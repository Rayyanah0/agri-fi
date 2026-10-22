import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AMMPoolService } from './services/amm-pool.service';
import { AMMSwapService } from './services/amm-swap.service';
import { AMMminingService } from './services/amm-mining.service';
import { CreatePoolDto } from './dto/create-pool.dto';
import { AddLiquidityDto, RemoveLiquidityDto, GetQuoteDto } from './dto/liquidity.dto';
import { SwapDto, SwapQuoteDto } from './dto/swap.dto';

@ApiTags('AMM')
@Controller('api/amm')
export class AMMController {
  constructor(
    private poolService: AMMPoolService,
    private swapService: AMMSwapService,
    private miningService: AMMminingService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Pool Management
  // ─────────────────────────────────────────────────────────────────────────

  @Post('pools')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  async createPool(@Body() dto: CreatePoolDto, @Req() req: any) {
    return this.poolService.createPool(dto, req.user.id);
  }

  @Get('pools/:poolId')
  @HttpCode(HttpStatus.OK)
  async getPool(@Param('poolId') poolId: string) {
    return this.poolService.getPool(poolId);
  }

  @Get('pools/:poolId/analytics')
  @HttpCode(HttpStatus.OK)
  async getPoolAnalytics(@Param('poolId') poolId: string) {
    return this.poolService.getPoolAnalytics(poolId);
  }

  @Get('deals/:dealId/pools')
  @HttpCode(HttpStatus.OK)
  async getPoolsByDeal(@Param('dealId') dealId: string) {
    return this.poolService.getAllPools(dealId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Liquidity Management
  // ─────────────────────────────────────────────────────────────────────────

  @Post('liquidity/add')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  async addLiquidity(@Body() dto: AddLiquidityDto, @Req() req: any) {
    return this.poolService.addLiquidity(dto, req.user.id);
  }

  @Post('liquidity/remove')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async removeLiquidity(@Body() dto: RemoveLiquidityDto, @Req() req: any) {
    return this.poolService.removeLiquidity(dto, req.user.id);
  }

  @Get('positions/:poolId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getPosition(@Param('poolId') poolId: string, @Req() req: any) {
    return this.poolService.getPosition(poolId, req.user.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Swaps
  // ─────────────────────────────────────────────────────────────────────────

  @Post('swaps/quote')
  @HttpCode(HttpStatus.OK)
  async getSwapQuote(@Body() dto: SwapQuoteDto) {
    return this.swapService.getSwapQuote(dto);
  }

  @Post('swaps')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  async executeSwap(@Body() dto: SwapDto, @Req() req: any) {
    return this.swapService.executeSwap(dto, req.user.id);
  }

  @Get('swaps/history/:poolId')
  @HttpCode(HttpStatus.OK)
  async getSwapHistory(
    @Param('poolId') poolId: string,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
  ) {
    return this.swapService.getSwapHistory(poolId, limit, offset);
  }

  @Get('swaps/user/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getUserSwaps(
    @Param('userId') userId: string,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
    @Req() req: any,
  ) {
    if (userId !== req.user.id && !req.user.roles?.includes('admin')) {
      throw new Error('Unauthorized');
    }
    return this.swapService.getUserSwaps(userId, limit, offset);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Mining Rewards
  // ─────────────────────────────────────────────────────────────────────────

  @Get('rewards/claimable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getClaimableRewards(@Req() req: any) {
    return {
      claimableAmount: await this.miningService.getClaimableRewards(req.user.id),
    };
  }

  @Post('rewards/claim')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async claimRewards(@Req() req: any) {
    return this.miningService.claimRewards(req.user.id);
  }

  @Get('rewards/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getRewardHistory(
    @Query('limit') limit: number = 50,
    @Req() req: any,
  ) {
    return this.miningService.getRewardHistory(req.user.id, limit);
  }
}
