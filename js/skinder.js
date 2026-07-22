// LoLSkinder — a hidden "Tinder for skins" easter egg.
// Swipe through random splash cards: right (♥ / →) collects the skin into My Gallery,
// left (✕ / ←) passes. It's an alternate, playful way to build a selection that reuses
// the same state.selected Set as the rest of the app, so likes land in My Gallery.
//
// Not linked anywhere in the UI. It's discovered two ways (wired in app.js):
//   - type a secret word ("skinder" / "lolskinder") into the search box, or
//   - enter the Konami code (↑ ↑ ↓ ↓ ← → ← → B A) on a keyboard.
//
// The overlay DOM is created lazily on first open (kept out of index.html, same trick as
// js/wallpaper.js / the toast) so nothing in the markup hints at it. Imports stay shallow:
// state.js + i18n.js, plus render()/refreshGalleryBtn() to reflect likes underneath. render.js
// never imports this module, so the skinder→render edge is one-way (no cycle).

import {
  state, DATA, $, esc, saveSelected, SELECT_KEY,
  lockScroll, unlockScroll, trapFocus, setBackgroundInert, clearBackgroundInert,
} from "./state.js";
import { t, champName, skinLabel, RARITY_LABELS } from "./i18n.js";
import { render, refreshGalleryBtn } from "./render.js";

// Past this horizontal drag distance (px) a release commits the swipe; below it, the card
// springs back. Buttons / keyboard commit directly regardless of this.
const SWIPE_THRESHOLD = 90;
// How long the fly-out transition runs (kept in sync with the CSS transition on .skinder-card).
const FLY_MS = 300;
// Secret words that open the feature when typed into the search box (compared lowercased/trimmed).
const TRIGGER_WORDS = new Set(["skinder", "lolskinder"]);

let deck = [];          // [{ c, s, key }] shuffled likeable skins (splash-bearing)
let idx = 0;            // index of the current top card in deck
let decisions = [];       // decision stack for Undo: [{ added: bool }] (added = a like that was NEW to the gallery)
let addedKeys = new Set(); // keys this session newly added (for the done-screen count / undo)
let committing = false; // a fly-out animation is in progress (blocks further input until it settles)
let releaseTrap = null; // focus-trap release fn (set on open)
let lastFocus = null;   // element focused before opening (restored on close)
let keyHandler = null;  // capture-phase keydown listener while open (removed on close)

// Fisher-Yates shuffle (same as lightbox.js's, kept local to avoid a cross-module dep).
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Every skin with a splash, across all champions, as a flat deck. Skins already in the gallery
// are shuffled toward the back so the swipe surfaces fresh ones first (idempotent either way —
// re-liking one just re-adds the same key).
function buildDeck() {
  const fresh = [], seen = [];
  for (const c of DATA.champions) {
    for (const s of c.skins) {
      if (!s.splash) continue;
      const key = SELECT_KEY(c.alias, s.label);
      (state.selected.has(key) ? seen : fresh).push({ c, s, key });
    }
  }
  return [...shuffle(fresh), ...shuffle(seen)];
}

export function isSkinderOpen() {
  const ov = $("skinder");
  return !!(ov && !ov.hidden);
}

// Recognizes the secret search-box word (called from app.js's search handler).
export function isSkinderTrigger(value) {
  return TRIGGER_WORDS.has(String(value || "").trim().toLowerCase());
}

