// views/tonight.js — the screen that matters. Opens on tonight's routine,
// swipe right for previous days (max 7 back), check-in when done.

import { h, human, addDays, daysBetween, isDaytime } from "../util.js";
import { DB, saveState, setNight, getNight, allNights } from "../state.js";
import { resolveNightType, composeRoutine } from "../schedule.js";
import * as E from "../engine.js";
import { bus } from "../bus.js";
import { ZONES, TRIGGER_TAGS } from "../seed.js";
import { addPhoto } from "../photos.js";

// transient per-date UI state (check-in stage etc.)
const ui = { date: null, stage: null, feel: null, flags: [], zones: [], triggers: [], flareTrend: null };

function resetUi(date) {
  if (ui.date !== date) Object.assign(ui, { date, stage: null, feel: null, flags: [], zones: [], triggers: [], flareTrend: null });
}

export function renderTonight(root) {
  const today = bus.todayIso;
  const date = bus.viewDate || today;
  const isToday = date === today;
  resetUi(date);

  const state = DB.state;
  const nights = allNights();
  let night = nights[date];

  // resolve tonight's type once and store it
  if (isToday && !night) {
    const { type, reason } = resolveNightType(state, date);
    night = { type, reason, status: "open", steps: [], woreMakeup: null };
    setNight(date, night, { message: `Night ${date} — ${type} started` });
  }

  const type = night?.type || resolveNightType(state, date).type;
  const reason = night?.reason || resolveNightType(state, date).reason;

  // header pill area
  root.append(
    h("div", { class: "nt-head" },
      h("span", { class: `pill ${type}` }, pillLabel(type, state)),
      h("div", { class: "why" }, reason),
      !isToday && h("div", { class: "past-band" }, `← Viewing ${human(date)} · tap ‹ › or swipe for other days`),
    )
  );

  // engine event cards (results of automatic actions)
  for (const ev of bus.events) {
    root.append(eventCard(ev));
  }

  // suggestion (today only, before/after steps depending on type)
  if (isToday) {
    const sugg = E.computeSuggestion(state, nights, today, {
      daytime: isDaytime(),
      photos: DB.photos.photos,
    });
    if (sugg) root.append(suggestionCard(sugg, nights));
  }

  if (!night && !isToday) {
    root.append(backfillCard(date));
    root.append(navRow(date, today));
    return;
  }

  // makeup question
  if (night.woreMakeup === null) {
    root.append(
      h("div", { class: "card" },
        h("h3", {}, "Did you wear sunscreen or makeup today?"),
        h("div", { class: "choices" },
          choiceBtn("Yes", "primary", () => setMakeup(date, night, true)),
          choiceBtn("No", "", () => setMakeup(date, night, false)),
        )
      )
    );
  } else {
    // steps
    const steps = stepsFor(state, night);
    const total = steps.filter((s) => !s.optional).length;
    const done = steps.filter((s) => !s.optional && stepDone(night, s.id)).length;
    root.append(h("div", { class: "progress" }, h("i", { style: { width: `${total ? (done / total) * 100 : 0}%` } })));
    root.append(
      h("div", { class: "makeup-toggle", onclick: () => setMakeup(date, night, !night.woreMakeup) },
        night.woreMakeup ? "wore makeup/SPF today ✓" : "no makeup/SPF today", " — tap to change")
    );
    for (const s of steps) root.append(stepRow(state, night, date, s));

    // check-in / flare check-in when all required steps are done
    const complete = steps.filter((s) => !s.optional).every((s) => stepDone(night, s.id));
    if (complete && !night.checkIn) {
      markCompleted(state, night, date);
      root.append(state.flare.active ? flareCheckInCard(date, nights) : checkInCard(date, night, nights));
    } else if (night.checkIn) {
      root.append(
        h("div", { class: "card ok-soft" },
          h("p", {}, `Logged: ${night.checkIn.label}.`,
            night.checkIn.grade === 1 ? " Normal, especially in the first few weeks." : ""))
      );
      if (!isToday) root.append(h("div", { class: "disc" }, "Tap a step to correct this night; the check-in stands."));
    }
  }

  // flare controls
  if (state.flare.active && isToday) {
    root.append(
      h("div", { class: "rescue-btn", onclick: () => resolveFlareFlow(today) }, "Mark this flare resolved")
    );
  }

  // rescue button (always reachable, today only)
  if (isToday && !state.rescue.active) {
    root.append(h("div", { class: "rescue-btn", onclick: () => rescueFlow(today) }, "My skin needs a break tonight"));
  }
  if (isToday && state.rescue.active) {
    root.append(h("div", { class: "rescue-btn on", onclick: () => rescueExitFlow(today, nights) }, "Barrier rescue is on — tap to end it"));
  }

  root.append(navRow(date, today));
  attachSwipe(root, date, today);
}

