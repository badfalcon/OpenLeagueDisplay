// Wallpaper confirmation modal (local run mode only).
// My Gallery multi-select -> "Set as wallpaper" -> review here -> apply in one batch.
// One image = static wallpaper, two or more = OS-native slideshow (server is local_app.py).
//
// The modal DOM is lazily created on first use (keeps it out of index.html, same trick
// as toast). Wiring also happens once; each open just swaps the target (_items) and display.

import { state, $, esc, lockScroll, unlockScroll, trapFocus, setBackgroundInert, clearBackgroundInert, LS_WP_INTERVAL_KEY, lsGet, lsSet, cardThumb } from "./state.js";
import { t, champName, skinLabel } from "./i18n.js";
import { applyWallpaper, fetchWallpaperProgress, toast, WALLPAPER_INTERVAL_DEFAULT } from "./local.js";

// Interval choices (minutes). value is milliseconds. Shown only for two or more images.
const WP_INTERVALS = [1, 5, 15, 30, 60];

let _items = [];     // selected items the modal currently targets
let _applying = false; // apply-in-progress flag. Blocks closing until POST finishes (incl. Esc/backdrop click)
let releaseTrap = null; // focus-trap release fn for the confirm modal (set on open, called on close)
let releaseDoneTrap = null; // focus-trap release fn for the done modal
let _lastFocus = null;      // focus just before opening the confirm modal (restored on close)
let _doneLastFocus = null;  // focus just before opening the done modal

function intervalOptionsHTML() {
  const saved = parseInt(lsGet(LS_WP_INTERVAL_KEY, ""), 10);
  const sel = WP_INTERVALS.includes(saved / 60000) ? saved : WALLPAPER_INTERVAL_DEFAULT;
  return WP_INTERVALS.map((m) => {
    const ms = m * 60000;
    return `<option value="${ms}" ${ms === sel ? "selected" : ""}>${esc(t("wallpaper_interval_min", m))}</option>`;
  }).join("");
}

function ensureModal() {
  let el = $("wp-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "wp-modal";
  el.className = "wp-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="wp-backdrop" id="wp-backdrop"></div>
    <div class="wp-dialog" role="dialog" aria-modal="true" aria-labelledby="wp-title" aria-describedby="wp-note">
      <h2 class="wp-title" id="wp-title">${esc(t("wallpaper_confirm_title"))}</h2>
      <div class="wp-grid" id="wp-grid"></div>
      <div class="wp-footer">
        <div class="wp-interval-row" id="wp-interval-row">
          <label for="wp-interval">${esc(t("wallpaper_interval_label"))}</label>
          <select id="wp-interval"></select>
        </div>
        <p class="wp-note" id="wp-note"></p>
        <div class="wp-progress" id="wp-progress" hidden>
          <div class="wp-prog-track"><div class="wp-prog-fill" id="wp-prog-fill"></div></div>
          <span class="wp-prog-label" id="wp-prog-label"></span>
        </div>
        <div class="wp-actions">
          <button class="btn" id="wp-cancel">${esc(t("wallpaper_cancel"))}</button>
          <button class="btn primary" id="wp-apply">${esc(t("wallpaper_apply"))}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  // Wire up once. Close paths: Cancel / backdrop click / Esc.
  $("wp-cancel").addEventListener("click", closeModal);
  $("wp-backdrop").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) closeModal();
  });
  $("wp-interval").addEventListener("change", (e) => lsSet(LS_WP_INTERVAL_KEY, e.target.value));
  $("wp-apply").addEventListener("click", onApply);
  return el;
}

function closeModal() {
  // Don't close mid-apply (Cancel button is disabled, but treat Esc / backdrop click the same)
  if (_applying) return;
  const el = $("wp-modal");
  if (!el || el.hidden) return;
  el.hidden = true;
  unlockScroll();
  clearBackgroundInert();
  if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  // Restore focus to where it was before opening (the gallery's "Set as wallpaper" button)
  if (_lastFocus && typeof _lastFocus.focus === "function") {
    try { _lastFocus.focus(); } catch (_) {}
  }
  _lastFocus = null;
}

// Post-success "Done! Enjoy" modal. Separate from the confirm modal (used instead of a toast).
// Lazily created as its own small modal so it doesn't muddy the confirm modal's layout.
function ensureDoneModal() {
  let el = $("wp-done-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "wp-done-modal";
  el.className = "wp-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="wp-backdrop" id="wp-done-backdrop"></div>
    <div class="wp-dialog wp-done-dialog" role="dialog" aria-modal="true" aria-labelledby="wp-done-title" aria-describedby="wp-done-detail">
      <div class="wp-done-emoji" aria-hidden="true">🎉</div>
      <h2 class="wp-title" id="wp-done-title">${esc(t("wallpaper_done_title"))}</h2>
      <p class="wp-done-detail" id="wp-done-detail"></p>
      <p class="wp-done-enjoy">${esc(t("wallpaper_done_enjoy"))}</p>
      <div class="wp-actions">
        <button class="btn primary" id="wp-done-ok">${esc(t("wallpaper_done_ok"))}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  $("wp-done-ok").addEventListener("click", closeDone);
  $("wp-done-backdrop").addEventListener("click", closeDone);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) closeDone();
  });
  return el;
}

