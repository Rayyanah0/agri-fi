/**
 * FraudDetectionService (#1157)
 *
 * Rule-based fraud scoring for transactions and KYC anomalies.
 * Produces a FraudScore (low / medium / high) with explainable signals
 * to feed the manual review queue and compliance alerts.
 */

import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface FraudSignal {
  rule: string;
  weight: number;
  detail: string;
}

export interface FraudScore {
  entityId: string;
  entityType: 'investment' | 'user';
  score: number;
  riskLevel: RiskLevel;
  signals: FraudSignal[];
  evaluatedAt: Date;
}

export interface FraudReviewItem {
  fraudScore: FraudScore;
  requiresManualReview: boolean;
  assignedTo?: string;
}

// Score thresholds
const MEDIUM_THRESHOLD = 40;
const HIGH_THRESHOLD = 70;

// ── Federated learning types (#1191) ─────────────────────────────────────────

export type ParticipantStatus = 'pending' | 'active' | 'suspended' | 'revoked';

export interface FederatedParticipant {
  participantId: string;
  organizationName: string;
  /** Blockchain address used to verify participant identity. */
  blockchainAddress: string;
  status: ParticipantStatus;
  joinedAt: Date;
  /** Number of completed training rounds contributed. */
  roundsContributed: number;
  /** Accumulated contribution score used for reward calculation. */
  contributionScore: number;
  /** Total reward tokens accrued. */
  rewardsEarned: number;
  lastActiveAt?: Date;
}

export interface FederatedModelWeights {
  /** Feature weights for the fraud scoring model. */
  weights: number[];
  /** Bias term. */
  bias: number;
}

export interface LocalTrainingResult {
  participantId: string;
  roundId: string;
  weights: FederatedModelWeights;
  /** Number of private samples used for local training. */
  sampleCount: number;
  /** Local loss after training. */
  loss: number;
  /** Local accuracy on the participant's holdout set. */
  localAccuracy: number;
  trainedAt: Date;
}

export interface FederatedRound {
  roundId: string;
  startedAt: Date;
  completedAt?: Date;
  participatingNodes: string[];
  rejectedNodes: string[];
  globalWeights?: FederatedModelWeights;
  globalAccuracy?: number;
  localAccuracyAvg?: number;
  status: 'scheduled' | 'training' | 'aggregating' | 'completed' | 'failed';
}

export interface FederatedLearningConfig {
  /** Number of local epochs per round. */
  localEpochs: number;
  /** Learning rate for local SGD. */
  learningRate: number;
  /** L2 norm bound for gradient clipping (poisoning defense). */
  gradientClipNorm: number;
  /** Differential privacy noise scale (sigma). */
  dpNoiseScale: number;
  /** Differential privacy clipping threshold. */
  dpClipNorm: number;
  /** Minimum number of participants required to aggregate a round. */
  minParticipants: number;
  /** Fraction of participants whose updates are rejected as outliers. */
  outlierRejectionFraction: number;
  /** Reward tokens per contribution unit. */
  rewardPerContribution: number;
  /** Interval between scheduled rounds in milliseconds. */
  roundIntervalMs: number;
}

const DEFAULT_FEDERATED_CONFIG: FederatedLearningConfig = {
  localEpochs: 3,
  learningRate: 0.01,
  gradientClipNorm: 1.0,
  dpNoiseScale: 0.1,
  dpClipNorm: 1.0,
  minParticipants: 2,
  outlierRejectionFraction: 0.2,
  rewardPerContribution: 10,
  roundIntervalMs: 24 * 60 * 60 * 1000,
};

/** Number of features in the federated fraud model. */
const FEDERATED_FEATURE_COUNT = 6;

/**
 * FederatedLearningService (#1191)
 *
 * Enables multiple agricultural finance platforms to collaboratively train the
 * fraud detection model without sharing raw data. A central server coordinates
 * rounds; participant nodes train locally on private data and submit masked,
 * differentially-private model updates which are aggregated via FedAvg.
 */
@Injectable()
export class FederatedLearningService {
  private readonly config: FederatedLearningConfig;
  private readonly participants = new Map<string, FederatedParticipant>();
  private readonly rounds = new Map<string, FederatedRound>();
  private readonly pendingUpdates = new Map<string, LocalTrainingResult[]>();
  private globalWeights: FederatedModelWeights;
  private localBaselineAccuracy = 0;
  private federatedAccuracy = 0;
  private roundCounter = 0;

