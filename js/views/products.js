// views/products.js — shelf, add flow, ran-out → review, and three sub-screens:
// want-to-try, past favourites, finished & reviewed. List rows delete by
// swipe-left (reveal), never by a stray tap.

import { h, humanShort, addDays, daysBetween } from "../util.js";
import { DB, saveProducts, saveReviews, saveState } from "../state.js";
import { bus } from "../bus.js";
import { PRODUCT_KINDS, CONFLICT_VERDICTS, REVIEW_TAGS } from "../seed.js";
import { COOLDOWN } from "../engine.js";

const ui = { mode: null, editId: null, review: null, add: null, openReviewId: null, screen: null };

// iOS number inputs reject the decimal separator on many keyboard locales,
// and Finnish keyboards give a comma. Text + inputmode=decimal, parse both.
function parsePrice(v) {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function renderProducts(root) {
  if (ui.mode === "add") return renderAdd(root);
  if (ui.mode === "review") return renderReview(root);
  if (ui.screen === "wtt") return subScreen(root, "Want to try", renderWantToTryList);
  if (ui.screen === "past") return subScreen(root, "Past favourites", renderPastList);
  if (ui.screen === "archive") return subScreen(root, "Finished & reviewed", renderArchiveList);

  const shelf = DB.products.shelf;
  // A product can live in both routines (same bottle, two slots) — it shows
  // under both headings.
  const groups = [
    ["Evening", (p) => (p.slots || []).some((s) => s.startsWith("pm-"))],
    ["Morning", (p) => (p.slots || []).some((s) => s.startsWith("am-"))],
  ];
  for (const [label, match] of groups) {
    root.append(h("div", { class: "sec" }, label));
    for (const p of shelf.filter((x) => x.status !== "finished" && match(x))) {
      root.append(productRow(p));
    }
  }

  root.append(h("button", { class: "addbtn", onclick: () => { ui.mode = "add"; ui.add = { name: "", kind: null, when: "pm" }; bus.rerender(); } }, "+ Add a product"));

  const wtt = DB.products.wantToTry.length;
  const past = (DB.products.pastFavorites || []).length;
  const arch = DB.reviews.reviews.filter((r) => !r.pastFavorite).length;
  root.append(h("div", { class: "sec" }, "Lists"));
  root.append(navRow("Want to try", wtt, () => { ui.screen = "wtt"; bus.rerender({ resetScroll: true }); }));
  root.append(navRow("Past favourites", past, () => { ui.screen = "past"; bus.rerender({ resetScroll: true }); }));
  root.append(navRow("Finished & reviewed", arch, () => { ui.screen = "archive"; bus.rerender({ resetScroll: true }); }));
}

function navRow(label, count, onclick) {
  return h("div", { class: "mrow", onclick },
    h("span", {}, h("span", { class: "nm" }, label),
      h("div", { class: "sub" }, count ? `${count} item${count > 1 ? "s" : ""}` : "Empty")),
    h("span", { class: "arw" }, "›"));
}

function subScreen(root, title, body) {
  root.append(h("div", { class: "daynav" },
    h("button", { class: "btn-sm", onclick: () => { ui.screen = null; ui.openReviewId = null; bus.rerender({ resetScroll: true }); } }, "‹ Products")));
  root.append(h("h2", { class: "view-title" }, title));
  body(root);
}

// ---- swipe-left to delete ----
// Reveal an 88px Delete behind the row; tap it to delete. Vertical scrolling
// stays native (touch-action: pan-y). A tap on a swiped-open row closes it.
function swipeDelete(row, onDelete) {
  const wrap = h("div", { class: "swipe-wrap" });
  const del = h("button", { class: "swipe-del", onclick: (e) => { e.stopPropagation(); onDelete(); } }, "Delete");
  wrap.append(del, row);
  let x0 = null, cur = 0, open = false, dragging = false;
  row.style.touchAction = "pan-y";
  row.addEventListener("pointerdown", (e) => { x0 = e.clientX; dragging = false; });
  row.addEventListener("pointermove", (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 8) dragging = true;
    if (dragging) {
      cur = Math.max(-88, Math.min(0, (open ? -88 : 0) + dx));
      row.style.transform = `translateX(${cur}px)`;
    }
  });
  const settle = () => {
    if (x0 == null) return;
    open = cur < -44;
    cur = open ? -88 : 0;
    row.style.transition = "transform .15s";
    row.style.transform = `translateX(${cur}px)`;
    setTimeout(() => (row.style.transition = ""), 180);
    x0 = null;
    // The drag's own ghost click (if any) fires immediately; a deliberate tap
    // on Delete comes later. Browsers don't reliably fire a click after a
    // drag, so the flag can't wait for one.
    setTimeout(() => { dragging = false; }, 80);
  };
  row.addEventListener("pointerup", settle);
  row.addEventListener("pointercancel", settle);
  // capture on the wrap runs before the row's own click handlers, so a drag
  // or an open row never triggers tap actions like expansion
  wrap.addEventListener("click", (e) => {
    if (dragging) { e.stopPropagation(); e.preventDefault(); dragging = false; return; }
    if (open && e.target !== del) {
      e.stopPropagation(); e.preventDefault();
      open = false; cur = 0; row.style.transform = "translateX(0)";
    }
  }, true);
  return wrap;
}

