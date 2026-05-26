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
  champName, skinLabel, lineName, toLightboxItem,
} from "./i18n.js";
import { downloadChampion, downloadLine, downloadSelected } from "./zip.js";
import { openLightbox, startGlobalSlideshow } from "./lightbox.js";

// localeCompare に渡す BCP-47 タグ。"default" は英語、それ以外は CDragon の
// "xx_xx" を "xx-xx" に直す。名前順ソートが現在の locale で自然な並びになる。
const cmpTag = () => state.locale === "default" ? "en" : state.locale.replace("_", "-");

// 「最近追加」セクションに出す日数の窓。各スキンの「新着判定日」(released 優先・
// 無ければ added) を data.json の generated_at_utc から遡って判定する。
// 週次更新なので 30 日 = 直近 ~4 回ぶんの新着が再訪のたびに数回は目に入る。
// 基準を client の wall-clock ではなく generated_at にするのは、判定を data.json の
// 鮮度に紐付けて決定的にするため (端末時計のズレや古いキャッシュに影響されない)。
const RECENT_DAYS = 30;

// generated_at (ISO) から RECENT_DAYS 遡った YYYY-MM-DD を返す。`added` は同形式の
// 文字列なので辞書順比較がそのまま日付比較になる。パース不能なら null (= 窓無効=全件)。
function recentCutoff(genAtIso) {
  const base = genAtIso ? new Date(genAtIso) : new Date();
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
}

// スキンの「新着判定日」: Meraki 由来の実リリース日 (released) を最優先し、無ければ
// generate_data.py の diff ベース初観測日 (added) にフォールバックする。released は
// 本物のリリース日なので過去スキンは自然と窓外になり、Meraki がまだ日付を持たない
// 最新スキンだけ added (≒初観測=新着) が効く、の二段構え。両方無ければ空文字。
const recentDate = (s) => s.released || s.added || "";

// 新着判定日を持ち、かつ generated_at から RECENT_DAYS 以内のスキンを新しい順に集める。
// 旧 data.json (released/added 無し) では空配列を返すので、セクション自体が出ない (完全後方互換)。
function collectRecent() {
  if (!DATA || !Array.isArray(DATA.champions)) return [];
  const cutoff = recentCutoff(DATA.generated_at_utc);
  const out = [];
  for (const c of DATA.champions) {
    for (const s of c.skins) {
      const d = recentDate(s);
      if (!s.splash || !d) continue;
      if (cutoff && d < cutoff) continue;
      out.push({ c, s });
    }
  }
  const cmpLocale = cmpTag();
  out.sort((a, b) =>
    recentDate(b.s).localeCompare(recentDate(a.s))  // 新しい順
    || champName(a.c).localeCompare(champName(b.c), cmpLocale, { sensitivity: "base" }));
  return out;
}

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
  // タブはトップレベル切替。back-btn は詳細 (champion / line / selected) または検索中に表示。
  // "selected" (マイギャラリー) は専用導線で開く中間ビューなのでタブはどちらも非アクティブ
  const isLines = (state.view === "lines" || state.view === "line");
  const isSelected = (state.view === "selected");
  const isDetail = (state.view === "champion" || state.view === "line" || isSelected);
  const hasSearch = !!state.searchQuery;
  const showBack = isDetail || hasSearch;
  $("tab-home").classList.toggle("active", !isLines && !isSelected);
  $("nav-lines").classList.toggle("active", isLines);
  if (state.view === "home") renderHome(root);
  else if (state.view === "champion") renderChampion(root);
  else if (state.view === "lines") renderLines(root);
  else if (state.view === "line") renderLine(root);
  else if (state.view === "selected") renderSelected(root);
  // 表示制御: back は showBack の時だけ、sort は home の時だけ可視
  $("back-btn").style.display = showBack ? "" : "none";
  $("sort-select").style.display = state.view === "home" ? "" : "none";
  refreshGalleryBtn();
}

