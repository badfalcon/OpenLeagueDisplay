// i18n-loading フェイルセーフ (旧来は index.html のインライン <script>)。
// ES Modules (app.js) が何らかの理由で applyStaticUIStrings まで到達できなくても、
// 3 秒で <html class="i18n-loading"> を外して、隠していたタブ/ボタン/ローディング
// 文言を必ず見せる保険。app.js とは独立した classic script として head で早期に走らせる
// (module が throw / 遅延しても効くように)。インライン化しないのは CSP の
// script-src 'unsafe-inline' を外すため (同一オリジン 'self' で読む)。
setTimeout(function () {
  document.documentElement.classList.remove("i18n-loading");
}, 3000);
