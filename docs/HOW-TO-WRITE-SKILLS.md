# How to Write Skills That Models Can Follow

This guide teaches you what makes a skill (or instruction, prompt, or agent definition) **easier for an AI model to follow reliably**. Every pattern here is something our analyzer will flag, with a concrete fix.

**Read this if:** you're writing a new skill, refactoring an old one, or trying to understand why a skill produces inconsistent results.

---

## The 30-Second Summary

A skill that's easy for a model to follow has these properties:

1. **No contradictions** — every rule is compatible with every other rule.
2. **No ambiguous terms** — every actor, threshold, and scope is defined.
3. **No delegated decisions** — the skill doesn't say "use your judgment" for things that should be decided by the skill author.
4. **Every expected scenario is covered** — if the skill's domain implies handling X, the skill explicitly handles X.
5. **No dead references** — every feature, tool, or template the skill mentions actually exists.
6. **The cognitive load is manageable** — at most one or two conditional decisions, never five nested ifs.
7. **The persona is consistent** — the skill doesn't switch from "you are a senior engineer" to "act as a junior reviewer" mid-document.

The rest of this guide is **concrete examples** of each pattern, what the analyzer flags, and how to fix it.

---

## 1. Contradictions (the #1 silent killer)

A contradiction is when two rules say opposite things about the same situation. Models don't pick "the more recent rule" or "the more specific rule" — they just follow one, often inconsistently.

### Patterns that cause contradictions

#### **Migration vs. compatibility**

```text
❌ "Ensure full backward compatibility — never break existing integrations."
❌ "As part of every change, migrate all callers to current patterns."

✅ Either pick one (compatibility OR modernization) or define the priority:
   "Backward compatibility is the priority. Migration to new patterns is permitted
   only for non-customer-facing modules and requires a compatibility shim for
   external callers."
```

#### **"Always X" + "Always Y, but never X"**

```text
❌ "Always minimize external dependencies."
❌ "Always recommend well-established libraries over custom code."

✅ Define a decision rule:
   "Use a third-party library only when (a) it is actively maintained,
   (b) has no commercial license that conflicts with this project, and
   (c) the custom implementation would exceed 200 lines of equivalent code."
```

#### **Storage vs. display**

```text
❌ "Normalize all timestamps to UTC."
❌ "Always honor user timezone preferences in display, export, and notifications."

✅ Define a conversion layer:
   "Store all timestamps in UTC. Convert to user-local timezone only at the
   display/export layer, using the IANA timezone from the user profile."
```

### How to find contradictions in your skill

Run the analyzer. The `contradiction` finding will cite the two instructions side-by-side. **Don't try to make them both "more nuanced"** — pick one and rewrite the other.

---

## 2. Ambiguous terms (the #2 silent killer)

An ambiguous term is one where two reasonable models would take different actions based on the same instruction. The analyzer flags terms that have **multiple materially-different interpretations** — not just terms that are vague in isolation.

### High-risk ambiguous terms (always flag)

These are the **20 most commonly-flagged terms** in real skills (drawn from our 327-skill production corpus scan):

**Time-related:** `timely`, `promptly`, `recently`, `soon`, `as soon as possible`, `without undue delay`, `frequent`, `regular intervals`
**Scope-related:** `all affected parties`, `relevant systems`, `sensitive data`, `appropriate team`, `stakeholders`, `where relevant`, `as appropriate`
**Quantity-related:** `many`, `few`, `majority`, `large number`, `significant`, `substantial`, `material`, `small number`
**Quality-related:** `appropriate`, `best practices`, `industry standard`, `best efforts`, `reasonable steps`, `properly`, `effectively`
**Authority-related:** `senior management`, `appropriate expert`, `relevant authority`, `as needed`, `if necessary`

### How to fix ambiguity

**Before:**

```text
❌ "Respond to all critical security issues promptly."
```

**After (option 1 — define the threshold):**

