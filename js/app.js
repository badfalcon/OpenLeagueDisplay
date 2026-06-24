// Entry point: load data.json -> resolve the initial locale -> wire events -> first render.
// Grid image load/failure is caught by a capture-phase delegated listener on #root (wireImgDelegation).
// We dropped the old inline <img onload=...> and removed CSP's script-src 'unsafe-inline'.

import {
  state, DATA, $, esc, setData,
  LS_LOCALE_KEY, LS_SORT_KEY, LS_LB_FIT_KEY,
  lsGet, lsSet,
  buildIndexes, SKIN_BY_KEY, LINE_INDEX, loadSelectedFromStorage, saveSelected,
} from "./state.js";
import {
  UI_STRINGS, t, syncPauseButton, syncCaptionButton, syncFitButton,
  applyStaticUIStrings, equalizeTabs,
  localeFlagURL, setLangButton, closeLangMenu,
  pickInitialLocale, loadLocale,
} from "./i18n.js";
import {
  render, goHome, goBack, openLines, openSelected,
  imgLoaded, imgErr, setRouteListener, setNavListener,
} from "./render.js";
import {
  hideProgress,
} from "./zip.js";
import {
  closeLightbox, nextSlide, prevSlide, scheduleNext,
  startSlideshow, stopSlideshow, startGlobalSlideshow, applyCaption,
} from "./lightbox.js";
import {
  openTutorial, closeTutorial, tutNext, tutPrev,
  renderTutorial, isTutorialOpen, maybeAutoOpenTutorial,
} from "./tutorial.js";
import { shareSite } from "./share.js";
import { probeLocal, toast } from "./local.js";

// Own scroll restoration ourselves (see applyRoute). The browser's default "auto" restoration
// tries to re-apply a remembered scroll on a re-rendered SPA at the wrong time and would fight our
// explicit restore. Set at module load, before the first render.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

// Handle grid image (the <img> inside champ/skin/line cards) load completion/failure via capture-phase
// delegation on #root. load/error don't bubble, so we catch them in the capture phase.
// The olSettled flag prevents reprocessing (so imgErr's src removal re-triggering error doesn't run twice).
// Cards are rebuilt via innerHTML each time, so a fresh <img> never carries the flag.
function wireImgDelegation() {
  const root = $("root");
  if (!root) return;
  const settle = (e, handler) => {
    const img = e.target;
    if (!img || img.tagName !== "IMG" || img.dataset.olSettled) return;
    if (!img.closest(".champ-card, .skin-card, .line-card")) return;
    img.dataset.olSettled = "1";
    handler(img);
  };
  root.addEventListener("load", (e) => settle(e, imgLoaded), true);
  root.addEventListener("error", (e) => settle(e, imgErr), true);
}

