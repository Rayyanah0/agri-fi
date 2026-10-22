import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

const SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Guard that verifies HMAC-SHA256 signatures on incoming webhook requests.
 *
 * The caller must include an `x-webhook-signature` header containing the
 * lowercase hex digest of HMAC-SHA256(rawBody, WEBHOOK_SECRET).
 *
 * Requires the NestJS app to be bootstrapped with `{ rawBody: true }` so
 * that `req.rawBody` is populated before JSON parsing. Without it the body is
 * already parsed by the time the guard runs and the original bytes — the ones
 * the HMAC was computed over — are gone.
 *
 * For routes that deliberately receive an unparsed body (e.g. `express.raw()`
 * middleware), `req.body` is accepted when it is still a `Buffer` or string.
 * A parsed object is never re-serialised for verification: JSON re-encoding is
 * not byte-stable, so verification would be unreliable by construction.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();

    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      throw new UnauthorizedException('Webhook secret is not configured.');
    }

    const incomingSignature = req.headers[SIGNATURE_HEADER];
    if (!incomingSignature || typeof incomingSignature !== 'string') {
      throw new UnauthorizedException(
        `Missing required header: ${SIGNATURE_HEADER}`,
      );
    }

    const rawBody = this.resolveRawBody(req);
    if (!rawBody) {
      throw new UnauthorizedException(
        'Request body is empty or was parsed before signature verification. ' +
          'Ensure the application is bootstrapped with rawBody: true.',
      );
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const incomingBuf = Buffer.from(incomingSignature, 'utf8');

    if (
      expectedBuf.length !== incomingBuf.length ||
      !timingSafeEqual(expectedBuf, incomingBuf)
    ) {
      throw new UnauthorizedException('Webhook signature mismatch.');
    }

    return true;
  }

  /**
   * Returns the exact request bytes the signature covers.
   *
   * `req.rawBody` is populated by Nest's raw-body support and is always the
   * preferred source. `req.body` is only used when it is still an untouched
   * `Buffer`/string (no JSON parser has run over it).
   */
  private resolveRawBody(req: RawBodyRequest<Request>): Buffer | null {
    const rawBody = req.rawBody;
    if (rawBody && rawBody.length > 0) {
      return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    }

    const body: unknown = req.body;
    if (Buffer.isBuffer(body) && body.length > 0) {
      return body;
    }
    if (typeof body === 'string' && body.length > 0) {
      return Buffer.from(body, 'utf8');
    }

    return null;
  }
}