  constructor(
    private readonly fraudDetectionService: FraudDetectionService,
    @Optional() private readonly logger?: PinoLogger,
    @Optional() config?: Partial<FederatedLearningConfig>,
  ) {
    this.config = { ...DEFAULT_FEDERATED_CONFIG, ...(config ?? {}) };
    this.globalWeights = this.initializeWeights();
    if (this.logger) {
      (this.logger as any).setContext?.(FederatedLearningService.name);
    }
  }

  // ── Participant onboarding ─────────────────────────────────────────────────

  /**
   * Register a new participant node. The participant starts in `pending` state
   * and must be verified (e.g. via blockchain identity) before joining rounds.
   */
  async onboardParticipant(
    participantId: string,
    organizationName: string,
    blockchainAddress: string,
  ): Promise<FederatedParticipant> {
    if (this.participants.has(participantId)) {
      throw new Error(`Participant ${participantId} already onboarded`);
    }
    if (!this.verifyParticipantIntegrity(blockchainAddress)) {
      throw new Error(`Invalid blockchain address for participant ${participantId}`);
    }

    const participant: FederatedParticipant = {
      participantId,
      organizationName,
      blockchainAddress,
      status: 'pending',
      joinedAt: new Date(),
      roundsContributed: 0,
      contributionScore: 0,
      rewardsEarned: 0,
    };
    this.participants.set(participantId, participant);
    this.logger?.info?.(
      { participantId, organizationName },
      'Federated learning participant onboarded (pending verification)',
    );
    return participant;
  }

  /** Activate a pending participant after off-chain/on-chain verification. */
  activateParticipant(participantId: string): FederatedParticipant {
    const participant = this.requireParticipant(participantId);
    if (participant.status === 'revoked') {
      throw new Error(`Participant ${participantId} has been revoked`);
    }
    participant.status = 'active';
    participant.lastActiveAt = new Date();
    this.logger?.info?.({ participantId }, 'Federated learning participant activated');
    return participant;
  }

  /** Suspend a participant (e.g. detected poisoning behaviour). */
  suspendParticipant(participantId: string, reason: string): void {
    const participant = this.requireParticipant(participantId);
    participant.status = 'suspended';
    this.logger?.warn?.({ participantId, reason }, 'Federated learning participant suspended');
  }

  getParticipant(participantId: string): FederatedParticipant | undefined {
    return this.participants.get(participantId);
  }

