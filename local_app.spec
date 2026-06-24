# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — OpenLeagueDisplay local executable
=====================================================
Bundles `local_app.py` into a single file along with the static assets
(HTML/CSS/JS/data). Only this spec (text) lives in the repo; the generated
binaries are not committed (they are distributed as Release assets).

Build (assumes PyInstaller 6.x):
    pip install pyinstaller pywebview
    pyinstaller local_app.spec
    # → dist/OpenLeagueDisplay(.exe)

datas can be written OS-independently (avoids the --add-data ';' / ':' separator
problem). At runtime, local_app.py serves the bundled files from sys._MEIPASS
(= BASE_DIR).
"""

import sys

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

# onefile: pass a.binaries / a.datas to EXE (don't create a COLLECT).
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="OpenLeagueDisplay",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,   # GUI app (native window), so don't show a console
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icon,
)
