# Skills Review and Polish - Full Technical Details

## The Problem

AI models are incredibly literal readers. They don't "understand intent" — they follow what you actually wrote, not what you meant. Most developers treat LLM instructions like "just write what you want" and watch their carefully crafted skills produce inconsistent, contradictory, or outright wrong results.

## The Solution

**Skills Review and Polish** is a VS Code extension that applies **6-wave LLM analysis** to catch the silent killers in your AI instructions before they bite.

### The 6 Waves

1. **Contradiction detection** — Finds when your rules conflict
2. **Ambiguity analysis** — Flags vague terms that models interpret differently
3. **Coverage gaps** — Identifies missing scenarios
4. **Persona consistency** — Catches voice shifts mid-document
5. **Cognitive load warnings** — Flags overly complex instructions
6. **Hygiene cleanup** — Redundant rules, dead references

## The Model Testing Twist

We deliberately DON'T use expensive reasoning models. After testing **47 models across 340 production skills**, we found standard-tier models (like `google/gemini-2.5-flash-lite`) outperform reasoning models. They're ~10x cheaper, faster, and produce more actionable findings.

**Claude Haiku was rejected** — the same file could report 6 issues one run, 22 another. Consistency matters.

## Post-Processor

The post-processor suppresses false positives deterministically, giving you clean feedback without noise. Today this is deterministic suppression; the long-term direction is broader diagnostic refinement.

## The Meta-Problem

AI models struggle to write good prompts. When we asked models to write their own skills, they produced pages of flowery prose and vague guidance. Humans do the same — we write in natural language, but models need precise, deterministic rules.

## MCP Server

The **MCP server** provides a 7-tool headless interface for agent-mode usage:

- `analyze()` — Run full analysis
- `fix()` — Apply surgical fixes
- `score()` — Get quality scores
- `verify_fix()` — Validate changes
- `accept_finding()` — Accept specific findings
- `list_accepted_findings()` — View accepted items
- `health()` — Check system status

This lets models analyze their own prompts as they write them.

## Model Picker

Shows 💰 pricing and ctx= context length, with starred recommendations. Assign different models to different waves — `model` for standard analysis, `deepModel` for contradictions, `fixModel` for surgical fixes.

## Real Results (5×3 clean fixtures)

- **87.3% recall** on known issues
- **63-73% precision** (targeting ≥85%)
- **Deterministic output** (9 of 10 runs identical)

## Experimental Insight

Focused-mode analysis (single category per run) achieves **98% detection vs 5.7% in single-mode** — LLM attention dilutes across 6 categories in combined prompts.

## Security Hardening

The codebase was hardened through Gilfoyle-style security reviews — **23 issues found in the fresh review and remediated through severity-ordered waves**.

## Get Started

Skills Review and Polish is live on the VS Code marketplace:
<https://marketplace.visualstudio.com/items?itemName=mutl3y.skills-review-and-polish>
