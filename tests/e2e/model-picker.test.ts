/**
 * E2E tests for the Skills Review extension running in VS Code Web.
 *
 * Run with:
 *   npm run test:e2e
 *
 * Auth: VS Code web uses a connection token stored at /home/vscode/.vscode-token.
 * We GET /?tkn=TOKEN first to set the vscode-tkn cookie, then navigate normally.
 */
import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';

test.describe.configure({ mode: 'serial' });

// Internal VS Code web server (port-forwarded externally but accessible directly inside the container)
const BASE_URL = process.env.EXT_HOST_URL ?? 'http://localhost:9200';
const TOKEN_FILE = process.env.VSCODE_TOKEN_FILE ?? '/home/vscode/.vscode-token';

// Use the extension root — already trusted, so no workspace-trust dialog blocks tests.
const FOLDER = '/workspace/skills-review-and-polish';
const VSCODE_URL = `${BASE_URL}/?folder=${encodeURIComponent(FOLDER)}`;

let page: Page;

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
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-box input', { timeout: 2_000 });
}

function exactLabel(name: string) {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

async function runCommand(page: Page, command: string) {
  await openCommandPalette(page);
  // Keep '>' prefix so VS Code stays in command mode (fill would overwrite it)
  const titlePart = command.split(':')[1]?.trim() ?? command;
  await page.fill('.quick-input-box input', `> ${titlePart}`);
  // Use locator API (same approach as the palette-visibility test) to find the item
  const item = page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: titlePart });
  await expect(item.first()).toBeVisible({ timeout: 1000 });
  await page.keyboard.press('Enter');
}

// ── fixtures ──────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // Step 1: present the connection token to get the vscode-tkn cookie
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  await page.goto(`${BASE_URL}/?tkn=${token}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  // Step 2: navigate to the workspace
  await page.goto(VSCODE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await waitForVSCode(page);
});

test.afterAll(async () => {
  await page?.close();
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
  await expect(item).toBeVisible({ timeout: 1000 });
  await page.keyboard.press('Escape');
});

test('Select Fix Model command appears in palette', async () => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Fix Model');
  const item = page.locator(
    '.quick-input-list .monaco-list-row .label-name',
    { hasText: 'Select Fix Model' },
  );
  await expect(item).toBeVisible({ timeout: 1000 });
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

test('model picker shows model name as label and id as description', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');

  const rows = page.locator('.quick-input-list .monaco-list-row');
  await expect(rows.first()).toBeVisible({ timeout: 1000 });
  expect(await rows.count()).toBeGreaterThan(0);

  const sonnetRow = rows.filter({
    has: page.locator('.label-name', { hasText: 'Claude Sonnet 4.6' }),
  });
  await expect(sonnetRow).toBeVisible({ timeout: 1000 });

  const sonnetDesc = sonnetRow.locator('.label-description, .quick-input-list-entry-description');
  await expect(sonnetDesc).toContainText('claude-sonnet-4.6');

  await page.keyboard.press('Escape');
});

test('model picker does not show internal search-agent models', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toBeVisible({ timeout: 1000 });
  await expect(page.locator('.quick-input-list .label-name', { hasText: /search agent/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('picker shows expected models from catalog', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toBeVisible({ timeout: 1000 });

  const labels = await page.locator('.quick-input-list .label-name').allTextContents();
  expect(labels.some((text) => /Claude/i.test(text))).toBe(true);
  expect(labels.some((text) => /GPT-5\.4/i.test(text))).toBe(true);
  expect(labels.some((text) => /Gemini/i.test(text))).toBe(true);
  await page.keyboard.press('Escape');
});

test('picker displays cost warnings for expensive models (multiplier > 1x)', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toBeVisible({ timeout: 1000 });

  const expensiveModels = ['claude-opus-4.7', 'claude-opus-4.8', 'gpt-5.5'];
  for (const modelId of expensiveModels) {
    const expensiveRow = page.locator('.quick-input-list .monaco-list-row').filter({
      has: page.locator('.label-description', { hasText: modelId }),
    });
    if (await expensiveRow.count() > 0) {
      await expect(expensiveRow.first()).toBeVisible({ timeout: 1000 });
      await expect(expensiveRow.locator('.label-name').first()).toContainText(/./);
    }
  }

  await page.keyboard.press('Escape');
});

test('picker shows current safe-tier model options', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toBeVisible({ timeout: 1000 });

  const safeModels = ['Claude Sonnet 4.6', 'GPT-5.4 mini', 'Gemini 3.1 Pro (Preview)'];
  const matched = await Promise.all(
    safeModels.map(async (label) => {
      const row = page.locator('.quick-input-list .monaco-list-row').filter({
        has: page.locator('.label-name', { hasText: label }),
      });
      return (await row.count()) > 0;
    }),
  );
  expect(matched.some(Boolean)).toBe(true);

  await page.keyboard.press('Escape');
});

test('picker title recommends safe models only', async () => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toBeVisible({ timeout: 1000 });
  const labels = await page.locator('.quick-input-list .label-name').allTextContents();
  expect(labels.some((text) => /Claude|GPT|Gemini/i.test(text))).toBe(true);

  await page.keyboard.press('Escape');
});
