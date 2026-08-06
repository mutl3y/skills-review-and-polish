import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import * as fs from 'fs';
import * as path from 'path';
import { ALL_WAVES, DEFAULT_ENGINE_CONFIG, Engine } from '../core/index';
import { SurgicalFixer } from '../core/fixer';
import { setTransport } from '../core/logger';
import { redactSecrets } from '../core/redact';
import { acceptFinding, loadAcceptedFindings, isFindingAccepted, validateRelevantText } from '../core/acceptedFindings';
import { validateKeyForProvider } from '../core/providerKeys';
import { safeResolveFilePath as safeResolveFilePathShared } from '../core/pathSafety';
import { CHARS_PER_TOKEN as CHARS_PER_TOKEN_SHARED, DEFAULT_DOCUMENT_CHARS } from '../core/tokenBudget';
import { OpenRouterProvider, CopilotProvider } from '../providers/externalProvider';
import { resolveContextLength, resolveCopilotContextLength } from '../modelCatalog';
import type { AnalysisResult, EngineConfig, LlmProvider, Severity, WaveName } from '../core/types';

export interface McpEngineConfig {
  provider: string;
  model: string;
  deepModel?: string;
  fixModel?: string;
  structuredOutput?: boolean | 'schema';
  requestTimeoutMs?: number;
  configSource: string;
  engineConfig?: EngineConfig;
}
/**
 * Maximum text length accepted by tools. Prevents runaway LLM costs.
 *
 * This must be at least as large as the analyzer's maximum document budget so
 * large production skills aren't rejected before they reach the analyzer. The
 * analyzer's budget is derived from the provider's context length (up to a
 * 200K-char fallback, and more for large-context models like gemini-3.5-flash
 * at 1M tokens). We set this to 200K to match the analyzer's fallback budget;
 * the analyzer itself will still truncate/notify if a model's context is
 * smaller than the document.
 */
const MAX_TEXT_LENGTH = DEFAULT_DOCUMENT_CHARS; // ~50k tokens

/** Minimum document chars the analyzer always accepts (mirrors Analyzer.MIN_DOCUMENT_CHARS). */
const MIN_DOCUMENT_CHARS = 8_000;

// ---------------------------------------------------------------------------
// Cost budget guard
// ---------------------------------------------------------------------------
// The MCP server has no spending cap by default — error redaction exists, but
// there is no guard against a runaway loop of analyze/score/verify_fix calls
// burning through a provider quota. This budget tracks cumulative *total*
// tokens (input + output) per server session and refuses new analysis requests
// once exceeded. It is a soft, configurable guard (not a hard wall): operators
// can raise or disable it via env var or `.skills-review.json`.
//
// Default: 500k total tokens per session (~$0.05-0.15 at current rates). Input
// tokens dominate (a 200K-char doc is ~50K input tokens per wave × 6 waves),
// so the cap is sized for total spend, not just output.
const DEFAULT_MAX_TOKENS_PER_SESSION = 500_000;
/** Rough chars-per-token heuristic used when the provider reports no usage. */
const CHARS_PER_TOKEN = CHARS_PER_TOKEN_SHARED;

/** Cumulative total-token budget state for the current server session. */
let _sessionTokens = 0;
/** Configured cap for the current session (0 disables the guard). */
let _maxTokensPerSession = DEFAULT_MAX_TOKENS_PER_SESSION;

/** Reset the session budget (for tests). */
export function _resetSessionBudget(): void {
  _sessionTokens = 0;
  _maxTokensPerSession = DEFAULT_MAX_TOKENS_PER_SESSION;
}

/** Set the session budget cap directly (for tests). 0 disables the guard. */
export function _setSessionBudgetCap(cap: number): void {
  _maxTokensPerSession = cap > 0 ? Math.floor(cap) : 0;
}

/** Read the budget cap from env var or config value. Returns 0 to disable. */
function resolveMaxTokensPerSession(value: unknown): number {
  const env = process.env.MCP_MAX_TOKENS;
  // Env var takes precedence; an explicit "0" disables the guard.
  if (env !== undefined && env.trim() !== '') {
    const n = Number(env);
    if (Number.isFinite(n)) return n > 0 ? Math.floor(n) : 0;
  }
  // Config-file value: accept a positive number, or an explicit 0 to disable.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.floor(value) : 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n > 0 ? Math.floor(n) : 0;
  }
  return DEFAULT_MAX_TOKENS_PER_SESSION;
}

/**
 * Estimate output tokens for a response body (chars / CHARS_PER_TOKEN).
 * Strips insignificant JSON whitespace first so pretty-printed bodies
 * (JSON.stringify(x, null, 2)) aren't over-charged for indentation.
 */
function estimateOutputTokens(text: string): number {
  const compact = text.replace(/\s+/g, '');
  return Math.ceil(compact.length / CHARS_PER_TOKEN);
}

/**
 * Charge the session budget for an LLM call. Returns true if the charge
 * was accepted (within budget). When the charge would exceed the cap, the
 * budget is still incremented (so `usedTokens` stays honest) and false
 * is returned — the caller may still return the result, but subsequent
 * analysis requests will be refused until the next session.
 *
 * Charges BOTH input and output tokens: the expensive part of an LLM call is
 * the input (a 200K-char document is ~50K input tokens per wave, × 6 waves).
 * `inputChars` is the document text length; `outputText` is the response body.
 * `inputWaves` is the number of times the input is sent to the LLM (analyze
 * runs 6 waves; score runs scoreSamples × waves) — the input cost is charged
 * per wave so the budget reflects actual spend.
 */
function chargeTokens(inputChars: number, outputText: string, inputWaves = 1): boolean {
  if (_maxTokensPerSession <= 0) return true; // guard disabled
  const inputCost = Math.ceil(inputChars / CHARS_PER_TOKEN) * inputWaves;
  const outputCost = estimateOutputTokens(outputText);
  _sessionTokens += inputCost + outputCost;
  return _sessionTokens <= _maxTokensPerSession;
}

/**
 * Reserve the estimated cost of a multi-call operation BEFORE it runs, so a
 * single `fix` (which makes up to 3 LLM calls) can't blow through the entire
 * remaining budget. Returns true when the reservation fits within the cap.
 * The reservation is a soft pre-check — the actual charge happens after the
 * call via `chargeTokens` — but it prevents starting an operation that is
 * guaranteed to exceed the budget.
 */
