// View renderers. Builds the DOM from state.view (home/champion/lines/line) and the search/selection state.
// The persistent layout (champ-header + view-content) is created once by ensureLayout;
// afterwards updates go through setPrimaryHeader / swapping view-content.innerHTML.

import {
  state, DATA, $, esc, announce,
  SELECT_KEY, SKIN_BY_KEY, LINE_INDEX,
  saveSelected,
} from "./state.js";
import {
  t, UI_STRINGS, ROLE_LABELS, RARITY_LABELS, REGION_LABELS,
  champName, skinLabel, lineName, toLightboxItem,
} from "./i18n.js";
import { downloadChampion, downloadLine, downloadSelected } from "./zip.js";
import { openLightbox, startGlobalSlideshow } from "./lightbox.js";
import { isLocal, isLocalWallpaper, toast } from "./local.js";
import { openWallpaperConfirm } from "./wallpaper.js";
import { gateDownload, openInDesktop, exportSelection, pickSelectionFile } from "./desktop.js";

// BCP-47 tag passed to localeCompare. "default" maps to English; otherwise convert
// CDragon's "xx_xx" to "xx-xx", so name sorting reads naturally in the current locale.
const cmpTag = () => state.locale === "default" ? "en" : state.locale.replace("_", "-");

// Sort key for release-date sorting. Use data.json's `release` ("YYYY-MM-DD") as-is; missing
// (old data.json / a new champion not yet on the Wiki) is treated as "9999-99-99", sending it to
// the end = newest side. Lexicographic string compare doubles as chronological order. JS's
// Array#sort is stable, so same-date and both-missing entries keep their original data.json order
// (= internal champion id order).
const relKey = (c) => c.release || "9999-99-99";
const cmpRelease = (a, b) => { const ka = relKey(a), kb = relKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; };

// Returns a new array of all champions ordered by state.sortOrder. Extracted so renderHome (the list)
// and renderChampion (prev/next nav order) share the same ordering. "name_asc"/"name_desc" use
// localeCompare on the localized name; "release" sorts ascending by data.json's `release` date.
function sortedChampions() {
  const arr = DATA.champions.slice();
  if (state.sortOrder === "release") return arr.sort(cmpRelease);
  const sign = state.sortOrder === "name_asc" ? 1 : state.sortOrder === "name_desc" ? -1 : 0;
  if (sign) {
    const tag = cmpTag();
    arr.sort((a, b) => sign * champName(a).localeCompare(champName(b), tag, { sensitivity: "base" }));
  }
  return arr;
}

// Returns skin lines with count>0 ordered by "count desc, then name in locale order" (all entries, unfiltered).
// Shared by renderLines (the list; search filtering is applied separately by the caller) and renderLine (prev/next nav order).
function sortedLineEntries() {
  const lines = DATA.skin_lines || {};
  return Object.entries(lines)
    .map(([id, name]) => {
      const idx = LINE_INDEX.get(id);
      return { id, name: lineName(id), _en: name, count: idx ? idx.count : 0, thumb: idx ? idx.thumb : "" };
    })
    .filter(e => e.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, cmpTag()));
}

