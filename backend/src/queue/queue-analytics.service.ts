import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  ESCROW_QUEUE_DLQ,
  ESCROW_QUEUE_NAME,
  MAIN_QUEUE_DLQ,
  MAIN_QUEUE_NAME,
} from './queue.dlq.constants';

export type QueueEventOutcome = 'published' | 'acked' | 'nacked' | 'retried' | 'dead_lettered';

export interface QueueDepth {
  queue: string;
  ready: number;
  unacked: number;
  consumers: number;
  publishRate: number;
  deliverRate: number;
}

export interface QueueAnalyticsSnapshot {
  windowSeconds: number;
  counts: Record<QueueEventOutcome, number>;
  throughputPerSecond: number;
  failureRate: number;
  avgProcessingMs: number;
  byPattern: Record<string, Record<QueueEventOutcome, number>>;
  depths: QueueDepth[];
}

interface Sample {
  at: number;
  pattern: string;
  outcome: QueueEventOutcome;
  durationMs?: number;
}

const emptyCounts = (): Record<QueueEventOutcome, number> => ({
  published: 0,
  acked: 0,
  nacked: 0,
  retried: 0,
  dead_lettered: 0,
});

/**
 * Tracks message throughput, failure rates and processing latency over a
 * rolling window, and polls the RabbitMQ management API for queue depth and
 * publish/deliver rates of the main, escrow and dead-letter queues (#1240).
 */
@Injectable()
export class QueueAnalyticsService {
  private readonly logger = new Logger(QueueAnalyticsService.name);
  private readonly samples: Sample[] = [];
  private depths: QueueDepth[] = [];
  private readonly windowMs: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.windowMs =
      Number(this.config.get('QUEUE_ANALYTICS_WINDOW_SECONDS', 300)) * 1000;
  }

  record(pattern: string, outcome: QueueEventOutcome, durationMs?: number): void {
    this.samples.push({ at: Date.now(), pattern, outcome, durationMs });
    this.prune();
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.samples.length && this.samples[0].at < cutoff) this.samples.shift();
  }

  getSnapshot(): QueueAnalyticsSnapshot {
    this.prune();
    const counts = emptyCounts();
    const byPattern: QueueAnalyticsSnapshot['byPattern'] = {};
    let durationTotal = 0;
    let durationCount = 0;

    for (const s of this.samples) {
      counts[s.outcome] += 1;
      (byPattern[s.pattern] ??= emptyCounts())[s.outcome] += 1;
      if (s.durationMs !== undefined) {
        durationTotal += s.durationMs;
        durationCount += 1;
      }
    }

    const processed = counts.acked + counts.nacked + counts.dead_lettered;
    const failed = counts.nacked + counts.dead_lettered;
    return {
      windowSeconds: this.windowMs / 1000,
      counts,
      throughputPerSecond: processed / (this.windowMs / 1000),
      failureRate: processed === 0 ? 0 : failed / processed,
      avgProcessingMs: durationCount === 0 ? 0 : durationTotal / durationCount,
      byPattern,
      depths: this.depths,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async pollDepths(): Promise<QueueDepth[]> {
    const base = this.config.get<string>(
      'RABBITMQ_MANAGEMENT_URL',
      'http://localhost:15672',
    );
    const vhost = encodeURIComponent(this.config.get<string>('RABBITMQ_VHOST', '/'));
    const auth = {
      username: this.config.get<string>('RABBITMQ_USER', 'guest'),
      password: this.config.get<string>('RABBITMQ_PASSWORD', 'guest'),
    };
    const queues = [MAIN_QUEUE_NAME, MAIN_QUEUE_DLQ, ESCROW_QUEUE_NAME, ESCROW_QUEUE_DLQ];

    const results = await Promise.allSettled(
      queues.map(async (queue) => {
        const { data } = await firstValueFrom(
          this.http.get(`${base}/api/queues/${vhost}/${encodeURIComponent(queue)}`, { auth }),
        );
        return {
          queue,
          ready: data.messages_ready ?? 0,
          unacked: data.messages_unacknowledged ?? 0,
          consumers: data.consumers ?? 0,
          publishRate: data.message_stats?.publish_details?.rate ?? 0,
          deliverRate: data.message_stats?.deliver_get_details?.rate ?? 0,
        } as QueueDepth;
      }),
    );

    this.depths = results
      .filter((r): r is PromiseFulfilledResult<QueueDepth> => r.status === 'fulfilled')
      .map((r) => r.value);

    for (const d of this.depths) {
      if (d.queue.endsWith('.dlq') && d.ready > 0) {
        this.logger.warn(`${d.ready} message(s) waiting in dead-letter queue ${d.queue}`);
      }
    }
    return this.depths;
  }
}
