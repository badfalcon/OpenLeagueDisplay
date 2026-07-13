// Service Worker: caches the app shell (HTML/CSS/JS/icons) to speed up revisits
// and to meet the installability requirement. Minimal by design.
//
// Strategy: every same-origin GET is network-first.
// - Online, always fetch the latest from the network; the cache is only an
//   offline fallback. Treating the shell (JS/CSS) the same way avoids the
//   stale-while-revalidate trap where source edits or a language switch
//   "don't apply until you reload". Static files come with an ETag from GitHub
//   Pages, so each load re-validates as a cheap 304.
// - data.json / i18n/*.json are network-first too (keeps the weekly-updated data fresh).
// - Images (raw.communitydragon.org) and CDNs (fonts / jsdelivr): never intercepted.
//   The splashes total ~600MB, so they are intentionally not cached.
// - Offline operation (PWA) survives via the cache fallback. SHELL is precached
//   on install. Bump CACHE_VERSION whenever the shell changes.

const CACHE_VERSION = "v18";
const CACHE_NAME = "old-shell-" + CACHE_VERSION;

// Precache targets. Paths are relative to sw.js (supports GitHub Pages subpath hosting).
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icon-maskable.svg",
  "./js/i18n-failsafe.js",
  "./js/app.js",
  "./js/hero.js",
  "./js/state.js",
  "./js/i18n.js",
  "./js/render.js",
  "./js/zip.js",
  "./js/lightbox.js",
  "./js/tutorial.js",
  "./js/share.js",
  "./js/local.js",
  "./js/wallpaper.js",
  "./js/desktop.js",
];

self.addEventListener("install", (e) => {
  // Promote the new SW out of the waiting state and activate it immediately
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(SHELL))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("old-shell-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first: on success also refresh the cache; on failure (offline) fall
// back to the cache. For an uncached navigation request, serve index.html so a
// SPA deep link / unknown path still shows the app shell offline.
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin; let CDragon images / fonts / jsdelivr pass through.
  if (url.origin !== self.location.origin) return;

  // Let the local-mode API (/api/ping etc.) pass through uncached: caching
  // GET /api/ping would return a stale feature-detection result.
  if (url.pathname.split("/").includes("api")) return;

  // Every same-origin GET (shell and data alike) is network-first: online,
  // always serve the latest, with the cache strictly as an offline fallback.
  e.respondWith(networkFirst(req));
});
