"use client";

/**
 * Theme provider — issue #1170.
 *
 * Responsibilities:
 *  - Owns the persisted `ThemePreferences` (scheme, accent, font size, contrast).
 *  - Mirrors the preferences onto `<html>` as data attributes + inline custom
 *    properties so `globals.css` can resolve the semantic tokens.
 *  - Detects the OS colour-scheme preference and exposes a `system` variant.
 *  - Persists locally (localStorage) and, for signed-in users, syncs to the
 *    backend user profile so the theme follows the user across devices.
 *  - Supports a *preview* mode: a candidate set of preferences can be applied
 *    to the live page (or to an isolated preview scope) before it is committed.
 *
 * The colour scheme itself is delegated to `next-themes`, which writes the
 * `light` / `dark` / `high-contrast` class onto `<html>`, restores it before
 * first paint and reacts to OS-level changes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { authHeader } from "@/lib/auth-token";
import {
  ACCENT_PALETTES,
  DEFAULT_THEME_PREFERENCES,
  THEME_PROFILE_KEY,
  THEME_STORAGE_KEY,
  THEME_VARIANT_STORAGE_KEY,
  customAccentPatch,
  customBrandPatch,
  formatHsl,
  normalizeThemePreferences,
  resolveVariant,
  type AccentColor,
  type ContrastLevel,
  type FontSizeScale,
  type ThemePreferences,
  type ThemeVariant,
} from "@/config/theme";

/** Colour schemes that map onto a `<html>` class. */
export const THEME_SCHEME_CLASSES = ["light", "dark", "high-contrast"] as const;
export type ThemeScheme = (typeof THEME_SCHEME_CLASSES)[number];

export type ThemeSyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

export interface ThemeContextValue {
  /** The committed preferences. */
  preferences: ThemePreferences;
  /** The effective colour scheme after resolving `system`. */
  resolvedScheme: ThemeScheme;
  /** Whether the OS currently prefers a dark colour scheme. */
  systemPrefersDark: boolean;
  /** True while a candidate theme is being previewed. */
  isPreviewing: boolean;
  /** The candidate preferences being previewed (null when not previewing). */
  previewPreferences: ThemePreferences | null;
  /** Status of the cross-device sync. */
  syncStatus: ThemeSyncStatus;
  /** ISO timestamp of the last successful cloud sync. */
  lastSyncedAt: string | null;

  setVariant(variant: ThemeVariant): void;
  setAccent(accent: AccentColor): void;
  setFontSize(fontSize: FontSizeScale): void;
  setContrast(contrast: ContrastLevel): void;
  setCustomBrandColor(triplet: string | null): void;
  setCustomAccentColor(triplet: string | null): void;
  updatePreferences(patch: Partial<ThemePreferences>): void;
  resetTheme(): void;

  /** Apply a candidate set of preferences without persisting them. */
  startPreview(preferences: ThemePreferences): void;
  /** Discard the preview and restore the committed preferences. */
  cancelPreview(): void;
  /** Persist the currently previewed preferences. */
  commitPreview(): void;

  /** Push the committed preferences to the user profile. */
  syncNow(): Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useThemePreferences(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error(
      "useThemePreferences must be used within a ThemeProvider",
    );
  }
  return context;
}

function readStoredPreferences(): ThemePreferences {
  if (typeof window === "undefined") return { ...DEFAULT_THEME_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME_PREFERENCES };
    return normalizeThemePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_THEME_PREFERENCES };
  }
}

function writeStoredPreferences(preferences: ThemePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* Storage may be unavailable (private mode / quota) — the theme still
       applies for the current session. */
  }
}

/**
 * The subset of preferences that is mirrored onto `<html>`. Everything else
 * (custom colour derivatives) is stored but applied through inline custom
 * properties.
 */
function applyAttributes(preferences: ThemePreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  root.setAttribute("data-theme-variant", preferences.variant);
  root.setAttribute("data-accent", preferences.accent);
  root.setAttribute("data-font-size", preferences.fontSize);
  root.setAttribute("data-contrast", preferences.contrast);

  const customBrand = preferences.customBrandColor ?? null;
  const customBrandDark = preferences.customBrandColorDark ?? null;
  const customAccent = preferences.customAccentColor ?? null;
  const customAccentDark = preferences.customAccentColorDark ?? null;

  const setOrRemove = (name: string, value: string | null) => {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  };

  setOrRemove("--brand-override", customBrand);
  setOrRemove("--brand-override-dark", customBrandDark);
  setOrRemove("--brand-fg-override", preferences.customBrandFg ?? null);
  setOrRemove("--brand-fg-override-dark", preferences.customBrandFgDark ?? null);
  setOrRemove("--accent-override", customAccent);
  setOrRemove("--accent-override-dark", customAccentDark);
  setOrRemove("--accent-fg-override", preferences.customAccentFg ?? null);
  setOrRemove("--accent-fg-override-dark", preferences.customAccentFgDark ?? null);
}

