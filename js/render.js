// view レンダラ。state.view (home/champion/lines/line) と検索/選択状態から DOM を組み立てる。
// 永続レイアウト (champ-header + view-content) は ensureLayout で 1 回だけ作り、
// 以降は setPrimaryHeader / view-content.innerHTML 差し替えで更新する。

import {
  state, DATA, $, esc,
  SELECT_KEY, SKIN_BY_KEY, LINE_INDEX,
  saveSelected,
} from "./state.js";
import {
  t, UI_STRINGS, ROLE_LABELS, RARITY_LABELS, REGION_LABELS,
  champName, skinLabel, skinDescription, lineName,
} from "./i18n.js";
import { downloadChampion, downloadLine, downloadSelected } from "./zip.js";
import { openLightbox } from "./lightbox.js";

// stats_format テンプレ ("{0} CHAMPIONS · {1} SKINS" 等) の {n} 部分だけ
// <span> 化して保持する。初回呼び出しでは 0 から目標値へカウントアップさせ、
// 以降の呼び出し (locale 切替時など) は即時表示にしてチラつかせない
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

// view-content の上に居る永続的な champ-header。h2 / count / primary は
// renderXxx 側から setPrimaryHeader() で書き換える。.champ-header-controls
// (back-btn / search / sort-select) は一度ここに住んだら二度と動かさない。
// これで search input の親が render() ごとに壊されることが無くなり、入力中の
// フォーカスやカーソル位置・IME composition が保たれる
export function ensureLayout(root) {
  if ($("view-content")) return;
  root.innerHTML = `
    <div class="champ-header" id="primary-header" hidden>
      <h2 id="primary-title"></h2>
      <div class="champ-header-controls"></div>
      <span class="count" id="primary-count"></span>
      <button class="btn primary" id="primary-action" hidden></button>
    </div>
    <div id="view-content"></div>`;
  const slot = root.querySelector(".champ-header-controls");
  slot.appendChild($("back-btn"));
  slot.appendChild($("search"));
  slot.appendChild($("sort-select"));
}

// 永続 champ-header の中身を更新する唯一の窓口。renderXxx は innerHTML を
// 触らず、ここに値を渡すだけにする
function setPrimaryHeader({ isList = false, title = "", count = "", primaryLabel = "", primaryClick = null }) {
  const ph = $("primary-header");
  ph.hidden = false;
  ph.classList.toggle("is-list", !!isList);
  $("primary-title").textContent = title;
  $("primary-count").textContent = count;
  const btn = $("primary-action");
  if (primaryLabel) {
    btn.hidden = false;
    btn.textContent = primaryLabel;
    // onclick への代入で前回の handler は自動破棄される (addEventListener と違って重複しない)
    btn.onclick = primaryClick;
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }
}

export function render() {
  const root = $("root");
  ensureLayout(root);
  // タブはトップレベル切替。back-btn は詳細 (champion / line) または検索中に表示
  const isLines = (state.view === "lines" || state.view === "line");
  const isDetail = (state.view === "champion" || state.view === "line");
  const hasSearch = !!state.searchQuery;
  const showBack = isDetail || hasSearch;
  $("tab-home").classList.toggle("active", !isLines);
  $("nav-lines").classList.toggle("active", isLines);
  if (state.view === "home") renderHome(root);
  else if (state.view === "champion") renderChampion(root);
  else if (state.view === "lines") renderLines(root);
  else if (state.view === "line") renderLine(root);
  // 表示制御: back は showBack の時だけ、sort は home の時だけ可視
  $("back-btn").style.display = showBack ? "" : "none";
  $("sort-select").style.display = state.view === "home" ? "" : "none";
  renderPackBar();
}

