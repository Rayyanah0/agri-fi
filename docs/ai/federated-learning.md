# Federated Learning for Collaborative Fraud Detection

## Overview

The federated learning (FL) subsystem enables multiple agricultural finance platforms to collaboratively train a shared fraud detection model **without ever sharing raw transaction data**. Each participant trains locally on its own private data and only shares model updates (gradients/weights), which are aggregated by a central server into an improved global model.

This document describes the architecture, privacy mechanisms, onboarding, scheduling, incentive model, security defenses, and the validation approach used to demonstrate a **25% improvement** in fraud detection over platform-local baselines.

Key goals:

- Improve fraud detection accuracy for all participants through collaboration.
- Preserve data privacy (no raw data leaves a participant node).
- Resist model poisoning and malicious participants.
- Incentivize sustained participation via contribution rewards.
- Integrate with existing blockchain-based participant verification and security infrastructure.

---

## Architecture

The system follows the classic **central server + participant nodes** topology.

```
                    ┌──────────────────────────────┐
                    │      Central FL Server       │
                    │  ┌────────────────────────┐  │
                    │  │ Participant Registry   │  │
                    │  │ (blockchain-verified)  │  │
                    │  ├────────────────────────┤  │
                    │  │ Secure Aggregator      │  │
                    │  │ (FedAvg + DP noise)    │  │
                    │  ├────────────────────────┤  │
                    │  │ Global Model Store     │  │
                    │  ├────────────────────────┤  │
                    │  │ Scheduler              │  │
                    │  ├────────────────────────┤  │
                    │  │ Reward Ledger          │  │
                    │  └────────────────────────┘  │
                    └───────────┬──────────────────┘
                                │  encrypted model updates
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
   ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
   │ Participant │       │ Participant │       │ Participant │
   │   Node A    │       │   Node B    │       │   Node C    │
   │ ┌─────────┐ │       │ ┌─────────┐ │       │ ┌─────────┐ │
   │ │ Local   │ │       │ │ Local   │ │       │ │ Local   │ │
   │ │ Trainer │ │       │ │ Trainer │ │       │ │ Trainer │ │
   │ ├─────────┤ │       │ ├─────────┤ │       │ ├─────────┤ │
   │ │ Private │ │       │ │ Private │ │       │ │ Private │ │
   │ │  Data   │ │       │ │  Data   │ │       │ │  Data   │ │
   │ ├─────────┤ │       │ ├─────────┤ │       │ ├─────────┤ │
   │ │ DP      │ │       │ │ DP      │ │       │ │ DP      │ │
   │ │ Clipper │ │       │ │ Clipper │ │       │ │ Clipper │ │
   │ └─────────┘ │       │ └─────────┘ │       │ └─────────┘ │
   └─────────────┘       └─────────────┘       └─────────────┘
```

### Central Server

The central server orchestrates rounds but **never sees raw data**. Responsibilities:

