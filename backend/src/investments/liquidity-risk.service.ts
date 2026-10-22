import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { LiquiditySnapshot } from './entities/liquidity-snapshot.entity';

export type LiquidityTier =
  'Highly Liquid' | 'Moderately Liquid' | 'Low Liquidity' | 'Illiquid';

export interface InvestmentLiquidityProfile {
  investmentId: string;
  dealId: string;
  dealTitle: string;
  commodity: string;
  amountUsd: number;
  daysToMaturity: number;
  liquidityScore: number; // 0 - 100
  liquidityTier: LiquidityTier;
  estimatedDaysToLiquidate: number;
  secondaryMarketHaircutPct: number;
  scoringBreakdown: {
    maturityFactor: number;
    secondaryMarketFactor: number;
    statusFactor: number;
    escrowCollateralFactor: number;
  };
}

export interface PortfolioLiquiditySummary {
  investorId: string;
  totalPortfolioUsd: number;
  portfolioLiquidityScore: number; // 0 - 100
  portfolioLiquidityTier: LiquidityTier;
  weightedDaysToCash: number;
  liquidityCoverageRatioPct: number; // LCR proxy: buffer / estimated 30d obligations
  cashConversionProfile: {
    within7DaysUsd: number;
    within7DaysPct: number;
    within30DaysUsd: number;
    within30DaysPct: number;
    within90DaysUsd: number;
    within90DaysPct: number;
    beyond90DaysUsd: number;
    beyond90DaysPct: number;
  };
  tierBreakdown: Record<
    LiquidityTier,
    { amountUsd: number; percentage: number; count: number }
  >;
  investments: InvestmentLiquidityProfile[];
}

export type StressScenarioType =
  | 'SECONDARY_FREEZE'
  | 'HARVEST_DELAY_45D'
  | 'REDEMPTION_SURGE_35PCT'
  | 'COMBINED_CRISIS';

export interface LiquidityStressTestResult {
  investorId: string;
  scenario: StressScenarioType;
  scenarioDescription: string;
  baseline: {
    portfolioLiquidityScore: number;
    liquidityCoverageRatioPct: number;
    convertible30dUsd: number;
  };
  stressed: {
    portfolioLiquidityScore: number;
    liquidityCoverageRatioPct: number;
    convertible30dUsd: number;
    scoreDropPoints: number;
    estimatedLiquidityShortfallUsd: number;
  };
  resilienceRating: 'Robust' | 'Moderate' | 'Vulnerable' | 'Critical';
}

export interface LiquidityAlert {
  type:
    | 'LOW_PORTFOLIO_LIQUIDITY'
    | 'BUFFER_WARNING'
    | 'LCR_BREACH'
    | 'CONCENTRATION_RISK';
  severity: 'low' | 'medium' | 'high' | 'critical';
  threshold: number;
  actualValue: number;
  message: string;
}

export interface LiquidityThresholds {
  minPortfolioScore: number; // default 40
  min30dBufferPct: number; // default 15%
  minLcrPct: number; // default 100%
}

export interface LiquidityOptimizationSuggestion {
  category:
    | 'REBALANCING'
    | 'SECONDARY_LISTING'
    | 'RESERVE_BUFFER'
    | 'MATURITY_STAGGERING';
  title: string;
  recommendation: string;
  potentialLiquidityScoreUplift: number;
  projectedNewScore: number;
  implementationEase: 'Easy' | 'Moderate' | 'Complex';
  impactUsd?: number;
}

export interface ScenarioParameters {
  secondaryMarketHaircutPct: number; // 0 - 50%
  harvestDelayDays: number; // 0 - 90 days
  investorWithdrawalDemandPct: number; // 0 - 60%
}

export interface ScenarioAnalysisResult {
  parametersApplied: ScenarioParameters;
  simulatedPortfolioScore: number;
  scoreChange: number;
  projected30dAvailableCashUsd: number;
  liquidityDeficitOrSurplusUsd: number;
  liquidityTier: LiquidityTier;
}

