/**
 * Central API gateway configuration. Every value can be overridden through
 * environment variables so limits can be tuned per environment without a deploy.
 */
export interface RateLimitRule {
  /** Path prefix (method optional, e.g. "POST /v1/auth/login"). */
  match: string;
  limit: number;
  windowSec: number;
}

export interface RouteRule {
  /** Incoming path prefix. */
  prefix: string;
  /** Upstream base URL; "local" keeps the request inside this NestJS process. */
  upstream: string;
  /** Strip the prefix before forwarding. */
  stripPrefix?: boolean;
  /** Require a valid JWT / API key at the gateway. */
  auth?: boolean;
}

const env = (k: string, d: number) => Number(process.env[k] ?? d);

export const gatewayConfig = {
  enabled: process.env.API_GATEWAY_ENABLED !== 'false',

  rateLimit: {
    global: { limit: env('GATEWAY_GLOBAL_LIMIT', 300), windowSec: env('GATEWAY_GLOBAL_WINDOW', 60) },
    perEndpoint: [
      { match: 'POST /v1/auth/login', limit: 10, windowSec: 60 },
      { match: 'POST /v1/auth/register', limit: 5, windowSec: 60 },
      { match: 'POST /v1/documents', limit: 30, windowSec: 60 },
      { match: '/v1/public', limit: 120, windowSec: 60 },
      { match: '/graphql', limit: 120, windowSec: 60 },
    ] as RateLimitRule[],
  },

  cache: {
    defaultTtlSec: env('GATEWAY_CACHE_TTL', 30),
    maxEntries: env('GATEWAY_CACHE_MAX', 5000),
    /** Only these GET prefixes are cached (public, non-personalised data). */
    include: ['/v1/public', '/v1/trade-deals/marketplace', '/v1/search', '/health'],
    ttlOverrides: { '/health': 5 } as Record<string, number>,
  },

  versions: {
    supported: ['v1', 'v2'],
    default: 'v1',
    deprecated: { v1: '2027-06-30' } as Record<string, string>,
  },

  routes: [
    { prefix: '/', upstream: 'local' },
    { prefix: '/graphql', upstream: 'local' },
    // Example of routing to an external microservice:
    // { prefix: '/v1/soroban-indexer', upstream: process.env.INDEXER_URL!, stripPrefix: true, auth: true },
  ] as RouteRule[],

  /** Paths that bypass gateway authentication (still subject to WAF / rate limits). */
  publicPaths: [
    '/health', '/metrics', '/v1/auth', '/v1/public', '/api/docs', '/graphql',
    '/v1/email/track', '/v1/email/unsubscribe', '/v1/email/inbound',
  ],

  security: {
    maxBodyBytes: env('GATEWAY_MAX_BODY', 10 * 1024 * 1024),
    maxUrlLength: 2048,
    blockedIps: (process.env.GATEWAY_BLOCKED_IPS ?? '').split(',').filter(Boolean),
    /** Auto-ban IPs that exceed this many rate-limit violations in banWindowSec. */
    banThreshold: env('GATEWAY_BAN_THRESHOLD', 20),
    banWindowSec: 300,
    banDurationSec: env('GATEWAY_BAN_DURATION', 900),
  },
};

export type GatewayConfig = typeof gatewayConfig;
