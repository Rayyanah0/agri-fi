# Stellar Mainnet Migration and Readiness Checklist

## Overview
This document outlines the operational runbook, security checklist, and infrastructure procedures required to transition the Agri-Fi platform from Stellar Testnet to Stellar Mainnet.

## Mainnet Onboarding Checklist

### 1. Key Management and Security
- [ ] Secrets provisioned in AWS KMS / HashiCorp Vault.
- [ ] No hardcoded secret seeds or operational private keys in environment files.
- [ ] Multi-signature configuration active for platform admin and treasury accounts.
- [ ] Key rotation procedure tested and operational.

### 2. Network Configuration & Failover
- [ ] Set `STELLAR_NETWORK=mainnet`.
- [ ] Primary Horizon endpoint: `https://horizon.stellar.org`.
- [ ] Backup Horizon endpoint configured for automatic failover.
- [ ] Friendbot removed from production endpoints.

### 3. Pre-Flight Simulations & Dry-Runs
- [ ] Dry-run deal funding transactions on testnet simulation environment.
- [ ] Verify base reserves and dynamic fee estimator.
- [ ] Transaction replay protection active (distinct network passphrases enforced).

### 4. Monitoring & Alerting
- [ ] Prometheus metrics active for Horizon response times and ledger latency.
- [ ] Alerts for failed submissions or network desynchronization.
- [ ] Network-specific logging with `[MAINNET]` prefix.

### 5. Staged Rollout & Rollback Triggers
- Stage 1: Whitelisted partner deals (pilot volume < $10k).
- Stage 2: Incremental volume expansion with manual checkpoint reviews.
- Rollback Trigger: Any consecutive ledger failure or unexplained balance mismatch immediately pauses contract interactions.
