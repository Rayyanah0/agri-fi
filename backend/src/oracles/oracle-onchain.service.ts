import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { SorobanService } from '../soroban/soroban.service';
import { OracleFeed } from './entities/oracle-feed.entity';

export interface OnChainSubmission {
  txId: string;
  gasCostXlm: number;
  onChainValue: string;
}

/**
 * Submits validated oracle readings to the on-chain `price_feed` contract
 * (#1235). Kept separate from the orchestration service so the contract bridge
 * can be unit-tested and swapped independently.
 */
@Injectable()
export class OracleOnChainService {
  private readonly logger = new Logger(OracleOnChainService.name);

  constructor(
    private readonly soroban: SorobanService,
    private readonly config: ConfigService,
  ) {}

  /** Scales a human price to the feed's integer on-chain representation. */
  toOnChainValue(value: number, decimals: number): bigint {
    return BigInt(Math.round(value * 10 ** decimals));
  }

  async submitPrice(params: {
    feed: OracleFeed;
    value: number;
    roundId: bigint;
    timestamp: number;
  }): Promise<OnChainSubmission> {
    const { feed, value, roundId, timestamp } = params;
    if (!feed.contractId || !feed.oracleAddress) {
      throw new Error(
        `Feed ${feed.feedId} is missing contractId or oracleAddress`,
      );
    }

    const onChainValue = this.toOnChainValue(value, feed.decimals);
    const args = [
      new Address(feed.oracleAddress).toScVal(),
      nativeToScVal(feed.feedId, { type: 'string' }),
      nativeToScVal(onChainValue, { type: 'i128' }),
      nativeToScVal(roundId, { type: 'u64' }),
      nativeToScVal(BigInt(timestamp), { type: 'u64' }),
    ];

    const txId = await this.soroban.invokeContract(
      feed.contractId,
      'submit_price',
      args,
    );

    this.logger.log(
      { feedId: feed.feedId, txId, onChainValue: onChainValue.toString() },
      'Oracle price submitted on-chain',
    );

    return {
      txId,
      gasCostXlm: this.estimateGasCostXlm(),
      onChainValue: onChainValue.toString(),
    };
  }

  /**
   * Estimated XLM cost per submission. Soroban resource fees vary with
   * footprint; the configured estimate is used for cost analytics and budget
   * enforcement until precise fees are wired in.
   */
  estimateGasCostXlm(): number {
    return Number(this.config.get('ORACLE_ESTIMATED_TX_FEE_XLM', 0.01));
  }
}
