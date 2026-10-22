# Regulatory Rule Engine

The AgriFi Regulatory Rule Engine encodes complex multi-jurisdictional financial, AML, sanctions, and investor accreditation regulations into executable, declarative business rules. Moving beyond static or manual checks, the engine executes dynamic compliance screening in real time across deals, investments, and cross-border transactions while maintaining an immutable audit trail.

---

## Overview

| Capability | Description |
| --- | --- |
| **Rule Editor** | Declarative condition-action rule builder supporting multi-field predicates and boolean logic (`AND`/`OR`). |
| **Execution Engine** | High-performance screening engine evaluating fact sets against active rules in $< 10\text{ ms}$. |
| **Rule Versioning** | Semantic, incremental version tracking preserving parent lineage and rollback capabilities. |
| **Automated Rule Testing** | Pre-deployment validation against test fixture suites preventing erroneous logic in production. |
| **Staged Rule Deployment** | Multi-phase lifecycle (`draft` $\to$ `testing` $\to$ `staged` $\to$ `active` $\to$ `deprecated`). |
| **Execution Monitoring** | Real-time observability tracking execution latency, violation rates, and rule effectiveness. |
| **Violation Alerts** | Immediate alerting for `HIGH` and `CRITICAL` infractions dispatched to compliance teams. |
| **Jurisdiction Compliance Reports** | Automated regulatory reporting broken down by region (US, EU, UK, Nigeria, Kenya, Ghana, Global). |
| **Workflow Integration** | Seamless hooks into deal screening, transaction validation, and user accreditation workflows. |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Regulatory Rule Engine Architecture                 │
│                                                                        │
│   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
│   │    Compliance Officer     │      │     Incoming Deal / Tx      │   │
│   │    Rule Editor & Tests    │      │     Facts Payload           │   │
│   └─────────────┬─────────────┘      └──────────────┬──────────────┘   │
│                 │                                   │                  │
│                 ▼                                   ▼                  │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │              RegulatoryRuleEngineService Engine                │   │
│   │                                                                │   │
│   │   1. Jurisdiction & Active Rule Scope Filter                   │   │
│   │   2. Dotted Path Predicate Evaluation (EQUALS, IN, GTE, etc.)  │   │
│   │   3. Decision Hierarchy: REJECT > EDD > FLAG > CAP > ALLOW     │   │
│   │   4. Cryptographic SHA-256 Audit Trail Generation              │   │
│   └─────────────┬───────────────────────────────────┬──────────────┘   │
│                 │                                   │                  │
│         ┌───────┴───────┬───────────────┬───────────┴────────┐         │
│         ▼               ▼               ▼                    ▼         │
│  ┌────────────┐  ┌─────────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Execution  │  │ Compliance  │  │ Alerts    │  │ Version History  │  │
│  │ Audit Logs │  │ Report Gen  │  │ Dispatch  │  │ & Rollback Pool  │  │
│  └────────────┘  └─────────────┘  └───────────┘  └──────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Rule Structure & Condition Predicates

Each rule defines conditions evaluated against an input context (e.g. `deal`, `transaction`, `user`):

```json
{
  "ruleCode": "AML-002-CROSS-BORDER-LIMIT",
  "name": "Cross-Border Unaccredited Investment Cap",
  "jurisdiction": "GLOBAL",
  "category": "DEAL_LIMITS",
  "severity": "HIGH",
  "action": "FLAG_REVIEW",
  "logicalOperator": "AND",
  "conditions": [
    {
      "field": "user.accreditationTier",
      "operator": "EQUALS",
      "value": "retail"
    },
    {
      "field": "transaction.amountUsd",
      "operator": "GREATER_THAN",
      "value": 10000
    }
  ]
}
```

### Supported Operators
* `EQUALS` / `NOT_EQUALS`: Case-insensitive exact equality.
* `GREATER_THAN` / `GREATER_THAN_OR_EQUAL`: Numeric comparisons.
* `LESS_THAN` / `LESS_THAN_OR_EQUAL`: Numeric thresholds.
* `IN` / `NOT_IN`: Membership tests in lists (e.g., sanctioned country codes).
* `CONTAINS`: Substring matching.

