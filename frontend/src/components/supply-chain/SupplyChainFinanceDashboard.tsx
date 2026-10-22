'use client';
/**
 * SupplyChainFinanceDashboard (#1220)
 *
 * Surfaces the supply chain finance (SCF) platform for working capital
 * optimisation.  Buyers can browse supplier invoices approved for early
 * payment; suppliers see outstanding invoices eligible for financing and the
 * discount rate offered.  Financing pool managers see capital utilisation.
 *
 * Data is fetched from GET /api/supply-chain-finance/summary and rendered
 * client-side.  Degrades gracefully on error or while loading.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export type ScfParticipantRole = 'buyer' | 'supplier' | 'investor';

export type InvoiceStatus =
  | 'pending_approval'
  | 'approved'
  | 'financing_offered'
  | 'financed'
  | 'settled';

export interface ScfInvoice {
  id: string;
  buyerName: string;
  supplierName: string;
  commodity: string;
  faceValueUsd: number;
  discountRatePct: number;
  earlyPaymentAmountUsd: number;
  dueDateIso: string;
  status: InvoiceStatus;
}

export interface ScfPoolSummary {
  totalCapitalUsd: number;
  utilizedCapitalUsd: number;
  availableCapitalUsd: number;
  utilizationPct: number;
  weightedAvgDiscountPct: number;
}

export interface ScfWorkingCapitalSuggestion {
  counterpartyId: string;
  counterpartyName: string;
  currentPaymentTermsDays: number;
  suggestedTermsDays: number;
  estimatedSavingsUsd: number;
  rationale: string;
}

export interface ScfSummary {
  role: ScfParticipantRole;
  invoices: ScfInvoice[];
  pool: ScfPoolSummary;
  suggestions: ScfWorkingCapitalSuggestion[];
  fetchedAt: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  pending_approval:  'Pending Approval',
  approved:          'Approved',
  financing_offered: 'Offer Available',
  financed:          'Financed',
  settled:           'Settled',
};

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  pending_approval:  '#94a3b8',
  approved:          '#60a5fa',
  financing_offered: '#f59e0b',
  financed:          '#34d399',
  settled:           '#6b7280',
};

function InvoiceRow({ invoice }: { invoice: ScfInvoice }) {
  const due = new Date(invoice.dueDateIso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  return (
    <tr data-testid={`scf-invoice-row-${invoice.id}`} style={{ borderBottom: '1px solid #1e293b' }}>
      <td style={tdStyle}>{invoice.buyerName}</td>
      <td style={tdStyle}>{invoice.supplierName}</td>
      <td style={tdStyle}>{invoice.commodity}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        ${invoice.faceValueUsd.toLocaleString()}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', color: '#34d399' }}>
        {invoice.discountRatePct.toFixed(2)}%
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        ${invoice.earlyPaymentAmountUsd.toLocaleString()}
      </td>
      <td style={tdStyle}>{due}</td>
      <td style={tdStyle}>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
            background: STATUS_COLORS[invoice.status] + '22',
            color: STATUS_COLORS[invoice.status],
            border: `1px solid ${STATUS_COLORS[invoice.status]}44`,
          }}
        >
          {STATUS_LABELS[invoice.status]}
        </span>
      </td>
    </tr>
  );
}

function PoolCard({ pool }: { pool: ScfPoolSummary }) {
  return (
    <div
      data-testid="scf-pool-card"
      style={{
        borderRadius: 12,
        border: '1px solid #1e293b',
        background: '#0f172a',
        padding: '16px 20px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 16,
      }}
    >
      <Stat label="Total Capital" value={`$${pool.totalCapitalUsd.toLocaleString()}`} />
      <Stat label="Utilised" value={`$${pool.utilizedCapitalUsd.toLocaleString()}`} />
      <Stat label="Available" value={`$${pool.availableCapitalUsd.toLocaleString()}`} accent="#34d399" />
      <Stat label="Utilisation" value={`${pool.utilizationPct.toFixed(1)}%`} />
      <Stat label="Avg Discount" value={`${pool.weightedAvgDiscountPct.toFixed(2)}%`} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700, color: accent ?? '#e2e8f0' }}>
        {value}
      </p>
    </div>
  );
}

function SuggestionList({ suggestions }: { suggestions: ScfWorkingCapitalSuggestion[] }) {
  if (suggestions.length === 0) return null;
  return (
    <div data-testid="scf-suggestions">
      <h3 style={{ margin: '0 0 10px', fontSize: 14, color: '#94a3b8' }}>
        Working Capital Optimisation Suggestions
      </h3>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {suggestions.map((s) => (
          <li
            key={s.counterpartyId}
            data-testid={`scf-suggestion-${s.counterpartyId}`}
            style={{
              borderRadius: 8,
              border: '1px solid #1e293b',
              background: '#0f172a',
              padding: '10px 14px',
              fontSize: 13,
              color: '#cbd5e1',
            }}
          >
            <strong style={{ color: '#e2e8f0' }}>{s.counterpartyName}</strong>
            {' · '}extend terms from {s.currentPaymentTermsDays}d → {s.suggestedTermsDays}d
            {' · '}save{' '}
            <span style={{ color: '#34d399', fontWeight: 600 }}>
              ${s.estimatedSavingsUsd.toLocaleString()}
            </span>
            <span style={{ display: 'block', color: '#64748b', fontSize: 12, marginTop: 2 }}>
              {s.rationale}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SupplyChainFinanceDashboardProps {
  /** Optional override for the API endpoint (useful for tests). */
  apiUrl?: string;
  /** Polling interval in ms (0 = no polling). Default 60 000. */
  pollMs?: number;
}

