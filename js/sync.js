// sync.js — GitHub Contents API client + offline-first write queue.
// The queue holds PATHS, not content: content is serialized from localStorage
// at push time, so coalesced writes always push the latest truth.

import { getToken, setQueue, getQueue, serializeForPath, replaceAll } from "./state.js";
import { toBase64, fromBase64, uid } from "./util.js";

export const REPO = { owner: "selenida", name: "skincare-data", branch: "main" };
const API = () => `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/`;

const BACKOFF = [2e3, 5e3, 15e3, 60e3, 300e3];

export const sync = {
  status: "idle", // idle | syncing | synced | offline | auth-failed | rate-limited
  pending: 0,
  lastError: null,
  onChange: null,
};

function emit() {
  sync.pending = getQueue().length;
  if (sync.onChange) sync.onChange(sync);
}

function headers() {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Enqueue a path. JSON paths coalesce (latest content wins at push time);
// photo ops carry their payload and never coalesce.
export function enqueue(path, message, kind = "json", payload = null) {
  const q = getQueue();
  const existing = kind === "json" ? q.find((op) => op.path === path) : null;
  if (existing) {
    existing.message = message || existing.message;
  } else {
    q.push({ id: uid(), path, kind, message: message || `Update ${path}`, payload, attempts: 0, nextAt: 0, queuedAt: new Date().toISOString() });
  }
  setQueue(q);
  emit();
  drain();
}

const shaCache = new Map();

async function getSha(path) {
  if (shaCache.has(path)) return shaCache.get(path);
  const res = await fetch(API() + path + `?ref=${REPO.branch}`, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error("get failed"), { status: res.status, res });
  const json = await res.json();
  shaCache.set(path, json.sha);
  return json.sha;
}

async function putFile(op) {
  const content = op.kind === "photo" ? op.payload : toBase64(serializeForPath(op.path) ?? "");
  const body = { message: op.message, content, branch: REPO.branch };
  const sha = await getSha(op.path).catch(() => null);
  if (sha) body.sha = sha;

  let res = await fetch(API() + op.path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });

  if (res.status === 409 || res.status === 422) {
    // stale sha — refetch and retry (max 3 by op.attempts loop)
    shaCache.delete(op.path);
    const fresh = await getSha(op.path).catch(() => null);
    if (fresh) body.sha = fresh; else delete body.sha;
    res = await fetch(API() + op.path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
  }
  if (!res.ok) throw Object.assign(new Error("put failed"), { status: res.status, res });
  const json = await res.json();
  shaCache.set(op.path, json.content.sha);
  return json;
}

let draining = false;

export async function drain() {
  if (draining) return;
  if (!getToken()) { sync.status = getQueue().length ? "auth-failed" : "idle"; emit(); return; }
  if (!navigator.onLine) { sync.status = "offline"; emit(); return; }

  draining = true;
  sync.status = "syncing";
  emit();
  try {
    let q = getQueue();
    const now = Date.now();
    for (const op of [...q]) {
      if (op.nextAt && op.nextAt > now) continue;
      try {
        await putFile(op);
        q = getQueue().filter((o) => o.id !== op.id);
        setQueue(q);
        emit();
      } catch (e) {
        if (e.status === 401 || e.status === 403) {
          const remaining = e.res?.headers?.get?.("x-ratelimit-remaining");
          if (e.status === 403 && remaining === "0") {
            sync.status = "rate-limited";
            const reset = Number(e.res.headers.get("x-ratelimit-reset") || 0) * 1000;
            op.nextAt = reset || now + 300e3;
          } else {
            sync.status = "auth-failed";
            draining = false;
            emit();
            return; // keep the queue intact
          }
        } else {
          op.attempts += 1;
          op.nextAt = now + BACKOFF[Math.min(op.attempts - 1, BACKOFF.length - 1)];
          sync.lastError = `${e.status || "network"} on ${op.path}`;
        }
        const q2 = getQueue();
        const idx = q2.findIndex((o) => o.id === op.id);
        if (idx >= 0) { q2[idx] = op; setQueue(q2); }
      }
    }
    sync.status = getQueue().length ? (navigator.onLine ? "syncing-later" : "offline") : "synced";
  } finally {
    draining = false;
    emit();
  }
}

export async function testConnection() {
  const res = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.name}`, { headers: headers() });
  if (res.status === 401 || res.status === 403) return { ok: false, why: "Token rejected — check it was copied fully and has Contents read & write on skincare-data." };
  if (res.status === 404) return { ok: false, why: "Repo not found — is it named exactly skincare-data, and does the token have access to it?" };
  if (!res.ok) return { ok: false, why: `GitHub answered ${res.status}.` };
  return { ok: true };
}

// Fetch a file's decoded JSON (for restore) or base64 (for photos).
export async function fetchFile(path, raw = false) {
  const res = await fetch(API() + path + `?ref=${REPO.branch}`, { headers: headers() });
  if (!res.ok) return null;
  const json = await res.json();
  return raw ? json.content.replace(/\n/g, "") : JSON.parse(fromBase64(json.content.replace(/\n/g, "")));
}

const photoUrlCache = new Map();
export async function photoObjectUrl(path) {
  if (photoUrlCache.has(path)) return photoUrlCache.get(path);
  const b64 = await fetchFile(path, true);
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  photoUrlCache.set(path, url);
  return url;
}

export async function restoreAll() {
  const files = {};
  for (const p of ["data/state.json", "data/products.json", "data/reviews.json", "data/photos.json"]) {
    const content = await fetchFile(p);
    if (content) files[p] = content;
  }
  // year logs: try current and previous 5 years
  const year = new Date().getFullYear();
  for (let y = year - 5; y <= year; y++) {
    const content = await fetchFile(`data/log/${y}.json`);
    if (content) files[`data/log/${y}.json`] = content;
  }
  if (!Object.keys(files).length) throw new Error("Nothing found to restore.");
  replaceAll(files);
  return Object.keys(files);
}

export function initSyncTriggers() {
  window.addEventListener("online", drain);
  setInterval(drain, 60e3);
  drain();
}
