---
name: financial-risk-management-advisor
description: Advises financial institutions on the classification, measurement, and management of credit risk, market risk, liquidity risk, and operational risk under Basel III and internal governance frameworks.
---

# Financial Risk Management Advisor

Use this skill to apply risk classification frameworks, calculate exposure metrics, and advise on remediation strategies for financial risk management.

> **Test metadata:** 10 injected hard circular definitions (HARD-CIRC-1 through HARD-CIRC-10).
> These are intentionally harder to detect than simple A-defines-B / B-defines-A loops.
> Patterns used:
>
> | Pattern | Labels |
> |---|---|
> | 3-hop circles: A → B → C → A | HARD-CIRC-3, HARD-CIRC-7 |
> | Near-synonym circles: A defined using a near-synonym of A | HARD-CIRC-1, HARD-CIRC-5, HARD-CIRC-9 |
> | Tautological definitions that sound like they clarify | HARD-CIRC-2, HARD-CIRC-6, HARD-CIRC-10 |
> | Reciprocal definitions using domain jargon that sounds self-contained | HARD-CIRC-4, HARD-CIRC-8 |
>
> Expected analyzer category: `structural` (circular_definition) for all 10.

---

## Credit Risk

**[HARD-CIRC-1]**
**Credit risk** is the risk that a counterparty will fail to discharge a financial obligation, resulting in a credit loss for the holding institution.
A **credit loss** is the financial loss that materialises when a counterparty fails to discharge an obligation that gave rise to credit risk.

---

**[HARD-CIRC-2]**
A **non-performing loan (NPL)** is a loan that has been classified as non-performing in accordance with the institution's NPL classification criteria.
The **NPL classification criteria** are the criteria by which a loan is determined to be a non-performing loan.

---

**[HARD-CIRC-3]** *(3-hop circle: default event → credit obligation → obligor → default event)*
A **default event** occurs when an obligor fails to fulfil a credit obligation.
A **credit obligation** is a financial commitment that, when unfulfilled by the obligor, constitutes a default event.
An **obligor** is any counterparty that holds a credit obligation whose non-fulfilment would be classified as a default event.

---

## Market Risk

**[HARD-CIRC-4]**
**Value-at-Risk (VaR)** is the maximum potential loss on a portfolio that is not exceeded within the defined VaR confidence interval.
The **VaR confidence interval** is the statistical confidence level that determines the maximum potential loss threshold used in VaR calculation.

---

**[HARD-CIRC-5]**
**Mark-to-market valuation** is the process of valuing a position at its current market price.
The **current market price** of a position is the price at which that position would be marked to market.

---

## Liquidity Risk

**[HARD-CIRC-6]**
A **liquid asset** is an asset that can be readily converted to cash in stress conditions without material loss of value.
**Readily convertible to cash** means that an asset can be liquidated quickly under the conditions that would apply to a liquid asset in stress.

---

**[HARD-CIRC-7]** *(3-hop circle: liquidity stress → funding gap → liquidity buffer → liquidity stress)*
A **liquidity stress event** is a scenario in which the institution faces a funding gap that depletes the liquidity buffer.
A **funding gap** is the shortfall that arises when liquidity stress reduces available funding below the level required to maintain operations.
The **liquidity buffer** is the reserve of liquid assets maintained to absorb a funding gap during a liquidity stress event.

---

## Operational Risk

**[HARD-CIRC-8]**
An **operational loss event** is any event that results in an operational risk loss being recorded.
An **operational risk loss** is the financial impact attributed to an operational loss event in the institution's loss event database.

---

**[HARD-CIRC-9]**
**Residual risk** is the risk that remains after risk controls have reduced the inherent risk to the residual risk level.
**Inherent risk** is the risk that existed before controls were applied, calculated as the residual risk plus the risk reduction attributable to those controls.

---

**[HARD-CIRC-10]**
A **risk appetite breach** is any situation in which the institution's risk exposure exceeds the level defined as acceptable in the risk appetite statement.
The **risk appetite statement** defines the level of risk exposure above which a risk appetite breach is considered to have occurred.