// ヘッダーの「マイギャラリー」ボタン: ラベルに選択件数を出し、ギャラリービュー中は
// .primary でアクティブ表現にする。選択数が変わる箇所 (toggle/bulk/clear) と
// render() から呼ぶ。locale 切替時は applyStaticUIStrings からも呼ばれる
export function refreshGalleryBtn() {
  const btn = $("gallery-btn");
  if (!btn) return;
  const n = state.selected.size;
  btn.textContent = n > 0 ? `${t("select_mode")} (${n})` : t("select_mode");
  btn.classList.toggle("primary", state.view === "selected");
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
  const sortSign = state.sortOrder === "name_asc" ? 1 : state.sortOrder === "name_desc" ? -1 : 0;
  const cmpLocale = cmpTag();
  const sortChamps = (arr) => sortSign && arr.sort((a, b) =>
    sortSign * champName(a).localeCompare(champName(b), cmpLocale, { sensitivity: "base" }));
  const sortSkins = (arr) => sortSign && arr.sort((a, b) => {
    const an = `${champName(a.c)} ${skinLabel(a.c, a.s)}`;
    const bn = `${champName(b.c)} ${skinLabel(b.c, b.s)}`;
    return sortSign * an.localeCompare(bn, cmpLocale, { sensitivity: "base" });
  });

  // 検索なし: チャンピオン一覧。新着スキンがあれば先頭に「最近追加」セクションを足す
  if (!q) {
    const list = DATA.champions.slice();
    sortChamps(list);
    const recent = collectRecent();
    setPrimaryHeader({ isList: true, title: t("nav_home"), count: t("champs_count", list.length) });
    let html = "";
    if (recent.length) {
      // 新着は flat な skin グリッド、その下の champ-grid は portrait タイルで見た目が
      // 明確に違うので、見出しは「最近追加」だけ付ける (チャンピオン側は sticky ヘッダーが
      // "Champions / N" を担当しており、ここで重ねると同じ見出しが二度出てしまう)
      html += `
        <div class="champ-header is-list">
          <h2>${t("section_recent")}</h2>
          <span class="count">${t("skins_count", recent.length)}</span>
        </div>
        <div class="skin-grid is-flat recent-grid">${renderSkinCards(recent)}</div>`;
    }
    html += `<div class="champ-grid">${renderChampCards(list)}</div>`;
    $("view-content").innerHTML = html;
    wireChampCards(root);
    if (recent.length) wireSkinCards(root.querySelector(".recent-grid"), recent.map(({ c, s }) => toLightboxItem(c, s)));
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
    // 配下スキンの選択件数を集計して partial/selected を分ける。
    // state.selected は per-skin なので、ここは派生情報の計算でしかない (集合の真実は Set 側)
    let cls = "", cbText = "";
    if (c.skins.length > 0) {
      const sel = c.skins.reduce((n, s) => n + (state.selected.has(SELECT_KEY(c.alias, s.label)) ? 1 : 0), 0);
      if (sel === c.skins.length) cls = " selected";
      else if (sel > 0) { cls = " partial"; cbText = `${sel}/${c.skins.length}`; }
    }
    return `
    <div class="champ-card${cls}" data-alias="${esc(c.alias)}">
      <div class="sel-checkbox" title="${esc(t("gallery_add"))}">${esc(cbText)}</div>
      <img loading="lazy" src="${esc(c.portrait)}" alt="${esc(champName(c))}" onload="imgLoaded(this)" onerror="imgErr(this)">
      <div class="label">${esc(champName(c))}</div>
    </div>`;
  }).join("");
}

// スキンタイル 1 枚の HTML。home(検索)/champion/line/selected の各 view が
// 微差 (data-alias の有無・label の champ 名プレフィックス・常時選択) だけで
// 同じカードを描いていたのを 1 箇所に集約する。video ありは ▶ バッジを重ねて
// 「これは動く」とライトボックスを開く前に分かるようにする。
function skinCardHTML({ c, s, idx, label, alias = false, forceSelected = false }) {
  const k = SELECT_KEY(c.alias, s.label);
  const selected = forceSelected || state.selected.has(k);
  const aliasAttr = alias ? ` data-alias="${esc(c.alias)}"` : "";
  const badge = s.video ? `<span class="anim-badge" aria-hidden="true">▶</span>` : "";
  const title = selected ? t("gallery_remove") : t("gallery_add");
  return `
    <div class="skin-card${selected ? " selected" : ""}" data-idx="${idx}" data-key="${esc(k)}"${aliasAttr}>
      <div class="sel-checkbox" title="${esc(title)}"></div>${badge}
      <img loading="lazy" src="${esc(s.splash)}" alt="${esc(skinLabel(c, s))}" onload="imgLoaded(this)" onerror="imgErr(this)">
      <div class="label">${esc(label)}</div>
    </div>`;
}

function renderSkinCards(matches) {
  return matches.map((m, i) =>
    skinCardHTML({ c: m.c, s: m.s, idx: i, label: `${champName(m.c)} — ${skinLabel(m.c, m.s)}`, alias: true })
  ).join("");
}

function wireChampCards(root) {
  root.querySelectorAll(".champ-card").forEach(el => {
    // 本体クリックは詳細画面へ。個別スキンの細かい調整は詳細でやる
    el.addEventListener("click", () => openChampion(el.dataset.alias));
    // ＋ クリックは「このチャンプの全スキンを一括 toggle」のショートカット
    const cb = el.querySelector(".sel-checkbox");
    if (cb) {
      cb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        bulkToggleChamp(el.dataset.alias);
      });
    }
  });
}

