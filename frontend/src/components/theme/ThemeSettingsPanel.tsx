"use client";

/**
 * Appearance settings panel — issue #1170.
 *
 * Exposes every appearance knob:
 *  - colour scheme (light / dark / high contrast / system)
 *  - brand + accent palette (plus custom colours)
 *  - font size (small / medium / large / extra-large)
 *  - contrast (normal / high / extra-high)
 *
 * Changes are staged locally and can be previewed on the live page before
 * they are committed. Committed preferences are persisted locally and synced
 * to the user profile so they follow the user across devices.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ThemePreview } from "./ThemePreview";
import { useThemePreferences } from "./ThemeProvider";
import {
  ACCENT_COLORS,
  ACCENT_PALETTES,
  CONTRAST_LEVELS,
  DEFAULT_THEME_PREFERENCES,
  FONT_SIZES,
  THEME_VARIANTS,
  customAccentPatch,
  customBrandPatch,
  formatHsl,
  isHslTriplet,
  parseHsl,
  type AccentColor,
  type ContrastLevel,
  type FontSizeScale,
  type ThemePreferences,
  type ThemeVariant,
} from "@/config/theme";

interface ThemeSettingsPanelProps {
  /** Render the panel inline (settings page) or inside a modal. */
  className?: string;
}

const VARIANT_ICON: Record<ThemeVariant, string> = {
  light: "☀",
  dark: "☾",
  "high-contrast": "◐",
  system: "🖥",
};

