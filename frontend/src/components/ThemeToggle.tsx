"use client";

/**
 * Theme toggle — issue #1170.
 *
 * Cycles through the available colour schemes (light → dark → high contrast →
 * system) and exposes a settings button that opens the full appearance
 * panel.
 */

import { useEffect, useRef, useState } from "react";
import { useThemePreferences } from "@/components/theme/ThemeProvider";
import { THEME_VARIANTS, type ThemeVariant } from "@/config/theme";

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M12 3.5v2.25M12 18.25v2.25M4.75 12H2.5M21.5 12h-2.25M6.1 6.1 4.5 4.5M19.5 19.5l-1.6-1.6M17.9 6.1l1.6-1.6M4.5 19.5l1.6-1.6M12 16.2A4.2 4.2 0 1 0 12 7.8a4.2 4.2 0 0 0 0 8.4Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M20.25 14.1A8.5 8.5 0 0 1 9.9 3.75a8.75 8.75 0 1 0 10.35 10.35Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ContrastIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3.75a8.25 8.25 0 0 1 0 16.5Z" fill="currentColor" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <rect x="3" y="4.5" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 20.25h6M12 16.5v3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

const VARIANT_LABELS: Record<ThemeVariant, string> = {
  light: "Light",
  dark: "Dark",
  "high-contrast": "High contrast",
  system: "System",
};

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { preferences, resolvedScheme, setVariant } = useThemePreferences();
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Cycle: light → dark → high-contrast → system → light
  const cycle = () => {
    const current = preferences.variant;
    const index = THEME_VARIANTS.indexOf(current);
    const next = THEME_VARIANTS[(index + 1) % THEME_VARIANTS.length];
    setVariant(next);
  };

  const icon = () => {
    if (!mounted) {
      return <span className="h-4 w-4 rounded-full border border-current/30 opacity-60" aria-hidden="true" />;
    }
    if (resolvedScheme === "high-contrast") {
      return <ContrastIcon />;
    }
    if (resolvedScheme === "dark") {
      return <MoonIcon />;
    }
    if (preferences.variant === "system") {
      return <MonitorIcon />;
    }
    return <SunIcon />;
  };

  const label = mounted
    ? `${VARIANT_LABELS[preferences.variant]} theme — switch theme`
    : "Theme toggle";

  return (
    <div ref={liveRef} className="flex items-center gap-2">
      <button
        type="button"
        onClick={cycle}
        aria-label={label}
        title={mounted ? VARIANT_LABELS[preferences.variant] : undefined}
        aria-pressed={mounted ? resolvedScheme === "dark" : undefined}
        disabled={!mounted}
        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface/90 text-foreground shadow-card backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 dark:backdrop-blur"
      >
        <span className="relative flex h-4 w-4 items-center justify-center">{icon()}</span>
      </button>
    </div>
  );
}

export default ThemeToggle;