function reserveTokens(inputChars: number, inputWaves: number): boolean {
  if (_maxTokensPerSession <= 0) return true; // guard disabled
  const inputCost = Math.ceil(inputChars / CHARS_PER_TOKEN) * inputWaves;
  return _sessionTokens + inputCost <= _maxTokensPerSession;
}

/**
 * Estimate how many LLM waves an analysis will run, so the cost budget
 * charges the input per wave (not a flat 6). Mirrors the engine's mode logic:
 * single=1, focused=2, multiWave=enabledWaves.length (default 6). A direct
 * `analysisWaves` list (argument or engine config) overrides the mode.
 */
function estimateWaveCount(
  engineConfig: EngineConfig | undefined,
  analysisWaves: string[] | undefined,
): number {
  // The engine's precedence is: configOverride (the analysisWaves argument
  // here) > engineConfig.analysisWaves > analysisMode. So check the argument
  // FIRST — it represents the per-call override that wins in the engine.
  if (analysisWaves && analysisWaves.length > 0) return analysisWaves.length;
  const configWaves = engineConfig?.analysisWaves;
  if (configWaves && configWaves.length > 0) return configWaves.length;
  const mode = engineConfig?.analysisMode ?? DEFAULT_ENGINE_CONFIG.analysisMode;
  if (mode === 'single') return 1;
  if (mode === 'focused') return 2;
  return engineConfig?.enabledWaves?.length ?? ALL_WAVES.length;
}

/** True when the session budget is exhausted (guard enabled and over cap). */
function budgetExhausted(): boolean {
  return _maxTokensPerSession > 0 && _sessionTokens > _maxTokensPerSession;
}

/** Error message returned when the budget is exhausted. */
function budgetExhaustedError(): Error {
  return new Error(
    `MCP session token budget exhausted (${_sessionTokens} / ${_maxTokensPerSession} tokens). ` +
    `Refusing new analysis requests until the next session. Raise the cap via ` +
    `MCP_MAX_TOKENS or the "maxTokensPerSession" config, or set it to 0 to disable.`,
  );
}

/**
 * Sanitize an error message to remove secrets (Bearer tokens, API keys, etc.)
 * before returning it in MCP responses.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  // Delegate to the shared redaction helper so the MCP server and the logger
  // use one source of truth (they were drifting).
  return redactSecrets(msg);
}

/** Resolve the accepted-findings path from MCP_SERVER_WORKSPACE env var (or cwd fallback). */
function resolveAcceptedFindingsPath(): string {
  const workspaceRoot = process.env['MCP_SERVER_WORKSPACE']?.trim() || process.cwd();
  return path.join(workspaceRoot, '.accepted-findings.json');
}

/**
 * Resolve the MCP server's workspace root. All file paths accepted by tools
 * must stay under this root — it is the trust boundary for the MCP server.
 */
function resolveWorkspaceRoot(): string {
  return process.env['MCP_SERVER_WORKSPACE']?.trim() || process.cwd();
}

/**
 * Validate and resolve a `filePath` argument against the workspace root.
 *
 * The MCP server is driven by an LLM agent, so `filePath` and document content
 * are attacker-controlled. We must NOT trust a path derived from the input —
 * the fixer/analyzer derive their reference dirs from `filePath`, so an
 * attacker could point it at `/etc/references` or `~/.ssh/references` to read
 * arbitrary files. This resolves the path against the fixed workspace root and
 * rejects anything that escapes it (absolute paths, `..`, and symlinks that
 * point outside the root).
 *
 * `requireExists` controls whether the path must exist on disk:
 *   - `true` (default): reject non-existent paths. Used by read operations
 *     (fix/analyze/score) where the path is later read from disk — returning
 *     an unresolved lexical path would open a TOCTOU hole (an attacker could
 *     create a symlink at that path between check and use).
 *   - `false`: resolve lexically against the root and reject escapes, but do
 *     NOT require the file to exist. Used by store-key operations
 *     (accept_finding / list_accepted_findings) where the path is only a key
 *     into the accepted-findings store and is never read from disk — an agent
 *     may legitimately accept a finding for a proposed/unsaved path.
 *
 * Returns the resolved absolute path, or `undefined` when the path escapes the
 * workspace root (or, when `requireExists`, is missing).
 */
/**
 * Validate and resolve a `filePath` argument against the MCP workspace root.
 *
 * The MCP server is driven by an LLM agent, so `filePath` and document content
 * are attacker-controlled. We must NOT trust a path derived from the input —
 * the fixer/analyzer derive their reference dirs from `filePath`, so an
 * attacker could point it at `/etc/references` or `~/.ssh/references` to read
 * arbitrary files. This delegates to the shared `safeResolveFilePath` (the
 * same canonical-to-canonical logic the extension uses) so the two doors
 * cannot diverge.
 *
 * `requireExists` controls whether the path must exist on disk (see the shared
 * helper). Returns the resolved absolute path, or `undefined` when the path
 * escapes the workspace root (or, when `requireExists`, is missing).
 */
function safeResolveFilePath(filePath: string | undefined, requireExists = true): string | undefined {
  return safeResolveFilePathShared(filePath, path.resolve(resolveWorkspaceRoot()), requireExists);
}
function requireString(args: Record<string, unknown>, key: string): string {
  const val = typeof args[key] === 'string' ? args[key] : '';
  if (!val.trim()) throw new Error(`Missing required argument: ${key}`);
  return val;
}

/**
 * Resolve a `filePath` argument against the workspace root, throwing a clear
 * error when the path escapes the workspace (so the caller fails loudly
 * instead of silently degrading to a wrong reference directory).
 */
function requireSafeFilePath(args: Record<string, unknown>): string | undefined {
  const raw = optionalString(args, 'filePath');
  if (raw === undefined) return undefined;
  const resolved = safeResolveFilePath(raw);
  if (resolved === undefined) {
    throw new Error(`filePath "${raw}" is outside the MCP workspace root and was rejected.`);
  }
  return resolved;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string) : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  return undefined;
}

/**
 * Resolve the 3-state structuredOutput value (boolean | 'schema') from a
 * file/env value. Accepts:
 *   - 'schema' (string)        → 'schema' (strict JSON schema mode)
 *   - true / 'true' / '1' / 'on' → true (legacy json_object mode)
 *   - false / 'false' / '0' / 'off' → false (no response_format)
 *   - undefined               → undefined (caller applies its own default)
 */
