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
they're clearly not coming back to it. OpenLeagueDisplay is a community
stand-in for the people who still want that experience — a League of Legends
splash art viewer where you can browse every champion × every skin in the
browser and bulk-download the ones you like as a ZIP for a local wallpaper
slideshow.

It is a fully static site. Images are loaded directly from the
**Community Dragon CDN**. New skins are picked up automatically every week by a
GitHub Actions job, so the catalog stays current without anyone babysitting it.

---

## Features

- **Browse every skin**: by champion, or by skin line (PROJECT, Star Guardian, K/DA, ...)
- **Bulk ZIP download**: grab the skins you selected, every skin of a champion,
  or every skin in a skin line in one shot. Extract locally and point Windows'
  "Background → Slideshow" at the folder for a LeagueDisplays-style wallpaper
  rotation.
- **Slideshow**: full-screen playback with Ken Burns + crossfade
- **Search / filter**: cross-keyword search over champion name, skin name, role
  (Mage / Tank / ...), region of origin (Demacia / Noxus / ...) and rarity
  (Legendary / Ultimate / ...)
- **20 locales**: flag picker for English, 日本語, 한국어, 简体中文, Français,
  Deutsch and more (champion names, skin names and UI strings are localized;
  the choice is persisted)
- **Mobile-friendly**: responsive layout for phones

## Controls

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

- File layout inside the ZIP: flat — `<Champion>_<Skin>.jpg` at the root, no
  per-champion subfolder. This is intentional: Windows' wallpaper slideshow
  only scans the folder you point it at, not subfolders, so a flat layout
  makes the extracted ZIP drop-in usable.
- Stored uncompressed (JPEGs are already compressed; this keeps zipping fast)
- Fetched directly from CDragon with a concurrency of 6. Skins that return 404
  on CDragon are silently skipped and counted in the final summary.

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
- i18n: `data.json` only carries the English names (CDragon's `default`
  locale). The 19 other LoL client locales (`ja_jp`, `ko_kr`, `zh_cn`, ... —
  20 languages total with English) live in `i18n/<locale>.json` and are
  fetched only when the user picks that language, so English users pay zero
  extra bandwidth.

For the rationale behind the design decisions (why images aren't kept in the
repo, why CDragon rather than Data Dragon, etc.), see [`CLAUDE.md`](./CLAUDE.md).

### Repository layout

```
.
├── index.html                       # The viewer (HTML + CSS + JS, single file)
├── data.json                        # Champion / skin manifest (~1.1 MB)
├── i18n/<locale>.json               # Per-locale name dictionaries (19 locales, ~15-160 KB each)
├── generate_data.py                 # Builds data.json + i18n/*.json (stdlib only)
├── serve.py                         # Thin wrapper around http.server for local serving
├── .github/workflows/update.yml     # Weekly auto-update (Mondays 09:00 JST)
├── .idea/runConfigurations/         # PyCharm Run Configurations, checked in
├── CLAUDE.md                        # Design notes & conventions (developer-facing)
├── LICENSE                          # MIT (covers the repository's code)
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

There is no build step and no package dependency. The front-end is plain
vanilla JS plus JSZip (loaded from a CDN). PyCharm users get the
"Generate data.json" and "Serve (http.server :8000)" Run Configurations under
`.idea/runConfigurations/` for free.

If a corporate proxy makes CDragon fail with `CERTIFICATE_VERIFY_FAILED`, you
can bypass certificate verification with
`LOL_INSECURE=1 python generate_data.py` (or
`$env:LOL_INSECURE=1; python generate_data.py` in PowerShell).

### Deploying it to your own account (≈5 minutes if you have Python)

1. **Create a new repo** (e.g. `OpenLeagueDisplay`).
2. Push the contents of this folder:
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

This project is not endorsed by Riot Games. It only references assets that
Community Dragon publishes under Riot's "Legal Jibber Jabber" policy; it does
not talk to Riot's client or API directly.
