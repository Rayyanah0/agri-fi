import { render, screen, act } from "@testing-library/react";
import { useThemePreferences } from "@/components/theme/ThemeProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import {
  DEFAULT_THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreferences,
} from "@/config/theme";

/**
 * Renders the theme context and exposes its value to the test.
 */
function Probe({ onReady }: { onReady: (value: ReturnType<typeof useThemePreferences>) => void }) {
  const value = useThemePreferences();
  onReady(value);
  return (
    <div
      data-testid="probe"
      data-variant={value.preferences.variant}
      data-accent={value.preferences.accent}
      data-font-size={value.preferences.fontSize}
      data-contrast={value.preferences.contrast}
      data-scheme={value.resolvedScheme}
    />
  );
}

function renderTheme() {
  const state: { current: ReturnType<typeof useThemePreferences> | null } = {
    current: null,
  };
  const utils = render(
    <ThemeProvider>
      <Probe onReady={(value) => (state.current = value)} />
    </ThemeProvider>,
  );
  return { ...utils, state };
}

describe("ThemeProvider (#1170)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme-variant");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("data-font-size");
    document.documentElement.removeAttribute("data-contrast");
    vi.mocked(global.fetch).mockReset();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);
  });

  it("provides the default preferences on first render", () => {
    const { state } = renderTheme();
    expect(state.current).not.toBeNull();
    expect(state.current!.preferences.variant).toBe(
      DEFAULT_THEME_PREFERENCES.variant,
    );
    expect(state.current!.preferences.accent).toBe(
      DEFAULT_THEME_PREFERENCES.accent,
    );
  });

  it("mirrors the preferences onto the html element", async () => {
    const { state } = renderTheme();

    await act(async () => {
      state.current!.setVariant("dark");
    });

    expect(document.documentElement.getAttribute("data-theme-variant")).toBe(
      "dark",
    );
    expect(document.documentElement.getAttribute("data-accent")).toBe(
      DEFAULT_THEME_PREFERENCES.accent,
    );
    expect(document.documentElement.getAttribute("data-font-size")).toBe(
      DEFAULT_THEME_PREFERENCES.fontSize,
    );
    expect(document.documentElement.getAttribute("data-contrast")).toBe(
      DEFAULT_THEME_PREFERENCES.contrast,
    );
  });

  it("persists the preferences to localStorage", async () => {
    const { state } = renderTheme();

    await act(async () => {
      state.current!.setAccent("violet");
    });

    const stored = JSON.parse(
      window.localStorage.getItem(THEME_STORAGE_KEY) ?? "{}",
    ) as ThemePreferences;
    expect(stored.accent).toBe("violet");
    expect(typeof stored.updatedAt).toBe("string");
  });

  it("applies the custom colours as inline custom properties", async () => {
    const { state } = renderTheme();

    await act(async () => {
      state.current!.setCustomBrandColor("142 50% 24%");
    });

    expect(
      document.documentElement.style.getPropertyValue("--brand-override"),
    ).toBe("142 50% 24%");
    expect(
      document.documentElement.style.getPropertyValue("--brand-override-dark"),
    ).not.toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--brand-fg-override"),
    ).toBe("0 0% 100%");
  });

  it("removes the custom property when the custom colour is cleared", async () => {
    const { state } = renderTheme();

    await act(async () => {
      state.current!.setCustomBrandColor("142 50% 24%");
    });
    await act(async () => {
      state.current!.setCustomBrandColor(null);
    });

    expect(
      document.documentElement.style.getPropertyValue("--brand-override"),
    ).toBe("");
  });

  it("does not persist a previewed theme until it is committed", async () => {
    const { state } = renderTheme();
    const committed = state.current!.preferences;

    await act(async () => {
      state.current!.startPreview({ ...committed, accent: "rose" });
    });

    expect(state.current!.isPreviewing).toBe(true);
    expect(state.current!.preferences.accent).toBe(committed.accent);
    expect(
      JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? "{}")
        ?.accent ?? committed.accent,
    ).toBe(committed.accent);

    await act(async () => {
      state.current!.commitPreview();
    });

    expect(state.current!.isPreviewing).toBe(false);
    expect(state.current!.preferences.accent).toBe("rose");
  });

  it("discards a preview when it is cancelled", async () => {
    const { state } = renderTheme();
    const committed = state.current!.preferences;

    await act(async () => {
      state.current!.startPreview({ ...committed, accent: "rose" });
    });
    await act(async () => {
      state.current!.cancelPreview();
    });

    expect(state.current!.isPreviewing).toBe(false);
    expect(state.current!.preferences.accent).toBe(committed.accent);
  });

  it("resets every preference back to the defaults", async () => {
    const { state } = renderTheme();

    await act(async () => {
      state.current!.setVariant("dark");
      state.current!.setAccent("blue");
      state.current!.setFontSize("large");
    });
    await act(async () => {
      state.current!.resetTheme();
    });

    expect(state.current!.preferences.variant).toBe(
      DEFAULT_THEME_PREFERENCES.variant,
    );
    expect(state.current!.preferences.accent).toBe(
      DEFAULT_THEME_PREFERENCES.accent,
    );
    expect(state.current!.preferences.fontSize).toBe(
      DEFAULT_THEME_PREFERENCES.fontSize,
    );
  });

  it("pushes the preferences to the profile on demand", async () => {
    const { state } = renderTheme();

    await act(async () => {
      state.current!.setAccent("teal");
    });
    await act(async () => {
      await state.current!.syncNow();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/users/me",
      expect.objectContaining({ method: "PATCH" }),
    );
    const patchCall = vi
      .mocked(global.fetch)
      .mock.calls.find(
        ([, options]) => (options as RequestInit)?.method === "PATCH",
      );
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body.themePreferences.accent).toBe("teal");
    expect(state.current!.syncStatus).toBe("synced");
  });

  it("reports an offline sync status when the request fails", async () => {
    const { state } = renderTheme();

    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await state.current!.syncNow();
    });

    expect(state.current!.syncStatus).toBe("offline");
  });

  it("renders its children", () => {
    render(
      <ThemeProvider>
        <span>child content</span>
      </ThemeProvider>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });
});