async function init() {
  // Even before data.json is fetched, tentatively show the UI in the saved locale from localStorage.
  // pickInitialLocale uses data.json's locales so it's re-invoked after load, but if there's a saved
  // value in localStorage we apply it first to reduce the initial flash.
  const savedLoc = lsGet(LS_LOCALE_KEY);
  if (savedLoc && UI_STRINGS[savedLoc]) state.locale = savedLoc;
  // Restore the sort order on return visits too. If an unknown value comes in, ignore it and keep
  // the default (name_asc). The old version saved this choice under the key "default" (the UI label
  // was "by release date"). Map it to the new "release" key to carry the selection over (the behavior
  // improved from id order to real release dates, but it's still the "by release date" the user chose).
  const savedSort = lsGet(LS_SORT_KEY);
  if (savedSort === "default") {
    state.sortOrder = "release";
  } else if (savedSort === "release" || savedSort === "name_asc" || savedSort === "name_desc") {
    state.sortOrder = savedSort;
  }
  // Restore the lightbox image fit too (accept only "contain" / "cover")
  const savedFit = lsGet(LS_LB_FIT_KEY);
  if (savedFit === "contain" || savedFit === "cover") {
    state.lb.fit = savedFit;
  }
  applyStaticUIStrings();
  // Detect whether this is a local run (local_app.py). Runs in parallel with the data.json fetch and
  // is awaited before the first render (on failure/Pages it quietly falls to false and doesn't affect the viewer).
  const localProbe = probeLocal();
  // Now that localized text is applied, remove the i18n-loading set in index.html to reveal the
  // tabs/buttons/loading text that were hidden. Locale switches from here on rewrite the DOM
  // synchronously, so there's no flash.
  document.documentElement.classList.remove("i18n-loading");
  // The Cinzel font is deferred, so the first equalizeTabs() measures with the fallback font.
  // Re-equalize after ready to prevent layout breakage.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(equalizeTabs);
  }
  try {
    const res = await fetch("./data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    setData(await res.json());
  } catch (e) {
    // data.json not generated (the typical first-local-run error): guide the user through the steps
    const is404 = /HTTP 404/.test(e.message);
    const hint = is404
      ? `<p style="margin-top:18px;font-size:13px;color:var(--ink-soft);line-height:1.7">${t("hint_no_data")}</p>`
      : "";
    $("root").innerHTML = `<div class="loading"><h2>${t("error_title")}</h2><p>${t("error_load_data", esc(e.message))}</p>${hint}</div>`;
    return;
  }

  // After setData, the DATA binding inside state.js is updated (each module references it via the live
  // binding). From here on it's fine to reference DATA.* directly.

  // Build the language picker (using the locales bundled in data.json). To stay robust even with an
  // old data.json (locales undefined), show only "default" when it's empty.
  const localesMeta = Array.isArray(DATA.locales) && DATA.locales.length
    ? DATA.locales
    : [{ code: "default", label: "English" }];
  const menu = $("lang-menu");
  menu.innerHTML = localesMeta
    .map(l => {
      const url = localeFlagURL(l.code);
      const flag = url
        ? `<img class="lang-flag" src="${esc(url)}" alt="" loading="lazy" decoding="async">`
        : `<span class="lang-flag" aria-hidden="true"></span>`;
      return `<li><button type="button" data-code="${esc(l.code)}">`
        + flag
        + `<span>${esc(l.label)}</span></button></li>`;
    })
    .join("");
  const availableSet = new Set(localesMeta.map(l => l.code).filter(c => c !== "default"));
  const initial = pickInitialLocale(availableSet);
  setLangButton(initial);
  if (initial !== "default") {
    await loadLocale(initial);
    // On load failure loadLocale reverts to "default" internally, so align the UI too
    if (state.locale === "default") setLangButton("default");
  } else if (state.locale !== "default") {
    // If the saved locale exists in UI_STRINGS but is dropped from data.json's locales
    // (per-locale generation failure / CDragon removing the locale, etc.), pickInitialLocale falls
    // to default. Leaving state.locale as-is then would cause a triple mismatch: button=EN /
    // UI chrome=old language / names=English (i18n empty) / inconsistent <html lang>. Realign to default.
    await loadLocale("default");
  }
  // The final locale is settled now that data.json is fetched, so reflect the static UI again
  // (it includes stats/last_updated, so this must be called after DATA is set).
  applyStaticUIStrings();

  buildIndexes();

  // Restore the skins selected in the previous session. Keys that disappeared from data.json
  // (renamed/removed) are silently filtered out and the storage is overwritten too.
  const saved = loadSelectedFromStorage();
  if (saved.length) {
    for (const k of saved) {
      if (SKIN_BY_KEY.has(k)) state.selected.add(k);
    }
    if (state.selected.size !== saved.length) saveSelected();
    // The header gallery button count is reflected by applyStaticUIStrings / render()
  }

  // Wait for the local-mode detection to settle before the first render (to reflect the wallpaper UI's visibility state)
  await localProbe;

  // Deep link: if there's an initial hash, reflect it into state and render once
  // (applyRoute would call render twice, so here we only set state and leave render to below).
  // If the hash is empty (or invalid), fall to home, and normalize an invalid one to #/
  // (don't leave a broken hash in the address bar).
  const initialHash = location.hash;
  setStateFromRoute(initialHash);
  if (routeFromState() !== (initialHash || "#/")) {
    history.replaceState(null, "", routeFromState());
  }

  render();

  // On a first visit, auto-open the tutorial after a short delay (after the UI fades in)
  maybeAutoOpenTutorial();
}

