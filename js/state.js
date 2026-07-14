// App-wide shared mutable state, indexes, and generic utilities.
// Other modules read/write this state / DATA via ES Module live bindings
// (DATA needs reassignment, so it is mutated through the setData setter).

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

// Announce via a polite live region (#sr-status) for screen readers, with no visual output
// (so status that changed on screen but wouldn't reach SR — e.g. search result counts — gets read out).
// Clear it then refill on the next frame so identical text is re-announced
// (same technique as the copy-complete notices in share.js / local.js). Text is set via textContent, so no esc needed.
export function announce(msg) {
  const sr = $("sr-status");
  if (!sr) return;
  sr.textContent = "";
  requestAnimationFrame(() => { sr.textContent = msg; });
}

// Lock background scroll (while the lightbox / tutorial modal is open).
// overflow:hidden alone doesn't stop touch scrolling in iOS Safari, so pin body with
// position:fixed and stash the current scroll position (the standard iOS scroll-lock).
// Even when html/body have overflow-x:clip and the real scroll container is <html>,
// taking body out of flow stops <html> from scrolling.
// A counter bundles nested locks so the lightbox and tutorial can stack without breaking.
let _scrollLockY = 0;
let _scrollLockCount = 0;
export function lockScroll() {
  if (_scrollLockCount++ > 0) return;
  const se = document.scrollingElement || document.documentElement;
  _scrollLockY = se.scrollTop;
  document.body.style.top = `-${_scrollLockY}px`;
  document.body.classList.add("scroll-locked");
}
export function unlockScroll() {
  if (_scrollLockCount === 0 || --_scrollLockCount > 0) return;
  document.body.classList.remove("scroll-locked");
  document.body.style.top = "";
  const se = document.scrollingElement || document.documentElement;
  se.scrollTop = _scrollLockY;
}

// While a modal/lightbox is open, mark the background (topbar / main / footer) inert so
// the screen reader's virtual cursor and Tab can't reach background content.
// This is the "SR reachability" counterpart to trapFocus trapping Tab: it blocks browse-mode
// navigation that aria-modal alone can't stop. The modal lives as a separate element directly
// under body, so it's excluded from the inert targets and stays operable.
// A counter bundles nested displays.
let _inertCount = 0;
function _inertTargets() {
  // Besides topbar / body / footer, also target the FABs (#to-top / #to-back), the interactive
  // elements floating directly under body (if a modal opens after scrolling they stay visible and
  // the SR browse cursor could reach them behind the modal). #offline-banner /
  // #sr-status / #toast are live regions (status notices), so they're intentionally excluded
  // and kept in the a11y tree.
  return [
    document.querySelector(".topbar"),
    document.getElementById("root"),
    document.querySelector("footer"),
    document.getElementById("to-top"),
    document.getElementById("to-back"),
  ];
}
export function setBackgroundInert() {
  if (_inertCount++ > 0) return;
  for (const el of _inertTargets()) if (el) el.inert = true;
}
export function clearBackgroundInert() {
  if (_inertCount === 0 || --_inertCount > 0) return;
  for (const el of _inertTargets()) if (el) el.inert = false;
}

