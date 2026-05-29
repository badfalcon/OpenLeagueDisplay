// ローカル実行モード (local_app.py 経由) の検知と、壁紙設定 / スライドショー API
// クライアント。GitHub Pages では /api/ping が無いので probeLocal() は false に倒れ、
// この module の公開関数を使う UI 自体が出ない (= 静的サイトとして従来通り動く)。
//
// 依存は state.js だけ (i18n.js は import しない)。toast() は呼び出し側で翻訳済みの
// 文字列を受け取る設計にして、render.js → local.js → i18n.js → render.js という
// 循環 import を作らないようにしている (i18n.js は既に render.js を import している)。

import { state, $ } from "./state.js";

// 壁紙スライドショーの既定間隔。ライトボックスの 7s (state.lb.interval) は流用しない
// — デスクトップ壁紙を数秒ごとに切り替えるのは過剰なので、別物として 5 分を既定にする。
export const WALLPAPER_SS_INTERVAL = 5 * 60 * 1000;

// 走行中フラグ。ギャラリーのツールバーは毎 render で作り直され DOM に状態が残らないので、
// 再描画時のボタン文言 (開始/停止) はこのフラグを見て決める。
let _ssRunning = false;

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
        slideshow: f.includes("slideshow"),
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

export function isLocalSlideshow() {
  return !!(state.local && state.local.slideshow);
}

export function isWallpaperSlideshowRunning() {
  return _ssRunning;
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

export async function setWallpaper(url, name) {
  // 単発設定はサーバ側で走行中スライドショーを止める。成功した時だけフラグも倒す
  // (失敗時はサーバに届かず回転が続いている可能性があるので状態を変えない)。
  const data = await postJSON("./api/wallpaper", { url, name: name || "" });
  _ssRunning = false;
  return data;
}

export async function startWallpaperSlideshow(urls, interval) {
  const data = await postJSON("./api/slideshow", {
    urls,
    interval: interval || WALLPAPER_SS_INTERVAL,
  });
  _ssRunning = true;
  return data;
}

export async function stopWallpaperSlideshow() {
  // 成功した時だけ停止済みにする (失敗時はサーバで回転が続いている可能性があり、
  // ボタンを「停止」のままにして再試行できるようにする)。setWallpaper / start と同じ方針。
  await postJSON("./api/slideshow/stop", {});
  _ssRunning = false;
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

  const sr = $("sr-status");
  if (sr) sr.textContent = msg;
}
