// Desktop-app promotion & web→native hand-off (Web / Pages only).
//
// The desktop app (local_app.py) can set the wallpaper directly — the thing browsers are sandboxed
// out of. This module surfaces it at the two moments a web user most wants the images locally:
//   1. the first ZIP download  → offer the desktop app instead (gateDownload)
//   2. My Gallery              → hand the current selection straight to the desktop app (openInDesktop)
// plus real presence detection (probeDesktop + the gallery status chip: the app's /api/ping is
// reachable cross-origin from Pages because loopback is exempt from mixed-content blocking and
// the server grants CORS to this origin), a persistent footer CTA (mountFooterCTA) and the
// native-side import (applyImportFromHash).
//
// Imports state / i18n / local only (no render.js), so it stays a leaf in the import graph: the
// caller (app.js / render.js) owns navigation and re-render after a selection import.

import {
  state, $, lockScroll, unlockScroll, trapFocus, setBackgroundInert, clearBackgroundInert,
  lsGet, lsSet, LS_DL_PROMPT_SEEN, LS_DESKTOP_SEEN, saveSelected, SKIN_BY_KEY, isMobile,
} from "./state.js";
import { t } from "./i18n.js";
import { isLocal, toast, CSRF_HEADERS } from "./local.js";
import { saveBlob } from "./zip.js";  // reuse the shared blob→download helper (zip.js imports only state/i18n, no cycle)

// Where the desktop builds live (GitHub Releases). Absolute URL since this runs on Pages.
const RELEASES_URL = "https://github.com/badfalcon/OpenLeagueDisplay/releases";
// Permanent "latest" alias to the Windows installer. The asset name comes from
// installer/windows.iss (OutputBaseFilename) and is hardcoded in release.yml's installer
// build/upload steps — rename all three together or this 404s. It also 404s while the latest
// release is missing the asset (fail-fast:false lets the mac/linux legs publish a release whose
// Windows leg failed) — re-run that leg; the CTAs keep a Releases-page path for that window.
const SETUP_EXE_URL = `${RELEASES_URL}/latest/download/OpenLeagueDisplay-windows-setup.exe`;
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
// setup.exe is Windows-only: direct-download it on Windows desktop, otherwise land on the
// Releases page where the user picks the right asset (and can read the SmartScreen note).
const desktopDownloadURL = () => (isWindows() && !isMobile()) ? SETUP_EXE_URL : RELEASES_URL;
// The OS passes the whole link to the app as one argv entry, and Windows caps a command line at
// 32767 chars. Stay well under it: past this the link is abandoned for the file export.
const MAX_LINK_LEN = 16000;

// openleaguedisplay://import?keys=<base64url of the JSON key array>. base64url (not
// percent-encoded JSON): skin keys are full of "/" and spaces, which percent-encoding would
// roughly triple, and the link has a hard length budget.
// Fire a custom-scheme link from a throwaway tab, then close the tab once it's done its job. Firing
// it at the CURRENT document is the obvious move, but it risks replacing the page the user is on:
// browsers without a handler registered aren't uniform about it (Chrome silently ignores it, Firefox
// can render an "unknown protocol" error page in place of the app). A scratch tab absorbs that, and
// closing it afterwards leaves no orphan blank tab — which is why we don't just window.open and walk
// away. The user gesture (the modal button) is what lets the open through.
//
// The close must NOT race the user. The browser's "Open OpenLeagueDisplay?" permission prompt is
// owned by the tab that initiated the navigation, so destroying that tab destroys the prompt and
// takes its cancel path — the app never launches. Every user meets that prompt on their first
// hand-off (until they tick "always allow"), and nobody reads and answers it in a couple of seconds.
// Hence a long backstop and nothing cleverer: closing on "the user came back to this page" would
// kill a prompt they merely tabbed away from. A minute of silence means they walked away, so the
// blank tab is just litter to sweep up.
// Write a status message into the scratch tab. Shared by fireSchemeLink (the initial
// "launching…" text) and watchLaunch (flipping it to a real success / failure once the ping
// polling settles — repainting replaces the previous message). about:blank is same-origin,
// and mutating its DOM leaves location.href === "about:blank", so the cleanup guards still
// recognise the tab as ours.
function paintScratchTab(w, message, link) {
  try {
    const d = w.document;
    d.title = "OpenLeagueDisplay";
    d.body.style.cssText = "margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;"
      + "background:#07060b;color:#e8e3d9;font:16px/1.7 system-ui,sans-serif;text-align:center;padding:24px";
    d.body.textContent = "";
    const p = d.createElement("p");
    p.style.cssText = "max-width:46ch";
    p.textContent = message;
    d.body.appendChild(p);
    if (link) {
      const a = d.createElement("a");
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = link.label;
      a.style.cssText = "margin-top:16px;color:#d4a857;font-weight:600";
      d.body.appendChild(a);
    }
  } catch (_) { /* a browser that won't let us touch the popup's document: the link still fires */ }
}

