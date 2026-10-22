'use client';

import React from 'react';
import { FactoredInvoice } from '@/lib/invoice-factoring';

interface InvoiceCardProps {
  invoice: FactoredInvoice;
  onOpenBid: (invoice: FactoredInvoice) => void;
  onCollect: (invoiceId: string) => void;
  onToggleInsurance: (invoiceId: string) => void;
}

export const InvoiceCard: React.FC<InvoiceCardProps> = ({
  invoice,
  onOpenBid,
  onCollect,
  onToggleInsurance,
}) => {
  const isAuctionOpen = invoice.status === 'in_auction' || invoice.status === 'verified';
  const isFunded = invoice.status === 'funded';
  const isCollected = invoice.status === 'collected';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg transition-all flex flex-col justify-between">
      <div>
        {/* Top Header: ID & Status */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-white text-base">
                {invoice.invoiceNumber}
              </span>
              {invoice.isVerified && (
                <span className="inline-flex items-center text-emerald-600 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900/50">
                  ✓ Verified
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{invoice.issuerName}</p>
          </div>

          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
              invoice.status === 'collected'
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                : invoice.status === 'funded'
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                  : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {invoice.status.replace('_', ' ')}
          </span>
        </div>

        {/* Debtor & Produce Details */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl mb-4 text-xs space-y-1.5 border border-slate-100 dark:border-slate-800">
          <div className="flex justify-between">
            <span className="text-slate-500">Corporate Debtor:</span>
            <span className="font-semibold text-slate-900 dark:text-white">{invoice.debtorName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Commodity:</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">{invoice.commodity}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Buyer Credit Rating:</span>
            <span className="font-bold text-xs px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600">
              {invoice.creditRating} (Score {invoice.creditScore})
            </span>
          </div>
        </div>

        {/* Financial Metrics */}
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
          <div>
            <span className="text-slate-500 block">Invoice Face Value</span>
            <span className="text-lg font-black text-slate-900 dark:text-white">
              ${invoice.faceValue.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Immediate Advance</span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
              ${invoice.advanceAmount.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 block">({invoice.immediateAdvancePercent}% cash out)</span>
          </div>
          <div>
            <span className="text-slate-500 block">Days to Maturity</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {invoice.daysToMaturity} Days (Due {invoice.dueDate})
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Discount Rate</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">
              {invoice.discountRatePercent}% p.a.
            </span>
          </div>
        </div>

        {/* Insurance status toggle */}
        <div className="flex justify-between items-center py-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs mb-3">
          <div className="flex items-center gap-1.5">
            <span>🛡️</span>
            <span className="text-slate-600 dark:text-slate-400">Default Insurance:</span>
            <span className={`font-semibold ${invoice.hasInsurance ? 'text-emerald-600' : 'text-slate-400'}`}>
              {invoice.hasInsurance ? 'Active (0.8%)' : 'None'}
            </span>
          </div>
          <button
            onClick={() => onToggleInsurance(invoice.id)}
            className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 underline"
          >
            {invoice.hasInsurance ? 'Remove' : 'Add Cover'}
          </button>
        </div>

        {/* Active Bids Preview */}
        {invoice.bids.length > 0 && (
          <div className="text-xs text-slate-500 mb-3">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Auction Bids ({invoice.bids.length}):
            </span>
            <div className="mt-1 space-y-1">
              {invoice.bids.slice(0, 2).map((bid) => (
                <div key={bid.id} className="flex justify-between text-[11px]">
                  <span>{bid.investorName}</span>
                  <span className="font-bold text-emerald-600">
                    ${bid.bidAmount.toLocaleString()} ({bid.offeredDiscountPercent}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex gap-2">
        {isAuctionOpen && (
          <button
            onClick={() => onOpenBid(invoice)}
            className="flex-1 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            Bid / Fund Advance
          </button>
        )}
        {isFunded && (
          <button
            onClick={() => onCollect(invoice.id)}
            className="flex-1 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
          >
            Collect Payment from Buyer
          </button>
        )}
        {isCollected && (
          <div className="w-full text-center py-1.5 text-xs font-bold text-slate-400">
            ✓ Fully Settled on {invoice.collectedAt}
          </div>
        )}
      </div>
    </div>
  );
};