function pillLabel(type, state) {
  if (type === "retinal") return "Retinal night";
  if (type === "azelaic") return "Azelaic night";
  if (type === "rescue") return "Barrier rescue";
  if (state.flare.active) return `Flare — day ${daysBetween(state.flare.startedDate, bus.todayIso) + 1}`;
  return "Recovery night";
}

function stepsFor(state, night) {
  const sandwichFull = state.retinal.sandwich === "FULL" || state.retinal.forceFullCount > 0;
  return composeRoutine(DB.products, night.type, {
    woreMakeup: night.woreMakeup,
    sandwichFull,
    peptideOnRetinalNights: state.retinal.peptideOnRetinalNights,
  });
}

const stepDone = (night, id) => (night.steps || []).some((s) => s.id === id && s.done);

function setMakeup(date, night, val) {
  night.woreMakeup = val;
  if (date === bus.todayIso) {
    DB.state.makeupAnswer = { date, woreMakeup: val };
    saveState();
  }
  setNight(date, night);
  bus.rerender();
}

function stepRow(state, night, date, s) {
  const done = stepDone(night, s.id);
  if (s.kind === "timer") return timerRow(night, date, s, done);
  return h("div", { class: `step ${done ? "done" : ""} ${s.optional ? "optional" : ""}`, onclick: () => toggleStep(state, night, date, s.id) },
    h("span", { class: "box" }),
    h("span", { class: "step-body" },
      h("span", { class: "lbl" }, s.label, s.optional && h("span", { class: "tag" }, "optional")),
      s.product && h("div", { class: "prod" }, s.product),
      s.note && h("div", { class: "note" }, s.note),
    )
  );
}

function toggleStep(state, night, date, id) {
  night.steps = night.steps || [];
  const existing = night.steps.find((s) => s.id === id);
  if (existing) existing.done = !existing.done;
  else night.steps.push({ id, done: true, at: new Date().toISOString() });
  setNight(date, night);
  bus.rerender();
}

// Timers survive backgrounding: we store the absolute target, not a countdown.
function timerRow(night, date, s, done) {
  const key = `sc.timer.${date}.${s.id}`;
  const target = Number(sessionStorage.getItem(key) || 0);
  const now = Date.now();
  const running = target > now;
  const row = h("div", { class: `step timer ${done ? "done" : ""}` });
  const body = h("span", { class: "step-body" },
    h("span", { class: "lbl" }, `${s.label} ${s.range || ""}`, s.optional && h("span", { class: "tag" }, "optional")),
    s.note && h("div", { class: "note" }, s.note));
  const right = h("span", { class: "timer-right" });

  if (done) {
    row.append(h("span", { class: "box" }), body);
    row.onclick = () => toggleStep(DB.state, night, date, s.id);
  } else if (running) {
    const count = h("div", { class: "count" });
    const tick = () => {
      const left = Math.max(0, Math.round((target - Date.now()) / 1000));
      count.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      if (left <= 0) {
        clearInterval(iv);
        sessionStorage.removeItem(key);
        try { navigator.vibrate && navigator.vibrate(200); } catch {}
        beep();
        toggleStep(DB.state, night, date, s.id);
      }
    };
    const iv = setInterval(tick, 500);
    tick();
    right.append(count, h("button", { class: "btn-sm", onclick: (e) => { e.stopPropagation(); clearInterval(iv); sessionStorage.removeItem(key); toggleStep(DB.state, night, date, s.id); } }, "Skip"));
    row.append(body, right);
  } else {
    right.append(h("button", { class: "btn-sm", onclick: (e) => {
      e.stopPropagation();
      sessionStorage.setItem(key, String(Date.now() + s.minutes * 60e3));
      bus.rerender();
    } }, "Start timer"),
    h("button", { class: "btn-sm ghost", onclick: (e) => { e.stopPropagation(); toggleStep(DB.state, night, date, s.id); } }, "Skip"));
    row.append(body, right);
  }
  return row;
}

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = 660; gain.gain.value = 0.08;
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.18);
  } catch {}
}

