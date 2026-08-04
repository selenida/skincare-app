// icons.js — original hand-drawn glyphs in the soft line style: warm-grey
// rounded strokes (currentColor), blush pink and pale mint fills. All inline
// SVG; nothing external.

import { h } from "./util.js";

const PINK = "#E8A9B5";
const MINT = "#D9E9E5";

const DEFS = {
  // bottles & vessels
  bottle: `<path d="M10.3 4.5h3.4v3h-3.4z" fill="${PINK}"/><rect x="8" y="7.5" width="8" height="13" rx="2.4" fill="${MINT}"/><path d="M9.8 11h4.4"/>`,
  pump: `<path d="M10.7 6.2V4h4.6M15.3 4v2.4"/><rect x="8.4" y="8.6" width="7.4" height="11.9" rx="2.2" fill="${MINT}"/><path d="M15.3 4h2.6v1.9h-1.3" fill="none"/>`,
  drop: `<path d="M12 3.8C12 3.8 6.2 10.6 6.2 14.7a5.8 5.8 0 0 0 11.6 0C17.8 10.6 12 3.8 12 3.8Z" fill="${MINT}"/><path d="M9.4 14.4a2.6 2.6 0 0 0 1.7 2.6" fill="none"/>`,
  dropplus: `<path d="M10.7 5.4C10.7 5.4 5.6 11.4 5.6 15a5.1 5.1 0 0 0 10.2 0C15.8 11.4 10.7 5.4 10.7 5.4Z" fill="${MINT}"/><path d="M18.6 4.6v4.4M16.4 6.8h4.4" stroke="${PINK}" stroke-width="2.1" fill="none"/>`,
  dropper: `<path d="M9 4h6"/><path d="M10.2 4c0 2-.5 2.7-1.1 3.6-.4.7-.4 1.4-.4 1.4h6.6s0-.7-.4-1.4c-.6-.9-1.1-1.6-1.1-3.6" fill="${PINK}"/><path d="M9.6 9h4.8l-1 7.2h-2.8z" fill="${MINT}"/><path d="M12 18.6c0 0-1.3 1.5-1.3 2.4a1.3 1.3 0 0 0 2.6 0c0-.9-1.3-2.4-1.3-2.4z" fill="${MINT}"/>`,
  jar: `<rect x="7.2" y="6.4" width="9.6" height="3.6" rx="1.4" fill="${PINK}"/><path d="M6.4 10.6h11.2l-.9 7.5a2.3 2.3 0 0 1-2.3 2h-4.8a2.3 2.3 0 0 1-2.3-2z" fill="${MINT}"/><path d="M9.3 14h5.4"/>`,
  tube: `<rect x="8.6" y="3.4" width="6.8" height="2.9" rx="1" fill="${PINK}"/><path d="M9 6.9 7.1 18.2a2.1 2.1 0 0 0 2.1 2.4h5.6a2.1 2.1 0 0 0 2.1-2.4L15 6.9z" fill="${MINT}"/><circle cx="12" cy="14" r="1.9" fill="none"/>`,
  mask: `<path d="M12 3.9c3.5 0 6.3 2.6 6.9 6.3.6 3.8-1 7.4-4 9.7-1.8 1.4-3.9 1.4-5.8 0-3-2.3-4.6-5.9-4-9.7.6-3.7 3.4-6.3 6.9-6.3z" fill="${MINT}"/><ellipse cx="9.3" cy="11" rx="1.6" ry="1"/><ellipse cx="14.7" cy="11" rx="1.6" ry="1"/><ellipse cx="12" cy="15.4" rx="1.7" ry="1.1"/>`,
  clock: `<circle cx="12" cy="12" r="8.2" fill="${MINT}"/><path d="M12 7.6V12l3.1 2.1" fill="none"/>`,
  leaf: `<path d="M5.6 18.4C5.6 10.2 10 5.7 18.7 5.6c-.1 8.7-4.6 13.1-12.8 13z" fill="${MINT}"/><path d="M6.8 17.2C9.2 13 12.2 10 16.1 7.9" fill="none"/>`,
  heart: `<path d="M12 19.6s-6.8-4.4-6.8-9.6a4.1 4.1 0 0 1 6.8-3 4.1 4.1 0 0 1 6.8 3c0 5.2-6.8 9.6-6.8 9.6z" fill="${PINK}"/>`,
  moon: `<path d="M20.2 14.3A8.4 8.4 0 1 1 9.7 3.8a6.6 6.6 0 0 0 10.5 10.5Z" fill="${MINT}"/>`,
  calendar: `<rect x="3.6" y="5" width="16.8" height="15.2" rx="3" fill="${MINT}"/><path d="M3.6 10h16.8M8 3.3v3.4M16 3.3v3.4" fill="none"/>`,
  dots: `<path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="2.6"/>`,
  camera: `<path d="M8.6 7.2 10 4.8h4l1.4 2.4" fill="none"/><rect x="3.6" y="7.2" width="16.8" height="12.6" rx="3" fill="${MINT}"/><circle cx="12" cy="13.2" r="3.3" fill="#FDFDFC"/>`,
  skin: `<rect x="4" y="7.6" width="16" height="12.4" rx="2.2" fill="${PINK}" fill-opacity=".55"/><path d="M4 12.2c2.6 0 2.6-2.1 5.3-2.1s2.7 2.1 5.4 2.1 2.6-2.1 5.3-2.1" fill="none"/><path d="M8.5 16.4h.01M12.5 17.6h.01M16 15.6h.01" stroke-width="2.2" stroke="${PINK}"/>`,
  sparkle: `<path d="M12 5.6v12.8M5.6 12h12.8" /><path d="M18.4 5.6l.01.01M5.6 18.4l.01.01" stroke="${PINK}" stroke-width="2.4"/>`,
};

export function icon(name, cls = "ic") {
  const span = h("span", { class: cls });
  span.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
    `stroke-linecap="round" stroke-linejoin="round">${DEFS[name] || DEFS.sparkle}</svg>`;
  return span;
}

export const TYPE_ICON = {
  "oil-cleanser": "bottle",
  cleanser: "pump",
  toner: "bottle",
  essence: "drop",
  peptide: "dropper",
  retinoid: "dropper",
  moisturizer: "jar",
  azelaic: "dropplus",
  "vitamin-c": "dropper",
  "vitamin-c-oil": "dropper",
  sunscreen: "tube",
  niacinamide: "drop",
  "mask-peel": "mask",
  "exfoliating-acid": "drop",
  "benzoyl-peroxide": "drop",
  other: "sparkle",
};

export const NIGHT_ICON = {
  retinal: "dropper",
  azelaic: "dropplus",
  recovery: "leaf",
  rescue: "heart",
};
