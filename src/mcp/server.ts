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
import { acceptFinding, loadAcceptedFindings, isFindingAccepted } from '../core/acceptedFindings';
import { OpenRouterProvider, CopilotProvider } from '../providers/externalProvider';
import { BatchAwareOpenRouterProvider } from '../providers/batchAwareProvider';
import { resolveContextLength } from '../modelCatalog';
import { batchModeWarning } from '../core/batchTransport';
import type { AnalysisJob } from '../core/analysisJob';
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
  /** When true, the OpenRouter provider batches wave requests via the Batch API. */
  batch?: boolean;
  /** The batch-aware provider instance (when batch mode is on) so handlers can flush it. */
  batchProvider?: BatchAwareOpenRouterProvider;
}

/**
 * In-memory registry of deferred analysis jobs (B1 batch design). Keyed by
 * jobId. Lives for the server process lifetime — sufficient for MCP, where the
 * client polls within the same session. Jobs are not persisted across restarts.
 */
const analysisJobs = new Map<string, AnalysisJob>();

/** Maximum text length accepted by tools. Prevents runaway LLM costs. */
const MAX_TEXT_LENGTH = 100_000; // ~25k tokens

// ---------------------------------------------------------------------------
// Cost budget guard
// ---------------------------------------------------------------------------
// The MCP server has no spending cap by default — error redaction exists, but
// there is no guard against a runaway loop of analyze/score/verify_fix calls
// burning through a provider quota. This budget tracks cumulative *output*
// tokens per server session and refuses new analysis requests once exceeded.
// It is a soft, configurable guard (not a hard wall): operators can raise or
// disable it via env var or `.skills-review.json`.
//
// Default: 50k output tokens per session (~$0.01-0.03 at current rates).
const DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION = 50_000;
/** Rough chars-per-token heuristic used when the provider reports no usage. */
const CHARS_PER_TOKEN = 4;

/** Cumulative output-token budget state for the current server session. */
let _sessionOutputTokens = 0;
/** Configured cap for the current session (0 disables the guard). */
let _maxOutputTokensPerSession = DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION;

/** Reset the session budget (for tests). */
export function _resetSessionBudget(): void {
  _sessionOutputTokens = 0;
  _maxOutputTokensPerSession = DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION;
}

/** Set the session budget cap directly (for tests). 0 disables the guard. */
export function _setSessionBudgetCap(cap: number): void {
  _maxOutputTokensPerSession = cap > 0 ? Math.floor(cap) : 0;
}

/** Read the budget cap from env var or config value. Returns 0 to disable. */
function resolveMaxOutputTokens(value: unknown): number {
  const env = process.env.MCP_MAX_OUTPUT_TOKENS;
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
  return DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION;
}

/** Estimate output tokens for a response body (chars / CHARS_PER_TOKEN). */
function estimateOutputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Charge the session budget for an LLM response. Returns true if the charge
 * was accepted (within budget). When the charge would exceed the cap, the
 * budget is still incremented (so `usedOutputTokens` stays honest) and false
 * is returned — the caller may still return the result, but subsequent
 * analysis requests will be refused until the next session.
 */
function chargeOutputTokens(text: string): boolean {
  if (_maxOutputTokensPerSession <= 0) return true; // guard disabled
  const cost = estimateOutputTokens(text);
  _sessionOutputTokens += cost;
  return _sessionOutputTokens <= _maxOutputTokensPerSession;
}

/** True when the session budget is exhausted (guard enabled and over cap). */
function budgetExhausted(): boolean {
  return _maxOutputTokensPerSession > 0 && _sessionOutputTokens >= _maxOutputTokensPerSession;
}

/** Error message returned when the budget is exhausted. */
function budgetExhaustedError(): Error {
  return new Error(
    `MCP session output-token budget exhausted (${_sessionOutputTokens} / ${_maxOutputTokensPerSession} tokens). ` +
    `Refusing new analysis requests until the next session. Raise the cap via ` +
    `MCP_MAX_OUTPUT_TOKENS or the "maxOutputTokensPerSession" config, or set it to 0 to disable.`,
  );
}

/** Maximum length for relevantText in accept_finding. */
const MAX_RELEVANT_TEXT_LENGTH = 200;

/** Minimum meaningful length for relevantText in accept_finding. */
const MIN_RELEVANT_TEXT_LENGTH = 3;

