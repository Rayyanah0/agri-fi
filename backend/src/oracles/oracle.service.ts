import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  OracleFeed,
  OracleProviderName,
} from './entities/oracle-feed.entity';
import { OracleObservation } from './entities/oracle-observation.entity';
import {
  OracleValidationService,
  deviationBps,
} from './oracle-validation.service';
import { OracleOnChainService } from './oracle-onchain.service';
import {
  OracleProvider,
  OracleReading,
} from './providers/oracle-provider.interface';
import { ChainlinkProvider } from './providers/chainlink.provider';
import { BandProvider } from './providers/band.provider';
import {
  CreateOracleFeedDto,
  UpdateOracleFeedDto,
} from './dto/oracle.dto';

export interface ReadingOutcome {
  provider: OracleProviderName;
  value: number | null;
  decimals: number;
  latencyMs: number;
  isFallback: boolean;
  valid: boolean;
  validationError: string | null;
  deviationBps: number | null;
  selected: boolean;
}

export interface RunFeedResult {
  feedId: string;
  ok: boolean;
  consensusValue: number | null;
  decimals: number;
  agreement: number;
  reason?: string;
  readings: ReadingOutcome[];
  submitted: boolean;
  stellarTxId?: string;
  gasCostXlm?: number;
}

export interface OracleAnalytics {
  feedId: string | null;
  totalObservations: number;
  validObservations: number;
  validRate: number;
  averageDeviationBps: number;
  averageLatencyMs: number;
  onChainSubmissions: number;
  submissionSuccessRate: number;
  totalGasCostXlm: number;
  byProvider: Array<{
    provider: OracleProviderName;
    count: number;
    averageLatencyMs: number;
    validRate: number;
  }>;
  costByDay: Array<{ date: string; costXlm: number; submissions: number }>;
}

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);
  private readonly providers = new Map<OracleProviderName, OracleProvider>();

  constructor(
    @InjectRepository(OracleFeed)
    private readonly feedRepo: Repository<OracleFeed>,
    @InjectRepository(OracleObservation)
    private readonly observationRepo: Repository<OracleObservation>,
    private readonly validation: OracleValidationService,
    private readonly onChain: OracleOnChainService,
    private readonly config: ConfigService,
    chainlink: ChainlinkProvider,
    band: BandProvider,
  ) {
    this.providers.set('chainlink', chainlink);
    this.providers.set('band', band);
  }

  // ── Feed configuration (governance) ─────────────────────────────────────────

  listFeeds(includeDisabled = true): Promise<OracleFeed[]> {
    const where = includeDisabled ? {} : { enabled: true };
    return this.feedRepo.find({ where, order: { feedId: 'ASC' } });
  }

  async getFeed(feedId: string): Promise<OracleFeed> {
    const feed = await this.feedRepo.findOne({ where: { feedId } });
    if (!feed) throw new NotFoundException(`Oracle feed ${feedId} not found`);
    return feed;
  }

  async createFeed(
    actorId: string,
    dto: CreateOracleFeedDto,
  ): Promise<OracleFeed> {
    const existing = await this.feedRepo.findOne({
      where: { feedId: dto.feedId },
    });
    if (existing) {
      throw new BadRequestException(`Feed ${dto.feedId} already exists`);
    }
    this.assertProviders(dto.providers);

    const feed = this.feedRepo.create({
      feedId: dto.feedId,
      description: dto.description ?? null,
      dataType: dto.dataType ?? 'commodity',
      providers: dto.providers,
      quorum: dto.quorum ?? 1,
      decimals: dto.decimals ?? 7,
      heartbeatSeconds: dto.heartbeatSeconds ?? 3600,
      maxDeviationBps: dto.maxDeviationBps ?? 1000,
      contractId: dto.contractId ?? null,
      oracleAddress: dto.oracleAddress ?? null,
      maxDailyCostXlm: dto.maxDailyCostXlm ?? null,
      enabled: dto.enabled ?? true,
      lastChangedBy: actorId,
    });
    return this.feedRepo.save(feed);
  }

  async updateFeed(
    actorId: string,
    feedId: string,
    dto: UpdateOracleFeedDto,
  ): Promise<OracleFeed> {
    const feed = await this.getFeed(feedId);
    if (dto.providers) this.assertProviders(dto.providers);
    if (
      dto.maxDeviationBps !== undefined &&
      (dto.maxDeviationBps <= 0 || dto.maxDeviationBps > 10_000)
    ) {
      throw new BadRequestException('maxDeviationBps must be within 1..10000');
    }

    Object.assign(feed, {
      description: dto.description ?? feed.description,
      dataType: dto.dataType ?? feed.dataType,
      providers: dto.providers ?? feed.providers,
      quorum: dto.quorum ?? feed.quorum,
      decimals: dto.decimals ?? feed.decimals,
      heartbeatSeconds: dto.heartbeatSeconds ?? feed.heartbeatSeconds,
      maxDeviationBps: dto.maxDeviationBps ?? feed.maxDeviationBps,
      contractId: dto.contractId ?? feed.contractId,
      oracleAddress: dto.oracleAddress ?? feed.oracleAddress,
      maxDailyCostXlm:
        dto.maxDailyCostXlm !== undefined
          ? dto.maxDailyCostXlm
          : feed.maxDailyCostXlm,
      enabled: dto.enabled ?? feed.enabled,
      lastChangedBy: actorId,
    });
    return this.feedRepo.save(feed);
  }

  // ── Fetch / validate / submit pipeline ──────────────────────────────────────

  /**
   * Runs the full pipeline for a feed: fetch from all providers, validate,
   * reach consensus, persist observations and (when configured + within budget)
   * submit to the on-chain price-feed contract.
   */
  async runFeed(
    feedId: string,
    options: { submit?: boolean } = {},
  ): Promise<RunFeedResult> {
    const feed = await this.getFeed(feedId);
    if (!feed.enabled) {
      throw new BadRequestException(`Feed ${feedId} is disabled`);
    }

    const submit = options.submit ?? true;
    if (submit && (await this.isOverBudget(feed))) {
      throw new BadRequestException(
        `Feed ${feedId} exceeded its daily cost budget`,
      );
    }

    const { readings, outcomes } = await this.collectReadings(feed);
    const consensus = this.validation.consensus(readings, feed);

    const selectedOutcomes = outcomes.map((o) => {
      if (!consensus.ok || consensus.value === null || !o.valid || o.value === null) {
        return o;
      }
      const agreement = deviationBps(o.value, consensus.value);
      const agrees =
        agreement === null || agreement <= feed.maxDeviationBps;
      return agrees ? { ...o, selected: true } : o;
    });

    await this.persistObservations(feed, selectedOutcomes);

    const result: RunFeedResult = {
      feedId,
      ok: consensus.ok,
      consensusValue: consensus.value,
      decimals: consensus.decimals,
      agreement: consensus.agreement,
      reason: consensus.reason,
      readings: selectedOutcomes,
      submitted: false,
    };

    if (consensus.ok && consensus.value !== null) {
      if (submit && feed.contractId && feed.oracleAddress) {
        const now = new Date();
        const submission = await this.onChain.submitPrice({
          feed,
          value: consensus.value,
          roundId: BigInt(now.getTime()),
          timestamp: Math.floor(now.getTime() / 1000),
        });
        result.submitted = true;
        result.stellarTxId = submission.txId;
        result.gasCostXlm = submission.gasCostXlm;
        await this.observationRepo.update(
          { feedId, selected: true },
          {
            onChain: true,
            stellarTxId: submission.txId,
            gasCostXlm: submission.gasCostXlm,
          },
        );
      }

      feed.lastValue = consensus.value;
      feed.lastRoundId = String(Date.now());
      feed.lastObservedAt = new Date();
      await this.feedRepo.save(feed);
    }

    return result;
  }

  /**
   * Dry-run: fetches and validates readings but never writes on-chain. Used to
   * verify provider configuration on testnet (#1235 — oracle testing).
   */
  async testFeed(feedId: string): Promise<RunFeedResult> {
    const feed = await this.getFeed(feedId);
    const { readings, outcomes } = await this.collectReadings(feed);
    const consensus = this.validation.consensus(readings, feed);
    return {
      feedId,
      ok: consensus.ok,
      consensusValue: consensus.value,
      decimals: consensus.decimals,
      agreement: consensus.agreement,
      reason: consensus.reason,
      readings: outcomes,
      submitted: false,
    };
  }

  // ── Analytics ───────────────────────────────────────────────────────────────

  async getAnalytics(
    feedId?: string,
    from?: Date,
    to?: Date,
  ): Promise<OracleAnalytics> {
    const range = this.range(from, to);
    const where = feedId
      ? { feedId, fetchedAt: Between(range.from, range.to) }
      : { fetchedAt: Between(range.from, range.to) };
    const observations = await this.observationRepo.find({ where });

    const valid = observations.filter((o) => o.valid);
    const deviations = valid
      .map((o) => Number(o.deviationBps))
      .filter((d) => Number.isFinite(d));
    const latencies = observations.map((o) => o.latencyMs);
    const submissions = observations.filter((o) => o.onChain);

    const byProvider = this.aggregate(observations, 'provider');
    const costByDay = this.costByDay(submissions);

    return {
      feedId: feedId ?? null,
      totalObservations: observations.length,
      validObservations: valid.length,
      validRate: this.ratio(valid.length, observations.length),
      averageDeviationBps: this.average(deviations),
      averageLatencyMs: this.average(latencies),
      onChainSubmissions: submissions.length,
      submissionSuccessRate: this.ratio(submissions.length, valid.length),
      totalGasCostXlm: submissions.reduce(
        (sum, o) => sum + Number(o.gasCostXlm ?? 0),
        0,
      ),
      byProvider,
      costByDay,
    };
  }

  async getCostSummary(
    feedId?: string,
  ): Promise<{ totalXlm: number; todayXlm: number; byFeed: Array<{ feedId: string; totalXlm: number }> }> {
    const submissions = await this.observationRepo.find({
      where: feedId ? { feedId, onChain: true } : { onChain: true },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const byFeedMap = new Map<string, number>();
    let totalXlm = 0;
    let todayXlm = 0;
    for (const o of submissions) {
      const cost = Number(o.gasCostXlm ?? 0);
      totalXlm += cost;
      if (o.fetchedAt >= today) todayXlm += cost;
      byFeedMap.set(o.feedId, (byFeedMap.get(o.feedId) ?? 0) + cost);
    }

    return {
      totalXlm,
      todayXlm,
      byFeed: Array.from(byFeedMap.entries()).map(([id, total]) => ({
        feedId: id,
        totalXlm: total,
      })),
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async collectReadings(feed: OracleFeed): Promise<{
    readings: OracleReading[];
    outcomes: ReadingOutcome[];
  }> {
    const readings: OracleReading[] = [];
    const outcomes: ReadingOutcome[] = [];
    const now = new Date();

    for (let index = 0; index < feed.providers.length; index += 1) {
      const name = feed.providers[index];
      const provider = this.providers.get(name);
      const isFallback = index > 0;
      if (!provider) {
        outcomes.push(this.failedOutcome(name, isFallback, 'provider_unknown'));
        continue;
      }

      const started = Date.now();
      try {
        const reading = await provider.fetch({
          feedId: feed.feedId,
          dataType: feed.dataType,
          decimals: feed.decimals,
        });
        const latencyMs = Date.now() - started;
        const check = this.validation.validateReading(
          reading,
          feed,
          feed.lastValue,
          now,
        );
        readings.push(reading);
        outcomes.push({
          provider: name,
          value: reading.value,
          decimals: reading.decimals,
          latencyMs,
          isFallback,
          valid: check.valid,
          validationError: check.error ?? null,
          deviationBps: check.deviationBps,
          selected: false,
        });
      } catch (err) {
        this.logger.warn(
          `Oracle provider ${name} failed for ${feed.feedId}: ${(err as Error).message}`,
        );
        const mock = this.maybeMock(name, feed);
        if (mock) {
          readings.push(mock);
          outcomes.push({
            provider: name,
            value: mock.value,
            decimals: mock.decimals,
            latencyMs: Date.now() - started,
            isFallback,
            valid: true,
            validationError: null,
            deviationBps: null,
            selected: false,
          });
          continue;
        }
        outcomes.push(
          this.failedOutcome(name, isFallback, 'provider_unavailable'),
        );
      }
    }

    return { readings, outcomes };
  }

  /** When enabled, synthesize a price so testnet/CI pipelines can run offline. */
  private maybeMock(
    provider: OracleProviderName,
    feed: OracleFeed,
  ): OracleReading | null {
    if (this.config.get('ORACLES_MOCK', 'false') !== 'true') return null;
    const base = feed.lastValue ?? 1;
    const jitter = 1 + (Math.random() - 0.5) * 0.002; // ±0.1%
    return {
      value: Number((base * jitter).toFixed(feed.decimals)),
      decimals: feed.decimals,
      roundId: String(Date.now()),
      observedAt: new Date(),
      provider,
    };
  }

  private failedOutcome(
    provider: OracleProviderName,
    isFallback: boolean,
    error: string,
  ): ReadingOutcome {
    return {
      provider,
      value: null,
      decimals: 0,
      latencyMs: 0,
      isFallback,
      valid: false,
      validationError: error,
      deviationBps: null,
      selected: false,
    };
  }

  private async persistObservations(
    feed: OracleFeed,
    outcomes: ReadingOutcome[],
  ): Promise<void> {
    if (outcomes.length === 0) return;
    const now = new Date();
    const rows = outcomes.map((o) =>
      this.observationRepo.create({
        feedId: feed.feedId,
        provider: o.provider,
        value: o.value,
        decimals: o.decimals,
        fetchedAt: now,
        latencyMs: o.latencyMs,
        deviationBps: o.deviationBps,
        valid: o.valid,
        validationError: o.validationError,
        isFallback: o.isFallback,
        selected: o.selected,
        onChain: false,
      }),
    );
    await this.observationRepo.save(rows);
  }

  private async isOverBudget(feed: OracleFeed): Promise<boolean> {
    if (feed.maxDailyCostXlm === null || feed.maxDailyCostXlm === undefined) {
      return false;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todays = await this.observationRepo.find({
      where: { feedId: feed.feedId, onChain: true, fetchedAt: Between(today, new Date()) },
    });
    const spent = todays.reduce((sum, o) => sum + Number(o.gasCostXlm ?? 0), 0);
    return spent >= feed.maxDailyCostXlm;
  }

  private assertProviders(providers: OracleProviderName[]): void {
    if (!providers || providers.length === 0) {
      throw new BadRequestException('At least one provider is required');
    }
    for (const provider of providers) {
      if (!this.providers.has(provider)) {
        throw new BadRequestException(`Unknown oracle provider: ${provider}`);
      }
    }
  }

  private aggregate(
    observations: OracleObservation[],
    field: 'provider',
  ): OracleAnalytics['byProvider'] {
    const map = new Map<
      OracleProviderName,
      { count: number; latency: number[]; valid: number }
    >();
    for (const o of observations) {
      const key = o[field] as OracleProviderName;
      const bucket = map.get(key) ?? { count: 0, latency: [], valid: 0 };
      bucket.count += 1;
      bucket.latency.push(o.latencyMs);
      if (o.valid) bucket.valid += 1;
      map.set(key, bucket);
    }
    return Array.from(map.entries()).map(([provider, bucket]) => ({
      provider,
      count: bucket.count,
      averageLatencyMs: this.average(bucket.latency),
      validRate: this.ratio(bucket.valid, bucket.count),
    }));
  }

  private costByDay(
    submissions: OracleObservation[],
  ): Array<{ date: string; costXlm: number; submissions: number }> {
    const map = new Map<string, { costXlm: number; submissions: number }>();
    for (const o of submissions) {
      const date = o.fetchedAt.toISOString().slice(0, 10);
      const bucket = map.get(date) ?? { costXlm: 0, submissions: 0 };
      bucket.costXlm += Number(o.gasCostXlm ?? 0);
      bucket.submissions += 1;
      map.set(date, bucket);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({ date, ...bucket }));
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(4));
  }

  private ratio(part: number, whole: number): number {
    if (whole === 0) return 0;
    return Number((part / whole).toFixed(4));
  }

  private range(from?: Date, to?: Date): { from: Date; to: Date } {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: start, to: end };
  }
}
