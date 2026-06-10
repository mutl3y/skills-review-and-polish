/**
 * Playwright auth setup — loads captured browser state for Copilot testing.
 *
 * Uses Playwright's native storageState format (from context.storageState())
 * which captures cookies + localStorage + sessionStorage in one file.
 *
 * Usage in test setup:
 *   import { loadAuthState, hasAuthState, AUTH_STATE_FILE } from './setup';
 *   const context = await browser.newContext({ storageState: AUTH_STATE_FILE });
 *   const page = await context.newPage();
 *   await page.goto(BASE_URL);
 */
import { BrowserContext } from '@playwright/test';
import { existsSync } from 'fs';
import { join } from 'path';

/** Path to the Playwright storageState file */
export const AUTH_STATE_FILE = join(__dirname, 'auth-state', 'storage-state.json');

/**
 * Load captured auth state into a Playwright browser context.
 * Delegates to Playwright's built-in storageState support.
 */
export async function loadAuthState(context: BrowserContext): Promise<void> {
  if (!existsSync(AUTH_STATE_FILE)) {
    throw new Error(
      `Auth state not found at ${AUTH_STATE_FILE}\n` +
      'Run: npx tsx tests/e2e/capture-auth.ts\n' +
      'This opens a browser window — login to Copilot and press Enter when ready.'
    );
  }

  // context already has storageState loaded via constructor option
  // This function is just for validation and logging
  console.log('[auth] Using Playwright storageState — Copilot should be available');
}

/**
 * Check if auth state file exists and has valid content.
 */
export function hasAuthState(): boolean {
  if (!existsSync(AUTH_STATE_FILE)) return false;
  try {
    const state = JSON.parse(require('fs').readFileSync(AUTH_STATE_FILE, 'utf8'));
    return (
      Array.isArray(state.cookies) &&
      state.cookies.length > 0 &&
      Array.isArray(state.origins) &&
      state.origins.length > 0
    );
  } catch {
    return false;
  }
}
