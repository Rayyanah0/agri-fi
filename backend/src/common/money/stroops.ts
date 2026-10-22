/** 1 XLM = 10_000_000 stroops */
export const STROOPS_PER_XLM = 10_000_000;

/** Convert a decimal XLM amount to integer stroops (floor). */
export function toStroops(xlm: number): number {
  return Math.floor(xlm * STROOPS_PER_XLM);
}

/** Convert integer stroops back to XLM. */
export function fromStroops(stroops: number): number {
  return stroops / STROOPS_PER_XLM;
}
