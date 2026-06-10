/**
 * Capture browser auth state via Playwright — one-time setup.
 *
 * 1. Opens a real browser window pointed at the VS Code ext host
 * 2. Waits for you to authenticate with Copilot
 * 3. Captures all cookies + localStorage via context.storageState()
 * 4. Saves to tests/e2e/auth-state/storage-state.json
 *
 * Usage:
 *   npx tsx tests/e2e/capture-auth.ts
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const AUTH_DIR = join(__dirname, 'auth-state');
const OUTPUT_FILE = join(AUTH_DIR, 'storage-state.json');

const BASE_URL = process.env.EXT_HOST_URL ?? 'http://localhost:9200';
const TOKEN_FILE = process.env.VSCODE_TOKEN_FILE ?? '/home/vscode/.vscode-token';
const FOLDER = '/workspace/skills-review-and-polish';

async function main() {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }

  let token = '';
  try {
    token = readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    console.log('[capture] No token file found — connecting without token');
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const url = token
    ? `${BASE_URL}/?tkn=${token}&folder=${encodeURIComponent(FOLDER)}`
    : `${BASE_URL}/?folder=${encodeURIComponent(FOLDER)}`;

  console.log(`[capture] Opening: ${url}`);
  console.log('[capture] Please login to Copilot in the browser window.');
  console.log('[capture] When Copilot is working, press Enter here.');

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });

  process.stdout.write('\n[capture] Press Enter when Copilot is authenticated: ');
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  const state = await context.storageState();
  writeFileSync(OUTPUT_FILE, JSON.stringify(state, null, 2), 'utf8');

  console.log(`\n[capture] Auth state saved to: ${OUTPUT_FILE}`);
  console.log(`[capture] Cookies: ${state.cookies.length}`);
  console.log(`[capture] localStorage origins: ${state.origins.length}`);

  await browser.close();
}

main().catch((err) => {
  console.error('[capture] Failed:', err);
  process.exit(1);
});
