# Liquidity Risk Monitoring

The AgriFi Liquidity Risk Monitoring system provides quantitative measurement and proactive management of how quickly agricultural asset-backed investments can be converted into cash without significant loss of value. By tracking harvest maturities, secondary order matching depth, escrow reserves, and stress resilience, the system helps institutional and retail investors safeguard cash needs, avoid liquidity crunches, and ensure regulatory compliance.

---

## Overview

| Capability | Description |
| --- | --- |
| **Quantitative Liquidity Calculation** | Scores individual investments (0–100) based on days-to-maturity, tokenization, deal status, and escrow collateral. |
| **Liquidity Tier Classification** | Categorizes positions into *Highly Liquid*, *Moderately Liquid*, *Low Liquidity*, and *Illiquid*. |
| **Portfolio Aggregation** | Computes dollar-weighted liquidity score, weighted days to cash, and cash-conversion horizon schedules. |
| **Basel III LCR Proxy** | Measures Liquidity Coverage Ratio (LCR) comparing 30-day liquid conversion buffers against projected net outflows. |
| **Stress Testing Engine** | Simulates market freezes, 45-day harvest delays, and 35% redemption spikes with resilience grading. |
| **Threshold Alerts** | Real-time notifications on low liquidity scores, buffer warnings, LCR breaches, or illiquid concentration. |
| **Optimization Engine** | Produces actionable recommendations (e.g. short-cycle crop allocation, secondary order listings, cash reserves). |
| **Historical Tracking** | Time-series snapshot persistence tracking 30-day and 90-day liquidity trends. |
| **Regulatory Liquidity Reporting** | Automated compliance reports aligned with Basel III LCR and Net Stable Funding Ratio (NSFR) proxies. |
| **Interactive Scenario Analysis** | Custom simulator allowing investors to adjust haircuts, harvest delays, and withdrawal demands. |
| **Forward Liquidity Planning** | Timeline mapping projected harvest payout inflows against planned capital outflows over 30 to 180 days. |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Liquidity Risk Monitoring Architecture               │
│                                                                        │
│   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
│   │    Active Investments     │      │     Secondary Market        │   │
│   │    & Deal Maturities      │      │     Order Matching Depth    │   │
│   └─────────────┬─────────────┘      └──────────────┬──────────────┘   │
│                 │                                   │                  │
│                 ▼                                   ▼                  │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 LiquidityRiskService Engine                    │   │
│   │                                                                │   │
│   │   1. Multi-factor Scoring (Maturity, Secondary, Escrow)        │   │
│   │   2. Portfolio Dollar-Weighted Aggregation                     │   │
│   │   3. Cash Conversion Horizon Schedules (7d, 30d, 90d, 180d)    │   │
│   │   4. Basel III LCR & NSFR Proxy Ratio Computation              │   │
│   └─────────────┬───────────────────────────────────┬──────────────┘   │
│                 │                                   │                  │
│         ┌───────┴───────┬───────────────┬───────────┴────────┐         │
│         ▼               ▼               ▼                    ▼         │
│  ┌────────────┐  ┌─────────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Stress Test│  │ Alert &     │  │ Historical│  │ Compliance Report│  │
│  │ Simulator  │  │ Optimizer   │  │ Snapshots │  │ & Cash Flow Plan │  │
│  └────────────┘  └─────────────┘  └───────────┘  └──────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Scoring Methodology & Liquidity Tiers

Individual investment liquidity scores ($0 - 100$) are determined by four core quantitative factors:

$$\text{Liquidity Score} = F_{\text{maturity}} + F_{\text{secondary}} + F_{\text{status}} + F_{\text{collateral}}$$

1. **Maturity Factor ($F_{\text{maturity}}$, 40 pts max):**
   * $\le 15$ days: $40$ pts
   * $16 - 30$ days: $35$ pts
   * $31 - 60$ days: $28$ pts
   * $61 - 90$ days: $22$ pts
   * $91 - 180$ days: $15$ pts
   * $> 180$ days: $8$ pts
2. **Secondary Market Trading ($F_{\text{secondary}}$, 25 pts max):**
   * Tokenized Stellar asset with fractional lot step: $22$ pts
   * Standard deal: $10$ pts
3. **Execution Status ($F_{\text{status}}$, 20 pts max):**
   * Releasing / Completed escrow: $20$ pts
   * Active / Confirmed: $15$ pts
4. **Escrow Collateral ($F_{\text{collateral}}$, 15 pts max):**
   * Smart contract Soroban escrow or verified multisig: $15$ pts
   * Standard escrow: $8$ pts

### Liquidity Tiers

| Tier | Score Range | Est. Days to Cash | Secondary Haircut | Description |
| --- | --- | --- | --- | --- |
| **Highly Liquid** | $75 - 100$ | $\le 5$ days | $3.5\%$ | Near-term maturity or active secondary order matching |
| **Moderately Liquid** | $55 - 74.9$ | $\le 14$ days | $7.0\%$ | Mid-maturity crop cycles with steady trading |
| **Low Liquidity** | $35 - 54.9$ | $\le 45$ days | $15.0\%$ | Longer cycle harvests requiring secondary discounts |
| **Illiquid** | $0 - 34.9$ | $> 90$ days | $25.0\%+$ | Long-cycle tree crops (e.g. Timber, Cocoa orchards) |

