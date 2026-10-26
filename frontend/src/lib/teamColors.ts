import type { MatchMeta } from "../feed/types";
import { cssVarRgb, ensureContrast, hexToRgb, onColor, rgbDistance, triplet } from "./color";

export interface TeamPalette {
  home: string;
  away: string;
  onHome: string;
  onAway: string;
}

/**
 * Team colors from the match config, made usable on the current theme: at least
 * 3:1 against the panel surface (WCAG non-text), and the away side switches to
 * its second color when the two primaries are too close to tell apart.
 */
export function applyTeamColors(meta: MatchMeta): TeamPalette {
  const surface = cssVarRgb("surface");
  const home = ensureContrast(hexToRgb(meta.home.colors[0]), surface);
  let away = ensureContrast(hexToRgb(meta.away.colors[0]), surface);
  if (rgbDistance(home, away) < 120) away = ensureContrast(hexToRgb(meta.away.colors[1]), surface);
  const root = document.documentElement.style;
  root.setProperty("--home", triplet(home));
  root.setProperty("--away", triplet(away));
  return {
    home: `rgb(${home.join(",")})`,
    away: `rgb(${away.join(",")})`,
    onHome: onColor(home),
    onAway: onColor(away),
  };
}