function renderHome(root) {
  const q = state.searchQuery.toLowerCase();
  // 検索キーワードは複数軸を OR で AND しない、つまり「どの軸でもヒットすれば残す」。
  // 軸 (チャンピオン側): チャンピオン名 (alias/英語名/翻訳名)、ロール (Mage 等)、
  // 地域 (Demacia 等)。軸 (スキン側): スキン名 (英語/翻訳)、rarity (Legendary 等)。
  // role/region/rarity の翻訳は英語キーと並べてチェックするので、ユーザがどちらの
  // 言語で打っても拾える。検索中は「該当チャンピオン」「該当スキン」を別セクション
  // にして縦に並べる: 例えば "garen" で打てば Garen 本人と他チャンプの Garen 風
  // スキン (もしあれば) を区別できる
  const localeRoles = ROLE_LABELS[state.locale] || {};
  const localeRarities = RARITY_LABELS[state.locale] || {};
  const localeRegions = REGION_LABELS[state.locale] || {};
  const hit = (s) => typeof s === "string" && s.toLowerCase().includes(q);

  // 並び替え: "default" は data.json の順 (リリース順) をそのまま使うので何もしない。
  // 名前順は localized name で localeCompare。比較に Intl 経路を使うため、
  // 日本語/韓国語/中文 でもクライアントの自然な並びになる
  const cmpLocale = state.locale === "default" ? "en" : state.locale.replace("_", "-");
  const sortSign = state.sortOrder === "name_asc" ? 1 : state.sortOrder === "name_desc" ? -1 : 0;
  const sortChamps = (arr) => sortSign && arr.sort((a, b) =>
    sortSign * champName(a).localeCompare(champName(b), cmpLocale, { sensitivity: "base" }));
  const sortSkins = (arr) => sortSign && arr.sort((a, b) => {
    const an = `${champName(a.c)} ${skinLabel(a.c, a.s)}`;
    const bn = `${champName(b.c)} ${skinLabel(b.c, b.s)}`;
    return sortSign * an.localeCompare(bn, cmpLocale, { sensitivity: "base" });
  });

  // 検索なし: 従来通りチャンピオン一覧だけ
  if (!q) {
    const list = DATA.champions.slice();
    sortChamps(list);
    setPrimaryHeader({ isList: true, title: t("nav_home"), count: t("champs_count", list.length) });
    $("view-content").innerHTML = `<div class="champ-grid">${renderChampCards(list)}</div>`;
    wireChampCards(root);
    return;
  }

  // 検索あり: チャンピオン側ヒットとスキン側ヒットを別々に集める
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
      const labelHit = hit(s.label) || hit(skinLabel(c, s));
      const rarityHit = s.rarity && (hit(s.rarity) || hit(localeRarities[s.rarity]) || hit(RARITY_LABELS.default[s.rarity]));
      if (labelHit || rarityHit) skinMatches.push({ c, s });
    }
  }
  sortChamps(champMatches);
  sortSkins(skinMatches);

  if (champMatches.length === 0 && skinMatches.length === 0) {
    setPrimaryHeader({ isList: true, title: t("no_results_title"), count: state.searchQuery });
    $("view-content").innerHTML = `<div class="loading"><p>${t("no_results_msg", esc(state.searchQuery))}</p></div>`;
    return;
  }

  // primary header はトップセクションを担当 (champions が居れば Champions、
  // skins だけなら Skins)。両方ある場合の二段目見出しは view-content 内に
  // 通常の champ-header として innerHTML で書き出す (controls スロット無し)
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
  $("view-content").innerHTML = parts.join("");
  wireChampCards(root);
  wireSearchSkinCards(root, skinMatches);
}

function renderChampCards(list) {
  return list.map(c => {
    // 選択モード中のみ、配下スキンの選択件数を集計して partial/selected を分ける。
    // state.selected は per-skin なので、ここは派生情報の計算でしかない (集合の真実は Set 側)
    let cls = "", cbText = "";
    if (state.selectMode && c.skins.length > 0) {
      const sel = c.skins.reduce((n, s) => n + (state.selected.has(SELECT_KEY(c.alias, s.label)) ? 1 : 0), 0);
      if (sel === c.skins.length) cls = " selected";
      else if (sel > 0) { cls = " partial"; cbText = `${sel}/${c.skins.length}`; }
    }
    return `
    <div class="champ-card${cls}" data-alias="${esc(c.alias)}">
      <div class="sel-checkbox">${esc(cbText)}</div>
      <img loading="lazy" src="${esc(c.portrait)}" alt="${esc(champName(c))}" onload="imgLoaded(this)" onerror="imgErr(this)">
      <div class="label">${esc(champName(c))}</div>
    </div>`;
  }).join("");
}

