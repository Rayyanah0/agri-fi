'use client';

import React, { useState } from 'react';

interface ChatbotSatisfactionProps {
  conversationId: string;
  onRated?: (rating: number) => void;
}

export const ChatbotSatisfaction: React.FC<ChatbotSatisfactionProps> = ({
  conversationId,
  onRated,
}) => {
  const [rating, setRating] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRate = async (value: number) => {
    setRating(value);
    setLoading(true);

    try {
      await fetch(`/api/v1/chatbot/${conversationId}/satisfaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ rating: value }),
      });

      setSubmitted(true);
      onRated?.(value);

      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      console.error('Failed to submit satisfaction rating', err);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="px-4 py-3 bg-green-50 border-t border-green-200 text-center">
        <p className="text-sm text-green-700">✓ Thank you for your feedback!</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-blue-50 border-t border-blue-200">
      <p className="text-xs text-blue-700 font-medium mb-2">How helpful was this response?</p>
      <div className="flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => handleRate(star)}
            disabled={loading}
            className={`text-2xl transition-transform hover:scale-110 disabled:opacity-50 ${
              rating && rating >= star ? 'opacity-100' : 'opacity-40'
            }`}
          >
            {rating && rating >= star ? '★' : '☆'}
          </button>
        ))}
      </div>
    </div>
  );
};
