/**
 * Theme system configuration — issue #1170.
 *
 * Single source of truth for every user-selectable appearance knob.
 *
 * The runtime `ThemeProvider` (`src/components/theme/ThemeProvider.tsx`) reads
 * these definitions to build the persisted `ThemePreferences` object and to
 * mirror the selected values onto `<html>` as data attributes. `globals.css`
 * then resolves those attributes into the CSS custom properties that every
 * component consumes.
 *
 * IMPORTANT: colours are expressed as *HSL channel triplets*
 * (`"142 50% 24%"`) because Tailwind consumes them via
 * `hsl(var(--color-primary) / <alpha-value>)`. Do not store `hsl(...)`
 * wrappers here.
 */

export const THEME_VARIANTS = ["light", "dark", "high-contrast", "system"] as const;
export type ThemeVariant = (typeof THEME_VARIANTS)[number];

export const FONT_SIZES = ["small", "medium", "large", "extra-large"] as const;
export type FontSizeScale = (typeof FONT_SIZES)[number];

export const CONTRAST_LEVELS = ["normal", "high", "extra-high"] as const;
export type ContrastLevel = (typeof CONTRAST_LEVELS)[number];

export const ACCENT_COLORS = [
  "emerald",
  "teal",
  "blue",
  "indigo",
  "violet",
  "amber",
  "rose",
  "slate",
] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

/** Root font-size multipliers applied via the `--font-scale` custom property. */
export const FONT_SIZE_SCALE: Record<FontSizeScale, number> = {
  small: 0.9375,
  medium: 1,
  large: 1.0625,
  "extra-large": 1.125,
};

/**
 * Accent palettes. `brand` drives `--color-primary` and `accent` drives
 * `--color-secondary`. Only hue/saturation live here — lightness is resolved
 * per colour scheme in `globals.css` so the same palette reads correctly in
 * both light and dark mode.
 */
export interface AccentPalette {
  brand: { hue: number; saturation: number };
  accent: { hue: number; saturation: number };
  /** Preview swatch colour (hex) used by the settings UI. */
  swatch: string;
}

export const ACCENT_PALETTES: Record<AccentColor, AccentPalette> = {
  emerald: { brand: { hue: 142, saturation: 50 }, accent: { hue: 38, saturation: 88 }, swatch: "#16a34a" },
  teal: { brand: { hue: 173, saturation: 72 }, accent: { hue: 190, saturation: 85 }, swatch: "#0d9488" },
  blue: { brand: { hue: 217, saturation: 72 }, accent: { hue: 199, saturation: 89 }, swatch: "#2563eb" },
  indigo: { brand: { hue: 239, saturation: 62 }, accent: { hue: 258, saturation: 80 }, swatch: "#4f46e5" },
  violet: { brand: { hue: 271, saturation: 58 }, accent: { hue: 292, saturation: 70 }, swatch: "#7c3aed" },
  amber: { brand: { hue: 32, saturation: 88 }, accent: { hue: 12, saturation: 78 }, swatch: "#d97706" },
  rose: { brand: { hue: 347, saturation: 72 }, accent: { hue: 330, saturation: 80 }, swatch: "#e11d48" },
  slate: { brand: { hue: 215, saturation: 25 }, accent: { hue: 199, saturation: 72 }, swatch: "#475569" },
};

/**
 * Persisted, serialisable appearance preferences.
 *
 * `customBrandColor` / `customAccentColor` hold the light-scheme HSL triplet
 * chosen by the user; their dark-scheme counterparts are derived on the fly
 * and cached in `customBrandColorDark` / `customAccentColorDark` so that the
 * no-flash bootstrap script can restore them without recomputing anything.
 */