// Returns the scratch tab (null when the popup was blocked and the link fired from this
// document instead) so watchLaunch can repaint it with the polling outcome.
// Sweeps are per-tab, NOT single-slot like _launchTimer: a second hand-off (even a popup-blocked
// one) must not disturb the first tab's pending cleanup. watchLaunch's timeout repaint cancels
// only ITS OWN tab's sweep — the repainted tab still reads "about:blank", so an uncancelled
// sweep would eat the install pointer 15s after it appeared (observed).
const _sweeps = new WeakMap();
// The tab owned by the running watchLaunch. The sweep defers to it: a watch tick can be starved
// past the 60s mark by a concurrent long probe (every tick awaits the shared _inflight promise,
// and Chrome's LNA prompt can park one for 20s), and closing the tab then would discard the
// verdict repaint that watch is about to write.
let _watchTab = null;

function cancelSweep(w) {
  const timer = w && _sweeps.get(w);
  if (timer) { clearTimeout(timer); _sweeps.delete(w); }
}

function fireSchemeLink(link, message) {
  const w = window.open("", "_blank");
  if (!w) { window.location.href = link; return null; }  // popup blocked: fall back to this document
  // The scratch tab takes focus, so THIS is the surface the user is looking at — a toast back on
  // the opener would play to an empty room (and expire before they return). Write the message here
  // instead: with no handler registered the browser silently drops the navigation, and without this
  // the user would just be staring at a blank tab.
  paintScratchTab(w, message);
  w.location.href = link;
  const sweep = (delay) => setTimeout(() => {
    try {
      if (w.closed) return;
      if (w === _watchTab) { _sweeps.set(w, sweep(30000)); return; }  // verdict still pending: check back later
      // Sweep it up only if it's still OUR blank tab. The scratch tab is focused and empty, which
      // is exactly where someone starts typing a URL — and the scheme navigation never commits, so
      // a tab that is still "about:blank" is one nobody has touched. Once they've navigated it, the
      // cross-origin read throws and we correctly leave their tab alone.
      if (w.location.href === "about:blank") w.close();
    } catch (_) {}
  }, delay);
  _sweeps.set(w, sweep(60000));
  return w;
}

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
  // Optional hover hints. Always assign (not just when given): the modal element is reused
  // across openers, so a stale title from the previous dialog must not leak into this one.
  p.title = primary.title || "";
  s.title = secondary.title || "";
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
      // Same forewarning as the footer CTA (clicking = an exe lands). English-only like there.
      title: desktopDownloadURL() === SETUP_EXE_URL ? "Downloads the Windows installer (setup.exe)" : "",
      onClick: () => { lsSet(LS_DL_PROMPT_SEEN, "1"); window.open(desktopDownloadURL(), "_blank", "noopener"); },
    },
    secondary: { label: t("dl_choice_zip"), onClick: proceedWithZip },
    onDismiss: proceedWithZip,
    focus: "secondary",
  });
}

