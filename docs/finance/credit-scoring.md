# Farmer Credit Scoring System

## Overview

The AgriFi Credit Scoring System turns a farmer's trading history into a single, explainable number: a credit score on a **300–850** scale, alongside the weighted factors behind it, the tier it falls in, and the uncollateralized deal ceiling that tier grants.

A farmer is not scored on an opinion of their farm. Every dimension is **measured from the platform's own records** — their deals, their shipment milestones, their supporting documents, their escrow releases and their KYC status — so the score is reproducible, auditable, and disputable.

---

## Scoring Model

### 1. Score Range

$$\text{Credit Score} = 300 + \left(\sum_{i} w_i \times f_i\right) \times 550$$

The weighted factor sum lives in `[0, 1]`, so the score maps linearly onto the published 300–850 range. Every factor is clamped to `[0, 1]` before it is weighted, so a malformed input can never push a score outside the range.

| Score | Meaning |
| :--- | :--- |
| **850** | A flawless record across every measured dimension |
| **300** | A failing record across every measured dimension |

### 2. Factors & Weights

The weights sum to exactly `1.0`.

| Factor | Weight | What it measures | Source of truth |
| :--- | :--- | :--- | :--- |
| **On-time delivery rate** | 25% | Share of contracted deliveries that reached the importer on or before the contractual date | `trade_deals.delivery_date` vs. the `importer` milestone `recorded_at` |
| **Repayment history** | 20% | Share of the farmer's obligations that were honoured — both the deals themselves and the escrow releases they triggered | `trade_deals.status`, `payment_distributions.status` |
| **Deal completion rate** | 15% | Share of closed deals that reached settlement | `trade_deals.status` |
| **Shipment accuracy** | 15% | Share of recorded milestones a verifier confirmed as accurate | `milestone_verifications.status` |
| **Shipment milestone compliance** | 10% | Share of shipments whose milestone chain has no gaps | `shipment_milestones.milestone` |
| **Document quality** | 10% | Share of reviewed supporting documents that passed review | `documents.verification_status` |
| **KYC tenure** | 5% | Days since the farmer's KYC submission was approved | `kyc_submissions.status`, `created_at` |

### 3. How Each Factor Is Measured

**On-time delivery rate.** A deal counts as a delivery only once it has reached `completed`. Its final `importer` milestone is compared against the contractual `delivery_date`; a milestone recorded on the delivery date itself still counts as on time. Deals that completed without a recorded `importer` milestone are not measurable and are excluded from both sides of the ratio.

**Repayment history.** The farmer's obligations are their closed deals plus the escrow distributions that paid them out. An obligation is *honoured* when the deal completed or the distribution was confirmed. Cancelled deals are excluded from the denominator — walking away from a deal is a legitimate exit, not a repayment failure. Failed and expired deals count against the farmer.

**Deal completion rate.** Every deal that reached a final outcome (`completed`, `failed`, `expired`, `canceled`) is in the denominator; only `completed` counts in the numerator.

**Shipment accuracy.** Only milestones that a verifier actually looked at carry evidence. A milestone with no verification record is excluded rather than counted against the farmer, and one with a `rejected` verdict counts against them.

**Shipment milestone compliance.** The expected chain is `farm → warehouse → port → importer`. A shipment is compliant when it has recorded every stage up to its furthest stage — a deal at the `farm` stage has not skipped anything, while a deal that recorded `farm` and `port` without `warehouse` has a gap.

**Document quality.** Documents still awaiting a verdict are excluded rather than counted against the farmer; `approved` counts in the numerator and `rejected` in the denominator.

**KYC tenure.** Measured from the approval of the farmer's KYC submission. The submission record carries no separate approval timestamp, so the submission date is used as a lower bound. The factor is normalized against 365 days.

### 4. Missing Evidence Is Never a Free Pass

A farmer with no track record has no evidence for any dimension, so every dimension is scored at the **neutral midpoint of 0.5** rather than at a perfect value. A new farmer therefore lands in the middle of the range and has to build history to climb, and a farmer whose history is merely absent is never treated as though it were excellent.

Rows written before the shipment-accuracy and document-quality dimensions existed are read back with the same neutral fill, so an old score is never silently inflated by a dimension that was never measured.

---

