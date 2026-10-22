'use client';

import React, { useState } from 'react';
import {
  INITIAL_POOLS,
  StakingPool,
  YieldStrategy,
} from '@/lib/yield-farming';
import { PoolCard } from './PoolCard';
import { StakeModal } from './StakeModal';
import { StrategyOptimizer } from './StrategyOptimizer';
import { YieldAnalyticsView } from './YieldAnalyticsView';

export const YieldFarmingDashboard: React.FC = () => {
  const [pools, setPools] = useState<StakingPool[]>(INITIAL_POOLS);
  const [activeTab, setActiveTab] = useState<'all' | 'staking' | 'farming' | 'optimizer' | 'analytics'>('all');
  const [selectedPool, setSelectedPool] = useState<StakingPool | null>(null);
  const [modalMode, setModalMode] = useState<'stake' | 'unstake'>('stake');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleOpenStake = (pool: StakingPool) => {
    setSelectedPool(pool);
    setModalMode('stake');
    setIsModalOpen(true);
  };

  const handleOpenUnstake = (pool: StakingPool) => {
    setSelectedPool(pool);
    setModalMode('unstake');
    setIsModalOpen(true);
  };

  const handleConfirmStake = (poolId: string, amount: number, mode: 'stake' | 'unstake') => {
    setPools((prev) =>
      prev.map((p) => {
        if (p.id !== poolId) return p;
        if (mode === 'stake') {
          return {
            ...p,
            userStaked: p.userStaked + amount,
            userWalletBalance: Math.max(0, p.userWalletBalance - amount),
            tvl: p.tvl + amount * 1.5,
          };
        } else {
          return {
            ...p,
            userStaked: Math.max(0, p.userStaked - amount),
            userWalletBalance: p.userWalletBalance + amount,
            tvl: Math.max(0, p.tvl - amount * 1.5),
          };
        }
      }),
    );
    showNotification(
      `Successfully ${mode === 'stake' ? 'staked' : 'unstaked'} ${amount.toLocaleString()} tokens!`,
    );
  };

  const handleClaim = (poolId: string) => {
    const pool = pools.find((p) => p.id === poolId);
    if (!pool || pool.userPendingRewards <= 0) return;

    const claimed = pool.userPendingRewards;
    setPools((prev) =>
      prev.map((p) =>
        p.id === poolId
          ? { ...p, userPendingRewards: 0, userRewardValueUsd: 0 }
          : p,
      ),
    );
    showNotification(`Harvested ${claimed.toFixed(2)} ${pool.rewardTokens[0]} to your Stellar wallet!`);
  };

  const handleClaimAll = () => {
    const totalPending = pools.reduce((acc, p) => acc + p.userPendingRewards, 0);
    if (totalPending <= 0) {
      showNotification('No rewards pending harvest at this time.');
      return;
    }
    setPools((prev) =>
      prev.map((p) => ({ ...p, userPendingRewards: 0, userRewardValueUsd: 0 })),
    );
    showNotification(`Harvested ${totalPending.toFixed(2)} total reward tokens!`);
  };

  const handleApplyStrategy = (strategy: YieldStrategy) => {
    showNotification(`Applied ${strategy.name}. Auto-compound schedule active!`);
  };

  const totalUserStakedUsd = pools.reduce((acc, p) => acc + p.userStaked * 1.5, 0);
  const totalClaimableUsd = pools.reduce((acc, p) => acc + p.userRewardValueUsd, 0);
  const totalPlatformTvl = pools.reduce((acc, p) => acc + p.tvl, 0);

  const displayedPools = pools.filter((p) => {
    if (activeTab === 'staking') return p.poolType === 'staking';
    if (activeTab === 'farming') return p.poolType === 'liquidity_farming';
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <span>✓</span>
          <span className="text-sm font-semibold">{notification}</span>
        </div>
      )}

      {/* Header & Claim Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
            DeFi Agriculture Liquidity Hub
          </span>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white mt-1">
            Yield Farming & Staking
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Provide liquidity, stake platform assets, and earn auto-compounding rewards backed by real agricultural commodity trade deals.
          </p>
        </div>

        <button
          onClick={handleClaimAll}
          className="self-start md:self-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 transition flex items-center gap-2"
        >
          <span>🌾</span> Harvest All Rewards (${totalClaimableUsd.toFixed(2)})
        </button>
      </div>

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Value Locked</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            ${(totalPlatformTvl / 1_000_000).toFixed(2)}M
          </p>
          <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 inline-block">
            Across 5 pools
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">My Staked Value</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            ${totalUserStakedUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 inline-block">
            Active in 4 pools
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Claimable Yield</span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            ${totalClaimableUsd.toFixed(2)}
          </p>
          <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 inline-block">
            Ready to harvest
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Max Available APY</span>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            52.8%
          </p>
          <span className="text-[11px] text-indigo-600 font-semibold mt-0.5 inline-block">
            AGRI/XLM Stellar Pool
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-3 overflow-x-auto text-sm font-semibold">
        {[
          { key: 'all', label: 'All Opportunities' },
          { key: 'staking', label: 'Single Staking' },
          { key: 'farming', label: 'Liquidity Farming' },
          { key: 'optimizer', label: 'Strategy Optimizer' },
          { key: 'analytics', label: 'Analytics & TVL' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-2 rounded-xl transition whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Rendering */}
      {activeTab === 'optimizer' ? (
        <StrategyOptimizer onApplyStrategy={handleApplyStrategy} />
      ) : activeTab === 'analytics' ? (
        <YieldAnalyticsView />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayedPools.map((pool) => (
            <PoolCard
              key={pool.id}
              pool={pool}
              onOpenStake={handleOpenStake}
              onOpenUnstake={handleOpenUnstake}
              onClaim={handleClaim}
            />
          ))}
        </div>
      )}

      {/* Stake/Unstake Modal */}
      {selectedPool && (
        <StakeModal
          pool={selectedPool}
          mode={modalMode}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onConfirm={handleConfirmStake}
        />
      )}
    </div>
  );
};
