import { Injectable } from '@nestjs/common';
import BigNumber from 'bignumber.js';
import { PricingModel } from '../entities/amm-pool.entity';
import { SwapDirection } from '../entities/amm-swap.entity';

interface PricingParams {
  reserveToken0: string;
  reserveToken1: string;
  amountIn: string;
  direction: SwapDirection;
  feePercentage: number;
  pricingModel: PricingModel;
  amplificationFactor?: number;
}

interface PricingResult {
  amountOut: string;
  executionPrice: string;
  priceImpact: number;
  feePaid: string;
}

@Injectable()
export class AMMPricingService {
  // Constant product formula: x*y=k
  private constantProductPrice(params: PricingParams): PricingResult {
    const {
      reserveToken0,
      reserveToken1,
      amountIn,
      direction,
      feePercentage,
    } = params;

    const reserve0 = new BigNumber(reserveToken0);
    const reserve1 = new BigNumber(reserveToken1);
    const input = new BigNumber(amountIn);

    // Apply fee
    const feeMultiplier = new BigNumber(1).minus(
      new BigNumber(feePercentage).div(100),
    );
    const amountInAfterFee = input.multipliedBy(feeMultiplier);
    const feePaid = input.minus(amountInAfterFee);

    let amountOut: BigNumber;
    let newReserveIn: BigNumber;
    let newReserveOut: BigNumber;

    if (direction === SwapDirection.TOKEN0_TO_TOKEN1) {
      // Selling token0, buying token1
      newReserveIn = reserve0.plus(amountInAfterFee);
      const k = reserve0.multipliedBy(reserve1);
      newReserveOut = k.div(newReserveIn);
      amountOut = reserve1.minus(newReserveOut);
    } else {
      // Selling token1, buying token0
      newReserveIn = reserve1.plus(amountInAfterFee);
      const k = reserve0.multipliedBy(reserve1);
      newReserveOut = k.div(newReserveIn);
      amountOut = reserve0.minus(newReserveOut);
    }

    // Calculate price impact
    const spotPrice =
      direction === SwapDirection.TOKEN0_TO_TOKEN1
        ? reserve1.div(reserve0)
        : reserve0.div(reserve1);

    const executionPrice = amountOut.div(amountInAfterFee);
    const priceImpact = spotPrice
      .minus(executionPrice)
      .div(spotPrice)
      .multipliedBy(100)
      .toNumber();

    return {
      amountOut: amountOut.toFixed(8),
      executionPrice: executionPrice.toFixed(8),
      priceImpact: Math.max(0, priceImpact),
      feePaid: feePaid.toFixed(8),
    };
  }

  // Stable swap formula for similar-value tokens
  private stableSwapPrice(params: PricingParams): PricingResult {
    const {
      reserveToken0,
      reserveToken1,
      amountIn,
      direction,
      feePercentage,
      amplificationFactor = 1,
    } = params;

    const reserve0 = new BigNumber(reserveToken0);
    const reserve1 = new BigNumber(reserveToken1);
    const input = new BigNumber(amountIn);
    const A = new BigNumber(amplificationFactor);

    // Apply fee
    const feeMultiplier = new BigNumber(1).minus(
      new BigNumber(feePercentage).div(100),
    );
    const amountInAfterFee = input.multipliedBy(feeMultiplier);
    const feePaid = input.minus(amountInAfterFee);

    // Simplified stable swap: less price impact than constant product
    // Real implementation would use iterative formula
    const reserve0Bn = reserve0;
    const reserve1Bn = reserve1;

    let amountOut: BigNumber;
    if (direction === SwapDirection.TOKEN0_TO_TOKEN1) {
      const constant = reserve0Bn.plus(reserve1Bn);
      const newReserve0 = reserve0Bn.plus(amountInAfterFee);
      const newReserve1 = constant.minus(newReserve0);
      amountOut = reserve1Bn.minus(newReserve1);
    } else {
      const constant = reserve0Bn.plus(reserve1Bn);
      const newReserve1 = reserve1Bn.plus(amountInAfterFee);
      const newReserve0 = constant.minus(newReserve1);
      amountOut = reserve0Bn.minus(newReserve0);
    }

    const executionPrice = amountOut.div(amountInAfterFee);

    return {
      amountOut: amountOut.toFixed(8),
      executionPrice: executionPrice.toFixed(8),
      priceImpact: 0.5, // Stable swap has minimal impact
      feePaid: feePaid.toFixed(8),
    };
  }