// ---- want to try ----
function renderWantToTryList(root) {
  const wtt = DB.products.wantToTry;
  if (!wtt.length) root.append(h("p", { class: "disc" }, "Empty. Park anything you're curious about here — it's offered when something runs out."));
  for (const w of wtt) {
    const row = h("div", { class: "prow" },
      h("span", { style: { flex: 1 } }, h("span", { class: "nm" }, w.name),
        h("div", { class: "sub" }, `Added ${humanShort(w.addedDate)}`)));
    root.append(swipeDelete(row, () => {
      DB.products.wantToTry = DB.products.wantToTry.filter((x) => x !== w);
      saveProducts(); bus.rerender();
    }));
  }
  root.append(listInput("Add something to try…", (name) => {
    DB.products.wantToTry.push({ name, addedDate: bus.todayIso, note: null });
    saveProducts();
  }));
  root.append(h("p", { class: "disc" }, "Swipe a row left to delete it."));
}

// ---- past favourites ----
function renderPastList(root) {
  const past = DB.products.pastFavorites || (DB.products.pastFavorites = []);
  if (!past.length) root.append(h("p", { class: "disc" }, "Products you loved before the app existed. Review them so future-you remembers why — they're offered whenever something runs out."));
  for (const f of past) {
    const review = f.reviewId ? DB.reviews.reviews.find((r) => r.id === f.reviewId) : null;
    const open = review && ui.openReviewId === review.id;
    const row = h("div", { class: `prow ${open ? "open" : ""}` },
      h("span", { style: { flex: 1 } },
        h("span", { class: "nm" }, f.name),
        h("div", { class: "sub" }, review ? "★".repeat(review.rating) + "☆".repeat(5 - review.rating) + ` · rebuy: ${review.wouldRebuy}` : "Not reviewed yet")),
      review
        ? h("span", { class: "arw" }, open ? "⌄" : "›")
        : h("button", { class: "btn-sm", onclick: (e) => { e.stopPropagation(); startReview({ id: null, name: f.name, type: f.type || "other" }, "past"); } }, "Review"));
    row.onclick = () => {
      if (!review) return;
      ui.openReviewId = open ? null : review.id;
      bus.rerender();
    };
    root.append(swipeDelete(row, () => {
      DB.products.pastFavorites = past.filter((x) => x !== f);
      saveProducts(); bus.rerender();
    }));
    if (open) root.append(reviewDetails(review));
  }
  root.append(listInput("Add a past favourite…", (name) => {
    DB.products.pastFavorites.push({ name, addedDate: bus.todayIso, reviewId: null });
    saveProducts();
  }));
  root.append(h("p", { class: "disc" }, "Tap a reviewed one to reread it. Swipe left to delete."));
}

