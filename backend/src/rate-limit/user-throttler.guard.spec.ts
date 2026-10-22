import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerOptions, ThrottlerStorageService } from '@nestjs/throttler';
import {
  RateLimitSettings,
  buildThrottlerOptions,
  readRateLimitSettings,
} from './rate-limit.config';
import { UserThrottlerGuard } from './user-throttler.guard';

const JWT_SECRET = 'rate-limit-test-secret';
const WINDOW_MS = 60_000;

class AuthController {
  login() {}
  changePassword() {}
}

interface Hit {
  allowed: boolean;
  status?: number;
  retryAfter?: string;
}

interface Harness {
  settings: RateLimitSettings;
  jwt: JwtService;
  hit: (req: Record<string, any>) => Promise<Hit>;
  hits: (req: Record<string, any>, times: number) => Promise<Hit[]>;
  chain: (requests: Array<Record<string, any>>) => Promise<Hit[]>;
}

function makeConfig(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, defaultValue?: string) => env[key] ?? defaultValue,
  } as unknown as ConfigService;
}

async function harness(
  env: Record<string, string> = {},
  buckets: string[] = ['login'],
): Promise<Harness> {
  const config = makeConfig(env);
  const settings = readRateLimitSettings(config);
  const throttlers = (
    buildThrottlerOptions(settings) as ThrottlerOptions[]
  ).filter((throttler) => buckets.includes(String(throttler.name)));

  const jwt = new JwtService({
    secret: JWT_SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const guard = new UserThrottlerGuard(
    throttlers,
    newStorage(),
    new Reflector(),
    jwt,
    config,
  );
  await guard.onModuleInit();

  const hit = async (req: Record<string, any>): Promise<Hit> => {
    const headers: Record<string, string> = {};
    const res = {
      header: (name: string, value: unknown) => {
        headers[name] = String(value);
        return res;
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getClass: () => AuthController,
      getHandler: () => AuthController.prototype.login,
    } as unknown as ExecutionContext;

    try {
      return { allowed: await guard.canActivate(context) };
    } catch (error) {
      if (error instanceof HttpException) {
        return {
          allowed: false,
          status: error.getStatus(),
          retryAfter: headers['Retry-After'],
        };
      }
      throw error;
    }
  };

  const hits = async (req: Record<string, any>, times: number) => {
    const results: Hit[] = [];
    for (let index = 0; index < times; index += 1) {
      results.push(await hit(req));
    }
    return results;
  };

  const chain = async (requests: Array<Record<string, any>>) => {
    const results: Hit[] = [];
    for (const request of requests) {
      results.push(await hit(request));
    }
    return results;
  };

  return { settings, jwt, hit, hits, chain };
}

function anonymousRequest(ip = '198.51.100.20'): Record<string, any> {
  return { ip, headers: {} };
}

function bearerRequest(
  sub: string,
  ip = '198.51.100.20',
  secret = JWT_SECRET,
): Record<string, any> {
  const token = new JwtService({ secret }).sign(
    { sub, role: 'investor' },
    { expiresIn: '1h' },
  );
  return { ip, headers: { authorization: `Bearer ${token}` } };
}

function forwardRequest(clientIp: string): Record<string, any> {
  return {
    ip: '10.0.0.1',
    headers: { 'x-forwarded-for': `${clientIp}, 10.0.0.2` },
  };
}

function withToken(req: Record<string, any>, token: string) {
  return { ...req, headers: { ...req.headers, authorization: token } };
}

/** Every storage instance schedules ttl timers that need clearing. */
const storages: ThrottlerStorageService[] = [];

function newStorage(): ThrottlerStorageService {
  const storage = new ThrottlerStorageService();
  storages.push(storage);
  return storage;
}

afterEach(() => {
  storages.splice(0).forEach((storage) => storage.onApplicationShutdown());
});

describe('UserThrottlerGuard', () => {
  it('lets an anonymous caller reach the anonymous tier and blocks the next hit', async () => {
    const { settings, hits } = await harness();
    const tier = settings.tiers.login.anonymous;

    const attempts = await hits(anonymousRequest(), tier + 1);

    expect(attempts.slice(0, tier).every((attempt) => attempt.allowed)).toBe(
      true,
    );
    expect(attempts[tier].allowed).toBe(false);
    expect(attempts[tier].status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('answers a breach with a positive Retry-After inside the window', async () => {
    const { settings, hits } = await harness();
    const attempts = await hits(
      anonymousRequest(),
      settings.tiers.login.anonymous + 1,
    );
    const blocked = attempts[attempts.length - 1];
    const retryAfter = Number(blocked.retryAfter);

    expect(blocked.retryAfter).toBeDefined();
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_MS / 1000);
  });

  it('does not send Retry-After while the caller stays inside the tier', async () => {
    const { hit } = await harness();

    const allowed = await hit(anonymousRequest());

    expect(allowed.allowed).toBe(true);
    expect(allowed.retryAfter).toBeUndefined();
  });

  it('grants a verified caller the authenticated tier, keyed by JWT sub', async () => {
    const { settings, hits } = await harness();
    const tier = settings.tiers.login.authenticated;

    const attempts = await hits(bearerRequest('user-verified'), tier + 1);

    expect(attempts.slice(0, tier).every((attempt) => attempt.allowed)).toBe(
      true,
    );
    expect(attempts[tier].status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('gives two verified users behind one egress IP independent budgets', async () => {
    const { settings, hits, hit } = await harness();
    const ip = '198.51.100.3';
    const tier = settings.tiers.login.authenticated;

    expect(
      (await hits(bearerRequest('user-a', ip), tier)).every(
        (attempt) => attempt.allowed,
      ),
    ).toBe(true);
    expect((await hits(bearerRequest('user-a', ip), 1))[0].status).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect((await hit(bearerRequest('user-b', ip))).allowed).toBe(true);
  });

  it('falls back to the stricter IP bucket for a token signed with another secret', async () => {
    const { settings, hits } = await harness();
    const tier = settings.tiers.login.anonymous;

    const attempts = await hits(
      bearerRequest('victim-sub', '198.51.100.40', 'attacker-secret'),
      tier + 1,
    );

    expect(attempts.slice(0, tier).every((attempt) => attempt.allowed)).toBe(
      true,
    );
    expect(attempts[tier].status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('treats an expired token as anonymous instead of throwing', async () => {
    const { settings, jwt, hits } = await harness();
    const tier = settings.tiers.login.anonymous;
    const expired = jwt.sign({ sub: 'user-expired' }, { expiresIn: -10 });

    const attempts = await hits(
      withToken(anonymousRequest('198.51.100.41'), `Bearer ${expired}`),
      tier + 1,
    );

    expect(attempts[tier].status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('treats a verified token without a usable sub as anonymous', async () => {
    const { settings, jwt, hits } = await harness();
    const tier = settings.tiers.login.anonymous;
    const noSub = jwt.sign({ role: 'investor' }, { expiresIn: '1h' });

    const attempts = await hits(
      withToken(anonymousRequest('198.51.100.42'), `Bearer ${noSub}`),
      tier + 1,
    );

    expect(attempts[tier].status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('ignores X-Forwarded-For unless TRUST_PROXY is enabled', async () => {
    const { settings, chain } = await harness();
    const tier = settings.tiers.login.anonymous;
    const spoofed = Array.from({ length: tier + 1 }, (_unused, index) => ({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': `203.0.113.${index + 1}` },
    }));

    const attempts = await chain(spoofed);

    expect(attempts[tier].status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('separates anonymous budgets by client address when TRUST_PROXY is enabled', async () => {
    const { settings, hit, chain } = await harness({ TRUST_PROXY: 'true' });
    const tier = settings.tiers.login.anonymous;

    const first = await chain([
      forwardRequest('203.0.113.1'),
      forwardRequest('203.0.113.1'),
    ]);
    expect(first.every((attempt) => attempt.allowed)).toBe(true);
    expect((await hit(forwardRequest('203.0.113.2'))).allowed).toBe(true);

    const rest = await chain(
      Array.from({ length: tier - 2 }, () => forwardRequest('203.0.113.1')),
    );
    expect(rest.every((attempt) => attempt.allowed)).toBe(true);
    expect((await hit(forwardRequest('203.0.113.1'))).status).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('uses the left-most entry of a proxy chain when TRUST_PROXY is enabled', async () => {
    const { settings, hit } = await harness({ TRUST_PROXY: 'true' });
    const tier = settings.tiers.login.anonymous;
    const chainHeader = {
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.110.11, 10.0.0.5' },
    };

    for (let index = 0; index < tier; index += 1) {
      expect((await hit(chainHeader)).allowed).toBe(true);
    }
    expect((await hit(chainHeader)).status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((await hit(forwardRequest('198.51.100.80'))).allowed).toBe(true);
  });

  it('never raises a route-level override when narrowing to the anonymous tier', async () => {
    const config = makeConfig();
    const settings = readRateLimitSettings(config);
    const guard = new UserThrottlerGuard(
      [{ name: 'login', ttl: WINDOW_MS, limit: 2 }],
      newStorage(),
      new Reflector(),
      new JwtService({ secret: JWT_SECRET }),
      config,
    );
    await guard.onModuleInit();
    expect(settings.tiers.login.anonymous).toBeGreaterThan(2);

    const req = anonymousRequest('198.51.100.50');
    const results: Hit[] = [];
    for (let index = 0; index < 3; index += 1) {
      const headers: Record<string, string> = {};
      const res = {
        header: (name: string, value: unknown) => {
          headers[name] = String(value);
          return res;
        },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
        getClass: () => AuthController,
        getHandler: () => AuthController.prototype.changePassword,
      } as unknown as ExecutionContext;
      try {
        results.push({ allowed: await guard.canActivate(context) });
      } catch (error) {
        results.push({
          allowed: false,
          status: (error as HttpException).getStatus(),
        });
      }
    }

    expect(results[1].allowed).toBe(true);
    expect(results[2].status).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('keys the global bucket by user without narrowing it for anonymous callers', async () => {
    const { settings, hits, hit } = await harness({ RATE_LIMIT_GLOBAL: '3' }, [
      'default',
    ]);
    expect(settings.globalLimit).toBe(3);

    const anonymous = await hits(anonymousRequest('198.51.100.60'), 4);
    expect(anonymous.slice(0, 3).every((attempt) => attempt.allowed)).toBe(
      true,
    );
    expect(anonymous[3].status).toBe(HttpStatus.TOO_MANY_REQUESTS);

    const verified = await hits(
      bearerRequest('user-global', '198.51.100.60'),
      3,
    );
    expect(verified.every((attempt) => attempt.allowed)).toBe(true);
    expect(
      (await hit(bearerRequest('other-user', '198.51.100.60'))).allowed,
    ).toBe(true);
  });

  it('resets the tier once the window expires', async () => {
    const { settings, hit } = await harness();
    const tier = settings.tiers.login.anonymous;
    const req = anonymousRequest('198.51.100.70');
    jest.useFakeTimers();
    try {
      for (let index = 0; index < tier; index += 1) {
        expect((await hit(req)).allowed).toBe(true);
      }
      expect((await hit(req)).status).toBe(HttpStatus.TOO_MANY_REQUESTS);

      jest.advanceTimersByTime(WINDOW_MS + 1);

      expect((await hit(req)).allowed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
