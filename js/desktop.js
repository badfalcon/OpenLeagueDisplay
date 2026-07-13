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
  lsGet, lsSet, LS_DL_PROMPT_SEEN, saveSelected, SKIN_BY_KEY, isMobile,
} from "./state.js";
import { t } from "./i18n.js";
import { isLocal, toast } from "./local.js";
import { saveBlob } from "./zip.js";  // reuse the shared blob→download helper (zip.js imports only state/i18n, no cycle)

// Where the desktop builds live (GitHub Releases). Absolute URL since this runs on Pages.
const RELEASES_URL = "https://github.com/badfalcon/OpenLeagueDisplay/releases";
// Custom URL scheme claimed by the Windows installer. Firing openleaguedisplay://import LAUNCHES the
// installed app — unlike the old http://127.0.0.1:8000 deep link, which only reached an
// already-running instance and otherwise dead-ended on a connection error. local_app.py accepts the
// link only in exactly this shape (strict regex) and boots straight into the import.
const NATIVE_SCHEME = "openleaguedisplay";
// Only the Windows installer claims the scheme — a macOS scheme needs an .app bundle's Info.plist
// and Linux needs a .desktop entry, neither of which the single-binary builds have. So elsewhere we
// keep the original deep link, which reaches an already-running instance on its default port.
const NATIVE_URL = "http://127.0.0.1:8000";
const isWindows = () => /win/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
// The OS passes the whole link to the app as one argv entry, and Windows caps a command line at
// 32767 chars. Stay well under it: past this the link is abandoned for the file export.
const MAX_LINK_LEN = 16000;

// openleaguedisplay://import?keys=<base64url of the JSON key array>. base64url (not
// percent-encoded JSON): skin keys are full of "/" and spaces, which percent-encoding would
// roughly triple, and the link has a hard length budget.
function desktopLink(keys) {
  const bytes = new TextEncoder().encode(JSON.stringify(keys));  // keys can hold non-ASCII, so go via UTF-8
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${NATIVE_SCHEME}://import?keys=${b64}`;
}

// ---- generic two-choice modal (reuses the wp-* modal CSS for styling) --------
let _releaseTrap = null;  // focus-trap release fn (set on open, called on close)
let _lastFocus = null;    // focus just before opening (restored on close)
let _onDismiss = null;    // optional callback when closed WITHOUT picking a button (Esc / backdrop)
let _choiceMade = false;  // set true by a button so closeChoice can tell a pick from a dismissal

