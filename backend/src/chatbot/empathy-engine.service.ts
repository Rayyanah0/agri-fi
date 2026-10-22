import { Injectable } from '@nestjs/common';
import { EmotionType } from './emotion-detector.service';

export interface EmpathyContext {
  userId: string;
  userRole: 'trader' | 'farmer' | 'investor' | 'logistics';
  dealContext?: { dealId: string; status: string };
  investmentContext?: { investmentId: string; amount: number };
  language: string;
}

export interface EmpathyResponse {
  acknowledgment: string;
  response: string;
  suggestedActions: string[];
  tone: string;
}

@Injectable()
export class EmpathyEngineService {
  private empathyTemplates: Record<
    EmotionType,
    Record<string, string[]>
  > = {
    happy: {
      acknowledgment: [
        "That's wonderful to hear!",
        'I\'m glad you\'re feeling positive!',
        'Your enthusiasm is great to see!',
      ],
      response: [
        'How can I help you make the most of this momentum?',
        'Let\'s keep building on this positive energy.',
        'What would help you achieve even more?',
      ],
    },
    sad: {
      acknowledgment: [
        "I understand you're feeling down.",
        'It sounds like things haven\'t gone as planned.',
        'I hear your concern.',
      ],
      response: [
        'Let me help you navigate through this.',
        'We can work through this together.',
        'What specific support do you need right now?',
      ],
    },
    angry: {
      acknowledgment: [
        'I can see this is frustrating you.',
        'Your concerns are valid.',
        'I understand your frustration.',
      ],
      response: [
        'Let\'s find a solution together.',
        'I\'m here to help resolve this.',
        'What can I do to make this right?',
      ],
    },
    anxious: {
      acknowledgment: [
        "I can sense your concern.",
        'Your caution is understandable.',
        'I recognize this might feel uncertain.',
      ],
      response: [
        'Let me provide some clarity and reassurance.',
        'We have safeguards in place to protect you.',
        'Here\'s what you need to know...',
      ],
    },
    confused: {
      acknowledgment: [
        'That makes sense to be uncertain about.',
        'This can be confusing at first.',
        'Let me clarify that for you.',
      ],
      response: [
        'Let me break this down step by step.',
        'Here\'s a simpler way to think about it...',
        'Let me explain this more clearly.',
      ],
    },
    frustrated: {
      acknowledgment: [
        'I understand your frustration.',
        'This situation is challenging, I get it.',
        'Your exasperation is completely justified.',
      ],
      response: [
        'Let\'s solve this problem right now.',
        'I\'m committed to fixing this for you.',
        'Here\'s exactly what we\'ll do...',
      ],
    },
    neutral: {
      acknowledgment: [
        'Thank you for reaching out.',
        'I\'m here to help.',
        'How can I assist you?',
      ],
      response: [
        'Let me provide you with the information you need.',
        'Here\'s what I can help you with.',
        'What would be most helpful?',
      ],
    },
  };

  generateEmpathyResponse(
    emotion: EmotionType,
    userInput: string,
    context: EmpathyContext,
  ): EmpathyResponse {
    const templates = this.empathyTemplates[emotion];

    const acknowledgment =
      templates.acknowledgment[Math.floor(Math.random() * templates.acknowledgment.length)];
    const responseTemplate =
      templates.response[Math.floor(Math.random() * templates.response.length)];

    // Tailor response based on context
    const tailoredResponse = this.tailorResponseToContext(
      responseTemplate,
      userInput,
      context,
    );

    const suggestedActions = this.generateSuggestedActions(emotion, context, userInput);

    return {
      acknowledgment,
      response: tailoredResponse,
      suggestedActions,
      tone: this.getTone(emotion),
    };
  }

  private tailorResponseToContext(
    template: string,
    userInput: string,
    context: EmpathyContext,
  ): string {
    let response = template;

    // Add contextual info if available
    if (context.dealContext) {
      if (userInput.toLowerCase().includes('deal')) {
        response += ` Your ${context.dealContext.status} deal is important to us.`;
      }
    }

    if (context.investmentContext) {
      if (userInput.toLowerCase().includes('invest')) {
        response += ` Your investment of $${context.investmentContext.amount} is secure with us.`;
      }
    }

    // Tailor to user role
    const roleContext: Record<string, string> = {
      trader: 'As a trader, you have full control over your shipment milestones.',
      farmer: 'As a farmer, your harvest and fair pricing are our priority.',
      investor: 'As an investor, your returns and transparency are guaranteed.',
      logistics: 'As a logistics provider, your efficiency is key to our success.',
    };

    response += ` ${roleContext[context.userRole]}`;

    return response;
  }

  private generateSuggestedActions(
    emotion: EmotionType,
    context: EmpathyContext,
    userInput: string,
  ): string[] {
    const actions: string[] = [];

    // Emotion-based suggestions
    if (emotion === 'anxious' || emotion === 'confused') {
      actions.push('View step-by-step guide');
      actions.push('Chat with a human agent');
    }

    if (emotion === 'angry' || emotion === 'frustrated') {
      actions.push('File a support ticket');
      actions.push('Escalate to management');
    }

    if (emotion === 'sad') {
      actions.push('Review past successful deals');
      actions.push('Get personalized recommendations');
    }

    // Context-based suggestions
    if (context.dealContext) {
      actions.push('View deal details');
      actions.push('Track shipment progress');
    }

    if (context.investmentContext) {
      actions.push('View investment performance');
      actions.push('Check returns');
    }

    // Role-based suggestions
    if (context.userRole === 'trader' && userInput.toLowerCase().includes('create')) {
      actions.push('Start new deal wizard');
    }

    return actions.slice(0, 3); // Return top 3 actions
  }

  private getTone(emotion: EmotionType): string {
    const tones: Record<EmotionType, string> = {
      happy: 'celebratory',
      sad: 'empathetic',
      angry: 'solution-focused',
      anxious: 'reassuring',
      confused: 'clarifying',
      frustrated: 'supportive',
      neutral: 'informative',
    };
    return tones[emotion];
  }
}
