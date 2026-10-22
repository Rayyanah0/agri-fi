'use client';

import React from 'react';
import { MOCK_FACTORING_ANALYTICS } from '@/lib/invoice-factoring';

export const FactoringAnalyticsView: React.FC = () => {
  const analytics = MOCK_FACTORING_ANALYTICS;

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">Total Factored Volume</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            ${(analytics.totalFactoredVolume / 1_000_000).toFixed(2)}M
          </p>
          <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 inline-block">
            +32% vs last quarter
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">Historical Default Rate</span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {analytics.defaultRate}%
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 inline-block">
            Industry average: 2.4%
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">Average Cash-Out Turnaround</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {analytics.averageCashoutHours} Hours
          </p>
          <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 inline-block">
            From listing to wallet advance
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 font-medium">Insured Coverage Ratio</span>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            {analytics.insuredInvoicesRatio}%
          </p>
          <span className="text-[11px] text-indigo-600 font-semibold mt-0.5 inline-block">
            Protected by default insurance
          </span>
        </div>
      </div>

      {/* Monthly Volume Progression Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
        <h4 className="font-bold text-slate-900 dark:text-white text-base mb-4">
          Monthly Factoring Growth
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="pb-3">Month</th>
                <th className="pb-3">Factored Volume (USD)</th>
                <th className="pb-3">Invoices Advanced</th>
                <th className="pb-3">Relative Velocity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {analytics.monthlyVolume.map((item) => (
                <tr key={item.month} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="py-3 font-semibold text-slate-900 dark:text-white">{item.month} 2026</td>
                  <td className="py-3 font-medium text-slate-700 dark:text-slate-300">
                    ${(item.volume / 1_000).toFixed(0)}k
                  </td>
                  <td className="py-3 font-bold text-slate-900 dark:text-white">
                    {item.invoices} Invoices
                  </td>
                  <td className="py-3">
                    <div className="w-40 bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full"
                        style={{ width: `${(item.volume / 1750000) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
