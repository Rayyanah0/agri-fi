import { ExecutionContext } from '@nestjs/common';
import { marketplaceCacheKey, viewerIdOf } from './marketplace-cache-key';

function requestContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('marketplaceCacheKey (#1003)', () => {
  it('keeps anonymous visitors on one shared entry', () => {
    // OptionalJwtGuard stores `false` when no usable token was sent.
    expect(
      marketplaceCacheKey(requestContext({ url: '/v1/trade-deals?page=2' })),
    ).toBe('/v1/trade-deals?page=2|viewer:anon');
    expect(
      marketplaceCacheKey(
        requestContext({ url: '/v1/trade-deals?page=2', user: false }),
      ),
    ).toBe('/v1/trade-deals?page=2|viewer:anon');
  });

  it('splits cached pages between viewers', () => {
    const a = marketplaceCacheKey(
      requestContext({ url: '/v1/trade-deals', user: { id: 'investor-1' } }),
    );
    const b = marketplaceCacheKey(
      requestContext({ url: '/v1/trade-deals', user: { id: 'investor-2' } }),
    );
    expect(a).toBe('/v1/trade-deals|viewer:investor-1');
    expect(a).not.toBe(b);
  });

  it('still keys on the query string', () => {
    const plain = marketplaceCacheKey(
      requestContext({ url: '/v1/trade-deals', user: { id: 'investor-1' } }),
    );
    const filtered = marketplaceCacheKey(
      requestContext({
        url: '/v1/trade-deals?commodity=Cocoa',
        user: { id: 'investor-1' },
      }),
    );
    expect(filtered).toBe('/v1/trade-deals?commodity=Cocoa|viewer:investor-1');
    expect(plain).not.toBe(filtered);
  });

  describe('viewerIdOf', () => {
    it.each([
      ['no request', undefined],
      ['anonymous', { user: false }],
      ['a partial user object', { user: {} }],
      ['a numeric sub', { user: { id: 7 } }],
    ])('returns undefined for %s', (_label, request) => {
      expect(viewerIdOf(request as any)).toBeUndefined();
    });

    it('reads a string subject', () => {
      expect(viewerIdOf({ user: { id: 'investor-1' } } as any)).toBe(
        'investor-1',
      );
    });
  });
});
