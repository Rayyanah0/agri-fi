import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment, InvestmentStatus } from './entities/investment.entity';

export interface ConcentrationBreakdown {
  /** Dimension being measured (commodity, region, or deal id). */
  dimension: string;
  /** Label for display (e.g. commodity name, location, deal title). */
  label: string;
  /** Invested USD in this dimension. */
  amountUsd: number;
  /** Share of total portfolio (0–1). */
  weight: number;
  /** Whether this dimension exceeds its threshold. */
  breached: boolean;
}

export interface ConcentrationAlert {
  type: 'commodity' | 'region' | 'deal';
  label: string;
  weight: number;
  threshold: number;
  message: string;
}

export interface ConcentrationRiskResult {
  totalPortfolioUsd: number;
  byCommodity: ConcentrationBreakdown[];
  byRegion: ConcentrationBreakdown[];
  byDeal: ConcentrationBreakdown[];
  alerts: ConcentrationAlert[];
}

export interface ConcentrationThresholds {
  /** Max weight per commodity before alert (default 0.40). */
  commodity: number;
  /** Max weight per region / farm location before alert (default 0.40). */
  region: number;
  /** Max weight per single deal before alert (default 0.25). */
  deal: number;
}

const DEFAULT_THRESHOLDS: ConcentrationThresholds = {
  commodity: 0.4,
  region: 0.4,
  deal: 0.25,
};

const ACTIVE_STATUSES: InvestmentStatus[] = [
  InvestmentStatus.CONFIRMED,
  InvestmentStatus.ACTIVE,
];

@Injectable()
export class ConcentrationRiskService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
  ) {}

  async getConcentrationRisk(
    investorId: string,
    thresholds: Partial<ConcentrationThresholds> = {},
  ): Promise<ConcentrationRiskResult> {
    const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };

    const investments = await this.investmentRepo.find({
      where: ACTIVE_STATUSES.map((s) => ({ investorId, status: s })),
      relations: ['tradeDeal'],
    });

    return this.computeConcentration(investments, limits);
  }

  /**
   * Returns exposure weights grouped by commodity and region for a supplied
   * investment list. Used by the stress-testing simulation to apply scenario
   * shocks by commodity and region without duplicating roll-up logic.
   */
  getExposureWeights(investments: Investment[]): {
    totalPortfolioUsd: number;
    byCommodity: ConcentrationBreakdown[];
    byRegion: ConcentrationBreakdown[];
  } {
    const totalPortfolioUsd = investments.reduce(
      (sum, inv) => sum + Number(inv.amountUsd),
      0,
    );

    if (totalPortfolioUsd === 0) {
      return { totalPortfolioUsd: 0, byCommodity: [], byRegion: [] };
    }

    const byCommodity = this.rollUp(
      investments,
      (inv) => inv.tradeDeal?.commodity?.toLowerCase() ?? 'unknown',
      (inv) => inv.tradeDeal?.commodity ?? 'Unknown',
      totalPortfolioUsd,
      DEFAULT_THRESHOLDS.commodity,
    );

    const byRegion = this.rollUp(
      investments,
      (inv) => inv.tradeDeal?.farmLocation?.toLowerCase() ?? 'unknown',
      (inv) => inv.tradeDeal?.farmLocation ?? 'Unknown',
      totalPortfolioUsd,
      DEFAULT_THRESHOLDS.region,
    );

    return { totalPortfolioUsd, byCommodity, byRegion };
  }

  /**
   * Pure computation path — accepts pre-loaded investments so callers (and
   * tests) can avoid a real DB round-trip.
   */
  computeConcentration(
    investments: Investment[],
    thresholds: ConcentrationThresholds = DEFAULT_THRESHOLDS,
  ): ConcentrationRiskResult {
    const totalPortfolioUsd = investments.reduce(
      (sum, inv) => sum + Number(inv.amountUsd),
      0,
    );

    if (totalPortfolioUsd === 0) {
      return {
        totalPortfolioUsd: 0,
        byCommodity: [],
        byRegion: [],
        byDeal: [],
        alerts: [],
      };
    }

    const byCommodity = this.rollUp(
      investments,
      (inv) => inv.tradeDeal?.commodity?.toLowerCase() ?? 'unknown',
      (inv) => inv.tradeDeal?.commodity ?? 'Unknown',
      totalPortfolioUsd,
      thresholds.commodity,
    );

    const byRegion = this.rollUp(
      investments,
      (inv) => inv.tradeDeal?.farmLocation?.toLowerCase() ?? 'unknown',
      (inv) => inv.tradeDeal?.farmLocation ?? 'Unknown',
      totalPortfolioUsd,
      thresholds.region,
    );

    const byDeal = this.rollUp(
      investments,
      (inv) => inv.tradeDealId,
      (inv) => inv.tradeDeal?.title ?? inv.tradeDealId,
      totalPortfolioUsd,
      thresholds.deal,
    );

    const alerts = this.buildAlerts(byCommodity, byRegion, byDeal, thresholds);

    return { totalPortfolioUsd, byCommodity, byRegion, byDeal, alerts };
  }

  private rollUp(
    investments: Investment[],
    keyFn: (inv: Investment) => string,
    labelFn: (inv: Investment) => string,
    total: number,
    threshold: number,
  ): ConcentrationBreakdown[] {
    const buckets = new Map<string, { label: string; amountUsd: number }>();

    for (const inv of investments) {
      const key = keyFn(inv);
      const existing = buckets.get(key);
      if (existing) {
        existing.amountUsd += Number(inv.amountUsd);
      } else {
        buckets.set(key, { label: labelFn(inv), amountUsd: Number(inv.amountUsd) });
      }
    }

    return Array.from(buckets.entries())
      .map(([dimension, { label, amountUsd }]) => {
        const weight = amountUsd / total;
        return { dimension, label, amountUsd, weight, breached: weight > threshold };
      })
      .sort((a, b) => b.weight - a.weight);
  }

  private buildAlerts(
    byCommodity: ConcentrationBreakdown[],
    byRegion: ConcentrationBreakdown[],
    byDeal: ConcentrationBreakdown[],
    thresholds: ConcentrationThresholds,
  ): ConcentrationAlert[] {
    const alerts: ConcentrationAlert[] = [];

    for (const b of byCommodity) {
      if (b.breached) {
        alerts.push({
          type: 'commodity',
          label: b.label,
          weight: b.weight,
          threshold: thresholds.commodity,
          message: `Commodity "${b.label}" is ${(b.weight * 100).toFixed(1)}% of your portfolio (limit ${(thresholds.commodity * 100).toFixed(0)}%)`,
        });
      }
    }

    for (const b of byRegion) {
      if (b.breached) {
        alerts.push({
          type: 'region',
          label: b.label,
          weight: b.weight,
          threshold: thresholds.region,
          message: `Region "${b.label}" is ${(b.weight * 100).toFixed(1)}% of your portfolio (limit ${(thresholds.region * 100).toFixed(0)}%)`,
        });
      }
    }

    for (const b of byDeal) {
      if (b.breached) {
        alerts.push({
          type: 'deal',
          label: b.label,
          weight: b.weight,
          threshold: thresholds.deal,
          message: `Deal "${b.label}" is ${(b.weight * 100).toFixed(1)}% of your portfolio (limit ${(thresholds.deal * 100).toFixed(0)}%)`,
        });
      }
    }

    return alerts;
  }
}
