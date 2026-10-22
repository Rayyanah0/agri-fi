# Blockchain Oracle Integration

> **Issue:** #1235
> **Sources:** `blockchain/contracts/price-feed/src/lib.rs`, `backend/src/oracles/`

## Overview

Agri-Fi depends on trusted off-chain data — commodity prices, FX rates and
weather/rainfall indices — to price trade deals, settle revenue shares and
trigger parametric insurance. The oracle integration brings that data on-chain
in a verifiable way:

1. The backend **fetches** readings from one or more external providers
   (Chainlink, Band Protocol).
2. Readings are **validated** (sanity, freshness, deviation bounds) and reduced
   to a **consensus** value.
3. The consensus value is **submitted on-chain** to the `PriceFeed` Soroban
   contract, which re-validates it and stores it immutably.
4. Accuracy, latency and cost are recorded for **analytics** and governance.

The design is provider-agnostic: adding a source means implementing one
interface and registering it, without touching the contract or controller.

## Architecture

```
            ┌──────────────┐   fetch   ┌────────────────┐
            │ Chainlink    │◀──────────│                │
            └──────────────┘           │  OracleService │
            ┌──────────────┐   fetch   │  (validation,  │
            │ Band Protocol│◀──────────│   consensus,   │
            └──────────────┘           │   fallback)    │
                                       └───────┬────────┘
                                               │ invoke submit_price
                                               ▼
                                     ┌───────────────────┐
                                     │ PriceFeed contract │  (Soroban)
                                     └───────────────────┘
```

## Supported providers

| Provider  | Adapter                                    | Config                       | Notes                                        |
|-----------|--------------------------------------------|------------------------------|----------------------------------------------|
| Chainlink | `providers/chainlink.provider.ts`          | `CHAINLINK_API_URL`, `CHAINLINK_API_KEY` | Data Feeds / Data Streams HTTP endpoint |
| Band      | `providers/band.provider.ts`               | `BAND_API_URL` (default `https://laozi1.bandchain.org`) | `/api/oracle/v1/get_reference_data` |

Providers are ordered per feed; the first is the **primary** and the rest are
**fallbacks**. A provider that is unreachable or returns an unusable payload is
skipped and the next one is tried. Each attempt is recorded with `is_fallback`.

### Provider interface

```ts
export interface OracleProvider {
  readonly name: 'chainlink' | 'band';
  fetch(descriptor: OracleFeedDescriptor): Promise<OracleReading>;
}
```

## On-chain contract — `PriceFeed`

The `PriceFeed` contract stores the latest reading per feed and enforces the
same invariants on-chain, so a compromised backend cannot write arbitrary data.

### Interface

```
initialize(admin)
configure_feed(caller, feed_id, decimals, heartbeat_secs, max_deviation_bps)
set_oracle(caller, feed_id, oracle, allowed)
pause(caller) / unpause(caller)
submit_price(oracle, feed_id, value, round_id, timestamp) -> Result<PriceData, Error>
get_price(feed_id)                                         -> Result<PriceData, Error>
get_feed_config(feed_id)                                   -> Result<FeedConfig, Error>
is_oracle_allowed(feed_id, oracle)                         -> bool
is_paused()                                                -> bool
get_admin()                                                -> Result<Address, Error>
```

### Types

| Type        | Fields                                                                |
|-------------|-----------------------------------------------------------------------|
| `FeedConfig`| `feed_id`, `decimals`, `heartbeat_secs`, `max_deviation_bps`           |
| `PriceData` | `value: i128`, `decimals: u32`, `round_id: u64`, `timestamp: u64`, `oracle: Address` |

### Error codes

| Code | Variant             | Meaning                                        |
|------|---------------------|------------------------------------------------|
| 1    | `Unauthorized`      | Caller is not the admin or an allowed oracle   |
| 2    | `NotInitialized`    | Contract has not been initialised yet          |
| 3    | `AlreadyInitialized`| `initialize` called more than once             |
| 4    | `Paused`            | Contract is administratively paused            |
| 5    | `FeedNotConfigured` | No config exists for the feed                  |
| 6    | `OracleNotAllowed`  | Caller is not on the feed's oracle allow-list  |
| 7    | `InvalidPrice`      | Price is zero or negative                      |
| 8    | `StalePrice`        | Timestamp did not advance                      |
| 9    | `DeviationTooHigh`  | Move exceeds `max_deviation_bps`               |
| 10   | `RoundNotIncreasing`| `round_id` is not greater than the last round  |
| 11   | `InvalidConfig`     | Feed configuration values are invalid          |
| 12   | `InvalidFeedId`     | Feed id string is empty                        |
| 13   | `PriceNotFound`     | No price has been submitted for the feed       |

### Events

| Topic tuple                  | Payload                              | Emitted when            |
|------------------------------|--------------------------------------|-------------------------|
| `("init",)`                  | `admin`                              | Contract initialised    |
| `("feed_cfg", caller)`       | `feed_id`                            | Feed configured/updated |
| `("oracle", caller)`         | `(feed_id, oracle, allowed)`         | Allow-list changed      |
| `("paused", caller)`         | `caller`                             | Paused                  |
| `("unpaused", caller)`       | `caller`                             | Unpaused                |
| `("price", oracle)`          | `(feed_id, value, round_id, timestamp)` | Price submitted      |

