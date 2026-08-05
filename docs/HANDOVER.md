
# Handover Update — 2026-07-13: v0.1.37/v0.1.38 Released

> **Latest handover (2026-08-05):** See
> `docs/plan/archive/releases/20260805-gilfoyle-loop-to-iter20/HANDOVER.md` for
> the Gilfoyle review loop (iterations 17–20), the independent 2026-08-05 review
> remediation, the bounded-review approach, and the pending v0.1.50 publish.

## Current State (Updated)

- **Branch:** main (HEAD: d0aa476)
- **Version:** 0.1.38 (beta / release-candidate hardening)
- **Tests:** 573 unit tests passing across 25 files
- **Compilation:** Clean (npm run compile)
- **Markdown lint:** 0 errors

## What Was Done in v0.1.37/v0.1.38 (since 2026-07-12)

### Multi-model scan recommended configuration (E53/E54/E56)

**Default config in package.json:**

- Provider defaults to `vscode-lm` for Copilot-first setup.
- `model` and `deepModel` default to empty strings so Copilot/provider defaults can be selected safely.
- Recommended OpenRouter opt-in: `model` = `google/gemini-2.5-flash-lite`, `deepModel` = `deepseek/deepseek-chat-v3`.

### E56 corpus scan results

| Metric | E30 (qwen-only) | E56 (multi-model) | Change |
| --- | ---: | ---: | ---: |
| Total findings | 1664 | **8811** | **+429%** |
| Cost | $0.50 | **$0.24** | **-52%** |
| Circular definitions | 1 | 15 | +1400% |
| Contradictions | 11 | 35 | +218% |
| Dead instructions | 0 | 29 | new |
| Ambiguity | 939 | 5235 | +458% |
| Coverage gaps | 323 | 2103 | +551% |
| Time | 48 min | 47 min | similar |

### Test architecture (E50)

- **Clean fixtures** (15): `tests/fixtures/clean/*.md` — no labels, no scaffolding
- **Expected answer files** (15): `tests/fixtures/expected/*.json`
- **Test runner:** `scripts/e50-clean-architecture.mjs`
- **Result:** 18/43 = 42% recall on clean fixtures (down from 22/47 = 47% with labels, but more honest)

### E58 — quality-playbook review

Scanned the 2738-line B-grade skill in 24.6s. Found **41 real findings**:

- 22 ambiguity-llm (subjective terms)
- 12 hygiene-redundant-instruction (duplicate text)
- 4 contradiction-related (line 358 default behavior conflict)
- 2 hygiene-vague-cognitive-directive
- 1 contradiction (line 358)

**E11 said 0 findings for this skill. E58 found 41. The E11 evaluation was missing real issues.**

### Documents Updated

- `package.json` — Copilot-first defaults, OpenRouter recommendation text, version 0.1.38
- `README.md` — v0.1.38 status
- `docs/USER-GUIDE.md` — new model recommendations, marked qwen as "Avoid"
- `docs/CHANGELOG.md` — full v0.1.37/v0.1.38 changes
- `src/core/prompts/hygiene.prompt` — circular rule fix (0/7 → 5/7 on test-circular-hard)

### New Scripts

- `scripts/e50-clean-architecture.mjs` — clean architecture test runner
- `scripts/e50-generate-clean-fixtures.mjs` — generator for clean fixtures
- `scripts/e51-production-skill-test.mjs` — production skill recall test
- `scripts/e52-model-comparison.mjs` — 2-model comparison
- `scripts/e53-model-comparison-clean.mjs` — 7-model comparison on clean fixtures
- `scripts/e54-models-not-yet-tested.mjs` — wildcards (Claude, Gemini Pro, o1/o3, deepseek, Grok, Mistral)
- `scripts/e55-cost-analysis.mjs` — cost estimates
- `scripts/e56-corpus-rescan-multimodel.mjs` — corpus scan with multi-model mix
- `scripts/e58-quality-playbook-review.mjs` — single-skill deep review

### New Notes

- `notes/e51-production-test.md` — E51 production test results
- `notes/e56-corpus-multimodel.md` — full E56 corpus scan results
- `notes/e57-manual-sample-review.md` — manual sample review of E56 results
- `notes/e58-quality-playbook-review.md` — single-skill deep review
- `notes/e60-suggested-improvements.md` — prioritized list of next improvements

