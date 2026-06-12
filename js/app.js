// エントリポイント: data.json ロード → 初期 locale 解決 → イベント配線 → 初回 render。
// <img onload="imgLoaded(...)"> のインライン属性は ES Modules スコープを見ないため、
// window.* に露出させる必要がある (最初の render 前に立てる)。

import {
  state, DATA, $, esc, setData,
  LS_LOCALE_KEY, LS_SORT_KEY, LS_LB_FIT_KEY,
  lsGet, lsSet,
  buildIndexes, SKIN_BY_KEY, loadSelectedFromStorage, saveSelected,
} from "./state.js";
import {
  UI_STRINGS, t, syncPauseButton, syncCaptionButton, syncFitButton,
  applyStaticUIStrings, equalizeTabs,
  localeFlagURL, setLangButton, closeLangMenu,
  pickInitialLocale, loadLocale,
} from "./i18n.js";
import {
  render, goHome, goBack, openLines, openSelected,
  imgLoaded, imgErr,
} from "./render.js";
import {
  hideProgress,
} from "./zip.js";
import {
  closeLightbox, nextSlide, prevSlide, scheduleNext,
  startSlideshow, stopSlideshow, startGlobalSlideshow, applyCaption,
} from "./lightbox.js";
import {
  openTutorial, closeTutorial, tutNext, tutPrev,
  renderTutorial, isTutorialOpen, maybeAutoOpenTutorial,
} from "./tutorial.js";
import { shareSite } from "./share.js";
import { probeLocal, toast } from "./local.js";

// インライン onload/onerror から呼ばれる窓口。最初の render() より前に立てる
window.imgLoaded = imgLoaded;
window.imgErr = imgErr;

async function init() {
  // data.json 取得前でも localStorage の保存 locale で UI を仮表示しておく。
  // pickInitialLocale は data.json の locales を使うのでロード後に再呼び出しするが、
  // localStorage に保存があればそれを先に当てて初回フラッシュを減らす。
  const savedLoc = lsGet(LS_LOCALE_KEY);
  if (savedLoc && UI_STRINGS[savedLoc]) state.locale = savedLoc;
  // 並び順も再訪時に復元。未知の値が来てたら無視して既定 (name_asc) のまま。
  // 旧バージョンの "default" (= リリース順) は新しい "release" にマップして挙動を保つ
  const savedSort = lsGet(LS_SORT_KEY);
  if (savedSort === "default") {
    state.sortOrder = "release";
  } else if (savedSort === "release" || savedSort === "name_asc" || savedSort === "name_desc") {
    state.sortOrder = savedSort;
  }
  // ライトボックスの画像フィットも復元 ("contain" / "cover" のみ受理)
  const savedFit = lsGet(LS_LB_FIT_KEY);
  if (savedFit === "contain" || savedFit === "cover") {
    state.lb.fit = savedFit;
  }
  applyStaticUIStrings();
  // ローカル実行 (local_app.py) かを検知。data.json fetch と並行で走らせ、初回 render の
  // 前に await する (失敗/Pages では静かに false に倒れ、ビューア本体には影響しない)。
  const localProbe = probeLocal();
  // localized テキストが当たったので、index.html で立てた i18n-loading を外して
  // 隠していたタブ/ボタン/ローディング文言を見せる。これ以降の locale 切替は
  // 同期的に DOM を書き換えるためフラッシュは発生しない
  document.documentElement.classList.remove("i18n-loading");
  // Cinzel フォントは defer 読込なので、初回の equalizeTabs() はフォールバック
  // フォントで測ってしまう。ready 後にもう一度合わせて崩れを防ぐ。
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(equalizeTabs);
  }
  try {
    const res = await fetch("./data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    setData(await res.json());
  } catch (e) {
    // data.json 未生成 (初回ローカル起動の典型エラー) は手順を案内する
    const is404 = /HTTP 404/.test(e.message);
    const hint = is404
      ? `<p style="margin-top:18px;font-size:13px;color:var(--ink-soft);line-height:1.7">${t("hint_no_data")}</p>`
      : "";
    $("root").innerHTML = `<div class="loading"><h2>${t("error_title")}</h2><p>${t("error_load_data", esc(e.message))}</p>${hint}</div>`;
    return;
  }

  // setData 後は state.js 内の DATA バインディングが更新されている (live binding 経由で
  // 各モジュールが参照する)。ここからは DATA.* を直接参照しても良い

  // 言語ピッカーを構築 (data.json に同梱されている locales を使う)。古い data.json
  // (locales 未定義) でも壊れないよう、空の場合は "default" だけ表示する
  const localesMeta = Array.isArray(DATA.locales) && DATA.locales.length
    ? DATA.locales
    : [{ code: "default", label: "English" }];
  const menu = $("lang-menu");
  menu.innerHTML = localesMeta
    .map(l => {
      const url = localeFlagURL(l.code);
      const flag = url
        ? `<img class="lang-flag" src="${esc(url)}" alt="" loading="lazy" decoding="async">`
        : `<span class="lang-flag" aria-hidden="true"></span>`;
      return `<li><button type="button" role="option" data-code="${esc(l.code)}">`
        + flag
        + `<span>${esc(l.label)}</span></button></li>`;
    })
    .join("");
  const availableSet = new Set(localesMeta.map(l => l.code).filter(c => c !== "default"));
  const initial = pickInitialLocale(availableSet);
  setLangButton(initial);
  if (initial !== "default") {
    await loadLocale(initial);
    // ロード失敗時は loadLocale 内で "default" に戻されているので、UI も合わせる
    if (state.locale === "default") setLangButton("default");
  }
  // data.json 取得後に最終的な locale が確定したので、改めて static UI を反映
  // (stats/last_updated を含むため、必ず DATA セット後に呼ぶこと)
  applyStaticUIStrings();

  buildIndexes();

  // 前回セッションで選択していたスキンを復元する。data.json から消えた
  // (リネーム/削除された) キーは静かにフィルタしてストレージも上書き保存する
  const saved = loadSelectedFromStorage();
  if (saved.length) {
    for (const k of saved) {
      if (SKIN_BY_KEY.has(k)) state.selected.add(k);
    }
    if (state.selected.size !== saved.length) saveSelected();
    // ヘッダーのギャラリーボタン件数は applyStaticUIStrings / render() が反映する
  }

  // ローカルモード検知の確定を待ってから初回 render (壁紙 UI の表示状態を反映するため)
  await localProbe;

  render();

  // 初回訪問なら少し遅らせてチュートリアルを自動表示 (UI フェードイン後)
  maybeAutoOpenTutorial();
}

