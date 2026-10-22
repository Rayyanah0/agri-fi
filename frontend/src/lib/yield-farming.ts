export type PoolType = 'staking' | 'liquidity_farming';

export interface StakingPool {
  id: string;
  name: string;
  poolType: PoolType;
  tokenSymbol: string;
  tokenIcon: string;
  pairTokens?: [string, string];
  apr: number; // Base APR percentage
  apy: number; // Auto-compounded APY percentage
  tvl: number; // Total Value Locked in USD
  multiplier: string;
  lockPeriodDays: number;
  rewardTokens: string[];
  userStaked: number;
  userPendingRewards: number;
  userRewardValueUsd: number;
  userWalletBalance: number;
}

export interface YieldStrategy {
  id: string;
  name: string;
  description: string;
  riskLevel: 'Conservative' | 'Balanced' | 'Max Yield';
  targetApy: number;
  recommendedPools: string[];
  allocation: Array<{ poolName: string; percentage: number }>;
  compoundFrequency: string;
}

export interface YieldAnalyticsData {
  totalPlatformTvl: number;
  totalDistributedRewards: number;
  activeStakers: number;
  averageApy: number;
  tvlHistory: Array<{ date: string; tvl: number; apy: number }>;
  earningsHistory: Array<{ date: string; amount: number; pool: string; txHash: string }>;
}

export const INITIAL_POOLS: StakingPool[] = [
  {
    id: 'pool-agri-single',
    name: 'AGRI Platform Staking',
    poolType: 'staking',
    tokenSymbol: 'AGRI',
    tokenIcon: '🌾',
    apr: 18.5,
    apy: 20.3,
    tvl: 1850000,
    multiplier: '1.0x',
    lockPeriodDays: 0,
    rewardTokens: ['AGRI'],
    userStaked: 1250,
    userPendingRewards: 48.75,
    userRewardValueUsd: 73.12,
    userWalletBalance: 5000,
  },
  {
    id: 'pool-agri-locked-90',
    name: 'AGRI Vault 90-Day Lock',
    poolType: 'staking',
    tokenSymbol: 'AGRI',
    tokenIcon: '🔒',
    apr: 28.0,
    apy: 32.2,
    tvl: 2420000,
    multiplier: '1.6x',
    lockPeriodDays: 90,
    rewardTokens: ['AGRI', 'USDC'],
    userStaked: 3000,
    userPendingRewards: 112.4,
    userRewardValueUsd: 168.6,
    userWalletBalance: 5000,
  },
  {
    id: 'pool-agri-usdc-lp',
    name: 'AGRI / USDC Liquidity Pool',
    poolType: 'liquidity_farming',
    tokenSymbol: 'AGRI-USDC LP',
    tokenIcon: '💧',
    pairTokens: ['AGRI', 'USDC'],
    apr: 36.5,
    apy: 44.1,
    tvl: 3100000,
    multiplier: '2.5x',
    lockPeriodDays: 14,
    rewardTokens: ['AGRI', 'XLM'],
    userStaked: 850,
    userPendingRewards: 96.2,
    userRewardValueUsd: 144.3,
    userWalletBalance: 1200,
  },
  {
    id: 'pool-agri-xlm-lp',
    name: 'AGRI / XLM Stellar Farming',
    poolType: 'liquidity_farming',
    tokenSymbol: 'AGRI-XLM LP',
    tokenIcon: '🚀',
    pairTokens: ['AGRI', 'XLM'],
    apr: 42.0,
    apy: 52.8,
    tvl: 1950000,
    multiplier: '3.0x',
    lockPeriodDays: 30,
    rewardTokens: ['AGRI', 'USDC'],
    userStaked: 500,
    userPendingRewards: 64.5,
    userRewardValueUsd: 96.75,
    userWalletBalance: 800,
  },
  {
    id: 'pool-cocoa-commodity-vault',
    name: 'Cocoa Harvest Yield Vault',
    poolType: 'staking',
    tokenSymbol: 'COCOA-VLT',
    tokenIcon: '🍫',
    apr: 22.4,
    apy: 25.1,
    tvl: 890000,
    multiplier: '1.25x',
    lockPeriodDays: 60,
    rewardTokens: ['USDC'],
    userStaked: 0,
    userPendingRewards: 0,
    userRewardValueUsd: 0,
    userWalletBalance: 2500,
  },
];

