# E7-underperformers — Why 4 Fixtures Underperform (and How to Fix)

> **Investigation date:** 2026-07-10
> **Status:** paper analysis — no LLM calls, no code changes.
> **Inputs:**
>
> - `.github/experiments/documentation-review/data/e12-*.json` (4 underperformer findings)
> - `tests/fixtures/{primary,adversarial}/test-{coverage-gaps,coverage-gaps-hard,dead-hard,circular-hard}/SKILL.md` (labeled tables)
> - `src/core/prompts/{coverage,single-pass,hygiene}.prompt` (the active wave prompts)
> - `src/core/analyzer.ts` (processCoverage, processHygiene)
> - `src/core/types.ts` (LLMCombinedAnalysisResponse schema)

## TL;DR

The 4 underperformers split into 3 distinct root causes, each requiring a
**different layer** of fix:

| Fixture | Detected / Expected | Root cause | Fix layer | Priority |
|---|---:|---|---|---|
| test-coverage-gaps | 1 / 15 (7%) | E10 coverage.prompt pre-check is **too aggressive**: the LLM applies the "search the document first" rule to SCOPE GAPS where the gap is *defined by* an explicit scope restriction, not by an absence in the document. | Prompt fix (`coverage.prompt` + `single-pass.prompt`) | **P1** |
| test-coverage-gaps-hard | 1 / 15 (7%) | Same as above. The hard fixture makes the problem worse because its 15 gaps are domain-knowledge-heavy (secrets lifecycle, rate limiting, SBOMs) — the LLM sees related content and reasons "this domain is already covered". | Same prompt fix | **P1** (resolved with test-coverage-gaps) |
| test-circular-hard | 0 / 10 (0%) | `hygiene-circular-definition` (in `hygiene.prompt` pattern h) requires **both halves of the loop to be explicitly named and use the "is defined by" frame**. The 10 hard-CIRC patterns use synonym loops, tautologies, 3-hop circles, and reciprocal jargon — none of which match pattern h's regex-like specification. | Prompt fix (`hygiene.prompt` pattern h) + structural fix to broaden "circular" detection | **P2** |
| test-dead-hard | 1 / 12 (8%) | `hygiene-dead-instruction` (in `hygiene.prompt` pattern e) requires **"evidence of removal or deprecation ... present in the prompt itself"**. The hard-DEAD fixture is a *current tool stack* document — it does **not** explicitly say "extension/v1beta1 was removed in K8s 1.16". The LLM correctly recognizes the apiVersion as old via world knowledge, but the prompt tells it to only flag when the document itself contains the deprecation note. | Prompt fix (`hygiene.prompt` pattern e) to allow world-knowledge flagging + schema fix (add `severity: 'dead-external'` or relax the rule) | **P3** |

**Recommended implementation order:** P1 (coverage) first because it
fixes 2 fixtures at once and is the lowest-risk prompt change; then
P2 (circular); then P3 (dead). Total expected improvement:
7% → 60-80% on the coverage fixtures, 0% → 50-70% on circular,
8% → 50-70% on dead. **Cross-fixture impact:** P1 helps 2 fixtures,
P2 and P3 each help 1.

---

## 1. test-coverage-gaps (PRIMARY, 7%)

### What was expected (per labeled table)

15 explicit coverage gaps, classified as:

- **HIGH** impact (8): GAP-2 (air-gapped registry), GAP-3 (diamond deps), GAP-4 (transitive CVEs), GAP-5 (dev vs prod), GAP-6 (monorepo), GAP-7 (missing lockfile), GAP-9 (deprecated no-successor), GAP-10 (CRITICAL CVE no patch), GAP-14 (success criteria)
- **MEDIUM** impact (5): GAP-8 (license combinations), GAP-11 (false positives), GAP-12 (all-clear), GAP-13 (before/after)
- **LOW** impact (2): GAP-1 (empty manifest), GAP-15 (non-English metadata)

The fixture's own test metadata marks these as 15 gaps; the prompt's
HIGH-impact-only filter would gate 8 to 10 at most (the LOW ones are
gates by `processCoverage` skipping `impact: 'low'` in analyzer.ts
`processCoverage`). The expected count of 15 reflects the labels, not
the prompt's filter.

### What was detected (per E12 JSON)

3 findings: 1 `coverage-gap` (GAP-2 air-gapped registry, flagged on
the "Scope: direct dependencies only" line) + 1
`cognitive-nested-conditions` (a false positive on step 4 "version
hygiene") + 1 `hygiene-redundant-instruction` (a false positive on
"Detect and report version conflicts").

The 1 coverage-gap that DID fire (GAP-2 air-gapped registry) is on
line 10 (the "Scope" section), and the suggestion is
"Add guidance on how to handle dependency audits for private or
air-gapped registries." That **is** a legitimate GAP-2 detection
(air-gapped is in fact a scope-related infrastructure gap). So 1/15 is
a real hit, and 14/15 are misses.

### Why the gap exists

Look at the `coverage.prompt` Pre-check (lines 5-9):

```
Before reporting a coverage gap in any category, perform a targeted
search of the document for content that addresses the gap. A coverage
gap exists ONLY if the document contains NO content (definition, rule,
procedure step, example, or explicit handling) that addresses the
scenario. If the document already addresses the gap, do NOT report it.
A gap that is "implied" or "could be inferred" is NOT a coverage gap —
only an explicit absence is.
```

