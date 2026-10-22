import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ValueTransformer } from 'typeorm';

const MESSAGE_PREFIX = 'enc:v1:';
const FILE_PREFIX = Buffer.from('AGF1');

function encryptionKey(): Buffer {
  const value = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string for chat encryption',
    );
  }
  return Buffer.from(value, 'hex');
}

function encryptBytes(value: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([FILE_PREFIX, iv, cipher.getAuthTag(), encrypted]);
}

function decryptBytes(value: Buffer): Buffer {
  if (
    value.length < FILE_PREFIX.length + 12 + 16 ||
    !value.subarray(0, FILE_PREFIX.length).equals(FILE_PREFIX)
  ) {
    throw new Error(
      'Stored chat attachment is not encrypted or has an invalid format',
    );
  }

  const ivStart = FILE_PREFIX.length;
  const tagStart = ivStart + 12;
  const dataStart = tagStart + 16;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    value.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(value.subarray(tagStart, dataStart));
  return Buffer.concat([
    decipher.update(value.subarray(dataStart)),
    decipher.final(),
  ]);
}

export const encryptedChatMessageTransformer: ValueTransformer = {
  to(value: string | null | undefined): string | null {
    if (value == null) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return `${MESSAGE_PREFIX}${iv.toString('hex')}:${cipher
      .getAuthTag()
      .toString('hex')}:${encrypted.toString('hex')}`;
  },
  from(value: string | null | undefined): string | null {
    if (value == null) return null;
    const [ivHex, tagHex, encryptedHex] = value
      .slice(MESSAGE_PREFIX.length)
      .split(':');
    if (
      !value.startsWith(MESSAGE_PREFIX) ||
      !ivHex ||
      !tagHex ||
      !encryptedHex
    ) {
      throw new Error(
        'Stored chat message is not encrypted or has an invalid format',
      );
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  },
};

export const chatFileEncryption = {
  encrypt: encryptBytes,
  decrypt: decryptBytes,
};