// Wraps just the {n} placeholders of the stats_format template ("{0} CHAMPIONS · {1} SKINS" etc.)
// in <span>s. The first call counts up from 0 to the target value; later calls
// (e.g. on locale switch) render instantly to avoid flicker.
let _statsAnimated = false;
export function renderStats(champCount, skinCount) {
  const tmpl = (UI_STRINGS[state.locale] || UI_STRINGS.default).stats_format
            || UI_STRINGS.default.stats_format;
  const targets = [champCount, skinCount];
  const initial = _statsAnimated;
  const html = tmpl.replace(/(\{(\d+)\})|([^{}]+)/g, (_m, ph, idx, txt) => {
    if (ph) {
      const v = targets[Number(idx)] ?? 0;
      const w = String(v).length;
      const shown = initial ? v : 0;
      return `<span class="stat-num" data-target="${v}" style="min-width:${w}ch">${shown}</span>`;
    }
    return esc(txt);
  });
  $("stats").innerHTML = html;
  if (_statsAnimated) return;
  _statsAnimated = true;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nodes = [...$("stats").querySelectorAll(".stat-num")];
  if (reduce) {
    nodes.forEach(n => { n.textContent = n.dataset.target; });
    return;
  }
  const dur = 1400;
  const start = performance.now();
  function frame(now) {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3); // ease-out-cubic
    for (const n of nodes) {
      const tgt = Number(n.dataset.target);
      n.textContent = Math.round(tgt * e);
    }
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// The persistent champ-header that sits above view-content. h2 / count / primary are
// rewritten by renderXxx via setPrimaryHeader(). .champ-header-controls
// (back-btn / search / sort-label / sort-select) live here once and never move again.
// This keeps the search input's parent from being torn down on every render(), so
// focus, cursor position, and IME composition survive mid-typing.
export function ensureLayout(root) {
  if ($("view-content")) return;
  root.innerHTML = `
    <div class="champ-header" id="primary-header" hidden>
      <h2 class="primary-title-row">
        <button class="detail-nav-btn" id="detail-prev" type="button" hidden>‹</button>
        <span id="primary-title"></span>
        <button class="detail-nav-btn" id="detail-next" type="button" hidden>›</button>
      </h2>
      <div class="champ-header-controls"></div>
      <span class="count" id="primary-count"></span>
      <button class="btn primary" id="primary-action" hidden></button>
    </div>
    <div id="view-content"></div>`;
  const slot = root.querySelector(".champ-header-controls");
  slot.appendChild($("back-btn"));
  slot.appendChild($("search"));
  slot.appendChild($("sort-label"));
  slot.appendChild($("sort-select"));
}

// The single entry point for updating the contents of the persistent champ-header. renderXxx
// never touches its innerHTML, it just passes values here.
function setPrimaryHeader({ isList = false, title = "", count = "", primaryLabel = "", primaryClick = null, nav = null }) {
  const ph = $("primary-header");
  ph.hidden = false;
  ph.classList.toggle("is-list", !!isList);
  $("primary-title").textContent = title;
  $("primary-count").textContent = count;
  const btn = $("primary-action");
  if (primaryLabel) {
    btn.hidden = false;
    btn.textContent = primaryLabel;
    // Assigning onclick discards the previous handler automatically (unlike addEventListener, no duplicates)
    btn.onclick = primaryClick;
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }
  // Prev/next nav for detail views (champion / line). For views without nav (home/lines/gallery/search)
  // both buttons go back to hidden and onclick to null. When shown, the neighbor's name goes in
  // title/aria-label so the destination is clear on desktop hover and to screen readers (the button
  // itself only shows the ‹ › glyph, so no i18n needed).
  const prevBtn = $("detail-prev");
  const nextBtn = $("detail-next");
  if (nav) {
    prevBtn.hidden = false;
    prevBtn.title = nav.prevLabel;
    prevBtn.setAttribute("aria-label", nav.prevLabel);
    prevBtn.onclick = nav.onPrev;
    nextBtn.hidden = false;
    nextBtn.title = nav.nextLabel;
    nextBtn.setAttribute("aria-label", nav.nextLabel);
    nextBtn.onclick = nav.onNext;
  } else {
    prevBtn.hidden = true;
    prevBtn.onclick = null;
    prevBtn.removeAttribute("aria-label");
    nextBtn.hidden = true;
    nextBtn.onclick = null;
    nextBtn.removeAttribute("aria-label");
  }
}

// Hash-routing hook. app.js registers a callback via setRouteListener that "syncs the
// hash for the current state into location.hash". render.js never touches the
// history API itself (route<->state conversion and pushState/popstate live entirely
// in app.js). This lets the URL follow along every time render() runs, without
// rewriting the existing navigation functions (openChampion etc.).
let onRouteChange = null;
export function setRouteListener(fn) { onRouteChange = fn; }

// Forward-navigation hook. app.js registers a callback (snapshotCurrentEntry) that saves the
// outgoing list view's scroll + search query into the current history entry BEFORE a nav function
// clears the search / scrolls to top. Called as the first line of the forward-nav functions below,
// so the snapshot captures the real pre-clear values. render.js stays free of the history API.
let onBeforeNav = null;
export function setNavListener(fn) { onBeforeNav = fn; }

export function render() {
  const root = $("root");
  ensureLayout(root);
  // Tabs are top-level switches. back-btn shows in detail views (champion / line / selected) or while searching.
  // "selected" (My Gallery) is an intermediate view opened via its own path, so neither tab is active.
  const isLines = (state.view === "lines" || state.view === "line");
  const isSelected = (state.view === "selected");
  const isDetail = (state.view === "champion" || state.view === "line" || isSelected);
  const hasSearch = !!state.searchQuery;
  const showBack = isDetail || hasSearch;
  // Tabs are navigation indicating the "current view". .active is visual, aria-current is for screen readers
  // (we avoid an incomplete role="tab" implementation and use aria-current="page" as navigation).
  const homeActive = !isLines && !isSelected;
  $("tab-home").classList.toggle("active", homeActive);
  $("nav-lines").classList.toggle("active", isLines);
  $("tab-home").setAttribute("aria-current", homeActive ? "page" : "false");
  $("nav-lines").setAttribute("aria-current", isLines ? "page" : "false");
  if (state.view === "home") renderHome(root);
  else if (state.view === "champion") renderChampion(root);
  else if (state.view === "lines") renderLines(root);
  else if (state.view === "line") renderLine(root);
  else if (state.view === "selected") renderSelected(root);
  // Visibility: back only when showBack, sort only on home (the label follows the same condition)
  $("back-btn").style.display = showBack ? "" : "none";
  const sortVis = state.view === "home" ? "" : "none";
  $("sort-label").style.display = sortVis;
  $("sort-select").style.display = sortVis;
  // Search placeholder: in detail views (champion / line), swap in wording that signals search is
  // not view-local but spans all champions (= implicitly returns to the list).
  // It overrides the initial value applyStaticUIStrings sets, keyed on the view, so it keeps
  // following along after a locale switch since render() runs again.
  const searchEl = $("search");
  if (searchEl) {
    const global = (state.view === "champion" || state.view === "line");
    const ph = t(global ? "search_placeholder_global" : "search_placeholder");
    searchEl.placeholder = ph;
    // A placeholder is not an accessible name (it disappears on input / AT doesn't pick it up), so
    // apply the same translated wording to aria-label to give screen readers / voice control a name.
    searchEl.setAttribute("aria-label", ph);
  }
  refreshGalleryBtn();
  // At the end, notify app.js of the hash for the current state. app.js only pushState's
  // "when it differs from the current location.hash" to avoid a double render.
  if (onRouteChange) onRouteChange();
}

// The header "My Gallery" button: shows the selection count and, while in the gallery view,
// renders an active look via .primary. Called wherever the selection count changes (toggle/bulk/clear)
// and from render(). Also called from applyStaticUIStrings on locale switch.
// The count is shown in a separate span (.gallery-count) rather than concatenated as "(19)": the
// bottom fixed nav (mobile) packs 4 equal-width buttons, so width is tight and adding a number to
// the label would overflow. CSS routes it to a badge right of the label on desktop / a corner badge on mobile.
export function refreshGalleryBtn() {
  const btn = $("gallery-btn");
  if (!btn) return;
  const n = state.selected.size;
  // Wrap the label in a span: in the mobile bottom nav we set the button to overflow:visible and
  // float the count badge above the button's top edge (the gap right above the text), while keeping
  // the label's ellipsis intact.
  btn.textContent = "";
  const label = document.createElement("span");
  label.className = "btn-label";
  label.textContent = t("select_mode");
  btn.appendChild(label);
  if (n > 0) {
    const badge = document.createElement("span");
    badge.className = "gallery-count";
    badge.textContent = n;
    btn.appendChild(badge);
  }
  const galleryActive = state.view === "selected";
  btn.classList.toggle("primary", galleryActive);
  btn.setAttribute("aria-current", galleryActive ? "page" : "false");
  // This function's job is nominally "the gallery button's count display", but since it's the one
  // sync point called from every path that changes the selection count + from render(), the header
  // Slideshow button's empty-state look piggybacks here too. With 0 selected, dim it via .is-empty
  // (disabled-looking) but don't set the disabled attribute: so the click path that routes to
  // My Gallery (app.js) stays alive.
  const ssBtn = $("slideshow-btn");
  if (ssBtn) ssBtn.classList.toggle("is-empty", n === 0);
}

// Filter chips: one tap injects a localized term from the given LABELS maps into the search query.
// Reuses the existing multi-axis search (renderHome=name/role/region, renderLines=rarity), so there's
// no dedicated filter engine. Axis placement is split by view based on its nature:
// home (champion list) gets role/region (= champion attributes); Lines (skin list) gets
// rarity (= a skin attribute; per-skin, so it doesn't fit "narrowing champions" and lives where
// skins are viewed). The goal is to surface ROLE/RARITY/REGION_LABELS as a "discoverable entry point".
// Key enumeration is keyed on .default's Object.keys (locale-independent and stable), and only
// the label is resolved in the current locale (falling back to default). Re-tapping an active chip
// (matching the current query) clears the search (toggle).
function filterChipsHTML(q, maps) {
  const seen = new Set();
  const chips = [];
  for (const map of maps) {
    const loc = map[state.locale] || {};
    for (const key of Object.keys(map.default)) {
      const label = loc[key] || map.default[key];
      const low = label.toLowerCase();
      // Collapse duplicate spellings across locales into one (e.g. regions in unregistered locales are all English)
      if (seen.has(low)) continue;
      seen.add(low);
      const active = low === q ? " active" : "";
      chips.push(`<button type="button" class="filter-chip${active}" data-filter="${esc(label)}">${esc(label)}</button>`);
    }
  }
  // Reference the visible label span via aria-labelledby so the group name is announced once
  // (avoids the double announcement of aria-label plus the visible span).
  return `<div class="filter-chips" role="group" aria-labelledby="filter-chips-label">`
    + `<span class="filter-chips-label" id="filter-chips-label">${esc(t("filters_label"))}</span>`
    + chips.join("") + `</div>`;
}

function wireFilterChips(root) {
  root.querySelectorAll(".filter-chip").forEach(el => {
    el.addEventListener("click", () => {
      // Re-tap an active chip -> clear. Otherwise -> search by that filter term.
      const next = el.classList.contains("active") ? "" : el.dataset.filter;
      // Put the value in the search box and fire input, merging into the existing debounced search path.
      // Writing state.searchQuery directly and calling render() would let the debounce timer (app.js)
      // armed by the previous keystroke overwrite it 90ms later with the stale value. Going through input
      // clears and re-arms that timer so there's no race, and avoids duplicating the search logic.
      const search = $("search");
      search.value = next;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

// In the Lines view, decide whether the (lowercased) search query points at a rarity by "exact match",
// returning the matching English key (Epic/Legendary/Mythic/Ultimate) or null. Rarity chips inject the
// localized label exactly into the search box, so a substring match would collide with typing a line
// name ("epi" etc.). Restricting to exact match makes the chip path and line-name search mutually
// exclusive with no ambiguity (checks the English key / default English label / current locale label).
function rarityKeyFromQuery(q) {
  if (!q) return null;
  const loc = RARITY_LABELS[state.locale] || {};
  for (const key of Object.keys(RARITY_LABELS.default)) {
    if (q === key.toLowerCase()) return key;
    if (q === RARITY_LABELS.default[key].toLowerCase()) return key;
    if (loc[key] && q === loc[key].toLowerCase()) return key;
  }
  return null;
}

function renderHome(root) {
  const q = state.searchQuery.toLowerCase();
  // The filter chip row pinned at the top of the home view (shown regardless of search). home is
  // about narrowing champions, so only role/region (champion attributes). rarity (a skin attribute)
  // was moved to the Lines view.
  const chips = filterChipsHTML(q, [ROLE_LABELS, REGION_LABELS]);
  // Search matching is OR across axes (not AND): "keep it if it hits on any axis".
  // Champion-side axes: champion name (alias/English name/translated name), role (Mage etc.),
  // region (Demacia etc.). Skin-side axis: skin name (English/translated) only. rarity moved to the
  // Lines view, so it's not a home search axis. role/region translations are checked alongside the
  // English keys, so it's found whichever language the user types. While searching, "matching champions"
  // and "matching skins" go in separate stacked sections: typing "garen" distinguishes Garen himself
  // from Garen-style skins on other champions (if any).
  const localeRoles = ROLE_LABELS[state.locale] || {};
  const localeRegions = REGION_LABELS[state.locale] || {};
  const hit = (s) => typeof s === "string" && s.toLowerCase().includes(q);

  // Sorting: the default "name_asc"/"name_desc" use localeCompare on the localized name.
  // Using the Intl path for comparison gives the client's natural ordering even in Japanese/Korean/Chinese.
  // "release" sorts ascending by the champion's release date (skins use their owning champion's date).
  const isRelease = state.sortOrder === "release";
  const sortSign = state.sortOrder === "name_asc" ? 1 : state.sortOrder === "name_desc" ? -1 : 0;
  const cmpLocale = cmpTag();
  const sortChamps = (arr) => isRelease ? arr.sort(cmpRelease)
    : sortSign && arr.sort((a, b) =>
        sortSign * champName(a).localeCompare(champName(b), cmpLocale, { sensitivity: "base" }));
  const sortSkins = (arr) => isRelease ? arr.sort((a, b) => cmpRelease(a.c, b.c))
    : sortSign && arr.sort((a, b) => {
        const an = `${champName(a.c)} ${skinLabel(a.c, a.s)}`;
        const bn = `${champName(b.c)} ${skinLabel(b.c, b.s)}`;
        return sortSign * an.localeCompare(bn, cmpLocale, { sensitivity: "base" });
      });

  // No search: just the champion list as before (shares the same ordering as renderChampion's prev/next nav)
  if (!q) {
    const list = sortedChampions();
    setPrimaryHeader({ isList: true, title: t("nav_home"), count: t("champs_count", list.length) });
    $("view-content").innerHTML = chips + `<div class="champ-grid">${renderChampCards(list)}</div>`;
    wireChampCards(root);
    wireFilterChips(root);
    return;
  }

  // With search: collect champion-side hits and skin-side hits separately
  const champMatches = DATA.champions.filter(c => {
    if (hit(c.name) || hit(c.alias) || hit(champName(c))) return true;
    if ((c.roles || []).some(r => hit(r) || hit(localeRoles[r]) || hit(ROLE_LABELS.default[r]))) return true;
    if ((c.regions || []).some(slug => hit(slug) || hit(localeRegions[slug]) || hit(REGION_LABELS.default[slug]))) return true;
    return false;
  });
  const skinMatches = [];
  for (const c of DATA.champions) {
    for (const s of c.skins) {
      if (!s.splash) continue;
      // Skin-side hits are skin name only. rarity moved to its dedicated chips in the Lines view, so
      // it's excluded from home's search axes (rarity is per-skin = doesn't fit narrowing champions).
      if (hit(s.label) || hit(skinLabel(c, s))) skinMatches.push({ c, s });
    }
  }
  sortChamps(champMatches);
  sortSkins(skinMatches);

  if (champMatches.length === 0 && skinMatches.length === 0) {
    setPrimaryHeader({ isList: true, title: t("no_results_title"), count: state.searchQuery });
    $("view-content").innerHTML = chips + `<div class="loading"><p>${t("no_results_msg", esc(state.searchQuery))}</p></div>`;
    wireFilterChips(root);
    // WCAG 4.1.3: result changes from search (including filter chips) are a status. Announce to screen readers.
    announce(t("no_results_msg", state.searchQuery));
    return;
  }

  // The primary header handles the top section (Champions if any champions, otherwise Skins).
  // When both exist, the second-level heading is written into view-content as an ordinary
  // champ-header via innerHTML (no controls slot).
  const parts = [];
  if (champMatches.length > 0) {
    setPrimaryHeader({ isList: true, title: t("nav_home"), count: t("champs_count", champMatches.length) });
    parts.push(`<div class="champ-grid">${renderChampCards(champMatches)}</div>`);
    if (skinMatches.length > 0) {
      parts.push(`
        <div class="champ-header is-list">
          <h2>${t("section_skins")}</h2>
          <span class="count">${t("skins_count", skinMatches.length)}</span>
        </div>
        <div class="skin-grid is-flat">${renderSkinCards(skinMatches)}</div>`);
    }
  } else {
    setPrimaryHeader({ isList: true, title: t("section_skins"), count: t("skins_count", skinMatches.length) });
    parts.push(`<div class="skin-grid is-flat">${renderSkinCards(skinMatches)}</div>`);
  }
  $("view-content").innerHTML = chips + parts.join("");
  wireChampCards(root);
  wireSearchSkinCards(root, skinMatches);
  wireFilterChips(root);
  // WCAG 4.1.3: announce result counts to screen readers. Composed from translated keys (no new key needed).
  const aParts = [];
  if (champMatches.length) aParts.push(t("champs_count", champMatches.length));
  if (skinMatches.length) aParts.push(t("skins_count", skinMatches.length));
  announce(aParts.join(", "));
}

// Builds the type/aria attributes for the + button (sel-checkbox). Conveys the three states
// (full=all selected / partial=some / none) to screen readers via aria-pressed (true / mixed / false).
// The visible "+/✓/3-14" is handled by ::before and textContent, so aria-label describes the action
// (add/remove) instead. (The title attribute isn't exposed to screen readers/keyboard, so we use aria-label.)
function cbAttrs(full, partial) {
  const pressed = partial ? "mixed" : (full ? "true" : "false");
  const label = full ? t("gallery_remove") : t("gallery_add");
  return `type="button" aria-pressed="${pressed}" aria-label="${esc(label)}"`;
}

// A transparent button covering the whole card that serves as its primary action (open). Making the
// card body role="button" would nest the interactive + button inside it, which is invalid ARIA
// (a focusable child inside a button), so the open action is an inset:0 <button> overlay and the
// + button is layered on top as a "sibling" (z-index: + on top, the cover button below). This way
// native button Enter/Space work as-is and the nesting is resolved.
function openBtn(label) {
  return `<button class="card-open" type="button" aria-label="${esc(label)}"></button>`;
}

function renderChampCards(list) {
  return list.map(c => {
    // Tally the selected count among the champion's skins to distinguish partial/selected.
    // state.selected is per-skin, so this is just derived info (the source of truth is the Set).
    let cls = "", cbText = "", full = false, partial = false;
    if (c.skins.length > 0) {
      const sel = c.skins.reduce((n, s) => n + (state.selected.has(SELECT_KEY(c.alias, s.label)) ? 1 : 0), 0);
      if (sel === c.skins.length) { cls = " selected"; full = true; }
      else if (sel > 0) { cls = " partial"; partial = true; cbText = `${sel}/${c.skins.length}`; }
    }
    // The cover button (openBtn) handles opening and surfaces the name once via aria-label. img/label
    // are decorative (alt="" / aria-hidden) to prevent double reading. + is a sibling button reachable
    // individually via Tab.
    const name = champName(c);
    return `
    <div class="champ-card${cls}" data-alias="${esc(c.alias)}">
      ${openBtn(name)}
      <button class="sel-checkbox" ${cbAttrs(full, partial)}>${esc(cbText)}</button>
      <img loading="lazy" decoding="async" src="${esc(c.portrait)}" alt="">
      <div class="label" aria-hidden="true">${esc(name)}</div>
    </div>`;
  }).join("");
}

// HTML for a single skin tile. The home(search)/champion/line/selected views all drew the same card
// with only minor differences (presence of data-alias, a champ-name prefix on the label, always-selected),
// so it's consolidated here. With video, overlay a ▶ badge so it's clear "this one moves" before
// opening the lightbox.
function skinCardHTML({ c, s, idx, label, alias = false, forceSelected = false }) {
  const k = SELECT_KEY(c.alias, s.label);
  const selected = forceSelected || state.selected.has(k);
  const aliasAttr = alias ? ` data-alias="${esc(c.alias)}"` : "";
  const badge = s.video ? `<span class="anim-badge" aria-hidden="true">▶</span>` : "";
  return `
    <div class="skin-card${selected ? " selected" : ""}" data-idx="${idx}" data-key="${esc(k)}"${aliasAttr}>
      ${openBtn(label)}
      <button class="sel-checkbox" ${cbAttrs(selected, false)}></button>${badge}
      <img loading="lazy" decoding="async" src="${esc(s.splash)}" alt="">
      <div class="label" aria-hidden="true">${esc(label)}</div>
    </div>`;
}

function renderSkinCards(matches) {
  return matches.map((m, i) =>
    skinCardHTML({ c: m.c, s: m.s, idx: i, label: `${champName(m.c)} — ${skinLabel(m.c, m.s)}`, alias: true })
  ).join("");
}

function wireChampCards(root) {
  root.querySelectorAll(".champ-card").forEach(el => {
    // The cover button (.card-open) opens the detail view. It's a native button, so Enter/Space work too.
    el.querySelector(".card-open").addEventListener("click", () => openChampion(el.dataset.alias));
    // + is a sibling button: a shortcut to "bulk-toggle all of this champion's skins"
    const cb = el.querySelector(".sel-checkbox");
    if (cb) cb.addEventListener("click", () => bulkToggleChamp(el.dataset.alias));
  });
}

// Shared helper that wires up a group of skin tiles. Body click opens the lightbox
// (the same idx in lbList); + (.sel-checkbox) toggles that single skin.
// The champion/line/selected/search-results views all wire the same way, so it's consolidated here.
function wireSkinCards(scope, lbList) {
  scope.querySelectorAll(".skin-card").forEach(el => {
    el.querySelector(".card-open").addEventListener("click",
      () => openLightbox(lbList, parseInt(el.dataset.idx, 10), "manual"));
    const cb = el.querySelector(".sel-checkbox");
    if (cb) cb.addEventListener("click", () => toggleSelected(el.dataset.key, el));
  });
}

// Search-result skin tiles: wire only the flat grid inside the home view
function wireSearchSkinCards(root, matches) {
  const scope = root.querySelector(".skin-grid.is-flat");
  if (!scope) return;
  wireSkinCards(scope, matches.map(({ c, s }) => toLightboxItem(c, s)));
}

function renderChampion(root) {
  const c = DATA.champions.find(x => x.alias === state.currentChamp);
  if (!c) { state.view = "home"; render(); return; }
  const cards = c.skins.map((s, i) =>
    skinCardHTML({ c, s, idx: i, label: skinLabel(c, s) })
  ).join("");
  const keys = c.skins.map(s => SELECT_KEY(c.alias, s.label));
  // Prev/next nav: find the current index within the same ordering as the list (sortedChampions),
  // with wraparound at both ends (same circular idea as the lightbox next/prev). With a single element,
  // prev and next are both itself, so we pass no nav and keep both buttons hidden.
  // openChampion runs render() -> the hash sync hook, so the browser back button returns to the
  // previous detail view (as intended).
  const order = sortedChampions();
  const i = order.findIndex(x => x.alias === c.alias);
  const nav = order.length > 1 && i >= 0 ? makeDetailNav(order, i, x => champName(x), x => openChampion(x.alias)) : null;
  setPrimaryHeader({
    title: champName(c),
    count: t("skins_count", c.skins.length),
    nav,
    ...detailPrimary(keys, t("dl_champion"), () => gateDownload(() => downloadChampion(c))),
  });
  $("view-content").innerHTML = `<div class="skin-grid">${cards}</div>`;
  wireSkinCards($("view-content"), buildChampList(c));
}

// Builds the { prevLabel, nextLabel, onPrev, onNext } for a detail view's prev/next nav.
// order: the sorted array, i: current index, labelOf: the neighbor's display name, go: the function to move to a neighbor.
// Both ends wrap around (circular).
function makeDetailNav(order, i, labelOf, go) {
  const n = order.length;
  const prev = order[(i - 1 + n) % n];
  const next = order[(i + 1) % n];
  return {
    prevLabel: labelOf(prev),
    nextLabel: labelOf(next),
    onPrev: () => go(prev),
    onNext: () => go(next),
  };
}

function renderLines(root) {
  const q = state.searchQuery.toLowerCase();
  // The rarity chip row pinned at the top of the Lines view (= a skin attribute, paired with home's role/region).
  // Unlike home's search-result Skins section, here it serves as a standalone browsing axis for rarity.
  const chips = filterChipsHTML(q, [RARITY_LABELS]);
  // For a rarity chip / exact-match typing of a rarity name, show the skins of that rarity flat
  // rather than the line list (reusing the same rendering as home's search-result Skins section).
  const rarityKey = rarityKeyFromQuery(q);
  if (rarityKey) { renderRaritySkins(root, chips, rarityKey); return; }

  // Tally the per-line selected counts (recomputed each time since state.selected changes).
  // count/thumb come from LINE_INDEX, which is built once.
  const selectedCounts = {};
  if (state.selected.size > 0) {
    for (const k of state.selected) {
      const hit = SKIN_BY_KEY.get(k);
      if (!hit) continue;
      for (const lid of (hit.s.lines || [])) {
        const id = String(lid);
        selectedCounts[id] = (selectedCounts[id] || 0) + 1;
      }
    }
  }
  // Ordering/counts are consolidated in sortedLineEntries (shared with renderLine's prev/next nav). Display uses
  // the translated name, but search matches on (translated name + English name), so the filter is applied here.
  const entries = sortedLineEntries()
    .filter(e => !q || e.name.toLowerCase().includes(q) || e._en.toLowerCase().includes(q));
  if (entries.length === 0) {
    setPrimaryHeader({ isList: true, title: t("no_results_title"), count: "" });
    $("view-content").innerHTML = chips + `<div class="loading"><p>${t("no_lines_msg")}</p></div>`;
    wireFilterChips(root);
    // WCAG 4.1.3: announce to screen readers only when the search filter yields 0 (stay silent for the plain list)
    if (q) announce(t("no_lines_msg"));
    return;
  }
  const cards = entries.map(e => {
    let cls = "", cbText = "", full = false, partial = false;
    if (e.count > 0) {
      const sel = selectedCounts[e.id] || 0;
      if (sel === e.count) { cls = " selected"; full = true; }
      else if (sel > 0) { cls = " partial"; partial = true; cbText = `${sel}/${e.count}`; }
    }
    const aria = `${e.name}, ${t("skins_count", e.count)}`;
    return `
    <div class="line-card${cls}" data-line="${esc(e.id)}">
      ${openBtn(aria)}
      <button class="sel-checkbox" ${cbAttrs(full, partial)}>${esc(cbText)}</button>
      <img loading="lazy" decoding="async" src="${esc(e.thumb)}" alt="">
      <div class="meta" aria-hidden="true">
        <div class="name">${esc(e.name)}</div>
        <div class="count">${t("skins_count", e.count)}</div>
      </div>
    </div>`;
  }).join("");
  setPrimaryHeader({ isList: true, title: t("skin_lines_header"), count: t("lines_count", entries.length) });
  $("view-content").innerHTML = chips + `<div class="line-grid">${cards}</div>`;
  $("view-content").querySelectorAll(".line-card").forEach(el => {
    el.querySelector(".card-open").addEventListener("click", () => openLine(el.dataset.line));
    const cb = el.querySelector(".sel-checkbox");
    if (cb) cb.addEventListener("click", () => bulkToggleLine(el.dataset.line));
  });
  wireFilterChips(root);
  // WCAG 4.1.3: announce result counts to screen readers only when filtering by search (stay silent for the plain list)
  if (q) announce(t("lines_count", entries.length));
}

// Display when a rarity chip is activated (Lines view): lay out all skins of that rarity in a flat
// skin grid. Rendering/wiring reuse home's search-result Skins section (renderSkinCards /
// wireSearchSkinCards) as-is. The chip row stays at the top so the user can switch to another rarity
// or clear it (by re-tapping the active chip).
function renderRaritySkins(root, chips, rarityKey) {
  const matches = [];
  for (const c of DATA.champions) {
    for (const s of c.skins) {
      if (s.splash && s.rarity === rarityKey) matches.push({ c, s });
    }
  }
  const cmpLocale = cmpTag();
  matches.sort((a, b) => {
    const an = `${champName(a.c)} ${skinLabel(a.c, a.s)}`;
    const bn = `${champName(b.c)} ${skinLabel(b.c, b.s)}`;
    return an.localeCompare(bn, cmpLocale, { sensitivity: "base" });
  });
  const label = (RARITY_LABELS[state.locale] || {})[rarityKey] || RARITY_LABELS.default[rarityKey];
  setPrimaryHeader({ isList: true, title: label, count: t("skins_count", matches.length) });
  if (matches.length === 0) {
    $("view-content").innerHTML = chips + `<div class="loading"><p>${t("no_results_msg", esc(label))}</p></div>`;
    wireFilterChips(root);
    announce(t("no_results_msg", label));
    return;
  }
  $("view-content").innerHTML = chips + `<div class="skin-grid is-flat">${renderSkinCards(matches)}</div>`;
  wireSearchSkinCards(root, matches);
  wireFilterChips(root);
  announce(t("skins_count", matches.length));
}

function renderLine(root) {
  const lid = state.currentLine;
  const lname = lineName(lid);
  const idx = LINE_INDEX.get(String(lid));
  const items = idx ? idx.members.map(m => ({ champ: m.c, skin: m.s })) : [];
  if (items.length === 0) { state.view = "lines"; render(); return; }
  const cards = items.map((it, i) =>
    skinCardHTML({ c: it.champ, s: it.skin, idx: i, label: `${champName(it.champ)} — ${skinLabel(it.champ, it.skin)}` })
  ).join("");
  const keys = items.map(it => SELECT_KEY(it.champ.alias, it.skin.label));
  // Prev/next nav: find the current id's index within sortedLineEntries' ordering (ignoring the search
  // filter = all entries), wrapping around to the prev/next id. With a single element, pass no nav and keep both buttons hidden.
  const order = sortedLineEntries();
  const li = order.findIndex(e => String(e.id) === String(lid));
  const nav = order.length > 1 && li >= 0 ? makeDetailNav(order, li, e => e.name, e => openLine(e.id)) : null;
  setPrimaryHeader({
    title: lname,
    count: t("skins_count", items.length),
    nav,
    ...detailPrimary(keys, t("dl_line"), () => gateDownload(() => downloadLine(lid, lname, items))),
  });
  $("view-content").innerHTML = `<div class="skin-grid">${cards}</div>`;
  wireSkinCards($("view-content"), items.map(it => toLightboxItem(it.champ, it.skin)));
}

// My Gallery (the list of selected skins) view. Opened via the header "My Gallery" button.
// Materializes state.selected (Set<SELECT_KEY>) through SKIN_BY_KEY and stable-sorts by localized
// name before laying out the skin-grid (the Set's iteration order = insertion order doesn't read
// intuitively on a return visit).
// A DL / Slideshow / Clear toolbar goes above the grid (the old pack-bar's role).
// Clicking + on a card calls toggleSelected but doesn't remove it immediately, just dims it in place
// (so it's undoable). It actually leaves the grid only the next time the gallery is reopened.

// Wire an "Import selection" button: open the file picker, merge the keys, then refresh the gallery
// so the imported cards appear (or are shown alongside the existing selection).
function wireImportSelection(btn) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    pickSelectionFile().then((n) => {
      if (n === null) return;                            // dialog cancelled — stay silent
      if (n < 0) { toast(t("import_invalid"), "err"); }  // unreadable / not selection JSON
      else if (n === 0) { toast(t("import_none")); }     // valid file, but nothing new (all already selected or stale keys)
      else { toast(t("import_done_file", n)); render(); }
    });
  });
}

function renderSelected(root) {
  const items = [];
  for (const k of state.selected) {
    const hit = SKIN_BY_KEY.get(k);
    if (hit && hit.s.splash) items.push({ key: k, champ: hit.c, skin: hit.s });
  }
  const cmpLocale = cmpTag();
  items.sort((a, b) => {
    const an = `${champName(a.champ)} ${skinLabel(a.champ, a.skin)}`;
    const bn = `${champName(b.champ)} ${skinLabel(b.champ, b.skin)}`;
    return an.localeCompare(bn, cmpLocale, { sensitivity: "base" });
  });

  setPrimaryHeader({
    isList: true,
    title: t("select_mode"),
    count: items.length ? t("skins_count", items.length) : "",
  });

  if (items.length === 0) {
    // The empty state tends to be a dead end, so show a CTA back to home below the hint text
    // Offer Import here too: a fresh desktop app (or a new device) starts with an empty gallery, and
    // importing a file exported elsewhere is exactly the cross-machine hand-off path.
    $("view-content").innerHTML =
      `<div class="loading"><p>${t("gallery_empty")}</p><p class="gallery-hint">${t("gallery_empty_hint")}</p>` +
      `<div class="gallery-empty-actions">` +
      `<button class="btn primary gallery-browse-cta" id="gallery-browse">${t("gallery_empty_cta")}</button>` +
      `<button class="btn" id="gallery-import">${t("import_selection")}</button>` +
      `</div></div>`;
    const browse = $("gallery-browse");
    if (browse) browse.addEventListener("click", goHome);
    wireImportSelection($("gallery-import"));
    return;
  }

  const cards = items.map((it, i) =>
    skinCardHTML({ c: it.champ, s: it.skin, idx: i, label: `${champName(it.champ)} — ${skinLabel(it.champ, it.skin)}`, forceSelected: true })
  ).join("");
  // Only in local-run mode, show "Set as wallpaper" (select -> confirm modal -> bulk apply).
  // One image = static wallpaper, two or more = the OS's native slideshow (handled by wallpaper.js + the server).
  // In local mode ZIP DL goes away and this becomes the main action, so it's promoted to primary.
  const wpBtn = isLocalWallpaper()
    ? `<button class="btn primary" id="gallery-wp">${t("wallpaper_set_btn")}</button>`
    : "";
  // ZIP DL is Web-only (the way to work around the browser sandbox). Hide it in local mode.
  const dlBtn = isLocal() ? "" : `<button class="btn primary" id="gallery-dl">${t("dl_selected")}</button>`;
  // Web only: hand this selection to the desktop app (set as wallpaper in one click). localStorage
  // is per-origin so it can't be shared automatically — this deep-links the selection across.
  const handoffBtn = isLocal() ? "" : `<button class="btn" id="gallery-handoff">${t("open_in_desktop")}</button>`;
  // Export / Import the selection as a file. Mode-independent (works either direction): the file is
  // the cross-machine path that the same-machine deep-link hand-off (handoffBtn) can't cover.
  $("view-content").innerHTML = `
    <div class="gallery-toolbar">
      ${dlBtn}
      ${wpBtn}
      ${handoffBtn}
      <button class="btn" id="gallery-ss">${t("nav_slideshow")}</button>
      <button class="btn" id="gallery-export">${t("export_selection")}</button>
      <button class="btn" id="gallery-import">${t("import_selection")}</button>
      <button class="btn" id="gallery-clear">${t("clear")}</button>
    </div>
    <div class="skin-grid gallery-grid">${cards}</div>`;
  const dl = $("gallery-dl");
  if (dl) dl.addEventListener("click", () => gateDownload(downloadSelected));
  const handoff = $("gallery-handoff");
  if (handoff) handoff.addEventListener("click", openInDesktop);
  const ex = $("gallery-export");
  if (ex) ex.addEventListener("click", () => { if (exportSelection()) toast(t("export_done")); });
  wireImportSelection($("gallery-import"));
  // The gallery toolbar's Slideshow: normally only shown when there are items, but in the edge case
  // of selecting only skins without a splash, startGlobalSlideshow returns false (0 playable). We're
  // already in the gallery view here, so no extra navigation is needed, just toast the reason.
  $("gallery-ss").addEventListener("click", () => {
    if (!startGlobalSlideshow()) toast(t("slideshow_empty"));
  });
  $("gallery-clear").addEventListener("click", clearSelected);
  const wp = $("gallery-wp");
  if (wp) wp.addEventListener("click", () => openWallpaperConfirm(items));
  wireSkinCards($("view-content"), items.map(it => toLightboxItem(it.champ, it.skin)));
}

export function openSelected() {
  if (onBeforeNav) onBeforeNav();   // snapshot the outgoing list (scroll + search) before we clear it
  state.view = "selected";
  state.currentChamp = null;
  state.currentLine = null;
  state.searchQuery = ""; $("search").value = "";
  window.scrollTo(0, 0); render();
}

export function toggleSelected(key, el) {
  const nowSelected = !state.selected.has(key);
  if (nowSelected) {
    state.selected.add(key);
    if (el) el.classList.add("selected");
  } else {
    state.selected.delete(key);
    if (el) el.classList.remove("selected");
  }
  saveSelected();
  // Don't re-render immediately even in the gallery view. Previously a card vanished from the grid
  // the instant it was deselected, so it couldn't be undone; now the card stays in place (.selected
  // removed = dimmed) and pressing again restores it. It actually leaves the grid only the next time
  // the gallery is reopened. In every view we settle for a card class update, and only the count
  // display (header / button) updates immediately.
  if (el) {
    const cb = el.querySelector(".sel-checkbox");
    if (cb) {
      cb.setAttribute("aria-pressed", String(nowSelected));
      cb.setAttribute("aria-label", nowSelected ? t("gallery_remove") : t("gallery_add"));
    }
  }
  refreshGalleryBtn();
  if (state.view === "selected") {
    const cnt = $("primary-count");
    if (cnt) cnt.textContent = state.selected.size ? t("skins_count", state.selected.size) : "";
  }
}
// Bulk toggle at the champion/line level. state.selected is a per-skin Set, so this is just
// "bulk add/remove the SELECT_KEYs of the contained skins".
// An indeterminate toggle: "all selected -> deselect all", "otherwise -> select all".
// To keep a partial selection (3/14 etc.), the user enters the detail view and adjusts individually.
function bulkToggleKeys(keys) {
  if (!keys.length) return;
  const allSel = keys.every(k => state.selected.has(k));
  for (const k of keys) {
    if (allSel) state.selected.delete(k);
    else state.selected.add(k);
  }
  saveSelected();
  // Previously this redrew everything with render(), but that remounted every visible card's <img>
  // at once and briefly darkened the screen. The selection state is just a look derived from
  // state.selected, so update the visible cards' classes/badges in place (don't touch img = no flash).
  applyCardSelectionStates();
  refreshGalleryBtn();
  // In a detail view (champion/line), the primary button's label flips between "Select all" and
  // "Deselect all". After the toggle, allSel is inverted (was allSel -> now deselected all / else -> now all selected).
  if (state.view === "champion" || state.view === "line") {
    const btn = $("primary-action");
    if (btn && !btn.hidden)
      btn.textContent = allSel ? t("select_all") : t("select_all_done");
  }
}

// Recomputes the selection state (.selected / .partial + count badge) of every visible card
// (champ / line / skin) from state.selected and applies it in place. Unlike render(), it doesn't
// rebuild the <img>, so bulk selection doesn't flicker the screen.
function applyCardSelectionStates() {
  const vc = $("view-content");
  if (!vc) return;
  const setState = (el, sel, total) => {
    const full = total > 0 && sel === total;
    const partial = sel > 0 && sel < total;
    el.classList.toggle("selected", full);
    el.classList.toggle("partial", partial);
    const cb = el.querySelector(".sel-checkbox");
    if (cb) {
      cb.textContent = partial ? `${sel}/${total}` : "";
      cb.setAttribute("aria-pressed", partial ? "mixed" : String(full));
      cb.setAttribute("aria-label", full ? t("gallery_remove") : t("gallery_add"));
    }
  };
  vc.querySelectorAll(".champ-card").forEach(el => {
    const c = DATA.champions.find(x => x.alias === el.dataset.alias);
    if (!c) return;
    const sel = c.skins.reduce((n, s) => n + (state.selected.has(SELECT_KEY(c.alias, s.label)) ? 1 : 0), 0);
    setState(el, sel, c.skins.length);
  });
  vc.querySelectorAll(".line-card").forEach(el => {
    const idx = LINE_INDEX.get(String(el.dataset.line));
    if (!idx) return;
    const sel = idx.members.reduce((n, m) => n + (state.selected.has(SELECT_KEY(m.c.alias, m.s.label)) ? 1 : 0), 0);
    setState(el, sel, idx.count);
  });
  vc.querySelectorAll(".skin-card").forEach(el => {
    const on = state.selected.has(el.dataset.key);
    el.classList.toggle("selected", on);
    const cb = el.querySelector(".sel-checkbox");
    if (cb) {
      cb.setAttribute("aria-pressed", String(on));
      cb.setAttribute("aria-label", on ? t("gallery_remove") : t("gallery_add"));
    }
  });
}
// The primary action of a detail view (champion/line). Web = ZIP DL, local = select-all toggle.
// In local mode DL is hidden, steering toward the gallery -> wallpaper-slideshow path. When all are
// selected it becomes "Deselect all" (the label update is done by bulkToggleKeys writing directly to primary-action).
function detailPrimary(keys, zipLabel, zipClick) {
  if (!isLocal()) return { primaryLabel: zipLabel, primaryClick: zipClick };
  const allSel = keys.length > 0 && keys.every(k => state.selected.has(k));
  return {
    primaryLabel: allSel ? t("select_all_done") : t("select_all"),
    primaryClick: () => bulkToggleKeys(keys),
  };
}
function bulkToggleChamp(alias) {
  const c = DATA.champions.find(x => x.alias === alias);
  if (!c) return;
  bulkToggleKeys(c.skins.map(s => SELECT_KEY(c.alias, s.label)));
}
function bulkToggleLine(lid) {
  const idx = LINE_INDEX.get(String(lid));
  if (!idx) return;
  bulkToggleKeys(idx.members.map(m => SELECT_KEY(m.c.alias, m.s.label)));
}
function clearSelected() {
  state.selected.clear();
  saveSelected();
  render();
  // Clear is gallery-view only (#gallery-clear). The re-render makes the toolbar (including the Clear
  // button just pressed) disappear and switches to the 0-selected empty state, so focus drops to body.
  // Move it to the "Browse champions" CTA shown in the empty state to keep a keyboard/screen-reader anchor.
  const browse = $("gallery-browse");
  if (browse) browse.focus();
}

export function openLine(lid) {
  if (onBeforeNav) onBeforeNav();   // snapshot the outgoing list (scroll + search) before we clear it
  state.view = "line"; state.currentLine = lid;
  // Opening a line detail while searching (within the 90ms debounce) would let the pending debounce
  // flip the view line->lines and bounce back to the list (+ spurious history). Detail views aren't in
  // the search scope, so like other navigation (openLines/goHome etc.) we clear the search to keep the invariant.
  state.searchQuery = ""; $("search").value = "";
  window.scrollTo(0, 0); render();
}
export function openLines() {
  if (onBeforeNav) onBeforeNav();   // snapshot the outgoing list (scroll + search) before we clear it
  state.view = "lines"; state.currentLine = null;
  state.searchQuery = ""; $("search").value = "";
  window.scrollTo(0, 0); render();
}

function buildChampList(c) {
  return c.skins.map(s => toLightboxItem(c, s));
}

export function openChampion(alias) {
  if (onBeforeNav) onBeforeNav();   // snapshot the outgoing list (scroll + search) before we clear it
  state.view = "champion"; state.currentChamp = alias;
  // Like openLine, clear the search to prevent the bounce-back and history pollution when a detail is
  // opened while searching (within the 90ms debounce) (detail views aren't in the search scope).
  state.searchQuery = ""; $("search").value = "";
  window.scrollTo(0, 0); render();
}
// Back: if searching, prefer clearing the search (keep the current view).
// Otherwise lines-family -> lines list, everything else -> home.
export function goBack() {
  if (state.searchQuery) {
    state.searchQuery = ""; $("search").value = "";
    render(); return;
  }
  if (state.view === "line") openLines();
  else { state.view = "home"; state.currentChamp = null; state.currentLine = null; render(); }
}
export function goHome() {
  if (onBeforeNav) onBeforeNav();   // snapshot the outgoing list (scroll + search) before we clear it
  state.view = "home"; state.currentChamp = null; state.currentLine = null;
  state.searchQuery = ""; $("search").value = ""; render();
}

// On image load completion/failure, add img-loaded to the parent card to stop the shimmer (CSS ::before).
// This used to be called from an inline <img onload="imgLoaded(this)"> attribute (which required CSP
// script-src 'unsafe-inline'), but moved to app.js attaching a capture-phase delegated listener on #root
// (load/error don't bubble, so capture is used). This let us drop inline JS and tighten CSP.
export function imgLoaded(img) {
  const card = img.parentElement;
  if (card) card.classList.add("img-loaded");
}
// When a thumbnail 404s at the CDN, fill it faintly so the card doesn't look empty.
// On failure too, add img-loaded since not stopping the shimmer would make it look "stuck loading".
export function imgErr(img) {
  img.style.opacity = "0.15";
  img.removeAttribute("src");
  const card = img.parentElement;
  if (card) card.classList.add("img-loaded");
}