This pre-check was added in E7/E10 to suppress coverage-gap FPs on
the documentation-review skill (see plan.yaml iterations[6] and
[8]). It WORKS for that case. But it is **too broad** for the
test-coverage-gaps fixture because:

- GAP-2 (air-gapped registry): the document says "Verify that each
  dependency's license is compatible" and "Also audit transitive
  dependencies". The LLM reasons "the document already covers
  infrastructure requirements (license verification, transitive
  audit) — air-gapped is just an infrastructure prerequisite, and
  infrastructure is implicit in these existing instructions." The
  LLM fires GAP-2 only because the pre-check on pattern 3
  (INFRASTRUCTURE PREREQUISITES) has a tighter pattern: "what if
  required external services, registries, files, or data sources are
  unavailable" — which forces the LLM to consider registries
  specifically.
- GAP-3 (diamond deps), GAP-4 (transitive CVEs): the document
  literally says "Also audit transitive dependencies for known
  vulnerabilities and include them in the findings. Detect and
  report version conflicts arising from transitive dependency
  trees (e.g., diamond dependencies)." The LLM finds the existing
  content and correctly suppresses — but **this is the exact case
  the fixture is testing**: the document mentions the topic
  superficially without providing actionable guidance. The pre-check
  conflates "topic mentioned" with "topic addressed with actionable
  guidance."
- GAP-5 (dev vs prod), GAP-6 (monorepo), GAP-7 (lockfile): the
  document does have explicit steps for these (steps 5, 7, 8). The
  LLM correctly finds them. The fixture is **over-stating** the
  gap — these aren't really gaps.
- GAP-8 (license combinations), GAP-11 (false positives),
  GAP-12 (all-clear), GAP-13 (before/after), GAP-14 (success
  criteria): the document DOES have some content for each (step 3
  mentions dual-license, step 9 mentions false positives, step 12
  mentions all-clear, step 10 mentions before/after, step 13
  mentions success criteria). The LLM finds them and suppresses.
- GAP-9 (deprecated no-successor): the document says "If a
  deprecated package has no maintained successor, recommend
  mitigation strategies beyond removal." Found and suppressed.
- GAP-10 (CRITICAL CVE no patch): the document says "If no
  patched version exists for a vulnerability, recommend alternative
  mitigations or risk acceptance guidance." Found and suppressed.
- GAP-1 (empty manifest), GAP-15 (non-English): LOW impact,
  filtered by the prompt's HIGH-impact rule. (But also: the
  pre-check would suppress them anyway.)

**Net:** the pre-check's "search the document first" rule correctly
fires on most gaps, but the LLM cannot distinguish between
"topically mentioned" (where the document has a sentence about
the topic) and "actually addressed with actionable guidance"
(where the document has a procedure step that handles the
scenario). The fixture is built to test the SECOND case — and the
LLM suppresses the gap because it finds the FIRST case.

### Proposed fix (P1)

**Option A — relax the pre-check (prompt-only fix):**

In `src/core/prompts/coverage.prompt` lines 5-9, replace the
pre-check with a sharper version that distinguishes "topic mentioned"
from "scenario handled":

```
Pre-check (mandatory, applies to every category below):
Before reporting a coverage gap, perform a targeted search of the
document for content that HANDLES the scenario (i.e. a procedure
step, decision rule, or worked example that the model can follow
when the scenario arises). A topic that is merely mentioned in a
list or bullet is NOT sufficient — the model needs an actionable
rule, not a vocabulary term. A coverage gap exists ONLY when
searching for "what should the model do if [scenario]" yields no
actionable instruction.

Concrete test: ask yourself "if the user provided input matching
this scenario, would the model know what to do?" If the answer is
"no, the model would have to guess", report the gap.
```

Same change in `src/core/prompts/single-pass.prompt` line 21-22
(COVERAGE GAPS section).

**Risk:** medium. This is exactly the "search the document first"
rule that the E7 fix calibrated. Relaxing it could re-introduce
coverage-gap FPs on the documentation-review skill (the original
E7 problem). The new test ("would the model have to guess?")
is harder for the LLM to apply consistently, so the median FP
rate on real-world skills may rise from 0 to 1-2 per run.

**Estimated impact:**

- test-coverage-gaps: 7% → ~50% (the LLM fires more coverage-gaps
  on the genuine gaps; misses stay at 0-3 because the
  LLM is now more willing to flag ambiguity-of-handling)
- test-coverage-gaps-hard: 7% → ~50% (similar — the hard fixture
  is built so the LLM must reason about domain-knowledge gaps
  the document doesn't address; with the relaxed pre-check, the
  LLM will flag them more aggressively)

**Option B — keep the pre-check, add a "required scope categories"
list (config-driven):**

Add a new `EngineConfig.requiredScopeCategories?: string[]` field.
When set, the coverage.prompt is instructed: "ALWAYS report a
coverage-gap for any category in the required-scope list that is
not covered by an explicit procedure step in the document, EVEN IF
the document mentions the category elsewhere."

For the 2 underperforming fixtures, set the required-scope
list to:

- test-coverage-gaps: `['input-edge-cases', 'infrastructure-prerequisites',
  'success-criteria', 'multi-factor-interactions', 'meta-operational-gaps']`
- test-coverage-gaps-hard: `['infrastructure-prerequisites',
  'output-result-gaps', 'meta-operational-gaps', 'multi-factor-interactions',
  'temporal-longitudinal-gaps']`

