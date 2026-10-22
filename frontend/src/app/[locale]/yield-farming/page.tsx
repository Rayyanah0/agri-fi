'use client';

import React from 'react';
import { YieldFarmingDashboard } from '@/components/yield-farming/YieldFarmingDashboard';

export default function YieldFarmingPage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 py-6">
      <YieldFarmingDashboard />
    </main>
  );
}
