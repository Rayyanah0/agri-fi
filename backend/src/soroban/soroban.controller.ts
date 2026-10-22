import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConflictResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolesGuard, MfaGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { SorobanService } from './soroban.service';
import { ReleaseMilestoneDto } from './dto/release-milestone.dto';
import { DistributeRevenueDto } from './dto/distribute-revenue.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { ContractDispute } from './entities/contract-dispute.entity';
import {
  DISPUTE_ERROR_CODES,
  DisputeEvidenceDto,
  DisputeMilestoneDto,
} from './dto/dispute.dto';

const DISPUTE_CONFLICT_SCHEMA = {
  type: 'object',
  properties: {
    statusCode: { type: 'number', example: 409 },
    code: { type: 'string', enum: Object.values(DISPUTE_ERROR_CODES) },
    message: { type: 'string' },
  },
};

@ApiTags('soroban')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ version: '1', path: 'soroban' })
export class SorobanController {
  constructor(
    private readonly sorobanService: SorobanService,
    @InjectRepository(ContractDispute)
    private readonly disputeRepo: Repository<ContractDispute>,
  ) {}

  @Get('campaign/:contractId/state')
  @ApiOperation({ summary: 'Get on-chain campaign state' })
  async getCampaignState(@Param('contractId') contractId: string) {
    return this.sorobanService.getCampaignState(contractId);
  }

  @Get('campaign/:contractId/investor/:address/ownership')
  @ApiOperation({ summary: 'Get investor ownership percentage (basis points)' })
  async getOwnership(
    @Param('contractId') contractId: string,
    @Param('address') address: string,
  ) {
    const bps = await this.sorobanService.getInvestorOwnership(
      contractId,
      address,
    );
    return { ownershipBps: bps, ownershipPct: (bps / 100).toFixed(2) };
  }

  @Post('campaign/:contractId/approve')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: approve funded campaign on-chain' })
  async approveCampaign(@Param('contractId') contractId: string) {
    const txHash = await this.sorobanService.approveCampaign(contractId);
    return { txHash };
  }

  @Post('campaign/:contractId/milestone')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: release a milestone tranche to farmer' })
  async releaseMilestone(
    @Param('contractId') contractId: string,
    @Body() dto: ReleaseMilestoneDto,
  ) {
    const txHash = await this.sorobanService.releaseMilestone(
      contractId,
      dto.milestoneIndex,
    );
    return { txHash };
  }

  @Post('campaign/:contractId/distribute')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: distribute harvest revenue to investors' })
  async distributeRevenue(
    @Param('contractId') contractId: string,
    @Body() dto: DistributeRevenueDto,
  ) {
    const txHash = await this.sorobanService.distributeRevenue(
      contractId,
      BigInt(dto.revenueAmountStroops),
    );
    return { txHash };
  }

  @Post('campaign/:contractId/pause')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: emergency pause campaign' })
  async pauseCampaign(@Param('contractId') contractId: string) {
    const txHash = await this.sorobanService.pauseCampaign(contractId);
    return { txHash };
  }

  @Post('campaign/:contractId/fail')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: mark campaign as failed (enables refunds)' })
  async failCampaign(@Param('contractId') contractId: string) {
    const txHash = await this.sorobanService.markCampaignFailed(contractId);
    return { txHash };
  }

  @Get('factory/:contractId/campaign/:dealId')
  @ApiOperation({ summary: 'Get campaign entry from ProjectFactory registry' })
  async getFactoryCampaign(
    @Param('contractId') contractId: string,
    @Param('dealId') dealId: string,
  ) {
    return this.sorobanService.getCampaignFromFactory(contractId, dealId);
  }

  @Post('marketplace/:contractId/confirm')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: confirm delivery and trigger settlement' })
  async confirmDelivery(
    @Param('contractId') contractId: string,
    @Body() dto: ConfirmDeliveryDto,
  ) {
    const txHash = await this.sorobanService.confirmMarketplaceDelivery(
      contractId,
      dto.orderId,
    );
    return { txHash };
  }