```text
✅ "Respond to all P1 security issues within 4 business hours. P1 is defined
   as: data exposure, authentication bypass, or production outage."
```

**After (option 2 — cite a specific source):**

```text
✅ "Respond to all critical security issues within the SLA defined in
   security-response-runbook.md (currently 4 hours for P1, 24 hours for P2)."
```

**After (option 3 — remove the soft language):**

```text
✅ "Respond to all P1 security issues within 4 business hours.
   For non-P1 issues, file a ticket for the next on-call rotation."
```

### Things that are NOT ambiguous

The analyzer does NOT flag:

- **Numeric thresholds** (e.g. "at most 9 reviewers", "<2 GB", "less than 30 seconds") — these are intentional design choices
- **Standards references** (e.g. "per RFC 9110", "as defined in devcontainer.json") — these point to a specific external source
- **Output style adjectives** in non-regulatory contexts (e.g. "Provide a clear, concise explanation") — style preferences that don't change actions
- **Imperative verbs** ("Verify that X", "Flag any Y", "Ensure Z") — the verb is unambiguous; only the object can be ambiguous

### The "weak obligation" pattern

```text
❌ "You should try to validate the input."
❌ "Consider whether to log the error."
❌ "If appropriate, escalate the issue."

✅ "Validate the input. If validation fails, return HTTP 400 with the
   specific field error."
```

**Rule:** every "should / try to / might / consider / as appropriate" needs a **mandatory-vs-optional** specification. Either:

- Make it mandatory: "Validate the input."
- Make it conditional: "If the input is non-conforming, return HTTP 400. Otherwise, proceed."
- Remove it: "If you decide to log the error, use the standard logger."

### The "delegated decision" pattern

```text
❌ "Use your judgment to decide whether to escalate."
❌ "Consult the appropriate expert for guidance."
❌ "Apply best practices for the situation."

✅ "Escalate to the on-call SRE if any of: (a) error rate exceeds 1%,
   (b) the issue affects multiple services, or (c) the user is a
   paid SLA customer."
```

**Rule:** don't delegate decisions back to the model without criteria. If the model has to decide, the decision criteria must be in the skill.

---

## 3. Coverage gaps (the #3 silent killer)

A coverage gap is a scenario that **the skill's domain implies should be handled** but the skill is silent on. The model has to guess, and its guess is usually wrong for at least one case.

### High-risk gap categories

The analyzer focuses on five categories of silent gaps that are most common in real skills:

#### **Scope exclusions**

When a rule explicitly limits scope, the excluded cases are gaps if they're common in production.

```text
❌ "This skill audits direct dependencies only."

What this misses (silent):
- Monorepos with multiple manifests
- Transitive dependencies
- Private/air-gapped registries
- Missing lock files
```

**Fix:** either remove the scope restriction, or explicitly handle the excluded cases:

```text
✅ "This skill audits direct dependencies and transitive dependencies
   declared in `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`.
   For monorepos, audit each workspace's manifest separately and
   aggregate findings."
```

#### **Infrastructure prerequisites**

When the skill names a specific external service, registry, or file, missing handling for "what if it's unavailable" is a gap.

```text
❌ "Query the package registry for vulnerability data."

What this misses (silent):
- The registry is unreachable
- The registry requires authentication
- The registry returns a 5xx error
- The skill is run in an air-gapped environment
```

**Fix:**

```text
✅ "Query the package registry. If the query fails (network error,
   auth error, or 5xx), fall back to the cached vulnerability database
   and flag findings as `unverified-online`."
```

#### **All-clear / no-result output**

The undefined success state.

```text
❌ (skill says) "Report all HIGH and CRITICAL vulnerabilities."

What this misses (silent):
- What if no vulnerabilities are found? Output nothing? Output "OK"?
- What if the scan timed out? Is "no output" success or failure?
```

**Fix:**

