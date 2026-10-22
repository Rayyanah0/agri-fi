/**
 * CounterpartyRiskService (#1227)
 *
 * Evaluates the creditworthiness and reliability of trade partners (farmers,
 * traders, logistics providers) using a multi-factor scoring model. Produces a
 * CounterpartyRiskScore with explainable factor breakdown, exposure limits, and
 * diversification recommendations.
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';

export type RiskTier = 'minimal' | 'low' | 'medium' | 'high' | 'critical';

export interface CounterpartyFactor {
  name: string;
  score: number;       // 0–100 (higher = riskier)
  weight: number;      // contribution weight (sum to 1)
  detail: string;
}

export interface CounterpartyRiskScore {
  counterpartyId: string;
  compositeScore: number;   // 0–100
  tier: RiskTier;
  factors: CounterpartyFactor[];
  exposureLimitUsd: number;
  recommendsDiversification: boolean;
  assessedAt: Date;
}

export interface CounterpartyPortfolioEntry {
  counterpartyId: string;
  totalExposureUsd: number;
  shareOfPortfolio: number;
  score: CounterpartyRiskScore;
  breachesLimit: boolean;
}

export interface CounterpartyPortfolioView {
  totalPortfolioUsd: number;
  entries: CounterpartyPortfolioEntry[];
  diversificationScore: number;   // 0–100 (higher = better diversified)
  overdueAlerts: string[];
}

// ── Score tier boundaries ─────────────────────────────────────────────────────

const TIER_BOUNDARIES: Array<{ max: number; tier: RiskTier }> = [
  { max: 20,  tier: 'minimal'  },
  { max: 40,  tier: 'low'      },
  { max: 60,  tier: 'medium'   },
  { max: 80,  tier: 'high'     },
  { max: 100, tier: 'critical' },
];

// Exposure limit per tier as a fraction of total portfolio
const EXPOSURE_LIMIT_BY_TIER: Record<RiskTier, number> = {
  minimal:  0.30,
  low:      0.25,
  medium:   0.20,
  high:     0.10,
  critical: 0.05,
};

function tierFromScore(score: number): RiskTier {
  for (const { max, tier } of TIER_BOUNDARIES) {
    if (score <= max) return tier;
  }
  return 'critical';
}

@Injectable()
export class CounterpartyRiskService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly logger: PinoLogger,
  ) {
    (this.logger as any).setContext(CounterpartyRiskService.name);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Scores a single counterparty.  Loads their deal history from the DB and
   * runs the multi-factor model.
   */
  async scoreCounterparty(counterpartyId: string): Promise<CounterpartyRiskScore> {
    const user = await this.userRepo.findOne({ where: { id: counterpartyId } as any });
    if (!user) throw new Error(`Counterparty ${counterpartyId} not found`);

    const investments = await this.investmentRepo.find({
      where: { investorId: counterpartyId } as any,
      relations: ['tradeDeal'],
    });

    return this.computeScore(counterpartyId, investments);
  }

  /**
   * Pure computation path — useful in tests without a DB.
   * Accepts a pre-loaded list of investments for the counterparty.
   */
  computeScore(
    counterpartyId: string,
    investments: Investment[],
    totalPortfolioUsd = 0,
  ): CounterpartyRiskScore {
    const factors: CounterpartyFactor[] = [];

    // ── Factor 1: deal volume diversity (spread across deals) ─────────────────
    const dealCount = investments.length;
    const volumeDiversityScore = dealCount === 0 ? 80
      : dealCount === 1 ? 60
      : dealCount <= 3 ? 40
      : dealCount <= 7 ? 20
      : 10;
    factors.push({
      name: 'deal_volume_diversity',
      score: volumeDiversityScore,
      weight: 0.25,
      detail: `${dealCount} deal(s) on record`,
    });

    // ── Factor 2: concentration in a single commodity ─────────────────────────
    const commodityCounts: Record<string, number> = {};
    for (const inv of investments) {
      const c = (inv as any).tradeDeal?.commodity ?? 'unknown';
      commodityCounts[c] = (commodityCounts[c] ?? 0) + 1;
    }
    const maxShare = dealCount === 0 ? 1
      : Math.max(...Object.values(commodityCounts)) / dealCount;
    const commodityConcentrationScore = Math.round(maxShare * 100);
    factors.push({
      name: 'commodity_concentration',
      score: commodityConcentrationScore,
      weight: 0.20,
      detail: `Max commodity share: ${(maxShare * 100).toFixed(0)}%`,
    });

    // ── Factor 3: total exposure relative to portfolio ─────────────────────────
    const totalExposure = investments.reduce(
      (sum, inv) => sum + Number(inv.amountUsd ?? 0), 0,
    );
    const exposureShare = totalPortfolioUsd > 0 ? totalExposure / totalPortfolioUsd : 0;
    const exposureScore = Math.min(100, Math.round(exposureShare * 200));
    factors.push({
      name: 'portfolio_exposure',
      score: exposureScore,
      weight: 0.25,
      detail: `$${totalExposure.toLocaleString()} exposure (${(exposureShare * 100).toFixed(1)}% of portfolio)`,
    });

    // ── Factor 4: active (non-completed) deals ratio ───────────────────────────
    const activeCount = investments.filter(
      (inv) => !['completed', 'cancelled', 'refunded'].includes((inv as any).status ?? ''),
    ).length;
    const activeRatio = dealCount === 0 ? 0 : activeCount / dealCount;
    const activeDealsScore = Math.round(activeRatio * 60);
    factors.push({
      name: 'active_deals_ratio',
      score: activeDealsScore,
      weight: 0.15,
      detail: `${activeCount} active deal(s) of ${dealCount} total`,
    });

    // ── Factor 5: geographic concentration ────────────────────────────────────
    const regionCounts: Record<string, number> = {};
    for (const inv of investments) {
      const r = (inv as any).tradeDeal?.farmLocation ?? 'unknown';
      regionCounts[r] = (regionCounts[r] ?? 0) + 1;
    }
    const maxRegionShare = dealCount === 0 ? 1
      : Math.max(...Object.values(regionCounts)) / dealCount;
    const geoConcentrationScore = Math.round(maxRegionShare * 80);
    factors.push({
      name: 'geographic_concentration',
      score: geoConcentrationScore,
      weight: 0.15,
      detail: `Max region share: ${(maxRegionShare * 100).toFixed(0)}%`,
    });

    // ── Composite score (weighted average) ────────────────────────────────────
    const compositeScore = Math.round(
      factors.reduce((sum, f) => sum + f.score * f.weight, 0),
    );
    const tier = tierFromScore(compositeScore);
    const exposureLimitUsd = totalPortfolioUsd * EXPOSURE_LIMIT_BY_TIER[tier];

    return {
      counterpartyId,
      compositeScore,
      tier,
      factors,
      exposureLimitUsd,
      recommendsDiversification: compositeScore > 50 || maxShare > 0.5,
      assessedAt: new Date(),
    };
  }

  /**
   * Builds a portfolio-level view: all counterparties the investor is exposed
   * to, their individual scores, and diversification metrics.
   */
  async getPortfolioView(investorId: string): Promise<CounterpartyPortfolioView> {
    const investments = await this.investmentRepo.find({
      where: { investorId } as any,
      relations: ['tradeDeal'],
    });

    const totalPortfolioUsd = investments.reduce(
      (sum, inv) => sum + Number(inv.amountUsd ?? 0), 0,
    );

    // Group by the "counterparty" represented by each deal's farmer/operator.
    // In this model the tradeDeal id proxies the counterparty for grouping.
    const byDeal: Record<string, Investment[]> = {};
    for (const inv of investments) {
      const key = (inv as any).tradeDealId ?? 'unknown';
      (byDeal[key] ??= []).push(inv);
    }

    const entries: CounterpartyPortfolioEntry[] = [];
    const alerts: string[] = [];

    for (const [dealId, invs] of Object.entries(byDeal)) {
      const score = this.computeScore(dealId, invs, totalPortfolioUsd);
      const totalExposureUsd = invs.reduce(
        (sum, inv) => sum + Number(inv.amountUsd ?? 0), 0,
      );
      const shareOfPortfolio = totalPortfolioUsd > 0
        ? totalExposureUsd / totalPortfolioUsd
        : 0;
      const breachesLimit = totalExposureUsd > score.exposureLimitUsd;

      if (breachesLimit) {
        alerts.push(
          `Counterparty ${dealId}: exposure $${totalExposureUsd.toLocaleString()} exceeds limit $${score.exposureLimitUsd.toLocaleString()} (tier: ${score.tier})`,
        );
      }

      entries.push({ counterpartyId: dealId, totalExposureUsd, shareOfPortfolio, score, breachesLimit });
    }

    // Diversification score: 100 when perfectly even spread, 0 when fully concentrated.
    const n = entries.length;
    const herfindahl = n === 0 ? 1
      : entries.reduce((sum, e) => sum + e.shareOfPortfolio ** 2, 0);
    const diversificationScore = n <= 1 ? 0
      : Math.round((1 - herfindahl) / (1 - 1 / n) * 100);

    return { totalPortfolioUsd, entries, diversificationScore, overdueAlerts: alerts };
  }
}
