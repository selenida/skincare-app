// views/products.js — shelf, add flow, ran-out → review, want-to-try, never-again.

import { h, humanShort, addDays, daysBetween } from "../util.js";
import { DB, saveProducts, saveReviews, saveState } from "../state.js";
import { bus } from "../bus.js";
import { PRODUCT_KINDS, CONFLICT_VERDICTS, REVIEW_TAGS } from "../seed.js";
import { COOLDOWN } from "../engine.js";

const ui = { mode: null, editId: null, review: null, add: null };

// iOS number inputs reject the decimal separator on many keyboard locales,
// and Finnish keyboards give a comma. Text + inputmode=decimal, parse both.
function parsePrice(v) {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function renderProducts(root) {
  if (ui.mode === "add") return renderAdd(root);
  if (ui.mode === "review") return renderReview(root);

  const shelf = DB.products.shelf;
  const groups = [
    ["Evening", (p) => (p.slots || []).some((s) => s.startsWith("pm-"))],
    ["Morning", (p) => (p.slots || []).every((s) => s.startsWith("am-")) && (p.slots || []).length],
  ];
  for (const [label, match] of groups) {
    root.append(h("div", { class: "sec" }, label));
    for (const p of shelf.filter((x) => x.status !== "finished" && match(x))) {
      root.append(productRow(p));
    }
  }

  root.append(h("button", { class: "addbtn", onclick: () => { ui.mode = "add"; ui.add = { name: "", kind: null }; bus.rerender(); } }, "+ Add a product"));

  // want-to-try
  root.append(h("div", { class: "sec" }, "Want to try"));
  const wtt = DB.products.wantToTry;
  if (!wtt.length) root.append(h("p", { class: "disc" }, "Empty. Park anything you're curious about here — it's offered when something runs out."));
  for (const w of wtt) {
    root.append(h("div", { class: "prow" },
      h("span", {}, h("span", { class: "nm" }, w.name), w.note && h("div", { class: "sub" }, w.note)),
      h("button", { class: "btn-sm ghost", onclick: () => { DB.products.wantToTry = wtt.filter((x) => x !== w); saveProducts(); bus.rerender(); } }, "✕")));
  }
  const wttInput = h("input", { class: "inputline", placeholder: "Add something to try…" });
  wttInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && wttInput.value.trim()) {
      DB.products.wantToTry.push({ name: wttInput.value.trim(), addedDate: bus.todayIso, note: null });
      saveProducts(); bus.rerender();
    }
  });
  root.append(wttInput);

  // reviews archive
  const reviews = DB.reviews.reviews;
  if (reviews.length) {
    root.append(h("div", { class: "sec" }, "Finished & reviewed"));
    for (const r of [...reviews].reverse()) {
      const never = DB.products.neverAgain.some((n) => n.reviewId === r.id);
      root.append(h("div", { class: `prow ${never ? "never" : ""}` },
        h("span", {},
          h("span", { class: "nm" }, r.productName),
          h("div", { class: "sub" },
            "★".repeat(r.rating) + "☆".repeat(5 - r.rating),
            ` · rebuy: ${r.wouldRebuy}`,
            r.lastedDays ? ` · lasted ${Math.round(r.lastedDays / 30)} mo` : "",
            r.costPerMonth ? ` · ${r.costPerMonth.toFixed(2)}€/mo` : "",
            (r.tags || []).length ? ` · ${r.tags.join(", ")}` : "")),
        never && h("span", { class: "badge alert" }, "never again")));
    }
  }
}

