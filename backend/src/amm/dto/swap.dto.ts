import { IsString, IsEnum, IsOptional, Min, IsNumber } from 'class-validator';
import { SwapDirection } from '../entities/amm-swap.entity';

export class SwapDto {
  @IsString()
  poolId: string;

  @IsString()
  amountIn: string;

  @IsEnum(SwapDirection)
  direction: SwapDirection;

  @IsString()
  @IsOptional()
  minimumAmountOut?: string; // Slippage protection

  @IsNumber()
  @Min(0)
  @IsOptional()
  slippagePercentage?: number; // 0-100, takes precedence if minimumAmountOut not set

  @IsNumber()
  @Min(1)
  @IsOptional()
  deadlineSeconds?: number; // Transaction deadline
}

export class SwapQuoteDto {
  @IsString()
  poolId: string;

  @IsString()
  amountIn: string;

  @IsEnum(SwapDirection)
  direction: SwapDirection;
}

export class GetSwapHistoryDto {
  @IsString()
  poolId: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  limit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}
