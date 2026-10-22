import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { User } from '../auth/entities/user.entity';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';
import {
  calculateScoreFromFactors as calculateScore,
  creditTierForScore,
  FACTOR_WEIGHTS,
  maxDealSizeForScore,
  normalizeFactors,
  CREDIT_SCORE_MAX,
  CREDIT_SCORE_MIN,
  CreditScoreTier,
  ScoreFactorsInput,
} from './credit-score.model';

/**
 * The scoring model itself lives in `credit-score.model.ts`; these
 * re-exports keep the historical import path working.
 */
export {
  FACTOR_WEIGHTS,
  NEUTRAL_FACTOR_VALUES,
  normalizeFactors,
} from './credit-score.model';
export type {
  CreditScoreTier,
  PersistedScoreFactors,
  ScoreFactorsInput,
} from './credit-score.model';

export interface FactorBreakdownItem {
  name: string;
  weight: number;
  weightPercent: string;
  scorePercent: number;
  description: string;
  impact: 'positive' | 'neutral' | 'negative';
}

export interface CreditScoreDisclosure {
  score: number;
  tier: CreditScoreTier;
  maxDealSizeUsdc: number;
  factors: ScoreFactorsInput;
  breakdown: Record<string, FactorBreakdownItem>;
  tips: string[];
  lastUpdated: string;
  cached: boolean;
}

const CREDIT_SCORE_CACHE_TTL_MS = 15 * 60 * 1_000; // 15-minute TTL

@Injectable()
export class FarmerCreditScoringService {
  private readonly logger = new Logger(FarmerCreditScoringService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(FarmerCreditScoreHistory)
    private readonly historyRepository: Repository<FarmerCreditScoreHistory>,
    @Optional()
    @Inject(CACHE_MANAGER)
    private readonly cacheManager?: Cache,
  ) {}

  /**
   * Maps the weighted factor sum onto the 300-850 credit range.
   *
   * Every factor is clamped to [0, 1] before it is weighted, so a bad
   * input can never push the score outside the published range.
   */
  public calculateScoreFromFactors(factors: ScoreFactorsInput): number {
    return calculateScore(factors);
  }

  /**
   * The uncollateralized deal ceiling a farmer may be offered at this
   * score. Bands are aligned with the credit tiers so a farmer can only
   * graduate to a higher ceiling by reaching the next tier.
   */
  public deriveMaxDealSize(score: number): number {
    return maxDealSizeForScore(score);
  }

  /**
   * Credit tier for a score. Bands follow issue #1160:
   * excellent 750+, good 700-749, fair 650-699, poor below 650.
   */
  public deriveScoreTier(score: number): CreditScoreTier {
    return creditTierForScore(score);
  }

  /**
   * Actionable advice aimed at the dimensions that cost the farmer the
   * most points, so the tips stay proportional to the weightings.
   */
  public generateTips(factors: ScoreFactorsInput, score: number): string[] {
    const tips: string[] = [];
    const f = normalizeFactors(factors);

    if (f.onTimeRepaymentRate < 0.95) {
      tips.push(
        'Maintain on-time delivery across upcoming harvest cycles. On-time delivery carries the highest weight (25%) in your score.',
      );
    }
    if (f.shipmentMilestoneComplianceRate < 0.90) {
      tips.push(
        'Log shipment checkpoints and keep IoT sensor telemetry active. Regular milestone updates account for 10% of your score.',
      );
    }
    if (f.shipmentAccuracyRate < 0.90) {
      tips.push(
        'Have each shipment milestone confirmed by a trader or logistics verifier. Verified milestones account for 15% of your score.',
      );
    }
    if (f.documentQualityRate < 0.90) {
      tips.push(
        'Upload complete, legible trade documents. Every supporting document is reviewed, and document quality accounts for 10% of your score.',
      );
    }
    if (f.dealDefaultRate > 0) {
      tips.push(
        'Avoid cancelled or unfulfilled deals. Zero defaults protect 20% of your total credit rating.',
      );
    }
    if (f.dealCompletionRate < 0.90) {
      tips.push(
        'Complete your active listed crops through final escrow release to build a solid track record (15% weight).',
      );
    }
    if (f.kycVerificationAgeDays < 180) {
      tips.push(
        'Keep your farm registry and KYC documentation verified and up to date (5% weight).',
      );
    }

    if (tips.length === 0 || score >= 750) {
      tips.unshift(
        'Your profile is in the top tier! You qualify for the lowest platform financing fees and up to $200,000 in uncollateralized deal limits.',
      );
    }

    return tips;
  }

