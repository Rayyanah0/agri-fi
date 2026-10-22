"use client";

/**
 * Isolated theme preview — issue #1170.
 *
 * Renders a miniature of the application chrome (canvas, card, buttons, text)
 * using an arbitrary set of theme preferences. The preview is rendered inside
 * a `.theme-scope` element so the candidate theme does not leak into the rest
 * of the page (see `globals.css`).
 */

import { themeScopeAttributes } from "./ThemeProvider";
import type { ThemePreferences } from "@/config/theme";

export interface ThemePreviewProps {
  /** Candidate preferences to render. */
  preferences: ThemePreferences;
  /** Whether the OS prefers dark — used to resolve the `system` variant. */
  systemPrefersDark: boolean;
  /** Optional accessible label for the preview region. */
  label?: string;
}

export function ThemePreview({
  preferences,
  systemPrefersDark,
  label = "Theme preview",
}: ThemePreviewProps) {
  const { className, style, ...dataAttributes } = themeScopeAttributes(
    preferences,
    systemPrefersDark,
  );

  return (
    <div
      className={`${className} overflow-hidden rounded-2xl border border-border shadow-card`}
      style={style}
      {...dataAttributes}
      role="img"
      aria-label={label}
      data-testid="theme-preview"
    >
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-secondary" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral" aria-hidden="true" />
        <span className="ml-2 h-2 w-16 rounded-full bg-neutral-muted" aria-hidden="true" />
      </div>
      <div className="space-y-3 bg-canvas p-3">
        <div className="rounded-xl border border-border bg-surface p-3 shadow-card">
          <div className="mb-2 h-2.5 w-2/5 rounded-full bg-foreground/80" aria-hidden="true" />
          <div className="mb-1.5 h-2 w-full rounded-full bg-muted-foreground/40" aria-hidden="true" />
          <div className="h-2 w-4/5 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          <div className="mt-3 flex gap-2">
            <span className="rounded-lg bg-primary px-2.5 py-1 text-[0.65rem] font-semibold text-primary-foreground">
              Invest
            </span>
            <span className="rounded-lg border border-border bg-surface px-2.5 py-1 text-[0.65rem] font-semibold text-foreground">
              Details
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 rounded-xl border border-border bg-surface p-3">
            <div className="mb-1.5 h-2 w-1/3 rounded-full bg-foreground/70" aria-hidden="true" />
            <div className="h-2 w-2/3 rounded-full bg-muted-foreground/35" aria-hidden="true" />
          </div>
          <div className="flex-1 rounded-xl border border-border bg-surface p-3">
            <div className="mb-1.5 h-2 w-1/3 rounded-full bg-foreground/70" aria-hidden="true" />
            <div className="h-2 w-1/2 rounded-full bg-muted-foreground/35" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThemePreview;
