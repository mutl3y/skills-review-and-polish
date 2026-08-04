/**
 * Structured logger — extension-agnostic.
 *
 * Design constraints:
 *  - No `vscode` imports — this module lives in `src/core/` and is used by
 *    the CLI, MCP server, tests, and (via a transport) the extension.
 *  - Three log levels: info (always), debug (opt-in), trace (opt-in).
 *  - Pluggable transport: callers inject `(line: string) => void`.
 *  - Build-time stripping: when `process.env.SKILL_REVIEW_LOG_LEVEL` is not
 *    set, trace/debug calls compile to empty function bodies (tree-shaking
 *    friendly).
 *
 * @module logger
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported log levels, ordered from most to least verbose. */
export type LogLevel = 'info' | 'debug' | 'trace';

/** A function that receives a fully-formatted log line. */
export type Transport = (line: string) => void;

// ─── Level ordering ──────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  info: 0,
  debug: 1,
  trace: 2,
};

// ─── Global state ────────────────────────────────────────────────────────────

/**
 * Current effective log level. Defaults to `'info'` (only info messages emit).
 * Set via `setLogLevel()` at startup.
 */
let currentLevel: LogLevel = resolveInitialLevel();

/**
 * Active transport function. Defaults to `console.error` so that:
 *  - MCP servers (stdio transport) don't pollute stdout.
 *  - CLI scripts get output on stderr.
 *  - Tests can override with a capturing function.
 *  - The extension wires this to its VS Code output channel.
 */
let currentTransport: Transport = (line: string) => {
  // Use console.error to avoid polluting stdout (important for MCP stdio).
   
  console.error(line);
};

// ─── Build-time flag ─────────────────────────────────────────────────────────

/**
 * Resolve the initial log level from the environment variable.
 * When the env var is absent, defaults to `'info'` so that trace/debug are
 * silenced by default (production behaviour).
 */
function resolveInitialLevel(): LogLevel {
  const env = (process.env.SKILL_REVIEW_LOG_LEVEL ?? '').toLowerCase();
  if (env === 'trace') return 'trace';
  if (env === 'debug') return 'debug';
  return 'info';
}

// ─── Configuration API ───────────────────────────────────────────────────────

/**
 * Set the global log level. Messages below this level are silently dropped.
 *
 * The extension calls this from `activate()` based on the user's config;
 * the CLI calls it from its entry point.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Get the current log level (useful for tests). */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Set the global transport function.
 *
 * The extension wires this to its `vscode.LogOutputChannel` + disk file;
 * the MCP server wires it to `process.stderr.write`;
 * tests wire it to a capturing array.
 */
export function setTransport(transport: Transport): void {
  currentTransport = transport;
}

/** Get the current transport (useful for tests). */
export function getTransport(): Transport {
  return currentTransport;
}

// ─── Logger class ────────────────────────────────────────────────────────────

/**
 * A module-scoped logger.
 *
 * Usage:
 * ```ts
 * import { createLogger } from './logger';
 * const log = createLogger('analyzer');
 * log.debug('wave started', { tier: 'deep' });
 * ```
 */
export class Logger {
  constructor(private readonly module: string) {}

  /** Always-on: errors, warnings, final results. */
  info(message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[currentLevel] < LEVEL_ORDER.info) return;
    currentTransport(formatLine('INFO', this.module, message, data));
  }

  /** Opt-in: decision points, model selection, timing. */
  debug(message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[currentLevel] < LEVEL_ORDER.debug) return;
    currentTransport(formatLine('DEBUG', this.module, message, data));
  }

  /** Opt-in: prompt previews, response previews, JSON parse details. */
  trace(message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[currentLevel] < LEVEL_ORDER.trace) return;
    currentTransport(formatLine('TRACE', this.module, message, data));
  }

  /**
   * Create a child logger with a sub-module suffix.
   * E.g. `createLogger('analyzer').child('callLLM')` produces `[analyzer:callLLM]`.
   */
  child(sub: string): Logger {
    return new Logger(`${this.module}:${sub}`);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a logger for a given module.
 *
 * Module names should be short identifiers: `analyzer`, `fixer`, `provider`,
 * `mcp`, `extension`, etc. They appear in the formatted output as
 * `[moduleName]`.
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatLine(
  level: string,
  module: string,
  message: string,
  data?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.padEnd(5)}] [${module}] ${message}`;
  if (!data) return prefix;
  try {
    return `${prefix} ${redact(JSON.stringify(data))}`;
  } catch {
    return `${prefix} [data serialization failed]`;
  }
}

/**
 * Redact secrets from a serialized log line before it reaches the transport.
 * The logger writes raw `data` objects (including LLM response previews and
 * error strings) to the output channel and, in debug mode, a plaintext /tmp
 * file — so any token echoed back by a provider or injected by a document
 * must not leak. Mirrors the MCP server's sanitizeErrorMessage.
 */
function redact(text: string): string {
  let out = text;
  // Strip Bearer tokens
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  // Strip API key / token / secret / password / authorization values
  out = out.replace(/(api[_-]?key|token|secret|password|authorization|credential)["']?\s*[:=]\s*["']?[^"',}\s]+/gi, '$1=[REDACTED]');
  // Strip x-api-key and other common header values
  out = out.replace(/(x-api-key|x-goog-api-key|x-amz-security-token)["']?\s*[:=]\s*["']?[^"',}\s]+/gi, '$1=[REDACTED]');
  // Strip URLs with embedded credentials (user:pass@host)
  out = out.replace(/https?:\/\/[^\s]*@[^\s]+/gi, 'https://[REDACTED]');
  // Strip long hex strings (32+ chars) that could be API keys
  out = out.replace(/\b[0-9a-f]{32,}\b/gi, '[REDACTED]');
  // Strip OpenRouter API keys (sk-or-v1-...) even when unlabeled
  out = out.replace(/sk-or-v1-[A-Za-z0-9\-_]+/gi, '[REDACTED]');
  return out;
}