function structuredOutputValue(value: unknown): boolean | 'schema' | undefined {
  if (value === 'schema') return 'schema';
  const bool = optionalBoolean(value);
  if (typeof bool === 'boolean') return bool;
  if (value === undefined) return undefined;
  // Unknown non-boolean values map to 'schema' — safer default.
  return 'schema';
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/**
 * Compute the maximum accepted text length for a given provider context
 * length (in tokens). Mirrors the analyzer's document-budget math
 * (1 token ≈ 4 chars, reserve a fraction for system prompt + response, with
 * a minimum-document floor so tiny models still get useful text). Falls back
 * to `MAX_TEXT_LENGTH` when the context is unknown.
 */
function maxTextLengthForContext(contextLength: number | undefined): number {
  if (contextLength && contextLength > 0) {
    return Math.max(Math.floor(contextLength * 4 * 0.8), MIN_DOCUMENT_CHARS);
  }
  return MAX_TEXT_LENGTH;
}

/** Resolve the provider's context length defensively (may be absent in mocks). */
function providerContextLength(engine: Engine): number | undefined {
  try {
    return engine.provider?.getContextLength?.();
  } catch {
    return undefined;
  }
}

function requireText(args: Record<string, unknown>, maxLength = MAX_TEXT_LENGTH): string {
  const text = requireString(args, 'text');
  if (text.length > maxLength) {
    throw new Error(`Text too long: ${text.length} chars (max ${maxLength}). Split the document or analyze a subsection.`);
  }
  return text;
}

/**
 * Validate and sanitize relevantText for the accept_finding tool.
 * Returns the trimmed/sanitized text, or throws with a descriptive error.
 */
function asWaveList(value: unknown, fallback: WaveName[] = [...ALL_WAVES]): WaveName[] {
  const valid = new Set<WaveName>(ALL_WAVES);
  if (!Array.isArray(value)) return fallback;
  const waves = value.filter((w): w is WaveName => typeof w === 'string' && valid.has(w as WaveName));
  return waves.length > 0 ? waves : fallback;
}

function asAnalysisMode(value: unknown): EngineConfig['analysisMode'] {
  return value === 'single' || value === 'focused' || value === 'multiWave'
    ? value
    : DEFAULT_ENGINE_CONFIG.analysisMode;
}

function asFixStrategy(value: unknown): EngineConfig['fixStrategy'] {
  return value === 'additive' ? 'additive' : DEFAULT_ENGINE_CONFIG.fixStrategy;
}

function asSeverityOverrides(value: unknown): Record<string, Severity | 'off'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(['error', 'warning', 'info', 'hint', 'off']);
  const out: Record<string, Severity | 'off'> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && allowed.has(raw)) out[key] = raw as Severity | 'off';
  }
  return out;
}

function buildEngineConfig(raw: Record<string, unknown> = {}): EngineConfig {
  return {
    ...DEFAULT_ENGINE_CONFIG,
    analysisMode: asAnalysisMode(raw['analysisMode']),
    enabledWaves: asWaveList(raw['enabledWaves']),
    analysisWaves: Array.isArray(raw['analysisWaves'])
      ? asWaveList(raw['analysisWaves'], [])
      : undefined,
    scoreSamples: typeof raw['scoreSamples'] === 'number'
      ? Math.max(1, Math.min(5, Math.floor(raw['scoreSamples'])))
      : DEFAULT_ENGINE_CONFIG.scoreSamples,
    fixStrategy: asFixStrategy(raw['fixStrategy']),
    fixSemanticCheck: typeof raw['fixSemanticCheck'] === 'boolean' ? raw['fixSemanticCheck'] : DEFAULT_ENGINE_CONFIG.fixSemanticCheck,
    fixSelfCritique: typeof raw['fixSelfCritique'] === 'boolean' ? raw['fixSelfCritique'] : DEFAULT_ENGINE_CONFIG.fixSelfCritique,
    fixReferenceGrounding: typeof raw['fixReferenceGrounding'] === 'boolean' ? raw['fixReferenceGrounding'] : DEFAULT_ENGINE_CONFIG.fixReferenceGrounding,
    filterFindings: typeof raw['filterFindings'] === 'boolean' ? raw['filterFindings'] : DEFAULT_ENGINE_CONFIG.filterFindings,
    severityOverrides: asSeverityOverrides(raw['severityOverrides']),
    fixGuardUpperBoundMultiplier: typeof raw['fixGuardUpperBoundMultiplier'] === 'number' ? raw['fixGuardUpperBoundMultiplier'] : undefined,
    fixGuardLowerBoundMultiplier: typeof raw['fixGuardLowerBoundMultiplier'] === 'number' ? raw['fixGuardLowerBoundMultiplier'] : undefined,
    fixGuardMaxAnchorChars: typeof raw['fixGuardMaxAnchorChars'] === 'number' ? raw['fixGuardMaxAnchorChars'] : undefined,
  };
}

interface ToolHandlerContext {
  getEngine: () => Promise<Engine>;
  resolvedConfig: McpEngineConfig | undefined;
  /**
   * Optional callback to send an MCP `notifications/progress` notification.
   * Clients that set `resetTimeoutOnProgress` on their request will keep the
   * request alive as long as the server keeps sending progress — this lets
   * long analyses (which can exceed the client's default 60s timeout) complete
   * without the client aborting. No-op when the client did not request a
   * progress token.
   */
  sendProgress?: (progress: number, total?: number, message?: string) => Promise<void>;
}

type ToolHandler = (args: Record<string, unknown>, ctx: ToolHandlerContext) => Promise<McpToolCallResult>;

/** Minimum interval (ms) between consecutive analyze calls to prevent quota exhaustion. */
const ANALYZE_COOLDOWN_MS = 5_000;
/** Exported for test reset — not part of public API. */
let _lastAnalyzeTimestamp = 0;
/** Reset the rate-limit timestamp (for tests). */
export function _resetAnalyzeCooldown(): void { _lastAnalyzeTimestamp = 0; }

