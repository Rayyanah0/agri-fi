# Blockchain-Based Reputation System

_Issue #1198 — Blockchain: Implement blockchain-based reputation system with staking and slashing_

## Overview

The `reputation` Soroban smart contract implements an on-chain reputation
system with economic incentives: users stake tokens to participate, earn
score points and token rewards for good behaviour, and face token slashing and
score reduction for misconduct.

## Architecture

```
User
 ├── stake(amount)           → transfer tokens to contract; initialise score=500
 ├── unstake()               → withdraw remaining stake; remove score record
 └── get_score()             → read current on-chain reputation score (0–1000)

Admin (oracle / milestone contract)
 ├── reward(user, amount)    → +10 score points; accumulate token rewards
 └── slash(user, amount)     → −30 score points; deduct slash_amount from stake
```

## Score Model

| Event | Score delta |
|-------|-------------|
| On-time delivery / milestone completion | +10 |
| Default / misconduct | −30 |

- Score initialises at **500** on first stake.
- Score is capped at **1000** and floored at **0**.
- Score is removed when the user unstakes (full withdrawal).

## Staking

- Minimum stake: **1 000 tokens** (7 decimals → `1_000_0000000` raw).
- Staked tokens are held by the contract until the user calls `unstake`.
- Slashed tokens are permanently removed from the user's staked balance.

## Storage Layout

| Key | Type | Description |
|-----|------|-------------|
| `Admin` | `Address` | Instance storage — contract administrator |
| `StakeToken` | `Address` | Instance storage — ERC-20-style token address |
| `Stake(user)` | `i128` | Persistent — current staked balance |
| `Score(user)` | `i64` | Persistent — current reputation score |
| `Rewards(user)` | `i128` | Persistent — cumulative token rewards earned |

## Events

| Topic | Data | Emitted when |
|-------|------|-------------|
| `staked` | `(user, amount)` | User stakes tokens |
| `unstaked` | `(user, amount)` | User withdraws stake |
| `rewarded` | `(user, new_score, token_amount)` | Admin rewards user |
| `slashed` | `(user, new_score, slash_amount)` | Admin slashes user |

## Building and Testing

```bash
cd blockchain/contracts/reputation
cargo test
cargo build --release --target wasm32-unknown-unknown
```

## Deploying on Testnet

```bash
stellar contract deploy \
  --wasm ../../target/wasm32-unknown-unknown/release/reputation.wasm \
  --source <deployer-key> \
  --network testnet

stellar contract invoke \
  --id <contract-id> \
  --source <admin-key> \
  --network testnet \
  -- initialize \
  --admin <admin-address> \
  --stake_token <token-address>
```