function closeDone() {
  const el = $("wp-done-modal");
  if (!el || el.hidden) return;
  el.hidden = true;
  unlockScroll();
  clearBackgroundInert();
  if (releaseDoneTrap) { releaseDoneTrap(); releaseDoneTrap = null; }
  if (_doneLastFocus && typeof _doneLastFocus.focus === "function") {
    try { _doneLastFocus.focus(); } catch (_) {}
  }
  _doneLastFocus = null;
}

function openDone(data) {
  ensureDoneModal();
  // One-liner reflecting how the count was dispatched (static / slideshow image count).
  $("wp-done-detail").textContent =
    data.mode === "slideshow" ? t("wallpaper_slideshow_set", data.count) : t("wallpaper_set");
  _doneLastFocus = document.activeElement;
  $("wp-done-modal").hidden = false;
  lockScroll();
  setBackgroundInert();
  // Same convention as other modals: inert blocks the background, trap Tab, focus OK
  if (releaseDoneTrap) releaseDoneTrap();
  releaseDoneTrap = trapFocus($("wp-done-modal"));
  const ok = $("wp-done-ok");
  if (ok) ok.focus();
}

function showProgress(done, total) {
  $("wp-progress").hidden = false;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("wp-prog-fill").style.width = `${pct}%`;
  $("wp-prog-label").textContent = t("wallpaper_applying", `${done}/${total}`);
}

function hideProgress() {
  const box = $("wp-progress");
  if (box) box.hidden = true;
}

async function onApply() {
  const apply = $("wp-apply");
  const cancel = $("wp-cancel");
  const urls = _items.map((it) => it.skin.splash).filter(Boolean);
  if (!urls.length) return;
  // While applying, disable buttons and show the progress gauge. The server POST blocks until
  // all images are downloaded, so poll /api/wallpaper/progress separately to reflect done/total
  // (prevents it looking "frozen" when there are many images).
  _applying = true;
  apply.disabled = true;
  cancel.disabled = true;
  showProgress(0, urls.length);
  const poll = setInterval(async () => {
    const p = await fetchWallpaperProgress();
    if (p && p.total) showProgress(p.done, p.total);
  }, 300);
  try {
    const interval = parseInt($("wp-interval").value, 10) || WALLPAPER_INTERVAL_DEFAULT;
    const data = await applyWallpaper(urls, interval);
    showProgress(urls.length, urls.length);
    // On success, celebrate with the "Done! Enjoy" modal instead of a toast.
    // closeModal is guarded while _applying, so drop the flag first.
    _applying = false;
    closeModal();
    openDone(data);
  } catch (err) {
    toast(t("wallpaper_failed", err.message), "err");
  } finally {
    _applying = false;
    clearInterval(poll);
    hideProgress();
    apply.disabled = false;
    cancel.disabled = false;
  }
}

// Open the confirm modal for a set of selected items. Called from render.js (gallery's "Set as wallpaper").
export function openWallpaperConfirm(items) {
  _items = (items || []).filter((it) => it && it.skin && it.skin.splash);
  if (!_items.length) {
    toast(t("wallpaper_none"), "err");
    return;
  }
  ensureModal();
  hideProgress();  // clear any leftover progress display from a previous apply
  // Thumbnail list (straight from CDragon. Wallpaper setting fetches server-side, so this is
  // display-only — the lightweight tile is plenty; what gets APPLIED is still the full splash)
  $("wp-grid").innerHTML = _items.map((it) => {
    const alt = `${champName(it.champ)} — ${skinLabel(it.champ, it.skin)}`;
    return `<img class="wp-thumb" loading="lazy" src="${esc(cardThumb(it.skin))}" alt="${esc(alt)}">`;
  }).join("");

  // Show the interval picker only for two or more (one image is a static wallpaper, so interval is meaningless).
  const multi = _items.length >= 2;
  $("wp-interval").innerHTML = intervalOptionsHTML();
  $("wp-interval-row").hidden = !multi;
  $("wp-note").textContent = multi
    ? t("wallpaper_note_slideshow", _items.length)
    : t("wallpaper_note_single");

  _lastFocus = document.activeElement;
  $("wp-modal").hidden = false;
  lockScroll();
  // Same isolation model as other modals (lightbox / tutorial / progress): make the background
  // inert to stop the SR browse cursor wandering, trap Tab, and move focus to the main action.
  setBackgroundInert();
  if (releaseTrap) releaseTrap();
  releaseTrap = trapFocus($("wp-modal"));
  const apply = $("wp-apply");
  if (apply) apply.focus();
}
