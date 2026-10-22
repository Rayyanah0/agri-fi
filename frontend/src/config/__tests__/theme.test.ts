import {
  DEFAULT_THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  THEME_VARIANT_STORAGE_KEY,
  customAccentPatch,
  customBrandPatch,
  deriveDarkTriplet,
  formatHsl,
  isHslTriplet,
  normalizeThemePreferences,
  parseHsl,
  readableForeground,
  resolveVariant,
} from "@/config/theme";

describe("theme configuration (#1170)", () => {
  describe("parseHsl / formatHsl", () => {
    it("parses an HSL triplet", () => {
      expect(parseHsl("142 50% 24%")).toEqual({ h: 142, s: 50, l: 24 });
    });

    it("tolerates surrounding whitespace", () => {
      expect(parseHsl("  142 50% 24%  ")).toEqual({ h: 142, s: 50, l: 24 });
    });

    it("returns null for a malformed triplet", () => {
      expect(parseHsl("hsl(142, 50%, 24%)")).toBeNull();
      expect(parseHsl("")).toBeNull();
    });

    it("round-trips a triplet", () => {
      expect(formatHsl(parseHsl("142 50% 24%")!)).toBe("142 50% 24%");
    });
  });

  describe("isHslTriplet", () => {
    it("accepts valid triplets", () => {
      expect(isHslTriplet("0 0% 100%")).toBe(true);
      expect(isHslTriplet("240 80.5% 12%")).toBe(true);
    });

    it("rejects invalid triplets", () => {
      expect(isHslTriplet("142 50 24")).toBe(false);
      expect(isHslTriplet("#16a34a")).toBe(false);
    });
  });

  describe("resolveVariant", () => {
    it("follows the OS preference for the system variant", () => {
      expect(resolveVariant("system", true)).toBe("dark");
      expect(resolveVariant("system", false)).toBe("light");
    });

    it("returns explicit variants unchanged", () => {
      expect(resolveVariant("dark", true)).toBe("dark");
      expect(resolveVariant("light", true)).toBe("light");
      expect(resolveVariant("high-contrast", false)).toBe("high-contrast");
    });
  });

  describe("normalizeThemePreferences", () => {
    it("falls back to the defaults for a non-object payload", () => {
      expect(normalizeThemePreferences(null)).toEqual(DEFAULT_THEME_PREFERENCES);
      expect(normalizeThemePreferences("nope")).toEqual(DEFAULT_THEME_PREFERENCES);
    });

    it("keeps valid values", () => {
      const normalized = normalizeThemePreferences({
        variant: "dark",
        accent: "teal",
        fontSize: "large",
        contrast: "high",
      });
      expect(normalized.variant).toBe("dark");
      expect(normalized.accent).toBe("teal");
      expect(normalized.fontSize).toBe("large");
      expect(normalized.contrast).toBe("high");
    });

    it("discards values outside the allow-lists", () => {
      const normalized = normalizeThemePreferences({
        variant: "neon",
        accent: "chartreuse",
        fontSize: "gigantic",
        contrast: "extreme",
      });
      expect(normalized.variant).toBe(DEFAULT_THEME_PREFERENCES.variant);
      expect(normalized.accent).toBe(DEFAULT_THEME_PREFERENCES.accent);
      expect(normalized.fontSize).toBe(DEFAULT_THEME_PREFERENCES.fontSize);
      expect(normalized.contrast).toBe(DEFAULT_THEME_PREFERENCES.contrast);
    });

    it("discards malformed custom colours", () => {
      const normalized = normalizeThemePreferences({
        customBrandColor: "not-a-colour",
        customAccentColor: "38 88% 40%",
      });
      expect(normalized.customBrandColor).toBeNull();
      expect(normalized.customAccentColor).toBe("38 88% 40%");
    });

    it("preserves the updatedAt timestamp", () => {
      const normalized = normalizeThemePreferences({
        updatedAt: "2026-01-15T10:30:00.000Z",
      });
      expect(normalized.updatedAt).toBe("2026-01-15T10:30:00.000Z");
    });
  });

  describe("deriveDarkTriplet", () => {
    it("lifts the lightness of a dark colour", () => {
      const dark = deriveDarkTriplet("142 50% 24%")!;
      expect(parseHsl(dark)!.l).toBeGreaterThan(24);
    });

    it("lowers the lightness of a light colour", () => {
      const dark = deriveDarkTriplet("142 50% 80%")!;
      expect(parseHsl(dark)!.l).toBeLessThan(80);
    });

    it("keeps hue and saturation", () => {
      const dark = parseHsl(deriveDarkTriplet("142 50% 24%")!)!;
      expect(dark.h).toBe(142);
      expect(dark.s).toBe(50);
    });

    it("returns null for a malformed triplet", () => {
      expect(deriveDarkTriplet("nope")).toBeNull();
    });
  });

  describe("readableForeground", () => {
    it("returns a light foreground for a dark background", () => {
      expect(readableForeground("142 50% 24%")).toBe("0 0% 100%");
    });

    it("returns a dark foreground for a light background", () => {
      expect(readableForeground("142 50% 90%")).toBe("0 0% 8%");
    });

    it("falls back to white for a malformed triplet", () => {
      expect(readableForeground("nope")).toBe("0 0% 100%");
    });
  });

  describe("custom colour patches", () => {
    it("builds a complete brand patch", () => {
      const patch = customBrandPatch("142 50% 24%");
      expect(patch.customBrandColor).toBe("142 50% 24%");
      expect(patch.customBrandColorDark).not.toBeNull();
      expect(patch.customBrandFg).toBe("0 0% 100%");
      expect(patch.customBrandFgDark).not.toBeNull();
    });

    it("clears every derived field when the colour is removed", () => {
      expect(customBrandPatch(null)).toEqual({
        customBrandColor: null,
        customBrandColorDark: null,
        customBrandFg: null,
        customBrandFgDark: null,
      });
      expect(customAccentPatch(null)).toEqual({
        customAccentColor: null,
        customAccentColorDark: null,
        customAccentFg: null,
        customAccentFgDark: null,
      });
    });

    it("builds a complete accent patch", () => {
      const patch = customAccentPatch("38 88% 20%");
      expect(patch.customAccentColor).toBe("38 88% 20%");
      expect(patch.customAccentColorDark).not.toBeNull();
      expect(patch.customAccentFg).toBe("0 0% 100%");
    });

    it("picks a dark foreground for a mid-tone accent colour", () => {
      // Amber at 40% lightness is bright enough to take dark text.
      expect(customAccentPatch("38 88% 40%").customAccentFg).toBe("0 0% 8%");
    });
  });

  describe("storage keys", () => {
    it("uses stable, namespaced keys", () => {
      expect(THEME_STORAGE_KEY).toBe("agri-fi-theme-preferences");
      expect(THEME_VARIANT_STORAGE_KEY).toBe("agri-fi-theme-variant");
    });
  });
});
