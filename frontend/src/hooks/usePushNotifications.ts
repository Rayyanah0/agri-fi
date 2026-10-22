'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  isPushSupported,
  getPushPermissionStatus,
  registerPushNotifications,
  optInToPush,
  optOutOfPush,
  CONCRETE_PUSH_EVENT_TYPES,
  ConcretePushEventType,
} from '@/lib/pushNotifications';

/**
 * Returns the current auth token if the visitor is authenticated, otherwise null.
 * Anonymous visitors (public pages such as marketplace/landing) have no token and
 * must not attempt authenticated socket registration.
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token =
      window.localStorage.getItem('token') ??
      window.localStorage.getItem('authToken') ??
      window.localStorage.getItem('accessToken');
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export interface UsePushNotificationsOptions {
  enabled?: boolean;
  eventTypes?: (ConcretePushEventType | string)[];
}

export interface UsePushNotificationsReturn {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  /** Whether the current visitor is authenticated (has a token). Anonymous visitors are a no-op. */
  isAuthenticated: boolean;
  optIn: (types?: string[]) => Promise<boolean>;
  optOut: () => Promise<boolean>;
}

/**
 * usePushNotifications
 *
 * Registers the service worker and manages push notifications for concrete event types:
 *  - investment.confirmed
 *  - escrow.released
 *  - kyc.approved
 *
 * Can be used as a side-effect-only hook:
 *   usePushNotifications();
 * Or with control handlers:
 *   const { isSubscribed, optIn, optOut } = usePushNotifications();
 */
export function usePushNotifications(
  optionsOrEnabled: boolean | UsePushNotificationsOptions = true,
): UsePushNotificationsReturn {
  const options =
    typeof optionsOrEnabled === 'boolean'
      ? { enabled: optionsOrEnabled, eventTypes: [...CONCRETE_PUSH_EVENT_TYPES] }
      : {
          enabled: optionsOrEnabled.enabled ?? true,
          eventTypes: optionsOrEnabled.eventTypes ?? [...CONCRETE_PUSH_EVENT_TYPES],
        };

  const attempted = useRef(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const isSupported = isPushSupported();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => getAuthToken() !== null);

  useEffect(() => {
    setPermission(getPushPermissionStatus());
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(sub !== null);
        });
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    if (attempted.current) return;
    if (!isSupported) return;

    // Anonymous visitors (public pages) must not attempt authenticated socket
    // registration: treat as a no-op instead of triggering auth errors and a
    // reconnect loop that floods the logs.
    if (getAuthToken() === null) {
      setIsAuthenticated(false);
      return;
    }
    setIsAuthenticated(true);

    attempted.current = true;

    // Fire-and-forget default registration for high-value events
    registerPushNotifications(options.eventTypes).then((success) => {
      setIsSubscribed(success);
      setPermission(getPushPermissionStatus());
    }).catch(() => {
      // Silently swallow failures
    });
  }, [options.enabled, isSupported, options.eventTypes]);

  const optIn = useCallback(async (types?: string[]) => {
    // No-op for anonymous visitors: avoid socket auth errors / reconnect loops.
    if (getAuthToken() === null) {
      setIsAuthenticated(false);
      return false;
    }
    setIsAuthenticated(true);
    const targetTypes = types ?? options.eventTypes;
    const success = await optInToPush(targetTypes);
    setIsSubscribed(success);
    setPermission(getPushPermissionStatus());
    return success;
  }, [options.eventTypes]);

  const optOut = useCallback(async () => {
    const success = await optOutOfPush();
    if (success) {
      setIsSubscribed(false);
    }
    return success;
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    isAuthenticated,
    optIn,
    optOut,
  };
}
