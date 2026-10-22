# Portfolio Value at Risk

The investor API calculates portfolio Value at Risk (VaR) and Expected Shortfall (ES) on demand from active investments and validated commodity oracle observations. Results are quantitative estimates for risk management, not guarantees of maximum loss or investment advice.

## Data and valuation

Only `confirmed`, `active`, and `releasing` investments are included. Deal commodity names map to enabled oracle feed identifiers by their normalized commodity symbol, for example `Cocoa` to `COCOA/USD`. A portfolio with an unmapped commodity or without overlapping price history is rejected rather than silently excluding that exposure.

The portfolio value is the sum of invested USD amounts. The repository does not currently maintain marked-to-market values for deal positions, so this cost basis is an explicit proxy, not a current liquidation value. Prices are daily closes from oracle observations that are both `valid` and `selected`; the last fetched reading on a UTC day is used, and missing days are carried forward. Calculations use up to 365 days of stored observations and refresh on each request.

## Methods and parameters

`GET /investments/risk/var` accepts `method`, `confidenceLevel`, and `horizonDays` query parameters. Supported methods are `historical`, `parametric`, and `monte_carlo`; confidence levels are `0.95`, `0.99`, and `0.999`; horizons are `1`, `10`, and `30` days.

- Historical simulation applies overlapping compounded portfolio returns to the current invested amount. The VaR quantile uses the nearest-rank empirical order statistic; ES is the mean loss at or beyond that quantile.
- Parametric VaR and ES assume normally distributed portfolio returns, estimate volatility from sample standard deviation, and scale volatility by the square root of the horizon.
- Monte Carlo bootstraps daily portfolio returns with replacement and compounds sampled returns over the requested horizon. The pseudo-random stream is deterministic for the same history, making repeated reports reproducible. It assumes independent draws and does not model volatility clustering.

Historical observations preserve same-day co-movement between mapped commodities. The parametric and bootstrap calculations operate on that aggregate portfolio return series. At high confidence levels, short histories are particularly unreliable; the response includes warnings and sample counts. A 99.9% estimate should be supported by substantially more than 1,000 observations for stable tail estimation.

## Backtesting, stress, and limits

`GET /investments/risk/var/backtest` performs an out-of-sample rolling historical backtest. Each prediction uses only preceding observations (up to 250) and requires at least one expected tail observation for the requested confidence level, then compares the predicted loss with the subsequent 1, 10, or 30-day portfolio loss. The response reports tested observations, exceptions, and the observed breach rate against the expected tail probability.

`POST /investments/risk/var/stress-test` applies custom percentage shocks keyed by commodity or `*` for all commodities. With no custom scenarios it applies -20% and -40% portfolio-wide shocks. Stress results are deterministic scenario analyses, not probability estimates.

`PUT /investments/risk/var/limit` stores a VaR limit per investor, confidence level, and horizon. The regular VaR response reports whether its calculated VaR exceeds the matching enabled limit. A notification is emitted when a limit transitions into breach; repeated calculations while it remains breached do not send duplicates, and clearing the breach resets the alert state. Limits are scoped to the authenticated investor.

The regular VaR response also contains a 30-point historical VaR trend and per-commodity component values. `riskContributionUsd` allocates total portfolio VaR in proportion to exposure-weighted historical volatility so the contributions sum to total VaR; it is an explanatory allocation, not a correlation-adjusted Euler decomposition. `standaloneVaRUsd` is the commodity's standalone 95% 1-day estimate and is not additive.

`GET /investments/risk/var/report` returns a JSON compliance-oriented report with generation time, calculation inputs and methodology, data coverage, VaR/ES, limits, components, trend, and backtest results. Oracle observations must be populated and selected by the oracle pipeline before these endpoints can produce estimates.

## Endpoints

All endpoints require an authenticated, KYC-approved investor session.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/investments/risk/var` | VaR, ES, trend, components, and limit status |
| GET | `/investments/risk/var/backtest` | Rolling out-of-sample exception analysis |
| GET | `/investments/risk/var/report` | Compliance-oriented JSON report |
| POST | `/investments/risk/var/stress-test` | Custom or default commodity stress scenarios |
| PUT | `/investments/risk/var/limit` | Create or update a VaR limit |

The `portfolio_var_limits` table is created by migration `2110000000000-CreatePortfolioVaRLimits`.