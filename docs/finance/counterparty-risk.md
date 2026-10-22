# Counterparty Risk Assessment

_Issue #1227 — Backend: Implement counterparty risk assessment for trade partners_

## Overview

The `CounterpartyRiskService` evaluates the creditworthiness and reliability of
trade partners (farmers, traders, logistics providers) using a multi-factor
scoring model.  Each counterparty receives a composite risk score (0–100) that
determines their exposure limit and whether the investor should diversify.

## Risk Factors

| Factor | Weight | What it measures |
|--------|--------|-----------------|
| `deal_volume_diversity` | 25% | Number of distinct deals — more deals = lower risk |
| `commodity_concentration` | 20% | Share of exposure in a single commodity |
| `portfolio_exposure` | 25% | This counterparty's share of the investor's total portfolio |
| `active_deals_ratio` | 15% | Proportion of open (non-completed) deals |
| `geographic_concentration` | 15% | Share of exposure in a single farming region |

## Risk Tiers and Exposure Limits

| Score | Tier | Max portfolio share |
|-------|------|---------------------|
| 0–20  | Minimal  | 30% |
| 21–40 | Low      | 25% |
| 41–60 | Medium   | 20% |
| 61–80 | High     | 10% |
| 81–100| Critical | 5%  |

## Portfolio View

`getPortfolioView(investorId)` groups all investments by deal counterparty and
returns:

- Per-counterparty exposure (USD, % of portfolio)
- Individual risk score and tier
- Breach flag when exposure exceeds the tier limit
- A Herfindahl-based **diversification score** (0 = fully concentrated, 100 = perfectly even)
- Alert strings for any counterparty breaching their limit

## Usage

```typescript
// Score a single counterparty (requires DB access)
const score = await counterpartyRiskService.scoreCounterparty(userId);

// Pure computation (no DB) — useful for what-if analysis
const score = service.computeScore(counterpartyId, investments, totalPortfolioUsd);

// Full portfolio view
const view = await counterpartyRiskService.getPortfolioView(investorId);
```

## Extending the Model

Add new factors by appending to the `factors` array inside `computeScore` and
adjusting weights so they sum to 1.0.  Historical payment data, KYC scores, and
credit bureau integrations are natural additions when available.
