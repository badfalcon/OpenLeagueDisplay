// Local run mode (via local_app.py) detection plus the batch wallpaper-setting API client.
// On GitHub Pages there's no /api/ping, so probeLocal() resolves false and no UI using this
// module's exports ever appears (= it keeps working as a plain static site).
//
// Depends only on state.js (does not import i18n.js). toast() takes already-translated strings
// from the caller, by design, to avoid a render.js -> local.js -> i18n.js -> render.js import
// cycle (i18n.js already imports render.js).

import { state, $ } from "./state.js";

// Default wallpaper-slideshow interval (ms). Initial value of the confirm modal's interval picker.
// When two or more images are selected, the server passes this interval to the OS-native slideshow.
export const WALLPAPER_INTERVAL_DEFAULT = 5 * 60 * 1000;

const CSRF_HEADERS = { "Content-Type": "application/json", "X-OLD-Local": "1" };

// Detect local run mode and set state.local. Failure (Pages / no backend) is silently ignored.
// Short timeout so a hang (e.g. corporate proxy) doesn't hold up the first render.
export async function probeLocal() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch("./api/ping", { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return false;
    const info = await res.json();
    if (info && info.local) {
      const f = info.features || [];
      state.local = {
        wallpaper: f.includes("wallpaper"),
        platform: info.platform || "",
      };
      return true;
    }
  } catch (_) {
    /* Pages or no backend: stay in static mode */
  } finally {
    clearTimeout(timer);  // never leave the timer running, whether success, failure, or abort
  }
  return false;
}

// If state.local is set, this is the local app (independent of feature flags). Used because the
// ZIP behavior should branch on "is this the local app at all", not "is the wallpaper feature present".
export function isLocal() {
  return !!state.local;
}

export function isLocalWallpaper() {
  return !!(state.local && state.local.wallpaper);
}

async function postJSON(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Batch-apply the selected splash URLs as wallpaper. The server dispatches by count:
// one image -> static wallpaper (also clears any slideshow), two or more -> OS-native slideshow.
// interval is ms (only meaningful for two or more). Returns data.mode = "static" | "slideshow".
export async function applyWallpaper(urls, interval) {
  return postJSON("./api/wallpaper", {
    urls,
    interval: interval || WALLPAPER_INTERVAL_DEFAULT,
  });
}

// Fetch apply progress (done/total). While applyWallpaper's POST blocks until downloads finish,
// the confirm modal polls this separately to show a gauge. Returns null on failure (poller ignores it).
export async function fetchWallpaperProgress() {
  try {
    const res = await fetch("./api/wallpaper/progress", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Dependency-free lightweight toast. Visual display via #toast; screen-reader announcement
// reuses the existing #sr-status (aria-live) (same approach as share.js's copy-done notice).
export function toast(msg, kind = "ok") {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);

  // Mirror to a screen-reader live region. Errors go through the assertive #sr-alert (interrupt now),
  // everything else through the polite #sr-status. aria-live won't re-announce the same string, so
  // clear it first and set it again next frame (same approach as share.js's copy-done notice). This
  // guarantees repeated toasts (e.g. "slideshow is empty") still get read out each time.
  const sr = $(kind === "err" ? "sr-alert" : "sr-status");
  if (sr) {
    sr.textContent = "";
    requestAnimationFrame(() => { sr.textContent = msg; });
  }
}
