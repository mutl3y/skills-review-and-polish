/**
 * Shared secret-redaction helper.
 *
 * Single source of truth for stripping secrets (Bearer tokens, API keys,
 * credentials) from log lines and error strings. Used by the logger (which
 * writes raw data to the output channel and a plaintext /tmp file in debug
 * mode) and the external providers (which surface error bodies that may echo
 * back tokens). Keeping one copy here prevents the two from drifting.
 *
 * @module redact
 */

/**
 * Redact secrets from a text string. Safe to call on any log line or error
 * message before it reaches a transport or the user.
 */
export function redactSecrets(text: string): string {
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
