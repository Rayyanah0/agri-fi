'use client';

import React from 'react';
import { InvoiceFactoringDashboard } from '@/components/invoice-factoring/InvoiceFactoringDashboard';

export default function InvoiceFactoringPage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 py-6">
      <InvoiceFactoringDashboard />
    </main>
  );
}
