import fc from 'fast-check';
import { splitRatio } from './split-ratio';

describe('splitRatio', () => {
  it('splits 100 stroops 98/2', () => {
    const [farmer, platform] = splitRatio(100, [0.98, 0.02]);
    expect(farmer + platform).toBe(100);
    expect(farmer).toBeGreaterThanOrEqual(0);
    expect(platform).toBeGreaterThanOrEqual(0);
  });

  it('all shares sum to total (property test)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 5 }),
        (total, rawRatios) => {
          const s = rawRatios.reduce((a, b) => a + b, 0);
          if (s < 1e-9) return true; // skip degenerate
          const ratios = rawRatios.map((r) => r / s); // normalise to sum=1
          const shares = splitRatio(total, ratios);
          const sharesSum = shares.reduce((a, b) => a + b, 0);
          return sharesSum === total && shares.every((x) => x >= 0);
        },
      ),
    );
  });

  it('throws on empty ratios', () => {
    expect(() => splitRatio(100, [])).toThrow();
  });

  it('throws on negative ratio', () => {
    expect(() => splitRatio(100, [1.5, -0.5])).toThrow();
  });
});
