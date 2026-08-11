# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — OpenLeagueDisplay local executable
=====================================================
Bundles `local_app.py` together with the static assets (HTML/CSS/JS/data). Only
this spec (text) lives in the repo; the generated binaries are not committed
(they are distributed as Release assets).

Build (assumes PyInstaller 6.x):
    pip install pyinstaller pywebview
    pyinstaller local_app.spec
    # Windows    → dist/OpenLeagueDisplay/OpenLeagueDisplay.exe  (+ _internal/)
    # macOS/Linux → dist/OpenLeagueDisplay

datas can be written OS-independently (avoids the --add-data ';' / ':' separator
problem). At runtime, local_app.py serves the bundled files from sys._MEIPASS
(= BASE_DIR) — PyInstaller sets that in BOTH modes (onedir points it at the
`_internal` folder), so the app code needs no branch of its own.
"""

import sys

# WINDOWS IS ONEDIR, EVERYTHING ELSE IS ONEFILE.
# A onefile build re-extracts its whole payload into a temp dir on EVERY launch, which costs
# seconds of startup and makes the app feel like a script rather than an installed program. Its
# bootloader is also a well-known antivirus false-positive trigger. Windows is where we ship a real
# installer (installer/windows.iss just copies this folder into {app}), so there the single-file
# packaging bought nothing and cost startup time — hence onedir.
# macOS / Linux stay onefile deliberately: they have no installer, so their Release asset IS the
# thing you download and run, and a bare binary beats "unzip a folder first".
ONEDIR = sys.platform == "win32"

# On Windows, embed the repo-committed icon.ico into the exe (so the correct icon
# shows in the taskbar, etc.). On mac/linux don't use the .ico and pass None =
# default icon (PyInstaller's mac icon is the different .icns format, so we don't pass it).
_icon = "icon.ico" if sys.platform == "win32" else None

# Static assets to bundle. (source, destination) tuples. Directories are copied recursively as-is.
datas = [
    ("index.html", "."),
    ("styles.css", "."),
    ("favicon.svg", "."),
    ("icon-maskable.svg", "."),
    ("manifest.webmanifest", "."),
    ("sw.js", "."),
    ("data.json", "."),
    # Passed at runtime as the native window icon (taskbar/titlebar). A separate
    # path from the exe embedding (the icon= one), to show reliably regardless of
    # icon-extraction failure under UPX compression.
    ("icon.ico", "."),
    ("js", "js"),
    ("i18n", "i18n"),
    # The pre-rendered SEO pages (174 files / ~2MB). They exist for crawlers, which never see
    # this build — but index.html's footer and its <noscript> both link to champions/, and sw.js
    # precaches ./champions/index.html. Leaving them out made those links 404 and, worse, failed
    # the service worker's install outright (cache.addAll is all-or-nothing). Cheap against a
    # ~20-35MB binary, so ship them rather than special-casing the frontend per build target.
    ("champions", "champions"),
]

a = Analysis(
    ["local_app.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    # pywebview's backend is lazily imported, so declare it explicitly for
    # environments where PyInstaller fails to pick it up. Unnecessary if the hook
    # bundled with pywebview takes effect.
    hiddenimports=["webview"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

# Options shared by both packaging modes. upx=False on purpose: UPX-packed binaries are a
# classic antivirus false-positive trigger, and the size it saves is redundant here anyway —
# both distribution channels compress already (Inno Setup uses lzma2, the portable download is
# a zip). It also broke icon extraction from the exe (see local_app.py's start_kwargs note).
_exe_opts = dict(
    name="OpenLeagueDisplay",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    console=False,   # GUI app (native window), so don't show a console
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icon,
)

if ONEDIR:
    # onedir: EXE holds only the launcher (exclude_binaries), and COLLECT lays the binaries and
    # data out next to it as a real folder — nothing to unpack at launch.
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, **_exe_opts)
    coll = COLLECT(
        exe,
        a.binaries,
        a.datas,
        strip=False,
        upx=False,
        upx_exclude=[],
        name="OpenLeagueDisplay",
    )
else:
    # onefile: hand a.binaries / a.datas straight to EXE and create no COLLECT.
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], runtime_tmpdir=None, **_exe_opts)
