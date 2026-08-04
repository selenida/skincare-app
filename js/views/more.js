// views/more.js — routine editor, breaks, morning card, GitHub, PIN, export.

import { h, download, humanShort, daysBetween, addDays } from "../util.js";
import { DB, saveProducts, saveState, exportAll, getToken, setToken, allNights, getNight, setNight } from "../state.js";
import { bus } from "../bus.js";
import { sync, drain, testConnection, restoreAll } from "../sync.js";
import { startBreak, endBreak, adjustStart } from "../engine.js";
import { AM_REFERENCE } from "../seed.js";
import { setPin, pinIsSet } from "../photos.js";
import { composeRoutine, resolveNightType } from "../schedule.js";

const ui = { open: null, tokenMsg: null };

export function renderMore(root) {
  root.append(section("routine", "Edit my routine", "Add, reorder or remove steps", renderEditor));
  root.append(section("start", "Start date", `Week 1 began ${humanShort(DB.state.startDate)}`, renderStart));
  root.append(section("morning", "Morning routine", "Reference only — not tracked", renderMorning));
  root.append(section("break", "Take a break", breakSub(), renderBreak));
  root.append(h("div", { class: "sec" }, "Data"));
  root.append(section("github", "GitHub", githubSub(), renderGithub));
  root.append(section("pin", "Photos PIN", pinIsSet() ? "Set" : "Not set", renderPin));
  root.append(section("export", "Export", "Everything, or a summary for your dermatologist", renderExport));
  root.append(h("div", { class: "disc big-disc" },
    h("strong", {}, "This isn't medical advice. "),
    "It tracks a routine you decided on and can't examine your skin. Patch test new products. If something burns, swells, weeps, cracks, or keeps getting worse, stop and see a dermatologist. ",
    "The pacing follows published dermatology guidance, but guidance is written for populations — you are one person with sensitive, eczema-prone skin, and you get the final say."));
}

function section(id, title, sub, body) {
  const open = ui.open === id;
  const row = h("div", { class: "mrow", onclick: () => { ui.open = open ? null : id; bus.rerender(); } },
    h("span", {}, h("span", { class: "nm" }, title), h("div", { class: "sub" }, sub)),
    h("span", { class: "arw" }, open ? "⌄" : "›"));
  if (!open) return row;
  const panel = h("div", { class: "mpanel" });
  body(panel);
  return h("div", {}, row, panel);
}

// ---- routine editor ----
function renderEditor(panel) {
  const templates = DB.products.templates;
  for (const [key, tpl] of Object.entries(templates)) {
    panel.append(h("div", { class: "sec" }, tpl.label || key));
    tpl.steps.forEach((s, i) => {
      panel.append(h("div", { class: "estep" },
        h("span", { class: "estep-lbl" }, s.label, s.optional ? " (optional)" : ""),
        h("span", { class: "estep-btns" },
          h("button", { class: "btn-sm ghost", onclick: () => { if (i > 0) { tpl.steps.splice(i, 1); tpl.steps.splice(i - 1, 0, s); saveProducts(); bus.rerender(); } } }, "↑"),
          h("button", { class: "btn-sm ghost", onclick: () => { if (i < tpl.steps.length - 1) { tpl.steps.splice(i, 1); tpl.steps.splice(i + 1, 0, s); saveProducts(); bus.rerender(); } } }, "↓"),
          h("button", { class: "btn-sm ghost", onclick: () => { if (confirm(`Remove “${s.label}” from ${tpl.label}?`)) { tpl.steps.splice(i, 1); saveProducts(); bus.rerender(); } } }, "✕"))));
    });
    const add = h("input", { class: "inputline", placeholder: `Add a step to ${tpl.label}…` });
    add.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && add.value.trim()) {
        tpl.steps.splice(tpl.steps.length - 1, 0, { id: "custom-" + Date.now().toString(36), label: add.value.trim(), optional: false });
        saveProducts(); bus.rerender();
      }
    });
    panel.append(add);
  }
  panel.append(h("p", { class: "disc" }, "The retinal, buffer and wait steps carry the safety logic — removing them removes the guidance too."));
}

