import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LetterOfCreditService } from './letter-of-credit.service';
import {
  CreateLetterOfCreditDto,
  AmendLetterOfCreditDto,
  VerifyDocumentDto,
} from './dto/create-lc.dto';

@ApiTags('letter-of-credit')
@Controller({ version: '1', path: 'letter-of-credit' })
export class LetterOfCreditController {
  constructor(private readonly lcService: LetterOfCreditService) {}

  @Get()
  @ApiOperation({ summary: 'List all digital Letters of Credit' })
  @ApiResponse({ status: 200, description: 'List of Letters of Credit' })
  async getAll() {
    return this.lcService.getAllLcs();
  }

  @Get('analytics')
  @ApiOperation({
    summary: 'Get Letter of Credit processing and compliance analytics',
  })
  @ApiResponse({ status: 200, description: 'LC Analytics summary' })
  async getAnalytics() {
    return this.lcService.getAnalytics();
  }

  @Get('deal/:dealId')
  @ApiOperation({
    summary: 'Get Letters of Credit associated with a trade deal',
  })
  @ApiParam({ name: 'dealId', description: 'Trade deal UUID' })
  @ApiResponse({ status: 200, description: 'Deal LCs' })
  async getByDeal(@Param('dealId') dealId: string) {
    return this.lcService.getDealLcs(dealId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Letter of Credit details by ID' })
  @ApiParam({ name: 'id', description: 'Letter of credit UUID' })
  @ApiResponse({ status: 200, description: 'Letter of credit record' })
  async getById(@Param('id') id: string) {
    return this.lcService.getLc(id);
  }

  @Post('issue-from-deal/:dealId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('trader', 'admin')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Automate issuance of Letter of Credit from trade deal terms',
  })
  @ApiParam({ name: 'dealId', description: 'Trade deal UUID' })
  @ApiResponse({ status: 201, description: 'Letter of Credit issued' })
  async issueFromDeal(
    @Param('dealId') dealId: string,
    @Body() dto: Partial<CreateLetterOfCreditDto>,
  ) {
    return this.lcService.issueFromDeal(dealId, dto);
  }

  @Post(':id/amendments')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('trader', 'farmer', 'admin')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Request an automated LC amendment with workflow approval',
  })
  @ApiParam({ name: 'id', description: 'Letter of credit UUID' })
  @ApiResponse({ status: 201, description: 'Amendment created' })
  async requestAmendment(
    @Param('id') id: string,
    @Body() dto: AmendLetterOfCreditDto,
  ) {
    return this.lcService.requestAmendment(id, dto);
  }

  @Post(':id/amendments/:amendmentId/decision')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('trader', 'farmer', 'admin')
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Approve or reject a pending LC amendment' })
  @ApiParam({ name: 'id', description: 'Letter of credit UUID' })
  @ApiParam({ name: 'amendmentId', description: 'Amendment identifier' })
  @ApiResponse({ status: 200, description: 'Amendment decision applied' })
  async decideAmendment(
    @Param('id') id: string,
    @Param('amendmentId') amendmentId: string,
    @Body() body: { approved: boolean; reason?: string },
  ) {
    return this.lcService.decideAmendment(
      id,
      amendmentId,
      body.approved,
      body.reason,
    );
  }

  @Post(':id/verify-document')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('trader', 'farmer', 'admin')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Verify shipping or commercial document against UCP 600 standards',
  })
  @ApiParam({ name: 'id', description: 'Letter of credit UUID' })
  @ApiResponse({ status: 200, description: 'Document verification result' })
  async verifyDocument(
    @Param('id') id: string,
    @Body() dto: VerifyDocumentDto,
  ) {
    return this.lcService.verifyDocument(id, dto);
  }

  @Post(':id/settle')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('trader', 'admin')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Trigger automated payment release on compliant LC fulfillment',
  })
  @ApiParam({ name: 'id', description: 'Letter of credit UUID' })
  @ApiResponse({ status: 200, description: 'Settlement execution result' })
  async settleLc(@Param('id') id: string) {
    return this.lcService.settleLc(id);
  }
}
