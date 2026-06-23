// ライトボックス (画像拡大表示) と全局スライドショー。
// state.lb がライトボックスの内部状態 (現在 idx, mode, timer, A/B フェード等) を持つ。

import { state, $, SKIN_BY_KEY, DATA, lockScroll, unlockScroll, trapFocus, setBackgroundInert, clearBackgroundInert } from "./state.js";
import { toLightboxItem, syncPauseButton, syncCaptionButton } from "./i18n.js";

// フォーカストラップ解除関数 (open で張り、close で呼ぶ)。chrome-hidden (opacity:0) 中も
// ツールバーのボタンは offsetParent が残る (opacity は offsetParent に影響しない) ので
// Tab 対象に残る。視覚と不一致だが、キーボード操作の起点 (lb-close) を失わないための
// 意図的な挙動。
let releaseTrap = null;

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
  // 戻る (Android バックジェスチャ / ブラウザ戻る) で「サイト離脱」ではなく
  // 「ライトボックスを閉じる」に倒すため、URL は変えずに戻る 1 回分の history
  // エントリだけ積む。popstate ハンドラ (app.js) はライトボックスが開いていれば
  // closeLightbox を呼ぶ。判定は DOM の .open クラスで行うので、リロードで
  // history.state.lb だけ残っても誤動作しない。
  history.pushState({ lb: 1 }, "", location.href);
  state.lb.list = list; state.lb.idx = idx; state.lb.mode = mode;
  state.lb.paused = false; state.lb.frontIsA = true;
  state.lb.lastFocus = document.activeElement;
  const lb = $("lightbox");
  lb.classList.add("open");
  lb.setAttribute("aria-hidden", "false");
  lb.inert = false;  // 閉じ状態の inert を解除 (フォーカス/タブ/操作を有効化)。focus より前に必須
  document.body.classList.add("lightbox-open");
  lockScroll();
  setBackgroundInert();
  lb.classList.toggle("slideshow", mode === "slideshow");
  // ステージタップで隠せる操作系 (chrome) は開くたびに必ず表示状態に戻す。
  // caption と違い「隠したまま」を持ち越さない (永続化しない) ので毎回外す。
  lb.classList.remove("chrome-hidden");
  // 永続化された画像フィット設定を反映 (.fill = object-fit: cover)
  lb.classList.toggle("fill", state.lb.fit === "cover");
  // スマホ拡大時の左右パン (CSS lb-panx) の長さを 1 スライドの表示時間に合わせる。
  // showImage が初回 .show を付ける前に設定しないと 1 枚目だけ CSS 既定 7000ms を読む
  lb.style.setProperty("--lb-pan-dur", state.lb.interval + "ms");
  // 一時停止ボタンは上ツールバーの 1 列に同居 (独立コンテナは廃止)。
  // スライドショー時のみ表示する
  $("ss-pause").style.display = mode === "slideshow" ? "" : "none";
  // 前回 pause したまま閉じた時にラベル/見た目が「再開」のまま残るのを防ぐ
  // (paused は上で false に戻したので、開いた瞬間に必ず再生中表示へ同期する)
  syncPauseButton();
  syncCaptionButton();
  // 間隔・キャプションの ⚙ メニューはスライドショー時のみ。開いた瞬間は必ず畳む
  $("ss-options-wrap").style.display = mode === "slideshow" ? "" : "none";
  $("ss-menu").hidden = true;
  $("ss-options").setAttribute("aria-expanded", "false");
  applyCaption();
  // 初回メディアはクロスフェード不要。動画スキンなら動画、それ以外は静止画を直接表示
  const seq = ++state.lb.seq;
  const item = state.lb.list[idx];
  if (item && item.video) showVideo(item, seq);
  else showImage(item, seq, false);
  updateMeta();
  preloadAdjacent();
  // 閉じるボタンへフォーカス (キーボード操作の起点)
  $("lb-close").focus();
  // Tab で背景へ抜けないよう閉じ込める (close で解除)
  if (releaseTrap) releaseTrap();
  releaseTrap = trapFocus(lb);
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
  lb.inert = true;  // 閉じたら操作ボタンをタブ順 / a11y ツリーから除く (フェード中も非操作で問題ない)
  document.body.classList.remove("lightbox-open");
  unlockScroll();
  clearBackgroundInert();
  if (releaseTrap) { releaseTrap(); releaseTrap = null; }
  stopSlideshow();
  // openLightbox の seq を進めて係争中の onload を無効化
  state.lb.seq++;
  // 閉じた後も動画が裏で再生/バッファし続けないよう止める
  const video = $("lb-video");
  if (video) { video.pause(); video.classList.remove("show"); }
  if (state.lb.lastFocus && typeof state.lb.lastFocus.focus === "function") {
    state.lb.lastFocus.focus();
  }
  // UI からの閉じ (✕ / Esc) の時だけ、openLightbox で積んだ history エントリを
  // 消費する。popstate 経由 (戻るで閉じる) の場合は既に history が巻き戻っていて
  // state.lb が消えているので history.back() は発火せず、二重戻りにならない。
  if (history.state && history.state.lb) history.back();
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
// キャプション表示量を lightbox ルートの class に反映する。CSS 側で
// .caption-name は説明文を、.caption-none はオーバーレイ全体を畳む。
// ビューアモードでは設定 UI (⚙) を出さないので常に full 扱いにして予測可能にする
// (= スライドショーで none にしても、別途開いた拡大表示には影響させない)。
export function applyCaption() {
  const active = state.lb.mode === "slideshow" ? state.lb.caption : "full";
  const lb = $("lightbox");
  lb.classList.toggle("caption-name", active === "name");
  lb.classList.toggle("caption-none", active === "none");
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
  // 間隔ボタン (app.js) は再生中ここを呼び直すので、左右パンの長さも追従させる
  // (走行中アニメには反映されず次スライドから効く)
  $("lightbox").style.setProperty("--lb-pan-dur", state.lb.interval + "ms");
  // 初回画像のロード完了後に scheduleNext が呼ばれるので、ここで明示的に開始する必要なし。
  // ただし初回画像がキャッシュ済みで onload 発火タイミングが微妙な場合に備え、
  // フォールバックで interval 後に1回開始する
  state.lb.timer = setTimeout(nextSlide, state.lb.interval);
}
export function stopSlideshow() {
  if (state.lb.timer) { clearTimeout(state.lb.timer); state.lb.timer = null; }
}
// 選択中スキンで全局スライドショーを開始する。開始できたら true、ギャラリーが空
// (= splash 付きの選択が 0 件) なら false を返す。
// 空振り時の行き先 (ギャラリービューへ誘導 + toast) は呼び出し側に任せる:
// ここで alert / render.js への遷移を抱えると lightbox→render の循環 import を
// 作ってしまうため、ナビゲーションの責務は app.js / render.js 側に置く。
export function startGlobalSlideshow() {
  if (!DATA) return false;
  const list = buildSelectedList();
  if (list.length === 0) return false;
  openLightbox(shuffle(list), 0, "slideshow");
  return true;
}
