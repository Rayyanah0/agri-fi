import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { REMEDIATION_ENVIRONMENTS } from './update-remediation-policy.dto';

export const REMEDIATION_ISSUE_TYPES = [
  'pod_failure',
  'pod_restart_loop',
  'high_memory',
  'high_cpu',
  'disk_full',
  'service_down',
  'service_degradation',
  'queue_backlog',
  'database_saturation',
  'certificate_expiry',
  'custom',
] as const;

export const REMEDIATION_INTERPRETERS = ['bash', 'sh', 'python3'] as const;

/**
 * Body used to register a custom remediation script.
 */
export class CreateRemediationScriptDto {
  @IsString()
  @MinLength(3)
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'name may only contain letters, digits, underscores and dashes',
  })
  name: string;

  @IsIn(REMEDIATION_ISSUE_TYPES)
  issueType: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[a-zA-Z0-9_./-]+$/, {
    message:
      'scriptPath may only contain letters, digits, dots, slashes, underscores and dashes',
  })
  scriptPath: string;

  @IsOptional()
  @IsIn(REMEDIATION_INTERPRETERS)
  interpreter?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1800)
  timeoutSeconds?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  defaultArgs?: string[];

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
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(REMEDIATION_ENVIRONMENTS, { each: true })
  allowedEnvironments?: string[];
}
