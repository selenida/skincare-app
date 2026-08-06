// app.js — boot, router, header/tabs, on-open processing.

import { h, human, logicalToday } from "./util.js";
import { DB, load, saveState, setNight, allNights, setPersistHook, getToken } from "./state.js";
import { enqueue, sync, initSyncTriggers } from "./sync.js";
import { resolveNightType } from "./schedule.js";
import * as E from "./engine.js";
import { bus } from "./bus.js";
import { prunePendingPayloads } from "./photos.js";
import { renderTonight } from "./views/tonight.js";
import { renderProducts } from "./views/products.js";
import { renderHistory } from "./views/history.js";
import { renderMore } from "./views/more.js";
import { icon } from "./icons.js";

const TABS = [
  ["#/tonight", "Tonight", renderTonight, () => icon("moon", "ic tab-ic")],
  ["#/products", "Products", renderProducts, () => icon("jar", "ic tab-ic")],
  ["#/history", "History", renderHistory, () => icon("calendar", "ic tab-ic")],
  ["#/more", "More", renderMore, () => icon("dots", "ic tab-ic")],
];

let backfillQueue = [];

function boot() {
  const today = logicalToday();
  bus.todayIso = today;

  setPersistHook((path, message) => {
    enqueue(path, message);
    if (path === "data/state.json" || path.startsWith("data/log/")) {
      enqueue("README.md", "Update summary");
    }
  });

  const firstRun = load(today);
  const state = DB.state;

  // on-open processing (order matters)
  const nights = allNights();
  const events = [];

  // queued products whose start date arrived
  for (const p of DB.products.shelf) {
    if (p.status === "queued" && p.startOn && p.startOn <= today) {
      p.status = "in-use";
      if (p.schedule) p.schedule.startDate = today;
      state.lastChange.azelaic = today; // generic non-retinal active stamp
      events.push({ kind: "ok", title: `${p.name} starts today`, body: "Its waiting period is over — it's in the schedule from tonight." });
    }
  }

  events.push(...E.tryAutoResume(state, nights, today));
  if (resolveNightType(state, today).type === "retinal") {
    events.push(...E.gapAdjustIfNeeded(state, today));
  }
  E.checkEscalation(state, nights, today);

  // missed nights — max 3 per sitting, handled in a modal queue before Tonight
  backfillQueue = E.missedNightDates(state, nights, today);

  state.lastOpenedDate = today;
  saveState();
  if (events.length) bus.events = events;

  prunePendingPayloads(today);

  bus.rerender = (opts) => render(opts);
  bus.navigate = (hash) => { location.hash = hash; };
  window.addEventListener("hashchange", () => { bus.events = []; bus.viewDate = null; render({ resetScroll: true }); });

  sync.onChange = renderHeaderOnly;
  initSyncTriggers();

  // iOS keeps the PWA suspended for days — boot() doesn't re-run on reopen, so
  // "today" went stale until a manual reload. Recheck whenever we come back to
  // the foreground and reboot if the logical date moved on.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && logicalToday() !== bus.todayIso) {
      location.reload();
    }
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    // When a new version takes control, reload once so updates land on the
    // FIRST reopen instead of needing the close-open-close-open dance.
    let refreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshed) { refreshed = true; location.reload(); }
    });
  }

  if (firstRun || !state.settings.disclaimerAccepted) {
    renderFirstRun();
  } else {
    render();
  }
}

// ---- first run ----
function renderFirstRun() {
  const rootEl = document.getElementById("app");
  rootEl.replaceChildren(
    h("div", { class: "screen onboard" },
      h("div", { class: "onboard-ic" }, icon("mask")),
      h("h1", { class: "onboard-title" }, "Your routine, decided for you"),
      h("p", {}, "Every night this app tells you what's on — retinal, azelaic or recovery — and paces the progression from how your skin actually responds."),
      h("div", { class: "card" },
        h("p", {},
          h("strong", {}, "Not medical advice. "),
          "It tracks a routine you decided on and can't examine your skin. Patch test new products. If something burns, swells, weeps or keeps getting worse — stop, and see a dermatologist.")),
      h("p", { class: "disc" }, "Everything stays on this phone and in your private GitHub repo. No account, no cloud, no notifications."),
      h("button", { class: "choice primary big", onclick: () => {
        DB.state.settings.disclaimerAccepted = true;
        saveState();
        render();
      } }, "Understood — let's start"),
      h("p", { class: "disc" }, "Tonight becomes Week 1, Night 1 — a retinal night. Connect GitHub any time from More; nothing is lost in the meantime.")));
}

