import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { DocumentVersionsService } from './document-versions.service';

interface AuthRequest {
  user: { id: string; role: string };
}

@Controller('documents/:documentId/versions')
@UseGuards(AuthGuard('jwt'))
export class DocumentVersionsController {
  constructor(private readonly service: DocumentVersionsService) {}

  @Get()
  history(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.history(documentId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
    @Body('comment') comment: string,
    @Request() req: AuthRequest,
  ) {
    return this.service.uploadVersion(documentId, file, comment, req.user);
  }

  @Get('compare')
  compare(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('a', ParseIntPipe) a: number,
    @Query('b', ParseIntPipe) b: number,
  ) {
    return this.service.compare(documentId, a, b);
  }

  @Get('diff')
  diff(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('a', ParseIntPipe) a: number,
    @Query('b', ParseIntPipe) b: number,
  ) {
    return this.service.diff(documentId, a, b);
  }

  @Get('analytics')
  analytics(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.analytics(documentId);
  }

  @Get(':version')
  get(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.service.getVersion(documentId, version);
  }

  @Post(':version/restore')
  restore(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body('comment') comment: string,
    @Request() req: AuthRequest,
  ) {
    return this.service.restoreVersion(documentId, version, comment, req.user);
  }
}

@Controller('admin/document-versions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class DocumentVersionsAdminController {
  constructor(private readonly service: DocumentVersionsService) {}

  @Get('analytics')
  analytics() {
    return this.service.analytics();
  }
}
