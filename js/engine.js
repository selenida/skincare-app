// engine.js — PURE. The progression brain: titration, flares, gaps, unlocks.
// Mutates the state object passed in and returns event messages; never touches
// DOM, network, or Date.now(). `nights` is a map of date -> night entry.
// Rule numbers (R1…) refer to SPEC-ENGINE.md.

import { addDays, daysBetween } from "./util.js";
import { nextRetinalDate, GAP_PATTERNS } from "./schedule.js";

export const HOLD_DAYS = 28;      // conservative dwell per step (eczema-prone)
export const CLEAN_APPS = 8;      // clean retinal applications before step-up
export const LOCK_DAYS = 28;      // lock after an accepted step-up
export const COOLDOWN = 14;       // cross-product change cooldown

// ---- irritation window counters ----
function eventsInWindow(nights, date, n, minGrade) {
  let count = 0;
  for (let i = 0; i < n; i++) {
    const d = addDays(date, -i);
    const night = nights[d];
    if (night && night.checkIn && night.checkIn.grade >= minGrade) count++;
  }
  return count;
}
export const g2Events = (nights, date, n) => eventsInWindow(nights, date, n, 2);
export const g3Events = (nights, date, n) => eventsInWindow(nights, date, n, 3);

function cleanWindow(nights, date, n) {
  return g2Events(nights, date, n) === 0;
}

function itchOccasions(nights, date, n) {
  let count = 0;
  for (let i = 0; i < n; i++) {
    const night = nights[addDays(date, -i)];
    if (night?.checkIn?.flags?.includes("itchy")) count++;
  }
  return count;
}

// ---- grading ----
// feel: 'fine' | 'dry' | 'irritated'; flags: subset of grade-3 markers
export function gradeCheckIn(feel, flags = []) {
  if (feel === "fine") return { grade: 0, label: "fine" };
  if (feel === "dry") return { grade: 1, label: "a bit dry" };
  const g3 = flags.length > 0 && !flags.includes("none");
  return { grade: g3 ? 3 : 2, label: g3 ? "irritated (severe)" : "irritated" };
}

// ---- check-in application ----
export function applyCheckIn(state, nights, date, checkIn) {
  const events = [];
  const r = state.retinal;
  const night = nights[date] || {};
  const grade = checkIn.grade;

  if (grade <= 1) {
    if (night.type === "retinal" && (night.status === "completed" || allRequiredDone(night))) {
      r.cleanStreak = (r.cleanStreak || 0) + 1;
    }
    return events;
  }

  // grade >= 2
  r.cleanStreak = 0;

  // R12 — attribution: blame whatever changed most recently within 14 days
  const rc = state.lastChange.retinal, ac = state.lastChange.azelaic;
  const rRecent = rc && daysBetween(rc, date) >= 0 && daysBetween(rc, date) < COOLDOWN;
  const aRecent = ac && daysBetween(ac, date) >= 0 && daysBetween(ac, date) < COOLDOWN;
  const blameAzelaic = aRecent && (!rRecent || ac >= rc);

  if (grade === 3) {
    // R5 — pause + flare, regardless of attribution
    r.freqAtPause = r.freq;
    r.phase = "PAUSED";
    startFlare(state, date, checkIn.zones || []);
    events.push({
      kind: "alert",
      title: "Retinal is paused",
      body: "That sounds like more than ordinary dryness, so retinal stops while this settles. The app will track it as a flare — it'll ask for a quick photo every couple of days (in daylight) and check how it's trending.",
    });
    return events;
  }

  // grade === 2
  if (blameAzelaic && state.azelaic.active) {
    const a = state.azelaic;
    if (a.freq > 1) {
      a.freq -= 1;
      a.dwellStartDate = date;
      state.lastChange.azelaic = date;
      events.push({
        kind: "warn",
        title: "Azelaic drops back a night",
        body: `Azelaic changed most recently, so it takes the blame. Down to ${a.freq} night${a.freq > 1 ? "s" : ""} a week while things settle. Your retinal stays as it was.`,
      });
    } else if (g2Events(nights, date, COOLDOWN) >= 2) {
      a.active = false;
      state.lastChange.azelaic = date;
      events.push({
        kind: "warn",
        title: "Azelaic is paused",
        body: "Two rough nights at its lowest step — azelaic comes out of the routine for now. It can be reintroduced from Products when your skin is calm.",
      });
    }
    return events;
  }

  // R4 — two grade-2 events in any 14-day window → automatic retinal step-down
  if (g2Events(nights, date, COOLDOWN) >= 2 && r.freq > 0) {
    const oldFreq = r.freq;
    r.freq = Math.max(1, r.freq - 1);
    r.phase = "RECOVERY";
    r.sandwich = "FULL";
    r.dwellStartDate = date;
    r.cleanStreak = 0;
    r.patternIndex = 0;
    state.lastChange.retinal = date;
    if (oldFreq !== r.freq) {
      events.push({
        kind: "warn",
        title: `Dropping back to ${r.freq} night${r.freq > 1 ? "s" : ""} a week`,
        body: "Two irritated nights within two weeks — the schedule eases off while your skin settles. This is the plan working, not a setback.",
      });
    }
  } else {
    events.push({
      kind: "warn",
      title: "Noted — progression is on hold",
      body: "One irritated night doesn't change your schedule, but step-ups wait until you've had a clean four weeks.",
    });
  }
  return events;
}