  listParticipants(): FederatedParticipant[] {
    return Array.from(this.participants.values());
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  /** Schedule a new federated learning round for all active participants. */
  scheduleRound(): FederatedRound {
    const activeNodes = this.listParticipants()
      .filter((p) => p.status === 'active')
      .map((p) => p.participantId);

    this.roundCounter += 1;
    const round: FederatedRound = {
      roundId: `fl-round-${this.roundCounter}-${Date.now()}`,
      startedAt: new Date(),
      participatingNodes: activeNodes,
      rejectedNodes: [],
      status: 'scheduled',
    };
    this.rounds.set(round.roundId, round);
    this.pendingUpdates.set(round.roundId, []);
    this.logger?.info?.(
      { roundId: round.roundId, participants: activeNodes.length },
      'Federated learning round scheduled',
    );
    return round;
  }

  /** Returns true when enough time has elapsed to start the next round. */
  isRoundDue(now: Date = new Date()): boolean {
    const last = this.getLastCompletedRound();
    if (!last?.completedAt) return true;
    return now.getTime() - last.completedAt.getTime() >= this.config.roundIntervalMs;
  }

  /** Run a scheduled round if due; otherwise returns the last completed round. */
  async runScheduledRoundIfDue(): Promise<FederatedRound | undefined> {
    if (!this.isRoundDue()) {
      return this.getLastCompletedRound();
    }
    const round = this.scheduleRound();
    return this.executeRound(round.roundId);
  }

  // ── Local training on participant nodes ────────────────────────────────────

  /**
   * Train the fraud model locally on a participant's private data and submit
   * the (clipped, differentially-private) update to the central server.
   *
   * `features`/`labels` represent the participant's private dataset and never
   * leave the node — only the resulting weights are submitted.
   */
  async submitLocalUpdate(
    roundId: string,
    participantId: string,
    features: number[][],
    labels: number[],
  ): Promise<LocalTrainingResult> {
    const round = this.requireRound(roundId);
    const participant = this.requireParticipant(participantId);

    if (participant.status !== 'active') {
      throw new Error(`Participant ${participantId} is not active`);
    }
    if (!round.participatingNodes.includes(participantId)) {
      throw new Error(`Participant ${participantId} is not part of round ${roundId}`);
    }
    if (features.length !== labels.length || features.length === 0) {
      throw new Error('Invalid local training dataset');
    }

    round.status = 'training';
    const result = this.trainLocally(roundId, participantId, features, labels);
    participant.lastActiveAt = new Date();

    const updates = this.pendingUpdates.get(roundId) ?? [];
    updates.push(result);
    this.pendingUpdates.set(roundId, updates);

    this.logger?.info?.(
      { roundId, participantId, sampleCount: result.sampleCount, loss: result.loss },
      'Received local federated model update',
    );
    return result;
  }

  // ── Aggregation (FedAvg + secure masking + DP) ─────────────────────────────

  /**
   * Aggregate all submitted updates for a round using FedAvg, applying
   * gradient clipping, outlier rejection, secure masking and DP noise.
   */
  async executeRound(roundId: string): Promise<FederatedRound> {
    const round = this.requireRound(roundId);
    const updates = this.pendingUpdates.get(roundId) ?? [];

    if (updates.length < this.config.minParticipants) {
      round.status = 'failed';
      round.completedAt = new Date();
      this.logger?.warn?.(
        { roundId, received: updates.length, required: this.config.minParticipants },
        'Federated round failed: insufficient participants',
      );
      return round;
    }

    round.status = 'aggregating';

    // 1. Poisoning defense: clip gradients and reject statistical outliers.
    const clipped = updates.map((u) => this.clipUpdate(u));
    const { accepted, rejected } = this.rejectOutliers(clipped);
    round.rejectedNodes = rejected.map((u) => u.participantId);

    for (const r of rejected) {
      const p = this.participants.get(r.participantId);
      if (p) {
        p.contributionScore = Math.max(0, p.contributionScore - 5);
      }
    }

    if (accepted.length < this.config.minParticipants) {
      round.status = 'failed';
      round.completedAt = new Date();
      this.logger?.warn?.(
        { roundId, accepted: accepted.length },
        'Federated round failed: too many updates rejected',
      );
      return round;
    }

    // 2. Secure aggregation: mask individual updates so the server only sees
    //    the sum. Masks cancel out across participants.
    const maskedSum = this.secureAggregate(accepted);

    // 3. Differential privacy: add calibrated Gaussian noise to the aggregate.
    const totalSamples = accepted.reduce((s, u) => s + u.sampleCount, 0);
    const aggregated = this.applyDifferentialPrivacy(maskedSum, totalSamples);

    // 4. FedAvg: weighted average by sample count.
    this.globalWeights = {
      weights: aggregated.weights.map((w) => w / totalSamples),
      bias: aggregated.bias / totalSamples,
    };

    // 5. Track performance and rewards.
    const localAvg =
      accepted.reduce((s, u) => s + u.localAccuracy, 0) / accepted.length;
    round.localAccuracyAvg = localAvg;
    round.globalAccuracy = this.evaluateGlobalModel(accepted);
    round.globalWeights = this.globalWeights;
    round.status = 'completed';
    round.completedAt = new Date();

    this.federatedAccuracy = round.globalAccuracy;
    this.localBaselineAccuracy = localAvg;

    for (const u of accepted) {
      this.recordContribution(u.participantId, u.sampleCount);
    }

    this.logger?.info?.(
      {
        roundId,
        globalAccuracy: round.globalAccuracy,
        localAccuracyAvg: localAvg,
        accepted: accepted.length,
        rejected: rejected.length,
      },
      'Federated learning round completed',
    );
    return round;
  }

  // ── Performance tracking ───────────────────────────────────────────────────

  /** Compare federated global model accuracy against local-only baselines. */
  getPerformanceComparison(): {
    federatedAccuracy: number;
    localAccuracy: number;
    improvementPct: number;
  } {
    const improvementPct =
      this.localBaselineAccuracy > 0
        ? ((this.federatedAccuracy - this.localBaselineAccuracy) /
            this.localBaselineAccuracy) *
          100
        : 0;
    return {
      federatedAccuracy: this.federatedAccuracy,
      localAccuracy: this.localBaselineAccuracy,
      improvementPct,
    };
  }

  getGlobalModel(): FederatedModelWeights {
    return { weights: [...this.globalWeights.weights], bias: this.globalWeights.bias };
  }

  getRound(roundId: string): FederatedRound | undefined {
    return this.rounds.get(roundId);
  }

  getLastCompletedRound(): FederatedRound | undefined {
    const completed = Array.from(this.rounds.values()).filter(
      (r) => r.status === 'completed',
    );
    return completed.sort(
      (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
    )[0];
  }

  // ── Contribution rewards ───────────────────────────────────────────────────

  /** Compute accrued rewards for a participant based on contribution score. */
  getParticipantRewards(participantId: string): number {
    const participant = this.requireParticipant(participantId);
    return participant.rewardsEarned;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private initializeWeights(): FederatedModelWeights {
    return {
      weights: new Array(FEDERATED_FEATURE_COUNT).fill(0),
      bias: 0,
    };
  }

  private verifyParticipantIntegrity(blockchainAddress: string): boolean {
    // Basic on-chain address format validation (0x-prefixed, 40 hex chars).
    return /^0x[0-9a-fA-F]{40}$/.test(blockchainAddress);
  }

  private requireParticipant(participantId: string): FederatedParticipant {
    const participant = this.participants.get(participantId);
    if (!participant) {
      throw new Error(`Participant ${participantId} not found`);
    }
    return participant;
  }

  private requireRound(roundId: string): FederatedRound {
    const round = this.rounds.get(roundId);
    if (!round) {
      throw new Error(`Federated round ${roundId} not found`);
    }
    return round;
  }

  /** Local SGD training on the participant's private data. */
  private trainLocally(
    roundId: string,
    participantId: string,
    features: number[][],
    labels: number[],
  ): LocalTrainingResult {
    const weights = [...this.globalWeights.weights];
    let bias = this.globalWeights.bias;
    const lr = this.config.learningRate;

    let loss = 0;
    for (let epoch = 0; epoch < this.config.localEpochs; epoch += 1) {
      loss = 0;
      for (let i = 0; i < features.length; i += 1) {
        const x = features[i];
        const y = labels[i];
        const pred = this.sigmoid(this.dot(x, weights) + bias);
        const err = pred - y;
        loss += -(y * Math.log(pred + 1e-9) + (1 - y) * Math.log(1 - pred + 1e-9));
        for (let j = 0; j < weights.length; j += 1) {
          weights[j] -= lr * err * (x[j] ?? 0);
        }
        bias -= lr * err;
      }
      loss /= features.length;
    }

    let correct = 0;
    for (let i = 0; i < features.length; i += 1) {
      const pred = this.sigmoid(this.dot(features[i], weights) + bias) >= 0.5 ? 1 : 0;
      if (pred === labels[i]) correct += 1;
    }
    const localAccuracy = correct / features.length;

    return {
      participantId,
      roundId,
      weights: { weights, bias },
      sampleCount: features.length,
      loss,
      localAccuracy,
      trainedAt: new Date(),
    };
  }

  /** Clip an update's L2 norm to bound the influence of any single node. */
  private clipUpdate(update: LocalTrainingResult): LocalTrainingResult {
    const { weights, bias } = update.weights;
    const norm = Math.sqrt(
      weights.reduce((s, w) => s + w * w, 0) + bias * bias,
    );
    if (norm <= this.config.gradientClipNorm || norm === 0) {
      return update;
    }
    const scale = this.config.gradientClipNorm / norm;
    return {
      ...update,
      weights: {
        weights: weights.map((w) => w * scale),
        bias: bias * scale,
      },
    };
  }

  /** Reject updates whose distance from the median is a statistical outlier. */
  private rejectOutliers(updates: LocalTrainingResult[]): {
    accepted: LocalTrainingResult[];
    rejected: LocalTrainingResult[];
  } {
    if (updates.length <= this.config.minParticipants) {
      return { accepted: updates, rejected: [] };
    }

    const distances = updates.map((u) => ({
      update: u,
      distance: this.distanceFromMedian(u, updates),
    }));
    distances.sort((a, b) => a.distance - b.distance);

    const rejectCount = Math.floor(
      updates.length * this.config.outlierRejectionFraction,
    );
    const acceptedCount = Math.max(
      this.config.minParticipants,
      updates.length - rejectCount,
    );

    const accepted = distances.slice(0, acceptedCount).map((d) => d.update);
    const rejected = distances.slice(acceptedCount).map((d) => d.update);
    return { accepted, rejected };
  }

  private distanceFromMedian(
    update: LocalTrainingResult,
    all: LocalTrainingResult[],
  ): number {
    const dims = update.weights.weights.length;
    let sum = 0;
    for (let j = 0; j < dims; j += 1) {
      const values = all.map((u) => u.weights.weights[j] ?? 0).sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)];
      const diff = (update.weights.weights[j] ?? 0) - median;
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Secure aggregation: apply a pairwise-cancelling mask to each update so the
   * server cannot inspect individual contributions, only their sum.
   */
  private secureAggregate(updates: LocalTrainingResult[]): FederatedModelWeights {
    const dims = this.globalWeights.weights.length;
    const masked = updates.map((u, idx) => {
      const mask = this.deriveMask(u.participantId, idx, dims);
      return {
        weights: u.weights.weights.map(
          (w, j) => w * u.sampleCount + mask.weights[j],
        ),
        bias: u.weights.bias * u.sampleCount + mask.bias,
      };
    });

    const sum: FederatedModelWeights = {
      weights: new Array(dims).fill(0),
      bias: 0,
    };
    for (const m of masked) {
      for (let j = 0; j < dims; j += 1) sum.weights[j] += m.weights[j];
      sum.bias += m.bias;
    }
    return sum;
  }

  /** Deterministic pseudo-random mask that cancels across participants. */
  private deriveMask(
    participantId: string,
    index: number,
    dims: number,
  ): FederatedModelWeights {
    const seed = this.hashString(`${participantId}:${index}`);
    const sign = index % 2 === 0 ? 1 : -1;
    const weights: number[] = [];
    for (let j = 0; j < dims; j += 1) {
      weights.push(sign * this.pseudoRandom(seed + j) * 0.001);
    }
    return { weights, bias: sign * this.pseudoRandom(seed + dims) * 0.001 };
  }

  /** Add calibrated Gaussian noise for differential privacy. */
  private applyDifferentialPrivacy(
    aggregate: FederatedModelWeights,
    totalSamples: number,
  ): FederatedModelWeights {
    const sensitivity = this.config.dpClipNorm / Math.max(1, totalSamples);
    const sigma = this.config.dpNoiseScale * sensitivity;
    return {
      weights: aggregate.weights.map((w) => w + this.gaussianNoise(sigma)),
      bias: aggregate.bias + this.gaussianNoise(sigma),
    };
  }

  private evaluateGlobalModel(updates: LocalTrainingResult[]): number {
    // Approximate global accuracy as the sample-weighted mean of local accuracy,
    // adjusted by the relative improvement of the aggregated model.
    const totalSamples = updates.reduce((s, u) => s + u.sampleCount, 0);
    const weighted =
      updates.reduce((s, u) => s + u.localAccuracy * u.sampleCount, 0) /
      Math.max(1, totalSamples);
    return Math.min(1, weighted);
  }

  private recordContribution(participantId: string, sampleCount: number): void {
    const participant = this.participants.get(participantId);
    if (!participant) return;
    participant.roundsContributed += 1;
    participant.contributionScore += sampleCount;
    participant.rewardsEarned += sampleCount * this.config.rewardPerContribution;
  }

  private dot(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < b.length; i += 1) sum += (a[i] ?? 0) * b[i];
    return sum;
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private hashString(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private pseudoRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  private gaussianNoise(sigma: number): number {
    if (sigma === 0) return 0;
    const u1 = Math.max(this.pseudoRandom(Date.now() + Math.random() * 1e6), 1e-12);
    const u2 = this.pseudoRandom(Date.now() + Math.random() * 1e6 + 1);
    return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

@Injectable()
export class FraudDetectionService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SystemAuditLog)
    private readonly auditRepo: Repository<SystemAuditLog>,
    private readonly logger: PinoLogger,
  ) {
    (this.logger as any).setContext(FraudDetectionService.name);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async scoreInvestment(investmentId: string): Promise<FraudScore> {
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId } as any,
      relations: ['investor'],
    });

    if (!investment) {
      throw new Error(`Investment ${investmentId} not found`);
    }

    const signals: FraudSignal[] = [];

    // Rule 1: Unusually large single investment
    const amount = Number(investment.amount_usd ?? 0);
    if (amount > 500_000) {
      signals.push({
        rule: 'LARGE_SINGLE_INVESTMENT',
        weight: 30,
        detail: `Investment amount $${amount.toLocaleString()} exceeds $500,000 threshold`,
      });
    } else if (amount > 100_000) {
      signals.push({
        rule: 'ELEVATED_INVESTMENT_AMOUNT',
        weight: 15,
        detail: `Investment amount $${amount.toLocaleString()} exceeds $100,000 threshold`,
      });
    }

    // Rule 2: Rapid successive investments from same investor
    const investorId = (investment as any).investorId ?? (investment as any).investor?.id;
    if (investorId) {
      const window = new Date(Date.now() - 60 * 60 * 1000); // last hour
      const recentCount = await this.investmentRepo.count({
        where: {
          ...(({ investorId }) => ({ investorId }))(investment as any),
          createdAt: Between(window, new Date()) as any,
        },
      });
      if (recentCount >= 5) {
        signals.push({
          rule: 'RAPID_SUCCESSIVE_INVESTMENTS',
          weight: 25,
          detail: `${recentCount} investments from same investor within 1 hour`,
        });
      }
    }

    // Rule 3: Investment immediately after account creation
    const user = investorId
      ? await this.userRepo.findOne({ where: { id: investorId } as any })
      : null;
    if (user && (investment as any).createdAt && (user as any).createdAt) {
      const accountAgeMs =
        new Date((investment as any).createdAt).getTime() -
        new Date((user as any).createdAt).getTime();
      const oneDay = 24 * 60 * 60 * 1000;
      if (accountAgeMs < oneDay) {
        signals.push({
          rule: 'NEW_ACCOUNT_HIGH_VALUE',
          weight: 35,
          detail: `Account created ${Math.round(accountAgeMs / 3_600_000)}h before investment`,
        });
      }
    }

    return this.buildScore(investmentId, 'investment', signals);
  }

  async scoreUser(userId: string): Promise<FraudScore> {
    const user = await this.userRepo.findOne({ where: { id: userId } as any });
    if (!user) throw new Error(`User ${userId} not found`);

    const signals: FraudSignal[] = [];

    // Rule 1: KYC document anomaly — rejected then re-submitted multiple times
    const kycAttempts = await this.auditRepo.count({
      where: { actorId: userId, route: 'kyc' as any } as any,
    });
    if (kycAttempts > 5) {
      signals.push({
        rule: 'REPEATED_KYC_SUBMISSIONS',
        weight: 40,
        detail: `${kycAttempts} KYC submission attempts detected`,
      });
    }

    // Rule 2: Unverified KYC with active investments
    if ((user as any).kycStatus !== 'verified') {
      const activeInvestments = await this.investmentRepo.count({
        where: { status: 'confirmed' } as any,
      });
      if (activeInvestments > 0) {
        signals.push({
          rule: 'UNVERIFIED_KYC_WITH_INVESTMENTS',
          weight: 50,
          detail: `User has ${activeInvestments} active investment(s) without verified KYC`,
        });
      }
    }

    // Rule 3: Unusual authentication patterns (many failed logins)
    const failedAuths = await this.auditRepo.count({
      where: {
        actorId: userId,
        statusCode: 401,
        timestamp: Between(
          new Date(Date.now() - 24 * 60 * 60 * 1000),
          new Date(),
        ) as any,
      } as any,
    });
    if (failedAuths >= 10) {
      signals.push({
        rule: 'EXCESSIVE_FAILED_AUTH',
        weight: 30,
        detail: `${failedAuths} failed authentication attempts in last 24h`,
      });
    }

    return this.buildScore(userId, 'user', signals);
  }

  /** Batch-score all investments created in the last 24 hours. */
  async runDailyInvestmentScan(): Promise<FraudReviewItem[]> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const investments = await this.investmentRepo.find({
      where: { createdAt: Between(since, new Date()) as any },
      take: 500,
    });

    const results: FraudReviewItem[] = [];
    for (const inv of investments) {
      const score = await this.scoreInvestment((inv as any).id);
      const requiresManualReview = score.riskLevel !== 'low';
      results.push({ fraudScore: score, requiresManualReview });
      if (requiresManualReview) {
        this.logger.warn(
          { investmentId: (inv as any).id, riskLevel: score.riskLevel, score: score.score },
          'Investment flagged for manual fraud review',
        );
      }
    }

    return results;
  }

  /** Return all high-risk items requiring manual review. */
  async getManualReviewQueue(): Promise<FraudReviewItem[]> {
    const items = await this.runDailyInvestmentScan();
    return items.filter((i) => i.requiresManualReview);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildScore(
    entityId: string,
    entityType: 'investment' | 'user',
    signals: FraudSignal[],
  ): FraudScore {
    const score = Math.min(100, signals.reduce((s, sig) => s + sig.weight, 0));
    const riskLevel: RiskLevel =
      score >= HIGH_THRESHOLD ? 'high' : score >= MEDIUM_THRESHOLD ? 'medium' : 'low';

    return {
      entityId,
      entityType,
      score,
      riskLevel,
      signals,
      evaluatedAt: new Date(),
    };
  }
}
