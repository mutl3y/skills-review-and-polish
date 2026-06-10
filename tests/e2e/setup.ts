/**
 * Playwright auth setup — loads captured browser state for Copilot testing.
 *
 * This module provides a helper function to inject previously captured
 * cookies and localStorage into a Playwright browser context, enabling
 * VS Code to decrypt extension secrets (including Copilot OAuth tokens)
 * without re-authenticating.
 *
 * The captured state uses the same ServerKeyedAESCrypto key derivation
 * as the mint-proxy:
 * - Client half: HttpOnly cookie `vscode-cli-secret-half` (base64url, 32 bytes)
 * - Server half: Derived via SHA-256(server_secret + client_half)
 * - Secrets: AES-GCM encrypted, stored in browser localStorage
 *
 * Usage in test setup:
 *   import { loadAuthState } from './setup';
 *   const context = await browser.newContext();
 *   await loadAuthState(context);
 *   const page = await context.newPage();
 *   await page.goto(BASE_URL);
 */
import { BrowserContext } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const AUTH_STATE_PATH = join(__dirname, 'auth-state', 'auth-state.json');

export interface CapturedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface AuthState {
  cookies: CapturedCookie[];
  localStorage: Record<string, string>;
  capturedAt: string;
}

/**
 * Load captured auth state into a Playwright browser context.
 *
 * Steps:
 * 1. Read the auth-state.json file
 * 2. Inject cookies via context.addCookies() (handles HttpOnly)
 * 3. Inject localStorage via addInitScript() so it's available
 *    before VS Code's workbench loads and tries to decrypt secrets
 *
 * @throws if auth-state.json doesn't exist or is malformed
 */
export async function loadAuthState(context: BrowserContext): Promise<void> {
  if (!existsSync(AUTH_STATE_PATH)) {
    throw new Error(
      `Auth state not found at ${AUTH_STATE_PATH}\n` +
      'Run: node tests/e2e/capture-auth.ts\n' +
      'Then fill in the values from your browser DevTools.'
    );
  }

  const raw = readFileSync(AUTH_STATE_PATH, 'utf8');
  const auth: AuthState = JSON.parse(raw);

  // Inject cookies — Playwright handles HttpOnly transparently
  await context.addCookies(
    auth.cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }))
  );

  // Inject localStorage via init script — runs before any page JS
  // This is critical: VS Code's workbench checks localStorage on load
  // and if vscode-workbench is present + cookies are set, it uses
  // ServerKeyedAESCrypto to decrypt secrets from storage.
  await context.addInitScript((storageData: Record<string, string>) => {
    for (const [key, value] of Object.entries(storageData)) {
      localStorage.setItem(key, value);
    }
  }, auth.localStorage);

  console.log(`[auth] Loaded ${auth.cookies.length} cookies and ${Object.keys(auth.localStorage).length} localStorage entries (captured: ${auth.capturedAt})`);
}

/**
 * Check if auth state file exists and has valid content.
 */
export function hasAuthState(): boolean {
  if (!existsSync(AUTH_STATE_PATH)) return false;
  try {
    const auth: AuthState = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf8'));
    return (
      auth.cookies.length > 0 &&
      Object.keys(auth.localStorage).length > 0 &&
      // Check that template placeholders weren't left in
      !auth.cookies.some(c => c.value.includes('PASTE'))
    );
  } catch {
    return false;
  }
}
