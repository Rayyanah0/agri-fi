# Multi-Dimensional Risk Scoring System for Trade Deals

## Overview

The AgriFi Risk Scoring System provides objective, quantitative, multi-dimensional risk evaluations for agricultural trade deals. It aggregates credit, market, operational, and geopolitical risks into an intuitive composite risk score (0–100 scale) and rating (`Low`, `Medium`, `High`, `Very High`), enabling investors to make data-driven capital allocation decisions while ensuring full auditability.

---

## Architecture & Mathematical Framework

### 1. Risk Pillars & Weights

The aggregate risk score is calculated as a weighted sum of four core pillars:

$$\text{Aggregate Risk Score} = (0.30 \times \text{Credit Risk}) + (0.25 \times \text{Market Risk}) + (0.25 \times \text{Operational Risk}) + (0.20 \times \text{Geopolitical Risk})$$

| Pillar | Weight | Description | Primary Drivers |
| :--- | :--- | :--- | :--- |
| **Credit Risk** | 30% | Evaluates counterparty creditworthiness and default probability | Farmer historical repayment rate, trader verification, KYC age, default frequency |
| **Market Risk** | 25% | Assesses commodity volatility and price shock risk | Baseline crop price volatility, seasonal demand cycle, investment pace |
| **Operational Risk** | 25% | Evaluates logistics, transit, and execution complexity | Deal duration, escrow collateral ratio, transport infrastructure index |
| **Geopolitical Risk** | 20% | Evaluates political, regulatory, and environmental stability | Sovereign risk index, export tariff/barrier index, climate & rainfall hazard |

---

### 2. Rating Bands

Calculated composite scores map into four standardized risk categories:

| Score Range | Rating | Investor Suitability | Default Guidance |
| :--- | :--- | :--- | :--- |
| **0 – 25** | `Low` | Conservative / Institutional | Low risk, eligible for automatic investment without secondary review |
| **26 – 50** | `Medium` | Balanced / Moderate Yield | Standard risk profile, verified collateral and milestone escrow release |
| **51 – 75** | `High` | Growth / High Yield | Elevated volatility or country risk; recommend crop insurance coverage |
| **76 – 100** | `Very High` | Speculative / Distressed | Significant risk; position limits enforced, secondary approvals required |

---

## Pillar Calculation Details

### Credit Risk Scoring
$$\text{Credit Risk} = 0.45 \times \text{FarmerRepayment} + 0.35 \times \text{TraderCredit} + 0.20 \times \text{HistoricalDefaults}$$
- **Farmer Repayment**: Derived from historical performance of investments associated with the farmer. Zero history starts at neutral baseline (50).
- **Trader Credit**: Based on KYC verification tier and registered corporate status.
- **Historical Defaults**: Historical ratio of failed or canceled deals over all past engagements.

### Market Risk Scoring
$$\text{Market Risk} = 0.50 \times \text{CommodityVolatility} + 0.25 \times \text{DemandRisk} + 0.25 \times \text{LiquidityRisk}$$
- **Commodity Volatility**: Standardized price shock volatility (e.g. Sugar: 55, Cocoa: 45, Wheat: 40, Rice: 30).
- **Demand Risk**: Cyclical demand stability for staple food crops vs luxury/cash crops.
- **Liquidity Risk**: Funding velocity and remaining capital required to reach minimum operational threshold.

### Operational Risk Scoring
$$\text{Operational Risk} = 0.35 \times \text{DealDuration} + 0.40 \times \text{CollateralCoverage} + 0.25 \times \text{LogisticsRisk}$$
- **Deal Duration**: Short (<30 days: score 15) to Long (>180 days: score 85).
- **Collateral Coverage**: Escrow funding ratio and multi-sig commitment.
- **Logistics Risk**: Route complexity and country logistics infrastructure ranking.

### Geopolitical Risk Scoring
$$\text{Geopolitical Risk} = 0.35 \times \text{WeatherRisk} + 0.40 \times \text{PoliticalRisk} + 0.25 \times \text{RegulatoryRisk}$$
- **Weather & Climate**: Origin country drought, flood, and seasonal temperature anomalies.
- **Political Stability**: Sovereign governance and stability index.
- **Regulatory Risk**: Cross-border trade barriers, export quotas, and currency transfer restrictions.

---

## Historical Tracking & Audit Trail

Every risk score calculation records an immutable audit record containing:
- Unique audit identifier (`audit-<timestamp>-<hash>`)
- Target trade deal identifier
- Calculated score, rating, and pillar breakdown
- Calculation trigger (`manual`, `system`, `cron-recalculate`, or user UUID)
- Model version (`v2.1.0-multidimensional`)
- Raw input parameter snapshots

---

## API Endpoints

### 1. Retrieve Comprehensive Risk Scoring & Radar Visualization
```http
GET /v1/trade-deals/:id/risk-scoring
```
**Response**:
```json
{
  "dealId": "c88f28c2-3e74-4b55-a0c3-f0a9971bc182",
  "score": 38.45,
  "rating": "Medium",
  "radar": [
    { "dimension": "Credit Risk", "score": 32, "benchmark": 45, "weight": 0.30 },
    { "dimension": "Market Risk", "score": 45, "benchmark": 42, "weight": 0.25 },
    { "dimension": "Operational Risk", "score": 35, "benchmark": 40, "weight": 0.25 },
    { "dimension": "Geopolitical Risk", "score": 42, "benchmark": 48, "weight": 0.20 }
  ],
  "keyDrivers": [
    { "factor": "Commodity Volatility", "impact": "High price fluctuations in target crop", "score": 48 }
  ],
  "mitigatingFactors": [
    "Strong credit track record with 0 default history",
    "Over 70% funded with multi-sig escrow protection"
  ],
  "recommendations": [
    "Balanced risk profile with attractive yield-to-risk ratio."
  ]
}
```

### 2. Historical Risk Score Tracking
```http
GET /v1/trade-deals/:id/risk-history
```

### 3. Risk Calculation Audit Trail
```http
GET /v1/trade-deals/:id/risk-audit
```

### 4. Recalculate Risk Score
```http
POST /v1/trade-deals/:id/recalculate-risk
Authorization: Bearer <jwt-token>
```

### 5. Risk-Based Deal Recommendations
```http
GET /v1/trade-deals/recommendations/by-risk?tolerance=medium&limit=10
```
Filters deals according to the investor's risk profile and ranks by risk-adjusted return (Sharpe-like ratio: $\frac{\text{Expected ROI}}{\text{Risk Score} + 5}$).
