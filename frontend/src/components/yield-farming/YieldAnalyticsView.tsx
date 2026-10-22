'use client';

import React from 'react';
import { MOCK_ANALYTICS } from '@/lib/yield-farming';

export const YieldAnalyticsView: React.FC = () => {
  const analytics = MOCK_ANALYTICS;

  return (
    <div className="space-y-6">
      {/* Platform Level KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Total Platform TVL</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            ${(analytics.totalPlatformTvl / 1_000_000).toFixed(2)}M
          </p>
          <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 inline-block">
            +18.4% this month
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Total Rewards Distributed</span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            ${(analytics.totalDistributedRewards / 1_000).toFixed(1)}k
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 inline-block">
            Across 5 pools
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Active Liquidity Providers</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {analytics.activeStakers.toLocaleString()}
          </p>
          <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 inline-block">
            +142 this week
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Average Platform APY</span>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            {analytics.averageApy}%
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 inline-block">
            Compounded daily
          </span>
        </div>
      </div>

      {/* Historical TVL Progression Table / Representation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
        <h4 className="font-bold text-slate-900 dark:text-white text-base mb-4">
          TVL & APY Trajectory
        </h4>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="pb-3">Period</th>
                <th className="pb-3">Total Value Locked (USD)</th>
                <th className="pb-3">Effective Pool APY</th>
                <th className="pb-3">Growth Momentum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {analytics.tvlHistory.map((row, idx) => (
                <tr key={row.date} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="py-3 font-semibold text-slate-900 dark:text-white">{row.date}</td>
                  <td className="py-3 font-medium text-slate-700 dark:text-slate-300">
                    ${(row.tvl / 1_000_000).toFixed(2)}M
                  </td>
                  <td className="py-3 font-bold text-emerald-600 dark:text-emerald-400">
                    {row.apy}%
                  </td>
                  <td className="py-3">
                    <div className="w-36 bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full"
                        style={{ width: `${Math.min(100, (row.tvl / 10310000) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Earnings & Harvest History */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
        <h4 className="font-bold text-slate-900 dark:text-white text-base mb-3">
          My Recent Reward Harvests
        </h4>
        <div className="space-y-2.5">
          {analytics.earningsHistory.map((item, idx) => (
            <div
              key={idx}
              className="flex justify-between items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs"
            >
              <div>
                <span className="font-bold text-slate-900 dark:text-white">{item.pool}</span>
                <span className="text-[11px] text-slate-400 block">{item.date} · Tx: {item.txHash}</span>
              </div>
              <div className="text-right">
                <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-sm">
                  +{item.amount} AGRI
                </span>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300 block">Confirmed on Stellar</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
