type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;

/** Nudge a color toward white (dark theme) or black (light theme) until it reaches `min` contrast. */
export function ensureContrast(c: RGB, bg: RGB, min = 3): RGB {
  const target: RGB = luminance(bg) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  let out = c;
  for (let t = 0.08; contrast(out, bg) < min && t <= 1; t += 0.08) out = mix(c, target, t);
  return out;
}

export const rgbDistance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const triplet = (c: RGB) => c.join(" ");
export const cssVarRgb = (name: string): RGB =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).map(Number) as RGB;
/** Text color (ink or white/black) that reads on a filled team color. */
export const onColor = (c: RGB) => (contrast(c, [255, 255, 255]) >= 4.5 ? "#FFFFFF" : "#0B0F14");
