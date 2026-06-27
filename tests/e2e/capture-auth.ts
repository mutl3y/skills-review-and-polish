/**
 * Capture browser auth state for Playwright E2E testing.
 *
 * Since we're running headless in a container (no X server), we can't open
 * a headed browser. Instead, use the DevTools console snippet below.
 *
 * HOW TO CAPTURE:
 *   1. Open your VS Code ext host in your browser (where Copilot is logged in)
 *   2. Open DevTools (F12) → Console tab
 *   3. Paste the snippet from getDevToolsSnippet() and press Enter
 *   4. It copies JSON to clipboard — paste into tests/e2e/auth-state/storage-state.json
 *   5. The smoke test auto-loads this file
 *
 * HOW TO VERIFY:
 *   After capturing, run: npm run test:e2e
 *   Check that the test output shows "Auth state loaded"
 *
 * @module capture-auth
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';

const AUTH_DIR = join(__dirname, 'auth-state');
const OUTPUT_FILE = join(AUTH_DIR, 'storage-state.json');

/**
 * Returns the DevTools console snippet that captures cookies + localStorage
 * in Playwright's storageState format and copies to clipboard.
 */
export function getDevToolsSnippet(): string {
  return `
// ── Playwright auth capture ── Paste this into DevTools Console ──
(() => {
  // Cookies (including HttpOnly — read from the network, not document.cookie)
  // NOTE: document.cookie CANNOT read HttpOnly cookies. We rely on Playwright
  // to set them from the storageState file. For the critical cookies, we read
  // them from the DevTools Application tab manually.
  const cookies = document.cookie.split(';').filter(c => c.trim()).map(c => {
    const eq = c.indexOf('=');
    return {
      name: c.slice(0, eq).trim(),
      value: c.slice(eq + 1).trim(),
      domain: location.hostname,
      path: '/',
      httpOnly: false,
      secure: location.protocol === 'https:',
      sameSite: 'Lax',
    };
  });

  // localStorage
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) ls[key] = localStorage.getItem(key) ?? '';
  }

  // sessionStorage
  const ss = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key) ss[key] = sessionStorage.getItem(key) ?? '';
  }

  const state = {
    cookies,
    origins: [{
      origin: location.origin,
      localStorage: Object.entries(ls).map(([name, value]) => ({ name, value })),
      sessionStorage: Object.entries(ss).map(([name, value]) => ({ name, value })),
    }],
  };

  const json = JSON.stringify(state, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    console.log('%c✅ Auth state copied to clipboard!', 'color: green; font-size: 14px');
    console.log('Paste into: tests/e2e/auth-state/storage-state.json');
    console.log('Cookies:', cookies.length, '| localStorage keys:', Object.keys(ls).length);
    console.log('%c⚠️  IMPORTANT: Also manually add HttpOnly cookies from DevTools → Application → Cookies', 'color: orange');
    console.log('The key cookies are: vscode-cli-secret-half, vscode-secret-key-path');
  }).catch(() => {
    console.log('[auth] Clipboard write failed — copy the JSON below manually:');
    console.log(json);
  });
})();
`;
}

/**
 * Generate the auth-state file from provided cookie values.
 * For when DevTools clipboard doesn't work or user wants to script it.
 */
export function createAuthStateFile(httpOnlyCookies: Array<{ name: string; value: string }>): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }

  const state = {
    cookies: httpOnlyCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict' as const,
    })),
    origins: [], // Will be populated by DevTools snippet
    capturedAt: new Date().toISOString(),
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log(`[capture] Created auth state file: ${OUTPUT_FILE}`);
  console.log('[capture] Now run the DevTools snippet to add localStorage data');
}

// CLI entry point
if (require.main === module) {
  console.log('=== PASTE THIS INTO DEVTOOLS CONSOLE ===');
  console.log(getDevToolsSnippet());
  console.log('=== END SNIPPET ===');
}

/**
 * Interactive Playwright-based auth capture.
 *
 * Opens a headed browser → VS Code Web → waits for user to sign into
 * Copilot → captures storageState (cookies + localStorage).
 *
 * Usage:
 *   npx tsx tests/e2e/capture-auth.ts
 *
 * Works on desktop Linux/macOS/Windows with a display server.
 */
async function captureAuthInteractive(): Promise<void> {
  const { chromium } = await import('playwright');
  const { BASE_URL, TOKEN_FILE, FOLDER } = await import('./setup');

  let token = '';
  try { token = readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* no token */ }

  if (!token) {
    console.error(`[capture] No token found at ${TOKEN_FILE}. Set VSCODE_TOKEN_FILE or create the file.`);
    process.exit(1);
  }

  console.log('[capture] Launching headed browser...');
  console.log(`[capture] Connecting to: ${BASE_URL}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Set the vscode-tkn cookie first
  await page.goto(`${BASE_URL}/?tkn=${token}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });

  // Navigate to the workspace
  await page.goto(`${BASE_URL}/?folder=${encodeURIComponent(FOLDER)}`, {
    waitUntil: 'domcontentloaded', timeout: 15_000,
  });

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  VS Code Web is open in your browser.                   ║');
  console.log('║                                                         ║');
  console.log('║  1. Sign into GitHub Copilot (Accounts icon → Sign in)  ║');
  console.log('║  2. Wait for the model picker to show real models       ║');
  console.log('║  3. Come back here and press ENTER when done            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Wait for user to press Enter in the terminal
  await new Promise<void>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Press ENTER when Copilot is signed in... ', () => {
      rl.close();
      resolve();
    });
  });

  console.log('[capture] Capturing storage state...');

  // Playwright's context.storageState() captures cookies + localStorage
  // from all origins automatically
  const state = await context.storageState();

  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(state, null, 2), 'utf8');

  console.log(`[capture] ✅ Auth state saved to: ${OUTPUT_FILE}`);
  console.log(`[capture] Cookies: ${state.cookies.length} | Origins: ${state.origins.length}`);
  console.log('[capture] Run `npm run test:e2e` to verify.');
  console.log('[capture] Closing browser...');

  await browser.close();
}

// Run interactive capture if executed directly
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: npx tsx tests/e2e/capture-auth.ts');
    console.log('');
    console.log('Opens a headed browser → VS Code Web → sign into Copilot → captures auth state.');
    console.log('The captured state is saved to tests/e2e/auth-state/storage-state.json');
    console.log('and automatically loaded by E2E tests.');
  } else {
    captureAuthInteractive().catch((err) => {
      console.error('[capture] Fatal error:', err);
      process.exit(1);
    });
  }
}
