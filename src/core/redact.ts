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
  // Strip Bearer tokens (case-insensitive, with or without space)
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  out = out.replace(/bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
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
  // Strip generic OpenAI-style keys (sk-...) even when unlabeled (short keys too)
  out = out.replace(/\bsk-[A-Za-z0-9\-_]{8,}\b/gi, '[REDACTED]');
  // Strip Stripe-style keys (sk_live_/sk_test_/rk_live_/rk_test_...) — the
  // underscore form isn't caught by the `sk-` pattern above.
  out = out.replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/gi, '[REDACTED]');
  // Strip GitHub tokens (ghp_ PATs, github_pat_ fine-grained, gho_/ghu_ OAuth)
  out = out.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/gi, '[REDACTED]');
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi, '[REDACTED]');
  // Strip JWT-shaped tokens. Require the header to start with eyJ (base64url of
  // '{"') so we don't over-redact legitimate dotted identifiers/version strings.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gi, '[REDACTED]');
  // Strip AWS access keys (AKIA... / ASIA...)
  out = out.replace(/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/gi, '[REDACTED]');
  // Strip Google API keys (AIza...)
  out = out.replace(/\bAIza[0-9A-Za-z_-]{35}\b/gi, '[REDACTED]');
  // Strip Slack tokens (xoxb-/xoxp-/xoxa-/xoxr-)
  out = out.replace(/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/gi, '[REDACTED]');
  // Strip PEM private key blocks
  out = out.replace(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]');
  return out;
}
