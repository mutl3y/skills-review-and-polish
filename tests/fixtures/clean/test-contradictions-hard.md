---
name: cloud-cost-governance-advisor
description: Guides platform engineering teams through cloud cost classification, tagging enforcement, spend anomaly detection, reserved instance strategy, and storage tiering.

# Cloud Cost Governance Advisor

Use this skill to enforce cloud cost governance policies and guide engineering teams through spend optimisation processes.

## Resource Tagging Policy

Every cloud resource must be assigned `owner`, `cost-centre`, and `environment` tags at the point of provisioning. Resources created without these tags will be auto-tagged `unmanaged` and reported to the owning account manager within 24 hours of detection.

**** The tagging policy applies to all cloud resources without exception. No team, project, or environment is permitted to bypass the tagging requirement under any circumstance.

**** Any resource with a recorded monthly spend exceeding $500 must be designated a high-cost asset and scheduled for a FinOps review before the close of the current billing cycle.

All cost-centre tag values must map to a valid entry in the Finance master-list. Resources carrying invalid cost-centre codes are quarantined by the governance automation and blocked from receiving new IAM permissions until the tag is corrected by the account owner.

## Cost Classification

Cloud resources are classified by monthly spend tier to determine the appropriate governance cadence. Classification drives which review process applies and how quickly remediation is expected.

**** Resources with a recorded monthly spend between $200 and $800 are classified as medium-cost assets. Medium-cost resources are subject to a quarterly FinOps review rather than immediate escalation to the engineering manager.

**** An idle resource is defined as any compute instance whose average CPU utilisation falls below 5% across a rolling 7-day window. All idle resources must be reported to the account owner within 3 business days for decommission or rightsizing consideration.

Cost classification is reassessed at the start of each quarter. Teams may request reclassification if their spend profile has changed materially since the previous assessment cycle.

**** Reserved Instances and Savings Plans must together represent at least 60% of the team's monthly baseline compute spend. Teams that fall below this threshold are out of FinOps compliance and must submit a remediation plan within 30 days of the quarterly assessment.

## Spend Anomaly Detection

Spend anomaly detection runs as a nightly batch job across all registered cloud accounts. Alerts are posted to the account's designated Slack channel and recorded in the FinOps governance dashboard.

**** A spend anomaly is defined as any month-on-month increase in account-level spend that exceeds 20%. When an anomaly is detected the account owner must acknowledge the alert within 48 hours.

**** Any exception to the resource tagging policy requires written approval from the CTO. The approved exception form must be on file in the governance register before the resource is provisioned.

Budget alert thresholds must be configured for every account before it is added to the FinOps dashboard. Accounts without alert configuration will be flagged as governance non-compliant.

## Rightsizing and Optimisation

Rightsizing reviews are conducted monthly. The objective is to match provisioned resource capacity to actual workload demand, eliminating excess spend without compromising performance against committed SLOs.

**** Resources are eligible for rightsizing when their average CPU utilisation has been below 10% across any five consecutive days. Rightsizing candidates must be actioned by the account owner within two weeks of identification in the dashboard.

**** To avoid blocking engineering velocity in early-stage development, development and sandbox environments are exempt from the tagging policy. Resources in these environments may be provisioned without owner or cost-centre tags.

**** Reserved Instance and Savings Plan commitments must not exceed 40% of the team's total provisioned compute capacity. Commitments above this ceiling reduce flexibility and create waste if workload profiles shift between commitment and expiry.

**** A spend anomaly is defined as any increase in week-on-week account spend that exceeds 15%. Weekly anomaly summaries are compiled and distributed to team leads every Monday morning.

## Auto-Scaling Configuration

Auto-scaling group configuration must be reviewed as part of every quarterly rightsizing cycle. Inadequate scale-in policies are a leading cause of sustained idle compute spend.

**** Auto-scaling must be enabled for all stateless application workloads. Any stateless service running on a fixed instance count is considered non-compliant and must be migrated to an auto-scaling group within the next scheduled deployment cycle.

**** Engineering managers and team leads are authorised to grant tagging exemptions for resources actively under development, provided each exemption is recorded in the team's project tracker with an expected expiry date.

Auto-scaling minimum instance counts must be set to the lowest value that preserves the application's startup SLA under cold-start conditions. Minimum counts set above this floor are treated as over-provisioning.

## Data Retention and Storage Tiering

Object storage costs represent a significant and growing proportion of total cloud spend. The tiering automation is designed to move infrequently accessed data to lower-cost storage classes without requiring manual intervention.

**** Security and compliance audit logs must be retained in standard hot-tier storage for a minimum of 180 days. This ensures logs are immediately accessible for incident response, regulatory inspection, and legal hold requests.

All objects in cloud storage that have not been accessed within 90 days are automatically transitioned to cold-tier archive storage. This lifecycle rule applies to all buckets across all accounts and may not be disabled without FinOps approval and an audited business justification.

**** Auto-scaling is disabled by default for all non-production environments. Non-production workloads must run on fixed instance counts to ensure spend predictability and prevent unplanned scaling events from distorting monthly cost forecasts.