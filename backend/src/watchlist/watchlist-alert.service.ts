import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In, Repository } from 'typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { WatchlistService } from './watchlist.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Human-readable wording for the deal lifecycle statuses. */
const STATUS_LABELS: Record<string, string> = {
  draft: 'in draft',
  open: 'open for investment',
  funded: 'fully funded',
  delivered: 'delivered',
  completed: 'completed',
  failed: 'failed',
  canceled: 'canceled',
  expired: 'expired',
};

export interface AlertScanResult {
  fundingAlerts: number;
  statusAlerts: number;
  watched: number;
}

/**
 * Pushes watchlist alerts (#1003).
 *
 * Every deal someone follows is compared against that person's thresholds and
 * against the last status they were told about. Comparison is state-based, not
 * callback-based: deal rows are written from six different places (investment
 * confirmation, cancellation, expiry, settlement, the Soroban indexer, the
 * marketplace crons) and several of them use bulk `manager.update()` calls that
 * bypass TypeORM entity events, so a single reconcile pass sees all of them.
 *
 * The `alertedPct` / `alertedStatus` columns are the dedup state, so a restart
 * or a re-run of the pass cannot send an alert twice. One pass per process per
 * 5 minutes is assumed; N independently scheduled replicas could each send
 * before the watermark lands.
 */
@Injectable()
export class WatchlistAlertService {
  private readonly logger = new Logger(WatchlistAlertService.name);

  constructor(
    @InjectRepository(WatchlistItem)
    private readonly watchlistRepo: Repository<WatchlistItem>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @Optional()
    private readonly notificationsService?: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scanWatchlistedDeals(): Promise<AlertScanResult> {
    const result: AlertScanResult = {
      fundingAlerts: 0,
      statusAlerts: 0,
      watched: 0,
    };

    try {
      const items = await this.watchlistRepo.find();
      if (items.length === 0) return result;
      result.watched = items.length;

      const deals = await this.dealRepo.find({
        where: { id: In([...new Set(items.map((item) => item.dealId))]) },
      });
      const dealsById = new Map(deals.map((deal) => [deal.id, deal]));

      for (const item of items) {
        const deal = dealsById.get(item.dealId);
        if (!deal) continue;
        result.fundingAlerts += await this.alertFunding(item, deal);
        result.statusAlerts += await this.alertStatus(item, deal);
      }

      if (result.fundingAlerts + result.statusAlerts > 0) {
        this.logger.log(
          {
            watched: result.watched,
            fundingAlerts: result.fundingAlerts,
            statusAlerts: result.statusAlerts,
          },
          'Watchlist alert pass complete',
        );
      }
      return result;
    } catch (error) {
      this.logger.error(
        { error },
        'Watchlist alert pass failed; will retry on the next schedule',
      );
      return result;
    }
  }

  /**
   * One notification per watcher per pass, even when several thresholds are
   * crossed between two runs.
   */
  private async alertFunding(
    item: WatchlistItem,
    deal: TradeDeal,
  ): Promise<number> {
    const pct = WatchlistService.fundedPct(deal);
    const reached = item.notifyFundingPct
      .filter((threshold) => threshold <= pct && threshold > item.alertedPct)
      .sort((a, b) => a - b);
    if (reached.length === 0) return 0;

    const highest = reached[reached.length - 1];
    const label = WatchlistAlertService.dealLabel(deal);

    try {
      await this.notify(item.userId, {
        title: `${label} is ${highest}% funded`,
        message:
          `${label} has reached ${highest}% of its funding target: ` +
          `$${WatchlistAlertService.usd(Number(deal.totalInvested))} of ` +
          `$${WatchlistAlertService.usd(Number(deal.totalValue))} raised.`,
        dealId: deal.id,
        metadata: {
          alertType: 'watchlist_funding',
          dealId: deal.id,
          thresholds: reached,
          fundedPct: Math.round(pct * 10) / 10,
          watchlistItemId: item.id,
        },
      });
    } catch (error) {
      this.logger.error(
        { error, dealId: deal.id, userId: item.userId },
        'Failed to store watchlist funding alert',
      );
      return 0;
    }

    // The watermark only moves once the notification row exists, so a failure
    // leaves the threshold eligible for the next pass.
    item.alertedPct = highest;
    await this.watchlistRepo.save(item);
    return 1;
  }

  private async alertStatus(
    item: WatchlistItem,
    deal: TradeDeal,
  ): Promise<number> {
    if (!item.notifyStatusChange) return 0;
    if (item.alertedStatus === deal.status) return 0;

    // A row with no recorded status (created before the watermark existed, or
    // backfilled by an import) learns the current status silently instead of
    // alerting on whatever happened in the past.
    if (item.alertedStatus === null) {
      item.alertedStatus = deal.status;
      await this.watchlistRepo.save(item);
      return 0;
    }

    const fromText = STATUS_LABELS[item.alertedStatus] ?? item.alertedStatus;
    const toText = STATUS_LABELS[deal.status] ?? deal.status;
    const label = WatchlistAlertService.dealLabel(deal);

    try {
      await this.notify(item.userId, {
        title: `${label} is now ${toText}`,
        message: `${label} moved from ${fromText} to ${toText}.`,
        dealId: deal.id,
        metadata: {
          alertType: 'watchlist_status',
          dealId: deal.id,
          fromStatus: item.alertedStatus,
          toStatus: deal.status,
          watchlistItemId: item.id,
        },
      });
    } catch (error) {
      this.logger.error(
        { error, dealId: deal.id, userId: item.userId },
        'Failed to store watchlist status alert',
      );
      return 0;
    }

    item.alertedStatus = deal.status;
    await this.watchlistRepo.save(item);
    return 1;
  }

  private async notify(
    userId: string,
    params: {
      title: string;
      message: string;
      dealId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!this.notificationsService) {
      this.logger.warn(
        { userId, dealId: params.dealId },
        'NotificationsService unavailable; watchlist alert not stored',
      );
      return;
    }
    await this.notificationsService.createNotification({
      userId,
      type: 'deal',
      title: params.title,
      message: params.message,
      linkUrl: `/marketplace/${params.dealId}`,
      metadataJson: params.metadata,
    });
  }

  private static dealLabel(deal: TradeDeal): string {
    if (deal.tokenSymbol) return deal.tokenSymbol;
    if (deal.commodity) return `The ${deal.commodity} deal`;
    return 'A deal on your watchlist';
  }

  private static usd(amount: number): string {
    return Number.isFinite(amount)
      ? amount.toLocaleString('en-US', { minimumFractionDigits: 2 })
      : '0.00';
  }
}
