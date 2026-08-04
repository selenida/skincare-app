// photos.js — capture, downscale, store. The canvas re-encode strips EXIF
// (including location). Long edge 1200px, JPEG q0.8 ≈ 200KB.

import { DB, savePhotos } from "./state.js";
import { enqueue } from "./sync.js";
import { bytesToBase64, sha256hex } from "./util.js";
import { getPinHash, setPinHash } from "./state.js";

export async function processFile(file) {
  const bitmap = await createImageBitmap(file);
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1200 / long);
  const w = Math.round(bitmap.width * scale);
  const hgt = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = hgt;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, hgt);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { b64: bytesToBase64(bytes), width: w, height: hgt, bytes: bytes.length };
}

// kind: 'baseline' | 'milestone' | 'flare'
export async function addPhoto(file, kind, date, startDate) {
  const { b64, width, height, bytes } = await processFile(file);
  const id = `${date}--${kind}${kind === "flare" ? "-" + Math.floor(Math.random() * 1e4) : ""}`;
  const path = `photos/${id}.jpg`;
  const week = startDate ? Math.max(0, Math.round((new Date(date) - new Date(startDate)) / 604800000)) : 0;
  DB.photos.photos.push({ id, path, date, kind, week, width, height, bytes, pendingB64: b64 });
  savePhotos();
  enqueue(path, `Photo — ${kind} ${date}`, "photo", b64);
  // photos.json metadata rides along
  return id;
}

// After a photo op succeeds we could drop pendingB64; done lazily on load to
// keep sync.js decoupled: anything older than 7 days loses its local payload.
export function prunePendingPayloads(todayIso) {
  let changed = false;
  for (const p of DB.photos.photos) {
    if (p.pendingB64 && p.date < todayIso.slice(0, 10) && daysAgo(p.date, todayIso) > 7) {
      delete p.pendingB64;
      changed = true;
    }
  }
  if (changed) savePhotos();
}
function daysAgo(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function localUrlFor(photo) {
  if (!photo.pendingB64) return null;
  const bytes = Uint8Array.from(atob(photo.pendingB64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
}

// ---- PIN ----
let unlockedThisSession = false;
export const pinIsSet = () => !!getPinHash();
export const isUnlocked = () => unlockedThisSession || !pinIsSet();
export async function tryUnlock(pin) {
  const ok = (await sha256hex(pin)) === getPinHash();
  if (ok) unlockedThisSession = true;
  return ok;
}
export async function setPin(pin) {
  setPinHash(pin ? await sha256hex(pin) : "");
  if (pin) unlockedThisSession = true;
}