async function handleAnalyze(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  // Resolve the engine first so we can size the text limit to the provider's
  // context length (large-context models accept larger documents).
  const engine = await ctx.getEngine();
  const text = requireText(args, maxTextLengthForContext(providerContextLength(engine)));

  // Cost guard: refuse new analysis once the session budget is exhausted.
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }

  // Reserve the estimated input cost up front so a single analyze (which runs
  // multiple waves) can't blow through the entire remaining budget. The actual
  // charge happens after the call; this prevents starting an operation that is
  // guaranteed to exceed the cap.
  const wavesArg0 = args['analysisWaves'] ?? args['enabledWaves'];
  const validWaves0 = new Set<string>(ALL_WAVES);
  const waves0: string[] | undefined = Array.isArray(wavesArg0)
    ? (wavesArg0 as string[]).filter(w => validWaves0.has(w))
    : undefined;
  const reserveWaves = estimateWaveCount(ctx.resolvedConfig?.engineConfig, waves0);
  if (!reserveTokens(text.length, reserveWaves)) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }

  // Rate limit: enforce minimum interval between analyze calls
  const now = Date.now();
  if (now - _lastAnalyzeTimestamp < ANALYZE_COOLDOWN_MS) {
    const waitMs = ANALYZE_COOLDOWN_MS - (now - _lastAnalyzeTimestamp);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  _lastAnalyzeTimestamp = Date.now();

  // Parse optional analysisWaves parameter (also accepts legacy enabledWaves)
  const wavesArg = args['analysisWaves'] ?? args['enabledWaves'];
  const validWaves = new Set<string>(ALL_WAVES);
  const analysisWaves: string[] | undefined = Array.isArray(wavesArg)
    ? (wavesArg as string[]).filter(w => validWaves.has(w))
    : undefined;

  // Use configOverride with analysisWaves (E21 API) — cleaner than 3rd parameter.
  // analysisMode: 'multiWave' ensures wave selection runs (not single-pass).
  const configOverride = analysisWaves && analysisWaves.length > 0
    ? { analysisWaves: analysisWaves as WaveName[], analysisMode: 'multiWave' as const }
    : undefined;

  // Analysis always runs synchronously (single-request). If the client
  // requested a progress token, emit periodic progress so the request stays
  // alive past the client's default timeout (long analyses can take minutes).
  // The progress interval is a heartbeat, not a real % — the analyzer doesn't
  // expose per-wave progress, so we send a monotonic tick.
  let progressTimer: ReturnType<typeof setInterval> | undefined;
  if (ctx.sendProgress) {
    let tick = 0;
    progressTimer = setInterval(() => {
      tick += 1;
      void ctx.sendProgress?.(tick, undefined, 'analyzing…').catch(() => { /* client may have gone away */ });
    }, 15_000);
  }
  try {
    const results = await engine.analyze({
      text,
      filePath: requireSafeFilePath(args),
      acceptedFindingsPath: resolveAcceptedFindingsPath(),
    }, undefined, undefined, configOverride);
    const body = JSON.stringify(results, null, 2);
    // Charge the budget (input × waves + output). If this call pushes us
    // over the cap, we still return its result (the work is done) but mark
    // the budget exhausted so the next analysis request is refused.
    const waves = estimateWaveCount(ctx.resolvedConfig?.engineConfig, analysisWaves);
    chargeTokens(text.length, body, waves);
    return { content: [{ type: 'text', text: body }] };
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
}

async function handleFix(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const engine = await ctx.getEngine();
  const text = requireText(args, maxTextLengthForContext(providerContextLength(engine)));
  // Cost guard: fix invokes the LLM (and can loop), so it is a paid operation
  // that must respect the session budget too.
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }
  const diagnosticCode = requireString(args, 'diagnosticCode');
  const relevantText = requireString(args, 'relevantText');
  // Parse the optional line argument defensively — a malformed value (e.g.
  // parseInt('abc') → NaN) must NOT bypass the duplicate-anchor guard.
  const rawLine = args['line'];
  const line = typeof rawLine === 'number' && Number.isFinite(rawLine)
    ? rawLine
    : typeof rawLine === 'string' && rawLine.trim() !== '' && Number.isFinite(Number(rawLine))
      ? Number(rawLine)
      : undefined;

  // Bounds-check the line against the document's actual line count so an
  // out-of-range line can't anchor the fix to the wrong location. If a line
  // was explicitly provided but is out of range, reject loudly rather than
  // silently falling back to first-match.
  const lineCount = text.split('\n').length;
  if (line !== undefined && (line < 0 || line >= lineCount)) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          error: `line ${line} is out of range (document has ${lineCount} lines).`,
        }, null, 2),
      }],
      isError: true,
    };
  }
  const validLine = line;

  // Duplicate-anchor guard: count occurrences of the RAW relevantText (matching
  // the interactive path) so a fragment that appears multiple times is refused
  // unless a line disambiguates. The fixer would otherwise silently target the
  // first occurrence.
  if (validLine === undefined) {
    const occurrences = relevantText ? text.split(relevantText).length - 1 : 0;
    if (occurrences > 1) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            error: `relevantText appears ${occurrences} times in the document. Provide a "line" argument to disambiguate which occurrence to fix.`,
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  const resolvedLine = validLine ?? 0;
  const syntheticDiag: AnalysisResult = {
    code: diagnosticCode,
    message: relevantText,
    severity: 'warning',
    range: { start: { line: resolvedLine, character: 0 }, end: { line: resolvedLine, character: 0 } },
    analyzer: 'mcp',
    relevantText,
  };

  const fixer = new SurgicalFixer(engine.provider as LlmProvider);
  // Respect the configured safety gates (semantic check + self-critique) so
  // the MCP path gets the same protection as the interactive path — not
  // weaker. additive is the safe default for ambiguity fixes. Pass the line
  // so the fixer resolves the anchor at that line (disambiguating duplicates).
  const fixCfg = ctx.resolvedConfig?.engineConfig ?? DEFAULT_ENGINE_CONFIG;
  // The fixer makes up to 3 LLM calls: the fix itself, plus the semantic
  // check and self-critique gates when enabled. The fixer FORCES self-critique
  // for additive ambiguity fixes even when fixSelfCritique is off, so account
  // for that here or the budget under-reserves/under-charges the common
  // additive path.
  const isAdditiveFix = fixCfg.fixStrategy === 'additive';
  const selfCritiqueCalls = (fixCfg.fixSelfCritique || isAdditiveFix) ? 1 : 0;
  const fixWaves = 1 + (fixCfg.fixSemanticCheck ? 1 : 0) + selfCritiqueCalls;
  if (!reserveTokens(text.length, fixWaves)) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }],
      isError: true,
    };
  }
  const result = await fixer.fixIssue(text, requireSafeFilePath(args) ?? '', syntheticDiag, {
    // Respect the configured fix strategy (additive only for ambiguity-llm),
    // matching the interactive path — not a hardcoded additive for all codes.
    additive: isAdditiveFix,
    semanticCheck: fixCfg.fixSemanticCheck,
    selfCritique: fixCfg.fixSelfCritique,
    referenceGrounding: fixCfg.fixReferenceGrounding,
    // Pass the guard bounds through so the MCP fix path applies the same
    // safety guards as the interactive path (they were parsed into fixCfg
    // but silently dropped here).
    guardUpperBoundMultiplier: fixCfg.fixGuardUpperBoundMultiplier,
    guardLowerBoundMultiplier: fixCfg.fixGuardLowerBoundMultiplier,
    guardMaxAnchorChars: fixCfg.fixGuardMaxAnchorChars,
    line: validLine,
  });

  const body = JSON.stringify(result, null, 2);
  // Charge the input per call so the budget reflects actual spend.
  chargeTokens(text.length, body, fixWaves);
  return { content: [{ type: 'text', text: body }] };
}

