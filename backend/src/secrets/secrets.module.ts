import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AuditModule } from '../audit/audit.module';
import { RolesGuard } from '../auth/roles.guard';
import { SecretManagementController } from './secrets.controller';
import {
  SECRETS_MANAGER_CLIENT,
  SecretManagementService,
} from './secrets.service';

@Module({
  imports: [ConfigModule, PassportModule, AuditModule],
  controllers: [SecretManagementController],
  providers: [
    RolesGuard,
    {
      provide: SECRETS_MANAGER_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new SecretsManagerClient({
          region: config.get<string>('AWS_REGION', 'us-east-1'),
        }),
    },
    SecretManagementService,
  ],
  exports: [SecretManagementService],
})
export class SecretsModule {}