function allRequiredDone(night) {
  if (!night.steps) return false;
  return night.steps.filter((s) => !s.optional).every((s) => s.done);
}

// ---- flares (§6) ----
export function startFlare(state, date, zones = []) {
  state.flare = {
    active: true, startedDate: date, lastPhotoDate: null, resolvedDate: null,
    peakGrade: 3, zones: [...zones], trend: [],
  };
}

// trend: 'calm' | 'better' | 'same' | 'worse'
export function flareCheckIn(state, nights, date, trend, zones) {
  const events = [];
  const f = state.flare;
  f.trend.push({ date, trend });
  if (zones && zones.length) f.zones = [...zones];
  const grade = trend === "calm" ? 0 : trend === "worse" ? 3 : 2;
  nights[date] = {
    ...(nights[date] || {}),
    type: "recovery",
    checkIn: { grade, label: "flare: " + trend, zones: zones || f.zones, flags: [], triggers: [], at: null },
  };
  const lastThree = f.trend.slice(-3).map((t) => t.trend);
  if (lastThree.length === 3 && lastThree.every((t) => t === "worse")) {
    triggerEscalation(state, date, "This flare has been getting worse for three days running.");
    events.push(escalationEvent(state));
  }
  const lastFive = f.trend.slice(-5).map((t) => t.trend);
  if (lastFive.length === 5 && lastFive.every((t) => t === "calm")) {
    events.push({
      kind: "ok",
      title: "Five calm days — is this flare over?",
      body: "You can mark it resolved from tonight's screen. Retinal will come back gently once it is.",
    });
  }
  return events;
}

export function resolveFlare(state, date) {
  const f = state.flare;
  f.active = false;
  f.resolvedDate = date;
  state.flareHistory.push({
    startedDate: f.startedDate,
    resolvedDate: date,
    days: daysBetween(f.startedDate, date) + 1,
    peakGrade: f.peakGrade,
    zones: [...(f.zones || [])],
  });
  return [{
    kind: "ok",
    title: `Flare resolved — ${daysBetween(f.startedDate, date) + 1} days`,
    body: "That recovery time is logged; knowing it is genuinely useful. Retinal stays paused until you've had 5 calm days in a row, then eases back one step below where it was.",
  }];
}

export function flarePhotoDue(state, date) {
  const f = state.flare;
  if (!f.active) return false;
  return !f.lastPhotoDate || daysBetween(f.lastPhotoDate, date) >= 2;
}

// R5 resume: ≥5 days elapsed AND last 5 consecutive nights grade 0
export function tryAutoResume(state, nights, date) {
  const r = state.retinal;
  if (r.phase !== "PAUSED" || state.flare.active) return [];
  const pausedOn = state.flareHistory.length
    ? state.flareHistory[state.flareHistory.length - 1].startedDate
    : r.dwellStartDate;
  if (!pausedOn || daysBetween(pausedOn, date) < 5) return [];
  for (let i = 1; i <= 5; i++) {
    const night = nights[addDays(date, -i)];
    if (!night || !night.checkIn || night.checkIn.grade !== 0) return [];
  }
  const resumeFreq = Math.max(1, (r.freqAtPause || r.freq) - 1);
  r.freq = resumeFreq;
  r.phase = "RECOVERY";
  r.sandwich = "FULL";
  r.dwellStartDate = date;
  r.cleanStreak = 0;
  r.patternIndex = 0;
  r.lastRetinalDate = null; // due tonight-or-next-open
  r.freqAtPause = null;
  state.lastChange.retinal = date;
  return [{
    kind: "ok",
    title: `Retinal is back — ${resumeFreq} night${resumeFreq > 1 ? "s" : ""} a week`,
    body: "One step below where you were, with full buffering, as the plan says after a pause. It rebuilds from here.",
  }];
}