function markCompleted(state, night, date) {
  if (night.status !== "completed") {
    night.status = "completed";
    if (night.type === "retinal" && !night.retinalCounted) {
      night.retinalCounted = true;
      night.sandwich = state.retinal.sandwich;
      E.onRetinalCompleted(state, date);
      saveState();
    }
    setNight(date, night, { message: `Night ${date} — ${night.type} completed` });
  }
}

// ---- normal check-in ----
function checkInCard(date, night, nights) {
  const card = h("div", { class: "card checkin" });

  if (!ui.stage) {
    card.append(
      h("h3", {}, "How does your skin feel tonight?"),
      h("div", { class: "choices stack" },
        choiceBtn("Fine", "primary", () => saveCheckIn(date, night, nights, "fine", [], [], [])),
        choiceBtn("A bit dry or tight", "warn-line", () => saveCheckIn(date, night, nights, "dry", [], [], [])),
        choiceBtn("Irritated", "alert-line", () => { ui.stage = "flags"; bus.rerender(); }),
      )
    );
    return card;
  }

  if (ui.stage === "flags") {
    const flagChips = ["itchy", "weeping", "swollen", "red 2+ days"].map((f) =>
      chip(f === "weeping" ? "weeping or cracked" : f, ui.flags.includes(f), () => {
        ui.flags = ui.flags.includes(f) ? ui.flags.filter((x) => x !== f) : [...ui.flags, f];
        bus.rerender();
      }));
    card.append(
      h("div", { class: "card-sect alert-soft" },
        h("h3", {}, "Any of these?"),
        h("p", { class: "sub" }, "Tap all that apply."),
        h("div", { class: "chips" }, flagChips,
          chip("none of these", ui.flags.length === 0, () => { ui.flags = []; bus.rerender(); }))),
      h("div", { class: "card-sect" },
        h("h3", {}, "Where is it?"),
        faceMap(ui.zones, (z) => {
          ui.zones = ui.zones.includes(z) ? ui.zones.filter((x) => x !== z) : [...ui.zones, z];
          bus.rerender();
        })),
      h("div", { class: "card-sect" },
        h("h3", {}, "Anything that might explain it?"),
        h("p", { class: "sub" }, "Optional — over time this shows what your flares actually track with."),
        h("div", { class: "chips" }, TRIGGER_TAGS.map((t) =>
          chip(t, ui.triggers.includes(t), () => {
            ui.triggers = ui.triggers.includes(t) ? ui.triggers.filter((x) => x !== t) : [...ui.triggers, t];
            bus.rerender();
          })))),
      h("div", { class: "choices" },
        choiceBtn("Save", "primary", () => saveCheckIn(date, night, nights, "irritated", ui.flags, ui.zones, ui.triggers)))
    );
  }
  return card;
}

function saveCheckIn(date, night, nights, feel, flags, zones, triggers) {
  const { grade, label } = E.gradeCheckIn(feel, flags);
  night.checkIn = { grade, label, flags, zones: zones.map((z) => ({ id: z, severity: grade })), triggers, note: null, at: new Date().toISOString() };
  nights[date] = night;
  const events = E.applyCheckIn(DB.state, nights, date, night.checkIn);
  events.push(...E.sandwichRevertIfNeeded(DB.state, nights, date));
  E.checkEscalation(DB.state, nights, date);
  saveState();
  setNight(date, night, { message: `Check-in ${date} — ${label}` });
  bus.events = events;
  ui.stage = null; ui.flags = []; ui.zones = []; ui.triggers = [];
  bus.rerender();
}

// ---- flare check-in ----
function flareCheckInCard(date, nights) {
  const f = DB.state.flare;
  const card = h("div", { class: "card warn-soft" },
    h("h3", {}, "How is it today?"),
    h("div", { class: "choices" },
      choiceBtn("Calm", "primary", () => saveFlare(date, nights, "calm")),
      choiceBtn("Better", "", () => saveFlare(date, nights, "better")),
      choiceBtn("Same", "", () => saveFlare(date, nights, "same")),
      choiceBtn("Worse", "alert-line", () => saveFlare(date, nights, "worse")),
    ),
    h("div", { class: "card-sect" },
      h("h3", {}, "Where is it?"),
      f.zones?.length ? h("button", { class: "btn-sm", onclick: () => saveFlare(date, nights, ui.flareTrend || "same") }, "Same as yesterday") : null,
      faceMap(ui.zones.length ? ui.zones : (f.zones || []).map(z => typeof z === 'string' ? z : z.id), (z) => {
        const cur = ui.zones.length ? ui.zones : (f.zones || []).map(zz => typeof zz === 'string' ? zz : zz.id);
        ui.zones = cur.includes(z) ? cur.filter((x) => x !== z) : [...cur, z];
        bus.rerender();
      })),
  );
  return card;
}