// ===== hash routing (#/...) =====
// Served on GitHub Pages, so we use the hash approach (no server-side rewrite config needed).
// route<->state conversion and popstate wiring live in app.js; render.js only receives the
// setRouteListener hook notification "sync the URL after render" (it never touches the history API).
// Route definitions:
//   #/                  home (champion list)
//   #/lines             skin line list
//   #/champion/<alias>  champion detail
//   #/line/<id>         skin line detail
//   #/gallery           My Gallery (state.view === "selected")
// Search query / sort order are not put in the URL (state/localStorage only; we keep scope narrow).

// Build the route string from the current state. In a detail view with no target set, treat as home.
function routeFromState() {
  switch (state.view) {
    case "lines": return "#/lines";
    case "selected": return "#/gallery";
    case "champion":
      return state.currentChamp ? `#/champion/${encodeURIComponent(state.currentChamp)}` : "#/";
    case "line":
      return state.currentLine ? `#/line/${encodeURIComponent(state.currentLine)}` : "#/";
    default: return "#/";
  }
}

// Parse the hash to decide state.view/currentChamp/currentLine. The search query is not in the URL;
// instead it's restored from the per-entry history.state (`saved.searchQuery`) on the back/popstate
// path, defaulting to "" (= bare view) for forward nav and the initial deep link (no saved state).
// Invalid/unknown routes (a nonexistent alias etc.) fall back to home.
// render is not called here, leaving it to the caller (to avoid a double render on the initial deep link).
// decodeURIComponent throws a URIError on invalid %-encoding (#/champion/% etc.). To avoid crashing the
// whole page on a tampered URL, route a decode failure straight to the existing home fallback as an
// "unknown route" (return null so the existence check fails).
const safeDecode = (str) => { try { return decodeURIComponent(str); } catch (_) { return null; } };

function setStateFromRoute(hash, saved) {
  const q = (saved && typeof saved.searchQuery === "string") ? saved.searchQuery : "";
  state.searchQuery = q;
  const s = $("search");
  if (s) s.value = q;
  // Strip the leading "#" and "/" and split on "/" ("#/champion/Ahri" -> ["champion","Ahri"])
  const path = (hash || "").replace(/^#\/?/, "");
  const parts = path.split("/").filter(Boolean);
  const head = parts[0] || "";
  if (head === "lines") {
    state.view = "lines"; state.currentChamp = null; state.currentLine = null;
  } else if (head === "gallery") {
    state.view = "selected"; state.currentChamp = null; state.currentLine = null;
  } else if (head === "champion" && parts[1]) {
    const alias = safeDecode(parts[1]);
    // Accept only an existing alias. Unknown (including null from a decode failure) falls to home
    // (deep-link URL tamper resistance).
    const ok = alias !== null && DATA && DATA.champions.some(c => c.alias === alias);
    if (ok) { state.view = "champion"; state.currentChamp = alias; state.currentLine = null; }
    else { state.view = "home"; state.currentChamp = null; state.currentLine = null; }
  } else if (head === "line" && parts[1]) {
    const id = safeDecode(parts[1]);
    // Accept only a line that exists in LINE_INDEX (= has members). Reject null from a decode failure.
    const ok = id !== null && LINE_INDEX.has(String(id));
    if (ok) { state.view = "line"; state.currentLine = id; state.currentChamp = null; }
    else { state.view = "home"; state.currentChamp = null; state.currentLine = null; }
  } else {
    state.view = "home"; state.currentChamp = null; state.currentLine = null;
  }
}

// "Latest navigation" token. Bumped by snapshotCurrentEntry (forward nav / search / in-place clear)
// and by applyRoute. Only consumed by applyRoute's async document.fonts.ready re-scroll, so a forward
// nav or search during a slow font load cancels a stale re-scroll.
let navSeq = 0;

// Save the current (outgoing) entry's scroll + search into its history.state so going Back restores
// them. Called: (1) as render.js's onBeforeNav, before a forward nav clears search / scrolls to top
// (captureScroll=true); (2) at the end of the search-input handler with captureScroll=false, and from
// onBackButton's in-place clear, to keep the entry's saved searchQuery in sync with in-place changes.
// The URL (2nd-arg title only, no 3rd url arg) is omitted so this never mutates the address bar.
// The depth is preserved via the spread.
//   captureScroll: re-read window.scrollY only at real navigation boundaries. A search keystroke is
//   NOT one: re-capturing there would overwrite the saved scroll with a filter-clamped value (and, on
//   a detail->list flip, with the detail view's leftover scroll), so it preserves the existing scrollY
//   and lets onBeforeNav record the true position when the user actually navigates away.
function snapshotCurrentEntry(captureScroll = true) {
  navSeq++;
  const next = { ...(history.state || {}), searchQuery: state.searchQuery };
  if (captureScroll) next.scrollY = window.scrollY;
  history.replaceState(next, "");
}

// Reflect the hash into state and re-render (the popstate / back path). render()'s trailing route
// listener runs too, but since the hash already matches it won't pushState (= no infinite loop).
// Restore the saved scroll position synchronously (aspect-ratio cards make the document's height final
// right after innerHTML, so scrollTo lands without an rAF; doing it synchronously also avoids a queued
// rAF racing other intentional scrolls like the "/" shortcut or to-top FAB). The only async fixup is
// for a hard load where web fonts (display=swap) reflow the header/chip row after we scrolled: if we
// were clamped short (landed < y) and the user hasn't moved since, re-apply y once fonts settle.
function applyRoute(hash, saved) {
  const my = ++navSeq;
  setStateFromRoute(hash, saved);
  render();
  const y = (saved && typeof saved.scrollY === "number") ? saved.scrollY : 0;
  window.scrollTo(0, y);
  const landed = window.scrollY;
  if (y && landed < y && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (my === navSeq && window.scrollY === landed) window.scrollTo(0, y);
    });
  }
}

