# Contributing to Skills Review and Polish

We welcome contributions from the community! This document explains how to get started, our development process, and how to submit changes.

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/). By participating, you are expected to uphold this code. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.

## Getting Started

### Prerequisites
- Node.js 18+
- npm 9+
- VS Code 1.90+

### Development Setup
```bash
# Clone the repository
git clone https://github.com/mutl3y/skills-review-and-polish.git
cd skills-review-and-polish

# Install dependencies
npm install

# Build the extension
npm run compile

# Launch Extension Development Host (F5 in VS Code)
# or manually:
code --extensionDevelopmentPath=$(pwd)
```

### Verification
```bash
npm run lint    # Check for style issues
npm run test    # Run 60/60 unit tests
npm run compile # Verify TypeScript
```

## Development Workflow

### 1. Pick an Issue
- Check [open issues](https://github.com/mutl3y/skills-review-and-polish/issues)
- Look for `good first issue` or `help wanted` labels
- Comment to claim the issue (avoid duplicated work)

### 2. Create a Feature Branch
```bash
git checkout -b feature/description-of-change
# or: git checkout -b fix/issue-number
```

### 3. Make Changes
Follow our [Development Standards](docs/DEVELOPMENT-STANDARDS.md):

**Code Style:**
- Use TypeScript (strict mode)
- 2-space indentation
- Prefer const/let over var
- Use async/await over Promises

**File Structure:**
- Unit tests in `src/**/*.test.ts` (co-located with source)
- E2E tests in `e2e/` (Playwright)
- Types in `src/core/types.ts` (shared types)
- UI components in `src/ui/` (isolated modules)

**Safety Standards:**
- Review [Safety Gates & Risk Classification](docs/DEVELOPMENT-STANDARDS.md#safety-gates)
- Document security implications
- Add tests for error paths

### 4. Test Locally
```bash
# Run tests
npm run test

# Watch mode during development
npm run test -- --ui

# Type-check
npm run compile

# Lint
npm run lint

# Manual testing (F5 in VS Code)
```

### 5. Commit with Meaningful Messages
Git hooks auto-enforce quality:

```bash
git add src/
git commit -m "fix: Handle JSON truncation in deep model responses

- Strip fence markers before JSON parsing
- Add salvage logic for incomplete JSON
- Test with 3 deep-tier mock responses"

# Pre-commit hook runs: eslint --fix, tsc, markdown lint
# If failures: fix and commit again (amended)
```

Commit message format (conventional):
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `test:` Test additions
- `refactor:` Code restructuring
- `chore:` Maintenance

### 6. Push and Open PR
```bash
git push origin feature/description-of-change
```

Visit GitHub and click "Create pull request". See [Pull Request Guidelines](#pull-request-guidelines) below.

## Pull Request Guidelines

### Before Submitting
- [ ] Tests pass: `npm test` (60/60)
- [ ] No TypeScript errors: `npm run compile`
- [ ] Lint clean: `npm run lint`
- [ ] All Git hooks pass on push (`pre-push` runs tests)

### PR Title & Description
**Title format:**
```
[type] Brief description (50 chars max)
```

**Description template:**
```markdown
## What
Brief explanation of the change.

## Why
Why this change is needed (issue #123, user pain point, etc.)

## How
Technical approach taken (algorithm, refactoring strategy, etc.)

## Testing
How to verify the change works:
- Run `npm test`
- Manual test: Open SKILL.md file, run "Analyze This File", verify X behavior

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated if needed
- [ ] No breaking changes
```

### Review Process
1. **Automated checks** (2-5 min):
   - Tests pass (60/60)
   - No type errors
   - Linting clean
   - Pre-push hook successful

2. **Code review** (24-48 hours):
   - Core team reviews logic, safety, edge cases
   - Feedback via comments
   - Request changes or approve

3. **Merge**:
   - Squash merge for clarity
   - Branch auto-deletes
   - Release notes generated

## Testing

### Unit Tests (Fast, Mocked)
```bash
npm test                    # Run all
npm test -- src/core/analyzer.test.ts  # Single file
npm test -- --ui            # Watch mode
```

**Test structure** (Vitest):
```typescript
import { describe, it, expect } from 'vitest';

describe('Feature name', () => {
  it('should handle specific case', () => {
    const result = functionUnderTest(input);
    expect(result).toBe(expected);
  });
});
```

**When to add tests:**
- ✅ All new features must have tests
- ✅ Bug fixes should include a regression test
- ✅ Critical paths (fixing, scoring, risk classification) **must** be tested
- ⏳ UI components (CodeLens, hovers) can be tested manually during development

**Coverage goals:**
- Analyzer: 100% (all waves)
- Providers: 100% (model selection, streaming)
- Fixer: 80%+ (risk classification, safety gates)
- UI: Manual testing OK (E2E tests deferred to v1.1)

### Integration Testing
For changes affecting multiple systems:
1. Open a SKILL.md file with known issues
2. Run "Skills Review: Analyze This File"
3. Verify diagnostics appear
4. Test "Fix this issue" on each one
5. Verify diff preview and acceptance

See [test/fixtures/README.md](test/fixtures/README.md) for test cases.

## Documentation

### When to Update Docs
- [ ] New feature added → update README features section
- [ ] User-facing command changed → update "Quick Start"
- [ ] Configuration option added → update "Configuration" section
- [ ] API changed → update [docs/DEVELOPMENT-STANDARDS.md](docs/DEVELOPMENT-STANDARDS.md)
- [ ] Major decision made → add decision record in [docs/plan/](docs/plan/)

### Documentation Standards
- Use active voice ("Run the analyzer" not "The analyzer can be run")
- Code examples must be tested/current
- Link to related docs
- Keep lines <100 characters (readability)
- Use `bash`, `typescript`, `json` code fences with language tags

## Troubleshooting

### Tests fail locally but pass on CI
- Ensure you're on the latest `main`
- Delete node_modules and reinstall: `rm -rf node_modules && npm install`
- Hard reset: `git clean -fdx && npm install && npm test`

### TypeScript errors in editor but `npm run compile` passes
- Reload VS Code: `Cmd+Shift+P` → "Reopen Window"
- Check that Workspace Version matches Project Version

### Pre-push hook blocks push
```bash
# Investigate why tests fail
npm test

# Fix issues
# Then try again (or bypass with git push --no-verify)
```

### How to update ESLint or TypeScript
- Update `package.json` manually
- Run `npm install`
- Run `npm run lint -- --fix` to auto-fix any issues
- Commit the changes

## Release Process

Releases are handled by core maintainers:

1. Update [CHANGELOG.md](CHANGELOG.md) with all changes since last release
2. Bump version in `package.json` (semantic versioning)
3. Commit: `git commit -m "chore: Release v0.0.2"`
4. Tag: `git tag v0.0.2`
5. Push: `git push origin main --tags`
6. Publish to VS Code Marketplace: `vsce publish`

## Questions?

- **Documentation**: Check [docs/](docs/) and linked guides
- **Issue help**: Comment on the GitHub issue with questions
- **General discussion**: Start a [GitHub Discussion](https://github.com/mutl3y/skills-review-and-polish/discussions)
- **Security**: See [SECURITY.md](SECURITY.md)

## Attribution

Contributors will be acknowledged in [CHANGELOG.md](CHANGELOG.md) release notes. Thank you for helping improve Skills Review and Polish! 🙏