function productRow(p) {
  const locked = p.locked;
  const queued = p.status === "queued";
  const row = h("div", { class: `prow ${locked || queued ? "locked" : ""}` },
    h("span", { style: { flex: 1 } },
      h("span", { class: "nm" }, p.name),
      h("div", { class: "sub" },
        locked ? "Unlocks in week 3 — the app offers it when your skin is ready" :
        queued ? `Queued to start ${humanShort(p.startOn)}` :
        p.replacesUntilFinished ? `Standing in for ${nameOf(p.replacesUntilFinished)} until finished` :
        p.concentration || typeLabel(p.type),
        p.openedDate ? ` · opened ${humanShort(p.openedDate)}` : "")),
    h("span", { class: `badge ${p.type === "retinoid" || p.type === "azelaic" ? "act" : ""}` }, badgeFor(p)));
  row.onclick = () => { ui.editId = ui.editId === p.id ? null : p.id; bus.rerender(); };

  if (ui.editId !== p.id) return row;

  const wrap = h("div", { class: "prow-open" }, row);
  row.classList.add("open");
  const openedInput = h("input", { class: "inputline", type: "date", value: p.openedDate || "" });
  const priceInput = h("input", { class: "inputline", type: "text", inputmode: "decimal", placeholder: "Price € — e.g. 12,50", value: p.price ?? "" });
  wrap.append(
    h("div", { class: "prow-detail" },
      h("label", { class: "flabel" }, "Opened"), openedInput,
      h("label", { class: "flabel" }, "Price"), priceInput,
      h("div", { class: "choices" },
        h("button", { class: "choice", onclick: (e) => { e.stopPropagation();
          p.openedDate = openedInput.value || null;
          p.price = parsePrice(priceInput.value);
          saveProducts(); ui.editId = null; bus.rerender(); } }, "Save"),
        !locked && !queued && h("button", { class: "choice warn-line", onclick: (e) => { e.stopPropagation(); startReview(p); } }, "Ran out"),
      )));
  return wrap;
}

const nameOf = (id) => (DB.products.shelf.find((p) => p.id === id) || {}).name || id;
const typeLabel = (t) => (PRODUCT_KINDS.find((k) => k.type === t) || {}).kind || t;
function badgeFor(p) {
  const map = { "oil-cleanser": "Oil", cleanser: "Cleanser", toner: "Toner", retinoid: "Retinal", essence: "Essence", peptide: "Peptide", moisturizer: "Cream", azelaic: "Azelaic", "vitamin-c": "Vit C", "vitamin-c-oil": "Vit C", sunscreen: "SPF", niacinamide: "Niacin." };
  return map[p.type] || "—";
}

// ---- review flow ----
function startReview(p) {
  ui.mode = "review";
  ui.review = {
    productId: p.id, productName: p.name, productType: p.type,
    rating: 0, wouldRebuy: null, tags: [], season: [], note: "",
    openedDate: p.openedDate, price: p.price, outcome: null, switchedTo: null,
  };
  bus.rerender();
}

function renderReview(root) {
  const r = ui.review;
  root.append(h("h2", { class: "view-title" }, `How was ${r.productName}?`));

  // rating
  const stars = h("div", { class: "stars" });
  for (let i = 1; i <= 5; i++) {
    stars.append(h("span", { class: i <= r.rating ? "" : "off", onclick: () => { r.rating = i; bus.rerender(); } }, "★"));
  }
  root.append(field("Rating", stars));

  root.append(field("Would you buy it again?", h("div", { class: "choices" },
    ...["yes", "maybe", "no"].map((v) => h("button", { class: `choice ${r.wouldRebuy === v ? "primary" : ""}`, onclick: () => { r.wouldRebuy = v; bus.rerender(); } }, v)))));

  root.append(field("Tags", h("div", { class: "chips" },
    ...REVIEW_TAGS.map((t) => h("button", { class: `chip ${r.tags.includes(t) ? "on" : ""}`, onclick: () => { r.tags = r.tags.includes(t) ? r.tags.filter((x) => x !== t) : [...r.tags, t]; bus.rerender(); } }, t)))));

  root.append(field("Good for", h("div", { class: "chips" },
    ...["spring", "summer", "autumn", "winter", "all year"].map((s) => h("button", { class: `chip ${r.season.includes(s) ? "on" : ""}`, onclick: () => { r.season = r.season.includes(s) ? r.season.filter((x) => x !== s) : [...r.season, s]; bus.rerender(); } }, s)))));

  const lasted = r.openedDate ? daysBetween(r.openedDate, bus.todayIso) : null;
  if (lasted) root.append(field("How long it lasted", h("div", { class: "inputline" }, `${lasted} days (${(lasted / 30).toFixed(1)} months)`)));
  const priceInput = h("input", { class: "inputline", type: "text", inputmode: "decimal", placeholder: "Optional — e.g. 12,50", value: r.price ?? "" });
  root.append(field("Price €", priceInput));
  const noteInput = h("textarea", { class: "inputline", rows: 2, placeholder: "Optional note — 'great in winter, too heavy for summer'…" });
  noteInput.value = r.note;
  root.append(field("Note", noteInput));

  root.append(field("What now?", h("div", { class: "choices" },
    ...[["rebought", "Bought again"], ["switched", "Switched"], ["nothing-yet", "Nothing yet"]].map(([v, lbl]) =>
      h("button", { class: `choice ${r.outcome === v ? "primary" : ""}`, onclick: () => { r.outcome = v; bus.rerender(); } }, lbl)))));

  if (r.outcome === "switched") {
    const options = DB.products.wantToTry.map((w) => w.name);
    const sel = h("input", { class: "inputline", placeholder: "Switched to…", list: "wtt-list", value: r.switchedTo || "" });
    sel.addEventListener("input", () => { r.switchedTo = sel.value; });
    root.append(field("Switched to", h("div", {},
      h("datalist", { id: "wtt-list" }, ...options.map((o) => h("option", { value: o }))), sel)));
  }

  root.append(h("div", { class: "choices" },
    h("button", { class: "choice", onclick: () => { ui.mode = null; ui.review = null; bus.rerender(); } }, "Cancel"),
    h("button", { class: `choice primary ${r.rating && r.wouldRebuy ? "" : "disabled"}`, onclick: () => {
      if (!r.rating || !r.wouldRebuy) return;
      r.price = parsePrice(priceInput.value);
      r.note = noteInput.value || null;
      finishReview(r, lasted);
    } }, "Save review")));
}