// Called at the end of render(): push if the current state's route differs from location.hash.
// Direct assignment to location.hash would re-fire hashchange/popstate and cause a double render, so
// we use pushState. This lets the URL follow along without rewriting the navigation functions, search, or tabs.
// Each pushed entry carries an incrementing `depth` so onBackButton knows whether there is an in-app
// entry to history.back() into (vs. a deep-link root, where Back must not leave the site).
function syncRouteFromState() {
  const want = routeFromState();
  const cur = location.hash || "#/";
  if (want !== cur) {
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ depth }, "", want);
  }
}

// In-app "Back" (the #back-btn and the Escape key). All history-API decisions live here so render.js's
// goBack stays history-free.
//  1. While searching a list, Back clears the filter in place (same view) and refreshes the entry's
//     saved searchQuery (so it doesn't resurrect on a later forward/back).
//  2. Otherwise, if there is an in-app entry to return to (depth > 0), delegate to history.back() so it
//     flows through the same popstate restore path (scroll + search + chips come back).
//  3. No in-app history (e.g. a deep link straight to a detail): fall back to goBack's synthesized
//     navigation, which never touches history, so we never leave the site.
// A rapid double Back/Escape simply maps to two history.back() steps (= go back twice), matching how a
// browser's own Back button behaves; it causes no state corruption here, so we don't debounce it. (An
// earlier guard flag was removed: history.back() can be a no-op on the session's bottom entry — e.g. a
// detail deep link restored as the first entry with depth>0 — which fires no popstate, so a flag cleared
// only by popstate would stick true and permanently kill Back.)
function onBackButton() {
  if (state.searchQuery) {
    // Clearing an in-place filter is a Back too: return to the pre-search scroll the entry remembers
    // (the snapshot(false) on each keystroke preserved it through the filtering), then sync
    // searchQuery="" WITHOUT re-capturing scroll — capturing here would overwrite the saved pre-search
    // position with the filter-clamped one (corrupting a later restore into this same entry).
    const savedY = (history.state && typeof history.state.scrollY === "number") ? history.state.scrollY : 0;
    goBack();
    window.scrollTo(0, savedY);
    snapshotCurrentEntry(false);
    return;
  }
  if (((history.state && history.state.depth) || 0) > 0) { history.back(); return; }
  goBack();
}