// ---- 2. desktop-app presence (Pages side) -------------------------------------
// Real detection instead of guesswork: fetch the app's /api/ping cross-origin. This works at
// all because loopback is exempt from mixed-content blocking (https page → http://127.0.0.1;
// Safari excepted) and our CSP allows the origin; the server grants CORS only to the
// production Pages origin (local_app.py's CORS_ALLOWED_ORIGINS). An old build without CORS
// simply rejects the fetch, which lands in "off" — the honest answer ("not reachable") — so
// no version negotiation is needed.
let _desktop = null;   // last successful /api/ping payload, or null = not detected
let _inflight = null;  // in-flight probe promise (dedupes the poller racing a chip click)

export function desktopStatus() { return _inflight ? "checking" : (_desktop ? "on" : "off"); }

// timeout is caller-chosen: the background poll aborts fast (default), but a probe born from
// an explicit gesture (chip click / hand-off attempt) must survive Chrome's Local Network
// Access permission prompt, which parks the fetch until the user answers it.
export function probeDesktop({ timeout = 1500 } = {}) {
  if (_inflight) return _inflight;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  _inflight = (async () => {
    try {
      const res = await fetch(`${NATIVE_URL}/api/ping`, { mode: "cors", cache: "no-store", signal: ctrl.signal });
      const info = res.ok ? await res.json() : null;
      _desktop = (info && info.app === "OpenLeagueDisplay" && info.local) ? info : null;
      if (_desktop) {
        lsSet(LS_DESKTOP_SEEN, "1");  // unlocks the ambient gallery poll (see state.js)
        // A first-time detection lands AFTER the gallery rendered (the render-time
        // startDesktopWatch saw no seen-flag and declined) — arm the poll now, or the chip
        // would freeze on "connected" until the next render. Chip presence = gallery on screen.
        if ($("desktop-chip")) startDesktopWatch();
      }
    } catch (_) {
      _desktop = null;  // unreachable / CORS-refused / LNA-denied: all honestly "not detected"
    } finally {
      clearTimeout(timer);
      _inflight = null;
      _updateChip();
    }
    return !!_desktop;
  })();
  _updateChip();  // flip the chip to "checking" right away
  return _inflight;
}

// Ambient re-probe while the gallery view is on screen (render.js starts/stops it with the
// view). Gated on LS_DESKTOP_SEEN so users who never had the desktop app never get an
// unprompted 127.0.0.1 fetch (= no surprise permission prompt); their first probe rides an
// explicit gesture instead (chip click / hand-off attempt).
let _watchTimer = null;
export function startDesktopWatch() {
  if (isLocal() || isMobile() || !lsGet(LS_DESKTOP_SEEN)) return;
  if (_watchTimer) return;
  probeDesktop();
  // The interval stays armed while the tab is hidden and just skips ticks — no
  // visibilitychange listener to leak; the first tick after re-show catches the state up.
  _watchTimer = setInterval(() => { if (!document.hidden) probeDesktop(); }, 10000);
}
export function stopDesktopWatch() {
  if (_watchTimer) { clearInterval(_watchTimer); _watchTimer = null; }
}

// render.js owns the toolbar markup (and rebuilds it every render); we own the chip's text,
// state and click. The click doubles as a first-time user's detection entry point, so it
// gets the long timeout.
export function wireDesktopChip(el) {
  el.title = t("desktop_chip_title");
  el.addEventListener("click", () => probeDesktop({ timeout: 20000 }));
  _updateChip();
}

function _updateChip() {
  const el = $("desktop-chip");
  if (!el) return;
  const st = desktopStatus();
  el.dataset.state = st;
  el.textContent = t(st === "on" ? "desktop_chip_on" : st === "checking" ? "desktop_chip_checking" : "desktop_chip_off");
}

