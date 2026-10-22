/**
 * Splits `total` (integer, e.g. stroops) among recipients according to
 * `ratios` (array of fractions that must sum to 1.0).
 *
 * Uses floor for each share; the remainder (dust) is added to the LAST
 * recipient so the invariant sum(shares) === total always holds.
 *
 * @throws if ratios is empty or any ratio < 0 or sum of ratios !== ~1.0
 */
export function splitRatio(total: number, ratios: number[]): number[] {
  if (ratios.length === 0) throw new Error('splitRatio: ratios must not be empty');
  for (const r of ratios) {
    if (r < 0) throw new Error('splitRatio: all ratios must be >= 0');
  }
  const sum = ratios.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 1e-9) {
    throw new Error(`splitRatio: ratios must sum to 1.0, got ${sum}`);
  }

  const shares = ratios.map((r) => Math.floor(total * r));
  const distributed = shares.reduce((a, b) => a + b, 0);
  // Add remainder to last recipient
  shares[shares.length - 1] += total - distributed;
  return shares;
}
