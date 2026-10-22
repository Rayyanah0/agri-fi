"use client";

import React, { useState } from "react";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

interface MobileQuickDealModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileQuickDealModal: React.FC<MobileQuickDealModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { trigger } = useHapticFeedback();
  const [crop, setCrop] = useState("Cocoa (Grade A)");
  const [quantityMt, setQuantityMt] = useState("");
  const [askingPriceUsd, setAskingPriceUsd] = useState("");
  const [capturedPhotoName, setCapturedPhotoName] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCapturedPhotoName(file.name);
      trigger("light");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    trigger("medium");

    setTimeout(() => {
      setIsSubmitting(false);
      setSuccessNotice(true);
      trigger("success");

      setTimeout(() => {
        setSuccessNotice(false);
        setQuantityMt("");
        setAskingPriceUsd("");
        setCapturedPhotoName(null);
        onClose();
      }, 1500);
    }, 600);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-deal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌾</span>
            <h2
              id="quick-deal-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              Quick Field Deal Entry
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {successNotice ? (
          <div className="py-8 text-center space-y-2">
            <span className="text-4xl">✅</span>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Deal Created & Queued for Synchronization!
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="quick-crop"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Crop
              </label>
              <select
                id="quick-crop"
                value={crop}
                onChange={(e) => setCrop(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
              >
                <option value="Cocoa (Grade A)">Cocoa (Grade A)</option>
                <option value="Arabica Coffee">Arabica Coffee</option>
                <option value="Hard Red Wheat">Hard Red Wheat</option>
                <option value="Yellow Corn No. 2">Yellow Corn No. 2</option>
                <option value="Non-GMO Soybeans">Non-GMO Soybeans</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="quick-qty"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Quantity (MT)
                </label>
                <input
                  id="quick-qty"
                  type="number"
                  step="any"
                  value={quantityMt}
                  onChange={(e) => setQuantityMt(e.target.value)}
                  placeholder="e.g. 50"
                  className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="quick-price"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Target (USD/MT)
                </label>
                <input
                  id="quick-price"
                  type="number"
                  step="any"
                  value={askingPriceUsd}
                  onChange={(e) => setAskingPriceUsd(e.target.value)}
                  placeholder="e.g. 8200"
                  className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            {/* Document / Warehouse Photo with direct Camera capture */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Field Photo / Warehouse Receipt
              </label>
              <label
                htmlFor="camera-upload"
                className="flex items-center justify-center gap-2 w-full min-h-[48px] rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 text-xs text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-slate-100"
              >
                <span>📷</span>
                <span>
                  {capturedPhotoName ?? "Take photo or attach document"}
                </span>
                <input
                  id="camera-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 min-h-[48px] rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 active:scale-95 disabled:opacity-50"
              >
                {isSubmitting ? "Posting..." : "Post Deal"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