  /**
   * Discloses the farmer's credit score, detailed weighted factor breakdown,
   * loan pricing tier, and personalized improvement tips.
   * Utilizes a 15-minute Redis cache.
   */
  async getCreditScoreDisclosure(userId: string): Promise<CreditScoreDisclosure> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.role !== 'farmer' && user.role !== 'admin') {
      throw new ForbiddenException(
        'Farmer credit score disclosure is only available for farmer accounts.',
      );
    }

    const cacheKey = `farmer:credit-score:${userId}`;

    if (this.cacheManager) {
      try {
        const cached = await this.cacheManager.get<CreditScoreDisclosure>(cacheKey);
        if (cached) {
          return { ...cached, cached: true };
        }
      } catch (err: any) {
        this.logger.warn(`Redis get failed for ${cacheKey}: ${err.message}`);
      }
    }

    // Retrieve latest score calculation or fall back to a neutral profile
    // for a farmer we have no history on yet.
    const latestHistory = await this.historyRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const factors: ScoreFactorsInput = normalizeFactors(
      latestHistory?.factors ?? {},
    );

    const score = user.creditScore ?? this.calculateScoreFromFactors(factors);
    const maxDealSizeUsdc = this.deriveMaxDealSize(score);
    const tier = this.deriveScoreTier(score);
    const tips = this.generateTips(factors, score);

    const breakdown: Record<string, FactorBreakdownItem> = {
      onTimeRepayment: {
        name: 'On-Time Delivery Rate',
        weight: FACTOR_WEIGHTS.onTimeRepayment,
        weightPercent: '25%',
        scorePercent: Math.round(factors.onTimeRepaymentRate * 100),
        description:
          'Share of contracted deliveries that reached the importer on or before the contractual date.',
        impact: factors.onTimeRepaymentRate >= 0.9 ? 'positive' : 'negative',
      },
      repaymentHistory: {
        name: 'Repayment History',
        weight: FACTOR_WEIGHTS.defaultRate,
        weightPercent: '20%',
        scorePercent: Math.round((1 - factors.dealDefaultRate) * 100),
        description:
          'History of settled obligations: cancelled, failed and expired deals reduce this figure.',
        impact: factors.dealDefaultRate === 0 ? 'positive' : 'negative',
      },
      dealCompletion: {
        name: 'Deal Completion Rate',
        weight: FACTOR_WEIGHTS.dealCompletion,
        weightPercent: '15%',
        scorePercent: Math.round(factors.dealCompletionRate * 100),
        description: 'Ratio of trade deals successfully carried through to settlement.',
        impact: factors.dealCompletionRate >= 0.85 ? 'positive' : 'neutral',
      },
      shipmentAccuracy: {
        name: 'Shipment Accuracy',
        weight: FACTOR_WEIGHTS.shipmentAccuracy,
        weightPercent: '15%',
        scorePercent: Math.round(factors.shipmentAccuracyRate * 100),
        description:
          'Share of recorded shipment milestones confirmed accurate by an independent verifier.',
        impact: factors.shipmentAccuracyRate >= 0.9 ? 'positive' : 'neutral',
      },
      sensorMilestoneCompliance: {
        name: 'Shipment Milestones & IoT Uptime',
        weight: FACTOR_WEIGHTS.shipmentMilestone,
        weightPercent: '10%',
        scorePercent: Math.round(factors.shipmentMilestoneComplianceRate * 100),
        description: 'Prompt milestone check-ins and IoT telemetry transmission.',
        impact: factors.shipmentMilestoneComplianceRate >= 0.9 ? 'positive' : 'neutral',
      },
      documentQuality: {
        name: 'Document Quality',
        weight: FACTOR_WEIGHTS.documentQuality,
        weightPercent: '10%',
        scorePercent: Math.round(factors.documentQualityRate * 100),
        description:
          'Share of uploaded supporting documents that passed verification review without rejection.',
        impact: factors.documentQualityRate >= 0.9 ? 'positive' : 'neutral',
      },
      kycAge: {
        name: 'KYC & Farm Verification Longevity',
        weight: FACTOR_WEIGHTS.kycAge,
        weightPercent: '5%',
        scorePercent: Math.min(Math.round((factors.kycVerificationAgeDays / 365) * 100), 100),
        description: 'Tenure of active identity and agricultural verification.',
        impact: factors.kycVerificationAgeDays >= 180 ? 'positive' : 'neutral',
      },
    };

    const disclosure: CreditScoreDisclosure = {
      score,
      tier,
      maxDealSizeUsdc,
      factors,
      breakdown,
      tips,
      lastUpdated: (latestHistory?.createdAt ?? user.createdAt ?? new Date()).toISOString(),
      cached: false,
    };

    if (this.cacheManager) {
      try {
        await this.cacheManager.set(cacheKey, disclosure, CREDIT_SCORE_CACHE_TTL_MS);
      } catch (err: any) {
        this.logger.warn(`Redis set failed for ${cacheKey}: ${err.message}`);
      }
    }

    return disclosure;
  }

  /**
   * Persists a score, its factor breakdown and a history row.
   *
   * `customFactors` should be the factors measured from the farmer's
   * actual deal, milestone, document and payment history. When it is
   * omitted the farmer is scored on the neutral profile, which carries no
   * credit for a track record they have not built yet.
   */
  async computeScore(
    userId: string,
    reason: string = 'Periodic recalculation',
    customFactors?: ScoreFactorsInput,
  ): Promise<{
    score: number;
    maxDealSizeUsdc: number;
    factors: ScoreFactorsInput;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const factors: ScoreFactorsInput = normalizeFactors(customFactors ?? {});

    const score = this.calculateScoreFromFactors(factors);
    const maxDealSizeUsdc = this.deriveMaxDealSize(score);

    // Save to user profile
    user.creditScore = score;
    await this.userRepository.save(user);

    // Save to history audit table
    const history = this.historyRepository.create({
      userId,
      score,
      maxDealSizeUsdc,
      factors,
      reason,
      overrideBy: null,
    });
    await this.historyRepository.save(history);

    // Invalidate Redis cache
    await this.invalidateCache(userId);

    this.logger.log(
      `Credit score updated for user ${userId}: ${score} (Tier max: $${maxDealSizeUsdc})`,
    );

    return { score, maxDealSizeUsdc, factors };
  }

  /**
   * Applies an administrator's manual correction to a farmer's score and
   * records the override in the score history.
   */
  async manualOverride(
    adminId: string,
    userId: string,
    score: number,
    reason: string,
  ): Promise<FarmerCreditScoreHistory> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const boundedScore = Math.min(Math.max(score, CREDIT_SCORE_MIN), CREDIT_SCORE_MAX);
    const maxDealSizeUsdc = this.deriveMaxDealSize(boundedScore);

    user.creditScore = boundedScore;
    await this.userRepository.save(user);

    const history = this.historyRepository.create({
      userId,
      score: boundedScore,
      maxDealSizeUsdc,
      factors: {
        onTimeRepaymentRate: 1,
        dealCompletionRate: 1,
        dealDefaultRate: 0,
        shipmentMilestoneComplianceRate: 1,
        shipmentAccuracyRate: 1,
        documentQualityRate: 1,
        kycVerificationAgeDays: 365,
      },
      reason: `Admin override by ${adminId}: ${reason}`,
      overrideBy: adminId,
    });

    const saved = await this.historyRepository.save(history);

    // Invalidate Redis cache
    await this.invalidateCache(userId);

    return saved;
  }

  /** Drops the cached disclosure for a farmer so the next read is fresh. */
  async invalidateCache(userId: string): Promise<void> {
    if (!this.cacheManager) return;
    try {
      await this.cacheManager.del(`farmer:credit-score:${userId}`);
    } catch (err: any) {
      this.logger.warn(`Redis del failed for farmer:credit-score:${userId}: ${err.message}`);
    }
  }
}
