import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'src/__tests__/**/*.test.ts',
    ],
    exclude: [
      'out/**',           // Don't run compiled CommonJS files
      'tests/e2e/**',     // E2E tests run separately via Playwright
      'node_modules/**',
    ],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**'],
    },
  },
});
