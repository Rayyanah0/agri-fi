import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OracleController } from './oracle.controller';
import { OracleService } from './oracle.service';
import { OracleValidationService } from './oracle-validation.service';
import { OracleOnChainService } from './oracle-onchain.service';
import { ChainlinkProvider } from './providers/chainlink.provider';
import { BandProvider } from './providers/band.provider';
import { OracleFeed } from './entities/oracle-feed.entity';
import { OracleObservation } from './entities/oracle-observation.entity';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([OracleFeed, OracleObservation]),
  ],
  controllers: [OracleController],
  providers: [
    OracleService,
    OracleValidationService,
    OracleOnChainService,
    ChainlinkProvider,
    BandProvider,
  ],
  exports: [OracleService, OracleValidationService, OracleOnChainService],
})
export class OracleModule {}