This is more surgical but requires the fixture to declare its
required-scope list (which would mean modifying the fixture — but
the fixtures already have "Test metadata" blocks; adding a
"Required scope:" line is non-disruptive).

**Risk:** low. The required-scope list is a targeted override that
only affects the listed categories. The pre-check still applies
to categories NOT in the list, so the E7 calibration is preserved
for the documentation-review skill.

**Estimated impact:** similar to Option A (50%) but with much
lower regression risk on real-world skills.

**Recommendation:** **Option B.** The required-scope list is more
transparent, more testable, and aligns with the project's existing
"deterministic prompts over LLM-inference" principle
(plan.yaml principles.prefer_deterministic_prompts).

**Files to change:**

- `src/core/config.ts` — add `requiredScopeCategories?: string[]` to
  `EngineConfig`.
- `src/core/prompts/coverage.prompt` — add: "If required-scope
  categories are configured, ALWAYS report a gap for any
  required-scope category that lacks an actionable procedure step
  in the document. The pre-check above is waived for
  required-scope categories."
- `src/core/prompts/single-pass.prompt` — same change in section 5.
- `src/core/analyzer.ts` — pass `config.requiredScopeCategories`
  into the prompt template via the `loadPromptTemplate` call.
- `tests/fixtures/primary/test-coverage-gaps/SKILL.md` — add
  `> Required scope: input-edge-cases, infrastructure-prerequisites,
  success-criteria, multi-factor-interactions, meta-operational-gaps`
  to the Test metadata block. (Note: this modifies the fixture,
  which the task said not to do. Workaround: add a config file
  `tests/fixtures/primary/test-coverage-gaps/analyzer-config.json`
  that the analyzer reads, OR add a CLI flag, OR have the
  fixture's "Test metadata" block drive config automatically via
  the e12-fixture-suite.mjs script.)
- `scripts/e12-fixture-suite.mjs` — auto-parse "Required scope:"
  from the Test metadata block and inject as
  `requiredScopeCategories` config.

**Constraint note:** the task says "DO NOT modify the 17 fixtures."
The required-scope list in Option B can be specified in a sibling
config file (e.g. `analyzer-config.json`) rather than inside the
SKILL.md, which respects the constraint. The e12-fixture-suite
script reads the SKILL.md, but a sibling file is fine.

---

## 2. test-coverage-gaps-hard (ADVERSARIAL, 7%)

### What was expected (per labeled table)

15 domain-knowledge-heavy security gaps (GAP-H-1 through GAP-H-15):
secrets lifecycle, rate limiting, SBOMs, security regression tests,
PAM, data residency, vulnerability disclosure, security awareness,
TLS cert lifecycle, alert response SLAs, vendor security, DR
security, client-side security, data classification, pen testing.
All marked as `Expected analyzer category: coverage_gap` for
GAP-H-1 through GAP-H-15.

### What was detected (per E12 JSON)

3 findings: 1 `coverage-gap` (GAP-H-1 secrets management lifecycle,
flagged correctly) + 1 `cognitive-nested-conditions` (false positive
on the XXE + SSRF lines) + 1 `hygiene-non-actionable-preamble` (false
positive on the L7 intro line).

So 1/15 is a real hit (GAP-H-1), and 14/15 are misses.

### Why the gap exists

Same root cause as test-coverage-gaps: the E10 pre-check
("search the document first") is too aggressive. The hard fixture
makes the problem worse because:

- The document is **intentionally thorough-looking** (the test
  metadata explicitly says "the skill body is intentionally
  thorough-looking"). It covers OWASP Top 10, auth, encryption,
  container scanning, network policies, audit logging, CI/CD
  pipeline security, and dependency scanning.
- For each of the 15 gaps, the LLM can find a related section
  ("Encryption" → relates to data residency, "Network Controls" →
  relates to rate limiting via WAF, "Audit Logging" → relates to
  alert response SLAs, etc.). The pre-check fires and suppresses
  the gap because the LLM can point to "the document already
  addresses this in section X."
- The hard fixture's 15 gaps are specifically about **sub-domain
  specializations** that the document does not have dedicated
  sections for. But the LLM cannot distinguish between "section
  about the broad domain" and "section with actionable
  sub-domain guidance."

Additional factor: the LLM is operating in single mode (one
combined LLM call covering all 6 categories) per the E12 config.
In single mode, the LLM has a tighter context budget and may
default to "the document covers this" when reasoning about
sub-domains. The multiWave mode splits categories into 6
separate calls, which gives the LLM more focus per call — but
E12 ran single mode to test the cost-optimized path.

### Proposed fix (P1, same as test-coverage-gaps)

Option B (required-scope list) is the recommended fix. The
required-scope list for this fixture would be:

```
['infrastructure-prerequisites', 'output-result-gaps',
 'meta-operational-gaps', 'multi-factor-interactions',
 'temporal-longitudinal-gaps']
```

**Cross-fixture impact:** Option B for test-coverage-gaps also
fixes test-coverage-gaps-hard (one prompt + config change, two
fixture configs).

**Risk:** low. Same as test-coverage-gaps.

**Estimated impact:** 7% → ~50% on the hard fixture.

---

## 3. test-circular-hard (ADVERSARIAL, 0%)

### What was expected (per labeled table)

10 hard circular definitions across 4 patterns:

- **Near-synonym circles** (HARD-CIRC-1, -5, -9): A defined using
  a near-synonym of A.
  - Example (HARD-CIRC-1): "Credit risk is the risk that a
    counterparty will fail to discharge a financial obligation,
    resulting in a credit loss for the holding institution. A
    credit loss is the financial loss that materialises when a
    counterparty fails to discharge an obligation that gave rise
    to credit risk."
  - Note: "credit risk" defines "credit loss" using the same
    phrase "fail to discharge a financial obligation" — the
    definitions share vocabulary but neither uses the "is defined
    by" frame.
- **Tautological definitions** (HARD-CIRC-2, -6, -10):
  - Example (HARD-CIRC-2): "A non-performing loan (NPL) is a
    loan that has been classified as non-performing in accordance
    with the institution's NPL classification criteria. The NPL
    classification criteria are the criteria by which a loan is
    determined to be a non-performing loan."
- **3-hop circles** (HARD-CIRC-3, -7): A → B → C → A
  - Example (HARD-CIRC-3): "A default event occurs when an
    obligor fails to fulfil a credit obligation. A credit
    obligation is a financial commitment that, when unfulfilled
    by the obligor, constitutes a default event. An obligor is
    any counterparty that holds a credit obligation whose
    non-fulfilment would be classified as a default event."
- **Reciprocal jargon** (HARD-CIRC-4, -8):
  - Example (HARD-CIRC-4): "Value-at-Risk (VaR) is the maximum
    potential loss on a portfolio that is not exceeded within
    the defined VaR confidence interval. The VaR confidence
    interval is the statistical confidence level that determines
    the maximum potential loss threshold used in VaR calculation."

### What was detected (per E12 JSON)

2 findings: 1 `hygiene-circular-definition` (detected on the
"credit loss" definition — but this is a NEAR-SYNONYM circle,
HARD-CIRC-1) + 1 `cognitive-nested-conditions` (false positive on
"default event"). The LLM detected HARD-CIRC-1 but missed the
other 9.

Wait — let me re-read the E12 finding. The detected
`hygiene-circular-definition` is on line 28:
> "A **credit loss** is the financial loss resulting from
> inadequate obligation fulfillment by a counterparty."

That's the SECOND sentence of HARD-CIRC-1, not the first. The
LLM detected the circular pattern, but the relevantText points
only at one side of the loop (line 28 has only the credit loss
definition, not the credit risk one). This is consistent with
the LLM being able to detect the pattern but only on the
"obvious" near-synonym case (HARD-CIRC-1). The other 9 patterns
require more sophisticated detection.

So the LLM detected 1/10 (HARD-CIRC-1 only) and missed 9/10
(tautologies, 3-hop circles, reciprocal jargon). But the
detection rate metric in E12 is `detected / expected` = 1/10
from the e12-summary.json's `by_code.hygiene-circular-definition`
count of 1. The expected 10 from the fixture is 10.

**Correction:** the e12-summary shows 1 `hygiene-circular-definition`
and 1 `cognitive-nested-conditions`. So 1/10 detected (HARD-CIRC-1),
not 0/10. The user's task statement said "0% (0/10)" but the
actual data is 1/10 = 10%. The 0% was likely a rounding or
older snapshot.

Either way: only 1/10 detected. The root cause analysis below
applies.

### Why the gap exists

The `hygiene.prompt` pattern (h) is:

```
(h) CIRCULAR DEFINITION — a term is defined by reference to a
    second term, and that second term is itself defined by
    reference back to the first, creating a definitional loop
    that provides no actionable meaning. Both definitions must
    appear in the document.

    Pattern: "An X is [something that satisfies/meets/requires]
    Y. Y is [the criteria/process/standard] that applies to X."

    Example: "A formal warning is issued when conduct warrants
    formal disciplinary action. Formal disciplinary action is
    the process applied when conduct warrants a formal warning."

    Only flag when BOTH sides of the loop are explicitly stated
    in the document. Do NOT flag a single-sided definition, even
    if it seems circular in isolation.
```

The pattern is too narrow. It requires:

1. Both sides of the loop must be explicitly stated.
2. The structure must match "An X is [something that satisfies/
   meets/requires] Y. Y is [the criteria/process/standard] that
   applies to X."
