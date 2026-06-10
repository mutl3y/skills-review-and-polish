# Documentation: Planning & Release

Core planning documents for the Skills Review and Polish project. For practical development workflows, see [../DEVELOPER-GUIDE.md](../DEVELOPER-GUIDE.md).

## Documents (3 core files)

| Document | Purpose | Audience |
| --- | --- | --- |
| [PROGRESS.md](PROGRESS.md) | Implementation status snapshot + known limitations | Stakeholders, new contributors |
| [LEARNINGS.md](LEARNINGS.md) | **READ THIS FIRST:** Hard-won engineering lessons from analyzer tuning | Anyone changing analyzer, fixer, or scoring |

## Archived Plans

Completed plans have been moved to [`archive/`](archive/). Convention: `archive/{category}/YYYYMMDD-plan-name/plan.yaml`.

| Category | Files | Description |
| --- | --- | --- |
| [`archive/gilfoyle-reviews/`](archive/gilfoyle-reviews/) | 9 files across 3 subdirs + 4 standalone | All Gilfoyle review & remediation iterations |
| [`archive/releases/RELEASE-IMPLEMENTATION-PLAN.md`](archive/releases/RELEASE-IMPLEMENTATION-PLAN.md) | 1 file | 5-phase release gate verification |
| [`archive/infrastructure/MCP-IMPROVEMENT-PLAN.md`](archive/infrastructure/MCP-IMPROVEMENT-PLAN.md) | 1 file | MCP server improvement plan |

## Quick Navigation

**Modifying the analyzer?** Read [LEARNINGS.md](LEARNINGS.md) first — covers noise floor, model choice, why things are designed the way they are.

**What's the status?** See [PROGRESS.md](PROGRESS.md) for implementation summary and known limitations.

**Developer workflows?** Jump to [../DEVELOPER-GUIDE.md](../DEVELOPER-GUIDE.md).
