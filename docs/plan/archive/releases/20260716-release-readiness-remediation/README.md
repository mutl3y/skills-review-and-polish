# 20260716 Release Readiness Remediation

## Purpose

Independent release-readiness review of Skills Review and Polish after the
v0.1.38 calibration work. The review covers product direction, analyzer
architecture, implementation risks, prompt behavior, calibration evidence, and
documentation honesty.

## Verdict

The application is directionally strong, but it is not ready for a formal
quality-claiming release. It is fit for a controlled beta or marketplace
preview if positioned as an assistive linter with human review. The remediation
work now has the beta gates passing: E50 clean-fixture calibration is at 74.0%
capped recall with a 68.3% precision proxy, a prior same-day gate reached 76.7%
capped recall with a 75.0% precision proxy, and the latest response-health gate
completed at 72.7% capped recall with a 63.0% precision proxy. That latest run
also recorded 35 JSON salvage recoveries, 60 non-stop finish reasons, and 37
deep-tier fallbacks. Real-skill E61 validation caught and reduced production
ambiguity/table noise, and large-skill analysis now degrades to an explicit
head/tail excerpt instead of failing provider context limits. The remaining
formal-release blockers are response-shape reliability, frequent deep-tier
fallback, model-dependent structured JSON behavior, and category-level misses
across 16/43 calibration categories.

The latest production spot check is still mixed: context-map returned 12
findings, sql-optimization returned 20 findings including 7 ambiguity findings,
and audit-integrity returned 15 findings. That is much cleaner than the earlier
sql-optimization 60-ambiguity flood, but it is not stable enough to support a
formal accuracy claim.

The remediation plan is in [plan.yaml](plan.yaml).

## Release Criteria

- Default installation can run analysis without model-selection dead ends.
- OpenRouter multi-model routing actually uses `deepModel` for deep waves.
- Clean-fixture calibration is a required release gate, not a manual script.
- Public docs describe current recall honestly and consistently.
- Single-pass, focused, MCP, and VS Code paths share the same filtering,
  scoring, and accepted-finding behavior.
- Prompt/analyzer changes are validated against real production skills, not
  only clean calibration fixtures.
