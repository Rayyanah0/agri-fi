'use client';

import React, { useState } from 'react';
import {
  INITIAL_INVOICES,
  FactoredInvoice,
} from '@/lib/invoice-factoring';
import { InvoiceCard } from './InvoiceCard';
import { InvoiceListingModal } from './InvoiceListingModal';
import { FactoringAuctionModal } from './FactoringAuctionModal';
import { FactoringAnalyticsView } from './FactoringAnalyticsView';

export const InvoiceFactoringDashboard: React.FC = () => {
  const [invoices, setInvoices] = useState<FactoredInvoice[]>(INITIAL_INVOICES);
  const [activeTab, setActiveTab] = useState<'marketplace' | 'my_invoices' | 'analytics'>('marketplace');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isListingOpen, setIsListingOpen] = useState(false);
  const [selectedInvoiceForBid, setSelectedInvoiceForBid] = useState<FactoredInvoice | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleAddInvoice = (newInv: FactoredInvoice) => {
    setInvoices((prev) => [newInv, ...prev]);
    showToast(`Invoice ${newInv.invoiceNumber} listed successfully! Investors can now place advance bids.`);
  };

  const handlePlaceBid = (invoiceId: string, bidAmount: number, discountPercent: number) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invoiceId) return inv;
        const newBid = {
          id: `bid-${Date.now()}`,
          investorId: 'current-investor',
          investorName: 'My Portfolio Fund',
          bidAmount,
          offeredDiscountPercent: discountPercent,
          timestamp: 'Just now',
        };
        return {
          ...inv,
          bids: [newBid, ...inv.bids],
          discountRatePercent: discountPercent,
          status: 'in_auction',
        };
      }),
    );
    showToast(`Placed bid of $${bidAmount.toLocaleString()} at ${discountPercent}% discount rate!`);
  };

  const handleCollect = (invoiceId: string) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invoiceId) return inv;
        return {
          ...inv,
          status: 'collected',
          collectedAt: new Date().toISOString().split('T')[0],
        };
      }),
    );
    showToast('Payment successfully collected from corporate debtor via banking rail!');
  };

  const handleToggleInsurance = (invoiceId: string) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invoiceId) return inv;
        const nextIns = !inv.hasInsurance;
        return {
          ...inv,
          hasInsurance: nextIns,
          advanceAmount: nextIns
            ? inv.advanceAmount - inv.faceValue * 0.008
            : inv.advanceAmount + inv.faceValue * 0.008,
        };
      }),
    );
    showToast('Updated default insurance policy coverage.');
  };

  const totalAdvanceAvailable = invoices
    .filter((i) => i.status === 'in_auction' || i.status === 'verified')
    .reduce((sum, i) => sum + i.advanceAmount, 0);

  const filteredInvoices = invoices.filter((i) => {
    if (activeTab === 'my_invoices' && i.issuerId !== 'current-user') {
      // For demo, show invoices or newly added ones
    }
    if (filterStatus !== 'all' && i.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.debtorName.toLowerCase().includes(q) ||
        i.commodity.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <span className="text-emerald-400">✓</span>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header & Listing CTA */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
            Trade Receivables & Cash Flow Financing
          </span>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white mt-1">
            Invoice Factoring Platform
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Farmers and traders sell verified unpaid commercial invoices to investors for immediate cash flow.
            Investors earn short-term yield backed by multinational buyers.
          </p>
        </div>

        <button
          onClick={() => setIsListingOpen(true)}
          className="self-start md:self-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 transition flex items-center gap-2"
        >
          <span>📄</span> List New Invoice
        </button>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500">Available Advance Capital</span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            ${(totalAdvanceAvailable / 1_000).toFixed(0)}k
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 inline-block">
            Across active listings
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500">Average Advance Ratio</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            89.4%
          </p>
          <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 inline-block">
            Immediate payout
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500">Average Turnaround</span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            &lt; 5 Hours
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 inline-block">
            vs 60 days standard wait
          </span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <span className="text-xs font-medium text-slate-500">Default Protection</span>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            100%
          </p>
          <span className="text-[11px] text-indigo-600 font-semibold mt-0.5 inline-block">
            With credit insurance
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex gap-2">
          {[
            { key: 'marketplace', label: 'Factoring Marketplace' },
            { key: 'my_invoices', label: 'My Listed Invoices' },
            { key: 'analytics', label: 'Factoring Analytics' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === tab.key
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab !== 'analytics' && (
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search by buyer, ID, commodity..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-full sm:w-64"
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold"
            >
              <option value="all">All Statuses</option>
              <option value="in_auction">In Auction</option>
              <option value="verified">Verified</option>
              <option value="funded">Funded</option>
              <option value="collected">Collected</option>
            </select>
          </div>
        )}
      </div>

      {/* Content Rendering */}
      {activeTab === 'analytics' ? (
        <FactoringAnalyticsView />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredInvoices.map((inv) => (
            <InvoiceCard
              key={inv.id}
              invoice={inv}
              onOpenBid={(i) => setSelectedInvoiceForBid(i)}
              onCollect={handleCollect}
              onToggleInsurance={handleToggleInsurance}
            />
          ))}
        </div>
      )}

      {/* Listing Modal */}
      <InvoiceListingModal
        isOpen={isListingOpen}
        onClose={() => setIsListingOpen(false)}
        onAddInvoice={handleAddInvoice}
      />

      {/* Auction Bid Modal */}
      {selectedInvoiceForBid && (
        <FactoringAuctionModal
          invoice={selectedInvoiceForBid}
          isOpen={!!selectedInvoiceForBid}
          onClose={() => setSelectedInvoiceForBid(null)}
          onPlaceBid={handlePlaceBid}
        />
      )}
    </div>
  );
};
