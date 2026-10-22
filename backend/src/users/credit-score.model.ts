/**
 * The farmer credit scoring model (#1160).
 *
 * Everything in this file is a pure function or a constant, with no Nest
 * or TypeORM dependencies, so the scoring rules can be reasoned about and
 * tested on their own.
 */

/** Credit tier bands. Boundaries follow issue #1160. */
export type CreditScoreTier = 'Excellent' | 'Good' | 'Fair' | 'Poor';

/**
 * The canonical factor set every score is computed from.
 *
 * #1160 extends the #1016 model with two dimensions that the issue names
 * explicitly — shipment accuracy and document quality — and folds the
 * repayment signal into a single repayment-history factor.
 */
export interface ScoreFactorsInput {
  /** Share of deliveries that landed on or before the contractual date. */
  onTimeRepaymentRate: number; // 0.0 to 1.0
  /** Share of closed deals that reached settlement. */
  dealCompletionRate: number; // 0.0 to 1.0
  /** Share of the farmer's obligations that went unfulfilled. */
  dealDefaultRate: number; // 0.0 to 1.0 (inverted when scoring)
  /** Share of shipments with a complete, gap-free milestone chain. */
  shipmentMilestoneComplianceRate: number; // 0.0 to 1.0
  /** Share of recorded milestones confirmed accurate by a verifier. */
  shipmentAccuracyRate: number; // 0.0 to 1.0
  /** Share of reviewed documents that passed verification review. */
  documentQualityRate: number; // 0.0 to 1.0
  /** Days since the farmer's KYC submission was approved. */
  kycVerificationAgeDays: number; // days since verified, normalized up to 365
}

/**
 * Shape actually stored in `farmer_credit_score_history.factors`.
 *
 * Rows written before #1160 predate the shipment-accuracy and
 * document-quality dimensions, so every key has to be treated as optional
 * when reading them back.
 */
export type PersistedScoreFactors = Partial<ScoreFactorsInput>;

/**
 * Weighted scoring model. The weights sum to exactly 1.0 so the weighted
 * sum maps linearly onto the 300-850 range.
 */
export const FACTOR_WEIGHTS = {
  /** On-time delivery rate — the core promise of an agricultural exporter. */
  onTimeRepayment: 0.25,
  /** Repayment history (inverted default rate) — a direct credit signal. */
  defaultRate: 0.20,
  /** Deal completion rate — evidence the farmer finishes what they start. */
  dealCompletion: 0.15,
  /** Shipment accuracy — milestones confirmed accurate by a verifier. */
  shipmentAccuracy: 0.15,
  /** Shipment milestone compliance — complete, gap-free milestone chains. */
  shipmentMilestone: 0.10,
  /** Document quality — the paperwork backing the trade. */
  documentQuality: 0.10,
  /** KYC tenure — how long the farmer has been a verified counterparty. */
  kycAge: 0.05,
} as const;

/**
 * Value used for a dimension we have no evidence for. A missing dimension
 * must never be a free pass, so it scores as the neutral midpoint rather
 * than as a perfect (or failing) result.
 */
export const NEUTRAL_FACTOR_VALUES: ScoreFactorsInput = {
  onTimeRepaymentRate: 0.5,
  dealCompletionRate: 0.5,
  dealDefaultRate: 0.5,
  shipmentMilestoneComplianceRate: 0.5,
  shipmentAccuracyRate: 0.5,
  documentQualityRate: 0.5,
  kycVerificationAgeDays: 0,
};

export const CREDIT_SCORE_MIN = 300;
export const CREDIT_SCORE_MAX = 850;
export const CREDIT_SCORE_SPAN = CREDIT_SCORE_MAX - CREDIT_SCORE_MIN;

/**
 * Fills any missing factor with its neutral value. Used when reading
 * history rows written before #1160, whose persisted JSON predates the
 * shipment-accuracy and document-quality dimensions.
 */