function field(label, node) {
  return h("div", { class: "field" }, h("label", { class: "flabel" }, label), node);
}

function finishReview(r, lasted) {
  const review = {
    id: `rev-${bus.todayIso}-${r.productId}`,
    productName: r.productName, productType: r.productType,
    finishedDate: bus.todayIso, openedDate: r.openedDate || null,
    lastedDays: lasted, rating: r.rating, wouldRebuy: r.wouldRebuy,
    tags: r.tags, season: r.season, price: r.price, currency: "EUR",
    costPerMonth: r.price && lasted ? +(r.price / (lasted / 30)).toFixed(2) : null,
    note: r.note, outcome: r.outcome || "nothing-yet", switchedTo: r.switchedTo || null,
  };
  DB.reviews.reviews.push(review);
  if (r.wouldRebuy === "no") {
    DB.products.neverAgain.push({ name: r.productName, reviewId: review.id, reason: r.tags.join(", ") || "did not rebuy" });
  }
  const p = DB.products.shelf.find((x) => x.id === r.productId);
  if (p) p.status = "finished";
  // promotion message if this was a stand-in
  if (p?.replacesUntilFinished) {
    const promoted = nameOf(p.replacesUntilFinished);
    bus.events = [{ kind: "ok", title: `${promoted} takes over`, body: `${p.name} is finished, so ${promoted} steps into its slot from tonight.` }];
  }
  if (r.outcome === "switched" && r.switchedTo) {
    DB.products.wantToTry = DB.products.wantToTry.filter((w) => w.name !== r.switchedTo);
    ui.mode = "add";
    ui.add = { name: r.switchedTo, kind: null, replacingSlots: p ? p.slots : null };
    saveProducts(); saveReviews();
    bus.rerender();
    return;
  }
  saveProducts(); saveReviews();
  ui.mode = null; ui.review = null;
  bus.rerender();
}