// ---- escalation (R6) ----
export function triggerEscalation(state, date, reason) {
  if (state.escalation.active) return;
  state.escalation = { active: true, reason, dismissedOn: null };
}

function escalationEvent(state) {
  return {
    kind: "alert",
    title: "Worth showing a dermatologist",
    body: state.escalation.reason +
      " The app can't examine your skin — a dermatologist can. Your logged history (frequency, reactions, photos) exports from More, and it's genuinely useful in that appointment.",
  };
}

export function checkEscalation(state, nights, date) {
  const r = state.retinal;
  if (state.escalation.active) return;
  if (g3Events(nights, date, 60) >= 2)
    return triggerEscalation(state, date, "Two severe reactions inside two months.");
  if (itchOccasions(nights, date, 30) >= 3)
    return triggerEscalation(state, date, "Itch has come up three times in a month — that pattern reads more like eczema than retinoid dryness.");
  if (r.phase === "PAUSED" && state.flare.startedDate && daysBetween(state.flare.startedDate, date) > 14)
    return triggerEscalation(state, date, "Retinal has been paused for over two weeks.");
  for (let i = 0; i < 60; i++) {
    const night = nights[addDays(date, -i)];
    if (night?.checkIn?.flags?.includes("weeping")) {
      return triggerEscalation(state, date, "Weeping or cracked skin was logged.");
    }
  }
}

// ---- gaps and breaks (§5) ----
export function gapAdjustIfNeeded(state, date) {
  const r = state.retinal;
  if (!r.lastRetinalDate || r.lastGapHandled === date) return [];
  const gap = daysBetween(r.lastRetinalDate, date);
  if (gap <= 7) return [];
  r.lastGapHandled = date;
  const events = [];
  if (gap <= 14) {
    r.forceFullCount = 2;
    events.push({
      kind: "info",
      title: `${gap} days since your last retinal night`,
      body: "Same schedule, but the first two nights back get full buffering.",
    });
  } else if (gap <= 30) {
    r.freq = Math.max(1, r.freq - 1);
    r.dwellStartDate = date;
    r.stepUpLockUntil = addDays(date, 14);
    r.patternIndex = 0;
    state.lastChange.retinal = date;
    events.push({
      kind: "info",
      title: `${gap} days off — easing back in`,
      body: `Restarting at ${r.freq} night${r.freq > 1 ? "s" : ""} a week for a couple of weeks. Tolerance fades a little during a gap; this is the recommended way back.`,
    });
  } else if (gap <= 90) {
    r.freq = Math.min(2, r.freq);
    r.sandwich = "FULL";
    r.dwellStartDate = date;
    r.stepUpLockUntil = addDays(date, 28);
    r.patternIndex = 0;
    state.lastChange.retinal = date;
    events.push({
      kind: "info",
      title: `${gap} days off — restarting gently`,
      body: "Back to 2 nights a week with full buffering, holding four weeks before any step up.",
    });
  } else {
    r.phase = "INIT";
    r.freq = Math.min(2, r.freq);
    r.sandwich = "FULL";
    r.dwellStartDate = date;
    r.stepUpLockUntil = addDays(date, 28);
    r.cleanStreak = 0;
    r.patternIndex = 0;
    state.lastChange.retinal = date;
    events.push({
      kind: "info",
      title: "Over three months off — starting fresh",
      body: "This counts as a new introduction: 2 nights a week, full buffering, the full run-up again.",
    });
  }
  return events;
}

export function startBreak(state, date, kind) {
  const b = state.break;
  b.active = true; b.startedDate = date; b.kind = kind; b.freqBefore = state.retinal.freq;
  if (kind === "reduced") {
    state.retinal.freq = 1;
    state.retinal.patternIndex = 0;
    state.lastChange.retinal = date;
    return [{ kind: "info", title: "Break — one night a week", body: "Keeping one retinal night a week holds on to most of what you've built. Stop fully any time from More." }];
  }
  return [{ kind: "info", title: "Full break", body: "No retinal until you come back. Honest note: results drift back toward baseline over roughly 4–5 months without it." }];
}

