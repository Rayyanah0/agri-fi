'use client';

import React from 'react';
import { format } from 'date-fns';

interface ChatbotMessageProps {
  message: {
    id: string;
    sender: 'user' | 'bot';
    content: string;
    emotion?: string;
    emotionConfidence?: number;
    timestamp: Date;
  };
}

const emotionEmojis: Record<string, string> = {
  happy: '😊',
  sad: '😢',
  angry: '😠',
  anxious: '😰',
  confused: '😕',
  frustrated: '😤',
  neutral: '😐',
};

export const ChatbotMessage: React.FC<ChatbotMessageProps> = ({ message }) => {
  const isUser = message.sender === 'user';
  const emotionEmoji = message.emotion ? emotionEmojis[message.emotion] : '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-xs px-4 py-2 rounded-lg ${
          isUser
            ? 'bg-brand-600 text-white rounded-br-none'
            : 'bg-gray-200 text-gray-900 rounded-bl-none'
        }`}
      >
        <p className="text-sm">{message.content}</p>

        {!isUser && message.emotion && message.emotionConfidence && (
          <div className="mt-2 text-xs opacity-75">
            {emotionEmoji} I detected {message.emotion} ({Math.round(message.emotionConfidence * 100)}% confidence)
          </div>
        )}

        <p className={`text-xs mt-1 ${isUser ? 'text-brand-100' : 'text-gray-500'}`}>
          {format(message.timestamp, 'HH:mm')}
        </p>
      </div>
    </div>
  );
};
