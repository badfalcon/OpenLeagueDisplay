// ライトボックス (画像拡大表示) と全局スライドショー。
// state.lb がライトボックスの内部状態 (現在 idx, mode, timer, A/B フェード等) を持つ。

import { state, $, SKIN_BY_KEY, DATA, lockScroll, unlockScroll } from "./state.js";
import { t, toLightboxItem, syncPauseButton } from "./i18n.js";

// スライドショー対象: 選択中のスキンだけを返す (splash が無いものは除外)
function buildSelectedList() {
  const list = [];
  for (const k of state.selected) {
    const hit = SKIN_BY_KEY.get(k);
    if (hit && hit.s.splash) list.push(toLightboxItem(hit.c, hit.s));
  }
  return list;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function openLightbox(list, idx, mode) {
  state.lb.list = list; state.lb.idx = idx; state.lb.mode = mode;
  state.lb.paused = false; state.lb.frontIsA = true;
  state.lb.lastFocus = document.activeElement;
  const lb = $("lightbox");
  lb.classList.add("open");
  lb.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
  lockScroll();
  lb.classList.toggle("slideshow", mode === "slideshow");
  // 永続化された画像フィット設定を反映 (.fill = object-fit: cover)
  lb.classList.toggle("fill", state.lb.fit === "cover");
  $("ss-controls").style.display = mode === "slideshow" ? "" : "none";
  // 前回 pause したまま閉じた時にラベル/見た目が「再開」のまま残るのを防ぐ
  // (paused は上で false に戻したので、開いた瞬間に必ず再生中表示へ同期する)
  syncPauseButton();
  // 間隔ボタンは上ツールバー側 (常時表示) に置いたので、スライドショー時のみ表示する
  $("ss-interval").style.display = mode === "slideshow" ? "" : "none";
  $("lb-mode").textContent = mode === "slideshow" ? t("mode_slideshow") : t("mode_viewer");
  // 初回メディアはクロスフェード不要。動画スキンなら動画、それ以外は静止画を直接表示
  const seq = ++state.lb.seq;
  const item = state.lb.list[idx];
  if (item && item.video) showVideo(item, seq);
  else showImage(item, seq, false);
  updateMeta();
  preloadAdjacent();
  // 閉じるボタンへフォーカス (キーボード操作の起点)
  $("lb-close").focus();
}

// <img> A/B クロスフェードで静止スプラッシュを表示する。crossfade=false は
// openLightbox の初回用 (A に直接乗せる)、true は showCurrent からの遷移用。
// 直前が動画スキンだった可能性があるので、動画レイヤは必ず畳んでから処理する。
function showImage(item, seq, crossfade) {
  const a = $("lb-img-a"), b = $("lb-img-b");
  const video = $("lb-video");
  video.onloadeddata = video.onerror = null;
  video.classList.remove("show");
  if (!video.paused) video.pause();
  if (!item) return;
  if (!crossfade) {
    a.onload = a.onerror = b.onload = b.onerror = null;
    b.classList.remove("show");
    a.classList.add("show");
    state.lb.frontIsA = true;
    a.onerror = () => { if (seq === state.lb.seq && state.lb.mode === "slideshow") scheduleNext(); };
    a.onload  = () => { if (seq === state.lb.seq && state.lb.mode === "slideshow") scheduleNext(); };
    a.src = item.src;
    return;
  }
  const front = state.lb.frontIsA ? a : b;
  const back  = state.lb.frontIsA ? b : a;
  back.onload = back.onerror = null;
  back.onload = () => {
    if (seq !== state.lb.seq) return;
    back.classList.add("show");
    front.classList.remove("show");
    state.lb.frontIsA = !state.lb.frontIsA;
    if (state.lb.mode === "slideshow") scheduleNext();
  };
  back.onerror = () => {
    if (seq !== state.lb.seq) return;
    // 画像取得失敗時もスライドショーは止めず次へ
    if (state.lb.mode === "slideshow") scheduleNext();
  };
  back.src = item.src;
}

// アニメーションスプラッシュ (video フィールドあり) を再生する。poster に splash
// 静止画を当てているので、動画ロード完了までは静止画が見える。画像レイヤは畳む。
// 動画取得に失敗したスキンは静止スプラッシュにフォールバックする。
function showVideo(item, seq) {
  const a = $("lb-img-a"), b = $("lb-img-b");
  const video = $("lb-video");
  a.onload = a.onerror = b.onload = b.onerror = null;
  a.classList.remove("show");
  b.classList.remove("show");
  video.onloadeddata = video.onerror = null;
  if (item.src) video.poster = item.src;
  else video.removeAttribute("poster");
  video.onloadeddata = () => {
    if (seq !== state.lb.seq) return;
    video.play().catch(() => {});
    if (state.lb.mode === "slideshow") scheduleNext();
  };
  video.onerror = () => {
    if (seq !== state.lb.seq) return;
    showImage(item, seq, false);
  };
  video.src = item.video;
  video.load();
  // poster (= splash) が即表示されるので、遷移前の画像から滑らかにフェードする
  video.classList.add("show");
}

// 現在 idx の前後 1 枚を Image() で先読みしてブラウザキャッシュに乗せる。
// 次のスライド遷移時に fetch を待たずにフェードできる。リスト 1 枚のときは何もしない。
function preloadAdjacent() {
  const list = state.lb.list;
  const n = list.length;
  if (n < 2) return;
  const next = (state.lb.idx + 1) % n;
  const prev = (state.lb.idx - 1 + n) % n;
  const targets = next === prev ? [next] : [next, prev];
  // Image().src を立てるとブラウザのリソースキャッシュに乗る。GC されても
  // 同一 URL を再要求した時にキャッシュヒットするので参照保持は不要。
  for (const i of targets) new Image().src = list[i].src;
}
export function closeLightbox() {
  const lb = $("lightbox");
  lb.classList.remove("open");
  lb.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lightbox-open");
  unlockScroll();
  stopSlideshow();
  // openLightbox の seq を進めて係争中の onload を無効化
  state.lb.seq++;
  // 閉じた後も動画が裏で再生/バッファし続けないよう止める
  const video = $("lb-video");
  if (video) { video.pause(); video.classList.remove("show"); }
  if (state.lb.lastFocus && typeof state.lb.lastFocus.focus === "function") {
    state.lb.lastFocus.focus();
  }
}
function updateMeta() {
  const item = state.lb.list[state.lb.idx];
  if (!item) return;
  $("lb-champ").textContent = item.champ;
  $("lb-skin").textContent = item.skin;
  // 説明文はめったに付いていないが、無くても領域は CSS の min-height で確保しておき、
  // 説明の有無でスキン名の高さがズレないようにする (畳まない)。テキストだけ差し替える
  const descEl = $("lb-desc");
  if (descEl) descEl.textContent = item.desc || "";
  $("lb-counter").textContent = `${state.lb.idx + 1} / ${state.lb.list.length}`;
}
function showCurrent() {
  const item = state.lb.list[state.lb.idx];
  if (!item) return;
  // 連打や低速回線で onload が遅延した場合、古いコールバックを無視するための識別子
  const seq = ++state.lb.seq;
  if (item.video) showVideo(item, seq);
  else showImage(item, seq, true);
  updateMeta();
  preloadAdjacent();
}
export function nextSlide() { state.lb.idx = (state.lb.idx + 1) % state.lb.list.length; showCurrent(); }
export function prevSlide() { state.lb.idx = (state.lb.idx - 1 + state.lb.list.length) % state.lb.list.length; showCurrent(); }
// フェード完了/エラー後に呼ばれる。次の interval ぶん待ってから次のスライドへ
export function scheduleNext() {
  stopSlideshow();
  if (state.lb.mode !== "slideshow" || state.lb.paused) return;
  state.lb.timer = setTimeout(nextSlide, state.lb.interval);
}
export function startSlideshow() {
  stopSlideshow();
  // 初回画像のロード完了後に scheduleNext が呼ばれるので、ここで明示的に開始する必要なし。
  // ただし初回画像がキャッシュ済みで onload 発火タイミングが微妙な場合に備え、
  // フォールバックで interval 後に1回開始する
  state.lb.timer = setTimeout(nextSlide, state.lb.interval);
}
export function stopSlideshow() {
  if (state.lb.timer) { clearTimeout(state.lb.timer); state.lb.timer = null; }
}
export function startGlobalSlideshow() {
  if (!DATA) return;
  const list = buildSelectedList();
  if (list.length === 0) {
    alert(t("slideshow_empty"));
    return;
  }
  openLightbox(shuffle(list), 0, "slideshow");
}
