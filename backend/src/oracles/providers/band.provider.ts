import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  OracleProvider,
  OracleFeedDescriptor,
  OracleReading,
} from './oracle-provider.interface';

/**
 * Band Protocol adapter (#1235).
 *
 * Band exposes reference data through its on-chain oracle API
 * (`/api/oracle/v1/get_reference_data`). The base URL defaults to the public
 * Band endpoint and can be overridden with `BAND_API_URL`.
 */
@Injectable()
export class BandProvider implements OracleProvider {
  readonly name = 'band' as const;
  private readonly logger = new Logger(BandProvider.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>(
      'BAND_API_URL',
      'https://laozi1.bandchain.org',
    );
    this.http = axios.create({
      timeout: config.get<number>('ORACLE_HTTP_TIMEOUT_MS', 5000),
      headers: { 'User-Agent': 'agri-fi-oracle/1.0' },
    });
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async fetch(descriptor: OracleFeedDescriptor): Promise<OracleReading> {
    const started = Date.now();
    const { data } = await this.http.get(
      `${this.baseUrl}/api/oracle/v1/get_reference_data`,
      { params: { pairs: descriptor.feedId } },
    );
    const latencyMs = Date.now() - started;

    const value = this.extractValue(data);
    if (value === null) {
      throw new Error('Band response did not contain a usable value');
    }

    this.logger.debug(
      { feed: descriptor.feedId, latencyMs },
      'Band reading fetched',
    );

    return {
      value,
      decimals: this.extractDecimals(data, descriptor.decimals),
      roundId: this.extractRoundId(data),
      observedAt: this.extractObservedAt(data),
      provider: 'band',
      raw: data,
    };
  }

  private extractValue(data: any): number | null {
    const list =
      data?.result ??
      data?.data ??
      data?.reference_data ??
      data?.data?.reference_data;
    const first = Array.isArray(list) ? list[0] : list;
    const candidates = [
      first?.rate,
      first?.price,
      first?.px,
      data?.rate,
      data?.price,
      data?.px,
    ];
    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
  }

  private extractDecimals(data: any, fallback: number): number {
    const list = data?.result ?? data?.data ?? [];
    const first = Array.isArray(list) ? list[0] : list;
    const parsed = Number(first?.decimals ?? data?.decimals);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private extractRoundId(data: any): string | undefined {
    const list = data?.result ?? data?.data ?? [];
    const first = Array.isArray(list) ? list[0] : list;
    const round = first?.resolve_time ?? first?.round_id ?? data?.round_id;
    return round === undefined || round === null ? undefined : String(round);
  }

  private extractObservedAt(data: any): Date {
    const list = data?.result ?? data?.data ?? [];
    const first = Array.isArray(list) ? list[0] : list;
    const ts = first?.timestamp ?? first?.resolve_time ?? data?.timestamp;
    if (ts === undefined || ts === null) return new Date();
    const asNumber = Number(ts);
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber);
    }
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}
