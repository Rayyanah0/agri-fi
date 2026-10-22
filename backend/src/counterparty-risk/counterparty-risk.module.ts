import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CounterpartyRiskService } from './counterparty-risk.service';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Investment, User])],
  providers: [CounterpartyRiskService],
  exports: [CounterpartyRiskService],
})
export class CounterpartyRiskModule {}
