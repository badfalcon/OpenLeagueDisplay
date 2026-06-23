// ZIP DL: 選択スキン / チャンピオン単位 / スキンライン単位の一括ダウンロード。
// CDragon に直接 fetch → JSZip でブラウザ内パッキング → blob を a.download で保存。
// GitHub の帯域は使わない (Pages → CDragon 経路は無く、ブラウザ ↔ CDragon の直接通信)。

import { state, $, SKIN_BY_KEY, trapFocus, setBackgroundInert, clearBackgroundInert } from "./state.js";
import { t, champName } from "./i18n.js";

// 進捗オーバーレイのフォーカストラップ解除関数 (showProgress で張り、hideProgress で解除)。
let releaseTrap = null;


export function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim() || "_";
}
export function extOf(url) {
  const m = /\.([a-zA-Z0-9]{2,4})(?:\?|$)/.exec(url);
  return m ? "." + m[1].toLowerCase() : ".jpg";
}
// "Aatrox//Justicar Aatrox" の key 配列から { champ, skin, url, path } リストを作る
export function buildItemsFromSelected() {
  const items = [];
  for (const k of state.selected) {
    const hit = SKIN_BY_KEY.get(k);
    if (hit && hit.s.splash) items.push(itemFor(hit.c, hit.s));
  }
  return items;
}
export function itemFor(c, s) {
  const skinName = s.label.endsWith("_Classic") ? "Classic" : s.label;
  return {
    champ: c.name,
    alias: c.alias,
    skin: skinName,
    url: s.splash,
    // ZIP内パスは平坦に <Champion>_<SkinName>.jpg。
    // Windows の壁紙スライドショー等は指定フォルダ直下しか走査しないため、
    // サブフォルダに分けると壁紙ローテーションで認識されない。
    // ファイル名衝突 (Classic.jpg が全チャンピオン分発生) はチャンピオン名で回避。
    path: `${safeName(c.name)}_${safeName(skinName)}${extOf(s.splash)}`,
  };
}

// 並列度制限付きの並列実行 (1度に concurrency 件まで)
async function pMap(items, fn, concurrency = 6) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      if (state.packAbort) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

let progressLastUpdate = 0;
export function showProgress(title, desc) {
  state.packAbort = false;
  $("prog-title").textContent = title;
  $("prog-desc").textContent = desc || t("zip_pack_desc_selected", "");
  $("prog-fill").style.width = "0%";
  $("prog-count").textContent = "0 / 0";
  $("prog-fail").textContent = "";
  $("prog-cancel").textContent = t("progress_cancel");
  const ov = $("progress-overlay");
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  setBackgroundInert();
  // Tab で背景へ抜けないよう閉じ込める (hideProgress で解除)
  if (releaseTrap) releaseTrap();
  releaseTrap = trapFocus(ov);
  // フォーカスを Cancel に移してキーボード/SR の起点を作る (他モーダルと作法を揃える)
  $("prog-cancel").focus();
}
export function updateProgress(done, total, failed) {
  // 描画コスト軽減のため、最後の更新から100ms以内ならスキップ (最終フレームは別途呼ぶ)
  const now = performance.now();
  if (done < total && now - progressLastUpdate < 100) return;
  progressLastUpdate = now;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("prog-fill").style.width = pct + "%";
  $("prog-count").textContent = `${done} / ${total}`;
  if (failed) $("prog-fail").textContent = t("zip_count_failed", failed);
}
export function hideProgress() {
  const ov = $("progress-overlay");
  ov.classList.remove("open");
  ov.setAttribute("aria-hidden", "true");
  clearBackgroundInert();
  if (releaseTrap) { releaseTrap(); releaseTrap = null; }
}

// JSZip 読み込み完了まで待つ (defer で後読みのため init より遅れることがある)
export function ensureJSZip() {
  return new Promise((resolve, reject) => {
    if (typeof JSZip !== "undefined") return resolve();
    const start = performance.now();
    // 外側で定義した i18n 関数 `t()` を遮らないよう、interval ID 用の変数は別名にする
    const iv = setInterval(() => {
      if (typeof JSZip !== "undefined") { clearInterval(iv); resolve(); }
      else if (performance.now() - start > 10000) {
        clearInterval(iv);
        reject(new Error(t("jszip_load_failed")));
      }
    }, 100);
  });
}

async function downloadAsZip(items, zipName, opts = {}) {
  if (!items.length) return;
  try {
    await ensureJSZip();
  } catch (e) {
    alert(e.message);
    return;
  }
  showProgress(t("zip_creating"), opts.desc || t("zip_pack_desc_selected", items.length));
  const zip = new JSZip();
  let done = 0, failed = 0;

  await pMap(items, async (it) => {
    if (state.packAbort) return;
    try {
      const res = await fetch(it.url, { mode: "cors", cache: "force-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      zip.file(it.path, blob);
    } catch (e) {
      failed++;
    }
    done++;
    updateProgress(done, items.length, failed);
  }, 6);

  if (state.packAbort) { hideProgress(); return; }
  updateProgress(items.length, items.length, failed);
  $("prog-title").textContent = t("zip_compressing");
  $("prog-desc").textContent = t("zip_bundling");
  // JPEG は元々圧縮済みなので STORE で時間短縮
  const blob = await zip.generateAsync(
    { type: "blob", compression: "STORE" },
    (meta) => {
      $("prog-fill").style.width = meta.percent.toFixed(1) + "%";
      $("prog-count").textContent = t("zip_bundling_pct", meta.percent.toFixed(0));
    },
  );
  // 圧縮フェーズ中のキャンセル (Cancel/Esc は packAbort を立てるだけで generateAsync は
  // 走り切る) をここで拾う。捨てるのは生成済み blob だけなので保存せず終了する
  if (state.packAbort) { hideProgress(); return; }
  saveBlob(blob, zipName);
  hideProgress();
  if (failed > 0) {
    setTimeout(() => alert(t("zip_failed", failed)), 100);
  }
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  // 大きい ZIP のダウンロード完了前に revoke すると壊れるので長めに遅延
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// すべてのZIPに共通でプレフィックスを付けて、DLフォルダ内で識別しやすくする
export const ZIP_PREFIX = "OpenLeagueDisplay";

export function downloadChampion(c) {
  const items = c.skins.filter(s => s.splash).map(s => itemFor(c, s));
  // ZIP のファイル名/内部パスは英語固定 (locale 非依存にして、複数 locale で
  // 同じファイル名・配布物を作れるようにする / 古いツールの非ASCII問題回避)。
  // 進捗テキストだけは UI と整合させて翻訳名で出す
  downloadAsZip(items, `${ZIP_PREFIX}-${safeName(c.name)}.zip`, {
    desc: t("zip_pack_desc", champName(c), items.length),
  });
}
export function downloadLine(lid, lineName, items) {
  const packItems = items.filter(it => it.skin.splash).map(it => itemFor(it.champ, it.skin));
  downloadAsZip(packItems, `${ZIP_PREFIX}-${safeName(lineName)}.zip`, {
    desc: t("zip_pack_desc", lineName, packItems.length),
  });
}
export function downloadSelected() {
  const items = buildItemsFromSelected();
  if (!items.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  downloadAsZip(items, `${ZIP_PREFIX}-${stamp}.zip`, {
    desc: t("zip_pack_desc_selected", items.length),
  });
}
