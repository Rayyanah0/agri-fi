import { Module } from '@nestjs/common';
import { MarketPredictionService } from './market-prediction.service';

@Module({
  providers: [MarketPredictionService],
  exports: [MarketPredictionService],
})
export class MarketPredictionModule {}