async function handleAcceptFinding(args: Record<string, unknown>, _ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  // filePath is used as a store key, but validate it against the workspace
  // root for consistency with the other tools — an agent shouldn't be able to
  // write accepted-findings entries under arbitrary keys (e.g. /etc/passwd).
  // Throw on escape (like requireSafeFilePath) rather than falling back to the
  // raw attacker-controlled string.
  const rawFilePath = requireString(args, 'filePath');
  // filePath is a store key here, not a path read from disk — resolve
  // lexically against the root (rejecting escapes) but don't require the file
  // to exist, since an agent may accept a finding for a proposed/unsaved path.
  const filePath = safeResolveFilePath(rawFilePath, false);
  if (filePath === undefined) {
    throw new Error(`filePath "${rawFilePath}" is outside the MCP workspace root and was rejected.`);
  }
  const diagnosticCode = requireString(args, 'diagnosticCode');
  const rawRelevantText = requireString(args, 'relevantText');

  let relevantText: string;
  try {
    relevantText = validateRelevantText(rawRelevantText);
  } catch (e) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        }, null, 2),
      }],
      isError: true,
    };
  }

  const reason = optionalString(args, 'reason');

  acceptFinding(resolveAcceptedFindingsPath(), filePath, {
    code: diagnosticCode,
    textPattern: relevantText,
    acceptedAt: new Date().toISOString(),
    reason,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'accepted',
        filePath,
        code: diagnosticCode,
      }, null, 2),
    }],
  };
}

async function handleHealth(_args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  try {
    await ctx.getEngine();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'ok',
          provider: ctx.resolvedConfig?.provider ?? 'unknown',
          model: ctx.resolvedConfig?.model ?? 'unknown',
          structuredOutput: ctx.resolvedConfig?.structuredOutput ?? false,
          requestTimeoutMs: ctx.resolvedConfig?.requestTimeoutMs,
          configSource: ctx.resolvedConfig?.configSource ?? 'unknown',
          costBudget: {
            maxTokensPerSession: _maxTokensPerSession,
            usedTokens: _sessionTokens,
            exhausted: budgetExhausted(),
            // The token count is an estimate (response chars / 4), not the
            // provider's reported usage — the provider interface does not
            // expose per-call token usage.
            estimate: 'responseChars/4',
          },
        }, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          error: sanitizeErrorMessage(error),
        }, null, 2),
      }],
    };
  }
}

async function handleScore(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const engine = await ctx.getEngine();
  const text = requireText(args, maxTextLengthForContext(providerContextLength(engine)));
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }
  // Reserve the estimated input cost up front (score runs scoreSamples × waves).
  const rawSamples = ctx.resolvedConfig?.engineConfig?.scoreSamples ?? 1;
  const samples = Math.max(1, Math.min(5, Math.floor(rawSamples)));
  const waves = estimateWaveCount(ctx.resolvedConfig?.engineConfig, undefined);
  if (!reserveTokens(text.length, waves * samples)) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }
  const result = await engine.score({
    text,
    filePath: requireSafeFilePath(args),
    // Respect accepted findings so score doesn't penalize issues the user
    // already accepted (handleAnalyze/handleVerifyFix pass this; score must too).
    acceptedFindingsPath: resolveAcceptedFindingsPath(),
  });
  const body = JSON.stringify(result, null, 2);
  // score runs scoreSamples analyses × the configured wave count each. Clamp
  // samples to the engine's 1-5 range so the charge matches actual work.
  chargeTokens(text.length, body, waves * samples);
  return { content: [{ type: 'text', text: body }] };
}

async function handleVerifyFix(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const engine = await ctx.getEngine();
  const text = requireText(args, maxTextLengthForContext(providerContextLength(engine)));
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }
  const diagnosticCode = requireString(args, 'diagnosticCode');
  // Validate relevantText with the same length floor as accept_finding — a
  // short pattern would otherwise always match nothing and report fixed:true
  // even when the issue is still present.
  const relevantText = validateRelevantText(requireString(args, 'relevantText'));

  // Re-analyze with the same wave set the user analyzed with (if provided),
  // so verification is consistent with the analysis it's verifying.
  const wavesArg = args['analysisWaves'] ?? args['enabledWaves'];
  const validWaves = new Set<string>(ALL_WAVES);
  const analysisWaves: string[] | undefined = Array.isArray(wavesArg)
    ? (wavesArg as string[]).filter(w => validWaves.has(w))
    : undefined;
  const configOverride = analysisWaves && analysisWaves.length > 0
    ? { analysisWaves: analysisWaves as WaveName[], analysisMode: 'multiWave' as const }
    : undefined;

  // Reserve the estimated input cost up front (verify_fix re-runs analysis).
  const waves = estimateWaveCount(ctx.resolvedConfig?.engineConfig, analysisWaves);
  if (!reserveTokens(text.length, waves)) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }

  // 1. Re-analyze (the only LLM cost)
  const results = await engine.analyze({
    text,
    filePath: requireSafeFilePath(args),
    acceptedFindingsPath: resolveAcceptedFindingsPath(),
  }, undefined, undefined, configOverride);

  // 2. Check if target issue is gone
  const targetAccepted = [{ code: diagnosticCode, textPattern: relevantText, acceptedAt: '' }];
  const matchingIssue = results.find((r) => isFindingAccepted(r, targetAccepted)) ?? null;
  const newIssues = results.filter((r) => !isFindingAccepted(r, targetAccepted));

  // 3. Return result WITHOUT the expensive score call
  const body = JSON.stringify({
    fixed: matchingIssue === null,
    matchingIssue,
    newIssues,
    issueCount: results.length,
  }, null, 2);
  // verify_fix re-runs the analysis (wave count from config override).
  chargeTokens(text.length, body, waves);
  return { content: [{ type: 'text', text: body }] };
}

