// Service worker — cache-first app shell, network-only for GitHub API.
// Bump CACHE_VERSION on every deploy or the phone stays on a stale build.
const CACHE_VERSION = "v7";
const CACHE = `skincare-${CACHE_VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js", "./js/bus.js", "./js/engine.js", "./js/icons.js", "./js/photos.js",
  "./js/schedule.js", "./js/seed.js", "./js/state.js", "./js/sync.js", "./js/util.js",
  "./js/views/tonight.js", "./js/views/products.js", "./js/views/history.js",
  "./js/views/photosview.js", "./js/views/more.js",
  "./manifest.json",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache anything personal: the GitHub API always goes to the network.
  if (url.hostname === "api.github.com") return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
