/**
 * Haptic feedback and tactile UI service for Agri-Fi.
 *
 * Provides physical vibration patterns, tactile responses for UI interactions,
 * accessibility fallbacks, and customizable intensity settings.
 */

export type HapticPatternType =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error'
  | 'selection';

export type HapticIntensity = 'off' | 'light' | 'medium' | 'strong';

export interface HapticConfig {
  enabled: boolean;
  intensity: HapticIntensity;
  fallbackAudio: boolean;
  trackAnalytics: boolean;
}

export interface HapticAnalyticsEvent {
  pattern: HapticPatternType;
  durationMs: number;
  timestamp: number;
  supported: boolean;
}

export const HAPTIC_PATTERNS: Record<HapticPatternType, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  selection: 5,
  success: [15, 40, 25],
  warning: [30, 30, 30],
  error: [50, 40, 50, 40, 75],
};

const INTENSITY_MULTIPLIERS: Record<HapticIntensity, number> = {
  off: 0,
  light: 0.6,
  medium: 1.0,
  strong: 1.5,
};

class HapticFeedbackService {
  private config: HapticConfig = {
    enabled: true,
    intensity: 'medium',
    fallbackAudio: false,
    trackAnalytics: true,
  };

  private analyticsHistory: HapticAnalyticsEvent[] = [];

  constructor() {
    this.loadPreferences();
  }

  /**
   * Checks whether the current device supports the Web Vibration API.
   */
  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'navigator' in window && typeof navigator.vibrate === 'function';
  }

  /**
   * Updates user preferences for haptic feedback.
   */
  public updateConfig(newConfig: Partial<HapticConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.savePreferences();
  }

  public getConfig(): Readonly<HapticConfig> {
    return { ...this.config };
  }

  /**
   * Triggers a tactile haptic pattern.
   * Returns true if vibration was successfully dispatched.
   */
  public trigger(pattern: HapticPatternType = 'light'): boolean {
    if (!this.config.enabled || this.config.intensity === 'off') {
      return false;
    }

    const multiplier = INTENSITY_MULTIPLIERS[this.config.intensity];
    const rawPattern = HAPTIC_PATTERNS[pattern] || HAPTIC_PATTERNS.light;

    let adjustedPattern: number | number[];
    let totalDuration = 0;

    if (Array.isArray(rawPattern)) {
      adjustedPattern = rawPattern.map((ms, idx) => {
        // Only scale vibration active intervals (even indices in vibration pattern arrays)
        const scaled = idx % 2 === 0 ? Math.round(ms * multiplier) : ms;
        totalDuration += scaled;
        return scaled;
      });
    } else {
      adjustedPattern = Math.round(rawPattern * multiplier);
      totalDuration = adjustedPattern;
    }

    const supported = this.isSupported();

    if (this.config.trackAnalytics) {
      this.analyticsHistory.push({
        pattern,
        durationMs: totalDuration,
        timestamp: Date.now(),
        supported,
      });

      // Keep recent history bounded
      if (this.analyticsHistory.length > 200) {
        this.analyticsHistory.shift();
      }
    }

    if (!supported) {
      return false;
    }

    try {
      return navigator.vibrate(adjustedPattern);
    } catch {
      return false;
    }
  }

  /**
   * Returns recorded haptic analytics metrics.
   */
  public getAnalytics(): {
    totalEvents: number;
    usageByPattern: Record<string, number>;
    supportedRate: number;
  } {
    const usage: Record<string, number> = {};
    let supportedCount = 0;

    for (const event of this.analyticsHistory) {
      usage[event.pattern] = (usage[event.pattern] || 0) + 1;
      if (event.supported) supportedCount++;
    }

    return {
      totalEvents: this.analyticsHistory.length,
      usageByPattern: usage,
      supportedRate: this.analyticsHistory.length ? supportedCount / this.analyticsHistory.length : 0,
    };
  }

  public clearAnalytics(): void {
    this.analyticsHistory = [];
  }

  private loadPreferences(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const stored = localStorage.getItem('agri_haptic_preferences');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.config = { ...this.config, ...parsed };
      }
    } catch {
      // Ignore storage errors
    }
  }

  private savePreferences(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem('agri_haptic_preferences', JSON.stringify(this.config));
    } catch {
      // Ignore storage errors
    }
  }
}

export const hapticService = new HapticFeedbackService();
