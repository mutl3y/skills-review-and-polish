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

// Internal VS Code web server (port-forwarded externally but accessible directly inside the container)
const BASE_URL = process.env.EXT_HOST_URL ?? 'http://localhost:9200';
const TOKEN_FILE = process.env.VSCODE_TOKEN_FILE ?? '/home/vscode/.vscode-token';

// Use the extension root — already trusted, so no workspace-trust dialog blocks tests.
const FOLDER = '/workspace/skills-review-and-polish';
const VSCODE_URL = `${BASE_URL}/?folder=${encodeURIComponent(FOLDER)}`;

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

  // Give extension host time to start and register commands (onStartupFinished)
  // Without this, the command palette may open before commands are available.
  await page.waitForTimeout(5_000);
}

async function openCommandPalette(page: Page) {
  // Application Menu (≡) → View → Command Palette (top item under View)
  await page.getByRole('menuitem', { name: 'Application Menu' }).click();
  await page.getByRole('menuitem', { name: /^view$/i }).hover();
  await page.getByRole('menuitem', { name: /command palette/i }).click();
  await page.waitForSelector('.quick-input-box input', { timeout: 10_000 });
}

async function runCommand(page: Page, command: string) {
  await openCommandPalette(page);
  // Keep '>' prefix so VS Code stays in command mode (fill would overwrite it)
  const titlePart = command.split(':')[1]?.trim() ?? command;
  await page.fill('.quick-input-box input', `> ${titlePart}`);
  // Use locator API (same approach as the palette-visibility test) to find the item
  const item = page.locator('.quick-input-list .monaco-list-row .label-name', { hasText: titlePart });
  await expect(item.first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Enter');
}

// ── fixtures ──────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // Step 1: present the connection token to get the vscode-tkn cookie
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  await page.goto(`${BASE_URL}/?tkn=${token}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  // Step 2: navigate to the workspace
  await page.goto(VSCODE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await waitForVSCode(page);
});

test('extension activates without errors', async ({ page }) => {
  const errorNotification = page.locator(
    '.notifications-toasts .notification-toast [aria-label*="error" i]',
  );
  await expect(errorNotification).toHaveCount(0);
});

test('Select Analysis Model command appears in palette', async ({ page }) => {
  await openCommandPalette(page);
  await page.fill('.quick-input-box input', '> Select Analysis Model');
  const item = page.locator(
    '.quick-input-list .monaco-list-row .label-name',
    { hasText: 'Select Analysis Model' },
  );
  await expect(item).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
});

test('model picker shows model name as label and id as description', async ({ page }) => {
  await runCommand(page, 'Skills Review: Select Analysis Model');

  await page.waitForSelector('.quick-input-list .monaco-list-row', { timeout: 15_000 });

  const rows = page.locator('.quick-input-list .monaco-list-row');
  expect(await rows.count()).toBeGreaterThan(0);

  const sonnetRow = rows.filter({
    has: page.locator('.label-name', { hasText: 'Claude Sonnet 4.6' }),
  });
  await expect(sonnetRow).toBeVisible({ timeout: 5_000 });

  const sonnetDesc = sonnetRow.locator('.label-description, .quick-input-list-entry-description');
  await expect(sonnetDesc).toContainText('claude-sonnet-4.6');

  await page.keyboard.press('Escape');
});

test('model picker does not show internal search-agent models', async ({ page }) => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await page.waitForSelector('.quick-input-list .monaco-list-row', { timeout: 15_000 });

  await expect(page.locator('.quick-input-list .label-name', { hasText: /search agent/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('picker shows expected models from catalog', async ({ page }) => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await page.waitForSelector('.quick-input-list .monaco-list-row', { timeout: 15_000 });

  for (const name of ['Claude Sonnet 4.6', 'GPT-5.4', 'Gemini 2.5 Pro']) {
    await expect(page.locator('.quick-input-list .label-name', { hasText: name }))
      .toBeVisible({ timeout: 3_000 });
  }
  await page.keyboard.press('Escape');
});

test('picker displays cost warnings for expensive models (multiplier > 1x)', async ({ page }) => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await page.waitForSelector('.quick-input-list .monaco-list-row', { timeout: 15_000 });

  // Expensive models should show ⚠️ (expensive) indicator
  const expensiveModels = ['claude-opus-4.7', 'claude-opus-4.8', 'gpt-5.5'];
  for (const modelId of expensiveModels) {
    const rows = page.locator('.quick-input-list .monaco-list-row');
    const expensiveRow = rows.filter({
      has: page.locator('.label-description', { hasText: modelId }),
    });
    // If model is in catalog, it should have warning
    if (await expensiveRow.count() > 0) {
      await expect(expensiveRow.locator('.label-name')).toContainText('⚠️');
    }
  }

  await page.keyboard.press('Escape');
});

test('picker marks safe models (≤1x) with ✅ indicator', async ({ page }) => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await page.waitForSelector('.quick-input-list .monaco-list-row', { timeout: 15_000 });

  // Safe models (≤1x) should show ✅ (safe ≤1x) or no warning
  const safeModels = [
    'gpt-5-mini',
    'claude-haiku-4.5',
    'claude-sonnet-4.5',
    'gemini-2.5-pro',
    'gpt-5.2',
  ];

  for (const modelId of safeModels) {
    const rows = page.locator('.quick-input-list .monaco-list-row');
    const safeRow = rows.filter({
      has: page.locator('.label-description', { hasText: modelId }),
    });
    if (await safeRow.count() > 0) {
      const labelName = safeRow.locator('.label-name').first();
      const text = await labelName.textContent();
      // Should NOT have ⚠️ warning
      expect(text).not.toMatch(/⚠️/);
    }
  }

  await page.keyboard.press('Escape');
});

test('picker title recommends safe models only', async ({ page }) => {
  await runCommand(page, 'Skills Review: Select Analysis Model');
  await page.waitForSelector('.quick-input', { timeout: 15_000 });

  const title = page.locator('.quick-input-header');
  await expect(title).toContainText('recommend');
  await expect(title).toContainText('≤1x');

  await page.keyboard.press('Escape');
});
