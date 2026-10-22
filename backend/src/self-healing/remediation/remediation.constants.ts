import type { RemediationActionType } from '../entities/remediation-action.entity';

/**
 * Manual effort, in minutes, that each remediation action type replaces.
 * Used to estimate the operator time that the automation saved.
 */
export const MANUAL_EFFORT_MINUTES: Record<RemediationActionType, number> = {
  restart_pod: 15,
  restart_service: 30,
  scale_up: 20,
  scale_down: 30,
  cleanup_disk: 45,
  custom_script: 25,
  manual: 60,
};

/** Default mean time to recovery used as the manual baseline. */
export const DEFAULT_BASELINE_MTTR_MINUTES = 120;
