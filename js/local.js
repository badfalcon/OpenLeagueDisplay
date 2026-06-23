// ローカル実行モード (local_app.py 経由) の検知と、壁紙の一括設定 API クライアント。
// GitHub Pages では /api/ping が無いので probeLocal() は false に倒れ、この module の
// 公開関数を使う UI 自体が出ない (= 静的サイトとして従来通り動く)。
//
// 依存は state.js だけ (i18n.js は import しない)。toast() は呼び出し側で翻訳済みの
// 文字列を受け取る設計にして、render.js → local.js → i18n.js → render.js という
// 循環 import を作らないようにしている (i18n.js は既に render.js を import している)。

import { state, $ } from "./state.js";

// 壁紙スライドショーの既定間隔 (ms)。確認モーダルの間隔ピッカー初期値。サーバは
// 2枚以上選択時に OS 純正スライドショーへこの間隔を渡す。
export const WALLPAPER_INTERVAL_DEFAULT = 5 * 60 * 1000;

const CSRF_HEADERS = { "Content-Type": "application/json", "X-OLD-Local": "1" };

// ローカル実行かを検知して state.local をセットする。失敗 (Pages / バックエンド無し)
// は静かに無視。社内プロキシ等でハングしても初回 render を待たせないよう短くタイムアウト。
export async function probeLocal() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch("./api/ping", { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return false;
    const info = await res.json();
    if (info && info.local) {
      const f = info.features || [];
      state.local = {
        wallpaper: f.includes("wallpaper"),
        platform: info.platform || "",
      };
      return true;
    }
  } catch (_) {
    /* Pages or no backend: stay in static mode */
  } finally {
    clearTimeout(timer);  // 成功・失敗・abort いずれでもタイマーを残さない
  }
  return false;
}

// state.local が立っていればローカルアプリ (機能フラグとは独立)。ZIP の出し分けは
// 「壁紙機能の有無」ではなく「そもそもローカルアプリか」で決めたいのでこれを使う。
export function isLocal() {
  return !!state.local;
}

export function isLocalWallpaper() {
  return !!(state.local && state.local.wallpaper);
}

async function postJSON(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: CSRF_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// 選択スプラッシュの URL 群を壁紙に一括適用する。サーバ側が枚数で振り分ける:
// 1枚 → 静止壁紙 (スライドショー解除も兼ねる)、2枚以上 → OS 純正スライドショー。
// interval は ms (2枚以上のときだけ意味を持つ)。返り値 data.mode = "static" | "slideshow"。
export async function applyWallpaper(urls, interval) {
  return postJSON("./api/wallpaper", {
    urls,
    interval: interval || WALLPAPER_INTERVAL_DEFAULT,
  });
}

// 適用中の進捗 (done/total) を取得する。applyWallpaper の POST が DL 完了までブロックする間、
// 確認モーダルが別途これをポーリングしてゲージを出す。取得失敗時は null (ポーリング側で無視)。
export async function fetchWallpaperProgress() {
  try {
    const res = await fetch("./api/wallpaper/progress", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// 依存ゼロの簡易トースト。視覚表示は #toast、スクリーンリーダー通知は既存の
// #sr-status (aria-live) を流用する (share.js のコピー完了通知と同じ手法)。
export function toast(msg, kind = "ok") {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);

  // aria-live は同じ文字列を入れ直しても再アナウンスされないので、一度空にしてから
  // 次フレームで入れ直す (share.js のコピー完了通知と同じ手法)。同じ toast (例:
  // 「スライドショーが空」) を連続で出しても確実に読み上げさせる。
  const sr = $("sr-status");
  if (sr) {
    sr.textContent = "";
    requestAnimationFrame(() => { sr.textContent = msg; });
  }
}
