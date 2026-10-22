import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicApiController } from './public-api.controller';
import { AuthModule } from '../auth/auth.module';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ApiKey } from '../auth/entities/api-key.entity';
import { ApiKeyGuard } from '../common/guards';
import { ApiKeyThrottlerGuard } from '../common/throttler/api-key-throttler.guard';
import { ApiUsageEvent } from './entities/api-usage-event.entity';
import { PartnerApiUsage } from './entities/partner-api-usage.entity';
import { ApiUsageService } from './api-usage.service';
import { ApiUsageInterceptor } from './api-usage.interceptor';
import { ApiUsageController } from './api-usage.controller';
import { ApiUsageQuotaGuard } from './api-usage-quota.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey, ApiUsageEvent, PartnerApiUsage]),
    AuthModule,
    TradeDealsModule,
    WebhooksModule,
    NotificationsModule,
  ],
  controllers: [PublicApiController, ApiUsageController],
  providers: [ApiKeyGuard, ApiKeyThrottlerGuard, ApiUsageService, ApiUsageInterceptor, ApiUsageQuotaGuard],
  exports: [ApiKeyGuard, ApiKeyThrottlerGuard],
})
export class PublicApiModule {}