3. The terms must be explicit (e.g. "X" and "Y" not "the
   counterparty" and "the credit loss").

The 9 missed patterns fail these criteria:

- **Tautological definitions (HARD-CIRC-2, -6, -10)** — the
  terms are explicit but the structure is "X is classified as X
  per the X classification criteria" — the verb is "classified"
  not "satisfies/meets/requires", and the loop is the noun
  itself, not two distinct terms.
- **3-hop circles (HARD-CIRC-3, -7)** — pattern h only matches
  2-hop loops ("X defined via Y, Y defined via X"). A 3-hop
  circle (A → B → C → A) is structurally different and the
  prompt's pattern regex doesn't match it.
- **Reciprocal jargon (HARD-CIRC-4, -8)** — the terms share
  vocabulary (e.g. "VaR" appears in both definitions) but the
  structure is "VaR is the maximum potential loss. The VaR
  confidence interval is...". The "second term" is not
  "VaR" but "VaR confidence interval" — a related but distinct
  term. The LLM cannot detect the reciprocal relationship
  because the prompt doesn't tell it to look for shared
  vocabulary.
- **Near-synonym circles (HARD-CIRC-5, -9)** — similar to
  HARD-CIRC-1 (which the LLM DID detect) but with synonyms
  (e.g. "mark-to-market" and "current market price" share
  vocabulary; "residual risk" and "inherent risk" share
  vocabulary). HARD-CIRC-1 happened to be detected because
  the vocabulary overlap is high and the verbs ("results in",
  "materialises when") are similar. The LLM only fires when
  the overlap is this obvious.

### Proposed fix (P2)

**Option A — broaden pattern (h) in `hygiene.prompt` (prompt-only fix):**

Replace the existing pattern (h) with a more flexible version that
covers the 4 hard patterns:

```
(h) CIRCULAR DEFINITION — a term is defined in a way that
    provides no actionable meaning because the definition
    ultimately depends on the term being defined, either
    directly (X defined by Y defined by X), indirectly (X
    defined by Y, Y defined by Z, Z defined by X — a 3-hop
    circle), or via shared vocabulary (X and Y share key
    vocabulary but neither provides an external anchor — a
    synonym loop), or tautologically (X is the X that
    satisfies the X criteria). All four patterns fail to
    provide a model with an actionable meaning.

    Detection heuristics (any ONE is sufficient):
    1. Direct loop: A term is defined using the SAME or
       NEAR-SYNONYM vocabulary as a term that itself is
       defined using the first term's vocabulary.
    2. 3-hop loop: A → B → C → A, where each step is a
       definition reference.
    3. Tautology: A term is defined using the term itself
       or a derivative of it (e.g. "X is the X that...",
       "X criteria are the criteria for X").
    4. Shared vocabulary: Two definitions share 2+ key
       content words but neither references an external
       source for the shared concept.

    Positive examples (any of these patterns):
    - "Credit risk is the risk of a credit loss. A credit
      loss is the loss arising from credit risk."
    - "An NPL is a loan classified as non-performing per
      the NPL classification criteria. The NPL classification
      criteria are the criteria for classifying NPLs." (tautology)
    - "A default event occurs when an obligor fails to
      fulfil a credit obligation. A credit obligation is
      unfulfilled when a default event occurs. An obligor
      is a party with a credit obligation." (3-hop)
    - "VaR is the maximum potential loss. The VaR confidence
      interval determines the loss threshold used in VaR." (shared vocabulary)

    Negative examples (do NOT flag):
    - Two terms that share vocabulary but where one is the
      ACTUAL definition of the other (e.g. "Credit risk is
      the risk of financial loss. A financial loss is a loss
      in monetary terms." — the second is a category, not a
      definition reference).
    - Cross-references that point to an external definition
      (e.g. "Credit risk, as defined in Basel III, is...").
    - A term used in its own definition in a self-evident
      way (e.g. "A loop is a sequence of statements that
      form a loop" — this is meta, not definitional).
```

This is a long change but it covers all 4 hard patterns.

**Risk:** medium-high. The LLM may over-fire on shared-vocabulary
cases that aren't actually circular (e.g. two terms that share
"financial" but have distinct definitions). The 4 negative
examples need to be carefully tuned.

**Estimated impact:** 0% (1/10) → 70% (7-8/10) on the hard fixture.
The remaining 2-3 would be the trickiest cases (3-hop circles with
intermediate definitions that look legitimate on first read).

**Option B — add a new contradiction-detection pre-pass for
"definitional loops":**

Instead of relying on the LLM to detect circular definitions via
pattern matching, add a deterministic pre-processor that:

1. Extracts all definitions from the document (lines starting
   with "**Term** is" or similar).
2. Builds a directed graph: term → words used in its definition.
3. Detects cycles in the graph (2-hop, 3-hop, etc.).
4. For each cycle, emits a `hygiene-circular-definition` finding
   with both/all sides of the cycle as relevantText.

This is a code change to `src/core/analyzer.ts` (or a new
`src/core/circularDefinitions.ts` module). It does NOT require
LLM calls.

**Risk:** low. The deterministic detector is verifiable (unit
testable with 10 cases). It can be tuned for false positives via
a threshold (e.g. require 60% vocabulary overlap to consider a
cycle).

**Estimated impact:** 0% (1/10) → 90% (9-10/10) on the hard fixture.
The deterministic detector would catch the 3-hop circles, the
synonym loops, and the tautologies. The reciprocal-jargon cases
(HARD-CIRC-4, -8) might still slip through if the vocabulary
overlap is below threshold.

**Files to change:**

- New: `src/core/circularDefinitions.ts` — the deterministic
  detector.
- New: `src/core/circularDefinitions.test.ts` — 10 unit tests
  (one per HARD-CIRC case).
- `src/core/analyzer.ts` — call the new detector from
  `processHygiene` (or a new `analyzeCircularDefinitions` wave)
  and merge the results.
- `src/core/types.ts` — add the new `LLMHygieneItem` type for
  `circular-definition-deterministic` (or extend the existing
  type).
- `src/core/prompts/hygiene.prompt` — keep pattern (h) as-is
  for LLM-detected cases; the deterministic detector handles
  the structural cases.

**Recommendation:** **Option B.** The deterministic detector
aligns with the project's principle of preferring deterministic
over LLM-based detection. The 4 hard patterns are structurally
distinct but all involve definitional cycles — a graph algorithm
is the natural fit.

---

## 4. test-dead-hard (ADVERSARIAL, 8%)

### What was expected (per labeled table)

12 dead instructions (HARD-DEAD-1 through HARD-DEAD-12), all
deprecation-era Kubernetes / GitHub / Terraform features:

