---
name: healthcare-records-management-system
description: Guides clinical informatics staff through the management, access control, retention, and disposal of electronic health records in compliance with applicable healthcare privacy regulations.
---

# Healthcare Records Management System

Use this skill to manage the lifecycle of electronic health records, ensuring compliance with clinical governance, data protection obligations, and audit requirements.

> **Test metadata:** 15 injected weak obligation issues (HARD-OBLIG-1 through HARD-OBLIG-15).
> These are deliberately harder to detect than direct "try to / should" patterns.
> Each labeled instruction appears to impose a strong requirement but is hedged in a way
> that makes compliance discretionary or unmeasurable.
>
> | Pattern | Labels |
> |---|---|
> | "ensure... where practicable" — "where practicable" undermines the "ensure" | HARD-OBLIG-1, HARD-OBLIG-7 |
> | "take reasonable steps" — sounds like a requirement, infinitely hedgeable | HARD-OBLIG-2, HARD-OBLIG-10 |
> | "best endeavours" / "best efforts" — not a deterministic standard | HARD-OBLIG-3, HARD-OBLIG-14 |
> | "as appropriate" / "where appropriate" — vests discretion in the reader | HARD-OBLIG-4, HARD-OBLIG-11 |
> | Vague measure word: "adequate", "suitable", "proportionate" | HARD-OBLIG-5, HARD-OBLIG-8, HARD-OBLIG-13 |
> | "timely" / "periodic" — undefined frequency or timeframe | HARD-OBLIG-6, HARD-OBLIG-9 |
> | Delegated standard: "as required" references no named document | HARD-OBLIG-12 |
> | Double hedge: two weakening phrases in one instruction | HARD-OBLIG-15 |
>
> Note: Instructions NOT labeled below use hard imperatives ("must", "always", imperative
> form) with concrete criteria — those are correct and should NOT be flagged.
> Expected analyzer category: `ambiguity` (obligation_strength) for all 15.

---

## Record Access and Authentication

All access to electronic health records must require multi-factor authentication. Single-factor authentication to any system holding patient records is non-compliant and must be remediated within 30 days of identification.

**[HARD-OBLIG-1]** Ensure, where practicable, that access to patient records is logged with sufficient granularity to reconstruct who accessed which record and at what time.

Access privileges must be assigned on a least-privilege basis. Each clinical staff member must be granted access only to the patient records relevant to their active care relationships.

**[HARD-OBLIG-2]** Take reasonable steps to verify that access privileges are revoked promptly when a staff member's employment or placement ends.

**[HARD-OBLIG-3]** Use best endeavours to prevent unauthorised access to records held on portable devices, including through the use of device encryption and remote wipe capabilities.

---

## Data Accuracy and Integrity

Clinical records must accurately reflect the care provided. Inaccurate records can result in clinical harm and regulatory sanction.

Every record amendment must be logged with the identity of the amending clinician, the original value, the amended value, and a clinical justification. Deletions are not permitted; amendments must preserve the original entry.

**[HARD-OBLIG-4]** Verify, as appropriate, that records amended outside normal clinical workflow have been reviewed and countersigned by a senior clinician.

**[HARD-OBLIG-5]** Implement adequate controls to detect and prevent duplicate patient records being created for the same individual across connected systems.

**[HARD-OBLIG-6]** Review the accuracy of patient demographic data, including address and next-of-kin details, on a periodic basis.

---

## Data Retention and Disposal

Patient records must be retained for the minimum period required by the applicable regulatory framework. The retention schedule must be approved by the Clinical Records Manager and reviewed annually.

**[HARD-OBLIG-7]** Ensure, where practicable, that records approaching the end of their retention period are flagged for clinical review before disposal is authorised.

Records must be disposed of using approved destruction methods. Physical records must be cross-cut shredded or incinerated. Digital records must be overwritten using an approved data wiping standard.

**[HARD-OBLIG-8]** Apply suitable de-identification or anonymisation before any patient records are used for research, audit, or quality improvement purposes.

---

## Third-Party Data Sharing

Patient data must only be shared with third parties who are bound by a Data Sharing Agreement approved by the Data Protection Officer.

**[HARD-OBLIG-9]** Review all active data sharing arrangements on a timely basis to confirm that they remain necessary and that the receiving party continues to meet the agreed security standards.

**[HARD-OBLIG-10]** Take reasonable steps to ensure that data transferred to third parties is transmitted over encrypted channels and that unencrypted email is not used for patient data.

**[HARD-OBLIG-11]** Where appropriate, include contractual clauses in new data sharing agreements requiring the third party to notify the organisation in the event of a security incident affecting the shared data.

---

## Incident Management

All security incidents involving patient data must be reported to the Data Protection Officer within 24 hours of detection. The DPO must determine whether the incident is notifiable to the regulator within the statutory timeframe.

**[HARD-OBLIG-12]** Document each data breach in the format required, retaining all supporting evidence and correspondence.

**[HARD-OBLIG-13]** Implement proportionate remediation measures following any confirmed data breach, addressing the root cause identified in the post-incident review.

---

## Security and Technical Controls

All systems storing or processing patient records must be covered by the organisation's vulnerability management programme. Critical and High vulnerabilities must be remediated within 30 and 90 days respectively.

**[HARD-OBLIG-14]** Use best efforts to apply security patches to clinical systems within the vulnerability management programme's target timeframe, taking into account the clinical continuity impact of any required downtime.

**[HARD-OBLIG-15]** Where possible and as appropriate, apply data minimisation principles to any new clinical data collection initiative so that only the information strictly necessary for the clinical purpose is captured.
