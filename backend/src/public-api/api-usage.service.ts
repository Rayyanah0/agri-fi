import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { ApiUsageEvent } from './entities/api-usage-event.entity';
import { PartnerApiUsage, PartnerTier } from './entities/partner-api-usage.entity';

const TIER_QUOTAS: Record<PartnerTier, number> = {
  free: 10_000,
  standard: 100_000,
  premium: 1_000_000,
};
const REQUEST_RATE_USD = 0.00001;
const TRANSFER_RATE_USD_PER_GIB = 0.1;
const COMPUTE_RATE_USD_PER_SECOND = 0.001;

@Injectable()
export class ApiUsageService {
  constructor(
    @InjectRepository(ApiUsageEvent)
    private readonly eventRepository: Repository<ApiUsageEvent>,
    @InjectRepository(PartnerApiUsage)
    private readonly partnerRepository: Repository<PartnerApiUsage>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getQuota(ownerId: string): Promise<{ tier: PartnerTier; monthlyQuota: number }> {
    const partner = await this.partnerRepository.findOne({ where: { ownerId } });
    const tier = partner?.tier ?? 'free';
    return {
      tier,
      monthlyQuota: partner?.monthlyQuotaOverride ?? TIER_QUOTAS[tier],
    };
  }

  async record(event: Partial<ApiUsageEvent>): Promise<void> {
    await this.eventRepository.save(this.eventRepository.create(event));
    if (event.ownerId) await this.notifyApproachingQuota(event.ownerId);
  }

  private async notifyApproachingQuota(ownerId: string, now = new Date()): Promise<void> {
    const quota = await this.getQuota(ownerId);
    if (quota.monthlyQuota <= 0) return;

    const requests = await this.getCurrentMonthCount(ownerId, now);
    if (requests < quota.monthlyQuota * 0.8) return;

    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    await this.partnerRepository
      .createQueryBuilder()
      .insert()
      .values({ ownerId, tier: 'free', monthlyQuotaOverride: null, lastAlertedMonth: null })
      .orIgnore()
      .execute();

    const claimed = await this.partnerRepository
      .createQueryBuilder()
      .update(PartnerApiUsage)
      .set({ lastAlertedMonth: month })
      .where('"owner_id" = :ownerId', { ownerId })
      .andWhere('(\"last_alerted_month\" IS NULL OR \"last_alerted_month\" <> :month)', { month })
      .execute();

    if (!claimed.affected) return;
    await this.notificationsService.createNotification({
      userId: ownerId,
      type: 'alert',
      title: 'Partner API quota warning',
      message: `API usage has reached ${Math.min(100, Math.floor(requests / quota.monthlyQuota * 100))}% of your ${quota.tier} monthly quota.`,
      linkUrl: '/settings/api-usage',
      metadataJson: { tier: quota.tier, quota: quota.monthlyQuota, requests, month },
    });
  }

  async getCurrentMonthCount(ownerId: string, now = new Date()): Promise<number> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const result = await this.eventRepository
      .createQueryBuilder('usage')
      .where('usage.ownerId = :ownerId', { ownerId })
      .andWhere('usage.createdAt >= :start', { start })
      .select('COUNT(*)', 'count')
      .getRawOne<{ count: string }>();
    return Number(result?.count ?? 0);
  }

  async getUsage(ownerId: string, now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.getUsageForPeriod(ownerId, start, now, now);
  }

  async getMonthlyStatement(ownerId: string, year: number, month: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('year must be 2000-9999 and month must be 1-12');
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return this.getUsageForPeriod(ownerId, start, end, end);
  }

  private async getUsageForPeriod(ownerId: string, start: Date, end: Date, now: Date) {
    const quota = await this.getQuota(ownerId);
    const rows = await this.eventRepository
      .createQueryBuilder('usage')
      .where('usage.ownerId = :ownerId', { ownerId })
      .andWhere('usage.createdAt >= :start', { start })
      .andWhere('usage.createdAt < :end', { end })
      .select('COUNT(*)', 'requests')
      .addSelect('COALESCE(SUM(usage.dataTransferBytes), 0)', 'bytes')
      .addSelect('COALESCE(SUM(usage.computeTimeMs), 0)', 'computeMs')
      .addSelect('COUNT(*) FILTER (WHERE usage.anomalous = true)', 'anomalies')
      .getRawOne<{ requests: string; bytes: string; computeMs: string; anomalies: string }>();
    const requests = Number(rows?.requests ?? 0);
    const bytes = Number(rows?.bytes ?? 0);
    const computeMs = Number(rows?.computeMs ?? 0);
    const chargesUsd = Number((
      requests * REQUEST_RATE_USD +
      (bytes / 1024 ** 3) * TRANSFER_RATE_USD_PER_GIB +
      (computeMs / 1000) * COMPUTE_RATE_USD_PER_SECOND
    ).toFixed(6));
    const daily = await this.eventRepository
      .createQueryBuilder('usage')
      .where('usage.ownerId = :ownerId', { ownerId })
      .andWhere('usage.createdAt >= :start', { start })
      .andWhere('usage.createdAt < :end', { end })
      .select("DATE_TRUNC('day', usage.createdAt)", 'day')
      .addSelect('COUNT(*)', 'requests')
      .groupBy("DATE_TRUNC('day', usage.createdAt)")
      .orderBy('day', 'ASC')
      .getRawMany<{ day: Date; requests: string }>();

    return {
      period: { start: start.toISOString(), end: now.toISOString() },
      tier: quota.tier,
      quota: quota.monthlyQuota,
      requests,
      remaining: Math.max(0, quota.monthlyQuota - requests),
      quotaUsedPercent: quota.monthlyQuota === 0 ? 100 : Math.min(100, requests / quota.monthlyQuota * 100),
      dataTransferBytes: bytes,
      computeTimeMs: computeMs,
      estimatedChargesUsd: chargesUsd,
      anomalies: Number(rows?.anomalies ?? 0),
      approachingQuota: requests >= quota.monthlyQuota * 0.8,
      daily: daily.map((item) => ({ day: new Date(item.day).toISOString().slice(0, 10), requests: Number(item.requests) })),
    };
  }
}