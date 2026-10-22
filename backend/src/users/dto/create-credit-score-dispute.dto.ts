import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The scoring dimensions a farmer may challenge. Kept in sync with the
 * factor keys exposed by the credit score disclosure.
 */
export const DISPUTABLE_CREDIT_SCORE_FACTORS = [
  'onTimeRepayment',
  'repaymentHistory',
  'dealCompletion',
  'shipmentAccuracy',
  'sensorMilestoneCompliance',
  'documentQuality',
  'kycAge',
] as const;

export type DisputableCreditScoreFactor =
  (typeof DISPUTABLE_CREDIT_SCORE_FACTORS)[number];

export class CreateCreditScoreDisputeDto {
  @ApiProperty({
    description: 'Why the farmer believes their score is wrong',
    example:
      'My cocoa delivery was recorded on the contractual date, but the score shows a late delivery.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;

  @ApiPropertyOptional({
    description: 'Which scoring dimension was mis-measured',
    enum: DISPUTABLE_CREDIT_SCORE_FACTORS,
    example: 'onTimeRepayment',
  })
  @IsOptional()
  @IsIn(DISPUTABLE_CREDIT_SCORE_FACTORS as unknown as string[])
  factor?: DisputableCreditScoreFactor;
}
