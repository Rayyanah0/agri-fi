import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';

/**
 * Positions that represent capital the investor committed: everything except
 * the terminal states where the money went back or never moved.
 */
const COMMITTED_STATUSES: InvestmentStatus[] = [
  InvestmentStatus.PENDING,
  InvestmentStatus.CONFIRMED,
  InvestmentStatus.ACTIVE,
  InvestmentStatus.RELEASING,
  InvestmentStatus.COMPLETED,
];

/** Committed positions whose payout has not landed yet. */
const OPEN_STATUSES: InvestmentStatus[] = [
  InvestmentStatus.PENDING,
  InvestmentStatus.CONFIRMED,
  InvestmentStatus.ACTIVE,
  InvestmentStatus.RELEASING,
];

export interface PortfolioAllocationSlice {
  deal_id: string;
  title: string;
  token_symbol: string | null;
  commodity: string | null;
  deal_status: string | null;
  /** Capital this investor put into the deal. */
  amount_usd: number;
  /** Share of `total_invested`, 0-100. */
  share_pct: number;
  expected_return_usd: number;
  /** Null until the deal has actually paid this investor out. */
  realized_return_usd: number | null;
  position_count: number;
}

export interface PortfolioSummary {
  investor_id: string;
  currency: 'USD';
  total_invested: number;
  /** Realised proceeds where the deal has paid out, expected claim otherwise. */
  current_value: number;
  expected_returns: number;
  returns_paid: number;
  roi_pct: number;
  active_deal_count: number;
  invested_deal_count: number;
  position_count: number;
  allocation: PortfolioAllocationSlice[];
  generated_at: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Aggregates one investor's positions into the numbers the portfolio summary
 * widget shows (#789).
 *
 * The per-position claim follows the same pro-rata rule the existing
 * `UsersService.getUserInvestments()` uses: the investor owns
 * `tokenAmount / deal.tokenCount` of the deal, so the claim on completion is
 * that fraction of `deal.totalValue`. Realised amounts come from confirmed
 * `payment_distributions` rows, which is the only place actual proceeds exist.
 *
 * Everything is grouped by deal before totals are formed, because an investor
 * can hold several positions in one deal and realised payouts are recorded per
 * deal, not per investment row.
 */
@Injectable()
export class PortfolioSummaryService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    // Payouts are read through the DataSource: InvestmentsModule lists
    // PaymentDistribution in forFeature() but never imports it, so no
    // injection token exists for it today.
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getSummary(investorId: string): Promise<PortfolioSummary> {
    const positions = await this.investmentRepo.find({
      where: COMMITTED_STATUSES.map((status) => ({ investorId, status })),
      relations: ['tradeDeal'],
    });

    const dealIds = [
      ...new Set(
        positions
          .map((position) => position.tradeDealId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const realizedByDeal = dealIds.length
      ? await this.realizedByDeal(investorId, dealIds)
      : new Map<string, number>();

    const investedByDeal = new Map<string, number>();
    const claimByDeal = new Map<string, number | null>();
    const positionsByDeal = new Map<string, number>();
    const deals = new Map<string, TradeDeal>();
    const activeDeals = new Set<string>();

    let totalInvested = 0;
    let totalExpected = 0;

    for (const position of positions) {
      const dealId = position.tradeDealId;
      if (!dealId) continue;

      const amount = this.toNumber(position.amountUsd);
      totalInvested += amount;
      if (OPEN_STATUSES.includes(position.status)) activeDeals.add(dealId);

      const deal = position.tradeDeal;
      const claim = deal
        ? PortfolioSummaryService.dealClaim(position, deal)
        : null;
      if (claim === null) {
        // Either the deal row is gone (soft-deleted) or its payout basis is
        // unusable. Nothing can be projected, so the position is valued at cost.
        if (!claimByDeal.has(dealId)) claimByDeal.set(dealId, null);
      } else {
        if (deal) deals.set(dealId, deal);
        totalExpected += claim;
        claimByDeal.set(dealId, (claimByDeal.get(dealId) ?? 0) + claim);
      }

      investedByDeal.set(dealId, (investedByDeal.get(dealId) ?? 0) + amount);
      positionsByDeal.set(dealId, (positionsByDeal.get(dealId) ?? 0) + 1);
    }

    let returnsPaid = 0;
    let currentValue = 0;
    for (const [dealId, invested] of investedByDeal) {
      const realized = realizedByDeal.get(dealId);
      returnsPaid += realized ?? 0;
      currentValue += realized ?? claimByDeal.get(dealId) ?? invested;
    }

    const allocation: PortfolioAllocationSlice[] = [...investedByDeal.entries()]
      .map(([dealId, invested]) => {
        const deal = deals.get(dealId);
        const realized = realizedByDeal.get(dealId) ?? null;
        return {
          deal_id: dealId,
          title: deal?.title ?? 'Removed deal',
          token_symbol: deal?.tokenSymbol ?? null,
          commodity: deal?.commodity ?? null,
          deal_status: deal?.status ?? null,
          amount_usd: round2(invested),
          share_pct:
            totalInvested > 0 ? round1((invested / totalInvested) * 100) : 0,
          expected_return_usd: round2(claimByDeal.get(dealId) ?? 0),
          realized_return_usd: realized === null ? null : round2(realized),
          position_count: positionsByDeal.get(dealId) ?? 0,
        };
      })
      .sort((a, b) => b.amount_usd - a.amount_usd);

    return {
      investor_id: investorId,
      currency: 'USD',
      total_invested: round2(totalInvested),
      current_value: round2(currentValue),
      expected_returns: round2(totalExpected),
      returns_paid: round2(returnsPaid),
      roi_pct:
        totalInvested > 0
          ? round1(((currentValue - totalInvested) / totalInvested) * 100)
          : 0,
      active_deal_count: activeDeals.size,
      invested_deal_count: investedByDeal.size,
      position_count: positions.length,
      allocation,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Confirmed payouts to this investor, summed per deal. One query for the
   * whole portfolio rather than the per-deal lookups the investments list
   * endpoint does.
   */
  private async realizedByDeal(
    investorId: string,
    dealIds: readonly string[],
  ): Promise<Map<string, number>> {
    const rows = await this.dataSource.getRepository(PaymentDistribution).find({
      where: {
        recipientId: investorId,
        recipientType: 'investor',
        status: 'confirmed',
        tradeDealId: In([...dealIds]),
      },
    });

    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(
        row.tradeDealId,
        (totals.get(row.tradeDealId) ?? 0) + this.toNumber(row.amountUsd),
      );
    }
    return totals;
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * The investor's share of the deal's total value, or null when the deal does
   * not describe a payout basis (no tokens issued, no target value, or values
   * that will not parse).
   */
  static dealClaim(
    position: Pick<Investment, 'tokenAmount'>,
    deal: Pick<TradeDeal, 'tokenCount' | 'totalValue'>,
  ): number | null {
    const tokenCount = Number(deal.tokenCount);
    const totalValue = Number(deal.totalValue);
    const tokenAmount = Number(position.tokenAmount);
    if (!Number.isFinite(tokenCount) || tokenCount <= 0) return null;
    if (!Number.isFinite(totalValue) || totalValue <= 0) return null;
    if (!Number.isFinite(tokenAmount)) return null;
    return (tokenAmount / tokenCount) * totalValue;
  }
}
