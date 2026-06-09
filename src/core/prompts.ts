/**
 * Prompt loading utilities — extension-agnostic.
 *
 * All analysis prompts live in .md files under `./prompts/`. This module
 * provides loadPrompt() and loadPromptTemplate() so both analyzer.ts and
 * fixer.ts can access them without duplicating the loading logic.
 *
 * @module prompts
 */

import * as fs from 'fs';
import * as path from 'path';

// NOTE: __dirname is correct for CommonJS output but will break with esbuild/webpack bundling.
// If bundling is added in the future, switch to import.meta.url or a config-driven path.
const PROMPTS_DIR = path.join(__dirname, 'prompts');

/** Default fallback when a prompt .md file cannot be loaded. */
const PROMPT_FALLBACK = '(No prompt file found — analysis degraded.)';

/**
 * Load a prompt .md file by name (without extension).
 * Returns a fallback string on I/O errors instead of throwing.
 */
export function loadPrompt(name: string): string {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[SkillsReview] loadPrompt failed for "${name}": ${msg}`);
    return PROMPT_FALLBACK;
  }
}

/** Load a prompt template and substitute {{PLACEHOLDER}} tokens. */
export function loadPromptTemplate(name: string, vars: Record<string, string>): string {
  let template = loadPrompt(name);
  for (const [key, value] of Object.entries(vars)) {
    template = template.split(`{{${key}}}`).join(value);
  }
  return template;
}