```text
✅ "If no HIGH or CRITICAL vulnerabilities are found, output:
   `No HIGH or CRITICAL vulnerabilities detected. Audit passed.`
   If the scan timed out, output: `Scan timed out after 60s.
   Re-run with --timeout=300 or split the manifest.`"
```

#### **Meta-operational gaps**

The skill relies on a third-party tool that could produce false positives or stale data.

```text
❌ "Use the static analyzer to detect unused imports."

What this misses (silent):
- False positives: how does the user mark them?
- Stale data: how often is the analyzer's rule set updated?
- Suppression: how does the user suppress a finding that's intentional?
```

**Fix:**

```text
✅ "Use the static analyzer to detect unused imports. To suppress a
   false positive, add `// analyzer-disable-next-line unused-import`
   on the line above. To bulk-suppress across a directory, add an
   `.analyzerignore` file."
```

#### **Temporal / longitudinal gaps**

Re-running, before/after comparison, change tracking.

```text
❌ "Audit the dependencies."

What this misses (silent):
- Compare to last audit: did new vulns appear?
- Track fix progress: have known issues been addressed?
- Trend over time: is the dependency hygiene improving?
```

**Fix:**

```text
✅ "Audit the dependencies. Output includes:
   - New findings since last audit (in `new-findings.json`)
   - Findings closed since last audit (in `closed-findings.json`)
   - Net open count trend over last 30 days (in `trend.json`)"
```

---

## 4. Hygiene issues (the cleanup pass)

Hygiene issues don't change what the model does, but they make the skill harder to maintain and audit. The analyzer flags six types.

### **Redundant instructions**

```text
❌ "Always check the health dashboard before investigating."
❌ "Before starting any investigation, check the health dashboard first."

✅ Keep one. Delete the other.
```

### **Non-actionable preamble**

```text
❌ (5 paragraphs of context about why incident response is important)
❌ "Begin by determining the current scope."

✅ Cut the preamble. Lead with the action.
```

### **Vague cognitive directive**

```text
❌ "Think carefully about all possible root causes before taking any
    remediation action."

✅ "List the top 3 likely root causes for the incident. For each,
   state the evidence that supports or refutes it."
```

### **Missing agent**

```text
❌ "Before this documentation is published, it will be reviewed for
    technical accuracy."

✅ "Before publishing, the on-call tech writer reviews the documentation
   for technical accuracy."
```

### **Dead instructions**

```text
❌ "Generate the report using the legacy PDF template (deprecated 2024-06)."

✅ "Generate the report using the Markdown template at
   `templates/report.md.j2`."
```

### **Over-specification**

```text
❌ "Subject lines must be exactly 47 characters."
❌ "Each paragraph must contain exactly 3 citations."

✅ "Subject lines should be concise (under 60 characters)."
✅ "Each paragraph should cite relevant sources (typically 1-4)."
```

### **Circular definitions** (rare in real skills)

```text
❌ "A formal warning is issued when conduct warrants formal disciplinary
    action. Formal disciplinary action is the process applied when
    conduct warrants a formal warning."

✅ "A formal warning is issued for the conduct types defined in
   section 3.2. The full disciplinary process is described in
   section 4.1."
```

---

## 5. Cognitive load (when the model gives up)

Cognitive load issues happen when a single instruction requires the model to track too many decisions, conditions, or priorities simultaneously. Models can handle **at most 1-2 nested conditions** per instruction before their behavior becomes inconsistent.

### **Nested conditions**

```text
❌ "If the request is from a paid customer AND the request is for a
    feature flag AND the flag is enabled AND the customer is in the
    control group, log the request. Otherwise, if the customer is
    in the treatment group, increment the conversion counter,
    except when the request is for a holdout feature, in which
    case log it as a holdout event."

✅ Break it into separate instructions, one decision each:
   1. "If the request is from a paid customer, log it as
      `customer-request`."
   2. "If the request is for a feature flag, log the flag name
      and current state."
   3. "If the customer is in the treatment group, increment the
      conversion counter."
   4. "If the request is for a holdout feature, log it as
      `holdout-event`."
