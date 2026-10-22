import { Injectable } from '@nestjs/common';
import { gatewayConfig, RateLimitRule } from './gateway.config';

interface Bucket { count: number; resetAt: number }
interface CacheEntry { status: number; headers: Record<string, string>; body: Buffer; expiresAt: number }

export interface RateResult { allowed: boolean; limit: number; remaining: number; resetSec: number; rule: string }

/**
 * Stateful gateway primitives: fixed-window rate limiting, LRU response cache,
 * IP banning and in-process analytics. State is per-instance; for multi-replica
 * deployments the ingress (see docs/api/api-gateway.md) enforces the global edge limit.
 */
@Injectable()
export class GatewayService {
  private buckets = new Map<string, Bucket>();
  private cache = new Map<string, CacheEntry>();
  private violations = new Map<string, Bucket>();
  private bans = new Map<string, number>();
  private stats = new Map<string, { count: number; errors: number; totalMs: number; maxMs: number; cacheHits: number }>();
  private blocked = { waf: 0, rateLimited: 0, banned: 0, unauthorized: 0 };

  // ---------- Rate limiting ----------
  private hit(key: string, limit: number, windowSec: number): RateResult & { key: string } {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowSec * 1000 };
      this.buckets.set(key, b);
    }
    b.count++;
    return {
      key,
      allowed: b.count <= limit,
      limit,
      remaining: Math.max(0, limit - b.count),
      resetSec: Math.ceil((b.resetAt - now) / 1000),
      rule: key.split('|')[0],
    };
  }

  matchRule(method: string, path: string): RateLimitRule | undefined {
    return gatewayConfig.rateLimit.perEndpoint.find((r) => {
      const [m, p] = r.match.includes(' ') ? r.match.split(' ') : [undefined, r.match];
      return (!m || m === method) && path.startsWith(p);
    });
  }

  checkRateLimit(clientKey: string, method: string, path: string): RateResult {
    const g = gatewayConfig.rateLimit.global;
    const global = this.hit(`global|${clientKey}`, g.limit, g.windowSec);
    const rule = this.matchRule(method, path);
    const endpoint = rule ? this.hit(`${rule.match}|${clientKey}`, rule.limit, rule.windowSec) : undefined;
    const res = endpoint && (!endpoint.allowed || endpoint.remaining < global.remaining) ? endpoint : global;
    if (!global.allowed || (endpoint && !endpoint.allowed)) {
      this.blocked.rateLimited++;
      this.recordViolation(clientKey);
      return { ...res, allowed: false };
    }
    return res;
  }

  // ---------- DDoS / ban list ----------
  private recordViolation(clientKey: string) {
    const ip = clientKey.split(':').pop()!;
    const s = gatewayConfig.security;
    const now = Date.now();
    let v = this.violations.get(ip);
    if (!v || v.resetAt <= now) v = { count: 0, resetAt: now + s.banWindowSec * 1000 };
    v.count++;
    this.violations.set(ip, v);
    if (v.count >= s.banThreshold) this.bans.set(ip, now + s.banDurationSec * 1000);
  }

  isBanned(ip: string): boolean {
    if (gatewayConfig.security.blockedIps.includes(ip)) return true;
    const until = this.bans.get(ip);
    if (!until) return false;
    if (until < Date.now()) { this.bans.delete(ip); return false; }
    return true;
  }

  countBlocked(kind: keyof GatewayService['blocked']) { this.blocked[kind]++; }

  // ---------- Cache ----------
  cacheTtl(path: string): number | null {
    const c = gatewayConfig.cache;
    if (!c.include.some((p) => path.startsWith(p))) return null;
    const o = Object.keys(c.ttlOverrides).find((p) => path.startsWith(p));
    return o ? c.ttlOverrides[o] : c.defaultTtlSec;
  }

  getCached(key: string): CacheEntry | null {
    const e = this.cache.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) { this.cache.delete(key); return null; }
    this.cache.delete(key); this.cache.set(key, e); // LRU touch
    return e;
  }

  setCached(key: string, entry: Omit<CacheEntry, 'expiresAt'>, ttlSec: number) {
    if (this.cache.size >= gatewayConfig.cache.maxEntries) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    this.cache.set(key, { ...entry, expiresAt: Date.now() + ttlSec * 1000 });
  }

  purgeCache(prefix?: string): number {
    let n = 0;
    for (const k of [...this.cache.keys()]) if (!prefix || k.includes(prefix)) { this.cache.delete(k); n++; }
    return n;
  }

  // ---------- Analytics ----------
  record(route: string, status: number, ms: number, cacheHit: boolean) {
    const s = this.stats.get(route) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0, cacheHits: 0 };
    s.count++;
    if (status >= 500) s.errors++;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    if (cacheHit) s.cacheHits++;
    this.stats.set(route, s);
  }

  analytics() {
    const routes = [...this.stats.entries()]
      .map(([route, s]) => ({
        route,
        requests: s.count,
        errorRate: s.count ? s.errors / s.count : 0,
        avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
        maxMs: s.maxMs,
        cacheHitRate: s.count ? s.cacheHits / s.count : 0,
      }))
      .sort((a, b) => b.requests - a.requests);
    return {
      totalRequests: routes.reduce((a, r) => a + r.requests, 0),
      blocked: { ...this.blocked },
      activeBans: this.bans.size,
      cacheEntries: this.cache.size,
      routes: routes.slice(0, 100),
    };
  }
}
