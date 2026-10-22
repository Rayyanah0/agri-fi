import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Queue payload encryption.
 *
 * Current format (`v2`) is AES-256-GCM, which is authenticated: a tampered
 * ciphertext or an altered nonce/tag fails decryption instead of producing
 * garbage. The associated data (AAD) is bound to the queue name, so a valid
 * ciphertext replayed onto a different queue is rejected.
 *
 *   v2:<keyId>:<nonce hex>:<auth tag hex>:<ciphertext hex>
 *
 * The `keyId` segment supports key rotation: encrypt with the primary key,
 * decrypt with whichever key the payload names. Keys are read from
 * `QUEUE_ENCRYPTION_KEYS` (JSON object of keyId -> 64-char hex) and fall back
 * to the legacy single-key `QUEUE_ENCRYPTION_KEY` / `ENCRYPTION_KEY` pair.
 *
 * Legacy `v1:<iv hex>:<ciphertext hex>` payloads (AES-256-CBC, no AAD) are
 * still accepted on decrypt so messages already in flight during the
 * transition are not lost. No new `v1` payloads are produced.
 */

const LEGACY_ALGORITHM = 'aes-256-cbc';
const LEGACY_IV_BYTES = 16;

const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

const KEY_ENV_VARS = ['QUEUE_ENCRYPTION_KEY', 'ENCRYPTION_KEY'] as const;
const KEY_RING_ENV_VAR = 'QUEUE_ENCRYPTION_KEYS';
const PRIMARY_KEY_ID_ENV_VAR = 'QUEUE_ENCRYPTION_KEY_ID';
const DEFAULT_KEY_ID = '1';

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const HEX_PATTERN = /^[0-9a-fA-F]*$/;

export interface QueueEncryptionKey {
  keyId: string;
  key: Buffer;
}