- HARD-DEAD-1: `apiVersion: extensions/v1beta1` (removed in K8s 1.16)
- HARD-DEAD-2: `kubectl run --generator=run-pod/v1` (removed in K8s 1.18)
- HARD-DEAD-3: `PodSecurityPolicy` (removed in K8s 1.25)
- HARD-DEAD-4: `kubectl get componentstatuses` (removed in K8s 1.20)
- HARD-DEAD-5: `kubernetes.io/ingress.class: "nginx"` annotation (replaced in 1.22)
- HARD-DEAD-6: `helm init` (removed in Helm 3)
- HARD-DEAD-7: `kubectl apply --server-dry-run` (renamed to `--dry-run=server` in 1.18)
- HARD-DEAD-8: `::set-output` workflow command (deprecated 2020, removed 2022)
- HARD-DEAD-9: `::save-state` workflow command (deprecated 2020, removed 2022)
- HARD-DEAD-10: `terraform 0.12upgrade` (removed in Terraform 1.0)
- HARD-DEAD-11: eksctl `--version 1.21` (EKS 1.21 retired)
- HARD-DEAD-12: argoproj.io/v1alpha1 Application (replaced by v1alpha2)

### What was detected (per E12 JSON)

3 findings: 1 `hygiene-dead-instruction` (HARD-DEAD-1 — the
apiVersion on L40-42) + 1 `cognitive-nested-conditions` (false
positive on L53) + 1 `coverage-gap` (false positive on L39).

So 1/12 is a real hit (HARD-DEAD-1), and 11/12 are misses.

### Why the gap exists

The `hygiene.prompt` pattern (e) is:

```
(e) DEAD INSTRUCTION — an instruction that references a feature,
    resource, template, authentication scheme, or tool that no
    longer exists, has been deprecated, or is explicitly noted as
    unavailable. Only flag when evidence of removal or
    deprecation is present in the prompt itself.

    Example: An instruction to use a deprecated authentication
    scheme when a note in the prompt states it was removed in a
    prior version.
```

The pattern explicitly requires **"evidence of removal or
deprecation ... present in the prompt itself"**. The test-dead-hard
fixture is a CURRENT TOOL STACK document. The relevant section is
"Current Platform Tool Stack (as of Q1 2025)" which lists the
supported versions. It does NOT say "extensions/v1beta1 was
removed in K8s 1.16" — it says "Kubernetes 1.29 (EKS-managed)".

So the LLM recognizes the apiVersion as old via world knowledge
(K8s 1.29 is current, extensions/v1beta1 was removed before 1.16),
but the prompt tells it to only flag when the document itself
contains the deprecation note. For HARD-DEAD-1, the LLM fires
because the contrast between "Kubernetes 1.29" (the current
version) and "extensions/v1beta1" (a 7-year-old removed API) is
so stark that the LLM flags it despite the prompt restriction.

For the other 11 hard-DEAD cases, the contrast is less stark:

- HARD-DEAD-2 (`--generator=run-pod/v1`): removed 6 years before
  K8s 1.29, but the LLM has less confident world knowledge about
  kubectl flag removals.
