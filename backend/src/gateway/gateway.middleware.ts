import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { Counter, Histogram, register } from 'prom-client';
import { gatewayConfig } from './gateway.config';
import { GatewayService } from './gateway.service';

const WAF_RULES: { name: string; re: RegExp }[] = [
  { name: 'sqli', re: /(\bunion\b[\s\S]*\bselect\b|\bor\b\s+1\s*=\s*1|;\s*drop\s+table|'\s*--)/i },
  { name: 'xss', re: /(<script\b|javascript:|onerror\s*=|onload\s*=)/i },
  { name: 'path-traversal', re: /(\.\.\/|\.\.\\|%2e%2e%2f)/i },
  { name: 'cmd-injection', re: /(;|\|\||&&)\s*(cat|wget|curl|rm|sh|bash)\b/i },
];

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'te', 'trailer'];

function metric<T>(name: string, make: () => T): T {
  return (register.getSingleMetric(name) as unknown as T) ?? make();
}
const reqCounter = metric('gateway_requests_total', () => new Counter({
  name: 'gateway_requests_total', help: 'Requests through the API gateway',
  labelNames: ['method', 'route', 'status', 'version', 'cache'],
}));
const blockedCounter = metric('gateway_blocked_total', () => new Counter({
  name: 'gateway_blocked_total', help: 'Requests blocked by the gateway', labelNames: ['reason'],
}));
const latency = metric('gateway_request_duration_seconds', () => new Histogram({
  name: 'gateway_request_duration_seconds', help: 'Gateway request latency',
  labelNames: ['method', 'route'], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
}));

/** Normalises ids so analytics group by route template. */
export function routeKey(path: string): string {
  return path
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
}

/**
 * Unified gateway middleware applied to every route. Order:
 * security (ban list, size, WAF) → versioning → auth → rate limit → cache → routing → transform → analytics.
 */
@Injectable()
export class GatewayMiddleware implements NestMiddleware {
  constructor(private readonly gw: GatewayService, private readonly jwt: JwtService) {}

  private reject(res: any, status: number, code: string, message: string, reason: string) {
    blockedCounter.inc({ reason });
    res.status(status).json({ statusCode: status, code, message });
  }

  async use(req: any, res: any, next: () => void) {
    if (!gatewayConfig.enabled) return next();
    const start = process.hrtime.bigint();
    const ip: string = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.socket?.remoteAddress || '').trim();
    const path: string = req.originalUrl || req.url;
    const sec = gatewayConfig.security;

    // ---- Request transformation (inbound) ----
    const requestId = req.headers['x-request-id'] || randomUUID();
    req.headers['x-request-id'] = requestId;
    req.headers['x-forwarded-for'] = ip;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Gateway', 'agri-fi');

    // ---- Security: ban list / DDoS ----
    if (this.gw.isBanned(ip)) {
      this.gw.countBlocked('banned');
      return this.reject(res, 403, 'IP_BLOCKED', 'Access denied', 'banned');
    }
    if (path.length > sec.maxUrlLength) return this.reject(res, 414, 'URI_TOO_LONG', 'URL too long', 'url');
    if (Number(req.headers['content-length'] || 0) > sec.maxBodyBytes) {
      return this.reject(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload too large', 'size');
    }
    // ---- Security: WAF ----
    let decoded = path;
    try { decoded = decodeURIComponent(path); } catch { /* keep raw */ }
    const bodyStr = req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : '';
    const hit = WAF_RULES.find((r) => r.re.test(decoded) || (bodyStr && r.re.test(bodyStr)));
    if (hit) {
      this.gw.countBlocked('waf');
      return this.reject(res, 403, 'WAF_BLOCKED', `Request blocked (${hit.name})`, `waf_${hit.name}`);
    }

    // ---- Versioning ----
    const urlVersion = path.match(/^\/(v\d+)\//)?.[1];
    const headerVersion = (req.headers['api-version'] || req.headers['accept-version']) as string | undefined;
    const version = urlVersion || (headerVersion ? `v${String(headerVersion).replace(/^v/, '')}` : gatewayConfig.versions.default);
    if (!gatewayConfig.versions.supported.includes(version)) {
      return this.reject(res, 400, 'UNSUPPORTED_API_VERSION',
        `Supported versions: ${gatewayConfig.versions.supported.join(', ')}`, 'version');
    }
    if (!urlVersion && headerVersion && /^\/(?!v\d+\/)/.test(req.url) && !req.url.startsWith('/health') && !req.url.startsWith('/graphql')) {
      req.url = `/${version}${req.url}`; // header-based versioning → URI versioning used by Nest
    }
    res.setHeader('API-Version', version);
    const sunset = gatewayConfig.versions.deprecated[version];
    if (sunset) { res.setHeader('Deprecation', 'true'); res.setHeader('Sunset', new Date(sunset).toUTCString()); }

    // ---- Authentication ----
    const isPublic = gatewayConfig.publicPaths.some((p) => path.startsWith(p) || path.startsWith(p.replace('/v1', '')));
    let principal = `ip:${ip}`;
    const auth: string | undefined = req.headers.authorization;
    if (auth?.startsWith('Bearer ') && !auth.startsWith('Bearer agfi_')) {
      try {
        const payload: any = await this.jwt.verifyAsync(auth.slice(7));
        principal = `user:${payload.sub ?? payload.id}:${ip}`;
        req.gatewayUser = payload;
      } catch {
        if (!isPublic) {
          this.gw.countBlocked('unauthorized');
          return this.reject(res, 401, 'INVALID_TOKEN', 'Invalid or expired token', 'auth');
        }
      }
    } else if (req.headers['x-api-key'] || auth?.startsWith('Bearer agfi_')) {
      principal = `key:${String(req.headers['x-api-key'] || auth).slice(-12)}:${ip}`; // validated downstream by ApiKeyGuard
    }

    // ---- Rate limiting ----
    const rl = this.gw.checkRateLimit(principal, req.method, path);
    res.setHeader('X-RateLimit-Limit', rl.limit);
    res.setHeader('X-RateLimit-Remaining', rl.remaining);
    res.setHeader('X-RateLimit-Reset', rl.resetSec);
    if (!rl.allowed) {
      res.setHeader('Retry-After', rl.resetSec);
      return this.reject(res, 429, 'RATE_LIMITED', 'Too many requests', 'rate_limit');
    }

    const route = routeKey(path);
    const finish = (status: number, cache: 'HIT' | 'MISS' | 'BYPASS') => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      this.gw.record(`${req.method} ${route}`, status, ms, cache === 'HIT');
      reqCounter.inc({ method: req.method, route, status: String(status), version, cache });
      latency.observe({ method: req.method, route }, ms / 1000);
    };

    // ---- Caching (GET only, anonymous or explicitly public) ----
    const ttl = req.method === 'GET' && !req.headers['cache-control']?.includes('no-cache') ? this.gw.cacheTtl(path) : null;
    const cacheKey = `${version}|${path}|${req.headers['accept-language'] ?? ''}`;
    if (ttl) {
      const cached = this.gw.getCached(cacheKey);
      if (cached) {
        Object.entries(cached.headers).forEach(([k, v]) => res.setHeader(k, v));
        res.setHeader('X-Cache', 'HIT');
        res.status(cached.status).end(cached.body);
        return finish(cached.status, 'HIT');
      }
      res.setHeader('X-Cache', 'MISS');
      const chunks: Buffer[] = [];
      const write = res.write.bind(res);
      const end = res.end.bind(res);
      res.write = (c: any, ...a: any[]) => { if (c) chunks.push(Buffer.from(c)); return write(c, ...a); };
      res.end = (c: any, ...a: any[]) => {
        if (c && typeof c !== 'function') chunks.push(Buffer.from(c));
        if (res.statusCode === 200) {
          const headers: Record<string, string> = {};
          for (const h of ['content-type', 'etag']) { const v = res.getHeader(h); if (v) headers[h] = String(v); }
          this.gw.setCached(cacheKey, { status: 200, headers, body: Buffer.concat(chunks) }, ttl);
        }
        return end(c, ...a);
      };
    }

    // ---- Routing ----
    const rule = gatewayConfig.routes.find((r) => path.startsWith(r.prefix));
    if (rule && rule.upstream !== 'local') {
      if (rule.auth && !req.gatewayUser) return this.reject(res, 401, 'UNAUTHORIZED', 'Authentication required', 'auth');
      try {
        const target = rule.upstream + (rule.stripPrefix ? path.slice(rule.prefix.length) || '/' : path);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.includes(k) && k !== 'host') headers[k] = String(v);
        const upstream = await fetch(target, {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        });
        upstream.headers.forEach((v, k) => { if (!HOP_BY_HOP.includes(k)) res.setHeader(k, v); });
        res.status(upstream.status).end(Buffer.from(await upstream.arrayBuffer()));
        return finish(upstream.status, ttl ? 'MISS' : 'BYPASS');
      } catch {
        res.status(502).json({ statusCode: 502, code: 'BAD_GATEWAY', message: 'Upstream unavailable' });
        return finish(502, 'BYPASS');
      }
    }

    // ---- Response transformation + analytics for local routes ----
    res.removeHeader?.('X-Powered-By');
    res.on('finish', () => finish(res.statusCode, ttl ? 'MISS' : 'BYPASS'));
    next();
  }
}
