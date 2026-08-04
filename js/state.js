// state.js — localStorage persistence. localStorage is the source of truth;
// GitHub is durable backup. Every write lands locally first, then a hook
// enqueues the matching repo path for sync.

import { SEED_STATE, SEED_PRODUCTS } from "./seed.js";

const K = {
  state: "sc.state",
  products: "sc.products",
  reviews: "sc.reviews",
  photos: "sc.photos",
  queue: "sc.queue",
  token: "sc.token",
  pin: "sc.pin",
};

export const DB = { state: null, products: null, reviews: null, photos: null };

let persistHook = () => {};
export function setPersistHook(fn) { persistHook = fn; }

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// Merge seed defaults into stored state so new fields never crash old data.
function withDefaults(stored, seed) {
  if (stored == null) return structuredClone(seed);
  if (Array.isArray(seed) || typeof seed !== "object") return stored;
  const out = { ...stored };
  for (const [k, v] of Object.entries(seed)) {
    if (!(k in out)) out[k] = structuredClone(v);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = withDefaults(out[k], v);
  }
  return out;
}

export function load(todayIso) {
  DB.state = withDefaults(read(K.state, null), SEED_STATE);
  DB.products = withDefaults(read(K.products, null), SEED_PRODUCTS);
  DB.reviews = read(K.reviews, { version: 1, reviews: [] });
  DB.photos = read(K.photos, { version: 1, photos: [] });

  const firstRun = !DB.state.startDate;
  if (firstRun) {
    DB.state.startDate = todayIso;
    DB.state.retinal.dwellStartDate = todayIso;
    DB.state.lastChange = { retinal: todayIso, azelaic: null };
  } else if (!DB.state.settings.startAdjusted) {
    // Migration: the start-date tool shipped before its own flag existed.
    // A backfilled night on the start date means it was already used, so the
    // first-week hint must not nag about something already fixed.
    const first = getYearLog(DB.state.startDate.slice(0, 4)).nights[DB.state.startDate];
    if (first && first.backfilled) DB.state.settings.startAdjusted = true;
  }
  saveState();
  saveProducts();
  return firstRun;
}

export function saveState()    { write(K.state, DB.state);       persistHook("data/state.json"); }
export function saveProducts() { write(K.products, DB.products); persistHook("data/products.json"); }
export function saveReviews()  { write(K.reviews, DB.reviews);   persistHook("data/reviews.json"); }
export function savePhotos()   { write(K.photos, DB.photos);     persistHook("data/photos.json"); }

// ---- night log, one localStorage key per year ----
function yearOf(date) { return date.slice(0, 4); }

export function getYearLog(year) {
  return read(`sc.log.${year}`, { version: 1, year: Number(year), nights: {} });
}

export function getNight(date) {
  return getYearLog(yearOf(date)).nights[date] || null;
}

export function setNight(date, entry, opts = {}) {
  const year = yearOf(date);
  const log = getYearLog(year);
  log.nights[date] = entry;
  write(`sc.log.${year}`, log);
  persistHook(`data/log/${year}.json`, opts.message);
}

// Flat map of every logged night across all years — what the engine consumes.
export function allNights() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("sc.log.")) {
      Object.assign(out, read(key, { nights: {} }).nights);
    }
  }
  return out;
}

// ---- token / pin ----
export const getToken = () => localStorage.getItem(K.token) || "";
export const setToken = (t) => t ? localStorage.setItem(K.token, t) : localStorage.removeItem(K.token);
export const getPinHash = () => localStorage.getItem(K.pin) || "";
export const setPinHash = (h) => h ? localStorage.setItem(K.pin, h) : localStorage.removeItem(K.pin);

// ---- queue (owned by sync.js, stored here) ----
export const getQueue = () => read(K.queue, []);
export const setQueue = (q) => write(K.queue, q);

// ---- export / restore ----
export function exportAll() {
  const dump = { exportedAt: new Date().toISOString(), state: DB.state, products: DB.products, reviews: DB.reviews, photos: DB.photos, logs: {} };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("sc.log.")) dump.logs[key.slice(7)] = read(key, {});
  }
  return dump;
}

export function replaceAll(files) {
  // files: { 'data/state.json': obj, 'data/log/2026.json': obj, ... }
  for (const [path, content] of Object.entries(files)) {
    if (path === "data/state.json") write(K.state, content);
    else if (path === "data/products.json") write(K.products, content);
    else if (path === "data/reviews.json") write(K.reviews, content);
    else if (path === "data/photos.json") write(K.photos, content);
    else if (path.startsWith("data/log/")) write("sc.log." + path.slice(9, 13), content);
  }
}

// Serialize the current truth for a repo path (sync pulls content at push time,
// so a coalesced queue entry always pushes the latest data).
export function serializeForPath(path) {
  if (path === "data/state.json") return JSON.stringify(read(K.state, {}), null, 2);
  if (path === "data/products.json") return JSON.stringify(read(K.products, {}), null, 2);
  if (path === "data/reviews.json") return JSON.stringify(read(K.reviews, {}), null, 2);
  if (path === "data/photos.json") return JSON.stringify(read(K.photos, {}), null, 2);
  if (path.startsWith("data/log/")) return JSON.stringify(getYearLog(path.slice(9, 13)), null, 2);
  if (path === "README.md") return buildReadme();
  return null;
}

function buildReadme() {
  const s = DB.state || {};
  const nights = allNights();
  const dates = Object.keys(nights).sort().reverse().slice(0, 14);
  const r = s.retinal || {};
  const lines = [
    "# Skincare log",
    "",
    "Auto-generated by the app — do not edit.",
    "",
    `**Started:** ${s.startDate || "—"}  `,
    `**Retinal:** ${r.freq}×/week, ${r.sandwich === "FULL" ? "buffered" : "unbuffered"}, phase ${r.phase}  `,
    `**Azelaic:** ${s.azelaic?.active ? s.azelaic.freq + "×/week" : "not yet"}  `,
    s.flare?.active ? `**⚠ Active flare since ${s.flare.startedDate}**  ` : "",
    "",
    "| Night | Type | Skin |",
    "|---|---|---|",
  ];
  for (const d of dates) {
    const n = nights[d];
    lines.push(`| ${d} | ${n.type || "—"} | ${n.checkIn ? n.checkIn.label : n.status || "—"} |`);
  }
  return lines.filter((l) => l !== null).join("\n") + "\n";
}
