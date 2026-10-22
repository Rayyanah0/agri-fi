import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import BigNumber from 'bignumber.js';
import { AMMPool, PoolStatus, PricingModel } from '../entities/amm-pool.entity';
import { AMMLiquidityPosition } from '../entities/amm-liquidity-position.entity';
import { CreatePoolDto } from '../dto/create-pool.dto';
import { AddLiquidityDto, RemoveLiquidityDto } from '../dto/liquidity.dto';
import { AMMPricingService } from './amm-pricing.service';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

@Injectable()
export class AMMPoolService {
  constructor(
    @InjectRepository(AMMPool)
    private poolRepository: Repository<AMMPool>,
    @InjectRepository(AMMLiquidityPosition)
    private liquidityPositionRepository: Repository<AMMLiquidityPosition>,
    @InjectRepository(TradeDeal)
    private dealRepository: Repository<TradeDeal>,
    private pricingService: AMMPricingService,
  ) {}

  async createPool(dto: CreatePoolDto, creatorId: string): Promise<AMMPool> {
    // Verify deal exists
    const deal = await this.dealRepository.findOne({
      where: { id: dto.dealId },
    });
    if (!deal) {
      throw new NotFoundException(`Deal ${dto.dealId} not found`);
    }

    // Validate initial reserves
    const reserve0 = new BigNumber(dto.reserveToken0);
    const reserve1 = new BigNumber(dto.reserveToken1);

    if (reserve0.isLessThanOrEqualTo(0) || reserve1.isLessThanOrEqualTo(0)) {
      throw new BadRequestException('Initial reserves must be positive');
    }

    // Create pool
    const pool = this.poolRepository.create({
      dealId: dto.dealId,
      creatorId,
      reserveToken0: reserve0.toFixed(8),
      reserveToken1: reserve1.toFixed(8),
      feePercentage: dto.feePercentage || 0.3,
      pricingModel: dto.pricingModel || PricingModel.CONSTANT_PRODUCT,
      amplificationFactor: dto.amplificationFactor || 1,
      minInitialLiquidity: dto.minInitialLiquidity || '0',
      totalLiquidity: reserve0.multipliedBy(reserve1).sqrt().toFixed(8),
      status: PoolStatus.ACTIVE,
      metadata: dto.metadata || {},
    });

    return this.poolRepository.save(pool);
  }

  async getPool(poolId: string): Promise<AMMPool> {
    const pool = await this.poolRepository.findOne({
      where: { id: poolId },
      relations: ['deal', 'creator'],
    });

    if (!pool) {
      throw new NotFoundException(`Pool ${poolId} not found`);
    }

    return pool;
  }

  async addLiquidity(
    dto: AddLiquidityDto,
    userId: string,
  ): Promise<AMMLiquidityPosition> {
    const pool = await this.getPool(dto.poolId);

    if (pool.status !== PoolStatus.ACTIVE) {
      throw new BadRequestException('Pool is not active');
    }

    const amount0 = new BigNumber(dto.amount0);
    const amount1 = new BigNumber(dto.amount1);

    if (amount0.isLessThanOrEqualTo(0) || amount1.isLessThanOrEqualTo(0)) {
      throw new BadRequestException('Amounts must be positive');
    }

    // Calculate LP tokens
    const lpTokens = this.pricingService.calculateLpTokens(
      pool.reserveToken0,
      pool.reserveToken1,
      dto.amount0,
      dto.amount1,
      pool.totalLiquidity,
    );

    // Check minimum
    if (dto.minLpTokens) {
      const minLp = new BigNumber(dto.minLpTokens);
      if (new BigNumber(lpTokens).isLessThan(minLp)) {
        throw new BadRequestException('Slippage exceeded minimum LP tokens');
      }
    }

    // Update pool reserves
    const newReserve0 = new BigNumber(pool.reserveToken0).plus(amount0);
    const newReserve1 = new BigNumber(pool.reserveToken1).plus(amount1);
    const newTotalLiquidity = new BigNumber(pool.totalLiquidity).plus(lpTokens);

    pool.reserveToken0 = newReserve0.toFixed(8);
    pool.reserveToken1 = newReserve1.toFixed(8);
    pool.totalLiquidity = newTotalLiquidity.toFixed(8);

    await this.poolRepository.save(pool);

    // Create position
    const position = this.liquidityPositionRepository.create({
      poolId: dto.poolId,
      userId,
      lpTokenAmount: lpTokens,
      depositToken0Amount: amount0.toFixed(8),
      depositToken1Amount: amount1.toFixed(8),
      currentToken0Value: amount0.toFixed(8),
      currentToken1Value: amount1.toFixed(8),
      isActive: true,
    });

    return this.liquidityPositionRepository.save(position);
  }

