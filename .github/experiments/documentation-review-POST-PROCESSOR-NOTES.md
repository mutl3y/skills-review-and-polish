# Post Processor Notes

## Purpose

The post processor exists to improve the quality of analyzer output after findings have been generated.

Its objective is **not** to reduce the number of findings.

Its objective is to improve the signal-to-noise ratio presented to the user.

---

# Guiding Principle

Treat the post processor as a diagnostic refinement stage rather than a suppression stage.

A finding should only disappear if there is a clear, explainable reason why it should not be presented.

Every suppression should be considered a hypothesis that can be inspected and validated.

---

# Desired Characteristics

The post processor should:

- remove duplicate findings
- merge equivalent findings
- improve finding clarity
- rank findings by importance
- identify probable false positives
- preserve evidence explaining every decision

The post processor should not:

- silently discard findings
- hide analyzer weaknesses
- compensate for poor analyzer heuristics
- change the meaning of findings

---

# Preferred Pipeline

Analyzer

↓

Raw Findings

↓

Post Processor

↓

Reviewed Findings

↓

User

Retaining access to the raw findings is valuable for debugging and analyzer development.

---

# Transparency

Every post-processing action should ideally be explainable.

Examples include:

- Duplicate merged
- Lower-confidence duplicate suppressed
- Finding reclassified
- Related findings grouped
- Candidate false positive identified

The user should be able to understand why a finding changed.

---

# Metrics

Track both raw and processed output.

Suggested metrics:

- Raw Findings
- Processed Findings
- Suppressed Findings
- Merged Findings
- Reclassified Findings
- Candidate False Positives

These metrics help distinguish improvements in the analyzer from improvements in presentation.

---

# Evaluation

When comparing analyzer versions, evaluate both:

## Precision

How many reported findings are genuinely useful?

## Recall

How many genuine issues were successfully detected?

Reducing false positives must not significantly reduce recall.

---

# Experimentation

When evaluating prompt revisions, record:

- Raw analyzer findings
- Processed findings
- Differences introduced by the post processor

This makes it possible to determine whether improvements originated from:

- better prompts
- better analyzer heuristics
- better post processing

These should not be conflated.

---

# Future Enhancements

Potential future capabilities include:

- confidence recalculation
- duplicate clustering
- semantic grouping
- root-cause grouping
- severity normalization
- evidence enrichment
- recommendation prioritization

These features should improve diagnostic quality without obscuring analyzer behaviour.

---

# Long-Term Vision

The post processor should evolve into a diagnostic reasoning layer rather than a filtering layer.

Its role is to help users understand findings, not merely reduce their number.

Ideally every reported finding should answer three questions:

1. Why was this finding produced?

2. Why is this finding important?

3. What evidence supports this finding?

Providing this context increases trust while making the analyzer easier to improve over time.

---

# Success Criteria

The post processor is successful when:

- users spend less time reviewing low-value findings
- genuine issues remain visible
- analyzer weaknesses become easier to identify
- every suppression is explainable
- analyzer improvements can be measured independently from post-processing improvements

A lower finding count is not, by itself, evidence of a better analyzer.

# learn as you go

Do not allow the post-processor become a "magic fixer." If you find yourself adding increasingly complex rules to compensate for analyzer shortcomings, that's often a signal that the underlying heuristic should be improved instead.

A useful rule of thumb might be:

- **Analyzer**: "Was this issue detected correctly?"
- **Post-processor**: "How should this issue be presented?"
- **UI**: "How should the user consume this issue?"

Keeping these responsibilities separate will make the system much easier to evolve and reason about over time.
