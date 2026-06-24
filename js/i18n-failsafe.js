// i18n-loading failsafe (formerly an inline <script> in index.html).
// Even if ES Modules (app.js) for some reason never reach applyStaticUIStrings, this removes
// <html class="i18n-loading"> after 3 seconds, guaranteeing the hidden tabs/buttons/loading text
// become visible. Runs early in head as a classic script independent of app.js (so it still works
// if the module throws or is delayed). Kept as a separate file rather than inlined so the CSP can
// drop script-src 'unsafe-inline' (loaded same-origin via 'self').
setTimeout(function () {
  document.documentElement.classList.remove("i18n-loading");
}, 3000);
