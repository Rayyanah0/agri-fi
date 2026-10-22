import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

/** A single sample returned by a Prometheus instant query. */
export interface PrometheusSample {
  metric: Record<string, string>;
  value: number;
  timestampMs: number;
}

/** An alert as reported by the Prometheus HTTP API (`/api/v1/alerts`). */
export interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'pending' | 'firing' | 'inactive';
  activeAt: string;
  value: string;
}

interface PrometheusVectorResponse {
  status: string;
  data?: {
    resultType?: string;
    result?: Array<{
      metric?: Record<string, string>;
      value?: [number, string];
    }>;
  };
  error?: string;
}

interface PrometheusAlertsResponse {
  status: string;
  data?: {
    alerts?: Array<{
      labels?: Record<string, string>;
      annotations?: Record<string, string>;
      state?: string;
      activeAt?: string;
      value?: string;
    }>;
  };
  error?: string;
}

/**
 * Thin client for the Prometheus HTTP API.
 *
 * The self-healing engine reuses the existing Prometheus deployment for
 * detection instead of scraping infrastructure directly: every issue the
 * engine sees is derived from metrics that Prometheus is already collecting.
 */
@Injectable()
export class PrometheusQueryService {
  private readonly logger = new Logger(PrometheusQueryService.name);
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService
      .get<string>('PROMETHEUS_URL', 'http://localhost:9090')
      .replace(/\/+$/, '');
    this.requestTimeoutMs = parseInt(
      this.configService.get<string>('PROMETHEUS_TIMEOUT_MS', '10000'),
      10,
    );
  }

  /** True when a Prometheus endpoint has been configured. */
  isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  /**
   * Run an instant query and return the numeric value of every series.
   * Query failures degrade to an empty result so that a Prometheus outage
   * never breaks the detection loop.
   */
  async query(promQl: string): Promise<PrometheusSample[]> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get<PrometheusVectorResponse>(`${this.baseUrl}/api/v1/query`, {
            params: { query: promQl },
            timeout: this.requestTimeoutMs,
          })
          .pipe(timeout(this.requestTimeoutMs)),
      );

      const body = response.data;
      if (body?.status !== 'success') {
        this.logger.warn(
          `Prometheus query failed: ${body?.error ?? 'unknown error'}`,
        );
        return [];
      }

      return (body.data?.result ?? [])
        .map((entry) => ({
          metric: entry.metric ?? {},
          value: Number(entry.value?.[1] ?? NaN),
          timestampMs: entry.value?.[0] ?? 0,
        }))
        .filter((sample) => Number.isFinite(sample.value));
    } catch (error) {
      this.logger.warn(
        `Prometheus query error for "${promQl}": ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Convenience helper returning the highest value of a query result.
   */
  async queryMax(promQl: string): Promise<number | null> {
    const samples = await this.query(promQl);
    if (samples.length === 0) {
      return null;
    }
    return samples.reduce(
      (max, sample) => Math.max(max, sample.value),
      -Infinity,
    );
  }

  /**
   * Fetch the alerts Prometheus currently knows about.
   * Only `firing` and `pending` alerts are returned.
   */
  async getAlerts(): Promise<PrometheusAlert[]> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get<PrometheusAlertsResponse>(`${this.baseUrl}/api/v1/alerts`, {
            timeout: this.requestTimeoutMs,
          })
          .pipe(timeout(this.requestTimeoutMs)),
      );

      const body = response.data;
      if (body?.status !== 'success') {
        this.logger.warn(
          `Prometheus alerts query failed: ${body?.error ?? 'unknown error'}`,
        );
        return [];
      }

      return (body.data?.alerts ?? [])
        .filter(
          (alert) => alert.state === 'firing' || alert.state === 'pending',
        )
        .map((alert) => ({
          labels: alert.labels ?? {},
          annotations: alert.annotations ?? {},
          state: alert.state as PrometheusAlert['state'],
          activeAt: alert.activeAt ?? new Date().toISOString(),
          value: alert.value ?? '',
        }));
    } catch (error) {
      this.logger.warn(
        `Prometheus alerts query error: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