function saveFlare(date, nights, trend) {
  const zones = ui.zones.length ? ui.zones : undefined;
  const events = E.flareCheckIn(DB.state, nights, date, trend, zones);
  saveState();
  setNight(date, nights[date], { message: `Flare check-in ${date} — ${trend}` });
  bus.events = events;
  ui.zones = [];
  bus.rerender();
}

function resolveFlareFlow(date) {
  if (!confirm("Mark this flare as resolved?")) return;
  const events = E.resolveFlare(DB.state, date);
  saveState();
  bus.events = events;
  bus.rerender();
}

function rescueFlow(date) {
  if (!confirm("Switch tonight to barrier rescue? No actives, just gentle care.")) return;
  const events = E.startRescue(DB.state, date);
  // reset tonight if not completed
  const night = getNight(date);
  if (night && night.status !== "completed") {
    setNight(date, { type: "rescue", reason: "Barrier rescue", status: "open", steps: [], woreMakeup: night.woreMakeup });
  }
  saveState();
  bus.events = events;
  bus.rerender();
}

function rescueExitFlow(date, nights) {
  const ready = E.rescueExitReady(DB.state, nights, date);
  if (!ready && !confirm("Less than 3 calm nights so far — end rescue anyway?")) return;
  const events = E.exitRescue(DB.state, date);
  saveState();
  bus.events = events;
  bus.rerender();
}

// ---- suggestion card ----
function suggestionCard(sugg, nights) {
  const card = h("div", { class: `card sugg ${sugg.kind || "info"}` },
    h("h3", {}, sugg.title),
    h("p", {}, sugg.body),
  );
  const actions = h("div", { class: "choices" });
  for (const a of sugg.actions || []) {
    actions.append(choiceBtn(a.label, a.id === "accept" || a.id === "take-photo" || a.id === "door-a" ? "primary" : "", () => actOnSuggestion(sugg, a.id, nights)));
  }
  card.append(actions);
  if (sugg.why && DB.state.settings.showReasoning) {
    const why = h("div", { class: "why-fold" }, h("span", { class: "exp" }, "Why this? ⌄"));
    why.onclick = () => { why.replaceChildren(h("p", { class: "why-text" }, sugg.why)); };
    card.append(why);
  }
  return card;
}

function actOnSuggestion(sugg, actionId, nights) {
  const today = bus.todayIso;
  if (actionId === "decline" || actionId === "later" || actionId === "noted") {
    E.declineSuggestion(DB.state, today, sugg);
    saveState();
    bus.rerender();
    return;
  }
  if (actionId === "take-photo") {
    const input = h("input", { type: "file", accept: "image/*", capture: "user", style: { display: "none" } });
    input.onchange = async () => {
      if (!input.files[0]) return;
      const kind = sugg.id === "flare-photo" ? "flare" : sugg.id === "baseline-photo" ? "baseline" : "milestone";
      await addPhoto(input.files[0], kind, today, DB.state.startDate);
      if (kind === "baseline") DB.state.settings.baselineDone = true;
      if (kind === "flare") DB.state.flare.lastPhotoDate = today;
      saveState();
      bus.events = [{ kind: "ok", title: "Photo saved", body: "Stored in your private repo. Location data is stripped automatically." }];
      bus.rerender();
    };
    document.body.append(input);
    input.click();
    return;
  }
  if (actionId === "export") {
    bus.navigate("#/more");
    return;
  }
  const events = E.acceptSuggestion(DB.state, nights, today, sugg, actionId);
  saveState();
  if (sugg.id === "azelaic-unlock") {
    const az = DB.products.shelf.find((p) => p.id === "anua-azelaic");
    if (az) { az.locked = false; }
    import("../state.js").then((m) => m.saveProducts());
  }
  bus.events = events;
  bus.rerender();
}

