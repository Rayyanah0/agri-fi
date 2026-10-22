import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveCreditScoreDisputeDto {
  @ApiProperty({
    description:
      'Decision on the dispute. `resolved` applies the correction, `rejected` closes it without a change.',
    enum: ['resolved', 'rejected'],
    example: 'resolved',
  })
  @IsIn(['resolved', 'rejected'])
  status: 'resolved' | 'rejected';

  @ApiProperty({
    description: "Administrator's note explaining the decision",
    example: 'Delivery milestone confirmed as on time; score corrected.',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  resolution: string;

  @ApiPropertyOptional({
    description:
      'Corrected score to apply. Required when the dispute is upheld; ignored when rejected.',
    minimum: 300,
    maximum: 850,
    example: 742,
  })
  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(850)
  correctedScore?: number;
}
