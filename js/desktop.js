// Desktop-app promotion & web→native hand-off (Web / Pages only).
//
// The desktop app (local_app.py) can set the wallpaper directly — the thing browsers are sandboxed
// out of. This module surfaces it at the two moments a web user most wants the images locally:
//   1. the first ZIP download  → offer the desktop app instead (gateDownload)
//   2. My Gallery              → hand the current selection straight to the desktop app (openInDesktop)
// plus a persistent footer CTA (mountFooterCTA) and the native-side import (applyImportFromHash).
//
// Imports state / i18n / local only (no render.js), so it stays a leaf in the import graph: the
// caller (app.js / render.js) owns navigation and re-render after a selection import.

import {
  state, $, lockScroll, unlockScroll, trapFocus, setBackgroundInert, clearBackgroundInert,
  lsGet, lsSet, LS_DL_PROMPT_SEEN, saveSelected, SKIN_BY_KEY,
} from "./state.js";
import { t } from "./i18n.js";
import { isLocal } from "./local.js";

// Where the desktop builds live (GitHub Releases). Absolute URL since this runs on Pages.
const RELEASES_URL = "https://github.com/badfalcon/OpenLeagueDisplay/releases";
// Default address the desktop app serves on (local_app.py binds 127.0.0.1:8000 unless a port is
// passed). The hand-off deep-links here; if the user ran it on another port this won't reach it
// (acceptable for v1 — 8000 is the documented default).
const NATIVE_URL = "http://127.0.0.1:8000";

// ---- generic two-choice modal (reuses the wp-* modal CSS for styling) --------
let _releaseTrap = null;  // focus-trap release fn (set on open, called on close)
let _lastFocus = null;    // focus just before opening (restored on close)

function ensureChoiceModal() {
  let el = $("choice-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "choice-modal";
  el.className = "wp-modal";  // borrow the wallpaper modal's styling (backdrop / dialog / actions)
  el.hidden = true;
  el.innerHTML = `
    <div class="wp-backdrop" id="choice-backdrop"></div>
    <div class="wp-dialog" role="dialog" aria-modal="true" aria-labelledby="choice-title">
      <h2 class="wp-title" id="choice-title"></h2>
      <p class="wp-note" id="choice-body"></p>
      <div class="wp-actions">
        <button class="btn" id="choice-secondary"></button>
        <button class="btn primary" id="choice-primary"></button>
      </div>
    </div>`;
  document.body.appendChild(el);
  // Esc / backdrop click = cancel (neither action runs). Wired once.
  $("choice-backdrop").addEventListener("click", closeChoice);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) closeChoice();
  });
  return el;
}

function closeChoice() {
  const el = $("choice-modal");
  if (!el || el.hidden) return;
  el.hidden = true;
  unlockScroll();
  clearBackgroundInert();
  if (_releaseTrap) { _releaseTrap(); _releaseTrap = null; }
  if (_lastFocus && typeof _lastFocus.focus === "function") {
    try { _lastFocus.focus(); } catch (_) {}
  }
  _lastFocus = null;
}

// title/body: strings. primary/secondary: { label, onClick }. Same modal isolation model as the
// others (lock scroll, inert background, trap Tab, focus the main action).
function choiceModal({ title, body, primary, secondary }) {
  const el = ensureChoiceModal();
  $("choice-title").textContent = title;
  $("choice-body").textContent = body;
  const p = $("choice-primary"), s = $("choice-secondary");
  p.textContent = primary.label;
  s.textContent = secondary.label;
  // Re-bind per open since the handlers differ each call. Close first, then act.
  p.onclick = () => { closeChoice(); primary.onClick(); };
  s.onclick = () => { closeChoice(); secondary.onClick(); };
  _lastFocus = document.activeElement;
  el.hidden = false;
  lockScroll();
  setBackgroundInert();
  if (_releaseTrap) _releaseTrap();
  _releaseTrap = trapFocus(el);
  p.focus();
}

// ---- 1. first-download upsell -------------------------------------------------
// Wrap a ZIP download so the first time (Web only) we offer the desktop app instead. After the
// user's first explicit choice we never interrupt again. In local mode there's no ZIP path to
// upsell, so run the download straight through. Cancelling (Esc / backdrop) neither downloads nor
// marks the prompt seen — the next attempt asks again.
export function gateDownload(runDownload) {
  if (isLocal() || lsGet(LS_DL_PROMPT_SEEN)) { runDownload(); return; }
  choiceModal({
    title: t("dl_choice_title"),
    body: t("dl_choice_body"),
    primary: {
      label: t("dl_choice_get"),
      onClick: () => { lsSet(LS_DL_PROMPT_SEEN, "1"); window.open(RELEASES_URL, "_blank", "noopener"); },
    },
    secondary: {
      label: t("dl_choice_zip"),
      onClick: () => { lsSet(LS_DL_PROMPT_SEEN, "1"); runDownload(); },
    },
  });
}

