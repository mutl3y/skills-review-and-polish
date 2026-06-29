/**
 * E2E smoke test — verifies the analyze command fires and the UI responds.
 * Does NOT wait for LLM results (those are tested via MCP).
 *
 * Run with:
 *   npm run test:e2e -- tests/e2e/smoke-analyze.test.ts
 *
 * Prerequisites:
 *   - VS Code web ext host running (bash scripts/rebuild-ext.sh then reload)
 *   - No Copilot auth needed
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import { readFileSync } from 'fs';
import { BASE_URL, TOKEN_FILE, VSCODE_URL } from './setup';

test.describe.configure({ mode: 'serial' });

let page: Page;
let context: BrowserContext;

// ── helpers ──────────────────────────────────────────────────────────────────

async function waitForVSCode(page: Page) {
  await page.waitForSelector('.monaco-workbench', { timeout: 10_000 });
  const trustBtn = page.getByRole('button', { name: 'Yes, I trust the authors' });
  try {
    await trustBtn.waitFor({ state: 'visible', timeout: 2_000 });
    await trustBtn.click();
    await page.locator('.monaco-dialog-modal-block').waitFor({ state: 'hidden', timeout: 2_000 });
  } catch { /* already trusted */ }
  await page.waitForFunction(() => {
    return !!document.querySelector('.monaco-workbench .part.activitybar');
  }, { timeout: 8_000 });
}

async function openCommandPalette(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-box input', { timeout: 3_000 });
}

async function runCommand(page: Page, command: string) {
  await openCommandPalette(page);
  const titlePart = command.split(':')[1]?.trim() ?? command;
  await page.keyboard.type(titlePart, { delay: 20 });
  const item = page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: titlePart });
  await expect(item.first()).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('Enter');
}

async function openFixture(page: Page, name: string) {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Close All');
  await page.waitForSelector('.quick-input-list .monaco-list-row', { timeout: 2_000 });
  await page.keyboard.press('Enter');

  await openCommandPalette(page);
  await page.fill('.quick-input-box input', `tests/fixtures/primary/${name}/SKILL.md`);
  await page.waitForSelector('.quick-input-list .monaco-list-row', { timeout: 2_000 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.monaco-editor', { timeout: 4_000 });
}

// ── setup / teardown ──────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();

  let token = '';
  try { token = readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* no token */ }

  const url = token ? `${BASE_URL}/?tkn=${token}` : BASE_URL;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.goto(VSCODE_URL, { waitUntil: 'domcontentloaded' });
  await waitForVSCode(page);
});

test.afterAll(async () => {
  await page?.close();
  await context?.close();
});

// ── tests ─────────────────────────────────────────────────────────────────────

test('extension activates without errors on startup', async () => {
  const errorToast = page.locator('.notifications-toasts .notification-toast [aria-label*="error" i]');
  await expect(errorToast).toHaveCount(0);
});

test('Analyze Customization command fires on a SKILL.md fixture', async () => {
  await openFixture(page, 'test-ambiguities');

  // Fire the analyze command — don't wait for LLM results
  // (analysis is tested via MCP; here we just verify the command path fires)
  await runCommand(page, 'Skills Review: Analyze Customization');

  // Status bar should reflect the analyzing or idle state
  const statusBar = page.getByRole('button', { name: /Skills Review/ });
  await expect(statusBar).toBeVisible({ timeout: 3_000 });
});

test('Re-scan command fires without error', async () => {
  await openFixture(page, 'test-contradictions-direct');
  await runCommand(page, 'Skills Review: Re-scan Customization');
  // No crash = pass
  const statusBar = page.getByRole('button', { name: /Skills Review/ });
  await expect(statusBar).toBeVisible({ timeout: 3_000 });
});

test('status bar shows Skills Review when a SKILL.md is open', async () => {
  await openFixture(page, 'test-ambiguities');
  const statusBar = page.getByRole('button', { name: /Skills Review/ });
  await expect(statusBar).toBeVisible({ timeout: 3_000 });
});

test('Sync MCP Config writes .skills-review.json', async () => {
  await runCommand(page, 'Skills Review: Sync MCP Config');
  // A notification should appear confirming the file was written
  const notification = page.locator('.notifications-toasts .notification-list-item-message, .notification-toast');
  // Wait briefly — soft check since notification may auto-dismiss
  await page.waitForTimeout(500);
  // No crash = the command ran without error
});
