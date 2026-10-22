import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DocumentType } from '../trade-deals/entities/document.entity';
import { DocumentClassificationService } from './document-classification.service';

@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'documents/classification', version: '1' })
export class DocumentClassificationController {
  constructor(private readonly classificationService: DocumentClassificationService) {}

  @Get('analytics')
  getAnalytics(@Req() request: { user: { id: string } }) {
    return this.classificationService.getAnalytics(request.user.id);
  }

  @Get('clusters')
  getClusters(@Req() request: { user: { id: string } }) {
    return this.classificationService.getClusters(request.user.id);
  }

  @Get(':documentId/similar')
  getSimilar(@Req() request: { user: { id: string } }, @Param('documentId') documentId: string, @Query('limit') limit?: string) {
    return this.classificationService.getSimilar(documentId, request.user.id, Number(limit) || 10);
  }

  @Post(':documentId/feedback')
  provideFeedback(
    @Req() request: { user: { id: string } },
    @Param('documentId') documentId: string,
    @Body() body: { correctedType: DocumentType; tags?: string[] },
  ) {
    return this.classificationService.provideFeedback(documentId, request.user.id, body.correctedType, body.tags);
  }
}