# Learnings — carried over from the source project

> Hard-won lessons from building/tuning the analyzer + surgical fixer in
> `vscode-chat-customizations-evaluation`. Copied here so the new project keeps
> them even without access to saved memories. **Read before changing scoring,
> the fixer, or the analyzer prompts.**

## The single most important fact: the noise floor is ±6

- Scanning the SAME unchanged file 5× (gpt-4.1) gives penalties like 30/32/38/38/42. This is irreducible LLM variance even at temperature 0 / top_p 0.
- **Consequence:** a single before/after scan cannot reliably detect a fix worth < ~12 points. Do **not** chase small score gains — that's chasing randomness.
- Encoded as `PENALTY_NOISE_MARGIN = 6`. Keep/revert/converge only on changes beyond the margin.
- **The durable fix is median-of-N at the SCORING layer** (`medianTotalPenalty`, `SCORE_SAMPLES` default 3), not changing the model or prompt. It's model/prompt-agnostic and doesn't suppress detection. Keep/revert MUST run `SCORE_SAMPLES >= 3` (N=1 is only for cheap bulk scans).

## Model choice: gpt-4.1 stays as the analyzer

- **Claude Haiku 4.5 was tested and REJECTED**: noisier and its detection count is erratic (6→22 issues on the same file vs gpt-4.1's tight 10–12).
- A severity rubric prompt was tested and **NOT shipped** (recalibrated harsher without clearly cutting noise).
- For the extension, the equivalent is: let `vscode.lm` pick a strong Copilot model (e.g. gpt-4.1 family) for analysis; allow override via the model settings.

## Two systematic noise drivers were found and FIXED

1. **`coverage-gap` was the #1 noise driver** — open-ended gap brainstorming emitted a variable-length list each run. FIX (commit bd3615b): coverage prompt = HIGH-impact-only + one-gap-per-category cap. coverage-gap count range → 0 on all skills, **sensitivity preserved** (genuinely gappy skills still report many gaps deterministically).
2. **`llm-parse-error` root cause was a fence-regex bug, NOT truncation** (commit f2f7438). The `extractJSON` fence regex matched an INNER ```` ```python ```` example embedded inside a JSON string value. FIX: strip a code fence ONLY when it wraps the WHOLE response (anchored leading/trailing), never an inner fence. Applied in both `llm.ts` and `cli-analyzer.js`. Kept `max_tokens: 16384` + a `salvageTruncatedJSON` helper as harmless defense-in-depth.
   - **LESSON:** when `llm-parse-error` flickers, FIRST capture raw responses and check `finish_reason` before assuming truncation — fence/parse bugs look identical at the score layer.

## Per-prompt determinism gates DON'T work — rejected twice

- Adding "confidence gates" to the contradiction wave (Exp2) and ambiguity wave (Exp4) both **recalibrated harder or over-suppressed real signal** without cutting range. Conservation of difficulty. **Do not add more per-prompt confidence gates.** Use median-of-N instead.

## Surgical fixer: what's safe and what's not

- Per-diagnostic find-and-replace, `SURGICAL_FIXABLE_CODES` only. NOT whole-file rewrite.
- **Conservative wins:** 1.5× growth guard is empirically best; loosening to 2× regressed B-71→D-49. Also guard the 0.5× lower bound (a real bug deleted entire YAML frontmatter on a 786→140 "fix").
- **Always protect YAML frontmatter** — never let a fix touch name/description/keywords.
- **Anti-hallucination:** the system prompt must forbid inventing concrete values/names/URLs/versions (model invented fake `server1.example.com` otherwise).
- **Penalty-revert safety net** runs even on single-pass: measure penalty before/after, revert if worse beyond margin. The tool can never make a file worse — this was verified repeatedly (every penalty-raising pass reverted correctly).

## Fix QUALITY is the real bottleneck (detection is solved)

- Deletions (`hygiene-redundant-instruction`) are the reliably-positive fix (shrink text + remove issue).
- `ambiguity-llm` fixes ALWAYS expand the fragment (+20–40 chars) — making a vague qualifier concrete inherently adds words. On ambiguity-heavy skills with nothing to delete, cumulative inflation raises length/over-spec penalty → revert. Net flat.
- **Append-only ambiguity fixing is SAFETY, not YIELD.** Lifting the length cap did NOT convert expansion-rejects into applies — they moved to concept-swap/self-critique rejects. The length cap was a crude proxy for what the semantic guards catch properly. Append-only buys safety + a touch more consistency, not a yield breakthrough.

## Autonomous --apply is NOT production-safe without HITL

- Across 100 prod skills / 3 disjoint batches, the fixer's edits are overwhelmingly subtractive specificity-erosions the penalty model *rewards* but which are detrimental: numeric changes ("5-7 cases"→"5"), concept swaps ("edge cases"→"error cases"), dropped scope ("Scan ALL files"→"Scan files"), invented constraints, markdown structure corruption.
- Safe autonomous yield is only ~10–13% of skills; the rest need human review.
- **Therefore the extension MUST default to a human-in-the-loop fix UX** (diff/preview + per-edit accept), not silent auto-apply. This is a core product decision.

## The risk classifier + dropped-detail flag

- `classifyEditRisk` flags risky edits for HITL. The **dropped-detail flag** (net loss of meaningful content words, multiset counts, minus a filler allowlist) is the single biggest contributor — lifts gate coverage **68%→92%** with zero confirmed false negatives.
- Validate classifiers on a **disjoint batch** — the subtractive-deletion false-negative class only surfaced on batch 2.

## Three-layer fix safety architecture (proven)

1. **Mechanical guards** (deterministic): fence injection, line deletion, obligation-word drops, numeric change, concept swap.
2. **Heuristic filter** (pattern-based): skip the judge for safe cases, flag red flags. Should *reduce* judge calls, not prevent them.
3. **LLM judge** (semantic): validate flagged cases with a domain-aware prompt. Judge prompt wording matters hugely — "LEGITIMATE TIGHTENING?" → 20% rejection (usable); "preserve SAME meaning" → 100% rejection (useless). Obligation-preservation ≠ exact semantic equivalence.

## Determinism: pin params, rely on guards

- Pin temperature 0, top_p 0. The Copilot endpoint accepts `seed` but IGNORES it (hosted-MoE nondeterminism survives temp 0). Final on-disk output is byte-identical because the deterministic GUARDS make the accept/reject verdict reproducible — don't chase a "deterministic model." For reproducible generation you'd need a seed-capable endpoint (Azure/OpenAI direct).

## Wave architecture decision (benchmark)

- Wave **86% Jaccard** vs single-prompt **82%**; coverage detection 60% vs 33%. Cost ≈ 1.5–2× with prompt caching; parallel keeps latency comparable. **Keep multi-wave as the default.**

## Process learnings

- Always `npm run build && npm run lint` before testing.
- Fast unit-test harness (1s/test) beats full scans (15min) for iterating on the fixer/classifier — `test → improve → test` 1s cycle.
- A standalone analyzer test (no extension F5 reload) is the fastest debug loop.
- The POST-grade single-scan column is noisy and misleading on reverted runs — trust the median-of-3 penalty transitions, always diff the actual file bytes.
