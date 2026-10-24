// Match Co-pilot web client: one SSE stream per viewer profile, overlays timed by the card.
const $ = (id) => document.getElementById(id);
const state = {
  seed: null, meta: null, es: null, profile: { mode: "fan", lang: "en", team: "", player: "", metric: "" },
  trail: [], control: [], cards: new Map(), score: [0, 0], minute: 0,
};
const KIND_LABEL = {
  en: { goal: "Goal", big_chance: "Big chance", hard_pass: "Pass of the match", control_shift: "Momentum",
        speed_alert: "Speed", distance_milestone: "Work rate", rocket_shot: "Shot power", card: "Card",
        substitution: "Substitution", half_time: "Half-time", full_time: "Full-time" },
  es: { goal: "Gol", big_chance: "Ocasión clara", hard_pass: "Pase del partido", control_shift: "Dominio",
        speed_alert: "Velocidad", distance_milestone: "Esfuerzo", rocket_shot: "Potencia", card: "Tarjeta",
        substitution: "Cambio", half_time: "Entretiempo", full_time: "Final" },
};
const METRIC_LABEL = { xg: "xG", shot_speed_kmh: "km/h", win_prob_swing: "win prob swing", difficulty: "difficulty",
  length_m: "m", forward_m: "m forward", ball_speed_kmh: "km/h ball", control: "control", chaos: "chaos",
  possession_home: "home poss.", turnovers_per_min: "turnovers/min", top_speed_kmh: "km/h", sprints: "sprints",
  distance_m: "m", outcome: "" };

// ------------------------------------------------------------------ setup
async function init() {
  const fixtures = await (await fetch("/api/matches")).json();
  $("fixture").innerHTML = fixtures.map((f) => `<option value="${f.seed}">${f.home} vs ${f.away}</option>`).join("");
  $("fixture").onchange = () => loadMeta(+$("fixture").value);
  $("start").onclick = start;
  for (const id of ["mode", "lang"]) {
    $(id).querySelectorAll("button").forEach((b) => (b.onclick = () => {
      $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      state.profile[id] = b.dataset.v;
      if (id === "mode" && b.dataset.v === "player" && !state.profile.player) $("player").focus();
      reconnect();
    }));
  }
  for (const id of ["team", "player", "metric"]) $(id).onchange = () => { state.profile[id] = $(id).value; reconnect(); };
  await loadMeta(fixtures[0].seed);
  drawPitch();
}

async function loadMeta(seed) {
  state.seed = seed;
  state.meta = await (await fetch(`/api/matches/${seed}`)).json();
  const { home, away } = state.meta;
  document.documentElement.style.setProperty("--home", home.colors[0]);
  document.documentElement.style.setProperty("--away", away.colors[0] === home.colors[0] ? away.colors[1] : away.colors[0]);
  $("sb-home").querySelector("b").textContent = home.short_name;
  $("sb-away").querySelector("b").textContent = away.short_name;
  $("team").innerHTML = `<option value="">Favorite club</option>` +
    [home, away].map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  $("player").innerHTML = `<option value="">Favorite player</option>` + [home, away].map((t) =>
    `<optgroup label="${t.name}">` + t.lineup.concat(t.bench).map((p) =>
      `<option value="${p.id}">${p.number}. ${p.name} (${p.position})</option>`).join("") + "</optgroup>").join("");
  state.profile.team = state.profile.player = "";
}

async function start() {
  await fetch(`/api/live/${state.seed}/start?restart=true&speed=${$("speed").value}`, { method: "POST" });
  reset();
  reconnect();
}

function reset() {
  state.trail = []; state.control = []; state.cards.clear(); state.score = [0, 0]; state.minute = 0;
  $("feed").innerHTML = ""; for (const s of document.querySelectorAll(".slot")) s.innerHTML = "";
  updateScore();
}

function reconnect() {
  if (!state.seed) return;
  if (state.es) state.es.close();
  const p = state.profile;
  const q = new URLSearchParams({ mode: p.mode, lang: p.lang, team: p.team, player: p.player, metric: p.metric,
                                  speed: $("speed").value });
  state.cards.clear(); $("feed").innerHTML = "";
  state.es = new EventSource(`/api/live/${state.seed}/stream?${q}`);
  state.es.onmessage = (m) => handle(JSON.parse(m.data));
  $("idle").classList.add("hidden");
}

