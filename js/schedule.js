// schedule.js — PURE. What kind of night is a given date, and what steps does
// it contain. No DOM, no network, no Date.now(): the date is always a parameter.

import { addDays, daysBetween } from "./util.js";

export const GAP_PATTERNS = {
  1: [7],
  2: [3, 4],
  3: [2, 2, 3],
  4: [2, 2, 2, 1],
  5: [2, 1, 2, 1, 1],
  6: [1, 1, 2, 1, 1, 1],
  7: [1],
};

export function nextRetinalDate(state) {
  const r = state.retinal;
  if (!r.lastRetinalDate) return state.startDate;
  const pattern = GAP_PATTERNS[r.freq] || GAP_PATTERNS[2];
  return addDays(r.lastRetinalDate, pattern[r.patternIndex % pattern.length]);
}

// Dates in [from, to] that would be retinal nights, assuming each future
// retinal night gets completed on schedule.
export function projectedRetinalSet(state, from, to) {
  const set = new Set();
  const r = state.retinal;
  const pattern = GAP_PATTERNS[r.freq] || GAP_PATTERNS[2];
  let idx = r.patternIndex % pattern.length;
  // Same index semantics as onRetinalCompleted: the first-ever night consumes
  // no gap, so the index must not advance after it.
  let consumedGap = !!r.lastRetinalDate;
  let cur = r.lastRetinalDate ? addDays(r.lastRetinalDate, pattern[idx]) : state.startDate;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    if (cur >= from) set.add(cur);
    if (consumedGap) idx = (idx + 1) % pattern.length;
    else consumedGap = true;
    cur = addDays(cur, pattern[idx]);
  }
  return set;
}

// Azelaic placement: per 7-day window anchored on azelaic.dwellStartDate,
// pick the azelaic.freq nights least adjacent to projected retinal nights.
export function isAzelaicNight(state, date) {
  const a = state.azelaic;
  if (!a.active || a.freq < 1 || !a.dwellStartDate || date < a.dwellStartDate) return false;
  const off = daysBetween(a.dwellStartDate, date);
  const ws = addDays(a.dwellStartDate, 7 * Math.floor(off / 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const retinal = projectedRetinalSet(state, ws, addDays(ws, 6));
  const candidates = days.filter((d) => !retinal.has(d));
  const score = (d) => (retinal.has(addDays(d, -1)) ? 1 : 0) + (retinal.has(addDays(d, 1)) ? 1 : 0);
  candidates.sort((x, y) => score(x) - score(y) || (x < y ? -1 : 1));
  return candidates.slice(0, a.freq).includes(date);
}

// First match wins. Returns {type, reason}.
export function resolveNightType(state, date) {
  if (state.rescue.active)
    return { type: "rescue", reason: "Barrier rescue — actives paused while your skin settles" };
  if (state.flare.active)
    return { type: "recovery", reason: "Retinal is paused while this flare settles" };
  if (state.break.active && state.break.kind === "full")
    return { type: "recovery", reason: "You're on a break from retinal" };
  if (state.retinal.phase === "PAUSED")
    return { type: "recovery", reason: "Retinal is paused" };
  if (date >= nextRetinalDate(state)) {
    const n = countRecentRetinal(state, date);
    return { type: "retinal", reason: `Retinal night — ${ordinal(n)} of your ${state.retinal.freq} this week` };
  }
  if (isAzelaicNight(state, date))
    return { type: "azelaic", reason: "Azelaic night — on its own night, away from your retinal" };
  return { type: "recovery", reason: "Recovery night — nothing active tonight" };
}

function countRecentRetinal(state, date) {
  // how many retinal nights (completed) in the 6 days before date, +1 for tonight
  let n = 1;
  const last = state.retinal.lastRetinalDate;
  if (last && daysBetween(last, date) <= 6) n = 2;
  return Math.min(n, state.retinal.freq);
}

function ordinal(n) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

// ---- routine composition ----

export function productForSlot(products, slot) {
  const inUse = products.shelf.filter(
    (p) => p.status === "in-use" && !p.locked && (p.slots || []).includes(slot)
  );
  if (!inUse.length) return null;
  return inUse.find((p) => p.replacesUntilFinished) || inUse[0];
}

// Returns concrete steps for rendering/logging.
// ctx: { woreMakeup, sandwichFull, peptideOnRetinalNights, extraActives: [product] }
export function composeRoutine(products, type, ctx = {}) {
  const tpl = products.templates[type];
  if (!tpl) return [];
  const steps = [];
  for (const s of tpl.steps) {
    if (s.conditional === "woreMakeup" && !ctx.woreMakeup) continue;
    if (s.onlyIf === "sandwichFull" && !ctx.sandwichFull) continue;
    if (s.onlyIf === "peptideOnRetinalNights" && !ctx.peptideOnRetinalNights) continue;
    const step = { ...s };
    if (s.slot) {
      const p = productForSlot(products, s.slot);
      if (!p && s.optional) continue;
      step.product = p ? p.name : null;
      step.productId = p ? p.id : null;
    }
    steps.push(step);
  }
  // Generic extra actives (non-azelaic phased products) insert before the cream
  if (ctx.extraActives && ctx.extraActives.length && type === "recovery") {
    const at = Math.max(steps.length - 1, 0);
    for (const p of ctx.extraActives) {
      steps.splice(at, 0, {
        id: "active-" + p.id, label: p.name, product: p.name, productId: p.id,
        note: "Its own night, away from your retinal.",
      });
    }
  }

  // Products added to the evening routine without a template slot ("pm-extra")
  // render just before the final cream, on every PM night type.
  const already = new Set(steps.map((s) => s.productId).filter(Boolean));
  const extras = products.shelf.filter(
    (p) => p.status === "in-use" && !p.locked && (p.slots || []).includes("pm-extra") && !already.has(p.id)
  );
  if (extras.length) {
    const creamAt = steps.findIndex((s) => s.slot === "pm-cream");
    const at = creamAt >= 0 ? creamAt : steps.length;
    extras.forEach((p, i) => steps.splice(at + i, 0, {
      id: "extra-" + p.id, label: p.name, product: p.name, productId: p.id,
    }));
  }
  return steps;
}

// Generic phased-active placement for products she adds later (non-azelaic):
// same placement algorithm, anchored on the product's own schedule.
export function isActiveNightFor(state, sched, date) {
  if (!sched || !sched.freq || !sched.startDate || date < sched.startDate) return false;
  const off = daysBetween(sched.startDate, date);
  const ws = addDays(sched.startDate, 7 * Math.floor(off / 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const retinal = projectedRetinalSet(state, ws, addDays(ws, 6));
  let candidates = days.filter((d) => !retinal.has(d));
  if (sched.strict) {
    // STRICT_SEPARATION: also never the night immediately before a retinal night
    candidates = candidates.filter((d) => !retinal.has(addDays(d, 1)));
  }
  const score = (d) => (retinal.has(addDays(d, -1)) ? 1 : 0) + (retinal.has(addDays(d, 1)) ? 1 : 0);
  candidates.sort((x, y) => score(x) - score(y) || (x < y ? -1 : 1));
  return candidates.slice(0, sched.freq).includes(date);
}
