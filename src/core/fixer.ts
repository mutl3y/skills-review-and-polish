/**
 * Surgical fixer — fragment-level fix pipeline for VS Code.
 *
 * Implementation details:
 *
 * Design constraints (from LEARNINGS.md):
 * - Never auto-apply without HITL confirmation — the extension calls this and
 *   decides whether to show a diff or apply via WorkspaceEdit.
 * - 1.5× growth guard (not 2×), 0.5× shrinkage floor, frontmatter protection.
 * - Obligation-token preservation, append-only for additive mode.
 * - Fails open on all optional LLM gates.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { promises as fsPromises } from 'fs';
import { AnalysisResult, LlmProvider, LlmRequest } from './types';
import { loadPrompt } from './prompts';
import { OBLIGATION_TOKENS, EMPHASIS_SCOPE_WORDS } from './vocabulary';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** The only codes the surgical fixer is permitted to touch. */
export const SURGICAL_FIXABLE_CODES = new Set([
  'ambiguity-llm',
  'hygiene-redundant-instruction',
  'hygiene-unordered-process',
  'hygiene-over-specification',
  'contradiction',
]);

/** Largest anchor we'll hand to the fix LLM (anything bigger risks structure damage). */
const MAX_SURGICAL_ANCHOR_CHARS = 350;

/** Noise margin for median-of-N keep/revert decisions. */
export const PENALTY_NOISE_MARGIN = 6;

// --------------------------------------------------------------------------
// Utility helpers
// --------------------------------------------------------------------------

function tokenPresent(text: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  // Use explicit boundary assertions instead of \b so tokens that start or
  // end with non-word characters (or are multi-word phrases) match correctly.
  // (?:(?<=\W)|(?<=^))  — preceded by a non-word char or start of string
  // (?:(?=\W)|(?=$))    — followed by a non-word char or end of string
  const boundary = '(?:(?<=\\W)|(?<=^))(?:' + esc + ')(?:(?=\\W)|(?=$))';
  return new RegExp(boundary, 'i').test(text);
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// --------------------------------------------------------------------------
// Structural utilities
// --------------------------------------------------------------------------

/**
 * Returns [start, end) char offsets for the YAML frontmatter block, or null.
 * Prevents the fixer from touching skill metadata (name/description/etc.).
 */
export function frontmatterRange(content: string): [number, number] | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const after = content.indexOf('\n', end + 1);
  return [0, after === -1 ? content.length : after + 1];
}

/**
 * Returns the enclosing markdown section (heading-to-next-heading) centred on
 * `targetText`, capped at `maxChars`. Returns null when it adds no context.
 */
export function surroundingContext(
  content: string,
  targetText: string,
  maxChars = 1200,
): string | null {
  const at = content.indexOf(targetText);
  if (at === -1) return null;
  let start = content.lastIndexOf('\n#', at);
  start = start === -1 ? 0 : start + 1;
  let end = content.indexOf('\n#', at + targetText.length);
  end = end === -1 ? content.length : end;
  let section = content.slice(start, end).trim();
  if (section.length > maxChars) {
    const localAt = section.indexOf(targetText);
    const half = Math.floor((maxChars - targetText.length) / 2);
    const s = Math.max(0, localAt - half);
    const e = Math.min(section.length, localAt + targetText.length + half);
    section =
      (s > 0 ? '…' : '') + section.slice(s, e).trim() + (e < section.length ? '…' : '');
  }
  if (section.length <= targetText.length + 8) return null;
  return section;
}

/**
 * One-line domain hint from frontmatter (name + description), reference-only.
 */
export function skillDomainHint(content: string): string | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = content.slice(3, end);
  const pick = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '').trim() : '';
  };
  const name = pick('name') || pick('title');
  const desc = pick('description');
  const hint = [name, desc].filter(Boolean).join(' — ');
  return hint ? hint.slice(0, 240) : null;
}

/**
 * Returns true when the text fragment has numerical/code/proper-noun content
 * that warrants loading a reference grounding file.
 */
