# Behavioral Biometrics

Behavioral biometrics provide **continuous authentication** for the application. Instead of relying only on a one-time login, the frontend continuously observes *how* a user interacts with the device — typing rhythm, mouse movement, and device usage patterns — and compares that behavior against a locally stored baseline profile. When behavior deviates significantly from the baseline, the risk score rises and adaptive authentication kicks in.

All behavioral data is processed and stored **locally on the device**. Nothing is sent to the cloud.

---

## Overview

| Capability | Description |
| --- | --- |
| Typing pattern analysis | Keystroke dynamics (dwell/flight times) and typing speed |
| Mouse movement analysis | Trajectory, velocity, acceleration, and click patterns |
| Device usage analysis | App usage patterns and session behavior |
| Behavioral profile creation | Builds a per-user baseline of normal behavior |
| Anomaly detection | Detects deviations from the baseline |
| Adaptive authentication | Adjusts security requirements based on risk score |
| Behavioral learning | Continuously updates the profile over time |
| Behavioral privacy | No cloud storage of behavioral data |
| Behavioral analytics | Tracks authentication accuracy and false positives |

The feature integrates with the existing authentication infrastructure, the existing analytics layer, and existing security measures (e.g. step-up authentication, session locking).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Frontend (browser)                     │
│                                                               │
│  ┌───────────────┐   ┌───────────────┐   ┌────────────────┐  │
│  │ Typing        │   │ Mouse         │   │ Device usage   │  │
│  │ collector     │   │ collector     │   │ collector      │  │
│  └──────┬────────┘   └──────┬────────┘   └───────┬────────┘  │
│         │                   │                    │           │
│         └───────────┬───────┴────────────────────┘           │
│                     ▼                                         │
│           ┌─────────────────────┐                             │
│           │ Behavioral engine   │                             │
│           │ (feature extract,   │                             │
│           │  profile, anomaly,  │                             │
│           │  risk scoring)      │                             │
│           └─────────┬───────────┘                             │
│                     │                                         │
│         ┌───────────┴────────────┐                            │
│         ▼                        ▼                            │
│  ┌──────────────┐        ┌──────────────────┐                 │
│  │ Local store  │        │ Adaptive auth    │                 │
│  │ (IndexedDB / │        │ controller       │                 │
│  │  localStorage│        │ (risk → action)  │                 │
│  │  encrypted)  │        └────────┬─────────┘                 │
│  └──────────────┘                 │                           │
│                                   ▼                           │
│                          ┌──────────────────┐                 │
│                          │ Existing auth /  │                 │
│                          │ security layer   │                 │
│                          └──────────────────┘                 │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Behavioral analytics (local) → existing analytics layer │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

The collectors feed raw signals into the behavioral engine. The engine extracts features, maintains the local profile, computes an anomaly/risk score, and hands that score to the adaptive authentication controller. Aggregated (non-identifying) accuracy metrics are surfaced through the existing analytics layer.

---

## Typing Pattern Analysis

Typing analysis captures **keystroke dynamics** — the timing characteristics of how a user types — rather than the content of what they type.

### Collected signals

- **Dwell time** — how long each key is held down (`keyup - keydown`).
- **Flight time** — the gap between releasing one key and pressing the next.
- **Typing speed** — characters per second / words per minute over a rolling window.
- **Digraph latency** — time between specific key pairs (e.g. `t→h`).
- **Backspace / correction rate** — frequency of corrections, a strong individual signal.
- **Pause distribution** — frequency and length of pauses between bursts.

### Feature extraction

For each rolling window (e.g. the last 50 keystrokes), the engine computes a feature vector:

```
{
  meanDwell, stdDwell,
  meanFlight, stdFlight,
  charsPerSecond,
  correctionRate,
  pauseRate,
  digraphLatencies: { "th": 120, "he": 95, ... }
}
```

Only timing metadata is recorded. **Key content is never stored** in the behavioral profile; digraph keys are hashed/aggregated so the profile cannot reconstruct typed text.

### Notes