export const YIELD_STRATEGIES: YieldStrategy[] = [
  {
    id: 'strat-conservative',
    name: 'Capital Preservation & Steady APY',
    description: 'Focus on flexible platform staking and stable pools with minimum lock-ups and low impermanent loss.',
    riskLevel: 'Conservative',
    targetApy: 21.5,
    recommendedPools: ['pool-agri-single', 'pool-cocoa-commodity-vault'],
    allocation: [
      { poolName: 'AGRI Platform Staking', percentage: 70 },
      { poolName: 'Cocoa Harvest Vault', percentage: 30 },
    ],
    compoundFrequency: 'Daily Auto-Compound',
  },
  {
    id: 'strat-balanced',
    name: 'Balanced Farm & Vault Accumulator',
    description: 'Blends locked single-token staking with high-depth LP farms to capture liquidity fees and farming incentives.',
    riskLevel: 'Balanced',
    targetApy: 38.2,
    recommendedPools: ['pool-agri-locked-90', 'pool-agri-usdc-lp'],
    allocation: [
      { poolName: 'AGRI Vault 90-Day Lock', percentage: 50 },
      { poolName: 'AGRI / USDC LP', percentage: 50 },
    ],
    compoundFrequency: '12-Hour Optimized Harvest',
  },
  {
    id: 'strat-max-yield',
    name: 'Maximum Multiplier Farming',
    description: 'Highest APY strategy leveraging 3x multi-token reward pools and dual-asset Stellar Soroban AMM liquidity.',
    riskLevel: 'Max Yield',
    targetApy: 52.8,
    recommendedPools: ['pool-agri-xlm-lp', 'pool-agri-usdc-lp'],
    allocation: [
      { poolName: 'AGRI / XLM Stellar Farming', percentage: 60 },
      { poolName: 'AGRI / USDC LP', percentage: 40 },
    ],
    compoundFrequency: 'Continuous Auto-Reinvest',
  },
];

export const MOCK_ANALYTICS: YieldAnalyticsData = {
  totalPlatformTvl: 10310000,
  totalDistributedRewards: 842500,
  activeStakers: 2480,
  averageApy: 34.6,
  tvlHistory: [
    { date: 'May 01', tvl: 6200000, apy: 28.4 },
    { date: 'May 15', tvl: 7100000, apy: 31.0 },
    { date: 'Jun 01', tvl: 8400000, apy: 33.2 },
    { date: 'Jun 15', tvl: 9200000, apy: 35.8 },
    { date: 'Jul 01', tvl: 10310000, apy: 34.6 },
  ],
  earningsHistory: [
    { date: '2026-06-18', amount: 32.5, pool: 'AGRI-USDC LP', txHash: '0x8f2a...c31b' },
    { date: '2026-06-11', amount: 28.1, pool: 'AGRI 90-Day Lock', txHash: '0x4d19...aa0e' },
    { date: '2026-06-04', amount: 24.0, pool: 'AGRI Platform Staking', txHash: '0x17bc...881f' },
  ],
};

/**
 * Calculates compound APY from APR and compound periods per year.
 */
export function calculateCompoundedApy(apr: number, periodsPerYear = 365): number {
  const r = apr / 100;
  const apy = Math.pow(1 + r / periodsPerYear, periodsPerYear) - 1;
  return Math.round(apy * 10000) / 100;
}

/**
 * Estimates earnings based on amount, APY, and duration in days.
 */
export function estimateYield(amount: number, apyPercent: number, days: number): number {
  const ratePerDay = (apyPercent / 100) / 365;
  return Math.round(amount * ratePerDay * days * 100) / 100;
}
