"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

interface MobileBottomNavProps {
  onOpenQuickDeal?: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  onOpenQuickDeal,
}) => {
  const pathname = usePathname();
  const { trigger } = useHapticFeedback();

  const handleNavClick = () => {
    trigger("selection");
  };

  const handleActionClick = () => {
    trigger("medium");
    onOpenQuickDeal?.();
  };

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      return (
        pathname.startsWith("/dashboard") &&
        !pathname.includes("/kanban") &&
        !pathname.includes("/calls")
      );
    }
    return pathname.startsWith(path);
  };

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {/* Dashboard */}
        <Link
          href="/dashboard"
          onClick={handleNavClick}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1 transition-colors ${
            isActive("/dashboard")
              ? "text-blue-600 dark:text-blue-400 font-semibold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-900"
          }`}
          aria-label="Home Dashboard"
        >
          <svg
            className="w-5 h-5 mb-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <span className="text-[10px] tracking-tight">Home</span>
        </Link>

        {/* Marketplace */}
        <Link
          href="/marketplace"
          onClick={handleNavClick}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1 transition-colors ${
            isActive("/marketplace")
              ? "text-blue-600 dark:text-blue-400 font-semibold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-900"
          }`}
          aria-label="Marketplace Deals"
        >
          <svg
            className="w-5 h-5 mb-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span className="text-[10px] tracking-tight">Deals</span>
        </Link>

        {/* Center Quick Action (Create Deal) */}
        <button
          type="button"
          onClick={handleActionClick}
          className="flex flex-col items-center justify-center -mt-5 min-w-[52px] min-h-[52px] w-13 h-13 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-95 transition-transform"
          aria-label="Quick Action: Create Deal"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>

        {/* Market Pricing */}
        <Link
          href="/market"
          onClick={handleNavClick}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1 transition-colors ${
            isActive("/market")
              ? "text-blue-600 dark:text-blue-400 font-semibold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-900"
          }`}
          aria-label="Commodity Prices"
        >
          <svg
            className="w-5 h-5 mb-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
          <span className="text-[10px] tracking-tight">Prices</span>
        </Link>

        {/* Profile */}
        <Link
          href="/profile"
          onClick={handleNavClick}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1 transition-colors ${
            isActive("/profile")
              ? "text-blue-600 dark:text-blue-400 font-semibold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-900"
          }`}
          aria-label="User Profile"
        >
          <svg
            className="w-5 h-5 mb-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span className="text-[10px] tracking-tight">Profile</span>
        </Link>
      </div>
    </nav>
  );
};
