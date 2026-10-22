import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CalendarConnection } from './entities/calendar-connection.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FeatureFlagAudit } from './entities/feature-flag-audit.entity';
import { Shard } from './entities/shard.entity';
import { PlatformIntegrationsController } from './platform-integrations.controller';
import { PlatformIntegrationsService } from './platform-integrations.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([CalendarConnection, CalendarEvent, FeatureFlag, FeatureFlagAudit, Shard])],
  controllers: [PlatformIntegrationsController],
  providers: [PlatformIntegrationsService],
  exports: [PlatformIntegrationsService],
})
export class PlatformIntegrationsModule {}