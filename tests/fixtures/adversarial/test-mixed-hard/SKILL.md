---
name: ml-model-deployment-governance
description: Guides ML engineers and governance teams through the deployment, monitoring, and lifecycle management of machine learning models in production, including fairness review, data lineage, and model versioning.
---

# ML Model Deployment and Governance

Use this skill to manage the deployment lifecycle, governance checkpoints, and operational monitoring of machine learning models.

> **Test metadata:** 16 injected hard mixed issues across all structural and ambiguity sub-types.
>
> | Label | Category | Sub-type | Pattern |
> |---|---|---|---|
> | MIX-H-WASTE-1 | structural | context_waste — preamble | Extended historical commentary before first instruction |
> | MIX-H-WASTE-2 | structural | context_waste — verbatim repetition | Identical drift monitoring instruction in two sections |
> | MIX-H-DIRECT-1 | contradiction | direct | Explainability required for all models ↔ exempt for rule-based models (unlabeled partner) |
> | MIX-H-DIRECT-2 | contradiction | direct | Retraining triggered at 5% drift ↔ retraining triggered at 10% drift |
> | MIX-H-AMBIG-1 | ambiguity | undefined threshold | "significant performance degradation" |
> | MIX-H-AMBIG-2 | ambiguity | undefined actor | "the appropriate team" for model sign-off |
> | MIX-H-OBLIG-1 | ambiguity | obligation_strength | "where practicable, ensure" with no measurable criterion |
> | MIX-H-OBLIG-2 | ambiguity | obligation_strength | "take reasonable steps" |
> | MIX-H-RESP-1 | ambiguity | responsibility_ambiguity | Passive voice — "a fairness review must be conducted" |
> | MIX-H-RESP-2 | ambiguity | responsibility_ambiguity | "use your judgment" for bias threshold |
> | MIX-H-DEAD-1 | structural | dead_instruction | MLflow log_model using deprecated `conda_env` parameter |
> | MIX-H-DEAD-2 | structural | dead_instruction | SageMaker `update_endpoint` with deprecated `RetainAllVariantProperties` flag |
> | MIX-H-CIRC-1 | structural | circular_definition | Model drift ↔ drift detection threshold |
> | MIX-H-CIRC-2 | structural | circular_definition | Feature importance ↔ model explainability |
> | MIX-H-GAP-1 | coverage_gap | silent — no label in body | No guidance on model rollback procedure |
> | MIX-H-GAP-2 | coverage_gap | silent — no label in body | No guidance on training data versioning / lineage |
>
> Note: MIX-H-GAP-1 and MIX-H-GAP-2 have NO marker in the body text — the analyzer
> must infer the gaps from the absence of those topics in an otherwise comprehensive guide.
> MIX-H-DIRECT-1 has an unlabeled partner in the Explainability section.
> Expected categories: `structural` for WASTE/DEAD/CIRC labels; `ambiguity` for
> AMBIG/OBLIG/RESP labels; `contradiction` for DIRECT labels; `coverage_gap` for GAPs.

---

## Background

### [MIX-H-WASTE-1]
Machine learning has undergone several paradigm shifts since the perceptron was first described by Frank Rosenblatt in 1958. The field progressed through symbolic AI, the first and second AI winters, the backpropagation renaissance of the 1980s, the kernel methods era of the 1990s, and the deep learning revolution catalysed by ImageNet in 2012. Today's production ML systems are qualitatively different from those of even five years ago: they are larger, trained on richer data, deployed in higher-stakes contexts, and governed by an increasingly demanding regulatory environment — including the EU AI Act and comparable frameworks in other jurisdictions. Against this backdrop, responsible deployment governance is not merely a compliance exercise; it is a precondition for sustained trust in AI-assisted decision-making across the organisation. This governance guide should therefore be understood not as a bureaucratic checklist but as a codification of the organisation's collective commitment to responsible AI. With that context in mind, the following sections describe the deployment and governance procedures that apply to all production machine learning models.

---

## Model Registration and Versioning

All models must be registered in the MLflow Model Registry before deployment. Each registered model version must include: training data reference, training code version (Git SHA), evaluation metrics, and a link to the experiment run.

