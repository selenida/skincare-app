// views/photosview.js — timeline, comparison (slider + blink), capture.

import { h, humanShort, isDaytime } from "../util.js";
import { DB, saveState } from "../state.js";
import { bus } from "../bus.js";
import { addPhoto, localUrlFor } from "../photos.js";
import { photoObjectUrl } from "../sync.js";

const ui = { a: null, b: null, blink: false, blinkShowB: true, urls: new Map() };

async function urlFor(photo) {
  if (ui.urls.has(photo.id)) return ui.urls.get(photo.id);
  const url = localUrlFor(photo) || (await photoObjectUrl(photo.path));
  if (url) ui.urls.set(photo.id, url);
  return url;
}

export function renderPhotos(root, onBack) {
  const photos = [...DB.photos.photos].sort((a, b) => (a.date < b.date ? -1 : 1));

  root.append(h("div", { class: "daynav" },
    h("button", { class: "btn-sm", onclick: onBack }, "‹ History"),
    h("span", { class: "sub" }, "Stored in your private repo · EXIF stripped")));

  if (photos.length >= 2) {
    // default: app-chosen pair — latest vs earliest of the same kind if possible
    if (!ui.a || !ui.b) {
      const milestones = photos.filter((p) => p.kind !== "flare");
      const pool = milestones.length >= 2 ? milestones : photos;
      ui.a = pool[0].id;
      ui.b = pool[pool.length - 1].id;
    }
    const a = photos.find((p) => p.id === ui.a), b = photos.find((p) => p.id === ui.b);
    root.append(compareCard(a, b));
  } else {
    root.append(h("div", { class: "card" },
      h("p", { class: "sub" }, photos.length === 1 ? "One photo so far — comparisons unlock with the second." : "No photos yet. The baseline is the one future-you compares against.")));
  }

  // capture
  const input = h("input", { type: "file", accept: "image/*", capture: "user", style: { display: "none" } });
  input.onchange = async () => {
    if (!input.files[0]) return;
    const kind = DB.state.flare.active ? "flare" : DB.photos.photos.length ? "milestone" : "baseline";
    await addPhoto(input.files[0], kind, bus.todayIso, DB.state.startDate);
    if (kind === "baseline") DB.state.settings.baselineDone = true;
    if (kind === "flare") DB.state.flare.lastPhotoDate = bus.todayIso;
    saveState();
    ui.a = ui.b = null;
    bus.rerender();
  };
  root.append(input);
  root.append(h("button", { class: "addbtn", onclick: () => input.click() },
    "Take a photo" + (isDaytime() ? "" : " (better in daylight)")));

  // timeline grid
  if (photos.length) {
    root.append(h("div", { class: "sec" }, "All photos"));
    const grid = h("div", { class: "photogrid" });
    for (const p of photos) {
      const cell = h("div", { class: `photocell ${ui.a === p.id || ui.b === p.id ? "sel" : ""}`, onclick: () => {
        if (ui.a === p.id) ui.a = null;
        else if (ui.b === p.id) ui.b = null;
        else if (!ui.a) ui.a = p.id;
        else ui.b = p.id;
        bus.rerender();
      } },
        h("div", { class: "photocap" }, `${p.kind === "flare" ? "flare" : "w" + p.week} · ${humanShort(p.date)}`));
      urlFor(p).then((url) => {
        if (url) cell.style.backgroundImage = `url(${url})`;
        else cell.append(h("span", { class: "pending" }, "waiting for sync"));
      });
      grid.append(cell);
    }
    root.append(grid);
    root.append(h("p", { class: "disc" }, "Tap two photos to compare them."));
  }
}

function compareCard(a, b) {
  const card = h("div", { class: "card" });
  const box = h("div", { class: "compare" });
  const imgA = h("div", { class: "cphoto" });
  const imgB = h("div", { class: "cphoto b" });
  urlFor(a).then((u) => u && (imgA.style.backgroundImage = `url(${u})`));
  urlFor(b).then((u) => u && (imgB.style.backgroundImage = `url(${u})`));
  box.append(imgA, imgB);

  const capA = `${a.kind === "flare" ? "flare" : "week " + a.week} · ${humanShort(a.date)}`;
  const capB = `${b.kind === "flare" ? "flare" : "week " + b.week} · ${humanShort(b.date)}`;

  if (ui.blink) {
    imgB.style.clipPath = "none";
    imgB.style.opacity = ui.blinkShowB ? "1" : "0";
    const iv = setInterval(() => {
      if (!document.body.contains(box)) return clearInterval(iv);
      ui.blinkShowB = !ui.blinkShowB;
      imgB.style.opacity = ui.blinkShowB ? "1" : "0";
    }, 650);
    card.append(h("div", { class: "compare-caps" }, h("span", {}, "blinking: "), h("strong", {}, `${capA} ⇄ ${capB}`)));
  } else {
    // slider
    let pos = 50;
    const divider = h("div", { class: "divider", style: { left: "50%" } }, h("div", { class: "handle" }, "‹›"));
    imgB.style.clipPath = `inset(0 0 0 ${pos}%)`;
    const move = (clientX) => {
      const rect = box.getBoundingClientRect();
      pos = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
      divider.style.left = pos + "%";
      imgB.style.clipPath = `inset(0 0 0 ${pos}%)`;
    };
    box.addEventListener("pointerdown", (e) => {
      move(e.clientX);
      const mv = (ev) => move(ev.clientX);
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
    });
    box.append(divider);
    card.append(h("div", { class: "compare-caps" }, h("span", {}, capA), h("span", {}, capB)));
  }

  card.prepend(box);
  card.append(h("div", { class: "choices" },
    h("button", { class: `choice ${ui.blink ? "" : "primary"}`, onclick: () => { ui.blink = false; bus.rerender(); } }, "Slider"),
    h("button", { class: `choice ${ui.blink ? "primary" : ""}`, onclick: () => { ui.blink = true; bus.rerender(); } }, "Blink A/B")));
  card.append(h("p", { class: "disc" }, "Blink flips the two in place — small changes are much easier to catch that way."));
  return card;
}
