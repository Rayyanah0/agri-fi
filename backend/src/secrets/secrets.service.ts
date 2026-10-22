import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  RotateSecretCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';

export const SECRETS_MANAGER_CLIENT = 'SECRETS_MANAGER_CLIENT';
export interface SecretActor {
  id: string;
  role: string;
}

export interface ManagedSecretMetadata {
  secretId: string;
  name?: string;
  description?: string;
  rotationEnabled: boolean;
  lastRotatedDate?: Date;
  nextRotationDate?: Date;
  versionStages: Record<string, string[]>;
}

@Injectable()
export class SecretManagementService {
  private readonly logger = new Logger(SecretManagementService.name);

  constructor(
    @Inject(SECRETS_MANAGER_CLIENT)
    private readonly client: SecretsManagerClient,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async listManagedSecrets(
    actor?: SecretActor,
  ): Promise<ManagedSecretMetadata[]> {
    const secrets = await Promise.all(
      this.getManagedSecretIds().map((secretId) =>
        this.describeSecret(secretId),
      ),
    );
    await this.auditAccess(actor, 'LIST', 'managed-secrets', 200);
    return secrets;
  }

  async getSecretValue(
    secretId: string,
    versionStage: 'AWSCURRENT' | 'AWSPREVIOUS' = 'AWSCURRENT',
    actor?: SecretActor,
  ): Promise<string> {
    this.assertManagedSecret(secretId);
    try {
      const result = await this.client.send(
        new GetSecretValueCommand({
          SecretId: secretId,
          VersionStage: versionStage,
        }),
      );
      const value =
        result.SecretString ??
        (result.SecretBinary
          ? Buffer.from(result.SecretBinary).toString('utf8')
          : undefined);
      if (value === undefined) {
        throw new Error('Secret Manager returned an empty secret value.');
      }
      await this.auditAccess(actor, 'READ', secretId, 200, result.VersionId);
      return value;
    } catch (error) {
      await this.auditAccess(actor, 'READ', secretId, this.statusCode(error));
      throw error;
    }
  }

  async rotateSecret(
    secretId: string,
    actor: SecretActor,
  ): Promise<{ secretId: string; rotationStarted: boolean }> {
    this.assertManagedSecret(secretId);
    try {
      const metadata = await this.describeSecret(secretId);
      if (!metadata.rotationEnabled) {
        throw new BadRequestException(
          'Automatic rotation is not configured for this secret.',
        );
      }
      await this.client.send(new RotateSecretCommand({ SecretId: secretId }));
      await this.auditAccess(actor, 'ROTATE', secretId, 200);
      return { secretId, rotationStarted: true };
    } catch (error) {
      await this.auditAccess(actor, 'ROTATE', secretId, this.statusCode(error));
      throw error;
    }
  }

  async recoverPreviousVersion(
    secretId: string,
    actor: SecretActor,
  ): Promise<{ secretId: string; recoveredVersionId: string }> {
    this.assertManagedSecret(secretId);
    try {
      const metadata = await this.client.send(
        new DescribeSecretCommand({ SecretId: secretId }),
      );
      const versions = metadata.VersionIdsToStages ?? {};
      const previousVersionId = Object.entries(versions).find(([, stages]) =>
        stages.includes('AWSPREVIOUS'),
      )?.[0];
      const currentVersionId = Object.entries(versions).find(([, stages]) =>
        stages.includes('AWSCURRENT'),
      )?.[0];

      if (!previousVersionId || !currentVersionId) {
        throw new BadRequestException(
          'The secret does not have both current and previous versions.',
        );
      }

      await this.client.send(
        new UpdateSecretVersionStageCommand({
          SecretId: secretId,
          VersionStage: 'AWSCURRENT',
          MoveToVersionId: previousVersionId,
          RemoveFromVersionId: currentVersionId,
        }),
      );
      await this.auditAccess(
        actor,
        'RECOVER',
        secretId,
        200,
        previousVersionId,
      );
      return { secretId, recoveredVersionId: previousVersionId };
    } catch (error) {
      await this.auditAccess(
        actor,
        'RECOVER',
        secretId,
        this.statusCode(error),
      );
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async monitorRotationStatus(): Promise<void> {
    const requiredIds = this.getRotationRequiredIds();
    for (const secretId of requiredIds) {
      const metadata = await this.describeSecret(secretId);
      if (!metadata.rotationEnabled || !metadata.nextRotationDate) {
        this.logger.error(
          `Required secret has no active rotation schedule: ${secretId}`,
        );
      } else if (
        metadata.nextRotationDate &&
        metadata.nextRotationDate.getTime() < Date.now()
      ) {
        this.logger.error(`Required secret rotation is overdue: ${secretId}`);
      } else {
        this.logger.log(`Required secret rotation is configured: ${secretId}`);
      }
    }
  }

  private async describeSecret(
    secretId: string,
  ): Promise<ManagedSecretMetadata> {
    const result = await this.client.send(
      new DescribeSecretCommand({ SecretId: secretId }),
    );
    return {
      secretId,
      name: result.Name,
      description: result.Description,
      rotationEnabled: result.RotationEnabled ?? false,
      lastRotatedDate: result.LastRotatedDate,
      nextRotationDate: result.NextRotationDate,
      versionStages: Object.fromEntries(
        Object.entries(result.VersionIdsToStages ?? {}).map(
          ([versionId, stages]) => [versionId, stages ?? []],
        ),
      ),
    };
  }

  private getManagedSecretIds(): string[] {
    const ids = this.parseIds('SECRET_MANAGEMENT_SECRET_IDS');
    return ids;
  }

  private getRotationRequiredIds(): string[] {
    const ids = this.parseIds('SECRET_ROTATION_REQUIRED_IDS');
    return ids;
  }

  private parseIds(key: string): string[] {
    return [
      ...new Set(
        (this.config.get<string>(key, '') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
  }

  private assertManagedSecret(secretId: string): void {
    if (!this.getManagedSecretIds().includes(secretId)) {
      throw new NotFoundException('Secret is not managed by this application.');
    }
  }

  private async auditAccess(
    actor: SecretActor | undefined,
    action: string,
    secretId: string,
    statusCode: number,
    versionId?: string,
  ): Promise<void> {
    await this.audit.logEvent({
      actorId: actor?.id ?? 'application',
      actorRole: actor?.role ?? 'service',
      route: `SECRET ${action}`,
      statusCode,
      requestDetails: {
        secretId,
        ...(versionId ? { versionId } : {}),
      },
    });
  }

  private statusCode(error: unknown): number {
    return error instanceof HttpException ? error.getStatus() : 500;
  }
}
