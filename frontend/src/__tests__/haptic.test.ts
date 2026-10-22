import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  hapticService,
  HAPTIC_PATTERNS,
} from '../lib/haptic/hapticFeedback';

describe('Haptic Feedback and Tactile UI (#1200)', () => {
  beforeEach(() => {
    hapticService.clearAnalytics();
    hapticService.updateConfig({ enabled: true, intensity: 'medium' });
    vi.restoreAllMocks();
  });

  it('correctly handles devices without navigator.vibrate fallback', () => {
    // In node/jsdom without mock, vibrate may not exist
    const supported = hapticService.isSupported();
    expect(typeof supported).toBe('boolean');

    const result = hapticService.trigger('light');
    expect(typeof result).toBe('boolean');

    const analytics = hapticService.getAnalytics();
    expect(analytics.totalEvents).toBe(1);
    expect(analytics.usageByPattern.light).toBe(1);
  });

  it('dispatches vibrate pattern with correct scaled timing when navigator.vibrate exists', () => {
    const vibrateMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'vibrate', {
      value: vibrateMock,
      configurable: true,
      writable: true,
    });

    expect(hapticService.isSupported()).toBe(true);

    // Trigger medium intensity
    const res = hapticService.trigger('heavy');
    expect(res).toBe(true);
    expect(vibrateMock).toHaveBeenCalledWith(HAPTIC_PATTERNS.heavy);

    // Change intensity to light (multiplier 0.6)
    hapticService.updateConfig({ intensity: 'light' });
    hapticService.trigger('heavy');
    expect(vibrateMock).toHaveBeenCalledWith(Math.round(Number(HAPTIC_PATTERNS.heavy) * 0.6));
  });

  it('does not trigger vibration when disabled or intensity is off', () => {
    const vibrateMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'vibrate', {
      value: vibrateMock,
      configurable: true,
      writable: true,
    });

    hapticService.updateConfig({ enabled: false });
    const resDisabled = hapticService.trigger('light');
    expect(resDisabled).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();

    hapticService.updateConfig({ enabled: true, intensity: 'off' });
    const resOff = hapticService.trigger('success');
    expect(resOff).toBe(false);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it('accurately accumulates analytics by pattern', () => {
    hapticService.trigger('light');
    hapticService.trigger('light');
    hapticService.trigger('success');
    hapticService.trigger('warning');

    const stats = hapticService.getAnalytics();
    expect(stats.totalEvents).toBe(4);
    expect(stats.usageByPattern.light).toBe(2);
    expect(stats.usageByPattern.success).toBe(1);
    expect(stats.usageByPattern.warning).toBe(1);
  });
});
