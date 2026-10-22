import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../common/guards';
import { EdgeAuthGuard } from './edge-auth.guard';
import { EdgeService } from './edge.service';

@Controller({ path: 'edge', version: '1' })
export class EdgeController {
  constructor(private readonly edgeService: EdgeService) {}

  @Post('heartbeat')
  @UseGuards(EdgeAuthGuard)
  heartbeat(@Req() request: { edgeNodeId: string }, @Body() body: { region: string; latencyMs: number; queuedItems: number; bytesSynced: number; lastError?: string | null }) {
    return this.edgeService.heartbeat(request.edgeNodeId, body);
  }

  @Post('sync')
  @UseGuards(EdgeAuthGuard)
  sync(@Req() request: { edgeNodeId: string }, @Body() body: { events: Array<{ eventId: string; type: string; payload: Record<string, unknown> }> }) {
    return this.edgeService.ingestBatch(request.edgeNodeId, body.events);
  }

  @Get('status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getStatus() {
    return this.edgeService.getStatus();
  }

  @Get('analytics')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getAnalytics() {
    return this.edgeService.getAnalytics();
  }
}