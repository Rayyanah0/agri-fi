'use client';

import React, { useState } from 'react';
import { YIELD_STRATEGIES, YieldStrategy } from '@/lib/yield-farming';

interface StrategyOptimizerProps {
  onApplyStrategy: (strategy: YieldStrategy) => void;
}

export const StrategyOptimizer: React.FC<StrategyOptimizerProps> = ({ onApplyStrategy }) => {
  const [selectedRisk, setSelectedRisk] = useState<string>('Balanced');

  const filteredStrategies = YIELD_STRATEGIES.filter(
    (s) => selectedRisk === 'All' || s.riskLevel === selectedRisk,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-gradient-to-r from-emerald-900 to-teal-900 text-white rounded-2xl p-6 shadow-xl">
        <div>
          <span className="text-emerald-300 text-xs font-bold uppercase tracking-wider">
            AI Automated Asset Allocation
          </span>
          <h3 className="text-xl font-black mt-1">Yield Strategy Optimizer</h3>
          <p className="text-emerald-100/80 text-xs sm:text-sm mt-1 max-w-xl">
            Maximize your liquidity return by balancing impermanent loss risk, lock terms, and auto-compounding schedules.
          </p>
        </div>

        <div className="flex gap-1.5 p-1 bg-white/10 rounded-xl backdrop-blur-sm self-start sm:self-auto">
          {['All', 'Conservative', 'Balanced', 'Max Yield'].map((risk) => (
            <button
              key={risk}
              onClick={() => setSelectedRisk(risk)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                selectedRisk === risk
                  ? 'bg-white text-emerald-900 shadow-md'
                  : 'text-white/80 hover:text-white hover:bg-white/5'
              }`}
            >
              {risk}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {filteredStrategies.map((strategy) => (
          <div
            key={strategy.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-emerald-500/50 hover:shadow-lg transition-all"
          >
            <div>
              <div className="flex justify-between items-start mb-3">
                <span
                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    strategy.riskLevel === 'Conservative'
                      ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                      : strategy.riskLevel === 'Balanced'
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        : 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300'
                  }`}
                >
                  {strategy.riskLevel}
                </span>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-medium">Target APY</span>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                    ~{strategy.targetApy}%
                  </span>
                </div>
              </div>

              <h4 className="font-bold text-slate-900 dark:text-white text-base mb-1.5">
                {strategy.name}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                {strategy.description}
              </p>

              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                  Recommended Allocation:
                </span>
                {strategy.allocation.map((alloc) => (
                  <div key={alloc.poolName} className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span className="truncate pr-2">{alloc.poolName}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{alloc.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-medium">
                {strategy.compoundFrequency}
              </span>
              <button
                onClick={() => onApplyStrategy(strategy)}
                className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
              >
                Deploy Strategy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
