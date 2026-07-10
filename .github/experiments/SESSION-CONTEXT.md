# Session Context

## Objective

Improve the `documentation-review` skill while simultaneously identifying opportunities to improve the Skills Review analyzer.

The objective is **not** to reduce findings at any cost.

The objective is to improve the prompt and classify remaining findings as either:

- Genuine prompt improvements
- Analyzer improvement opportunities

## Working Principles

- Never weaken a prompt solely to remove a finding.
- Every modification must improve the prompt independently of the analyzer.
- Treat analyzer findings as hypotheses.
- Verify every hypothesis before changing the prompt.
- Preserve readability.
- Prefer deterministic instructions over subjective guidance.

## Current Status

Iterations completed:

- v1
- v2
- v3

The revisions successfully reduced language-level findings.

Remaining findings are primarily:

- logical contradictions
- specification edge cases
- analyzer heuristics

The experiment is entering a calibration phase rather than a rewriting phase.