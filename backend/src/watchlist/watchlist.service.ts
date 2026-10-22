import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DEFAULT_WATCHLIST_THRESHOLDS,
  MAX_WATCHLIST_THRESHOLDS,
  WATCHLIST_THRESHOLD_MAX,
  WATCHLIST_THRESHOLD_MIN,
  WatchlistItem,
} from './entities/watchlist-item.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import {
  CreateWatchlistItemDto,
  UpdateWatchlistThresholdsDto,
} from './dto/watchlist.dto';

/** Deal summary safe to return to a watcher — never the raw relation. */
export interface WatchlistedDealSummary {
  id: string;
  title: string;
  commodity: string;
  country: string | null;
  status: string;
  token_symbol: string;
  total_value: string;
  total_invested: string;
  funded_pct: number;
  expected_roi: string | null;
  delivery_date: Date | null;
}

export interface WatchlistEntry {
  id: string;
  deal_id: string;
  notify_funding_pct: number[];
  notify_status_change: boolean;
  alerted_pct: number;
  alerted_status: string | null;
  created_at: Date;
  deal: WatchlistedDealSummary | null;
}

/**
 * Watchlist persistence for #1003: which deals an investor starred, and the
 * funding thresholds / status changes they want to be told about.
 *
 * Watermarks (`alertedPct`, `alertedStatus`) are seeded from the deal's current
 * state when an investor stars it, so joining a watchlist never replays alerts
 * for events that already happened.
 */