export function endBreak(state, date) {
  const b = state.break;
  b.active = false;
  if (b.kind === "reduced" && b.freqBefore) {
    state.retinal.freq = b.freqBefore;
  }
  b.kind = null; b.freqBefore = null;
  // gap table applies at next retinal night via gapAdjustIfNeeded
  return [{ kind: "ok", title: "Welcome back", body: "The schedule picks up from your last retinal night — if it's been a while, it eases you back in automatically." }];
}

// ---- rescue (§9) ----
export function startRescue(state, date) {
  state.rescue = { active: true, startedDate: date };
  return [{ kind: "info", title: "Barrier rescue on", body: "Gentle cleanse, toner, essence, plenty of cream. No actives until your skin feels like itself." }];
}
export function rescueExitReady(state, nights, date) {
  if (!state.rescue.active) return false;
  for (let i = 0; i < 3; i++) {
    const night = nights[addDays(date, -i)];
    if (!night || !night.checkIn || night.checkIn.grade !== 0) return false;
  }
  return true;
}
export function exitRescue(state, date) {
  state.rescue = { active: false, startedDate: null };
  return [{ kind: "ok", title: "Rescue off", body: "Back to the normal schedule — it eases in rather than jumping straight back." }];
}

// ---- retinal night completed ----
export function onRetinalCompleted(state, date) {
  const r = state.retinal;
  const pattern = GAP_PATTERNS[r.freq] || GAP_PATTERNS[2];
  // patternIndex points at the gap that will produce the NEXT retinal date.
  // The very first night consumed no gap, so the index only advances when
  // this completion actually consumed pattern[patternIndex].
  if (r.lastRetinalDate) r.patternIndex = (r.patternIndex + 1) % pattern.length;
  r.lastRetinalDate = date;
  if (r.forceFullCount > 0) r.forceFullCount -= 1;
  if (r.phase === "INIT" || r.phase === "RECOVERY") r.phase = "TITRATE";
}

