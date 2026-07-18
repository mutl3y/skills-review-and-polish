# Structured Output Across Providers — Research Note

> Captured 2026-07-16. Records the per-provider `response_format` wire formats,
> OpenRouter's translation behaviour, and the live probe results that drove
> the `json_schema` default flip for OpenRouter-backed providers.

## Background

The `skills-review-and-polish` analyzer emits structured JSON across six
waves (contradictions, ambiguities, persona, structural/cognitive, coverage,
hygiene). The current default external-provider mode is `response_format:
{ type: 'json_schema', json_schema: { name, strict: true, schema } }`,
which OpenRouter translates per underlying provider (OpenAI/Fireworks
passthrough, Gemini → `generationConfig.responseSchema`, Anthropic →
tool-use `input_schema`).

### Document-budget interaction

Schema mode is *additive* to the analyzer's document budget. As of
2026-07-17 the budget is sourced from `provider.getContextLength()` and
scaled to a fraction of that context. The legacy 60K-char hard cap and
head/tail slicing were removed — we now send the whole skill + reference
files when they fit, and surface a budget-exceeded marker when they
don't.

The `LlmProvider` interface requires `getContextLength(): number |
undefined`. `VsCodeLmProvider` reads `maxInputTokens` from the cached
`vscode.LanguageModelChat`. `OpenRouterProvider` and
`GitHubModelsProvider` accept a `contextLength` constructor option that
callers populate via `modelCatalog.resolveContextLength()`. When the
provider returns `undefined` the analyzer logs a warning and falls back
to a 200K-char (~50K-token) budget that fits every supported model.

The MCP server awaits `resolveContextLengths()` at startup (in
`createDefaultEngine`) before constructing the provider. The cold
OpenRouter `/models` fetch is ~140ms (1h cached, ~5ms warm) — not a
user-perceptible cost. The 200K fallback is only hit when the catalog
is genuinely down or the model isn't in either the catalog or the
static fallback table. End-to-end probe (`scripts/probes/verify-mcp-context.mjs`)
confirms `provider.getContextLength()` returns the resolved 1M-token
value for `google/gemini-2.5-flash-lite` immediately after startup.

Reference files (linked `.md` content) are included in the prompt for
all 6 waves, not just composition-conflicts. Files that would overflow
the budget are dropped (with a marker) rather than truncated mid-content.

`resolveContextLength` resolves the model context via a three-tier
chain: live OpenRouter catalog (1h cache, ~140ms cold) → bundled asset
(`assets/openrouter-catalog.json`, top-75 popular models, ~4.5KB,
ships in the .vsix) → 5-entry static table for niche Copilot display
names and GitHub Models IDs. The bundle is refreshed by running
`node scripts/refresh-openrouter-catalog.mjs` (after `npm run
compile`); run it on a weekly CI schedule or whenever OpenRouter
adds models you care about. The script writes two outputs:

- `assets/openrouter-catalog.json` (top-75, ships in the .vsix)
- `tests/fixtures/openrouter-catalog.json` (full 1,215-entry, test-only)

The test fixture is for drift detection only — the runtime never
reads it. The 5-entry static table covers model IDs that don't appear
in the OpenRouter catalog (Copilot display names, deprecated/future
Gemini, GitHub Models IDs) — adding new entries should be rare.

See also `modelCatalog.ts` for the catalog fetcher, asset loader,
and the static fallback table.

```text
salvageTruncatedJSON: 35 recoveries
nonStopFinishReason: 60
finishReasonError:   60
deepFallback:        37
```

That noise comes from the analyzer running `salvageTruncatedJSON` to
recover partial output from `finish_reason: length` or otherwise
truncated responses. The hypothesis tested here: switching the wire
format to OpenRouter-compatible `json_schema` mode eliminates most of
that noise by giving the model a strict target shape.

## OpenRouter's compatibility surface

OpenRouter explicitly markets a `structured_outputs` feature that maps
a single OpenAI-compatible body to each underlying provider's native
format:

