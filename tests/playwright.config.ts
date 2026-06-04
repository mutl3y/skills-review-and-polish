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
  timeout: 60_000,
  use: {
    ignoreHTTPSErrors: true,
    headless: true,
    baseURL: 'http://localhost:9200',
    launchOptions: {
      executablePath: findChromiumExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  reporter: [['list']],
});