// ---- backfill for a swiped-to empty night ----
function backfillCard(date) {
  const { type } = resolveNightType(DB.state, date);
  return h("div", { class: "card warn-soft" },
    h("h3", {}, "You didn't log this night"),
    h("p", {}, "Did you do your routine?"),
    h("div", { class: "choices stack" },
      choiceBtn("Yes, as planned", "", () => answerBackfill(date, "yes", type)),
      choiceBtn("No", "", () => answerBackfill(date, "no", type)),
      choiceBtn("Can't remember", "", () => answerBackfill(date, "unknown", type)),
    ),
    h("p", { class: "disc" }, "“Can't remember” is neutral — it neither builds nor breaks your clean record."),
  );
}

function answerBackfill(date, answer, type) {
  const nights = allNights();
  const entry = E.answerMissedNight(DB.state, nights, date, answer, type);
  saveState();
  setNight(date, entry, { message: `Backfill ${date} — ${answer}` });
  bus.rerender();
}

// ---- shared bits ----
function eventCard(ev) {
  return h("div", { class: `card ev ${ev.kind}` }, h("h3", {}, ev.title), h("p", {}, ev.body));
}

function choiceBtn(label, variant, onclick) {
  return h("button", { class: `choice ${variant || ""}`, onclick }, label);
}

function chip(label, on, onclick) {
  return h("button", { class: `chip ${on ? "on" : ""}`, onclick }, label);
}

export function faceMap(selected, onToggle) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 128");
  svg.setAttribute("class", "facemap-svg");
  const shapes = [
    ["path", { d: "M21 41c5-15 16-24 29-24s24 9 29 24c-18-7-40-7-58 0Z" }, "forehead"],
    ["ellipse", { cx: 34, cy: 52, rx: 11, ry: 7 }, "periorbital-l"],
    ["ellipse", { cx: 66, cy: 52, rx: 11, ry: 7 }, "periorbital-r"],
    ["ellipse", { cx: 28, cy: 68, rx: 10, ry: 11 }, "cheek-l"],
    ["ellipse", { cx: 72, cy: 68, rx: 10, ry: 11 }, "cheek-r"],
    ["ellipse", { cx: 50, cy: 82, rx: 17, ry: 9 }, "perioral"],
    ["ellipse", { cx: 50, cy: 97, rx: 12, ry: 7 }, "chin"],
    ["rect", { x: 38, y: 107, width: 24, height: 17, rx: 6 }, "neck"],
  ];
  const base = document.createElementNS(svgNS, "ellipse");
  for (const [k, v] of Object.entries({ cx: 50, cy: 58, rx: 35, ry: 45, fill: "#FAFAF8", stroke: "#DDDDD7", "stroke-width": 1.4 })) base.setAttribute(k, v);
  svg.append(base);
  for (const [tag, attrs, id] of shapes) {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute("class", `zone ${selected.includes(id) ? "on" : ""}`);
    el.addEventListener("click", () => onToggle(id));
    svg.append(el);
  }
  const labels = selected.map((id) => (ZONES.find((z) => z.id === id) || {}).label).filter(Boolean);
  return h("div", { class: "facemap" }, svg,
    h("span", { class: "facelist" }, labels.length ? labels.join(", ") : "Tap where it is"));
}

// ---- day navigation ----
function navRow(date, today) {
  const minDate = addDays(today, -7);
  return h("div", { class: "daynav" },
    h("button", { class: "btn-sm", disabled: date <= minDate ? "" : null, onclick: () => { bus.viewDate = addDays(date, -1); bus.rerender(); } }, "‹ previous night"),
    date < today ? h("button", { class: "btn-sm", onclick: () => { bus.viewDate = addDays(date, 1); bus.rerender(); } }, "next ›") : h("span"),
  );
}

let swipeBound = null;
function attachSwipe(root, date, today) {
  if (swipeBound === root) return;
  swipeBound = root;
  let x0 = null, y0 = null;
  root.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  root.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    const cur = bus.viewDate || bus.todayIso;
    if (dx > 0 && cur > addDays(bus.todayIso, -7)) { bus.viewDate = addDays(cur, -1); bus.rerender(); }
    if (dx < 0 && cur < bus.todayIso) { bus.viewDate = addDays(cur, 1); bus.rerender(); }
  }, { passive: true });
}
