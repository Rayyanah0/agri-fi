'use client';

import React, { useState } from 'react';
import {
  FactoredInvoice,
  deriveCreditRating,
  calculateDiscountFee,
  calculateNetAdvance,
} from '@/lib/invoice-factoring';

interface InvoiceListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddInvoice: (invoice: FactoredInvoice) => void;
}

export const InvoiceListingModal: React.FC<InvoiceListingModalProps> = ({
  isOpen,
  onClose,
  onAddInvoice,
}) => {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [debtorName, setDebtorName] = useState('');
  const [commodity, setCommodity] = useState('');
  const [faceValue, setFaceValue] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [hasInsurance, setHasInsurance] = useState(true);

  if (!isOpen) return null;

  const numFaceValue = parseFloat(faceValue) || 0;
  const daysToMaturity = dueDate
    ? Math.max(1, Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 45;

  const simulatedCreditScore = 760;
  const creditRating = deriveCreditRating(simulatedCreditScore);
  const discountRate = 5.0;
  const advancePercent = 90;
  const discountFee = calculateDiscountFee(numFaceValue, discountRate, daysToMaturity);
  const netAdvance = calculateNetAdvance(numFaceValue, advancePercent, discountFee, hasInsurance);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNumber || !debtorName || numFaceValue <= 0 || !dueDate) return;

    const newInvoice: FactoredInvoice = {
      id: `inv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      invoiceNumber,
      issuerId: 'current-user',
      issuerName: 'My Cooperative / Trader Account',
      debtorName,
      commodity: commodity || 'Agricultural Produce',
      faceValue: numFaceValue,
      issueDate: new Date().toISOString().split('T')[0],
      dueDate,
      daysToMaturity,
      status: 'in_auction',
      creditScore: simulatedCreditScore,
      creditRating,
      discountRatePercent: discountRate,
      immediateAdvancePercent: advancePercent,
      advanceAmount: netAdvance,
      discountFee,
      isVerified: true,
      verificationDetails: {
        commercialDocVerified: true,
        debtorConfirmed: true,
        deliveryBillVerified: true,
        antiFraudScore: 96,
      },
      hasInsurance,
      insuranceFeePercent: 0.8,
      bids: [],
    };

    onAddInvoice(newInvoice);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 my-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              List Invoice for Factoring
            </h3>
            <p className="text-xs text-slate-500">
              Get immediate cash advance against your confirmed unpaid buyer invoices
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Invoice Reference / ID
            </label>
            <input
              type="text"
              required
              placeholder="e.g. INV-2026-COCOA-901"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Buyer / Corporate Debtor
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Barry Callebaut / Olam"
                value={debtorName}
                onChange={(e) => setDebtorName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Commodity / Produce
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Dry Maize, Coffee"
                value={commodity}
                onChange={(e) => setCommodity(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Total Face Value (USD)
              </label>
              <input
                type="number"
                step="any"
                min="100"
                required
                placeholder="50000"
                value={faceValue}
                onChange={(e) => setFaceValue(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Payment Due Date
              </label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl">
            <input
              type="checkbox"
              id="insuranceCheck"
              checked={hasInsurance}
              onChange={(e) => setHasInsurance(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
            />
            <label htmlFor="insuranceCheck" className="text-slate-700 dark:text-slate-300 cursor-pointer">
              <span className="font-bold text-emerald-800 dark:text-emerald-300 block">
                Enable Credit Default Insurance (+0.8%)
              </span>
              <span className="text-[11px] text-slate-500">
                Guarantees 100% repayment in case of buyer insolvency or default
              </span>
            </label>
          </div>

          {numFaceValue > 0 && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Immediate Advance Ratio:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{advancePercent}%</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Estimated Factoring Discount Fee:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">${discountFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Credit Default Insurance Premium:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  ${hasInsurance ? (numFaceValue * 0.008).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                <span>Estimated Net Cash Out Today:</span>
                <span>${netAdvance.toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-lg shadow-emerald-600/20 transition"
            >
              Submit for Factoring
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
