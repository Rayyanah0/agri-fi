import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../auth/entities/user.entity';
import { CollaborationService } from './collaboration.service';
import {
  CollaborationHistoryQueryDto,
  UpdateCollaborationPermissionDto,
} from './dto/collaboration.dto';
import { PublicPresence } from './presence.service';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('collaboration')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ version: '1', path: 'collaboration' })
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Get('analytics')
  @Roles('admin')
  @ApiOperation({ summary: 'Global collaboration analytics (admin)' })
  @ApiResponse({ status: 200, description: 'Per-resource collaboration stats' })
  async globalAnalytics(
    @Query() query: CollaborationHistoryQueryDto,
  ): Promise<unknown> {
    return this.collaboration.getGlobalAnalytics(
      this.parseDate(query.from),
      this.parseDate(query.to),
    );
  }

  @Get(':resourceType/:resourceId/presence')
  @ApiOperation({ summary: 'Current presence for a resource' })
  @ApiResponse({ status: 200, description: 'List of visible participants' })
  async presence(
    @Request() req: AuthRequest,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
  ): Promise<{ users: PublicPresence[] }> {
    const users = await this.collaboration.presenceFor(
      this.actor(req),
      CollaborationService.normalizeResourceType(resourceType),
      resourceId,
    );
    return { users };
  }

  @Get(':resourceType/:resourceId/history')
  @ApiOperation({ summary: 'Collaboration session history' })
  @ApiParam({ name: 'resourceType', enum: ['deal', 'document'] })
  async history(
    @Request() req: AuthRequest,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @Query() query: CollaborationHistoryQueryDto,
  ): Promise<unknown> {
    return this.collaboration.getHistory(
      this.actor(req),
      CollaborationService.normalizeResourceType(resourceType),
      resourceId,
      query.limit ?? 50,
    );
  }

  @Get(':resourceType/:resourceId/analytics')
  @ApiOperation({ summary: 'Collaboration analytics for a resource' })
  async analytics(
    @Request() req: AuthRequest,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @Query() query: CollaborationHistoryQueryDto,
  ): Promise<unknown> {
    return this.collaboration.getAnalytics(
      this.actor(req),
      CollaborationService.normalizeResourceType(resourceType),
      resourceId,
      this.parseDate(query.from),
      this.parseDate(query.to),
    );
  }

  @Get(':resourceType/:resourceId/permissions')
  @ApiOperation({ summary: 'Collaboration permission policy' })
  async permissions(
    @Request() req: AuthRequest,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
  ): Promise<unknown> {
    await this.assertManage(req, resourceType, resourceId);
    return this.collaboration.getPermissions(
      CollaborationService.normalizeResourceType(resourceType),
      resourceId,
    );
  }

  @Put(':resourceType/:resourceId/permissions')
  @ApiOperation({ summary: 'Update collaboration permissions (owner/admin)' })
  async updatePermissions(
    @Request() req: AuthRequest,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @Body() dto: UpdateCollaborationPermissionDto,
  ): Promise<unknown> {
    return this.collaboration.upsertPermissions(
      this.actor(req),
      CollaborationService.normalizeResourceType(resourceType),
      resourceId,
      dto,
    );
  }

  @Put(':resourceType/:resourceId/presence-visibility')
  @ApiOperation({ summary: 'Hide or show my presence (privacy)' })
  async setPresenceVisibility(
    @Request() req: AuthRequest,
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @Body() body: { visible: boolean },
  ): Promise<{ ok: boolean }> {
    await this.collaboration.setPresenceVisibility(
      req.user.id,
      CollaborationService.normalizeResourceType(resourceType),
      resourceId,
      body.visible !== false,
    );
    return { ok: true };
  }

  private async assertManage(
    req: AuthRequest,
    resourceType: string,
    resourceId: string,
  ): Promise<void> {
    const allowed = await this.collaboration.canManage(
      this.actor(req),
      CollaborationService.normalizeResourceType(resourceType),
      resourceId,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Only the resource owner may manage collaboration permissions',
      );
    }
  }

  private actor(req: AuthRequest): { id: string; role?: string } {
    return { id: req.user.id, role: req.user.role };
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
