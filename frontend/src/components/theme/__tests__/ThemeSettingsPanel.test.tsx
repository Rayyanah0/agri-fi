import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeSettingsPanel } from "@/components/theme/ThemeSettingsPanel";
import { THEME_STORAGE_KEY } from "@/config/theme";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

function renderPanel() {
  return render(
    <ThemeProvider>
      <ThemeSettingsPanel />
    </ThemeProvider>,
  );
}

describe("ThemeSettingsPanel (#1170)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(global.fetch).mockReset();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);
  });

  it("renders every appearance control", () => {
    renderPanel();

    expect(screen.getByTestId("theme-settings-panel")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "scheme.label" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "accent.label" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "fontSize.label" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "contrast.label" })).toBeInTheDocument();
  });

  it("changes the colour scheme and persists it", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "scheme.dark" }));

    expect(
      document.documentElement.getAttribute("data-theme-variant"),
    ).toBe("dark");
    const stored = JSON.parse(
      window.localStorage.getItem(THEME_STORAGE_KEY) ?? "{}",
    );
    expect(stored.variant).toBe("dark");
  });

  it("marks the selected scheme as pressed", async () => {
    const user = userEvent.setup();
    renderPanel();

    const dark = screen.getByRole("button", { name: "scheme.dark" });
    await user.click(dark);

    expect(dark).toHaveAttribute("aria-pressed", "true");
  });

  it("changes the font size", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "fontSize.large" }));

    expect(document.documentElement.getAttribute("data-font-size")).toBe("large");
  });

  it("changes the contrast level", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "contrast.high" }));

    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
  });

  it("selects an accent palette", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "accent.violet" }));

    expect(document.documentElement.getAttribute("data-accent")).toBe("violet");
  });

  it("ignores a malformed custom colour", async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByRole("textbox", { name: "accent.customBrand" });
    await user.type(input, "not-a-colour");
    await user.click(
      screen.getByRole("button", { name: "accent.customBrand: accent.apply" }),
    );

    expect(
      document.documentElement.style.getPropertyValue("--brand-override"),
    ).toBe("");
  });

  it("applies a valid custom brand colour", async () => {
    const user = userEvent.setup();
    renderPanel();

    const input = screen.getByRole("textbox", { name: "accent.customBrand" });
    await user.clear(input);
    await user.type(input, "142 50% 24%");
    await user.click(
      screen.getByRole("button", { name: "accent.customBrand: accent.apply" }),
    );

    expect(
      document.documentElement.style.getPropertyValue("--brand-override"),
    ).toBe("142 50% 24%");
  });

  it("shows the sync status", () => {
    renderPanel();
    expect(screen.getByTestId("theme-sync-status")).toHaveTextContent(
      "sync.idle",
    );
  });

  it("resets the theme to the defaults", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "scheme.dark" }));
    await user.click(screen.getByRole("button", { name: "actions.reset" }));

    expect(document.documentElement.getAttribute("data-theme-variant")).toBe(
      "system",
    );
  });

  it("syncs the preferences to the profile on demand", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "actions.sync" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/users/me",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