// ------------------------------------------------------------------ stream
let historyMode = true;
function handle(msg) {
  if (msg.type === "hello") {
    historyMode = true;
    $("agents-badge").textContent = msg.agents ? "AI agents on" : "template mode";
    setTimeout(() => (historyMode = false), 400);
  } else if (msg.type === "event") onEvent(msg.event);
  else if (msg.type === "state") onState(msg.state);
  else if (msg.type === "card") onCard(msg.card);
  else if (msg.type === "end") $("ticker").textContent = "Match over.";
}

function onEvent(e) {
  if (!e.location) return;
  const away = e.team_id === state.meta.away.id;
  const flip = ([x, y]) => (away ? [120 - x, 80 - y] : [x, y]);
  state.trail.push({ from: flip(e.location), to: e.end_location ? flip(e.end_location) : null, away, type: e.type,
                     outcome: e.outcome });
  if (state.trail.length > 14) state.trail.shift();
  state.minute = e.minute;
  $("sb-clock").textContent = `${e.minute}'`;
  $("ticker").textContent = `${e.minute}' ${e.type}${e.player_name ? " · " + e.player_name : ""}${e.outcome ? " · " + e.outcome : ""}`;
  drawPitch();
}

function onState(s) {
  const { home, away } = state.meta;
  state.score = [s.score[home.id], s.score[away.id]];
  state.minute = s.minute;
  updateScore();
  const wp = s.win_prob;
  const bar = $("wp");
  bar.querySelector(".h").style.width = `${wp.home * 100}%`;
  bar.querySelector(".d").style.width = `${wp.draw * 100}%`;
  bar.querySelector(".a").style.width = `${wp.away * 100}%`;
  $("wp-legend").innerHTML = `<span>${home.short_name} ${Math.round(wp.home * 100)}%</span>` +
    `<span>Draw ${Math.round(wp.draw * 100)}%</span><span>${away.short_name} ${Math.round(wp.away * 100)}%</span>`;
  state.control = s.control_history || [];
  drawControl();
  const a = s.stats[home.id], b = s.stats[away.id];
  const pct = (x) => (x == null ? "-" : `${Math.round(x * 100)}%`);
  const tot = a.possession_s + b.possession_s || 1;
  const rows = [
    ["Possession", pct(a.possession_s / tot), pct(b.possession_s / tot)],
    ["xG", a.xg.toFixed(2), b.xg.toFixed(2)], ["Shots", a.shots, b.shots], ["On target", a.on_target, b.on_target],
    ["Pass completion", pct(a.pass_completion), pct(b.pass_completion)], ["Pressures", a.pressures, b.pressures],
  ];
  $("stats").innerHTML = rows.map(([k, x, y]) => `<tr><td>${x}</td><td>${k}</td><td>${y}</td></tr>`).join("");
}

function updateScore() {
  $("sb-score").textContent = `${state.score[0]} - ${state.score[1]}`;
  $("sb-clock").textContent = `${state.minute}'`;
}

function onCard(c) {
  const prev = state.cards.get(c.card_id);
  state.cards.set(c.card_id, c);
  addToFeed(c, prev);
  if (!historyMode && (!prev || c.version > prev.version)) showOverlay(c, !!prev);
}

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])); }

function metricsHtml(m) {
  return Object.entries(m || {}).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => {
    const val = typeof v === "number" ? (Math.abs(v) < 1 && k !== "difficulty" ? v.toFixed(2) : Math.round(v)) : v;
    return `<span>${esc(val)} ${esc(METRIC_LABEL[k] ?? k)}</span>`;
  }).join("");
}

function cardHtml(c) {
  const label = KIND_LABEL[state.profile.lang][c.kind] || c.kind;
  return `<div class="k"><span>${c.minute}' · ${esc(label)}</span>${c.source === "agents" ? '<span class="ai">AI</span>' : ""}</div>
    <div class="h">${esc(c.headline)}</div>${c.body ? `<div class="b">${esc(c.body)}</div>` : ""}
    ${c.metrics && Object.keys(c.metrics).length ? `<div class="m">${metricsHtml(c.metrics)}</div>` : ""}`;
}

function showOverlay(c, upgrade) {
  const slot = $(`slot-${c.placement}`) || $("slot-lower_third");
  let el = slot.querySelector(`[data-id="${c.card_id}"]`);
  if (!el) {
    if (upgrade) return; // the moment already left the screen; the feed shows the upgrade
    slot.innerHTML = "";
    el = document.createElement("div");
    el.dataset.id = c.card_id;
    slot.appendChild(el);
  }
  el.className = `ov${c.your_player || c.your_team ? " mine" : ""}`;
  el.innerHTML = cardHtml(c);
  const ms = (c.duration_s || 8) * 1000 * (20 / +$("speed").value) ** 0.5;
  clearTimeout(el._t);
  const takeover = c.placement === "full_screen";
  if (takeover) $("stage").classList.add("takeover");
  el._t = setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => { el.remove(); if (takeover) $("stage").classList.remove("takeover"); }, 400);
  }, Math.max(ms, 3500));
}

