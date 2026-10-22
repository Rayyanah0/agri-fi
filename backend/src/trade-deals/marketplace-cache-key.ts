import { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Viewer of the marketplace list. `OptionalJwtGuard` stores `false` on the
 * request when no (or an invalid) token was sent, so the id is read
 * defensively.
 */
export function viewerIdOf(req?: Request): string | undefined {
  const user = (req as { user?: { id?: unknown } } | undefined)?.user;
  return typeof user?.id === 'string' ? user.id : undefined;
}

/**
 * The marketplace listing is cached and `watched` is per viewer (#1003), so the
 * cache entry has to be keyed on the viewer too. Anonymous visitors keep
 * sharing the single public entry the route already used, and the request URL
 * (path + query string) stays part of the key exactly as the stock
 * `CacheInterceptor` had it.
 */
export function marketplaceCacheKey(context: ExecutionContext): string {
  const req = context.switchToHttp().getRequest<Request>();
  return `${req.url}|viewer:${viewerIdOf(req) ?? 'anon'}`;
}
