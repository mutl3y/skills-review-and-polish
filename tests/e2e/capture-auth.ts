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

import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

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
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Playwright Auth Capture                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  1. Open VS Code ext host in browser (Copilot logged in)   ║');
  console.log('║  2. DevTools → Console → paste snippet below               ║');
  console.log('║  3. Copy output to: tests/e2e/auth-state/storage-state.json║');
  console.log('║  4. Also add HttpOnly cookies from DevTools → App → Cookies║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('=== PASTE THIS INTO DEVTOOLS CONSOLE ===');
  console.log(getDevToolsSnippet(){
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
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Playwright Auth Capture                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  1. Open VS Code ext host in browser (Copilot logged in)   ║');
  console.log('║  2. DevTools → Console → paste snippet below               ║');
  console.log('║  3. Copy output to: tests/e2e/auth-state/storage-state.json║');
  console.log('║  4. Also add HttpOnly cookies from DevTools → App → Cookies║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('=== PASTE THIS INTO DEVTOOLS CONSOLE ===');
  console.log(getDevToolsSnippet(){
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
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Playwright Auth Capture                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  1. Open VS Code ext host in browser (Copilot logged in)   ║');
  console.log('║  2. DevTools → Console → paste snippet below               ║');
  console.log('║  3. Copy output to: tests/e2e/auth-state/storage-state.json║');
  console.log('║  4. Also add HttpOnly cookies from DevTools → App → Cookies║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('=== PASTE THIS INTO DEVTOOLS CONSOLE ===');
  console.log(getDevToolsSnippet());
  console.log('=== END SNIPPET ===');
}
