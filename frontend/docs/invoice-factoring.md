# Invoice Factoring Platform Documentation

## Overview

The AgriFi Invoice Factoring Platform unlocks liquidity for agricultural producers and commodity traders by allowing them to sell unpaid accounts receivable (invoices) to global investors for immediate cash flow. Instead of waiting 30 to 90 days for corporate buyers to settle payment terms, farmers receive an immediate cash advance (typically 85% to 92% of invoice face value) within hours, while investors earn attractive short-term yield backed by verified multinational agribusinesses.

---

## Key Platform Capabilities

1. **Self-Service Invoice Listing**:
   - Farmers and exporters can list unpaid invoices with supporting commercial documents (Bills of Lading, delivery receipts, purchase orders).
   - Instant calculation of cash out advance, discounting fees, and net immediate liquidity.
2. **Automated Verification & Fraud Prevention**:
   - Verification of commercial shipping documents and anti-fraud checks.
   - Dual-confirmation mechanism verifying debtor receipt of produce.
3. **Competitive Factoring Auction & Bidding**:
   - Global institutional and retail investors compete on discount rate percentages.
   - Lower discount rates reduce factoring costs for farmers while optimizing yield for investors.
4. **Debtor Credit Scoring & Ratings**:
   - Invoices are dynamically scored based on debtor payment track record, financial stability, and credit score (300 to 850 scale).
   - Standardized credit tiers: `AAA`, `AA`, `A`, `BBB`, `BB`, `B`.
5. **Credit Default Insurance**:
   - Optional insurance coverage (+0.8% premium) guaranteeing 100% principal protection in the event of buyer insolvency or delayed default.
6. **Automated Maturity Collection**:
   - On payment due dates, corporate buyers settle directly via banking/Stellar rails, automatically repaying the investor's principal and yield.
7. **Factoring Analytics & Metrics**:
   - Total factored volume tracking.
   - Default rates (consistently under 0.2%).
   - Average cash advance turnaround times (&lt; 5 hours).

---

## Discounting & Advance Formulas

### 1. Factoring Discount Fee
$$\text{Discount Fee} = \text{Face Value} \times \left(\frac{\text{Discount Rate}}{100}\right) \times \left(\frac{\text{Days to Maturity}}{365}\right)$$

### 2. Net Cash Advance to Farmer
$$\text{Net Advance} = \left(\text{Face Value} \times \frac{\text{Advance Ratio}}{100}\right) - \text{Discount Fee} - \text{Insurance Fee}$$

Where:
- $\text{Advance Ratio}$ is typically $90\%$.
- $\text{Insurance Fee} = \text{Face Value} \times 0.008$ (if credit insurance is selected).

---

## Component Architecture

- `InvoiceFactoringDashboard`: Master interface managing active tabs (`Marketplace`, `My Listed Invoices`, `Analytics`), search/filtering, and modal state.
- `InvoiceCard`: Displays face value, immediate advance amounts, debtor ratings, maturity timelines, active bids, and quick actions.
- `InvoiceListingModal`: Modal form for uploading invoices, calculating real-time advance estimates, and opting into credit insurance.
- `FactoringAuctionModal`: Investor interface for submitting competitive discount rate bids.
- `FactoringAnalyticsView`: Volume growth trends, default rates, and turnaround metrics.

---

## Routing

The Invoice Factoring module is accessible under:
```
/[locale]/invoice-factoring
```
For example: `/en/invoice-factoring`.