function ensureChoiceModal() {
  let el = $("choice-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "choice-modal";
  el.className = "wp-modal";  // borrow the wallpaper modal's styling (backdrop / dialog / actions)
  el.hidden = true;
  el.innerHTML = `
    <div class="wp-backdrop" id="choice-backdrop"></div>
    <div class="wp-dialog" role="dialog" aria-modal="true" aria-labelledby="choice-title" aria-describedby="choice-body">
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
  // Esc / backdrop closed it without a button pick → run the caller's dismissal action (if any).
  const dismissed = !_choiceMade, cb = _onDismiss;
  _choiceMade = false; _onDismiss = null;
  if (dismissed && cb) cb();
}

// title/body: strings. primary/secondary: { label, onClick }. Same modal isolation model as the
// others (lock scroll, inert background, trap Tab, focus the main action).
// Exported: render.js reuses it as the app's generic confirm dialog (gallery Clear).
// render.js already imports this module, so the import graph stays acyclic.
export function choiceModal({ title, body, primary, secondary, onDismiss, focus }) {
  const el = ensureChoiceModal();
  $("choice-title").textContent = title;
  $("choice-body").textContent = body;
  const p = $("choice-primary"), s = $("choice-secondary");
  p.textContent = primary.label;
  s.textContent = secondary.label;
  // Re-bind per open since the handlers differ each call. Mark a real pick (so closeChoice doesn't
  // also fire onDismiss), close first, then act.
  p.onclick = () => { _choiceMade = true; closeChoice(); primary.onClick(); };
  s.onclick = () => { _choiceMade = true; closeChoice(); secondary.onClick(); };
  _onDismiss = onDismiss || null;
  _choiceMade = false;
  _lastFocus = document.activeElement;
  el.hidden = false;
  lockScroll();
  setBackgroundInert();
  if (_releaseTrap) _releaseTrap();
  _releaseTrap = trapFocus(el);
  // Default focus to the primary action, but let callers focus the secondary when IT is the action the
  // user actually asked for (e.g. the download upsell, where secondary = "Download the ZIP").
  (focus === "secondary" ? s : p).focus();
}

// ---- 1. first-download upsell -------------------------------------------------
// Wrap a ZIP download so the first time (Web only) we offer the desktop app instead. After the
// user's first explicit choice we never interrupt again. In local mode there's no ZIP path to
// upsell, so run the download straight through. The user clicked Download, so dismissing the upsell
// (Esc / backdrop) is treated as "yes, just give me the ZIP" — it downloads and marks the prompt seen
// rather than silently doing nothing. The ZIP (secondary) is focused by default since it's the action
// the user actually requested. On mobile we skip the upsell entirely (and don't burn the "seen" flag):
// the desktop app can't run on the phone, so interrupting a ZIP download to pitch it only gets in the way.
export function gateDownload(runDownload) {
  if (isLocal() || isMobile() || lsGet(LS_DL_PROMPT_SEEN)) { runDownload(); return; }
  const proceedWithZip = () => { lsSet(LS_DL_PROMPT_SEEN, "1"); runDownload(); };
  choiceModal({
    title: t("dl_choice_title"),
    body: t("dl_choice_body"),
    primary: {
      label: t("dl_choice_get"),
      onClick: () => { lsSet(LS_DL_PROMPT_SEEN, "1"); window.open(RELEASES_URL, "_blank", "noopener"); },
    },
    secondary: { label: t("dl_choice_zip"), onClick: proceedWithZip },
    onDismiss: proceedWithZip,
    focus: "secondary",
  });
}

// ---- 2. web → native selection hand-off --------------------------------------
// Encode the current My Gallery selection into an openleaguedisplay:// link and offer to open it in
// the desktop app. localStorage is per-origin (github.io ≠ 127.0.0.1) and can't be shared
// automatically — this explicit hand-off bridges the two.
export function openInDesktop() {
  const keys = [...state.selected];
  if (!keys.length) return;
  // On mobile the link can't work — there's no desktop app on the phone. Skip the choice and go
  // straight to the file export, which is the path that actually makes sense here: write the
  // selection out and import it on the PC.
  if (isMobile()) { if (exportSelection()) toast(t("export_done")); return; }
  const scheme = isWindows();
  const link = scheme ? desktopLink(keys)
                      : `${NATIVE_URL}/#import=${encodeURIComponent(JSON.stringify(keys))}`;
  // A gallery big enough to blow the command-line budget can't ride the scheme link at all, so don't
  // offer a button that would silently do nothing — export it to a file, which has no size limit.
  // (The http fallback rides in the fragment, which the browser never puts on a command line.)
  if (scheme && link.length > MAX_LINK_LEN) {
    if (exportSelection()) toast(t("handoff_too_big"));
    return;
  }
  // Neither path can be preflighted from an https origin (the browser swallows the result of a
  // custom scheme, and 127.0.0.1 can't be probed cross-origin), so the secondary always offers the
  // file Export — the fallback that works whatever state the desktop app is in.
  choiceModal({
    title: t("handoff_title"),
    body: t("handoff_body"),
    primary: {
      label: t("handoff_open"),
      // Custom scheme: navigate the current page rather than window.open, which would leave an
      // orphaned blank tab behind — the browser intercepts it, prompts, and the page stays put. The
      // http fallback is a real page, so it still gets its own tab.
      onClick: () => {
        if (scheme) { window.location.href = link; toast(t("handoff_launching")); }
        else window.open(link, "_blank", "noopener");
      },
    },
    secondary: { label: t("handoff_export"), onClick: () => { if (exportSelection()) toast(t("export_done")); } },
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
  saveBlob(blob, SELECTION_FILE);  // shared helper (objectURL → <a download> → click → delayed revoke)
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