function wireEvents() {
  $("title").addEventListener("click", goHome);
  $("back-btn").addEventListener("click", goBack);
  $("tab-home").addEventListener("click", goHome);
  $("nav-lines").addEventListener("click", openLines);
  // Slideshow ボタン: 開始できれば全局スライドショーへ。空 (ギャラリーに splash 付き
  // 選択が無い) なら OS ダイアログを出さず、My Gallery ビューを開いて理由を toast で示す
  // (空ビューの gallery_empty / _hint が追加導線になる)。startGlobalSlideshow が
  // 戻り値で開始可否を返すので、ナビゲーションはここ (= 呼び出し側) で行う。
  $("slideshow-btn").addEventListener("click", () => {
    if (!startGlobalSlideshow()) {
      openSelected();
      toast(t("slideshow_empty"));
    }
  });
  $("gallery-btn").addEventListener("click", openSelected);
  $("help-btn").addEventListener("click", openTutorial);
  $("share-btn").addEventListener("click", shareSite);
  $("tut-skip").addEventListener("click", closeTutorial);
  $("tut-next").addEventListener("click", tutNext);
  $("tut-back").addEventListener("click", tutPrev);
  $("tutorial-overlay").addEventListener("click", (e) => {
    if (e.target === $("tutorial-overlay")) closeTutorial();
  });
  $("lang-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("lang-menu");
    const open = !menu.hidden;
    menu.hidden = open;
    $("lang-btn").setAttribute("aria-expanded", open ? "false" : "true");
  });
  $("lang-menu").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-code]");
    if (!btn) return;
    const code = btn.dataset.code;
    closeLangMenu();
    lsSet(LS_LOCALE_KEY, code);
    // ロード中はボタンを無効化して連打を防ぐ。ファイルは static で軽いので
    // 進捗 UI 等は出さず、blocking なロードで十分 (default→non-default で 100KB 程度)
    $("lang-btn").disabled = true;
    await loadLocale(code);
    $("lang-btn").disabled = false;
    // ロード失敗時 loadLocale が default に戻すので、UI もそれに合わせる
    setLangButton(state.locale);
    // UI chrome (ボタン/プレースホルダ/aria) も locale 切替に追従させる
    applyStaticUIStrings();
    // チュートリアルが開きっぱなしの時は本文も新 locale で塗り直す
    if (isTutorialOpen()) renderTutorial();
    render();
  });
  // メニュー外クリック / Escape で閉じる
  document.addEventListener("click", (e) => {
    if (!$("lang-picker").contains(e.target)) closeLangMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("lang-menu").hidden) {
      closeLangMenu();
      $("lang-btn").focus();
      // この Escape は「メニューを閉じる」で消費済み。後続の document keydown
      // (goBack / ライトボックス) まで同時に発火させない
      e.stopImmediatePropagation();
    }
  });
  $("prog-cancel").addEventListener("click", () => {
    state.packAbort = true;
    hideProgress();
  });
  // 入力中に毎キーストロークで render() を回すと、Lines タブ (~2000 スキン分の
  // 選択集計を含む) で体感がもたつくので 90ms debounce
  let searchTimer = null;
  $("search").addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      // 入力イベント時点の値ではなく発火時点の値を読む。タイマー保留中に
      // goHome 等が input をクリアした場合に古いクエリを書き戻さないため
      const value = $("search").value.trim();
      if (value === state.searchQuery) return;
      state.searchQuery = value;
      // home/lines のフィルタとして動く。詳細画面で検索したら一覧に戻す
      if (state.view === "champion") state.view = "home";
      if (state.view === "line") state.view = "lines";
      render();
    }, 90);
  });
  $("sort-select").addEventListener("change", (e) => {
    state.sortOrder = e.target.value;
    lsSet(LS_SORT_KEY, state.sortOrder);
    render();
  });
  $("lb-close").addEventListener("click", closeLightbox);
  $("lb-prev").addEventListener("click", prevSlide);
  $("lb-next").addEventListener("click", nextSlide);
  $("ss-pause").addEventListener("click", () => {
    state.lb.paused = !state.lb.paused;
    syncPauseButton();
    // setTimeout 連鎖モデルなので、再開時にタイマーを再点火する必要がある
    if (state.lb.paused) stopSlideshow();
    else if (state.lb.mode === "slideshow") scheduleNext();
  });
  $("ss-interval").addEventListener("click", () => {
    const seqs = [3000, 5000, 7000, 10000, 15000, 30000];
    const i = seqs.indexOf(state.lb.interval);
    state.lb.interval = seqs[(i + 1) % seqs.length];
    $("ss-interval").textContent = t("ss_interval", state.lb.interval / 1000);
    if (state.lb.mode === "slideshow") startSlideshow();
  });
  // ⚙ メニューの開閉。間隔・キャプションを 1 つに集約してツールバーのボタン数を抑える。
  // 開いたまま両方いじれるよう、メニュー内クリックでは閉じない (外側クリック / Esc で閉じる)
  const closeSsMenu = () => {
    $("ss-menu").hidden = true;
    $("ss-options").setAttribute("aria-expanded", "false");
  };
  $("ss-options").addEventListener("click", (e) => {
    // 親の lightbox click (外側クリック判定) に拾われて即閉じしないよう止める
    e.stopPropagation();
    const willOpen = $("ss-menu").hidden;
    $("ss-menu").hidden = !willOpen;
    $("ss-options").setAttribute("aria-expanded", String(willOpen));
  });
  $("ss-caption").addEventListener("click", () => {
    const modes = ["full", "name", "none"];
    const i = modes.indexOf(state.lb.caption);
    state.lb.caption = modes[(i + 1) % modes.length];
    syncCaptionButton();
    applyCaption();
  });
  // メニュー外をクリックしたら畳む (lightbox 全体で拾い、⚙ メニュー内は除外)
  $("lightbox").addEventListener("click", (e) => {
    if (!$("ss-menu").hidden && !$("ss-options-wrap").contains(e.target)) closeSsMenu();
  });
  // 画像フィット切替 (contain ↔ cover)。縦長スマホの黒帯を潰す。
  // .fill クラスで CSS の object-fit を切替え、設定は localStorage に永続化する
  $("lb-fit").addEventListener("click", () => {
    state.lb.fit = state.lb.fit === "cover" ? "contain" : "cover";
    $("lightbox").classList.toggle("fill", state.lb.fit === "cover");
    lsSet(LS_LB_FIT_KEY, state.lb.fit);
    syncFitButton();
  });
  // オフライン検知: CDragon のスプラッシュ画像はキャッシュ対象外なので、
  // オフラインだと画像が一斉に出ない。「壊れている」誤解を避けるため理由を告知する
  const offlineBanner = $("offline-banner");
  const syncOnlineState = () => { offlineBanner.hidden = navigator.onLine; };
  window.addEventListener("online", syncOnlineState);
  window.addEventListener("offline", syncOnlineState);
  syncOnlineState();

  // 「トップへ戻る」FAB: 一定量スクロールしたら出す。passive リスナーで scroll を
  // 妨げず、表示状態はフラグでキャッシュして毎 scroll で classList を触らない
  // (閾値をまたいだ時だけ DOM を更新する)。
  const toTopBtn = $("to-top");
  if (toTopBtn) {
    let toTopShown = false;
    const syncToTop = () => {
      const show = window.scrollY > 600;
      if (show === toTopShown) return;
      toTopShown = show;
      toTopBtn.hidden = !show;
    };
    window.addEventListener("scroll", syncToTop, { passive: true });
    syncToTop();
    toTopBtn.addEventListener("click", () => {
      // reduce-motion を尊重: アニメ無効化希望なら即時ジャンプにする
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
  }

  // タッチスワイプ (モバイル): 横方向の動きが縦より明確に大きい時だけ反応させる
  let tStartX = 0, tStartY = 0;
  const lbEl = $("lightbox");
  lbEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    tStartX = e.touches[0].clientX;
    tStartY = e.touches[0].clientY;
  }, { passive: true });
  lbEl.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - tStartX;
    const dy = t.clientY - tStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) prevSlide(); else nextSlide();
    }
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    // チュートリアル表示中は最優先で吸う (Esc/矢印/Enter のみ)
    if (isTutorialOpen()) {
      if (e.key === "Escape") closeTutorial();
      else if (e.key === "ArrowRight" || e.key === "Enter") tutNext();
      else if (e.key === "ArrowLeft") tutPrev();
      return;
    }
    // 進捗オーバーレイ表示中はEsc=中止のみ受け付ける
    if ($("progress-overlay").classList.contains("open")) {
      if (e.key === "Escape") { state.packAbort = true; hideProgress(); }
      return;
    }
    if (!$("lightbox").classList.contains("open")) {
      if (e.key === "Escape" && state.view !== "home") goBack();
      // ? (Shift+/) でいつでもチュートリアル再表示。検索 input にフォーカス中は
      // 文字入力として ? を打ちたいケースが想定されるので無効化
      else if (e.key === "?" && document.activeElement !== $("search")) {
        e.preventDefault();
        openTutorial();
      }
      // / で検索へジャンプ (PC 向けの定番ショートカット)。入力系にフォーカス中は
      // 文字として打ちたいので無効化。検索 input は dom-stash から transplant されて
      // 常に DOM に居るので、見えるよう先頭までスクロールしてからフォーカスする
      else if (e.key === "/") {
        const ae = document.activeElement;
        const tag = ae && ae.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        e.preventDefault();
        window.scrollTo(0, 0);
        $("search").focus();
      }
      return;
    }
    // ⚙ メニューが開いていれば Esc はまずメニューを畳む (lightbox は閉じない)
    if (e.key === "Escape" && !$("ss-menu").hidden) { closeSsMenu(); return; }
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") nextSlide();
    else if (e.key === "ArrowLeft") prevSlide();
    else if (e.key === " ") { e.preventDefault(); if (state.lb.mode === "slideshow") $("ss-pause").click(); }
  });
}

// sticky な topbar の実高さを CSS 変数 --topbar-h に書き出す。ギャラリーの
// sticky ツールバーが topbar 直下に正しく貼り付くための基準値。topbar は
// 2 段構成 + locale 差 + モバイルでの行2 下部固定化で高さが変わるため、CSS の
// 固定値ではなく ResizeObserver で実測して追従させる。
function trackTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const setVar = () => {
    document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px");
  };
  if ("ResizeObserver" in window) {
    new ResizeObserver(setVar).observe(topbar);
  } else {
    window.addEventListener("resize", setVar);
  }
  setVar();
}

// Service Worker 登録: アプリシェルをキャッシュして再訪を高速化し、インストール可能
// 要件を満たす。初回ロードの帯域と競合させないよう load 後に登録する。
// 失敗 (file:// 直開き / 非対応ブラウザ) してもビューア本体の動作には影響しない
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function bootstrap() {
  wireEvents();
  trackTopbarHeight();
  init();
  registerSW();
}

// type="module" は defer 相当なので通常は DOMContentLoaded 後に評価されるが、
// 何らかの理由で先に読まれた場合に備えて両分岐を用意する
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
