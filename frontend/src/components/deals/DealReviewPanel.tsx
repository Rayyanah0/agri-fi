'use client';

// #1159 — Collaborative deal review: threaded comments, annotations, version history.

import { useState } from 'react';

export type ReviewStatus = 'draft' | 'under_review' | 'approved' | 'rejected';

export interface DealComment {
  id: string;
  authorName: string;
  authorRole: 'trader' | 'investor' | 'reviewer';
  body: string;
  createdAt: string;
  parentId?: string;
  flagged?: boolean;
}

export interface DealAnnotation {
  id: string;
  authorName: string;
  fieldKey: string;
  note: string;
  createdAt: string;
}

export interface DealVersion {
  version: number;
  changedBy: string;
  changedAt: string;
  summary: string;
}

interface DealReviewPanelProps {
  dealId: string;
  currentStatus: ReviewStatus;
  comments: DealComment[];
  annotations: DealAnnotation[];
  versions: DealVersion[];
  currentUserName: string;
  currentUserRole: 'trader' | 'investor' | 'reviewer';
  onAddComment: (body: string, parentId?: string) => void;
  onAddAnnotation: (fieldKey: string, note: string) => void;
  onChangeStatus: (status: ReviewStatus) => void;
  onFlagComment: (commentId: string) => void;
}

type ActiveTab = 'comments' | 'annotations' | 'history';