function parseKey(hex: string, source: string): Buffer {
  if (!HEX_KEY_PATTERN.test(hex)) {
    throw new Error(
      `${source} must be a 64-character hex string (32 bytes). ` +
        'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

function parseKeyRing(raw: string): Map<string, Buffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${KEY_RING_ENV_VAR} must be a JSON object mapping key ids to ` +
        '64-character hex keys, e.g. {"1":"<hex>","2":"<hex>"}.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `${KEY_RING_ENV_VAR} must be a JSON object of keyId -> key.`,
    );
  }

  const ring = new Map<string, Buffer>();
  for (const [keyId, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new Error(
        `Invalid key id "${keyId}" in ${KEY_RING_ENV_VAR}: only letters, ` +
          'digits, "_" and "-" are allowed (the id is embedded in the payload).',
      );
    }
    if (typeof value !== 'string') {
      throw new Error(
        `Key "${keyId}" in ${KEY_RING_ENV_VAR} must be a string.`,
      );
    }
    ring.set(keyId, parseKey(value, `${KEY_RING_ENV_VAR}[${keyId}]`));
  }

  if (ring.size === 0) {
    throw new Error(`${KEY_RING_ENV_VAR} does not contain any keys.`);
  }

  return ring;
}

function readKeyRing(): Map<string, Buffer> {
  const ringJson = process.env[KEY_RING_ENV_VAR];
  if (ringJson && ringJson.trim() !== '') {
    return parseKeyRing(ringJson);
  }

  const singleKey = KEY_ENV_VARS.map((name) => process.env[name]).find(
    (value) => value !== undefined && value !== '',
  );
  if (!singleKey) {
    throw new Error(
      'QUEUE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: openssl rand -hex 32',
    );
  }

  const keyId = process.env[PRIMARY_KEY_ID_ENV_VAR] ?? DEFAULT_KEY_ID;
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(
      `${PRIMARY_KEY_ID_ENV_VAR} must match ${KEY_ID_PATTERN.source}.`,
    );
  }

  return new Map([[keyId, parseKey(singleKey, 'QUEUE_ENCRYPTION_KEY')]]);
}

function getPrimaryKey(): QueueEncryptionKey {
  const ring = readKeyRing();
  const configuredKeyId = process.env[PRIMARY_KEY_ID_ENV_VAR];

  if (configuredKeyId) {
    const key = ring.get(configuredKeyId);
    if (!key) {
      throw new Error(
        `${PRIMARY_KEY_ID_ENV_VAR}=${configuredKeyId} is not present in the ` +
          'configured queue encryption key ring.',
      );
    }
    return { keyId: configuredKeyId, key };
  }

  if (ring.has(DEFAULT_KEY_ID)) {
    return { keyId: DEFAULT_KEY_ID, key: ring.get(DEFAULT_KEY_ID)! };
  }

  const [keyId, key] = ring.entries().next().value as [string, Buffer];
  return { keyId, key };
}

function getLegacyKey(): Buffer {
  const singleKey = KEY_ENV_VARS.map((name) => process.env[name]).find(
    (value) => value !== undefined && value !== '',
  );
  if (!singleKey) {
    throw new Error(
      'QUEUE_ENCRYPTION_KEY must be set to decrypt legacy v1 payloads.',
    );
  }
  return parseKey(singleKey, 'QUEUE_ENCRYPTION_KEY');
}

function getKeyById(keyId: string): Buffer {
  const ring = readKeyRing();
  const key = ring.get(keyId);
  if (!key) {
    throw new Error(
      `No queue encryption key configured for key id "${keyId}". ` +
        `Add it to ${KEY_RING_ENV_VAR} to decrypt this payload.`,
    );
  }
  return key;
}

function decryptV2<T>(parts: string[], aad: string): T {
  if (parts.length !== 5) {
    throw new Error(
      'Invalid ciphertext format — expected v2:<keyId>:<nonce>:<tag>:<data>',
    );
  }

  const [, keyId, nonceHex, tagHex, encHex] = parts;

  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(`Invalid key id in ciphertext: "${keyId}"`);
  }
  if (nonceHex.length !== GCM_NONCE_BYTES * 2 || !HEX_PATTERN.test(nonceHex)) {
    throw new Error('Invalid AES-GCM nonce in ciphertext.');
  }
  if (tagHex.length !== GCM_TAG_BYTES * 2 || !HEX_PATTERN.test(tagHex)) {
    throw new Error('Invalid AES-GCM authentication tag in ciphertext.');
  }
  if (encHex.length % 2 !== 0 || !HEX_PATTERN.test(encHex)) {
    throw new Error('Invalid ciphertext payload encoding.');
  }

  const decipher = createDecipheriv(
    GCM_ALGORITHM,
    getKeyById(keyId),
    Buffer.from(nonceHex, 'hex'),
    { authTagLength: GCM_TAG_BYTES },
  );
  // Binding the queue name as AAD makes a ciphertext replayable only onto the
  // queue it was produced for.
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);

  return JSON.parse(dec.toString('utf8')) as T;
}

function decryptV1<T>(parts: string[]): T {
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format — expected v1:<iv>:<data>');
  }

  const [, ivHex, encHex] = parts;
  if (ivHex.length !== LEGACY_IV_BYTES * 2 || !HEX_PATTERN.test(ivHex)) {
    throw new Error('Invalid AES-CBC IV in legacy v1 ciphertext.');
  }
  if (encHex.length % 2 !== 0 || !HEX_PATTERN.test(encHex)) {
    throw new Error('Invalid ciphertext payload encoding.');
  }

  // Legacy messages predate AAD binding; the queue name is deliberately not
  // checked here so in-flight v1 messages continue to decrypt.
  const decipher = createDecipheriv(
    LEGACY_ALGORITHM,
    getLegacyKey(),
    Buffer.from(ivHex, 'hex'),
  );
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);

  return JSON.parse(dec.toString('utf8')) as T;
}

/**
 * Encrypt a queue payload with AES-256-GCM.
 *
 * @param data Payload to serialise and encrypt.
 * @param aad  Additional authenticated data — pass the queue/event name so the
 *             ciphertext cannot be replayed onto another queue.
 */
export function encryptPayload(data: unknown, aad: string = ''): string {
  const { keyId, key } = getPrimaryKey();
  const nonce = randomBytes(GCM_NONCE_BYTES);

  const cipher = createCipheriv(GCM_ALGORITHM, key, nonce, {
    authTagLength: GCM_TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const enc = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `v2:${keyId}:${nonce.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a queue payload. Supports authenticated `v2` payloads and the
 * legacy, unauthenticated `v1` format still in flight during the transition.
 *
 * @param ciphertext Serialised payload produced by {@link encryptPayload}.
 * @param aad        Queue/event name used as AAD when the payload was encrypted.
 */
export function decryptPayload<T = unknown>(
  ciphertext: string,
  aad: string = '',
): T {
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new Error('Invalid ciphertext: expected a non-empty string.');
  }

  const parts = ciphertext.split(':');
  switch (parts[0]) {
    case 'v2':
      return decryptV2<T>(parts, aad);
    case 'v1':
      return decryptV1<T>(parts);
    default:
      throw new Error(
        `Unsupported queue payload version "${parts[0] ?? ''}" — expected v1 or v2.`,
      );
  }
}