function updateThemeColorMeta(scheme: ThemeScheme): void {
  if (typeof document === "undefined") return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const palette: Record<ThemeScheme, string> = {
    light: "#faf9f7",
    dark: "#020617",
    "high-contrast": "#000000",
  };
  meta.setAttribute("content", palette[scheme]);
}

export interface ThemeProviderProps
  extends Omit<ComponentProps<typeof NextThemesProvider>, "children" | "themes"> {
  children: ReactNode;
}

/**
 * Root provider. Mounted once in `src/app/layout.tsx`.
 *
 * The defaults below are the ones the theme system relies on; they can be
 * overridden by the caller (the root layout passes them explicitly so the
 * configuration is visible in one place).
 */
export function ThemeProvider({ children, ...overrides }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      themes={[...THEME_SCHEME_CLASSES]}
      defaultTheme="system"
      enableSystem
      storageKey={THEME_VARIANT_STORAGE_KEY}
      disableTransitionOnChange
      {...overrides}
    >
      <ThemeManager>{children}</ThemeManager>
    </NextThemesProvider>
  );
}

function ThemeManager({ children }: { children: ReactNode }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  // The initial state must be identical on the server and on the client,
  // otherwise hydration mismatches occur. The stored preferences are read in
  // the mount effect below; `public/theme-bootstrap.js` has already applied
  // them to the DOM before the first paint.
  const [preferences, setPreferences] = useState<ThemePreferences>(() => ({
    ...DEFAULT_THEME_PREFERENCES,
  }));
  const [previewPreferences, setPreviewPreferences] =
    useState<ThemePreferences | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [syncStatus, setSyncStatus] = useState<ThemeSyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  // ── System colour-scheme detection ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemPrefersDark(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  // ── Hydrate from localStorage on the client ──────────────────────────────
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = readStoredPreferences();
    setPreferences(stored);
  }, []);

  // ── Keep the next-themes class in sync with the committed variant ───────
  useEffect(() => {
    const target =
      preferences.variant === "system" ? "system" : preferences.variant;
    if (theme !== target) {
      setTheme(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.variant]);

  // ── Apply the active (previewed or committed) preferences to the DOM ────
  const active = previewPreferences ?? preferences;

  useEffect(() => {
    applyAttributes(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active.variant,
    active.accent,
    active.fontSize,
    active.contrast,
    active.customBrandColor,
    active.customBrandColorDark,
    active.customAccentColor,
    active.customAccentColorDark,
  ]);

  const resolvedScheme = useMemo<ThemeScheme>(() => {
    if (previewPreferences) {
      return resolveVariant(
        previewPreferences.variant,
        systemPrefersDark,
      ) as ThemeScheme;
    }
    if (resolvedTheme && (THEME_SCHEME_CLASSES as readonly string[]).includes(resolvedTheme)) {
      return resolvedTheme as ThemeScheme;
    }
    return resolveVariant(preferences.variant, systemPrefersDark);
  }, [
    previewPreferences,
    resolvedTheme,
    preferences.variant,
    systemPrefersDark,
  ]);

  useEffect(() => {
    updateThemeColorMeta(resolvedScheme);
  }, [resolvedScheme]);

  // ── Persist + sync ───────────────────────────────────────────────────────
  const persist = useCallback(
    (next: ThemePreferences) => {
      const stamped: ThemePreferences = {
        ...next,
        updatedAt: new Date().toISOString(),
      };
      setPreferences(stamped);
      writeStoredPreferences(stamped);
      return stamped;
    },
    [],
  );

  const syncNow = useCallback(async () => {
    if (typeof window === "undefined") return;
    setSyncStatus("syncing");
    try {
      const response = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(),
        },
        credentials: "include",
        body: JSON.stringify({
          [THEME_PROFILE_KEY]: preferences,
        }),
      });
      if (!response.ok) {
        setSyncStatus(response.status === 401 ? "offline" : "error");
        return;
      }
      setSyncStatus("synced");
      setLastSyncedAt(new Date().toISOString());
    } catch {
      setSyncStatus("offline");
    }
  }, [preferences]);

  // Pull the theme stored on the user profile so the preference follows the
  // user across devices. Local values win when they are newer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/users/me", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...authHeader(),
          },
          credentials: "include",
        });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as Record<string, unknown>;
        const remote = normalizeThemePreferences(payload?.[THEME_PROFILE_KEY]);
        if (!remote.updatedAt) return;
        const localUpdated = preferences.updatedAt
          ? Date.parse(preferences.updatedAt)
          : 0;
        const remoteUpdated = Date.parse(remote.updatedAt);
        if (Number.isNaN(remoteUpdated)) return;
        if (remoteUpdated > localUpdated) {
          setPreferences(remote);
          writeStoredPreferences(remote);
          setSyncStatus("synced");
          setLastSyncedAt(remote.updatedAt ?? null);
        } else if (localUpdated > 0) {
          setSyncStatus("synced");
        }
      } catch {
        setSyncStatus("offline");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mutators ─────────────────────────────────────────────────────────────
  const updatePreferences = useCallback(
    (patch: Partial<ThemePreferences>) => {
      persist({ ...preferences, ...patch });
    },
    [persist, preferences],
  );

  const setVariant = useCallback(
    (variant: ThemeVariant) => updatePreferences({ variant }),
    [updatePreferences],
  );

  const setAccent = useCallback(
    (accent: AccentColor) => updatePreferences({ accent }),
    [updatePreferences],
  );

  const setFontSize = useCallback(
    (fontSize: FontSizeScale) => updatePreferences({ fontSize }),
    [updatePreferences],
  );

  const setContrast = useCallback(
    (contrast: ContrastLevel) => updatePreferences({ contrast }),
    [updatePreferences],
  );

  const setCustomBrandColor = useCallback(
    (triplet: string | null) => {
      updatePreferences(customBrandPatch(triplet));
    },
    [updatePreferences],
  );

  const setCustomAccentColor = useCallback(
    (triplet: string | null) => {
      updatePreferences(customAccentPatch(triplet));
    },
    [updatePreferences],
  );

  const resetTheme = useCallback(() => {
    persist({
      ...DEFAULT_THEME_PREFERENCES,
      updatedAt: new Date().toISOString(),
    });
  }, [persist]);

  // ── Preview ──────────────────────────────────────────────────────────────
  const startPreview = useCallback((candidate: ThemePreferences) => {
    setPreviewPreferences(candidate);
  }, []);

  const cancelPreview = useCallback(() => {
    setPreviewPreferences(null);
  }, []);

  const commitPreview = useCallback(() => {
    setPreviewPreferences((current) => {
      if (current) {
        persist(current);
      }
      return null;
    });
  }, [persist]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preferences,
      resolvedScheme,
      systemPrefersDark,
      isPreviewing: previewPreferences !== null,
      previewPreferences,
      syncStatus,
      lastSyncedAt,
      setVariant,
      setAccent,
      setFontSize,
      setContrast,
      setCustomBrandColor,
      setCustomAccentColor,
      updatePreferences,
      resetTheme,
      startPreview,
      cancelPreview,
      commitPreview,
      syncNow,
    }),
    [
      preferences,
      resolvedScheme,
      systemPrefersDark,
      previewPreferences,
      syncStatus,
      lastSyncedAt,
      setVariant,
      setAccent,
      setFontSize,
      setContrast,
      setCustomBrandColor,
      setCustomAccentColor,
      updatePreferences,
      resetTheme,
      startPreview,
      cancelPreview,
      commitPreview,
      syncNow,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Builds the class list, data attributes and inline custom properties for an
 * isolated preview scope so a theme can be rendered side-by-side with the live
 * theme.
 */
export function themeScopeAttributes(
  preferences: ThemePreferences,
  systemPrefersDark: boolean,
): {
  className: string;
  style: React.CSSProperties;
  "data-accent": string;
  "data-font-size": string;
  "data-contrast": string;
} {
  const scheme = resolveVariant(preferences.variant, systemPrefersDark);
  const classNames = ["theme-scope"];
  if (scheme === "dark") classNames.push("dark");
  if (scheme === "high-contrast") classNames.push("high-contrast");

  const style: Record<string, string> = {};
  const cssVars = {
    "--brand-override": preferences.customBrandColor ?? null,
    "--brand-override-dark": preferences.customBrandColorDark ?? null,
    "--brand-fg-override": preferences.customBrandFg ?? null,
    "--brand-fg-override-dark": preferences.customBrandFgDark ?? null,
    "--accent-override": preferences.customAccentColor ?? null,
    "--accent-override-dark": preferences.customAccentColorDark ?? null,
    "--accent-fg-override": preferences.customAccentFg ?? null,
    "--accent-fg-override-dark": preferences.customAccentFgDark ?? null,
  } as Record<string, string | null>;

  for (const [name, value] of Object.entries(cssVars)) {
    if (value) style[name] = value;
  }

  return {
    className: classNames.join(" "),
    style: style as React.CSSProperties,
    "data-accent": preferences.accent,
    "data-font-size": preferences.fontSize,
    "data-contrast": preferences.contrast,
  };
}

export { ACCENT_PALETTES, formatHsl };