- Collectors listen on `keydown`/`keyup` and use `event.timeStamp` for high-resolution timing.
- Password fields are handled specially: only aggregate timing statistics are kept, never per-key data.
- Typing analysis is most reliable after a warm-up period (see [Behavioral Learning](#behavioral-learning)).

---

## Mouse Movement Analysis

Mouse analysis captures the *kinematics* of pointer movement and clicking behavior.

### Collected signals

- **Trajectory shape** — sampled `(x, y, t)` points, reduced to curvature and path efficiency (straight-line distance vs. actual path length).
- **Velocity and acceleration** — mean/variance of pointer speed and acceleration.
- **Movement smoothness** — jerk and number of direction changes.
- **Click patterns** — click frequency, inter-click intervals, double-click timing, and click position relative to targets.
- **Idle/movement ratio** — proportion of time the pointer is idle vs. moving.

### Feature extraction

Per rolling window (e.g. last 30 seconds of movement):

```
{
  meanVelocity, stdVelocity,
  meanAcceleration,
  pathEfficiency,
  directionChanges,
  clickRate,
  meanInterClickInterval,
  idleRatio
}
```

### Notes

- Sampling is throttled (e.g. every ~16–50 ms) to limit CPU usage.
- Touch input is supported via `pointermove`/`pointerdown` events and mapped to the same feature space where possible.
- Coordinates are used only for relative motion features; absolute screen positions are not persisted.

---

## Device Usage Analysis

Device usage analysis models *when* and *how* the user works, complementing the fine-grained typing and mouse signals.

### Collected signals

- **Session behavior** — session duration, number of interactions per session, active vs. idle time.
- **App usage patterns** — which features/routes are used and in what order (route-level, not content-level).
- **Time-of-day / day-of-week patterns** — typical active hours.
- **Navigation cadence** — time spent per view, frequency of navigation.
- **Interaction density** — actions per minute.

### Feature extraction

```
{
  meanSessionDuration,
  interactionsPerMinute,
  activeIdleRatio,
  typicalActiveHours: [9,10,11,14,15,...],
  routeUsageDistribution: { "/dashboard": 0.4, "/settings": 0.1, ... }
}
```

### Notes

- Route/feature usage is recorded as coarse categories, not full URLs with parameters.
- Usage analysis helps detect account takeover where an attacker uses the account at unusual times or in unusual ways.

---

## Behavioral Profile Creation

A **behavioral profile** is the per-user baseline of normal behavior. It is created and stored locally.

### Profile lifecycle

1. **Enrollment / warm-up** — On first use (or after a reset), the engine collects signals without enforcing adaptive auth. A minimum number of samples (e.g. 200 keystrokes, 60 s of mouse movement, 3 sessions) is required before the profile is considered *mature*.
2. **Baseline computation** — For each feature, the engine stores a running mean and variance (Welford's online algorithm) plus robust statistics (median, MAD) for outlier resistance.
3. **Maturity flag** — The profile exposes `isMature`. Anomaly detection and adaptive auth are only enforced once mature; before that, the system behaves as today.

### Profile shape (local)

```
{
  userId,
  version,
  createdAt,
  updatedAt,
  sampleCounts: { keystrokes, mouseWindows, sessions },
  isMature,
  typing:  { feature: { mean, variance, median, mad, n }, ... },
  mouse:   { feature: { mean, variance, median, mad, n }, ... },
  device:  { feature: { mean, variance, median, mad, n }, ... }
}
```

Profiles are keyed by user and stored in an encrypted local store (see [Privacy](#behavioral-privacy-no-cloud-storage)).

---

## Anomaly Detection

Anomaly detection compares current behavior against the baseline profile and produces a **risk score** in `[0, 1]`.

### Method

1. **Feature scoring** — For each feature, compute a robust z-score against the baseline:
   ```
   z = (x - median) / (1.4826 * MAD + ε)
   ```
   Map `|z|` to a per-feature anomaly in `[0, 1]` via a saturating function (e.g. `min(|z| / Z_MAX, 1)`).
2. **Aggregation** — Combine per-feature anomalies with weights (typing, mouse, device) into a single risk score. Features with insufficient samples are down-weighted.
3. **Smoothing** — Apply exponential smoothing over time so a single odd window does not trigger action; sustained deviation does.
4. **Thresholds** — Risk is bucketed:
   - `low` (< 0.4) — normal, no action.
   - `medium` (0.4–0.7) — monitor, optionally soft challenge.
   - `high` (≥ 0.7) — trigger adaptive authentication.

### Account takeover detection

A sustained `high` risk score — especially combined with unusual device-usage patterns (odd hours, unfamiliar routes) — is treated as a potential account takeover and escalates to the adaptive authentication controller.

---

## Adaptive Authentication

The adaptive authentication controller maps the current risk score to a security action, integrating with the existing security measures.

| Risk | Action |
| --- | --- |
| `low` | No action; continue session normally. |
| `medium` | Soft challenge — e.g. re-confirm identity on the next sensitive action, or prompt for a quick verification. |
| `high` | Step-up authentication — require re-authentication (password / MFA) before continuing; optionally lock the session. |

### Behavior

- Actions are **debounced** to avoid repeated prompts; once a step-up is triggered, further prompts are suppressed until the user re-authenticates or the risk drops.
- The controller respects existing auth state — it never weakens existing security, only adds challenges.
- All decisions are logged locally for analytics (see below).
- If the profile is not mature, the controller stays in `low`/no-op mode.

---

## Behavioral Learning

Profiles are not static — they adapt over time so that legitimate drift (e.g. a new keyboard, a new role) does not cause false positives.

- **Online updates** — Each accepted window updates the running statistics (Welford) for the profile.
- **Trust-weighted learning** — Samples taken while risk is `low` update the baseline strongly; samples during `medium`/`high` risk are down-weighted or excluded so an attacker cannot poison the profile.
- **Decay** — Older samples are gradually decayed so the profile reflects recent behavior.
- **Reset** — Users can reset their behavioral profile at any time (see Privacy), returning to enrollment.

---

## Behavioral Privacy (No Cloud Storage)

Behavioral data is sensitive. The implementation enforces strict local-only handling.

- **Local-only storage** — Profiles and raw feature windows are stored in the browser (IndexedDB / `localStorage`) and **never transmitted to any server or cloud service**.
- **Encryption at rest** — The local store is encrypted using a key derived from the user's session (Web Crypto API). If the key is unavailable, behavioral data is not persisted.
- **No content capture** — Only timing and motion metadata are stored. Typed text, exact coordinates, and full URLs are never persisted.
- **Aggregate-only analytics** — Only non-identifying aggregate metrics (accuracy, false-positive rate) are reported to the existing analytics layer; no raw behavioral data leaves the device.
- **User control** — Users can view, export, and delete their behavioral profile from settings.
- **Opt-out** — Behavioral biometrics can be disabled; when disabled, no collection occurs and the app falls back to static authentication.

---

## Behavioral Analytics

The engine tracks its own accuracy locally and reports aggregates to the existing analytics layer.

### Tracked metrics

- **Authentication accuracy** — proportion of windows correctly classified as legitimate vs. anomalous.
- **False positives** — legitimate users flagged as `medium`/`high` risk.
- **False negatives** — (where ground truth is available, e.g. after a confirmed takeover or re-auth) missed anomalies.
- **Risk distribution** — histogram of risk scores over time.
- **Challenge outcomes** — how often step-up challenges were passed vs. failed.
- **Profile maturity** — time/samples to reach a mature profile.

### Reporting

- Metrics are computed locally and stored alongside the profile.
- Only aggregated, anonymized counters are forwarded to the existing analytics layer (e.g. `behavioral_auth_accuracy`, `behavioral_false_positive_rate`).
- A local diagnostics view (in settings) shows the user their own accuracy and risk history.

---

## Integration

- **Authentication** — Uses the existing auth infrastructure for user identity, session state, and step-up flows.
- **Analytics** — Reuses the existing analytics layer for aggregate metric reporting.
- **Security** — Feeds the adaptive auth controller into existing security measures (session locking, MFA prompts).
- **Feature flags** — Behavioral biometrics is gated behind a feature flag and can be disabled globally or per user.

---

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Master switch for behavioral biometrics. |
| `enrollmentMinKeystrokes` | `200` | Keystrokes required before profile matures. |
| `enrollmentMinMouseSeconds` | `60` | Mouse movement seconds required before maturity. |
| `enrollmentMinSessions` | `3` | Sessions required before maturity. |
| `riskMediumThreshold` | `0.4` | Risk score for `medium`. |
| `riskHighThreshold` | `0.7` | Risk score for `high`. |
| `smoothingFactor` | `0.3` | Exponential smoothing factor for risk. |
| `learningRate` | `0.05` | Weight for online profile updates. |
| `decayHalfLifeDays` | `30` | Half-life for sample decay. |

---

## Limitations & Considerations

- **Cold start** — No enforcement until the profile matures; early sessions are enrollment only.
- **Context changes** — New devices, keyboards, or accessibility tools can cause temporary false positives; trust-weighted learning and decay mitigate this.
- **Accessibility** — Users relying on assistive input may have atypical patterns; the system must not penalize them. Consider per-input-method baselines.
- **Privacy** — Behavioral data can be identifying; strict local-only storage and user control are mandatory.
- **Not a replacement** — Behavioral biometrics complements, not replaces, static authentication and MFA.

---

## Testing

- **Unit tests** — Feature extraction, robust z-scoring, risk aggregation, and profile updates.
- **Simulation** — Replay synthetic typing/mouse streams for legitimate and anomalous users to validate accuracy and false-positive rates.
- **Privacy tests** — Assert no behavioral data is included in network requests.
- **Integration tests** — Verify adaptive auth triggers step-up at the correct thresholds and respects debouncing.

---

## References

- Keystroke dynamics: dwell/flight time analysis.
- Mouse dynamics: trajectory and kinematic feature analysis.
- Welford's online algorithm for running mean/variance.
- Robust statistics: median absolute deviation (MAD) for outlier-resistant z-scores.