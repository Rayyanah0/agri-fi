import { Injectable } from '@nestjs/common';

export type EmotionType = 'happy' | 'sad' | 'angry' | 'anxious' | 'confused' | 'neutral' | 'frustrated';

export interface EmotionAnalysis {
  emotion: EmotionType;
  confidence: number;
  intensity: number; // 0-1
  flags: string[];
}

@Injectable()
export class EmotionDetectorService {
  private emotionKeywords: Record<EmotionType, { positive: string[]; negative: string[] }> = {
    happy: {
      positive: ['great', 'excellent', 'wonderful', 'fantastic', 'love', 'perfect', 'amazing', 'thrilled'],
      negative: ['bad', 'terrible', 'awful'],
    },
    sad: {
      positive: ['understandable', 'okay', 'alright'],
      negative: ['sad', 'unhappy', 'disappointed', 'down', 'depressed', 'lost', 'sorry'],
    },
    angry: {
      positive: ['calm', 'resolved'],
      negative: ['angry', 'furious', 'frustrated', 'upset', 'mad', 'disgusted', 'hate'],
    },
    anxious: {
      positive: ['confident', 'sure', 'certain'],
      negative: ['worried', 'nervous', 'anxious', 'scared', 'afraid', 'concerned', 'stressed'],
    },
    confused: {
      positive: ['understand', 'clear', 'obvious'],
      negative: ['confused', 'lost', 'don\'t understand', 'unclear', 'bewildered', 'puzzled'],
    },
    frustrated: {
      positive: ['resolved', 'working', 'fixed'],
      negative: ['frustrated', 'annoyed', 'irritated', 'exasperated', 'fed up'],
    },
    neutral: {
      positive: [],
      negative: [],
    },
  };

  detectEmotion(text: string): EmotionAnalysis {
    const lowerText = text.toLowerCase();
    const words = lowerText.split(/\s+/);

    const emotionScores: Record<EmotionType, number> = {
      happy: 0,
      sad: 0,
      angry: 0,
      anxious: 0,
      confused: 0,
      frustrated: 0,
      neutral: 0,
    };

    const flags: string[] = [];

    // Analyze keywords
    Object.entries(this.emotionKeywords).forEach(([emotion, keywords]) => {
      words.forEach((word) => {
        keywords.positive.forEach((kw) => {
          if (word.includes(kw)) emotionScores[emotion as EmotionType] += 1.5;
        });
        keywords.negative.forEach((kw) => {
          if (word.includes(kw)) emotionScores[emotion as EmotionType] += 2;
        });
      });
    });

    // Detect intensity markers
    if (lowerText.includes('!!!') || lowerText.includes('???')) {
      flags.push('high_punctuation');
    }
    if (lowerText === lowerText.toUpperCase() && lowerText.length > 3) {
      flags.push('all_caps');
    }
    if (text.includes('please') || text.includes('help')) {
      flags.push('needs_assistance');
    }

    // Determine primary emotion
    let maxScore = 0;
    let primaryEmotion: EmotionType = 'neutral';

    Object.entries(emotionScores).forEach(([emotion, score]) => {
      if (score > maxScore) {
        maxScore = score;
        primaryEmotion = emotion as EmotionType;
      }
    });

    const totalScore = Object.values(emotionScores).reduce((a, b) => a + b, 0);
    const confidence = totalScore > 0 ? maxScore / totalScore : 0;
    const intensity = Math.min(maxScore / 10, 1);

    return {
      emotion: primaryEmotion,
      confidence,
      intensity,
      flags,
    };
  }

  getEmotionMeta(emotion: EmotionType) {
    const meta: Record<EmotionType, { icon: string; color: string; tone: string }> = {
      happy: { icon: '😊', color: 'green', tone: 'positive' },
      sad: { icon: '😢', color: 'blue', tone: 'empathetic' },
      angry: { icon: '😠', color: 'red', tone: 'calming' },
      anxious: { icon: '😰', color: 'orange', tone: 'reassuring' },
      confused: { icon: '😕', color: 'yellow', tone: 'clarifying' },
      frustrated: { icon: '😤', color: 'red', tone: 'supportive' },
      neutral: { icon: '😐', color: 'gray', tone: 'informative' },
    };
    return meta[emotion];
  }
}