export interface ThemePreferences {
  /** Base colour scheme. `system` follows `prefers-color-scheme`. */
  variant: ThemeVariant;
  /** Brand/accent palette identifier. */
  accent: AccentColor;
  /** Root font-size scale. */
  fontSize: FontSizeScale;
  /** Contrast tuning level. */
  contrast: ContrastLevel;
  /** Custom brand colour (HSL triplet) overriding the palette in light mode. */
  customBrandColor?: string | null;
  /** Derived dark-scheme counterpart of `customBrandColor`. */
  customBrandColorDark?: string | null;
  /** Readable foreground for `customBrandColor` (light scheme). */
  customBrandFg?: string | null;
  /** Readable foreground for `customBrandColorDark` (dark scheme). */
  customBrandFgDark?: string | null;
  /** Custom accent colour (HSL triplet) overriding the palette in light mode. */
  customAccentColor?: string | null;
  /** Derived dark-scheme counterpart of `customAccentColor`. */
  customAccentColorDark?: string | null;
  /** Readable foreground for `customAccentColor` (light scheme). */
  customAccentFg?: string | null;
  /** Readable foreground for `customAccentColorDark` (dark scheme). */
  customAccentFgDark?: string | null;
  /** Timestamp of the last change, used for cross-device conflict resolution. */
  updatedAt?: string;
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  variant: "system",
  accent: "emerald",
  fontSize: "medium",
  contrast: "normal",
  customBrandColor: null,
  customBrandColorDark: null,
  customBrandFg: null,
  customBrandFgDark: null,
  customAccentColor: null,
  customAccentColorDark: null,
  customAccentFg: null,
  customAccentFgDark: null,
};

/** localStorage key holding the locally cached preferences. */
export const THEME_STORAGE_KEY = "agri-fi-theme-preferences";

/** localStorage key used by next-themes for the resolved colour scheme. */
export const THEME_VARIANT_STORAGE_KEY = "agri-fi-theme-variant";

/** Cross-device sync key inside the user profile payload. */
export const THEME_PROFILE_KEY = "themePreferences";

export function isThemeVariant(value: unknown): value is ThemeVariant {
  return typeof value === "string" && (THEME_VARIANTS as readonly string[]).includes(value);
}

export function isFontSizeScale(value: unknown): value is FontSizeScale {
  return typeof value === "string" && (FONT_SIZES as readonly string[]).includes(value);
}

export function isContrastLevel(value: unknown): value is ContrastLevel {
  return typeof value === "string" && (CONTRAST_LEVELS as readonly string[]).includes(value);
}

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && (ACCENT_COLORS as readonly string[]).includes(value);
}

/** Validates an "H S% L%" triplet, e.g. `"142 50% 24%"`. */
export function isHslTriplet(value: string): boolean {
  return /^\s*(\d{1,3})\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%\s*$/.test(value);
}

/**
 * Accepts an arbitrary payload and coerces it into a valid `ThemePreferences`
 * object, falling back to defaults for unknown/invalid fields. Used both when
 * reading from localStorage and when receiving a profile payload from the API.
 */
export function normalizeThemePreferences(input: unknown): ThemePreferences {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_THEME_PREFERENCES };
  }
  const raw = input as Partial<Record<keyof ThemePreferences, unknown>>;
  const next: ThemePreferences = { ...DEFAULT_THEME_PREFERENCES };

  if (isThemeVariant(raw.variant)) next.variant = raw.variant;
  if (isAccentColor(raw.accent)) next.accent = raw.accent;
  if (isFontSizeScale(raw.fontSize)) next.fontSize = raw.fontSize;
  if (isContrastLevel(raw.contrast)) next.contrast = raw.contrast;

  if (typeof raw.customBrandColor === "string" && isHslTriplet(raw.customBrandColor)) {
    next.customBrandColor = raw.customBrandColor;
  }
  if (typeof raw.customBrandColorDark === "string" && isHslTriplet(raw.customBrandColorDark)) {
    next.customBrandColorDark = raw.customBrandColorDark;
  }
  if (typeof raw.customBrandFg === "string" && isHslTriplet(raw.customBrandFg)) {
    next.customBrandFg = raw.customBrandFg;
  }
  if (typeof raw.customBrandFgDark === "string" && isHslTriplet(raw.customBrandFgDark)) {
    next.customBrandFgDark = raw.customBrandFgDark;
  }
  if (typeof raw.customAccentColor === "string" && isHslTriplet(raw.customAccentColor)) {
    next.customAccentColor = raw.customAccentColor;
  }
  if (typeof raw.customAccentColorDark === "string" && isHslTriplet(raw.customAccentColorDark)) {
    next.customAccentColorDark = raw.customAccentColorDark;
  }
  if (typeof raw.customAccentFg === "string" && isHslTriplet(raw.customAccentFg)) {
    next.customAccentFg = raw.customAccentFg;
  }
  if (typeof raw.customAccentFgDark === "string" && isHslTriplet(raw.customAccentFgDark)) {
    next.customAccentFgDark = raw.customAccentFgDark;
  }
  if (typeof raw.updatedAt === "string") {
    next.updatedAt = raw.updatedAt;
  }
  return next;
}