  async removeLiquidity(
    dto: RemoveLiquidityDto,
    userId: string,
  ): Promise<{ amount0: string; amount1: string }> {
    const pool = await this.getPool(dto.poolId);

    // Find position
    const position = await this.liquidityPositionRepository.findOne({
      where: { poolId: dto.poolId, userId, isActive: true },
    });

    if (!position) {
      throw new NotFoundException('Liquidity position not found');
    }

    const lpTokensToRemove = new BigNumber(dto.lpTokenAmount);

    if (lpTokensToRemove.isGreaterThan(position.lpTokenAmount)) {
      throw new BadRequestException('Insufficient LP tokens');
    }

    // Calculate amounts
    const totalLp = new BigNumber(pool.totalLiquidity);
    const reserve0 = new BigNumber(pool.reserveToken0);
    const reserve1 = new BigNumber(pool.reserveToken1);

    const proportion = lpTokensToRemove.div(totalLp);
    const amount0 = reserve0.multipliedBy(proportion);
    const amount1 = reserve1.multipliedBy(proportion);

    // Validate minimum amounts
    if (dto.minAmount0) {
      const minAmount0 = new BigNumber(dto.minAmount0);
      if (amount0.isLessThan(minAmount0)) {
        throw new BadRequestException('Slippage exceeded for token0');
      }
    }

    if (dto.minAmount1) {
      const minAmount1 = new BigNumber(dto.minAmount1);
      if (amount1.isLessThan(minAmount1)) {
        throw new BadRequestException('Slippage exceeded for token1');
      }
    }

    // Update pool
    const newReserve0 = reserve0.minus(amount0);
    const newReserve1 = reserve1.minus(amount1);
    const newTotalLiquidity = totalLp.minus(lpTokensToRemove);

    pool.reserveToken0 = newReserve0.toFixed(8);
    pool.reserveToken1 = newReserve1.toFixed(8);
    pool.totalLiquidity = newTotalLiquidity.toFixed(8);

    await this.poolRepository.save(pool);

    // Update position
    position.lpTokenAmount = new BigNumber(position.lpTokenAmount)
      .minus(lpTokensToRemove)
      .toFixed(8);

    if (new BigNumber(position.lpTokenAmount).isZero()) {
      position.isActive = false;
      position.removedAt = new Date();
    }

    await this.liquidityPositionRepository.save(position);

    return {
      amount0: amount0.toFixed(8),
      amount1: amount1.toFixed(8),
    };
  }

  async getPosition(
    poolId: string,
    userId: string,
  ): Promise<AMMLiquidityPosition> {
    const position = await this.liquidityPositionRepository.findOne({
      where: { poolId, userId, isActive: true },
    });

    if (!position) {
      throw new NotFoundException('Position not found');
    }

    return position;
  }

  async getPoolAnalytics(poolId: string): Promise<any> {
    const pool = await this.getPool(poolId);

    return {
      id: pool.id,
      dealId: pool.dealId,
      reserves: {
        token0: pool.reserveToken0,
        token1: pool.reserveToken1,
      },
      totalLiquidity: pool.totalLiquidity,
      totalVolume24h: pool.totalVolume24h,
      totalFeeCollected: pool.totalFeeCollected,
      currentAPR: pool.currentApr,
      feePercentage: pool.feePercentage,
      pricingModel: pool.pricingModel,
      status: pool.status,
      createdAt: pool.createdAt,
      updatedAt: pool.updatedAt,
    };
  }

  async updatePoolStatus(
    poolId: string,
    status: PoolStatus,
    reason?: string,
  ): Promise<AMMPool> {
    const pool = await this.getPool(poolId);

    pool.status = status;
    if (status === PoolStatus.PAUSED && reason) {
      pool.pauseReason = reason;
    }

    return this.poolRepository.save(pool);
  }

  async getAllPools(dealId?: string): Promise<AMMPool[]> {
    const query = this.poolRepository.createQueryBuilder('pool');

    if (dealId) {
      query.where('pool.dealId = :dealId', { dealId });
    }

    return query.getMany();
  }
}
