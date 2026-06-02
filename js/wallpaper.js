// 壁紙の確認モーダル (ローカル実行モード専用)。
// My Gallery で複数選択 → 「壁紙にする」→ このモーダルで内容を確認 → 一括設定。
// 1枚なら静止壁紙、2枚以上なら OS 純正スライドショー (実体はサーバ local_app.py)。
//
// モーダルの DOM は初回に遅延生成する (index.html を汚さない。toast と同じ手法)。
// 配線も初回だけ行い、開くたびに対象 (_items) と表示だけ差し替える。

import { state, $, esc, lockScroll, unlockScroll, LS_WP_INTERVAL_KEY, lsGet, lsSet } from "./state.js";
import { t, champName, skinLabel } from "./i18n.js";
import { applyWallpaper, fetchWallpaperProgress, toast, WALLPAPER_INTERVAL_DEFAULT } from "./local.js";

// 切り替え間隔の選択肢 (分)。value はミリ秒。2枚以上のときだけ表示する。
const WP_INTERVALS = [1, 5, 15, 30, 60];

let _items = [];   // 現在モーダルが対象にしている選択アイテム
let _wired = false;

function intervalOptionsHTML() {
  const saved = parseInt(lsGet(LS_WP_INTERVAL_KEY, ""), 10);
  const sel = WP_INTERVALS.includes(saved / 60000) ? saved : WALLPAPER_INTERVAL_DEFAULT;
  return WP_INTERVALS.map((m) => {
    const ms = m * 60000;
    return `<option value="${ms}" ${ms === sel ? "selected" : ""}>${esc(t("wallpaper_interval_min", m))}</option>`;
  }).join("");
}

function ensureModal() {
  let el = $("wp-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "wp-modal";
  el.className = "wp-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="wp-backdrop" id="wp-backdrop"></div>
    <div class="wp-dialog" role="dialog" aria-modal="true" aria-labelledby="wp-title">
      <h2 class="wp-title" id="wp-title">${esc(t("wallpaper_confirm_title"))}</h2>
      <div class="wp-grid" id="wp-grid"></div>
      <div class="wp-footer">
        <div class="wp-interval-row" id="wp-interval-row">
          <label for="wp-interval">${esc(t("wallpaper_interval_label"))}</label>
          <select id="wp-interval"></select>
        </div>
        <p class="wp-note" id="wp-note"></p>
        <div class="wp-progress" id="wp-progress" hidden>
          <div class="wp-prog-track"><div class="wp-prog-fill" id="wp-prog-fill"></div></div>
          <span class="wp-prog-label" id="wp-prog-label"></span>
        </div>
        <div class="wp-actions">
          <button class="btn" id="wp-cancel">${esc(t("wallpaper_cancel"))}</button>
          <button class="btn primary" id="wp-apply">${esc(t("wallpaper_apply"))}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  // 配線は1回だけ。閉じる手段は キャンセル / 背景クリック / Esc。
  $("wp-cancel").addEventListener("click", closeModal);
  $("wp-backdrop").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) closeModal();
  });
  $("wp-interval").addEventListener("change", (e) => lsSet(LS_WP_INTERVAL_KEY, e.target.value));
  $("wp-apply").addEventListener("click", onApply);
  _wired = true;
  return el;
}

function closeModal() {
  const el = $("wp-modal");
  if (!el || el.hidden) return;
  el.hidden = true;
  unlockScroll();
}

function showProgress(done, total) {
  $("wp-progress").hidden = false;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("wp-prog-fill").style.width = `${pct}%`;
  $("wp-prog-label").textContent = t("wallpaper_applying", `${done}/${total}`);
}

function hideProgress() {
  const box = $("wp-progress");
  if (box) box.hidden = true;
}

async function onApply() {
  const apply = $("wp-apply");
  const cancel = $("wp-cancel");
  const urls = _items.map((it) => it.skin.splash).filter(Boolean);
  if (!urls.length) return;
  // 適用中はボタンを無効化し、進捗ゲージを出す。サーバの POST は全画像 DL 完了まで
  // ブロックするので、別途 /api/wallpaper/progress をポーリングして done/total を反映する
  // (枚数が多いと「固まった」ように見えるのを防ぐ)。
  apply.disabled = true;
  cancel.disabled = true;
  showProgress(0, urls.length);
  const poll = setInterval(async () => {
    const p = await fetchWallpaperProgress();
    if (p && p.total) showProgress(p.done, p.total);
  }, 300);
  try {
    const interval = parseInt($("wp-interval").value, 10) || WALLPAPER_INTERVAL_DEFAULT;
    const data = await applyWallpaper(urls, interval);
    showProgress(urls.length, urls.length);
    // サーバが枚数で振り分けた結果 (static/slideshow) に応じた文言を出す。
    toast(data.mode === "slideshow" ? t("wallpaper_slideshow_set", data.count) : t("wallpaper_set"));
    closeModal();
  } catch (err) {
    toast(t("wallpaper_failed", err.message), "err");
  } finally {
    clearInterval(poll);
    hideProgress();
    apply.disabled = false;
    cancel.disabled = false;
  }
}

// 選択アイテム群を対象に確認モーダルを開く。render.js (ギャラリーの「壁紙にする」) から呼ぶ。
export function openWallpaperConfirm(items) {
  _items = (items || []).filter((it) => it && it.skin && it.skin.splash);
  if (!_items.length) {
    toast(t("wallpaper_none"), "err");
    return;
  }
  ensureModal();
  hideProgress();  // 前回適用の進捗表示が残っていれば消す
  // サムネイル一覧 (CDragon から直接。壁紙設定はサーバ側で取得するのでここは表示専用)
  $("wp-grid").innerHTML = _items.map((it) => {
    const alt = `${champName(it.champ)} — ${skinLabel(it.champ, it.skin)}`;
    return `<img class="wp-thumb" loading="lazy" src="${esc(it.skin.splash)}" alt="${esc(alt)}">`;
  }).join("");

  // 2枚以上のときだけ間隔ピッカーを出す (1枚は静止壁紙なので間隔は無意味)。
  const multi = _items.length >= 2;
  $("wp-interval").innerHTML = intervalOptionsHTML();
  $("wp-interval-row").hidden = !multi;
  $("wp-note").textContent = multi
    ? t("wallpaper_note_slideshow", _items.length)
    : t("wallpaper_note_single");

  $("wp-modal").hidden = false;
  lockScroll();
}
