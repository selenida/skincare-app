// views/history.js — calendar heatmap, plan status, zone heat map, flare log, photos.

import { h, addDays, daysBetween, humanShort } from "../util.js";
import { DB, allNights } from "../state.js";
import { bus } from "../bus.js";
import { ZONES } from "../seed.js";
import { faceMap } from "./tonight.js";
import { pinIsSet, isUnlocked, tryUnlock } from "../photos.js";
import { renderPhotos } from "./photosview.js";

const ui = { month: null, photosOpen: false, pinTry: "" };

export function renderHistory(root) {
  if (ui.photosOpen) {
    if (!isUnlocked()) return renderPinGate(root);
    return renderPhotos(root, () => { ui.photosOpen = false; bus.rerender(); });
  }

  const nights = allNights();
  const today = bus.todayIso;
  ui.month = ui.month || today.slice(0, 7);

  root.append(calendar(nights, today));
  root.append(whereAmI(nights, today));
  root.append(zoneHeat(nights));
  root.append(flareLog());

  const photoCount = DB.photos.photos.length;
  root.append(h("div", { class: "prow", onclick: () => { ui.photosOpen = true; bus.rerender(); } },
    h("span", { style: { fontSize: "20px" } }, "🔒"),
    h("span", { style: { flex: 1 } },
      h("span", { class: "nm" }, "Progress photos"),
      h("div", { class: "sub" }, photoCount ? `${photoCount} photo${photoCount > 1 ? "s" : ""}` : "None yet")),
    pinIsSet() && h("span", { class: "badge" }, "PIN")));
}

function renderPinGate(root) {
  const input = h("input", { class: "inputline", type: "password", inputmode: "numeric", maxlength: 8, placeholder: "PIN", autofocus: true });
  root.append(h("div", { class: "card" },
    h("h3", {}, "Photos are locked"),
    input,
    h("div", { class: "choices" },
      h("button", { class: "choice", onclick: () => { ui.photosOpen = false; bus.rerender(); } }, "Back"),
      h("button", { class: "choice primary", onclick: async () => {
        if (await tryUnlock(input.value)) bus.rerender();
        else { input.value = ""; input.placeholder = "Wrong PIN"; }
      } }, "Unlock"))));
}