function ensureOverlay() {
  let el = $("skinder");
  if (el) return el;
  el = document.createElement("div");
  el.id = "skinder";
  el.className = "skinder";
  el.hidden = true;
  // aria-modal dialog; labelled by the title. The live stage is rebuilt per card by renderCards().
  el.innerHTML = `
    <div class="skinder-dialog" role="dialog" aria-modal="true" aria-labelledby="skinder-title">
      <div class="skinder-head">
        <div class="skinder-brand">
          <span class="skinder-eyebrow">${esc(t("skinder_subtitle"))}</span>
          <h2 class="skinder-title" id="skinder-title">${esc(t("skinder_title"))}</h2>
        </div>
        <span class="skinder-counter" id="skinder-counter" aria-hidden="true"></span>
        <button class="skinder-x" id="skinder-close" type="button" aria-label="${esc(t("skinder_close"))}">✕</button>
      </div>
      <div class="skinder-stage" id="skinder-stage"></div>
      <div class="skinder-actions" id="skinder-actions">
        <button class="skinder-btn skinder-undo" id="skinder-undo" type="button" aria-label="${esc(t("skinder_undo"))}" title="${esc(t("skinder_undo"))}">↩</button>
        <button class="skinder-btn skinder-nope" id="skinder-nope" type="button" aria-label="${esc(t("skinder_nope"))}" title="${esc(t("skinder_nope"))}">✕</button>
        <button class="skinder-btn skinder-like" id="skinder-like" type="button" aria-label="${esc(t("skinder_like"))}" title="${esc(t("skinder_like"))}">♥</button>
      </div>
      <p class="skinder-hint" id="skinder-hint">${esc(t("skinder_hint"))}</p>
    </div>`;
  document.body.appendChild(el);

  // Wire the static controls once. The per-card pointer handlers are (re)wired by renderCards().
  $("skinder-close").addEventListener("click", closeSkinder);
  $("skinder-nope").addEventListener("click", () => commit("left", false));
  $("skinder-like").addEventListener("click", () => commit("right", true));
  $("skinder-undo").addEventListener("click", undo);
  return el;
}

// Build a card element for a deck item. isTop cards are interactive (draggable) and carry the
// LIKE/NOPE stamps; the peek card behind is inert scenery.
function cardEl(item, isTop) {
  const el = document.createElement("div");
  el.className = "skinder-card" + (isTop ? " is-top" : "");
  const rarity = item.s.rarity
    ? `<span class="skinder-rarity">${esc((RARITY_LABELS[state.locale] || {})[item.s.rarity] || RARITY_LABELS.default[item.s.rarity] || "")}</span>`
    : "";
  el.innerHTML = `
    <div class="skinder-stamp skinder-stamp-like" aria-hidden="true">${esc(t("skinder_like_stamp"))}</div>
    <div class="skinder-stamp skinder-stamp-nope" aria-hidden="true">${esc(t("skinder_nope_stamp"))}</div>
    <img class="skinder-img" src="${esc(item.s.splash)}" alt="" decoding="async" draggable="false">
    <div class="skinder-info">
      <span class="skinder-champ">${esc(champName(item.c))}</span>
      <span class="skinder-skin">${esc(skinLabel(item.c, item.s))}${rarity}</span>
    </div>`;
  return el;
}

function renderCards() {
  committing = false;
  const stage = $("skinder-stage");
  if (!stage) return;
  stage.innerHTML = "";
  if (idx >= deck.length) { renderDone(stage); return; }

  const top = deck[idx];
  const next = deck[idx + 1];
  // Peek card first (rendered behind), then the top card on top (later DOM node = higher stack).
  if (next) stage.appendChild(cardEl(next, false));
  const topEl = cardEl(top, true);
  stage.appendChild(topEl);
  wireDrag(topEl);
  setActionsEnabled(true);
  updateCounter();
  // Warm the browser cache for the card two ahead so the reveal after a swipe is instant.
  const ahead = deck[idx + 2];
  if (ahead && ahead.s.splash) { const im = new Image(); im.src = ahead.s.splash; }
}

function renderDone(stage) {
  setActionsEnabled(false, true);
  updateCounter();
  stage.innerHTML = `
    <div class="skinder-done">
      <div class="skinder-done-mark" aria-hidden="true">♥</div>
      <h3 class="skinder-done-title">${esc(t("skinder_done_title"))}</h3>
      <p class="skinder-done-body">${esc(t("skinder_done_body", addedKeys.size))}</p>
      <div class="skinder-done-actions">
        <button class="btn primary" id="skinder-done-gallery" type="button">${esc(t("skinder_done_gallery"))}</button>
        <button class="btn" id="skinder-done-restart" type="button">${esc(t("skinder_done_restart"))}</button>
        <button class="btn" id="skinder-done-close" type="button">${esc(t("skinder_done_close"))}</button>
      </div>
    </div>`;
  $("skinder-done-gallery").addEventListener("click", () => { closeSkinder(); openGallery(); });
  $("skinder-done-restart").addEventListener("click", restart);
  $("skinder-done-close").addEventListener("click", closeSkinder);
  // The like/nope buttons that had focus are now disabled, so move focus to a live control
  // rather than letting it drop to <body> (keeps a keyboard/SR anchor on the done screen).
  $("skinder-done-gallery").focus();
}

