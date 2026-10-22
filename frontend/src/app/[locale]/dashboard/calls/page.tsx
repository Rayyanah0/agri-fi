'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, type User } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import ErrorBoundary from '@/components/ErrorBoundary';
import CallCenter from '@/components/calling/CallCenter';

export default function CallsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const current = apiClient.getCurrentUser();
    if (!current) router.push('/login');
    else setUser(current);
  }, [router]);

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <ErrorBoundary>
        <div className="mx-auto max-w-6xl p-4 md:p-6">
          <h1 className="mb-4 text-2xl font-bold">Calls</h1>
          <CallCenter />
        </div>
      </ErrorBoundary>
    </DashboardLayout>
  );
}
