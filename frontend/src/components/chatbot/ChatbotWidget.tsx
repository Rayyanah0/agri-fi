'use client';

import React, { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { ChatbotMessage } from './ChatbotMessage';
import { ChatbotActions } from './ChatbotActions';

interface Message {
  id: string;
  sender: 'user' | 'bot';
  content: string;
  emotion?: string;
  emotionConfidence?: number;
  timestamp: Date;
  suggestedActions?: string[];
  canEscalate?: boolean;
}

interface ChatbotWidgetProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ChatbotWidget: React.FC<ChatbotWidgetProps> = ({
  userId,
  isOpen,
  onClose,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initial greeting
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting: Message = {
        id: `greeting-${Date.now()}`,
        sender: 'bot',
        content:
          'Hello! I\'m your empathetic AI assistant. How can I help you today? Whether you need guidance on deals, investments, or have questions about the platform, I\'m here to support you.',
        timestamp: new Date(),
        suggestedActions: [
          'Create a new deal',
          'Track investments',
          'Platform help',
        ],
      };
      setMessages([greeting]);
    }
  }, [isOpen]);

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      // Send to backend
      const res = await fetch('/api/v1/chatbot/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          message: input,
          language: document.documentElement.lang || 'en',
        }),
      });

      if (!res.ok) throw new Error('Failed to get response');

      const data = await res.json();

      // Add bot response
      const botMessage: Message = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        content: data.response,
        emotion: data.emotion,
        emotionConfidence: data.emotionConfidence,
        timestamp: new Date(),
        suggestedActions: data.suggestedActions,
        canEscalate: data.canEscalate,
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleActionClick = (action: string) => {
    setInput(action);
  };

  const handleEscalate = async () => {
    if (messages.length === 0) return;

    const lastBotMessage = [...messages].reverse().find((m) => m.sender === 'bot');
    if (!lastBotMessage?.id) return;

    try {
      await fetch(`/api/v1/chatbot/${lastBotMessage.id}/escalate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      const escalationMsg: Message = {
        id: `escalation-${Date.now()}`,
        sender: 'bot',
        content:
          'You\'ve been connected with a human agent. They\'ll be with you shortly. Thank you for your patience!',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, escalationMsg]);
    } catch (err) {
      setError('Failed to escalate');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 w-96 h-[600px] bg-white rounded-lg shadow-2xl border border-gray-200 flex flex-col z-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-brand-600 to-brand-700 text-white px-4 py-4 rounded-t-lg flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">AgriFi Assistant</h2>
          <p className="text-xs text-brand-100">Always here to help 😊</p>
        </div>
        <button
          onClick={onClose}
          className="text-white hover:bg-brand-800 p-1 rounded transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg) => (
          <ChatbotMessage key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested actions */}
      {messages.length > 0 && messages[messages.length - 1].suggestedActions && (
        <ChatbotActions
          actions={messages[messages.length - 1].suggestedActions || []}
          onActionClick={handleActionClick}
        />
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 p-4 space-y-3">
        {messages.length > 0 && messages[messages.length - 1].canEscalate && (
          <button
            onClick={handleEscalate}
            className="w-full px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
          >
            Escalate to Human Agent
          </button>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Type your message..."
            disabled={loading}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-100 text-sm"
          />
          <button
            onClick={handleSendMessage}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
