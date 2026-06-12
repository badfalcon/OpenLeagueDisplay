// アプリ全体で共有する mutable state とインデックス、汎用ユーティリティ。
// 他モジュールは ES Module の live binding でこの state / DATA を読み書きする
// (DATA だけは再代入が必要なので setData setter 経由で書き換える)

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

// 背景スクロールのロック (ライトボックス / チュートリアルのモーダル表示中)。
// overflow:hidden だけだと iOS Safari はタッチスクロールを止めないので、body を
// position:fixed にして現在のスクロール位置を退避する (= 定番の iOS scroll-lock)。
// html/body に overflow-x:clip があり実スクロールコンテナが <html> 側になる構成でも、
// body をフローから外せば <html> はスクロールしなくなる。
// ライトボックスとチュートリアルが入れ子になっても破綻しないようカウンタで多重ロックを束ねる。
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

// モーダル/ライトボックス表示中に Tab で背景 (topbar 等) へフォーカスが抜けるのを防ぐ。
// aria-modal は SR へのヒントでしかなく、キーボードの Tab 順序は制限しないため
// JS で root 内に閉じ込める。戻り値の関数で解除する (開閉のたびに張り直す)。
// state.js は「依存される側専用」なので、ここに置くのは他モジュールを import しない
// 純 DOM ユーティリティに限る (trapFocus はその条件を満たす)。
export function trapFocus(root) {
  const onKey = (e) => {
    if (e.key !== "Tab" || !root) return;
    // フォーカス可能要素は開閉で増減する (ライトボックスの ⚙ メニュー / チュートリアルの
    // Skip ボタン等が状態で出入りする) ので、リストはキャッシュせず毎回その場で計算する。
    const focusable = [...root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    // activeElement が root 外 (= 背景) に居る時は先頭へ寄せてから閉じ込める
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
  // capture で document に張る (背景要素のハンドラより先に Tab を握る)。
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}

export let DATA = null;
export function setData(d) { DATA = d; }

export const state = {
  view: "home",            // home | champion | lines | line | selected
  currentChamp: null,
  currentLine: null,       // skin line id (string)
  searchQuery: "",
  // ホーム画面のチャンピオン並び順。既定は "name_asc" (チャンピオン名の昇順)。
  // "name_desc" は降順。どちらも localized name で localeCompare するので、
  // locale を切替えると比較基準も同じ locale で再計算される。"release" は
  // data.json の順 (= CDragon のリリース順、Annie が先頭) をそのまま使う
  sortOrder: "name_asc",
  // 選択キー (= マイギャラリーの中身): `${alias}//${skinLabel}` (label はスキン側でユニーク)。
  // 選択は常時有効 (モード概念なし): 各カードの ＋ で個別 toggle する
  selected: new Set(),
  // ZIP生成キャンセル用フラグ
  packAbort: false,
  // 表示言語。"default" は data.json の英語名そのまま。それ以外は i18n/<code>.json
  // から読み込んだ翻訳マップで上書き表示する。実データ (alias, label, splash URL,
  // SELECT_KEY, ZIP内パス) は locale 非依存で固定。localStorage で永続化
  locale: "default",
  i18n: { champions: {}, skins: {}, skin_descriptions: {}, champion_descriptions: {}, lines: {} },
  lb: {
    list: [], idx: 0, mode: "manual",
    timer: null, interval: 7000, paused: false, frontIsA: true,
    // スライドショー時のキャプション表示量: "full" (名前+説明) / "name" (名前のみ) /
    // "none" (非表示)。⚙ メニューから循環。ビューアモードでは常に full 扱い (適用しない)
    caption: "full",
    seq: 0, lastFocus: null,
    // 画像の収め方: "contain" (全体表示・上下/左右に黒帯) ↔ "cover" (画面いっぱい・
    // 一部クロップ)。縦長スマホで 16:9 スプラッシュの黒帯が大きいので切替えられる。
    // localStorage で永続化し、ライトボックスを開く度に反映する
    fit: "contain",
  },
  // チュートリアル: 現在のステップ番号 (1-based) と、開く直前にフォーカスしていた
  // 要素 (閉じた時に戻すため)。state.lb と同じ形に揃える
  tut: { step: 1, lastFocus: null },
  // ローカル実行 (local_app.py) の検知結果。null = 通常の Web (Pages) モード。
  // local.js の probeLocal() が { wallpaper, slideshow, platform } をセットする
  local: null,
};

export const SELECT_KEY = (alias, label) => `${alias}//${label}`;

// 選択状態を再訪まで持ち越すための localStorage キー。値は JSON 配列。
// 名前空間プレフィックス "old." は OpenLeagueDisplay の略 (将来別キーを追加する時の衝突回避)
export const LS_SELECTED_KEY = "old.selected";
export const LS_LOCALE_KEY = "old.locale";
export const LS_SORT_KEY = "old.sort";
// 壁紙スライドショーの切替間隔 (ミリ秒) を永続化。ローカル実行モードでのみ使う。
export const LS_WP_INTERVAL_KEY = "old.wpInterval";
// ライトボックスの画像フィット ("contain" / "cover") を永続化。
export const LS_LB_FIT_KEY = "old.lbFit";
// 初回訪問チュートリアルの既読フラグ。値は "1" (見せたら立てる) で、未設定なら未読扱い。
// ヘッダの ? ボタン / ? キーから再表示する場合はこのフラグを変更しない (既読のまま)
export const LS_TUTORIAL_KEY = "old.tutorial.seen";

// QuotaExceeded / プライベートブラウジング / 読み込み専用環境では落ちることがあるので
// 失敗は無視して fallback を返す best-effort 永続化
export function lsGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

// data.json ロード後に1度だけ構築するインデックス。renderLines/renderLine/bulkToggleLine
// が「全 champion × 全 skin」を毎回スキャンしないために用意する。
// SKIN_BY_KEY: SELECT_KEY → { c, s }。state.selected を起点に items 列を作る時に O(1) で参照。
// LINE_INDEX:  skin line id (string) → { count, thumb, members: [{c, s}, ...] }。renderLines のサムネ
//              と件数、renderLine のメンバ列、bulkToggleLine の対象キーすべてここから取る。
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
        // 代表サムネは「最初に見つかったスプラッシュあり」(チャンピオン順固定で決定的)
        if (!bucket.thumb && s.splash) bucket.thumb = s.splash;
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
