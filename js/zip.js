// ZIP download: bulk download of selected skins / per champion / per skin line.
// Fetch directly from CDragon → pack in-browser with JSZip → save the blob via a.download.
// Uses no GitHub bandwidth (there's no Pages → CDragon path; it's direct browser ↔ CDragon traffic).

import { state, $, SKIN_BY_KEY, trapFocus, setBackgroundInert, clearBackgroundInert } from "./state.js";
import { t, champName } from "./i18n.js";

// Focus-trap release function for the progress overlay (installed in showProgress, released in hideProgress).
let releaseTrap = null;

// Legal notice bundled into every ZIP. The download is the point where Riot's splash art actually
// lands on the user's disk, detached from the site (where the footer disclaimer lives), so the terms
// travel with the files. Kept in English / locale-independent like the in-ZIP filenames and paths.
// A .txt is ignored by OS wallpaper slideshows (they scan the folder for images), so it doesn't
// disturb rotation. Mirrors the README's License/Disclaimer sections.
const ZIP_NOTICE =
`OpenLeagueDisplay — https://github.com/badfalcon/OpenLeagueDisplay

The images in this archive are League of Legends splash art, copyright Riot Games, Inc.
They are provided for personal, non-commercial use only (e.g. setting your own desktop
wallpaper). Please do not redistribute them or use them commercially.

OpenLeagueDisplay is fan-made under Riot Games' "Legal Jibber Jabber" policy
(https://www.riotgames.com/en/legal) and is not endorsed by Riot Games. League of Legends
and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
`;


export function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim() || "_";
}
export function extOf(url) {
  const m = /\.([a-zA-Z0-9]{2,4})(?:\?|$)/.exec(url);
  return m ? "." + m[1].toLowerCase() : ".jpg";
}
// Build a { champ, skin, url, path } list from the array of "Aatrox//Justicar Aatrox" keys
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
    // In-ZIP path is flat: <Champion>_<SkinName>.jpg.
    // Windows wallpaper slideshows etc. only scan directly inside the chosen folder, so splitting
    // into subfolders would make wallpaper rotation miss the files.
    // Filename collisions (Classic.jpg would occur for every champion) are avoided by the champion name.
    path: `${safeName(c.name)}_${safeName(skinName)}${extOf(s.splash)}`,
  };
}

// Concurrency-limited parallel execution (at most `concurrency` at a time)
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
  // Trap focus so Tab can't escape to the background (released in hideProgress)
  if (releaseTrap) releaseTrap();
  releaseTrap = trapFocus(ov);
  // Move focus to Cancel to give keyboard/SR a starting point (consistent with other modals)
  $("prog-cancel").focus();
}
export function updateProgress(done, total, failed) {
  // To cut render cost, skip if less than 100ms since the last update (the final frame is called separately)
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

// Wait until JSZip has finished loading (it's deferred, so it can arrive after init)
export function ensureJSZip() {
  return new Promise((resolve, reject) => {
    if (typeof JSZip !== "undefined") return resolve();
    const start = performance.now();
    // Name the interval-ID variable differently so it doesn't shadow the outer i18n function `t()`
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
  // Bundle the legal/usage notice alongside the images (locale-independent, fixed name).
  zip.file("README.txt", ZIP_NOTICE);
  updateProgress(items.length, items.length, failed);
  $("prog-title").textContent = t("zip_compressing");
  $("prog-desc").textContent = t("zip_bundling");
  // JPEG is already compressed, so STORE saves time
  const blob = await zip.generateAsync(
    { type: "blob", compression: "STORE" },
    (meta) => {
      $("prog-fill").style.width = meta.percent.toFixed(1) + "%";
      $("prog-count").textContent = t("zip_bundling_pct", meta.percent.toFixed(0));
    },
  );
  // Catch cancellation during the compression phase (Cancel/Esc only set packAbort while
  // generateAsync runs to completion). The only thing discarded is the generated blob, so bail out without saving.
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
  // Revoking before a large ZIP finishes downloading corrupts it, so delay generously
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Prefix every ZIP the same way so it's easy to spot in the downloads folder
export const ZIP_PREFIX = "OpenLeagueDisplay";

export function downloadChampion(c) {
  const items = c.skins.filter(s => s.splash).map(s => itemFor(c, s));
  // ZIP filename / internal paths are fixed to English (locale-independent, so the same filenames
  // and artifacts are produced across locales / avoids non-ASCII issues with older tools).
  // Only the progress text uses the translated name to stay consistent with the UI.
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
