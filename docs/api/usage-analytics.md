# Partner API Usage and Quotas

Partner requests authenticated with an API key on `/v1/public` are recorded by owner, key, endpoint, response status, response bytes, and elapsed processing time. Usage records are retained as a monthly ledger and feed the partner usage endpoint.

## Tiers and limits

| Tier | Included requests per UTC month |
| --- | ---: |
| Free | 10,000 |
| Standard | 100,000 |
| Premium | 1,000,000 |

An operator can assign a tier or a non-negative monthly quota override in `partner_api_usage`. Requests are rejected with HTTP 429 once the monthly request quota is reached. The limit resets at 00:00 UTC on the first day of each month. The existing per-minute API-key rate limit remains in effect independently.

## Self-service usage

`GET /v1/public/usage` uses the authenticated API key and returns only its owner's current-month totals, tier, quota remaining, daily request trend, transfer volume, compute time, estimated charge, and anomaly count. It does not accept an owner ID, preventing a partner from querying another partner's data. The usage endpoints remain available when the monthly request quota is exhausted so partners can inspect usage and reset timing. `approachingQuota` becomes true at 80% of the monthly request quota.

`GET /v1/public/usage/monthly?year=2026&month=10` returns the selected UTC calendar month's totals and daily trend for a monthly usage statement, including the estimated charge breakdown. The authenticated API key owner is the only account whose records are queried.

## Charge calculation and anomalies

The current estimate is calculated from tracked consumption: $0.00001 per request, $0.10 per GiB transferred, and $0.001 per compute second. These are estimates, not invoices; rates are implementation defaults and must be reviewed and published before production billing. Events taking over 30 seconds or returning over 10 MiB are flagged as anomalous for review. Usage records are not modified by the reporting API.

## Alerts and statements

When a partner reaches 80% of the monthly request quota, the backend creates one in-platform `alert` notification per owner per UTC month. The database marker prevents duplicate alerts across concurrent requests. Automatic email/SMS delivery and final invoicing are not configured by this feature; the monthly statement contains estimated charges and is not a payable invoice.