// seed.js — initial products, routine templates and state. Everything here is
// editable in-app afterwards; this is a starting point, not a hardcoded routine.

export const SEED_PRODUCTS = {
  version: 1,
  shelf: [
    { id: "anua-heartleaf-oil",    name: "Anua Heartleaf Cleansing Oil",      type: "oil-cleanser", tier: 1, slots: ["pm-oil"], status: "in-use" },
    { id: "avene-tolerance",       name: "Avène Tolérance Cleanser",          type: "cleanser",     tier: 1, slots: ["pm-cleanse", "am-cleanse"], status: "in-use" },
    { id: "celimax-dual-barrier",  name: "Celimax Dual Barrier Creamy Toner", type: "toner",        tier: 1, slots: ["pm-toner"], status: "in-use" },
    { id: "dr-different-forte",    name: "Dr. Different Vitalift-A Forte",    type: "retinoid",     tier: 3, slots: ["pm-retinal"], status: "in-use",
      concentration: "0.1% retinaldehyde" },
    { id: "aestura-hydro-essence", name: "Aestura Hydro Essence",             type: "essence",      tier: 1, slots: ["pm-essence", "am-essence"], status: "in-use" },
    { id: "maelove-peptide",       name: "Maelove Peptide",                   type: "peptide",      tier: 1, slots: ["pm-peptide", "am-peptide"], status: "in-use" },
    { id: "medik8-peptide",        name: "Medik8 peptide",                    type: "peptide",      tier: 1, slots: ["pm-peptide"], status: "in-use",
      replacesUntilFinished: "maelove-peptide" },
    { id: "pyunkang-yul-ato",      name: "Pyunkang Yul ATO Cream Blue Label", type: "moisturizer",  tier: 1, slots: ["pm-cream", "pm-buffer"], status: "in-use" },
    { id: "anua-azelaic",          name: "Anua Azelaic Acid 10 Hyaluron",     type: "azelaic",      tier: 2, slots: ["pm-azelaic"], status: "in-use",
      locked: true, protocol: "PHASED_ALTERNATING" },
    { id: "maelove-glow-maker",    name: "Maelove Glow Maker",                type: "vitamin-c",    tier: 3, slots: ["am-vitc"], status: "in-use",
      protocol: "AM_ONLY_RAMP" },
    { id: "sunday-riley-ceo-glow", name: "Sunday Riley C.E.O. Glow Vitamin C + Turmeric Face Oil", type: "vitamin-c-oil", tier: 2, slots: ["am-oil"], status: "in-use",
      replacesUntilFinished: "maelove-glow-maker" },
    { id: "anua-daily-lotion",     name: "Anua Daily Lotion",                 type: "moisturizer",  tier: 1, slots: ["am-cream"], status: "in-use" },
    { id: "skin1004-hyalu-cica",   name: "SKIN1004 Hyalu-Cica Sunscreen",     type: "sunscreen",    tier: 1, slots: ["am-spf"], status: "in-use" },
  ],
  wantToTry: [],
  neverAgain: [],
  templates: {
    retinal: {
      label: "Retinal night",
      steps: [
        { id: "oil-cleanse", slot: "pm-oil", conditional: "woreMakeup", label: "Cleansing oil", note: "Only if you wore sunscreen or makeup today" },
        { id: "cleanse", slot: "pm-cleanse", label: "Cleanser" },
        { id: "toner", slot: "pm-toner", label: "Toner" },
        { id: "wait-1", kind: "timer", minutes: 7, range: "5–10 min", optional: true, label: "Wait", note: "Optional. Helps if you're worried about irritation tonight" },
        { id: "buffer", slot: "pm-buffer", onlyIf: "sandwichFull", label: "Thin layer of cream", note: "Buffering — softens the retinal while your barrier is still settling" },
        { id: "retinal", slot: "pm-retinal", label: "Retinal",
          note: "Pea-sized for your whole face. Dot on forehead, both cheeks, chin and nose, then spread thin.\nAvoid eyelids, corners of your eyes, the creases beside your nose, corners of your mouth, and any patch of active eczema." },
        { id: "wait-2", kind: "timer", minutes: 1.5, range: "1–2 min", label: "Wait" },
        { id: "peptide-r", slot: "pm-peptide", onlyIf: "peptideOnRetinalNights", optional: true, label: "Peptide" },
        { id: "cream", slot: "pm-cream", label: "Moisturizer" },
      ],
    },
    recovery: {
      label: "Recovery night",
      steps: [
        { id: "oil-cleanse", slot: "pm-oil", conditional: "woreMakeup", label: "Cleansing oil" },
        { id: "cleanse", slot: "pm-cleanse", label: "Cleanser" },
        { id: "toner", slot: "pm-toner", label: "Toner" },
        { id: "essence", slot: "pm-essence", label: "Essence" },
        { id: "peptide", slot: "pm-peptide", label: "Peptide" },
        { id: "cream", slot: "pm-cream", label: "Moisturizer" },
      ],
    },
    azelaic: {
      label: "Azelaic night",
      steps: [
        { id: "oil-cleanse", slot: "pm-oil", conditional: "woreMakeup", label: "Cleansing oil" },
        { id: "cleanse", slot: "pm-cleanse", label: "Cleanser" },
        { id: "toner", slot: "pm-toner", label: "Toner" },
        { id: "azelaic", slot: "pm-azelaic", label: "Azelaic acid",
          note: "Thin layer on dry skin. Some tingling in the first weeks is common and usually settles within a week or two." },
        { id: "essence", slot: "pm-essence", optional: true, label: "Essence" },
        { id: "cream", slot: "pm-cream", label: "Moisturizer" },
      ],
    },
    rescue: {
      label: "Barrier rescue",
      steps: [
        { id: "oil-cleanse", slot: "pm-oil", conditional: "woreMakeup", label: "Cleansing oil" },
        { id: "cleanse", slot: "pm-cleanse", label: "Cleanser", note: "Lukewarm water, no scrubbing" },
        { id: "toner", slot: "pm-toner", label: "Toner" },
        { id: "essence", slot: "pm-essence", label: "Essence" },
        { id: "cream", slot: "pm-cream", label: "Moisturizer", note: "Be generous tonight" },
      ],
    },
  },
};

