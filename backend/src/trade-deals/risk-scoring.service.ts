import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from './entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';

export interface DimensionScore {
  score: number;
  weight: number;
  rating: 'Low' | 'Medium' | 'High' | 'Very High';
  factors: Record<string, number>;
}

export interface RiskBreakdown {
  // Legacy fields preserved for backward compatibility
  farmerRepayment: number;
  commodityVolatility: number;
  weatherRisk: number;
  dealDuration: number;
  collateralCoverage: number;

  // Comprehensive multi-dimensional risk pillars
  creditRisk: DimensionScore;
  marketRisk: DimensionScore;
  operationalRisk: DimensionScore;
  geopoliticalRisk: DimensionScore;
}

export interface RiskScoreResult {
  score: number;
  rating: 'Low' | 'Medium' | 'High' | 'Very High';
  breakdown: RiskBreakdown;
}

export interface RiskScoreAuditEntry {
  id: string;
  dealId: string;
  calculatedAt: string;
  score: number;
  rating: 'Low' | 'Medium' | 'High' | 'Very High';
  breakdown: RiskBreakdown;
  triggeredBy: string;
  modelVersion: string;
  inputs: Record<string, any>;
}

export interface RiskVisualizationData {
  dealId: string;
  score: number;
  rating: 'Low' | 'Medium' | 'High' | 'Very High';
  radar: Array<{
    dimension: string;
    score: number;
    benchmark: number;
    weight: number;
  }>;
  keyDrivers: Array<{ factor: string; impact: string; score: number }>;
  mitigatingFactors: string[];
  recommendations: string[];
}

export interface DealRecommendation {
  dealId: string;
  title: string;
  commodity: string;
  riskScore: number;
  riskRating: 'Low' | 'Medium' | 'High' | 'Very High';
  expectedRoi: number;
  sharpeRatio: number;
  recommendationReason: string;
}

// Pillar weights for aggregate score (must sum to 1.0)
const PILLAR_WEIGHTS = {
  credit: 0.3,
  market: 0.25,
  operational: 0.25,
  geopolitical: 0.2,
};

// Commodity volatility baseline (0-100 scale, higher = more volatile)
export const COMMODITY_VOLATILITY: Record<string, number> = {
  cocoa: 45,
  coffee: 50,
  maize: 35,
  corn: 35,
  wheat: 40,
  rice: 30,
  soybeans: 42,
  cotton: 38,
  sugar: 55,
  palm_oil: 48,
  tea: 33,
  sorghum: 36,
  millet: 34,
  cashew: 44,
  sesame: 42,
  ginger: 46,
};

// Country weather/climate risk baseline (0-100 scale)
const COUNTRY_WEATHER_RISK: Record<string, number> = {
  GH: 40,
  KE: 50,
  NG: 55,
  TZ: 45,
  UG: 42,
  ET: 60,
  CI: 38,
  SN: 35,
  ML: 55,
  BF: 52,
  ZM: 38,
  MW: 36,
  MZ: 48,
  IN: 58,
  BR: 42,
  VN: 45,
  ID: 50,
  TH: 40,
  MX: 44,
  CO: 46,
  ZA: 36,
  EG: 32,
  RW: 34,
};

// Country political stability risk baseline (0-100 scale, higher = higher risk)
const COUNTRY_POLITICAL_RISK: Record<string, number> = {
  GH: 32,
  KE: 44,
  NG: 58,
  TZ: 36,
  UG: 45,
  ET: 62,
  CI: 42,
  SN: 30,
  ML: 68,
  BF: 65,
  ZM: 34,
  MW: 32,
  MZ: 52,
  IN: 40,
  BR: 38,
  VN: 28,
  ID: 35,
  TH: 42,
  MX: 48,
  CO: 44,
  ZA: 46,
  EG: 50,
  RW: 26,
};

// Country regulatory & trade barrier risk baseline (0-100 scale)
const COUNTRY_REGULATORY_RISK: Record<string, number> = {
  GH: 35,
  KE: 40,
  NG: 54,
  TZ: 42,
  UG: 44,
  ET: 56,
  CI: 40,
  SN: 34,
  ML: 62,
  BF: 60,
  ZM: 36,
  MW: 35,
  MZ: 50,
  IN: 45,
  BR: 44,
  VN: 38,
  ID: 40,
  TH: 36,
  MX: 40,
  CO: 42,
  ZA: 38,
  EG: 48,
  RW: 28,
};

