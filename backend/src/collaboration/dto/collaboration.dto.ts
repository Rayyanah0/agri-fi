import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RoomTargetDto {
  @ApiProperty({
    description: 'Resource being collaboratively viewed',
    enum: ['deal', 'document'],
    example: 'deal',
  })
  @IsIn(['deal', 'document'])
  resourceType: 'deal' | 'document';

  @ApiProperty({ description: 'UUID of the deal or document' })
  @IsString()
  resourceId: string;
}

export class JoinRoomDto extends RoomTargetDto {
  @ApiProperty({
    description: 'Display name shown next to the cursor / in presence',
    required: false,
    example: 'Amina O.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiProperty({
    description: 'Avatar URL shown with the presence indicator',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatarUrl?: string;
}

export class LeaveRoomDto extends RoomTargetDto {}

export class CursorMoveDto extends RoomTargetDto {
  @ApiProperty({ description: 'Normalized x position (0..1)', example: 0.42 })
  @IsNumber()
  @Min(0)
  @Max(1)
  x: number;

  @ApiProperty({ description: 'Normalized y position (0..1)', example: 0.18 })
  @IsNumber()
  @Min(0)
  @Max(1)
  y: number;
}

export class TypingDto extends RoomTargetDto {
  @ApiProperty({ description: 'Whether the user is currently typing' })
  @IsBoolean()
  isTyping: boolean;
}

export class PresenceVisibilityDto extends RoomTargetDto {
  @ApiProperty({ description: 'Whether this user is visible to collaborators' })
  @IsBoolean()
  visible: boolean;
}

export class UpdateCollaborationPermissionDto {
  @ApiProperty({
    description: 'Who may view presence for this resource',
    enum: ['everyone', 'invited'],
    required: false,
  })
  @IsOptional()
  @IsIn(['everyone', 'invited'])
  visibility?: 'everyone' | 'invited';

  @ApiProperty({
    description:
      'Whether the target user may view presence (used with visibility=invited)',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  canViewPresence?: boolean;

  @ApiProperty({
    description: 'Target user UUID; omit for the resource default policy',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class CollaborationHistoryQueryDto {
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({ required: false, description: 'ISO start date' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({ required: false, description: 'ISO end date' })
  @IsOptional()
  @IsString()
  to?: string;
}
