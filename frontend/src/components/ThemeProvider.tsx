"use client";

/**
 * Backwards-compatible entry point for the theme provider.
 *
 * The implementation lives in `src/components/theme/ThemeProvider.tsx` since
 * issue #1170 introduced a dedicated theme directory. This re-export keeps
 * existing imports (`@/components/ThemeProvider`) working.
 */

export {
  ThemeProvider,
  useThemePreferences,
  themeScopeAttributes,
  THEME_SCHEME_CLASSES,
} from "./theme/ThemeProvider";

export type {
  ThemeContextValue,
  ThemeProviderProps,
  ThemeScheme,
  ThemeSyncStatus,
} from "./theme/ThemeProvider";
