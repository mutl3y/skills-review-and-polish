# Git Workflow & Quality Checks

This project uses Git hooks to enforce code quality before committing and pushing.

## Pre-Commit Checks

Before each commit, **lint-staged** automatically:

- ✅ Runs ESLint on staged TypeScript files (with auto-fix)
- ✅ Type-checks with TypeScript
- ✅ Lints markdown files

**Blocked if:**

- Linting errors remain
- Type errors detected

**Example:**

```bash
$ git commit -m "Fix multiplier access"
husky - pre-commit hook
✓ src/core/analyzer.ts
✓ src/ui/diagnostics.ts
✓ docs/MULTIPLIER-ACCESS.md
✅ Commit allowed
```

## Pre-Push Checks

Before pushing to remote, the full test suite runs:

- ✅ All 60 Vitest tests must pass
- ✅ No type errors

**Blocked if:**

- Any test fails
- Compilation fails

**Example:**

```bash
$ git push
🔍 Running full test suite before push...
 ✓ src/core/analyzer.test.ts (38)
 ✓ src/providers/vscodeLmProvider.test.ts (22)
✅ All tests passed!
Pushing to origin...
```

## Bypass (Emergency Only)

If you need to skip hooks in an emergency:

```bash
# Skip pre-commit
git commit --no-verify -m "WIP: debug token leak"

# Skip pre-push
git push --no-verify
```

⚠️ **Use sparingly** — these checks catch real bugs before they reach main.

## Local Setup

Hooks are auto-installed on `npm install`. If they don't work:

```bash
npx husky install
# Verify hooks are executable:
ls -la .husky/
```

## Scripts

Quick commands for local development:

```bash
npm run lint        # ESLint check (no fix)
npm run compile     # TypeScript check
npm run test        # Run all tests
npm run watch       # Watch mode compilation
```

---

**More Info:** See [lint-staged docs](https://github.com/okonet/lint-staged) and [husky docs](https://typicode.github.io/husky/).
