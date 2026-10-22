'use client';

import React from 'react';
import { StakingPool } from '@/lib/yield-farming';

interface PoolCardProps {
  pool: StakingPool;
  onOpenStake: (pool: StakingPool) => void;
  onOpenUnstake: (pool: StakingPool) => void;
  onClaim: (poolId: string) => void;
}

export const PoolCard: React.FC<PoolCardProps> = ({
  pool,
  onOpenStake,
  onOpenUnstake,
  onClaim,
}) => {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg transition-all duration-200 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800">
              {pool.tokenIcon}
            </span>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-base">{pool.name}</h4>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-medium text-slate-600 dark:text-slate-300">
                  {pool.poolType === 'liquidity_farming' ? 'LP Farming' : 'Single Staking'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 font-semibold text-indigo-600 dark:text-indigo-400">
                  {pool.multiplier}
                </span>
              </div>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs text-slate-500 dark:text-slate-400 block font-medium">APY</span>
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
              {pool.apy}%
            </span>
            <span className="text-[10px] text-slate-400 block">APR: {pool.apr}%</span>
          </div>
        </div>

        {/* Pool Metrics Grid */}
        <div className="grid grid-cols-2 gap-2.5 py-3 border-y border-slate-100 dark:border-slate-800/80 my-3 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400">Total Value Locked</span>
            <p className="font-semibold text-slate-900 dark:text-white text-sm mt-0.5">
              ${(pool.tvl / 1_000_000).toFixed(2)}M
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Lock Period</span>
            <p className="font-semibold text-slate-900 dark:text-white text-sm mt-0.5">
              {pool.lockPeriodDays > 0 ? `${pool.lockPeriodDays} Days` : 'Flexible'}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Reward Tokens</span>
            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
              {pool.rewardTokens.join(' + ')}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">My Staked</span>
            <p className="font-semibold text-slate-900 dark:text-white text-sm mt-0.5">
              {pool.userStaked.toLocaleString()} {pool.tokenSymbol}
            </p>
          </div>
        </div>

        {/* User Earned Section */}
        {pool.userStaked > 0 && (
          <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 rounded-xl p-3 mb-4 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">Pending Rewards</span>
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                {pool.userPendingRewards.toFixed(2)} {pool.rewardTokens[0]}{' '}
                <span className="text-xs font-normal text-emerald-700/80">(${pool.userRewardValueUsd.toFixed(2)})</span>
              </p>
            </div>
            <button
              onClick={() => onClaim(pool.id)}
              disabled={pool.userPendingRewards <= 0}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition"
            >
              Harvest
            </button>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => onOpenStake(pool)}
          className="flex-1 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 transition shadow-sm"
        >
          Stake
        </button>
        {pool.userStaked > 0 && (
          <button
            onClick={() => onOpenUnstake(pool)}
            className="flex-1 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Unstake
          </button>
        )}
      </div>
    </div>
  );
};