  // Linear pricing for testing
  private linearPrice(params: PricingParams): PricingResult {
    const { reserveToken0, reserveToken1, amountIn, feePercentage } = params;

    const reserve0 = new BigNumber(reserveToken0);
    const reserve1 = new BigNumber(reserveToken1);
    const input = new BigNumber(amountIn);

    const feeMultiplier = new BigNumber(1).minus(
      new BigNumber(feePercentage).div(100),
    );
    const amountInAfterFee = input.multipliedBy(feeMultiplier);
    const feePaid = input.minus(amountInAfterFee);

    const spotPrice = reserve1.div(reserve0);
    const amountOut = amountInAfterFee.multipliedBy(spotPrice);
    const executionPrice = spotPrice;

    return {
      amountOut: amountOut.toFixed(8),
      executionPrice: executionPrice.toFixed(8),
      priceImpact: 0,
      feePaid: feePaid.toFixed(8),
    };
  }

  calculatePrice(params: PricingParams): PricingResult {
    switch (params.pricingModel) {
      case PricingModel.CONSTANT_PRODUCT:
        return this.constantProductPrice(params);
      case PricingModel.STABLE_SWAP:
        return this.stableSwapPrice(params);
      case PricingModel.LINEAR:
        return this.linearPrice(params);
      default:
        throw new Error(`Unknown pricing model: ${params.pricingModel}`);
    }
  }

  // Calculate LP token amount for deposit
  calculateLpTokens(
    reserve0: string,
    reserve1: string,
    amount0: string,
    amount1: string,
    existingLpTokens: string,
  ): string {
    const reserve0Bn = new BigNumber(reserve0);
    const reserve1Bn = new BigNumber(reserve1);
    const amount0Bn = new BigNumber(amount0);
    const amount1Bn = new BigNumber(amount1);
    const existingLp = new BigNumber(existingLpTokens);

    if (reserve0Bn.isZero() || reserve1Bn.isZero()) {
      // Initial liquidity: geometric mean
      return amount0Bn.multipliedBy(amount1Bn).sqrt().toFixed(8);
    }

    // Standard LP token calculation
    const liquidityFromAmount0 = amount0Bn
      .multipliedBy(existingLp)
      .div(reserve0Bn);
    const liquidityFromAmount1 = amount1Bn
      .multipliedBy(existingLp)
      .div(reserve1Bn);

    // Use minimum to ensure balanced deposit
    return BigNumber.min(liquidityFromAmount0, liquidityFromAmount1).toFixed(8);
  }

  // Calculate impermanent loss
  calculateImpermanentLoss(
    depositedAmount0: string,
    depositedAmount1: string,
    currentAmount0: string,
    currentAmount1: string,
  ): { loss: string; lossPercentage: number } {
    const dep0 = new BigNumber(depositedAmount0);
    const dep1 = new BigNumber(depositedAmount1);
    const cur0 = new BigNumber(currentAmount0);
    const cur1 = new BigNumber(currentAmount1);

    // Initial value
    const initialPrice = dep1.div(dep0);
    const initialValue = dep0.plus(dep1.multipliedBy(initialPrice));

    // Current value
    const currentPrice = cur1.div(cur0);
    const currentValue = cur0.plus(cur1.multipliedBy(currentPrice));

    // Holding value (what we would have if we didn't provide liquidity)
    const holdingValue = dep0.plus(dep1);

    const loss = currentValue.minus(holdingValue);
    const lossPercentage = loss.div(holdingValue).multipliedBy(100).toNumber();

    return {
      loss: loss.toFixed(8),
      lossPercentage: Math.min(0, lossPercentage),
    };
  }
}
