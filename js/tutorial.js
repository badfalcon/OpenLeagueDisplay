// 初回訪問チュートリアル: 3 ステップの簡易オンボーディングモーダル。
// 既読フラグは localStorage (LS_TUTORIAL_KEY) で持ち、ヘッダの ? ボタンと
// ? キーから何度でも再表示できる (フラグは変わらない)。閉じる経路 (Skip / Done /
// Esc / 外側クリック) はどれも最初の表示時のみフラグを立てる。
//
// 本文 (tut_s*_body) は i18n テーブルに <strong>/<em>/<code>/<br> を埋め込んだ
// 信頼済み文字列なので innerHTML に直接流す。ユーザー入力経路は無いので XSS シンクは無い。

import { $, lsGet, lsSet, LS_TUTORIAL_KEY } from "./state.js";
import { t } from "./i18n.js";

const TOTAL_STEPS = 3;
let currentStep = 1;
let prevFocus = null;

export function isTutorialOpen() {
  const ov = $("tutorial-overlay");
  return !!(ov && ov.classList.contains("open"));
}

export function openTutorial() {
  const ov = $("tutorial-overlay");
  if (!ov) return;
  currentStep = 1;
  prevFocus = document.activeElement;
  renderTutorial();
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  document.body.classList.add("tutorial-open");
  // 主操作 (Next) にフォーカスを移して Enter / 矢印で進めるように
  requestAnimationFrame(() => $("tut-next") && $("tut-next").focus());
}

export function closeTutorial() {
  const ov = $("tutorial-overlay");
  if (!ov || !ov.classList.contains("open")) return;
  ov.classList.remove("open");
  ov.setAttribute("aria-hidden", "true");
  document.body.classList.remove("tutorial-open");
  lsSet(LS_TUTORIAL_KEY, "1");
  // 直前にフォーカスがあった要素 (help-btn など) に戻す
  if (prevFocus && typeof prevFocus.focus === "function") {
    try { prevFocus.focus(); } catch (_) {}
  }
  prevFocus = null;
}

export function tutNext() {
  if (currentStep >= TOTAL_STEPS) {
    closeTutorial();
    return;
  }
  currentStep++;
  renderTutorial();
}

export function tutPrev() {
  if (currentStep <= 1) return;
  currentStep--;
  renderTutorial();
}

// locale 切替時に開いたままだと文言が古いままになるので、app.js から呼び戻す。
// 直接 textContent / innerHTML を更新し、表示中ステップ自体は維持する
export function renderTutorial() {
  const counter = $("tut-step-counter");
  const titleEl = $("tut-title");
  const bodyEl  = $("tut-body");
  const dotsEl  = $("tut-dots");
  const backBtn = $("tut-back");
  const nextBtn = $("tut-next");
  const skipBtn = $("tut-skip");
  if (!counter || !titleEl || !bodyEl) return;

  counter.textContent = t("tut_step", currentStep, TOTAL_STEPS);
  titleEl.textContent = t(`tut_s${currentStep}_title`);
  bodyEl.innerHTML = t(`tut_s${currentStep}_body`);

  if (dotsEl) {
    let dots = "";
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      dots += `<span class="tut-dot${i === currentStep ? " active" : ""}" aria-hidden="true"></span>`;
    }
    dotsEl.innerHTML = dots;
  }

  if (backBtn) {
    backBtn.textContent = t("tut_back");
    backBtn.disabled = currentStep === 1;
  }
  if (nextBtn) {
    nextBtn.textContent = currentStep === TOTAL_STEPS ? t("tut_done") : t("tut_next");
  }
  if (skipBtn) {
    skipBtn.textContent = t("tut_skip");
    // 最終ステップでは Next が "Done" になるので Skip は隠す (重複動線を消す)
    skipBtn.style.visibility = currentStep === TOTAL_STEPS ? "hidden" : "visible";
  }
}

// 初回訪問時のみ自動表示。他のオーバーレイ (進捗 / lightbox) が出ているケースは
// 譲って、次回起動で再試行させる
export function maybeAutoOpenTutorial() {
  if (lsGet(LS_TUTORIAL_KEY)) return;
  // .champ-grid の fadeIn 0.5s が落ち着いた頃に出すと体感が穏やか
  setTimeout(() => {
    const prog = $("progress-overlay");
    const lb   = $("lightbox");
    if (prog && prog.classList.contains("open")) return;
    if (lb && lb.classList.contains("open")) return;
    openTutorial();
  }, 600);
}
