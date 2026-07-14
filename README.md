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
they're clearly not coming back to it. **OpenLeagueDisplay** is the community
successor for the people who still want that experience: browse every League of
Legends champion × every skin, find one you love, and **set it as your desktop
wallpaper in one click** — exactly what LeagueDisplays did.

That one-click wallpaper lives in the
**[desktop app](#desktop-app-set-wallpaper-directly)** (browsers are sandboxed
out of your wallpaper). The
**[web version](https://badfalcon.github.io/OpenLeagueDisplay/)** is the
no-install way to browse from anywhere — your phone included — and, since it
can't touch your wallpaper, it hands you the skins you pick as a ZIP instead.
You can even build up a selection in the browser and send it straight to the
desktop app to set.

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
- **Set wallpaper directly (desktop app)** — *the headline feature*: in the
  native build, click any splash in the viewer and it becomes your desktop
  wallpaper instantly. Pick several in My Gallery for an OS-native slideshow, or
  hand a selection over from the web version. The OS keeps any slideshow rotating
  even after you close the app. See
  [Desktop app](#desktop-app-set-wallpaper-directly) below.
- **Bulk ZIP download** (web fallback): browsers are sandboxed out of your
  wallpaper, so the web version instead lets you grab the skins you selected,
  every skin of a champion, or a whole skin line as one ZIP. Extract locally and
  point Windows' "Background → Slideshow" at the folder for a LeagueDisplays-style
  rotation. (The desktop app skips all of this.)
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
| 🖥 in fullscreen | *(desktop app only)* set the splash you're viewing as wallpaper, instantly |

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
full LeagueDisplays experience — see a splash you like, make it your wallpaper —
run the **desktop app**: the exact same UI wrapped in a native window, plus a
tiny local helper that sets the wallpaper for you.

- **Download a build** from the [Releases](../../releases) page and run it. Then:
  - **One-click from the viewer** *(the simple path)*: open any splash and click
    the **🖥** button in the top bar — it's your wallpaper, instantly. This is the
    whole idea: see it, set it.
  - **Several at once (slideshow)**: tick splashes in **My Gallery**, click
    **🖥 Set as wallpaper**, and apply. **One** image becomes a static wallpaper;
    **two or more** become a desktop **slideshow** with a change interval
    (1 / 5 / 15 / 30 / 60 min). The slideshow uses your OS's *native* slideshow
    (Windows `IDesktopWallpaper`, macOS System Events, GNOME slideshow XML), so it
    keeps rotating even after you close the app and shows up correctly as a
    slideshow in your system settings.
  - **Sent from the web**: browsing on the [web version](https://badfalcon.github.io/OpenLeagueDisplay/)?
    Build a selection in My Gallery there and click **🖥 Open in desktop app** — your
    picks open in the desktop app ready to set. On Windows this goes through an
    `openleaguedisplay://` link, so the app is **launched for you** even if it wasn't
    running (your browser will ask "Open OpenLeagueDisplay?" first). That link only
    works with the **installer** build below — the portable exe never registers it, and
    on macOS / Linux the app has to be running already. Picking on a *different* device
    (phone → PC)? Use **⬆ Export selection** to save a small file and **⬇ Import
    selection** to load it on the other end — that works everywhere.
  - **Windows — installer (recommended):**
    `OpenLeagueDisplay-windows-setup.exe` installs per-user (no admin prompt),
    adds a **Start Menu** entry and an optional **desktop shortcut**, registers the
    `openleaguedisplay://` link the web version uses to hand a gallery over, and
    registers an **uninstaller** under *Settings → Apps → Installed apps*. The
    builds are **unsigned**, so SmartScreen warns on first run — click **More
    info → Run anyway**. Uninstalling removes the app but **keeps your wallpaper
    cache** (`%LOCALAPPDATA%\OpenLeagueDisplay`) so the current wallpaper isn't
    broken; delete that folder by hand if you want it gone too.
  - **Windows — portable:** `OpenLeagueDisplay-windows.exe` is the same app with
    no installer — just download and run. One difference: it does **not** register the
    `openleaguedisplay://` link (an app that claimed the link on every start could
    silently steal it from an installed copy), so **🖥 Open in desktop app** on the web
    version won't reach it — use **⬆ Export selection** / **⬇ Import selection** instead.
  - **macOS / Linux:** `OpenLeagueDisplay-macos` / `-linux` — download and run.
- **Or run from source**: `python local_app.py` (Python 3.7+). `pip install
  pywebview` for the native window; without it, it just opens your default
  browser. The same site on GitHub Pages is unaffected — the wallpaper UI only
  appears when the local helper is detected.
- **Platform notes**: Windows uses the `IDesktopWallpaper` COM API (fill style;
  falls back to the legacy `SystemParametersInfoW` if unavailable), macOS uses
  System Events via `osascript`, Linux uses GNOME `gsettings` with an `feh`
  fallback (single image only on non-GNOME).
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
│   ├── lightbox.js                  #   fullscreen viewer + (in-app) slideshow
│   ├── local.js                     #   local-app detection + wallpaper API client
│   ├── wallpaper.js                 #   wallpaper confirm modal (select → confirm → apply)
│   └── desktop.js                   #   desktop-app promotion + web→native selection hand-off (Web only)
├── sw.js                            # Service Worker (app-shell cache)
├── manifest.webmanifest             # PWA manifest (install / add to home screen)
├── favicon.svg                      # Site icon (also the manifest "any" icon)
├── icon-maskable.svg                # PWA maskable icon
├── icon.ico                         # Windows app icon (exe / installer / shortcuts)
├── make_icon.py                     # Regenerates icon.ico from favicon.svg (Pillow)
├── data.json                        # Champion / skin manifest (~1.1 MB)
├── i18n/<locale>.json               # Per-locale name dictionaries (19 locales, ~15-160 KB each)
├── generate_data.py                 # Builds data.json + i18n/*.json (stdlib only)
├── serve.py                         # Thin wrapper around http.server for local serving
├── local_app.py                     # Local app server: static + /api wallpaper (stdlib + optional pywebview)
├── local_app.spec                   # PyInstaller spec for the desktop build
├── installer/windows.iss            # Inno Setup script for the Windows installer
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
release asset (the binaries are **never committed** to the repo). The release
notes (changelog) are auto-generated by GitHub from the PRs merged since the
previous tag — categorized per `.github/release.yml` — so there's no
hand-maintained `CHANGELOG.md` to keep in sync. To build one yourself:

```bash
pip install pyinstaller pywebview
pyinstaller local_app.spec
# → dist/OpenLeagueDisplay(.exe)
```

`local_app.spec` bundles the static assets (HTML/CSS/`js/`/`data.json`/`i18n/`),
so the binary is self-contained. The bundled `data.json` is a **snapshot from
build time** — cut a fresh release (or rerun `generate_data.py` + rebuild) to
refresh it.

On Windows the workflow also produces a proper installer with
[Inno Setup](https://jrsoftware.org/isinfo.php) (`installer/windows.iss`). The
app icon (`icon.ico`) is a small committed brand asset (like `ogp.png`),
embedded into the exe by `local_app.spec` and used for the installer and
shortcuts. It's drawn from `favicon.svg` by `make_icon.py` — re-run that and
commit the result only when the brand changes:

```powershell
# (only when the brand changes) regenerate icon.ico from favicon.svg
uv run --with pillow python make_icon.py   # or: pip install pillow; python make_icon.py
```

To build the installer yourself:

```powershell
# 1. build the exe (embeds icon.ico on Windows)
pyinstaller local_app.spec
# 2. compile the installer (Inno Setup 6 → ISCC.exe)
ISCC.exe /DAppVersion=1.2.3 installer\windows.iss
# → installer\out\OpenLeagueDisplay-windows-setup.exe
```

`build_installer.py` does both steps for you — it **rebuilds the exe first**,
then locates `ISCC.exe` (PATH, `Program Files`, or winget's per-user
`%LOCALAPPDATA%\Programs\Inno Setup 6`) and compiles the installer — e.g.
`python build_installer.py 1.2.3` (version defaults to `dev`). The rebuild is
the default on purpose: the installer just wraps whatever
`dist/OpenLeagueDisplay.exe` already is, and the exe bundles the whole frontend,
so compiling the installer against a stale exe "succeeds" while silently
shipping old code. Pass `--skip-exe` to wrap the existing exe as-is (its build
time is printed so you can tell how old it is). Inno Setup is free/open-source:
`winget install JRSoftware.InnoSetup`.

In PyCharm, **Run ▸ "Build installer (Inno Setup)"** runs the whole chain
(**"Build desktop exe (PyInstaller)"** still exists for building just the exe);
**"Run desktop app (local_app.py)"** launches the local wallpaper mode. (Build
outputs `dist/`, `build/`, `installer/out/` are git-ignored — binaries aren't
committed.)

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
6. *(Only if you also build the desktop app)* The web→desktop detection and
   direct hand-off are CORS-gated to the official Pages origin. Change
   `CORS_ALLOWED_ORIGINS` in `local_app.py` to your own origin
   (`https://<your-username>.github.io`) and rebuild the desktop binaries, or
   your deployment falls back to the old fire-and-forget scheme link (still
   works — you just get no connection status or send confirmation). The CSP in
   `index.html` already allows `http://127.0.0.1:8000`, no change needed there.

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

The released desktop binaries bundle the MIT-licensed app plus a `data.json`
metadata snapshot (champion/skin names and CDragon URLs — the same data already
served publicly by the web version). Splash **images are not bundled**; they are
fetched from Community Dragon at runtime onto your own machine for personal
wallpaper use. The terms above apply equally to the binaries.

## Disclaimer

OpenLeagueDisplay isn't endorsed by Riot Games and doesn't reflect the views
or opinions of Riot Games or anyone officially involved in producing or
managing League of Legends. League of Legends and Riot Games are trademarks
or registered trademarks of Riot Games, Inc.

It only references assets that Community Dragon publishes under Riot's
"Legal Jibber Jabber" policy; it does not talk to Riot's client or API
directly.
