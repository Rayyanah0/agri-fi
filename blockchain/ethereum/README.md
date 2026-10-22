# Ethereum Deal Escrow Templates

This is an isolated Hardhat workspace; it does not change the existing Soroban contracts. `DealEscrow` is an OpenZeppelin UUPS-upgradeable implementation parameterized as simple escrow (`mode=0`), milestone escrow (`mode=1`), or arbitrated dispute escrow (`mode=2`). The deployment script creates three ERC-1967 proxies with distinct initialization state.

## Contract behavior

- The buyer funds the escrow by approving the configured ERC-20 token and calling `fund()`.
- Simple mode releases the funded amount to the seller when the buyer calls `releaseSimple()`.
- Milestone mode accepts up to 64 positive milestone amounts whose sum must equal the escrow total. The buyer releases each amount once with `releaseMilestone(id)`.
- Dispute mode lets either party open a dispute with a nonzero reason hash. The arbitrator resolves it to the buyer or seller; any remainder is returned to the buyer.
- A buyer can recover the unreleased amount after the configured deadline with `refundAfterTimeout()`.
- UUPS upgrades require the proxy admin role. The implementation disables direct initialization.

The Solidity contract is the interaction API: `fund`, `releaseSimple`, `releaseMilestone`, `openDispute`, `resolveDispute`, and `refundAfterTimeout`. A product backend should submit calls using the participant's wallet signature; the contract deliberately does not custody private keys or sign user transactions.

## Deploy and verify

Install the workspace dependencies, copy `.env.example` to `.env`, set a Sepolia RPC endpoint and deployment key, and replace the example addresses for `ESCROW_BUYER`, `ESCROW_SELLER`, `ESCROW_ARBITRATOR`, and `ESCROW_TOKEN`. Set `ESCROW_AMOUNT` and comma-separated `MILESTONE_AMOUNTS` in the token's smallest units; the milestone values must be positive and sum exactly to the escrow amount. Deployment is blocked unless `ALLOW_UNAUDITED_DEPLOYMENT=true` is explicitly set after the release owner approves an external audit.

`npm run deploy:sepolia` deploys proxies and implementations and writes `deployments/<chainId>.json`; with `ETHERSCAN_API_KEY` configured it submits implementation verification. `npm run verify:sepolia` can re-submit verification from that manifest. Do not commit `.env`, keys, or deployment manifests containing operational data.

## Security and release status

This code is an implementation baseline, not an audit report. Do not deploy to mainnet or hold real assets until independent Solidity review, fuzz/invariant testing, testnet exercises, token compatibility review, and a monitored upgrade/incident procedure are complete. The repository cannot claim an external security audit or 30% gas reduction without those measured activities. Optimizer and IR compilation are enabled, but gas baselines must be measured against equivalent deal scenarios before making a reduction claim.