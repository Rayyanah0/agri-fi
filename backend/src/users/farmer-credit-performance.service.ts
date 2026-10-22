import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';
import { TradeDeal, TradeDealStatus } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { MilestoneVerification } from '../shipments/entities/milestone-verification.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';
import {
  CreditScoreTier,
  ScoreFactorsInput,
} from './credit-score.model';
import { FarmerCreditScoringService } from './farmer-credit-scoring.service';

/** Deal statuses that mean the deal has reached a final outcome. */
const CLOSED_DEAL_STATUSES: TradeDealStatus[] = [
  'completed',
  'failed',
  'expired',
  'canceled',
];

/**
 * Statuses that count as a credit event. A cancelled deal is a legitimate
 * exit that is not the farmer's default, so it is excluded from the
 * repayment history rather than counted against it.
 */
const DEFAULT_DEAL_STATUSES: TradeDealStatus[] = ['failed', 'expired'];

/** The shipment chain, in the order a compliant shipment records it. */
const MILESTONE_CHAIN: Array<ShipmentMilestone['milestone']> = [
  'farm',
  'warehouse',
  'port',
  'importer',
];

/** Deal statuses an investor can still fund. */
const INVESTABLE_DEAL_STATUSES: TradeDealStatus[] = ['open', 'funded'];

export interface MonthlyScorePoint {
  /** ISO month, e.g. `2026-09`. */
  month: string;
  score: number;
  tier: CreditScoreTier;
  maxDealSizeUsdc: number;
  /** Change against the previous month. `null` for the first month. */
  change: number | null;
}

export interface PeerBenchmark {
  country: string;
  peerCount: number;
  averageScore: number;
  medianScore: number;
  /** Share of peers scoring at or below this farmer, 0-100. */
  percentile: number;
  /** This farmer's score, or `null` when it has never been computed. */
  score: number | null;
  tier: CreditScoreTier | null;
  /** Peer counts per tier, for the regional distribution chart. */
  tierDistribution: Record<CreditScoreTier, number>;
}

export interface CreditInvestmentRecommendation {
  dealId: string;
  commodity: string;
  totalValue: number;
  expectedRoi: number | null;
  farmerCreditScore: number;
  farmerCreditTier: CreditScoreTier;
  maxDealSizeUsdc: number;
  /** Why this deal is recommended, in plain language for the investor. */
  rationale: string;
}

export interface RecalculationOutcome {
  score: number;
  tier: CreditScoreTier;
  previousScore: number | null;
  previousTier: CreditScoreTier | null;
  scoreChanged: boolean;
  tierChanged: boolean;
  factors: ScoreFactorsInput;
}

/**
 * Measures a farmer's real trading history and turns it into the factor
 * set the scoring model consumes.
 *
 * Every dimension follows the same rule: when there is no evidence for it
 * the farmer is scored at the neutral midpoint, so a missing history can
 * never be mistaken for a good one.
 */
@Injectable()
export class FarmerCreditPerformanceService {
  private readonly logger = new Logger(FarmerCreditPerformanceService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepository: Repository<TradeDeal>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepository: Repository<ShipmentMilestone>,
    @InjectRepository(MilestoneVerification)
    private readonly verificationRepository: Repository<MilestoneVerification>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(PaymentDistribution)
    private readonly paymentDistributionRepository: Repository<PaymentDistribution>,
    @InjectRepository(KycSubmission)
    private readonly kycSubmissionRepository: Repository<KycSubmission>,
    @InjectRepository(FarmerCreditScoreHistory)
    private readonly historyRepository: Repository<FarmerCreditScoreHistory>,
    private readonly scoringService: FarmerCreditScoringService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Measures every scoring dimension from the farmer's actual history.
   */
  async deriveFactors(userId: string): Promise<ScoreFactorsInput> {
    const deals = await this.tradeDealRepository.find({
      where: { farmerId: userId },
    });
    const dealIds = deals.map((deal) => deal.id);

    const milestones = dealIds.length
      ? await this.milestoneRepository.find({ where: { tradeDealId: In(dealIds) } })
      : [];
    const documents = dealIds.length
      ? await this.documentRepository.find({ where: { tradeDealId: In(dealIds) } })
      : [];
    const payments = dealIds.length
      ? await this.paymentDistributionRepository.find({
          where: { tradeDealId: In(dealIds), recipientType: 'farmer' },
        })
      : [];

    // Repayment history is the fulfilment record: obligations the farmer
    // took on and the escrow releases that paid them out. It is stored in
    // the model as the inverted default rate.
    const repaymentHistoryRate = this.measureRepaymentHistory(deals, payments);

    return {
      onTimeRepaymentRate: this.measureOnTimeDelivery(deals, milestones),
      dealCompletionRate: this.measureDealCompletion(deals),
      dealDefaultRate: 1 - repaymentHistoryRate,
      shipmentMilestoneComplianceRate: this.measureMilestoneCompliance(
        deals,
        milestones,
      ),
      shipmentAccuracyRate: await this.measureShipmentAccuracy(milestones),
      documentQualityRate: this.measureDocumentQuality(documents),
      kycVerificationAgeDays: await this.measureKycAge(userId),
    };
  }

  /**
   * Re-measures a farmer, stores the new score and alerts the farmer when
   * the score or the tier moved.
   */
  async recalculate(
    userId: string,
    reason = 'Scheduled performance recalculation',
  ): Promise<RecalculationOutcome> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const previousScore = user.creditScore ?? null;
    const previousTier =
      previousScore === null ? null : this.scoringService.deriveScoreTier(previousScore);

    const factors = await this.deriveFactors(userId);
    const { score } = await this.scoringService.computeScore(userId, reason, factors);
    const tier = this.scoringService.deriveScoreTier(score);

    const scoreChanged = previousScore !== null && previousScore !== score;
    const tierChanged = previousTier !== null && previousTier !== tier;

    if (scoreChanged || tierChanged) {
      await this.notifyScoreChange(userId, {
        score,
        tier,
        previousScore,
        previousTier,
        tierChanged,
      });
    }

    return {
      score,
      tier,
      previousScore,
      previousTier,
      scoreChanged,
      tierChanged,
      factors,
    };
  }