export interface LiquidityPlan {
  investorId: string;
  projectedHorizonDays: number;
  generatedAt: string;
  periods: Array<{
    periodName: string;
    startDay: number;
    endDay: number;
    expectedInflowsUsd: number;
    targetExpendituresUsd: number;
    netCashPositionUsd: number;
    cumulativeSurplusDeficitUsd: number;
    participatingDeals: string[];
  }>;
  totalProjectedInflowsUsd: number;
  recommendedReserveUsd: number;
}

export interface LiquidityComplianceReport {
  reportId: string;
  investorId: string;
  generatedAt: string;
  framework: 'BASEL_III_LCR_NSFR_PROXY';
  complianceStatus: 'PASSED' | 'WARNING' | 'FAILED';
  metrics: {
    portfolioLiquidityScore: number;
    liquidityCoverageRatioPct: number;
    netStableFundingProxyPct: number;
    highQualityLiquidAssetsUsd: number;
    totalInvestedUsd: number;
  };
  stressTestSummary: {
    worstCaseScenario: string;
    stressedLcrPct: number;
    passesStressThreshold: boolean;
  };
  auditorNotes: string;
}

const DEFAULT_THRESHOLDS: LiquidityThresholds = {
  minPortfolioScore: 40,
  min30dBufferPct: 15,
  minLcrPct: 100,
};

