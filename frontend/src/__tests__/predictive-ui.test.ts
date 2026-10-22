import { describe, it, expect, beforeEach } from 'vitest';
import { PredictiveUIEngine } from '../lib/predictive/predictiveEngine';

describe('Predictive User Interface (#1202)', () => {
  let engine: PredictiveUIEngine;

  beforeEach(() => {
    engine = new PredictiveUIEngine();
    engine.clearHistory();
  });

  it('provides default contextual predictions before recording user actions', () => {
    const predictions = engine.predictNextActions('deals');
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions.some((p) => p.targetActionId === 'create_investment')).toBe(true);
  });

  it('learns user workflow patterns and assigns higher confidence to frequent transitions', () => {
    // Train the engine: in 'deals' context, 'view_deal_detail' is frequently followed by 'invest_deal'
    engine.recordAction('view_deal_detail', 'deals');
    engine.recordAction('invest_deal', 'deals');

    engine.recordAction('view_deal_detail', 'deals');
    engine.recordAction('invest_deal', 'deals');

    engine.recordAction('view_deal_detail', 'deals');
    engine.recordAction('bookmark_deal', 'deals');

    const next = engine.predictNextActions('deals', 'view_deal_detail');
    expect(next.length).toBeGreaterThan(0);
    expect(next[0].targetActionId).toBe('invest_deal');
    // 2 out of 3 = ~0.67
    expect(next[0].confidence).toBeGreaterThan(0.6);
  });

  it('adjusts weights when suggestions are dismissed', () => {
    engine.recordAction('action_a', 'test_context');
    engine.recordAction('action_b', 'test_context');

    const before = engine.predictNextActions('test_context', 'action_a');
    expect(before.some((p) => p.targetActionId === 'action_b')).toBe(true);

    engine.onPredictionDismissed('test_context', 'action_b');
    const after = engine.predictNextActions('test_context', 'action_a');
    expect(after.some((p) => p.targetActionId === 'action_b')).toBe(false);
  });

  it('tracks accuracy and estimated minutes saved in analytics', () => {
    engine.recordAction('start', 'ctx');
    engine.recordAction('finish', 'ctx');

    engine.predictNextActions('ctx', 'start');
    engine.onPredictionAccepted('ctx', 'finish');

    const analytics = engine.getAnalytics();
    expect(analytics.totalSuggestions).toBe(1);
    expect(analytics.acceptedSuggestions).toBe(1);
    expect(analytics.accuracyRate).toBe(1);
    expect(analytics.estimatedMinutesSaved).toBe(0.5);
  });
});