// Morning reference card — displayed, never tracked. Two variants because
// C.E.O. Glow is an oil (goes after watery steps); Maelove is a serum (step 2).
export const AM_REFERENCE = {
  withOil: [
    { label: "Water, or Avène Cleanser" },
    { label: "Maelove Peptide", optional: true },
    { label: "Aestura Hydro Essence", optional: true, note: "If you feel dry" },
    { label: "Sunday Riley C.E.O. Glow", note: "It's an oil, so it goes after the watery steps" },
    { label: "Anua Daily Lotion" },
    { label: "SKIN1004 Hyalu-Cica Sunscreen", note: "Two-finger amount" },
  ],
  withSerum: [
    { label: "Water, or Avène Cleanser" },
    { label: "Maelove Glow Maker" },
    { label: "Maelove Peptide", optional: true },
    { label: "Aestura Hydro Essence", optional: true, note: "If you feel dry" },
    { label: "Anua Daily Lotion" },
    { label: "SKIN1004 Hyalu-Cica Sunscreen", note: "Two-finger amount" },
  ],
};

export const SEED_STATE = {
  version: 1,
  startDate: null, // set on first launch
  settings: { dayRolloverHour: 4, showReasoning: true, photoIntervalDays: 84, disclaimerAccepted: false, baselineDone: false },
  retinal: {
    freq: 2, targetFreq: 3, phase: "INIT", sandwich: "FULL",
    lastRetinalDate: null, patternIndex: 0,
    dwellStartDate: null, cleanStreak: 0, stepUpLockUntil: null,
    concentration: "0.1", peptideOnRetinalNights: false,
    forceFullCount: 0, sandwichChangedOn: null, lastGapHandled: null, freqAtPause: null,
  },
  azelaic: { unlocked: false, active: false, freq: 0, dwellStartDate: null, unlockOfferedOn: null },
  flare: { active: false, startedDate: null, lastPhotoDate: null, resolvedDate: null, peakGrade: null, zones: [], trend: [] },
  flareHistory: [],
  rescue: { active: false, startedDate: null },
  break: { active: false, startedDate: null, kind: null, freqBefore: null },
  ceiling: { reachedTargetOn: null, doorsOfferedOn: null, doorsDeclinedUntil: null, dermMilestoneFlagged: false },
  escalation: { active: false, reason: null, dismissedOn: null },
  declines: {},
  lastChange: { retinal: null, azelaic: null },
  lastOpenedDate: null,
  makeupAnswer: { date: null, woreMakeup: null },
};

