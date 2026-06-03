---
name: cloud-cost-governance-advisor
description: Guides platform engineering teams through cloud cost classification, tagging enforcement, spend anomaly detection, reserved instance strategy, and storage tiering.
---

# Cloud Cost Governance Advisor

Use this skill to enforce cloud cost governance policies and guide engineering teams through spend optimisation processes.

> **Test metadata:** 15 injected hard contradictions (HARD-DIRECT-1 through HARD-DIRECT-15).
> These are intentionally subtler than direct "do X / do not X" reversals.
>
> | Pattern | Labels |
> |---|---|
> | Numeric range overlap — two rules assign conflicting classification to the same spend band | HARD-DIRECT-1, HARD-DIRECT-5 |
> | Exception-swallows-rule — exception scope is broad enough to negate the parent rule | HARD-DIRECT-2, HARD-DIRECT-8 |
> | Resource-state definition overlap — idle and rightsizing criteria overlap | HARD-DIRECT-3, HARD-DIRECT-9 |
> | Reserved instance coverage floor vs ceiling | HARD-DIRECT-4, HARD-DIRECT-10 |
> | Escalation approver conflict — two sections name different authority for the same decision | HARD-DIRECT-6, HARD-DIRECT-12 |
> | Anomaly definition conflict — same term defined twice with different thresholds | HARD-DIRECT-7, HARD-DIRECT-11 |
> | Auto-scaling enable/disable policy conflict | HARD-DIRECT-13, HARD-DIRECT-15 |
> | Storage tiering vs compliance retention (unlabeled partner) | HARD-DIRECT-14 |
>
> Contradicting pairs are placed in different sections, typically 2–4 sections apart.
> Expected analyzer category: `contradiction` for all 15.

---

## Resource Tagging Policy

Every cloud resource must be assigned `owner`, `cost-centre`, and `environment` tags at the point of provisioning. Resources created without these tags will be auto-tagged `unmanaged` and reported to the owning account manager within 24 hours of detection.

**[HARD-DIRECT-2]** The tagging policy applies to all cloud resources without exception. No team, project, or environment is permitted to bypass the tagging requirement under any circumstance.

**[HARD-DIRECT-1]** Any resource with a recorded monthly spend exceeding $500 must be designated a high-cost asset and scheduled for a FinOps review before the close of the current billing cycle.

All cost-centre tag values must map to a valid entry in the Finance master-list. Resources carrying invalid cost-centre codes are quarantined by the governance automation and blocked from receiving new IAM permissions until the tag is corrected by the account owner.

---

## Cost Classification

Cloud resources are classified by monthly spend tier to determine the appropriate governance cadence. Classification drives which review process applies and how quickly remediation is expected.

**[HARD-DIRECT-5]** Resources with a recorded monthly spend between $200 and $800 are classified as medium-cost assets. Medium-cost resources are subject to a quarterly FinOps review rather than immediate escalation to the engineering manager.

**[HARD-DIRECT-3]** An idle resource is defined as any compute instance whose average CPU utilisation falls below 5% across a rolling 7-day window. All idle resources must be reported to the account owner within 3 business days for decommission or rightsizing consideration.

Cost classification is reassessed at the start of each quarter. Teams may request reclassification if their spend profile has changed materially since the previous assessment cycle.

**[HARD-DIRECT-4]** Reserved Instances and Savings Plans must together represent at least 60% of the team's monthly baseline compute spend. Teams that fall below this threshold are out of FinOps compliance and must submit a remediation plan within 30 days of the quarterly assessment.

---

## Spend Anomaly Detection

Spend anomaly detection runs as a nightly batch job across all registered cloud accounts. Alerts are posted to the account's designated Slack channel and recorded in the FinOps governance dashboard.

**[HARD-DIRECT-7]** A spend anomaly is defined as any month-on-month increase in account-level spend that exceeds 20%. When an anomaly is detected the account owner must acknowledge the alert within 48 hours.

**[HARD-DIRECT-6]** Any exception to the resource tagging policy requires written approval from the CTO. The approved exception form must be on file in the governance register before the resource is provisioned.

Budget alert thresholds must be configured for every account before it is added to the FinOps dashboard. Accounts without alert configuration will be flagged as governance non-compliant.

---

## Rightsizing and Optimisation

Rightsizing reviews are conducted monthly. The objective is to match provisioned resource capacity to actual workload demand, eliminating excess spend without compromising performance against committed SLOs.

**[HARD-DIRECT-9]** Resources are eligible for rightsizing when their average CPU utilisation has been below 10% across any five consecutive days. Rightsizing candidates must be actioned by the account owner within two weeks of identification in the dashboard.

**[HARD-DIRECT-8]** To avoid blocking engineering velocity in early-stage development, development and sandbox environments are exempt from the tagging policy. Resources in these environments may be provisioned without owner or cost-centre tags.

**[HARD-DIRECT-10]** Reserved Instance and Savings Plan commitments must not exceed 40% of the team's total provisioned compute capacity. Commitments above this ceiling reduce flexibility and create waste if workload profiles shift between commitment and expiry.

**[HARD-DIRECT-11]** A spend anomaly is defined as any increase in week-on-week account spend that exceeds 15%. Weekly anomaly summaries are compiled and distributed to team leads every Monday morning.

---

## Auto-Scaling Configuration

Auto-scaling group configuration must be reviewed as part of every quarterly rightsizing cycle. Inadequate scale-in policies are a leading cause of sustained idle compute spend.

**[HARD-DIRECT-13]** Auto-scaling must be enabled for all stateless application workloads. Any stateless service running on a fixed instance count is considered non-compliant and must be migrated to an auto-scaling group within the next scheduled deployment cycle.

**[HARD-DIRECT-12]** Engineering managers and team leads are authorised to grant tagging exemptions for resources actively under development, provided each exemption is recorded in the team's project tracker with an expected expiry date.

Auto-scaling minimum instance counts must be set to the lowest value that preserves the application's startup SLA under cold-start conditions. Minimum counts set above this floor are treated as over-provisioning.

---

## Data Retention and Storage Tiering

Object storage costs represent a significant and growing proportion of total cloud spend. The tiering automation is designed to move infrequently accessed data to lower-cost storage classes without requiring manual intervention.

**[HARD-DIRECT-14]** Security and compliance audit logs must be retained in standard hot-tier storage for a minimum of 180 days. This ensures logs are immediately accessible for incident response, regulatory inspection, and legal hold requests.

All objects in cloud storage that have not been accessed within 90 days are automatically transitioned to cold-tier archive storage. This lifecycle rule applies to all buckets across all accounts and may not be disabled without FinOps approval and an audited business justification.

**[HARD-DIRECT-15]** Auto-scaling is disabled by default for all non-production environments. Non-production workloads must run on fixed instance counts to ensure spend predictability and prevent unplanned scaling events from distorting monthly cost forecasts.