// ---- archive ----
function renderArchiveList(root) {
  const reviews = DB.reviews.reviews.filter((r) => !r.pastFavorite);
  if (!reviews.length) root.append(h("p", { class: "disc" }, "Nothing finished yet. When a product runs out, its review lands here."));
  for (const r of [...reviews].reverse()) {
    const never = DB.products.neverAgain.some((n) => n.reviewId === r.id);
    const open = ui.openReviewId === r.id;
    const row = h("div", { class: `prow ${never ? "never" : ""} ${open ? "open" : ""}`, onclick: () => { ui.openReviewId = open ? null : r.id; bus.rerender(); } },
      h("span", { style: { flex: 1 } },
        h("span", { class: "nm" }, r.productName),
        h("div", { class: "sub" }, "★".repeat(r.rating) + "☆".repeat(5 - r.rating) + ` · rebuy: ${r.wouldRebuy} · ${humanShort(r.finishedDate)}`)),
      never && h("span", { class: "badge alert" }, "never again"),
      h("span", { class: "arw" }, open ? "⌄" : "›"));
    root.append(row);
    if (open) root.append(reviewDetails(r));
  }
}

// Full detail panel — everything she submitted, readable a year later.
function reviewDetails(r) {
  const rows = [];
  const add = (label, val) => val != null && val !== "" && rows.push(h("div", { class: "rd-row" }, h("span", { class: "rd-l" }, label), h("span", { class: "rd-v" }, val)));
  add("Rating", "★".repeat(r.rating) + "☆".repeat(5 - r.rating));
  add("Buy again", r.wouldRebuy);
  add("Tags", (r.tags || []).join(", ") || null);
  add("Good for", (r.season || []).join(", ") || null);
  if (r.lastedDays) add("Lasted", `${r.lastedDays} days (${(r.lastedDays / 30).toFixed(1)} months)`);
  if (r.price) add("Price", `${r.price.toFixed(2)} €`);
  if (r.costPerMonth) add("Cost", `${r.costPerMonth.toFixed(2)} €/month`);
  if (r.outcome && r.outcome !== "nothing-yet") add("Afterwards", r.outcome === "switched" ? `switched to ${r.switchedTo || "?"}` : "bought it again");
  if (r.openedDate) add("Opened", humanShort(r.openedDate));
  if (r.finishedDate) add("Reviewed", humanShort(r.finishedDate));
  return h("div", { class: "prow-open" }, h("div", { class: "prow-detail" }, rows,
    r.note && h("p", { class: "rd-note" }, "“", r.note, "”")));
}

function listInput(placeholder, onAdd) {
  const input = h("input", { class: "inputline", placeholder });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      onAdd(input.value.trim());
      bus.rerender();
    }
  });
  return input;
}

// ---- shelf rows ----
function productRow(p) {
  const locked = p.locked;
  const queued = p.status === "queued";
  const both = (p.slots || []).some((s) => s.startsWith("am-")) && (p.slots || []).some((s) => s.startsWith("pm-"));
  const row = h("div", { class: `prow ${locked || queued ? "locked" : ""}` },
    h("span", { style: { flex: 1 } },
      h("span", { class: "nm" }, p.name),
      h("div", { class: "sub" },
        locked ? "Unlocks in week 3 — the app offers it when your skin is ready" :
        queued ? `Queued to start ${humanShort(p.startOn)}` :
        p.replacesUntilFinished ? `Standing in for ${nameOf(p.replacesUntilFinished)} until finished` :
        p.concentration || typeLabel(p.type),
        both ? " · morning + evening" : "",
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
        !locked && !queued && h("button", { class: "choice warn-line", onclick: (e) => { e.stopPropagation(); startReview(p, "shelf"); } }, "Ran out"),
      )));
  return wrap;
}

const nameOf = (id) => (DB.products.shelf.find((p) => p.id === id) || {}).name || id;
const typeLabel = (t) => (PRODUCT_KINDS.find((k) => k.type === t) || {}).kind || t;
function badgeFor(p) {
  const map = { "oil-cleanser": "Oil", cleanser: "Cleanser", toner: "Toner", retinoid: "Retinal", essence: "Essence", peptide: "Peptide", moisturizer: "Cream", azelaic: "Azelaic", "vitamin-c": "Vit C", "vitamin-c-oil": "Vit C", sunscreen: "SPF", niacinamide: "Niacin." };
  return map[p.type] || "—";
}

