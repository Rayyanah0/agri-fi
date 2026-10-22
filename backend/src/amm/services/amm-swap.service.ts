import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import BigNumber from 'bignumber.js';
import { AMMSwap, SwapStatus, SwapDirection } from '../entities/amm-swap.entity';
import { AMMPool } from '../entities/amm-pool.entity';
import { SwapDto, SwapQuoteDto } from '../dto/swap.dto';
import { AMMPricingService } from './amm-pricing.service';

@Injectable()
export class AMMSwapService {
  constructor(
    @InjectRepository(AMMSwap)
    private swapRepository: Repository<AMMSwap>,
    @InjectRepository(AMMPool)
    private poolRepository: Repository<AMMPool>,
    private pricingService: AMMPricingService,
  ) {}

  async getSwapQuote(dto: SwapQuoteDto): Promise<any> {
    const pool = await this.poolRepository.findOne({
      where: { id: dto.poolId },
    });

    if (!pool) {
      throw new NotFoundException('Pool not found');
    }

    const quote = this.pricingService.calculatePrice({
      reserveToken0: pool.reserveToken0,
      reserveToken1: pool.reserveToken1,
      amountIn: dto.amountIn,
      direction: dto.direction,
      feePercentage: pool.feePercentage,
      pricingModel: pool.pricingModel,
      amplificationFactor: pool.amplificationFactor,
    });

    return {
      poolId: dto.poolId,
      amountIn: dto.amountIn,
      direction: dto.direction,
      amountOut: quote.amountOut,
      executionPrice: quote.executionPrice,
      priceImpact: quote.priceImpact,
      feePaid: quote.feePaid,
    };
  }

  async executeSwap(
    dto: SwapDto,
    userId: string,
  ): Promise<AMMSwap> {
    const pool = await this.poolRepository.findOne({
      where: { id: dto.poolId },
    });

    if (!pool) {
      throw new NotFoundException('Pool not found');
    }

    // Get quote
    const quote = this.pricingService.calculatePrice({
      reserveToken0: pool.reserveToken0,
      reserveToken1: pool.reserveToken1,
      amountIn: dto.amountIn,
      direction: dto.direction,
      feePercentage: pool.feePercentage,
      pricingModel: pool.pricingModel,
      amplificationFactor: pool.amplificationFactor,
    });

    // Validate slippage
    let minAmountOut = dto.minimumAmountOut;
    if (!minAmountOut && dto.slippagePercentage !== undefined) {
      const maxSlippage = new BigNumber(100)
        .minus(dto.slippagePercentage)
        .div(100);
      minAmountOut = new BigNumber(quote.amountOut)
        .multipliedBy(maxSlippage)
        .toFixed(8);
    }

    let slippageExceeded = false;
    if (minAmountOut) {
      const minAmount = new BigNumber(minAmountOut);
      if (new BigNumber(quote.amountOut).isLessThan(minAmount)) {
        slippageExceeded = true;
        if (!dto.slippagePercentage) {
          throw new BadRequestException('Slippage exceeded');
        }
      }
    }

    // Update pool reserves
    const amountIn = new BigNumber(dto.amountIn);
    const amountOut = new BigNumber(quote.amountOut);

    if (dto.direction === SwapDirection.TOKEN0_TO_TOKEN1) {
      pool.reserveToken0 = new BigNumber(pool.reserveToken0)
        .plus(amountIn)
        .toFixed(8);
      pool.reserveToken1 = new BigNumber(pool.reserveToken1)
        .minus(amountOut)
        .toFixed(8);
    } else {
      pool.reserveToken0 = new BigNumber(pool.reserveToken0)
        .minus(amountOut)
        .toFixed(8);
      pool.reserveToken1 = new BigNumber(pool.reserveToken1)
        .plus(amountIn)
        .toFixed(8);
    }

    // Update fees
    const feePaid = new BigNumber(quote.feePaid);
    if (dto.direction === SwapDirection.TOKEN0_TO_TOKEN1) {
      pool.accumulatedFees0 = new BigNumber(pool.accumulatedFees0)
        .plus(feePaid)
        .toFixed(8);
    } else {
      pool.accumulatedFees1 = new BigNumber(pool.accumulatedFees1)
        .plus(feePaid)
        .toFixed(8);
    }

    // Update volume
    pool.totalVolume24h = new BigNumber(pool.totalVolume24h)
      .plus(amountIn)
      .toFixed(8);

    await this.poolRepository.save(pool);

    // Record swap
    const swap = this.swapRepository.create({
      poolId: dto.poolId,
      userId,
      direction: dto.direction,
      amountIn: amountIn.toFixed(8),
      amountOut: amountOut.toFixed(8),
      executionPrice: quote.executionPrice,
      priceImpact: quote.priceImpact,
      feePaid: quote.feePaid,
      minimumAmountOut: minAmountOut,
      slippageExceeded,
      status: SwapStatus.COMPLETED,
    });

    return this.swapRepository.save(swap);
  }

  async getSwapHistory(
    poolId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ swaps: AMMSwap[]; total: number }> {
    const [swaps, total] = await this.swapRepository.findAndCount({
      where: { poolId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { swaps, total };
  }

  async getUserSwaps(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ swaps: AMMSwap[]; total: number }> {
    const [swaps, total] = await this.swapRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { swaps, total };
  }
}
