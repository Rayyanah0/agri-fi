import { Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EmotionDetectorService, EmotionType } from './emotion-detector.service';
import { EmpathyEngineService } from './empathy-engine.service';
import { ChatbotContextService } from './chatbot-context.service';
import { ChatbotConversation } from './chatbot-conversation.entity';
import { PinoLogger } from 'nestjs-pino';

export interface ChatbotRequest {
  userId: string;
  message: string;
  language?: string;
}

export interface ChatbotResponse {
  conversationId: string;
  response: string;
  emotion: EmotionType;
  emotionConfidence: number;
  suggestedActions: string[];
  tone: string;
  canEscalate: boolean;
}

@Injectable()
export class ChatbotService {
  constructor(
    private readonly logger: PinoLogger,
    @InjectRepository(ChatbotConversation)
    private readonly conversationRepo: Repository<ChatbotConversation>,
    private readonly emotionDetector: EmotionDetectorService,
    private readonly empathyEngine: EmpathyEngineService,
    private readonly contextService: ChatbotContextService,
  ) {
    (this.logger as any).setContext(ChatbotService.name);
  }

  async processMessage(req: ChatbotRequest): Promise<ChatbotResponse> {
    // Detect emotion
    const emotionAnalysis = this.emotionDetector.detectEmotion(req.message);

    // Get user context
    const userContext = await this.contextService.enrichUserContext(
      req.userId,
      req.message,
    );

    // Generate empathetic response
    const empathyResponse = this.empathyEngine.generateEmpathyResponse(
      emotionAnalysis.emotion,
      req.message,
      {
        userId: req.userId,
        userRole: userContext.userRole,
        dealContext: userContext.dealContext,
        language: req.language || userContext.preferredLanguage,
      },
    );

    // Determine if escalation is needed
    const shouldEscalate = this.shouldEscalate(
      emotionAnalysis,
      req.message,
      userContext,
    );

    // Format full response
    const fullResponse = `${empathyResponse.acknowledgment} ${empathyResponse.response}`;

    // Save conversation to database
    const conversation = this.conversationRepo.create({
      userId: req.userId,
      message: req.message,
      response: fullResponse,
      detectedEmotion: emotionAnalysis.emotion,
      emotionConfidence: emotionAnalysis.confidence,
      escalated: shouldEscalate,
      language: req.language || userContext.preferredLanguage,
      metadata: {
        emotionIntensity: emotionAnalysis.intensity,
        emotionFlags: emotionAnalysis.flags,
        userRole: userContext.userRole,
        isNewUser: userContext.isNewUser,
      },
    });

    const saved = await this.conversationRepo.save(conversation);

    this.logger.info(
      {
        userId: req.userId,
        emotion: emotionAnalysis.emotion,
        escalated: shouldEscalate,
      },
      'Chatbot message processed',
    );

    return {
      conversationId: saved.id,
      response: fullResponse,
      emotion: emotionAnalysis.emotion,
      emotionConfidence: emotionAnalysis.confidence,
      suggestedActions: empathyResponse.suggestedActions,
      tone: empathyResponse.tone,
      canEscalate: !shouldEscalate,
    };
  }

  private shouldEscalate(
    emotionAnalysis: any,
    message: string,
    context: any,
  ): boolean {
    // High intensity negative emotions
    if (
      (emotionAnalysis.emotion === 'angry' ||
        emotionAnalysis.emotion === 'frustrated') &&
      emotionAnalysis.intensity > 0.7
    ) {
      return true;
    }

    // Keywords that indicate escalation need
    const escalationKeywords = [
      'human',
      'manager',
      'supervisor',
      'escalate',
      'urgent',
      'emergency',
      'legal',
      'complaint',
    ];

    if (escalationKeywords.some((kw) => message.toLowerCase().includes(kw))) {
      return true;
    }

    return false;
  }

  async escalateToHuman(conversationId: string, agentId: string): Promise<void> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.conversationRepo.update(conversationId, {
      escalated: true,
      escalatedTo: agentId,
    });

    this.logger.info(
      { conversationId, agentId },
      'Conversation escalated to human agent',
    );
  }

  async recordSatisfaction(conversationId: string, rating: number): Promise<void> {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    await this.conversationRepo.update(conversationId, {
      userSatisfaction: rating,
    });

    this.logger.info(
      { conversationId, rating },
      'User satisfaction recorded',
    );
  }

  async getConversationHistory(userId: string, limit = 10): Promise<ChatbotConversation[]> {
    return this.conversationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getAnalytics(startDate: Date, endDate: Date): Promise<any> {
    const conversations = await this.conversationRepo.find({
      where: {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      },
    });

    const emotionCounts: Record<string, number> = {};
    let escalationCount = 0;
    let totalSatisfaction = 0;
    let satisfactionCount = 0;

    conversations.forEach((conv) => {
      if (conv.detectedEmotion) {
        emotionCounts[conv.detectedEmotion] =
          (emotionCounts[conv.detectedEmotion] || 0) + 1;
      }
      if (conv.escalated) escalationCount++;
      if (conv.userSatisfaction) {
        totalSatisfaction += conv.userSatisfaction;
        satisfactionCount++;
      }
    });

    const averageSatisfaction =
      satisfactionCount > 0 ? totalSatisfaction / satisfactionCount : 0;

    return {
      totalConversations: conversations.length,
      emotionDistribution: emotionCounts,
      escalationRate: conversations.length > 0 ? escalationCount / conversations.length : 0,
      averageSatisfaction,
      resolutionRate: 1 - (escalationCount / conversations.length || 0),
    };
  }
}
