import {
  Controller,
  Get,
  Post,
  Patch,
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
import {
  RegulatoryRuleEngineService,
  CreateRegulatoryRuleDto,
  UpdateRegulatoryRuleDto,
} from './regulatory-rule-engine.service';
import {
  RuleJurisdiction,
  RuleStatus,
  RuleCategory,
  RuleTestCase,
} from './entities/regulatory-rule.entity';
import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';

interface AuthRequest {
  user: {
    id: string;
    roles?: string[];
  };
}

@ApiTags('Regulatory Rule Engine')
@Controller('api/v1/compliance/rules')
export class RegulatoryRuleEngineController {
  constructor(
    private readonly ruleEngineService: RegulatoryRuleEngineService,
  ) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Create a new regulatory compliance rule (Editor)' })
  @ApiResponse({ status: 201, description: 'Rule created in draft status' })
  async createRule(
    @Request() req: AuthRequest,
    @Body() dto: CreateRegulatoryRuleDto,
  ) {
    return this.ruleEngineService.createRule({
      ...dto,
      authorId: req.user.id,
    });
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'List regulatory compliance rules' })
  @ApiQuery({ name: 'jurisdiction', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'category', required: false })
  async listRules(
    @Query('jurisdiction') jurisdiction?: RuleJurisdiction,
    @Query('status') status?: RuleStatus,
    @Query('category') category?: RuleCategory,
  ) {
    return this.ruleEngineService.listRules({ jurisdiction, status, category });
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get details for a specific regulatory rule' })
  @ApiParam({ name: 'id', description: 'Rule UUID' })
  async getRule(@Param('id') id: string) {
    return this.ruleEngineService.getRule(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Edit rule and increment version (Rule Versioning)',
  })
  @ApiParam({ name: 'id', description: 'Rule UUID' })
  async editRule(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateRegulatoryRuleDto,
  ) {
    return this.ruleEngineService.editRule(id, dto, req.user.id);
  }

  @Get(':code/history')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Retrieve immutable version history for a rule code',
  })
  @ApiParam({ name: 'code', description: 'Rule code family, e.g. AML-001' })
  async getRuleHistory(@Param('code') code: string) {
    return this.ruleEngineService.getRuleVersionHistory(code);
  }

  @Post(':code/rollback')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Rollback rule to a previous active version' })
  @ApiParam({ name: 'code', description: 'Rule code family' })
  async rollbackRule(
    @Param('code') code: string,
    @Request() req: AuthRequest,
    @Body() body: { targetVersion: number },
  ) {
    return this.ruleEngineService.rollbackRule(
      code,
      body.targetVersion,
      req.user.id,
    );
  }

  @Post(':id/test')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Test rule conditions against test cases (Rule Testing)',
  })
  @ApiParam({ name: 'id', description: 'Rule UUID' })
  async testRule(
    @Param('id') id: string,
    @Body() body: { testCases?: RuleTestCase[] },
  ) {
    return this.ruleEngineService.testRule(id, body.testCases);
  }

  @Post(':id/deploy')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Deploy rule to staged or active/production (Rule Deployment)',
  })
  @ApiParam({ name: 'id', description: 'Rule UUID' })
  async deployRule(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() body: { targetStatus: 'staged' | 'active' },
  ) {
    return this.ruleEngineService.deployRule(
      id,
      body.targetStatus,
      req.user.id,
    );
  }

  @Post('evaluate')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Execute rule engine against fact context (Execution Engine)',
  })
  async evaluateFacts(
    @Body()
    body: {
      facts: Record<string, any>;
      context: {
        jurisdiction?: RuleJurisdiction;
        entityType: string;
        entityId: string;
      };
    },
  ) {
    return this.ruleEngineService.evaluateFacts(body.facts, body.context);
  }

  @Get('metrics/monitoring')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary:
      'Get rule execution monitoring metrics & latency (Rule Monitoring)',
  })
  async getMonitoringMetrics() {
    return this.ruleEngineService.getRuleMonitoringMetrics();
  }

  @Get('reports/jurisdiction')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'compliance_officer')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Generate compliance report by jurisdiction (Rule Reporting)',
  })
  @ApiQuery({ name: 'jurisdiction', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  async getComplianceReport(
    @Query('jurisdiction') jurisdiction?: RuleJurisdiction,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.ruleEngineService.generateComplianceReport({
      jurisdiction,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
  }
}
