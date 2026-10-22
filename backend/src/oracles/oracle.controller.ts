import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { OracleService } from './oracle.service';
import {
  CreateOracleFeedDto,
  RunOracleFeedDto,
  UpdateOracleFeedDto,
} from './dto/oracle.dto';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('oracles')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ version: '1', path: 'oracles' })
export class OracleController {
  constructor(private readonly oracles: OracleService) {}

  @Get('feeds')
  @ApiOperation({ summary: 'List configured oracle feeds' })
  @ApiResponse({ status: 200, description: 'Oracle feeds' })
  async listFeeds(@Query('includeDisabled') includeDisabled?: string) {
    return this.oracles.listFeeds(includeDisabled !== 'false');
  }

  @Get('feeds/:feedId')
  @ApiOperation({ summary: 'Get a single oracle feed' })
  @ApiParam({ name: 'feedId', example: 'COCOA/USD' })
  async getFeed(@Param('feedId') feedId: string) {
    return this.oracles.getFeed(feedId);
  }

  @Post('feeds')
  @Roles('admin')
  @ApiOperation({ summary: 'Create an oracle feed configuration (admin)' })
  @ApiResponse({ status: 201, description: 'Feed created' })
  async createFeed(
    @Request() req: AuthRequest,
    @Body() dto: CreateOracleFeedDto,
  ) {
    return this.oracles.createFeed(req.user.id, dto);
  }

  @Patch('feeds/:feedId')
  @Roles('admin')
  @ApiOperation({ summary: 'Update an oracle feed configuration (admin)' })
  @ApiParam({ name: 'feedId', example: 'COCOA/USD' })
  async updateFeed(
    @Request() req: AuthRequest,
    @Param('feedId') feedId: string,
    @Body() dto: UpdateOracleFeedDto,
  ) {
    return this.oracles.updateFeed(req.user.id, feedId, dto);
  }

  @Post('feeds/:feedId/run')
  @Roles('admin')
  @ApiOperation({
    summary: 'Fetch, validate and (optionally) submit a feed on-chain',
  })
  @ApiParam({ name: 'feedId', example: 'COCOA/USD' })
  async runFeed(
    @Param('feedId') feedId: string,
    @Body() dto: RunOracleFeedDto,
  ) {
    return this.oracles.runFeed(feedId, { submit: dto.submit !== false });
  }

  @Post('feeds/:feedId/test')
  @Roles('admin')
  @ApiOperation({
    summary: 'Dry-run a feed against providers without writing on-chain',
  })
  @ApiParam({ name: 'feedId', example: 'COCOA/USD' })
  async testFeed(@Param('feedId') feedId: string) {
    return this.oracles.testFeed(feedId);
  }

  @Get('analytics')
  @Roles('admin')
  @ApiOperation({ summary: 'Oracle accuracy, latency and cost analytics (admin)' })
  async analytics(
    @Query('feedId') feedId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.oracles.getAnalytics(feedId, this.parseDate(from), this.parseDate(to));
  }

  @Get('costs')
  @Roles('admin')
  @ApiOperation({ summary: 'On-chain oracle cost summary (admin)' })
  async costs(@Query('feedId') feedId?: string) {
    return this.oracles.getCostSummary(feedId);
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
