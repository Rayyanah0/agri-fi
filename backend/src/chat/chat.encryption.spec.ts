import {
  chatFileEncryption,
  encryptedChatMessageTransformer,
} from './chat.encryption';

describe('chat encryption', () => {
  const previousKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  });

  it('encrypts message content and authenticates it when decrypted', () => {
    const plaintext = 'Deal delivery confirmed';
    const encrypted = encryptedChatMessageTransformer.to(plaintext);

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain(plaintext);
    expect(encryptedChatMessageTransformer.from(encrypted)).toBe(plaintext);
  });

  it('encrypts binary attachments and rejects tampering', () => {
    const original = Buffer.from([0, 1, 2, 3, 255]);
    const encrypted = chatFileEncryption.encrypt(original);

    expect(encrypted).not.toEqual(original);
    expect(chatFileEncryption.decrypt(encrypted)).toEqual(original);
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => chatFileEncryption.decrypt(encrypted)).toThrow();
  });

  it('fails closed when the encryption key is missing or malformed', () => {
    process.env.ENCRYPTION_KEY = 'not-a-key';
    expect(() => encryptedChatMessageTransformer.to('private')).toThrow(
      'ENCRYPTION_KEY must be a 64-character hex string',
    );
  });
});
