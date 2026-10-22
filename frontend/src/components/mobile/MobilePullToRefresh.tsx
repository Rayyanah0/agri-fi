"use client";

import React, { useState, useRef, TouchEvent } from "react";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

interface MobilePullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
}

export const MobilePullToRefresh: React.FC<MobilePullToRefreshProps> = ({
  onRefresh,
  children,
}) => {
  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { trigger } = useHapticFeedback();
  const threshold = 70;

  const handleTouchStart = (e: TouchEvent) => {
    if (window.scrollY === 0) {
      setStartY(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (startY === 0 || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - startY);

    if (distance > 0 && window.scrollY === 0) {
      const dampened = Math.min(threshold * 1.5, distance * 0.4);
      setPullDistance(dampened);
      if (dampened >= threshold && pullDistance < threshold) {
        trigger("light");
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      trigger("medium");
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
        setStartY(0);
      }
    } else {
      setPullDistance(0);
      setStartY(0);
    }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative"
    >
      {/* Pull indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="flex items-center justify-center w-full transition-transform text-xs text-slate-500 py-2"
          style={{ height: `${pullDistance}px` }}
        >
          {isRefreshing ? (
            <span className="flex items-center gap-1.5 animate-pulse text-blue-600 font-medium">
              ↻ Updating marketplace feeds...
            </span>
          ) : (
            <span>
              {pullDistance >= threshold
                ? "Release to refresh"
                : "Pull down to refresh"}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
};
