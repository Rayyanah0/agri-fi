'use client';

import React from 'react';

interface ChatbotActionsProps {
  actions: string[];
  onActionClick: (action: string) => void;
}

export const ChatbotActions: React.FC<ChatbotActionsProps> = ({
  actions,
  onActionClick,
}) => {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 space-y-2">
      <p className="text-xs text-gray-600 font-medium">Suggested:</p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action, idx) => (
          <button
            key={idx}
            onClick={() => onActionClick(action)}
            className="text-xs px-3 py-1 bg-white border border-brand-200 text-brand-600 rounded-full hover:bg-brand-50 transition-colors"
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
};
