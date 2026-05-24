// 初回訪問チュートリアル: 3 ステップの簡易オンボーディングモーダル。
// 既読フラグは localStorage (LS_TUTORIAL_KEY) で持ち、ヘッダの ? ボタンと
// ? キーから何度でも再表示できる (フラグは変わらない)。閉じる経路 (Skip / Done /
// Esc / 外側クリック) はどれも初回表示時にフラグを立てる。
//
// 本文 (tut_s*_body) は i18n テーブルに <strong>/<em>/<code>/<br> を埋め込んだ
// 信頼済み文字列なので innerHTML に直接流す。ユーザー入力経路は無いので XSS シンクは無い。

import { state, $, lsGet, lsSet, LS_TUTORIAL_KEY, lockScroll, unlockScroll } from "./state.js";
import { t } from "./i18n.js";

const TOTAL_STEPS = 3;

export function isTutorialOpen() {
  const ov = $("tutorial-overlay");
  return !!(ov && ov.classList.contains("open"));
}

export function openTutorial() {
  const ov = $("tutorial-overlay");
  if (!ov) return;
  state.tut.step = 1;
  state.tut.lastFocus = document.activeElement;
  renderTutorial();
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  document.body.classList.add("tutorial-open");
  lockScroll();
  // 主操作 (Next) にフォーカスを移して Enter / 矢印で進めるように
  requestAnimationFrame(() => {
    const next = $("tut-next");
    if (next) next.focus();
  });
}

export function closeTutorial() {
  const ov = $("tutorial-overlay");
  if (!ov || !ov.classList.contains("open")) return;
  ov.classList.remove("open");
  ov.setAttribute("aria-hidden", "true");
  document.body.classList.remove("tutorial-open");
  unlockScroll();
  lsSet(LS_TUTORIAL_KEY, "1");
  const prev = state.tut.lastFocus;
  if (prev && typeof prev.focus === "function") {
    try { prev.focus(); } catch (_) {}
  }
  state.tut.lastFocus = null;
}

export function tutNext() {
  if (state.tut.step >= TOTAL_STEPS) {
    closeTutorial();
    return;
  }
  state.tut.step++;
  renderTutorial();
}

export function tutPrev() {
  if (state.tut.step <= 1) return;
  state.tut.step--;
  renderTutorial();
}

export function renderTutorial() {
  const counter = $("tut-step-counter");
  const titleEl = $("tut-title");
  const bodyEl  = $("tut-body");
  const dotsEl  = $("tut-dots");
  const backBtn = $("tut-back");
  const nextBtn = $("tut-next");
  const skipBtn = $("tut-skip");
  if (!counter || !titleEl || !bodyEl) return;

  const step = state.tut.step;
  counter.textContent = t("tut_step", step, TOTAL_STEPS);
  titleEl.textContent = t(`tut_s${step}_title`);
  bodyEl.innerHTML = t(`tut_s${step}_body`);

  if (dotsEl) {
    let dots = "";
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      dots += `<span class="tut-dot${i === step ? " active" : ""}" aria-hidden="true"></span>`;
    }
    dotsEl.innerHTML = dots;
  }

  if (backBtn) {
    backBtn.textContent = t("tut_back");
    backBtn.disabled = step === 1;
  }
  if (nextBtn) {
    nextBtn.textContent = step === TOTAL_STEPS ? t("tut_done") : t("tut_next");
  }
  if (skipBtn) {
    skipBtn.textContent = t("tut_skip");
    // 最終ステップでは Next が "Done" を兼ねるので Skip は隠す (重複動線を消す)
    skipBtn.style.visibility = step === TOTAL_STEPS ? "hidden" : "visible";
  }
}

// 初回訪問時のみ自動表示。他のオーバーレイ (進捗 / lightbox) が先に出ている
// レアケースでは譲って、次回起動で再試行させる
export function maybeAutoOpenTutorial() {
  if (lsGet(LS_TUTORIAL_KEY) === "1") return;
  // .champ-grid の fadeIn 0.5s が落ち着いた頃に出すと体感が穏やか
  setTimeout(() => {
    const prog = $("progress-overlay");
    const lb   = $("lightbox");
    if (prog && prog.classList.contains("open")) return;
    if (lb && lb.classList.contains("open")) return;
    openTutorial();
  }, 600);
}