// ---- review flow (context: 'shelf' = ran out, 'past' = past favourite) ----
function startReview(p, context) {
  ui.mode = "review";
  ui.review = {
    context, productId: p.id, productName: p.name, productType: p.type,
    rating: 0, wouldRebuy: null, tags: [], season: [], note: "",
    openedDate: p.openedDate || null, price: p.price || null, outcome: null, switchedTo: null,
  };
  bus.rerender();
}

function renderReview(root) {
  const r = ui.review;
  root.append(h("h2", { class: "view-title" }, `How was ${r.productName}?`));

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

  const lasted = r.context === "shelf" && r.openedDate ? daysBetween(r.openedDate, bus.todayIso) : null;
  if (lasted) root.append(field("How long it lasted", h("div", { class: "inputline" }, `${lasted} days (${(lasted / 30).toFixed(1)} months)`)));
  const priceInput = h("input", { class: "inputline", type: "text", inputmode: "decimal", placeholder: "Optional — e.g. 12,50", value: r.price ?? "" });
  root.append(field("Price €", priceInput));
  const noteInput = h("textarea", { class: "inputline", rows: 2, placeholder: "Optional note — 'great in winter, too heavy for summer'…" });
  noteInput.value = r.note;
  root.append(field("Note", noteInput));

  if (r.context === "shelf") {
    root.append(field("What now?", h("div", { class: "choices" },
      ...[["rebought", "Bought again"], ["switched", "Switched"], ["nothing-yet", "Nothing yet"]].map(([v, lbl]) =>
        h("button", { class: `choice ${r.outcome === v ? "primary" : ""}`, onclick: () => { r.outcome = v; bus.rerender(); } }, lbl)))));

    if (r.outcome === "switched") {
      const options = [
        ...DB.products.wantToTry.map((w) => w.name),
        ...(DB.products.pastFavorites || []).map((f) => f.name),
      ];
      const sel = h("input", { class: "inputline", placeholder: "Switched to…", list: "switch-list", value: r.switchedTo || "" });
      sel.addEventListener("input", () => { r.switchedTo = sel.value; });
      root.append(field("Switched to", h("div", {},
        h("datalist", { id: "switch-list" }, ...options.map((o) => h("option", { value: o }))), sel)));
    }
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
    id: `rev-${bus.todayIso}-${(r.productId || r.productName).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`,
    productName: r.productName, productType: r.productType,
    finishedDate: bus.todayIso, openedDate: r.openedDate || null,
    lastedDays: lasted, rating: r.rating, wouldRebuy: r.wouldRebuy,
    tags: r.tags, season: r.season, price: r.price, currency: "EUR",
    costPerMonth: r.price && lasted ? +(r.price / (lasted / 30)).toFixed(2) : null,
    note: r.note, outcome: r.outcome || "nothing-yet", switchedTo: r.switchedTo || null,
    pastFavorite: r.context === "past",
  };
  DB.reviews.reviews.push(review);
  if (r.wouldRebuy === "no") {
    DB.products.neverAgain.push({ name: r.productName, reviewId: review.id, reason: r.tags.join(", ") || "did not rebuy" });
  }

  if (r.context === "past") {
    const fav = (DB.products.pastFavorites || []).find((f) => f.name === r.productName);
    if (fav) fav.reviewId = review.id;
    saveProducts(); saveReviews();
    ui.mode = null; ui.review = null; ui.openReviewId = review.id; ui.screen = "past";
    bus.rerender();
    return;
  }

  const p = DB.products.shelf.find((x) => x.id === r.productId);
  if (p) p.status = "finished";
  if (p?.replacesUntilFinished) {
    const promoted = nameOf(p.replacesUntilFinished);
    bus.events = [{ kind: "ok", title: `${promoted} takes over`, body: `${p.name} is finished, so ${promoted} steps into its slot from tonight.` }];
  }
  if (r.outcome === "switched" && r.switchedTo) {
    DB.products.wantToTry = DB.products.wantToTry.filter((w) => w.name !== r.switchedTo);
    ui.mode = "add";
    ui.add = { name: r.switchedTo, kind: null, when: "pm", replacingSlots: p ? p.slots : null };
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
    // Same bottle, second routine: if she already owns this kind, offer it
    // before assuming a new product ("add my toner to mornings too").
    const owned = DB.products.shelf.filter((p) => p.type === a.kind.type && !p.locked);
    if (owned.length && !a.reuseDismissed) {
      const card = h("div", { class: "card ok-soft" },
        h("h3", {}, "Use one you already have?"),
        h("div", { class: "chips" },
          ...owned.map((p) => h("button", { class: `chip ${a.reuse === p.id ? "on" : ""}`, onclick: () => { a.reuse = p.id; bus.rerender(); } },
            p.name + (p.status === "finished" ? " (finished)" : "")))));
      if (a.reuse) {
        card.append(
          h("p", {}, "Add it to which routine?"),
          h("div", { class: "choices" },
            h("button", { class: "choice primary", onclick: () => reuseProduct(a.reuse, "am") }, "Morning"),
            h("button", { class: "choice primary", onclick: () => reuseProduct(a.reuse, "pm") }, "Evening")));
      }
      card.append(h("div", { class: "choices" },
        h("button", { class: "choice", onclick: () => { a.reuseDismissed = true; a.reuse = null; bus.rerender(); } }, "No — it's a new product")));
      root.append(card, cancelRow());
      return;
    }

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

    // gentle products can join either routine — ask instead of assuming evening
    if (a.kind.tier === 1 && !a.kind.am) {
      root.append(field("Which routine?", h("div", { class: "choices" },
        h("button", { class: `choice ${a.when === "pm" ? "primary" : ""}`, onclick: () => { a.when = "pm"; bus.rerender(); } }, "Evening"),
        h("button", { class: `choice ${a.when === "am" ? "primary" : ""}`, onclick: () => { a.when = "am"; bus.rerender(); } }, "Morning"))));
    }

    if (a.kind.tier >= 2 && a.kind.type !== "retinoid") {
      root.append(h("div", { class: "card" },
        h("p", {}, h("strong", {}, "Patch test first? "),
          "Inner forearm, once a day for 7–10 days. Reactions usually show around day 4 — the 24-hour test on the box isn't long enough. Your call; the app doesn't gate you.")));

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

function reuseProduct(productId, when) {
  const p = DB.products.shelf.find((x) => x.id === productId);
  if (!p) return;
  const slot = when === "am" ? "am-extra" : "pm-extra";
  p.slots = [...new Set([...(p.slots || []), slot])];
  if (p.status === "finished") p.status = "in-use";
  saveProducts();
  ui.mode = null; ui.add = null;
  bus.events = [{
    kind: "ok",
    title: `${p.name} — added to your ${when === "am" ? "morning" : "evening"} routine`,
    body: when === "am"
      ? "Same bottle, no duplicate. It now shows under Morning on your shelf and on the morning reference card."
      : "Same bottle, no duplicate. It appears as a step just before your moisturizer.",
  }];
  bus.rerender();
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
  const morning = k.am || (k.tier === 1 && a.when === "am");
  const slots = a.replacingSlots || (morning ? ["am-extra"] : k.tier === 1 ? ["pm-extra"] : []);
  const p = {
    id, name: a.name.trim(), type: k.type, tier: k.tier, slots,
    status: startOn ? "queued" : "in-use", startOn: startOn || null,
    protocol: k.protocol, openedDate: null, price: null, notes: null,
  };
  if (k.tier >= 2 && k.type !== "retinoid" && !k.am) {
    p.schedule = { freq: k.tier === 4 ? 1 : k.tier === 3 ? 1 : 2, startDate: startOn || bus.todayIso, strict: k.tier >= 3 };
    if (!startOn) DB.state.lastChange.azelaic = bus.todayIso;
  }
  DB.products.shelf.push(p);
  saveProducts(); saveState();
  ui.mode = null; ui.add = null;
  bus.events = [{ kind: "ok", title: `${p.name} added`, body: startOn ? `Queued — it starts on ${humanShort(startOn)}.` : morning ? "On the morning reference card from tomorrow." : k.tier >= 2 ? "Phased in gently, on nights away from your retinal." : "In the evening routine from tonight." }];
  bus.rerender();
}
