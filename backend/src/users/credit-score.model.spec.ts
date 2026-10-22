import {
  calculateScoreFromFactors,
  creditTierForScore,
  FACTOR_WEIGHTS,
  maxDealSizeForScore,
  normalizeFactors,
  NEUTRAL_FACTOR_VALUES,
  ScoreFactorsInput,
} from './credit-score.model';

describe('credit scoring model (#1160)', () => {
  const perfectFactors: ScoreFactorsInput = {
    onTimeRepaymentRate: 1,
    dealCompletionRate: 1,
    dealDefaultRate: 0,
    shipmentMilestoneComplianceRate: 1,
    shipmentAccuracyRate: 1,
    documentQualityRate: 1,
    kycVerificationAgeDays: 365,
  };

  const zeroFactors: ScoreFactorsInput = {
    onTimeRepaymentRate: 0,
    dealCompletionRate: 0,
    dealDefaultRate: 1,
    shipmentMilestoneComplianceRate: 0,
    shipmentAccuracyRate: 0,
    documentQualityRate: 0,
    kycVerificationAgeDays: 0,
  };

  describe('weights', () => {
    it('sum to exactly 1.0', () => {
      const sum = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('weights every documented scoring dimension', () => {
      expect(Object.keys(FACTOR_WEIGHTS).sort()).toEqual(
        [
          'dealCompletion',
          'defaultRate',
          'documentQuality',
          'kycAge',
          'onTimeRepayment',
          'shipmentAccuracy',
          'shipmentMilestone',
        ].sort(),
      );
    });
  });

  describe('calculateScoreFromFactors', () => {
    it('returns the maximum score for a perfect track record', () => {
      expect(calculateScoreFromFactors(perfectFactors)).toBe(850);
    });

    it('returns the minimum score for a failing track record', () => {
      expect(calculateScoreFromFactors(zeroFactors)).toBe(300);
    });

    it('never leaves the published 300-850 range', () => {
      const outOfRange = calculateScoreFromFactors({
        onTimeRepaymentRate: 5,
        dealCompletionRate: 5,
        dealDefaultRate: -3,
        shipmentMilestoneComplianceRate: 99,
        shipmentAccuracyRate: 99,
        documentQualityRate: 99,
        kycVerificationAgeDays: 5000,
      });
      expect(outOfRange).toBe(850);
      expect(outOfRange).toBeLessThanOrEqual(850);
    });

    it('treats a factor with no evidence as neutral rather than perfect', () => {
      // A farmer with no history at all must not land near the top of the
      // range — a missing dimension is not a good one.
      const score = calculateScoreFromFactors({
        ...perfectFactors,
        onTimeRepaymentRate: NEUTRAL_FACTOR_VALUES.onTimeRepaymentRate,
        dealCompletionRate: NEUTRAL_FACTOR_VALUES.dealCompletionRate,
        dealDefaultRate: NEUTRAL_FACTOR_VALUES.dealDefaultRate,
        shipmentMilestoneComplianceRate:
          NEUTRAL_FACTOR_VALUES.shipmentMilestoneComplianceRate,
        shipmentAccuracyRate: NEUTRAL_FACTOR_VALUES.shipmentAccuracyRate,
        documentQualityRate: NEUTRAL_FACTOR_VALUES.documentQualityRate,
        kycVerificationAgeDays: 0,
      });
      expect(score).toBeGreaterThanOrEqual(300);
      expect(score).toBeLessThan(600);
    });

    it('rewards a higher repayment history', () => {
      const clean = calculateScoreFromFactors({ ...perfectFactors, dealDefaultRate: 0 });
      const dirty = calculateScoreFromFactors({ ...perfectFactors, dealDefaultRate: 0.5 });
      expect(clean).toBeGreaterThan(dirty);
    });
  });

  describe('normalizeFactors', () => {
    it('fills the dimensions that pre-date #1160 with neutral values', () => {
      const normalized = normalizeFactors({
        onTimeRepaymentRate: 0.9,
        dealCompletionRate: 0.8,
        dealDefaultRate: 0.1,
        shipmentMilestoneComplianceRate: 0.7,
        kycVerificationAgeDays: 200,
      });

      expect(normalized.shipmentAccuracyRate).toBe(
        NEUTRAL_FACTOR_VALUES.shipmentAccuracyRate,
      );
      expect(normalized.documentQualityRate).toBe(
        NEUTRAL_FACTOR_VALUES.documentQualityRate,
      );
    });

    it('leaves a complete factor set untouched', () => {
      expect(normalizeFactors(perfectFactors)).toEqual(perfectFactors);
    });
  });

  describe('creditTierForScore', () => {
    it('uses the tier bands from #1160', () => {
      expect(creditTierForScore(850)).toBe('Excellent');
      expect(creditTierForScore(750)).toBe('Excellent');
      expect(creditTierForScore(749)).toBe('Good');
      expect(creditTierForScore(700)).toBe('Good');
      expect(creditTierForScore(699)).toBe('Fair');
      expect(creditTierForScore(650)).toBe('Fair');
      expect(creditTierForScore(649)).toBe('Poor');
      expect(creditTierForScore(300)).toBe('Poor');
    });
  });

  describe('maxDealSizeForScore', () => {
    it('aligns the ceiling with the tier bands', () => {
      expect(maxDealSizeForScore(649)).toBe(10000);
      expect(maxDealSizeForScore(650)).toBe(50000);
      expect(maxDealSizeForScore(749)).toBe(50000);
      expect(maxDealSizeForScore(750)).toBe(200000);
    });
  });
});