// ---- add flow ----
function renderAdd(root) {
  const a = ui.add;
  root.append(h("h2", { class: "view-title" }, "Add a product"));

  const nameInput = h("input", { class: "inputline", placeholder: "Name", value: a.name });
  nameInput.addEventListener("input", () => { a.name = nameInput.value; });
  root.append(field("Name", nameInput));

  root.append(field("What kind is it?", h("div", { class: "chips" },
    ...PRODUCT_KINDS.map((k) => h("button", { class: `chip ${a.kind === k ? "on" : ""}`, onclick: () => { a.kind = k; bus.rerender(); } }, k.kind)))));

  if (a.kind) {
    // never-again warning
    const hit = DB.products.neverAgain.find((n) => a.name && n.name.toLowerCase().includes(a.name.toLowerCase().slice(0, 12)));
    if (hit && a.name.length > 3) {
      root.append(h("div", { class: "card alert-soft" },
        h("h3", {}, "You've been here before"),
        h("p", {}, `You finished “${hit.name}” and said you wouldn't rebuy — “${hit.reason}”.`)));
    }

    const verdict = CONFLICT_VERDICTS[a.kind.type];
    if (verdict) {
      root.append(h("div", { class: `card ${verdict.level === "ok" ? "ok-soft" : verdict.level === "never" ? "alert-soft" : "warn-soft"}` },
        h("h3", {}, verdictTitle(verdict.level)),
        h("p", {}, verdict.text)));
    }

    if (a.kind.tier >= 2 && a.kind.type !== "retinoid") {
      root.append(h("div", { class: "card" },
        h("p", {}, h("strong", {}, "Patch test first? "),
          "Inner forearm, once a day for 7–10 days. Reactions usually show around day 4 — the 24-hour test on the box isn't long enough. Your call; the app doesn't gate you.")));

      // cooldown / one-at-a-time check
      const lc = DB.state.lastChange;
      const recent = [lc.retinal, lc.azelaic].filter(Boolean).sort().pop();
      const blockedUntil = recent ? addDays(recent, COOLDOWN) : null;
      if (blockedUntil && blockedUntil > bus.todayIso) {
        root.append(h("div", { class: "card sugg ok" },
          h("h3", {}, "Something's still settling in"),
          h("p", {}, `A change landed on ${humanShort(recent)}. If you start this now and react, you won't know which caused it. It can start automatically on ${humanShort(blockedUntil)}.`),
          h("div", { class: "choices stack" },
            h("button", { class: "choice primary", onclick: () => saveNew(a, blockedUntil) }, `Queue it for ${humanShort(blockedUntil)}`),
            h("button", { class: "choice", onclick: () => saveNew(a, null) }, "Start it now anyway"))));
        root.append(cancelRow());
        return;
      }
    }

    root.append(h("div", { class: "choices" },
      h("button", { class: "choice", onclick: () => { ui.mode = null; bus.rerender(); } }, "Cancel"),
      h("button", { class: `choice primary ${a.name.trim() ? "" : "disabled"}`, onclick: () => a.name.trim() && saveNew(a, null) }, "Add")));
  } else {
    root.append(cancelRow());
  }
}

function cancelRow() {
  return h("div", { class: "choices" },
    h("button", { class: "choice", onclick: () => { ui.mode = null; bus.rerender(); } }, "Cancel"));
}

function verdictTitle(level) {
  return level === "ok" ? "Plays fine with your retinal"
    : level === "am" ? "This belongs in your mornings"
    : level === "never" ? "One retinoid at a time"
    : "This gets its own night";
}

function saveNew(a, startOn) {
  const k = a.kind;
  const id = a.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Math.floor(Math.random() * 100);
  const slots = a.replacingSlots || (k.am ? ["am-serum"] : k.tier === 1 ? ["pm-extra"] : []);
  const p = {
    id, name: a.name.trim(), type: k.type, tier: k.tier, slots,
    status: startOn ? "queued" : "in-use", startOn: startOn || null,
    protocol: k.protocol, openedDate: null, price: null, notes: null,
  };
  if (k.tier >= 2 && k.type !== "retinoid" && !k.am) {
    p.schedule = { freq: k.tier === 4 ? 1 : k.tier === 3 ? 1 : 2, startDate: startOn || bus.todayIso, strict: k.tier >= 3 };
    if (!startOn) DB.state.lastChange.azelaic = bus.todayIso; // generic "other active" cooldown stamp
  }
  DB.products.shelf.push(p);
  saveProducts(); saveState();
  ui.mode = null; ui.add = null;
  bus.events = [{ kind: "ok", title: `${p.name} added`, body: startOn ? `Queued — it starts on ${humanShort(startOn)}.` : k.tier >= 2 ? "Phased in gently, on nights away from your retinal." : "In the routine from now on." }];
  bus.rerender();
}
