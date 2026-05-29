# OpenLeagueDisplay

[![Update splash data](https://github.com/badfalcon/OpenLeagueDisplay/actions/workflows/update.yml/badge.svg)](https://github.com/badfalcon/OpenLeagueDisplay/actions/workflows/update.yml)
[![Pages deploy](https://github.com/badfalcon/OpenLeagueDisplay/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/badfalcon/OpenLeagueDisplay/actions/workflows/pages/pages-build-deployment)
[![Last commit](https://img.shields.io/github/last-commit/badfalcon/OpenLeagueDisplay?label=last%20update)](https://github.com/badfalcon/OpenLeagueDisplay/commits)
[![License: MIT](https://img.shields.io/github/license/badfalcon/OpenLeagueDisplay?color=c89b3c)](./LICENSE)
[![Locales](https://img.shields.io/badge/locales-20-c89b3c?style=flat)](./i18n)
[![Powered by Community Dragon](https://img.shields.io/badge/data-Community%20Dragon-010a13?style=flat&labelColor=c89b3c)](https://www.communitydragon.org/)
[![Not affiliated with Riot Games](https://img.shields.io/badge/Riot%20Games-not%20affiliated-555?style=flat)](https://www.riotgames.com/en/legal)

> **<https://badfalcon.github.io/OpenLeagueDisplay/>** — open it in a browser and it just works.

![screenshot](./screenshot.png)

Riot's official LeagueDisplays app has been sitting abandoned since 2021, and
they're clearly not coming back to it. **OpenLeagueDisplay** is a community
stand-in for the people who still want that experience — a League of Legends
splash art viewer where you can browse every champion × every skin in the
browser and bulk-download the ones you like as a ZIP for a local wallpaper
slideshow.

It is a fully static site. Images are loaded directly from the
**Community Dragon CDN** — none are stored in this repo. New skins are picked
up automatically every week by a GitHub Actions job, so the catalog stays
current without anyone babysitting it.

## Contents

- [For users](#for-users)
  - [Features](#features)
  - [Controls](#controls)
  - [About the ZIP download](#about-the-zip-download)
  - [Desktop app (set wallpaper directly)](#desktop-app-set-wallpaper-directly)
- [For developers](#for-developers)
  - [How it works](#how-it-works)
  - [Repository layout](#repository-layout)
  - [Running locally](#running-locally)
  - [Building the desktop app](#building-the-desktop-app)
  - [Deploying it to your own account](#deploying-it-to-your-own-account)
  - [Disabling the auto-update](#disabling-the-auto-update)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## For users

Nothing to install — just open
**<https://badfalcon.github.io/OpenLeagueDisplay/>**. On a phone you can also
"Add to Home Screen" to run it as an installed app.

### Features

- **Browse every skin**: by champion, or by skin line (PROJECT, Star Guardian, K/DA, ...)
- **Bulk ZIP download**: grab the skins you selected, every skin of a champion,
  or every skin in a skin line in one shot. Extract locally and point Windows'
  "Background → Slideshow" at the folder for a LeagueDisplays-style wallpaper
  rotation.
- **Desktop app (set wallpaper directly)**: an optional native build lets you
  set any splash as your desktop wallpaper in one click — or rotate your gallery
  on a timer — without downloading/extracting anything. See
  [Desktop app](#desktop-app-set-wallpaper-directly) below.
- **Slideshow**: full-screen playback with Ken Burns + crossfade
- **Search / filter**: cross-keyword search over champion name, skin name, role
  (Mage / Tank / ...), region of origin (Demacia / Noxus / ...) and rarity
  (Legendary / Ultimate / ...)
- **20 locales**: flag picker for English, 日本語, 한국어, 简体中文, Français,
  Deutsch and more (champion names, skin names and UI strings are localized;
  the choice is persisted)
- **Installable PWA**: add it to your phone's home screen; the app shell is
  cached by a service worker so the UI loads even on a flaky connection
- **Mobile-friendly**: responsive layout for phones

### Controls

| Key / action | What it does |
|---|---|
| Click | champion → skin → fullscreen |
| `←` / `→` | previous / next splash |
| `Esc` | back / exit fullscreen |
| `Space` | pause the slideshow |
| Search bar | filter by champion / skin name, role, region, rarity (e.g. "Mage", "Demacia", "Legendary") |
| Skin lines | header button opens the skin-line index |
| Language | header flag button picks one of 20 locales (remembered next time) |
| Selection mode | tick skins, then header "⬇ ZIP selected" downloads them in one ZIP |
| Champion page | "⬇ ZIP all skins" downloads every skin for that champion |
| Skin-line page | "⬇ ZIP this line" downloads every skin in that skin line |

### About the ZIP download

- **Flat file layout** inside the ZIP — `<Champion>_<Skin>.jpg` at the root, no
  per-champion subfolder. This is intentional: Windows' wallpaper slideshow
  only scans the folder you point it at, not subfolders, so a flat layout
  makes the extracted ZIP drop-in usable.
- **Stored uncompressed** (JPEGs are already compressed; this keeps zipping fast).
- **Fetched directly from CDragon** with a concurrency of 6. Skins that return
  404 on CDragon are silently skipped and counted in the final summary.

### Desktop app (set wallpaper directly)

The web version can't touch your wallpaper (browsers are sandboxed). For the
full LeagueDisplays experience — pick a splash, click, it's your wallpaper — run
the **local app**, which is the exact same UI wrapped in a native window plus a
tiny local helper that sets the wallpaper for you.

- **Download a build** from the [Releases](../../releases) page
  (`OpenLeagueDisplay-windows.exe` / `-macos` / `-linux`) and run it. It opens
  a native window; in any splash a **★ Set as wallpaper** button appears, and
  **My Gallery** gains a **🖥 Slideshow on desktop** toggle with a rotation
  interval picker (1 / 5 / 15 / 30 / 60 min, remembered next time).
- **Or run from source**: `python local_app.py` (Python 3.7+). `pip install
  pywebview` for the native window; without it, it just opens your default
  browser. The same site on GitHub Pages is unaffected — the wallpaper UI only
  appears when the local helper is detected.
- **Platform notes**: Windows uses the desktop wallpaper API (fill style),
  macOS uses `osascript`, Linux uses GNOME `gsettings` with an `feh` fallback.
  On Windows 10 the native window needs Microsoft's WebView2 runtime (bundled on
  Windows 11); if it's missing, install the Evergreen Runtime or the app falls
  back to the browser. macOS builds are unsigned, so Gatekeeper will warn on
  first launch (right-click → Open).

---

## For developers

### How it works

- `data.json` is built from Community Dragon's `champion-summary.json` and the
  per-champion `champions/{id}.json` files (~1.1 MB / ~75 KB gzipped).
- Image URLs (`splash`, `tile`, `loading`) point directly at
  `https://raw.communitydragon.org/latest/...`. No images are stored in the
  repo.
- The browser fetches `data.json` once on load; thumbnails are pulled from the
  CDN on demand via `<img loading="lazy">`.
- **i18n**: `data.json` only carries the English names (CDragon's `default`
  locale). The 19 other LoL client locales (`ja_jp`, `ko_kr`, `zh_cn`, ... —
  20 languages total with English) live in `i18n/<locale>.json` and are
  fetched only when the user picks that language, so English users pay zero
  extra bandwidth.
- **PWA**: `sw.js` caches the app shell (HTML/CSS/JS/icons) stale-while-revalidate
  and serves `data.json` / `i18n/*.json` network-first. Splash images from
  CDragon are not cached, so full offline use (with images) is not supported.

For the rationale behind the design decisions (why images aren't kept in the
repo, why CDragon rather than Data Dragon, etc.), see [`CLAUDE.md`](./CLAUDE.md).

### Repository layout

```
.
├── index.html                       # The viewer markup (loads styles.css + js/app.js)
├── styles.css                       # All styling (CSS variables for theme)
├── js/                              # ES Modules
│   ├── app.js                       #   entry: data.json fetch + event wiring
│   ├── state.js                     #   shared state, DATA, indexes, utilities
│   ├── i18n.js                      #   UI_STRINGS, locale loader, name maps
│   ├── render.js                    #   view rendering (home / champion / lines / line)
│   ├── zip.js                       #   bulk ZIP download (JSZip)
│   ├── lightbox.js                  #   fullscreen viewer + slideshow
│   └── local.js                     #   local-app detection + wallpaper/slideshow API client
├── sw.js                            # Service Worker (app-shell cache)
├── manifest.webmanifest             # PWA manifest (install / add to home screen)
├── favicon.svg                      # Site icon (also the manifest "any" icon)
├── icon-maskable.svg                # PWA maskable icon
├── data.json                        # Champion / skin manifest (~1.1 MB)
├── i18n/<locale>.json               # Per-locale name dictionaries (19 locales, ~15-160 KB each)
├── generate_data.py                 # Builds data.json + i18n/*.json (stdlib only)
├── serve.py                         # Thin wrapper around http.server for local serving
├── local_app.py                     # Local app server: static + /api wallpaper (stdlib + optional pywebview)
├── local_app.spec                   # PyInstaller spec for the desktop build
├── .github/workflows/update.yml     # Weekly auto-update (Mondays 09:00 JST)
├── .github/workflows/release.yml    # Build & publish desktop binaries on tag push
├── .idea/runConfigurations/         # PyCharm Run Configurations, checked in
├── CLAUDE.md                        # Design notes & conventions (developer-facing)
├── LICENSE                          # MIT (covers the repository's code)
├── ogp.png                          # Open Graph / Twitter Card share image
├── screenshot.png                   # README screenshot
└── README.md
```

### Running locally

```bash
# Only needed the first time, or to refresh the manifest
# (builds data.json and i18n/*.json)
python generate_data.py

# Serve it (uses only the Python standard library)
python serve.py
# → http://127.0.0.1:8000
```

For the **desktop app** (with the wallpaper helper) run `local_app.py` instead of
`serve.py` — same static site, plus the `/api` endpoints that set the wallpaper.
`pip install pywebview` for a native window; otherwise it opens your browser.
Requires Python 3.7+ (`ThreadingHTTPServer` / `directory=`).

There is no build step and no package dependency. The front-end is plain
vanilla JS (ES Modules) plus JSZip (loaded from a CDN). Open the page through
`python serve.py` rather than `file://` directly — ES Modules require an HTTP
origin to load. PyCharm users get the "Generate data.json" and
"Serve (http.server :8000)" Run Configurations under `.idea/runConfigurations/`
for free.

If a corporate proxy makes CDragon fail with `CERTIFICATE_VERIFY_FAILED`, you
can bypass certificate verification with
`LOL_INSECURE=1 python generate_data.py` (or
`$env:LOL_INSECURE=1; python generate_data.py` in PowerShell).

### Building the desktop app

The cross-platform binaries on the Releases page are built by
`.github/workflows/release.yml`, which runs on every `v*` tag push: it builds on
Windows / macOS / Linux runners with PyInstaller and uploads each binary as a
release asset (the binaries are **never committed** to the repo). To build one
yourself:

```bash
pip install pyinstaller pywebview
pyinstaller local_app.spec
# → dist/OpenLeagueDisplay(.exe)
```

`local_app.spec` bundles the static assets (HTML/CSS/`js/`/`data.json`/`i18n/`),
so the binary is self-contained. The bundled `data.json` is a **snapshot from
build time** — cut a fresh release (or rerun `generate_data.py` + rebuild) to
refresh it.

### Deploying it to your own account

≈5 minutes if you have Python installed.

1. **Create a new repo** (e.g. `OpenLeagueDisplay`).
2. **Push the contents of this folder**:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo>.git
   git push -u origin main
   ```
3. **Generate the first `data.json`**:
   ```bash
   python generate_data.py
   git add data.json && git commit -m "initial data" && git push
   ```
   (Or trigger it from the Actions tab: "Update splash data" → "Run workflow".)
4. **Enable GitHub Pages**: repo Settings → Pages → Source = "Deploy from a
   branch", Branch = `main`, Folder = `/ (root)` → Save.
5. After a minute or two it's live at
   `https://<your-username>.github.io/<repo>/`.

### Disabling the auto-update

Delete `.github/workflows/update.yml`, or comment out its `schedule:` section.
You can always refresh `data.json` manually by running
`python generate_data.py`.

---

## License

The source code in this repository is distributed under the **MIT License**
([`LICENSE`](./LICENSE)). The images and game data fetched at runtime from
Community Dragon are **copyright Riot Games, Inc.** and are *not* covered by
the MIT license — please avoid redistribution or commercial use beyond
personal use.

## Disclaimer

OpenLeagueDisplay isn't endorsed by Riot Games and doesn't reflect the views
or opinions of Riot Games or anyone officially involved in producing or
managing League of Legends. League of Legends and Riot Games are trademarks
or registered trademarks of Riot Games, Inc.

It only references assets that Community Dragon publishes under Riot's
"Legal Jibber Jabber" policy; it does not talk to Riot's client or API
directly.
