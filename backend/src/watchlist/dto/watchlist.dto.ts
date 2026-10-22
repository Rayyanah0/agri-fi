import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsOptional, IsUUID } from 'class-validator';

/**
 * Funding percentages are range-checked, de-duplicated and sorted by
 * `WatchlistService.normalizeThresholds` so that create and update share one
 * set of rules.
 */
export class CreateWatchlistItemDto {
  @ApiProperty({
    description: 'Deal to star',
    example: '8b0c2f2a-2f1e-4c3b-9d3a-1f6f0c4d9b21',
  })
  @IsUUID()
  deal_id: string;

  @ApiProperty({
    description:
      'Funding percentages (1-100) to be notified about. Omit for the default 50% and 100%; send an empty array to silence funding alerts for this deal.',
    example: [25, 50, 75, 100],
    required: false,
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  notify_funding_pct?: number[];

  @ApiProperty({
    description: 'Notify when the deal changes lifecycle status',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  notify_status_change?: boolean;
}

export class UpdateWatchlistThresholdsDto {
  @ApiProperty({
    description: 'Replace the funding percentages to notify about',
    example: [75, 100],
    required: false,
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  notify_funding_pct?: number[];

  @ApiProperty({
    description: 'Turn status-change notifications on or off',
    example: false,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  notify_status_change?: boolean;
}
