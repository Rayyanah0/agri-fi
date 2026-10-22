import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  OracleProvider,
  OracleFeedDescriptor,
  OracleReading,
} from './oracle-provider.interface';

/**
 * Chainlink data-feed adapter (#1235).
 *
 * Chainlink Data Feeds / Data Streams are consumed through the provider's
 * HTTP API / aggregator endpoint. The endpoint and credentials are configured
 * with `CHAINLINK_API_URL` and `CHAINLINK_API_KEY`. When no endpoint is set the
 * adapter reports itself unavailable so the service can fall back.
 */
@Injectable()
export class ChainlinkProvider implements OracleProvider {
  readonly name = 'chainlink' as const;
  private readonly logger = new Logger(ChainlinkProvider.name);
  private readonly http: AxiosInstance;
  private readonly apiUrl?: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = config.get<string>('CHAINLINK_API_URL') || undefined;
    this.http = axios.create({
      timeout: config.get<number>('ORACLE_HTTP_TIMEOUT_MS', 5000),
      headers: {
        'User-Agent': 'agri-fi-oracle/1.0',
      },
    });
    const apiKey = config.get<string>('CHAINLINK_API_KEY');
    if (apiKey) {
      this.http.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiUrl);
  }

  async fetch(descriptor: OracleFeedDescriptor): Promise<OracleReading> {
    if (!this.apiUrl) {
      throw new Error('Chainlink endpoint is not configured');
    }

    const started = Date.now();
    const { data } = await this.http.get(this.apiUrl, {
      params: { pair: descriptor.feedId },
    });
    const latencyMs = Date.now() - started;

    const value = this.extractValue(data);
    if (value === null) {
      throw new Error('Chainlink response did not contain a usable value');
    }

    this.logger.debug(
      { feed: descriptor.feedId, latencyMs },
      'Chainlink reading fetched',
    );

    return {
      value,
      decimals: this.extractDecimals(data, descriptor.decimals),
      roundId: this.extractRoundId(data),
      observedAt: this.extractObservedAt(data),
      provider: 'chainlink',
      raw: data,
    };
  }

  private extractValue(data: any): number | null {
    const candidates = [
      data?.value,
      data?.answer,
      data?.price,
      data?.latestAnswer,
      data?.data?.value,
      data?.data?.price,
    ];
    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
  }

  private extractDecimals(data: any, fallback: number): number {
    const parsed = Number(data?.decimals ?? data?.data?.decimals);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private extractRoundId(data: any): string | undefined {
    const round = data?.roundId ?? data?.round_id ?? data?.data?.roundId;
    return round === undefined || round === null ? undefined : String(round);
  }

  private extractObservedAt(data: any): Date {
    const ts =
      data?.updatedAt ??
      data?.updated_at ??
      data?.timestamp ??
      data?.data?.updatedAt;
    if (ts === undefined || ts === null) return new Date();
    const asNumber = Number(ts);
    if (Number.isFinite(asNumber)) {
      // Seconds vs milliseconds heuristic.
      return new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber);
    }
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}
