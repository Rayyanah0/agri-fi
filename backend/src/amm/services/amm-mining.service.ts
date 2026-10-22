import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import BigNumber from 'bignumber.js';
import { AMMMiningReward } from '../entities/amm-mining-reward.entity';
import { AMMLiquidityPosition } from '../entities/amm-liquidity-position.entity';
import { AMMPool } from '../entities/amm-pool.entity';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class AMMminingService {
  constructor(
    @InjectRepository(AMMMiningReward)
    private miningRewardRepository: Repository<AMMMiningReward>,
    @InjectRepository(AMMLiquidityPosition)
    private liquidityPositionRepository: Repository<AMMLiquidityPosition>,
    @InjectRepository(AMMPool)
    private poolRepository: Repository<AMMPool>,
  ) {}

  // Calculate and distribute mining rewards daily
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async distributeMiningRewards(): Promise<void> {
    // Get all active pools
    const pools = await this.poolRepository.find({
      where: { status: 'active' },
    });

    for (const pool of pools) {
      await this.distributeMiningRewardsForPool(pool.id);
    }
  }

  async distributeMiningRewardsForPool(poolId: string): Promise<void> {
    const pool = await this.poolRepository.findOne({ where: { id: poolId } });
    if (!pool) return;

    // Get all active positions
    const positions = await this.liquidityPositionRepository.find({
      where: { poolId, isActive: true },
    });

    // Calculate daily reward amount (e.g., 0.1% of pool total volume per day)
    const dailyRewardRate = new BigNumber('0.001');
    const totalRewardAmount = new BigNumber(pool.totalVolume24h)
      .multipliedBy(dailyRewardRate);

    // Distribute rewards proportionally to LP token holdings
    const totalLpTokens = new BigNumber(pool.totalLiquidity);

    const now = new Date();
    const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const periodEnd = now;

    for (const position of positions) {
      const positionShare = new BigNumber(position.lpTokenAmount).div(
        totalLpTokens,
      );
      const rewardAmount = totalRewardAmount
        .multipliedBy(positionShare)
        .toFixed(8);

      // Calculate APY
      const dailyReward = new BigNumber(rewardAmount);
      const annualReward = dailyReward.multipliedBy(365);
      const positionValue = new BigNumber(position.currentToken0Value).plus(
        position.currentToken1Value,
      );
      const apy = annualReward
        .div(positionValue.isZero() ? 1 : positionValue)
        .multipliedBy(100)
        .toNumber();

      // Create mining reward record
      const reward = this.miningRewardRepository.create({
        poolId,
        userId: position.userId,
        rewardAmount,
        apy,
        rewardPeriodStart: periodStart,
        rewardPeriodEnd: periodEnd,
        isVested: false,
        vestingPercentage: 0,
        isClaimed: false,
      });

      await this.miningRewardRepository.save(reward);

      // Update position accumulated rewards
      position.miningRewardsAccumulated = new BigNumber(
        position.miningRewardsAccumulated || 0,
      )
        .plus(rewardAmount)
        .toFixed(8);

      await this.liquidityPositionRepository.save(position);

      // Update pool APR
      const totalRewards = new BigNumber(pool.totalFeeCollected).plus(
        totalRewardAmount,
      );
      const poolValue = new BigNumber(pool.reserveToken0).plus(
        pool.reserveToken1,
      );
      pool.currentApr = totalRewards
        .div(poolValue.isZero() ? 1 : poolValue)
        .multipliedBy(100)
        .multipliedBy(365)
        .toNumber();
    }

    await this.poolRepository.save(pool);
  }

  async getClaimableRewards(userId: string): Promise<string> {
    const rewards = await this.miningRewardRepository.find({
      where: { userId, isClaimed: false, isVested: true },
    });

    const totalClaimable = rewards.reduce((sum, reward) => {
      return new BigNumber(sum)
        .plus(reward.rewardAmount)
        .toFixed(8);
    }, '0');

    return totalClaimable;
  }

  async claimRewards(userId: string): Promise<{ amount: string; txHash: string }> {
    const rewards = await this.miningRewardRepository.find({
      where: { userId, isClaimed: false, isVested: true },
    });

    const totalAmount = rewards.reduce((sum, reward) => {
      return new BigNumber(sum)
        .plus(reward.rewardAmount)
        .toFixed(8);
    }, '0');

    // Simulate tx hash (in production, this would be from blockchain)
    const txHash = `0x${Math.random().toString(16).slice(2)}`;

    // Mark as claimed
    for (const reward of rewards) {
      reward.isClaimed = true;
      reward.claimedAt = new Date();
      reward.claimTxHash = txHash;
      await this.miningRewardRepository.save(reward);
    }

    return { amount: totalAmount, txHash };
  }

  async getRewardHistory(
    userId: string,
    limit = 50,
  ): Promise<{ rewards: AMMMiningReward[]; total: number }> {
    const [rewards, total] = await this.miningRewardRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return { rewards, total };
  }
}
