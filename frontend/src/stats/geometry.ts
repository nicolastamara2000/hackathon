import type { XY } from "../feed/types";

/** Pitch: 120 x 80 units = 105 x 68 m. */
export const toM = (dx: number, dy: number) => Math.hypot((dx * 105) / 120, (dy * 68) / 80);
export const goalDist = ([x, y]: XY) => toM(120 - x, 40 - y);

/**
 * Expected threat of holding the ball at (x, y), own frame. A smooth stand-in for
 * the 12 x 8 xT grid: about 0.12 at the penalty spot, 0.02 at 30 m, ~0.005 at halfway.
 */
export function xT(p: XY): number {
  const d = goalDist(p);
  const [x, y] = p;
  const central = 1 - Math.min(1, Math.abs(y - 40) / 40) * 0.35;
  return 0.004 + 0.42 * Math.exp(-d / 9) * central + 0.012 * (x / 120) ** 3;
}

/** Wyscout-style progressive pass: 30 m closer in own half, 15 m across, 10 m in the final half. */
export function isProgressive(a: XY, b: XY): boolean {
  const gain = goalDist(a) - goalDist(b);
  if (a[0] < 60 && b[0] < 60) return gain >= 30;
  if (a[0] < 60) return gain >= 15;
  return gain >= 10;
}