function addToFeed(c, prev) {
  let li = $("feed").querySelector(`[data-id="${c.card_id}"]`);
  if (!li) {
    li = document.createElement("li");
    li.dataset.id = c.card_id;
    $("feed").prepend(li);
  }
  li.className = c.your_player || c.your_team ? "mine" : "";
  li.innerHTML = `<span class="t">${c.minute}'</span>${c.source === "agents" ? '<span class="ai">AI </span>' : ""}${esc(c.headline)}` +
    (c.body ? `<span class="why">${esc(c.body)}</span>` : "");
}

// ------------------------------------------------------------------ drawing
function drawPitch() {
  const cv = $("pitch"), g = cv.getContext("2d");
  const W = cv.width, H = cv.height, sx = W / 120, sy = H / 80;
  g.fillStyle = "#0f5132"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 12; i++) if (i % 2) { g.fillStyle = "#11593a"; g.fillRect(i * W / 12, 0, W / 12, H); }
  g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 2;
  const r = (x, y, w, h) => g.strokeRect(x * sx, y * sy, w * sx, h * sy);
  r(1, 1, 118, 78); g.beginPath(); g.moveTo(60 * sx, 1 * sy); g.lineTo(60 * sx, 79 * sy); g.stroke();
  g.beginPath(); g.arc(60 * sx, 40 * sy, 10 * sx, 0, Math.PI * 2); g.stroke();
  r(1, 18, 18, 44); r(101, 18, 18, 44); r(1, 30, 6, 20); r(113, 30, 6, 20);
  const home = getComputedStyle(document.documentElement).getPropertyValue("--home").trim();
  const away = getComputedStyle(document.documentElement).getPropertyValue("--away").trim();
  state.trail.forEach((t, i) => {
    const a = (i + 1) / state.trail.length;
    g.globalAlpha = 0.25 + 0.75 * a;
    const col = t.away ? away : home;
    if (t.to) {
      g.strokeStyle = col; g.lineWidth = t.type === "Shot" ? 4 : 2.5;
      g.setLineDash(t.type === "Carry" ? [8, 6] : []);
      g.beginPath(); g.moveTo(t.from[0] * sx, t.from[1] * sy); g.lineTo(t.to[0] * sx, t.to[1] * sy); g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = col; g.beginPath(); g.arc(t.from[0] * sx, t.from[1] * sy, 7, 0, Math.PI * 2); g.fill();
  });
  g.globalAlpha = 1;
  const last = state.trail.at(-1);
  if (last) {
    const [bx, by] = last.to || last.from;
    g.fillStyle = "#fff"; g.strokeStyle = "#111"; g.lineWidth = 2;
    g.beginPath(); g.arc(bx * sx, by * sy, 9, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}

function drawControl() {
  const cv = $("control"), g = cv.getContext("2d"), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const pts = state.control;
  g.strokeStyle = "rgba(255,255,255,.18)"; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  if (pts.length < 2) return;
  const x = (i) => (i / (pts.length - 1)) * (W - 8) + 4, y = (v) => H / 2 - v * (H / 2 - 8);
  const home = getComputedStyle(document.documentElement).getPropertyValue("--home").trim();
  const away = getComputedStyle(document.documentElement).getPropertyValue("--away").trim();
  pts.forEach((p, i) => {  // chaos as a soft band behind the line
    g.fillStyle = `rgba(255,90,95,${p.chaos * 0.35})`; g.fillRect(x(i) - W / pts.length / 2, 0, W / pts.length + 1, H);
  });
  for (let i = 1; i < pts.length; i++) {
    g.strokeStyle = pts[i].control >= 0 ? home : away; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x(i - 1), y(pts[i - 1].control)); g.lineTo(x(i), y(pts[i].control)); g.stroke();
  }
  g.fillStyle = "#8fa1b5"; g.font = "12px system-ui";
  g.fillText(state.meta.home.short_name, 6, 14); g.fillText(state.meta.away.short_name, 6, H - 6);
  g.fillText(`${pts.at(-1).minute}'`, W - 30, 14);
}

init();
