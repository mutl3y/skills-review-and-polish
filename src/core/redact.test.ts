// /workspace/skills-review-and-polish/src/core/redact.test.ts
//
// Validates the shared secret-redaction helper. These patterns are
// security-critical — a token that slips through ends up in the log file or
// MCP responses.

import { describe, it, expect } from 'vitest';
import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('redacts Bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer abc123def456ghi789')).toContain('[REDACTED]');
    expect(redactSecrets('Authorization: Bearer abc123def456ghi789')).not.toContain('abc123def456ghi789');
  });

  it('redacts OpenRouter keys (sk-or-v1-)', () => {
    const out = redactSecrets('key=sk-or-v1-abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('sk-or-v1-');
  });

  it('redacts generic OpenAI-style keys (sk-)', () => {
    const out = redactSecrets('sk-abcdefghijklmnopqrstuvwxyz');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts Stripe-style underscore keys (sk_live_/rk_test_)', () => {
    const live = redactSecrets('sk_live_51HabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP');
    expect(live).toContain('[REDACTED]');
    expect(live).not.toContain('sk_live_');
    const test = redactSecrets('rk_test_51HabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP');
    expect(test).toContain('[REDACTED]');
    expect(test).not.toContain('rk_test_');
  });

  it('redacts GitHub classic PATs (ghp_)', () => {
    const out = redactSecrets('token ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('ghp_');
  });

  it('redacts GitHub fine-grained PATs (github_pat_)', () => {
    const out = redactSecrets('github_pat_abcdefghijklmnopqrstuvwxyz_1234567890_ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('github_pat_');
  });

  it('redacts JWT-shaped tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redactSecrets(jwt);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('eyJhbGci');
  });

  it('redacts long hex strings', () => {
    const out = redactSecrets('key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    expect(out).toContain('[REDACTED]');
  });

  it('does not over-redact legitimate dotted identifiers', () => {
    const out = redactSecrets('version 1.0.0-alpha.20260701.beta');
    expect(out).toContain('1.0.0-alpha.20260701.beta');
  });
});