export function ThemeSettingsPanel({ className = "" }: ThemeSettingsPanelProps) {
  const t = useTranslations("theme");
  const {
    preferences,
    systemPrefersDark,
    isPreviewing,
    previewPreferences,
    syncStatus,
    lastSyncedAt,
    updatePreferences,
    resetTheme,
    startPreview,
    cancelPreview,
    commitPreview,
    syncNow,
  } = useThemePreferences();

  const [brandInput, setBrandInput] = useState(
    preferences.customBrandColor ?? "",
  );
  const [accentInput, setAccentInput] = useState(
    preferences.customAccentColor ?? "",
  );

  const staged = useMemo<ThemePreferences>(
    () => previewPreferences ?? preferences,
    [previewPreferences, preferences],
  );

  const stage = useCallback(
    (patch: Partial<ThemePreferences>) => {
      const next = { ...staged, ...patch };
      if (isPreviewing) {
        startPreview(next);
      } else {
        updatePreferences(patch);
      }
    },
    [staged, isPreviewing, startPreview, updatePreferences],
  );

  const commit = useCallback(() => {
    if (isPreviewing) {
      commitPreview();
    }
  }, [isPreviewing, commitPreview]);

  const cancel = useCallback(() => {
    if (isPreviewing) {
      cancelPreview();
    }
  }, [isPreviewing, cancelPreview]);

  const reset = useCallback(() => {
    if (isPreviewing) {
      startPreview({ ...DEFAULT_THEME_PREFERENCES });
      return;
    }
    resetTheme();
  }, [isPreviewing, resetTheme, startPreview]);

  const applyCustomBrand = () => {
    const value = brandInput.trim();
    if (!value) {
      stage(customBrandPatch(null));
      return;
    }
    if (!isHslTriplet(value)) return;
    stage(customBrandPatch(formatHsl(parseHsl(value)!)));
  };

  const applyCustomAccent = () => {
    const value = accentInput.trim();
    if (!value) {
      stage(customAccentPatch(null));
      return;
    }
    if (!isHslTriplet(value)) return;
    stage(customAccentPatch(formatHsl(parseHsl(value)!)));
  };

  const syncLabel = {
    idle: t("sync.idle"),
    syncing: t("sync.syncing"),
    synced: t("sync.synced"),
    error: t("sync.error"),
    offline: t("sync.offline"),
  }[syncStatus];

  return (
    <section
      className={`space-y-6 ${className}`}
      aria-label={t("title")}
      data-testid="theme-settings-panel"
    >
      <header>
        <h2 className="section-title">{t("title")}</h2>
        <p className="muted mt-1">{t("description")}</p>
      </header>

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t("preview.title")}</h3>
        <ThemePreview
          preferences={staged}
          systemPrefersDark={systemPrefersDark}
          label={t("preview.label")}
        />
        <p className="text-xs text-muted-foreground">{t("preview.hint")}</p>
      </div>

      {/* ── Colour scheme ───────────────────────────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-foreground">
          {t("scheme.label")}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_VARIANTS.map((variant) => (
            <button
              key={variant}
              type="button"
              onClick={() => stage({ variant })}
              aria-pressed={staged.variant === variant}
              className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                staged.variant === variant
                  ? "border-primary bg-primary-muted text-primary"
                  : "border-border bg-surface text-foreground hover:bg-neutral-muted"
              }`}
            >
              <span aria-hidden="true" className="text-lg">
                {VARIANT_ICON[variant]}
              </span>
              {t(`scheme.${variant}`)}
            </button>
          ))}
        </div>
        {staged.variant === "system" ? (
          <p className="text-xs text-muted-foreground">
            {systemPrefersDark ? t("scheme.systemDark") : t("scheme.systemLight")}
          </p>
        ) : null}
      </fieldset>

      {/* ── Accent palette ──────────────────────────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-foreground">
          {t("accent.label")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((accent: AccentColor) => (
            <button
              key={accent}
              type="button"
              onClick={() => stage({ accent })}
              aria-pressed={staged.accent === accent}
              aria-label={t(`accent.${accent}`)}
              title={t(`accent.${accent}`)}
              className={`h-9 w-9 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                staged.accent === accent
                  ? "border-foreground scale-110"
                  : "border-border hover:scale-105"
              }`}
              style={{ backgroundColor: ACCENT_PALETTES[accent].swatch }}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            {t("accent.customBrand")}
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={brandInput}
                onChange={(event) => setBrandInput(event.target.value)}
                onBlur={applyCustomBrand}
                placeholder="142 50% 24%"
                aria-label={t("accent.customBrand")}
                className="input text-xs"
              />
              <button
                type="button"
                onClick={applyCustomBrand}
                aria-label={`${t("accent.customBrand")}: ${t("accent.apply")}`}
                className="btn-secondary btn-sm"
              >
                {t("accent.apply")}
              </button>
            </div>
          </label>
          <label className="block text-xs text-muted-foreground">
            {t("accent.customAccent")}
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={accentInput}
                onChange={(event) => setAccentInput(event.target.value)}
                onBlur={applyCustomAccent}
                placeholder="38 88% 40%"
                aria-label={t("accent.customAccent")}
                className="input text-xs"
              />
              <button
                type="button"
                onClick={applyCustomAccent}
                aria-label={`${t("accent.customAccent")}: ${t("accent.apply")}`}
                className="btn-secondary btn-sm"
              >
                {t("accent.apply")}
              </button>
            </div>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("accent.hint")}</p>
      </fieldset>

      {/* ── Font size ───────────────────────────────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-foreground">
          {t("fontSize.label")}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FONT_SIZES.map((size: FontSizeScale) => (
            <button
              key={size}
              type="button"
              onClick={() => stage({ fontSize: size })}
              aria-pressed={staged.fontSize === size}
              className={`rounded-xl border px-3 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                staged.fontSize === size
                  ? "border-primary bg-primary-muted text-primary"
                  : "border-border bg-surface text-foreground hover:bg-neutral-muted"
              }`}
              style={{
                fontSize:
                  size === "small"
                    ? "0.8125rem"
                    : size === "medium"
                      ? "0.9375rem"
                      : size === "large"
                        ? "1.0625rem"
                        : "1.1875rem",
              }}
            >
              {t(`fontSize.${size}`)}
            </button>
          ))}
        </div>
      </fieldset>

      {/* ── Contrast ────────────────────────────────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-foreground">
          {t("contrast.label")}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CONTRAST_LEVELS.map((level: ContrastLevel) => (
            <button
              key={level}
              type="button"
              onClick={() => stage({ contrast: level })}
              aria-pressed={staged.contrast === level}
              className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                staged.contrast === level
                  ? "border-primary bg-primary-muted text-primary"
                  : "border-border bg-surface text-foreground hover:bg-neutral-muted"
              }`}
            >
              {t(`contrast.${level}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("contrast.hint")}</p>
      </fieldset>

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button type="button" onClick={reset} className="btn-secondary btn-sm">
          {t("actions.reset")}
        </button>
        <button
          type="button"
          onClick={() => void syncNow()}
          className="btn-secondary btn-sm"
          disabled={syncStatus === "syncing"}
        >
          {t("actions.sync")}
        </button>
        {isPreviewing ? (
          <>
            <button type="button" onClick={cancel} className="btn-ghost btn-sm">
              {t("actions.cancelPreview")}
            </button>
            <button type="button" onClick={commit} className="btn-primary btn-sm">
              {t("actions.applyPreview")}
            </button>
          </>
        ) : null}
        <span
          className="ml-auto text-xs text-muted-foreground"
          aria-live="polite"
          data-testid="theme-sync-status"
        >
          {syncLabel}
          {lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleString()}` : ""}
        </span>
      </div>
    </section>
  );
}

export default ThemeSettingsPanel;
