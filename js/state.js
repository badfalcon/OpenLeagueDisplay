// アプリ全体で共有する mutable state とインデックス、汎用ユーティリティ。
// 他モジュールは ES Module の live binding でこの state / DATA を読み書きする
// (DATA だけは再代入が必要なので setData setter 経由で書き換える)

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

export let DATA = null;
export function setData(d) { DATA = d; }

export const state = {
  view: "home",            // home | champion | lines | line
  currentChamp: null,
  currentLine: null,       // skin line id (string)
  searchQuery: "",
  // ホーム画面のチャンピオン並び順。"default" は data.json の順 (= CDragon の
  // リリース順、Annie が先頭)。"name_asc"/"name_desc" は localized name で
  // localeCompare。locale を切替えると比較基準も同じ locale で再計算される
  sortOrder: "default",
  selectMode: false,
  // 選択キー: `${alias}//${skinLabel}` (label はスキン側でユニーク)
  selected: new Set(),
  // ZIP生成キャンセル用フラグ
  packAbort: false,
  // 表示言語。"default" は data.json の英語名そのまま。それ以外は i18n/<code>.json
  // から読み込んだ翻訳マップで上書き表示する。実データ (alias, label, splash URL,
  // SELECT_KEY, ZIP内パス) は locale 非依存で固定。localStorage で永続化
  locale: "default",
  i18n: { champions: {}, skins: {}, lines: {} },
  lb: {
    list: [], idx: 0, mode: "manual",
    timer: null, interval: 7000, paused: false, frontIsA: true,
    seq: 0, lastFocus: null,
  },
};

export const SELECT_KEY = (alias, label) => `${alias}//${label}`;

// 選択状態を再訪まで持ち越すための localStorage キー。値は JSON 配列。
// 名前空間プレフィックス "old." は OpenLeagueDisplay の略 (将来別キーを追加する時の衝突回避)
export const LS_SELECTED_KEY = "old.selected";
export const LS_LOCALE_KEY = "old.locale";
export const LS_SORT_KEY = "old.sort";

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
