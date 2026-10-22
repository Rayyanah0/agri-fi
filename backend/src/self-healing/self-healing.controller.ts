import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { SelfHealingService } from './self-healing.service';
import { RemediationHistoryService } from './remediation/remediation-history.service';
import { RemediationAnalyticsService } from './remediation/remediation-analytics.service';
import { CustomScriptService } from './remediation/custom-script.service';
import { SafetyCheckService } from './remediation/safety-check.service';
import { SelfHealingIssue } from './entities/self-healing-issue.entity';
import { RemediationAction } from './entities/remediation-action.entity';
import { RemediationPolicy } from './entities/remediation-policy.entity';
import { CreateRemediationScriptDto } from './dto/create-remediation-script.dto';
import { UpdateRemediationPolicyDto } from './dto/update-remediation-policy.dto';
import { normalizePagination, toPaginatedResult } from '../common/pagination';
import type {
  RemediationActionType,
  RemediationStatus,
} from './entities/remediation-action.entity';
import type { SelfHealingIssueType } from './entities/self-healing-issue.entity';

/**
 * Administrative API of the self-healing engine.
 *
 * It exposes the detected issues, the remediation history used for the
 * audit trail, the analytics of the automation and the controls (policies
 * and custom scripts) that decide what the automation is allowed to do.
 */
