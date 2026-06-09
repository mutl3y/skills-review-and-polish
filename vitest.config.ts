/**
 * Root-level vitest config — re-exports the canonical config from tests/.
 * This prevents vitest's auto-discovery from picking up compiled out/ files
 * and Playwright e2e tests when running `npx vitest run` without --config.
 *
 * The canonical config lives at tests/vitest.config.ts.
 */
export { default } from './tests/vitest.config';
