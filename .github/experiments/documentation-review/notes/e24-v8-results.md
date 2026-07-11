# E24 — v8 documentation-review skill iteration

**Date:** 2026-07-11
**Status:** Complete — contradiction cluster fully resolved
**Cost:** 2 LLM calls (initial + post-fix re-run) on Gemini 2.5 Flash Lite. ~$0.01. ~10s each.
**Driver:** E22 surfaced 5 contradiction findings on v7 in the D8 (Modification definition) vs C2/C3/C4 (Constraints) and D9.3 vs D9.4 (Precedence) areas.

## TL;DR

v8 of the documentation-review skill **eliminates all 5 contradiction findings from v7** and reduces total findings from 33 to 8 (a 76% reduction). The fix targeted the specific contradiction cluster E22 surfaced: a structural issue in how D8 (Modification) related to C2 (no strengthen) and C3 (no weaken), and how D9 (Precedence) step 3 related to step 4 (the vacuous-constraint exception).

## v7 → v8 changes

### Fix 1: D8 (Modification) — removed the duplicate property enumeration

**v7 (problem):** D8's Factual Fix entry enumerated "must not change meaning/intent/scope" as SHAPE constraints. C2 ("no strengthen") and C3 ("no weaken") also defined those same properties as CONSTRAINTS. The LLM read this as overlapping/conflicting rules.

**v8 (fix):** D8's Factual Fix entry now references C2 and C3 instead of redefining their terms:
- Factual Fix: "changes only the words used to express a fact... A Factual Fix that strengthens a claim (Constraint C2) or weakens a claim (Constraint C3) is NOT a Factual Fix; see C2 and C3 for the precise definitions of 'strengthen' and 'weaken' in terms of meaning, intent, and scope."

A new "Relationship to Constraints" subsection explicitly states: "D8 defines the SHAPE of a permitted Modification. Satisfying the shape constraints above is NECESSARY but not SUFFICIENT: every Modification must ALSO satisfy all five Constraints."

### Fix 2: D8 (Modification) — removed "Stylistic Rewrite" from the positive enumeration

**v7 (problem):** D8 listed "Stylistic Rewrite" as a fourth Modification type, then said it was forbidden. C4 separately forbade it. The LLM read this as: "D8 says one type is forbidden → D8 contradicts itself."

**v8 (fix):** Only 3 types are listed in the bullet enumeration (Factual Fix, Clarification, Deletion). A new "Stylistic Rewrites (forbidden)" subsection explicitly states: "A Modification made solely to improve prose style, tone, formatting, or word choice while preserving meaning is a Stylistic Rewrite and is forbidden by Constraint C4. A Stylistic Rewrite is NOT a permitted Modification type — it is listed here only to name what C4 prohibits."

### Fix 3: D9 (Precedence) — clarified step 3 vs step 4 relationship

**v7 (problem):** D9.3 said "When R1=TRUE, produce a Modification that satisfies all Constraints." D9.4 said "When R1=TRUE but every candidate would violate a Constraint, leave unchanged." The LLM read "produce a Modification" vs "leave unchanged" as a direct contradiction.

**v8 (fix):** D9.3 rephrased to "search for a permitted Modification... if at least one permitted Modification exists, apply the minimum one." D9.4 relabeled as "Search-empty case" and rephrased: "If the search in step 3 finds no permitted Modification, apply the formal fallback: leave the affected statement unchanged and report it as Unverifiable. Step 4 is reached ONLY when step 3's search space is empty — it is the formal completion of step 3, not a contradictory alternative."

Also: R1's "When VD=TRUE: Apply a permitted Modification" branch updated to acknowledge the D9.4 fallback: "...If no permitted Modification exists (per D9.4, the vacuous-constraint case), leave the affected statement unchanged and report it as Unverifiable instead of producing a forbidden Modification."

## Results

| Metric | v7 (E22) | v8 (E24) | Change |
| --- | ---: | ---: | ---: |
| Total findings | 33 | 8 | -76% |
| Contradiction | 5 (2+3) | 0 | -100% |
| Ambiguity (`ambiguity-llm`) | 13 | 3 | -77% |
| Hygiene (all) | 13 | 0 | -100% |
| Coverage-gap | 1 | 5 | +400% |
| Persona | 1 | 0 | -100% |
| Wall-clock | 9.7s | 5.5s | -43% |

### Per-finding comparison

The 8 v8 findings:
- 3 `ambiguity-llm` — minor wording in the new D8 prose (acceptable, the new text is denser)
- 5 `coverage-gap` — new findings: D8 now REFERENCES C1, C2, C3, C4 instead of duplicating them, so the analyzer flags that those references need to be present (they are, but the LLM still flags the reference pattern as a coverage check)

### Grade impact

v7 B- (under-counted E11 baseline) → v8 with focused multiWave: the grade would now be in the A range (8 findings × ~2 pts = 16-pt penalty, well within the B/A boundary). A re-grade run is needed to confirm the exact score, but the qualitative direction is unambiguous: v8 is materially better than v7.

## Files

- `.github/experiments/documentation-review/versions/v8/SKILL.md` (new — 497 lines, +3 lines from v7)
- `scripts/e24-v8-focused.mjs` (new)
- `.github/experiments/documentation-review/data/e24-v8-focused-2026-07-11T07-18-14-903Z.json`
- `.github/experiments/documentation-review/logs/e24-v8-focused-2026-07-11T07-18-14-903Z.log`

## Recommendation

Adopt v8 as the canonical documentation-review skill. The 3 remaining `ambiguity-llm` findings are about the new "Relationship to Constraints" prose, which is the prose that fixed the contradictions. Tightening it further would risk re-introducing the contradictions. The 5 `coverage-gap` findings are false positives in the sense that the references ARE present in the document; the LLM is just verifying the reference pattern, not the content.

**Next iteration (v9) candidates** (low priority — only 8 findings, mostly minor):
1. The "Relationship to Constraints" paragraph in D8 could be moved to a footnote to reduce ambiguity
2. The 5 coverage-gap findings might be eliminated by adding the cross-reference verification back to the coverage wave (currently the analyzer only checks for the existence of referenced terms, not whether the relationship is bidirectional)
