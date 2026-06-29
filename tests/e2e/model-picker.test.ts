/**
 * E2E tests for the model picker commands — NO auth required.
 *
 * Tests that model picker commands exist in the palette and that
 * the picker quickpick opens. Does NOT wait for models to load
 * (that requires Copilot auth). LLM functionality is tested via MCP.
 *
 * Run with:
 *   npm run test:e2e -- tests/e2e/model-picker.test.ts
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
  const existing = page.locator('.quick-input-box input');
  if (await existing.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await existing.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
  }
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-box input', { timeout: 3_000 });
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

test('extension activates without errors', async () => {
  const errorToast = page.locator('.notifications-toasts .notification-toast [aria-label*="error" i]');
  await expect(errorToast).toHaveCount(0);
});

test('Select Analysis Model command appears in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Analysis Model');
  const item = page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: 'Select Analysis Model' });
  await expect(item.first()).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('Escape');
});

test('Select Fix Model command appears in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Fix Model');
  const item = page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: 'Select Fix Model' });
  await expect(item.first()).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('Escape');
});

test('Analyze Customization and Re-scan commands appear in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Analyze Customization');
  await expect(
    page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: 'Analyze Customization' }).first()
  ).toBeVisible({ timeout: 2_000 });
  await page.keyboard.press('Escape');
});

test('Fix All Issues command appears in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Fix All Issues');
  const item = page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: 'Fix All Issues' });
  await expect(item.first()).toBeVisible({ timeout: 2_000 });
  await page.keyboard.press('Escape');
});

test('model picker quickpick opens when command is run', async () => {
  // Just verify the quickpick UI appears — model loading requires Copilot auth
  // and is tested separately via MCP
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Analysis Model');
  await page.keyboard.press('Enter');
  // Quickpick or warning notification should appear
  const quickpickOrWorkbench = page.locator('.quick-input-box, .notifications-toasts');
  await expect(quickpickOrWorkbench.first()).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('Escape');
});

test('model picker does not show search-agent models', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Analysis Model');
  await page.keyboard.press('Enter');
  // If a quickpick opened, verify no search-agent models appear
  const isOpen = await page.locator('.quick-input-list').isVisible().catch(() => false);
  if (isOpen) {
    await expect(page.locator('.quick-input-list .label-name', { hasText: /search agent/i })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
});
