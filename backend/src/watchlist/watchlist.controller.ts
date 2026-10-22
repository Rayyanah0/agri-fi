import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WatchlistService, WatchlistEntry } from './watchlist.service';
import {
  CreateWatchlistItemDto,
  UpdateWatchlistThresholdsDto,
} from './dto/watchlist.dto';

/**
 * Investor watchlist (#1003): star a deal, choose the funding percentages and
 * status changes worth notifying about.
 */
@ApiTags('watchlist')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1', path: 'watchlist' })
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  @ApiOperation({ summary: 'List the deals on the current investor watchlist' })
  @ApiResponse({
    status: 200,
    description: 'Watchlist entries with deal summary',
  })
  async list(@CurrentUser('id') userId: string): Promise<WatchlistEntry[]> {
    return this.watchlistService.list(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a deal to the watchlist (idempotent)',
    description:
      'Starring a deal that is already watched returns the existing entry and leaves its alert watermarks untouched.',
  })
  @ApiResponse({ status: 201, description: 'Watchlist entry' })
  @ApiResponse({
    status: 400,
    description: 'Threshold out of range or draft deal',
  })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async add(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWatchlistItemDto,
  ): Promise<{ created: boolean; item: WatchlistEntry }> {
    const { item, created } = await this.watchlistService.add(userId, dto);
    return { created, item };
  }

  @Patch(':dealId')
  @ApiOperation({ summary: 'Update alert thresholds for a watched deal' })
  @ApiParam({ name: 'dealId', description: 'Watched deal UUID' })
  @ApiResponse({ status: 200, description: 'Updated watchlist entry' })
  @ApiResponse({ status: 404, description: 'Deal is not on your watchlist' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('dealId') dealId: string,
    @Body() dto: UpdateWatchlistThresholdsDto,
  ): Promise<WatchlistEntry> {
    return this.watchlistService.update(userId, dealId, dto);
  }

  @Delete(':dealId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a deal from the watchlist' })
  @ApiParam({ name: 'dealId', description: 'Watched deal UUID' })
  @ApiResponse({ status: 204, description: 'Removed from watchlist' })
  @ApiResponse({ status: 404, description: 'Deal is not on your watchlist' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('dealId') dealId: string,
  ): Promise<void> {
    await this.watchlistService.remove(userId, dealId);
  }
}