// ---- render ----
function route() {
  const hash = location.hash || "#/tonight";
  return TABS.find(([r]) => hash.startsWith(r)) || TABS[0];
}

let lastEventsRef = null;

function render(opts = {}) {
  // Keep the scroll position across in-place rerenders (every tap rerenders).
  // Jump to top only on tab/day changes, or when new engine event cards appear
  // at the top and need to be seen.
  const newEvents = bus.events.length && bus.events !== lastEventsRef;
  lastEventsRef = bus.events;
  const y = window.scrollY;

  const rootEl = document.getElementById("app");
  const [, label, view] = route();
  rootEl.replaceChildren();

  renderHeader(rootEl, label);

  const screen = h("div", { class: "screen" });

  // backfill modal queue outranks everything on Tonight
  if (backfillQueue.length && route()[0] === "#/tonight") {
    screen.append(backfillModal(backfillQueue[0]));
  } else {
    view(screen);
  }
  rootEl.append(screen);
  renderTabs(rootEl);

  if (opts.resetScroll || newEvents) window.scrollTo(0, 0);
  else requestAnimationFrame(() => window.scrollTo(0, y));
}

function renderHeader(rootEl, label) {
  const today = bus.todayIso;
  const date = bus.viewDate || today;
  const isTonight = route()[0] === "#/tonight";
  rootEl.append(
    h("header", { class: "apphead", id: "apphead" },
      h("div", { class: "row1" },
        h("span", { class: "date" }, isTonight ? human(date) : label),
        syncDot())));
}

function renderHeaderOnly() {
  const el = document.getElementById("apphead");
  if (!el) return;
  const dot = el.querySelector(".sync");
  if (dot) dot.replaceWith(syncDot());
}

function syncDot() {
  const s = sync.status;
  const cls = s === "synced" || s === "idle" ? "" : s === "auth-failed" ? "red" : "amber";
  const label = !getToken() ? "not connected"
    : s === "synced" ? "Synced"
    : s === "auth-failed" ? "Reconnect"
    : s === "offline" ? `offline · ${sync.pending}`
    : sync.pending ? `${sync.pending} pending` : "Synced";
  return h("span", { class: "sync", onclick: () => { location.hash = "#/more"; } },
    h("span", { class: `dot ${cls}` }), label);
}

function renderTabs(rootEl) {
  const current = route()[0];
  const bar = h("nav", { class: "tabs" });
  for (const [hash, label, , icon] of TABS) {
    bar.append(h("a", { class: `tab ${hash === current ? "on" : ""}`, href: hash },
      icon(), label));
  }
  rootEl.append(bar);
}

// ---- missed-night modal ----
function backfillModal(date) {
  const { type } = resolveNightType(DB.state, date);
  const label = type === "retinal" ? "a retinal night" : type === "azelaic" ? "an azelaic night" : "a recovery night";
  const answer = (ans) => {
    const nights = allNights();
    const entry = E.answerMissedNight(DB.state, nights, date, ans, type);
    saveState();
    setNight(date, entry, { message: `Backfill ${date} — ${ans}` });
    backfillQueue.shift();
    render();
  };
  return h("div", { class: "card warn-soft" },
    h("h3", {}, `You didn't log ${human(date)}`),
    h("p", {}, `It was planned as ${label}. Did you do your routine?`),
    h("div", { class: "choices stack" },
      h("button", { class: "choice", onclick: () => answer("yes") }, "Yes, as planned"),
      h("button", { class: "choice", onclick: () => answer("no") }, "No"),
      h("button", { class: "choice", onclick: () => answer("unknown") }, "Can't remember")),
    h("p", { class: "disc" }, "“Can't remember” is neutral — it neither builds nor breaks your record."));
}

boot();
