# Theme System Documentation

> Issue **#1170** — user-selectable appearance (colour scheme, brand colours, text
> size, contrast) with cross-device synchronisation.

## Overview

The theme system lets every user choose how AgriFi looks. It covers four
independent knobs:

| Knob | Values | Notes |
| --- | --- | --- |
| Colour scheme | `light`, `dark`, `high-contrast`, `system` | `system` follows `prefers-color-scheme` |
| Brand / accent palette | `emerald`, `teal`, `blue`, `indigo`, `violet`, `amber`, `rose`, `slate` | plus optional custom brand and accent colours |
| Text size | `small`, `medium`, `large`, `extra-large` | scales the root font size |
| Contrast | `normal`, `high`, `extra-high` | increases border/text separation |

Every choice is stored locally, applied without a flash of the default theme,
and — for signed-in users — synchronised to the user profile so the appearance
follows the user to any device.

## Architecture

```
public/theme-bootstrap.js      no-flash restore of the stored preferences
        │
        ▼
src/config/theme.ts             single source of truth (allow-lists, helpers)
        │
        ▼
src/components/theme/
  ThemeProvider.tsx             owns the state, writes <html> attributes
  ThemeSettingsPanel.tsx        the settings UI
  ThemePreview.tsx              isolated preview scope
        │
        ▼
src/app/globals.css             resolves the attributes into CSS variables
```

### Responsibilities split

* **`next-themes`** owns the *scheme class* on `<html>` (`light` / `dark` /
  `high-contrast`). It already ships a blocking inline script that restores the
  class before the first paint and reacts to OS-level changes.
* **The theme provider** owns everything else: the accent palette, the text
  scale, the contrast level and the custom colours. It mirrors those values
  onto `<html>` as data attributes and inline custom properties.
* **`globals.css`** turns the attributes into the semantic tokens every
  component consumes.

This split keeps `next-themes` small and lets the CSS stay declarative: a
component never needs to know which palette is active.

## The preference object

```ts
interface ThemePreferences {
  variant: "light" | "dark" | "high-contrast" | "system";
  accent: "emerald" | "teal" | "blue" | "indigo" | "violet" | "amber" | "rose" | "slate";
  fontSize: "small" | "medium" | "large" | "extra-large";
  contrast: "normal" | "high" | "extra-high";
  customBrandColor?: string | null;      // "H S% L%"
  customBrandColorDark?: string | null;  // derived
  customBrandFg?: string | null;         // derived (WCAG)
  customBrandFgDark?: string | null;     // derived (WCAG)
  customAccentColor?: string | null;
  customAccentColorDark?: string | null;
  customAccentFg?: string | null;
  customAccentFgDark?: string | null;
  updatedAt?: string;                    // ISO timestamp, used for sync conflicts
}
```

Colours are stored as **HSL channel triplets** (`"142 50% 24%"`), never as
`hsl(...)` wrappers, because Tailwind consumes them through
`hsl(var(--color-primary) / <alpha-value>)`.

## Persistence

| Store | Key | Purpose |
| --- | --- | --- |
| `localStorage` | `agri-fi-theme-preferences` | the full preference object |
| `localStorage` | `agri-fi-theme-variant` | the scheme class, managed by `next-themes` |
| User profile | `themePreferences` | cross-device synchronisation |

`normalizeThemePreferences()` validates every value against the allow-lists
before it is used, so a corrupted or outdated payload can never break the
render.

### No flash of the default theme

`public/theme-bootstrap.js` is loaded synchronously in `<head>`. It reads
`agri-fi-theme-preferences` and writes the data attributes plus the inline
custom properties onto `<html>` **before the first paint**. The React provider
then takes over and keeps them in sync.

Because the script is plain ES5-compatible JavaScript it needs no build step
and no framework runtime.

## Cross-device synchronisation

1. On mount the provider issues `GET /api/users/me` and reads
   `themePreferences` from the profile.
2. If the remote `updatedAt` is **newer** than the locally stored one, the
   remote values win and are written to `localStorage`.