| Provider family | OpenAI body accepted | OpenRouter translation |
|---|---|---|
| OpenAI (GPT-4o+) | `json_object`, `json_schema` | passthrough |
| Google Gemini | `json_object`, `json_schema` | `json_schema` → `generationConfig.responseSchema`; `json_object` → `responseMimeType: "application/json"` (no schema) |
| Anthropic (Sonnet 4.5+, Opus 4.1+) | `json_schema` only | translates to tool-use with `input_schema` |
| Fireworks (all) | `json_object`, `json_schema` | passthrough |
| Most open-source | `json_object` (advisory) | prompt-level soft JSON |

Source: <https://openrouter.ai/models?order=newest&supported_parameters=structured_outputs>.

## Live probes

Probes used the production OpenRouter routes recommended in
`package.json` (`google/gemini-2.5-flash-lite` as standard,
`deepseek/deepseek-chat-v3` as deep). Each probe sent a real
sample payload; the response payload was parsed with the same
JSON parser the analyzer uses. Probe scripts:

- `/tmp/probe-or.py` — toy schema + simple prompt
- `/tmp/probe-stress.py` — full `LLMCombinedAnalysisResponse` shape
  (~3KB schema, all required keys, severity enums, nested objects)

### Probe matrix

| # | Model | Mode | HTTP | `finish_reason` | Schema adherence |
|---|---|---|---|---|---|
| 1 | Gemini Flash Lite | `json_schema` | 200 | `stop` | exact match |
| 2 | Gemini Flash Lite | `json_object` | 200 | `stop` | invented `analysis[]` (drifted) |
| 3 | Gemini Flash Lite | none | 200 | `stop` | invented `analysisTitle`, `sections` (drifted more) |
| 4 | DeepSeek Chat v3 | `json_schema` | 200 | `stop` | exact match |
| **Stress** | Gemini Flash Lite | `json_schema` (8-key shape) | 200 | `stop` | 8/8 keys present, no enum violations, 2411 completion tokens |
| **Stress** | DeepSeek Chat v3 | `json_schema` (8-key shape) | 200 | `stop` | 8/8 keys present, no enum violations, 927 completion tokens |

### Why the existing `json_object` path truncates

The `json_object` body tells Gemini *"emit valid JSON, no schema"*. For our
response (8 top-level keys, multiple array sub-trees, enums, nested objects),
the model drifts, re-narrates, or hits `finish_reason: length`. Probe 2
produced `"analysis": [...]` instead of the expected
`{"contradictions": [], "ambiguity_issues": [], ...}` — exactly the
near-miss shape `salvageTruncatedJSON` was added to recover.

### Why the E61 `STRUCTURED_OUTPUT=1` spot check added noise

The plan notes caution:

> E61 real-skill testing with `STRUCTURED_OUTPUT=1` introduced extra
> llm-parse-error/salvage noise on the current OpenRouter Gemini path.

That advice was based on `json_object` (the only mode `STRUCTURED_OUTPUT=1`
enabled at the time). The probes above demonstrate that `json_schema` is
the actually-strict mode; `json_object` is the worst of both worlds — the
model is told JSON, but not which JSON.

## Decision

Switch the default `structuredOutput` value from `false` to `'schema'`
on external providers. Backwards compatibility:

| Setting | Body sent | Notes |
|---|---|---|
| `structuredOutput: 'schema'` (NEW DEFAULT) | `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }` | Strict adherence for OpenAI / Gemini / Anthropic / Fireworks via OpenRouter translation |
| `structuredOutput: true` | `response_format: { type: 'json_object' }` | Legacy opt-in; preserved for users who validated that mode on a specific model |
| `structuredOutput: false` | (no `response_format`) | Pre-existing default; preserved for users who saw regressions on a specific model |

### Fallback chain

`shouldRetryWithoutStructuredOutput` already detects
`response_format | structured output | json schema | json mode`
patterns in 400/422 responses and strips `response_format` for one
retry. The chosen fallback target is **straight to no `response_format`**
(not `json_object`): if a model rejects `json_schema`, our shape is not
going to come back via `json_object` either, so skipping the
guaranteed-failing step is faster and cleaner.

### Schema source of truth