@Injectable()
export class LiquidityRiskService {
  private readonly logger = new Logger(LiquidityRiskService.name);

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @Optional()
    @InjectRepository(LiquiditySnapshot)
    private readonly snapshotRepo?: Repository<LiquiditySnapshot>,
  ) {}

  /**
   * 1. Liquidity Calculation: Calculates quantitative liquidity score per investment
   */
  public calculateInvestmentLiquidity(
    inv: Investment,
  ): InvestmentLiquidityProfile {
    const deal = inv.tradeDeal;
    const amountUsd = Number(inv.amountUsd || 0);

    // 1. Days to maturity based on deal deliveryDate
    const now = new Date();
    let daysToMaturity = 90; // fallback
    if (deal?.deliveryDate) {
      const diffMs = new Date(deal.deliveryDate).getTime() - now.getTime();
      daysToMaturity = Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 0);
    } else if (deal?.durationDays) {
      daysToMaturity = Number(deal.durationDays);
    }

    // Maturity factor (0 - 40 pts)
    let maturityFactor = 15;
    if (daysToMaturity <= 15) maturityFactor = 40;
    else if (daysToMaturity <= 30) maturityFactor = 35;
    else if (daysToMaturity <= 60) maturityFactor = 28;
    else if (daysToMaturity <= 90) maturityFactor = 22;
    else if (daysToMaturity <= 180) maturityFactor = 15;
    else maturityFactor = 8;

    // Secondary market factor (0 - 25 pts)
    // Active tokenized deals with Stellar symbol and fractional lot sizes have secondary market potential
    let secondaryMarketFactor = 10;
    if (deal?.tokenSymbol && deal?.minLotSize != null) {
      secondaryMarketFactor = 22;
    }

    // Status factor (0 - 20 pts)
    let statusFactor = 10;
    if (
      inv.status === InvestmentStatus.RELEASING ||
      inv.status === InvestmentStatus.COMPLETED
    ) {
      statusFactor = 20;
    } else if (
      inv.status === InvestmentStatus.CONFIRMED ||
      inv.status === InvestmentStatus.ACTIVE
    ) {
      statusFactor = 15;
    }

    // Escrow & collateral backing (0 - 15 pts)
    let escrowCollateralFactor = 8;
    if (deal?.sorobanCampaignContractId || deal?.escrowPublicKey) {
      escrowCollateralFactor = 15;
    }

    const rawScore =
      maturityFactor +
      secondaryMarketFactor +
      statusFactor +
      escrowCollateralFactor;
    const liquidityScore = Math.min(Math.max(rawScore, 5), 100);

    let liquidityTier: LiquidityTier = 'Low Liquidity';
    let secondaryMarketHaircutPct = 12;
    let estimatedDaysToLiquidate = 30;

    if (liquidityScore >= 75) {
      liquidityTier = 'Highly Liquid';
      secondaryMarketHaircutPct = 3.5;
      estimatedDaysToLiquidate = Math.min(daysToMaturity, 5);
    } else if (liquidityScore >= 55) {
      liquidityTier = 'Moderately Liquid';
      secondaryMarketHaircutPct = 7.0;
      estimatedDaysToLiquidate = Math.min(daysToMaturity, 14);
    } else if (liquidityScore >= 35) {
      liquidityTier = 'Low Liquidity';
      secondaryMarketHaircutPct = 15.0;
      estimatedDaysToLiquidate = Math.min(daysToMaturity, 45);
    } else {
      liquidityTier = 'Illiquid';
      secondaryMarketHaircutPct = 25.0;
      estimatedDaysToLiquidate = Math.max(daysToMaturity, 90);
    }

    return {
      investmentId: inv.id,
      dealId: inv.tradeDealId,
      dealTitle: deal?.title || deal?.commodity || 'Trade Deal',
      commodity: deal?.commodity || 'Unknown',
      amountUsd,
      daysToMaturity,
      liquidityScore,
      liquidityTier,
      estimatedDaysToLiquidate,
      secondaryMarketHaircutPct,
      scoringBreakdown: {
        maturityFactor,
        secondaryMarketFactor,
        statusFactor,
        escrowCollateralFactor,
      },
    };
  }

  /**
   * 2. Liquidity Aggregation: Calculate portfolio-level liquidity and cash-conversion profile
   */
  async aggregatePortfolioLiquidity(
    investorId: string,
    preloadedInvestments?: Investment[],
  ): Promise<PortfolioLiquiditySummary> {
    let investments = preloadedInvestments;
    if (!investments) {
      investments = await this.investmentRepo.find({
        where: [
          { investorId, status: InvestmentStatus.ACTIVE },
          { investorId, status: InvestmentStatus.CONFIRMED },
          { investorId, status: InvestmentStatus.RELEASING },
        ],
        relations: ['tradeDeal'],
      });
    }

    const totalPortfolioUsd = investments.reduce(
      (sum, inv) => sum + Number(inv.amountUsd || 0),
      0,
    );

    if (totalPortfolioUsd === 0) {
      return {
        investorId,
        totalPortfolioUsd: 0,
        portfolioLiquidityScore: 0,
        portfolioLiquidityTier: 'Illiquid',
        weightedDaysToCash: 0,
        liquidityCoverageRatioPct: 100,
        cashConversionProfile: {
          within7DaysUsd: 0,
          within7DaysPct: 0,
          within30DaysUsd: 0,
          within30DaysPct: 0,
          within90DaysUsd: 0,
          within90DaysPct: 0,
          beyond90DaysUsd: 0,
          beyond90DaysPct: 0,
        },
        tierBreakdown: {
          'Highly Liquid': { amountUsd: 0, percentage: 0, count: 0 },
          'Moderately Liquid': { amountUsd: 0, percentage: 0, count: 0 },
          'Low Liquidity': { amountUsd: 0, percentage: 0, count: 0 },
          Illiquid: { amountUsd: 0, percentage: 0, count: 0 },
        },
        investments: [],
      };
    }

    const analyzedProfiles = investments.map((inv) =>
      this.calculateInvestmentLiquidity(inv),
    );

    let weightedScoreSum = 0;
    let weightedDaysSum = 0;

    let within7DaysUsd = 0;
    let within30DaysUsd = 0;
    let within90DaysUsd = 0;
    let beyond90DaysUsd = 0;

    const tierBreakdown: Record<
      LiquidityTier,
      { amountUsd: number; percentage: number; count: number }
    > = {
      'Highly Liquid': { amountUsd: 0, percentage: 0, count: 0 },
      'Moderately Liquid': { amountUsd: 0, percentage: 0, count: 0 },
      'Low Liquidity': { amountUsd: 0, percentage: 0, count: 0 },
      Illiquid: { amountUsd: 0, percentage: 0, count: 0 },
    };

    for (const p of analyzedProfiles) {
      weightedScoreSum += p.liquidityScore * p.amountUsd;
      weightedDaysSum += p.daysToMaturity * p.amountUsd;

      tierBreakdown[p.liquidityTier].amountUsd += p.amountUsd;
      tierBreakdown[p.liquidityTier].count += 1;

      if (p.daysToMaturity <= 7) within7DaysUsd += p.amountUsd;
      else if (p.daysToMaturity <= 30) within30DaysUsd += p.amountUsd;
      else if (p.daysToMaturity <= 90) within90DaysUsd += p.amountUsd;
      else beyond90DaysUsd += p.amountUsd;
    }

    // Cumulative 30d and 90d buffers include earlier buckets
    const cumulative30dUsd = within7DaysUsd + within30DaysUsd;
    const cumulative90dUsd = cumulative30dUsd + within90DaysUsd;

    for (const key of Object.keys(tierBreakdown) as LiquidityTier[]) {
      tierBreakdown[key].percentage =
        Math.round((tierBreakdown[key].amountUsd / totalPortfolioUsd) * 1000) /
        10;
    }

    const portfolioLiquidityScore =
      Math.round((weightedScoreSum / totalPortfolioUsd) * 10) / 10;
    const weightedDaysToCash =
      Math.round((weightedDaysSum / totalPortfolioUsd) * 10) / 10;

    let portfolioLiquidityTier: LiquidityTier = 'Low Liquidity';
    if (portfolioLiquidityScore >= 75) portfolioLiquidityTier = 'Highly Liquid';
    else if (portfolioLiquidityScore >= 55)
      portfolioLiquidityTier = 'Moderately Liquid';
    else if (portfolioLiquidityScore >= 35)
      portfolioLiquidityTier = 'Low Liquidity';
    else portfolioLiquidityTier = 'Illiquid';

    // Basel III LCR proxy: 30-day liquid buffer vs standard 20% estimated 30-day redemption requirement
    const estimated30dOutflowRequirementUsd = totalPortfolioUsd * 0.2;
    const liquidityCoverageRatioPct =
      estimated30dOutflowRequirementUsd > 0
        ? Math.round(
            (cumulative30dUsd / estimated30dOutflowRequirementUsd) * 1000,
          ) / 10
        : 100;

    return {
      investorId,
      totalPortfolioUsd: Math.round(totalPortfolioUsd * 100) / 100,
      portfolioLiquidityScore,
      portfolioLiquidityTier,
      weightedDaysToCash,
      liquidityCoverageRatioPct,
      cashConversionProfile: {
        within7DaysUsd: Math.round(within7DaysUsd * 100) / 100,
        within7DaysPct:
          Math.round((within7DaysUsd / totalPortfolioUsd) * 1000) / 10,
        within30DaysUsd: Math.round(cumulative30dUsd * 100) / 100,
        within30DaysPct:
          Math.round((cumulative30dUsd / totalPortfolioUsd) * 1000) / 10,
        within90DaysUsd: Math.round(cumulative90dUsd * 100) / 100,
        within90DaysPct:
          Math.round((cumulative90dUsd / totalPortfolioUsd) * 1000) / 10,
        beyond90DaysUsd: Math.round(beyond90DaysUsd * 100) / 100,
        beyond90DaysPct:
          Math.round((beyond90DaysUsd / totalPortfolioUsd) * 1000) / 10,
      },
      tierBreakdown,
      investments: analyzedProfiles,
    };
  }

  /**
   * 3. Liquidity Stress Testing: Stresses portfolio under market disruption scenarios
   */
  async runStressTest(
    investorId: string,
    scenario: StressScenarioType = 'COMBINED_CRISIS',
    preloadedInvestments?: Investment[],
  ): Promise<LiquidityStressTestResult> {
    const baseline = await this.aggregatePortfolioLiquidity(
      investorId,
      preloadedInvestments,
    );

    let scoreMultiplier = 1.0;
    let bufferMultiplier = 1.0;
    let scenarioDescription = '';

    switch (scenario) {
      case 'SECONDARY_FREEZE':
        scoreMultiplier = 0.72;
        bufferMultiplier = 0.65;
        scenarioDescription =
          'Secondary market order matching freezes; liquidation discounts widen by 100%.';
        break;

      case 'HARVEST_DELAY_45D':
        scoreMultiplier = 0.68;
        bufferMultiplier = 0.4;
        scenarioDescription =
          'Regional climate delay extends all harvest maturities by 45 calendar days.';
        break;

      case 'REDEMPTION_SURGE_35PCT':
        scoreMultiplier = 0.8;
        bufferMultiplier = 0.55;
        scenarioDescription =
          'Sudden liquidity demand surge with 35% unexpected withdrawal requests.';
        break;

      case 'COMBINED_CRISIS':
      default:
        scoreMultiplier = 0.52;
        bufferMultiplier = 0.3;
        scenarioDescription =
          'Compound stress: Secondary freeze combined with 45-day harvest delays and 35% withdrawal pressure.';
        break;
    }

    const stressedScore = Math.max(
      Math.round(baseline.portfolioLiquidityScore * scoreMultiplier * 10) / 10,
      5,
    );
    const stressed30dBuffer =
      Math.round(
        baseline.cashConversionProfile.within30DaysUsd * bufferMultiplier * 100,
      ) / 100;
    const stressedLcr =
      Math.round(baseline.liquidityCoverageRatioPct * bufferMultiplier * 10) /
      10;

    const targetRequirement = baseline.totalPortfolioUsd * 0.2;
    const estimatedLiquidityShortfallUsd = Math.max(
      targetRequirement - stressed30dBuffer,
      0,
    );

    let resilienceRating: LiquidityStressTestResult['resilienceRating'] =
      'Moderate';
    if (stressedLcr >= 120 && stressedScore >= 50) resilienceRating = 'Robust';
    else if (stressedLcr >= 90) resilienceRating = 'Moderate';
    else if (stressedLcr >= 60) resilienceRating = 'Vulnerable';
    else resilienceRating = 'Critical';

    return {
      investorId,
      scenario,
      scenarioDescription,
      baseline: {
        portfolioLiquidityScore: baseline.portfolioLiquidityScore,
        liquidityCoverageRatioPct: baseline.liquidityCoverageRatioPct,
        convertible30dUsd: baseline.cashConversionProfile.within30DaysUsd,
      },
      stressed: {
        portfolioLiquidityScore: stressedScore,
        liquidityCoverageRatioPct: stressedLcr,
        convertible30dUsd: stressed30dBuffer,
        scoreDropPoints:
          Math.round((baseline.portfolioLiquidityScore - stressedScore) * 10) /
          10,
        estimatedLiquidityShortfallUsd:
          Math.round(estimatedLiquidityShortfallUsd * 100) / 100,
      },
      resilienceRating,
    };
  }

  /**
   * 4. Liquidity Alerts: Detects threshold breaches
   */
  public evaluateLiquidityAlerts(
    summary: PortfolioLiquiditySummary,
    thresholds: LiquidityThresholds = DEFAULT_THRESHOLDS,
  ): LiquidityAlert[] {
    const alerts: LiquidityAlert[] = [];

    // Score breach
    if (summary.portfolioLiquidityScore < thresholds.minPortfolioScore) {
      alerts.push({
        type: 'LOW_PORTFOLIO_LIQUIDITY',
        severity: summary.portfolioLiquidityScore < 25 ? 'critical' : 'high',
        threshold: thresholds.minPortfolioScore,
        actualValue: summary.portfolioLiquidityScore,
        message: `Portfolio liquidity score of ${summary.portfolioLiquidityScore} is below policy threshold (${thresholds.minPortfolioScore}).`,
      });
    }

    // 30-day buffer warning
    if (
      summary.cashConversionProfile.within30DaysPct < thresholds.min30dBufferPct
    ) {
      alerts.push({
        type: 'BUFFER_WARNING',
        severity: 'high',
        threshold: thresholds.min30dBufferPct,
        actualValue: summary.cashConversionProfile.within30DaysPct,
        message: `30-day liquid conversion buffer is ${summary.cashConversionProfile.within30DaysPct}% (minimum requirement: ${thresholds.min30dBufferPct}%).`,
      });
    }

    // LCR breach
    if (summary.liquidityCoverageRatioPct < thresholds.minLcrPct) {
      alerts.push({
        type: 'LCR_BREACH',
        severity: 'critical',
        threshold: thresholds.minLcrPct,
        actualValue: summary.liquidityCoverageRatioPct,
        message: `Liquidity Coverage Ratio (LCR) is ${summary.liquidityCoverageRatioPct}%, breaching the 100% regulatory baseline.`,
      });
    }

    // Single illiquid deal concentration risk (> 30% of portfolio in a single illiquid position)
    for (const inv of summary.investments) {
      if (
        inv.liquidityTier === 'Illiquid' &&
        inv.amountUsd / summary.totalPortfolioUsd > 0.3
      ) {
        alerts.push({
          type: 'CONCENTRATION_RISK',
          severity: 'medium',
          threshold: 30,
          actualValue:
            Math.round((inv.amountUsd / summary.totalPortfolioUsd) * 1000) / 10,
          message: `Single illiquid deal "${inv.dealTitle}" represents ${Math.round((inv.amountUsd / summary.totalPortfolioUsd) * 100)}% of your portfolio.`,
        });
      }
    }

    return alerts;
  }

  /**
   * 5. Liquidity Optimization: Suggests actionable improvements to increase liquidity
   */
  async getLiquidityOptimizationSuggestions(
    investorId: string,
    preloadedInvestments?: Investment[],
  ): Promise<LiquidityOptimizationSuggestion[]> {
    const summary = await this.aggregatePortfolioLiquidity(
      investorId,
      preloadedInvestments,
    );
    const suggestions: LiquidityOptimizationSuggestion[] = [];
    const currentScore = summary.portfolioLiquidityScore;

    if (summary.cashConversionProfile.within30DaysPct < 25) {
      suggestions.push({
        category: 'REBALANCING',
        title: 'Allocate to Short-Cycle Grain & Vegetable Deals',
        recommendation:
          'Deploy 15% of upcoming capital allocations into short-cycle crops (≤60 day maturity) such as Maize or Soybeans.',
        potentialLiquidityScoreUplift: 14.5,
        projectedNewScore: Math.min(currentScore + 14.5, 100),
        implementationEase: 'Easy',
        impactUsd: Math.round(summary.totalPortfolioUsd * 0.15),
      });
    }

    const illiquidAmount =
      summary.tierBreakdown['Illiquid'].amountUsd +
      summary.tierBreakdown['Low Liquidity'].amountUsd;
    if (illiquidAmount > 0) {
      suggestions.push({
        category: 'SECONDARY_LISTING',
        title: 'List Tranche on Secondary Order Matching',
        recommendation:
          'Create secondary marketplace sell orders for tokenized tranches with >120 days to harvest to convert into near-term USDC.',
        potentialLiquidityScoreUplift: 8.0,
        projectedNewScore: Math.min(currentScore + 8.0, 100),
        implementationEase: 'Easy',
        impactUsd: Math.round(illiquidAmount * 0.5),
      });
    }

    if (summary.liquidityCoverageRatioPct < 120) {
      suggestions.push({
        category: 'RESERVE_BUFFER',
        title: 'Establish 10% Cash/Stablecoin Liquidity Buffer',
        recommendation:
          'Retain at least 10% of portfolio value in liquid USDC escrow deposits to guarantee instant liquidity for emergency redemption needs.',
        potentialLiquidityScoreUplift: 11.2,
        projectedNewScore: Math.min(currentScore + 11.2, 100),
        implementationEase: 'Easy',
        impactUsd: Math.round(summary.totalPortfolioUsd * 0.1),
      });
    }

    suggestions.push({
      category: 'MATURITY_STAGGERING',
      title: 'Stagger Harvest Maturity Ladders',
      recommendation:
        'Structure future deal commitments with monthly staggered delivery milestones to maintain steady cash flow distributions.',
      potentialLiquidityScoreUplift: 6.5,
      projectedNewScore: Math.min(currentScore + 6.5, 100),
      implementationEase: 'Moderate',
    });

    return suggestions.sort(
      (a, b) =>
        b.potentialLiquidityScoreUplift - a.potentialLiquidityScoreUplift,
    );
  }

  /**
   * 6. Historical Tracking: Record and fetch portfolio liquidity snapshots
   */
  async recordSnapshot(
    investorId: string,
    summary: PortfolioLiquiditySummary,
  ): Promise<LiquiditySnapshot | null> {
    if (!this.snapshotRepo) return null;

    const snapshot = this.snapshotRepo.create({
      investorId,
      totalPortfolioUsd: summary.totalPortfolioUsd,
      liquidityScore: summary.portfolioLiquidityScore,
      liquidityTier: summary.portfolioLiquidityTier,
      lcrRatioPct: summary.liquidityCoverageRatioPct,
      convertible30dUsd: summary.cashConversionProfile.within30DaysUsd,
      convertible30dPct: summary.cashConversionProfile.within30DaysPct,
      snapshotMetadata: {
        tierBreakdown: summary.tierBreakdown,
        weightedDaysToCash: summary.weightedDaysToCash,
      },
    });

    return this.snapshotRepo.save(snapshot);
  }

  async getHistoricalSnapshots(
    investorId: string,
    days: number = 90,
  ): Promise<LiquiditySnapshot[]> {
    if (!this.snapshotRepo) return [];
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.investorId = :investorId', { investorId })
      .andWhere('s.createdAt >= :since', { since })
      .orderBy('s.createdAt', 'ASC')
      .getMany();
  }

  /**
   * 7. Liquidity Reporting: Generate regulatory Basel III compliance report
   */
  async generateLiquidityReport(
    investorId: string,
  ): Promise<LiquidityComplianceReport> {
    const summary = await this.aggregatePortfolioLiquidity(investorId);
    const stress = await this.runStressTest(investorId, 'COMBINED_CRISIS');

    const passesBaseline = summary.liquidityCoverageRatioPct >= 100;
    const passesStress = stress.stressed.liquidityCoverageRatioPct >= 60;

    let complianceStatus: LiquidityComplianceReport['complianceStatus'] =
      'PASSED';
    if (!passesBaseline) complianceStatus = 'FAILED';
    else if (!passesStress) complianceStatus = 'WARNING';

    return {
      reportId: `LIQ-REP-${Date.now().toString(36).toUpperCase()}`,
      investorId,
      generatedAt: new Date().toISOString(),
      framework: 'BASEL_III_LCR_NSFR_PROXY',
      complianceStatus,
      metrics: {
        portfolioLiquidityScore: summary.portfolioLiquidityScore,
        liquidityCoverageRatioPct: summary.liquidityCoverageRatioPct,
        netStableFundingProxyPct:
          Math.round(
            (summary.cashConversionProfile.beyond90DaysPct + 50) * 10,
          ) / 10,
        highQualityLiquidAssetsUsd:
          summary.cashConversionProfile.within30DaysUsd,
        totalInvestedUsd: summary.totalPortfolioUsd,
      },
      stressTestSummary: {
        worstCaseScenario: stress.scenarioDescription,
        stressedLcrPct: stress.stressed.liquidityCoverageRatioPct,
        passesStressThreshold: passesStress,
      },
      auditorNotes:
        passesBaseline && passesStress
          ? 'Portfolio satisfies institutional liquidity risk thresholds with ample 30-day buffer.'
          : 'Liquidity warning: portfolio requires rebalancing into shorter maturities to meet severe stress scenarios.',
    };
  }

  /**
   * 8. Scenario Analysis: Interactive custom scenario simulator
   */
  async runScenarioAnalysis(
    investorId: string,
    params: ScenarioParameters,
  ): Promise<ScenarioAnalysisResult> {
    const baseline = await this.aggregatePortfolioLiquidity(investorId);

    // Apply custom parameters
    const haircutFactor = 1 - params.secondaryMarketHaircutPct / 100;
    const delayFactor =
      params.harvestDelayDays > 0
        ? Math.max(1 - params.harvestDelayDays / 120, 0.3)
        : 1.0;

    const simulatedScore = Math.max(
      Math.round(
        baseline.portfolioLiquidityScore * haircutFactor * delayFactor * 10,
      ) / 10,
      5,
    );

    const projected30dAvailableCashUsd =
      Math.round(
        baseline.cashConversionProfile.within30DaysUsd *
          haircutFactor *
          delayFactor *
          100,
      ) / 100;

    const withdrawalRequirement =
      baseline.totalPortfolioUsd * (params.investorWithdrawalDemandPct / 100);
    const liquidityDeficitOrSurplusUsd =
      Math.round((projected30dAvailableCashUsd - withdrawalRequirement) * 100) /
      100;

    let liquidityTier: LiquidityTier = 'Low Liquidity';
    if (simulatedScore >= 75) liquidityTier = 'Highly Liquid';
    else if (simulatedScore >= 55) liquidityTier = 'Moderately Liquid';
    else if (simulatedScore >= 35) liquidityTier = 'Low Liquidity';
    else liquidityTier = 'Illiquid';

    return {
      parametersApplied: params,
      simulatedPortfolioScore: simulatedScore,
      scoreChange:
        Math.round((simulatedScore - baseline.portfolioLiquidityScore) * 10) /
        10,
      projected30dAvailableCashUsd,
      liquidityDeficitOrSurplusUsd,
      liquidityTier,
    };
  }

  /**
   * 9. Liquidity Planning: Forward cash flow projections across time horizons
   */
  async generateLiquidityPlan(
    investorId: string,
    horizonDays: number = 180,
  ): Promise<LiquidityPlan> {
    const summary = await this.aggregatePortfolioLiquidity(investorId);

    const periods = [
      {
        periodName: '0 - 30 Days (Immediate)',
        startDay: 0,
        endDay: 30,
        targetExpenditurePct: 0.15,
      },
      {
        periodName: '31 - 60 Days (Short Term)',
        startDay: 31,
        endDay: 60,
        targetExpenditurePct: 0.2,
      },
      {
        periodName: '61 - 90 Days (Medium Term)',
        startDay: 61,
        endDay: 90,
        targetExpenditurePct: 0.25,
      },
      {
        periodName: '91 - 180 Days (Long Term)',
        startDay: 91,
        endDay: 180,
        targetExpenditurePct: 0.4,
      },
    ];

    let runningSurplus = 0;
    const planPeriods = periods.map((p) => {
      const dealsInPeriod = summary.investments.filter(
        (inv) =>
          inv.daysToMaturity >= p.startDay && inv.daysToMaturity <= p.endDay,
      );

      const inflows = dealsInPeriod.reduce((sum, d) => sum + d.amountUsd, 0);
      const targetExp = summary.totalPortfolioUsd * p.targetExpenditurePct;
      const netCash = inflows - targetExp;
      runningSurplus += netCash;

      return {
        periodName: p.periodName,
        startDay: p.startDay,
        endDay: p.endDay,
        expectedInflowsUsd: Math.round(inflows * 100) / 100,
        targetExpendituresUsd: Math.round(targetExp * 100) / 100,
        netCashPositionUsd: Math.round(netCash * 100) / 100,
        cumulativeSurplusDeficitUsd: Math.round(runningSurplus * 100) / 100,
        participatingDeals: dealsInPeriod.map((d) => d.dealTitle),
      };
    });

    const totalInflows = summary.investments.reduce(
      (sum, inv) => sum + inv.amountUsd,
      0,
    );

    return {
      investorId,
      projectedHorizonDays: horizonDays,
      generatedAt: new Date().toISOString(),
      periods: planPeriods,
      totalProjectedInflowsUsd: Math.round(totalInflows * 100) / 100,
      recommendedReserveUsd:
        Math.round(summary.totalPortfolioUsd * 0.1 * 100) / 100,
    };
  }
}
