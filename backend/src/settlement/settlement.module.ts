import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementService } from './settlement.service';
import { NettingService } from './netting.service';
import { NettingController } from './netting.controller';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { NettingCycle } from './entities/netting-cycle.entity';
import { NettingObligation } from './entities/netting-obligation.entity';
import { SorobanModule } from '../soroban/soroban.module';
import { StellarModule } from '../stellar/stellar.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradeDeal,
      Document,
      NettingCycle,
      NettingObligation,
    ]),
    SorobanModule,
    StellarModule,
    NotificationsModule,
  ],
  controllers: [NettingController],
  providers: [SettlementService, NettingService],
  exports: [SettlementService, NettingService],
})
export class SettlementModule {}
