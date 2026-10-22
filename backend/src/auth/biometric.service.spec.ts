import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { BiometricService } from './biometric.service';
import { BiometricCredential } from './entities/biometric-credential.entity';

describe('BiometricService (#1203)', () => {
  let service: BiometricService;
  let repo: jest.Mocked<Repository<BiometricCredential>>;

  const mockCredential: Partial<BiometricCredential> = {
    id: 'cred-uuid-1',
    userId: 'user-uuid-1',
    credentialId: 'cred-pub-123',
    publicKey: 'sample_public_key',
    signCount: 5,
    deviceName: 'iPhone 15 Pro',
    biometricType: 'facial',
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiometricService,
        {
          provide: getRepositoryToken(BiometricCredential),
          useValue: {
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'saved-id', ...entity })),
            findOne: jest.fn(),
            find: jest.fn(),
            count: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();

    service = module.get<BiometricService>(BiometricService);
    repo = module.get(getRepositoryToken(BiometricCredential));
  });

  describe('generateChallenge', () => {
    it('creates a cryptographic challenge and expiration timeout', () => {
      const result = service.generateChallenge('user-uuid-1');
      expect(result.challenge).toBeDefined();
      expect(result.challenge.length).toBeGreaterThan(20);
      expect(result.timeoutMs).toBe(60000);
    });
  });

  describe('enrollCredential', () => {
    it('successfully enrolls a new biometric authenticator', async () => {
      repo.findOne.mockResolvedValue(null);

      const enrolled = await service.enrollCredential('user-uuid-1', {
        credentialId: 'cred-new-999',
        publicKey: 'pubkey-abc',
        deviceName: 'Pixel 8',
        biometricType: 'fingerprint',
      });

      expect(enrolled.credentialId).toBe('cred-new-999');
      expect(enrolled.userId).toBe('user-uuid-1');
      expect(enrolled.isActive).toBe(true);
    });

    it('throws BadRequestException if credential ID already exists', async () => {
      repo.findOne.mockResolvedValue(mockCredential as BiometricCredential);

      await expect(
        service.enrollCredential('user-uuid-1', {
          credentialId: 'cred-pub-123',
          publicKey: 'key',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyAssertion', () => {
    it('successfully verifies assertion and increments counter', async () => {
      // 1. Generate challenge first
      service.generateChallenge('user-uuid-1');

      repo.findOne.mockResolvedValue({
        ...mockCredential,
      } as BiometricCredential);

      const result = await service.verifyAssertion('user-uuid-1', {
        credentialId: 'cred-pub-123',
        signature: 'valid_mock_signature',
        clientDataJson: '{"type":"webauthn.get"}',
        signCount: 10, // Monotonically higher than 5
      });

      expect(result.verified).toBe(true);
      expect(result.credentialId).toBe('cred-pub-123');
      expect(repo.save).toHaveBeenCalled();
    });

    it('rejects verification if challenge is missing or expired', async () => {
      await expect(
        service.verifyAssertion('user-without-challenge', {
          credentialId: 'cred-pub-123',
          signature: 'sig',
          clientDataJson: '{}',
          signCount: 6,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('detects cloned authenticator when signCount is non-increasing', async () => {
      service.generateChallenge('user-uuid-1');
      repo.findOne.mockResolvedValue({
        ...mockCredential,
        signCount: 20,
      } as BiometricCredential);

      await expect(
        service.verifyAssertion('user-uuid-1', {
          credentialId: 'cred-pub-123',
          signature: 'valid_mock_signature',
          clientDataJson: '{}',
          signCount: 15, // Replay or clone: counter <= 20
        }),
      ).rejects.toThrow('Potential cloned authenticator detected');
    });

    it('throws NotFoundException if credential is inactive or not found', async () => {
      service.generateChallenge('user-uuid-1');
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyAssertion('user-uuid-1', {
          credentialId: 'non-existent',
          signature: 'sig',
          clientDataJson: '{}',
          signCount: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeCredential', () => {
    it('deactivates an enrolled credential', async () => {
      const activeCred = { ...mockCredential, isActive: true };
      repo.findOne.mockResolvedValue(activeCred as BiometricCredential);

      const revoked = await service.revokeCredential('user-uuid-1', 'cred-pub-123');
      expect(revoked).toBe(true);
      expect(activeCred.isActive).toBe(false);
      expect(repo.save).toHaveBeenCalledWith(activeCred);
    });
  });
});
