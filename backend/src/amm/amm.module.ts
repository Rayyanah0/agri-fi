import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AMMPool } from './entities/amm-pool.entity';
import { AMMLiquidityPosition } from './entities/amm-liquidity-position.entity';
import { AMMSwap } from './entities/amm-swap.entity';
import { AMMMiningReward } from './entities/amm-mining-reward.entity';
import { AMMPoolService } from './services/amm-pool.service';
import { AMMSwapService } from './services/amm-swap.service';
import { AMMminingService } from './services/amm-mining.service';
import { AMMPricingService } from './services/amm-pricing.service';
import { AMMController } from './amm.controller';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AMMPool,
      AMMLiquidityPosition,
      AMMSwap,
      AMMMiningReward,
      TradeDeal,
    ]),
    ScheduleModule.forRoot(),
  ],
  providers: [AMMPoolService, AMMSwapService, AMMminingService, AMMPricingService],
  controllers: [AMMController],
  exports: [AMMPoolService, AMMSwapService, AMMminingService, AMMPricingService],
})
export class AMMModule {}
