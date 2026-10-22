# Webhook delivery

Inbound webhooks (payment/SEP-24 callbacks and other signed integrations) are
authenticated by `WebhookSignatureGuard`, which verifies
`HMAC-SHA256(rawBody, WEBHOOK_SECRET)` against the `x-webhook-signature` header.

The signature is computed over the **exact bytes** the sender signed. Anything that
alters the body in transit or before the guard runs will break verification.

## Required proxy / edge configuration

Apply these at every hop in front of the backend (nginx, ALB/ELB, CloudFront, API
gateway, WAF):

- Pass the request body through byte-for-byte. No reordering, no JSON re-serialisation,
  no whitespace changes, no content rewriting rules.
- Preserve `Content-Length`. Do not convert a `Content-Length` request to chunked
  encoding, or vice versa.
- Do **not** gzip or Brotli-compress the request body. The signature covers the
  uncompressed payload.
- Do not terminate and replay the request from a buffering layer that rebuilds the body.
- Forward `x-webhook-signature` unchanged (header names are case-insensitive; the value
  is a lowercase hex digest).
- Allow the sender's source IPs to reach `/v1/webhooks/*` and `/v1/stellar/sep24/*`
  without challenge pages or bot interstitials.

The application side depends on `rawBody: true` in `main.ts`. Removing it, or adding a
global body parser that consumes these routes first, makes every signature check fail.

## Verifying a delivery manually

```bash
BODY='{"event":"callback","id":"123"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')
curl -i -X POST https://api.example.com/v1/stellar/sep24/callback \
  -H 'content-type: application/json' \
  -H "x-webhook-signature: $SIG" \
  --data-raw "$BODY"
```

If this succeeds but the provider's deliveries fail, the body is being altered in
transit — inspect the edge configuration above.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Webhook signature mismatch` on every delivery | Proxy rewrote/compressed the body, or `WEBHOOK_SECRET` differs from the sender's secret |
| `401 Request body is empty` | Body was consumed by middleware before the guard, or `rawBody: true` was removed |
| `401 Missing required header: x-webhook-signature` | Edge stripped the header, or the sender is unauthenticated |
| Intermittent mismatch under load | A hop is re-framing chunked requests; disable request buffering/compression for webhook routes |
| Works locally, fails in production | Production sits behind a different proxy chain — diff the two configurations |

Signatures are compared in constant time; do not add a custom comparator that
short-circuits.

See also: the raw-body contract in [`CONTRIBUTING.md`](../../CONTRIBUTING.md#webhooks-and-raw-request-bodies).
