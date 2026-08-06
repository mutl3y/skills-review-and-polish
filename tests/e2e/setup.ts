/**
 * Playwright auth setup — loads captured browser state for Copilot testing.
 *
 * Uses Playwright's native storageState format (from context.storageState())
 * which captures cookies + localStorage + sessionStorage in one file.
 *
 * Usage in test setup:
 *   import { loadAuthState, hasAuthState, AUTH_STATE_FILE, BASE_URL, TOKEN_FILE, FOLDER, VSCODE_URL } from './setup';
 *   const context = await browser.newContext({ storageState: AUTH_STATE_FILE });
 *   const page = await context.newPage();
 *   await page.goto(BASE_URL);
 */
import { BrowserContext } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Shared constants — single source of truth for all e2e tests ──────────────

/** VS Code web server URL (the ext host). Override with EXT_HOST_URL env var. */
export const BASE_URL = process.env.EXT_HOST_URL ?? 'https://192.168.0.29:8550';

/** Path to the connection token file. Override with VSCODE_TOKEN_FILE env var. */
export const TOKEN_FILE = process.env.VSCODE_TOKEN_FILE ?? join(homedir(), '.vscode-token');

/** Workspace folder to open in VS Code. */
export const FOLDER = '/workspace/skills-review-and-polish';

/** Full VS Code URL with workspace folder. */
export const VSCODE_URL = `${BASE_URL}/?folder=${encodeURIComponent(FOLDER)}`;

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
    const state = JSON.parse(readFileSync(AUTH_STATE_FILE, 'utf8'));
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
