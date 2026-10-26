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
            why: `${T} adelanta líneas y salta a presionar a los centrales y al volante de salida de ${O}. Cada robo alto es una transición corta, con la defensa rival desordenada y a pocos metros del arco.`,
            next: `Mirá si ${O} saca al arquero largo para saltear la presión, o baja un volante entre los centrales para tener salida limpia.`,
            limits: `Puede reflejar errores de ${O} más que un cambio de plan de ${T}. No hay datos de posición sin pelota.`,
          }
        : {
            category: "Pressing", headline: `${T} press higher`,
            fan: `${T} are winning the ball high up: ${m("hiRec").now} high recoveries.`,
            observed: `Recoveries in the opponent half: ${pn("hiRec")}. ${O} forward-pass completion: ${pn("oppFwd")}.`,
            why: `${T} push their lines up and jump onto ${O}'s centre-backs and holding midfielder. Every high regain is a short transition against a defence that is out of shape and close to its own goal.`,
            next: `Watch whether ${O} go long from the keeper to skip the press, or drop a midfielder between the centre-backs to build cleanly.`,
            limits: `Could reflect ${O} errors rather than a ${T} plan change. No off-ball tracking data.`,
          };
    case "forward_drop":
      return es
        ? {
            category: "Progresión", headline: `${T} no logra avanzar`,
            fan: `A ${T} le cuesta pasar hacia adelante: ${pct(m("fwdPct").now)} de acierto.`,
            observed: `Pases hacia adelante completados: ${pn("fwdPct")} (${m("fwdAtt").now} intentos). Recuperaciones altas de ${O}: ${pn("oppHiRec")}.`,
            why: `${T} no encuentra al hombre libre entre líneas: los pases verticales se cortan y la pelota vuelve atrás o se pierde antes del último tercio. Así no puede fijar a la defensa rival.`,
            next: `Mirá si ${T} usa más los laterales para salir por afuera, cambia de frente más rápido o tira un volante a los half-spaces para dar una línea de pase.`,
            limits: `Muestra chica: ${m("fwdAtt").now} pases. Puede ser cansancio o riesgo deliberado.`,
          }
        : {
            category: "Progression", headline: `${T} struggle to progress`,
            fan: `${T} can't find forward passes: ${pct(m("fwdPct").now)} completed.`,
            observed: `Forward-pass completion: ${pn("fwdPct")} (${m("fwdAtt").now} tried). ${O} high recoveries: ${pn("oppHiRec")}.`,
            why: `${T} can't find the free man between the lines: vertical passes are cut out and the ball goes backwards or is lost before the final third, so they never pin the back line.`,
            next: `Watch whether ${T} use the full-backs to go round the block, switch play faster, or drop a midfielder into the half-spaces to open a passing lane.`,
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
            why: `${T} junta lateral, extremo y volante en esa banda para crear superioridad y triangular. ${O} bascula hacia ese lado, y eso deja al lateral y al extremo del lado contrario con espacio.`,
            next: `Mirá el cambio de frente al lado débil: si ${O} cierra la banda cargada, el espacio aparece del otro lado.`,
            limits: `El lado se mide desde la dirección de ataque de ${T}. Puede ser donde ${O} deja espacio, no un plan.`,
          }
        : {
            category: "Space", headline: `${T} shift play to the ${side}`,
            fan: `${T} are attacking down the ${side}: ${pct(m(k).now)} of their play.`,
            observed: `Actions on the ${side} flank: ${pn(k)} of ${T}'s on-ball actions.`,
            why: `${T} stack full-back, winger and midfielder on that side to create an overload and play in triangles. ${O} shift across to cope, which leaves space for the far-side full-back and winger.`,
            next: `Watch for the switch to the weak side: if ${O} lock down the loaded flank, the space is on the other one.`,
            limits: `Flank is measured from ${T}'s attacking direction. It may be where ${O} allow space, not a plan.`,
          };
    }
    case "territory":
      return es
        ? {
            category: "Territorio", headline: `${T} empuja a ${O} contra su arco`,
            fan: `${T} juega en campo rival: ${pct(m("fieldTilt").now)} de los pases en el último tercio.`,
            observed: `Inclinación de campo: ${pn("fieldTilt")}. Pases en último tercio: ${pn("ftPasses")}.`,
            why: `${T} instala el juego en campo rival y hunde el bloque de ${O}. Con los centrales arriba, defiende la pérdida rápido (contrapresión) y vive de centros, segundas pelotas y córners.`,
            next: `Mirá la defensa de ${T} sin pelota: con tanta gente arriba, una contra de ${O} encuentra espacio a la espalda de los laterales.`,
            limits: `Territorio no es lo mismo que peligro: mirá el xG del mismo período.`,
          }
        : {
            category: "Territory", headline: `${T} pin ${O} back`,
            fan: `${T} are camped in the opponent's half: ${pct(m("fieldTilt").now)} of final-third passes.`,
            observed: `Field tilt: ${pn("fieldTilt")}. Final-third passes: ${pn("ftPasses")}.`,
            why: `${T} have settled in the opponent's half and pushed ${O}'s block deep. With the centre-backs high they can counter-press any loss, and live off crosses, second balls and corners.`,
            next: `Watch ${T}'s rest defence: with this many players committed, an ${O} counter finds space behind the full-backs.`,
            limits: `Territory is not danger: check the xG over the same window.`,
          };
    case "threat_surge":
      return es
        ? {
            category: "Amenaza", headline: `${T} se vuelve peligroso`,
            fan: `¡${T} está cerca del gol! xG ${m("xg").now.toFixed(2)} en los últimos minutos.`,
            observed: `xT generado: ${pn("xt")}. xG: ${pn("xg")}. Tiros: ${pn("shots")}.`,
            why: `${T} ya no circula por afuera: entra al área, recibe entre líneas y encuentra al delantero de frente al arco. Son las zonas de donde salen los goles.`,
            next: `Mirá si ${O} baja el bloque y cierra el centro con un quinto defensor, o si el gol de ${T} llega antes.`,
            limits: `xT es un modelo simple de amenaza por zona; no ve a los defensores.`,
          }
        : {
            category: "Threat", headline: `${T} turn up the threat`,
            fan: `${T} are knocking on the door: ${m("xg").now.toFixed(2)} xG in the last minutes.`,
            observed: `Expected threat added: ${pn("xt")}. xG: ${pn("xg")}. Shots: ${pn("shots")}.`,
            why: `${T} have stopped circulating wide: they are getting into the box, receiving between the lines and finding the striker facing goal. Those are the zones goals come from.`,
            next: `Watch whether ${O} drop deeper and add a fifth defender to close the middle, or whether ${T}'s goal comes first.`,
            limits: `xT is a simple zone threat model; it does not see defenders.`,
          };
    case "sterile_possession":
      return es
        ? {
            category: "Control", headline: `${T} tiene la pelota, pero no lastima`,
            fan: `${T} tiene ${pct(m("possShare").now)} de la pelota y casi nada de peligro.`,
            observed: `% de acciones con pelota: ${pn("possShare")}. xG: ${pn("xg")}. Pases en último tercio: ${pn("ftPasses")}.`,
            why: `${O} cede la pelota a propósito: bloque medio compacto, centro cerrado y ${T} circulando en U por delante, sin pases que rompan líneas.`,
            next: `Mirá si ${T} acelera la circulación, busca la espalda con un pase en profundidad o mete más gente en el área. Si no, ${O} espera el error para salir de contra.`,
            limits: `Posesión medida por acciones con pelota, no por tiempo.`,
          }
        : {
            category: "Control", headline: `${T} have the ball but no bite`,
            fan: `${T} have ${pct(m("possShare").now)} of the ball and almost no danger.`,
            observed: `Share of on-ball actions: ${pn("possShare")}. xG: ${pn("xg")}. Final-third passes: ${pn("ftPasses")}.`,
            why: `${O} are happy to give up the ball: a compact mid block, the middle closed, and ${T} circulating in a U-shape in front of it without line-breaking passes.`,
            next: `Watch whether ${T} speed up circulation, try a ball in behind, or commit more runners to the box. If not, ${O} wait for the mistake and counter.`,
            limits: `Possession measured by on-ball actions, not by time.`,
          };
    case "chaos":
      return es
        ? {
            category: "Ritmo", headline: `El partido se rompe: ida y vuelta`,
            fan: `¡Ida y vuelta! ${m("turnovers").now.toFixed(1)} pérdidas por minuto.`,
            observed: `Pérdidas por minuto: ${pn("turnovers")}. Tiros de ambos: ${pn("shotsBoth")}.`,
            why: `El medio se partió: los equipos están largos, nadie hace la pausa y cada pérdida es una transición. Gana el que tenga mejor defensa de la pérdida.`,
            next: `Mirá quién pide la pelota para hacer la pausa: el que va ganando querrá cortar el ritmo con faltas tácticas y posesión.`,
            limits: `Pérdidas = cambios de posesión en acciones con pelota.`,
          }
        : {
            category: "Rhythm", headline: `The game breaks open`,
            fan: `End to end! ${m("turnovers").now.toFixed(1)} turnovers a minute.`,
            observed: `Turnovers per minute: ${pn("turnovers")}. Shots, both teams: ${pn("shotsBoth")}.`,
            why: `Midfield has been skipped: both teams are stretched, nobody slows the game and every loss becomes a transition. The side with the better rest defence wins this phase.`,
            next: `Watch who takes the sting out of it: the leading side will want to slow the tempo with tactical fouls and keep-ball.`,
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
            why: `Después del evento ${T} adelantó la línea y empujó con más gente: puede ser una orden del banco, un cambio de sistema o un golpe anímico.`,
            next: `Si se sostiene, ${T} debería generar más tiros en los próximos minutos.`,
            limits: `Antes/después de un solo evento: correlación, no causa probada.`,
          }
        : {
            category: "Reaction", headline: `${T} change after ${what}`,
            fan: `Since ${what}, ${T} are playing higher up the pitch.`,
            observed: `10 min before vs 10 min after (${tp.extra.triggerMinute}′): field tilt ${pn("fieldTilt")}, xT ${pn("xt")}.`,
            why: `After the event ${T} raised their defensive line and committed more players forward: a call from the bench, a change of shape, or an emotional lift.`,
            next: `If it holds, ${T} should create more shots in the next minutes.`,
            limits: `Before/after a single event: correlation, not proven cause.`,
          };
    }
  }
}