`src/providers/llmResponseSchema.ts` will hold a constant
`LLM_RESPONSE_SCHEMA` that mirrors `LLMCombinedAnalysisResponse` from
`src/core/types.ts`. The two stay co-located but the schema file owns
the wire format; the type file owns the runtime shape. If they drift,
the post-validator (a future hardening step) will catch it.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| A model silently ignores `strict: true` | Low (OpenRouter enforces for supported providers) | `additionalProperties: false` + enum fields act as second-line check |
| Schema body exceeds a provider limit | Negligible (~3KB vs 100KB+ limits) | None required |
| An Anthropic model only accepts tool-use form | Medium — OpenRouter handles this in its translation layer | `shouldRetryWithoutStructuredOutput` falls back to no `response_format` |
| Default flip regresses E50 metrics | Medium — unvalidated until E50 re-run | Run E50 before committing the default flip; if it regresses, revert and keep opt-in |
| Existing user setting `true` breaks | None | `true` continues to mean `json_object` exactly as before |

## Validation gate (in progress)

`npm run test:calibration` (E50) must be run with the new default before
the flip is committed. Success criteria (vs plan baseline):

| Metric | Plan baseline (2026-07-16) | New baseline target |
|---|---|---|
| Capped recall | 72.7% | ≥ 72.7% (no regression) |
| Precision proxy | 63.0% | ≥ 63.0% (no regression) |
| Over-report ratio | 1.15x | ≤ 1.20x |
| `salvageTruncatedJSON` recoveries | 35 | ≤ 5 (most schema-mode responses won't truncate) |
| `finishReasonError` | 60 | ≤ 10 |
| `deepFallback` | 37 | ≤ 37 (orthogonal to schema choice) |

If the gate regresses on recall or precision, revert the default flip
and keep `structuredOutput: 'schema'` as an opt-in. The retry/fallback
chain still benefits anyone who opts in.

### Partial run: structuredOutput=off (sanity check, 2026-07-16T19:49Z)

The first E50 run after the schema-mode default was wired in was
launched **before** the E50 script's `STRUCTURED_OUTPUT` env parsing
was updated. It therefore passed `structuredOutput: false` to the
provider explicitly, exercising the legacy "no response_format" path
rather than the new schema default. Result:

| Metric | Plan baseline | Off-run (2026-07-16T19:49Z) |
|---|---|---|
| Capped recall | 72.7% | 77.1% |
| Precision proxy | 63.0% | 58.9% |
| Over-report ratio | 1.15x | 1.31x |
| Categories at full median recall | 27/43 | 25/43 |
| `salvageTruncatedJSON` | 35 | 16 |
| `finishReasonError` | 60 | 17 |
| `nonStopFinish` | 60 | 17 |
| `deepFallback` | 37 | 0 |

Observations:

- `salvageTruncatedJSON` and `finishReasonError` already dropped by
  more than half, even without schema mode. This is consistent with
  other recent changes (response-health instrumentation, reduced
  salvage reliance) lowering the noise floor across modes.
- `deepFallback` collapsed from 37 → 0. This is the cleanest signal
  that the deep tier is now reliably reachable on this OpenRouter
  route — schema mode should not regress it.
- Recall improved (+4.4pp) but precision regressed (−4.1pp) and the
  over-report ratio crept up. The next run (schema mode, in progress
  at the time of writing) is the actual test of whether the default
  flip is a net win.

### Run in progress: structuredOutput=schema (2026-07-16T20:25Z)

Launched via `npm run test:calibration` with
`STRUCTURED_OUTPUT=schema` and `RELEASE_GATE=1`. Live log at
`/tmp/e50-schema.log` (symlink → timestamped file under `/tmp/`).
The validation outcome for the default flip depends on whether this
run meets the success criteria above.

## Process notes

- Per [`.github/experiments/WORKFLOW.md`](../../experiments/WORKFLOW.md),
  every prompt/format change should report Resolved / New / Unchanged /
  Regression. The probe matrix above is the "before" snapshot; the
  E50 report is the "after".
- Per `docs/plan/LEARNINGS.md` "API key in error messages" lesson,
  probe scripts must never log raw keys. The probe output above redacts
  headers.
- Per `AGENTS.md` verification gates, before any commit:
  `npm run compile`, `npx vitest run --config tests/vitest.config.ts`,
  `npm run lint:md`.