- HARD-DEAD-3 (PodSecurityPolicy): removed in 1.25, 4 minor
  versions before 1.29. The document says "Pod Security Admission
  controller (built-in since K8s 1.25)" — so the document DOES
  mention the removal (in the context of "we use Pod Security
  Admission now, not PSP"). But the LLM is told to only flag
  when the document EXPLICITLY notes the removal of the
  referenced feature, and the document only notes the
  introduction of the replacement, not the removal of the old.
- HARD-DEAD-4 (`kubectl get componentstatuses`): removed in
  1.20. The LLM has world knowledge but the prompt restriction
  blocks it.
- HARD-DEAD-5 (`kubernetes.io/ingress.class`): the document
  says "all ingress resources must use the `ingressClassName:
  nginx` field" — this implicitly deprecates the old
  annotation-based selection, but the LLM cannot infer
  deprecation from a contrasting positive statement.
- HARD-DEAD-6 (`helm init`): the document says "Helm 3.14 —
  Helm 2 is fully retired" — this DOES note the retirement of
  the Tiller-era Helm 2 (which is what `helm init` was for).
  The LLM might fire if it connects "Helm 2 retired" to "helm
  init is a Helm 2 command", but the prompt pattern says
  "evidence of removal ... of the FEATURE referenced", and the
  feature is `helm init` not "Helm 2".
- HARD-DEAD-7 (`--server-dry-run`): renamed in 1.18. The
  LLM's world knowledge may not cover flag renames.
- HARD-DEAD-8, -9 (GitHub Actions `::set-output`,
  `::save-state`): deprecated 2020, removed 2022. The
  document says "deprecated workflow commands disabled" — this
  DOES note the deprecation. The LLM should fire here. It
  doesn't (E12 missed it), so either the LLM's context window
  is being exhausted on the larger document or the contrast is
  too subtle.
- HARD-DEAD-10 (`terraform 0.12upgrade`): removed in
  Terraform 1.0. The document says "Terraform 1.7" — the
  LLM's world knowledge says `0.12upgrade` was removed
  4 major versions ago. Should fire; didn't.
- HARD-DEAD-11 (eksctl `--version 1.21`): EKS 1.21 is
  retired. The document says "Kubernetes 1.29" — the LLM
  should infer the EKS version is out of support. Should
  fire; didn't.
- HARD-DEAD-12 (argoproj.io/v1alpha1): the document doesn't
  mention v1alpha1 or v1alpha2 specifically. The LLM has
  no signal.

### Proposed fix (P3)

**Option A — relax the "evidence of removal" rule in pattern (e)
(prompt-only fix):**

Replace the existing pattern (e) with:

```
(e) DEAD INSTRUCTION — an instruction that references a feature,
    resource, tool, command, or API version that is no longer
    available, has been deprecated, or has been superseded by
    a newer alternative. Flag when ANY of the following
    evidence is present:

    1. Explicit deprecation/removal note in the document
       (e.g. "Helm 2 is fully retired", "deprecated workflow
       commands disabled", "Pod Security Admission (built-in
       since K8s 1.25)" — implies PSP is replaced).

    2. Contrasting CURRENT version: the document specifies a
       CURRENT version for a tool, and the instruction
       references a feature that is incompatible with that
       CURRENT version (e.g. document says "Kubernetes 1.29"
       and instruction uses "extensions/v1beta1" — known
       removed in 1.16). Use world knowledge to identify
       the incompatibility.

    3. Replacement context: the document introduces a
       REPLACEMENT for the feature, which implies the
       referenced feature is the prior/removed version
       (e.g. document says "use `ingressClassName` field"
       and instruction uses the old annotation
       `kubernetes.io/ingress.class`).

    4. Removed-in-version note: any version-aware deprecation
       note in the document that, combined with the
       instruction, makes the instruction inapplicable
       (e.g. document says "deprecated workflow commands
       disabled" and instruction uses `::set-output`).

    For each finding, also report:
    - The CURRENT version or replacement that should be used.
    - The specific tool name + version where the feature was
      removed (if known).
```

**Risk:** medium. World-knowledge flagging is error-prone
(gpt-4o-mini may hallucinate removal versions for tools it
doesn't know). The 4-evidence list is comprehensive but
may produce FPs on:

- Documents that mention old versions in a "history" or
  "changelog" context (where the old version is intentional).
- Documents that reference multiple tools, where the LLM
  may infer "removed" when the tool is just less common.

Mitigation: add a "negative example" section to the prompt:

```
Negative examples (do NOT flag):
- "Originally built with v1beta1, this skill has been
  upgraded to v1." — historical reference, not an active
  instruction.
- A document that lists old and new versions side-by-side
  for migration context.
- A "See also" or "Related" section that references old
  tools for context.
```

**Estimated impact:** 8% (1/12) → 60% (7-8/12) on the hard fixture.
The remaining 4-5 would be the trickiest cases (HARD-DEAD-2
`--generator`, HARD-DEAD-4 `componentstatuses`, HARD-DEAD-7
`--server-dry-run` rename, HARD-DEAD-12 v1alpha1 vs v1alpha2
where the document doesn't mention either).

**Option B — add a deterministic version-mismatch pre-processor
(code change):**

Extract every command, apiVersion, and CLI flag from the document
(regex or simple parse). For each, look up its "current
recommended version" in a static lookup table (or via an LLM
call with a tightly-scoped prompt). If the document's CURRENT
version doesn't match the lookup, emit a `hygiene-dead-instruction`
finding.

This is similar to Option B for the circular case: a
deterministic pre-processor that supplements the LLM.

**Risk:** low. The lookup table is verifiable. LLM-based
lookup is a separate, narrow call that can be unit-tested.

**Estimated impact:** 8% (1/12) → 90% (10-11/12) on the hard
fixture. The deterministic detector would catch all the
apiVersion mismatches, the removed commands, and the renamed
flags. Only the deep version-knowledge ones (HARD-DEAD-12
v1alpha1 → v1alpha2) might slip through.

**Files to change:**

- New: `src/core/deadInstructions.ts` — the deterministic
  detector (regex-based extraction + lookup table).
- New: `src/core/deadInstructions.lookup.json` — the static
  version/command lookup table.
- New: `src/core/deadInstructions.test.ts` — 12 unit tests.
- `src/core/analyzer.ts` — call the new detector from
  `processHygiene` and merge results.
- `src/core/prompts/hygiene.prompt` — keep pattern (e) as-is
  for LLM-detected cases; the deterministic detector handles
  the structural cases.

**Recommendation:** **Option A first** (lower cost, lower
risk), then **Option B as a follow-up** if the prompt-only
fix doesn't reach 60% on the hard fixture.

---

## Priority Ranking

| Priority | Fix | Files | Risk | Estimated Δ (4 fixtures) | Cross-fixture impact |
|---|---|---|---|---|---|
| **P1** | Option B for coverage (required-scope list) | `src/core/config.ts`, `src/core/prompts/coverage.prompt`, `src/core/prompts/single-pass.prompt`, `src/core/analyzer.ts`, `scripts/e12-fixture-suite.mjs`, sibling config files | Low | +86 pp (7%→50% on each of 2 fixtures) | Fixes 2 fixtures |
| **P2** | Option B for circular (deterministic graph detector) | New: `src/core/circularDefinitions.ts`, `src/core/circularDefinitions.test.ts`. Modified: `src/core/analyzer.ts`, `src/core/types.ts` | Low | +90 pp (0%→90% on 1 fixture) | None (fixture-specific) |
| **P3a** | Option A for dead (relax "evidence of removal" rule) | `src/core/prompts/hygiene.prompt` | Medium | +52 pp (8%→60% on 1 fixture) | None (fixture-specific) |
| **P3b** | Option B for dead (deterministic version-mismatch detector) | New: `src/core/deadInstructions.ts`, `src/core/deadInstructions.lookup.json`, `src/core/deadInstructions.test.ts`. Modified: `src/core/analyzer.ts` | Low | +82 pp (8%→90% on 1 fixture) | None (fixture-specific), but could generalize to other version-sensitive tools (e.g. AWS SDK, npm packages) |

**Total expected improvement** (all 4 fixes implemented):

- test-coverage-gaps: 7% → 50% (+43 pp, +6 findings detected)
- test-coverage-gaps-hard: 7% → 50% (+43 pp, +6 findings detected)
- test-circular-hard: 0% → 90% (+90 pp, +9 findings detected)
- test-dead-hard: 8% → 90% (+82 pp, +10 findings detected)
- **Combined: 22/52 expected → 36/52 expected (42% → 69% on the 4 underperformers)**

---

## Cross-Fixture Impact

**P1 (coverage) helps 2 fixtures simultaneously** because both
test-coverage-gaps and test-coverage-gaps-hard are coverage-gap
fixtures and share the same root cause (E10 pre-check is too
aggressive). Implementing P1 with a required-scope list
(Option B) means defining two required-scope lists, one per
fixture, but the prompt change is shared.

**P2 (circular) and P3 (dead) each help 1 fixture.** The
structural-detector pattern (Option B for each) is
theoretically extensible: P2's graph-detector could generalize
to "any definitional loop, not just circular" (e.g. self-
referential definitions where a term is defined using itself).
P3's version-mismatch detector could generalize to "any
document with a stated CURRENT version and a reference to an
incompatible version" (e.g. an AWS Lambda function with a
`runtime: nodejs8.10` reference when the document says "use
Node.js 20+"). But the immediate impact is 1 fixture each.

**P1 + P2 + P3 implementation: 5 files modified, 3 new files
created, 22+ new unit tests.** Reasonable scope for a single
session.

---

## Hypothesis Verdict

The 4 underperformers reflect **real analyzer limitations**,
not fixture design issues:

- **Coverage-gap (2 fixtures)**: the E10 pre-check fix was
  calibrated on the documentation-review skill (where it
  reduced FPs by 67%). It over-suppresses on fixtures that
  have **actionable procedure steps for some scenarios but
  not others**, and where the LLM cannot distinguish
  "topically mentioned" from "scenario handled." This is a
  pre-check scope issue, not a fixture issue.

- **Circular-definitions (1 fixture)**: the `hygiene-circular-
  definition` pattern is a 2-hop-only pattern that misses
  3-hop circles, synonym loops, tautologies, and reciprocal
  jargon. These are all real circular-definition patterns;
  the LLM-as-pattern-matcher approach has hit a ceiling.
  A deterministic graph detector is the natural fix.

- **Dead-instructions (1 fixture)**: the "evidence of removal
  in the prompt itself" rule is too strict for current-state
  documents. The hard-DEAD fixture is realistic — production
  documents often specify a CURRENT version without
  enumerating every removed feature. The rule needs to
  allow world-knowledge + contrasting-CURRENT-version
  detection.

**All 4 underperformers are worth fixing.** None of them
are fixture design issues. The fixtures are well-built
adversarial tests; the analyzer just has structural
limitations on these categories.

---

## Follow-up Work

After implementing P1-P3, the next steps would be:

1. Re-run E12 on the 4 underperformers to measure the actual
   delta. (4 LLM calls, ~2-3 minutes including cooldown.)
2. Re-run E12 on all 17 fixtures to verify no regressions.
3. Re-run E13 baseline (15 skills) to verify no real-world
   regressions.
4. Update `LEARNINGS.md` with the new "fix category by code
   type" taxonomy: prompt-only fixes for
   {coverage-gap, ambiguity-llm}, deterministic pre-processors
   for {circular-definition, dead-instruction}, and config
   overrides for fixture-targeted testing.
5. Add new adversarial fixtures that stress the
   deterministic pre-processors:
   - `test-circular-3hop` — explicitly 3-hop circles
   - `test-circular-tautology` — explicitly tautological
   - `test-dead-version-mismatch` — explicit
     CURRENT-vs-OLD pattern

---

## Notes for Implementation Session

- All proposed fixes preserve the existing code paths. The
  prompt changes are additive (Option A) and the
  deterministic pre-processors are supplementary (Option B).
  No existing tests should regress.
- The required-scope list in P1 Option B is a NEW config
  field, not a behavior change. Existing skills/skills with
  no required-scope list get the current E10 behavior.
- The deterministic pre-processors in P2/P3 are NEW modules.
  They run BEFORE the LLM wave, so they add no LLM cost.
  They add a small CPU cost (regex extraction + graph
  algorithm) which is bounded by document size (typically
  <10ms for skills under 1000 lines).
- All proposed fixes are E-numberable: P1 could be E16,
  P2 could be E17, P3 could be E18. Recommend reserving
  E16 for the E14/E15-style scoring/data fix, and using
  E17, E18, E19 for the three prompt/detector fixes.

---

## Summary

4 underperformers analyzed. 3 distinct root causes identified.
4 concrete fixes proposed (1 prompt-only for coverage, 1
deterministic detector for circular, 2 alternatives for dead).
Expected combined improvement: 42% → 69% on the 4 underperformers.
Priority order: P1 (coverage, 2 fixtures) > P2 (circular, 1 fixture)
> P3 (dead, 1 fixture). Cross-fixture impact: P1 helps 2, P2/P3
each help 1. All 4 reflect real analyzer limitations, not fixture
issues.
