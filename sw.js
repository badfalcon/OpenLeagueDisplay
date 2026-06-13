// Service Worker: アプリシェル (HTML/CSS/JS/アイコン) をキャッシュして再訪を高速化し、
// インストール可能要件を満たすための最小構成。
//
// 方針: 同一オリジンの GET は一律 network-first。
// - オンライン時は常にネットワークから最新を取り、キャッシュは「オフライン時の
//   フォールバック」として持つ。シェル (JS/CSS) も同じ扱いにすることで、ソース編集や
//   言語切替が「リロードするまで反映されない」(stale-while-revalidate の罠) を解消する。
//   静的ファイルは GitHub Pages が ETag を返すので、毎ロードの再取得は実体ほぼ 304 で安い。
// - data.json / i18n/*.json も同じ network-first (週次更新データの鮮度も自然に担保)。
// - 画像 (raw.communitydragon.org) や CDN (fonts / jsdelivr): 一切インターセプトしない。
//   スプラッシュ全体で ~600MB あり、キャッシュに載せる方針ではない。
// - オフライン動作 (PWA) はキャッシュフォールバックで維持。インストール時に
//   SHELL をプリキャッシュしておく。シェル更新時は CACHE_VERSION を上げること。

const CACHE_VERSION = "v7";
const CACHE_NAME = "old-shell-" + CACHE_VERSION;

// プリキャッシュ対象。sw.js と同階層基準の相対パス (GitHub Pages のサブパス配信に対応)
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icon-maskable.svg",
  "./js/app.js",
  "./js/state.js",
  "./js/i18n.js",
  "./js/render.js",
  "./js/zip.js",
  "./js/lightbox.js",
  "./js/tutorial.js",
  "./js/share.js",
  "./js/local.js",
  "./js/wallpaper.js",
];

self.addEventListener("install", (e) => {
  // 新しい SW を即座に待機解除して有効化する
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(SHELL))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("old-shell-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先: 取れたらキャッシュも更新、失敗時 (オフライン) はキャッシュへ
// フォールバック。ナビゲーション要求が未キャッシュなら index.html を返す
// (SPA の deep link / 未知パスでもオフラインでアプリシェルを出す)。
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 同一オリジンのみ扱う。CDragon 画像 / フォント / jsdelivr は素通し
  if (url.origin !== self.location.origin) return;

  // ローカル実行モードの API (/api/ping 等) はキャッシュせず素通しする。
  // GET /api/ping をキャッシュに乗せると古い検知結果を返してしまうため除外する。
  if (url.pathname.split("/").includes("api")) return;

  // 同一オリジンの GET は一律 network-first (シェルもデータも)。オンラインなら常に
  // 最新を配り、キャッシュはオフライン時のフォールバックに徹する。
  e.respondWith(networkFirst(req));
});
