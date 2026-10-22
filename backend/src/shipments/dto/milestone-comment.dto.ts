import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateMilestoneCommentDto {
  @IsNotEmpty()
  @IsString()
  milestoneId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class MilestoneCommentResponseDto {
  id: string;
  milestoneId: string;
  userId: string;
  userDisplayName: string;
  content: string;
  role: string | null;
  createdAt: Date;
  updatedAt: Date;
}
