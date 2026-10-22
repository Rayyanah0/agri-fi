import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request as ExpressRequest, Response } from 'express';
import { ChatService, CreateConversationInput } from './chat.service';

interface ChatRequest extends ExpressRequest {
  user: { id: string };
}

@ApiTags('chat')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'chat', version: '1' })
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('contacts')
  searchContacts(@Request() req: ChatRequest, @Query('q') query: string) {
    return this.chatService.searchContacts(req.user.id, query ?? '');
  }

  @Get('conversations')
  listConversations(@Request() req: ChatRequest) {
    return this.chatService.listConversations(req.user.id);
  }

  @Post('conversations')
  createConversation(
    @Request() req: ChatRequest,
    @Body() input: CreateConversationInput,
  ) {
    return this.chatService.createConversation(req.user.id, input);
  }

  @Get('conversations/:id/messages')
  getMessages(
    @Request() req: ChatRequest,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.getMessages(conversationId, req.user.id);
  }

  @Get('conversations/:id/search')
  searchMessages(
    @Request() req: ChatRequest,
    @Param('id') conversationId: string,
    @Query('q') query: string,
  ) {
    return this.chatService.searchMessages(
      conversationId,
      req.user.id,
      query ?? '',
    );
  }

  @Post('conversations/:id/messages')
  createMessage(
    @Request() req: ChatRequest,
    @Param('id') conversationId: string,
    @Body() body: { content?: string; replyToId?: string },
  ) {
    return this.chatService.createMessage(
      conversationId,
      req.user.id,
      body?.content ?? '',
      body?.replyToId,
    );
  }

  @Post('conversations/:id/read')
  markRead(@Request() req: ChatRequest, @Param('id') conversationId: string) {
    return this.chatService.markRead(conversationId, req.user.id);
  }

  @Post('messages/:id/reactions')
  addReaction(
    @Request() req: ChatRequest,
    @Param('id') messageId: string,
    @Body() body: { emoji?: string },
  ) {
    return this.chatService.addReaction(
      messageId,
      req.user.id,
      body?.emoji ?? '',
    );
  }

  @Post('conversations/:id/attachments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  uploadAttachment(
    @Request() req: ChatRequest,
    @Param('id') conversationId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.chatService.uploadAttachment(conversationId, req.user.id, file);
  }

  @Get('attachments/:id')
  async downloadAttachment(
    @Request() req: ChatRequest,
    @Param('id') attachmentId: string,
    @Res() response: Response,
  ) {
    const attachment = await this.chatService.getAttachment(
      attachmentId,
      req.user.id,
    );
    const safeName = attachment.fileName.replace(/[\r\n"]/g, '_');
    response
      .set({
        'Content-Type': attachment.mimeType,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': attachment.data.length,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      })
      .send(attachment.data);
  }

  @Get('analytics')
  analytics(@Request() req: ChatRequest) {
    return this.chatService.getAnalytics(req.user.id);
  }
}