function renderSkinCards(matches) {
  return matches.map((m, i) => {
    const { c, s } = m;
    const k = SELECT_KEY(c.alias, s.label);
    const sel = state.selected.has(k) ? " selected" : "";
    const cn = champName(c);
    const sl = skinLabel(c, s);
    return `
    <div class="skin-card${sel}" data-idx="${i}" data-key="${esc(k)}" data-alias="${esc(c.alias)}">
      <div class="sel-checkbox"></div>
      <img loading="lazy" src="${esc(s.splash)}" alt="${esc(sl)}" onload="imgLoaded(this)" onerror="imgErr(this)">
      <div class="label">${esc(cn)} — ${esc(sl)}</div>
    </div>`;
  }).join("");
}

function wireChampCards(root) {
  root.querySelectorAll(".champ-card").forEach(el => {
    // 本体クリックは選択モードでも詳細画面へ。個別スキンの細かい調整は詳細でやる
    el.addEventListener("click", () => openChampion(el.dataset.alias));
    // □ クリックは「このチャンプの全スキンを一括 toggle」のショートカット
    const cb = el.querySelector(".sel-checkbox");
    if (cb) {
      cb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!state.selectMode) return;
        bulkToggleChamp(el.dataset.alias);
      });
    }
  });
}

// 検索結果のスキンタイル: クリックでライトボックスを開く (lines view と同じ流儀)。
// 選択モード時は当該スキンだけを toggle (チャンピオン一括ではなく per-skin)
function wireSearchSkinCards(root, matches) {
  const lbList = matches.map(({ c, s }) => ({ champ: champName(c), skin: skinLabel(c, s), src: s.splash, desc: skinDescription(c, s) }));
  root.querySelectorAll(".skin-grid.is-flat .skin-card").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx, 10);
      if (state.selectMode) { toggleSelected(el.dataset.key, el); return; }
      openLightbox(lbList, idx, "manual");
    });
  });
}

function renderChampion(root) {
  const c = DATA.champions.find(x => x.alias === state.currentChamp);
  if (!c) { state.view = "home"; render(); return; }
  const cards = c.skins.map((s, i) => {
    const k = SELECT_KEY(c.alias, s.label);
    const sel = state.selected.has(k) ? " selected" : "";
    const lab = skinLabel(c, s);
    return `
    <div class="skin-card${sel}" data-idx="${i}" data-key="${esc(k)}">
      <div class="sel-checkbox"></div>
      <img loading="lazy" src="${esc(s.splash)}" alt="${esc(lab)}" onload="imgLoaded(this)" onerror="imgErr(this)">
      <div class="label">${esc(lab)}</div>
    </div>`;
  }).join("");
  setPrimaryHeader({
    title: champName(c),
    count: t("skins_count", c.skins.length),
    primaryLabel: t("dl_champion"),
    primaryClick: () => downloadChampion(c),
  });
  $("view-content").innerHTML = `<div class="skin-grid">${cards}</div>`;
  $("view-content").querySelectorAll(".skin-card").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx, 10);
      if (state.selectMode) { toggleSelected(el.dataset.key, el); return; }
      openLightbox(buildChampList(c), idx, "manual");
    });
  });
}