  @Post('refund')
  @Roles('admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard, MfaGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: process buyer refund with MFA protection' })
  async refund(@Body() dto: { contractId: string; orderId: string }) {
    const txHash = await this.sorobanService.refundMarketplaceBuyer(
      dto.contractId,
      dto.orderId,
    );
    return { txHash };
  }

  @Post('marketplace/:contractId/refund')
  @Roles('admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard, MfaGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin: refund buyer (dispute resolution) with MFA',
  })
  async refundBuyer(
    @Param('contractId') contractId: string,
    @Body() dto: ConfirmDeliveryDto,
  ) {
    const txHash = await this.sorobanService.refundMarketplaceBuyer(
      contractId,
      dto.orderId,
    );
    return { txHash };
  }

  @Get('marketplace/:contractId/order/:orderId')
  @ApiOperation({ summary: 'Get marketplace order state on-chain' })
  async getOrder(
    @Param('contractId') contractId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.sorobanService.getMarketplaceOrder(contractId, orderId);
  }

  // ── On-chain dispute resolution (issue #1004) ───────────────────────────────

  @Post('campaign/:contractId/dispute')
  @Roles('admin', 'farmer', 'investor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Raise a dispute on a campaign milestone',
    description:
      'Freezes the milestone release and opens the arbitrator voting window. ' +
      'Only the campaign admin, the farmer and staked investors are parties.',
  })
  @ApiConflictResponse({
    description: 'Milestone already has an open dispute (contract error 15)',
    schema: DISPUTE_CONFLICT_SCHEMA,
  })
  async raiseDispute(
    @Param('contractId') contractId: string,
    @Body() dto: DisputeMilestoneDto,
  ) {
    const txHash = await this.sorobanService
      .raiseCampaignDispute(contractId, dto.milestoneIndex)
      .catch((error) => this.rethrowDisputeConflict(error, dto.milestoneIndex));
    return { txHash };
  }

  @Post('campaign/:contractId/dispute/evidence')
  @Roles('admin', 'farmer', 'investor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Attach an evidence document to an undecided dispute',
  })
  @ApiConflictResponse({
    description:
      'No open dispute, already decided, or the evidence cap is reached',
    schema: DISPUTE_CONFLICT_SCHEMA,
  })
  async submitDisputeEvidence(
    @Param('contractId') contractId: string,
    @Body() dto: DisputeEvidenceDto,
  ) {
    const txHash = await this.sorobanService
      .submitDisputeEvidence(contractId, dto.milestoneIndex, dto.uri)
      .catch((error) => this.rethrowDisputeConflict(error, dto.milestoneIndex));
    return { txHash };
  }

  @Post('campaign/:contractId/dispute/resolve')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute a dispute verdict once the voting window has closed',
    description:
      'Release pays the milestone tranche to the farmer; refund converts the ' +
      'remaining escrow into investor refunds. Idempotent on-chain.',
  })
  @ApiConflictResponse({
    description: 'The voting window is still open (contract error 20)',
    schema: DISPUTE_CONFLICT_SCHEMA,
  })
  async resolveDispute(
    @Param('contractId') contractId: string,
    @Body() dto: DisputeMilestoneDto,
  ) {
    const txHash = await this.sorobanService
      .resolveCampaignDispute(contractId, dto.milestoneIndex)
      .catch((error) => this.rethrowDisputeConflict(error, dto.milestoneIndex));
    return { txHash };
  }

  @Get('campaign/:contractId/dispute/:milestoneIndex')
  @ApiOperation({
    summary: 'Read the authoritative dispute record straight from the contract',
  })
  @ApiNotFoundResponse({ description: 'No dispute was ever raised on it' })
  async getCampaignDispute(
    @Param('contractId') contractId: string,
    @Param('milestoneIndex') milestoneIndex: string,
  ) {
    const index = Number(milestoneIndex);
    if (!Number.isInteger(index) || index < 0) {
      throw new NotFoundException(
        `milestoneIndex must be a zero-based integer, received "${milestoneIndex}"`,
      );
    }

    const dispute = await this.sorobanService.getCampaignDispute(
      contractId,
      index,
    );
    if (!dispute) {
      throw new NotFoundException(
        `No dispute recorded on-chain for milestone ${index} of ${contractId}`,
      );
    }
    return dispute;
  }

  @Get('campaign/:contractId/disputes')
  @ApiOperation({
    summary: 'List disputes indexed by the Soroban event listener',
    description:
      'Served from the local `contract_disputes` projection, so it only covers ' +
      'disputed milestones whose events the listener has seen.',
  })
  async listIndexedDisputes(@Param('contractId') contractId: string) {
    const disputes = await this.disputeRepo.find({
      where: { contractId },
      order: { milestoneIndex: 'ASC' },
    });
    return { contractId, total: disputes.length, disputes };
  }

  @Get('campaign/:contractId/dispute-config')
  @ApiOperation({
    summary: 'Arbitration configuration a newly raised dispute inherits',
  })
  async getDisputeConfig(@Param('contractId') contractId: string) {
    const [votingWindowSecs, arbitratorPool] = await Promise.all([
      this.sorobanService.getDisputeVotingWindow(contractId),
      this.sorobanService.getArbitratorPool(contractId),
    ]);
    return { votingWindowSecs, arbitratorPool };
  }

  /**
   * `DISPUTE_ACTIVE` (15), `VOTING_WINDOW_CLOSED` (19) and `VOTING_NOT_OVER`
   * (20) all come back from `simulateTransaction` as plain errors, so the
   * contract error code is mapped to a conflict the client can branch on
   * instead of leaking raw host debug text. Anything else is left untouched.
   */
  private rethrowDisputeConflict(
    error: unknown,
    milestoneIndex: number,
  ): never {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/contract error code:\s*(\d+)/i);
    const code = match ? DISPUTE_ERROR_CODES[Number(match[1])] : undefined;

    if (!code) throw error instanceof Error ? error : new Error(message);
    throw new ConflictException({
      message,
      code,
      milestoneIndex,
      status: 409,
    });
  }
}