async function handleListAcceptedFindings(args: Record<string, unknown>, _ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  // Validate the filePath filter against the workspace root for consistency.
  // filePath is a store-key filter here, not a path read from disk — resolve
  // lexically against the root (rejecting escapes) but don't require the file
  // to exist.
  const rawFilePath = optionalString(args, 'filePath');
  const filePath = rawFilePath ? safeResolveFilePath(rawFilePath, false) : undefined;
  if (rawFilePath && filePath === undefined) {
    throw new Error(`filePath "${rawFilePath}" is outside the MCP workspace root and was rejected.`);
  }
  const store = loadAcceptedFindings(resolveAcceptedFindingsPath());

  if (filePath) {
    const entries = store.entries[filePath] ?? [];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ filePath, entries }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(store, null, 2),
    }],
  };
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  analyze: handleAnalyze,
  fix: handleFix,
  accept_finding: handleAcceptFinding,
  health: handleHealth,
  score: handleScore,
  verify_fix: handleVerifyFix,
  list_accepted_findings: handleListAcceptedFindings,
};

export interface McpToolRegistryOptions {
  buildEngine?: () => Promise<{ engine: Engine; config: McpEngineConfig }> | { engine: Engine; config: McpEngineConfig };
}

export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  /** MCP protocol flag: indicates the tool call resulted in an error. */
  isError?: boolean;
}

/**
 * Resolve context lengths for `model`, `deepModel`, and `fixModel` so the
 * provider can scale its document budget to the actual model. Returns the
 * *smallest* value — the analyzer uses the most conservative so any wave
 * fits. Falls back to `undefined` when unknown (analyzer logs a warning).
 */
async function resolveContextLengths(
  model: string | undefined,
  deepModel: string | undefined,
  fixModel: string | undefined,
): Promise<{ standard?: number; deep?: number; fix?: number }> {
  const [stdR, deepR, fixR] = await Promise.all([
    model ? resolveContextLength(model).catch(() => undefined) : Promise.resolve(undefined),
    deepModel ? resolveContextLength(deepModel).catch(() => undefined) : Promise.resolve(undefined),
    fixModel ? resolveContextLength(fixModel).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const out: { standard?: number; deep?: number; fix?: number } = {};
  if (stdR) out.standard = stdR.contextLength;
  if (deepR) out.deep = deepR.contextLength;
  if (fixR) out.fix = fixR.contextLength;
  return out;
}

/**
 * Pick the smallest context length across `model` / `deepModel` /
 * `fixModel` so the analyzer's document budget fits the most constrained
 * model in the configured tier set. Returns `undefined` when every tier
 * is unknown — the analyzer's 200K-char fallback then kicks in.
 */
async function pickSmallestContextLength(
  model: string | undefined,
  deepModel: string | undefined,
  fixModel: string | undefined,
): Promise<number | undefined> {
  const all = await resolveContextLengths(model, deepModel, fixModel);
  const values = [all.standard, all.deep, all.fix].filter((v): v is number => typeof v === 'number');
  return values.length > 0 ? Math.min(...values) : undefined;
}

export async function createDefaultEngine(): Promise<{ engine: Engine; config: McpEngineConfig }> {
  // Priority 1: .skills-review.json in workspace root
  // MCP_SERVER_WORKSPACE env var takes precedence for config discovery,
  // falling back to process.cwd() for CLI usage.
  const workspaceRoot = process.env.MCP_SERVER_WORKSPACE?.trim() || process.cwd();
  const configPath = path.join(workspaceRoot, '.skills-review.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg === 'object') {
      // Apply the session cost budget from config (env var takes precedence).
      _maxTokensPerSession = resolveMaxTokensPerSession(cfg.maxTokensPerSession);
      const engineConfig = buildEngineConfig(cfg as Record<string, unknown>);
      const provider = cfg.provider || 'openrouter';
      const model = cfg.model || 'gpt-4o-mini';
      const deepModel = cfg.deepModel || undefined;
      const fixModel = cfg.fixModel || undefined;
      const structuredOutput = structuredOutputValue(cfg.structuredOutput) ?? structuredOutputValue(cfg.externalStructuredOutput);
      const requestTimeoutMs = optionalPositiveNumber(cfg.requestTimeoutMs) ?? optionalPositiveNumber(cfg.externalRequestTimeoutMs);

      if (provider === 'openrouter') {
        const apiKey = process.env.OPENROUTER_API_KEY?.trim();
        if (apiKey) {
          // Accept-list validation (shared with the extension) — never send a
          // GitHub/Copilot token to openrouter.ai.
          const keyError = validateKeyForProvider('openrouter', apiKey);
          if (keyError) throw new Error(`MCP config: ${keyError}`);
          // Resolve context lengths from the OpenRouter catalog (1h cached;
          // ~50ms cold, ~5ms warm). The MCP registry awaits this before
          // serving the first request, so the analyzer's 200K-char fallback
          // is never hit on the cold path.
          const contextLength = await pickSmallestContextLength(model, deepModel, fixModel);
          const contextSource = contextLength ? 'catalog-or-static' : 'fallback';
          const base = new OpenRouterProvider({ apiKey, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength });
          return {
            engine: new Engine(base, engineConfig),
            config: { provider: 'openrouter', model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextSource, configSource: `file:${configPath}`, engineConfig } as McpEngineConfig,
          };
        }
      }
      if (provider === 'copilot') {
        const apiKey = (process.env.GITHUB_TOKEN ?? process.env.COPILOT_TOKEN)?.trim();
        if (apiKey) {
          // Accept-list validation (shared with the extension) — never send an
          // OpenRouter key to api.githubcopilot.com.
          const keyError = validateKeyForProvider('copilot', apiKey);
          if (keyError) throw new Error(`MCP config: ${keyError}`);
          // Resolve context length from the live Copilot /models API so new
          // models are picked up automatically (no static table). Only fall
          // back to the OpenRouter catalog if the Copilot fetch fails — a
          // Copilot deployment shouldn't depend on openrouter.ai being up.
          const copilotCtx = await resolveCopilotContextLength(model, apiKey);
          let copilotContextLength = copilotCtx;
          let copilotContextSource = copilotCtx ? 'copilot-api' : 'fallback';
          if (!copilotCtx) {
            const fallback = await pickSmallestContextLength(model, deepModel, fixModel);
            if (fallback) {
              copilotContextLength = fallback;
              copilotContextSource = 'catalog-or-static';
            }
          }
          return {
            engine: new Engine(new CopilotProvider({ apiKey, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength: copilotContextLength, editorVersion: process.env.COPILOT_EDITOR_VERSION }), engineConfig),
            config: { provider: 'copilot', model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextSource: copilotContextSource, configSource: `file:${configPath}`, engineConfig } as McpEngineConfig,
          };
        }
      }
    }
  } catch {
    // File doesn't exist or is malformed — fall through to env vars
  }

  // Priority 2: env vars (existing logic)
  _maxTokensPerSession = resolveMaxTokensPerSession(undefined);
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const keyError = validateKeyForProvider('openrouter', openRouterKey);
    if (keyError) throw new Error(`MCP env config: ${keyError}`);
    const model = process.env.ANALYSIS_MODEL ?? 'openai/gpt-4o-mini';
    const deepModel = process.env.DEEP_MODEL ?? undefined;
    const fixModel = process.env.FIX_MODEL ?? undefined;
    const structuredOutput = structuredOutputValue(process.env.STRUCTURED_OUTPUT);
    const requestTimeoutMs = optionalPositiveNumber(process.env.REQUEST_TIMEOUT_MS);
    const engineConfig = buildEngineConfig({
      analysisMode: process.env.ANALYSIS_MODE,
      scoreSamples: process.env.SCORE_SAMPLES ? Number(process.env.SCORE_SAMPLES) : undefined,
    });
    const contextLength = await pickSmallestContextLength(model, deepModel, fixModel);
    const contextSource = contextLength ? 'catalog-or-static' : 'fallback';
    const base = new OpenRouterProvider({ apiKey: openRouterKey, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength });
    return {
      engine: new Engine(base, engineConfig),
      config: { provider: 'openrouter', model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextSource, configSource: `file:${configPath}`, engineConfig } as McpEngineConfig,
    };
  }

  // Copilot via env var (GITHUB_TOKEN / COPILOT_TOKEN).
  const copilotToken = (process.env.GITHUB_TOKEN ?? process.env.COPILOT_TOKEN)?.trim();
  if (copilotToken) {
    const keyError = validateKeyForProvider('copilot', copilotToken);
    if (keyError) throw new Error(`MCP env config: ${keyError}`);
    const model = process.env.ANALYSIS_MODEL ?? 'gpt-4o-mini';
    const deepModel = process.env.DEEP_MODEL ?? undefined;
    const fixModel = process.env.FIX_MODEL ?? undefined;
    const structuredOutput = structuredOutputValue(process.env.STRUCTURED_OUTPUT);
    const requestTimeoutMs = optionalPositiveNumber(process.env.REQUEST_TIMEOUT_MS);
    const engineConfig = buildEngineConfig({
      analysisMode: process.env.ANALYSIS_MODE,
      scoreSamples: process.env.SCORE_SAMPLES ? Number(process.env.SCORE_SAMPLES) : undefined,
    });
    // Resolve context length from the live Copilot /models API so new models
    // are picked up automatically (no static table). Only fall back to the
    // OpenRouter catalog if the Copilot fetch fails.
    const copilotCtx = await resolveCopilotContextLength(model, copilotToken);
    let contextLength = copilotCtx;
    let contextSource = copilotCtx ? 'copilot-api' : 'fallback';
    if (!copilotCtx) {
      const fallback = await pickSmallestContextLength(model, deepModel, fixModel);
      if (fallback) {
        contextLength = fallback;
        contextSource = 'catalog-or-static';
      }
    }
    return {
      engine: new Engine(new CopilotProvider({ apiKey: copilotToken, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength, editorVersion: process.env.COPILOT_EDITOR_VERSION }), engineConfig),
      config: { provider: 'copilot', model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextSource, configSource: 'env:GITHUB_TOKEN', engineConfig } as McpEngineConfig,
    };
  }

  throw new Error(
    'MCP provider configuration missing. Set OPENROUTER_API_KEY for OpenRouter, or GITHUB_TOKEN for the Copilot provider.',
  );
}

