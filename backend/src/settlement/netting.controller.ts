import {
  Controller,
  Get,
  Post,
  Param,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { NettingService, CreateObligationDto } from './netting.service';
import {
  NettingCycleFrequency,
  NettingCycleStatus,
} from './entities/netting-cycle.entity';
import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';

interface AuthRequest {
  user: {
    id: string;
    roles?: string[];
  };
}

@ApiTags('Settlement Netting')
@Controller('api/v1/settlement/netting')
export class NettingController {
  constructor(private readonly nettingService: NettingService) {}

  @Post('obligations')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Record a new payment obligation for settlement netting',
  })
  @ApiResponse({ status: 201, description: 'Obligation recorded' })
  async createObligation(@Body() dto: CreateObligationDto) {
    return this.nettingService.createObligation(dto);
  }

  @Get('obligations')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List pending payment obligations' })
  @ApiQuery({ name: 'partyId', required: false })
  @ApiQuery({ name: 'dealId', required: false })
  async getPendingObligations(
    @Query('partyId') partyId?: string,
    @Query('dealId') dealId?: string,
  ) {
    return this.nettingService.getPendingObligations({ partyId, dealId });
  }

  @Post('cycles')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'settlement_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Schedule a new settlement netting cycle (Admin only)',
  })
  @ApiResponse({ status: 201, description: 'Netting cycle scheduled' })
  async scheduleCycle(
    @Body() body: { frequency?: NettingCycleFrequency; scheduledAt?: string },
  ) {
    return this.nettingService.scheduleCycle(
      body.frequency || 'daily',
      body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    );
  }

  @Get('cycles')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List settlement netting cycles' })
  @ApiQuery({ name: 'status', required: false })
  async listCycles(@Query('status') status?: NettingCycleStatus) {
    return this.nettingService.listCycles(status);
  }

  @Get('cycles/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get details for a specific netting cycle' })
  @ApiParam({ name: 'id', description: 'Netting cycle UUID' })
  async getCycle(@Param('id') id: string) {
    return this.nettingService.getCycle(id);
  }

  @Post('cycles/:id/execute')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'settlement_officer')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Execute multilateral netting and process settlements (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Netting cycle UUID' })
  async executeCycle(@Param('id') id: string) {
    return this.nettingService.executeNettingCycle(id);
  }

  @Post('cycles/:id/unwind')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'settlement_officer')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Unwind a defaulting counterparty and re-net solvent parties (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Netting cycle UUID' })
  async unwindDefaultingParty(
    @Param('id') id: string,
    @Body() body: { defaultingPartyId: string },
  ) {
    return this.nettingService.unwindDefaultingCounterparty(
      id,
      body.defaultingPartyId,
    );
  }

  @Get('cycles/:id/report')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Generate reconciliation report for netting cycle' })
  @ApiParam({ name: 'id', description: 'Netting cycle UUID' })
  async getReconciliationReport(@Param('id') id: string) {
    return this.nettingService.generateNettingReport(id);
  }

  @Get('cycles/:id/compliance')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Verify ISDA & CPMI-IOSCO regulatory compliance for netting cycle',
  })
  @ApiParam({ name: 'id', description: 'Netting cycle UUID' })
  async verifyCompliance(@Param('id') id: string) {
    return this.nettingService.verifyNettingCompliance(id);
  }

  @Get('analytics')
  @ApiOperation({
    summary:
      'Get aggregate netting savings, volume reductions, and efficiency gains',
  })
  async getNettingAnalytics() {
    return this.nettingService.getNettingAnalytics();
  }
}
