import { useEffect, useState } from "react";
import { AIError, writePlayerReport, writeStory, type AIPlayerReport, type AIStory, type AIStatus } from "../feed/ai";
import type { Locale } from "../i18n/strings";

type State<T> = { kind: "idle" } | { kind: "busy" } | { kind: "done"; value: T; minute: number } | { kind: "error"; status: AIStatus };

const L = (locale: Locale) =>
  locale === "en"
    ? {
        story: "AI match story", report: "AI performance report", write: "Write it", rewrite: "Rewrite at", busy: "Writing… (10–30 s)",
        by: "Written by the Foundry story agent from the verified numbers below. Numbers are fact-checked; interpretations are the agent's reading.",
        byP: "Written by the Foundry scout agent from this player's verified numbers. One match is a small sample.",
        off: "The AI writer is not configured on this server. The rule-based text below uses the same numbers.",
        failed: "The AI writer could not produce a fact-checked text this time. Try again; the rule-based text stays below.",
        key: "Tactical key", next: "What to watch next", strengths: "Strengths", concerns: "Concerns", vs: "Head-to-head", verdict: "Verdict", asOf: "as of",
        intro: "A written match report that explains the football, not only the numbers.", introP: "A one-match scouting report on this player.",
      }
    : {
        story: "Historia del partido con IA", report: "Informe de rendimiento con IA", write: "Escribirla", rewrite: "Reescribir al", busy: "Escribiendo… (10–30 s)",
        by: "Escrita por el agente de historia de Foundry con los números verificados de abajo. Los números se chequean; las interpretaciones son su lectura.",
        byP: "Escrito por el agente scout de Foundry con los números verificados del jugador. Un partido es una muestra chica.",
        off: "El escritor IA no está configurado en este servidor. El texto de abajo, basado en reglas, usa los mismos números.",
        failed: "El escritor IA no logró un texto que pase el chequeo de datos. Probá de nuevo; el texto basado en reglas sigue abajo.",
        key: "La clave táctica", next: "Qué mirar ahora", strengths: "Fortalezas", concerns: "Dudas", vs: "Mano a mano", verdict: "Veredicto", asOf: "al",
        intro: "Una crónica escrita que explica el fútbol, no solo los números.", introP: "Un informe scout de un partido sobre este jugador.",
      };

function useWriter<T>(write: (facts: unknown, locale: string) => Promise<T>, resetKey: string) {
  const [state, setState] = useState<State<T>>({ kind: "idle" });
  useEffect(() => setState({ kind: "idle" }), [resetKey]);
  const run = (facts: unknown, locale: string, minute: number) => {
    setState({ kind: "busy" });
    write(facts, locale)
      .then((value) => setState({ kind: "done", value, minute }))
      .catch((e) => setState({ kind: "error", status: e instanceof AIError ? e.status : "failed" }));
  };
  return [state, run] as const;
}

function Shell({ title, intro, state, minute, locale, onWrite, children }: { title: string; intro: string; state: State<unknown>; minute: number; locale: Locale; onWrite(): void; children?: React.ReactNode }) {
  const l = L(locale);
  return (
    <section className="rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="flex items-center gap-2">
        <h3 className="eyebrow text-accent">✦ {title}</h3>
        {state.kind === "done" && <span className="num text-2xs text-muted">{l.asOf} {state.minute}′</span>}
        <button
          onClick={onWrite}
          disabled={state.kind === "busy"}
          className="ml-auto rounded bg-accent px-3 py-1 text-xs font-bold text-bg hover:brightness-110 disabled:opacity-60"
        >
          {state.kind === "busy" ? l.busy : state.kind === "done" ? `↻ ${l.rewrite} ${minute}′` : `✦ ${l.write}`}
        </button>
      </div>
      {state.kind === "idle" && <p className="mt-1 text-sm text-muted">{intro}</p>}
      {state.kind === "error" && <p className="mt-2 text-sm text-muted">{state.status === "off" ? l.off : l.failed}</p>}
      {children}
    </section>
  );
}

export function AIStoryCard({ facts, minute, locale, resetKey }: { facts: () => unknown; minute: number; locale: Locale; resetKey: string }) {
  const l = L(locale);
  const [state, run] = useWriter<AIStory>(writeStory, `${resetKey}|${locale}`);
  return (
    <Shell title={l.story} intro={l.intro} state={state} minute={minute} locale={locale} onWrite={() => run(facts(), locale, minute)}>
      {state.kind === "done" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-lg font-semibold leading-snug">{state.value.headline}</p>
          {state.value.paragraphs.map((p, i) => (
            <p key={i} className="leading-relaxed">{p}</p>
          ))}
          <p className="leading-snug"><span className="font-semibold">{l.key}:</span> {state.value.tactical_key}</p>
          {state.value.watch_next && (
            <p className="leading-snug">
              <span className="mr-1.5 rounded-sm border border-dashed border-accent px-1 py-px text-2xs font-bold uppercase tracking-wider text-accent">{l.next}</span>
              {state.value.watch_next}
            </p>
          )}
          <p className="text-2xs text-muted">{l.by}</p>
        </div>
      )}
    </Shell>
  );
}

export function AIPlayerReportCard({ facts, minute, locale, resetKey }: { facts: () => unknown; minute: number; locale: Locale; resetKey: string }) {
  const l = L(locale);
  const [state, run] = useWriter<AIPlayerReport>(writePlayerReport, `${resetKey}|${locale}`);
  const list = (title: string, items: string[], mark: string) => (
    <div>
      <div className="eyebrow mb-1">{title}</div>
      <ul className="flex flex-col gap-1">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 leading-snug"><span className="text-accent">{mark}</span>{s}</li>
        ))}
      </ul>
    </div>
  );
  return (
    <Shell title={l.report} intro={l.introP} state={state} minute={minute} locale={locale} onWrite={() => run(facts(), locale, minute)}>
      {state.kind === "done" && (
        <div className="mt-2 flex flex-col gap-2.5 text-sm">
          <p className="text-base font-semibold leading-snug">{state.value.headline}</p>
          <p className="leading-snug">{state.value.role}</p>
          {list(l.strengths, state.value.strengths, "+")}
          {list(l.concerns, state.value.concerns, "–")}
          <p className="leading-snug"><span className="font-semibold">{l.vs}:</span> {state.value.vs_opponent}</p>
          <p className="leading-snug"><span className="font-semibold">{l.verdict}:</span> {state.value.verdict}</p>
          <p className="text-2xs text-muted">{l.byP}</p>
        </div>
      )}
    </Shell>
  );
}