export function factualGroundingTrigger(text: string): boolean {
  const s = String(text || '');
  // Numbers (version strings, thresholds, etc.)
  if (/\b\d+(?:[.\-–]\d+)?\b/.test(s)) return true;
  // Backtick-quoted code references
  if (/`[^`]+`/.test(s)) return true;
  // Dotted/segmented paths (e.g. src/core/fixer.ts, node_modules)
  if (/\b[A-Za-z]+(?:[._\-/][A-Za-z0-9]+)+\b/.test(s)) return true;
  // CamelCase identifiers (e.g. GitHubCopilot, YAMLFrontMatter)
  if (/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/.test(s)) return true;
  // ALL_CAPS or uppercase technical acronyms (e.g. API, HTTP, YAML)
  if (/\b[A-Z]{2,}[A-Z0-9_\-/]*\b/.test(s)) return true;
  // HTTP/HTTPS URLs
  if (/https?:\/\//i.test(s)) return true;
  // Sequential proper nouns in close proximity (e.g. "GitHub Copilot",
  // "OpenRouter API", "Copilot Pricing") — require 2+ consecutive
  // capitalized words where the second is NOT a common English word-start.
  // This avoids triggering on natural prose like "When Alice told Bob".
  const COMMON_STARTERS = new Set([
    'I', 'If', 'When', 'Then', 'The', 'This', 'That', 'Use', 'Return',
    'Do', 'And', 'But', 'Or', 'For', 'Not', 'All', 'Can', 'Will', 'May',
    'Has', 'Had', 'Was', 'Were', 'Are', 'Have', 'You', 'Your', 'Our',
    'Its', 'Let', 'Get', 'Set', 'Add', 'Put', 'See', 'Try', 'How', 'Why',
  ]);
  const tokens = s.split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i++) {
    const w1 = tokens[i].replace(/[^A-Za-z]/g, '');
    const w2 = tokens[i + 1].replace(/[^A-Za-z0-9]/g, '');
    if (
      w1.length >= 2 && w1[0] === w1[0].toUpperCase() &&
      w2.length >= 2 && w2[0] === w2[0].toUpperCase() &&
      !COMMON_STARTERS.has(w1) && !COMMON_STARTERS.has(w2)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Loads content from a sibling `references/` directory when
 * `fixReferenceGrounding` is enabled and the fragment is factual.
 */
export async function loadReferenceGrounding(
  filePath: string,
  targetText: string,
  enabled: boolean,
  maxChars = 1800,
): Promise<string | null> {
  if (!enabled) return null;
  // Skip reference grounding for untitled documents (no real file path)
  if (!filePath || filePath.trim() === '') return null;
  if (!factualGroundingTrigger(targetText)) return null;
  const refDir = path.join(path.dirname(filePath), 'references');
  try {
    await fsPromises.access(refDir);
  } catch {
    return null;
  }
  let stat: import('fs').Stats;
  try {
    stat = await fsPromises.stat(refDir);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  const allNames = await fsPromises.readdir(refDir);
  const files = allNames
    .filter((name) => /\.(md|mdx|txt|json|yaml|yml)$/i.test(name))
    .sort();

  // Reject symlinks — they could point outside the references directory
  const safeFiles: string[] = [];
  for (const name of files) {
    try {
      const lstat = await fsPromises.lstat(path.join(refDir, name));
      if (!lstat.isSymbolicLink()) safeFiles.push(name);
    } catch {
      // skip
    }
  }

  const parts: string[] = [];
  let remaining = maxChars;
  for (const name of safeFiles) {
    if (remaining <= 80) break;
    const full = path.join(refDir, name);
    // stat() (not lstat) follows symlinks — we already rejected symlinks above,
    // so this is a normal file or directory. We use it to distinguish between
    // the two (readdir lists both) and confirm the file is readable.
    let fileStat: import('fs').Stats;
    try {
      fileStat = await fsPromises.stat(full);
    } catch {
      continue;
    }
    if (!fileStat.isFile()) continue;
    // Path traversal guard: resolved path must remain inside refDir
    // Use path.sep to prevent traversal via same-prefix directory names
    // (e.g., refDir="/a/b" should not allow "/a/bad/file")
    const resolved = path.resolve(full);
    const refDirResolved = path.resolve(refDir);
    const sep = path.sep;
    if (!resolved.startsWith(refDirResolved + sep) && resolved !== refDirResolved) continue;
    let text: string;
    try {
      text = (await fsPromises.readFile(full, 'utf8')).trim();
    } catch {
      continue;
    }
    if (!text) continue;
    const header = `--- references/${name} ---\n`;
    const room = remaining - header.length;
    if (room <= 0) break;
    const body = text.length > room ? `${text.slice(0, Math.max(0, room - 1)).trim()}…` : text;
    parts.push(header + body);
    remaining -= header.length + body.length + 2;
  }
  return parts.length ? parts.join('\n\n') : null;
}

/**
 * Expand a short locator phrase to its surrounding paragraph via
 * whitespace-normalised match.
 */
export function expandToParagraph(content: string, phrase: string): string | null {
  const normPhrase = phrase.replace(/\s+/g, ' ').trim();
  const normContent = content.replace(/\r\n/g, '\n');

  let searchStart = normContent.indexOf(phrase);
  if (searchStart === -1) {
    const re = new RegExp(
      normPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s{1,3}'),
    );
    const m = normContent.match(re);
    searchStart = m ? normContent.indexOf(m[0]) : -1;
  }
  if (searchStart === -1) return null;

  let paraStart = searchStart;
  while (paraStart > 0) {
    const prev = normContent.lastIndexOf('\n\n', paraStart - 1);
    if (prev === -1) {
      paraStart = 0;
      break;
    }
    if (prev + 2 <= searchStart) {
      paraStart = prev + 2;
      break;
    }
    paraStart = prev;
  }
  const next = normContent.indexOf('\n\n', searchStart);
  const paraEnd = next !== -1 ? next : normContent.length;
  const para = normContent.slice(paraStart, paraEnd);
  return para.length > phrase.length ? para : null;
}

/**
 * Extract the paragraph surrounding a 0-indexed line number.
 */
export function extractParagraphAtLine(content: string, lineIndex: number): string | null {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  let start = lineIndex;
  while (start > 0 && lines[start - 1].trim() !== '') start--;
  let end = lineIndex;
  while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++;
  const para = lines.slice(start, end + 1).join('\n');
  return para.length > 20 && para.length < content.length * 0.8 ? para : null;
}

// --------------------------------------------------------------------------
// LLM prompts
// --------------------------------------------------------------------------

function stripSuggestion(message: string): string {
  return message.replace(/\s*Suggestion:[\s\S]*$/, '').trim();
}

export function surgicalFixSystemPrompt({ additive = false }: { additive?: boolean } = {}): string {
  const addRule = additive
    ? '- APPEND-ONLY (ambiguity-llm in additive mode): you must reproduce every word of the original fragment VERBATIM and only INSERT a short concrete clause after the vague term. Do NOT delete, replace, or reorder any existing word.'
    : '- Prefer pure deletion of vague qualifiers over rewording — shorter is safer.';
  const lengthRule = additive
    ? '- The fix may grow by at most one short clause (~80 chars); do NOT pad or restructure.'
    : '- Do NOT make the fragment longer than necessary; avoid padding, explanatory clauses, or parentheticals.';
  const ambiguityRule = additive
    ? '- For ambiguity-llm in additive mode: reproduce the full original text first, then INSERT a short concrete clause.'
    : '- For ambiguity-llm: remove or tighten the vague qualifier — DELETE the vague word or swap for a shorter concrete term.';

  const template = loadPrompt('surgical-fix');
  return template
    .replace('{{ADD_RULE}}', addRule)
    .replace('{{LENGTH_RULE}}', lengthRule)
    .replace('{{AMBIGUITY_RULE}}', ambiguityRule);
}

export function buildSurgicalFixPrompt(
  targetText: string,
  diagnostic: AnalysisResult,
  context: string | null = null,
  domain: string | null = null,
  additive = false,
  grounding: string | null = null,
  anchorId?: string,
): string {
  const code = diagnostic.code ?? '';
  const suggestion =
    diagnostic.suggestion ??
    (diagnostic.message ?? '').replace(/^.*Suggestion:\s*/, '').trim();
  const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();
  const showContext =
    context !== null &&
    norm(context) !== norm(targetText) &&
    norm(context).length > norm(targetText).length;

  let why = stripSuggestion(diagnostic.message ?? '')
    .replace(/^\s*Ambiguous:\s*"[\s\S]*?"\.\s*/i, '')
    .replace(/^\s*Contradiction:\s*/i, '')
    .trim();
  if (norm(why) === norm(targetText)) why = '';

  const taskMap: Record<string, string> = {
    'ambiguity-llm': additive
      ? 'APPEND-ONLY: keep the entire original sentence word-for-word (including the vague word) and INSERT a short concrete clause that says what the vague term means here. Do NOT delete, replace, or reorder any existing word, and do NOT invent a new value/name/number/step/timing — only restate what is already required. Return only the corrected sentence.'
      : 'Remove or tighten the vague qualifier(s) WITHOUT making the sentence longer — delete the vague word or swap it for a shorter concrete term. Keep the same obligation strength (do not drop consider/should/may) and keep every domain-specific word. Do not add explanatory clauses or parentheticals. Return only the corrected sentence.',
    'hygiene-redundant-instruction': 'This instruction is a duplicate. Return an empty string to delete it.',
    'hygiene-unordered-process': 'Number the items in this list to make the order explicit. Return only the numbered version.',
    'hygiene-over-specification': 'Remove the overly specific constraint that reduces reusability. Return only the corrected sentence.',
    contradiction: 'Reconcile the contradiction. Return only the corrected version of this fragment.',
  };
  const task = taskMap[code] ?? 'Fix the issue described below. Return only the corrected fragment.';

  const lines: Array<string | null> = [
    domain
      ? `Document domain (reference only — do NOT add facts from this into the fragment): ${domain}`
      : null,
    `Issue type: ${code}`,
    `Task: ${task}`,
    why
      ? `Why flagged (fix ONLY this aspect; leave every other word — names, numbers, ordering — untouched): ${why.slice(0, 240)}`
      : null,
    suggestion ? `Guidance: ${suggestion}` : null,
    showContext ? '' : null,
    showContext ? 'Surrounding section (READ-ONLY — for understanding only; do NOT edit or return this):' : null,
    showContext ? '<<<CONTEXT' : null,
    showContext ? context : null,
    showContext ? 'CONTEXT>>>' : null,
    grounding ? '' : null,
    grounding
      ? 'Skill references (READ-ONLY grounding — use ONLY to verify facts already present in the fragment; do NOT import new facts unless the exact added claim is traceable here):'
      : null,
    grounding ? `<<<REFERENCES_${anchorId ?? 'X'}` : null,
    grounding ? grounding : null,
    grounding ? `REFERENCES_${anchorId ?? 'X'}>>>` : null,
    '',
    'Fragment to fix (return ONLY a corrected version of THIS exact text, or [[ABSTAIN]]):',
    '"""',
    targetText,
    '"""',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// --------------------------------------------------------------------------
// Safety guards
// --------------------------------------------------------------------------

/**
 * Append-only verification: the original token sequence must be a subsequence
 * of the fixed tokens (every original token present, in original order).
 * Returns the first original token that breaks insertion-only order, or null.
 */
export function appendOnlyBreak(before: string, after: string): string | null {
  const tok = (s: string) => (String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const a = tok(before);
  const b = tok(after);
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    while (j < b.length && b[j] !== a[i]) j++;
    if (j >= b.length) return a[i];
    j++;
  }
  return null;
}

export function computeFixBounds(
  targetText: string,
  code: string,
  additive = false,
  guardOverrides?: { upperBoundMultiplier?: number; lowerBoundMultiplier?: number },
): { upperBound: number; lowerBound: number } {
  const isAdditiveFix = additive && code === 'ambiguity-llm';
  // Default multipliers: 1.1 for subtractive ambiguity, 1.6 for additive ambiguity, 1.5 for others
  const defaultUpperMul = code === 'ambiguity-llm' ? (isAdditiveFix ? 1.6 : 1.1) : 1.5;
  const upperMul = guardOverrides?.upperBoundMultiplier ?? defaultUpperMul;
  const upperBound = isAdditiveFix
    ? Math.max(targetText.length * upperMul, targetText.length + 80)
    : targetText.length * upperMul;
  const lowerMul = guardOverrides?.lowerBoundMultiplier ?? 0.5;
  const lowerBound = targetText.length * lowerMul;
  return { upperBound, lowerBound };
}

export function shouldRunOptionalFixGate(
  code: string,
  targetText: string,
  fixed: string,
  additive: boolean,
  options: SurgicalFixOptions,
): { selfCritique: boolean; semanticCheck: boolean } {
  const isAdditiveFix = additive && code === 'ambiguity-llm';
  const hasMeaningfulChange = editAddsAuditableContent(targetText, fixed);

  return {
    selfCritique: isAdditiveFix || ((options.selfCritique ?? false) && hasMeaningfulChange),
    semanticCheck: Boolean(options.semanticCheck),
  };
}

/**
 * Classify a proposed surgical edit and return human-readable risk flags.
 */
export function classifyEditRisk(code: string, before: string, after: string): string[] {
  const risks: string[] = [];
  const b = before ?? '';
  const a = after ?? '';

  if (a === '') {
    risks.push('DELETES an instruction');
    return risks;
  }

  const bLines = b.split('\n').length;
  const aLines = a.split('\n').length;
  if (aLines !== bLines) risks.push(`structure change (${bLines}→${aLines} lines)`);

  const markerCount = (s: string) => (s.match(/^[ \t]*([-*+]|\d+[.)])\s/gm) ?? []).length;
  if (markerCount(b) !== markerCount(a)) risks.push('list/bullet formatting changed');

  const nums = (s: string) => (s.match(/\d+(?:[.\-–]\d+)?/g) ?? []);
  const bn = nums(b).join(',');
  const an = nums(a).join(',');
  if (bn !== an) risks.push(`numeric value changed (${bn || '∅'} → ${an || '∅'})`);

  for (const w of EMPHASIS_SCOPE_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, 'ig');
    const bc = (b.match(re) ?? []).length;
    const ac = (a.match(re) ?? []).length;
    if (bc > ac) risks.push(`dropped scope word "${w}"`);
  }

  for (const t of OBLIGATION_TOKENS) {
    if (tokenPresent(b, t) && !tokenPresent(a, t))
      risks.push(`obligation/hedge "${t}" removed`);
  }

  const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'is', 'are', 'be',
    'that', 'this', 'you', 'your', 'it', 'as', 'at', 'by', 'from', 'use', 'using',
  ]);
  const words = (s: string) =>
    (s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
  const bSet = new Set(words(b));
  const aSet = new Set(words(a));
  const removed = [...bSet].filter((w) => !aSet.has(w));
  const added = [...aSet].filter((w) => !bSet.has(w));
  if (removed.length && added.length && aLines === bLines) {
    risks.push(
      `possible concept change (${removed.slice(0, 3).join('/')} → ${added.slice(0, 3).join('/')})`,
    );
  }

  const FILLER = new Set([
    'very', 'really', 'just', 'simply', 'actually', 'basically', 'quite',
    'rather', 'somewhat', 'fairly', 'truly', 'literally', 'essentially',
    'multiple', 'various', 'please', 'kindly',
  ]);
  const counts = (s: string) => {
    const m = new Map<string, number>();
    for (const w of words(s)) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const bCounts = counts(b);
  const aCounts = counts(a);
  const droppedByCount = [...bCounts.keys()].filter(
    (w) => (aCounts.get(w) ?? 0) < (bCounts.get(w) ?? 0),
  );
  if (added.length === 0 && aLines === bLines && a.length < b.length) {
    const meaningful = droppedByCount.filter((w) => !FILLER.has(w));
    if (meaningful.length) {
      risks.push(`dropped detail (${meaningful.slice(0, 3).join(', ')})`);
    }
  }
  return risks;
}

/**
 * Returns a reject reason string, or null if the fix should be accepted.
 */
export function meaningPreservationReject(
  code: string,
  targetText: string,
  fixed: string,
  additive = false,
): string | null {
  // 1. Delimiter injection
  if (countOf(fixed, '```') > countOf(targetText, '```')) return 'fence-injection';
  if (countOf(fixed, '"""') > countOf(targetText, '"""')) return 'docstring-injection';
  if (countOf(fixed, "'''") > countOf(targetText, "'''")) return 'docstring-injection';

  // 2. Line deletion (except for redundant-instruction which deletes intentionally)
  if (code !== 'hygiene-redundant-instruction') {
    const fixedLines = fixed.trim().split('\n').length;
    const targetLines = targetText.trim().split('\n').length;
    if (fixedLines < targetLines) return 'line-deletion';
  }

  // 3. Obligation-strength preservation
  if (code === 'ambiguity-llm' || code === 'contradiction') {
    for (const tok of OBLIGATION_TOKENS) {
      if (tokenPresent(targetText, tok) && !tokenPresent(fixed, tok)) {
        return `obligation-drop:${tok}`;
      }
    }
  }

  // 4. Factual mutation / concept swap
  if (code === 'ambiguity-llm' || code === 'contradiction') {
    const risks = classifyEditRisk(code, targetText, fixed);
    if (risks.some((r) => r.startsWith('numeric value changed'))) return 'numeric-change';
    if (additive && code === 'ambiguity-llm') {
      const broke = appendOnlyBreak(targetText, fixed);
      if (broke) return `append-only-violation(not-insertion-only: "${broke}")`;
      return null;
    }
    const concept = risks.find((r) => r.startsWith('possible concept change'));
    if (concept) return `concept-swap${concept.slice('possible concept change'.length)}`;
  }
  return null;
}

function editAddsAuditableContent(before: string, after: string): boolean {
  const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'is', 'are', 'be',
    'that', 'this', 'you', 'your', 'it', 'as', 'at', 'by', 'from', 'use', 'using',
  ]);
  const tokens = (s: string) =>
    (String(s).toLowerCase().match(/[a-z0-9][a-z0-9._/-]*/g) ?? []).filter((t) => !STOP.has(t));
  const counts = (s: string) => {
    const m = new Map<string, number>();
    for (const t of tokens(s)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const beforeCounts = counts(before);
  const afterCounts = counts(after);
  return [...afterCounts.entries()].some(([token, count]) => count > (beforeCounts.get(token) ?? 0));
}

// --------------------------------------------------------------------------
// Optional LLM gates (fail-open)
// --------------------------------------------------------------------------

async function fixPreservesMeaning(
  targetText: string,
  fixed: string,
  provider: LlmProvider,
): Promise<boolean> {
  try {
    const req: LlmRequest = {
      systemPrompt:
        'You are a tightening-judge for ambiguity fixes. Judge whether a revised directive is a LEGITIMATE TIGHTENING that removes vagueness without changing obligations. Reply with ONLY YES or NO.',
      prompt: [
        'ORIGINAL directive:',
        '"""',
        targetText,
        '"""',
        '',
        'REVISED directive:',
        '"""',
        fixed,
        '"""',
        '',
        'Is the revision a LEGITIMATE TIGHTENING? Judge:',
        '- What MUST/SHOULD/MAY the model do in original? What in revised?',
        '- If obligation/scope same or stronger (just removed vague hedges): YES',
        '- If obligation changed (should→must, consider→use), requirement dropped, or scope narrowed: NO',
        '',
        'Answer YES or NO only.',
      ].join('\n'),
    };
    const res = await provider.complete(req);
    if (res.error) return true;
    return /^\s*yes\b/i.test(res.text ?? '');
  } catch {
    return true; // fail-open
  }
}

async function fixIntroducesFact(
  targetText: string,
  fixed: string,
  provider: LlmProvider,
): Promise<string> {
  try {
    const req: LlmRequest = {
      systemPrompt:
        'You audit a text edit for FACTUAL DRIFT. Reply with ONLY "OK" or "DRIFT: <reason in <=8 words>".',
      prompt: [
        'ORIGINAL:', '"""', targetText, '"""', '',
        'EDITED:', '"""', fixed, '"""', '',
        'Does EDITED change or ADD any FACT not in ORIGINAL — a number, name, framework/library/API,',
        'config key, ordering (sequential/parallel, before/after), or cause/effect? Merely deleting a',
        'vague qualifier is NOT drift. Reply "OK" or "DRIFT: <reason>".',
      ].join('\n'),
    };
    const res = await provider.complete(req);
    if (res.error) return '';
    const m = (res.text ?? '').trim().match(/^DRIFT:\s*(.+)$/i);
    return m ? m[1].trim().slice(0, 60) : '';
  } catch {
    return ''; // fail-open
  }
}

// --------------------------------------------------------------------------
// Fix-single-issue result
// --------------------------------------------------------------------------

export interface FixIssueResult {
  /** Whether the fix was accepted by all guards. */
  accepted: boolean;
  /** The fixed text (only meaningful when accepted=true). */
  fixed: string;
  /** Risk flags from classifyEditRisk. */
  risks: string[];
  /** Reason the fix was rejected, if accepted=false. */
  rejectReason?: string;
}

export interface SurgicalFixOptions {
  additive?: boolean;
  semanticCheck?: boolean;
  selfCritique?: boolean;
  referenceGrounding?: boolean;
  /** Guard overrides - optional values to replace hardcoded defaults. */
  guardUpperBoundMultiplier?: number;
  guardLowerBoundMultiplier?: number;
  guardMaxAnchorChars?: number;
  /**
   * Optional 0-based line to disambiguate which occurrence of a duplicated
   * anchor to fix. When provided, the anchor is resolved to the paragraph at
   * that line (via extractParagraphAtLine) so the fix targets the correct
   * occurrence instead of the first match.
   */
  line?: number;
}

// --------------------------------------------------------------------------
// SurgicalFixer class
// --------------------------------------------------------------------------

/**
 * Ports the surgical fix pipeline from cli-analyzer.js.
 * Callers are responsible for HITL: this class only computes proposed fixes
 * and applies safety guards — it never writes files autonomously.
 */
export class SurgicalFixer {
  constructor(private provider: LlmProvider) {}

  /**
   * Compute a proposed fix for a single diagnostic against `text`.
   * Does NOT modify the document; returns the fixed fragment text and risk
   * flags. The caller (extension.ts) handles HITL confirmation and writing.
   */
  async fixIssue(
    text: string,
    filePath: string,
    diagnostic: AnalysisResult,
    options: SurgicalFixOptions = {},
  ): Promise<FixIssueResult> {
    const code = diagnostic.code ?? '';
    if (!SURGICAL_FIXABLE_CODES.has(code)) {
      return {
        accepted: false,
        fixed: '',
        risks: [],
        rejectReason: `code "${code}" is not surgical-fixable`,
      };
    }

    const resolved = this.resolveAnchorText(text, diagnostic, code, options.guardMaxAnchorChars, options.line);
    if (resolved.rejectReason) {
      return { accepted: false, fixed: '', risks: [], rejectReason: resolved.rejectReason };
    }
    const targetText = resolved.targetText;
    if (!targetText) {
      return { accepted: false, fixed: '', risks: [], rejectReason: 'anchor not found' };
    }

    const additive = (options.additive ?? false) && code === 'ambiguity-llm';
    const context = surroundingContext(text, targetText);
    const domain = skillDomainHint(text);
    const grounding = await loadReferenceGrounding(filePath, targetText, options.referenceGrounding ?? true);
    // Random anchor for the reference data zone — prevents an attacker who
    // knows the delimiter from breaking out of the data zone and injecting
    // instructions into the fix prompt.
    const anchorId = crypto.randomUUID();

    // Call fixer LLM - use 'fix' tier to get the dedicated fix model
    const req: LlmRequest = {
      prompt: buildSurgicalFixPrompt(targetText, diagnostic, context, domain, additive, grounding, anchorId),
      systemPrompt: surgicalFixSystemPrompt({ additive }),
      modelTier: 'fix',
    };
    let llmResp;
    try {
      llmResp = await this.provider.complete(req);
    } catch (e) {
      return { accepted: false, fixed: '', risks: [], rejectReason: `LLM error: ${String(e)}` };
    }
    if (llmResp.error) {
      return { accepted: false, fixed: '', risks: [], rejectReason: `LLM error: ${llmResp.error}` };
    }

    const fixed = llmResp.text.trim();

    // Abstain
    if (/^\[\[ABSTAIN\]\]/i.test(fixed)) {
      const reason = fixed.replace(/^\[\[ABSTAIN\]\]\s*:?\s*/i, '').trim();
      return {
        accepted: false,
        fixed: '',
        risks: [],
        rejectReason: `model abstained${reason ? ': ' + reason : ''}`,
      };
    }

    const rejectReason = this.rejectCandidate(code, targetText, fixed, additive, {
      upperBoundMultiplier: options.guardUpperBoundMultiplier,
      lowerBoundMultiplier: options.guardLowerBoundMultiplier,
    });
    if (rejectReason) {
      return { accepted: false, fixed: '', risks: [], rejectReason };
    }

    // Optional self-critique (factual drift)
    const gates = shouldRunOptionalFixGate(code, targetText, fixed, additive, options);
    if (gates.selfCritique) {
      const critiqueReason = await fixIntroducesFact(targetText, fixed, this.provider);
      if (critiqueReason) {
        return {
          accepted: false,
          fixed: '',
          risks: [],
          rejectReason: `self-critique: ${critiqueReason}`,
        };
      }
    }

    // Optional semantic judge
    if (gates.semanticCheck) {
      const ok = await fixPreservesMeaning(targetText, fixed, this.provider);
      if (!ok) {
        return {
          accepted: false,
          fixed: '',
          risks: [],
          rejectReason: 'semantic-judge: obligation/scope change',
        };
      }
    }

    const risks = classifyEditRisk(code, targetText, fixed);
    return { accepted: true, fixed, risks };
  }

  private resolveAnchorText(
    text: string,
    diagnostic: AnalysisResult,
    code: string,
    guardMaxAnchorChars?: number,
    line?: number,
  ): { targetText: string | null; rejectReason: string | null } {
    const rawAnchor = diagnostic.relevantText ?? this.extractAnchorFromMessage(diagnostic.message, code);
    if (!rawAnchor || !rawAnchor.trim()) return { targetText: null, rejectReason: 'empty or whitespace-only anchor' };

    // When a line is provided, resolve the anchor to the paragraph at that
    // line FIRST — this disambiguates which occurrence of a duplicated anchor
    // to fix, instead of always taking the first match. If the paragraph
    // extraction fails, REJECT rather than silently falling back to first-match
    // (which would defeat the disambiguation).
    let targetText: string | null = null;
    if (line !== undefined && line >= 0) {
      targetText = extractParagraphAtLine(text, line);
      if (!targetText) {
        return { targetText: null, rejectReason: 'anchor not found at the given line' };
      }
    } else {
      targetText = text.includes(rawAnchor) ? rawAnchor : expandToParagraph(text, rawAnchor);
      if (!targetText) {
        const diagLine = diagnostic.range?.start?.line ?? -1;
        if (diagLine >= 0) targetText = extractParagraphAtLine(text, diagLine);
      }
    }

    if (!targetText) return { targetText: null, rejectReason: 'anchor not found' };
    const maxAnchor = guardMaxAnchorChars ?? MAX_SURGICAL_ANCHOR_CHARS;
    if (targetText.length > maxAnchor) {
      return { targetText: null, rejectReason: `anchor too large (${targetText.length} chars)` };
    }

    const fm = frontmatterRange(text);
    if (fm) {
      const at = text.indexOf(targetText);
      if (at !== -1 && at < fm[1]) {
        return { targetText: null, rejectReason: 'anchor overlaps frontmatter' };
      }
    }

    return { targetText, rejectReason: null };
  }

  private rejectCandidate(
    code: string,
    targetText: string,
    fixed: string,
    additive: boolean,
    guardOverrides?: { upperBoundMultiplier?: number; lowerBoundMultiplier?: number },
  ): string | null {
    const { upperBound, lowerBound } = computeFixBounds(targetText, code, additive, guardOverrides);

    if (code === 'hygiene-redundant-instruction' && fixed === '') {
      return null;
    }
    if (fixed === targetText) return 'identical output';
    if (fixed.length >= upperBound) return `expansion (${fixed.length} chars vs ${targetText.length})`;
    if (fixed.length < lowerBound) return `shrinkage (${fixed.length} chars vs ${targetText.length})`;

    const guardReason = meaningPreservationReject(code, targetText, fixed, additive);
    return guardReason ? `meaning-guard: ${guardReason}` : null;
  }

  /**
   * Compute proposed fixes for all SURGICAL_FIXABLE_CODES diagnostics in a
   * document. Returns a map of `anchorText → fixedText` for each accepted fix,
   * along with the resulting full document text.
   */
  async fixDocument(
    text: string,
    filePath: string,
    diagnostics: AnalysisResult[],
    options: SurgicalFixOptions = {},
    guardOverrides?: { upperBoundMultiplier?: number; lowerBoundMultiplier?: number; maxAnchorChars?: number },
  ): Promise<{ fixedText: string; applied: number; skipped: number; skippedReasons: string[] }> {
    const fixable = diagnostics
      .filter((d) => SURGICAL_FIXABLE_CODES.has(d.code ?? ''))
      .sort((a, b) => (b.range?.start?.line ?? 0) - (a.range?.start?.line ?? 0));
    let content = text;
    let applied = 0;
    let skipped = 0;
    const skippedReasons: string[] = [];

    // Merge guard overrides into options for fixIssue calls
    const optsWithGuards: SurgicalFixOptions = {
      ...options,
      guardUpperBoundMultiplier: guardOverrides?.upperBoundMultiplier,
      guardLowerBoundMultiplier: guardOverrides?.lowerBoundMultiplier,
      guardMaxAnchorChars: guardOverrides?.maxAnchorChars,
    };

    for (const d of fixable) {
      const result = await this.fixIssue(content, filePath, d, optsWithGuards);
      if (!result.accepted) {
        skipped++;
        skippedReasons.push(`${d.code}: ${result.rejectReason ?? 'unknown'}`);
        continue;
      }
      // Find the anchor in the (possibly already-modified) content
      const rawAnchor =
        d.relevantText ?? this.extractAnchorFromMessage(d.message, d.code ?? '');
      const anchor = rawAnchor && content.includes(rawAnchor)
        ? rawAnchor
        : expandToParagraph(content, rawAnchor ?? '') ??
          extractParagraphAtLine(content, d.range?.start?.line ?? -1);
      if (!anchor) {
        skipped++;
        skippedReasons.push(`${d.code}: anchor not found in document`);
        continue;
      }

      // Count occurrences of anchor to avoid corrupting the wrong instance.
      const anchorCount = countOf(content, anchor);
      if (anchorCount !== 1) {
        // Ambiguous anchor — skip to avoid silent data corruption.
        skipped++;
        skippedReasons.push(`${d.code}: ambiguous anchor (${anchorCount} occurrences)`);
        continue;
      }

      // Use function-as-replacement to prevent $-pattern interpretation
      // (e.g. $variable being treated as a replacement token).
      if (d.code === 'hygiene-redundant-instruction' && result.fixed === '') {
        content = content.replace(anchor + '\n', '').replace(anchor, () => '');
      } else {
        content = content.replace(anchor, () => result.fixed);
      }
      applied++;
    }

    return { fixedText: content, applied, skipped, skippedReasons };
  }

  private extractAnchorFromMessage(message: string | undefined, code: string): string | null {
    if (!message) return null;
    if (code === 'ambiguity-llm') {
      const m = message.match(/^Ambiguous: "(.+?)"\./s);
      return m ? m[1] : null;
    }
    if (code === 'contradiction') {
      const m = message.match(/^Contradiction: "(.+?)" conflicts/s);
      return m ? m[1] : null;
    }
    return null;
  }
}