/** Overly generic single-word patterns that should not be used as acceptance anchors. */
const GENERIC_PATTERNS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'be', 'to', 'of', 'in', 'for', 'on', 'with', 'as', 'at', 'by',
]);

/**
 * Sanitize an error message to remove secrets (Bearer tokens, API keys, etc.)
 * before returning it in MCP responses.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  let sanitized = msg;
  // Strip Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  // Strip API key / token / secret / password patterns in assignment or header contexts
  sanitized = sanitized.replace(/(api[_-]?key|token|secret|password|authorization|credential)[\s:=]+\S+/gi, '$1=[REDACTED]');
  // Strip x-api-key and other common header values
  sanitized = sanitized.replace(/(x-api-key|x-goog-api-key|x-amz-security-token)[\s:=]+\S+/gi, '$1=[REDACTED]');
  // Strip URLs that may contain embedded credentials (user:pass@host)
  sanitized = sanitized.replace(/https?:\/\/[^\s]*@[^\s]+/gi, 'https://[REDACTED]');
  // Strip any remaining long hex strings (32+ chars) that could be API keys
  sanitized = sanitized.replace(/\b[0-9a-f]{32,}\b/gi, '[REDACTED]');
  return sanitized;
}

/** Resolve the accepted-findings path from MCP_SERVER_WORKSPACE env var (or cwd fallback). */
function resolveAcceptedFindingsPath(): string {
  const workspaceRoot = process.env['MCP_SERVER_WORKSPACE']?.trim() || process.cwd();
  return path.join(workspaceRoot, '.accepted-findings.json');
}