// ---- suggestions (§12 priority) ----
// ctx: { daytime: bool, photos: [{kind, date, week}], pendingBackfills: n }
export function computeSuggestion(state, nights, date, ctx = {}) {
  const r = state.retinal;
  const decl = state.declines || {};
  const okToSuggest = !state.flare.active && !state.rescue.active && r.phase !== "PAUSED" && !state.break.active;
  const cooldownClear = (which) => {
    const other = which === "retinal" ? state.lastChange.azelaic : state.lastChange.retinal;
    return !other || daysBetween(other, date) >= COOLDOWN;
  };
  const declined = (key, days) => decl[key] && daysBetween(decl[key], date) < days;

  // 1 — escalation
  if (state.escalation.active && !state.escalation.dismissedOn) {
    return { id: "escalation", ...escalationEvent(state), actions: [{ id: "dismiss", label: "Okay" }, { id: "export", label: "Export for my derm" }] };
  }

  // 2 — flare photo (daylight only; never inside the nightly routine)
  if (state.flare.active && flarePhotoDue(state, date) && ctx.daytime) {
    return {
      id: "flare-photo", kind: "warn", title: "Flare photo due",
      body: "Every other day while it lasts — seeing the trend beats remembering it.",
      actions: [{ id: "take-photo", label: "Take it now" }, { id: "later", label: "Later" }],
    };
  }

  // 4 — milestone / baseline photo (daylight only)
  if (ctx.daytime && !state.flare.active) {
    const photos = ctx.photos || [];
    if (!photos.some((p) => p.kind === "baseline") && !state.settings.baselineDone) {
      return {
        id: "baseline-photo", kind: "info", title: "Baseline photo",
        body: "Before anything changes. No visible difference is expected before week 8 — this is the photo future-you compares against.",
        actions: [{ id: "take-photo", label: "Take it now" }, { id: "later", label: "Later" }],
      };
    }
    const week = Math.floor(daysBetween(state.startDate, date) / 7);
    const block = Math.floor(daysBetween(state.startDate, date) / state.settings.photoIntervalDays);
    if (block >= 1 && !photos.some((p) => p.kind === "milestone" && Math.floor(daysBetween(state.startDate, p.date) / state.settings.photoIntervalDays) === block)) {
      return {
        id: "milestone-photo", kind: "info", title: `Week ${week} photo`,
        body: milestoneCopy(week, r.freq),
        actions: [{ id: "take-photo", label: "Take it now" }, { id: "later", label: "Later" }],
      };
    }
  }

  if (!okToSuggest) return null;

  // 5 — azelaic offer (R10): day 14, previous 14 days clean; deferred, not cancelled.
  // Two declines and it stops auto-offering — it waits on the shelf instead of
  // outranking every later suggestion forever.
  if (!state.azelaic.unlocked && state.startDate && daysBetween(state.startDate, date) >= 14 &&
      (decl["azelaic-count"] || 0) < 2) {
    if (cleanWindow(nights, date, 14) && g3Events(nights, date, 60) === 0 && cooldownClear("azelaic") && !declined("azelaic", 14)) {
      return {
        id: "azelaic-unlock", kind: "ok", title: "Ready to bring in azelaic acid?",
        body: "Two clean weeks behind you — this is the week-3 step from your plan. One night a week to start, on a night away from your retinal.",
        why: "Yours is the mild 10% formulation. Retinal stays at 2 nights while this settles, and nothing else changes for 14 days — so if you react, it's clear what caused it. Mild tingling in the first weeks is common and usually settles. (DermNet)",
        actions: [{ id: "accept", label: "Yes, add it" }, { id: "decline", label: "Not yet" }],
      };
    }
  }

  // 5b — azelaic ladder (R11)
  if (state.azelaic.active && state.azelaic.freq < 4 && cooldownClear("azelaic") && !declined("azelaic-step", 14)) {
    const a = state.azelaic;
    const need = a.freq === 1 ? 7 : 14;
    if (a.dwellStartDate && daysBetween(a.dwellStartDate, date) >= need && cleanWindow(nights, date, need)) {
      return {
        id: "azelaic-step", kind: "ok", title: `Azelaic to ${a.freq + 1} nights a week?`,
        body: a.freq === 1
          ? "A clean week at one night — this is the week-4 step from your plan."
          : `${need} clean days at ${a.freq} nights. Next step is ${a.freq + 1}.`,
        actions: [{ id: "accept", label: "Yes" }, { id: "decline", label: "Not yet" }],
      };
    }
  }

  // 6 — retinal step-up (R1)
  if (r.freq < r.targetFreq && !declined("step-up", 14)) {
    const dwellOk = r.dwellStartDate && daysBetween(r.dwellStartDate, date) >= HOLD_DAYS;
    const lockOk = !r.stepUpLockUntil || date > r.stepUpLockUntil;
    if (dwellOk && r.cleanStreak >= CLEAN_APPS && cleanWindow(nights, date, 28) &&
        g3Events(nights, date, 60) === 0 && lockOk && cooldownClear("retinal")) {
      return {
        id: "step-up", kind: "ok", title: `Ready for a ${ordinalWord(r.freq + 1)} retinal night?`,
        body: `You've done ${r.cleanStreak} retinal nights over ${Math.floor(daysBetween(r.dwellStartDate, date) / 7)} weeks with no irritation.`,
        why: "Conservative pacing for eczema-prone skin: four clean weeks and eight clean applications before each step, double the usual convention, because your barrier repaired recently and 0.1% is the strongest Vitalift.",
        actions: [{ id: "accept", label: "Yes, add a night" }, { id: "decline", label: "Not yet" }],
      };
    }
  }

  // 7 — sandwich graduation (R8)
  if (r.sandwich === "FULL" && cleanWindow(nights, date, 56) && r.dwellStartDate &&
      daysBetween(r.dwellStartDate, date) >= 56 && !declined("sandwich", 30) && cooldownClear("retinal")) {
    return {
      id: "sandwich", kind: "ok", title: "Drop the cream-before-retinal layer?",
      body: "Eight clean weeks. Buffering softens the retinal roughly 3× — removing it is a real dose increase, so it gets its own settling-in period.",
      why: "AAD 2025 data: a single moisturizer layer before OR after leaves potency essentially unchanged; the full sandwich cuts it ~3×. You'd move to cream after only.",
      actions: [{ id: "accept", label: "Yes" }, { id: "decline", label: "Keep buffering" }],
    };
  }

  // 8 — peptide on retinal nights (R9)
  if (!r.peptideOnRetinalNights && r.freq >= 2 && cleanWindow(nights, date, 28) &&
      state.startDate && daysBetween(state.startDate, date) >= 28 && !declined("peptide", 30)) {
    return {
      id: "peptide", kind: "info", title: "Add your peptide to retinal nights?",
      body: "Four clean weeks in. Peptides are fine alongside retinal — this was the optional step in your written plan.",
      actions: [{ id: "accept", label: "Yes" }, { id: "decline", label: "Keep it simple" }],
    };
  }

  // 9 — ceiling doors (R2)
  if (r.freq === r.targetFreq && r.freq >= 3 && r.dwellStartDate &&
      daysBetween(r.dwellStartDate, date) >= 56 && cleanWindow(nights, date, 56) &&
      g3Events(nights, date, 60) === 0 &&
      (!state.ceiling.doorsDeclinedUntil || date > state.ceiling.doorsDeclinedUntil)) {
    return {
      id: "doors", kind: "ok", title: "You're at 3 nights — and that's already a real result",
      body: "Eight clean weeks at your target. Honest note: 3 nights a week is proven to maintain results (the study built them at higher frequency first) — it's a sound plateau, not a stalled climb. Two doors from here, or stay put.",
      actions: [
        { id: "door-a", label: "Add a 4th night" },
        { id: "door-b", label: "Ask a derm about stronger" },
        { id: "decline", label: "Stay at 3" },
      ],
    };
  }

  // 10 — concentration fallback (R7)
  if (r.freq === 1 && g2Events(nights, date, 28) >= 2 && !declined("concentration", 30)) {
    return {
      id: "concentration", kind: "info", title: "Consider the 0.05% instead?",
      body: "Even one night a week is biting. Dr. Different makes this at 0.05% — a trial found near-identical results to 0.1% over 3 months, with only pigment benefit favouring the stronger one.",
      actions: [{ id: "noted", label: "Noted" }],
    };
  }

  return null;
}

