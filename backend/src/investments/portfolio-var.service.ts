import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { OracleFeed } from '../oracles/entities/oracle-feed.entity';
import { OracleObservation } from '../oracles/entities/oracle-observation.entity';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { PortfolioVaRLimit } from './entities/portfolio-var-limit.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  calculatePortfolioVaR,
  getHorizonReturns,
  standardDeviation,
  VaRCalculation,
  VaRMethod,
} from './portfolio-var.calculator';
import {
  PortfolioVaRQueryDto,
  PortfolioVaRStressScenarioDto,
  SetPortfolioVaRLimitDto,
} from './dto/portfolio-var.dto';

const ACTIVE_STATUSES = [
  InvestmentStatus.CONFIRMED,
  InvestmentStatus.ACTIVE,
  InvestmentStatus.RELEASING,
];
const HISTORY_DAYS = 365;
const TREND_POINTS = 30;
const BACKTEST_LOOKBACK = 250;
const MIN_BACKTEST_SAMPLES = 20;

interface PortfolioExposure {
  feedId: string;
  commodity: string;
  amountUsd: number;
  weight: number;
  dailyReturns: number[];
}

interface PortfolioHistory {
  portfolioValueUsd: number;
  exposures: PortfolioExposure[];
  dates: string[];
  dailyReturns: number[];
  observationCount: number;
  feedCount: number;
  marketDataAsOf: string;
}

export interface PortfolioVaRResult extends VaRCalculation {
  investorId: string;
  currency: 'USD';
  method: VaRMethod;
  confidenceLevel: number;
  horizonDays: number;
  portfolioValueUsd: number;
  valuationBasis: 'invested_amount_proxy';
  marketDataAsOf: string;
  observationCount: number;
  feedCount: number;
  asOf: string;
  warnings: string[];
  limit: {
    limitUsd: number;
    breached: boolean;
  } | null;
  components: Array<{
    commodity: string;
    feedId: string;
    exposureUsd: number;
    weight: number;
    riskContributionUsd: number;
    standaloneVaRUsd: number;
  }>;
  trend: Array<{ date: string; varUsd: number }>;
}

export interface PortfolioVaRBacktest {
  confidenceLevel: number;
  horizonDays: number;
  observationsTested: number;
  breaches: number;
  breachRate: number | null;
  expectedBreachRate: number;
  results: Array<{
    date: string;
    predictedVaRUsd: number;
    actualLossUsd: number;
    breached: boolean;
  }>;
}

