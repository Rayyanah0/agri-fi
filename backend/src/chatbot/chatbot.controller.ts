import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Query,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ChatbotService, ChatbotRequest, ChatbotResponse } from './chatbot.service';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('chatbot')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'chatbot', version: '1' })
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message to emotional AI chatbot' })
  @ApiResponse({ status: 200, description: 'Chatbot response with emotion analysis' })
  async sendMessage(
    @Request() req: AuthRequest,
    @Body() body: { message: string; language?: string },
  ): Promise<ChatbotResponse> {
    return this.chatbotService.processMessage({
      userId: req.user.id,
      message: body.message,
      language: body.language,
    });
  }

  @Get('history')
  @ApiOperation({ summary: 'Get conversation history for current user' })
  @ApiResponse({ status: 200, description: 'List of past conversations' })
  async getHistory(
    @Request() req: AuthRequest,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.chatbotService.getConversationHistory(req.user.id, limitNum);
  }

  @Post(':conversationId/escalate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Escalate conversation to human agent' })
  async escalate(
    @Request() req: AuthRequest,
    @Param('conversationId') conversationId: string,
  ) {
    await this.chatbotService.escalateToHuman(conversationId, req.user.id);
    return { success: true, message: 'Conversation escalated' };
  }

  @Post(':conversationId/satisfaction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record satisfaction rating for conversation' })
  async recordSatisfaction(
    @Param('conversationId') conversationId: string,
    @Body() body: { rating: number },
  ) {
    await this.chatbotService.recordSatisfaction(conversationId, body.rating);
    return { success: true, message: 'Satisfaction recorded' };
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get chatbot analytics (admin only)' })
  async getAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.chatbotService.getAnalytics(start, end);
  }
}
