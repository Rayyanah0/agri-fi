/* eslint-disable */
/**
 * Theme bootstrap — issue #1170.
 *
 * Runs synchronously in <head> before the first paint so the persisted
 * appearance preferences (accent palette, font scale, contrast level and
 * custom colours) are applied without a flash of the default theme.
 *
 * The colour *scheme* class (light / dark / high-contrast) is handled by
 * next-themes, which injects its own script for that purpose. This script
 * only mirrors the data attributes and inline custom properties.
 *
 * Keep this file in sync with `src/config/theme.ts` — the storage key and the
 * custom property names must match.
 */
(function () {
  var STORAGE_KEY = "agri-fi-theme-preferences";

  var DEFAULTS = {
    variant: "system",
    accent: "emerald",
    fontSize: "medium",
    contrast: "normal",
  };

  var VARIANTS = ["light", "dark", "high-contrast", "system"];
  var ACCENTS = [
    "emerald",
    "teal",
    "blue",
    "indigo",
    "violet",
    "amber",
    "rose",
    "slate",
  ];
  var FONT_SIZES = ["small", "medium", "large", "extra-large"];
  var CONTRASTS = ["normal", "high", "extra-high"];

  function pick(value, allowed, fallback) {
    return allowed.indexOf(value) !== -1 ? value : fallback;
  }

  function read() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULTS;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return DEFAULTS;
      return {
        variant: pick(parsed.variant, VARIANTS, DEFAULTS.variant),
        accent: pick(parsed.accent, ACCENTS, DEFAULTS.accent),
        fontSize: pick(parsed.fontSize, FONT_SIZES, DEFAULTS.fontSize),
        contrast: pick(parsed.contrast, CONTRASTS, DEFAULTS.contrast),
        customBrandColor: parsed.customBrandColor || null,
        customBrandColorDark: parsed.customBrandColorDark || null,
        customBrandFg: parsed.customBrandFg || null,
        customBrandFgDark: parsed.customBrandFgDark || null,
        customAccentColor: parsed.customAccentColor || null,
        customAccentColorDark: parsed.customAccentColorDark || null,
        customAccentFg: parsed.customAccentFg || null,
        customAccentFgDark: parsed.customAccentFgDark || null,
      };
    } catch (e) {
      return DEFAULTS;
    }
  }

  function apply() {
    var prefs = read();
    var root = document.documentElement;

    root.setAttribute("data-theme-variant", prefs.variant);
    root.setAttribute("data-accent", prefs.accent);
    root.setAttribute("data-font-size", prefs.fontSize);
    root.setAttribute("data-contrast", prefs.contrast);

    var vars = {
      "--brand-override": prefs.customBrandColor,
      "--brand-override-dark": prefs.customBrandColorDark,
      "--brand-fg-override": prefs.customBrandFg,
      "--brand-fg-override-dark": prefs.customBrandFgDark,
      "--accent-override": prefs.customAccentColor,
      "--accent-override-dark": prefs.customAccentColorDark,
      "--accent-fg-override": prefs.customAccentFg,
      "--accent-fg-override-dark": prefs.customAccentFgDark,
    };

    for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        if (vars[name]) {
          root.style.setProperty(name, vars[name]);
        } else {
          root.style.removeProperty(name);
        }
      }
    }
  }

  if (document.readyState === "loading") {
    // The <html> element already exists while the parser is inside <head>,
    // so the attributes can be applied immediately (before first paint) and
    // re-applied once the document is fully parsed.
    apply();
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
