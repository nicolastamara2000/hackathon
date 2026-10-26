/**
 * Words for turning points. The numbers are passed in from stats/turning.ts;
 * these templates never compute or invent one. Facts, interpretation and
 * hypothesis stay in separate fields so the UI can label them.
 */
import type { MatchMeta } from "../feed/types";
import type { TPMetric, TurningPoint } from "../stats/turning";
import type { Locale } from "./strings";

export interface TPText {
  category: string;
  headline: string;
  fan: string; // one plain sentence
  observed: string; // fact, from the numbers
  why: string; // interpretation
  next: string; // conditional hypothesis
  limits: string; // alternative explanations / caveats
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmt = (m: TPMetric, v: number) => (m.unit === "pct" ? pct(v) : m.unit === "dec" ? v.toFixed(2) : String(Math.round(v)));
export const fmtMetric = fmt;

export const METRIC_LABEL: Record<Locale, Record<string, string>> = {
  en: {
    hiRec: "High recoveries", oppFwd: "Opponent forward-pass completion", fwdPct: "Forward-pass completion",
    fwdAtt: "Forward passes tried", oppHiRec: "Opponent high recoveries", leftShare: "Actions on left flank",
    rightShare: "Actions on right flank", fieldTilt: "Field tilt (final-third pass share)", ftPasses: "Final-third passes",
    xt: "Expected threat (xT) added", xg: "xG", shots: "Shots", possShare: "Share of on-ball actions",
    turnovers: "Turnovers per minute", shotsBoth: "Shots, both teams",
  },
  "es-419": {
    hiRec: "Recuperaciones altas", oppFwd: "Pases hacia adelante del rival completados", fwdPct: "Pases hacia adelante completados",
    fwdAtt: "Pases hacia adelante intentados", oppHiRec: "Recuperaciones altas del rival", leftShare: "Acciones por la izquierda",
    rightShare: "Acciones por la derecha", fieldTilt: "Inclinación de campo (% pases en último tercio)", ftPasses: "Pases en último tercio",
    xt: "Amenaza esperada (xT) generada", xg: "xG", shots: "Tiros", possShare: "% de acciones con pelota",
    turnovers: "Pérdidas por minuto", shotsBoth: "Tiros, ambos equipos",
  },
};

export const STATUS_LABEL: Record<Locale, Record<TurningPoint["status"], string>> = {
  en: { new: "New", developing: "Developing", confirmed: "Confirmed", faded: "No longer supported" },
  "es-419": { new: "Nuevo", developing: "En desarrollo", confirmed: "Confirmado", faded: "Ya no se sostiene" },
};

export const IMPACT_LABEL: Record<Locale, Record<TurningPoint["impact"], string>> = {
  en: { high: "High impact", medium: "Medium impact", low: "Low impact" },
  "es-419": { high: "Impacto alto", medium: "Impacto medio", low: "Impacto bajo" },
};

export function confidenceText(tp: TurningPoint, locale: Locale): string {
  const x = tp.strength.toFixed(1);
  const lvl = { en: { high: "High", medium: "Medium", low: "Low" }, "es-419": { high: "Alta", medium: "Media", low: "Baja" } }[locale][tp.confidence];
  return locale === "en"
    ? `${lvl} confidence: ${tp.sample} events behind the signal, change is ${x}× the detection threshold. High = 12+ events and 1.5×; medium = 6+ events.`
    : `Confianza ${lvl.toLowerCase()}: ${tp.sample} eventos detrás de la señal, el cambio es ${x}× el umbral. Alta = 12+ eventos y 1,5×; media = 6+ eventos.`;
}

export function windowText(tp: TurningPoint, locale: Locale): string {
  const w = tp.window;
  return locale === "en"
    ? `Minutes ${w.nowFrom}–${w.nowTo} of play vs ${Math.max(0, w.prevFrom)}–${w.prevTo}`
    : `Minutos ${w.nowFrom}–${w.nowTo} de juego vs ${Math.max(0, w.prevFrom)}–${w.prevTo}`;
}

export function tpText(tp: TurningPoint, meta: MatchMeta, locale: Locale): TPText {
  const es = locale !== "en";
  const T = meta[tp.side].short_name;
  const O = meta[tp.side === "home" ? "away" : "home"].short_name;
  const m = (k: string) => tp.metrics.find((x) => x.key === k)!;
  const pn = (k: string) => {
    const x = m(k);
    return `${fmt(x, x.prev)} → ${fmt(x, x.now)}`;
  };

  switch (tp.kind) {
    case "press_up":
      return es
        ? {
            category: "Presión", headline: `${T} sube la presión`,
            fan: `${T} está robando la pelota arriba: ${m("hiRec").now} recuperaciones altas.`,
            observed: `Recuperaciones en campo rival: ${pn("hiRec")}. Pases hacia adelante de ${O}: ${pn("oppFwd")}.`,
            why: `${O} tiene menos tiempo para salir jugando; cada robo alto deja a ${T} cerca del arco.`,
            next: `Si sigue así, ${O} podría buscar pelotas largas para saltar la presión.`,
            limits: `Puede reflejar errores de ${O} más que un cambio de plan de ${T}. No hay datos de posición sin pelota.`,
          }
        : {
            category: "Pressing", headline: `${T} press higher`,
            fan: `${T} are winning the ball high up: ${m("hiRec").now} high recoveries.`,
            observed: `Recoveries in the opponent half: ${pn("hiRec")}. ${O} forward-pass completion: ${pn("oppFwd")}.`,
            why: `${O} get less time to build from the back; each high win leaves ${T} close to goal.`,
            next: `If it continues, ${O} may go longer to bypass the press.`,
            limits: `Could reflect ${O} errors rather than a ${T} plan change. No off-ball tracking data.`,
          };
    case "forward_drop":
      return es
        ? {
            category: "Progresión", headline: `${T} no logra avanzar`,
            fan: `A ${T} le cuesta pasar hacia adelante: ${pct(m("fwdPct").now)} de acierto.`,
            observed: `Pases hacia adelante completados: ${pn("fwdPct")} (${m("fwdAtt").now} intentos). Recuperaciones altas de ${O}: ${pn("oppHiRec")}.`,
            why: `Sin progresión, ${T} pierde la pelota antes de llegar al último tercio.`,
            next: `Si continúa, ${T} podría necesitar cambiar de frente más rápido o sumar un pase extra en el medio.`,
            limits: `Muestra chica: ${m("fwdAtt").now} pases. Puede ser cansancio o riesgo deliberado.`,
          }
        : {
            category: "Progression", headline: `${T} struggle to progress`,
            fan: `${T} can't find forward passes: ${pct(m("fwdPct").now)} completed.`,
            observed: `Forward-pass completion: ${pn("fwdPct")} (${m("fwdAtt").now} tried). ${O} high recoveries: ${pn("oppHiRec")}.`,
            why: `Without progression, ${T} lose the ball before reaching the final third.`,
            next: `If it continues, ${T} may need to switch play faster or add a passing option in midfield.`,
            limits: `Small sample: ${m("fwdAtt").now} passes. Could be fatigue or deliberate risk-taking.`,
          };
    case "flank_shift": {
      const left = tp.extra.flank === "left";
      const side = es ? (left ? "izquierda" : "derecha") : left ? "left" : "right";
      const k = left ? "leftShare" : "rightShare";
      return es
        ? {
            category: "Espacio", headline: `${T} carga el juego por la ${side}`,
            fan: `${T} ataca casi todo por la ${side}: ${pct(m(k).now)} de sus acciones.`,
            observed: `Acciones por la ${side}: ${pn(k)} del total de ${T}.`,
            why: `Sobrecargar una banda busca superioridad numérica ahí, pero deja el lado opuesto libre.`,
            next: `Si ${O} cierra esa banda, un cambio de frente rápido al lado débil podría abrir espacio.`,
            limits: `El lado se mide desde la dirección de ataque de ${T}. Puede ser donde ${O} deja espacio, no un plan.`,
          }
        : {
            category: "Space", headline: `${T} shift play to the ${side}`,
            fan: `${T} are attacking down the ${side}: ${pct(m(k).now)} of their play.`,
            observed: `Actions on the ${side} flank: ${pn(k)} of ${T}'s on-ball actions.`,
            why: `Overloading one flank creates numbers there but leaves the far side open.`,
            next: `If ${O} close that flank, a quick switch to the weak side could open space.`,
            limits: `Flank is measured from ${T}'s attacking direction. It may be where ${O} allow space, not a plan.`,
          };
    }
    case "territory":
      return es
        ? {
            category: "Territorio", headline: `${T} empuja a ${O} contra su arco`,
            fan: `${T} juega en campo rival: ${pct(m("fieldTilt").now)} de los pases en el último tercio.`,
            observed: `Inclinación de campo: ${pn("fieldTilt")}. Pases en último tercio: ${pn("ftPasses")}.`,
            why: `Más tiempo cerca del área rival suele traer más tiros y más pelotas paradas.`,
            next: `Si ${T} no convierte el territorio en tiros, ${O} tendrá espacio para contragolpear.`,
            limits: `Territorio no es lo mismo que peligro: mirá el xG del mismo período.`,
          }
        : {
            category: "Territory", headline: `${T} pin ${O} back`,
            fan: `${T} are camped in the opponent's half: ${pct(m("fieldTilt").now)} of final-third passes.`,
            observed: `Field tilt: ${pn("fieldTilt")}. Final-third passes: ${pn("ftPasses")}.`,
            why: `More time near the box usually brings more shots and set pieces.`,
            next: `If ${T} don't turn territory into shots, ${O} will have space to counter.`,
            limits: `Territory is not danger: check the xG over the same window.`,
          };
    case "threat_surge":
      return es
        ? {
            category: "Amenaza", headline: `${T} se vuelve peligroso`,
            fan: `¡${T} está cerca del gol! xG ${m("xg").now.toFixed(2)} en los últimos minutos.`,
            observed: `xT generado: ${pn("xt")}. xG: ${pn("xg")}. Tiros: ${pn("shots")}.`,
            why: `${T} está llevando la pelota a zonas de las que salen goles.`,
            next: `Si se mantiene, un gol de ${T} es más probable que antes; ${O} podría bajar el bloque.`,
            limits: `xT es un modelo simple de amenaza por zona; no ve a los defensores.`,
          }
        : {
            category: "Threat", headline: `${T} turn up the threat`,
            fan: `${T} are knocking on the door: ${m("xg").now.toFixed(2)} xG in the last minutes.`,
            observed: `Expected threat added: ${pn("xt")}. xG: ${pn("xg")}. Shots: ${pn("shots")}.`,
            why: `${T} are moving the ball into the zones goals come from.`,
            next: `If it holds, a ${T} goal is more likely than before; ${O} may drop deeper.`,
            limits: `xT is a simple zone threat model; it does not see defenders.`,
          };
    case "sterile_possession":
      return es
        ? {
            category: "Control", headline: `${T} tiene la pelota, pero no lastima`,
            fan: `${T} tiene ${pct(m("possShare").now)} de la pelota y casi nada de peligro.`,
            observed: `% de acciones con pelota: ${pn("possShare")}. xG: ${pn("xg")}. Pases en último tercio: ${pn("ftPasses")}.`,
            why: `Posesión sin llegadas: ${O} defiende cómodo y espera el error.`,
            next: `Si ${T} no acelera o no mete más gente en el área, la posesión seguirá sin premio.`,
            limits: `Posesión medida por acciones con pelota, no por tiempo.`,
          }
        : {
            category: "Control", headline: `${T} have the ball but no bite`,
            fan: `${T} have ${pct(m("possShare").now)} of the ball and almost no danger.`,
            observed: `Share of on-ball actions: ${pn("possShare")}. xG: ${pn("xg")}. Final-third passes: ${pn("ftPasses")}.`,
            why: `Possession without penetration: ${O} defend comfortably and wait for a mistake.`,
            next: `Unless ${T} speed up or commit more players to the box, the ball will stay unrewarded.`,
            limits: `Possession measured by on-ball actions, not by time.`,
          };
    case "chaos":
      return es
        ? {
            category: "Ritmo", headline: `El partido se rompe: ida y vuelta`,
            fan: `¡Ida y vuelta! ${m("turnovers").now.toFixed(1)} pérdidas por minuto.`,
            observed: `Pérdidas por minuto: ${pn("turnovers")}. Tiros de ambos: ${pn("shotsBoth")}.`,
            why: `Con tantas pérdidas, nadie controla el medio y cualquiera puede llegar.`,
            next: `Si sigue roto, gana el equipo más rápido en transición; el que va ganando querría calmarlo.`,
            limits: `Pérdidas = cambios de posesión en acciones con pelota.`,
          }
        : {
            category: "Rhythm", headline: `The game breaks open`,
            fan: `End to end! ${m("turnovers").now.toFixed(1)} turnovers a minute.`,
            observed: `Turnovers per minute: ${pn("turnovers")}. Shots, both teams: ${pn("shotsBoth")}.`,
            why: `With this many turnovers, nobody controls midfield and both sides can reach goal.`,
            next: `If it stays open, the faster transition team gains; the leading side would want to slow it down.`,
            limits: `Turnovers = possession changes on on-ball actions.`,
          };
    case "reaction": {
      const trig = String(tp.extra.trigger);
      const who = String(tp.extra.triggerPlayer);
      const by = meta[tp.extra.triggerSide as "home" | "away"].short_name;
      const what = es
        ? { goal: `el gol de ${who} (${by})`, sub: `el ingreso de ${who} (${by})`, red: `la roja a ${who} (${by})` }[trig]
        : { goal: `${who}'s goal (${by})`, sub: `${who} coming on (${by})`, red: `the red card to ${who} (${by})` }[trig];
      return es
        ? {
            category: "Reacción", headline: `${T} cambia tras ${what}`,
            fan: `Desde ${what}, ${T} juega más arriba.`,
            observed: `10 min antes vs 10 min después (${tp.extra.triggerMinute}′): inclinación de campo ${pn("fieldTilt")}, xT ${pn("xt")}.`,
            why: `${T} ganó terreno después del evento: puede ser ajuste táctico o efecto emocional.`,
            next: `Si se sostiene, ${T} debería generar más tiros en los próximos minutos.`,
            limits: `Antes/después de un solo evento: correlación, no causa probada.`,
          }
        : {
            category: "Reaction", headline: `${T} change after ${what}`,
            fan: `Since ${what}, ${T} are playing higher up the pitch.`,
            observed: `10 min before vs 10 min after (${tp.extra.triggerMinute}′): field tilt ${pn("fieldTilt")}, xT ${pn("xt")}.`,
            why: `${T} gained territory after the event: a tactical adjustment or an emotional lift.`,
            next: `If it holds, ${T} should create more shots in the next minutes.`,
            limits: `Before/after a single event: correlation, not proven cause.`,
          };
    }
  }
}
