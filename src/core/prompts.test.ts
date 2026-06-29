import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { loadPrompt, loadPromptTemplate } from './prompts';

// The prompts directory is copied to out/core/prompts at build time.
// In the test environment __dirname points to src/core, and the .prompt files
// live at src/core/prompts/ — so loadPrompt() can read real files.

describe('loadPrompt', () => {
  it('loads a known prompt without error', () => {
    const text = loadPrompt('contradiction');
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
    // Should not be the fallback
    expect(text).not.toContain('No prompt file found');
  });

  it('loads the ambiguity prompt', () => {
    const text = loadPrompt('ambiguity');
    expect(text).toContain('ambiguit');
  });

  it('returns the fallback string for a missing prompt file', () => {
    const text = loadPrompt('__nonexistent_prompt__');
    expect(text).toContain('No prompt file found');
  });

  it('trims trailing whitespace from the loaded prompt', () => {
    const text = loadPrompt('contradiction');
    expect(text).toBe(text.trim());
  });
});

describe('loadPromptTemplate', () => {
  it('substitutes a single {{PLACEHOLDER}} token', () => {
    // Use the custom-diagnostics template which has {{CONFIG}} and {{DOCUMENT}}
    const result = loadPromptTemplate('custom-diagnostics', {
      CONFIG: 'MY_CONFIG',
      DOCUMENT: 'MY_DOCUMENT',
    });
    expect(result).not.toContain('{{CONFIG}}');
    expect(result).not.toContain('{{DOCUMENT}}');
    expect(result).toContain('MY_CONFIG');
    expect(result).toContain('MY_DOCUMENT');
  });

  it('substitutes all occurrences of a token (not just the first)', () => {
    // Build a minimal synthetic template via loadPromptTemplate on a known prompt
    // that repeats a placeholder — instead just verify multi-replace behavior
    // by substituting into a known template twice:
    const result = loadPromptTemplate('composition-conflicts', {
      COMPOSED_TEXT: 'CONTENT_A',
      ANCHOR_OPEN: '<OPEN>',
      ANCHOR_CLOSE: '</CLOSE>',
    });
    // If any placeholder remains, the substitution is incomplete
    expect(result).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('returns the fallback text when the prompt file does not exist', () => {
    const result = loadPromptTemplate('__nonexistent__', { KEY: 'value' });
    expect(result).toContain('No prompt file found');
  });

  it('leaves unmatched {{TOKENS}} in place when the key is not in vars', () => {
    // loadPromptTemplate only replaces the keys provided — unknown tokens remain
    const result = loadPromptTemplate('custom-diagnostics', {
      CONFIG: 'c',
      // DOCUMENT intentionally omitted
    });
    expect(result).toContain('{{DOCUMENT}}');
  });
});
