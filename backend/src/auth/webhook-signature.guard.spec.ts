import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhookSignatureGuard } from './webhook-signature.guard';

const SECRET = 'test-webhook-secret';
const RAW_BODY = '{"event":"payment.callback","id":"evt_123","amount":"10.00"}';

function sign(body: Buffer | string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('WebhookSignatureGuard', () => {
  let guard: WebhookSignatureGuard;
  const originalSecret = process.env.WEBHOOK_SECRET;

  beforeEach(() => {
    guard = new WebhookSignatureGuard();
    process.env.WEBHOOK_SECRET = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = originalSecret;
  });

  describe('rawBody path', () => {
    it('accepts a signature computed over req.rawBody', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
        rawBody: Buffer.from(RAW_BODY),
        body: { event: 'payment.callback' },
      };

      expect(guard.canActivate(contextFor(request))).toBe(true);
    });

    it('rejects a signature that does not match req.rawBody', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(`${RAW_BODY} `) },
        rawBody: Buffer.from(RAW_BODY),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a body whose bytes were altered after signing', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
        // Same JSON, different bytes (whitespace inserted by a proxy).
        rawBody: Buffer.from(
          '{"event": "payment.callback", "id": "evt_123", "amount": "10.00"}',
        ),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        /signature mismatch/i,
      );
    });

    it('prefers req.rawBody over a parsed req.body', () => {
      // Signing the parsed body would produce different bytes; the guard must
      // still verify against rawBody and accept.
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
        rawBody: Buffer.from(RAW_BODY),
        body: JSON.parse(RAW_BODY),
      };

      expect(guard.canActivate(contextFor(request))).toBe(true);
    });
  });

  describe('req.body fallback (no rawBody)', () => {
    it('accepts a Buffer body when rawBody is absent', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
        body: Buffer.from(RAW_BODY),
      };

      expect(guard.canActivate(contextFor(request))).toBe(true);
    });

    it('accepts a string body when rawBody is absent', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
        body: RAW_BODY,
      };

      expect(guard.canActivate(contextFor(request))).toBe(true);
    });

    it('rejects a generic Buffer body with a wrong signature', () => {
      const request = {
        headers: { 'x-webhook-signature': sign('tampered') },
        body: Buffer.from(RAW_BODY),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        /signature mismatch/i,
      );
    });
  });

  describe('missing raw body', () => {
    it('rejects when the body was already parsed into an object', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
        body: JSON.parse(RAW_BODY),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        /rawBody: true/,
      );
    });

    it('rejects an empty Buffer body', () => {
      const request = {
        headers: { 'x-webhook-signature': sign('') },
        rawBody: Buffer.alloc(0),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when rawBody is undefined and body is missing', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('configuration and header validation', () => {
    it('rejects when WEBHOOK_SECRET is not configured', () => {
      delete process.env.WEBHOOK_SECRET;
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY) },
        rawBody: Buffer.from(RAW_BODY),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        /secret is not configured/i,
      );
    });

    it('rejects when the signature header is missing', () => {
      const request = { headers: {}, rawBody: Buffer.from(RAW_BODY) };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        /Missing required header/,
      );
    });

    it('rejects a signature with a different length without throwing from timingSafeEqual', () => {
      const request = {
        headers: { 'x-webhook-signature': 'abc123' },
        rawBody: Buffer.from(RAW_BODY),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        /signature mismatch/i,
      );
    });

    it('rejects a signature produced with a different secret', () => {
      const request = {
        headers: { 'x-webhook-signature': sign(RAW_BODY, 'other-secret') },
        rawBody: Buffer.from(RAW_BODY),
      };

      expect(() => guard.canActivate(contextFor(request))).toThrow(
        /signature mismatch/i,
      );
    });
  });
});