(Other experiment notes — e50, e52, e53, e54, e55 — exist as scripts but their detailed report notes were not created; the scripts and data files are the source of truth for those.)

## What's Next (v0.1.39+)

See `notes/e60-suggested-improvements.md` for a prioritized list of 13 improvements.
The top 3 are:

1. **P0: Improve contradiction detection** for test-contradictions-direct (4/15 → 10+/15)
2. **P0: Improve dead-instruction detection** (2/12 → 8+/12)
3. **P0: Add MIX model option to config UI** (already in code, just needs UX)

## Cost Summary (v0.1.37 work)

- E43-E50 prompt work: ~$0.20
- E51-E58 model comparison + corpus scan: ~$1.50
- Total: ~$1.70 for 600+ LLM calls and a major improvement

---

## Verification Note (2026-07-13)

This HANDOVER was verified using the `documentation-review` skill (SKILL.md).
Result: **Factually Accurate with 3 minor corrections applied** (HEAD reference, 5 missing notes references corrected, line count off by 1).
All 25+ Factual Statements (version, test count, model config, E56 corpus results, E58 findings, E30 baseline, file references for scripts that exist) verified against Repository Evidence.

## What's Next (v0.1.39+ — added 2026-07-17)

The previous "What's Next" section above (P0/P1 list of e60 items) still
applies but is now augmented by the analyzer no-truncation refactor:

1. **Re-run E50 schema-mode end-to-end** — the in-progress run was
   interrupted at 3/15 fixtures when the analyzer truncation issue was
   discovered. Now that the analyzer sends the whole document + all
   references, the recall/precision numbers may be materially different.
   Command:
   `npm run compile && STRUCTURED_OUTPUT=schema node scripts/run-with-log.mjs e50-schema-v3 -- node scripts/e50-clean-architecture.mjs`

2. **Re-run E61 production-skill validation** against `quality-playbook`
   and `mutl3y-foreman` with the new no-truncation analyzer. The previous
   E61 numbers were measured with the legacy 60K-cap and head/tail
   slicing.

3. **Decide on default model** for the bundled catalog. Currently the
   picker recommends `qwen/qwen3-coder-30b-a3b-instruct` per E56 results,
   but the catalog now surfaces ~75 popular models with explicit context
   lengths. Pickers should default to a 1M+ context model on cold-start so
   the budget works for large skills out of the box.

## Model Catalog Architecture (added 2026-07-17)

Three-tier resolution of model context length, defined in
`src/modelCatalog.ts`:

1. **Live OpenRouter catalog** (primary). Fetched from
   `https://openrouter.ai/api/v1/models` on first analyze, cached 1h
   in-memory. ~140ms cold, ~5ms warm, full 1,215-entry payload.
2. **Bundled asset** `assets/openrouter-catalog.json` (~4.5KB, top-75
   popular models). Ships in the .vsix. Used when network is unavailable
   or the user has never called analyze (cold start).
3. **Static fallback table** (5 entries): `gpt-4o mini`,
   `gemini 2.0 flash`, `gemini 3.0 pro`, `mistral-small-2503`,
   `phi-3.5-mini-instruct`. For niche Copilot display names and
   GitHub Models IDs that aren't in the OpenRouter catalog.

Test fixture `tests/fixtures/openrouter-catalog.json` keeps the full
1,215-entry catalog for drift detection (`src/modelCatalog.test.ts`).

## Release Gate Workflow (added 2026-07-17)

Before publishing to the VS Code marketplace, run:

```bash
npm run release:gate
```

This does: refresh bundled fixture (live OpenRouter fetch) → compile →
test → lint → lint:md. The `vscode:prepublish` script runs the first
two halves automatically, but `release:gate` adds the test/lint steps
for a stronger pre-flight check. AGENTS.md has the canonical note.

To publish after the gate passes, use:

```bash
VSCE_PAT=... npm run publish:vsce -- 0.1.45
```

The publish wrapper runs `release:gate` first and then calls `vsce publish`
with an explicit token, which avoids the Linux secret-store failure we hit in
this session.
