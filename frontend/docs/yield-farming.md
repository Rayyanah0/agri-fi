# Yield Farming & Staking Rewards Documentation

## Overview

The AgriFi Yield Farming and Staking Platform provides decentralized finance (DeFi) yield incentives for liquidity providers and platform token holders. Users can stake single assets (such as AGRI platform tokens or commodity vaults) or deposit Liquidity Provider (LP) tokens on automated market maker (AMM) pools (such as AGRI/USDC and AGRI/XLM) to earn competitive, auto-compounding rewards directly on the Stellar Soroban network.

---

## Core Features

1. **Single-Asset Staking Pools**:
   - Flexible Staking: Unstake anytime without lockup restrictions (18.5% APR / 20.3% APY).
   - Term Vaults: 90-day fixed lock periods with a 1.6x booster multiplier (28.0% APR / 32.2% APY).
   - Commodity Yield Vaults: Backed by seasonal harvest revenue distributions (e.g., Cocoa Harvest Yield Vault).
2. **Liquidity Farming Pools**:
   - AGRI/USDC LP: 2.5x reward multiplier (36.5% APR / 44.1% APY).
   - AGRI/XLM Stellar Farming: 3.0x reward multiplier (42.0% APR / 52.8% APY).
3. **Compound APY Mathematical Modeling**:
   Compounded daily:
   $$\text{APY} = \left(1 + \frac{\text{APR}}{365}\right)^{365} - 1$$
4. **Reward Claim & Harvest Mechanism**:
   - Real-time accrual of rewards per block/ledger.
   - Per-pool "Harvest" button and global "Harvest All Rewards" banner.
5. **AI Yield Strategy Optimizer**:
   - Pre-configured allocation profiles:
     - **Conservative**: Capital preservation, low impermanent loss, flexible withdrawals.
     - **Balanced**: 50/50 mix of single-asset vaults and high-depth AMM liquidity pools.
     - **Max Yield**: Aggressive dual-asset LP staking with multi-token reward accrual.
6. **Analytics & Performance Tracking**:
   - Platform Total Value Locked (TVL) metrics and historical chart.
   - Total rewards distributed across all stakers.
   - Personal earnings harvest history with Stellar ledger transaction hash receipts.

---

## Component Architecture

- `YieldFarmingDashboard`: High-level layout hosting the global summary stats, category filter tabs, and pool listings.
- `PoolCard`: Interactive card detailing individual pool APR/APY, TVL, user staked balance, pending rewards, and action buttons.
- `StakeModal`: Dynamic dialog handling both `stake` and `unstake` flows with balance validation, lock-term notice, and return projection.
- `StrategyOptimizer`: Allocation engine recommending diversified pool distributions based on user risk tolerance.
- `YieldAnalyticsView`: Metrics dashboard showing platform TVL trajectory, active participants, and reward transaction history.

---

## Navigation & Routing

The Yield Farming platform is available at:
```
/[locale]/yield-farming
```
For example: `/en/yield-farming` or `/fr/yield-farming`.
