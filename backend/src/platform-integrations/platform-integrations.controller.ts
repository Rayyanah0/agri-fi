import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlatformIntegrationsService } from './platform-integrations.service';

@Controller('platform')
@UseGuards(AuthGuard('jwt'))
export class PlatformIntegrationsController {
  constructor(private readonly service: PlatformIntegrationsService) {}

  @Get('calendar') listCalendars(@CurrentUser('id') userId: string) { return this.service.listCalendars(userId); }
  @Post('calendar') connectCalendar(@CurrentUser('id') userId: string, @Body() body: any) { return this.service.connectCalendar(userId, body); }
  @Put('calendar/event') upsertEvent(@CurrentUser('id') userId: string, @Body() body: any) { return this.service.upsertEvent(userId, body); }
  @Get('feature-flags/evaluate') evaluateFlag(@Query('key') key: string, @CurrentUser('id') userId: string, @Query('segment') segment?: string) { return this.service.evaluateFlag(key, userId, segment); }
  @Post('feature-flags')
  @UseGuards(RolesGuard)
  @Roles('admin', 'company_admin')
  saveFlag(@CurrentUser('id') userId: string, @Body() body: any) { return this.service.saveFlag(userId, body); }
  @Get('shards/route') routeShard(@Query('user_id') userId?: string, @Query('deal_id') dealId?: string) { return this.service.routeShard(userId, dealId); }
}