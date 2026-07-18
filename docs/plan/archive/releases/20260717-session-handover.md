# Handover — 2026-07-17

> **Resume target**: continue schema-mode validation, fix the post-processor
> nondeterminism, dispatch the production-skill noise probe, then update
> LEARNINGS.md to publish the corrected numbers.
>
> **Last conversation action**: User asked for a handover doc to persist
> state across a PC restart. State at hand-off time below.

## TL;DR

This session shipped **schema-mode validation as the v0.1.39 release's default
analyzer mode** (87.3% recall, 63.3% precision, 1.38x over-report at 5×3 on
hard fixtures; sql-optimization production-skill noise dropped 63→15 findings).

A subsequent **noise-floor remeasurement** showed 16-finding variance per
iteration on labeled fixtures (10× probe, 9 successful runs), which is
~30% of the 50-finding baseline. **This is fixable in code** — the
post-processor's `crossWaveDedupRule` iterates findings in arrival order,
which depends on which parallel wave call returned first. The deterministic
fix is a 5-line sort in [src/core/findingFilter.ts:605](src/core/findingFilter.ts#L605).

The most consequential pending work item: **ship the deterministic
post-processor fix and remeasure** before publishing any new noise margin.

---

## State at hand-off (timestamp 2026-07-17T14:36:42 UTC)

### Code changes (uncommitted)

**Modified:**

- `src/extension.ts` — picker `RECOMMENDED_MODELS` switched from `qwen/qwen3-coder-30b` to `google/gemini-2.5-flash-lite`; added `RECOMMENDED_DEEP_MODELS` for `deepseek/deepseek-chat-v3`. Both get ⭐ in the picker.
- `package.json` — `model` and `deepModel` settings descriptions point at the picker ⭐ + the experiment script + the Recommended OpenRouter Models table.
- `scripts/e50-clean-architecture.mjs` — three fixes:
  1. Constructor passes `contextLength: 1_000_000` (silences the 200/wave `getContextLength() returned undefined` warning)
  2. Added `PER_WAVE_TIMEOUT_MS` env (default 120_000) and tightened the script-level `withTimeout` net from 360s to `6 × PER_WAVE_TIMEOUT_MS + 30s`
  3. Added `SKIP_POST_PROCESS` env (when `1`, sets `filterFindings: false`) for the dedup-discovery probe

**Untracked (new):**

- `assets/openrouter-catalog.json` — 75-entry bundled model catalog
- `scripts/refresh-openrouter-catalog.mjs` — refresh maintenance script
- `src/modelCatalog.ts` + `src/modelCatalog.test.ts` — three-tier resolution (live → bundled → static)
- `src/providers/llmResponseSchema.ts` + `src/providers/llmResponseSchema.test.ts` — strict JSON schema for OpenRouter
- `scripts/run-with-log.mjs` — long-running wrapper
- `scripts/probes/` — 28 diagnostic probes (READMEs tier 1/2/3 + 28 .mjs files)
- `tests/fixtures/openrouter-catalog.json` — drift-detection fixture
- `docs/plan/20260716-release-readiness-remediation/` — main plan.yaml (1394 lines)
- `docs/plan/research/` — supporting notes
- `.archive/scripts-2026-07-17-audit/` — 5 deleted scripts kept for recovery

**Deleted (archived in `.archive/`):**

- `scripts/analyze-prompts-{github,safe}.mjs`
- `scripts/e40-m3-direct-test.mjs`
- `scripts/e40-minimax-m3-fixture-validation.mjs`
- `scripts/e45-circular-probe.mjs`

### Documentation changes

- `docs/CHANGELOG.md` — added `## [Unreleased]` v0.1.39 subsections (Breaking / Added / Changed / Fixed)
- `docs/USER-GUIDE.md`, `docs/FAQS.md`, `docs/ARCHITECTURE.md`, `docs/HANDOVER.md` — model catalog + picker ⭐ references
- `docs/plan/20260716-release-readiness-remediation/plan.yaml` — now 1394 lines, with 4 new sections:
  - `notes_added_2026_07_17_smoke` (1×1 schema-mode smoke)
  - `notes_added_2026_07_17_ab_probe` (1×1 schema vs off A/B)
  - `notes_added_2026_07_17_5x3_smoke` (5×3 schema-mode)
  - `notes_added_2026_07_17_crossWaveDedup_stale_expectation` (discovery)
  - `notes_added_2026_07_17_round2_probes` (rederive + noise-floor)
  - `notes_added_2026_07_17_user_correction` (labeled-fixture vs production variance)
  - `notes_added_2026_07_17_user_correction_b` (metric confusion + post-processor fix)
  - `follow_ups_added_2026_07_17_{a..g}` (8 prioritized follow-up blocks)
- `docs/plan/LEARNINGS.md` — updated `/tmp/` probe references to `scripts/probes/`; deferred restructure

### Artifacts (data + logs)

All 7 new artifacts are checked into `.github/experiments/documentation-review/`:

| Artifact | When | What | Headline |
| --- | --- | --- | --- |
| `e50-clean-architecture-2026-07-17T09-57-04-966Z.{json,log}` | 1×1 schema-mode | First validation that fix worked | Recall 78.8%, Precision 45.6% |
| `e50-clean-architecture-2026-07-17T10-05-14-326Z.{json,log}` | 1×1 off-mode | A/B disambiguator | Recall 63.6%, Precision 47.7% |
| `e50-clean-architecture-2026-07-17T10-11-56-417Z.{json,log}` | 5×3 schema-mode | Statistically meaningful | **Recall 87.3%, Precision 63.3%, Over-report 1.38x** |
| `e50-clean-architecture-2026-07-17T10-38-51-009Z.{json,log}` | 5×3 schema + skip-post-process | Dedup-discovery | **Recall 94.9%, Precision 73.5%** (raw analyzer, no dedup) |
| `e50-clean-architecture-2026-07-17T11-00-27-263Z.{json,log}` | 5× schema-mode | Noise-floor | **Penalty range 54, finding range 16** |
| `e61-production-current-2026-07-17T11-01-04-396Z.{json,log}` | E61 default | Production validation | **sql-optimization 63→15 findings (-76%)** |
| `e61-production-current-2026-07-17T13-16-45-612Z.{json,log}` | E61 targeted | Targeted re-run | Same JSON overwritten (env not forwarded — known bug) |

---

## Open work items (prioritized)

### Post-Handover Update (same day)

After the handover was written, two provider-side schema hardening changes landed:

- external providers now send `temperature: 0` and `top_p: 0` by default
- when schema mode returns `finish_reason: error|length`, the provider retries once with `response_format` removed

A live 1x1 schema smoke on `test-contradictions-direct` improved from
`78.8% recall / 45.6% precision / salvage=1 / finishError=1` to
`81.8% recall / 67.5% precision / salvage=0 / finishError=0`.

However, the necessary like-for-like 5-fixture rerun showed the tradeoff is not free:

- pre-hardening 5-slice: `87.3% recall / 63.3% precision / 1.38x over-report / 2 finish errors`
- post-hardening 5-slice: `83.5% recall / 73.3% precision / 1.14x over-report / 0 finish errors`

So provider hardening improved precision and eliminated response-health failures, but it also reduced recall. The next best step is **narrowing the fallback scope** (e.g. only on `finish_reason:error`, or only on the standard tier), not rerunning the same broad probes.

### 1. **deterministic-post-processor** (severity: high, ~15 min)

The most impactful fix and the right next move. Sort `others` in
`crossWaveDedupRule.matches()` by `(analyzer, code, range.start.line, range.start.character)`
before iterating, so suppression is deterministic given the same finding set.

**Patch (in [src/core/findingFilter.ts:605](src/core/findingFilter.ts#L605)):**

```ts
matches(candidate, others) {
  if (!SUPPRESSABLE_WEAK_CODES.has(candidate.code)) return false;
  const candSpec = specificity(candidate.code);
  if (candSpec === -1) return false;
  const sortedOthers = others
    .filter(o => o !== candidate)
    .slice()
    .sort((a, b) =>
      (a.analyzer || '').localeCompare(b.analyzer || '') ||
      a.code.localeCompare(b.code) ||
      (a.range?.start?.line ?? 0) - (b.range?.start?.line ?? 0) ||
      (a.range?.start?.character ?? 0) - (b.range?.start?.character ?? 0));
  for (const other of sortedOthers) {
    if (other.analyzer === candidate.analyzer) continue;
    const otherSpec = specificity(other.code);
    if (otherSpec === -1) continue;
    if (otherSpec > candSpec && rangesOverlap(candidate, other)) {
      return true;
    }
  }
  return false;
}
```

**Verification command (after the fix):**

```bash
nohup env OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  node scripts/probes/noise-floor-10x.mjs \
  > /tmp/probes/noise-floor-10x-postfix.log 2>&1 &
disown
```

If post-fix finding-count range drops to ~5-8 (vs the current 16), the
post-processor nondeterminism was the dominant contributor and we've
recovered most of the legacy +6 floor.

### 2. **publish-correct-noise-floor-numbers** (severity: medium, ~30 min)

Blocked on (1). Once post-processor is fixed, remeasure and update
`docs/plan/LEARNINGS.md` to publish **both numbers** (severity-weighted
penalty range AND raw finding-count range). The legacy +6 was a penalty
total; the current +55 was a penalty total; the apples-to-apples
finding-count range is the user-facing number.

### 3. **measure-production-skill-noise-floor** (severity: high, ~30 min)

Extend E61 to support `scoreSamples=N`. Run 5 iterations on each of:
`quality-playbook`, `sql-optimization`, `audit-integrity`,
`structured-autonomy-plan`. **BLOCKED** on (1) — remeasure after the
post-processor fix so we don't bake nondeterminism into the published
production floor.

Command template:

```bash
SKILLS=quality-playbook,sql-optimization,audit-integrity,structured-autonomy-plan \
  SCORE_SAMPLES=5 \
  node scripts/e61-production-current-validation.mjs
```

(May require extending E61 to support `SCORE_SAMPLES` env — not yet implemented.)

### 4. **rederive-fixture-expected-counts** (severity: high, ~25 min)

Update `tests/fixtures/expected/*.json` using the dedup-discovery
artifact (probe A data). 5 of 15 fixtures covered by the
`10-38-51-009Z.json` artifact; 10 more to go. Use skip-post-process
median as the new expected value, with a notes field explaining the
expected count includes no dedup.

### 5. **cap-quality-playbook-findings-ux-decision** (severity: medium, ~0 min)

`quality-playbook` produces 31 findings on the new analyzer. Decide UX
before formal release: top-N by severity, group-by-category, or trust
the post-processor ranking. Currently no decision documented.

### 6. **LEARNINGS-restructure** (severity: low, ~2 hr)

Blocked on 1-5. The current 18-section 407-line doc has accreted
incident-style writeups alongside terse rules. The "Restructure + trim"
approach in the plan is the recommended path.

---

## Resume command sequence (after restart)

```bash
# 1) Sanity check
cd /workspace/skills-review-and-polish
git status --short | head -20
echo "---"
ls .github/experiments/documentation-review/data/ | grep "2026-07-17" | wc -l

# 2) Confirm tests still green
npx vitest run --config tests/vitest.config.ts 2>&1 | tail -6
npm run lint:md 2>&1 | tail -3

# 3) Pick up the deterministic-post-processor fix
#    Apply the 5-line patch in src/core/findingFilter.ts:605
#    (see "Open work items" #1 above)

# 4) Rerun the noise floor probe
nohup env OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  node scripts/probes/noise-floor-10x.mjs \
  > /tmp/probes/noise-floor-10x-postfix.log 2>&1 &
disown

# 5) If post-fix range < 8, dispatch the production-skill noise probe
#    (extend E61 to accept SCORE_SAMPLES env first if needed)
```

---

## Things to NOT do at restart

- **Do NOT update `PENALTY_NOISE_MARGIN`** from 6 to anything else until the
  production-skill probe lands. The +55 labeled-fixture number is a
  ceiling, not a floor, and we don't know the actual production floor.
- **Do NOT trust E61 numbers from a `SKILLS=foo,bar` invocation** until
  the `run-with-log.mjs` env-forwarding bug is fixed (artifact for the
  targeted run overwrote the default run's JSON).
- **Do NOT make the picker ⭐ for `qwen/qwen3-coder-30b-a3b-instruct`**
  again — that was the prior default and was reversed based on E56
  findings (5x fewer findings than gemini-flash).
- **Do NOT launch the e50-clean-architecture.mjs full 45-job run**
  without `FIXTURE_FILTER` set. The script no longer auto-detects that
  you wanted a small smoke; default is 15 fixtures × 3 runs = 45 jobs.
  Set `FIXTURE_FILTER='test-cognitive-structural'` etc. for smokes.

---

## Decisions made this turn (for audit)

1. **Default analyzer mode = schema-mode.** Validated at 5×3 with 87.3%
   recall, 63.3% precision, 1.38x over-report on 5 hard fixtures.
2. **Default model = `google/gemini-2.5-flash-lite`.** Picker ⭐ marked.
   Default deep = `deepseek/deepseek-chat-v3`. Picker ⭐ marked.
3. **Skip-post-process probe revealed stale expected counts.** The
   `crossWaveDedup` rule was hiding ~7.6pts of recall and ~10.2pts of
   precision across all fixtures.
4. **Post-processor nondeterminism is the dominant noise contributor.**
   16-finding variance on a 50-finding labeled fixture is mostly fixable
   by sorting `crossWaveDedupRule`'s iteration order.
5. **LEARNINGS restructure deferred** until E50/E61/noise-floor remeasurement
   produce stable baseline data.

---

## Key file paths to know

- Main plan: `docs/plan/20260716-release-readiness-remediation/plan.yaml`
- LEARNINGS: `docs/plan/LEARNINGS.md` (restructure deferred)
- Analyzer: `src/core/analyzer.ts` (whole-doc + reference-file inclusion)
- Provider interface: `src/core/types.ts:126` (`LlmProvider.getContextLength`)
- Post-processor rule to fix: `src/core/findingFilter.ts:605`
- Model catalog: `src/modelCatalog.ts` (three-tier resolution)
- E50 script: `scripts/e50-clean-architecture.mjs` (3 fixes landed)
- E61 script: `scripts/e61-production-current-validation.mjs` (needs `SCORE_SAMPLES` env)
- Probes: `scripts/probes/` (28 files, README explains tiers)
- Noise-floor probe: `scripts/probes/noise-floor-10x.mjs`
- Archived dead scripts: `.archive/scripts-2026-07-17-audit/`

---

*Resumed conversations should start by reading this handover, then
running the sanity check sequence above. **IMPORTANT correction after the
handover was first written:** the deterministic-post-processor fix did NOT
collapse the noise floor. A direct 10× comparison showed:

- schema-mode + deterministic dedup: penalty range 89, raw finding-count range 42, 9/10 successful
- off-mode + deterministic dedup: penalty range 46, raw finding-count range 21, 10/10 successful

So the dominant noise contributor is **schema-mode response-shape instability**
(non-stop finish reasons + salvageTruncatedJSON recoveries), not post-processor
ordering. The next session should treat **structured=off as the measurement
harness** and **structured=schema as the ship mode**, until schema-mode
response health is hardened.*
