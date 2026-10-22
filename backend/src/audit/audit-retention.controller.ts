import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../common/guards';
import { AuditRetentionService } from './audit-retention.service';

class RequestAuditArchiveRetrievalDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;
}

interface AdminRequest extends Request {
  user: { id: string };
}

@ApiTags('admin-audit-retention')
@ApiBearerAuth('jwt')
@Controller({ path: 'admin', version: '1' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AuditRetentionController {
  constructor(private readonly retentionService: AuditRetentionService) {}

  @Get('audit-retention/report')
  @ApiOperation({ summary: 'Get audit log retention compliance report' })
  getComplianceReport() {
    return this.retentionService.complianceReport();
  }

  @Get('audit-archives')
  @ApiOperation({ summary: 'List retained audit archive records' })
  listArchives(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.retentionService.listArchives(limit);
  }

  @Post('audit-archives/:id/retrieval-requests')
  @ApiOperation({ summary: 'Request retrieval of a retained audit record' })
  requestRetrieval(
    @Request() req: AdminRequest,
    @Param('id', ParseUUIDPipe) archiveRecordId: string,
    @Body() dto: RequestAuditArchiveRetrievalDto,
  ) {
    return this.retentionService.requestRetrieval(
      archiveRecordId,
      req.user.id,
      dto.reason,
    );
  }

  @Get('audit-archive-retrieval-requests')
  @ApiOperation({ summary: 'List audit archive retrieval requests' })
  listRetrievalRequests(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) {
    return this.retentionService.listRetrievalRequests(limit, status);
  }

  @Post('audit-archive-retrievals/:id/approve')
  @ApiOperation({
    summary: 'Approve an audit archive retrieval as a second administrator',
  })
  approveRetrieval(
    @Request() req: AdminRequest,
    @Param('id', ParseUUIDPipe) requestId: string,
  ) {
    return this.retentionService.approveRetrieval(requestId, req.user.id);
  }

  @Get('audit-archive-retrievals/:id')
  @ApiOperation({ summary: 'Retrieve an approved audit archive record' })
  retrieveApproved(
    @Request() req: AdminRequest,
    @Param('id', ParseUUIDPipe) requestId: string,
  ) {
    return this.retentionService.retrieveApproved(requestId, req.user.id);
  }
}
