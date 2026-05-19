// サイト自体の共有リンク。Web Share API が使える端末 (主にモバイル) は OS の
// ネイティブ共有シートを開き、無い端末はサイト URL をクリップボードへコピーして、
// ボタンを一時的にチェックマークへ差し替えて成功を知らせる。

import { $ } from "./state.js";
import { t } from "./i18n.js";

// 共有先は常にサイトのトップ (canonical URL)。検索/選択状態は localStorage 専用で
// URL には載せない設計なので、location.href ではなく og:url と同じ固定値を使う。
const SHARE_URL = "https://badfalcon.github.io/OpenLeagueDisplay/";

const CHECK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// コピー成功時のアイコン差し替えを元に戻すためのタイマーと元 innerHTML。
// 連打でタイマーが多重化しないよう 1 本に集約する。
let revertTimer = null;
let originalIcon = "";

export async function shareSite() {
  const btn = $("share-btn");
  if (navigator.share) {
    try {
      await navigator.share({ title: "OpenLeagueDisplay", url: SHARE_URL });
    } catch (_) {
      // ユーザーによるキャンセル (AbortError) や失敗は黙って無視する
    }
    return;
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    ok = true;
  } catch (_) {
    // clipboard API 非対応 / 非セキュアコンテキスト向けのフォールバック
    ok = legacyCopy(SHARE_URL);
  }
  if (ok && btn) showCopied(btn);
}

function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_) {}
  ta.remove();
  return ok;
}

function showCopied(btn) {
  // 最初の 1 回だけ元アイコンを覚える (差し替え中の innerHTML を保存しないため)
  if (revertTimer) clearTimeout(revertTimer);
  else originalIcon = btn.innerHTML;
  btn.innerHTML = CHECK_ICON;
  btn.classList.add("copied");
  btn.setAttribute("aria-label", t("share_copied"));
  // aria-label の書き換えは読み上げられないので、live region 経由で通知する。
  // 連打で同じ文言を入れても再アナウンスされるよう、一度空にしてから入れ直す
  const live = $("sr-status");
  if (live) {
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = t("share_copied"); });
  }
  revertTimer = setTimeout(() => {
    btn.innerHTML = originalIcon;
    btn.classList.remove("copied");
    btn.setAttribute("aria-label", t("share_aria"));
    revertTimer = null;
  }, 1800);
}
