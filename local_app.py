#!/usr/bin/env python3
"""
ローカル実行モード用サーバ
==========================
serve.py (静的配信のみ) を壊さず、壁紙設定 API を足した上位版。これを起動すると
フロント (js/local.js) が /api/ping を検知して "ローカルモード" になり、スプラッシュを
複数選択 → 確認 → 「壁紙にする」で一括設定できるようになる。1枚なら静止壁紙、2枚以上なら
OS 純正スライドショー (Windows=IDesktopWallpaper / macOS=System Events のフォルダ
ローテーション / Linux GNOME=slideshow XML) として設定するので、アプリを閉じても OS が
回し続け、設定アプリの背景種類も正しく「スライドショー」になる。GitHub Pages では
/api/ping が無い (404) ので何も変わらない ＝ 同一コードベースで段階的デグレード。

壁紙設定・画像取得はすべて Python 標準ライブラリのみ (urllib / ctypes [COM 直叩き] /
winreg / subprocess / threading)。pywebview だけが唯一の任意依存で、入っていればネイティブ
窓、無ければ既定ブラウザにフォールバックするので必須にはしない。

実行:
    python local_app.py            # 8000番、ネイティブ窓 (pywebview があれば) で起動
    python local_app.py 8080       # ポート指定
    python local_app.py --no-window   # 窓を出さずサーバだけ (CI / curl テスト用)
"""

from __future__ import annotations

import ctypes
import functools
import hashlib
import http.server
import json
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

# Windows の既定コンソール encoding (cp932 / cp1252) だと起動ログの非ASCII文字 (em dash
# 等) を print した瞬間 UnicodeEncodeError で落ちる。stdout/stderr を UTF-8 に固定する
# (windowed ビルドでは None になり得るので存在チェック付き)。generate_data.py と同方針。
for _stream in (sys.stdout, sys.stderr):
    try:
        if _stream is not None:
            _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

HOST = "127.0.0.1"  # 外向きには公開しない (SSRF / 横取りを防ぐ第一の関門)

# PyInstaller の onefile は実体を sys._MEIPASS に展開する。通常実行ではこのファイルの
# あるディレクトリ。ここを静的配信ルートにすることで cwd 依存をやめる。
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

# スプラッシュの取得元はこのホストだけに固定する。file:// や内部 IP、任意ドメインへの
# 誘導 (SSRF) を封じる。CDragon は global asset の公式ミラー。
ALLOWED_HOST = "raw.communitydragon.org"

# CSRF 関門。/api への POST はこのヘッダを必須にする。クロスサイトからの "simple
# request" はカスタムヘッダを付けられず (付ければ CORS プリフライトが走り、本サーバは
# OPTIONS に許可を返さないので弾かれる) ＝ 同一オリジン (= 自分のフロント) しか撃てない。
CSRF_HEADER = "X-OLD-Local"

# 壁紙スライドショーのサーバ側最小間隔 (暴走防止)。UI 側の既定は 5 分。
MIN_INTERVAL_S = 10
# ダウンロード上限。巨大ファイル / 非画像レスポンスを弾く多層防御。
MAX_BYTES = 25 * 1024 * 1024


# ---------------------------------------------------------------------------
# 画像キャッシュ
# ---------------------------------------------------------------------------
def cache_dir() -> pathlib.Path:
    """ダウンロードした壁紙の保存先。

    /tmp ではなく永続のユーザ専用ディレクトリに置く。Linux(gsettings) と macOS は
    壁紙を「ファイルパス参照」で設定する (画像をコピーしない) ため、再起動で消える
    /tmp に置くと次回ログイン時に壁紙が壊れる。他ユーザから読めない場所なので
    プライバシ / TOCTOU も軽減できる。
    """
    system = platform.system()
    if system == "Windows":
        base = pathlib.Path(os.environ.get("LOCALAPPDATA", pathlib.Path.home() / "AppData" / "Local"))
        root = base / "OpenLeagueDisplay" / "wallpapers"
    elif system == "Darwin":
        root = pathlib.Path.home() / "Library" / "Application Support" / "OpenLeagueDisplay" / "wallpapers"
    else:
        base = pathlib.Path(os.environ.get("XDG_DATA_HOME", pathlib.Path.home() / ".local" / "share"))
        root = base / "OpenLeagueDisplay" / "wallpapers"
    root.mkdir(parents=True, exist_ok=True)
    return root


