import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';

/**
 * Buckets that gate credential and identity changes. Each carries two limits:
 * one for a caller presenting a verifiable JWT, and a stricter one for an
 * anonymous caller keyed by IP.
 */
export const SENSITIVE_BUCKETS = ['login', 'kyc', 'password', 'mfa'] as const;

export type SensitiveBucket = (typeof SENSITIVE_BUCKETS)[number];

export interface RateLimitTier {
  authenticated: number;
  anonymous: number;
}

export interface RateLimitSettings {
  defaultTtlMs: number;
  sensitiveTtlMs: number;
  globalLimit: number;
  tiers: Record<SensitiveBucket, RateLimitTier>;
}

/** Buckets that stay IP-only; their numbers match the pre-#790 defaults. */
const NON_SENSITIVE_TTL_MS = 60_000;
const MARKETPLACE_LIMIT = 60;
const PUBLIC_MARKET_LIMIT = 120;

const DEFAULT_TIERS: Record<SensitiveBucket, RateLimitTier> = {
  login: { authenticated: 10, anonymous: 5 },
  kyc: { authenticated: 5, anonymous: 3 },
  password: { authenticated: 10, anonymous: 3 },
  mfa: { authenticated: 5, anonymous: 3 },
};

/**
 * Environment values arrive as strings and a non-positive or fractional limit
 * would silently disable throttling (`totalHits > NaN` is always false), so
 * anything that is not a positive integer falls back to the documented default.
 */
export function positiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'string' ? Number(value.trim()) : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function tierFromEnv(
  config: ConfigService,
  bucket: SensitiveBucket,
): RateLimitTier {
  const key = bucket.toUpperCase();
  const authenticated = positiveInt(
    config.get(`RATE_LIMIT_${key}_AUTH`),
    DEFAULT_TIERS[bucket].authenticated,
  );
  const anonymous = positiveInt(
    config.get(`RATE_LIMIT_${key}_ANON`),
    DEFAULT_TIERS[bucket].anonymous,
  );
  return {
    authenticated,
    // A misconfigured environment must not end up treating anonymous callers
    // more generously than identified ones.
    anonymous: Math.min(anonymous, authenticated),
  };
}

export function readRateLimitSettings(
  config: ConfigService,
): RateLimitSettings {
  return {
    defaultTtlMs: positiveInt(config.get('RATE_LIMIT_TTL'), 60_000),
    sensitiveTtlMs: positiveInt(config.get('RATE_LIMIT_SENSITIVE_TTL'), 60_000),
    globalLimit: positiveInt(config.get('RATE_LIMIT_GLOBAL'), 100),
    tiers: {
      login: tierFromEnv(config, 'login'),
      kyc: tierFromEnv(config, 'kyc'),
      password: tierFromEnv(config, 'password'),
      mfa: tierFromEnv(config, 'mfa'),
    },
  };
}

/**
 * Registered limits are the authenticated tier; `UserThrottlerGuard` lowers the
 * limit to the anonymous tier when the caller has no verifiable token.
 */
export function buildThrottlerOptions(
  settings: RateLimitSettings,
): ThrottlerModuleOptions {
  const throttlers: ThrottlerOptions[] = [
    {
      name: 'default',
      ttl: settings.defaultTtlMs,
      limit: settings.globalLimit,
    },
    ...SENSITIVE_BUCKETS.map<ThrottlerOptions>((name) => ({
      name,
      ttl: settings.sensitiveTtlMs,
      limit: settings.tiers[name].authenticated,
    })),
    {
      name: 'marketplace',
      ttl: NON_SENSITIVE_TTL_MS,
      limit: MARKETPLACE_LIMIT,
    },
    {
      name: 'public-market',
      ttl: NON_SENSITIVE_TTL_MS,
      limit: PUBLIC_MARKET_LIMIT,
    },
  ];
  return throttlers;
}
