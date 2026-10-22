import { ConfigService } from '@nestjs/config';
import { ThrottlerOptions } from '@nestjs/throttler';
import {
  buildThrottlerOptions,
  positiveInt,
  readRateLimitSettings,
} from './rate-limit.config';

function makeConfig(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) => env[key] ?? defaultValue,
  } as unknown as ConfigService;
}

describe('rate limit settings', () => {
  describe('positiveInt', () => {
    it('keeps documented defaults for anything unusable', () => {
      expect(positiveInt(undefined, 5)).toBe(5);
      expect(positiveInt('', 5)).toBe(5);
      expect(positiveInt('abc', 5)).toBe(5);
      expect(positiveInt('0', 5)).toBe(5);
      expect(positiveInt('-3', 5)).toBe(5);
      expect(positiveInt('2.5', 5)).toBe(5);
      expect(positiveInt('NaN', 5)).toBe(5);
    });

    it('accepts positive integers from string or number env values', () => {
      expect(positiveInt('12', 5)).toBe(12);
      expect(positiveInt(' 12 ', 5)).toBe(12);
      expect(positiveInt(7, 5)).toBe(7);
      expect(positiveInt(1, 5)).toBe(1);
    });
  });

  it('falls back to the pre-#790 anonymous numbers', () => {
    const settings = readRateLimitSettings(makeConfig());

    expect(settings.defaultTtlMs).toBe(60_000);
    expect(settings.sensitiveTtlMs).toBe(60_000);
    expect(settings.globalLimit).toBe(100);
    expect(settings.tiers.login).toEqual({ authenticated: 10, anonymous: 5 });
    expect(settings.tiers.kyc).toEqual({ authenticated: 5, anonymous: 3 });
    expect(settings.tiers.password).toEqual({
      authenticated: 10,
      anonymous: 3,
    });
    expect(settings.tiers.mfa).toEqual({ authenticated: 5, anonymous: 3 });
  });

  it('never lets an anonymous tier exceed the authenticated tier', () => {
    const settings = readRateLimitSettings(
      makeConfig({
        RATE_LIMIT_LOGIN_AUTH: '1',
        RATE_LIMIT_LOGIN_ANON: '99',
      }),
    );

    const login = settings.tiers.login;
    expect(login.authenticated).toBe(1);
    expect(login.anonymous).toBeLessThanOrEqual(login.authenticated);
  });

  it('reads the window and the global limit from the environment', () => {
    const settings = readRateLimitSettings(
      makeConfig({
        RATE_LIMIT_TTL: '30000',
        RATE_LIMIT_SENSITIVE_TTL: '120000',
        RATE_LIMIT_GLOBAL: '25',
      }),
    );

    expect(settings.defaultTtlMs).toBe(30_000);
    expect(settings.sensitiveTtlMs).toBe(120_000);
    expect(settings.globalLimit).toBe(25);
  });

  it('registers one throttler per bucket, sensitive limits at the top tier', () => {
    const settings = readRateLimitSettings(makeConfig());
    const throttlers = buildThrottlerOptions(settings) as ThrottlerOptions[];
    const byName = new Map(
      throttlers.map((throttler) => [throttler.name, throttler]),
    );

    expect([...byName.keys()]).toEqual([
      'default',
      'login',
      'kyc',
      'password',
      'mfa',
      'marketplace',
      'public-market',
    ]);
    expect(byName.get('default')).toMatchObject({
      ttl: 60_000,
      limit: 100,
    });
    expect(byName.get('login')).toMatchObject({
      ttl: 60_000,
      limit: settings.tiers.login.authenticated,
    });
    expect(byName.get('marketplace')).toMatchObject({ limit: 60 });
    expect(byName.get('public-market')).toMatchObject({ limit: 120 });
  });
});
