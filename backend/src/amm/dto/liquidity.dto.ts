import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class AddLiquidityDto {
  @IsString()
  poolId: string;

  @IsString()
  amount0: string; // Token0 amount

  @IsString()
  amount1: string; // Token1 amount

  @IsString()
  @IsOptional()
  minLpTokens?: string; // Minimum LP tokens expected

  @IsNumber()
  @Min(0)
  @IsOptional()
  slippagePercentage?: number; // 0-100
}

export class RemoveLiquidityDto {
  @IsString()
  poolId: string;

  @IsString()
  lpTokenAmount: string;

  @IsString()
  @IsOptional()
  minAmount0?: string; // Minimum token0 expected

  @IsString()
  @IsOptional()
  minAmount1?: string; // Minimum token1 expected

  @IsNumber()
  @Min(0)
  @IsOptional()
  slippagePercentage?: number;
}

export class GetQuoteDto {
  @IsString()
  poolId: string;

  @IsString()
  amountIn: string;

  @IsString()
  @IsOptional()
  direction?: 'token0_to_token1' | 'token1_to_token0';
}

export class GetPositionDto {
  @IsString()
  poolId: string;

  @IsString()
  userId: string;
}