// ---- calendar ----
function calendar(nights, today) {
  const [y, m] = ui.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(y, m, 0).getDate();

  const monthName = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const grid = h("div", { class: "days" });
  for (let i = 0; i < startDow; i++) grid.append(h("span", { class: "d empty" }));
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${ui.month}-${String(d).padStart(2, "0")}`;
    const night = nights[iso];
    let cls = "empty2";
    if (iso > today) cls = "future";
    else if (night) {
      cls = night.status === "missed" ? "missed" : night.status === "unknown" ? "unknown" : night.type;
    } else if (iso >= (DB.state.startDate || today)) cls = "missed";
    const cell = h("span", { class: `d ${cls}` }, String(d));
    const grade = night?.checkIn?.grade;
    if (grade >= 1) cell.append(h("i", { class: `mk ${grade >= 2 ? "a" : "w"}` }));
    grid.append(cell);
  }

  return h("div", { class: "cal" },
    h("div", { class: "calhead" },
      h("button", { class: "btn-sm ghost", onclick: () => { ui.month = shiftMonth(ui.month, -1); bus.rerender(); } }, "‹"),
      h("span", { class: "m" }, monthName),
      h("button", { class: "btn-sm ghost", onclick: () => { ui.month = shiftMonth(ui.month, 1); bus.rerender(); } }, "›")),
    h("div", { class: "dow" }, ...["M", "T", "W", "T", "F", "S", "S"].map((x) => h("span", {}, x))),
    grid,
    h("div", { class: "legend" },
      legend("retinal", "Retinal"), legend("azelaic", "Azelaic"), legend("recovery", "Recovery"),
      legend("rescue", "Rescue"), legend("missed", "Missed"), legend("dot", "Irritation")));
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function legend(cls, label) {
  return h("span", {}, h("i", { class: `sw ${cls}` }), label);
}

// ---- plan status ----
function whereAmI(nights, today) {
  const s = DB.state;
  const week = Math.floor(daysBetween(s.startDate, today) / 7) + 1;
  const r = s.retinal;
  const lines = [];
  lines.push(h("p", { class: "big" },
    `Retinal ${r.freq} night${r.freq > 1 ? "s" : ""} a week` + (r.sandwich === "FULL" ? ", buffered" : "") + ".",
    s.azelaic.active ? ` Azelaic ${s.azelaic.freq} night${s.azelaic.freq > 1 ? "s" : ""}.` : ""));

  if (s.flare.active) lines.push(h("p", { class: "warn-text" }, `Flare running since ${humanShort(s.flare.startedDate)} — retinal paused.`));
  else if (r.phase === "PAUSED") lines.push(h("p", { class: "warn-text" }, "Retinal is paused; it resumes after 5 calm days."));
  else {
    // rough next-step estimate
    let next = null;
    if (!s.azelaic.unlocked && daysBetween(s.startDate, today) < 14) {
      next = `Azelaic acid is offered around ${humanShort(addDays(s.startDate, 14))} if your skin stays calm.`;
    } else if (r.freq < r.targetFreq && r.dwellStartDate) {
      const eligible = addDays(r.dwellStartDate, 28);
      next = eligible > today
        ? `Next retinal step-up can come around ${humanShort(eligible)} if the record stays clean.`
        : "A retinal step-up is close — it appears on Tonight when every condition is met.";
    } else if (r.freq >= r.targetFreq) {
      next = "You're at target. After a long clean stretch the app offers the two doors — a 4th night, or a chat with a derm about strength.";
    }
    if (next) lines.push(h("p", { class: "ok-text" }, next));
  }

  const g2 = Object.values(nights).filter((n) => n.checkIn?.grade >= 2).length;
  lines.push(h("p", { class: "sub" }, `Week ${week}. ${g2 === 0 ? "No irritation logged so far." : `${g2} irritated night${g2 > 1 ? "s" : ""} logged in total.`}`));

  return h("div", { class: "card" }, h("h3", {}, `Week ${week}`), ...lines);
}

// ---- zone heat map ----
function zoneHeat(nights) {
  const counts = {};
  let reports = 0;
  for (const n of Object.values(nights)) {
    const zones = n.checkIn?.zones || [];
    if (n.checkIn?.grade >= 2 && zones.length) {
      reports++;
      for (const z of zones) counts[typeof z === "string" ? z : z.id] = (counts[typeof z === "string" ? z : z.id] || 0) + 1;
    }
  }
  const card = h("div", { class: "card" }, h("h3", {}, "Where it happens"));
  if (reports < 5) {
    card.append(h("p", { class: "sub" }, `Not enough yet — this needs about 5 irritation reports before it means anything. (${reports} so far.)`));
    return card;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const selected = top.filter(([, c]) => c >= Math.max(1, top[0][1] * 0.5)).map(([z]) => z);
  card.append(faceMap(selected, () => {}));
  card.append(h("div", { class: "sub" }, top.slice(0, 3).map(([z, c]) =>
    `${(ZONES.find((x) => x.id === z) || {}).label || z}: ${c} of ${reports} reports`).join(" · ")));
  card.append(h("p", { class: "disc" },
    "Beside the nose and cheeks usually points at the retinal; eyelids and neck reads more like eczema. Patterns, not diagnoses."));
  return card;
}

// ---- flare log ----
function flareLog() {
  const flares = DB.state.flareHistory;
  const card = h("div", { class: "card" }, h("h3", {}, "Flares"));
  if (!flares.length) {
    card.append(h("p", { class: "sub" }, "None so far."));
    return card;
  }
  const durations = flares.map((f) => f.days);
  const median = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  card.append(h("p", { class: "big" }, `${flares.length} flare${flares.length > 1 ? "s" : ""}, median ${median} day${median > 1 ? "s" : ""}.`));
  for (const f of [...flares].reverse()) {
    card.append(h("div", { class: "flare-row" },
      h("span", {}, `${humanShort(f.startedDate)} → ${humanShort(f.resolvedDate)}`),
      h("span", { class: "sub" }, `${f.days} days`)));
  }
  return card;
}
