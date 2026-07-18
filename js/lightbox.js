// Lightbox (enlarged image view) and global slideshow.
// state.lb holds the lightbox's internal state (current idx, mode, timer, A/B fade, etc.).

import { state, $, SKIN_BY_KEY, DATA, lockScroll, unlockScroll, trapFocus, setBackgroundInert, clearBackgroundInert } from "./state.js";
import { toLightboxItem, syncPauseButton, syncCaptionButton, RARITY_LABELS } from "./i18n.js";
import { isLocalWallpaper } from "./local.js";

// Focus-trap release function (installed on open, called on close). Even while chrome-hidden
// (opacity:0), toolbar buttons keep their offsetParent (opacity doesn't affect offsetParent),
// so they stay Tab targets. This diverges from the visuals but is intentional, so we don't lose
// the keyboard-operation starting point (lb-close).
let releaseTrap = null;

// Slideshow source: returns only the selected skins (excluding any without a splash)
function buildSelectedList() {
  const list = [];
  for (const k of state.selected) {
    const hit = SKIN_BY_KEY.get(k);
    if (hit && hit.s.splash) list.push(toLightboxItem(hit.c, hit.s));
  }
  return list;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function openLightbox(list, idx, mode) {
  const lb = $("lightbox");
  // openLightbox must be idempotent about its one-time setup. The history entry, scroll lock and
  // background inert below are reference-counted (state.js), and a single close only unwinds them
  // once — so a second open while already open would stack a lock/inert that never clears, leaving
  // the body scroll-locked and the whole page unclickable after the lightbox is visually gone (the
  // triggers are inert-guarded, but an event-duplication race or a future caller can still double
  // it). Run that setup only on the closed→open edge; the content swap below always runs.
  const wasOpen = lb.classList.contains("open");
  if (!wasOpen) {
    // So that "back" (Android back gesture / browser back) closes the lightbox rather than
    // leaving the site, push one history entry's worth without changing the URL. The popstate
    // handler (app.js) calls closeLightbox if the lightbox is open. The check uses the DOM .open
    // class, so a reload that leaves only history.state.lb behind won't misbehave.
    history.pushState({ lb: 1 }, "", location.href);
    state.lb.lastFocus = document.activeElement;  // where to restore focus on close (skip on re-entry so a lightbox-internal element isn't captured)
  } else if (typeof console !== "undefined") {
    console.warn("openLightbox called while already open — reusing the existing scroll lock");
  }
  state.lb.list = list; state.lb.idx = idx; state.lb.mode = mode;
  state.lb.paused = false; state.lb.frontIsA = true;
  lb.classList.add("open");
  lb.setAttribute("aria-hidden", "false");
  lb.inert = false;  // Clear the closed-state inert (re-enables focus/tab/interaction). Must come before focus()
  document.body.classList.add("lightbox-open");
  if (!wasOpen) {
    lockScroll();
    setBackgroundInert();
  }
  lb.classList.toggle("slideshow", mode === "slideshow");
  // The chrome (controls hideable by tapping the stage) is always restored to visible on each open.
  // Unlike caption, a "kept hidden" state isn't carried over (not persisted), so clear it every time.
  lb.classList.remove("chrome-hidden");
  // Apply the persisted image fit setting (.fill = object-fit: cover)
  lb.classList.toggle("fill", state.lb.fit === "cover");
  // Match the duration of the horizontal pan on mobile zoom (CSS lb-panx) to one slide's display time.
  // If not set before showImage adds the first .show, only the first image reads the CSS default 7000ms.
  lb.style.setProperty("--lb-pan-dur", state.lb.interval + "ms");
  // The slideshow control dock (‹ ▶ › | interval | caption) only exists during the
  // slideshow; display:none in viewer mode also drops its buttons from the tab order.
  $("lb-dock").style.display = mode === "slideshow" ? "flex" : "none";
  // Prevent the label/appearance staying at "resume" when last closed while paused
  // (paused was reset to false above, so sync to the playing state the instant it opens).
  syncPauseButton();
  syncCaptionButton();
  // One-click "set as wallpaper" only makes sense in local-run mode (Pages can't touch the wallpaper).
  // Shown in both viewer and slideshow modes; the click handler (app.js) applies the current splash.
  // Reset the transient busy/disabled state too: it's a single shared button, so a still-settling
  // apply from a previous open must not leave a freshly-opened lightbox showing a dead button (the
  // old request's finally re-enabling an already-enabled button is harmless).
  const lbWp = $("lb-wallpaper");
  lbWp.style.display = isLocalWallpaper() ? "" : "none";
  lbWp.disabled = false;
  lbWp.removeAttribute("aria-busy");
  applyCaption();
  // The first media needs no crossfade. Video skin → play video, otherwise show the still directly.
  const seq = ++state.lb.seq;
  const item = state.lb.list[idx];
  if (item && item.video) showVideo(item, seq);
  else showImage(item, seq, false);
  updateMeta();
  preloadAdjacent();
  // Focus the close button (the keyboard-operation starting point)
  $("lb-close").focus();
  // Trap focus so Tab can't escape to the background (released on close)
  if (releaseTrap) releaseTrap();
  releaseTrap = trapFocus(lb);
}

// Show a still splash with an <img> A/B crossfade. crossfade=false is for openLightbox's
// first frame (loads straight onto A); true is for transitions from showCurrent.
// The previous item may have been a video skin, so always collapse the video layer first.
function showImage(item, seq, crossfade) {
  const a = $("lb-img-a"), b = $("lb-img-b");
  const video = $("lb-video");
  video.onloadeddata = video.onerror = null;
  video.classList.remove("show");
  if (!video.paused) video.pause();
  if (!item) return;
  if (!crossfade) {
    a.onload = a.onerror = b.onload = b.onerror = null;
    b.classList.remove("show");
    a.classList.add("show");
    state.lb.frontIsA = true;
    a.onerror = () => { if (seq === state.lb.seq && state.lb.mode === "slideshow") scheduleNext(); };
    a.onload  = () => { if (seq === state.lb.seq && state.lb.mode === "slideshow") scheduleNext(); };
    a.src = item.src;
    return;
  }
  const front = state.lb.frontIsA ? a : b;
  const back  = state.lb.frontIsA ? b : a;
  back.onload = back.onerror = null;
  back.onload = () => {
    if (seq !== state.lb.seq) return;
    back.classList.add("show");
    front.classList.remove("show");
    state.lb.frontIsA = !state.lb.frontIsA;
    if (state.lb.mode === "slideshow") scheduleNext();
  };
  back.onerror = () => {
    if (seq !== state.lb.seq) return;
    // On image load failure, don't stop the slideshow — advance to the next
    if (state.lb.mode === "slideshow") scheduleNext();
  };
  back.src = item.src;
}

// Play an animated splash (skins with a `video` field). The poster is the still splash,
// so the still is visible until the video finishes loading. The image layers are collapsed.
// Skins whose video fails to load fall back to the still splash.
function showVideo(item, seq) {
  const a = $("lb-img-a"), b = $("lb-img-b");
  const video = $("lb-video");
  a.onload = a.onerror = b.onload = b.onerror = null;
  a.classList.remove("show");
  b.classList.remove("show");
  video.onloadeddata = video.onerror = null;
  if (item.src) video.poster = item.src;
  else video.removeAttribute("poster");
  video.onloadeddata = () => {
    if (seq !== state.lb.seq) return;
    video.play().catch(() => {});
    if (state.lb.mode === "slideshow") scheduleNext();
  };
  video.onerror = () => {
    if (seq !== state.lb.seq) return;
    showImage(item, seq, false);
  };
  video.src = item.video;
  video.load();
  // The poster (= splash) shows immediately, so it fades smoothly from the pre-transition image
  video.classList.add("show");
}

// Preload the images one before and after the current idx via Image() into the browser cache,
// so the next slide transition can fade without waiting on a fetch. No-op when the list has one item.
function preloadAdjacent() {
  const list = state.lb.list;
  const n = list.length;
  if (n < 2) return;
  const next = (state.lb.idx + 1) % n;
  const prev = (state.lb.idx - 1 + n) % n;
  const targets = next === prev ? [next] : [next, prev];
  // Setting Image().src puts it in the browser's resource cache. Even if GC'd, re-requesting
  // the same URL hits the cache, so we don't need to hold a reference.
  for (const i of targets) new Image().src = list[i].src;
}
export function closeLightbox() {
  const lb = $("lightbox");
  lb.classList.remove("open");
  lb.setAttribute("aria-hidden", "true");
  lb.inert = true;  // Once closed, remove control buttons from tab order / a11y tree (no interaction needed even mid-fade)
  document.body.classList.remove("lightbox-open");
  unlockScroll();
  clearBackgroundInert();
  if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  stopSlideshow();
  // Bump seq to invalidate any in-flight onload from openLightbox
  state.lb.seq++;
  // Stop the video so it doesn't keep playing/buffering in the background after closing
  const video = $("lb-video");
  if (video) { video.pause(); video.classList.remove("show"); }
  if (state.lb.lastFocus && typeof state.lb.lastFocus.focus === "function") {
    state.lb.lastFocus.focus();
  }
  // Only consume the history entry pushed by openLightbox when closing from the UI (✕ / Esc).
  // For a popstate-driven close (back closes it), history is already unwound and state.lb is
  // gone, so history.back() doesn't fire — no double-back.
  if (history.state && history.state.lb) history.back();
}
function updateMeta() {
  const item = state.lb.list[state.lb.idx];
  if (!item) return;
  $("lb-champ").textContent = item.champ;
  $("lb-skin").textContent = item.skin;
  // Rarity chip next to the skin name. Most skins have none — empty + hidden then,
  // so no "undefined" ever renders. Translated at display time (RARITY_LABELS)
  const rar = $("lb-rarity");
  if (rar) {
    const label = item.rarity
      ? ((RARITY_LABELS[state.locale] || {})[item.rarity] || RARITY_LABELS.default[item.rarity] || "")
      : "";
    rar.hidden = !label;
    rar.textContent = label;
  }
  // Descriptions are rarely present, but the area is reserved via CSS min-height even when absent,
  // so the skin name's height doesn't shift based on whether a description exists (don't collapse). Only swap the text.
  const descEl = $("lb-desc");
  if (descEl) descEl.textContent = item.desc || "";
  $("lb-counter").textContent = `${state.lb.idx + 1} / ${state.lb.list.length}`;
}
// Reflect caption verbosity into the lightbox root's class. In CSS, .caption-name collapses the
// description and .caption-none collapses the whole overlay.
// Viewer mode shows no settings UI (⚙), so always treat it as full for predictability
// (i.e. setting none in slideshow doesn't affect a separately opened enlarged view).
export function applyCaption() {
  const active = state.lb.mode === "slideshow" ? state.lb.caption : "full";
  const lb = $("lightbox");
  lb.classList.toggle("caption-name", active === "name");
  lb.classList.toggle("caption-none", active === "none");
}
function showCurrent() {
  const item = state.lb.list[state.lb.idx];
  if (!item) return;
  // Identifier to ignore stale callbacks when onload is delayed (rapid clicks or slow connections)
  const seq = ++state.lb.seq;
  if (item.video) showVideo(item, seq);
  else showImage(item, seq, true);
  updateMeta();
  preloadAdjacent();
}
export function nextSlide() { state.lb.idx = (state.lb.idx + 1) % state.lb.list.length; showCurrent(); }
export function prevSlide() { state.lb.idx = (state.lb.idx - 1 + state.lb.list.length) % state.lb.list.length; showCurrent(); }
// Called after a fade completes/errors. Wait one interval, then advance to the next slide.
export function scheduleNext() {
  stopSlideshow();
  if (state.lb.mode !== "slideshow" || state.lb.paused) return;
  state.lb.timer = setTimeout(nextSlide, state.lb.interval);
}
export function startSlideshow() {
  stopSlideshow();
  // The interval buttons (app.js) re-call this during playback, so keep the horizontal-pan duration
  // in sync (doesn't affect the running animation, takes effect from the next slide).
  $("lightbox").style.setProperty("--lb-pan-dur", state.lb.interval + "ms");
  // scheduleNext is called after the first image loads, so no explicit start is needed here.
  // But in case the first image is already cached and the onload timing is iffy, start once
  // after interval as a fallback.
  state.lb.timer = setTimeout(nextSlide, state.lb.interval);
}
export function stopSlideshow() {
  if (state.lb.timer) { clearTimeout(state.lb.timer); state.lb.timer = null; }
}
// Start a global slideshow from the selected skins. Returns true if it could start, false if the
// gallery is empty (0 selections with a splash).
// What happens on an empty start (steering to the gallery view + toast) is left to the caller:
// holding alert / a transition into render.js here would create a lightbox→render circular import,
// so navigation responsibility stays on the app.js / render.js side.
export function startGlobalSlideshow() {
  if (!DATA) return false;
  const list = buildSelectedList();
  if (list.length === 0) return false;
  openLightbox(shuffle(list), 0, "slideshow");
  return true;
}
