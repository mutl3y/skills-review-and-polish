# Pull Request

Brief description of the change.

## Why

Context and motivation:

- Related issue(s): Fixes #123
- Problem statement or enhancement goal
- Why this approach was chosen

## How

Technical details:

- Algorithm or approach taken
- Files modified
- Key design decisions

## Testing

How to verify this works:

```bash
npm test                           # All tests pass (60/60)
npm run compile                    # No TypeScript errors
npm run lint                       # Lint clean
```

## Manual Testing

Steps (if applicable):

1. ...
2. ...
3. ...

## Checklist

- [ ] Tests added/updated for new or changed logic
- [ ] No breaking changes (or documented if intentional)
- [ ] Documentation updated (README, docs/, comments)
- [ ] Linting and tests pass locally
- [ ] Commit message follows [conventional format](CONTRIBUTING.md)
- [ ] Type-safe (TypeScript strict mode)
- [ ] Considered error cases and edge conditions

## Screenshots

If UI change:

Before/after or visual demonstration of changes.

## Related

- Links to discussions, reference implementations, or related PRs
- External resources if applicable

---

**Note**: Pre-push hook will run full test suite. If checks fail, fix and push again.
