/**
 * Per-key ordered execution for queue consumers (#1240).
 *
 * Messages that share an ordering key (e.g. a tradeDealId) are processed
 * strictly one after another in arrival order, while messages with different
 * keys still run concurrently. Combined with a prefetch window this preserves
 * order where it matters without serialising the whole queue.
 */
export class OrderedExecutor {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string | undefined, task: () => Promise<T>): Promise<T> {
    if (!key) return task();

    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.tails.set(key, next);

    const cleanup = () => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  pendingKeys(): number {
    return this.tails.size;
  }
}

/** Extracts the ordering key from a payload, preferring an explicit field. */
export function getOrderingKey(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const key = p.orderingKey ?? p.tradeDealId ?? p.dealId;
  return typeof key === 'string' ? key : undefined;
}