// スキンタイル群への配線をまとめる共通ヘルパ。本体クリックでライトボックス
// (lbList の同じ idx を開く)、＋ (.sel-checkbox) で当該スキン 1 枚を toggle する。
// champion/line/selected/検索結果のどの view も同じ配線なので 1 箇所に集約する。
function wireSkinCards(scope, lbList) {
  scope.querySelectorAll(".skin-card").forEach(el => {
    el.addEventListener("click", () => openLightbox(lbList, parseInt(el.dataset.idx, 10), "manual"));
    const cb = el.querySelector(".sel-checkbox");
    if (cb) {
      cb.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleSelected(el.dataset.key, el);
      });
    }
  });
}

// 検索結果のスキンタイル: home view 内の flat グリッドだけを対象に配線する
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
  setPrimaryHeader({
    title: champName(c),
    count: t("skins_count", c.skins.length),
    primaryLabel: t("dl_champion"),
    primaryClick: () => downloadChampion(c),
  });
  $("view-content").innerHTML = `<div class="skin-grid">${cards}</div>`;
  wireSkinCards($("view-content"), buildChampList(c));
}

function renderLines(root) {
  const lines = DATA.skin_lines || {};
  // per-line の選択件数を集計 (state.selected は変化するので毎回計算)。
  // count/thumb は LINE_INDEX から取るので 1 回構築済み。
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
    if (e.count > 0) {
      const sel = selectedCounts[e.id] || 0;
      if (sel === e.count) cls = " selected";
      else if (sel > 0) { cls = " partial"; cbText = `${sel}/${e.count}`; }
    }
    return `
    <div class="line-card${cls}" data-line="${esc(e.id)}">
      <div class="sel-checkbox" title="${esc(t("gallery_add"))}">${esc(cbText)}</div>
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
  const cards = items.map((it, i) =>
    skinCardHTML({ c: it.champ, s: it.skin, idx: i, label: `${champName(it.champ)} — ${skinLabel(it.champ, it.skin)}` })
  ).join("");
  setPrimaryHeader({
    title: lname,
    count: t("skins_count", items.length),
    primaryLabel: t("dl_line"),
    primaryClick: () => downloadLine(lid, lname, items),
  });
  $("view-content").innerHTML = `<div class="skin-grid">${cards}</div>`;
  wireSkinCards($("view-content"), items.map(it => toLightboxItem(it.champ, it.skin)));
}

// マイギャラリー (選択中スキン一覧) ビュー。ヘッダーの「マイギャラリー」ボタンから開く。
// state.selected (Set<SELECT_KEY>) を SKIN_BY_KEY で実体化し、localized 名前で
// 安定ソートしてから skin-grid で並べる (Set のイテレーション順 = 追加順だと、
// 再訪時の表示が直感的に並ばない)。
// グリッド上部に DL / スライドショー / クリアのツールバーを置く (旧 pack-bar の役割)。
// カードの ＋ クリックで toggleSelected しても即削除はせず、その場で淡色化するだけ
// (やり直し可能にするため)。実際にグリッドから外れるのは次にギャラリーを開き直した時。
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
    $("view-content").innerHTML =
      `<div class="loading"><p>${t("gallery_empty")}</p><p class="gallery-hint">${t("gallery_empty_hint")}</p></div>`;
    return;
  }

  const cards = items.map((it, i) =>
    skinCardHTML({ c: it.champ, s: it.skin, idx: i, label: `${champName(it.champ)} — ${skinLabel(it.champ, it.skin)}`, forceSelected: true })
  ).join("");
  $("view-content").innerHTML = `
    <div class="gallery-toolbar">
      <button class="btn primary" id="gallery-dl">${t("dl_selected")}</button>
      <button class="btn" id="gallery-ss">${t("nav_slideshow")}</button>
      <button class="btn" id="gallery-clear">${t("clear")}</button>
    </div>
    <div class="skin-grid gallery-grid">${cards}</div>`;
  $("gallery-dl").addEventListener("click", downloadSelected);
  $("gallery-ss").addEventListener("click", startGlobalSlideshow);
  $("gallery-clear").addEventListener("click", clearSelected);
  wireSkinCards($("view-content"), items.map(it => toLightboxItem(it.champ, it.skin)));
}

export function openSelected() {
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
  // ギャラリービューでも即 re-render しない。以前は解除した瞬間に grid から消えて
  // やり直せなかったので、カードはその場に残し (.selected が外れて淡色化)、もう一度
  // 押せば戻せるようにする。実際にグリッドから消えるのは次にギャラリーを開き直した時。
  // どのビューでもカードの class 更新で済ませ、件数表示 (ヘッダー / ボタン) だけ即時更新。
  if (el) {
    const cb = el.querySelector(".sel-checkbox");
    if (cb) cb.title = nowSelected ? t("gallery_remove") : t("gallery_add");
  }
  refreshGalleryBtn();
  if (state.view === "selected") {
    const cnt = $("primary-count");
    if (cnt) cnt.textContent = state.selected.size ? t("skins_count", state.selected.size) : "";
  }
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
  return c.skins.map(s => toLightboxItem(c, s));
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
