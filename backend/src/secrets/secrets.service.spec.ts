import { ConfigService } from '@nestjs/config';
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  RotateSecretCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';
import { AuditService } from '../audit/audit.service';
import { SecretManagementService } from './secrets.service';

describe('SecretManagementService', () => {
  let service: SecretManagementService;
  let send: jest.Mock;
  let audit: jest.Mock;
  let client: SecretsManagerClient;

  beforeEach(() => {
    send = jest.fn();
    audit = jest.fn().mockResolvedValue({});
    client = { send } as unknown as SecretsManagerClient;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'SECRET_MANAGEMENT_SECRET_IDS') return 'secret-a, secret-b';
        if (key === 'SECRET_ROTATION_REQUIRED_IDS') return 'secret-a';
        return '';
      }),
    } as unknown as ConfigService;
    service = new SecretManagementService(client, config, {
      logEvent: audit,
    } as unknown as AuditService);
  });

  it('rejects reads of secrets outside the configured allow-list', async () => {
    await expect(service.getSecretValue('unmanaged')).rejects.toThrow(
      'Secret is not managed by this application.',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('returns secret data only from the internal getter and audits the read', async () => {
    send.mockResolvedValue({ SecretString: 'private-value', VersionId: 'v1' });

    await expect(service.getSecretValue('secret-a')).resolves.toBe(
      'private-value',
    );

    expect(send.mock.calls[0][0]).toBeInstanceOf(GetSecretValueCommand);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'SECRET READ',
        requestDetails: { secretId: 'secret-a', versionId: 'v1' },
      }),
    );
  });

  it('starts rotation only when rotation is enabled', async () => {
    send.mockResolvedValueOnce({ RotationEnabled: true });
    send.mockResolvedValueOnce({});

    await expect(
      service.rotateSecret('secret-a', { id: 'admin-id', role: 'admin' }),
    ).resolves.toEqual({ secretId: 'secret-a', rotationStarted: true });

    expect(send.mock.calls[0][0]).toBeInstanceOf(DescribeSecretCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(RotateSecretCommand);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'SECRET ROTATE', actorId: 'admin-id' }),
    );
  });

  it('promotes AWSPREVIOUS and audits the recovered version without returning its value', async () => {
    send.mockResolvedValueOnce({
      VersionIdsToStages: {
        current: ['AWSCURRENT'],
        previous: ['AWSPREVIOUS'],
      },
    });
    send.mockResolvedValueOnce({});

    await expect(
      service.recoverPreviousVersion('secret-a', {
        id: 'admin-id',
        role: 'admin',
      }),
    ).resolves.toEqual({
      secretId: 'secret-a',
      recoveredVersionId: 'previous',
    });

    expect(send.mock.calls[1][0]).toBeInstanceOf(
      UpdateSecretVersionStageCommand,
    );
  });
});
