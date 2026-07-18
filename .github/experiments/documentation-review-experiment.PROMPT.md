
---

# Skills Review and Polish – Documentation Review Prompt Experiment

## Context

We are conducting a structured experiment to improve a documentation review skill for the Skills Review and Polish project.

The objective is **not** to silence the analyser.

The objective is to improve the prompt while identifying opportunities to improve the analyser itself.

The current repository contains:

* Skills Review and Polish
* Documentation review skill
* Analyzer
* MCP server
* VS Code extension

This session has direct access to the repository and can invoke the analyser through MCP.

---

## Principles

Follow these principles throughout the experiment.

### 1. Never game the analyser

Do not rewrite text solely to remove findings.

Every modification must improve the prompt itself.

If a finding appears incorrect, preserve the better wording and record the finding as a potential analyser improvement.

---

### 2. Make one logical change at a time

Avoid large rewrites.

After each revision:

* Run the analyser.
* Compare findings with the previous revision.
* Explain exactly which findings changed.

Treat the process like compiler optimisation rather than creative writing.

---

### 3. Prefer deterministic prompts

Reduce:

* delegated decisions
* undefined terminology
* duplicated rules
* overlapping rule sets

Increase:

* explicit definitions
* decision trees
* binary acceptance criteria
* single sources of truth

---

### 4. Preserve readability

The prompt should remain usable by humans.

Do not replace natural language with unnecessary formal notation.

Readability is a project requirement.

---

## Experiment Goals

Improve both:

1. the documentation-review skill

and

1. the Skills Review analyser.

Each analyser finding should be classified as one of:

### Genuine Prompt Improvement

The analyser found a real issue.

Modify the prompt.

### Possible False Positive

The analyser appears to have misunderstood the prompt.

Do not weaken the prompt simply to remove the finding.

Instead:

* explain why
* produce a minimal reproduction
* suggest an analyser improvement

---

## Workflow

For every iteration:

### Step 1

Run the analyser.

### Step 2

Categorise every finding.

Suggested categories:

* Contradiction
* Ambiguity
* Delegated Decision
* Cognitive Load
* Coverage
* Persona
* Hygiene
* Potential False Positive

### Step 3

Rank findings.

Use:

Critical

High

Medium

Low

---

### Step 4

Select the smallest logical improvement that addresses the highest-ranked finding.

Implement only that improvement.

---

### Step 5

Run the analyser again.

Produce a delta:

Resolved

New

Unchanged

Regression

---

## Metrics

Track after every iteration.

| Metric            | Description                       |
| ----------------- | --------------------------------- |
| Errors            | Count                             |
| Warnings          | Count                             |
| Information       | Count                             |
| Words Changed     | Total edit size                   |
| Findings Resolved | Count                             |
| New Findings      | Count                             |
| Churn             | Words Changed / Findings Resolved |

The goal is to reduce churn over time.

---

## Potential Analyzer Improvements

Watch for evidence that the analyser does **not** recognise:

* defined terminology
* glossary definitions
* decision trees
* state-machine style prompts
* single-source-of-truth rule references
* section cross references

These should be documented rather than worked around.

---

## Repository Tasks

Use the MCP tools to:

* inspect the current skill
* inspect analyser prompts
* inspect rule implementations
* inspect heuristic implementations where helpful

Avoid guessing how the analyser works when the implementation can be inspected.

---

## Success Criteria

Success is **not** zero findings.

Success is:

* fewer genuine issues
* better prompt quality
* documented analyser improvements
* reproducible experiments
* evidence explaining why each change was made

---

## Deliverables

Maintain:

1. Current skill revision
2. Iteration history
3. Findings delta
4. Candidate analyser improvements
5. Final recommendations

---

# Experiment locationsd

Experiments deserve their own directory in the repository.

Something like:

```
experiments/
    documentation-review/
        README.md
        baseline.md
        iteration-01.md
        iteration-02.md
        iteration-03.md
        findings.csv
        analyser-feedback.md
```
