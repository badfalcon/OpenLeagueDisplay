// Service Worker: アプリシェル (HTML/CSS/JS/アイコン) をキャッシュして再訪を高速化し、
// インストール可能要件を満たすための最小構成。
//
// 方針:
// - シェル: stale-while-revalidate。キャッシュを即返しつつ裏で更新を取りに行く。
//   JS/CSS の変更は「次回訪問」で反映される (SWR の標準的な挙動)。
// - data.json / i18n/*.json: network-first。週次ワークフローで更新されるデータなので
//   オンライン時は常に最新を取り、オフライン時のみキャッシュへフォールバック。
// - 画像 (raw.communitydragon.org) や CDN (fonts / jsdelivr): 一切インターセプトしない。
//   スプラッシュ全体で ~600MB あり、キャッシュに載せる方針ではない。
// - シェル更新時は CACHE_VERSION を上げること (activate で古いキャッシュを掃除する)。

const CACHE_VERSION = "v9";
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

// ネットワーク優先: 取れたらキャッシュも更新、失敗時はキャッシュへフォールバック
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

// stale-while-revalidate: キャッシュを即返し、裏で取り直して次回に備える
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  const fetching = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  const res = await fetching;
  if (res) return res;
  // ナビゲーション要求がオフラインで未キャッシュなら index.html を出す
  if (req.mode === "navigate") {
    const shell = await cache.match("./index.html");
    if (shell) return shell;
  }
  return Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 同一オリジンのみ扱う。CDragon 画像 / フォント / jsdelivr は素通し
  if (url.origin !== self.location.origin) return;

  // ローカル実行モードの API (/api/ping 等) はキャッシュせず素通しする。
  // GET /api/ping を SWR に乗せると古い検知結果を返してしまうため除外する。
  if (url.pathname.split("/").includes("api")) return;

  // data.json と i18n/*.json は週次更新データなので network-first
  if (url.pathname.endsWith("/data.json") || url.pathname.includes("/i18n/")) {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req));
});
