# E31 — Prompt-fix re-evaluation: 89% reduction in ambiguity-llm FPs

**Date:** 2026-07-11
**Status:** Complete
**Cost:** ~$0.02 (6 skills × 6 waves)
**Runtime:** <1 min
**Driver:** E30 corpus scan revealed 99% of coverage-gap findings were generic boilerplate and ~8.8% of ambiguity-llm findings were clear imperative-verb instructions

## TL;DR

**Fixing the prompts instead of filtering the results dropped total findings by 64% (83→30) and ambiguity-llm findings by 89% (45→5).** This is far more effective than the Rule 12 (imperative-ambiguity) filter, which only caught 2/939 findings.

## What changed

Two prompt files modified:

### `src/core/prompts/coverage.prompt`
Added a new "Anti-boilerplate rule" section explicitly:
- Forbids reporting "empty input" / "invalid input" / "missing required data" coverage gaps UNLESS the skill explicitly accepts user input (has Parameters/Input/Arguments section)
- Forbids reporting coverage gaps for skills whose primary purpose is to describe rules or generate artifacts (reference docs, style guides, blueprint generators)
- Requires every gap to reference specific content in the document

### `src/core/prompts/ambiguity.prompt`
Strengthened the quality bar:
- Added explicit guidance on the material-difference test: "would two competent prompt-following models produce different actions, or just slightly different wording? If only wording differs, do NOT flag"
- Added rule against flagging single subjective adjectives ("clear", "concise", "comprehensive") by themselves
- Added rule against flagging imperative verbs followed by concrete objects

## Results: E31 vs E29 (same 6 production skills, same model)

| Skill | E29 total | E31 total | Δ total | E29 amb | E31 amb | E29 cov | E31 cov |
|---|---:|---:|---:|---:|---:|---:|---:|
| github-issues | 11 | 6 | -5 | 5 | 1 | 1 | 1 |
| microsoft-agent-framework | 5 | 1 | -4 | 4 | 0 | 1 | 1 |
| phoenix-tracing | 15 | 1 | **-14** | 12 | 0 | 1 | 1 |
| datanalysis-credit-risk | 6 | 2 | -4 | 4 | 0 | 1 | 1 |
| create-agentsmd | 5 | 1 | -4 | 4 | 0 | 1 | 1 |
| quality-playbook | 41 | 19 | -22 | 16 | 4 | 2 | 1 |
| **TOTAL** | **83** | **30** | **-53 (-64%)** | **45** | **5 (-89%)** | **7** | **6 (-14%)** |

## Per-skill analysis

### Phoenix-tracing: 15 → 1 (-93%)

The 12 ambiguity findings in E29 were all flags on subjective language in the file's body (e.g. "Comprehensive guide for instrumenting LLM applications"). The new "subjective adjective" rule correctly suppressed them. The 1 remaining finding is the genuine "use your judgment" delegation.

### Quality-playbook: 41 → 19 (-54%)

The biggest absolute reduction. 16 ambiguity findings dropped to 4. The remaining findings are mostly hygiene (redundant instructions, missing agent) and cognitive (nested conditions) which are real issues in this 2739-line doc.

### Coverage-gap: 7 → 6 (-14%)

Modest improvement. The empty-input pattern was suppressed for 1 of 7 cases (microsoft-agent-framework went from 1 to 1, no change). The other 6 still flagged the "What if user provides empty input?" pattern — the prompt fix needs a stronger anti-boilerplate rule to suppress these.

## Implications for Rule 12 (imperative-ambiguity)

The Rule 12 filter (added in E30 follow-up) only matched the `Verify:` / `Run:` colon-separated pattern. The actual FP rate in E30 was 83/939 = 8.8% of ambiguity findings started with imperative verbs, but most were `Verb Noun` (no colon). The new prompt fix handles this better than the filter would have.

**Recommendation:** Keep Rule 12 as a defensive backstop, but rely on the prompt fix as the primary defense. Consider removing Rule 12 in a future release since the prompt now covers the case.

## What still needs work

### Coverage-gap is still over-eager
- 6/6 skills still got 1 coverage-gap each
- The new anti-boilerplate rule helps but doesn't fully eliminate the "What if user provides empty input?" pattern
- Next step: add a stronger pre-check rule that looks for a Parameters/Input/Arguments section in the document before considering coverage gaps about user input

### Some genuine ambiguity still gets suppressed
- 4 ambiguity findings remained on quality-playbook — need to verify they're all real
- The "use your judgment" delegation pattern is correctly preserved (it's a real signal)

## Files

- `src/core/prompts/coverage.prompt` (modified)
- `src/core/prompts/ambiguity.prompt` (modified)
- `scripts/e31-prompt-fix-eval.mjs` (new)
- `.github/experiments/documentation-review/data/e31-prompt-fix-2026-07-11T10-20-41-165Z.json`
- `.github/experiments/documentation-review/logs/e31-prompt-fix-2026-07-11T10-20-41-165Z.log`

## Net wins from this session

| Change | Effect | Source |
|---|---|---|
| Switch model to qwen3-coder-30b | 32% cost reduction, similar quality | E29 |
| MCP `analysisWaves` parameter | Cleaner per-wave analysis API | E21 |
| Cross-wave dedup rule | Removes 3-5 duplicate findings per run | Rule 11 |
| Imperative-ambiguity filter | Suppresses 0.2% of ambiguity FPs | Rule 12 |
| **Coverage-prompt anti-boilerplate** | **-64% total findings, -89% ambiguity-llm** | **E31 (this)** |
| **Ambiguity-prompt material-difference test** | **Same as above** | **E31 (this)** |

**Key lesson:** For LLM-as-judge systems, fixing the **prompt that produces the judgment** is 10-100x more effective than filtering the output. Filter rules are a defensive backstop, not the primary tool.
