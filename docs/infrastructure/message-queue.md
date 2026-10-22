# Message Queue (RabbitMQ)

Agri-fi uses RabbitMQ (`@nestjs/microservices` RMQ transport + `amqplib`) for reliable asynchronous processing of trade-deal, investment and escrow events.

## Topology

| Queue | Dead-letter exchange | Dead-letter queue |
|---|---|---|
| `agric_onchain_queue` | `agric_onchain_queue.dlx` | `agric_onchain_queue.dlq` |
| `agric_onchain_escrow_queue` | `agric_onchain_escrow_queue.dlx` | `agric_onchain_escrow_queue.dlq` |

Defined in `backend/src/queue/queue.dlq.constants.ts` and asserted at boot by `QueueTopologyService`.

## Reliability guarantees

- **Persistence** – queues are `durable` and messages are published with `persistent: true`, so they survive broker restarts.
- **Acknowledgment** – `noAck: false`; consumers in `queue.processor.ts` `ack` on success and `nack` on failure.
- **Retry policy** – transient errors (`isTransientQueueError`) are retried with exponential backoff + jitter (`retry-policy.ts`): `delay = base * 2^(attempt-1) + jitter`. Main queue: `MAX_DELIVERY_ATTEMPTS = 3`; escrow: `ESCROW_MAX_DELIVERY_ATTEMPTS = 5`. The attempt count is derived from RabbitMQ's `x-death` header.
- **Dead-letter queue** – once retries are exhausted (or the error is permanent) the message is `nack`ed without requeue and routed to the DLQ via the DLX.
- **Idempotency** – `IdempotencyService` deduplicates redeliveries.
- **Transactional outbox** – `*Transactional` methods in `QueueService` write to the outbox inside the DB transaction so events are never lost.

## Message ordering

`OrderedExecutor` (`queue-ordering.ts`) serialises processing of messages that share an ordering key (`orderingKey`, `tradeDealId` or `dealId`) while messages with different keys run concurrently. Use `getOrderingKey(payload)` in consumers:

```ts
await this.ordered.run(getOrderingKey(payload), () => this.handle(payload));
```

## Monitoring & analytics

`QueueAnalyticsService` (`queue-analytics.service.ts`):

- `record(pattern, outcome, durationMs?)` – outcomes: `published`, `acked`, `nacked`, `retried`, `dead_lettered`. `QueueService.emit` records `published` automatically.
- `getSnapshot()` – rolling-window counts, throughput/s, failure rate, average processing time, per-pattern breakdown and latest queue depths.
- `pollDepths()` – runs every minute against the RabbitMQ management API, collecting ready/unacked counts, consumers, publish and deliver rates, and warns when a DLQ is non-empty.

`QueueAlertService` additionally sends a Discord alert if the main queue stays above `QUEUE_ALERT_THRESHOLD` for `QUEUE_ALERT_DURATION_MS`. Broker liveness is exposed via `RabbitMQHealthIndicator`.

## Security

- Payloads are encrypted with AES-256 (`queue.crypto.ts`, key `QUEUE_ENCRYPTION_KEY`, 64 hex chars) before publishing.
- In production use `amqps://` in `RABBITMQ_URL` for TLS in transit, and dedicated per-service credentials.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | Broker URL (`amqps://` for TLS) |
| `RABBITMQ_PREFETCH_COUNT` | `10` | Consumer prefetch window |
| `RABBITMQ_MANAGEMENT_URL` | `http://localhost:15672` | Management API for depth polling |
| `RABBITMQ_VHOST` | `/` | Virtual host |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `guest` | Management API credentials |
| `QUEUE_ENCRYPTION_KEY` | – | Payload encryption key |
| `QUEUE_ANALYTICS_WINDOW_SECONDS` | `300` | Analytics rolling window |

## Replaying dead-lettered messages

Inspect the DLQ from the management UI, fix the root cause, then shovel messages back to the primary queue (`rabbitmqctl` shovel or management "Move messages").
