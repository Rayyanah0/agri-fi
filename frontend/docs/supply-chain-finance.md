# Supply Chain Finance Platform

_Issue #1220 — Frontend: Implement supply chain finance platform for working capital optimization_

## Overview

`SupplyChainFinanceDashboard` is a client-side React component that renders the
SCF platform for working capital optimisation.  Buyers, suppliers, and
financing-pool investors share one component; the server response's `role` field
controls which perspective is most prominent.

## Component Location

```
frontend/src/components/supply-chain/SupplyChainFinanceDashboard.tsx
```

## Data Contract

The component fetches `GET /api/supply-chain-finance/summary` and expects a
`ScfSummary` payload:

```typescript
interface ScfSummary {
  role: 'buyer' | 'supplier' | 'investor';
  invoices: ScfInvoice[];          // invoices eligible for SCF
  pool: ScfPoolSummary;            // financing pool utilisation
  suggestions: ScfWorkingCapitalSuggestion[];  // optimisation recommendations
  fetchedAt: string;               // ISO timestamp
}
```

See `SupplyChainFinanceDashboard.tsx` for the full type definitions.

## Props

| Prop | Default | Description |
|------|---------|-------------|
| `apiUrl` | `/api/supply-chain-finance/summary` | Override for testing |
| `pollMs` | `60000` | Auto-refresh interval (0 = disabled) |

## Rendered Sections

1. **Pool Card** (`data-testid="scf-pool-card"`) — capital utilisation metrics.
2. **Working Capital Suggestions** (`data-testid="scf-suggestions"`) — per-counterparty payment-term recommendations with estimated savings.
3. **Invoice Table** (`data-testid="scf-invoice-table"`) — pageable list of invoices with status, face value, discount rate, and early-payment amount.

## Error and Loading States

- Loading: `data-testid="scf-loading"` with `aria-busy="true"`.
- Error: `data-testid="scf-error"` with `role="alert"`.
- Empty invoices: `data-testid="scf-empty"`.

## Usage

```tsx
import { SupplyChainFinanceDashboard } from '@/components/supply-chain/SupplyChainFinanceDashboard';

export default function ScfPage() {
  return <SupplyChainFinanceDashboard />;
}
```

## Backend Integration Notes

The backend endpoint (`/api/supply-chain-finance/summary`) should:

- Use existing invoice infrastructure (`/api/invoices`) as the data source.
- Filter invoices to those marked `approved` or `financing_offered`.
- Compute working capital suggestions from payment term history.
- Respect the authenticated user's role to scope the response.
