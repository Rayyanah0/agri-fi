'use client';

import React, { useState } from 'react';
import { FactoredInvoice } from '@/lib/invoice-factoring';

interface FactoringAuctionModalProps {
  invoice: FactoredInvoice;
  isOpen: boolean;
  onClose: () => void;
  onPlaceBid: (invoiceId: string, bidAmount: number, discountPercent: number) => void;
}

export const FactoringAuctionModal: React.FC<FactoringAuctionModalProps> = ({
  invoice,
  isOpen,
  onClose,
  onPlaceBid,
}) => {
  const [discountPercent, setDiscountPercent] = useState<string>(
    invoice.discountRatePercent.toString(),
  );

  if (!isOpen) return null;

  const numDiscount = parseFloat(discountPercent) || 4.5;
  const days = Math.max(1, invoice.daysToMaturity);
  const discountFee = Math.round(invoice.faceValue * (numDiscount / 100) * (days / 365) * 100) / 100;
  const bidAmount = Math.round((invoice.faceValue * (invoice.immediateAdvancePercent / 100) - discountFee) * 100) / 100;
  const annualizedYield = (numDiscount * 1.15).toFixed(1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (numDiscount <= 0) return;
    onPlaceBid(invoice.id, bidAmount, numDiscount);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Place Factoring Bid
            </h3>
            <p className="text-xs text-slate-500">
              Auction for {invoice.invoiceNumber} · Debtor: {invoice.debtorName}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-1.5 border border-slate-100 dark:border-slate-800">
            <div className="flex justify-between">
              <span className="text-slate-500">Invoice Face Value:</span>
              <span className="font-bold text-slate-900 dark:text-white">${invoice.faceValue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Debtor Credit Rating:</span>
              <span className="font-bold text-indigo-600">{invoice.creditRating} ({invoice.creditScore})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Term to Maturity:</span>
              <span className="font-bold text-slate-900 dark:text-white">{invoice.daysToMaturity} Days</span>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Your Offered Discount Rate (% per annum)
            </label>
            <input
              type="number"
              step="0.1"
              min="1.0"
              max="20.0"
              required
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-base"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Lower discount rates are more attractive to the farmer/trader and win the auction faster.
            </span>
          </div>

          <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl space-y-1.5 border border-emerald-100 dark:border-emerald-900/50">
            <div className="flex justify-between">
              <span className="text-emerald-800 dark:text-emerald-300 font-medium">Your Advance Capital:</span>
              <span className="font-bold text-emerald-950 dark:text-emerald-200">${bidAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-800 dark:text-emerald-300 font-medium">Projected Investor Yield:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{annualizedYield}% Annualized</span>
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold shadow-md transition"
            >
              Confirm Bid
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
