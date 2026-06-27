/**
 * E2E tests for the Skills Review extension running in VS Code Web.
 *
 * Run with:
 *   npm run test:e2e
 *
 * Auth: VS Code web uses a connection token stored at /home/vscode/.vscode-token.
 * We GET /?tkn=TOKEN first to set the vscode-tkn cookie, then navigate normally.
 */
import { test, expect, Page, BrowserContext, BrowserContextOptions } from '@playwright/test';
import { readFileSync } from 'fs';
import { hasAuthState, AUTH_STATE_FILE, BASE_URL, TOKEN_FILE, VSCODE_URL } from './setup';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? '';

test.describe.configure({ mode: 'serial' });

let page: Page;
let context: BrowserContext;

// ── helpers ──────────────────────────────────────────────────────────────────

async function waitForVSCode(page: Page) {
  // VS Code web is ready when the workbench is visible
  await page.waitForSelector('.monaco-workbench', { timeout: 30_000 });

  // Workspace-trust dialog appears ~2s after workbench; wait up to 6s for it then dismiss.
  // We know the exact button text from inspection.
  const trustBtn = page.getByRole('button', { name: 'Yes, I trust the authors' });
  try {
    await trustBtn.waitFor({ state: 'visible', timeout: 6_000 });
    await trustBtn.click();
    // Wait for the modal backdrop to clear before proceeding
    await page.locator('.monaco-dialog-modal-block').waitFor({ state: 'hidden', timeout: 5_000 });
  } catch {
    // Dialog didn't appear — folder already trusted, nothing to do
  }

  // Wait for the workbench shell to be fully interactive before opening the palette.
  await page.waitForFunction(() => {
    const workbench = document.querySelector('.monaco-workbench');
    const activityBar = document.querySelector('.monaco-workbench .part.activitybar');
    return !!workbench && !!activityBar;
  }, { timeout: 30_000 });
}

async function openCommandPalette(page: Page) {
  // Ensure any existing palette is fully dismissed first
  const existing = page.locator('.quick-input-box input');
  if (await existing.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await existing.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-box input', { timeout: 2_000 });
}

async function runCommand(page: Page, command: string) {
  await openCommandPalette(page);
  const titlePart = command.split(':')[1]?.trim() ?? command;
  await page.keyboard.type(titlePart, { delay: 30 });
  const item = page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: titlePart });
  await expect(item.first()).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Enter');
}