/**
 * Resolves the *effective* colour scheme for a variant, taking the OS
 * preference into account when the variant is `system`.
 */
export function resolveVariant(
  variant: ThemeVariant,
  systemPrefersDark: boolean,
): "light" | "dark" | "high-contrast" {
  if (variant === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return variant;
}

/** Parsed representation of an HSL triplet. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function parseHsl(triplet: string): Hsl | null {
  const match = /^\s*(\d{1,3})\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%\s*$/.exec(triplet);
  if (!match) return null;
  return {
    h: Number(match[1]),
    s: Number(match[2]),
    l: Number(match[3]),
  };
}

export function formatHsl({ h, s, l }: Hsl): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}

/**
 * Derives a dark-scheme counterpart of a light-scheme HSL triplet by lifting
 * the lightness so the colour keeps its contrast against a dark canvas.
 */
export function deriveDarkTriplet(triplet: string): string | null {
  const hsl = parseHsl(triplet);
  if (!hsl) return null;
  const lightness = hsl.l > 55 ? Math.max(40, hsl.l - 15) : Math.min(72, hsl.l + 28);
  return formatHsl({ h: hsl.h, s: hsl.s, l: lightness });
}

/**
 * Computes a readable foreground colour for a given background triplet using
 * the WCAG relative-luminance formula. Returns a near-black or near-white HSL
 * triplet so the result can be stored next to the colour it belongs to.
 */
export function readableForeground(triplet: string): string {
  const hsl = parseHsl(triplet);
  if (!hsl) return "0 0% 100%";
  const s = hsl.s / 100;
  const l = hsl.l / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hsl.h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const luminance = 0.2126 * (r + m) + 0.7152 * (g + m) + 0.0722 * (b + m);
  return luminance > 0.45 ? "0 0% 8%" : "0 0% 100%";
}

/** The preference fields written by a custom brand colour. */
export interface CustomBrandPatch {
  customBrandColor: string | null;
  customBrandColorDark: string | null;
  customBrandFg: string | null;
  customBrandFgDark: string | null;
}

/** The preference fields written by a custom accent colour. */
export interface CustomAccentPatch {
  customAccentColor: string | null;
  customAccentColorDark: string | null;
  customAccentFg: string | null;
  customAccentFgDark: string | null;
}

/**
 * Builds the full preference patch for a custom brand colour, including the
 * derived dark-scheme counterpart and both readable foregrounds.
 */
export function customBrandPatch(triplet: string | null): CustomBrandPatch {
  if (!triplet) {
    return {
      customBrandColor: null,
      customBrandColorDark: null,
      customBrandFg: null,
      customBrandFgDark: null,
    };
  }
  const dark = deriveDarkTriplet(triplet);
  return {
    customBrandColor: triplet,
    customBrandColorDark: dark,
    customBrandFg: readableForeground(triplet),
    customBrandFgDark: dark ? readableForeground(dark) : null,
  };
}

/** Builds the full preference patch for a custom accent colour. */
export function customAccentPatch(triplet: string | null): CustomAccentPatch {
  if (!triplet) {
    return {
      customAccentColor: null,
      customAccentColorDark: null,
      customAccentFg: null,
      customAccentFgDark: null,
    };
  }
  const dark = deriveDarkTriplet(triplet);
  return {
    customAccentColor: triplet,
    customAccentColorDark: dark,
    customAccentFg: readableForeground(triplet),
    customAccentFgDark: dark ? readableForeground(dark) : null,
  };
}