3. The user can trigger a push at any time with **Sync across devices**,
   which issues `PATCH /api/users/me` with `{ "themePreferences": … }`.
4. The status is surfaced to the user (`idle` / `syncing` / `synced` /
   `error` / `offline`).

### Backend

| Endpoint | Purpose |
| --- | --- |
| `GET /users/me` | returns the profile, including `themePreferences` |
| `PATCH /users/me` | persists `themePreferences` (and `preferredCurrency`) |

The payload is validated with `UpdateUserPreferencesDto`:

* `variant`, `accent`, `fontSize` and `contrast` must be one of the
  allow-listed values;
* every custom colour must match the `H S% L%` pattern;
* `updatedAt` must be an ISO 8601 timestamp.

The value is stored in a `jsonb` column (`users.theme_preferences`) so new
appearance knobs do not require another migration.

## Preview mode

The settings panel lets the user try a combination before committing it:

* **Start preview** applies a candidate set of preferences to the live page.
* The isolated `ThemePreview` card renders the same candidate inside a
  `.theme-scope` container, which re-composes the tokens so the preview does
  not inherit the live theme.
* **Apply preview** persists the candidate; **Cancel preview** restores the
  committed preferences.

## CSS contract

The provider writes these attributes onto `<html>`:

| Attribute | Values |
| --- | --- |
| `data-theme-variant` | `light` / `dark` / `high-contrast` / `system` |
| `data-accent` | the palette identifier |
| `data-font-size` | `small` / `medium` / `large` / `extra-large` |
| `data-contrast` | `normal` / `high` / `extra-high` |

and these inline custom properties:

| Property | Meaning |
| --- | --- |
| `--brand-override`, `--brand-override-dark` | custom brand colour per scheme |
| `--brand-fg-override`, `--brand-fg-override-dark` | readable foreground |
| `--accent-override`, `--accent-override-dark` | custom accent colour per scheme |
| `--accent-fg-override`, `--accent-fg-override-dark` | readable foreground |

The selectors are deliberately scopeable — `.dark`, `.high-contrast`,
`[data-accent]`, `[data-contrast]`, `[data-font-size]` — so the same rules can
be re-declared inside `.theme-scope` to build an isolated preview.

## Accessibility

* Every control is a real `<button>` with `aria-pressed` reflecting the
  current selection.
* Colour swatches carry an `aria-label` so the palette is not communicated by
  colour alone.
* The `high-contrast` scheme raises the contrast of borders, muted text and
  focus rings.
* `prefers-contrast: more` is honoured in addition to the explicit setting.
* `prefers-reduced-transparency` removes the translucent surfaces.
* `forced-colors` (Windows high contrast) keeps the layout legible.
* Custom colours automatically get a readable foreground, calculated with the
  WCAG relative-luminance formula.

## Usage

```tsx
"use client";

import { useThemePreferences } from "@/components/theme/ThemeProvider";

function AccentBadge() {
  const { preferences, setAccent } = useThemePreferences();

  return (
    <button type="button" onClick={() => setAccent("violet")}>
      {preferences.accent}
    </button>
  );
}
```

The full settings panel is available on **Settings → Appearance**:

```tsx
import { ThemeSettingsPanel } from "@/components/theme/ThemeSettingsPanel";

<ThemeSettingsPanel />;
```

## Tests

```bash
cd frontend
npx vitest run src/config/__tests__/theme.test.ts \
                 src/components/theme/__tests__/ThemeProvider.test.tsx \
                 src/components/theme/__tests__/ThemeSettingsPanel.test.tsx
```

```bash
cd backend
npx jest src/users/theme-preferences.service.spec.ts
```

## Adding a new option

1. Add the value to the allow-list in `src/config/theme.ts`.
2. Add the matching selector to `src/app/globals.css`.
3. Mirror it in the backend DTO (`backend/src/users/dto/update-user-preferences.dto.ts`).
4. Add the translation to every catalogue in `frontend/src/messages/`.
5. Extend `normalizeThemePreferences()` so the new field is validated.
