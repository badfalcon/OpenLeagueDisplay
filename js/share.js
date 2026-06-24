// Share link for the site itself. Devices with the Web Share API (mostly mobile) open the OS
// native share sheet; devices without it copy the site URL to the clipboard and briefly swap
// the button to a checkmark to signal success.

import { $ } from "./state.js";
import { t } from "./i18n.js";

// Share target is the current URL including its route (location.href). Hash routing made it
// possible to deep-link to champion / skin-line detail pages, so we share the current location
// rather than a fixed top URL. Search query / sort order are intentionally kept out of the URL
// (state/localStorage only), so what's shared is just the view + target ID.
const shareUrl = () => location.href;

const CHECK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// Timer and original innerHTML for reverting the icon swap after a successful copy.
// Kept as a single timer so rapid clicks don't stack multiple timers.
let revertTimer = null;
let originalIcon = "";

export async function shareSite() {
  const btn = $("share-btn");
  // Read the current location on every share (deep-link support). Don't hold a fixed URL in a constant.
  const url = shareUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: "OpenLeagueDisplay", url });
    } catch (_) {
      // Silently ignore user cancellation (AbortError) and failures
    }
    return;
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch (_) {
    // Fallback for browsers without the clipboard API / non-secure contexts
    ok = legacyCopy(url);
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
  // Remember the original icon only on the first call (so we don't save the swapped-in innerHTML)
  if (revertTimer) clearTimeout(revertTimer);
  else originalIcon = btn.innerHTML;
  btn.innerHTML = CHECK_ICON;
  btn.classList.add("copied");
  btn.setAttribute("aria-label", t("share_copied"));
  // Rewriting aria-label isn't announced, so notify via the live region instead.
  // Clear it first then set it again so repeated clicks with the same text still re-announce.
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
