import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class CreateMilestoneVerificationDto {
  @IsNotEmpty()
  @IsString()
  milestoneId: string;

  @IsNotEmpty()
  @IsIn(['verified', 'rejected'])
  status: 'verified' | 'rejected';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class MilestoneVerificationResponseDto {
  id: string;
  milestoneId: string;
  verifiedBy: string;
  verifierRole: string;
  status: 'verified' | 'rejected';
  notes: string | null;
  verifiedAt: Date;
}