export function normalizeFactors(
  factors: PersistedScoreFactors,
): ScoreFactorsInput {
  return {
    onTimeRepaymentRate:
      factors.onTimeRepaymentRate ?? NEUTRAL_FACTOR_VALUES.onTimeRepaymentRate,
    dealCompletionRate:
      factors.dealCompletionRate ?? NEUTRAL_FACTOR_VALUES.dealCompletionRate,
    dealDefaultRate:
      factors.dealDefaultRate ?? NEUTRAL_FACTOR_VALUES.dealDefaultRate,
    shipmentMilestoneComplianceRate:
      factors.shipmentMilestoneComplianceRate ??
      NEUTRAL_FACTOR_VALUES.shipmentMilestoneComplianceRate,
    shipmentAccuracyRate:
      factors.shipmentAccuracyRate ?? NEUTRAL_FACTOR_VALUES.shipmentAccuracyRate,
    documentQualityRate:
      factors.documentQualityRate ?? NEUTRAL_FACTOR_VALUES.documentQualityRate,
    kycVerificationAgeDays:
      factors.kycVerificationAgeDays ??
      NEUTRAL_FACTOR_VALUES.kycVerificationAgeDays,
  };
}

/**
 * Credit tier for a score. Bands follow issue #1160:
 * excellent 750+, good 700-749, fair 650-699, poor below 650.
 */
export function creditTierForScore(score: number): CreditScoreTier {
  if (score >= 750) return 'Excellent';
  if (score >= 700) return 'Good';
  if (score >= 650) return 'Fair';
  return 'Poor';
}

/**
 * The uncollateralized deal ceiling a farmer may be offered at this
 * score. Bands are aligned with the credit tiers so a farmer can only
 * graduate to a higher ceiling by reaching the next tier.
 */
export function maxDealSizeForScore(score: number): number {
  if (score < 650) {
    return 10000; // $10K — Poor tier
  } else if (score < 750) {
    return 50000; // $50K — Fair and Good tiers
  } else {
    return 200000; // $200K — Excellent tier
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Maps the weighted factor sum onto the 300-850 credit range.
 *
 * Every factor is clamped to [0, 1] before it is weighted, so a bad input
 * can never push the score outside the published range.
 */
export function calculateScoreFromFactors(factors: ScoreFactorsInput): number {
  const f = normalizeFactors(factors);

  const repaymentComponent =
    clamp01(f.onTimeRepaymentRate) * FACTOR_WEIGHTS.onTimeRepayment;
  const completionComponent =
    clamp01(f.dealCompletionRate) * FACTOR_WEIGHTS.dealCompletion;
  // Repayment history: a zero default rate is a perfect repayment record.
  const defaultComponent =
    (1 - clamp01(f.dealDefaultRate)) * FACTOR_WEIGHTS.defaultRate;
  const milestoneComponent =
    clamp01(f.shipmentMilestoneComplianceRate) * FACTOR_WEIGHTS.shipmentMilestone;
  const accuracyComponent =
    clamp01(f.shipmentAccuracyRate) * FACTOR_WEIGHTS.shipmentAccuracy;
  const documentComponent =
    clamp01(f.documentQualityRate) * FACTOR_WEIGHTS.documentQuality;

  // Normalize KYC age: 365 days or more gives full 1.0
  const kycNormalized = Math.min(Math.max(f.kycVerificationAgeDays, 0) / 365, 1);
  const kycComponent = kycNormalized * FACTOR_WEIGHTS.kycAge;

  const weightedScore =
    repaymentComponent +
    completionComponent +
    defaultComponent +
    milestoneComponent +
    accuracyComponent +
    documentComponent +
    kycComponent;

  const score = Math.round(CREDIT_SCORE_MIN + weightedScore * CREDIT_SCORE_SPAN);
  return Math.min(Math.max(score, CREDIT_SCORE_MIN), CREDIT_SCORE_MAX);
}