function renderLines(root) {
  const lines = DATA.skin_lines || {};
  // 選択モード時は per-line の選択件数を集計 (state.selected は変化するので毎回計算)。
  // count/thumb は LINE_INDEX から取るので 1 回構築済み。
  const selectedCounts = {};
  if (state.selectMode && state.selected.size > 0) {
    for (const k of state.selected) {
      const hit = SKIN_BY_KEY.get(k);
      if (!hit) continue;
      for (const lid of (hit.s.lines || [])) {
        const id = String(lid);
        selectedCounts[id] = (selectedCounts[id] || 0) + 1;
      }
    }
  }
  const q = state.searchQuery.toLowerCase();
  // 表示は翻訳名、検索は (翻訳名 + 英語名) でマッチさせる
  const entries = Object.entries(lines)
    .map(([id, name]) => {
      const idx = LINE_INDEX.get(id);
      return { id, name: lineName(id), _en: name, count: idx ? idx.count : 0, thumb: idx ? idx.thumb : "" };
    })
    .filter(e => e.count > 0)
    .filter(e => !q || e.name.toLowerCase().includes(q) || e._en.toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (entries.length === 0) {
    setPrimaryHeader({ isList: true, title: t("no_results_title"), count: "" });
    $("view-content").innerHTML = `<div class="loading"><p>${t("no_lines_msg")}</p></div>`;
    return;
  }
  const cards = entries.map(e => {
    let cls = "", cbText = "";
    if (state.selectMode && e.count > 0) {
      const sel = selectedCounts[e.id] || 0;
      if (sel === e.count) cls = " selected";
      else if (sel > 0) { cls = " partial"; cbText = `${sel}/${e.count}`; }
    }
    return `
    <div class="line-card${cls}" data-line="${esc(e.id)}">
      <div class="sel-checkbox">${esc(cbText)}</div>
      <img loading="lazy" src="${esc(e.thumb)}" alt="${esc(e.name)}" onload="imgLoaded(this)" onerror="imgErr(this)">
      <div class="meta">
        <div class="name">${esc(e.name)}</div>
        <div class="count">${t("skins_count", e.count)}</div>
      </div>
    </div>`;
  }).join("");
  setPrimaryHeader({ isList: true, title: t("skin_lines_header"), count: t("lines_count", entries.length) });
  $("view-content").innerHTML = `<div class="line-grid">${cards}</div>`;
  $("view-content").querySelectorAll(".line-card").forEach(el => {
    el.addEventListener("click", () => openLine(el.dataset.line));
    const cb = el.querySelector(".sel-checkbox");
    if (cb) {
      cb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!state.selectMode) return;
        bulkToggleLine(el.dataset.line);
      });
    }
  });
}

function renderLine(root) {
  const lid = state.currentLine;
  const lname = lineName(lid);
  const idx = LINE_INDEX.get(String(lid));
  const items = idx ? idx.members.map(m => ({ champ: m.c, skin: m.s })) : [];
  if (items.length === 0) { state.view = "lines"; render(); return; }
  const cards = items.map((it, i) => {
    const k = SELECT_KEY(it.champ.alias, it.skin.label);
    const sel = state.selected.has(k) ? " selected" : "";
    const cn = champName(it.champ);
    const sl = skinLabel(it.champ, it.skin);
    return `
    <div class="skin-card${sel}" data-idx="${i}" data-key="${esc(k)}">
      <div class="sel-checkbox"></div>
      <img loading="lazy" src="${esc(it.skin.splash)}" alt="${esc(sl)}" onload="imgLoaded(this)" onerror="imgErr(this)">
      <div class="label">${esc(cn)} — ${esc(sl)}</div>
    </div>`;
  }).join("");
  setPrimaryHeader({
    title: lname,
    count: t("skins_count", items.length),
    primaryLabel: t("dl_line"),
    primaryClick: () => downloadLine(lid, lname, items),
  });
  $("view-content").innerHTML = `<div class="skin-grid">${cards}</div>`;
  const lbList = items.map(it => ({ champ: champName(it.champ), skin: skinLabel(it.champ, it.skin), src: it.skin.splash, desc: skinDescription(it.champ, it.skin) }));
  $("view-content").querySelectorAll(".skin-card").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.idx, 10);
      if (state.selectMode) { toggleSelected(el.dataset.key, el); return; }
      openLightbox(lbList, idx, "manual");
    });
  });
}