**[MIX-H-DEAD-1]** When logging a model to MLflow with its conda environment specification, use the `conda_env` parameter:
```python
mlflow.sklearn.log_model(
    sk_model=model,
    artifact_path="model",
    conda_env="conda.yaml"
)
```
The `conda.yaml` file must list all runtime dependencies at pinned versions.

Models must be promoted through the `Staging` → `Production` stages in the registry. Direct promotion from `None` to `Production` is not permitted without a documented governance exception.

---

## Pre-Deployment Governance Checks

Before any model is promoted to Production in the registry, the following checks must be completed and signed off in the model card.

**[MIX-H-DIRECT-1]** All models deployed to production must provide a human-interpretable explanation for every individual prediction. The explanation must be generated by an approved explainability method (SHAP, LIME, integrated gradients) and must be logged alongside each prediction in the prediction store.

**[MIX-H-RESP-1]** A fairness review must be conducted against the protected characteristics applicable to the use case before the model is promoted to Production.

**[MIX-H-AMBIG-2]** Once all governance checks are complete, the appropriate team must sign off the model card before the promotion step is executed.

**[MIX-H-OBLIG-1]** Ensure, where practicable, that evaluation datasets are representative of the full distribution of inputs the model will encounter in production, including edge cases and minority sub-populations.

---

## Production Monitoring

All production models must be monitored continuously. The monitoring configuration must be committed to the model's GitOps repository alongside the deployment manifests.

**[MIX-H-WASTE-2]** Model performance drift must be monitored using a statistical test (PSI, KS test, or equivalent) applied to a rolling window of production predictions. Alerts must be triggered when drift exceeds the configured threshold.

**[MIX-H-DIRECT-2]** When the drift metric for a production model exceeds 5% relative to the baseline distribution, an automated retraining job must be triggered.

**[MIX-H-AMBIG-1]** If a model shows significant performance degradation over the monitoring window, the owning team must initiate a root cause analysis within 48 hours.

**[MIX-H-RESP-2]** When evaluating model fairness metrics on production data, use your judgment to determine whether the observed disparity between demographic groups constitutes an actionable bias issue.

---

## Model Retirement and Updates

Models may be superseded by a new version or retired if the use case is discontinued. Both paths require governance sign-off.

**[MIX-H-CIRC-1]**
**Model drift** is detected when the drift monitoring score exceeds the drift detection threshold.
The **drift detection threshold** is the score value above which model drift is considered to have occurred.

When a model is superseded, the outgoing version must be archived in the registry. Archived models must not be re-promoted to Production without repeating the full governance process.

**[MIX-H-DEAD-2]** To update a SageMaker endpoint in place while retaining existing traffic distribution across all variants, use the `RetainAllVariantProperties` flag:
```python
sagemaker_client.update_endpoint(
    EndpointName="my-endpoint",
    EndpointConfigName="my-new-config",
    RetainAllVariantProperties=True,
    ExcludedVariantProperties=[]
)
```

**[MIX-H-OBLIG-2]** Take reasonable steps to notify downstream application teams of any model version change that could affect the distribution of outputs before the change is applied to the production endpoint.

---

## Explainability and Transparency

**[MIX-H-CIRC-2]**
**Feature importance** is a measure of how much each input feature contributes to the model's explainability score.
**Model explainability** is quantified by aggregating the feature importance values across the prediction set.

The model card must include a plain-language description of the model's intended use, known limitations, and the populations for which evaluation data is available. Model cards must be kept up to date whenever the model is retrained.

Rule-based decision systems that do not use learned weights are exempt from the explainability requirement. The model governance process for rule-based systems is limited to a documented business logic review.

---

## Monitoring Cadence (Repeat Reference)

**[MIX-H-WASTE-2 — second occurrence]**
Model performance drift must be monitored using a statistical test (PSI, KS test, or equivalent) applied to a rolling window of production predictions. Alerts must be triggered when drift exceeds the configured threshold.

The retraining trigger threshold must be reviewed and re-validated whenever the model is retrained. Stale drift thresholds that no longer reflect the model's expected distribution are a common source of missed degradation events.

**[MIX-H-DIRECT-2 — conflicting occurrence]** An automated retraining job is triggered when the drift metric exceeds 10% relative to the baseline distribution, as assessed at the weekly monitoring checkpoint.