// Prevent Tab from escaping focus to the background (topbar, etc.) while a modal/lightbox is open.
// aria-modal is only a hint to SR and doesn't constrain the keyboard Tab order, so we trap focus
// within root in JS. The returned function releases the trap (re-installed on each open/close).
// state.js is "dependency-target only", so what lives here is limited to pure DOM utilities that
// import no other module (trapFocus satisfies that).
export function trapFocus(root) {
  const onKey = (e) => {
    if (e.key !== "Tab" || !root) return;
    // Focusable elements come and go with state (the lightbox ⚙ menu, the tutorial Skip
    // button, etc.), so don't cache the list — recompute it on the spot every time.
    const focusable = [...root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    // If activeElement is outside root (the background), pull it to the first element before trapping
    if (!root.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  // Attach on document in capture phase (grab Tab before background element handlers).
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}

// Rough "this device can't run the desktop app" probe (phone / tablet). The desktop build needs a
// localhost server, so the right signal isn't viewport width (a small laptop window would false-positive)
// but a touch-primary device: a coarse pointer with no hover. Used to suppress the "use the desktop app
// right now" prompts (the 127.0.0.1 hand-off / the download upsell) where they can only mislead — the
// passive footer CTA and the file-export path still show, since a phone user may want it on their PC later.
export function isMobile() {
  return !!(window.matchMedia && window.matchMedia("(pointer: coarse) and (hover: none)").matches);
}

export let DATA = null;
export function setData(d) { DATA = d; }

export const state = {
  view: "home",            // home | champion | lines | line | selected
  currentChamp: null,
  currentLine: null,       // skin line id (string)
  searchQuery: "",
  // Champion sort order on the home screen. Default is "name_asc" (ascending by champion name).
  // "name_desc" is descending. Both localeCompare on the localized name, so switching locale
  // recomputes the comparison basis in that same locale. "release" sorts ascending by each
  // champion's real release date (data.json `release`, sourced from the LoL Wiki); missing dates
  // go last (newest side). Old data.json (no `release`) leaves everyone missing, so it falls back
  // to the legacy id order — backward compatible.
  sortOrder: "name_asc",
  // Selection keys (the contents of My Gallery): `${alias}//${skinLabel}` (label is unique per skin).
  // Selection is always on (no mode concept): the ＋ on each card toggles individually.
  selected: new Set(),
  // Flag for cancelling ZIP generation
  packAbort: false,
  // Display language. "default" uses the English names from data.json as-is. Otherwise names
  // are overridden via the translation map loaded from i18n/<code>.json. The real data (alias,
  // label, splash URL, SELECT_KEY, in-ZIP path) is locale-independent and fixed. Persisted in localStorage.
  locale: "default",
  i18n: { champions: {}, skins: {}, skin_descriptions: {}, champion_descriptions: {}, lines: {} },
  lb: {
    list: [], idx: 0, mode: "manual",
    timer: null, interval: 7000, paused: false, frontIsA: true,
    // Caption verbosity during slideshow: "full" (name + description) / "name" (name only) /
    // "none" (hidden). Cycled from the ⚙ menu. Viewer mode always treats it as full (not applied).
    caption: "full",
    seq: 0, lastFocus: null,
    // Image fit: "contain" (whole image, with letterbox/pillarbox bars) ↔ "cover" (fills the
    // screen, partially cropped). Toggleable because 16:9 splashes leave large bars on tall phones.
    // Persisted in localStorage and applied each time the lightbox opens.
    fit: "contain",
  },
  // Tutorial: current step number (1-based) and the element focused just before opening
  // (to restore on close). Mirrors the shape of state.lb.
  tut: { step: 1, lastFocus: null },
  // Detection result for local mode (local_app.py). null = normal Web (Pages) mode.
  // local.js's probeLocal() sets { wallpaper, platform }.
  local: null,
};

export const SELECT_KEY = (alias, label) => `${alias}//${label}`;

// Image to use on GRID CARDS (skin/line tiles, wallpaper-confirm thumbs): the square `tile`
// (~30-60KB) instead of the full splash (~150-400KB) — the single biggest bandwidth lever on
// mobile, and the same asset the LoL client's collection grid uses. Old data.json without
// `tile` falls back to the splash (fully backward compatible). The lightbox / ZIP / wallpaper
// paths keep the full `splash`; to revert the grids to splashes, change only this helper.
export const cardThumb = (s) => s.tile || s.splash;

// localStorage key for carrying selection state across revisits. Value is a JSON array.
// The "old." namespace prefix is short for OpenLeagueDisplay (avoids collisions when other keys are added later).
export const LS_SELECTED_KEY = "old.selected";
export const LS_LOCALE_KEY = "old.locale";
export const LS_SORT_KEY = "old.sort";
// Persists the wallpaper slideshow interval (milliseconds). Only used in local mode.
export const LS_WP_INTERVAL_KEY = "old.wpInterval";
// Persists the lightbox image fit ("contain" / "cover").
export const LS_LB_FIT_KEY = "old.lbFit";
// Seen flag for the first-visit tutorial. Value is "1" (set once shown); unset means unseen.
// Re-showing it from the header ? button / ? key doesn't change this flag (stays seen).
export const LS_TUTORIAL_KEY = "old.tutorial.seen";
// Seen flag for the first ZIP-download upsell (Web only). On the first download we offer the
// desktop app (which sets wallpaper directly) instead of a ZIP; once the user has chosen, we
// never interrupt the download again. Value is "1" (set after the first choice); unset = unseen.
export const LS_DL_PROMPT_SEEN = "old.dlPrompt.seen";
// Set once the desktop app has EVER been detected from this browser (Web only). Gates the
// ambient gallery-view probe: Chrome 138+ shows a Local Network Access permission prompt on
// the first 127.0.0.1 fetch, so we never auto-probe users who never had the app — the first
// detection only happens on an explicit gesture (status-chip click / hand-off attempt).
export const LS_DESKTOP_SEEN = "old.desktop.seen";

// Best-effort persistence: can throw under QuotaExceeded / private browsing / read-only
// environments, so swallow failures and return the fallback.
export function lsGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

// Indexes built once after data.json loads, so renderLines/renderLine/bulkToggleLine don't
// rescan "all champions × all skins" every time.
// SKIN_BY_KEY: SELECT_KEY → { c, s }. O(1) lookup when building item lists from state.selected.
// LINE_INDEX:  skin line id (string) → { count, thumb, members: [{c, s}, ...] }. Source for
//              renderLines's thumbnail and count, renderLine's member list, and bulkToggleLine's target keys.
export const SKIN_BY_KEY = new Map();
export const LINE_INDEX = new Map();
export function buildIndexes() {
  SKIN_BY_KEY.clear();
  LINE_INDEX.clear();
  for (const c of DATA.champions) {
    for (const s of c.skins) {
      SKIN_BY_KEY.set(SELECT_KEY(c.alias, s.label), { c, s });
      for (const lid of (s.lines || [])) {
        const id = String(lid);
        let bucket = LINE_INDEX.get(id);
        if (!bucket) {
          bucket = { count: 0, thumb: "", members: [] };
          LINE_INDEX.set(id, bucket);
        }
        bucket.count++;
        bucket.members.push({ c, s });
        // Representative thumbnail = the first skin found that has a splash (deterministic since
        // champion order is fixed). Displayed at card size, so prefer the lightweight tile.
        if (!bucket.thumb && s.splash) bucket.thumb = cardThumb(s);
      }
    }
  }
}

export function saveSelected() {
  lsSet(LS_SELECTED_KEY, JSON.stringify([...state.selected]));
}
export function loadSelectedFromStorage() {
  const raw = lsGet(LS_SELECTED_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
  } catch (_) {
    return [];
  }
}