// ---- 2. web → native selection hand-off --------------------------------------
// Encode the current My Gallery selection into a deep link and offer to open it in the desktop app.
// The selection rides in the URL *fragment* (#import=...), which is never sent to the local server,
// so there's no request-line length limit. localStorage is per-origin (github.io ≠ 127.0.0.1) and
// can't be shared automatically — this explicit hand-off bridges the two.
export function openInDesktop() {
  const keys = [...state.selected];
  if (!keys.length) return;
  const link = `${NATIVE_URL}/#import=${encodeURIComponent(JSON.stringify(keys))}`;
  choiceModal({
    title: t("handoff_title"),
    body: t("handoff_body"),
    primary: { label: t("handoff_open"), onClick: () => window.open(link, "_blank", "noopener") },
    secondary: { label: t("handoff_get"), onClick: () => window.open(RELEASES_URL, "_blank", "noopener") },
  });
}

// Native side of the hand-off: if the URL carries #import=<json keys>, merge the valid ones into the
// current selection. Returns null when there is NO #import= hash, or a count >= 0 when there is one
// (a corrupt/unparseable fragment is folded into 0 = nothing imported — these links are normally
// machine-generated, so a rare hand-pasted broken one just reads as "nothing new" rather than an
// error). This lets the caller tell "no hand-off" from "hand-off that added nothing" without
// re-parsing the fragment format, which is owned here. Called once on startup (after buildIndexes, so
// SKIN_BY_KEY is ready). Not gated on isLocal() — the link only ever points at 127.0.0.1, but a
// manually pasted link should still work. The caller clears the hash afterward.
export function applyImportFromHash() {
  const m = /^#import=(.*)$/.exec(location.hash || "");
  if (!m) return null;
  let keys;
  try { keys = JSON.parse(decodeURIComponent(m[1])); } catch (_) { return 0; }
  return Array.isArray(keys) ? mergeKeys(keys) : 0;
}

// Merge a list of SELECT_KEY strings into the current selection, keeping only keys that exist in the
// loaded data (renamed/removed skins are dropped) and aren't already selected. Returns how many were
// newly added; persists if anything changed. Shared by the deep-link and file-import paths.
function mergeKeys(keys) {
  let added = 0;
  for (const k of keys) {
    if (typeof k === "string" && SKIN_BY_KEY.has(k) && !state.selected.has(k)) {
      state.selected.add(k);
      added++;
    }
  }
  if (added) saveSelected();
  return added;
}

// ---- 3. file-based selection transfer (cross-machine) ------------------------
// The deep-link hand-off (openInDesktop) only works same-machine. For phone → PC, export the
// selection to a small JSON file, move it across, and import it on the other device. Works in any
// mode (web or native) and in either direction. Format: { v: 1, keys: [...] }.
const SELECTION_FILE = "openleaguedisplay-selection.json";

// Download the current selection as a JSON file. Returns false if nothing is selected.
export function exportSelection() {
  const keys = [...state.selected];
  if (!keys.length) return false;
  const blob = new Blob([JSON.stringify({ v: 1, keys })], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = SELECTION_FILE;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);  // revoke once the download has grabbed the blob
  return true;
}

// Open a file picker, read the chosen JSON, and merge its keys. The caller needs to tell three
// outcomes apart (so a re-import of your own export doesn't read as a broken file), so resolve to:
//   null  → dialog cancelled / dismissed (no feedback wanted)
//   -1    → unreadable / not valid selection JSON (genuine error)
//   0     → valid file but every key was already selected (nothing new)
//   n > 0 → n keys newly added
// Accepts both our { keys: [...] } envelope and a bare array. Reuses a single lazily-created input.
export function pickSelectionFile() {
  return new Promise((resolve) => {
    let input = $("selection-file");
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.id = "selection-file";
      input.accept = ".json,application/json";
      input.style.display = "none";
      document.body.appendChild(input);
    }
    // A file input doesn't fire 'change' when the picker is dismissed; the 'cancel' event covers that
    // so the Promise always settles (older browsers without 'cancel' simply leave a cancel un-toasted).
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files && input.files[0];
      input.value = "";  // let the same file be picked again next time
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        let keys = null;
        try {
          const obj = JSON.parse(String(reader.result));
          keys = Array.isArray(obj) ? obj : (obj && obj.keys);
        } catch (_) { /* invalid JSON → falls through to the -1 below */ }
        resolve(Array.isArray(keys) ? mergeKeys(keys) : -1);
      };
      reader.onerror = () => resolve(-1);
      reader.readAsText(file);
    };
    input.click();
  });
}

// ---- 4. footer CTA ------------------------------------------------------------
// Footer CTA pointing web users at the desktop app. Web / Pages only (in local mode you already
// have it). Kept in English to match the footer's other text — attribution / policy there are
// intentionally not localized (see index.html). Injected once.
export function mountFooterCTA() {
  if (isLocal()) return;
  if ($("footer-cta")) return;
  const inner = document.querySelector(".footer-inner");
  if (!inner) return;
  const p = document.createElement("p");
  p.id = "footer-cta";
  p.className = "footer-cta";
  p.innerHTML = `🖥 Want one-click wallpaper? <a href="${RELEASES_URL}" target="_blank" rel="noopener">Get the desktop app</a> — set any splash directly, no download or extracting.`;
  inner.insertBefore(p, inner.firstChild);  // top of the footer so it's seen
}