---

## Decision Hierarchy

When multiple rules trigger on an entity, the engine resolves the conflict by enforcing the strictest action:

$$\text{REJECT} > \text{REQUIRE\_ENHANCED\_DUE\_DILIGENCE} > \text{FLAG\_REVIEW} > \text{CAP\_TRANSACTION} > \text{ALLOW}$$

* **ALLOW:** Entity passes all active regulatory mandates.
* **CAP_TRANSACTION:** Permitted up to regulatory threshold.
* **FLAG_REVIEW:** Queued for manual review by a compliance officer.
* **REQUIRE_ENHANCED_DUE_DILIGENCE:** Triggers Tier-2 source of funds or physical inspection.
* **REJECT:** Instantly blocks execution due to severe non-compliance (e.g. Sanctions, Child Labor).

---

## Rule Lifecycle & Staged Deployment

1. **Draft:** Created in the rule editor; inert and excluded from live screening.
2. **Testing:** Automated test cases executed to verify expected pass/fail behavior.
3. **Staged:** Deployed to preview environments for shadow evaluation against live traffic.
4. **Active:** Production execution. Automatically deprecates any older active versions of the same `ruleCode`.
5. **Deprecated:** Retired version retained for audit replay.

### Versioning & Rollback
Every modification creates version $V_{k+1}$ referencing $V_k$ as parent. If an updated rule causes unintended flags, compliance officers can execute a zero-downtime rollback to any prior version.

---

## Rule Testing Framework

Rules must define test fixtures before production activation:

```typescript
const testReport = await ruleEngineService.testRule(ruleId, [
  {
    name: "Blocks transactions from sanctioned countries",
    inputFacts: { transaction: { fromCountry: "CU" } },
    expectedAction: "REJECT",
    expectedViolated: true,
  },
  {
    name: "Allows compliant transactions",
    inputFacts: { transaction: { fromCountry: "GH" } },
    expectedAction: "ALLOW",
    expectedViolated: false,
  }
]);
```

---

## Workflow Integration Examples

### Deal Screening
```typescript
const result = await ruleEngineService.screenDeal({
  id: deal.id,
  commodity: deal.commodity,
  totalValue: deal.totalValue,
  country: "NIGERIA",
  esgScore: deal.esgScore,
});
if (!result.isCompliant) {
  // Flag deal for review or block publication
}
```

### Transaction Screening
```typescript
const result = await ruleEngineService.screenTransaction({
  id: tx.id,
  amountUsd: tx.amountUsd,
  fromCountry: "US",
  toCountry: "KENYA",
});
```

---

## API Reference

| Method | Endpoint | Description | Auth Required |
| --- | --- | --- | --- |
| `POST` | `/api/v1/compliance/rules` | Create new compliance rule (Draft) | Admin / Compliance |
| `GET` | `/api/v1/compliance/rules` | List compliance rules by status & jurisdiction | Authenticated |
| `GET` | `/api/v1/compliance/rules/:id` | Get rule details and conditions | Authenticated |
| `PATCH` | `/api/v1/compliance/rules/:id` | Edit rule & create new version | Admin / Compliance |
| `GET` | `/api/v1/compliance/rules/:code/history` | Get immutable version history | Authenticated |
| `POST` | `/api/v1/compliance/rules/:code/rollback` | Rollback to specific version | Admin / Compliance |
| `POST` | `/api/v1/compliance/rules/:id/test` | Test rule against test fixtures | Admin / Compliance |
| `POST` | `/api/v1/compliance/rules/:id/deploy` | Deploy rule (staged / active) | Admin / Compliance |
| `POST` | `/api/v1/compliance/rules/evaluate` | Execute rule engine against facts | Authenticated |
| `GET` | `/api/v1/compliance/rules/metrics/monitoring` | Execution counts, pass rates & latency | Admin / Compliance |
| `GET` | `/api/v1/compliance/rules/reports/jurisdiction` | Generate jurisdiction compliance report | Admin / Compliance |
