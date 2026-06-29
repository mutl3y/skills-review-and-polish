import { defineConfig } from '@playwright/test';
import { existsSync } from 'fs';
import { join } from 'path';

// Prefer the full Chromium binary (chrome-linux64/chrome) over chromium_headless_shell
// to avoid libnspr4.so linker issues in this devcontainer.
function findChromiumExecutable(): string | undefined {
  const base = join(process.env.HOME ?? '/home/vscode', '.cache', 'ms-playwright');
  for (const dir of ['chromium-1223', 'chromium-1222', 'chromium-1224']) {
    const candidate = join(base, dir, 'chrome-linux64', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export default defineConfig({
  testDir: './e2e',
  timeout: 10_000,    // 10 s per test — UI-only tests should be fast
  workers: 1,  // single worker — all tests share the same VS Code web instance
  use: {
    ignoreHTTPSErrors: true,
    headless: true,
    baseURL: 'https://192.168.0.29:8550',
    actionTimeout: 5_000,   // individual locator actions
    navigationTimeout: 15_000, // page.goto() — VS Code web can be slow on first load
    launchOptions: {
      executablePath: findChromiumExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  reporter: [['list']],
});