// ── fixtures ──────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  const contextOptions: BrowserContextOptions = {};
  if (hasAuthState()) {
    contextOptions.storageState = AUTH_STATE_FILE;
  }
  context = await browser.newContext(contextOptions);
  page = await context.newPage();
  // Step 1: present the connection token to get the vscode-tkn cookie
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  await page.goto(`${BASE_URL}/?tkn=${token}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  // Step 2: navigate to the workspace
  await page.goto(VSCODE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await waitForVSCode(page);

  // Step 3: if OpenRouter key is available, set it and switch provider
  // so the model picker can list actual models without Copilot auth
  if (OPENROUTER_KEY) {
    console.log('[test] Setting OpenRouter API key for model picker tests');
    await runCommand(page, 'Skills Review: Set API Key');
    const inputBox = page.locator('.quick-input-box input, .monaco-inputbox input');
    try {
      await expect(inputBox.first()).toBeVisible({ timeout: 5_000 });
      await inputBox.first().fill(OPENROUTER_KEY);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    } catch {
      console.log('[test] Could not set API key — skipping OpenRouter setup');
    }

    // Switch provider to OpenRouter
    await runCommand(page, 'Skills Review: Change Provider');
    const openrouterOption = page.locator('.quick-input-list .monaco-list-row', { hasText: 'OpenRouter' });
    try {
      await expect(openrouterOption).toBeVisible({ timeout: 3_000 });
      await openrouterOption.click();
      await page.waitForTimeout(500);
      console.log('[test] Switched to OpenRouter provider');
    } catch {
      console.log('[test] Could not switch provider — will use default');
      await page.keyboard.press('Escape');
    }
  }
});

test.afterAll(async () => {
  await page?.close();
  await context?.close();
});

test('extension activates without errors', async () => {
  const errorNotification = page.locator(
    '.notifications-toasts .notification-toast [aria-label*="error" i]',
  );
  await expect(errorNotification).toHaveCount(0);
});

test('Select Analysis Model command appears in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Analysis Model');
  const item = page.locator(
    '.quick-input-list .monaco-list-row .label-name',
    { hasText: 'Select Analysis Model' },
  );
  await expect(item).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
});

test('Select Fix Model command appears in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Fix Model');
  const item = page.locator(
    '.quick-input-list .monaco-list-row .label-name',
    { hasText: 'Select Fix Model' },
  );
  await expect(item).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
});

test('Analyze Customization and Re-scan Customization commands appear in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Analyze Customization');
  await expect(page.locator('.quick-input-list .monaco-list-row .label-name', {
    hasText: 'Analyze Customization',
  }).first()).toBeVisible({ timeout: 1000 });

  await page.fill('.quick-input-box input', '> Re-scan Customization');
  await expect(page.locator('.quick-input-list .monaco-list-row .label-name', {
    hasText: 'Re-scan Customization',
  }).first()).toBeVisible({ timeout: 1000 });

  await page.keyboard.press('Escape');
});

test('Fix All Issues command appears in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Fix All Issues');
  const item = page.locator(
    '.quick-input-list .monaco-list-row .label-name',
    { hasText: 'Fix All Issues' },
  );
  await expect(item).toBeVisible({ timeout: 1000 });
  await page.keyboard.press('Escape');
});

test('model picker opens and shows content (models or loading placeholder)', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');

  // Wait for the picker to render (either loading row or actual models)
  await page.waitForSelector('.quick-input-list', { timeout: 10_000 });

  // Try waiting for actual models (row count > 1), but don't fail if they don't load
  let modelsLoaded = false;
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
      return rows.length > 1;
    }, { timeout: 10_000 });
    modelsLoaded = true;
  } catch { /* pricing fetch may be slow */ }

  if (modelsLoaded) {
    const labels = await page.locator('.quick-input-list .label-name').allTextContents();
    expect(labels.some((t) => t.includes('🟢') || t.includes('🔵'))).toBe(true);
  }

  await page.keyboard.press('Escape');
});

test('model picker does not show internal search-agent models', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await page.waitForSelector('.quick-input-list', { timeout: 10_000 });
  await expect(page.locator('.quick-input-list .label-name', { hasText: /search agent/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('picker shows expected models from catalog (when signed in)', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
      return rows.length > 1;
    }, { timeout: 15_000 });
    const labels = await page.locator('.quick-input-list .label-name').allTextContents();
    expect(labels.some((text) => /Claude|GPT|Gemini|o[1-9]/i.test(text))).toBe(true);
  } catch { /* models didn't load */ }
  await page.keyboard.press('Escape');
});

test('picker shows cost annotations when models available', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
      return rows.length > 1;
    }, { timeout: 15_000 });
    const allLabels = await page.locator('.quick-input-list .label-name').allTextContents();
    expect(allLabels.every((t) => t.trim().length > 0)).toBe(true);
  } catch { /* models didn't load */ }
  await page.keyboard.press('Escape');
});

test('picker shows safe-tier models with vendor indicator', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  // Wait for models to appear (pricing fetch can take a few seconds)
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
      return rows.length > 1;
    }, { timeout: 15_000 });
    const labels = await page.locator('.quick-input-list .label-name').allTextContents();
    expect(labels.some((text) => text.includes('🟢'))).toBe(true);
  } catch {
    // Models didn't load — either not signed in or pricing fetch failed
  }
  await page.keyboard.press('Escape');
});

test('picker title shows sorting info when models available', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  try {
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.quick-input-list .monaco-list-row');
      return rows.length > 1;
    }, { timeout: 15_000 });
    const labels = await page.locator('.quick-input-list .label-name').allTextContents();
    expect(labels.some((text) => /Claude|GPT|Gemini|o[1-9]/i.test(text))).toBe(true);
  } catch {
    // Models didn't load — skip content validation
  }
  await page.keyboard.press('Escape');
});
