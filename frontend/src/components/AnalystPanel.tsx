import { memo } from "react";
import { Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import type { Side, StatsSnapshot } from "../stats/engine";
import { CompareRow, ControlGauge, DifficultyBadge, Section } from "./bits";

interface Props {
  meta: MatchMeta;
  stats: StatsSnapshot;
  events: MatchEvent[];
  palette: TeamPalette;
  t: Strings;
  onStat(key: string): void;
}

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const dec = (n: number) => (v: number | null) => (v === null ? "–" : v.toFixed(n));
const int = (v: number | null) => (v === null ? "–" : String(Math.round(v)));
const share = (h: number, a: number) => (h + a > 0 ? h / (h + a) : 0.5);

/** High density: every number, raw values, two standard charts, JSON export. */
export const AnalystPanel = memo(function AnalystPanel({ meta, stats, events, palette, t, onStat }: Props) {
  const H = stats.home, A = stats.away;
  const name = (s: Side | null) => (s ? meta[s].short_name : "");
  const caption =
    stats.controlChaos > 25
      ? stats.controlSide
        ? `${name(stats.controlSide)} · ${t.control}`
        : t.control
      : stats.controlChaos < -25
        ? t.chaos
        : t.balanced;
  const recent = events
    .filter((e) => (e.type === "Pass" || e.type === "Shot") && e.clock_s <= stats.clock_s)
    .slice(-6)
    .reverse();
  const goals = stats.keyMoments.filter((k) => k.kind === "goal");
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(stats, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meta.match_id}-${stats.minute}m-stats.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const rhythmCls = { fast: "text-good", slow: "text-muted", broken: "text-warn" }[stats.rhythm];
  const rhythmIcon = { fast: "▶▶", slow: "▶", broken: "■" }[stats.rhythm];

  return (
    <div className="flex flex-col">
      <Section
        title={t.gameState}
        right={
          <span className={`text-xs font-semibold ${rhythmCls}`}>
            {t.rhythm}: {rhythmIcon} {t[stats.rhythm]}
          </span>
        }
      >
        <button className="w-full text-left" onClick={() => onStat("control")}>
          <ControlGauge value={stats.controlChaos} caption={caption} t={t} />
        </button>
        {stats.pressureShift && (
          <button
            onClick={() => onStat(`${stats.pressureShift!.side}.ppda5`)}
            className="mt-2 w-full rounded border border-warn/60 bg-warn/10 px-3 py-2 text-left text-sm"
          >
            <span className="font-semibold text-warn">⚠ {t.pressureShift}</span> · {name(stats.pressureShift.side)} PPDA{" "}
            <span className="num">
              {stats.pressureShift.from.toFixed(1)} → {stats.pressureShift.to.toFixed(1)}
            </span>
          </button>
        )}
      </Section>

      <Section
        title={`${meta.home.short_name} · ${meta.away.short_name}`}
        right={<span className="text-2xs text-muted">{t.evidenceHint}</span>}
      >
        <CompareRow label={t.possession} home={H.possession} away={A.possession} fmt={pct} share={H.possession} onClick={(s) => onStat(`${s}.possession`)} />
        <CompareRow label={t.fieldTilt} home={H.fieldTilt} away={A.fieldTilt} fmt={pct} share={H.fieldTilt} onClick={(s) => onStat(`${s}.fieldTilt`)} />
        <CompareRow label={t.ppda} home={H.ppda5} away={A.ppda5} fmt={dec(1)} onClick={(s) => onStat(`${s}.ppda5`)} />
        <CompareRow label={t.xg} home={H.xg} away={A.xg} fmt={dec(2)} share={share(H.xg, A.xg)} onClick={(s) => onStat(`${s}.xg`)} />
        <CompareRow label={t.xt} home={H.xt} away={A.xt} fmt={dec(2)} share={share(H.xt, A.xt)} onClick={(s) => onStat(`${s}.xt`)} />
        <CompareRow
          label={t.shots}
          home={H.shots}
          away={A.shots}
          fmt={int}
          share={share(H.shots, A.shots)}
          onClick={(s) => onStat(`${s}.shots`)}
        />
        <div className="-mt-1 grid grid-cols-2 text-xs text-muted">
          <span className="num">({H.onTarget})</span>
          <span className="num text-right">({A.onTarget})</span>
        </div>
        <CompareRow label={t.passes} home={H.passes} away={A.passes} fmt={int} share={share(H.passes, A.passes)} onClick={(s) => onStat(`${s}.passes`)} />
        <CompareRow label={t.passAcc} home={H.passAccuracy} away={A.passAccuracy} fmt={pct} onClick={(s) => onStat(`${s}.passes`)} />
        <CompareRow label={t.passDist} home={H.passDistanceM} away={A.passDistanceM} fmt={dec(1)} onClick={(s) => onStat(`${s}.passes`)} />
        <CompareRow
          label={t.progressive}
          home={H.progressive}
          away={A.progressive}
          fmt={int}
          share={share(H.progressive, A.progressive)}
          onClick={(s) => onStat(`${s}.progressive`)}
        />
        <CompareRow label={t.difficulty} home={H.avgDifficulty} away={A.avgDifficulty} fmt={int} onClick={(s) => onStat(`${s}.passes`)} />
        <CompareRow
          label={`${t.topShot}, km/h`}
          home={H.topShotKmh || null}
          away={A.topShotKmh || null}
          fmt={int}
          onClick={(s) => onStat(`${s}.shots`)}
        />
      </Section>

      <Section title={t.winProb}>
        <div className="h-28">
          <ResponsiveContainer>
            <LineChart data={stats.winProbHistory} margin={{ top: 4, right: 8, bottom: 0, left: -28 }}>
              <XAxis dataKey="minute" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v) => `${v * 100}`} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTip fmt={(v) => `${Math.round(v * 100)}%`} />} />
              <Line type="stepAfter" dataKey="home" name={meta.home.short_name} stroke={palette.home} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="draw" name={t.draw} stroke="rgb(var(--muted))" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="away" name={meta.away.short_name} stroke={palette.away} strokeWidth={2.5} strokeDasharray="1 0" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title={t.xgTimeline}>
        <div className="h-28">
          <ResponsiveContainer>
            <LineChart data={stats.xgTimeline} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}>
              <XAxis dataKey="minute" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} tickLine={false} axisLine={false} allowDecimals />
              <Tooltip content={<ChartTip fmt={(v) => v.toFixed(2)} />} />
              <Line type="stepAfter" dataKey="home" name={meta.home.short_name} stroke={palette.home} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="away" name={meta.away.short_name} stroke={palette.away} strokeWidth={2.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
              {goals.map((g) => {
                const pt = stats.xgTimeline.find((p) => p.play_s === g.play_s);
                return pt ? (
                  <ReferenceDot
                    key={g.id}
                    x={pt.minute}
                    y={g.side === "home" ? pt.home : pt.away}
                    r={5}
                    fill={g.side === "home" ? palette.home : palette.away}
                    stroke="rgb(var(--ink))"
                    strokeWidth={2}
                  />
                ) : null;
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title={t.latest}>
        <ul className="space-y-1.5">
          {recent.map((e) => (
            <li key={e.id} className="grid grid-cols-[38px_1fr_auto] items-center gap-2 text-sm">
              <span className="num text-muted">{e.minute}′</span>
              <span className="truncate">
                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${e.team_id === meta.home.id ? "bg-home" : "bg-away"}`} />
                {e.player_name?.split(" ").slice(-1)[0]} · {e.type === "Shot" ? `Shot ${e.outcome}` : `${Math.round(e.pass_length_m ?? 0)} m ${e.outcome === "Complete" ? "✓" : "✗"}`}
              </span>
              {e.type === "Pass" ? (
                <DifficultyBadge value={e.pass_difficulty ?? 0} />
              ) : (
                <span className="num text-sm">xG {(e.xg ?? 0).toFixed(2)}</span>
              )}
            </li>
          ))}
        </ul>
        <button onClick={exportJson} className="mt-3 w-full rounded border border-line py-2 text-sm font-semibold hover:bg-raised">
          {"{ }"} {t.exportJson}
        </button>
      </Section>
    </div>
  );
});

function ChartTip({ active, payload, label, fmt }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number; fmt(v: number): string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded bg-raised px-2 py-1 text-xs shadow-[var(--shadow)]">
      <div className="num text-muted">{label}′</div>
      {payload.map((p) => (
        <div key={p.name} className="num" style={{ color: p.color }}>
          {p.name} {fmt(p.value)}
        </div>
      ))}
    </div>
  );
}
