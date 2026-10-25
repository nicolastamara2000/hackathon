/** Port of metrics/analyzer.py win_probability: Poisson on remaining scoring rates. */

const BASE_GOALS_PER_90 = 1.35;

const pmf = (k: number, lam: number) => {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lam) * lam ** k) / f;
};

export interface WinProb {
  home: number;
  draw: number;
  away: number;
}

export function winProbability(score: [number, number], minute: number, rh: number, ra: number): WinProb {
  const left = Math.max(0, 95 - minute) / 90;
  const ph = Array.from({ length: 11 }, (_, k) => pmf(k, rh * left));
  const pa = Array.from({ length: 11 }, (_, k) => pmf(k, ra * left));
  let home = 0, draw = 0, away = 0;
  ph.forEach((a, i) =>
    pa.forEach((b, j) => {
      const h = score[0] + i, w = score[1] + j, p = a * b;
      if (h > w) home += p;
      else if (h === w) draw += p;
      else away += p;
    }),
  );
  const t = home + draw + away;
  return { home: home / t, draw: draw / t, away: away / t };
}

/** Scoring rates per 90: strength prior blended with in-match xG pace (as the analyzer does). */
export function scoringRates(sh: number, sa: number, minute: number, xgH: number, xgA: number): [number, number] {
  const priorH = BASE_GOALS_PER_90 * Math.exp(1.5 * (sh - sa)) * 1.08;
  const priorA = (BASE_GOALS_PER_90 * Math.exp(1.5 * (sa - sh))) / 1.08;
  const played = Math.max(minute, 1) / 90;
  const w = 0.4 * Math.min(played, 1);
  const rh = (1 - w) * priorH + w * (xgH / played);
  const ra = (1 - w) * priorA + w * (xgA / played);
  return [Math.max(rh, 0.6 * priorH), Math.max(ra, 0.6 * priorA)];
}
