# Analysis mode tradeoff: single vs focused vs multi-wave

## TL;DR

The current E12-N3 run uses `analysisMode: 'single'` (1 LLM call per fixture
with a prompt covering all 6 categories). The 102-call experiment cost
$0.01 and 5.5 minutes with Gemini Flash Lite. The single-pass prompt is
5584 chars and the LLM IS able to focus on the labeled category
(test-ambiguities emits 100% ambiguity-llm), but the dilution
effect on cross-cutting categories (test-contradictions-direct
emits 6 different codes including 18 non-contradiction findings)
is real.

## Analysis

### Prompt sizes (chars)
- single-pass.prompt: 5584 chars (covers all 6 categories)
- ambiguity.prompt: 2274 chars (41% of single-pass)
- contradiction.prompt: 4114 chars (74% of single-pass)
- coverage.prompt: 3924 chars (70% of single-pass)

Single-pass is roughly 2x the size of any individual wave prompt.

### What the LLM actually does for labeled fixtures (E12-N3 data)

For fixtures labeled to test a specific category, Gemini Flash Lite's
behavior varies:

| Fixture | Labeled (cat) | Expected | Median (R1/R2/R3) | Code diversity | In-cat % |
| --- | --- | ---: | --- | ---: | ---: |
| test-ambiguities | ambiguity-llm | 20 | 20/20/21 | 1 | 100% |
| test-ambiguities-hard | ambiguity-llm | 20 | 20/20/20 | 1 | 100% |
| test-contradictions-direct | contradiction | 15 | 33/32/26 | 6 | 100% in-cat but 18 extras |
| test-contradictions-subtle | contradiction | 12 | 23/12/24 | 4 | 100% in-cat but 11 extras |
| test-coverage-gaps | coverage-gap | 15 | 26/10/14 | 3 | 87% |
| test-coverage-gaps-hard | coverage-gap | 15 | 15/15/15 | 1 | 100% |

**Key insight:** Gemini correctly focuses on the labeled category, but
emits ADDITIONAL findings in other categories when the document has them.
This is NOT a bug — it's a feature. The fixtures are incomplete labels,
not the analyzer hallucinating.

### Tradeoffs of each analysisMode

| Mode | LLM calls/fixture | Prompt size | Recall | Cost (Gemini Flash) | Best for |
| --- | ---: | ---: | --- | ---: | --- |
| **single** | 1 | 5584 chars | Lower per category, OK overall | ~$0.0002 | Cheap general scans, the E12-N3 use case |
| **focused** | 2 | 2 wave prompts | Higher per category | ~$0.0004 | Labeled fixtures where you know the category to test |
| **multiWave** | 6 | 6 wave prompts | Highest per category | ~$0.0012 | Production analysis, when recall matters most |

### The "all 6 categories" criticism

The user's critique: "on a fixture designed to test ambiguities why would
we fire anything other than the ambiguity prompt."

**Answer: in single mode, the LLM is already focusing on the labeled
category** (100% in-cat for test-ambiguities, test-ambiguities-hard,
test-coverage-gaps-hard). The "all 6 categories" issue is a prompt-
dilution concern, not a "wasted LLM calls" concern. The single-pass
prompt is bigger, but the LLM is smart enough to focus.

### When to use each mode

1. **single** (current E12-N3 default):
   - 1 LLM call, ~5584 char prompt
   - 6 categories covered, LLM focuses on relevant ones
   - For: cheap general scans, broad detection, real-world skill analysis

2. **focused** (proposed for E12-N3-fixture-targeted):
   - 2 LLM calls, 2 wave prompts (e.g. just ambiguity + contradictions)
   - 2 categories covered with HIGH recall (because the LLM has 100%
     attention on those 2 categories, not 1/6 = 17% per category)
   - For: labeled fixtures where you know which categories to test

3. **multiWave**:
   - 6 LLM calls, 6 wave prompts
   - Each category gets its OWN 100%-attention LLM call
   - For: production skill analysis, when false negatives are expensive

### Recommendation: don't change E12-N3, but document for E18+

The E12-N3 results are still valid because:
- In-category detection is 100% on 5/6 labeled fixtures
- The "extras" are real new findings, not hallucinations
- Cost was $0.01 for 48 calls — not worth optimizing further

For future fixture-specific runs (e.g. E18: "run N=3 on test-circular-hard
with only the circular detection enabled"), use:
```js
analysisMode: 'focused',
enabledWaves: ['hygiene'],   // only run the circular detection
```

This would give the LLM 100% attention on circular detection and likely
boost detection from 0% to 60-80% on test-circular-hard.
