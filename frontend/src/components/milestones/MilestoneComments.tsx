'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';

interface Comment {
  id: string;
  userId: string;
  userDisplayName: string;
  content: string;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

interface MilestoneCommentsProps {
  milestoneId: string;
  onCommentAdded?: (comment: Comment) => void;
}

const roleColors: Record<string, string> = {
  trader: 'bg-blue-100 text-blue-800',
  farmer: 'bg-green-100 text-green-800',
  logistics: 'bg-purple-100 text-purple-800',
  investor: 'bg-amber-100 text-amber-800',
};

export const MilestoneComments: React.FC<MilestoneCommentsProps> = ({
  milestoneId,
  onCommentAdded,
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch comments on mount
  useEffect(() => {
    const fetchComments = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/shipments/milestones/${milestoneId}/comments`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        });

        if (!res.ok) throw new Error('Failed to load comments');

        const data = await res.json();
        setComments(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load comments');
      } finally {
        setLoading(false);
      }
    };

    fetchComments();
  }, [milestoneId]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newComment.trim()) return;

    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch(`/api/v1/shipments/milestones/${milestoneId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          milestoneId,
          content: newComment,
        }),
      });

      if (!res.ok) throw new Error('Failed to add comment');

      const comment = await res.json();
      setComments((prev) => [...prev, comment]);
      setNewComment('');
      onCommentAdded?.(comment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Collaboration</h3>

      {/* Comments list */}
      <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
        {comments.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No comments yet</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="border-l-2 border-gray-200 pl-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{comment.userDisplayName}</p>
                  {comment.role && (
                    <span
                      className={`inline-block mt-1 text-xs font-medium px-2 py-1 rounded ${
                        roleColors[comment.role] || 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {comment.role}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  {format(new Date(comment.createdAt), 'PPp')}
                </p>
              </div>
              <p className="text-sm text-gray-700 mt-2">{comment.content}</p>
            </div>
          ))
        )}
      </div>

      {/* Add comment form */}
      <form onSubmit={handleAddComment} className="border-t border-gray-200 pt-4">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a collaborative comment..."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          rows={3}
          disabled={submitting}
        />

        <button
          type="submit"
          disabled={submitting || !newComment.trim()}
          className="mt-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Adding...' : 'Add Comment'}
        </button>
      </form>
    </div>
  );
};