// Floating "Back" FAB visibility. The real ← Back button lives in the scrolling champ-header (not the
// sticky topbar), so on tall screens it scrolls out of reach. This mirrors it as a bottom-left FAB,
// surfaced only once the real button has slipped behind the topbar (= out of reach). Mirrors the
// real button's own availability: render() shows #back-btn only in detail views / while searching,
// and hides it (display:none) otherwise — a hidden / dom-stash-parked button has a zero-size rect,
// which reads as "Back not available". Called from the scroll listener and after each render().
// Cache the flag so the DOM is touched only when crossing the threshold (same trick as the to-top FAB).
let backFabShown = false;
function syncBackFab() {
  const fab = $("to-back");
  if (!fab) return;
  const realBack = $("back-btn");
  const rect = realBack ? realBack.getBoundingClientRect() : null;
  // The sticky topbar covers the top of the viewport, so "out of reach" means the real button's
  // bottom edge has slipped above the topbar's bottom (not merely above y=0).
  const topbar = document.querySelector(".topbar");
  const coverBottom = topbar ? topbar.getBoundingClientRect().bottom : 0;
  const show = !!rect && rect.height > 0 && rect.bottom <= coverBottom;
  if (show === backFabShown) return;
  backFabShown = show;
  fab.hidden = !show;
}

function wirePopstate() {
  window.addEventListener("popstate", (e) => {
    // (1) If the lightbox is open, Back is spent on "close". By this point history has already
    // unwound (state.lb is gone), so closeLightbox's history.back() doesn't fire and there's no
    // double back. The check uses the DOM's .open class.
    if ($("lightbox").classList.contains("open")) {
      closeLightbox();
      return;
    }
    // (2) Otherwise, reflect the current hash into state. But for the case fired by a UI-driven
    // lightbox close (history.back inside closeLightbox), the URL already matches the view, so
    // re-render and scroll reset are wasted (= flicker / position jump). If they match, do nothing.
    if ((location.hash || "#/") === routeFromState()) return;
    applyRoute(location.hash, e.state);
  });
  // Register the URL sync hook that runs after render(), and the snapshot hook that saves the
  // outgoing list's scroll + search before a forward nav clears them. The post-render hook also
  // re-evaluates the Back FAB, since its visibility tracks render()'s show/hide of #back-btn.
  setRouteListener(() => { syncRouteFromState(); syncBackFab(); });
  setNavListener(snapshotCurrentEntry);
}