function ordinalWord(n) {
  return ["", "first", "second", "third", "fourth", "fifth"][n] || `${n}th`;
}

function milestoneCopy(week, freq) {
  const sub = freq < 3
    ? " You're at " + freq + " nights a week — below the dose the trials ran, so expect changes later than the standard timeline. That's fine; it's deliberate."
    : "";
  if (week <= 5) return "Tolerance checkpoint, not results — the adjustment period mostly settles by weeks 4–6." + sub;
  if (week <= 9) return "Earliest evidence-backed window: fine lines ~12%, pores ~20%, tone ~19% at 3 nights/week." + sub;
  if (week <= 13) return "The texture and hydration window. Compare against your baseline." + sub;
  if (week <= 20) return "Wrinkle and roughness territory now." + sub;
  return "Deep remodeling continues to month 12. Compare with week 0 — that's the real story." + sub;
}

// ---- accepting / declining ----
export function acceptSuggestion(state, nights, date, sugg, actionId) {
  const r = state.retinal;
  const events = [];
  switch (sugg.id) {
    case "azelaic-unlock": {
      // Anchored on tomorrow: tonight's routine is already done, so the first
      // azelaic night can never be a night that already happened.
      state.azelaic = { unlocked: true, active: true, freq: 1, dwellStartDate: addDays(date, 1), unlockOfferedOn: date };
      state.lastChange.azelaic = date;
      events.push({ kind: "ok", title: "Azelaic is in", body: "One night a week, placed away from your retinal. The shelf card is unlocked." });
      break;
    }
    case "azelaic-step": {
      state.azelaic.freq += 1;
      state.azelaic.dwellStartDate = date;
      state.lastChange.azelaic = date;
      events.push({ kind: "ok", title: `Azelaic: ${state.azelaic.freq} nights a week`, body: "Placed on your calmest available nights." });
      break;
    }
    case "step-up": {
      r.freq += 1;
      r.dwellStartDate = date;
      r.cleanStreak = 0;
      r.patternIndex = 0;
      r.stepUpLockUntil = addDays(date, LOCK_DAYS);
      r.phase = "TITRATE";
      state.lastChange.retinal = date;
      events.push({ kind: "ok", title: `Retinal: ${r.freq} nights a week`, body: "Locked here for four weeks — no further changes while this settles." });
      break;
    }
    case "sandwich": {
      r.sandwich = "OPEN";
      r.sandwichChangedOn = date;
      r.dwellStartDate = date;
      r.cleanStreak = 0;
      r.stepUpLockUntil = addDays(date, 28);
      state.lastChange.retinal = date;
      events.push({ kind: "ok", title: "Buffering off", body: "Cream comes after the retinal only, from tonight. If your skin objects within four weeks, buffering comes back automatically." });
      break;
    }
    case "peptide": {
      r.peptideOnRetinalNights = true;
      events.push({ kind: "ok", title: "Peptide joins retinal nights", body: "It appears after the retinal step from tonight." });
      break;
    }
    case "doors": {
      if (actionId === "door-a") {
        r.targetFreq = 4;
        r.freq += 1;
        r.dwellStartDate = date;
        r.cleanStreak = 0;
        r.patternIndex = 0;
        r.stepUpLockUntil = addDays(date, LOCK_DAYS);
        state.lastChange.retinal = date;
        events.push({ kind: "ok", title: "Fourth night added", body: "Same rules as ever — any irritation steps it back." });
      } else {
        state.ceiling.dermMilestoneFlagged = true;
        state.ceiling.doorsOfferedOn = date;
        events.push({
          kind: "info", title: "Take your history with you",
          body: "Export the dermatologist summary from More — your frequency history, reactions and photo dates. That conversation is about prescription options the app deliberately doesn't advise on.",
        });
      }
      break;
    }
    case "escalation": {
      state.escalation.dismissedOn = date;
      state.escalation.active = false;
      break;
    }
  }
  return events;
}

