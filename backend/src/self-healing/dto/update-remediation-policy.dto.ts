import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const REMEDIATION_ENVIRONMENTS = ['staging', 'production'] as const;

/**
 * Body of a remediation policy update.
 *
 * Every field is optional so that operators can tighten or relax a single
 * aspect of a policy without rewriting it.
 */
export class UpdateRemediationPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  destructive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxExecutionsPerHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  cooldownMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(REMEDIATION_ENVIRONMENTS, { each: true })
  allowedEnvironments?: string[];

  @IsOptional()
  @IsBoolean()
  stagingValidated?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  minReplicas?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  maxReplicas?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