function wireEvents() {
  $("title").addEventListener("click", goHome);
  $("back-btn").addEventListener("click", onBackButton);
  // The floating Back FAB drives the same in-app Back as the real button.
  $("to-back").addEventListener("click", onBackButton);
  $("tab-home").addEventListener("click", goHome);
  $("nav-lines").addEventListener("click", openLines);
  // Slideshow button: if it can start, go to the global slideshow. If empty (no splash-bearing
  // selection in the gallery), don't pop an OS dialog; open the My Gallery view and toast the reason
  // (the empty view's gallery_empty / _hint act as the next step). startGlobalSlideshow returns
  // whether it could start, so navigation is done here (= the caller).
  $("slideshow-btn").addEventListener("click", () => {
    if (!startGlobalSlideshow()) {
      openSelected();
      toast(t("slideshow_empty"));
    }
  });
  $("gallery-btn").addEventListener("click", openSelected);
  $("help-btn").addEventListener("click", openTutorial);
  $("share-btn").addEventListener("click", shareSite);
  $("tut-skip").addEventListener("click", closeTutorial);
  $("tut-next").addEventListener("click", tutNext);
  $("tut-back").addEventListener("click", tutPrev);
  $("tutorial-overlay").addEventListener("click", (e) => {
    if (e.target === $("tutorial-overlay")) closeTutorial();
  });
  $("lang-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("lang-menu");
    const open = !menu.hidden;
    menu.hidden = open;
    $("lang-btn").setAttribute("aria-expanded", open ? "false" : "true");
  });
  $("lang-menu").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-code]");
    if (!btn) return;
    const code = btn.dataset.code;
    closeLangMenu();
    lsSet(LS_LOCALE_KEY, code);
    // Disable the button while loading to prevent rapid re-clicks. The files are static and small, so
    // we skip progress UI etc.; a blocking load is enough (~100KB for default->non-default).
    $("lang-btn").disabled = true;
    await loadLocale(code);
    $("lang-btn").disabled = false;
    // On load failure loadLocale reverts to default, so align the UI to it
    setLangButton(state.locale);
    // Make the UI chrome (buttons/placeholder/aria) follow the locale switch too
    applyStaticUIStrings();
    // If the tutorial is still open, repaint its body in the new locale too
    if (isTutorialOpen()) renderTutorial();
    render();
  });
  // Close on outside click / Escape
  document.addEventListener("click", (e) => {
    if (!$("lang-picker").contains(e.target)) closeLangMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("lang-menu").hidden) {
      closeLangMenu();
      $("lang-btn").focus();
      // This Escape is already consumed by "close the menu". Don't let it also fire the later
      // document keydown (goBack / lightbox).
      e.stopImmediatePropagation();
    }
  });
  $("prog-cancel").addEventListener("click", () => {
    state.packAbort = true;
    hideProgress();
  });
  // Running render() on every keystroke while typing feels sluggish on the Lines tab (which tallies
  // selections across ~2000 skins), so debounce by 90ms.
  let searchTimer = null;
  $("search").addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      // Read the value at fire time, not at input-event time, so a stale query isn't written back if
      // goHome etc. cleared the input while the timer was pending.
      const value = $("search").value.trim();
      if (value === state.searchQuery) return;
      // A search from a detail view flips to the list. Like the other view-entering navs, show the
      // filtered list from the top rather than leaving the detail view's leftover scroll in place.
      const flipped = (state.view === "champion" || state.view === "line");
      // Beginning a search on a list (empty -> non-empty, not a flip): persist the current pre-filter
      // scroll into the entry NOW, before render() shrinks the list and the browser clamps the scroll.
      // This is the only moment the pre-search position is still known; Back-to-clear restores it. The
      // home entry on first load has history.state===null (no scrollY) until this runs, so without it a
      // scrolled-then-searched home list would lose its position on clear.
      if (!state.searchQuery && !flipped) snapshotCurrentEntry(true);
      state.searchQuery = value;
      // Acts as a filter for home/lines. Searching from a detail view returns to the list.
      if (state.view === "champion") state.view = "home";
      if (state.view === "line") state.view = "lines";
      render();
      if (flipped) window.scrollTo(0, 0);
      // Keep the current history entry's saved searchQuery in sync with this in-place change, so a
      // later forward-then-back (or back-then-forward) doesn't resurrect a stale query. If render()
      // just pushed a new entry (view flip), this lands on that new entry (depth preserved).
      // captureScroll=false: a keystroke is not a navigation, so it must not overwrite the saved scroll
      // (the pre-search snapshot above, or onBeforeNav on a real nav, owns scrollY).
      snapshotCurrentEntry(false);
    }, 90);
  });
  $("sort-select").addEventListener("change", (e) => {
    state.sortOrder = e.target.value;
    lsSet(LS_SORT_KEY, state.sortOrder);
    render();
  });
  $("lb-close").addEventListener("click", closeLightbox);
  $("lb-prev").addEventListener("click", prevSlide);
  $("lb-next").addEventListener("click", nextSlide);
  $("ss-pause").addEventListener("click", () => {
    state.lb.paused = !state.lb.paused;
    syncPauseButton();
    // It's a chained-setTimeout model, so the timer must be re-ignited on resume
    if (state.lb.paused) stopSlideshow();
    else if (state.lb.mode === "slideshow") scheduleNext();
  });
  $("ss-interval").addEventListener("click", () => {
    const seqs = [3000, 5000, 7000, 10000, 15000, 30000];
    const i = seqs.indexOf(state.lb.interval);
    state.lb.interval = seqs[(i + 1) % seqs.length];
    $("ss-interval").textContent = t("ss_interval", state.lb.interval / 1000);
    if (state.lb.mode === "slideshow") startSlideshow();
  });
  // Open/close the ⚙ menu. Interval and caption are grouped into one to limit the number of toolbar buttons.
  // So both can be adjusted while it stays open, a click inside the menu doesn't close it (outside click / Esc closes it).
  const closeSsMenu = () => {
    $("ss-menu").hidden = true;
    $("ss-options").setAttribute("aria-expanded", "false");
  };
  $("ss-options").addEventListener("click", (e) => {
    // Stop it from being caught by the parent lightbox click (outside-click detection) and closing immediately
    e.stopPropagation();
    const willOpen = $("ss-menu").hidden;
    $("ss-menu").hidden = !willOpen;
    $("ss-options").setAttribute("aria-expanded", String(willOpen));
  });
  $("ss-caption").addEventListener("click", () => {
    const modes = ["full", "name", "none"];
    const i = modes.indexOf(state.lb.caption);
    state.lb.caption = modes[(i + 1) % modes.length];
    syncCaptionButton();
    applyCaption();
  });
  // Collapse on a click outside the menu (caught across the whole lightbox, excluding inside the ⚙ menu)
  $("lightbox").addEventListener("click", (e) => {
    if (!$("ss-menu").hidden && !$("ss-options-wrap").contains(e.target)) closeSsMenu();
  });
  // Image fit toggle (contain ↔ cover). Kills the black bars on tall phones.
  // The .fill class switches CSS object-fit, and the setting is persisted to localStorage.
  $("lb-fit").addEventListener("click", () => {
    state.lb.fit = state.lb.fit === "cover" ? "contain" : "cover";
    $("lightbox").classList.toggle("fill", state.lb.fit === "cover");
    lsSet(LS_LB_FIT_KEY, state.lb.fit);
    syncFitButton();
  });
  // Offline detection: CDragon splash images aren't cached, so offline they all fail to appear.
  // Announce the reason to avoid the "it's broken" misunderstanding.
  const offlineBanner = $("offline-banner");
  const syncOnlineState = () => { offlineBanner.hidden = navigator.onLine; };
  window.addEventListener("online", syncOnlineState);
  window.addEventListener("offline", syncOnlineState);
  syncOnlineState();

  // "Back to top" FAB: show it after scrolling a certain amount. A passive listener avoids blocking
  // scroll, and the visibility is cached in a flag so classList isn't touched on every scroll
  // (the DOM updates only when crossing the threshold).
  const toTopBtn = $("to-top");
  if (toTopBtn) {
    let toTopShown = false;
    const syncToTop = () => {
      const show = window.scrollY > 600;
      if (show === toTopShown) return;
      toTopShown = show;
      toTopBtn.hidden = !show;
    };
    // One passive scroll listener drives both FABs: top-right "Back to top" and bottom-left "Back".
    const onScroll = () => { syncToTop(); syncBackFab(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    toTopBtn.addEventListener("click", () => {
      // Respect reduce-motion: jump instantly if the user wants animations disabled
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
  }

  // Touch swipe (mobile): react only when horizontal movement is clearly larger than vertical
  let tStartX = 0, tStartY = 0;
  // A flag to ignore exactly one click that may fire right after a swipe completes. A completed swipe
  // normally suppresses the browser's click, but some devices leak it, so for reliability we decide
  // "a stage click right after a swipe is not used for the chrome toggle".
  let swipeConsumedClick = false;
  const lbEl = $("lightbox");
  lbEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    tStartX = e.touches[0].clientX;
    tStartY = e.touches[0].clientY;
  }, { passive: true });
  lbEl.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - tStartX;
    const dy = t.clientY - tStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipeConsumedClick = true;
      if (dx > 0) prevSlide(); else nextSlide();
    }
  }, { passive: true });
  // Tapping the stage (image area) bulk-toggles the control UI, the standard image-viewer gesture.
  // - When the ⚙ menu is open, defer to the existing "close on outside click" (the handler caught
  //   across the whole lightbox) and do nothing here (= the tap is spent on the close action)
  // - Ignore exactly one click completed by the preceding swipe (no double-fire with next/prev)
  // - The handler is attached directly to .lb-stage, so by DOM structure clicks on the toolbar/arrows/
  //   overlay don't reach here. lb-overlay is pointer-events:none so taps pass through to the stage,
  //   but a tap in the overlay area is fine to toggle too.
  document.querySelector(".lb-stage").addEventListener("click", () => {
    if (swipeConsumedClick) { swipeConsumedClick = false; return; }
    if (!$("ss-menu").hidden) return;
    $("lightbox").classList.toggle("chrome-hidden");
  });

  document.addEventListener("keydown", (e) => {
    // While a local wallpaper modal (confirm / done) is open, defer to the modal's own Esc handling
    // and don't run any of the app's key handling (Esc=goBack / ? / etc.). Without this, pressing Esc
    // in the gallery view (view!=="home") would close the modal and also fire goBack, navigating away
    // underneath. Tab containment is handled by each modal's trapFocus.
    const wp = $("wp-modal"), wpDone = $("wp-done-modal");
    if ((wp && !wp.hidden) || (wpDone && !wpDone.hidden)) return;
    // While the tutorial is shown, absorb keys with top priority (Esc/arrows/Enter only)
    if (isTutorialOpen()) {
      if (e.key === "Escape") closeTutorial();
      else if (e.key === "ArrowRight" || e.key === "Enter") tutNext();
      else if (e.key === "ArrowLeft") tutPrev();
      return;
    }
    // While the progress overlay is shown, accept only Esc=abort
    if ($("progress-overlay").classList.contains("open")) {
      if (e.key === "Escape") { state.packAbort = true; hideProgress(); }
      return;
    }
    if (!$("lightbox").classList.contains("open")) {
      if (e.key === "Escape" && state.view !== "home") onBackButton();
      // ? (Shift+/) reopens the tutorial anytime. Disabled while the search input is focused, since
      // the user may want to type ? as a character there.
      else if (e.key === "?" && document.activeElement !== $("search")) {
        e.preventDefault();
        openTutorial();
      }
      // / jumps to search (the standard desktop shortcut). Disabled while an input is focused, since
      // the user may want to type it as a character. The search input is transplanted from dom-stash
      // and always lives in the DOM, so scroll to the top first to make it visible, then focus it.
      else if (e.key === "/") {
        const ae = document.activeElement;
        const tag = ae && ae.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        e.preventDefault();
        window.scrollTo(0, 0);
        $("search").focus();
      }
      return;
    }
    // If the ⚙ menu is open, Esc first collapses the menu (doesn't close the lightbox)
    if (e.key === "Escape" && !$("ss-menu").hidden) { closeSsMenu(); return; }
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") nextSlide();
    else if (e.key === "ArrowLeft") prevSlide();
    else if (e.key === " ") { e.preventDefault(); if (state.lb.mode === "slideshow") $("ss-pause").click(); }
  });
}