export function declineSuggestion(state, date, sugg) {
  state.declines = state.declines || {};
  if (sugg.id === "doors") state.ceiling.doorsDeclinedUntil = addDays(date, 90);
  else if (sugg.id === "azelaic-unlock") {
    state.declines["azelaic"] = date;
    state.declines["azelaic-count"] = (state.declines["azelaic-count"] || 0) + 1;
  } else state.declines[sugg.id] = date;
}

// ---- missed nights (§11) ----
export function missedNightDates(state, nights, date) {
  if (!state.lastOpenedDate) return [];
  const out = [];
  const from = Math.max(1, Math.min(7, daysBetween(state.lastOpenedDate, date)));
  for (let i = from; i >= 1; i--) {
    const d = addDays(date, -i);
    if (d >= state.startDate && !nights[d]) out.push(d);
  }
  return out.slice(0, 3); // never more than 3 per sitting
}

// answer: 'yes' | 'no' | 'unknown'. Returns the entry to store.
export function answerMissedNight(state, nights, d, answer, scheduledType) {
  if (answer === "yes") {
    if (scheduledType === "retinal") onRetinalCompleted(state, d);
    return { type: scheduledType, status: "completed", steps: [], backfilled: true };
  }
  if (answer === "no") return { type: scheduledType, status: "missed", backfilled: true };
  return { type: scheduledType, status: "unknown", backfilled: true };
}

// ---- start-date adjustment ----
// For when the real first retinal night happened before the app was first
// opened. Re-anchors the whole schedule and returns a completed night entry
// for the true first night (caller fills in the ticked steps and stores it).
export function adjustStart(state, newStartDate) {
  const r = state.retinal;
  state.startDate = newStartDate;
  r.dwellStartDate = newStartDate;
  r.lastRetinalDate = newStartDate;
  r.patternIndex = 0; // first night consumed no gap; next = +pattern[0]
  state.lastChange.retinal = newStartDate;
  return {
    type: "retinal",
    reason: "Retinal night — your first",
    status: "completed",
    backfilled: true,
    woreMakeup: false,
    retinalCounted: true,
    sandwich: r.sandwich,
    steps: [],
  };
}

// ---- sandwich auto-revert (R8 guard) ----
export function sandwichRevertIfNeeded(state, nights, date) {
  const r = state.retinal;
  if (r.sandwich === "OPEN" && r.sandwichChangedOn &&
      daysBetween(r.sandwichChangedOn, date) <= 28 && g2Events(nights, date, 3) > 0) {
    r.sandwich = "FULL";
    r.sandwichChangedOn = null;
    return [{
      kind: "info", title: "Buffering is back",
      body: "Your skin objected within four weeks of removing it, so the cream-first layer returns automatically. Try again after a longer clean stretch.",
    }];
  }
  return [];
}
