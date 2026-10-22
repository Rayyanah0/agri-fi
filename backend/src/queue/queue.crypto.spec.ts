import { createCipheriv, randomBytes } from 'crypto';
import { decryptPayload, encryptPayload } from './queue.crypto';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const LEGACY_KEY = 'c'.repeat(64);

const ENV_VARS = [
  'QUEUE_ENCRYPTION_KEY',
  'ENCRYPTION_KEY',
  'QUEUE_ENCRYPTION_KEYS',
  'QUEUE_ENCRYPTION_KEY_ID',
] as const;

function encryptLegacyV1(data: unknown, keyHex: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  return `v1:${iv.toString('hex')}:${enc.toString('hex')}`;
}

describe('queue.crypto', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of ENV_VARS) {
      originalEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  describe('v2 (AES-256-GCM)', () => {
    beforeEach(() => {
      process.env.QUEUE_ENCRYPTION_KEY = KEY_A;
    });

    it('round-trips a payload', () => {
      const payload = { dealId: 'deal-1', amount: 250, nested: { ok: true } };

      const ciphertext = encryptPayload(payload);

      expect(decryptPayload(ciphertext)).toEqual(payload);
    });

    it('emits the documented v2 marker with nonce, tag and ciphertext', () => {
      const ciphertext = encryptPayload({ ok: true });
      const parts = ciphertext.split(':');

      expect(parts).toHaveLength(5);
      expect(parts[0]).toBe('v2');
      expect(parts[1]).toBe('1');
      expect(parts[2]).toHaveLength(24); // 12-byte nonce
      expect(parts[3]).toHaveLength(32); // 16-byte auth tag
      expect(parts[4]).toMatch(/^[0-9a-f]+$/);
    });

    it('uses a fresh nonce for every payload', () => {
      const payload = { dealId: 'deal-1' };

      expect(encryptPayload(payload)).not.toBe(encryptPayload(payload));
    });

    it('detects tampering with the ciphertext', () => {
      const ciphertext = encryptPayload({ dealId: 'deal-1', amount: 10 });
      const parts = ciphertext.split(':');
      const tampered = Buffer.from(parts[4], 'hex');
      tampered[0] ^= 0xff;
      parts[4] = tampered.toString('hex');

      expect(() => decryptPayload(parts.join(':'))).toThrow();
    });

    it('detects tampering with the authentication tag', () => {
      const ciphertext = encryptPayload({ dealId: 'deal-1' });
      const parts = ciphertext.split(':');
      parts[3] = '0'.repeat(32);

      expect(() => decryptPayload(parts.join(':'))).toThrow();
    });

    it('rejects a payload replayed onto a different queue (AAD mismatch)', () => {
      const ciphertext = encryptPayload({ dealId: 'deal-1' }, 'deal.publish');

      expect(() => decryptPayload(ciphertext, 'deal.funded')).toThrow();
      expect(() => decryptPayload(ciphertext, '')).toThrow();
      expect(decryptPayload(ciphertext, 'deal.publish')).toEqual({
        dealId: 'deal-1',
      });
    });

    it('rejects malformed payloads', () => {
      expect(() => decryptPayload('v2:1:abcd')).toThrow(/Invalid ciphertext/);
      expect(() => decryptPayload('v3:1:aa:bb:cc')).toThrow(
        /Unsupported queue payload version/,
      );
      expect(() => decryptPayload('not-encrypted')).toThrow(
        /Unsupported queue payload version/,
      );
    });

    it('fails closed when no key is configured', () => {
      delete process.env.QUEUE_ENCRYPTION_KEY;

      expect(() => encryptPayload({ ok: true })).toThrow(
        /QUEUE_ENCRYPTION_KEY/,
      );
    });
  });

  describe('key versioning', () => {
    it('decrypts payloads encrypted with a non-primary key in the ring', () => {
      process.env.QUEUE_ENCRYPTION_KEYS = JSON.stringify({
        '1': KEY_A,
        '2': KEY_B,
      });
      delete process.env.QUEUE_ENCRYPTION_KEY;

      process.env.QUEUE_ENCRYPTION_KEY_ID = '1';
      const oldPayload = encryptPayload({ rotation: 1 });

      process.env.QUEUE_ENCRYPTION_KEY_ID = '2';
      const newPayload = encryptPayload({ rotation: 2 });

      expect(oldPayload.split(':')[1]).toBe('1');
      expect(newPayload.split(':')[1]).toBe('2');
      // Both keys stay readable during the rotation window.
      expect(decryptPayload(oldPayload)).toEqual({ rotation: 1 });
      expect(decryptPayload(newPayload)).toEqual({ rotation: 2 });
    });

    it('fails with a clear error when the payload key id is not configured', () => {
      process.env.QUEUE_ENCRYPTION_KEYS = JSON.stringify({ '1': KEY_A });
      delete process.env.QUEUE_ENCRYPTION_KEY_ID;

      const nonce = '0'.repeat(24);
      const tag = '0'.repeat(32);
      const payload = `v2:9:${nonce}:${tag}:${'00'}`;

      expect(() => decryptPayload(payload)).toThrow(/key id "9"/);
    });

    it('rejects an invalid key ring', () => {
      process.env.QUEUE_ENCRYPTION_KEYS = 'not-json';

      expect(() => encryptPayload({ ok: true })).toThrow(
        /QUEUE_ENCRYPTION_KEYS/,
      );
    });
  });

  describe('v1 legacy compatibility', () => {
    beforeEach(() => {
      process.env.QUEUE_ENCRYPTION_KEY = LEGACY_KEY;
    });

    it('decrypts v1 AES-256-CBC payloads', () => {
      const ciphertext = encryptLegacyV1({ dealId: 'legacy-deal' }, LEGACY_KEY);

      expect(decryptPayload(ciphertext)).toEqual({ dealId: 'legacy-deal' });
    });

    it('ignores the AAD for v1 payloads (they predate AAD binding)', () => {
      const ciphertext = encryptLegacyV1({ dealId: 'legacy-deal' }, LEGACY_KEY);

      expect(decryptPayload(ciphertext, 'deal.publish')).toEqual({
        dealId: 'legacy-deal',
      });
    });

    it('rejects malformed v1 payloads', () => {
      expect(() => decryptPayload('v1:abcd:00')).toThrow(/Invalid AES-CBC IV/);
      expect(() => decryptPayload('v1:aa:bb')).toThrow(/Invalid AES-CBC IV/);
    });
  });
});
