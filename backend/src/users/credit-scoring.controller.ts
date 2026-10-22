import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { User } from '../auth/entities/user.entity';
import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditScoreTier } from './credit-score.model';
import { FarmerCreditPerformanceService } from './farmer-credit-performance.service';
import { FarmerCreditDisputeService } from './farmer-credit-dispute.service';
import { CreateCreditScoreDisputeDto } from './dto/create-credit-score-dispute.dto';
import { ResolveCreditScoreDisputeDto } from './dto/resolve-credit-score-dispute.dto';

interface AuthRequest extends Request {
  user: User;
}

const CREDIT_TIERS: CreditScoreTier[] = ['Excellent', 'Good', 'Fair', 'Poor'];

@ApiTags('credit-scoring')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1', path: 'credit-scoring' })
export class CreditScoringController {
  constructor(
    private readonly performanceService: FarmerCreditPerformanceService,
    private readonly disputeService: FarmerCreditDisputeService,
  ) {}

  @Get('me/history')
  @ApiOperation({
    summary:
      "Get the farmer's credit score history rolled up by month (#1160)",
    description:
      'Returns one point per calendar month, oldest first, with the change against the previous month so the score trend can be charted.',
  })
  @ApiQuery({ name: 'months', required: false, example: 12 })
  @ApiResponse({ status: 200, description: 'Monthly credit score history' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getMyHistory(@Request() req: AuthRequest, @Query('months') months?: string) {
    const parsed = months ? Math.min(Math.max(parseInt(months, 10) || 12, 1), 60) : 12;
    return this.performanceService.getMonthlyHistory(req.user.id, parsed);
  }

  @Get('me/benchmark')
  @ApiOperation({
    summary: "Benchmark the farmer against peers in their country (#1160)",
    description:
      'Returns the regional average, median and percentile of the farmer against the other farmers in the same country.',
  })
  @ApiResponse({ status: 200, description: 'Peer benchmark for the farmer' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getMyBenchmark(@Request() req: AuthRequest) {
    return this.performanceService.getPeerBenchmark(req.user.id);
  }

  @Get('me/disputes')
  @ApiOperation({
    summary: "List the farmer's credit score disputes (#1160)",
  })
  @ApiResponse({ status: 200, description: 'Disputes filed by the farmer' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyDisputes(@Request() req: AuthRequest) {
    return this.disputeService.listForFarmer(req.user.id);
  }

  @Post('me/disputes')
  @ApiOperation({
    summary: 'File a dispute against the farmer credit score (#1160)',
    description:
      'A farmer may challenge any scoring dimension. Only one dispute may be under review at a time.',
  })
  @ApiResponse({ status: 201, description: 'Dispute filed' })
  @ApiResponse({ status: 400, description: 'A dispute is already under review' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Only farmers can dispute a score' })
  async fileDispute(@Request() req: AuthRequest, @Body() dto: CreateCreditScoreDisputeDto) {
    return this.disputeService.fileDispute(req.user.id, dto);
  }

  @Get('investment-recommendations')
  @ApiOperation({
    summary: 'Get deal recommendations ranked by farmer credit score (#1160)',
    description:
      'Returns the investable deals whose farmer clears the requested credit tier, and whose deal value fits inside the uncollateralized ceiling that tier grants.',
  })
  @ApiQuery({
    name: 'minTier',
    required: false,
    enum: CREDIT_TIERS,
    example: 'Good',
  })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Credit-ranked deal recommendations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getInvestmentRecommendations(
    @Request() req: AuthRequest,
    @Query('minTier') minTier?: string,
    @Query('limit') limit?: string,
  ) {
    const tier = CREDIT_TIERS.includes(minTier as CreditScoreTier)
      ? (minTier as CreditScoreTier)
      : 'Fair';
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50) : 10;

    const recommendations = await this.performanceService.getInvestmentRecommendations({
      minTier: tier,
      limit: parsedLimit,
    });

    return { minTier: tier, count: recommendations.length, recommendations };
  }

  @Get('admin/disputes')
  @UseGuards(RolesGuard)
  @Roles('admin', 'company_admin')
  @ApiOperation({
    summary: 'List credit score disputes for review (Admin only) (#1160)',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'under_review', 'resolved', 'rejected'] })
  @ApiResponse({ status: 200, description: 'Dispute review queue' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  async listDisputes(@Query('status') status?: string) {
    const allowed = ['open', 'under_review', 'resolved', 'rejected'];
    const filtered = allowed.includes(status) ? status : undefined;
    return this.disputeService.listDisputes(filtered as any);
  }

  @Patch('admin/disputes/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'company_admin')
  @ApiOperation({
    summary: 'Resolve a credit score dispute (Admin only) (#1160)',
    description:
      'Upholding a dispute applies the corrected score, or re-measures the farmer from their corrected history when no score is supplied.',
  })
  @ApiResponse({ status: 200, description: 'Dispute resolved' })
  @ApiResponse({ status: 400, description: 'Dispute already resolved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @ApiResponse({ status: 404, description: 'Dispute not found' })
  async resolveDispute(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: ResolveCreditScoreDisputeDto,
  ) {
    return this.disputeService.resolveDispute(req.user.id, id, dto);
  }
}