@Injectable()
export class PortfolioVaRService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(OracleFeed)
    private readonly feedRepo: Repository<OracleFeed>,
    @InjectRepository(OracleObservation)
    private readonly observationRepo: Repository<OracleObservation>,
    @InjectRepository(PortfolioVaRLimit)
    private readonly limitRepo: Repository<PortfolioVaRLimit>,
    @Optional()
    private readonly notificationsService?: NotificationsService,
  ) {}

  async calculate(
    investorId: string,
    query: PortfolioVaRQueryDto = new PortfolioVaRQueryDto(),
  ): Promise<PortfolioVaRResult> {
    const options = this.normalizeQuery(query);
    const history = await this.loadPortfolioHistory(investorId);
    const calculation = calculatePortfolioVaR(history.dailyReturns, {
      ...options,
      portfolioValueUsd: history.portfolioValueUsd,
    });
    const configuredLimit = await this.limitRepo.findOne({
      where: {
        investorId,
        confidenceLevel: options.confidenceLevel,
        horizonDays: options.horizonDays,
        enabled: true,
      },
    });
    let limit: PortfolioVaRResult['limit'] = null;
    if (configuredLimit) {
      const limitUsd = Number(configuredLimit.limitUsd);
      const breached = calculation.varUsd > limitUsd;
      if (breached !== configuredLimit.lastBreached) {
        configuredLimit.lastBreached = breached;
        configuredLimit.lastAlertedAt = breached ? new Date() : null;
        await this.limitRepo.save(configuredLimit);
        if (breached && this.notificationsService) {
          await this.notificationsService
            .createNotification({
              userId: investorId,
              type: 'alert',
              title: 'Portfolio VaR limit exceeded',
              message: `Your ${options.horizonDays}-day VaR of $${calculation.varUsd.toFixed(2)} exceeds your $${limitUsd.toFixed(2)} limit at ${(options.confidenceLevel * 100).toFixed(1)}% confidence.`,
              linkUrl: '/investments/risk/var',
              metadataJson: {
                confidenceLevel: options.confidenceLevel,
                horizonDays: options.horizonDays,
                varUsd: calculation.varUsd,
                limitUsd,
              },
            })
            .catch(() => undefined);
        }
      }
      limit = { limitUsd, breached };
    }
    const warnings: string[] = [];
    if (history.dailyReturns.length < 250) {
      warnings.push(
        `Only ${history.dailyReturns.length} daily return observations are available; results may be unstable at high confidence levels.`,
      );
    }
    if (Date.now() - Date.parse(history.marketDataAsOf) > 24 * 60 * 60 * 1000) {
      warnings.push(
        'The latest selected oracle observation is more than 24 hours old.',
      );
    }
    if (
      options.confidenceLevel === 0.999 &&
      history.dailyReturns.length < 1000
    ) {
      warnings.push(
        'Fewer than 1,000 observations are available for a 99.9% confidence estimate.',
      );
    }

    return {
      investorId,
      currency: 'USD',
      method: options.method,
      confidenceLevel: options.confidenceLevel,
      horizonDays: options.horizonDays,
      portfolioValueUsd: history.portfolioValueUsd,
      valuationBasis: 'invested_amount_proxy',
      marketDataAsOf: history.marketDataAsOf,
      observationCount: history.observationCount,
      feedCount: history.feedCount,
      asOf: new Date().toISOString(),
      ...calculation,
      warnings,
      limit,
      components: this.buildComponents(history, calculation.varUsd),
      trend: this.buildTrend(history, options),
    };
  }

  async setLimit(
    investorId: string,
    dto: SetPortfolioVaRLimitDto,
  ): Promise<PortfolioVaRLimit> {
    const existing = await this.limitRepo.findOne({
      where: {
        investorId,
        confidenceLevel: dto.confidenceLevel,
        horizonDays: dto.horizonDays,
      },
    });
    if (existing) {
      existing.limitUsd = dto.limitUsd;
      existing.enabled = true;
      existing.lastBreached = false;
      existing.lastAlertedAt = null;
      return this.limitRepo.save(existing);
    }
    return this.limitRepo.save(this.limitRepo.create({ ...dto, investorId }));
  }

  async backtest(
    investorId: string,
    query: PortfolioVaRQueryDto = new PortfolioVaRQueryDto(),
  ): Promise<PortfolioVaRBacktest> {
    const options = this.normalizeQuery(query);
    const history = await this.loadPortfolioHistory(investorId);
    const results: PortfolioVaRBacktest['results'] = [];
    const minimumTrainingSamples = Math.max(
      MIN_BACKTEST_SAMPLES,
      Math.ceil(1 / (1 - options.confidenceLevel)),
    );
    const lastTestIndex = history.dailyReturns.length - options.horizonDays;

    for (
      let index = minimumTrainingSamples;
      index <= lastTestIndex;
      index += 1
    ) {
      const trainingReturns = history.dailyReturns.slice(
        Math.max(0, index - BACKTEST_LOOKBACK),
        index,
      );
      if (
        trainingReturns.length <
        Math.max(minimumTrainingSamples, options.horizonDays)
      ) {
        continue;
      }
      const predicted = calculatePortfolioVaR(trainingReturns, {
        confidenceLevel: options.confidenceLevel,
        horizonDays: options.horizonDays,
        method: 'historical',
        portfolioValueUsd: history.portfolioValueUsd,
      }).varUsd;
      const realizedReturn = getHorizonReturns(
        history.dailyReturns.slice(index, index + options.horizonDays),
        options.horizonDays,
      )[0];
      const actualLossUsd = -realizedReturn * history.portfolioValueUsd;
      results.push({
        date: history.dates[index + options.horizonDays - 1],
        predictedVaRUsd: predicted,
        actualLossUsd,
        breached: actualLossUsd > predicted,
      });
    }

    const breaches = results.filter((result) => result.breached).length;
    return {
      confidenceLevel: options.confidenceLevel,
      horizonDays: options.horizonDays,
      observationsTested: results.length,
      breaches,
      breachRate: results.length ? breaches / results.length : null,
      expectedBreachRate: 1 - options.confidenceLevel,
      results,
    };
  }

  async stressTest(
    investorId: string,
    scenarios: PortfolioVaRStressScenarioDto[] = [],
  ) {
    const history = await this.loadPortfolioHistory(investorId);
    const appliedScenarios = scenarios.length
      ? scenarios
      : [
          { name: 'Commodity shock -20%', shocks: { '*': -0.2 } },
          { name: 'Severe commodity shock -40%', shocks: { '*': -0.4 } },
        ];

    return {
      investorId,
      currency: 'USD' as const,
      portfolioValueUsd: history.portfolioValueUsd,
      scenarios: appliedScenarios.map((scenario) => {
        const shockReturn = history.exposures.reduce((total, exposure) => {
          const shock = this.scenarioShock(scenario, exposure);
          return total + exposure.weight * shock;
        }, 0);
        const lossUsd = -shockReturn * history.portfolioValueUsd;
        return {
          name: scenario.name,
          shockReturn,
          stressedValueUsd: Math.max(0, history.portfolioValueUsd + -lossUsd),
          lossUsd,
          shocks: scenario.shocks,
        };
      }),
      asOf: new Date().toISOString(),
    };
  }

  async generateReport(
    investorId: string,
    query: PortfolioVaRQueryDto = new PortfolioVaRQueryDto(),
  ) {
    const [calculation, backtest] = await Promise.all([
      this.calculate(investorId, query),
      this.backtest(investorId, query),
    ]);
    return {
      reportType: 'portfolio_value_at_risk',
      generatedAt: new Date().toISOString(),
      methodology: {
        selectedMethod: calculation.method,
        historicalBacktestMethod: 'rolling_historical_simulation',
        currency: calculation.currency,
        valuationBasis: calculation.valuationBasis,
        marketData: 'selected, validated commodity oracle observations',
      },
      calculation,
      backtest,
    };
  }

  private normalizeQuery(query: PortfolioVaRQueryDto) {
    const confidenceLevel = Number(query.confidenceLevel ?? 0.95);
    const horizonDays = Number(query.horizonDays ?? 1);
    const method = query.method ?? 'historical';
    if (![0.95, 0.99, 0.999].includes(confidenceLevel)) {
      throw new BadRequestException('Unsupported VaR confidence level');
    }
    if (![1, 10, 30].includes(horizonDays)) {
      throw new BadRequestException('Unsupported VaR time horizon');
    }
    if (!['historical', 'parametric', 'monte_carlo'].includes(method)) {
      throw new BadRequestException('Unsupported VaR method');
    }
    return { confidenceLevel, horizonDays, method };
  }

  private async loadPortfolioHistory(
    investorId: string,
  ): Promise<PortfolioHistory> {
    const investments = await this.investmentRepo.find({
      where: ACTIVE_STATUSES.map((status) => ({ investorId, status })),
      relations: ['tradeDeal'],
    });
    const amountByCommodity = new Map<string, number>();
    let portfolioValueUsd = 0;
    for (const investment of investments) {
      const amount = Number(investment.amountUsd);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const commodity = investment.tradeDeal?.commodity?.trim();
      if (!commodity) {
        throw new BadRequestException(
          'An active investment is missing its trade-deal commodity',
        );
      }
      const key = normalizeCommodity(commodity);
      amountByCommodity.set(key, (amountByCommodity.get(key) ?? 0) + amount);
      portfolioValueUsd += amount;
    }
    if (portfolioValueUsd <= 0) {
      throw new NotFoundException('No active portfolio exposures were found');
    }

    const feeds = await this.feedRepo.find({
      where: { dataType: 'commodity', enabled: true },
    });
    const feedByCommodity = new Map(
      feeds.map((feed) => [
        normalizeCommodity(feed.feedId.split('/')[0]),
        feed,
      ]),
    );
    const missingCommodities = [...amountByCommodity.keys()].filter(
      (commodity) => !feedByCommodity.has(commodity),
    );
    if (missingCommodities.length) {
      throw new BadRequestException(
        `No enabled commodity oracle feed maps to: ${missingCommodities.join(', ')}`,
      );
    }

    const exposures = [...amountByCommodity.entries()].map(
      ([normalizedCommodity, amountUsd]) => {
        const feed = feedByCommodity.get(normalizedCommodity)!;
        return {
          feedId: feed.feedId,
          commodity: feed.feedId.split('/')[0],
          amountUsd,
          weight: amountUsd / portfolioValueUsd,
          dailyReturns: [],
        };
      },
    );
    const historyFrom = new Date();
    historyFrom.setUTCDate(historyFrom.getUTCDate() - HISTORY_DAYS);
    const observations = await this.observationRepo.find({
      where: {
        feedId: In(exposures.map((exposure) => exposure.feedId)),
        valid: true,
        selected: true,
        fetchedAt: MoreThanOrEqual(historyFrom),
      },
      order: { fetchedAt: 'ASC' },
    });
    const priceByFeedAndDate = new Map<string, Map<string, number>>();
    for (const observation of observations) {
      const price = Number(observation.value);
      if (!Number.isFinite(price) || price <= 0) continue;
      const day = observation.fetchedAt.toISOString().slice(0, 10);
      const prices = priceByFeedAndDate.get(observation.feedId) ?? new Map();
      prices.set(day, price);
      priceByFeedAndDate.set(observation.feedId, prices);
    }

    const observedDates = [
      ...new Set(
        [...priceByFeedAndDate.values()].flatMap((prices) => [
          ...prices.keys(),
        ]),
      ),
    ].sort();
    if (observedDates.length < 2) {
      throw new BadRequestException(
        'At least two days of selected, valid commodity oracle observations are required',
      );
    }

    const dates: string[] = [];
    const dateCursor = new Date(`${observedDates[0]}T00:00:00.000Z`);
    const lastDate = new Date(
      `${observedDates[observedDates.length - 1]}T00:00:00.000Z`,
    );
    while (dateCursor <= lastDate) {
      dates.push(dateCursor.toISOString().slice(0, 10));
      dateCursor.setUTCDate(dateCursor.getUTCDate() + 1);
    }

    const previousPrices = new Map<string, number>();
    const dailyReturns: number[] = [];
    const returnDates: string[] = [];
    let marketDataAsOf: Date | null = null;
    for (const observation of observations) {
      const value = Number(observation.value);
      if (Number.isFinite(value) && value > 0) {
        if (!marketDataAsOf || observation.fetchedAt > marketDataAsOf) {
          marketDataAsOf = observation.fetchedAt;
        }
      }
    }
    for (const date of dates) {
      let complete = true;
      let portfolioReturn = 0;
      const assetReturns = new Map<string, number>();
      for (const exposure of exposures) {
        const prices = priceByFeedAndDate.get(exposure.feedId);
        const observedPrice = prices?.get(date);
        const previousPrice = previousPrices.get(exposure.feedId);
        const currentPrice = observedPrice ?? previousPrice;
        if (observedPrice !== undefined) {
          previousPrices.set(exposure.feedId, observedPrice);
        }
        if (currentPrice === undefined || previousPrice === undefined) {
          complete = false;
          continue;
        }
        const assetReturn = currentPrice / previousPrice - 1;
        assetReturns.set(exposure.feedId, assetReturn);
        portfolioReturn += exposure.weight * assetReturn;
      }
      if (complete) {
        for (const exposure of exposures) {
          exposure.dailyReturns.push(assetReturns.get(exposure.feedId) ?? 0);
        }
        dailyReturns.push(portfolioReturn);
        returnDates.push(date);
      }
    }
    if (dailyReturns.length === 0) {
      throw new BadRequestException(
        'Oracle feeds do not have overlapping daily observations for this portfolio',
      );
    }

    return {
      portfolioValueUsd,
      exposures,
      dates: returnDates,
      dailyReturns,
      observationCount: observations.length,
      feedCount: exposures.length,
      marketDataAsOf: marketDataAsOf!.toISOString(),
    };
  }

  private buildComponents(
    history: PortfolioHistory,
    portfolioVaRUsd: number,
  ): PortfolioVaRResult['components'] {
    const components = history.exposures.map((exposure) => {
      const standalone = calculatePortfolioVaR(exposure.dailyReturns, {
        confidenceLevel: 0.95,
        horizonDays: 1,
        method: 'historical',
        portfolioValueUsd: exposure.amountUsd,
      }).varUsd;
      const riskWeight =
        exposure.weight *
        standardDeviation(exposure.dailyReturns) *
        history.portfolioValueUsd;
      return { exposure, standalone, riskWeight };
    });
    const totalRiskWeight = components.reduce(
      (sum, component) => sum + component.riskWeight,
      0,
    );
    return components.map(({ exposure, standalone, riskWeight }) => ({
      commodity: exposure.commodity,
      feedId: exposure.feedId,
      exposureUsd: exposure.amountUsd,
      weight: exposure.weight,
      riskContributionUsd:
        totalRiskWeight > 0
          ? (portfolioVaRUsd * riskWeight) / totalRiskWeight
          : 0,
      standaloneVaRUsd: standalone,
    }));
  }

  private buildTrend(
    history: PortfolioHistory,
    options: ReturnType<PortfolioVaRService['normalizeQuery']>,
  ): PortfolioVaRResult['trend'] {
    const trend: PortfolioVaRResult['trend'] = [];
    const firstIndex = Math.max(1, history.dailyReturns.length - TREND_POINTS);
    for (
      let index = firstIndex;
      index < history.dailyReturns.length;
      index += 1
    ) {
      const sample = history.dailyReturns.slice(
        Math.max(0, index - BACKTEST_LOOKBACK),
        index,
      );
      if (sample.length < options.horizonDays) continue;
      trend.push({
        date: history.dates[index],
        varUsd: calculatePortfolioVaR(sample, {
          ...options,
          method: 'historical',
          portfolioValueUsd: history.portfolioValueUsd,
        }).varUsd,
      });
    }
    return trend;
  }

  private scenarioShock(
    scenario: PortfolioVaRStressScenarioDto,
    exposure: PortfolioExposure,
  ): number {
    const normalizedShocks = Object.entries(scenario.shocks ?? {}).map(
      ([key, value]) =>
        [key === '*' ? '*' : normalizeCommodity(key), Number(value)] as const,
    );
    if (
      normalizedShocks.some(
        ([, value]) => !Number.isFinite(value) || value < -1,
      )
    ) {
      throw new BadRequestException(
        `Scenario "${scenario.name}" contains an invalid shock`,
      );
    }
    const commodity = normalizeCommodity(exposure.commodity);
    const shock =
      normalizedShocks.find(([key]) => key === commodity)?.[1] ??
      normalizedShocks.find(([key]) => key === '*')?.[1];
    return shock ?? 0;
  }
}

function normalizeCommodity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
