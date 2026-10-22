# Visual regression testing

Agri-Fi uses Playwright's Chromium screenshot assertions for visual regression
coverage of the Help Center and login page on desktop and mobile viewports.
Tests honor reduced-motion preferences, use a fixed locale/time zone, disable
screenshot animations, and wait for visible page content before comparing
screenshots.

## Run and update baselines

Run from `frontend/`:

```sh
pnpm test:visual
```

On the first run, or after an intentional design change, create or update
tracked baselines with:

```sh
pnpm test:visual:update
```

Review every changed PNG in `tests/visual-baselines/` before committing it.
Regenerate baselines in the same Linux/Chromium environment used by CI to avoid
operating-system font and rendering differences. Do not update snapshots merely
to make an unexplained visual difference pass.

The suite is configured in `playwright.visual.config.ts`; add named scenarios
in `tests/visual-regression.spec.ts` and keep network-dependent content
deterministic with Playwright route mocks. The screenshot tolerance is
`maxDiffPixelRatio: 0.01`; adjust it only when a measured rendering issue
justifies the change.

## CI, reports, and analytics

`.github/workflows/visual-regression.yml` runs on pull requests that change
frontend files, every Monday at 08:00 UTC, and on manual dispatch. Playwright
HTML reports include expected, actual, and diff images when screenshots fail.
Workflow artifacts retain the HTML report, comparison images, and Playwright
JSON results for 30 days.

The workflow summary reports first-attempt passes, tests that passed after
retry, failures, skips, pass rate, and flake rate. The JSON result artifact
provides run-level data for comparing those rates across scheduled and pull
request runs.

## Interpreting failures

Treat a screenshot diff as a review request, not an automatic design defect.
Inspect the Playwright HTML report and compare the expected, actual, and
side-by-side diff images. If the change is intentional, update the relevant
baseline and include the updated screenshot with the UI change. If it is
unexpected, fix the UI and keep the baseline unchanged. A test that passes only
after retry is reported as flaky and should be investigated rather than hidden
by repeated baseline updates.
