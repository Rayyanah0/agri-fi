"use client";

import React, { useState, useEffect } from "react";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

export const MobileOfflineSyncStatus: React.FC = () => {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const { trigger } = useHapticFeedback();

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      trigger("success");
    };
    const handleOffline = () => {
      setIsOnline(false);
      trigger("warning");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Mock check for pending offline indexedDb/localStorage queue
    const queue = localStorage.getItem("agrifi_offline_queue");
    if (queue) {
      try {
        setPendingSyncCount(JSON.parse(queue).length);
      } catch {}
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [trigger]);

  const handleManualSync = () => {
    if (!isOnline) return;
    setIsSyncing(true);
    trigger("medium");

    setTimeout(() => {
      setPendingSyncCount(0);
      localStorage.removeItem("agrifi_offline_queue");
      setIsSyncing(false);
      trigger("success");
    }, 1200);
  };

  if (isOnline && pendingSyncCount === 0) return null;

  return (
    <div
      role="status"
      className={`px-4 py-2 text-xs flex items-center justify-between transition-colors ${
        !isOnline ? "bg-amber-500 text-white" : "bg-blue-600 text-white"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="animate-pulse">●</span>
        <span>
          {!isOnline
            ? "Offline Mode — Changes will sync when network reconnects"
            : `${pendingSyncCount} offline transaction(s) pending sync`}
        </span>
      </div>

      {isOnline && pendingSyncCount > 0 && (
        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="ml-2 px-2.5 py-1 rounded bg-white/20 hover:bg-white/30 text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
        >
          {isSyncing ? "Syncing..." : "Sync Now"}
        </button>
      )}
    </div>
  );
};
