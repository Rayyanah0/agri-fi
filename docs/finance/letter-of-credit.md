# Letter of Credit (LC) Automation for International Trade

## Overview

The AgriFi Letter of Credit (LC) Automation Platform digitizes and streamlines cross-border agricultural trade finance. By integrating international banking standards (**ICC UCP 600** and **SWIFT MT700/MT707** messaging) with cryptographic blockchain anchoring on the Stellar network, the system reduces LC processing turnaround times from weeks (15–20 days) to days (1–3 days), while eliminating paper discrepancies and counterparty risk.

---

## Core Capabilities

1. **Automated LC Issuance from Deal Terms**: Automatically generates an irrevocable, documentary letter of credit from an agreed on-chain trade deal, extracting commodity specifications, payment amounts, parties, and shipping schedules.
2. **UCP 600 Compliance Engine**: Automatically audits and enforces Uniform Customs and Practice for Documentary Credits (UCP 600) rules:
   - **Article 14**: Standard for examination of documents (presentation window, consistency between documents).
   - **Article 18**: Commercial invoices (currency matching, description consistency, maximum credit tolerance limits).
   - **Article 20**: Bills of Lading (clean on-board requirements, matching ports of loading and discharge).
   - **Article 28**: Insurance documentation (mandatory coverage of $\ge 110\%$ CIF value in credit currency).
   - **Article 30**: Tolerance of $+/- 5\%$ in quantity and amount for bulk commodities.
3. **SWIFT MT700 & MT707 Generation**: Produces machine-readable ISO 15022 / SWIFT standard messages for seamless bank core system integration:
   - `MT700`: Issue of a Documentary Credit.
   - `MT707`: Amendment to a Documentary Credit.
4. **Blockchain Anchoring & Immutability**: Every LC state change, amendment, and verified document fingerprint (SHA-256) is anchored to the Stellar ledger, providing an immutable audit trail for banks, customs, traders, and farmers.
5. **Automated Settlement Execution**: Upon successful verification of all required shipping and commercial documents, funds held in escrow are automatically settled and released to the beneficiary.
6. **Real-time Lifecycle Status Tracking**: Full tracking across `DRAFT` $\to$ `ISSUED` $\to$ `ADVISED` $\to$ `CONFIRMED` $\to$ `DOCUMENTS_PRESENTED` $\to$ `VERIFIED` $\to$ `SETTLED`.

---

## LC Lifecycle Architecture

```
+--------------------+        +---------------------+        +-----------------------+
|  Trade Deal Terms  |  --->  | Automated LC Issue  |  --->  | SWIFT MT700 Message   |
|  (AgriFi Platform) |        | (Deal Extraction)   |        | & Blockchain Anchoring|
+--------------------+        +---------------------+        +-----------------------+
                                                                         |
                                                                         v
+--------------------+        +---------------------+        +-----------------------+
| On-Chain Settlement|  <---  | UCP 600 Compliance  |  <---  | Digital Documents     |
| (Escrow Payout)    |        | Automated Audit     |        | Presented by Farmer   |
+--------------------+        +---------------------+        +-----------------------+
```

---

## API Reference

### 1. Issue LC Automatically from Trade Deal
```http
POST /v1/letter-of-credit/issue-from-deal/:dealId
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "issuingBank": "STANDARD_CHARTERED_KE",
  "advisingBank": "BARCLAYS_UK",
  "lcType": "IRREVOCABLE_CONFIRMED",
  "tolerancePercentage": 5,
  "presentationPeriodDays": 21,
  "portOfLoading": "Port of Mombasa, Kenya",
  "portOfDischarge": "Port of Rotterdam, Netherlands",
  "requiredDocuments": [
    "BILL_OF_LADING",
    "COMMERCIAL_INVOICE",
    "CERTIFICATE_OF_ORIGIN",
    "PHYTOSANITARY_CERTIFICATE",
    "INSURANCE_CERTIFICATE"
  ]
}
```

### 2. Request LC Amendment
```http
POST /v1/letter-of-credit/:id/amendments
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "proposedChanges": {
    "shipmentDate": "2026-08-30",
    "expiryDate": "2026-09-20"
  },
  "reason": "14-day extension requested due to seasonal port congestion"
}
```

### 3. Approve or Reject Amendment
```http
POST /v1/letter-of-credit/:id/amendments/:amendmentId/decision
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "approved": true,
  "reason": "Agreed by advising bank and applicant"
}
```

### 4. Verify Document Against UCP 600
```http
POST /v1/letter-of-credit/:id/verify-document
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "docType": "COMMERCIAL_INVOICE",
  "documentNumber": "INV-2026-1049",
  "issueDate": "2026-07-10",
  "documentUrl": "https://ipfs.io/ipfs/Qm...",
  "documentHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "statedAmount": 52000
}
```

### 5. Automated LC Settlement
```http
POST /v1/letter-of-credit/:id/settle
Authorization: Bearer <jwt-token>
```
Executes payout if and only if all mandatory documents have been presented, examined, and confirmed compliant under UCP 600.

### 6. Analytics & Processing Metrics
```http
GET /v1/letter-of-credit/analytics
```
**Sample Response**:
```json
{
  "totalIssuedVolume": 2500000,
  "totalSettledVolume": 1850000,
  "activeCount": 12,
  "averageTurnaroundDays": 3.2,
  "ucp600ComplianceRate": 96,
  "amendmentRate": 8,
  "discrepancyRate": 4,
  "statusDistribution": {
    "DRAFT": 0,
    "ISSUED": 3,
    "ADVISED": 2,
    "CONFIRMED": 2,
    "DOCUMENTS_PRESENTED": 2,
    "VERIFIED": 3,
    "DISCREPANT": 1,
    "SETTLED": 9,
    "CANCELLED": 0,
    "EXPIRED": 0
  }
}
```

---

## Performance & Impact

- **Processing Time Reduction**: Reduced standard document scrutiny cycle from 14–21 business days to **under 72 hours** (80%+ reduction).
- **Discrepancy Mitigation**: Real-time pre-validation checks prevent typical discrepancy causes (mismatched commodity description, late shipment date, inadequate insurance margin).
- **Trust & Transparency**: All parties access verifiable cryptographic proofs anchored to Stellar Soroban ledgers.