@Injectable()
export class RiskScoringService {
  private readonly auditTrail: RiskScoreAuditEntry[] = [];
  private readonly MODEL_VERSION = 'v2.1.0-multidimensional';

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RiskScoringService.name);
  }

  async computeScore(dealId: string): Promise<RiskScoreResult> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['farmer', 'trader'],
    });
    if (!deal) {
      throw new Error(`Trade deal ${dealId} not found`);
    }

    // 1. Credit Risk Scoring
    const farmerRepayment = await this.scoreFarmerRepayment(deal.farmerId);
    const traderCreditworthiness = await this.scoreTraderCreditworthiness(
      deal.traderId,
    );
    const historicalDefaultScore = await this.scoreHistoricalDefaults(
      deal.farmerId,
    );
    const creditScore = Math.round(
      farmerRepayment * 0.45 +
        traderCreditworthiness * 0.35 +
        historicalDefaultScore * 0.2,
    );

    const creditRisk: DimensionScore = {
      score: creditScore,
      weight: PILLAR_WEIGHTS.credit,
      rating: this.scoreToRating(creditScore),
      factors: {
        farmerRepayment,
        traderCreditworthiness,
        historicalDefaultScore,
      },
    };

    // 2. Market Risk Scoring
    const commodityVolatility = this.scoreCommodityVolatility(deal.commodity);
    const demandRisk = this.scoreDemandRisk(deal.commodity);
    const liquidityRisk = this.scoreLiquidityRisk(deal);
    const marketScore = Math.round(
      commodityVolatility * 0.5 + demandRisk * 0.25 + liquidityRisk * 0.25,
    );

    const marketRisk: DimensionScore = {
      score: marketScore,
      weight: PILLAR_WEIGHTS.market,
      rating: this.scoreToRating(marketScore),
      factors: {
        commodityVolatility,
        demandRisk,
        liquidityRisk,
      },
    };

    // 3. Operational Risk Scoring
    const dealDuration = this.scoreDealDuration(
      deal.deliveryDate,
      deal.createdAt,
    );
    const collateralCoverage = this.scoreCollateralCoverage(deal);
    const logisticsRisk = this.scoreLogisticsRisk(deal.farmer?.country);
    const operationalScore = Math.round(
      dealDuration * 0.35 + collateralCoverage * 0.4 + logisticsRisk * 0.25,
    );

    const operationalRisk: DimensionScore = {
      score: operationalScore,
      weight: PILLAR_WEIGHTS.operational,
      rating: this.scoreToRating(operationalScore),
      factors: {
        dealDuration,
        collateralCoverage,
        logisticsRisk,
      },
    };

    // 4. Geopolitical Risk Scoring
    const country = deal.farmer?.country;
    const weatherRisk = this.scoreWeatherRisk(country);
    const politicalStabilityRisk = this.scorePoliticalRisk(country);
    const regulatoryRisk = this.scoreRegulatoryRisk(country);
    const geopoliticalScore = Math.round(
      weatherRisk * 0.35 + politicalStabilityRisk * 0.4 + regulatoryRisk * 0.25,
    );

    const geopoliticalRisk: DimensionScore = {
      score: geopoliticalScore,
      weight: PILLAR_WEIGHTS.geopolitical,
      rating: this.scoreToRating(geopoliticalScore),
      factors: {
        weatherRisk,
        politicalStabilityRisk,
        regulatoryRisk,
      },
    };

    // Multi-dimensional breakdown
    const breakdown: RiskBreakdown = {
      farmerRepayment,
      commodityVolatility,
      weatherRisk,
      dealDuration,
      collateralCoverage,
      creditRisk,
      marketRisk,
      operationalRisk,
      geopoliticalRisk,
    };

    // Aggregate score calculation
    const aggregateScore =
      creditScore * PILLAR_WEIGHTS.credit +
      marketScore * PILLAR_WEIGHTS.market +
      operationalScore * PILLAR_WEIGHTS.operational +
      geopoliticalScore * PILLAR_WEIGHTS.geopolitical;

    const roundedScore = Math.round(aggregateScore * 100) / 100;
    const rating = this.scoreToRating(roundedScore);

    this.logger.info(
      { dealId, score: roundedScore, rating },
      'Comprehensive risk score computed',
    );

    return { score: roundedScore, rating, breakdown };
  }

  async computeAndPersist(
    dealId: string,
    triggeredBy = 'system',
  ): Promise<RiskScoreResult> {
    const result = await this.computeScore(dealId);
    await this.tradeDealRepo.update(dealId, {
      riskScore: result.score,
      riskRating: result.rating,
      riskBreakdown: result.breakdown as any,
    });

    // Record in audit trail
    this.recordAuditEntry({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      dealId,
      calculatedAt: new Date().toISOString(),
      score: result.score,
      rating: result.rating,
      breakdown: result.breakdown,
      triggeredBy,
      modelVersion: this.MODEL_VERSION,
      inputs: {
        weights: PILLAR_WEIGHTS,
      },
    });

    return result;
  }

  async recalculateAll(): Promise<void> {
    const deals = await this.tradeDealRepo.find({
      where: [{ status: 'open' }, { status: 'funded' }],
    });

    this.logger.info(
      `Recalculating risk scores for ${deals.length} active deals`,
    );

    for (const deal of deals) {
      try {
        await this.computeAndPersist(deal.id, 'cron-recalculate');
      } catch (err: any) {
        this.logger.error(
          { dealId: deal.id, error: err.message },
          'Failed to recalculate risk score',
        );
      }
    }
  }

  /**
   * Risk score visualization data for radar charts and investor summaries.
   */
  async getRiskVisualization(dealId: string): Promise<RiskVisualizationData> {
    const result = await this.computeScore(dealId);
    const { breakdown, score, rating } = result;

    const radar = [
      {
        dimension: 'Credit Risk',
        score: breakdown.creditRisk.score,
        benchmark: 45,
        weight: PILLAR_WEIGHTS.credit,
      },
      {
        dimension: 'Market Risk',
        score: breakdown.marketRisk.score,
        benchmark: 42,
        weight: PILLAR_WEIGHTS.market,
      },
      {
        dimension: 'Operational Risk',
        score: breakdown.operationalRisk.score,
        benchmark: 40,
        weight: PILLAR_WEIGHTS.operational,
      },
      {
        dimension: 'Geopolitical Risk',
        score: breakdown.geopoliticalRisk.score,
        benchmark: 48,
        weight: PILLAR_WEIGHTS.geopolitical,
      },
    ];

    const keyDrivers: Array<{ factor: string; impact: string; score: number }> =
      [];
    if (breakdown.commodityVolatility > 45) {
      keyDrivers.push({
        factor: 'Commodity Volatility',
        impact: 'High price fluctuations in target crop',
        score: breakdown.commodityVolatility,
      });
    }
    if (breakdown.farmerRepayment > 50) {
      keyDrivers.push({
        factor: 'Farmer Repayment Record',
        impact: 'Elevated historical default or refund rate',
        score: breakdown.farmerRepayment,
      });
    }
    if (breakdown.collateralCoverage > 60) {
      keyDrivers.push({
        factor: 'Collateral & Escrow Coverage',
        impact: 'Under-collateralized or early-stage funding pace',
        score: breakdown.collateralCoverage,
      });
    }
    if (breakdown.weatherRisk > 50) {
      keyDrivers.push({
        factor: 'Weather & Climate Vulnerability',
        impact: 'High rainfall deficit or flood hazard in origin country',
        score: breakdown.weatherRisk,
      });
    }

    const mitigatingFactors: string[] = [];
    if (breakdown.creditRisk.score < 30) {
      mitigatingFactors.push(
        'Strong credit track record with 0 default history',
      );
    }
    if (breakdown.collateralCoverage < 35) {
      mitigatingFactors.push(
        'Over 70% funded with multi-sig escrow protection',
      );
    }
    if (breakdown.dealDuration < 40) {
      mitigatingFactors.push(
        'Short turnaround duration minimizes term exposure',
      );
    }

    const recommendations: string[] = [];
    if (score <= 35) {
      recommendations.push(
        'Suitable for conservative and institutional portfolios.',
      );
    } else if (score <= 60) {
      recommendations.push(
        'Balanced risk profile with attractive yield-to-risk ratio.',
      );
    } else {
      recommendations.push(
        'Higher risk deal; allocate with position limits and require crop insurance.',
      );
    }

    return {
      dealId,
      score,
      rating,
      radar,
      keyDrivers,
      mitigatingFactors,
      recommendations,
    };
  }

  /**
   * Historical tracking for a deal's risk scores.
   */
  getDealRiskHistory(dealId: string): RiskScoreAuditEntry[] {
    return this.auditTrail
      .filter((entry) => entry.dealId === dealId)
      .sort(
        (a, b) =>
          new Date(b.calculatedAt).getTime() -
          new Date(a.calculatedAt).getTime(),
      );
  }

  /**
   * Audit trail of all risk scoring calculations across the system.
   */
  getAuditTrail(dealId?: string, limit = 50): RiskScoreAuditEntry[] {
    let entries = this.auditTrail;
    if (dealId) {
      entries = entries.filter((e) => e.dealId === dealId);
    }
    return entries
      .slice(-limit)
      .sort(
        (a, b) =>
          new Date(b.calculatedAt).getTime() -
          new Date(a.calculatedAt).getTime(),
      );
  }

  /**
   * Risk-based deal recommendations for investors.
   */
  async getRiskBasedRecommendations(
    riskTolerance: 'low' | 'medium' | 'high' | 'very_high' = 'medium',
    limit = 10,
  ): Promise<DealRecommendation[]> {
    const deals = await this.tradeDealRepo.find({
      where: [{ status: 'open' }, { status: 'funded' }],
      take: 50,
    });

    const recommendations: DealRecommendation[] = [];

    for (const deal of deals) {
      let riskScore = Number(deal.riskScore);
      let riskRating = deal.riskRating as any;

      if (!riskScore) {
        try {
          const res = await this.computeAndPersist(deal.id);
          riskScore = res.score;
          riskRating = res.rating;
        } catch {
          continue;
        }
      }

      // Filter by risk tolerance
      const matchesTolerance =
        riskTolerance === 'very_high'
          ? true
          : riskTolerance === 'high'
            ? riskScore <= 75
            : riskTolerance === 'medium'
              ? riskScore <= 50
              : riskScore <= 28;

      if (!matchesTolerance) continue;

      const roi = Number(deal.expectedRoi || 15);
      const sharpeRatio = Math.round((roi / (riskScore + 5)) * 100) / 100;

      let reason = 'Balanced return with well-managed counterparty exposure';
      if (riskRating === 'Low') {
        reason =
          'High safety margin with strong collateral and established farmer';
      } else if (sharpeRatio > 0.5) {
        reason = 'Exceptional risk-adjusted yield for this commodity cycle';
      }

      recommendations.push({
        dealId: deal.id,
        title: deal.title || `${deal.commodity} Trade Deal`,
        commodity: deal.commodity,
        riskScore,
        riskRating,
        expectedRoi: roi,
        sharpeRatio,
        recommendationReason: reason,
      });
    }

    return recommendations
      .sort((a, b) => b.sharpeRatio - a.sharpeRatio)
      .slice(0, limit);
  }

  private recordAuditEntry(entry: RiskScoreAuditEntry): void {
    this.auditTrail.push(entry);
    // Keep in-memory buffer reasonable
    if (this.auditTrail.length > 2000) {
      this.auditTrail.shift();
    }
  }

  /**
   * Farmer historical repayment score (0-100, higher = riskier).
   */
  private async scoreFarmerRepayment(farmerId: string): Promise<number> {
    const investments = await this.investmentRepo.find({
      where: { tradeDeal: { farmerId } },
    });

    if (investments.length === 0) return 50; // No history = medium risk

    const failedCount = investments.filter(
      (inv) =>
        inv.status === InvestmentStatus.FAILED ||
        inv.status === InvestmentStatus.REFUNDED,
    ).length;

    const failureRate = failedCount / investments.length;
    return Math.min(100, Math.round(failureRate * 100 * 1.5));
  }

  /**
   * Trader creditworthiness score (0-100, higher = riskier).
   */
  private async scoreTraderCreditworthiness(
    traderId?: string,
  ): Promise<number> {
    if (!traderId) return 48;
    const trader = await this.userRepo.findOne({ where: { id: traderId } });
    if (!trader) return 50;

    let score = 40;
    if (trader.kycStatus === 'verified') score -= 15;
    if (trader.isCompany) score -= 10;
    return Math.max(10, Math.min(90, score));
  }

  /**
   * Historical default rate for counterparty deals.
   */
  private async scoreHistoricalDefaults(farmerId: string): Promise<number> {
    const pastDeals = await this.tradeDealRepo.find({
      where: { farmerId },
    });

    if (pastDeals.length <= 1) return 40;

    const failedDeals = pastDeals.filter(
      (d) => d.status === 'failed' || d.status === 'canceled',
    ).length;

    return Math.min(100, Math.round((failedDeals / pastDeals.length) * 100));
  }

  /**
   * Commodity price volatility score (0-100, higher = riskier).
   */
  private scoreCommodityVolatility(commodity: string): number {
    const key = (commodity || '').toLowerCase().replace(/\s+/g, '_');
    return COMMODITY_VOLATILITY[key] ?? 50;
  }

  /**
   * Commodity market demand cycle risk.
   */
  private scoreDemandRisk(commodity: string): number {
    const key = (commodity || '').toLowerCase();
    if (key.includes('coffee') || key.includes('cocoa')) return 35;
    if (key.includes('corn') || key.includes('wheat') || key.includes('rice'))
      return 25;
    if (key.includes('sugar') || key.includes('palm')) return 50;
    return 40;
  }

  /**
   * Market liquidity risk based on deal funding pace.
   */
  private scoreLiquidityRisk(deal: TradeDeal): number {
    const total = Number(deal.totalValue) || 1;
    const invested = Number(deal.totalInvested) || 0;
    const ratio = invested / total;
    if (ratio >= 0.8) return 15;
    if (ratio >= 0.5) return 35;
    if (ratio >= 0.2) return 55;
    return 75;
  }

  /**
   * Country logistics infrastructure risk.
   */
  private scoreLogisticsRisk(country?: string): number {
    if (!country) return 48;
    const code = country.toUpperCase();
    const logisticsMap: Record<string, number> = {
      KE: 38,
      GH: 40,
      NG: 52,
      CI: 42,
      SN: 36,
      ZA: 30,
      VN: 34,
      IN: 46,
      BR: 40,
    };
    return logisticsMap[code] ?? 45;
  }

  /**
   * Geographic weather risk score (0-100, higher = riskier).
   */
  private scoreWeatherRisk(country?: string): number {
    if (!country) return 50;
    return COUNTRY_WEATHER_RISK[country.toUpperCase()] ?? 50;
  }

  /**
   * Country political risk score.
   */
  private scorePoliticalRisk(country?: string): number {
    if (!country) return 45;
    return COUNTRY_POLITICAL_RISK[country.toUpperCase()] ?? 45;
  }

  /**
   * Country regulatory & trade policy risk.
   */
  private scoreRegulatoryRisk(country?: string): number {
    if (!country) return 40;
    return COUNTRY_REGULATORY_RISK[country.toUpperCase()] ?? 40;
  }

  /**
   * Deal duration risk (0-100, higher = riskier).
   */
  private scoreDealDuration(deliveryDate: Date, createdAt: Date): number {
    const delivery = new Date(deliveryDate);
    const created = new Date(createdAt);

    const totalDays = Math.max(
      1,
      Math.ceil(
        (delivery.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    if (totalDays <= 30) return 15;
    if (totalDays <= 90) return 35;
    if (totalDays <= 180) return 60;
    return 85;
  }

  /**
   * Collateral coverage score (0-100, higher = riskier).
   */
  private scoreCollateralCoverage(deal: TradeDeal): number {
    const totalValue = Number(deal.totalValue);
    const totalInvested = Number(deal.totalInvested);

    if (totalValue <= 0) return 80;

    const fundingRatio = totalInvested / totalValue;

    if (fundingRatio >= 0.9) return 10;
    if (fundingRatio >= 0.7) return 25;
    if (fundingRatio >= 0.5) return 45;
    if (fundingRatio >= 0.25) return 65;
    return 85;
  }

  getCommodityVolatilityBaseline(commodity: string): number {
    return this.scoreCommodityVolatility(commodity);
  }

  getCommodityVolatilityMap(): Record<string, number> {
    return { ...COMMODITY_VOLATILITY };
  }

  getRating(score: number): 'Low' | 'Medium' | 'High' | 'Very High' {
    return this.scoreToRating(score);
  }

  private scoreToRating(
    score: number,
  ): 'Low' | 'Medium' | 'High' | 'Very High' {
    if (score <= 25) return 'Low';
    if (score <= 50) return 'Medium';
    if (score <= 75) return 'High';
    return 'Very High';
  }
}
