import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VaRMethod } from '../portfolio-var.calculator';

export const VAR_CONFIDENCE_LEVELS = [0.95, 0.99, 0.999] as const;
export const VAR_HORIZONS = [1, 10, 30] as const;

export class PortfolioVaRQueryDto {
  @IsOptional()
  @IsIn(['historical', 'parametric', 'monte_carlo'])
  method: VaRMethod = 'historical';

  @IsOptional()
  @Type(() => Number)
  @IsIn(VAR_CONFIDENCE_LEVELS)
  confidenceLevel = 0.95;

  @IsOptional()
  @Type(() => Number)
  @IsIn(VAR_HORIZONS)
  horizonDays = 1;
}

export class SetPortfolioVaRLimitDto {
  @Type(() => Number)
  @IsIn(VAR_CONFIDENCE_LEVELS)
  confidenceLevel: number;

  @Type(() => Number)
  @IsIn(VAR_HORIZONS)
  horizonDays: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0.01)
  limitUsd: number;
}

export class PortfolioVaRStressScenarioDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsObject()
  shocks: Record<string, number>;
}

export class PortfolioVaRStressTestDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PortfolioVaRStressScenarioDto)
  scenarios?: PortfolioVaRStressScenarioDto[];
}
