import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  getOptionsToken,
  getStorageToken,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  RateLimitSettings,
  SensitiveBucket,
  readRateLimitSettings,
} from './rate-limit.config';

const IDENTITY_CACHE_KEY = '__rateLimitIdentity';

export type RateLimitIdentity =
  { kind: 'user'; sub: string } | { kind: 'anonymous'; ip: string };

interface MaybeJwtPayload {
  sub?: unknown;
}

/**
 * `ThrottlerGuard` that keys its buckets on the authenticated user instead of
 * the connection IP, so a shared NAT or corporate egress no longer makes
 * one user's traffic consume another user's budget — and so an attacker cannot
 * reset a budget by rotating source addresses.
 *
 * The key only comes from a JWT whose signature verifies: an unsigned or
 * spoofed token falls back to the IP bucket, which keeps anonymous callers on
 * the stricter tier and stops a caller from minting unlimited identity buckets
 * with forged tokens.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  private readonly settings: RateLimitSettings;
  private readonly trustProxy: boolean;

  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    super(options, storageService, reflector);
    this.settings = readRateLimitSettings(config);
    this.trustProxy =
      config.get<string>('TRUST_PROXY', 'false').toLowerCase() === 'true';
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const tier =
      this.settings.tiers[requestProps.throttler.name as SensitiveBucket];
    if (!tier) {
      return super.handleRequest(requestProps);
    }
    const { req } = this.getRequestResponse(requestProps.context);
    if (this.identity(req).kind === 'user') {
      return super.handleRequest(requestProps);
    }
    return super.handleRequest({
      ...requestProps,
      limit: Math.min(requestProps.limit, tier.anonymous),
    });
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const identity = this.identity(req);
    return identity.kind === 'user'
      ? `user:${identity.sub}`
      : `ip:${identity.ip}`;
  }

  /**
   * The storage only emits the suffixed `Retry-After-<bucket>` header, and only
   * once a request is blocked; clients and proxies expect the standard header.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const remaining =
      throttlerLimitDetail.timeToBlockExpire ||
      throttlerLimitDetail.timeToExpire ||
      1;
    const retryAfter = Math.max(1, Math.ceil(remaining));
    if (res && typeof res.header === 'function') {
      res.header('Retry-After', String(retryAfter));
    }
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }

  private identity(req: Record<string, any>): RateLimitIdentity {
    const cached = req[IDENTITY_CACHE_KEY] as RateLimitIdentity | undefined;
    if (cached) {
      return cached;
    }
    const identity = this.resolveIdentity(req);
    req[IDENTITY_CACHE_KEY] = identity;
    return identity;
  }

  private resolveIdentity(req: Record<string, any>): RateLimitIdentity {
    const token = this.bearerToken(req);
    if (token) {
      try {
        const payload = this.jwtService.verify<MaybeJwtPayload>(token);
        if (typeof payload?.sub === 'string' && payload.sub.length > 0) {
          return { kind: 'user', sub: payload.sub };
        }
      } catch {
        // Unverifiable token: fall through to the stricter IP bucket.
      }
    }
    return { kind: 'anonymous', ip: this.clientIp(req) };
  }

  private bearerToken(req: Record<string, any>): string | undefined {
    const header = req.headers?.authorization ?? req.headers?.Authorization;
    if (typeof header !== 'string') {
      return undefined;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    return match ? match[1] : undefined;
  }

  private clientIp(req: Record<string, any>): string {
    if (this.trustProxy) {
      const forwarded = req.headers?.['x-forwarded-for'];
      if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
        return forwarded.split(',')[0].trim();
      }
    }
    return req.ip ?? 'unknown';
  }
}
