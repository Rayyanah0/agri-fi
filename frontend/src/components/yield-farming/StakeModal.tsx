'use client';

import React, { useState } from 'react';
import { StakingPool, estimateYield } from '@/lib/yield-farming';

interface StakeModalProps {
  pool: StakingPool;
  mode: 'stake' | 'unstake';
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (poolId: string, amount: number, mode: 'stake' | 'unstake') => void;
}

export const StakeModal: React.FC<StakeModalProps> = ({
  pool,
  mode,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [amount, setAmount] = useState<string>('');
  const maxAvailable = mode === 'stake' ? pool.userWalletBalance : pool.userStaked;
  const numAmount = parseFloat(amount) || 0;

  if (!isOpen) return null;

  const handleMax = () => {
    setAmount(maxAvailable.toString());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0 || numAmount > maxAvailable) return;
    onConfirm(pool.id, numAmount, mode);
    onClose();
  };

  const estimatedMonthly = estimateYield(numAmount, pool.apy, 30);
  const estimatedYearly = estimateYield(numAmount, pool.apy, 365);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">{pool.tokenIcon}</span>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white capitalize">
                {mode} {pool.tokenSymbol}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {pool.name} · APY: <span className="text-emerald-600 font-semibold">{pool.apy}%</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <div className="flex justify-between items-center text-xs mb-1.5 text-slate-600 dark:text-slate-400">
              <span>Amount</span>
              <span className="cursor-pointer text-emerald-600 dark:text-emerald-400 font-medium" onClick={handleMax}>
                Available: {maxAvailable.toLocaleString()} {pool.tokenSymbol} (Max)
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                max={maxAvailable}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 text-lg tabular-nums"
                required
              />
              <button
                type="button"
                onClick={handleMax}
                className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200"
              >
                MAX
              </button>
            </div>
          </div>

          {mode === 'stake' && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Lock Duration</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {pool.lockPeriodDays > 0 ? `${pool.lockPeriodDays} Days` : 'Flexible (No lock)'}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Reward Multiplier</span>
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">{pool.multiplier}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Est. 30-Day Rewards</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  +{estimatedMonthly} {pool.rewardTokens[0]}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Est. 1-Year Rewards</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  +{estimatedYearly} {pool.rewardTokens[0]}
                </span>
              </div>
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={numAmount <= 0 || numAmount > maxAvailable}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold shadow-lg shadow-emerald-600/20 transition capitalize"
            >
              Confirm {mode}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
