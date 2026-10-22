'use client';

import { useState, useCallback } from 'react';
import {
  hapticService,
  HapticPatternType,
  HapticIntensity,
} from '../lib/haptic/hapticFeedback';

export function useHapticFeedback() {
  const [config, setConfig] = useState(() => hapticService.getConfig());
  const [isSupported] = useState(() => hapticService.isSupported());

  const trigger = useCallback((pattern: HapticPatternType = 'light') => {
    return hapticService.trigger(pattern);
  }, []);

  const setIntensity = useCallback((intensity: HapticIntensity) => {
    hapticService.updateConfig({ intensity });
    setConfig(hapticService.getConfig());
  }, []);

  const toggleEnabled = useCallback((enabled?: boolean) => {
    const nextState = enabled !== undefined ? enabled : !config.enabled;
    hapticService.updateConfig({ enabled: nextState });
    setConfig(hapticService.getConfig());
  }, [config.enabled]);

  return {
    trigger,
    isSupported,
    isEnabled: config.enabled,
    intensity: config.intensity,
    setIntensity,
    toggleEnabled,
  };
}