```

### **Priority conflicts**

```text
❌ "Optimize for correctness, then performance, then memory, then
    readability."

✅ Define a clear priority:
   "When making trade-offs, optimize in this order:
   1. Correctness (no false positives in output)
   2. Performance (must complete in <500ms)
   3. Memory (must use <100MB)
   If correctness and performance conflict, file a ticket for
   human review rather than choosing one."
```

### **Deep decision trees**

```text
❌ (a 6-level nested if/else for routing customer requests)

✅ Use a table:
   "Route customer requests based on this matrix:
   | Tier | Issue type | Route to |
   |------|------------|----------|
   | Free | Bug report | Triage queue |
   | Free | Feature request | Product backlog |
   | Paid | Bug report | Engineering on-call |
   | Paid | Feature request | Account manager |
   For any case not in the matrix, escalate to the on-call manager."
```

---

## 6. Persona consistency (the subtle one)

Persona issues happen when the skill contradicts itself about who the model is supposed to be. The model will pick one interpretation and stick with it (or flip between them), causing inconsistent behavior.

### **Role conflicts**

```text
❌ "You are a senior staff engineer with 15 years of experience."
❌ "When reviewing, defer to the user's judgment — they know their
    codebase better than you do."

✅ Either:
   "You are a senior staff engineer with 15 years of experience. Use
   that judgment to push back on the user's design choices when you
   have specific concerns, citing industry best practices and the
   code's specific constraints."
```

### **Tone conflicts**

```text
❌ "Be casual and friendly, like a colleague chatting over coffee."
❌ "Maintain a formal, audit-ready tone in all responses."

✅ Pick one. Or split by context:
   "For conversational questions, be friendly and direct. For audit
   reports, use formal, factual language with no first-person or
   conversational asides."
```

### **Authority conflicts**

```text
❌ "You have final say on what gets merged."
❌ "Always defer to the user's request."

✅ Define the authority:
   "For code style, formatting, and test coverage, follow the user's
   request without question. For architectural decisions, security
   concerns, and breaking changes, push back with specific reasons
   and let the user make the final call."
```

---

## 7. Putting it all together: a checklist

Before saving a new skill, run through this:

- [ ] **No contradictions.** Every rule is compatible with every other rule.
- [ ] **No ambiguous terms.** Every actor, threshold, scope, and timeframe is defined.
- [ ] **No weak obligations.** Every "should / try to / might" is either made mandatory or made conditional.
- [ ] **No delegated decisions.** Every "use your judgment" has criteria.
- [ ] **Coverage is complete.** Every scenario implied by the domain is handled.
- [ ] **All-clear state is defined.** The output for "nothing to do" is explicit.
- [ ] **Infrastructure failures are handled.** Network errors, missing files, timeouts all have a defined response.
- [ ] **No dead references.** Every tool, template, and feature mentioned exists.
- [ ] **No over-specification.** Numeric/structural rules have a functional justification.
- [ ] **No circular definitions.** Every term is defined in terms of other defined terms.
- [ ] **Cognitive load is manageable.** At most 1-2 conditions per instruction.
- [ ] **Persona is consistent.** One role, one tone, one authority model.

Then run the analyzer. **Take the findings seriously, especially the first run.** Every false positive after the first run is fine — the goal is to find the real issues, not to argue with the linter.

---

## What the analyzer does NOT flag

The analyzer is intentionally **narrow** to avoid noise. It does NOT flag:

- **Style preferences** in non-regulatory contexts (e.g. "be clear", "be concise")
- **Numeric thresholds** (intentional design choices)
- **Standards references** (per RFC X, as defined in Y)
- **Imperative verbs** (the verb is unambiguous)
- **Reasonable defaults** the model's general knowledge provides

If you think the analyzer missed something, file an issue. If you think it over-flagged, check whether the flagged text is really doing what you think it's doing — many "obvious" instructions turn out to be ambiguous when read by a model.