export const REVIEW_TAGS = [
  "broke me out", "stung", "pilled under sunscreen", "too heavy", "too light",
  "pleasant texture", "unpleasant smell", "no reaction", "visible improvement",
  "too expensive", "hard to find", "great in winter", "great in summer",
];

export const TRIGGER_TAGS = [
  "new product", "cold weather", "stress", "poor sleep", "hormonal", "sun", "travel", "illness",
];

export const ZONES = [
  { id: "forehead", label: "Forehead" },
  { id: "periorbital-l", label: "Left eye area" },
  { id: "periorbital-r", label: "Right eye area" },
  { id: "cheek-l", label: "Left cheek" },
  { id: "cheek-r", label: "Right cheek" },
  { id: "perioral", label: "Beside the nose / mouth" },
  { id: "chin", label: "Chin / jaw" },
  { id: "neck", label: "Neck" },
];

export const PRODUCT_KINDS = [
  { kind: "Cleanser", type: "cleanser", tier: 1, protocol: "IMMEDIATE_DAILY" },
  { kind: "Toner", type: "toner", tier: 1, protocol: "IMMEDIATE_DAILY" },
  { kind: "Moisturizer", type: "moisturizer", tier: 1, protocol: "IMMEDIATE_DAILY" },
  { kind: "Essence / hydrator", type: "essence", tier: 1, protocol: "IMMEDIATE_DAILY" },
  { kind: "Peptide serum", type: "peptide", tier: 1, protocol: "IMMEDIATE_DAILY" },
  { kind: "Sunscreen", type: "sunscreen", tier: 1, protocol: "IMMEDIATE_DAILY" },
  { kind: "Niacinamide", type: "niacinamide", tier: 2, protocol: "PHASED_ALTERNATING" },
  { kind: "Azelaic acid", type: "azelaic", tier: 2, protocol: "PHASED_ALTERNATING" },
  { kind: "Vitamin C (derivative / oil)", type: "vitamin-c-oil", tier: 2, protocol: "IMMEDIATE_DAILY", am: true },
  { kind: "Vitamin C (pure / L-ascorbic)", type: "vitamin-c", tier: 3, protocol: "AM_ONLY_RAMP", am: true },
  { kind: "Exfoliating acid (AHA/BHA)", type: "exfoliating-acid", tier: 3, protocol: "STRICT_SEPARATION" },
  { kind: "Benzoyl peroxide", type: "benzoyl-peroxide", tier: 3, protocol: "STRICT_SEPARATION" },
  { kind: "Retinoid", type: "retinoid", tier: 3, protocol: "SPECIAL_RETINOID" },
  { kind: "Mask / peel / enzyme", type: "mask-peel", tier: 4, protocol: "WEEKLY_EPISODIC" },
  { kind: "Something else", type: "other", tier: 1, protocol: "IMMEDIATE_DAILY" },
];

export const CONFLICT_VERDICTS = {
  "cleanser": null, "toner": null, "moisturizer": null, "essence": null, "sunscreen": null, "other": null,
  "peptide": { level: "ok", text: "Peptides are fine on the same night as your retinal — a retinal-plus-peptide serum tested well even in sensitive skin." },
  "niacinamide": { level: "ok", text: "Safe on the same night as retinal — niacinamide may actually reduce retinoid irritation. It still gets a gentle phase-in because your skin is sensitive." },
  "azelaic": { level: "separate", text: "This can't share a night with your retinal while it's settling in. It goes on your non-retinal nights, starting slowly." },
  "vitamin-c-oil": { level: "ok", text: "This is a vitamin C derivative — stable at skin pH, no conflict with a night-time retinal. It belongs in your morning routine." },
  "vitamin-c": { level: "am", text: "Pure vitamin C belongs in the morning — not because it 'cancels out' retinal (that's outdated), but because it works best as an antioxidant alongside sunscreen." },
  "exfoliating-acid": { level: "separate", text: "This can't share a night with your retinal. Both dry the skin, so together they'd add up. It gets its own night — and never the night before a retinal night." },
  "benzoyl-peroxide": { level: "separate", text: "Alternate nights with retinal — because both are drying, not because it 'deactivates' retinoids (that old claim has been revised). " },
  "retinoid": { level: "never", text: "One retinoid at a time — this would replace your Dr. Different, not join it. Mark the current one finished first, or talk to a dermatologist about switching." },
  "mask-peel": { level: "separate", text: "Once a week at most, on a night of its own — and the app will skip your retinal that night and the night after." },
};