Only governance-approved accounts can write. `submit_price` calls
`require_auth` on the submitting address **and** checks the per-feed allow-list,
so every stored value is cryptographically signed by an approved oracle.

## Backend module

`backend/src/oracles/` exposes the integration over REST (version `1`), all
admin-guarded except the read endpoints.

| Method | Path                             | Auth  | Purpose                                 |
|--------|----------------------------------|-------|-----------------------------------------|
| GET    | `/v1/oracles/feeds`              | jwt   | List configured feeds                   |
| GET    | `/v1/oracles/feeds/:feedId`      | jwt   | Read one feed                           |
| POST   | `/v1/oracles/feeds`              | admin | Create a feed configuration             |
| PATCH  | `/v1/oracles/feeds/:feedId`      | admin | Update a feed (governance)              |
| POST   | `/v1/oracles/feeds/:feedId/run`  | admin | Fetch → validate → submit on-chain      |
| POST   | `/v1/oracles/feeds/:feedId/test` | admin | Dry-run against providers (no on-chain) |
| GET    | `/v1/oracles/analytics`          | admin | Accuracy / latency / cost analytics     |
| GET    | `/v1/oracles/costs`              | admin | On-chain cost summary                   |

### Pipeline (`runFeed`)

1. Load the feed and reject if disabled.
2. Enforce the daily cost budget (`max_daily_cost_xlm`).
3. Fetch from each provider in order; on failure, try the next.
4. Validate every reading and compute the consensus value.
5. Persist one `oracle_observations` row per attempt (providers, latency,
   deviation, validity, selected flag).
6. When consensus succeeds and the feed has a `contractId` + `oracleAddress`,
   call `submit_price` and record the transaction id and estimated gas cost.

## Validation

| Rule            | Effect                                                        |
|-----------------|---------------------------------------------------------------|
| `invalid_value` | Value must be finite and strictly positive                    |
| `stale_reading` | `now − observedAt` must not exceed `heartbeat_seconds`        |
| `future_timestamp` | Readings dated > 60 s in the future are rejected           |
| `deviation_too_high` | Move vs the last accepted value must be ≤ `max_deviation_bps` |

**Consensus**: readings within `max_deviation_bps` of the median agree; at least
`quorum` must agree, otherwise the round fails (`quorum_not_met`) and nothing is
submitted.

## Cost management

- Each feed may set `max_daily_cost_xlm`. The pipeline refuses to submit once
  the day's recorded cost reaches the budget.
- Per-submission cost is estimated (`ORACLE_ESTIMATED_TX_FEE_XLM`, default
  `0.01` XLM) and accumulated in `oracle_observations.gas_cost_xlm`.
- `GET /v1/oracles/costs` returns total spend, today's spend and a per-feed
  breakdown.

## Analytics

`GET /v1/oracles/analytics?feedId=&from=&to=` returns:

| Metric                  | Description                                            |
|-------------------------|--------------------------------------------------------|
| `validRate`             | Share of readings that passed validation               |
| `averageDeviationBps`   | Mean deviation of valid readings                       |
| `averageLatencyMs`      | Mean provider fetch latency                            |
| `onChainSubmissions` / `submissionSuccessRate` | Submissions and success ratio     |
| `totalGasCostXlm`       | Cumulative estimated on-chain cost                     |
| `byProvider[]`          | Per-provider count, latency and validity               |
| `costByDay[]`           | Daily cost and submission counts                       |

## Configuration

| Variable                       | Default                          | Purpose                              |
|--------------------------------|----------------------------------|--------------------------------------|
| `CHAINLINK_API_URL`            | _(unset)_                        | Chainlink endpoint; unset ⇒ disabled |
| `CHAINLINK_API_KEY`            | _(unset)_                        | Bearer token for Chainlink           |
| `BAND_API_URL`                 | `https://laozi1.bandchain.org`   | Band API base URL                    |
| `ORACLE_HTTP_TIMEOUT_MS`       | `5000`                           | Provider request timeout             |
| `ORACLE_ESTIMATED_TX_FEE_XLM`  | `0.01`                           | Estimated on-chain cost per submit   |
| `ORACLES_MOCK`                 | `false`                          | Synthesize readings when providers are unreachable (testnet/CI) |

## Testing on testnet

1. Deploy `price_feed`, call `initialize(admin)`.
2. `configure_feed(admin, "COCOA/USD", 7, 3600, 1000)`.
3. `set_oracle(admin, "COCOA/USD", <oracle address>, true)`.
4. Configure the backend feed with the deployed `contractId` and
   `oracleAddress`.
5. Run `POST /v1/oracles/feeds/COCOA%2FUSD/test` to verify providers and
   validation without spending funds.
6. Run `POST /v1/oracles/feeds/COCOA%2FUSD/run` to submit, then read
   `get_price("COCOA/USD")`.

`cargo test -p price_feed` covers initialisation, governance, allow-listing,
validation and deviation/staleness rejection.

## Governance & security

- Feed parameters and the oracle allow-list are admin-only on both the API and
  the contract; every change records the acting admin (`last_changed_by`,
  contract events).
- The contract is pauseable for incident response.
- On-chain validation is authoritative — the backend cannot bypass the move
  bound, round monotonicity or the freshness check.
- Treat provider API keys as secrets; supply them via environment/secret
  storage, never in source.