// 選択モード中、ヘッダー直下に「現在 N 件選択中 / DL / クリア」バーを出す
function renderPackBar() {
  const root = $("root");
  let bar = $("pack-bar");
  if (!state.selectMode || state.selected.size === 0) {
    if (bar) bar.remove();
    return;
  }
  const html = `
    <div class="pack-bar" id="pack-bar">
      <span class="count">${t("selected_count", state.selected.size)}</span>
      <button class="btn" id="pack-clear">${t("clear")}</button>
      <button class="btn primary" id="pack-dl">${t("dl_selected")}</button>
    </div>`;
  if (bar) {
    bar.outerHTML = html;
  } else {
    root.insertAdjacentHTML("afterbegin", html);
  }
  $("pack-clear").addEventListener("click", clearSelected);
  $("pack-dl").addEventListener("click", downloadSelected);
}

export function toggleSelected(key, el) {
  if (state.selected.has(key)) {
    state.selected.delete(key);
    if (el) el.classList.remove("selected");
  } else {
    state.selected.add(key);
    if (el) el.classList.add("selected");
  }
  saveSelected();
  renderPackBar();
}
// チャンプ/ライン単位の一括 toggle。state.selected は per-skin の Set なので、
// 「配下スキンの SELECT_KEY を一括 add/remove するだけ」。
// 「全部選択済み → 全解除」「それ以外 → 全選択」の indeterminate トグル。
// 部分選択 (3/14 等) の状態を保持したいときは、ユーザーは詳細画面に入って個別調整する
function bulkToggleKeys(keys) {
  if (!keys.length) return;
  const allSel = keys.every(k => state.selected.has(k));
  for (const k of keys) {
    if (allSel) state.selected.delete(k);
    else state.selected.add(k);
  }
  saveSelected();
  render();
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
}

export function openLine(lid) {
  state.view = "line"; state.currentLine = lid;
  window.scrollTo(0, 0); render();
}
export function openLines() {
  state.view = "lines"; state.currentLine = null;
  state.searchQuery = ""; $("search").value = "";
  window.scrollTo(0, 0); render();
}

function buildChampList(c) {
  return c.skins.map(s => ({ champ: champName(c), skin: skinLabel(c, s), src: s.splash, desc: skinDescription(c, s) }));
}

export function openChampion(alias) {
  state.view = "champion"; state.currentChamp = alias;
  window.scrollTo(0, 0); render();
}
// 戻る: 検索中なら検索クリアを優先 (現在の view は維持)。
// それ以外は lines系→lines 一覧、その他→home。
export function goBack() {
  if (state.searchQuery) {
    state.searchQuery = ""; $("search").value = "";
    render(); return;
  }
  if (state.view === "line") openLines();
  else { state.view = "home"; state.currentChamp = null; state.currentLine = null; render(); }
}
export function goHome() {
  state.view = "home"; state.currentChamp = null; state.currentLine = null;
  state.searchQuery = ""; $("search").value = ""; render();
}

// 画像のロード完了/失敗で親カードに img-loaded を付け、シマー (CSS の ::before) を止める。
// <img onload="imgLoaded(this)"> でインライン参照されるため、app.js が window.imgLoaded =
// imgLoaded で globalにも露出する (ES Modules スコープからは見えないため)。
export function imgLoaded(img) {
  img.onload = null;
  const card = img.parentElement;
  if (card) card.classList.add("img-loaded");
}
// サムネ画像が CDN で 404 になった時、空のカードに見えないよう薄く塗りつぶす。
// 失敗時もシマーを止めないと「ずっと読込中」に見えてしまうため img-loaded を付ける
export function imgErr(img) {
  img.onerror = null;
  img.style.opacity = "0.15";
  img.removeAttribute("src");
  const card = img.parentElement;
  if (card) card.classList.add("img-loaded");
}
