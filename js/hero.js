// Home hero: the "newest splashes" featured band at the top of the home view.
// render() destroys it unconditionally (destroyHero) and renderHome re-mounts it on
// every home render — #view-content is rebuilt wholesale each render(), so the DOM
// can't persist; only the module-level pool/index survive (the featured order and
// current slide don't reshuffle on every visit).
// Imports stay at state/i18n level; navigation (openChampion) and the wallpaper
// action are injected by render.js as callbacks, so there's no hero→render edge
// (the hero→i18n→render cycle that remains is the same hoist-safe pattern as
// render↔i18n — nothing here calls t() at module top level).

import { state, DATA, $ } from "./state.js";
import { t, champName, skinLabel, RARITY_LABELS } from "./i18n.js";

const POOL_SIZE = 6;
const ROTATE_MS = 7000;

let pool = null;      // [{ c, s }] — memoized per session (per DATA identity)
let poolData = null;  // the DATA.champions the pool was built from (rebuilt after locale-independent data swaps)
let idx = 0;
let timer = null;
let frontIsA = true;
let callbacks = null;

// Newest first by the per-skin `release` (W0: wiki date / first-seen stamp).
// Fallback when the data has too few dated skins (old data.json or a failed wiki
// run): random Ultimate/Mythic picks, so the band never comes up empty.
function buildPool() {
  if (pool && poolData === DATA.champions) return pool;
  const dated = [];
  for (const c of DATA.champions) {
    for (const s of c.skins) {
      if (s.splash && s.release) dated.push({ c, s });
    }
  }
  dated.sort((a, b) => (a.s.release < b.s.release ? 1 : a.s.release > b.s.release ? -1 : 0));
  const picked = dated.slice(0, POOL_SIZE);
  if (picked.length < POOL_SIZE) {
    const rare = [];
    for (const c of DATA.champions) {
      for (const s of c.skins) {
        if (s.splash && (s.rarity === "Ultimate" || s.rarity === "Mythic")) rare.push({ c, s });
      }
    }
    for (let i = rare.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rare[i], rare[j]] = [rare[j], rare[i]];
    }
    for (const e of rare) {
      if (picked.length >= POOL_SIZE) break;
      if (!picked.some(p => p.s === e.s)) picked.push(e);
    }
  }
  pool = picked;
  poolData = DATA.champions;
  idx = Math.min(idx, Math.max(0, pool.length - 1));
  return pool;
}

const reducedMotion = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fill the container (the empty <section id="hero"> renderHome emitted) and start
// the rotation. Text goes in via textContent (no escaping concerns).
export function mountHero(container, cbs) {
  destroyHero();
  const items = buildPool();
  if (!items.length || !container) return;
  callbacks = cbs;

  container.innerHTML = `
    <img class="hero-img kb-on" id="hero-img-a" alt="" decoding="async">
    <img class="hero-img kb-on" id="hero-img-b" alt="" decoding="async">
    <div class="hero-scrim"></div>
    <div class="hero-content">
      <div class="hero-eyebrow" id="hero-eyebrow"></div>
      <h2 class="hero-name" id="hero-name"></h2>
      <div class="hero-meta">
        <span class="hero-skin" id="hero-skin"></span>
        <span class="rarity-badge" id="hero-rarity" hidden></span>
      </div>
      <div class="hero-actions">
        <button class="btn primary" id="hero-view" type="button"></button>
        <button class="btn ghost" id="hero-wallpaper" type="button"></button>
      </div>
    </div>
    <div class="hero-dots" id="hero-dots"></div>`;

  $("hero-eyebrow").textContent = t("hero_eyebrow");
  $("hero-view").textContent = t("hero_view_skin");
  $("hero-wallpaper").textContent = t("wallpaper_set_btn");
  // "View splash" goes straight to the skin (champion view opens underneath and the
  // lightbox lands on this exact splash) — the skin is the star here, not the champion
  $("hero-view").addEventListener("click", () => {
    const cur = items[idx];
    if (cur && callbacks) callbacks.onView(cur.c.alias, cur.s.label);
  });
  $("hero-wallpaper").addEventListener("click", () => {
    const cur = items[idx];
    if (cur && callbacks) callbacks.onWallpaper(cur.s.splash);
  });

  const dots = $("hero-dots");
  items.forEach((it, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", `${champName(it.c)} — ${skinLabel(it.c, it.s)}`);
    b.addEventListener("click", () => { show(i, true); arm(); });
    dots.appendChild(b);
  });

  frontIsA = true;
  show(idx, false);
  arm();
}

function arm() {
  clearInterval(timer);
  timer = null;
  if (reducedMotion()) return;  // no auto-advance for vestibular safety
  timer = setInterval(() => {
    // Hold the rotation while the tab is hidden or a lightbox/slideshow is up
    if (document.hidden) return;
    const lb = $("lightbox");
    if (lb && lb.classList.contains("open")) return;
    show((idx + 1) % (pool ? pool.length : 1), true);
  }, ROTATE_MS);
}

function show(i, crossfade) {
  if (!pool || !pool.length) return;
  idx = i;
  const { c, s } = pool[idx];
  const name = $("hero-name");
  if (!name) return;  // container was torn down between ticks
  // The SKIN name is the headline (it's a "new splashes" band); the champion is the
  // small kicker below. Classic skins render their champion name as the skin label,
  // so drop the kicker when it would just repeat the headline.
  const skin = skinLabel(c, s);
  const champ = champName(c);
  name.textContent = skin;
  $("hero-skin").textContent = champ !== skin ? champ : "";
  const rar = $("hero-rarity");
  const rLabel = s.rarity
    ? ((RARITY_LABELS[state.locale] || {})[s.rarity] || RARITY_LABELS.default[s.rarity] || "")
    : "";
  rar.hidden = !rLabel;
  rar.textContent = rLabel;
  [...$("hero-dots").children].forEach((d, di) => d.classList.toggle("active", di === idx));

  const a = $("hero-img-a"), b = $("hero-img-b");
  const back = frontIsA ? b : a;
  const front = frontIsA ? a : b;
  if (!crossfade) {
    front.src = s.splash;
    front.classList.add("show");
    back.classList.remove("show");
    return;
  }
  const swap = () => {
    back.classList.add("show");
    front.classList.remove("show");
    frontIsA = !frontIsA;
  };
  if (back.getAttribute("src") === s.splash) { swap(); return; }
  back.onload = swap;
  back.onerror = swap;
  back.src = s.splash;
}

export function destroyHero() {
  clearInterval(timer);
  timer = null;
  callbacks = null;
}
