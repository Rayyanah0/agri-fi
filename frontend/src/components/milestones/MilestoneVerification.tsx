'use client';

import React, { useState, useEffect } from 'react';

interface Verification {
  id: string;
  verifiedBy: string;
  verifierRole: string;
  status: 'verified' | 'rejected';
  notes: string | null;
  verifiedAt: string;
}

interface MilestoneVerificationProps {
  milestoneId: string;
  onVerificationAdded?: (verification: Verification) => void;
  canVerify?: boolean;
}

const statusConfig = {
  verified: {
    icon: '✓',
    color: 'bg-green-100 text-green-800',
    label: 'Verified',
  },
  rejected: {
    icon: '✕',
    color: 'bg-red-100 text-red-800',
    label: 'Rejected',
  },
};

const roleColors: Record<string, string> = {
  farmer: 'bg-green-50 border-green-200',
  logistics: 'bg-purple-50 border-purple-200',
  investor: 'bg-amber-50 border-amber-200',
  trader: 'bg-blue-50 border-blue-200',
};

export const MilestoneVerification: React.FC<MilestoneVerificationProps> = ({
  milestoneId,
  onVerificationAdded,
  canVerify = true,
}) => {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'verified' | 'rejected'>('verified');
  const [verifyNotes, setVerifyNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVerifications = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/shipments/milestones/${milestoneId}/verifications`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        });

        if (!res.ok) throw new Error('Failed to load verifications');

        const data = await res.json();
        setVerifications(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load verifications');
      } finally {
        setLoading(false);
      }
    };

    fetchVerifications();
  }, [milestoneId]);

  const handleVerify = async (status: 'verified' | 'rejected') => {
    try {
      setVerifying(true);
      setError(null);

      const res = await fetch(`/api/v1/shipments/milestones/${milestoneId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          milestoneId,
          status,
          notes: verifyNotes || undefined,
        }),
      });

      if (!res.ok) throw new Error('Failed to verify milestone');

      const verification = await res.json();
      setVerifications((prev) => [...prev, verification]);
      setVerifyNotes('');
      onVerificationAdded?.(verification);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify milestone');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
      </div>
    );
  }

  const verifiedCount = verifications.filter((v) => v.status === 'verified').length;
  const rejectedCount = verifications.filter((v) => v.status === 'rejected').length;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Multi-Party Verification</h3>

      {/* Verification stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 rounded-lg p-4 border border-green-200">
          <p className="text-3xl font-bold text-green-600">{verifiedCount}</p>
          <p className="text-xs text-green-700 mt-1">Verified</p>
        </div>
        <div className="bg-red-50 rounded-lg p-4 border border-red-200">
          <p className="text-3xl font-bold text-red-600">{rejectedCount}</p>
          <p className="text-xs text-red-700 mt-1">Rejected</p>
        </div>
      </div>

      {/* Verifications list */}
      <div className="space-y-3 mb-6 max-h-48 overflow-y-auto">
        {verifications.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No verifications yet</p>
        ) : (
          verifications.map((v) => {
            const config = statusConfig[v.status];
            return (
              <div
                key={v.id}
                className={`rounded-lg p-3 border-l-4 ${
                  roleColors[v.verifierRole] || 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${config.color}`}>
                        {config.icon}
                      </span>
                      <p className="text-sm font-medium text-gray-900">
                        {config.label} by {v.verifierRole}
                      </p>
                    </div>
                    {v.notes && <p className="text-xs text-gray-600 mt-2">{v.notes}</p>}
                  </div>
                  <p className="text-xs text-gray-400">
                    {new Date(v.verifiedAt).toLocaleString('en-US', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Verify form */}
      {canVerify && (
        <div className="border-t border-gray-200 pt-4">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          <textarea
            value={verifyNotes}
            onChange={(e) => setVerifyNotes(e.target.value)}
            placeholder="Add verification notes (optional)..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none mb-3"
            rows={2}
            disabled={verifying}
          />

          <div className="flex gap-2">
            <button
              onClick={() => handleVerify('verified')}
              disabled={verifying}
              className="flex-1 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ✓ Verify
            </button>
            <button
              onClick={() => handleVerify('rejected')}
              disabled={verifying}
              className="flex-1 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ✕ Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
