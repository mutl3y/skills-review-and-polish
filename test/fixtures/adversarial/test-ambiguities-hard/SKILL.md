---
name: data-breach-response-coordinator
description: Guides security and legal teams through the identification, assessment, notification, and documentation of personal data breaches under applicable privacy regulations.
---

# Data Breach Response Coordinator

Use this skill to manage data breach response activities from initial detection through regulatory notification and remediation.

> **Test metadata:** 20 injected subtle ambiguities (HARD-AMBIG-1 through HARD-AMBIG-20).
> Each labeled term or phrase sounds authoritative and precise but contains an undefined
> threshold, criterion, scope, or actor that a practitioner cannot act on without guessing.
>
> | Ambiguity type | Labels |
> |---|---|
> | Undefined legal threshold ("material", "significant", "substantial") | HARD-AMBIG-1, HARD-AMBIG-4, HARD-AMBIG-17 |
> | Undefined timeframe ("timely", "recently", "promptly", "without undue delay") | HARD-AMBIG-2, HARD-AMBIG-6, HARD-AMBIG-14 |
> | Undefined scope ("all affected parties", "relevant systems", "sensitive data") | HARD-AMBIG-3, HARD-AMBIG-8, HARD-AMBIG-19 |
> | Undefined actor ("senior management", "relevant authorities", "appropriate team") | HARD-AMBIG-5, HARD-AMBIG-11, HARD-AMBIG-18 |
> | Undefined standard ("appropriate measures", "standard industry practice", "adequate controls") | HARD-AMBIG-7, HARD-AMBIG-10, HARD-AMBIG-13 |
> | Undefined effort ("reasonable steps", "best efforts") | HARD-AMBIG-9, HARD-AMBIG-15 |
> | Undefined quantity ("small number", "majority") | HARD-AMBIG-12, HARD-AMBIG-16 |
> | Undefined condition ("if harm is likely", "if the breach is material") | HARD-AMBIG-20 |
>
> Note: The terms are deliberately chosen because they have legal or regulatory weight in
> privacy law but no agreed operational definition in this document.
> Expected analyzer category: `ambiguity` for all 20.

---

## Initial Breach Detection and Classification

When a potential data breach is identified, the responding team must immediately determine whether the incident constitutes a notifiable breach under the applicable regulatory framework. Not every security incident triggers a reporting obligation — the classification step is critical.

**[HARD-AMBIG-1]** If the breach involves a material number of affected records, it must be escalated to the Data Protection Officer within the first hour of detection.

**[HARD-AMBIG-2]** The incident must be logged in the breach register in a timely manner following initial detection.

**[HARD-AMBIG-3]** All affected parties must be identified and listed in the incident record before the preliminary assessment is submitted.

Breach classification must distinguish between incidents involving personal data and incidents that are purely technical in nature with no data exposure component. Only personal data breaches trigger notification obligations.

**[HARD-AMBIG-4]** If there is a significant risk that the breach could result in harm to individuals, the incident must be escalated to Priority 1 status.

---

## Severity Assessment

The severity assessment determines the notification pathway and the timeline for each required action. It must be completed within the first four hours of an incident being declared.

**[HARD-AMBIG-5]** Senior management must be briefed on the incident as soon as the severity assessment is complete.

**[HARD-AMBIG-6]** Evidence preservation actions must be completed promptly to ensure forensic integrity of logs and system state.

The assessment must consider the nature of the data exposed, the number of individuals affected, and the likely consequences for those individuals. The output is a severity rating of Low, Medium, High, or Critical.

**[HARD-AMBIG-7]** The responding team must apply appropriate technical measures to contain the breach and prevent further data exfiltration.

**[HARD-AMBIG-8]** All relevant systems implicated in the breach must be isolated or put into read-only mode until the forensic review is complete.

---

## Regulatory Notification

Data protection authorities in applicable jurisdictions must be notified within the statutory deadline where the breach meets the notification threshold. Failure to notify within the required window can result in significant regulatory penalties.

**[HARD-AMBIG-9]** The organisation must take reasonable steps to verify that the breach notification is complete, accurate, and has been received by the regulator before the deadline.

**[HARD-AMBIG-10]** The notification must meet the standard required by industry practice for breach notifications of this type.

**[HARD-AMBIG-11]** Notification must be sent to the relevant authorities in each jurisdiction where individuals whose data was exposed are resident.

**[HARD-AMBIG-12]** Where only a small number of records were exposed, a simplified notification process may be used rather than the full breach notification template.

---

## Individual Notification

Where the breach is likely to result in a high risk to the rights and freedoms of individuals, those individuals must also be notified directly. Individual notification is in addition to, not a substitute for, regulatory notification.

**[HARD-AMBIG-13]** The individual notification must include adequate information for the recipient to understand what happened, what data was involved, and what steps the organisation has taken.

**[HARD-AMBIG-14]** Individual notifications must be dispatched without undue delay once the decision to notify has been made.

**[HARD-AMBIG-15]** The organisation must use best efforts to ensure that notification reaches individuals through the most effective channel available.

**[HARD-AMBIG-16]** Where the majority of affected individuals have provided a primary email address, email is the preferred notification channel.

---

## Remediation and Documentation

**[HARD-AMBIG-17]** Remediation is complete when the substantial risk of ongoing data exposure has been addressed.

**[HARD-AMBIG-18]** A post-incident review must be completed by the appropriate team within 30 days of the breach being closed.

**[HARD-AMBIG-19]** The remediation plan must cover all sensitive data stores that were or could have been accessible via the attack vector used in the breach.

**[HARD-AMBIG-20]** Where the post-incident review concludes that if a recurrence would be likely to cause harm to individuals, additional technical or organisational controls must be implemented before the incident record is closed.