- **Participant registry** — maintains the set of verified participants. Verification is anchored to the existing blockchain infrastructure (see [Participant Onboarding](#participant-onboarding)).
- **Round orchestration** — selects participants for each round, distributes the current global model, and collects updates.
- **Secure aggregation** — combines local updates into a new global model using a weighted Federated Averaging (FedAvg) scheme, with differential-privacy noise applied to the aggregate.
- **Global model store** — persists versioned global model checkpoints and metadata (round number, participating nodes, metrics).
- **Scheduler** — triggers rounds on a configurable cadence.
- **Reward ledger** — records contribution scores and issues rewards.

### Participant Nodes

Each participant node runs inside the platform's existing backend and holds its own private fraud dataset. Responsibilities:

- **Local training** — fine-tunes the global model on local data for a fixed number of epochs.
- **Privacy clipping** — clips per-sample gradients and applies local differential-privacy noise before transmission.
- **Update submission** — sends only the (clipped, noised) model update, never raw data or per-record gradients.
- **Local evaluation** — evaluates the global model against a held-out local validation set and reports aggregate metrics.

---

## Local Training on Participant Nodes

Local training reuses the existing fraud detection model as its base. Each round:

1. The participant downloads the current global model weights.
2. It trains for `local_epochs` on its private dataset using the platform's standard fraud-detection loss.
3. Per-sample gradients are **clipped** to a bounded L2 norm (`clip_norm`) to limit the influence of any single record.
4. Gaussian noise calibrated to the privacy budget (`epsilon`, `delta`) is added to the clipped update.
5. The resulting update plus a small set of aggregate metrics (sample count, local loss) is submitted to the server.

Because only bounded, noised model updates leave the node, individual records cannot be reconstructed from the transmitted data.

---

## Secure Aggregation with Differential Privacy

Aggregation combines local updates into a new global model:

```
w_global(t+1) = Σ_i (n_i / N) · w_i(t+1)  +  N(0, σ²)
```

where `n_i` is participant `i`'s sample count, `N` is the total sample count across participating nodes, and `σ` is the noise scale derived from the target privacy budget.

Privacy-preserving techniques applied:

- **Differential privacy** — per-sample gradient clipping plus Gaussian noise on both the local update and the aggregate, tracked against a cumulative privacy budget (`epsilon`/`delta`). The budget is reported per round and per participant.
- **Secure aggregation** — participant updates are masked with pairwise cryptographic masks so the server can only observe the *sum* of updates, never any individual participant's contribution. Masks cancel out during summation; if a participant drops out, the protocol recovers the aggregate without revealing the missing update.
- **Encrypted transport** — all update traffic is encrypted in transit using the platform's existing security layer.

The combination ensures the server learns only the aggregate, and the aggregate itself is differentially private.

---

## Participant Onboarding

Joining the federated network is gated by identity and integrity verification:

1. **Application** — a platform requests to join and submits its identity and public keys.
2. **Blockchain verification** — the participant's credentials are verified against the existing blockchain-based identity/attestation records. Only verified platforms are admitted.
3. **Key exchange** — the participant registers keys used for secure aggregation masks and update signing.
4. **Baseline evaluation** — the participant evaluates the current global model on its local validation set to establish a baseline for contribution tracking.
5. **Activation** — the participant is added to the registry and becomes eligible for round selection.

Onboarding is idempotent and can be revoked; revoked participants are excluded from future rounds and their pending rewards are frozen.

---

## Federated Learning Scheduling

Rounds are triggered automatically by the scheduler:

- **Cadence** — configurable interval (e.g., daily) or triggered when enough new local data has accumulated.
- **Participant selection** — a configurable fraction of eligible participants is sampled per round to bound cost and improve privacy (fewer participants per round ⇒ stronger privacy amplification).
- **Round lifecycle** — `distribute → local train → submit → aggregate → evaluate → publish → reward`.
- **Failure handling** — participants that fail to submit within the round deadline are skipped; secure aggregation tolerates dropouts.
- **Versioning** — each published global model is versioned and immutable, enabling rollback if a regression is detected.

---

## Contribution Rewards

Participation is incentivized through a contribution-reward mechanism:

- **Contribution score** — derived from the number of samples trained on, the improvement the participant's update provides to global validation metrics, and reliability (on-time submissions).
- **Reward issuance** — scores are recorded in the reward ledger and converted to platform rewards on a configurable schedule.
- **Anti-gaming** — scores are capped per round and normalized, so a single participant cannot dominate rewards; updates that fail integrity checks earn no reward.
- **Transparency** — participants can audit their own contribution history.

---

## Security: Preventing Model Poisoning

The system defends against malicious or faulty participants through layered checks:

- **Update validation** — every submitted update is signed; signatures are verified against the participant's registered keys.
- **Norm bounds** — updates whose L2 norm exceeds a threshold are rejected or clipped, preventing outsized poisoning attempts.
- **Robust aggregation** — aggregation uses robust statistics (e.g., trimmed mean / median-style aggregation) to reduce the influence of outlier updates.
- **Anomaly detection** — updates that deviate sharply from the expected distribution (cosine similarity to the running aggregate) are flagged and quarantined for review.
- **Reputation** — participants accumulate a reputation score; repeated anomalies lead to suspension and exclusion.
- **Canary validation** — each candidate global model is evaluated on a server-held canary set before publication; models that regress are rejected.
- **Blockchain-anchored integrity** — participant identity and reputation events are recorded against the existing blockchain infrastructure, providing tamper-evident auditability.

---

## Model Performance Tracking

Performance is tracked continuously to demonstrate value:

- **Per-round metrics** — precision, recall, F1, and AUC are recorded for the global model on each participant's local validation set (aggregated, never per-record).
- **Federated vs. local comparison** — each participant's local-only model is evaluated alongside the federated global model on the same validation data, producing a direct comparison.
- **Dashboards** — metrics are surfaced through the existing monitoring stack, with per-round and trend views.
- **Regression detection** — canary validation and metric thresholds block publication of regressing models.

### Validating the 25% Improvement

The acceptance criterion of a **25% improvement in fraud detection** is validated as follows:

1. **Baseline** — each participant's platform-local fraud model is evaluated on a held-out local validation set, recording F1 and AUC.
2. **Federated model** — after a defined number of federated rounds, the global model is evaluated on the *same* held-out sets.
3. **Comparison** — relative improvement is computed per participant and aggregated across the network:

   ```
   improvement = (metric_federated − metric_local) / metric_local
   ```

4. **Threshold** — the network is considered to meet the criterion when the aggregate relative improvement in F1 (and AUC) reaches **≥ 25%** over the local baselines, sustained across multiple rounds.
5. **Reporting** — results are published in the performance dashboard and recorded in the round metadata for auditability.

Because evaluation uses held-out data that is never trained on and never shared, the comparison is fair and privacy-preserving.

---

## Integration Notes

- **Base model** — the existing fraud detection model is the starting point for federated training.
- **Blockchain** — participant verification, reputation events, and reward records leverage the existing blockchain infrastructure.
- **Security** — update encryption, signing, and integrity checks reuse the platform's existing security measures.
- **Frameworks** — the design is compatible with federated learning frameworks such as TensorFlow Federated and PySyft; the aggregation and DP components follow standard FedAvg + DP-SGD conventions.

---

## Summary of Acceptance Criteria Mapping

| Criterion | Where addressed |
|---|---|
| Federated learning architecture | [Architecture](#architecture) |
| Model training on participant nodes | [Local Training](#local-training-on-participant-nodes) |
| Model aggregation combines local models | [Secure Aggregation](#secure-aggregation-with-differential-privacy) |
| Privacy-preserving techniques (DP) | [Secure Aggregation](#secure-aggregation-with-differential-privacy) |
| Participant onboarding | [Participant Onboarding](#participant-onboarding) |
| Performance tracking shows improvement | [Model Performance Tracking](#model-performance-tracking) |
| Automated scheduling | [Scheduling](#federated-learning-scheduling) |
| Contribution rewards | [Contribution Rewards](#contribution-rewards) |
| Security prevents poisoning | [Security](#security-preventing-model-poisoning) |
| Documentation | This document |
| 25% improvement | [Validating the 25% Improvement](#validating-the-25-improvement) |