## Credit Tiers

| Tier | Score range | Uncollateralized ceiling |
| :--- | :--- | :--- |
| **Excellent** | 750 – 850 | $200,000 |
| **Good** | 700 – 749 | $50,000 |
| **Fair** | 650 – 699 | $50,000 |
| **Poor** | below 650 | $10,000 |

The deal ceiling is the maximum value of a single deal a farmer may list without additional collateral. It is derived from the score, so a farmer can only graduate to a higher ceiling by reaching the next tier.

---

## API

All endpoints are under `/v1` and require a JWT.

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/users/me/credit-score` | Score, tier, factor breakdown and improvement tips |
| `GET` | `/credit-scoring/me/history` | Score history rolled up by month, with the change against the previous month |
| `GET` | `/credit-scoring/me/benchmark` | The farmer's standing against the farmers in their own country |
| `GET` | `/credit-scoring/me/disputes` | Disputes the farmer has filed |
| `POST` | `/credit-scoring/me/disputes` | File a dispute against a scoring dimension |
| `GET` | `/credit-scoring/investment-recommendations` | Investable deals ranked by the credit standing of the farmer behind them |
| `GET` | `/credit-scoring/admin/disputes` | Dispute review queue (admin) |
| `PATCH` | `/credit-scoring/admin/disputes/:id` | Resolve a dispute (admin) |

### Peer benchmarking

`GET /credit-scoring/me/benchmark` compares a farmer against the other farmers registered in the same country, and returns the peer count, the regional average and median, the farmer's percentile within the region, and the distribution of peers across the four tiers. Peers without a computed score are excluded from the comparison set rather than counted as zeroes.

### Investment recommendations

`GET /credit-scoring/investment-recommendations` returns the open and funded deals whose farmer clears the requested tier (default `Fair`). A deal is only recommended when its value also fits inside the uncollateralized ceiling that the farmer's tier grants, so the platform never recommends a deal its own credit model would not support. Each recommendation carries a plain-language rationale.

---

## Dispute & Correction Workflow

A farmer who believes a dimension was mis-measured can file a dispute against it.

1. **File.** The farmer states what went wrong and, optionally, which dimension it affected. The score the farmer was shown at the time is recorded on the dispute so the claim is anchored to a specific figure. Only one dispute may be under review at a time, which keeps the review queue unambiguous.
2. **Review.** An administrator picks the dispute up from the admin queue and inspects the underlying records.
3. **Resolve.** The administrator either upholds the dispute or rejects it.
   - *Upheld with a corrected score* — the corrected score is applied to the farmer's profile and written to the score history as an admin override, with the resolution as the audit reason.
   - *Upheld without a corrected score* — the farmer is re-measured from their (now corrected) history, so the fix flows from the data rather than from a manual number.
   - *Rejected* — the dispute is closed with the administrator's reason and the score is left untouched.
4. **Notify.** The farmer is notified of the outcome either way.

Every resolution is recorded with the administrator who made it and the moment it was made.

---

## Notifications

A farmer is notified whenever a recalculation moves their score, and specifically when it moves their **tier** — a tier change is the moment that matters, because it is what changes the deals they can list. A notification failure never fails the recalculation itself.

---

## Data & Storage

| Table | Purpose |
| :--- | :--- |
| `users.credit_score` | The farmer's current score, denormalised for the marketplace listing |
| `farmer_credit_score_history` | An append-only audit trail: score, tier ceiling, the full factor set, the reason and any admin override |
| `farmer_credit_score_disputes` | The dispute workflow |

The score history is the source of truth for the monthly trend; `users.credit_score` is a cache of the latest entry so the marketplace listing stays a single query. A Redis cache in front of the disclosure endpoint holds it for 15 minutes and is invalidated on every write.

---

## Design Notes

- **The model is pure.** `credit-score.model.ts` holds the weights, the scoring function, the tier bands and the deal ceiling with no Nest or TypeORM dependency, so the scoring rules can be read and tested on their own.
- **Measurement is separated from the model.** `farmer-credit-performance.service.ts` owns the "what happened" questions, and the scoring service owns the "what does it mean" questions. The model never touches the database.
- **A notification failure must not lose a score.** Notifications are best-effort and logged, never allowed to abort a write.