---

## Portfolio Aggregation & Cash Conversion Profiles

The portfolio liquidity score is the dollar-weighted average across all active holdings:

$$\text{Portfolio Liquidity Score} = \frac{\sum_{i=1}^{N} (\text{AmountUSD}_i \times \text{Score}_i)}{\sum_{i=1}^{N} \text{AmountUSD}_i}$$

### Cash Conversion Horizon
Investments are mapped into maturity buckets to determine capital convertible to cash:
* **Immediate ($\le 7$ days):** Harvests in active disbursement or instant secondary matches.
* **Near Term ($\le 30$ days):** Serves as High-Quality Liquid Asset (HQLA) buffer.
* **Medium Term ($31 - 90$ days):** Standard agricultural turnaround.
* **Long Term ($> 90$ days):** Capital committed to full growing seasons.

### Liquidity Coverage Ratio (LCR) Proxy
Modeled on Basel III regulatory standards:

$$\text{LCR} = \frac{\text{Cash Convertible Within 30 Days}}{\text{Estimated 30-Day Net Outflows (20\% of Portfolio)}} \times 100\%$$

An LCR $\ge 100\%$ indicates the investor can comfortably weather expected redemptions or capital calls without forced asset liquidations.

---

## Liquidity Stress Testing

The engine evaluates portfolio resilience under four deterministic stress scenarios:

1. **Secondary Market Freeze:** Order matching pool temporarily halted; liquidation discounts double, lowering portfolio score by $\approx 28\%$.
2. **Harvest Delay Shock (45 Days):** Regional weather delay extends delivery dates across all deals by 45 days, shrinking the 30-day liquid buffer.
3. **Redemption Surge (35%):** Sharp increase in liquidity demand testing whether cash conversion meets capital call requirements.
4. **Combined Severe Crisis:** Compound shock combining secondary market freezes, harvest delays, and withdrawal pressure.

### Resilience Ratings
* **Robust:** Stressed $\text{LCR} \ge 120\%$ and Stressed Score $\ge 50$.
* **Moderate:** Stressed $\text{LCR} \ge 90\%$.
* **Vulnerable:** Stressed $\text{LCR} \ge 60\%$.
* **Critical:** Stressed $\text{LCR} < 60\%$ (immediate capital injection or secondary liquidation recommended).

---

## Proactive Threshold Alerts

Automatic alerts notify investors when:
* **Low Portfolio Liquidity:** Portfolio score drops below $40$ pts.
* **Buffer Warning:** 30-day cash conversion falls below $15\%$ of total portfolio value.
* **LCR Breach:** Liquidity Coverage Ratio falls below the $100\%$ regulatory baseline.
* **Illiquid Concentration:** A single illiquid position exceeds $30\%$ of total portfolio capital.

---

## Optimization Engine

The optimization engine recommends targeted capital deployment and secondary trades:
* **Short-Cycle Crop Allocation:** Deploy $15\%$ into short-cycle crops (Maize, Soybeans $\le 60$ days) for $+14.5$ pts score uplift.
* **Secondary Order Listing:** List tranches of long-dated assets on secondary matching for $+8.0$ pts uplift.
* **Cash/Stablecoin Reserve:** Maintain a $10\%$ liquid USDC balance for $+11.2$ pts uplift.
* **Maturity Staggering:** Spread commitments across calendar months for continuous monthly inflows.

---

## Forward Liquidity Planning

The liquidity planning module projects expected harvest completion payouts across a timeline:
* **0 – 30 Days (Immediate):** Upcoming payouts for urgent commitments.
* **31 – 60 Days (Short Term):** Projected interim payouts.
* **61 – 90 Days (Medium Term):** Main harvest settlement arrivals.
* **91 – 180 Days (Long Term):** Season completions.

The report calculates running surpluses/deficits against target expenditure needs and advises on necessary reserve buffers.

---

## API Reference

| Method | Endpoint | Description | Auth Required |
| --- | --- | --- | --- |
| `GET` | `/api/v1/investments/liquidity/summary` | Portfolio liquidity score, LCR, and conversion schedule | Investor |
| `POST` | `/api/v1/investments/liquidity/stress-test` | Run market stress test scenarios | Investor |
| `GET` | `/api/v1/investments/liquidity/alerts` | Active liquidity alerts and breach warnings | Investor |
| `GET` | `/api/v1/investments/liquidity/optimization` | Ranked rebalancing suggestions & uplift estimates | Investor |
| `POST` | `/api/v1/investments/liquidity/snapshots` | Record point-in-time liquidity snapshot | Investor |
| `GET` | `/api/v1/investments/liquidity/snapshots` | Retrieve historical snapshots & trend line | Investor |
| `GET` | `/api/v1/investments/liquidity/report` | Generate Basel III compliant LCR/NSFR report | Investor |
| `POST` | `/api/v1/investments/liquidity/scenario` | Interactive custom scenario simulator | Investor |
| `GET` | `/api/v1/investments/liquidity/plan` | Forward cash flow plan & inflow horizon projections | Investor |
