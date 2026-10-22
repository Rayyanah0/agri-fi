# Haptic Feedback and Tactile UI

This document outlines the haptic feedback architecture and tactile UI integration in Agri-Fi (#1200).

## Overview

Physical haptic responses confirm user actions and provide non-visual cues for accessibility.

## Supported Patterns

- `light`: Quick 10ms tap for selection changes or minor toggles.
- `medium`: 25ms pulse for standard button presses.
- `heavy`: 50ms pulse for irreversible operations or primary dispatches.
- `selection`: Ultra-short 5ms tick for list or slider scrubbing.
- `success`: Multi-pulse pattern `[15ms, 40ms, 25ms]` confirming transaction completion.
- `warning`: Pattern `[30ms, 30ms, 30ms]` indicating thresholds or cautions.
- `error`: Distinct `[50ms, 40ms, 50ms, 40ms, 75ms]` pattern signaling validation or network failures.

## Usage

### Hook

```tsx
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

export function InvestmentModal() {
  const { trigger, intensity, setIntensity } = useHapticFeedback();

  const handleConfirm = () => {
    trigger('success');
  };

  return <button onClick={handleConfirm}>Confirm</button>;
}
```

### Tactile Component

```tsx
import { TactileButton } from '@/components/common/TactileButton';

<TactileButton hapticPattern="medium" tactileVariant="raised" onClick={handleSubmit}>
  Submit Deal
</TactileButton>
```

## Accessibility and Fallbacks

Devices lacking the Web Vibration API gracefully degrade with zero errors. Analytics metrics monitor utilization patterns without capturing personal data.
