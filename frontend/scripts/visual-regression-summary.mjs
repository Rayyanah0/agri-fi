import { appendFile, readFile } from 'node:fs/promises';

const reportPath = 'visual-test-results/results.json';
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const { expected, unexpected, flaky, skipped } = report.stats ?? {};

if (
  !Number.isInteger(expected) ||
  !Number.isInteger(unexpected) ||
  !Number.isInteger(flaky) ||
  !Number.isInteger(skipped)
) {
  throw new Error(`Playwright JSON report at ${reportPath} has no valid stats.`);
}

const executed = expected + unexpected + flaky;
const passRate = executed === 0 ? 0 : ((expected + flaky) / executed) * 100;
const flakeRate = executed === 0 ? 0 : (flaky / executed) * 100;
const summary = [
  '## Visual regression test analytics',
  '',
  '| Passed on first attempt | Passed after retry (flaky) | Failed | Skipped | Pass rate | Flake rate |',
  '| ---: | ---: | ---: | ---: | ---: | ---: |',
  `| ${expected} | ${flaky} | ${unexpected} | ${skipped} | ${passRate.toFixed(1)}% | ${flakeRate.toFixed(1)}% |`,
  '',
  `Full Playwright JSON report: \`${reportPath}\` (retained as a workflow artifact).`,
].join('\n');

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