const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: 'Draft',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<ReviewStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  under_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export function DealReviewPanel({
  dealId: _dealId,
  currentStatus,
  comments,
  annotations,
  versions,
  currentUserName,
  currentUserRole,
  onAddComment,
  onAddAnnotation,
  onChangeStatus,
  onFlagComment,
}: DealReviewPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('comments');
  const [commentBody, setCommentBody] = useState('');
  const [replyToId, setReplyToId] = useState<string | undefined>(undefined);
  const [annotationField, setAnnotationField] = useState('');
  const [annotationNote, setAnnotationNote] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const topLevelComments = comments.filter((c) => !c.parentId);
  const repliesFor = (id: string) => comments.filter((c) => c.parentId === id);

  const filteredComments = searchQuery
    ? comments.filter(
        (c) =>
          c.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.authorName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : topLevelComments;

  const handleSubmitComment = () => {
    if (!commentBody.trim()) return;
    onAddComment(commentBody.trim(), replyToId);
    setCommentBody('');
    setReplyToId(undefined);
  };

  const handleSubmitAnnotation = () => {
    if (!annotationField.trim() || !annotationNote.trim()) return;
    onAddAnnotation(annotationField.trim(), annotationNote.trim());
    setAnnotationField('');
    setAnnotationNote('');
  };

  const canChangeStatus = currentUserRole === 'reviewer';

  return (
    <div className="card divide-y divide-slate-100">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <h3 className="font-bold text-slate-900">Deal Review</h3>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[currentStatus]}`}>
          {STATUS_LABELS[currentStatus]}
        </span>
      </div>

      {/* Status workflow (reviewer only) */}
      {canChangeStatus && (
        <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 mr-1">Set status:</span>
          {(['draft', 'under_review', 'approved', 'rejected'] as ReviewStatus[]).map((s) => (
            <button
              key={s}
              disabled={s === currentStatus}
              onClick={() => onChangeStatus(s)}
              className={`text-xs px-3 py-1 rounded-full font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                s === currentStatus
                  ? STATUS_COLORS[s]
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-100">
        {(['comments', 'annotations', 'history'] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-sm font-semibold capitalize transition-colors ${
              activeTab === tab
                ? 'text-brand-600 border-b-2 border-brand-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'comments'
              ? `Comments (${comments.length})`
              : tab === 'annotations'
              ? `Annotations (${annotations.length})`
              : `History (${versions.length})`}
          </button>
        ))}
      </div>

      {/* Comments tab */}
      {activeTab === 'comments' && (
        <div className="p-4 space-y-4">
          {/* Search */}
          <input
            className="input text-sm"
            type="search"
            placeholder="Search comments…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          {/* Thread list */}
          <div className="space-y-4 max-h-80 overflow-y-auto">
            {filteredComments.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No comments yet.</p>
            )}
            {filteredComments.map((comment) => (
              <div key={comment.id}>
                <CommentBubble
                  comment={comment}
                  onReply={() => setReplyToId(comment.id)}
                  onFlag={() => onFlagComment(comment.id)}
                  currentUserRole={currentUserRole}
                />
                {/* Replies */}
                {repliesFor(comment.id).map((reply) => (
                  <div key={reply.id} className="ml-6 mt-2">
                    <CommentBubble
                      comment={reply}
                      onReply={() => setReplyToId(comment.id)}
                      onFlag={() => onFlagComment(reply.id)}
                      currentUserRole={currentUserRole}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* New comment */}
          {replyToId && (
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span>Replying to comment</span>
              <button
                className="text-red-500 underline"
                onClick={() => setReplyToId(undefined)}
              >
                cancel
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              className="input text-sm flex-1 resize-none"
              rows={2}
              placeholder={`Comment as ${currentUserName}…`}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitComment();
              }}
            />
            <button
              onClick={handleSubmitComment}
              disabled={!commentBody.trim()}
              className="btn-primary text-sm px-4 self-end disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Post
            </button>
          </div>
        </div>
      )}

      {/* Annotations tab */}
      {activeTab === 'annotations' && (
        <div className="p-4 space-y-4">
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {annotations.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No annotations yet.</p>
            )}
            {annotations.map((ann) => (
              <div key={ann.id} className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-yellow-800">{ann.fieldKey}</span>
                  <span className="text-xs text-slate-400">
                    {ann.authorName} · {new Date(ann.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-slate-700">{ann.note}</p>
              </div>
            ))}
          </div>

          {/* Add annotation */}
          <div className="space-y-2">
            <input
              className="input text-sm"
              type="text"
              placeholder="Field name (e.g. 'Deal Value', 'Maturity Date')"
              value={annotationField}
              onChange={(e) => setAnnotationField(e.target.value)}
            />
            <div className="flex gap-2">
              <textarea
                className="input text-sm flex-1 resize-none"
                rows={2}
                placeholder="Your annotation note…"
                value={annotationNote}
                onChange={(e) => setAnnotationNote(e.target.value)}
              />
              <button
                onClick={handleSubmitAnnotation}
                disabled={!annotationField.trim() || !annotationNote.trim()}
                className="btn-primary text-sm px-4 self-end disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version history tab */}
      {activeTab === 'history' && (
        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {versions.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">No version history.</p>
          )}
          {[...versions].reverse().map((v) => (
            <div key={v.version} className="flex gap-3 items-start">
              <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                v{v.version}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">{v.summary}</p>
                <p className="text-xs text-slate-400">
                  {v.changedBy} · {new Date(v.changedAt).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentBubble({
  comment,
  onReply,
  onFlag,
  currentUserRole,
}: {
  comment: DealComment;
  onReply: () => void;
  onFlag: () => void;
  currentUserRole: 'trader' | 'investor' | 'reviewer';
}) {
  const roleColors: Record<string, string> = {
    trader: 'bg-blue-100 text-blue-700',
    investor: 'bg-purple-100 text-purple-700',
    reviewer: 'bg-green-100 text-green-700',
  };

  return (
    <div className={`rounded-xl p-3 ${comment.flagged ? 'bg-red-50 border border-red-200' : 'bg-slate-50'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleColors[comment.authorRole] ?? ''}`}>
          {comment.authorName}
        </span>
        <span className="text-xs text-slate-400">{new Date(comment.createdAt).toLocaleString()}</span>
        {comment.flagged && <span className="text-xs text-red-600 font-semibold">⚑ Flagged</span>}
      </div>
      <p className="text-sm text-slate-700">{comment.body}</p>
      <div className="flex gap-3 mt-2">
        <button className="text-xs text-brand-600 hover:underline" onClick={onReply}>
          Reply
        </button>
        {currentUserRole === 'reviewer' && !comment.flagged && (
          <button className="text-xs text-red-500 hover:underline" onClick={onFlag}>
            Flag
          </button>
        )}
      </div>
    </div>
  );
}
