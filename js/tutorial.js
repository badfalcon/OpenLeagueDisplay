// First-visit tutorial: a simple 4-step onboarding modal.
// The seen flag lives in localStorage (LS_TUTORIAL_KEY); the header's ? button and the ? key
// can re-show it any number of times (without changing the flag). Every close path (Skip / Done /
// Esc / outside click) sets the flag on the first display.
//
// Bodies (tut_s*_body) are trusted strings with <strong>/<em>/<code>/<br> embedded in the i18n
// table, so they go straight into innerHTML. There's no user-input path, so no XSS sink.

import { state, $, lsGet, lsSet, LS_TUTORIAL_KEY, lockScroll, unlockScroll, trapFocus, setBackgroundInert, clearBackgroundInert } from "./state.js";
import { t } from "./i18n.js";

const TOTAL_STEPS = 4;

// Focus-trap release fn (set on open, called on close). Since buttons come and go by state
// (e.g. Skip hides on the last step), trapFocus recomputes the list on the fly each time.
let releaseTrap = null;

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
  setBackgroundInert();
  // Trap focus so Tab can't escape to the background (released on close)
  if (releaseTrap) releaseTrap();
  releaseTrap = trapFocus(ov);
  // Move focus to the main action (Next) so Enter / arrows advance it
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
  clearBackgroundInert();
  if (releaseTrap) { releaseTrap(); releaseTrap = null; }
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
    // On the last step Next doubles as "Done", so hide Skip (removes the redundant path)
    skipBtn.style.visibility = step === TOTAL_STEPS ? "hidden" : "visible";
  }
}

// Auto-show only on the first visit. In the rare case another overlay (progress / lightbox) is
// already up, yield and retry on the next launch.
export function maybeAutoOpenTutorial() {
  if (lsGet(LS_TUTORIAL_KEY) === "1") return;
  // Showing it once .champ-grid's 0.5s fadeIn has settled feels gentler
  setTimeout(() => {
    const prog = $("progress-overlay");
    const lb   = $("lightbox");
    if (prog && prog.classList.contains("open")) return;
    if (lb && lb.classList.contains("open")) return;
    openTutorial();
  }, 600);
}