@ApiTags('admin/self-healing')
@ApiBearerAuth('jwt')
@Controller({ path: 'admin/self-healing', version: '1' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class SelfHealingController {
  constructor(
    private readonly selfHealingService: SelfHealingService,
    private readonly historyService: RemediationHistoryService,
    private readonly analyticsService: RemediationAnalyticsService,
    private readonly customScriptService: CustomScriptService,
    private readonly safetyCheckService: SafetyCheckService,
    @InjectRepository(SelfHealingIssue)
    private readonly issueRepo: Repository<SelfHealingIssue>,
    @InjectRepository(RemediationAction)
    private readonly actionRepo: Repository<RemediationAction>,
    @InjectRepository(RemediationPolicy)
    private readonly policyRepo: Repository<RemediationPolicy>,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get the status of the self-healing automation',
  })
  @ApiResponse({ status: 200, description: 'Automation status' })
  async getStatus() {
    return {
      enabled: this.selfHealingService.isEnabled(),
      environment: this.safetyCheckService.getEnvironment(),
      scriptsDirectory: this.customScriptService.getScriptsDirectory(),
    };
  }

  @Get('issues')
  @ApiOperation({ summary: 'List the detected self-healing issues' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'issueType', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Detected issues' })
  async getIssues(
    @Query('status') status?: string,
    @Query('issueType') issueType?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    const pagination = normalizePagination({ page, limit });
    const where: any = {};

    if (status) {
      where.status = status;
    }
    if (issueType) {
      where.issueType = issueType;
    }

    const [data, total] = await this.issueRepo.findAndCount({
      where,
      order: { detectedAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return toPaginatedResult(data, total, pagination.page, pagination.limit);
  }

  @Get('issues/:id')
  @ApiOperation({ summary: 'Get a single detected issue' })
  @ApiResponse({ status: 200, description: 'Issue detail' })
  @ApiResponse({ status: 404, description: 'Issue not found' })
  async getIssue(@Param('id') id: string) {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      return null;
    }

    const actions = await this.actionRepo.find({
      where: { issueId: id },
      order: { createdAt: 'DESC' },
    });

    return { ...issue, actions };
  }

  @Post('issues/:id/remediate')
  @ApiOperation({
    summary: 'Trigger the remediation of an issue manually',
  })
  @ApiResponse({ status: 200, description: 'Remediation result' })
  @ApiResponse({ status: 404, description: 'Issue not found' })
  async remediateIssue(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      return { status: 'not_found' };
    }

    const outcome = await this.selfHealingService.remediateIssue(issue, {
      actorId: req.user.id,
      triggerSource: 'api',
    });

    return { issueId: id, outcome };
  }

  @Post('cycle')
  @ApiOperation({
    summary: 'Run a detection and remediation cycle immediately',
  })
  @ApiResponse({ status: 200, description: 'Cycle summary' })
  async runCycle() {
    return this.selfHealingService.runDetectionCycle();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get the remediation history (audit trail)' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'actionType', required: false, type: String })
  @ApiQuery({ name: 'issueId', required: false, type: String })
  @ApiQuery({ name: 'target', required: false, type: String })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Remediation history' })
  async getHistory(
    @Query('status') status?: string,
    @Query('actionType') actionType?: string,
    @Query('issueId') issueId?: string,
    @Query('target') target?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    const pagination = normalizePagination({ page, limit });
    const { data, total } = await this.historyService.find({
      status: status as RemediationStatus | undefined,
      actionType: actionType as RemediationActionType | undefined,
      issueId,
      target,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: pagination.page,
      limit: pagination.limit,
    });

    return toPaginatedResult(data, total, pagination.page, pagination.limit);
  }

  @Get('analytics')
  @ApiOperation({
    summary:
      'Get the remediation analytics (success rate, time saved, false positives)',
  })
  @ApiQuery({ name: 'hours', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Remediation analytics' })
  async getAnalytics(
    @Query('hours', new DefaultValuePipe(720), ParseIntPipe)
    hours: number = 720,
  ) {
    return this.analyticsService.compute(hours);
  }

  @Get('policies')
  @ApiOperation({ summary: 'List the remediation safety policies' })
  @ApiResponse({ status: 200, description: 'Remediation policies' })
  async getPolicies() {
    return this.policyRepo.find({ order: { name: 'ASC' } });
  }

  @Patch('policies/:id')
  @ApiOperation({ summary: 'Update a remediation safety policy' })
  @ApiResponse({ status: 200, description: 'Updated policy' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async updatePolicy(
    @Param('id') id: string,
    @Body() dto: UpdateRemediationPolicyDto,
  ) {
    const policy = await this.policyRepo.findOne({ where: { id } });
    if (!policy) {
      return null;
    }

    const changes: Partial<RemediationPolicy> = {
      enabled: dto.enabled,
      requiresApproval: dto.requiresApproval,
      destructive: dto.destructive,
      maxExecutionsPerHour: dto.maxExecutionsPerHour,
      cooldownMinutes: dto.cooldownMinutes,
      stagingValidated: dto.stagingValidated,
      minReplicas: dto.minReplicas,
      maxReplicas: dto.maxReplicas,
      description: dto.description,
    };

    if (dto.allowedEnvironments) {
      changes.allowedEnvironmentsJson = dto.allowedEnvironments;
    }

    Object.assign(policy, changes);
    return this.policyRepo.save(policy);
  }

  @Get('scripts')
  @ApiOperation({ summary: 'List the registered custom remediation scripts' })
  @ApiResponse({ status: 200, description: 'Remediation scripts' })
  async getScripts() {
    return this.customScriptService.listScripts();
  }

  @Post('scripts')
  @ApiOperation({ summary: 'Register a custom remediation script' })
  @ApiResponse({ status: 201, description: 'Registered script' })
  async createScript(@Body() dto: CreateRemediationScriptDto) {
    return this.customScriptService.registerScript({
      name: dto.name,
      issueType: dto.issueType as SelfHealingIssueType,
      description: dto.description ?? null,
      scriptPath: dto.scriptPath,
      interpreter: dto.interpreter ?? 'bash',
      timeoutSeconds: dto.timeoutSeconds ?? 300,
      defaultArgsJson: dto.defaultArgs ?? [],
      enabled: dto.enabled ?? true,
      requiresApproval: dto.requiresApproval ?? true,
      destructive: dto.destructive ?? false,
      allowedEnvironmentsJson: dto.allowedEnvironments ?? ['staging'],
      version: 1,
      lastRunAt: null,
      lastResult: null,
    });
  }

  @Patch('scripts/:id')
  @ApiOperation({ summary: 'Update a custom remediation script' })
  @ApiResponse({ status: 200, description: 'Updated script' })
  @ApiResponse({ status: 404, description: 'Script not found' })
  async updateScript(
    @Param('id') id: string,
    @Body() dto: CreateRemediationScriptDto,
  ) {
    return this.customScriptService.updateScript(id, {
      name: dto.name,
      issueType: dto.issueType as SelfHealingIssueType,
      description: dto.description ?? null,
      scriptPath: dto.scriptPath,
      interpreter: dto.interpreter ?? 'bash',
      timeoutSeconds: dto.timeoutSeconds ?? 300,
      defaultArgsJson: dto.defaultArgs ?? [],
      enabled: dto.enabled ?? true,
      requiresApproval: dto.requiresApproval ?? true,
      destructive: dto.destructive ?? false,
      allowedEnvironmentsJson: dto.allowedEnvironments ?? ['staging'],
    });
  }

  @Get('actions/:id')
  @ApiOperation({ summary: 'Get a single remediation action' })
  @ApiResponse({ status: 200, description: 'Remediation action' })
  async getAction(@Param('id') id: string) {
    return this.actionRepo.findOne({ where: { id } });
  }

  @Post('actions/:id/approve')
  @ApiOperation({
    summary: 'Approve a pending remediation action and execute it',
  })
  @ApiResponse({ status: 200, description: 'Approved action' })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async approveAction(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.selfHealingService.approveAction(id, req.user.id);
  }

  @Post('actions/:id/reject')
  @ApiOperation({ summary: 'Reject a pending remediation action' })
  @ApiResponse({ status: 200, description: 'Rejected action' })
  @ApiResponse({ status: 404, description: 'Action not found' })
  async rejectAction(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.selfHealingService.rejectAction(id, req.user.id);
  }
}
