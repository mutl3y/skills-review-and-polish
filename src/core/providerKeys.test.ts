// /workspace/skills-review-and-polish/src/core/providerKeys.test.ts
//
// Validates the shared provider-key accept-list. This is security-critical:
// `validateKeyForProvider` is the single gate that decides whether a key is
// ever sent to a provider's API. Zero coverage here means a malformed or
// mis-scoped key can leak in either direction (a Copilot token to
// openrouter.ai, or an OpenRouter key to api.githubcopilot.com).

import { describe, it, expect } from 'vitest';
import { validateKeyForProvider } from './providerKeys.js';

describe('validateKeyForProvider', () => {
  describe('OpenRouter provider', () => {
    it('accepts a valid OpenRouter key (sk-or-v1-)', () => {
      const key = 'sk-or-v1-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
      expect(validateKeyForProvider('openrouter', key)).toBeNull();
    });

    it('accepts a valid OpenRouter key with surrounding whitespace (trims)', () => {
      const key = '  sk-or-v1-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345  ';
      expect(validateKeyForProvider('openrouter', key)).toBeNull();
    });

    it('rejects a GitHub/Copilot token (ghp_)', () => {
      const key = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
      const err = validateKeyForProvider('openrouter', key);
      expect(err).toBeTruthy();
      expect(err).toMatch(/OpenRouter key/);
      expect(err).not.toContain(key); // never echo the key back
    });

    it('rejects a generic sk- key that is not OpenRouter-formatted', () => {
      const err = validateKeyForProvider('openrouter', 'sk-abcdefghijklmnopqrstuvwxyz');
      expect(err).toBeTruthy();
      expect(err).toMatch(/sk-or-v1-/);
    });

    it('rejects an undefined key', () => {
      const err = validateKeyForProvider('openrouter', undefined);
      expect(err).toBeTruthy();
      expect(err).toMatch(/requires an API key/);
    });

    it('rejects an empty or whitespace-only key', () => {
      expect(validateKeyForProvider('openrouter', '')).toBeTruthy();
      expect(validateKeyForProvider('openrouter', '   ')).toBeTruthy();
    });
  });

  describe('Copilot provider', () => {
    it('accepts a GitHub token (ghp_)', () => {
      const key = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
      expect(validateKeyForProvider('copilot', key)).toBeNull();
    });

    it('rejects an OpenRouter key (sk-or-v1-) — would leak to the wrong provider', () => {
      const key = 'sk-or-v1-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
      const err = validateKeyForProvider('copilot', key);
      expect(err).toBeTruthy();
      expect(err).toMatch(/GitHub token/);
      expect(err).not.toContain(key);
    });

    it('rejects an undefined key for copilot', () => {
      expect(validateKeyForProvider('copilot', undefined)).toBeTruthy();
    });
  });

  describe('unknown provider', () => {
    it('returns an unknown-provider error (fail closed)', () => {
      // @ts-expect-error intentional bad provider to assert fail-closed behavior
      const err = validateKeyForProvider('grok', 'sk-somekey');
      expect(err).toBeTruthy();
      expect(err).toMatch(/unknown provider/);
    });
  });
});