function requireString(args: Record<string, unknown>, key: string): string {
  const val = typeof args[key] === 'string' ? args[key] : '';
  if (!val.trim()) throw new Error(`Missing required argument: ${key}`);
  return val;
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
  if (value === 'schema' || value === 'true' || value === 'false'
      || value === '1' || value === '0' || value === 'on' || value === 'off') {
    if (value === 'schema') return 'schema';
    // String truthy/falsy values fall through to boolean parsing.
  }
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

function requireText(args: Record<string, unknown>): string {
  const text = requireString(args, 'text');
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long: ${text.length} chars (max ${MAX_TEXT_LENGTH}). Split the document or analyze a subsection.`);
  }
  return text;
}

/**
 * Validate and sanitize relevantText for the accept_finding tool.
 * Returns the trimmed/sanitized text, or throws with a descriptive error.
 */
function validateRelevantText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < MIN_RELEVANT_TEXT_LENGTH) {
    throw new Error(`relevantText too short (${trimmed.length} chars, minimum ${MIN_RELEVANT_TEXT_LENGTH}). Must be a meaningful text fragment.`);
  }
  if (trimmed.length > MAX_RELEVANT_TEXT_LENGTH) {
    throw new Error(`relevantText too long (${trimmed.length} chars, maximum ${MAX_RELEVANT_TEXT_LENGTH}). Use a shorter representative fragment.`);
  }
  // Reject overly generic single-word patterns
  if (GENERIC_PATTERNS.has(trimmed.toLowerCase())) {
    throw new Error(`relevantText "${trimmed}" is overly generic and would suppress unrelated findings. Use a longer, more specific text fragment.`);
  }
  // Escape control characters: replace chars below 0x20 (except \t \n \r) with empty
  // eslint-disable-next-line no-control-regex
  const sanitized = trimmed.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return sanitized;
}

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
  const text = requireText(args);

  // Cost guard: refuse new analysis once the session budget is exhausted.
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }

  // Rate limit: enforce minimum interval between analyze calls
  const now = Date.now();
  if (now - _lastAnalyzeTimestamp < ANALYZE_COOLDOWN_MS) {
    const waitMs = ANALYZE_COOLDOWN_MS - (now - _lastAnalyzeTimestamp);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  _lastAnalyzeTimestamp = Date.now();

  const engine = await ctx.getEngine();

  // Parse optional analysisWaves parameter (also accepts legacy enabledWaves)
  const wavesArg = args['analysisWaves'] ?? args['enabledWaves'];
  const validWaves = new Set<string>(['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene']);
  const analysisWaves: string[] | undefined = Array.isArray(wavesArg)
    ? (wavesArg as string[]).filter(w => validWaves.has(w))
    : undefined;

  // Use configOverride with analysisWaves (E21 API) — cleaner than 3rd parameter.
  // analysisMode: 'multiWave' ensures wave selection runs (not single-pass).
  const configOverride = analysisWaves && analysisWaves.length > 0
    ? { analysisWaves: analysisWaves as any, analysisMode: 'multiWave' as const }
    : undefined;

  // Explicit `batch` arg overrides the server's batch config. When batch mode
  // is on, analysis runs as a deferred job (B1 design) so the tool returns
  // immediately instead of blocking ~5 min on the OpenRouter Batch API.
  const batchArg = optionalBoolean(args['batch']);
  const batch = batchArg ?? ctx.resolvedConfig?.batch ?? false;

  if (!batch) {
    // Synchronous single-request path — instant, blocks only on normal latency.
    // If the client requested a progress token, emit periodic progress so the
    // request stays alive past the client's default timeout (long analyses can
    // take minutes). The progress interval is a heartbeat, not a real % — the
    // analyzer doesn't expose per-wave progress, so we send a monotonic tick.
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
        filePath: optionalString(args, 'filePath'),
        acceptedFindingsPath: resolveAcceptedFindingsPath(),
      }, undefined, undefined, configOverride);
      const body = JSON.stringify(results, null, 2);
      // Charge the budget. If this call pushes us over the cap, we still return
      // its result (the work is done) but mark the budget exhausted so the next
      // analysis request is refused.
      chargeOutputTokens(body);
      return { content: [{ type: 'text', text: body }] };
    } finally {
      if (progressTimer) clearInterval(progressTimer);
    }
  }

  // Batch (slow) mode: submit as a deferred job and return a handle immediately.
  const job = engine.analyzeDeferred(
    {
      text,
      filePath: optionalString(args, 'filePath'),
      acceptedFindingsPath: resolveAcceptedFindingsPath(),
    },
    { batch: true },
  );
  // Flush the batch provider so buffered waves are submitted as one batch job.
  if (ctx.resolvedConfig?.batchProvider) {
    void ctx.resolvedConfig.batchProvider.flush();
  }
  analysisJobs.set(job.jobId, job);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'processing',
        jobId: job.jobId,
        estimatedWaitSeconds: Math.round((job.estimatedWaitMs ?? 300_000) / 1000),
        warning: batchModeWarning(ctx.resolvedConfig?.model ?? '', Math.round((job.estimatedWaitMs ?? 300_000) / 1000)),
        nextStep: `Poll get_analysis_result with jobId "${job.jobId}". Do NOT re-call analyze — that submits a duplicate batch.`,
      }, null, 2),
    }],
  };
}

async function handleGetAnalysisResult(args: Record<string, unknown>, _ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const jobId = requireString(args, 'jobId');
  const job = analysisJobs.get(jobId);
  if (!job) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `Unknown jobId: ${jobId}` }, null, 2) }],
      isError: true,
    };
  }
  if (job.status === 'processing') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'processing',
          jobId,
          estimatedWaitSeconds: Math.round((job.estimatedWaitMs ?? 300_000) / 1000),
          warning: batchModeWarning(_ctx.resolvedConfig?.model ?? '', Math.round((job.estimatedWaitMs ?? 300_000) / 1000)),
          nextStep: `Still running. Poll get_analysis_result with jobId "${jobId}" again. Do NOT re-call analyze.`,
        }, null, 2),
      }],
    };
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    let message = job.status === 'cancelled' ? 'Analysis job was cancelled.' : 'Analysis job failed.';
    try {
      await job.getResults();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ status: job.status, error: message }, null, 2) }],
      isError: true,
    };
  }
  // completed
  // completed
  const results = await job.getResults();
  analysisJobs.delete(jobId);
  const body = JSON.stringify(results, null, 2);
  // Charge the batch results against the session budget too — otherwise the
  // batch path would bypass the cost guard entirely.
  chargeOutputTokens(body);
  return { content: [{ type: 'text', text: body }] };
}

async function handleFix(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const text = requireText(args);
  // Cost guard: fix invokes the LLM (and can loop), so it is a paid operation
  // that must respect the session budget too.
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }
  const diagnosticCode = requireString(args, 'diagnosticCode');
  const relevantText = requireString(args, 'relevantText');
  const line = typeof args['line'] === 'number' ? args['line'] : (typeof args['line'] === 'string' ? parseInt(args['line'], 10) : undefined);

  // Duplicate-anchor guard: if relevantText appears more than once and no
  // explicit line was provided, refuse to fix to avoid replacing the wrong instance.
  if (line === undefined) {
    const occurrences = text.split(relevantText).length - 1;
    if (occurrences > 1) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            error: `relevantText appears ${occurrences} times in the document. Provide a "line" argument to disambiguate which occurrence to fix.`,
          }, null, 2),
        }],
      };
    }
  }

  const resolvedLine = line ?? 0;
  const engine = await ctx.getEngine();
  const syntheticDiag: AnalysisResult = {
    code: diagnosticCode,
    message: relevantText,
    severity: 'warning',
    range: { start: { line: resolvedLine, character: 0 }, end: { line: resolvedLine, character: 0 } },
    analyzer: 'mcp',
    relevantText,
  };

  const fixer = new SurgicalFixer(engine.provider as LlmProvider);
  const result = await fixer.fixIssue(text, optionalString(args, 'filePath') ?? '', syntheticDiag, {
    additive: true,
    semanticCheck: false,
    selfCritique: false,
    referenceGrounding: true,
  });

  const body = JSON.stringify(result, null, 2);
  chargeOutputTokens(body);
  return { content: [{ type: 'text', text: body }] };
}

async function handleAcceptFinding(args: Record<string, unknown>, _ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const filePath = requireString(args, 'filePath');
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
            maxOutputTokensPerSession: _maxOutputTokensPerSession,
            usedOutputTokens: _sessionOutputTokens,
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
  const text = requireText(args);
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }
  const engine = await ctx.getEngine();
  const result = await engine.score({
    text,
    filePath: optionalString(args, 'filePath'),
  });
  const body = JSON.stringify(result, null, 2);
  chargeOutputTokens(body);
  return { content: [{ type: 'text', text: body }] };
}

async function handleVerifyFix(args: Record<string, unknown>, ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const text = requireText(args);
  if (budgetExhausted()) {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: budgetExhaustedError().message }, null, 2) }], isError: true };
  }
  const diagnosticCode = requireString(args, 'diagnosticCode');
  const relevantText = requireString(args, 'relevantText');

  const engine = await ctx.getEngine();

  // 1. Re-analyze (6 waves — the only LLM cost)
  const results = await engine.analyze({
    text,
    filePath: optionalString(args, 'filePath'),
    acceptedFindingsPath: resolveAcceptedFindingsPath(),
  });

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
  chargeOutputTokens(body);
  return { content: [{ type: 'text', text: body }] };
}

async function handleListAcceptedFindings(args: Record<string, unknown>, _ctx: ToolHandlerContext): Promise<McpToolCallResult> {
  const filePath = optionalString(args, 'filePath');
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
  get_analysis_result: handleGetAnalysisResult,
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

/**
 * Wrap an OpenRouter provider in a batch-aware provider when batch mode is
 * enabled. Batch mode submits the analyzer's wave requests as a single
 * OpenRouter Batch API job instead of sequential chat completions. When the
 * model is not batch-capable, the wrapper falls back to single requests
 * transparently, so callers always get correct results.
 */
function maybeBatchProvider(
  base: OpenRouterProvider,
  model: string,
  batch: boolean,
): { provider: LlmProvider; batching: boolean; batchProvider?: BatchAwareOpenRouterProvider } {
  if (!batch) return { provider: base, batching: false };
  const wrapped = new BatchAwareOpenRouterProvider({ provider: base, modelId: model, flushSize: 6 });
  return { provider: wrapped, batching: wrapped.batchingEnabled, batchProvider: wrapped };
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
      _maxOutputTokensPerSession = resolveMaxOutputTokens(cfg.maxOutputTokensPerSession);
      const engineConfig = buildEngineConfig(cfg as Record<string, unknown>);
      const provider = cfg.provider || 'openrouter';
      const model = cfg.model || 'gpt-4o-mini';
      const deepModel = cfg.deepModel || undefined;
      const fixModel = cfg.fixModel || undefined;
      const structuredOutput = structuredOutputValue(cfg.structuredOutput) ?? structuredOutputValue(cfg.externalStructuredOutput);
      const requestTimeoutMs = optionalPositiveNumber(cfg.requestTimeoutMs) ?? optionalPositiveNumber(cfg.externalRequestTimeoutMs);
      // Resolve context lengths from the OpenRouter catalog (1h cached;
      // ~50ms cold, ~5ms warm). The MCP registry awaits this before
      // serving the first request, so the analyzer's 200K-char fallback
      // is never hit on the cold path.
      const contextLength = await pickSmallestContextLength(model, deepModel, fixModel);
      const contextSource = contextLength ? 'catalog-or-static' : 'fallback';

      if (provider === 'openrouter') {
        const apiKey = process.env.OPENROUTER_API_KEY?.trim();
        if (apiKey) {
          const batch = cfg.batch === true || process.env.MCP_BATCH_API === '1';
          const base = new OpenRouterProvider({ apiKey, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength });
          const { provider: wrapped, batching } = maybeBatchProvider(base, model, batch);
          return {
            engine: new Engine(wrapped, engineConfig),
            config: { provider: 'openrouter', model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextSource, configSource: `file:${configPath}`, engineConfig, batch: batch && batching } as McpEngineConfig,
          };
        }
      }
      if (provider === 'copilot') {
        const apiKey = (process.env.GITHUB_TOKEN ?? process.env.COPILOT_TOKEN)?.trim();
        if (apiKey) {
          return {
            engine: new Engine(new CopilotProvider({ apiKey, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength }), engineConfig),
            config: { provider: 'copilot', model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextSource, configSource: `file:${configPath}`, engineConfig } as McpEngineConfig,
          };
        }
      }
    }
  } catch {
    // File doesn't exist or is malformed — fall through to env vars
  }

  // Priority 2: env vars (existing logic)
  _maxOutputTokensPerSession = resolveMaxOutputTokens(undefined);
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
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
    const batch = process.env.MCP_BATCH_API === '1';
    const base = new OpenRouterProvider({ apiKey: openRouterKey, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength });
    const { provider, batching, batchProvider } = maybeBatchProvider(base, model, batch);
    return {
      engine: new Engine(provider, engineConfig),
      config: { provider: 'openrouter', model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextSource, configSource: `file:${configPath}`, engineConfig, batch: batch && batching, batchProvider } as McpEngineConfig,
    };
  }

  // Copilot via env var (GITHUB_TOKEN / COPILOT_TOKEN).
  const copilotToken = (process.env.GITHUB_TOKEN ?? process.env.COPILOT_TOKEN)?.trim();
  if (copilotToken) {
    const model = process.env.ANALYSIS_MODEL ?? 'gpt-4o-mini';
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
    return {
      engine: new Engine(new CopilotProvider({ apiKey: copilotToken, model, deepModel, fixModel, structuredOutput, requestTimeoutMs, contextLength }), engineConfig),
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
              batch: {
                type: 'boolean',
                description: 'Optional: force batch (slow) mode. When true, analyze returns a jobId immediately and you must poll get_analysis_result (~5 min). Defaults to the server batch config.',
              },
            },
            required: ['text'],
          },
        },
        {
          name: 'get_analysis_result',
          description:
            'Poll the result of a deferred (batch/slow-mode) analysis job started by `analyze`. Returns the diagnostics once the OpenRouter Batch API job completes (~5 min). While the job is still processing, returns status "processing" with a warning — do NOT re-call analyze (that submits a duplicate batch). Use this only when `analyze` returned a jobId (batch mode); for synchronous single-request analysis, `analyze` already returns the results directly.',
          inputSchema: {
            type: 'object',
            properties: {
              jobId: { type: 'string', description: 'Job id returned by analyze in batch mode.' },
            },
            required: ['jobId'],
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
  let sawStdinData = false;
  process.stdin.on('data', () => {
    sawStdinData = true;
  });
  await new Promise<void>((resolve) => {
    const done = (force = false) => {
      if (!force && !sawStdinData) return;
      clearInterval(keepAlive);
      resolve();
    };
    process.stdin.once('end', () => done());
    process.stdin.once('close', () => done());
    process.once('SIGTERM', () => done(true));
    process.once('SIGINT', () => done(true));
  });
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('MCP server failed:', error);
    process.exitCode = 1;
  });
}