export function SupplyChainFinanceDashboard({
  apiUrl = '/api/supply-chain-finance/summary',
  pollMs = 60_000,
}: SupplyChainFinanceDashboardProps) {
  const [data, setData] = useState<ScfSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSummary = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(apiUrl, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = (await res.json()) as ScfSummary;
      setData(json);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message ?? 'Failed to load SCF data.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void fetchSummary();
    if (pollMs > 0) {
      const id = setInterval(() => void fetchSummary(), pollMs);
      return () => clearInterval(id);
    }
  }, [fetchSummary, pollMs]);

  if (loading) {
    return (
      <div data-testid="scf-loading" aria-busy="true" style={{ color: '#64748b', padding: 24 }}>
        Loading supply chain finance data…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        data-testid="scf-error"
        role="alert"
        style={{ color: '#f87171', padding: 24, borderRadius: 10, border: '1px solid #7f1d1d22', background: '#450a0a22' }}
      >
        {error ?? 'No data available.'}
      </div>
    );
  }

  return (
    <div data-testid="scf-dashboard" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
          Supply Chain Finance
        </h2>
        <span style={{ fontSize: 11, color: '#475569' }}>
          Updated {new Date(data.fetchedAt).toLocaleTimeString()}
        </span>
      </header>

      <PoolCard pool={data.pool} />
      <SuggestionList suggestions={data.suggestions} />

      {data.invoices.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table
            data-testid="scf-invoice-table"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#cbd5e1' }}
            aria-label="Supply chain finance invoices"
          >
            <thead>
              <tr style={{ borderBottom: '2px solid #1e293b' }}>
                {['Buyer', 'Supplier', 'Commodity', 'Face Value', 'Discount', 'Early Pay', 'Due Date', 'Status'].map((h) => (
                  <th key={h} scope="col" style={{ ...tdStyle, fontWeight: 600, color: '#94a3b8', paddingBottom: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <InvoiceRow key={inv.id} invoice={inv} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p
          data-testid="scf-empty"
          style={{ color: '#475569', fontSize: 14, textAlign: 'center', padding: 32 }}
        >
          No invoices eligible for supply chain financing at this time.
        </p>
      )}
    </div>
  );
}

export default SupplyChainFinanceDashboard;

// ── Style helpers ─────────────────────────────────────────────────────────────

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};
