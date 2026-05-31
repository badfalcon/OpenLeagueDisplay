# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — OpenLeagueDisplay ローカル実行ファイル
=========================================================
`local_app.py` を 1 ファイルにまとめ、静的アセット (HTML/CSS/JS/データ) を同梱する。
リポジトリにはこの spec (テキスト) だけを置き、生成バイナリはコミットしない
(Release アセットとして配布する)。

ビルド (PyInstaller 6.x 想定):
    pip install pyinstaller pywebview
    pyinstaller local_app.spec
    # → dist/OpenLeagueDisplay(.exe)

datas は OS 非依存に書ける (--add-data の ';' / ':' 区切り問題を回避できる)。
実行時、local_app.py は同梱物を sys._MEIPASS (= BASE_DIR) から配信する。
"""

import sys

# Windows ではリポジトリにコミット済みの icon.ico を exe に埋め込む (タスクバー等で
# 正しいアイコンが出る)。mac/linux では .ico を使わず None = デフォルトアイコン
# (PyInstaller の mac アイコンは .icns 形式で別物なので渡さない)。
_icon = "icon.ico" if sys.platform == "win32" else None

# 同梱する静的アセット。(ソース, 展開先) のタプル。ディレクトリはそのまま再帰コピー。
datas = [
    ("index.html", "."),
    ("styles.css", "."),
    ("favicon.svg", "."),
    ("icon-maskable.svg", "."),
    ("manifest.webmanifest", "."),
    ("sw.js", "."),
    ("data.json", "."),
    # 実行時にネイティブ窓のアイコンとして渡す (タスクバー/タイトルバー)。exe 埋め込み
    # (icon= の方) とは別経路で、UPX 圧縮でのアイコン抽出失敗に左右されず確実に出すため。
    ("icon.ico", "."),
    ("js", "js"),
    ("i18n", "i18n"),
]

a = Analysis(
    ["local_app.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    # pywebview のバックエンドは遅延 import されるため、PyInstaller が拾い損ねる
    # 環境では明示する。pywebview 同梱のフックが効けば不要。
    hiddenimports=["webview"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

# onefile: a.binaries / a.datas を EXE に渡す (COLLECT は作らない)。
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
    console=False,   # GUI アプリ (ネイティブ窓) なのでコンソールは出さない
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icon,
)
