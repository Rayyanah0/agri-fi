import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ShipmentsService } from './shipments.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { CreateMilestoneCommentDto } from './dto/milestone-comment.dto';
import { CreateMilestoneVerificationDto } from './dto/milestone-verification.dto';
import { CreateSensorReadingsDto } from './dto/create-sensor-readings.dto';
import { SensorReadingsService } from './sensor-readings.service';
import { User } from '../auth/entities/user.entity';
import { TradeDealsGuard } from '../trade-deals/trade-deals.guard';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('shipments')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'shipments', version: '1' })
export class ShipmentsController {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly sensorReadingsService: SensorReadingsService,
  ) {}

  @Get(':trade_deal_id')
  @UseGuards(TradeDealsGuard)
  @ApiOperation({ summary: 'List shipment milestones for a trade deal' })
  @ApiParam({ name: 'trade_deal_id', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'Ordered list of milestones' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async getMilestonesByDeal(@Param('trade_deal_id') tradeDealId: string) {
    return this.shipmentsService.findByDeal(tradeDealId);
  }

  @Post('milestones')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a shipment milestone (trader only)' })
  @ApiResponse({ status: 201, description: 'Milestone recorded' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or milestone out of sequence',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Only traders can record milestones',
  })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async recordMilestone(
    @Request() req: AuthRequest,
    @Body() dto: CreateMilestoneDto,
  ) {
    const user: User = req.user;
    if (user.role !== 'trader') {
      throw new ForbiddenException({
        code: 'ROLE_REQUIRED',
        message: 'Only traders can record milestones.',
      });
    }
    return this.shipmentsService.recordMilestone(user.id, dto);
  }

  @Post(':id/sensor-readings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ingest a batch of IoT sensor readings for a shipment (#849)',
  })
  @ApiParam({ name: 'id', description: 'Trade deal / shipment UUID' })
  @ApiResponse({
    status: 201,
    description: 'Readings saved; returns count and alert count',
  })
  @ApiResponse({ status: 400, description: 'Validation error or empty batch' })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  async ingestSensorReadings(
    @Param('id') id: string,
    @Body() dto: CreateSensorReadingsDto,
  ) {
    return this.sensorReadingsService.ingestBatch(id, dto);
  }

  @Get(':id/sensor-readings')
  @ApiOperation({ summary: 'List sensor readings for a shipment' })
  @ApiParam({ name: 'id', description: 'Trade deal / shipment UUID' })
  @ApiResponse({ status: 200, description: 'Ordered list of sensor readings' })
  async getSensorReadings(@Param('id') id: string) {
    return this.sensorReadingsService.findByShipment(id);
  }

  @Post('milestones/:milestoneId/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a collaborative comment to a milestone' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone UUID' })
  @ApiResponse({ status: 201, description: 'Comment created' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  async addComment(
    @Request() req: AuthRequest,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: CreateMilestoneCommentDto,
  ) {
    const user: User = req.user;
    return this.shipmentsService.addComment(
      user.id,
      user.displayName || user.email,
      { ...dto, milestoneId },
    );
  }

  @Get('milestones/:milestoneId/comments')
  @ApiOperation({ summary: 'Get all comments for a milestone' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone UUID' })
  @ApiResponse({ status: 200, description: 'List of comments' })
  async getComments(@Param('milestoneId') milestoneId: string) {
    return this.shipmentsService.getComments(milestoneId);
  }

  @Post('milestones/:milestoneId/verify')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Verify or reject a milestone' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone UUID' })
  @ApiResponse({ status: 201, description: 'Verification recorded' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  async verifyMilestone(
    @Request() req: AuthRequest,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: CreateMilestoneVerificationDto,
  ) {
    const user: User = req.user;
    return this.shipmentsService.verifyMilestone(user.id, user.role, {
      ...dto,
      milestoneId,
    });
  }

  @Get('milestones/:milestoneId/verifications')
  @ApiOperation({ summary: 'Get all verifications for a milestone' })
  @ApiParam({ name: 'milestoneId', description: 'Milestone UUID' })
  @ApiResponse({ status: 200, description: 'List of verifications' })
  async getVerifications(@Param('milestoneId') milestoneId: string) {
    return this.shipmentsService.getVerifications(milestoneId);
  }

  @Get('deals/:tradeDealId/history')
  @UseGuards(TradeDealsGuard)
  @ApiOperation({
    summary: 'Get complete milestone history with comments and verifications',
  })
  @ApiParam({ name: 'tradeDealId', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'Milestone history' })
  async getMilestoneHistory(@Param('tradeDealId') tradeDealId: string) {
    return this.shipmentsService.getMilestoneHistory(tradeDealId);
  }
}