  /**
   * The farmer's score history rolled up into one point per calendar
   * month, oldest first, so the trend line shows monthly evolution.
   */
  async getMonthlyHistory(
    userId: string,
    months = 12,
  ): Promise<MonthlyScorePoint[]> {
    const history = await this.historyRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const byMonth = new Map<string, FarmerCreditScoreHistory>();
    for (const entry of history) {
      const month = this.toIsoMonth(entry.createdAt);
      // Rows come back newest first, so the first row seen for a month is
      // the one we keep.
      if (!byMonth.has(month)) {
        byMonth.set(month, entry);
      }
    }

    const points: MonthlyScorePoint[] = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-Math.max(1, months))
      .map(([month, entry]) => {
        const score = entry.score;
        return {
          month,
          score,
          tier: this.scoringService.deriveScoreTier(score),
          maxDealSizeUsdc: Number(entry.maxDealSizeUsdc),
          change: null,
        };
      });

    for (let i = 1; i < points.length; i += 1) {
      points[i].change = points[i].score - points[i - 1].score;
    }

    return points;
  }

  /**
   * Compares a farmer against the other farmers in the same country.
   */
  async getPeerBenchmark(userId: string): Promise<PeerBenchmark> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const peers = await this.userRepository.find({
      where: { role: 'farmer', country: user.country },
      select: ['id', 'creditScore'],
    });

    const scored = peers
      // The farmer is compared against the *other* farmers in their
      // region, so they are not part of their own peer set.
      .filter((peer) => peer.id !== userId)
      .filter((peer) => peer.creditScore !== null && peer.creditScore !== undefined)
      .map((peer) => peer.creditScore as number)
      .sort((a, b) => a - b);

    const tierDistribution: Record<CreditScoreTier, number> = {
      Excellent: 0,
      Good: 0,
      Fair: 0,
      Poor: 0,
    };
    for (const score of scored) {
      tierDistribution[this.scoringService.deriveScoreTier(score)] += 1;
    }

    const score = user.creditScore ?? null;
    const averageScore =
      scored.length > 0
        ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length)
        : 0;
    const medianScore =
      scored.length === 0
        ? 0
        : scored.length % 2 === 1
          ? scored[Math.floor(scored.length / 2)]
          : Math.round(
              (scored[scored.length / 2 - 1] + scored[scored.length / 2]) / 2,
            );
    const percentile =
      score === null || scored.length === 0
        ? 0
        : Math.round(
            (scored.filter((peerScore) => peerScore <= score).length / scored.length) * 100,
          );

    return {
      country: user.country,
      peerCount: scored.length,
      averageScore,
      medianScore,
      percentile,
      score,
      tier: score === null ? null : this.scoringService.deriveScoreTier(score),
      tierDistribution,
    };
  }

  /**
   * Ranks the deals an investor can still fund by the credit quality of
   * the farmer behind them.
   *
   * A deal is only recommended when the farmer's score is at or above the
   * requested tier and the deal fits inside the uncollateralized ceiling
   * that score grants them.
   */
  async getInvestmentRecommendations(
    options: {
      minTier?: CreditScoreTier;
      limit?: number;
    } = {},
  ): Promise<CreditInvestmentRecommendation[]> {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const minTier = options.minTier ?? 'Fair';
    const minScore = this.tierFloor(minTier);

    const farmers = await this.userRepository.find({
      where: { role: 'farmer', creditScore: MoreThanOrEqual(minScore) },
      order: { creditScore: 'DESC' },
      take: 100,
    });

    if (farmers.length === 0) return [];

    const farmerById = new Map(farmers.map((farmer) => [farmer.id, farmer]));
    const deals = await this.tradeDealRepository.find({
      where: {
        farmerId: In(farmers.map((farmer) => farmer.id)),
        status: In(INVESTABLE_DEAL_STATUSES),
      },
    });

    const recommendations: CreditInvestmentRecommendation[] = [];

    for (const deal of deals) {
      const farmer = farmerById.get(deal.farmerId);
      const score = farmer?.creditScore;
      if (score === null || score === undefined) continue;

      const tier = this.scoringService.deriveScoreTier(score);
      if (this.tierFloor(tier) < minScore) continue;

      const maxDealSizeUsdc = this.scoringService.deriveMaxDealSize(score);
      const totalValue = Number(deal.totalValue);

      // The farmer can only carry so much volume on their own credit.
      if (totalValue > maxDealSizeUsdc) continue;

      recommendations.push({
        dealId: deal.id,
        commodity: deal.commodity,
        totalValue,
        expectedRoi:
          deal.expectedRoi === null || deal.expectedRoi === undefined
            ? null
            : Number(deal.expectedRoi),
        farmerCreditScore: score,
        farmerCreditTier: tier,
        maxDealSizeUsdc,
        rationale: this.buildRationale(tier, score, totalValue, maxDealSizeUsdc),
      });
    }

    // The strongest credit standing comes first.
    recommendations.sort((a, b) => b.farmerCreditScore - a.farmerCreditScore);

    return recommendations.slice(0, limit);
  }

  /**
   * Sends the farmer an alert when their score or tier moves.
   */
  private async notifyScoreChange(
    userId: string,
    change: {
      score: number;
      tier: CreditScoreTier;
      previousScore: number | null;
      previousTier: CreditScoreTier | null;
      tierChanged: boolean;
    },
  ): Promise<void> {
    try {
      const title = change.tierChanged
        ? `Credit tier upgraded to ${change.tier}`
        : 'Credit score updated';
      const message = change.tierChanged
        ? `Your credit tier moved from ${change.previousTier} to ${change.tier}. Your score is now ${change.score}.`
        : `Your credit score moved from ${change.previousScore} to ${change.score}.`;

      await this.notificationsService.createNotification({
        userId,
        type: 'alert',
        title,
        message,
        linkUrl: '/dashboard/farmer',
        metadataJson: {
          creditScore: change.score,
          tier: change.tier,
          previousScore: change.previousScore,
          previousTier: change.previousTier,
          tierChanged: change.tierChanged,
        },
      });
    } catch (err: any) {
      // A notification failure must never fail the recalculation itself.
      this.logger.warn(
        `Failed to notify credit score change for ${userId}: ${err.message}`,
      );
    }
  }

  // ── Measurements ───────────────────────────────────────────────────────────

  /**
   * On-time delivery: a completed deal counts as on time when its final
   * `importer` milestone was recorded on or before the contractual
   * delivery date.
   */
  private measureOnTimeDelivery(
    deals: TradeDeal[],
    milestones: ShipmentMilestone[],
  ): number {
    const completed = deals.filter((deal) => deal.status === 'completed');
    if (completed.length === 0) return 0.5;

    const byDeal = new Map<string, ShipmentMilestone[]>();
    for (const milestone of milestones) {
      const list = byDeal.get(milestone.tradeDealId) ?? [];
      list.push(milestone);
      byDeal.set(milestone.tradeDealId, list);
    }

    let onTime = 0;
    let measurable = 0;

    for (const deal of completed) {
      const dealMilestones = byDeal.get(deal.id) ?? [];
      const finalMilestone = dealMilestones.find(
        (milestone) => milestone.milestone === 'importer',
      );
      if (!finalMilestone) continue;

      measurable += 1;
      // The delivery date is a calendar day, so anything recorded on that
      // day still counts as on time.
      const endOfDeliveryDay = new Date(deal.deliveryDate);
      endOfDeliveryDay.setHours(23, 59, 59, 999);

      if (
        new Date(finalMilestone.recordedAt).getTime() <= endOfDeliveryDay.getTime()
      ) {
        onTime += 1;
      }
    }

    if (measurable === 0) return 0.5;
    return onTime / measurable;
  }

  /** Share of closed deals that reached settlement. */
  private measureDealCompletion(deals: TradeDeal[]): number {
    const closed = deals.filter((deal) => CLOSED_DEAL_STATUSES.includes(deal.status));
    if (closed.length === 0) return 0.5;

    const completed = closed.filter((deal) => deal.status === 'completed').length;
    return completed / closed.length;
  }

  /**
   * Repayment history: the share of the farmer's obligations that were
   * honoured. Both the deals themselves and the escrow releases they
   * triggered count, so a farmer cannot be paid out in full while their
   * deals are quietly failing.
   *
   * Cancelled deals are excluded: walking away from a deal is a
   * legitimate exit, not a repayment failure.
   */
  private measureRepaymentHistory(
    deals: TradeDeal[],
    payments: PaymentDistribution[],
  ): number {
    const counted = deals.filter(
      (deal) => CLOSED_DEAL_STATUSES.includes(deal.status) && deal.status !== 'canceled',
    );
    const obligations = counted.length + payments.length;
    if (obligations === 0) return 0.5;

    const honoured =
      counted.filter((deal) => deal.status === 'completed').length +
      payments.filter((payment) => payment.status === 'confirmed').length;

    return honoured / obligations;
  }

  /**
   * Share of shipments whose milestone chain has no gaps — a deal that
   * recorded `farm` and `port` without `warehouse` is not compliant, but a
   * deal that is only at the `farm` stage has not skipped anything yet.
   */
  private measureMilestoneCompliance(
    deals: TradeDeal[],
    milestones: ShipmentMilestone[],
  ): number {
    if (milestones.length === 0) return 0.5;

    const byDeal = new Map<string, Set<string>>();
    for (const milestone of milestones) {
      const stages = byDeal.get(milestone.tradeDealId) ?? new Set<string>();
      stages.add(milestone.milestone);
      byDeal.set(milestone.tradeDealId, stages);
    }

    let compliant = 0;
    let measured = 0;

    for (const deal of deals) {
      const stages = byDeal.get(deal.id);
      if (!stages || stages.size === 0) continue;

      measured += 1;
      const furthest = MILESTONE_CHAIN.reduce(
        (acc, stage, index) => (stages.has(stage) ? index : acc),
        -1,
      );
      if (furthest < 0) continue;

      let hasGap = false;
      for (let index = 0; index <= furthest; index += 1) {
        if (!stages.has(MILESTONE_CHAIN[index])) {
          hasGap = true;
          break;
        }
      }
      if (!hasGap) compliant += 1;
    }

    if (measured === 0) return 0.5;
    return compliant / measured;
  }

  /**
   * Share of verified milestones a verifier confirmed. Milestones that
   * nobody has looked at yet carry no evidence either way.
   */
  private async measureShipmentAccuracy(
    milestones: ShipmentMilestone[],
  ): Promise<number> {
    if (milestones.length === 0) return 0.5;

    const milestoneIds = milestones.map((milestone) => milestone.id);
    const verifications = await this.verificationRepository.find({
      where: { milestoneId: In(milestoneIds) },
    });

    if (verifications.length === 0) return 0.5;

    const verified = verifications.filter(
      (verification) => verification.status === 'verified',
    ).length;

    return verified / verifications.length;
  }

  /**
   * Share of reviewed documents that passed review. Documents still
   * awaiting a verdict are excluded rather than counted against the
   * farmer.
   */
  private measureDocumentQuality(documents: Document[]): number {
    if (documents.length === 0) return 0.5;

    const approved = documents.filter(
      (document) => document.verificationStatus === 'approved',
    ).length;
    const rejected = documents.filter(
      (document) => document.verificationStatus === 'rejected',
    ).length;

    const reviewed = approved + rejected;
    if (reviewed === 0) return 0.5;
    return approved / reviewed;
  }

  /**
   * Days since the farmer's KYC was approved. The submission has no
   * approval timestamp, so the submission date is used as a lower bound.
   */
  private async measureKycAge(userId: string): Promise<number> {
    const approved = await this.kycSubmissionRepository.findOne({
      where: { userId, status: 'approved' },
      order: { createdAt: 'DESC' },
    });
    if (!approved) return 0;

    const elapsed = Date.now() - new Date(approved.createdAt).getTime();
    return Math.max(0, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** The lowest score that still qualifies for a tier. */
  private tierFloor(tier: CreditScoreTier): number {
    switch (tier) {
      case 'Excellent':
        return 750;
      case 'Good':
        return 700;
      case 'Fair':
        return 650;
      default:
        return 0;
    }
  }

  private buildRationale(
    tier: CreditScoreTier,
    score: number,
    totalValue: number,
    maxDealSizeUsdc: number,
  ): string {
    const size = `$${Math.round(totalValue).toLocaleString('en-US')}`;
    const ceiling = `$${maxDealSizeUsdc.toLocaleString('en-US')}`;
    return `${tier} credit score (${score}) — this deal is ${size}, within the ${ceiling} uncollateralized ceiling for this tier.`;
  }

  private toIsoMonth(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
}
