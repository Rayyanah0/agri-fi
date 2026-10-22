'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  apiClient,
  type PortfolioAllocationSlice,
  type PortfolioSummary,
} from '@/lib/api';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import StatCard from '@/components/StatCard';

/** Slices drawn individually; anything past this is folded into "Other". */
const TOP_SLICES = 7;

/**
 * Donut segment colours. Hard-coded rather than CSS variables because recharts
 * paints each segment with its own fill and needs concrete colours for the
 * matching legend swatches too.
 */
const SLICE_COLORS = [
  '#16a34a',
  '#7c3aed',
  '#0ea5e9',
  '#f59e0b',
  '#e11d48',
  '#0d9488',
  '#6366f1',
  '#94a3b8',
];

interface AllocationRow {
  key: string;
  label: string;
  amount_usd: number;
  share_pct: number;
  color: string;
}

/** Fold the long tail so the donut stays readable on a small screen. */
export function buildAllocationRows(
  allocation: PortfolioAllocationSlice[],
): AllocationRow[] {
  const head = allocation.slice(0, TOP_SLICES);
  const tail = allocation.slice(TOP_SLICES);

  const rows = head.map((slice, index) => ({
    key: slice.deal_id,
    label: slice.token_symbol || slice.title || slice.commodity || 'Untitled deal',
    amount_usd: slice.amount_usd,
    share_pct: slice.share_pct,
    color: SLICE_COLORS[index % SLICE_COLORS.length],
  }));

  if (tail.length > 0) {
    rows.push({
      key: 'other',
      label: `Other (${tail.length})`,
      amount_usd: tail.reduce((sum, slice) => sum + slice.amount_usd, 0),
      share_pct: tail.reduce((sum, slice) => sum + slice.share_pct, 0),
      color: SLICE_COLORS[SLICE_COLORS.length - 1],
    });
  }

  return rows;
}

function formatRoi(roiPct: number): string {
  return `${roiPct > 0 ? '+' : ''}${roiPct.toFixed(1)}%`;
}

function SummarySkeleton() {
  return (
    <section
      className="card p-5"
      role="status"
      aria-live="polite"
      aria-label="Loading portfolio summary"
    >
      <div className="h-4 w-40 skeleton rounded mb-4" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat-card h-24 skeleton" />
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-5 items-center">
        <div className="h-44 w-44 skeleton rounded-full flex-shrink-0" />
        <div className="flex-1 w-full space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 skeleton rounded" />
          ))}
        </div>
      </div>
      <span className="sr-only">Loading portfolio summary</span>
    </section>
  );
}

function AllocationTooltip({
  active,
  payload,
  formatCurrency,
}: {
  active?: boolean;
  payload?: { payload?: AllocationRow }[];
  formatCurrency: (value: number, currency: string, options?: { decimalPlaces?: number }) => string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-card">
      <p className="text-xs font-bold text-slate-900">{row.label}</p>
      <p className="text-xs text-slate-500 tabular-nums">
        {formatCurrency(row.amount_usd, 'USD', { decimalPlaces: 0 })} ·{' '}
        {row.share_pct.toFixed(1)}%
      </p>
    </div>
  );
}

export default function PortfolioSummaryWidget() {
  const { formatCurrency } = useCurrencyFormat();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.getPortfolioSummary();
      if (mounted.current) setSummary(result);
    } catch {
      if (mounted.current) setError('We could not load your portfolio summary.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => buildAllocationRows(summary?.allocation ?? []),
    [summary],
  );

  if (loading) return <SummarySkeleton />;

  if (error) {
    return (
      <section
        role="alert"
        className="card p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
      >
        <div>
          <h3 className="section-title text-base">Portfolio summary</h3>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="btn-secondary flex-shrink-0 text-sm"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!summary || summary.position_count === 0) {
    return (
      <section className="card p-5">
        <h3 className="section-title text-base mb-2">Portfolio summary</h3>
        <p className="text-sm text-slate-500 mb-4">
          Fund a deal and this panel will track what you have invested, what it
          is worth, and how it is spread across deals.
        </p>
        <Link href="/marketplace" className="btn-primary text-sm w-fit">
          Browse Marketplace →
        </Link>
      </section>
    );
  }

  const paidOut = summary.returns_paid > 0;

  return (
    <section className="card p-5 space-y-5" aria-label="Portfolio summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title text-base">Portfolio summary</h3>
        <span className="text-xs font-medium text-slate-400">
          {summary.invested_deal_count} deal
          {summary.invested_deal_count !== 1 ? 's' : ''} ·{' '}
          {summary.position_count} position
          {summary.position_count !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Total Invested"
          value={summary.total_invested}
          icon="💰"
          color="bg-violet-50"
          isCurrency
          currency={summary.currency}
        />
        <StatCard
          label="Current Value"
          value={summary.current_value}
          icon="📊"
          color="bg-emerald-50"
          isCurrency
          currency={summary.currency}
          trend={paidOut ? `${formatCurrency(summary.returns_paid, summary.currency, { decimalPlaces: 0 })} paid out` : undefined}
          trendUp={paidOut}
        />
        <StatCard
          label="ROI"
          value={formatRoi(summary.roi_pct)}
          icon="📈"
          color="bg-sky-50"
          trend={`${formatCurrency(summary.expected_returns, summary.currency, { decimalPlaces: 0 })} expected`}
          trendUp={summary.roi_pct >= 0}
        />
        <StatCard
          label="Active Deals"
          value={summary.active_deal_count}
          icon="✅"
          color="bg-amber-50"
        />
      </div>

      <div>
        <h4 className="text-sm font-bold text-slate-900 mb-3">
          Allocation by deal
        </h4>
        <div className="flex flex-col sm:flex-row gap-5 sm:items-center">
          <div
            className="h-44 w-44 flex-shrink-0 mx-auto sm:mx-0"
            role="img"
            aria-label={`Capital allocation across ${rows.length} groups`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="amount_usd"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="100%"
                  stroke="none"
                  isAnimationActive={false}
                >
                  {rows.map((row) => (
                    <Cell key={row.key} fill={row.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={<AllocationTooltip formatCurrency={formatCurrency} />}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="flex-1 space-y-2 min-w-0">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
                <span className="truncate text-slate-700">{row.label}</span>
                <span className="ml-auto tabular-nums text-slate-500">
                  {row.share_pct.toFixed(1)}%
                </span>
                <span className="tabular-nums font-semibold text-slate-900 w-24 text-right">
                  {formatCurrency(row.amount_usd, summary.currency, {
                    decimalPlaces: 0,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