@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistItem)
    private readonly watchlistRepo: Repository<WatchlistItem>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
  ) {}

  /**
   * Validate and canonicalise a threshold list: integers within 1-100, unique,
   * ascending, at most `MAX_WATCHLIST_THRESHOLDS` entries. An explicit empty
   * list is valid and means "no funding alerts".
   */
  normalizeThresholds(input?: number[]): number[] {
    if (input === undefined) return [...DEFAULT_WATCHLIST_THRESHOLDS];
    if (!Array.isArray(input)) {
      throw new BadRequestException('notify_funding_pct must be an array');
    }
    if (input.length > MAX_WATCHLIST_THRESHOLDS) {
      throw new BadRequestException(
        `notify_funding_pct accepts at most ${MAX_WATCHLIST_THRESHOLDS} thresholds`,
      );
    }
    for (const value of input) {
      if (
        !Number.isInteger(value) ||
        value < WATCHLIST_THRESHOLD_MIN ||
        value > WATCHLIST_THRESHOLD_MAX
      ) {
        throw new BadRequestException(
          `Funding thresholds must be whole numbers between ${WATCHLIST_THRESHOLD_MIN} and ${WATCHLIST_THRESHOLD_MAX}`,
        );
      }
    }
    return [...new Set(input)].sort((a, b) => a - b);
  }

  async list(userId: string): Promise<WatchlistEntry[]> {
    const items = await this.watchlistRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (items.length === 0) return [];

    const deals = await this.dealRepo.find({
      where: { id: In(items.map((item) => item.dealId)) },
    });
    const byId = new Map(deals.map((deal) => [deal.id, deal]));

    return items.map((item) => ({
      id: item.id,
      deal_id: item.dealId,
      notify_funding_pct: item.notifyFundingPct,
      notify_status_change: item.notifyStatusChange,
      alerted_pct: item.alertedPct,
      alerted_status: item.alertedStatus,
      created_at: item.createdAt,
      deal: this.toSummary(byId.get(item.dealId)),
    }));
  }

  /**
   * Star a deal. Idempotent: starring an already-watched deal updates nothing
   * but reports the existing row, so a double tap cannot reset alert
   * watermarks.
   */
  async add(
    userId: string,
    dto: CreateWatchlistItemDto,
  ): Promise<{ item: WatchlistEntry; created: boolean }> {
    const deal = await this.dealRepo.findOne({ where: { id: dto.deal_id } });
    if (!deal) {
      throw new NotFoundException('Trade deal not found');
    }
    if (deal.status === 'draft') {
      throw new BadRequestException(
        'Only published deals can be added to a watchlist',
      );
    }

    const existing = await this.watchlistRepo.findOne({
      where: { userId, dealId: dto.deal_id },
    });
    if (existing) {
      return { item: await this.toEntry(existing, deal), created: false };
    }

    const saved = await this.watchlistRepo.save(
      this.watchlistRepo.create({
        userId,
        dealId: deal.id,
        notifyFundingPct: this.normalizeThresholds(dto.notify_funding_pct),
        notifyStatusChange: dto.notify_status_change ?? true,
        alertedPct: Math.min(
          WATCHLIST_THRESHOLD_MAX,
          Math.floor(WatchlistService.fundedPct(deal)),
        ),
        alertedStatus: deal.status,
      }),
    );

    return { item: await this.toEntry(saved, deal), created: true };
  }

  /** Replace the alert thresholds on an existing watchlist item. */
  async update(
    userId: string,
    dealId: string,
    dto: UpdateWatchlistThresholdsDto,
  ): Promise<WatchlistEntry> {
    const item = await this.watchlistRepo.findOne({
      where: { userId, dealId },
    });
    if (!item) {
      throw new NotFoundException('Deal is not on your watchlist');
    }
    if (
      dto.notify_funding_pct === undefined &&
      dto.notify_status_change === undefined
    ) {
      throw new BadRequestException(
        'Provide notify_funding_pct and/or notify_status_change',
      );
    }

    if (dto.notify_funding_pct !== undefined) {
      // The watermark is deliberately left alone: a threshold the deal has
      // already passed stays silent, and re-adding it must not back-date an
      // alert for something that happened before the change.
      item.notifyFundingPct = this.normalizeThresholds(dto.notify_funding_pct);
    }
    if (dto.notify_status_change !== undefined) {
      item.notifyStatusChange = dto.notify_status_change;
    }

    const saved = await this.watchlistRepo.save(item);
    return this.toEntry(saved);
  }

  async remove(userId: string, dealId: string): Promise<void> {
    const item = await this.watchlistRepo.findOne({
      where: { userId, dealId },
    });
    if (!item) {
      throw new NotFoundException('Deal is not on your watchlist');
    }
    await this.watchlistRepo.remove(item);
  }

  /** Subset of `dealIds` the user has starred — used by the marketplace list. */
  async watchedDealIds(
    userId: string,
    dealIds: readonly string[],
  ): Promise<Set<string>> {
    if (dealIds.length === 0) return new Set();
    const rows = await this.watchlistRepo.find({
      where: { userId, dealId: In([...dealIds]) },
      select: { dealId: true },
    });
    return new Set(rows.map((row) => row.dealId));
  }

  static fundedPct(deal: Pick<TradeDeal, 'totalValue' | 'totalInvested'>) {
    const totalValue = Number(deal.totalValue);
    if (!Number.isFinite(totalValue) || totalValue <= 0) return 0;
    return (Number(deal.totalInvested) / totalValue) * 100;
  }

  private toSummary(deal?: TradeDeal): WatchlistedDealSummary | null {
    if (!deal) return null;
    return {
      id: deal.id,
      title: deal.title,
      commodity: deal.commodity,
      country: deal.country ?? null,
      status: deal.status,
      token_symbol: deal.tokenSymbol,
      total_value: deal.totalValue as unknown as string,
      total_invested: deal.totalInvested as unknown as string,
      funded_pct: Math.round(WatchlistService.fundedPct(deal) * 10) / 10,
      expected_roi: deal.expectedRoi as unknown as string | null,
      delivery_date: deal.deliveryDate ?? null,
    };
  }

  private async toEntry(
    item: WatchlistItem,
    alreadyLoaded?: TradeDeal,
  ): Promise<WatchlistEntry> {
    const deal =
      alreadyLoaded ??
      (await this.dealRepo.findOne({ where: { id: item.dealId } }));
    return {
      id: item.id,
      deal_id: item.dealId,
      notify_funding_pct: item.notifyFundingPct,
      notify_status_change: item.notifyStatusChange,
      alerted_pct: item.alertedPct,
      alerted_status: item.alertedStatus,
      created_at: item.createdAt,
      deal: this.toSummary(deal ?? undefined),
    };
  }
}