export function createMcpToolRegistry({
  buildEngine = createDefaultEngine,
}: McpToolRegistryOptions = {}): {
  listTools(): Array<{ name: string; description: string; inputSchema: unknown }>;
  callTool(name: string, args: Record<string, unknown>, ctx?: Partial<ToolHandlerContext>): Promise<McpToolCallResult>;
} {
  // Resolve engine + config once; handlers use the stored values.
  let resolvedEngine: Engine | undefined;
  let resolvedConfig: McpEngineConfig | undefined;
  let configWatcher: ReturnType<typeof fs.watch> | undefined;

  /** Watch the config file and invalidate the cached engine on change. */
  function startConfigWatcher(configPath: string): void {
    if (configWatcher) return; // already watching
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      configWatcher = fs.watch(configPath, { persistent: false }, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          // Debounce: editors may emit multiple events per save (write + rename)
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            resolvedEngine = undefined;
            resolvedConfig = undefined;
            configWatcher?.close();
            configWatcher = undefined;
            debounceTimer = undefined;
          }, 200);
        }
      });
    } catch {
      // fs.watch may not be available in all environments — fail silently.
    }
  }

  async function getEngine(): Promise<Engine> {
    if (!resolvedEngine) {
      const raw = buildEngine();
      const result = (raw instanceof Promise) ? await raw : raw;
      // Support both new { engine, config } shape and legacy direct-engine shape.
      if ('engine' in result && 'config' in result) {
        resolvedEngine = result.engine;
        resolvedConfig = result.config;
      } else {
        resolvedEngine = result as unknown as Engine;
        resolvedConfig = { provider: 'unknown', model: 'unknown', configSource: 'unknown' } as McpEngineConfig;
      }
      // Start watching the config file for changes (if resolved from file).
      if (resolvedConfig?.configSource?.startsWith('file:')) {
        const configFilePath = resolvedConfig.configSource.slice(5);
        if (configFilePath) startConfigWatcher(configFilePath);
      }
    }
    return resolvedEngine;
  }

  return {
    listTools() {
      return [
        {
          name: 'analyze',
          description:
            'Analyze a skill, instructions, or prompt document for quality issues. Runs 6 focused analysis waves: contradictions, ambiguities, persona conflicts, structural/cognitive issues, coverage gaps, and hygiene problems. Returns a JSON array of diagnostics, each with: code (e.g. "ambiguity-llm", "contradiction", "coverage-gap"), severity (error/warning/info), message, range, and optional suggestion. Use "score" to get an overall quality grade. Use "fix" to attempt surgical repair of fixable issues (only 5 codes are fixable: ambiguity-llm, contradiction, hygiene-redundant-instruction, hygiene-unordered-process, hygiene-over-specification). Optional "analysisWaves" parameter selects specific analysis categories (e.g. ["contradictions", "hygiene"]).',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text to analyze.' },
              filePath: { type: 'string', description: 'Optional file path for context.' },
              analysisWaves: {
                type: 'array',
                items: { type: 'string', enum: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'] },
                description: 'Optional: which analysis waves to run. If omitted, all 6 waves run in multi-wave mode.',
              },
            },
            required: ['text'],
          },
        },
        {
          name: 'fix',
          description:
            'Surgically fix ONE quality issue in a document. Returns the proposed fixed text and whether it was accepted or rejected (with reason). Only works on these 5 codes: ambiguity-llm, contradiction, hygiene-redundant-instruction, hygiene-unordered-process, hygiene-over-specification. All other codes (coverage-gap, persona-inconsistency, cognitive-*, etc.) are NOT fixable \u2014 the tool will return accepted:false. Use "analyze" first to find issues, then "fix" on each fixable one. Use "verify_fix" after to confirm the fix worked.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text to update.' },
              filePath: { type: 'string', description: 'Optional file path for grounding.' },
              diagnosticCode: { type: 'string', description: 'Issue code to fix.' },
              relevantText: { type: 'string', description: 'Verbatim text that triggered the issue.' },
            },
            required: ['text', 'diagnosticCode', 'relevantText'],
          },
        },
        {
          name: 'accept_finding',
          description:
            'Accept (suppress) a specific finding on a specific file so it will not appear in future analyses. Use this for known/expected issues that are intentional (e.g. self-referential prompt patterns). The finding is matched by code AND text pattern \u2014 accepting "ambiguity-llm" on "vague or underspecified" in file.md won\'t suppress a different ambiguity-llm finding in the same file.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Absolute path to the file.' },
              diagnosticCode: { type: 'string', description: 'Issue code to accept (e.g. ambiguity-llm, coverage-gap).' },
              relevantText: { type: 'string', description: 'The verbatim text that triggered the finding.' },
              reason: { type: 'string', description: 'Optional reason for accepting.' },
            },
            required: ['filePath', 'diagnosticCode', 'relevantText'],
          },
        },
        {
          name: 'health',
          description:
            'Check the MCP server status. Returns provider name, model ID, config source (file/env/default), and whether the provider is reachable. Use this first to verify setup before running analyses.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'score',
          description:
            'Compute the quality score (0-100) and letter grade (A+ through F) for a document. Returns score, grade, penalty breakdown (issues + length), pillar scores (Contradictions, Clarity, Completeness, Structure), skill type, and line count. Use this before/after fixes to measure improvement.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text.' },
              filePath: { type: 'string', description: 'Optional file path for context.' },
            },
            required: ['text'],
          },
        },
        {
          name: 'verify_fix',
          description:
            "Re-analyze a document and check if a specific issue has been resolved. Provide the original diagnostic code and text pattern. Returns: fixed (boolean), the matching issue if still present, any new issues introduced by the fix, and total issue count. Use this after 'fix' to confirm the fix worked without side effects. Call 'score' separately to get the updated quality grade.",
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Full document text (post-fix).' },
              filePath: { type: 'string', description: 'Optional file path.' },
              diagnosticCode: { type: 'string', description: 'The issue code to check.' },
              relevantText: { type: 'string', description: 'The text pattern that triggered the original issue.' },
            },
            required: ['text', 'diagnosticCode', 'relevantText'],
          },
        },
        {
          name: 'list_accepted_findings',
          description:
            'List all accepted (suppressed) findings, optionally filtered by file path. Returns the full store contents with code, textPattern, acceptedAt, and reason for each entry.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Optional filter by file path.' },
            },
            required: [],
          },
        },
      ];
    },

    async callTool(name, args, ctx) {
      try {
        const handler = TOOL_HANDLERS[name];
        if (!handler) throw new Error(`Unknown tool: ${name}`);
        return await handler(args, {
          getEngine,
          get resolvedConfig() { return resolvedConfig; },
          sendProgress: ctx?.sendProgress,
        });
      } catch (error) {
        // Catch ALL errors (validation, unknown tools, LLM failures, I/O)
        // and return a structured error instead of crashing the MCP server.
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'error',
              error: sanitizeErrorMessage(error),
            }, null, 2),
          }],
          isError: true,
        };
      }
    },
  };
}