// Enable/disable the action buttons. On the done screen everything but Undo is off; Undo stays
// live only while there's something to undo.
function setActionsEnabled(on, done = false) {
  const like = $("skinder-like"), nope = $("skinder-nope"), undoBtn = $("skinder-undo");
  if (like) like.disabled = done || !on;
  if (nope) nope.disabled = done || !on;
  if (undoBtn) undoBtn.disabled = decisions.length === 0;
}

function updateCounter() {
  const c = $("skinder-counter");
  if (!c) return;
  const pos = Math.min(idx + 1, deck.length);
  c.textContent = t("skinder_counter", pos, deck.length) + "   " + t("skinder_liked_count", addedKeys.size);
}

// Pointer-drag on the top card: track it 1:1, reveal the LIKE/NOPE stamp by drag direction,
// and on release commit past the threshold or spring back.
function wireDrag(el) {
  let startX = 0, startY = 0, dx = 0, dy = 0, down = false;
  const likeStamp = el.querySelector(".skinder-stamp-like");
  const nopeStamp = el.querySelector(".skinder-stamp-nope");

  el.addEventListener("pointerdown", (e) => {
    if (committing || e.button != null && e.button !== 0) return;
    down = true; dx = 0; dy = 0;
    startX = e.clientX; startY = e.clientY;
    el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!down) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    el.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 22}deg)`;
    const p = Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD);
    likeStamp.style.opacity = dx > 0 ? p : 0;
    nopeStamp.style.opacity = dx < 0 ? p : 0;
  });
  const end = () => {
    if (!down) return;
    down = false;
    el.classList.remove("dragging");
    if (dx > SWIPE_THRESHOLD) commit("right", true, el);
    else if (dx < -SWIPE_THRESHOLD) commit("left", false, el);
    else {
      // Spring back: clearing the inline transform animates home (transition returns with .dragging off).
      el.style.transform = "";
      likeStamp.style.opacity = 0;
      nopeStamp.style.opacity = 0;
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

// Commit the current card in a direction. right = like (collect into the gallery), left = pass.
// topEl is passed on the drag path (already found); button/keyboard paths look it up.
function commit(dir, like, topEl) {
  if (committing || idx >= deck.length) return;
  const el = topEl || $("skinder-stage").querySelector(".skinder-card.is-top");
  if (!el) return;
  committing = true;
  const item = deck[idx];

  // Show the matching stamp fully (button/keyboard paths have no drag to have raised it).
  const stamp = el.querySelector(like ? ".skinder-stamp-like" : ".skinder-stamp-nope");
  if (stamp) stamp.style.opacity = 1;

  // Record the like against the shared selection now (so the header count reacts immediately).
  const added = like ? addLike(item) : false;
  decisions.push({ added });
  setActionsEnabled(false);  // freeze buttons during the fly-out; Undo re-enables on next render

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finalize = () => { idx++; renderCards(); };
  if (reduce) { finalize(); return; }
  // Fly the card off in the swipe direction (transition is on .skinder-card.is-top in CSS).
  const off = dir === "right" ? 1 : -1;
  el.style.transform = `translate(${off * 130}%, 0) rotate(${off * 18}deg)`;
  let done = false;
  const settle = () => { if (done) return; done = true; finalize(); };
  el.addEventListener("transitionend", settle, { once: true });
  setTimeout(settle, FLY_MS + 60);  // backstop if transitionend doesn't fire
}

// Add a skin to My Gallery. Returns true only if it was NEW (so Undo knows to remove it and the
// done screen counts it). Already-selected skins count as "not added" and Undo leaves them.
function addLike(item) {
  if (state.selected.has(item.key)) return false;
  state.selected.add(item.key);
  addedKeys.add(item.key);
  saveSelected();
  refreshGalleryBtn();
  return true;
}

function undo() {
  if (committing || decisions.length === 0) return;
  const last = decisions.pop();
  idx = Math.max(0, idx - 1);
  if (last.added) {
    const item = deck[idx];
    if (item) {
      state.selected.delete(item.key);
      addedKeys.delete(item.key);
      saveSelected();
      refreshGalleryBtn();
    }
  }
  renderCards();
}

function restart() {
  deck = buildDeck();
  idx = 0;
  decisions = [];
  addedKeys = new Set();
  refreshGalleryBtn();
  renderCards();
}

// Keyboard while open: ← pass, → like, Escape close, z/u undo. Runs in the capture phase and
// stops propagation for keys it owns so app.js's global handlers (goBack / ? / etc.) don't also fire.
function onKeydown(e) {
  if (!isSkinderOpen()) return;
  const k = e.key;
  if (k === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeSkinder(); }
  else if (k === "ArrowRight") { e.preventDefault(); e.stopImmediatePropagation(); commit("right", true); }
  else if (k === "ArrowLeft") { e.preventDefault(); e.stopImmediatePropagation(); commit("left", false); }
  else if (k === "z" || k === "Z" || k === "u" || k === "U") { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
  // Tab is intentionally left alone so trapFocus can keep focus inside the dialog.
}

// True if another overlay owns the screen. Opening on top of it would stack scroll-locks and
// let a stray Konami sequence (its arrows are the lightbox's own nav) pop this over a live modal.
function anyOverlayOpen() {
  if (["lightbox", "tutorial-overlay", "progress-overlay"].some(id => {
    const el = $(id); return el && el.classList.contains("open");
  })) return true;
  return ["wp-modal", "wp-done-modal", "choice-modal"].some(id => {
    const el = $(id); return el && !el.hidden;
  });
}

export function openSkinder() {
  if (!DATA || isSkinderOpen() || anyOverlayOpen()) return;
  deck = buildDeck();
  if (!deck.length) return;  // no likeable skins (shouldn't happen with real data)
  idx = 0;
  decisions = [];
  addedKeys = new Set();
  ensureOverlay();
  renderCards();
  lastFocus = document.activeElement;
  $("skinder").hidden = false;
  lockScroll();
  setBackgroundInert();
  if (releaseTrap) releaseTrap();
  releaseTrap = trapFocus($("skinder"));
  keyHandler = onKeydown;
  document.addEventListener("keydown", keyHandler, true);
  const like = $("skinder-like");
  if (like) like.focus();
}

export function closeSkinder() {
  const el = $("skinder");
  if (!el || el.hidden) return;
  el.hidden = true;
  unlockScroll();
  clearBackgroundInert();
  if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  if (keyHandler) { document.removeEventListener("keydown", keyHandler, true); keyHandler = null; }
  // Re-render the underlying view so cards/gallery reflect any likes collected while swiping.
  render();
  if (lastFocus && typeof lastFocus.focus === "function") {
    try { lastFocus.focus(); } catch (_) {}
  }
  lastFocus = null;
}

// Jump to My Gallery after closing (from the done screen). Imported lazily-ish via state to avoid a
// hard render-cycle: openSelected lives in render.js, which we already depend on.
function openGallery() {
  state.view = "selected";
  state.currentChamp = null;
  state.currentLine = null;
  state.searchQuery = "";
  const s = $("search");
  if (s) s.value = "";
  window.scrollTo(0, 0);
  render();
}

// Konami code (↑ ↑ ↓ ↓ ← → ← → B A) opens the feature. Wired once from app.js bootstrap.
// A rolling buffer avoids resetting on a mistyped key mid-sequence beyond the last N presses.
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
export function wireKonami() {
  let buf = [];
  document.addEventListener("keydown", (e) => {
    // Ignore while typing in a field or when already open; don't hijack real input.
    if (isSkinderOpen()) return;
    const ae = document.activeElement;
    const tag = ae && ae.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    buf.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (buf.length > KONAMI.length) buf = buf.slice(-KONAMI.length);
    if (buf.length === KONAMI.length && KONAMI.every((k, i) => k === buf[i])) {
      buf = [];
      openSkinder();
    }
  });
}