// Write the sticky topbar's actual height to the CSS variable --topbar-h. It's the reference value so
// the gallery's sticky toolbar pins correctly just below the topbar. The topbar's height varies due to
// its two-row structure + locale differences + the mobile row-2 bottom-fixing, so we measure with a
// ResizeObserver and follow along rather than using a fixed CSS value.
function trackTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const setVar = () => {
    document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px");
  };
  if ("ResizeObserver" in window) {
    new ResizeObserver(setVar).observe(topbar);
  } else {
    window.addEventListener("resize", setVar);
  }
  setVar();
}

// Service Worker registration: cache the app shell to speed up return visits and satisfy the
// installability requirement. Register after load so it doesn't contend with the initial load's bandwidth.
// Failure (opening file:// directly / unsupported browser) doesn't affect the viewer itself.
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function bootstrap() {
  wireEvents();
  // Attach the grid image load/error delegated listener before the first render (#root is in the initial HTML)
  wireImgDelegation();
  // Attach the hash-routing popstate wiring + the post-render URL sync hook first.
  // Even if the hook is called by init()'s first render, the hash is already normalized by deep-link
  // resolution, so no spurious pushState is emitted.
  wirePopstate();
  trackTopbarHeight();
  init();
  registerSW();
}

// type="module" is defer-equivalent, so it's normally evaluated after DOMContentLoaded, but provide
// both branches in case it's read earlier for some reason.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
