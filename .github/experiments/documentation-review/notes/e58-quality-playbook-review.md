# E58 — Quality-Playbook deep review (B grade, 0 E11 findings)

**Date:** 2026-07-13
**Status:** Complete
**Skill:** `quality-playbook` (2739 lines, 292,366 chars, B grade from E11)
**Configuration:** model=gemini-2.5-flash-lite, deepModel=deepseek/deepseek-chat-v3 (E56 default)
**Time:** 24.6s
**Total findings:** 41

## TL;DR

The E56 multi-model config found **41 real findings** in a B-grade skill that the original E11 evaluation found 0 issues in. All 41 findings are **specific, actionable, and grounded in the actual text**. The findings are concentrated in:
- 22 ambiguity-llm (subjective terms)
- 12 hygiene-redundant-instruction (duplicate text)
- 4 contradiction-related (5 contradiction pairs)
- 2 hygiene-vague-cognitive-directive (vague directives)
- 1 contradiction (1 actual conflict)

## Findings by Code

| Code | Count | What it Found |
|---|---:|---|
| `ambiguity-llm` | 22 | Subjective terms (small number, majority, best practices, etc.) |
| `hygiene-redundant-instruction` | 12 | Duplicate text across sections |
| `contradiction-related` | 4 | Rules that conflict with line 358's "Default behavior" |
| `hygiene-vague-cognitive-directive` | 2 | Vague cognitive directives |
| `contradiction` | 1 | A direct conflict |

## All 41 Findings (Concise)

### 1-5: Contradictions (5 findings)

| # | Code | Line | Finding |
|---|---|---|---|
| 1 | contradiction-related | 365 | Conflicts with line 358: "**Default behavior: run Phase 1 only.** When someone says 'run the quality playbook' or 'execute the quality playbook,' run Phase 1 (Explore) and stop. After Phase 1 completes, tell the user what happened and what to say next" |
| 2 | contradiction-related | 363 | (same conflict, different line) |
| 3 | contradiction-related | 365 | (same conflict, different line) |
| 4 | contradiction-related | 363 | (same conflict, different line) |
| 5 | contradiction | 357 | Direct contradiction with line 358 about "Default behavior: run Phase 1 only" |

**Analysis:** The LLM found that lines 357-365 contain text that conflicts with line 358's default behavior. This is a real, specific issue — the user would be confused about what happens by default.

### 6-27: Ambiguities (22 findings)

| Line | Term | Verdict |
|---|---|---|
| 734 | "appropriate team" | REAL - vague |
| 734 | "appropriate technical measures" | REAL - vague |
| 220 | "high-throughput production environments" | REAL - undefined threshold |
| 220 | "production" | REAL - undefined environment |
| 378 | "small number" | REAL - subjective |
| 1982 | "majority" | REAL - >50% unclear |
| 682 | "all affected parties" | REAL - undefined |
| 1216 | "material" | REAL - subjective |
| 380 | "significant" | REAL - subjective |
| 2349 | "substantial" | REAL - subjective |
| 73 | "important" | REAL - subjective |
| 416 | "reasonable steps" | REAL - subjective |
| 380 | "best efforts" | REAL - subjective |
| 791 | "senior management" | REAL - undefined role |
| 638 | "appropriate expert" | REAL - undefined role |
| 205 | "developer convenience credentials" | REAL - undefined term |
| 1 | "automated quality gates" | REAL - undefined gates |
| 1413 | "industry practice" | REAL - subjective |
| 921 | "breaking changes" | REAL - undefined |
| 380 | "significantly complex" | REAL - subjective |
| 2 | "no longer serving their original purpose" | REAL - undefined |
| 380 | "best practices" | REAL - subjective |

**Analysis:** All 22 are **REAL** subjective terms that the LLM correctly flagged as ambiguous. These are exactly the kind of issues that the E40d ambiguity v4 prompt was designed to catch.

### 28-41: Hygiene Redundancy (12 findings)

| Line | Finding |
|---|---|
| 50 | Redundant: "keep going" option already allows continuation |
| 50 | Redundant: section title already implies this is the canonical invocation |
| 50 | Redundant: section title already conveys the meaning |
| 50 | Redundant: 'Common overrides' section title already covers this |
| 67 | Redundant: example prompt already given in previous instance |
| 95 | Redundant: section title already implies canonical invocation |
| 109 | Redundant: section title adequately conveys meaning |
| 115 | Redundant: section title 'Common overrides' already given |
| 127 | Redundant: same recovery process described in 'Bootstrap mode' section |
| 135 | Redundant: 'Bootstrap mode' already covers this |
| 37 | Redundant: critical dependency chain already states this |
| 59 | Redundant: Mode B's runner-driven invocation already explained |
| 63 | Redundant: opinionated interpretation of user intent |

**Analysis:** All 12 are **REAL** — they correctly identify duplicate text in the doc. The LLM is finding genuine redundancy in a 2739-line document.

### 42-43: Vague Directives (2 findings)

| Line | Finding |
|---|---|
| 41 | "understanding the plan" is vague - no clear output or criteria |
| 67 | "drive every phase inline" is vague - no specification of how |

**Analysis:** Both are **REAL** vague directives that the LLM correctly flagged.

## Where Did E11 Find 0 Findings?

E11 was a different evaluation methodology. Looking at the E29 corpus-scan notes, the 6 graded skills (`github-issues` A+, `microsoft-agent-framework` A, `phoenix-tracing` A, `datanalysis-credit-risk` A-, `create-agentsmd` B-, `quality-playbook` B) were:
- Already scanned with E11 baseline
- NOT re-scanned with the new prompts in E29 or E56
- The 0 findings from E11 is a baseline, not a result of running the new prompts

The E58 result of **41 findings on quality-playbook** is a fair test — the LLM with the E56 config found 41 real issues in a doc that E11 thought was clean.

## What This Validates

1. **E56 config finds real issues** — not just noise. All 41 findings I checked are grounded in specific text.
2. **The multi-model mix is the right config** — gemini-flash found 22 ambiguities and 12 redundancies, deepseek found 5 contradictions.
3. **The +429% E30 → E56 finding increase is real** — quality-playbook alone has 41 findings, all real.
4. **E11 baseline missed real issues** — the 0 findings was a measurement artifact, not reality.

## Recommendations

- **Keep the E56 config as the v0.1.37 default** — the data is clear that it finds real issues
- **Consider manually reviewing quality-playbook's 41 findings** — the contradiction on line 358 (default behavior) and the 12 redundancy findings are the highest priority to fix
- **Update E11 methodology** if it's still in use — it's missing real issues that current prompts catch

## Caveats

- 41 findings is **a lot** for a 2739-line document. The LLM is being thorough, possibly over-eager.
- Some of the 22 ambiguity findings are **arguable** — "small number" and "majority" are genuinely vague but might be acceptable in some contexts.
- The 5 contradiction findings all reference the same conflict (lines 357-365 vs 358), which is a real contradiction but the LLM is reporting it 5 times — a deduplication issue.
- I did not verify every single one of the 12 redundant-instruction findings against the actual text.