// ---- start date ----
function renderStart(panel) {
  panel.append(h("p", { class: "sub" },
    "The app started counting the night you first opened it. If your real first retinal night was earlier, set it here — that night gets logged as fully completed and the whole schedule shifts to match."));
  const input = h("input", { class: "inputline", type: "date", value: DB.state.startDate, min: addDays(bus.todayIso, -14), max: addDays(bus.todayIso, -1) });
  panel.append(input);
  panel.append(h("div", { class: "choices" },
    h("button", { class: "choice primary", onclick: () => {
      const d = input.value;
      if (!d || d >= bus.todayIso) return alert("Pick a date before today.");
      if (d < addDays(bus.todayIso, -14)) return alert("That's more than two weeks back — tell Claude instead, this tool isn't meant for that.");
      if (!confirm(`Set ${humanShort(d)} as Week 1, Night 1 (retinal, completed)? Tonight's plan is recalculated — any steps already ticked tonight reset.`)) return;

      const entry = adjustStart(DB.state, d);
      entry.steps = composeRoutine(DB.products, "retinal", {
        woreMakeup: false, sandwichFull: true,
        peptideOnRetinalNights: DB.state.retinal.peptideOnRetinalNights,
      }).map((s) => ({ id: s.id, done: true, at: null }));
      setNight(d, entry, { message: `Backfill ${d} — first retinal night (start-date adjustment)` });

      // re-resolve tonight under the corrected schedule
      const tonight = getNight(bus.todayIso);
      if (!tonight || tonight.status !== "completed") {
        const { type, reason } = resolveNightType(DB.state, bus.todayIso);
        setNight(bus.todayIso, { type, reason, status: "open", steps: [], woreMakeup: tonight ? tonight.woreMakeup : null });
      }
      saveState();
      ui.open = null;
      bus.events = [{ kind: "ok", title: `Week 1 now starts ${humanShort(d)}`, body: "That night is logged as your first retinal night, and tonight has been recalculated to match." }];
      bus.navigate("#/tonight");
    } }, "Save")));
}

// ---- morning ----
function renderMorning(panel) {
  const oilInUse = DB.products.shelf.some((p) => p.id === "sunday-riley-ceo-glow" && p.status === "in-use");
  const steps = oilInUse ? AM_REFERENCE.withOil : AM_REFERENCE.withSerum;
  for (const s of steps) {
    panel.append(h("div", { class: "estep" },
      h("span", { class: "estep-lbl" }, s.label, s.optional ? " (optional)" : "", s.note && h("div", { class: "sub" }, s.note))));
  }
  if (oilInUse) panel.append(h("p", { class: "disc" }, "Order shifts when C.E.O. Glow runs out — the Maelove serum moves to step 2."));
}

// ---- break ----
function breakSub() {
  return DB.state.break.active
    ? (DB.state.break.kind === "reduced" ? "On a reduced break — 1 night a week" : "On a full break")
    : "Reduce or pause retinal";
}
function renderBreak(panel) {
  const s = DB.state;
  if (s.break.active) {
    panel.append(h("p", { class: "sub" }, `Since ${humanShort(s.break.startedDate)}.`));
    panel.append(h("div", { class: "choices" },
      h("button", { class: "choice primary", onclick: () => { bus.events = endBreak(s, bus.todayIso); saveState(); ui.open = null; bus.rerender(); } }, "End the break")));
    return;
  }
  panel.append(h("p", { class: "sub" }, "Life happens. Two kinds:"));
  panel.append(h("div", { class: "choices stack" },
    h("button", { class: "choice primary", onclick: () => { bus.events = startBreak(s, bus.todayIso, "reduced"); saveState(); ui.open = null; bus.rerender(); } }, "Reduced — 1 night a week (recommended)"),
    h("button", { class: "choice", onclick: () => { bus.events = startBreak(s, bus.todayIso, "full"); saveState(); ui.open = null; bus.rerender(); } }, "Full stop")));
  panel.append(h("p", { class: "disc" }, "Keeping one night a week holds on to most of what you've built. A full stop drifts back toward baseline over ~4–5 months. Coming back after a gap eases in automatically."));
}

