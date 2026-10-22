'use client';

import React from 'react';

interface ChatbotButtonProps {
  onClick: () => void;
  isOpen: boolean;
}

export const ChatbotButton: React.FC<ChatbotButtonProps> = ({ onClick, isOpen }) => {
  if (isOpen) return null;

  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-brand-600 to-brand-700 text-white rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all flex items-center justify-center text-2xl z-40 border-2 border-white animate-pulse"
      title="Open AI Assistant"
      aria-label="Open AI Assistant"
    >
      💬
    </button>
  );
};