export interface McpServerOptions extends McpToolRegistryOptions {
  transport?: Transport;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const registry = createMcpToolRegistry(options);

  const server = new Server(
    { name: 'skills-review-and-polish', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // If the client requested a progress token (via `_meta.progressToken`),
    // build a `sendProgress` callback so long-running tools (e.g. analyze)
    // can emit `notifications/progress`. Clients that set
    // `resetTimeoutOnProgress` keep the request alive as long as progress
    // keeps flowing — this lets analyses that exceed the client's default
    // 60s timeout complete without being aborted.
    const progressToken = (request.params as { _meta?: { progressToken?: string | number } })._meta?.progressToken;
    const sendProgress = progressToken !== undefined
      ? async (progress: number, total?: number, message?: string) => {
          await server.notification({
            method: 'notifications/progress',
            params: { progressToken, progress, total, message },
          });
        }
      : undefined;

    const result = await registry.callTool(
      String(request.params.name),
      (request.params.arguments ?? {}) as Record<string, unknown>,
      { sendProgress },
    );
    return result as CallToolResult;
  });

  return {
    server,
    async start() {
      const transport = options.transport ?? new StdioServerTransport();
      await server.connect(transport);
    },
    async stop() {
      await server.close();
    },
  };
}

export async function main(): Promise<void> {
  // Wire core logger to stderr — MCP uses stdio for protocol communication.
  setTransport((line) => process.stderr.write(line + '\n'));

  process.stdin.resume();
  const { start } = createMcpServer();
  await start();

  // Keep the stdio server alive until the client closes stdin or the process
  // receives a termination signal. Without this explicit ref, Node can exit
  // immediately after connect() resolves in some child-process environments.
  const keepAlive = setInterval(() => undefined, 60_000);
  await new Promise<void>((resolve) => {
    const done = () => {
      clearInterval(keepAlive);
      resolve();
    };
    // Always exit on stdin end/close — if the client closes stdin (even with
    // no data), the session is over and the process must not hang.
    process.stdin.once('end', done);
    process.stdin.once('close', done);
    process.once('SIGTERM', done);
    process.once('SIGINT', done);
  });
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('MCP server failed:', error);
    process.exitCode = 1;
  });
}
