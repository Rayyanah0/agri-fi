import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OracleDataType,
  OracleProviderName,
} from '../entities/oracle-feed.entity';

const PROVIDERS: OracleProviderName[] = ['chainlink', 'band'];
const DATA_TYPES: OracleDataType[] = ['commodity', 'weather', 'fx'];

export class CreateOracleFeedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @ApiProperty({ example: 'COCOA/USD', description: 'Unique feed identifier' })
  feedId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({ description: 'Human readable description' })
  description?: string;

  @IsOptional()
  @IsIn(DATA_TYPES)
  @ApiPropertyOptional({ enum: DATA_TYPES, default: 'commodity' })
  dataType?: OracleDataType;

  @IsArray()
  @IsIn(PROVIDERS, { each: true })
  @ApiProperty({
    enum: PROVIDERS,
    isArray: true,
    example: ['chainlink', 'band'],
    description: 'Ordered providers — first is primary, rest are fallbacks',
  })
  providers: OracleProviderName[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @ApiPropertyOptional({ default: 1, description: 'Minimum agreeing sources' })
  quorum?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  @ApiPropertyOptional({ default: 7 })
  decimals?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({ default: 3600, description: 'Max age in seconds' })
  heartbeatSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  @ApiPropertyOptional({ default: 1000, description: 'Max move in bps' })
  maxDeviationBps?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiPropertyOptional({ description: 'PriceFeed Soroban contract id' })
  contractId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiPropertyOptional({ description: 'Stellar oracle submitter address' })
  oracleAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ description: 'Max on-chain cost per day (XLM)' })
  maxDailyCostXlm?: number;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ default: true })
  enabled?: boolean;
}

export class UpdateOracleFeedDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsIn(DATA_TYPES)
  dataType?: OracleDataType;

  @IsOptional()
  @IsArray()
  @IsIn(PROVIDERS, { each: true })
  providers?: OracleProviderName[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  quorum?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  decimals?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  heartbeatSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxDeviationBps?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contractId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  oracleAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDailyCostXlm?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class RunOracleFeedDto {
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    default: true,
    description: 'Submit the consensus value on-chain when possible',
  })
  submit?: boolean;
}