// Push the selection straight into the running app over HTTP — the path with a real answer.
// Returns true when the hand-off was handled (sent, or 409 → deep-link tab); false = the
// app wasn't reachable after all (the caller falls back to launching it).
async function sendToDesktop(keys) {
  try {
    const res = await fetch(`${NATIVE_URL}/api/handoff`, {
      method: "POST", mode: "cors", headers: CSRF_HEADERS, body: JSON.stringify({ keys }),
    });
    if (res.status === 409) {
      // Browser mode: no native window to steer, but same profile + same origin means a
      // deep-link tab lands in the gallery the user actually sees (the pre-CORS fallback).
      window.open(`${NATIVE_URL}/#import=${encodeURIComponent(JSON.stringify(keys))}`, "_blank", "noopener");
      return true;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast(t("handoff_sent", data.count));  // server-confirmed count — the real feedback
    return true;
  } catch (_) {
    _desktop = null;  // it just went away — let the chip say so
    _updateChip();
    return false;
  }
}

// After firing the scheme link, poll ping until the app comes up: the launch itself is
// unobservable (the browser swallows a custom scheme's outcome) but the running app isn't.
// The scheme link already carried the keys (local_app.py imports them on boot), so success
// does NOT resend — it only reports. Keeps polling while the tab is hidden: the user is
// looking at the scratch tab, not at us. Known caveat: a first-time Chrome user faces both
// the scheme-confirm prompt (scratch tab) and the Local Network Access prompt (this tab);
// ignoring the latter starves the polling and a successful launch reads as a timeout — the
// degraded outcome equals the old fire-and-forget, so it's acceptable.
let _launchTimer = null;
let _watchGen = 0;  // ticks are async: a tick parked on a probe must not act for a replaced watch
function watchLaunch(w, deadlineMs = 45000) {
  if (_launchTimer) clearInterval(_launchTimer);
  const gen = ++_watchGen;
  _watchTab = w;  // the sweep defers to the active watch (see fireSchemeLink)
  const startedAt = Date.now();
  _launchTimer = setInterval(async () => {
    const up = await probeDesktop();
    if (gen !== _watchGen) return;  // superseded while awaiting — the newer watch owns the outcome
    if (up) {
      clearInterval(_launchTimer); _launchTimer = null;
      _watchTab = null;
      toast(t("handoff_launch_ok"));
      // The app is up, so the browser's scheme prompt has served its purpose — the scratch
      // tab may be swept early. Flip it to the success message first and give the user a
      // beat to read it (same "still our about:blank" guard as the 60s backstop, which stays
      // armed as the fallback closer in case this early close is refused).
      try {
        if (w && !w.closed && w.location.href === "about:blank") {
          paintScratchTab(w, t("handoff_launch_ok"));
          setTimeout(() => { try { if (!w.closed && w.location.href === "about:blank") w.close(); } catch (_) {} }, 1500);
        }
      } catch (_) {}
    } else if (Date.now() - startedAt > deadlineMs) {
      clearInterval(_launchTimer); _launchTimer = null;
      _watchTab = null;
      toast(t("handoff_launch_timeout"), "err");
      // Leave the tab open — the install pointer is the useful part of this outcome. Make the
      // pointer clickable: this path only exists after a scheme launch (= Windows), so link the
      // installer directly rather than the Releases page. Call off THIS tab's sweep (and only
      // this tab's): the repainted tab still reads "about:blank", so the sweep would close it
      // (observed) — exactly the tab we just told the user to look at.
      cancelSweep(w);
      try {
        if (w && !w.closed && w.location.href === "about:blank") {
          paintScratchTab(w, t("handoff_launch_timeout"), { href: SETUP_EXE_URL, label: t("dl_choice_get") });
        }
      } catch (_) {}
    }
  }, 2000);
}

// ---- 3. web → native selection hand-off --------------------------------------
// Encode the current My Gallery selection into an openleaguedisplay:// link and offer to open it in
// the desktop app. localStorage is per-origin (github.io ≠ 127.0.0.1) and can't be shared
// automatically — this explicit hand-off bridges the two.
export async function openInDesktop() {
  const keys = [...state.selected];
  if (!keys.length) return;
  // On mobile the link can't work — there's no desktop app on the phone. Skip the choice and go
  // straight to the file export, which is the path that actually makes sense here: write the
  // selection out and import it on the PC.
  if (isMobile()) { if (exportSelection()) toast(t("export_done")); return; }
  // App already detected → send straight over HTTP, no modal. The launch/export choice was a
  // product of the fire-and-forget era: when the outcome was unknowable we had to ask first,
  // but a confirmed-running app plus a server-confirmed toast needs no ceremony.
  if (desktopStatus() === "on" && await sendToDesktop(keys)) return;
  // Not (yet) detected — but this click is an explicit gesture, so probe with the long
  // timeout (survives the permission prompt). This is a first-time user's other detection
  // entry point besides the chip; on a machine without the app it fails in milliseconds
  // (connection refused), so the modal below isn't noticeably delayed.
  if (await probeDesktop({ timeout: 20000 }) && await sendToDesktop(keys)) return;
  // The app is genuinely not running: fall back to launching it (Windows: scheme link) or
  // exporting to a file.
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
  // The custom scheme itself still can't be preflighted (the browser swallows its outcome), so
  // the secondary keeps offering the file Export — the fallback that works whatever state the
  // desktop app is in.
  choiceModal({
    title: t("handoff_title"),
    body: t("handoff_body"),
    primary: {
      label: t("handoff_open"),
      onClick: () => {
        // http fallback (non-Windows): a real page, and no launch polling — without the
        // scheme the link can't start the app, so there is no "did it come up?" to answer.
        if (!scheme) { window.open(link, "_blank", "noopener"); return; }
        // The message goes into the scratch tab (that's where the user's eyes are); the toast covers
        // the popup-blocked path, where the link fires from this document and no scratch tab exists.
        const w = fireSchemeLink(link, t("handoff_launching"));
        toast(t("handoff_launching"));
        watchLaunch(w);
      },
    },
    secondary: { label: t("handoff_export"), onClick: () => { if (exportSelection()) toast(t("export_done")); } },
  });
}

// Native side of the hand-off: if the URL carries #import=<json keys>, merge the valid ones into the
// current selection. The fragment format is owned here, so the caller never re-parses it; it only
// reads the return value:
//    null → no #import= hash at all (not a hand-off)
//    -1   → there was one, but its payload is unreadable (same contract as pickSelectionFile)
//    0    → a valid hand-off whose picks were all already in the gallery
//    n    → n keys newly added
// Two callers, both in app.js and both of which then clear the hash: init() (after buildIndexes, so
// SKIN_BY_KEY is ready) for a link that launched or reloaded the page, and maybeHandleImportHash()
// for one that arrives at an already-loaded page (the desktop app's /api/handoff steers its own
// window there, which is a same-document fragment navigation — init does not re-run).
// Not gated on isLocal() — the link only ever points at 127.0.0.1, but a manually pasted link should
// still work.
export function applyImportFromHash() {
  const m = /^#import=(.*)$/.exec(location.hash || "");
  if (!m) return null;
  let keys;
  // -1 (not 0) for an unreadable payload — same contract as pickSelectionFile. 0 has to keep
  // meaning "a valid hand-off whose picks were all already in the gallery", so that the caller can
  // reassure ("already up to date") instead of claiming a broken link is fine.
  try { keys = JSON.parse(decodeURIComponent(m[1])); } catch (_) { return -1; }
  return Array.isArray(keys) ? mergeKeys(keys) : -1;
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

// ---- 4. file-based selection transfer (cross-machine) ------------------------
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

// ---- 5. footer CTA ------------------------------------------------------------
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
  // On Windows desktop the link downloads setup.exe directly (clicking = an exe lands), so
  // forewarn in the visible text — a title tooltip never reaches touch or keyboard users — and
  // keep a Releases-page link alongside: the pinned /latest/download asset can 404 (see
  // SETUP_EXE_URL) and the page is the escape hatch. English-only like the rest of the footer.
  const url = desktopDownloadURL();
  p.innerHTML = url === SETUP_EXE_URL
    ? `🖥 Want one-click wallpaper? <a href="${url}" target="_blank" rel="noopener">Get the desktop app</a> — set any splash directly. Downloads the Windows installer (<a href="${RELEASES_URL}" target="_blank" rel="noopener">all versions</a>).`
    : `🖥 Want one-click wallpaper? <a href="${url}" target="_blank" rel="noopener">Get the desktop app</a> — set any splash directly, no download or extracting.`;
  inner.insertBefore(p, inner.firstChild);  // top of the footer so it's seen
}
