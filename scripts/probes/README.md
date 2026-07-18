# Probes

One-off diagnostic scripts that exercise specific code paths in the analyzer, providers, and model catalog. Unlike `e*.mjs` scripts (which produce per-iteration reports and live under `scripts/`), probes are **ad-hoc**:

- Built to answer a specific question in 5 minutes
- Usually print a single number or a small report
- Are not part of `npm run compile`, `npm run test`, or `npm run release:gate`
- Do not have unit-test parity — they exercise real code paths against real services and require `OPENROUTER_API_KEY` (and similar) in the environment

Most probes were originally placed in `/tmp` and would have been lost on reboot. They are kept here so that the reproduction steps behind CHANGELOG entries, plan.yaml notes, and review decisions don't disappear.

## Usage

Every probe is a standalone ESM script. From the workspace root:

```bash
# OpenRouter probes
OPENROUTER_API_KEY=sk-... node scripts/probes/<name>.mjs

# Cat-local probes (no network)
node scripts/probes/<name>.mjs
```

If the probe needs a built bundle, ensure `npm run compile` has produced `out/` first.

## Probe inventory (28 files)

### Tier 1 — load-bearing (cited in CHANGELOG / plan.yaml)

| File | Cited from | Purpose |
| --- | --- | --- |
| `verify-full-doc.mjs` | CHANGELOG, plan.yaml, LEARNINGS.md | Proves the analyzer now sends the whole skill + all references (no 60K head/tail cap). Uses a 1M-context gemini and the local `quality-playbook` skill. |
| `probe-cache-priority.mjs` | plan.yaml | Exercises the live → fixture → static fallback chain in `modelCatalog.ts` and asserts cache-hit latency. |
| `measure-tokens.mjs` | plan.yaml | Measures real `usage.prompt_tokens` for `quality-playbook` and `mutl3y-foreman` across llama-3.1-8b and gemini-2.5-flash-lite. |

### Tier 2 — recurring architecture probes

| File | Purpose |
| --- | --- |
| `verify-mcp-context.mjs` | Confirms `createDefaultEngine()` async fetches the catalog so MCP gets a real context length (not the 200K fallback). |
| `probe-truncation.mjs` | Sends full / head-tail-truncated / first-30K variants to compare model behavior. |
| `probe-catalog.mjs` | Measures cold vs warm `/models` fetch latency. |
| `probe-full.mjs` | Does the model accept the full document? At what cost? |
| `probe-openai-schema.mjs` | Tries `json_schema` mode against each OpenRouter-compatible provider. |
| `probe-static-table.mjs` | Exercises every static-table entry in `modelCatalog.ts`. |
| `capture-catalog.mjs` | Writes the live OpenRouter catalog to a fixture file. |
| `audit-static-vs-catalog.mjs` | Cross-references static table values vs live OpenRouter catalog (drift detection). |
| `pick-top-50.mjs` | Heuristic for picking the most-likely-to-be-picked models into the bundled asset. |
| `audit-static-orphans.mjs` | Reports static-table entries that are NOT in the OpenRouter catalog. |

### Tier 3 — one-off exploratory / debugging

These survive because deleting is irreversible and they may answer a future question, but they are **not load-bearing** for the current architecture:

`debug-schema-gemini.mjs`, `debug-schema-models.mjs`, `debug-test.mjs`,
`check-claude.mjs`, `check-dirs.mjs`, `e27-retest.mjs`, `e35b-v9.mjs`,
`e41-minimax-m3.mjs`, `e41-mini-test.mjs`, `e61-model-compare.mjs`,
`list-models.mjs`, `retry-candidates.mjs`, `test-dedup.mjs`,
`test-dedup2.mjs`, `test-single-schema.mjs`.

## Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | (required) | All OpenRouter probes |
| `SKILLS_REVIEW_PROBE_SKILL` | `/workspace/awesome-copilot-fork/skills/quality-playbook/SKILL.md` | `verify-full-doc.mjs`, `probe-truncation.mjs`, `probe-full.mjs` |
| `SKILLS_REVIEW_PROBE_REF_ROOT` | `/workspace/awesome-copilot-fork/skills/quality-playbook` | Same three as above |
| `SKILLS_REVIEW_PROBE_MUTL3Y_ROOT` | `/workspace/mutl3y_review_workflow_development/skills/mutl3y-foreman` | `measure-tokens.mjs` |

Local-only defaults point at skills on the original analysis machine. Set the env vars to make these probes run elsewhere.

## Adding a new probe

1. Pick a name that reads as a verb: `verify-*.mjs`, `probe-*.mjs`, `measure-*.mjs`, `audit-*.mjs`, `capture-*.mjs`.
2. Top-of-file comment must answer three questions: **What is the question? Why does it matter? What does success look like?**
3. If the probe is cited from CHANGELOG, plan.yaml, or LEARNINGS.md, add it to **Tier 1** here.
4. Do **not** wire probes into `npm run compile`, `npm run test`, or `npm run release:gate`. They are diagnostic, not gates.

## Removing probes

Probes accumulate. Every quarter, sweep this folder and:

- Delete probes whose underlying question has been answered in a committed test
- Move Tier-2 entries that have proven useful 3+ times into the test suite (see `LEARNINGS.md` "Promote probes to tests" rule)
- Keep Tier-1 entries forever (they're the reproduction commands for historic decisions)
