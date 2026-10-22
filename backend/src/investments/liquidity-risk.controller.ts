import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import {
  LiquidityRiskService,
  StressScenarioType,
  ScenarioParameters,
} from './liquidity-risk.service';

interface AuthRequest {
  user: {
    id: string;
    roles?: string[];
  };
}

@ApiTags('Liquidity Risk Monitoring')
@Controller('api/v1/investments/liquidity')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth('jwt')
export class LiquidityRiskController {
  constructor(private readonly liquidityRiskService: LiquidityRiskService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Calculate quantitative portfolio-level liquidity metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio liquidity summary and cash conversion schedule',
  })
  async getPortfolioLiquidity(@Request() req: AuthRequest) {
    return this.liquidityRiskService.aggregatePortfolioLiquidity(req.user.id);
  }

  @Post('stress-test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Simulate portfolio liquidity under market stress scenarios',
  })
  @ApiResponse({
    status: 200,
    description: 'Stress test results and resilience rating',
  })
  async runStressTest(
    @Request() req: AuthRequest,
    @Body() body: { scenario?: StressScenarioType },
  ) {
    return this.liquidityRiskService.runStressTest(req.user.id, body.scenario);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Evaluate liquidity alerts and threshold breaches' })
  @ApiResponse({ status: 200, description: 'Active liquidity risk alerts' })
  async getLiquidityAlerts(
    @Request() req: AuthRequest,
    @Query('minScore') minScore?: number,
    @Query('minBufferPct') minBufferPct?: number,
  ) {
    const summary = await this.liquidityRiskService.aggregatePortfolioLiquidity(
      req.user.id,
    );
    const thresholds = {
      minPortfolioScore: minScore ? Number(minScore) : 40,
      min30dBufferPct: minBufferPct ? Number(minBufferPct) : 15,
      minLcrPct: 100,
    };
    return this.liquidityRiskService.evaluateLiquidityAlerts(
      summary,
      thresholds,
    );
  }

  @Get('optimization')
  @ApiOperation({
    summary:
      'Get actionable portfolio rebalancing and liquidity uplift suggestions',
  })
  @ApiResponse({ status: 200, description: 'Ranked optimization suggestions' })
  async getOptimizationSuggestions(@Request() req: AuthRequest) {
    return this.liquidityRiskService.getLiquidityOptimizationSuggestions(
      req.user.id,
    );
  }

  @Post('snapshots')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Record a historical liquidity snapshot for the portfolio',
  })
  async recordSnapshot(@Request() req: AuthRequest) {
    const summary = await this.liquidityRiskService.aggregatePortfolioLiquidity(
      req.user.id,
    );
    return this.liquidityRiskService.recordSnapshot(req.user.id, summary);
  }

  @Get('snapshots')
  @ApiOperation({ summary: 'Retrieve historical liquidity tracking snapshots' })
  @ApiQuery({ name: 'days', required: false, example: 90 })
  async getHistoricalSnapshots(
    @Request() req: AuthRequest,
    @Query('days') days?: number,
  ) {
    return this.liquidityRiskService.getHistoricalSnapshots(
      req.user.id,
      days ? Number(days) : 90,
    );
  }

  @Get('report')
  @ApiOperation({
    summary: 'Generate Basel III compliant liquidity coverage & funding report',
  })
  @ApiResponse({ status: 200, description: 'Liquidity compliance report' })
  async getLiquidityReport(@Request() req: AuthRequest) {
    return this.liquidityRiskService.generateLiquidityReport(req.user.id);
  }

  @Post('scenario')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Test custom hypothetical liquidity scenarios with interactive variables',
  })
  async runScenarioAnalysis(
    @Request() req: AuthRequest,
    @Body() params: ScenarioParameters,
  ) {
    return this.liquidityRiskService.runScenarioAnalysis(req.user.id, params);
  }

  @Get('plan')
  @ApiOperation({
    summary: 'Generate forward cash flow timeline and liquidity plan',
  })
  @ApiQuery({ name: 'horizonDays', required: false, example: 180 })
  async getLiquidityPlan(
    @Request() req: AuthRequest,
    @Query('horizonDays') horizonDays?: number,
  ) {
    return this.liquidityRiskService.generateLiquidityPlan(
      req.user.id,
      horizonDays ? Number(horizonDays) : 180,
    );
  }
}
