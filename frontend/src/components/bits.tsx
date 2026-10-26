import { motion } from "framer-motion";
import type { Strings } from "../i18n/strings";

/** Pass difficulty 0–100: green < 40, amber 40–70, red > 70. The word is printed too, so color is never alone. */
export function DifficultyBadge({ value }: { value: number }) {
  const [cls, word] =
    value > 70 ? ["bg-[#D55E00]", "Hard"] : value >= 40 ? ["bg-[#E69F00]", "Med"] : ["bg-[#009E73]", "Easy"];
  return (
    <span className={`num inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-xs font-semibold text-[#0B0F14] ${cls}`}>
      {value}
      <span className="font-sans text-2xs font-semibold uppercase">{word}</span>
    </span>
  );
}

/** Control vs chaos, −100 (chaos) .. +100 (control). Needle springs to the new value. */
export function ControlGauge({ value, caption, t }: { value: number; caption: string; t: Strings }) {
  const R = 54;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [60 + R * Math.cos(Math.PI - a), 64 - R * Math.sin(Math.PI - a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}`;
  };
  const angle = (value / 100) * 90; // −90 left .. +90 right
  return (
    <div className="flex items-center gap-3">
      <svg width={120} height={72} viewBox="0 0 120 72" role="img" aria-label={`${t.control} ${value}`}>
        <path d={arc(0, Math.PI / 3)} stroke="#D55E00" strokeWidth={10} fill="none" />
        <path d={arc(Math.PI / 3, (2 * Math.PI) / 3)} stroke="rgb(var(--muted))" strokeWidth={10} fill="none" />
        <path d={arc((2 * Math.PI) / 3, Math.PI)} stroke="#56B4E9" strokeWidth={10} fill="none" />
        <motion.g
          style={{ originX: "60px", originY: "64px" }}
          animate={{ rotate: angle }}
          transition={{ type: "spring", stiffness: 70, damping: 12 }}
        >
          <line x1={60} y1={64} x2={60} y2={16} stroke="rgb(var(--ink))" strokeWidth={3} strokeLinecap="round" />
        </motion.g>
        <circle cx={60} cy={64} r={5} fill="rgb(var(--ink))" />
      </svg>
      <div>
        <div className="num text-tv-sm leading-none">
          {value > 0 ? "+" : ""}
          {value}
        </div>
        <div className="mt-1 text-xs text-muted">{caption}</div>
        <div className="mt-0.5 flex gap-2 text-2xs uppercase tracking-wider text-muted">
          <span>◀ {t.chaos}</span>
          <span>{t.control} ▶</span>
        </div>
      </div>
    </div>
  );
}

/** One head-to-head stat row: numbers outside, split bar inside. Click opens the source events. */
export function CompareRow({
  label,
  home,
  away,
  fmt,
  share,
  onClick,
}: {
  label: string;
  home: number | null;
  away: number | null;
  fmt(v: number | null): string;
  /** 0..1 home share for the bar; omit for no bar */
  share?: number;
  onClick(side: "home" | "away"): void;
}) {
  return (
    <div className="grid grid-cols-[64px_1fr_64px] items-center gap-2 py-1.5">
      <button onClick={() => onClick("home")} className="num rounded text-left text-lg leading-none hover:text-accent">
        {fmt(home)}
      </button>
      <div>
        <div className="mb-1 text-center text-xs text-muted">{label}</div>
        {share !== undefined && (
          <div className="flex h-1.5 overflow-hidden rounded-full bg-raised">
            <motion.div className="bg-home" animate={{ width: `${share * 100}%` }} transition={{ duration: 0.5 }} />
            <div className="w-0.5 bg-surface" />
            <div className="flex-1 bg-away" />
          </div>
        )}
      </div>
      <button onClick={() => onClick("away")} className="num rounded text-right text-lg leading-none hover:text-accent">
        {fmt(away)}
      </button>
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="eyebrow">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}