// ---- github ----
function githubSub() {
  if (!getToken()) return "Not connected";
  const map = { synced: "Connected · everything synced", syncing: "Syncing…", "syncing-later": `${sync.pending} pending`, offline: `Offline · ${sync.pending} pending`, "auth-failed": "⚠ Reconnect needed", "rate-limited": "Rate limited — retrying later", idle: "Connected" };
  return map[sync.status] || sync.status;
}
function renderGithub(panel) {
  const input = h("input", { class: "inputline", type: "password", placeholder: getToken() ? "Replace token…" : "Paste your github_pat_… token", autocomplete: "off" });
  panel.append(input);
  if (ui.tokenMsg) panel.append(h("p", { class: ui.tokenMsg.ok ? "ok-text" : "warn-text" }, ui.tokenMsg.text));
  panel.append(h("div", { class: "choices" },
    h("button", { class: "choice primary", onclick: async () => {
      if (input.value.trim()) setToken(input.value.trim());
      const t = await testConnection();
      ui.tokenMsg = t.ok ? { ok: true, text: "Connected. Everything queued now syncs." } : { ok: false, text: t.why };
      if (t.ok) drain();
      bus.rerender();
    } }, getToken() ? "Test / save" : "Connect"),
    getToken() && h("button", { class: "choice", onclick: () => { drain(); } }, "Sync now")));
  panel.append(h("p", { class: "disc" }, `Queue: ${sync.pending} pending. ${sync.lastError ? "Last error: " + sync.lastError : ""} The token lives only on this phone, scoped to the skincare-data repo.`));
  panel.append(h("div", { class: "choices" },
    h("button", { class: "choice warn-line", onclick: async () => {
      if (!confirm("Replace everything on this phone with what's in GitHub? Unsynced local changes are lost.")) return;
      try { await restoreAll(); location.reload(); } catch (e) { alert("Restore failed: " + e.message); }
    } }, "Restore from GitHub")));
}

// ---- pin ----
function renderPin(panel) {
  const p1 = h("input", { class: "inputline", type: "password", inputmode: "numeric", maxlength: 8, placeholder: "New PIN (4+ digits)" });
  const p2 = h("input", { class: "inputline", type: "password", inputmode: "numeric", maxlength: 8, placeholder: "Repeat it" });
  panel.append(p1, p2);
  panel.append(h("div", { class: "choices" },
    h("button", { class: "choice primary", onclick: async () => {
      if (p1.value.length < 4) return alert("4 digits minimum.");
      if (p1.value !== p2.value) return alert("They don't match.");
      await setPin(p1.value);
      ui.open = null; bus.rerender();
    } }, "Set PIN"),
    pinIsSet() && h("button", { class: "choice", onclick: async () => { await setPin(""); ui.open = null; bus.rerender(); } }, "Remove PIN")));
  panel.append(h("p", { class: "disc" }, "This hides the photos section in the app. It is a privacy curtain, not encryption — your phone's own lock is the real protection."));
}

// ---- export ----
function renderExport(panel) {
  panel.append(h("div", { class: "choices stack" },
    h("button", { class: "choice", onclick: () => {
      download(`skincare-export-${bus.todayIso}.json`, JSON.stringify(exportAll(), null, 2));
    } }, "Everything (JSON)"),
    h("button", { class: "choice", onclick: () => {
      download(`skincare-derm-summary-${bus.todayIso}.txt`, dermSummary(), "text/plain");
    } }, "Dermatologist summary (text)")));
}

function dermSummary() {
  const s = DB.state;
  const nights = allNights();
  const lines = [
    "SKINCARE TRACKING SUMMARY (auto-generated, patient-logged data)",
    `Generated: ${bus.todayIso}`,
    "",
    `Retinoid: Dr. Different Vitalift-A Forte (0.1% retinaldehyde)`,
    `Started: ${s.startDate} (week ${Math.floor(daysBetween(s.startDate, bus.todayIso) / 7) + 1})`,
    `Current frequency: ${s.retinal.freq} nights/week, ${s.retinal.sandwich === "FULL" ? "moisturizer sandwich (buffered)" : "moisturizer after only"}`,
    `Azelaic acid 10%: ${s.azelaic.active ? s.azelaic.freq + " nights/week since " + s.azelaic.dwellStartDate : "not started"}`,
    "",
    "IRRITATION EVENTS (grade 2 = redness/stinging >24h; grade 3 = itch/weeping/swelling):",
  ];
  const events = Object.entries(nights)
    .filter(([, n]) => n.checkIn?.grade >= 2)
    .sort();
  if (!events.length) lines.push("  none logged");
  for (const [d, n] of events) {
    const zones = (n.checkIn.zones || []).map((z) => (typeof z === "string" ? z : z.id)).join(", ");
    lines.push(`  ${d}: grade ${n.checkIn.grade}${zones ? " — zones: " + zones : ""}${n.checkIn.triggers?.length ? " — possible triggers: " + n.checkIn.triggers.join(", ") : ""}`);
  }
  lines.push("", "FLARES:");
  if (!s.flareHistory.length) lines.push("  none");
  for (const f of s.flareHistory) lines.push(`  ${f.startedDate} → ${f.resolvedDate} (${f.days} days), zones: ${(f.zones || []).map((z) => (typeof z === "string" ? z : z.id)).join(", ") || "n/a"}`);
  lines.push("", `PHOTOS on file: ${DB.photos.photos.length} (baseline + 12-weekly + flare series), available on request.`);
  return lines.join("\n");
}