def current_set_dir() -> pathlib.Path:
    """「今アクティブな壁紙セット」専用フォルダ。

    OS 純正スライドショーは*フォルダを参照*して中の画像を回すので、ユーザが今回
    選んだ画像「だけ」がここに入っている必要がある。適用のたびに `reset_current_set()`
    で空にしてから選択画像を入れ直す。cache_dir() 直下 (全 DL 履歴の sha1 置き場) とは
    分離する。
    """
    d = cache_dir() / "current"
    d.mkdir(parents=True, exist_ok=True)
    return d


def reset_current_set() -> pathlib.Path:
    """current_set_dir を空にして返す (前回のセットを残さない)。"""
    d = current_set_dir()
    for p in d.iterdir():
        if p.is_file():
            p.unlink()
    return d


def validate_url(url: str) -> bool:
    """https かつ ALLOWED_HOST のみ許可 (file:// や内部 IP を弾く SSRF 対策)。"""
    try:
        u = urllib.parse.urlparse(url)
    except ValueError:
        return False
    return u.scheme == "https" and u.hostname == ALLOWED_HOST


def safe_filename(url: str) -> str:
    """URL から決定的で衝突しにくいファイル名を作る。本体は URL の sha1 にして
    path traversal / 長すぎ問題を避け、拡張子だけ元のものを (画像系のみ) 引き継ぐ。"""
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    return hashlib.sha1(url.encode("utf-8")).hexdigest() + ext


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """リダイレクト先も毎回 validate_url で検証する (多層防御)。

    validate_url は初回 URL しか見ないので、万一 CDragon が別ホストや内部アドレスへ
    リダイレクトを返しても urllib が黙って追従しないようにする。同一ホスト内の
    正当なリダイレクトは許可されるので画像取得は壊れない。
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not validate_url(newurl):
            raise urllib.error.HTTPError(
                newurl, code, "redirect to disallowed host blocked", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_SafeRedirectHandler())


def download_image(url: str, dest_dir: pathlib.Path | None = None) -> pathlib.Path:
    """検証済み URL を dest_dir (既定 cache_dir) にダウンロードして絶対パスを返す。

    既に同じ sha1 名のファイルがあれば再ダウンロードしない。temp に書いてから
    os.replace でアトミックに置くので、同じパスへ同時に書いても壁紙設定側が
    壊れかけのファイルを読むことはない。
    """
    base = dest_dir if dest_dir is not None else cache_dir()
    dest = (base / safe_filename(url)).resolve()
    if dest.exists():
        return dest

    req = urllib.request.Request(url, headers={"User-Agent": "OpenLeagueDisplay/local"})
    with _OPENER.open(req, timeout=20) as r:
        ctype = (r.headers.get("Content-Type") or "").lower()
        if not ctype.startswith("image/"):
            raise ValueError(f"not an image (Content-Type: {ctype or 'unknown'})")
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("image too large")

    # tmp 名はスレッドごとに固有にする (PID だけだと、スライドショースレッドと手動設定が
    # 同じ URL を同時に取得した時に同一 tmp を奪い合い、片方の os.replace が
    # FileNotFoundError になる)。スレッド ID を混ぜて衝突を防ぐ。
    tmp = dest.with_suffix(dest.suffix + f".{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return dest


# ---------------------------------------------------------------------------
# 壁紙設定 (OS 別) — 1枚=静止 / 2枚以上=OS純正スライドショー
# ---------------------------------------------------------------------------
# 自前タイマーで静止画を設定し直す旧方式はやめ、各 OS の「純正スライドショー」機構に
# 寄せる。これにより (1) 設定アプリの背景種類が正しく「スライドショー」になり
# (2) アプリを閉じても OS が回し続ける。1枚だけのときは静止壁紙にし、これが
# 「スライドショーを解除して1枚に戻す」操作も兼ねる。
def set_wallpaper_static(path: pathlib.Path) -> None:
    """選んだ1枚を静止壁紙にする。失敗時は例外を投げる。"""
    p = str(path)
    system = platform.system()
    if system == "Windows":
        _win_set_wallpaper(p)
    elif system == "Darwin":
        _mac_set_wallpaper(p)
    else:
        _linux_set_wallpaper(p)


def set_slideshow(folder: pathlib.Path, interval_s: float, shuffle: bool = False) -> None:
    """folder 内の画像を OS 純正スライドショーとして設定する (2枚以上向け)。"""
    interval_s = max(MIN_INTERVAL_S, float(interval_s))
    system = platform.system()
    if system == "Windows":
        _win_set_slideshow(folder, interval_s, shuffle)
    elif system == "Darwin":
        _mac_set_slideshow(folder, interval_s, shuffle)
    else:
        _linux_set_slideshow(folder, interval_s, shuffle)


# ---- Windows: IDesktopWallpaper (COM) ----------------------------------------
# 設定アプリ自身が使う COM API。レガシーの SystemParametersInfoW と違い、設定アプリの
# 背景種類・最近使った画像とも整合し、スライドショーは OS 管理 (アプリ終了後も継続) になる。
# 追加依存なしで ctypes から vtable を直叩きする (stdlib のみ方針を維持)。WINFUNCTYPE /
# windll / HRESULT は Windows 専用なので、参照は必ず関数本体内 (= Windows でのみ実行) に置く。
_CLSID_DesktopWallpaper = "{C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD}"
_IID_IDesktopWallpaper = "{B92B56A9-8B55-4E14-9A89-0199BBB6F93B}"
_IID_IShellItem = "{43826D1E-E718-42EE-BC55-A1E261C37BFE}"
_IID_IShellItemArray = "{B63EA76D-1F85-456F-A19C-48159EFA858B}"
_DWPOS_FILL = 4          # DESKTOP_WALLPAPER_POSITION (CENTER0 TILE1 STRETCH2 FIT3 FILL4 SPAN5)
_DSO_SHUFFLEIMAGES = 0x1
_CLSCTX_ALL = 0x17
_COINIT_APARTMENTTHREADED = 0x2


class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_uint32),
                ("Data2", ctypes.c_uint16),
                ("Data3", ctypes.c_uint16),
                ("Data4", ctypes.c_ubyte * 8)]


def _guid(s: str) -> "_GUID":
    g = _GUID()
    hr = ctypes.windll.ole32.CLSIDFromString(s, ctypes.byref(g))
    if hr != 0:
        raise OSError(f"CLSIDFromString({s}) failed: 0x{hr & 0xFFFFFFFF:08X}")
    return g


def _vtbl(ptr, index, restype, argtypes):
    """COM インターフェースポインタ ptr の vtable[index] を呼べる callable を返す。
    第1引数は this ポインタ。"""
    vtable = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    proto = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)
    return proto(vtable[index])


def _com_release(ptr) -> None:
    if ptr:
        _vtbl(ptr, 2, ctypes.c_ulong, [])(ptr)  # IUnknown::Release (slot 2)


def _desktop_wallpaper():
    """IDesktopWallpaper を生成 (要 CoInitialize 済み)。呼び出し側が _com_release する。"""
    ptr = ctypes.c_void_p()
    clsid = _guid(_CLSID_DesktopWallpaper)
    iid = _guid(_IID_IDesktopWallpaper)
    hr = ctypes.windll.ole32.CoCreateInstance(
        ctypes.byref(clsid), None, _CLSCTX_ALL, ctypes.byref(iid), ctypes.byref(ptr))
    if hr < 0:
        raise ctypes.WinError(hr)
    return ptr


def _win_set_wallpaper(p: str) -> None:
    try:
        _win_com_set_wallpaper(p)
    except OSError as e:
        # 万一 COM が使えない環境ではレガシー SPI に退避する (多層防御)。
        print(f"[wallpaper] IDesktopWallpaper failed ({e}); SPI fallback", file=sys.stderr)
        _win_set_wallpaper_spi(p)


def _win_com_set_wallpaper(p: str) -> None:
    ctypes.windll.ole32.CoInitializeEx(None, _COINIT_APARTMENTTHREADED)
    try:
        dw = _desktop_wallpaper()
        try:
            # SetWallpaper(monitorID=NULL, wallpaper=path) → 全モニタ (slot 3)
            _vtbl(dw, 3, ctypes.HRESULT, [ctypes.c_wchar_p, ctypes.c_wchar_p])(dw, None, p)
            # SetPosition(FILL) (slot 10)
            _vtbl(dw, 10, ctypes.HRESULT, [ctypes.c_int])(dw, _DWPOS_FILL)
        finally:
            _com_release(dw)
    finally:
        ctypes.windll.ole32.CoUninitialize()


def _win_set_slideshow(folder: pathlib.Path, interval_s: float, shuffle: bool) -> None:
    ctypes.windll.ole32.CoInitializeEx(None, _COINIT_APARTMENTTHREADED)
    psi = ctypes.c_void_p()
    psia = ctypes.c_void_p()
    dw = None
    try:
        dw = _desktop_wallpaper()
        iid_si = _guid(_IID_IShellItem)
        iid_sia = _guid(_IID_IShellItemArray)
        # フォルダの IShellItem → IShellItemArray を作って SetSlideshow に渡す
        hr = ctypes.windll.shell32.SHCreateItemFromParsingName(
            ctypes.c_wchar_p(str(folder)), None, ctypes.byref(iid_si), ctypes.byref(psi))
        if hr < 0:
            raise ctypes.WinError(hr)
        hr = ctypes.windll.shell32.SHCreateShellItemArrayFromShellItem(
            psi, ctypes.byref(iid_sia), ctypes.byref(psia))
        if hr < 0:
            raise ctypes.WinError(hr)
        # SetSlideshow(items) (slot 12)
        _vtbl(dw, 12, ctypes.HRESULT, [ctypes.c_void_p])(dw, psia)
        # SetSlideshowOptions(options, tickMs) (slot 14)。最小 tick は 1000ms。
        opts = _DSO_SHUFFLEIMAGES if shuffle else 0
        _vtbl(dw, 14, ctypes.HRESULT, [ctypes.c_int, ctypes.c_uint])(
            dw, opts, int(interval_s * 1000))
        # SetPosition(FILL) (slot 10)
        _vtbl(dw, 10, ctypes.HRESULT, [ctypes.c_int])(dw, _DWPOS_FILL)
    finally:
        _com_release(psia)
        _com_release(psi)
        _com_release(dw)
        ctypes.windll.ole32.CoUninitialize()


def _win_set_wallpaper_spi(p: str) -> None:
    """レガシー SPI フォールバック (COM が使えない時用)。表示スタイルを fill に。"""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop", 0,
                            winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, "WallpaperStyle", 0, winreg.REG_SZ, "10")  # 10 = Fill
            winreg.SetValueEx(key, "TileWallpaper", 0, winreg.REG_SZ, "0")
    except OSError:
        pass
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    spi = user32.SystemParametersInfoW
    spi.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_wchar_p, ctypes.c_uint]
    spi.restype = ctypes.c_int
    if not spi(20, 0, p, 3):  # SPI_SETDESKWALLPAPER, SPIF_UPDATEINIFILE|SPIF_SENDWININICHANGE
        raise ctypes.WinError(ctypes.get_last_error())


# ---- macOS: System Events ----------------------------------------------------
def _mac_set_wallpaper(p: str) -> None:
    script = (
        'tell application "System Events" to tell every desktop '
        f"to set picture to {json.dumps(p)}"
    )
    subprocess.run(["osascript", "-e", script], check=True)


def _mac_set_slideshow(folder: pathlib.Path, interval_s: float, shuffle: bool) -> None:
    # System Events の「フォルダを指定して一定間隔で回す」純正ローテーション。
    # picture rotation: 0=オフ, 1=インターバル, 2=ログイン/スリープ復帰。
    lines = [
        'tell application "System Events"',
        'tell every desktop',
        f"set pictures folder to {json.dumps(str(folder))}",
        "set picture rotation to 1",
        f"set change interval to {float(interval_s)}",
        f"set random order to {'true' if shuffle else 'false'}",
        "end tell",
        "end tell",
    ]
    cmd = ["osascript"]
    for ln in lines:
        cmd += ["-e", ln]
    subprocess.run(cmd, check=True)


# ---- Linux (GNOME): slideshow XML --------------------------------------------
_IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def _xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _linux_set_wallpaper(p: str) -> None:
    _linux_apply_uri(pathlib.Path(p).as_uri(), feh_path=p)


def _linux_set_slideshow(folder: pathlib.Path, interval_s: float, shuffle: bool) -> None:
    imgs = sorted(str(p) for p in folder.iterdir()
                  if p.is_file() and p.suffix.lower() in _IMG_EXTS)
    if not imgs:
        raise OSError("no images for slideshow")
    # GNOME の純正スライドショーは <background> XML を picture-uri に指す方式。各画像を
    # duration 秒表示し、次へ transition する連鎖を書く (最後は先頭へ戻してループ)。
    dur, trans = float(interval_s), 1.5
    parts = ['<?xml version="1.0"?>', "<background>"]
    for i, img in enumerate(imgs):
        nxt = imgs[(i + 1) % len(imgs)]
        parts.append(f"  <static><duration>{dur:.1f}</duration>"
                     f"<file>{_xml_escape(img)}</file></static>")
        parts.append(f"  <transition><duration>{trans:.1f}</duration>"
                     f"<from>{_xml_escape(img)}</from><to>{_xml_escape(nxt)}</to></transition>")
    parts.append("</background>")
    xml_path = folder / "slideshow.xml"
    xml_path.write_text("\n".join(parts), encoding="utf-8")
    # GNOME 以外 (feh) は時間回転ができないので先頭1枚を静止にフォールバック。
    _linux_apply_uri(xml_path.as_uri(), feh_path=imgs[0])


def _linux_apply_uri(uri: str, feh_path: str) -> None:
    try:
        subprocess.run(["gsettings", "set", "org.gnome.desktop.background",
                        "picture-uri", uri], check=True)
        subprocess.run(["gsettings", "set", "org.gnome.desktop.background",
                        "picture-uri-dark", uri], check=False)
        subprocess.run(["gsettings", "set", "org.gnome.desktop.background",
                        "picture-options", "zoom"], check=False)
        return
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass
    if shutil.which("feh"):
        subprocess.run(["feh", "--bg-fill", feh_path], check=True)
        return
    raise OSError("No supported wallpaper backend (tried gsettings, feh)")


# ---------------------------------------------------------------------------
# HTTP ハンドラ
# ---------------------------------------------------------------------------
class Handler(http.server.SimpleHTTPRequestHandler):
    """静的配信は SimpleHTTPRequestHandler のまま、/api/* だけ自前で処理する。"""

    # ログを少し静かに (ヘルスチェック的な GET /api/ping を毎回出さない)
    def log_message(self, fmt: str, *args) -> None:
        if "/api/ping" in (self.path or ""):
            return
        super().log_message(fmt, *args)

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _path(self) -> str:
        return (self.path or "").split("?")[0]

    def _host_ok(self) -> bool:
        # DNS リバインディング対策。サーバは 127.0.0.1 にしか bind しないので、正規の
        # アクセスは Host が必ずループバックリテラルになる。悪意サイトが自ドメインを
        # 127.0.0.1 に rebind して same-origin 化し X-OLD-Local を付けて撃ってきても、
        # Host ヘッダは攻撃者ドメインのままなのでここで弾ける (CSRF 関門の補強)。
        host = self.headers.get("Host", "")
        hostname = host.rsplit(":", 1)[0].strip("[]") if host else ""
        return hostname in ("127.0.0.1", "localhost", "::1")

    def do_GET(self) -> None:
        if self._path() == "/api/ping":
            if not self._host_ok():
                self._json(403, {"ok": False, "error": "bad host"})
                return
            self._json(200, {
                "app": "OpenLeagueDisplay",
                "local": True,
                "platform": platform.system(),
                "features": ["wallpaper"],
            })
            return
        super().do_GET()  # それ以外は通常の静的配信

    def do_POST(self) -> None:
        path = self._path()
        if not path.startswith("/api/"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        # DNS リバインディング対策: ループバック以外の Host は拒否 (CSRF 関門の補強)
        if not self._host_ok():
            self._json(403, {"ok": False, "error": "bad host"})
            return
        # CSRF 関門: カスタムヘッダ必須 (クロスサイトからは付けられない)
        if self.headers.get(CSRF_HEADER) is None:
            self._json(403, {"ok": False, "error": "forbidden"})
            return
        try:
            body = self._read_json()
            if path == "/api/wallpaper":
                self._handle_wallpaper(body)
            else:
                self._json(404, {"ok": False, "error": "not found"})
        except Exception as e:  # 何が起きても JSON で返す (フロントは ok を見る)
            self._json(500, {"ok": False, "error": str(e)})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw or b"{}")

    def _handle_wallpaper(self, body: dict) -> None:
        """選択 URL 群を current フォルダに一括 DL し、枚数で静止/スライドショーに振り分ける。

        body: {urls: [...], interval: ms, shuffle: bool}。後方互換で単数 url も受ける。
        1枚 → 静止壁紙 (スライドショー解除も兼ねる)、2枚以上 → OS 純正スライドショー。
        """
        urls = [str(u) for u in (body.get("urls") or [])]
        if not urls and body.get("url"):
            urls = [str(body["url"])]  # 旧 {url} 形式の後方互換
        urls = [u for u in urls if validate_url(u)]
        if not urls:
            self._json(400, {"ok": False, "error": "no valid urls"})
            return

        folder = reset_current_set()  # 前回セットを消し、選んだ画像だけ入れる
        paths = [download_image(u, folder) for u in urls]

        if len(paths) == 1:
            set_wallpaper_static(paths[0])
            mode = "static"
        else:
            interval_s = float(body.get("interval", 300000)) / 1000.0
            set_slideshow(folder, interval_s, shuffle=bool(body.get("shuffle", False)))
            mode = "slideshow"
        self._json(200, {"ok": True, "count": len(paths), "mode": mode})


# ---------------------------------------------------------------------------
# 起動
# ---------------------------------------------------------------------------
def _serve(port: int) -> http.server.ThreadingHTTPServer:
    # ThreadingHTTPServer: 画像 DL (最大 ~20s) 中でも他リクエスト (停止 / 静的) を捌く。
    # directory= で配信ルートを明示し cwd 依存をやめる (PyInstaller 同梱に対応)。
    handler = functools.partial(Handler, directory=BASE_DIR)
    httpd = http.server.ThreadingHTTPServer((HOST, port), handler)
    return httpd


def main() -> None:
    args = [a for a in sys.argv[1:]]
    no_window = "--no-window" in args
    ports = [a for a in args if a.isdigit()]
    port = int(ports[0]) if ports else 8000

    httpd = _serve(port)
    url = f"http://{HOST}:{port}"
    print(f"OpenLeagueDisplay (local mode, wallpaper enabled) — {url}  (Ctrl+C to stop)")

    # pywebview があればネイティブ窓。GUI はメインスレッド必須 (特に macOS) なので
    # サーバを別スレッド (daemon) で回し、webview をメインスレッドで起動する。
    if not no_window:
        try:
            import webview  # pywebview
        except ImportError:
            webview = None
        if webview is not None:
            # ネイティブ窓を試す。pywebview があっても GUI backend 不全 (例: Linux で
            # WebKitGTK 無し / DISPLAY 無し) だと create_window/start が ImportError 以外を
            # 投げるので、その時はブラウザに切替えてサーバを生かしたまま待機する。
            server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            server_thread.start()
            try:
                webview.create_window("OpenLeagueDisplay", url, width=1280, height=800)
                webview.start()
            except Exception as e:
                print(f"(native window unavailable: {e}) opening browser instead", file=sys.stderr)
                webbrowser.open(url)
                try:
                    server_thread.join()
                except KeyboardInterrupt:
                    print("\nstopped.")
            finally:
                httpd.shutdown()
            return
        # pywebview 未インストール: 既定ブラウザを開いてサーバを foreground で回す
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
