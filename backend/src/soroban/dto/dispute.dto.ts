import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * Raising, resolving and reading a dispute all key off the disputed milestone,
 * so they share one DTO.
 */
export class DisputeMilestoneDto {
  @ApiProperty({
    description: 'Zero-based index of the disputed milestone',
    example: 0,
  })
  @IsInt()
  @Min(0)
  milestoneIndex: number;
}

/** Evidence submission additionally requires a document reference. */
export class DisputeEvidenceDto extends DisputeMilestoneDto {
  @ApiProperty({
    description: 'Document reference attached as evidence',
    example: 'https://docs.example/inspection-report.pdf',
  })
  @IsString()
  @MaxLength(512)
  @Matches(/\S/, { message: 'uri must not be blank' })
  uri: string;
}

/**
 * FarmCampaign `#[contracterror]` codes the dispute entrypoints can return
 * (#1004). The simulation error only carries the numeric code, so the API maps
 * it to a stable string clients can branch on.
 */
export const DISPUTE_ERROR_CODES: Record<number, string> = {
  15: 'DISPUTE_ACTIVE',
  16: 'NO_DISPUTE',
  19: 'VOTING_WINDOW_CLOSED',
  20: 'VOTING_NOT_OVER',
  21: 'ALREADY_VOTED',
  22: 'NOT_AN_ARBITRATOR',
  23: 'EVIDENCE_LIMIT_REACHED',
  24: 'EMPTY_ARBITRATOR_POOL',
  25: 'DISPUTE_DECIDED',
  26: 'INVALID_EVIDENCE',
};
