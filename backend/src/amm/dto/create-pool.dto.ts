import { IsString, IsNumber, IsEnum, IsOptional, Min, Max } from 'class-validator';
import { PricingModel } from '../entities/amm-pool.entity';

export class CreatePoolDto {
  @IsString()
  dealId: string;

  @IsString()
  reserveToken0: string; // Deal token amount

  @IsString()
  reserveToken1: string; // Quote token (USDC) amount

  @IsNumber()
  @Min(0)
  @Max(100)
  feePercentage: number; // e.g., 0.3 for 0.3%

  @IsEnum(PricingModel)
  @IsOptional()
  pricingModel?: PricingModel;

  @IsNumber()
  @IsOptional()
  @Min(0.1)
  amplificationFactor?: number; // For stable swap

  @IsString()
  @IsOptional()
  minInitialLiquidity?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
