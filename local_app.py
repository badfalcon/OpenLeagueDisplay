#!/usr/bin/env python3
"""
ローカル実行モード用サーバ
==========================
serve.py (静的配信のみ) を壊さず、壁紙設定 API を足した上位版。これを起動すると
フロント (js/local.js) が /api/ping を検知して "ローカルモード" になり、ライトボックスに
「壁紙に設定」ボタン、ギャラリーに「デスクトップでスライドショー」が出る。GitHub Pages
では /api/ping が無い (404) ので何も変わらない ＝ 同一コードベースで段階的デグレード。

壁紙設定・画像取得・回転はすべて Python 標準ライブラリのみ (urllib / ctypes / winreg /
subprocess / threading)。pywebview だけが唯一の任意依存で、入っていればネイティブ窓、
無ければ既定ブラウザにフォールバックするので必須にはしない。

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
import urllib.parse
import urllib.request
import webbrowser

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


def download_image(url: str) -> pathlib.Path:
    """検証済み URL を cache_dir にダウンロードして絶対パスを返す。

    既に同じ sha1 名のファイルがあれば再ダウンロードしない。temp に書いてから
    os.replace でアトミックに置くので、スライドショーと手動設定が同じパスへ同時に
    書いても、壁紙設定側が壊れかけのファイルを読むことはない。
    """
    dest = (cache_dir() / safe_filename(url)).resolve()
    if dest.exists():
        return dest

    req = urllib.request.Request(url, headers={"User-Agent": "OpenLeagueDisplay/local"})
    with urllib.request.urlopen(req, timeout=20) as r:
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
# 壁紙設定 (OS 別)
# ---------------------------------------------------------------------------
def set_wallpaper(path: pathlib.Path) -> None:
    """OS 別に壁紙を設定する。失敗時は例外を投げる (呼び出し側が JSON で返す)。"""
    p = str(path)
    system = platform.system()
    if system == "Windows":
        _set_wallpaper_windows(p)
    elif system == "Darwin":
        _set_wallpaper_macos(p)
    else:
        _set_wallpaper_linux(p)


def _set_wallpaper_windows(p: str) -> None:
    # 横長スプラッシュが画面いっぱいに出るよう、先に表示スタイルを "fill" にする。
    # 設定しないと中央寄せ / タイルになり得る (本家 LeagueDisplays と同じ見え方に)。
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop", 0,
                            winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, "WallpaperStyle", 0, winreg.REG_SZ, "10")  # 10 = Fill
            winreg.SetValueEx(key, "TileWallpaper", 0, winreg.REG_SZ, "0")
    except OSError:
        pass  # スタイル設定の失敗は致命的ではない。壁紙自体の設定は続行する

    # SPI_SETDESKWALLPAPER=20, SPIF_UPDATEINIFILE|SPIF_SENDWININICHANGE=0x01|0x02=3。
    # ...W は wide-string を取るので argtypes を明示してから絶対パスを渡す。
    # use_last_error=True で開かないと ctypes.get_last_error() が GetLastError を
    # 拾わない (失敗時に誤った "Error 0" を投げてしまう) ので、専用に開き直す。
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    spi = user32.SystemParametersInfoW
    spi.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_wchar_p, ctypes.c_uint]
    spi.restype = ctypes.c_int
    if not spi(20, 0, p, 3):
        raise ctypes.WinError(ctypes.get_last_error())


def _set_wallpaper_macos(p: str) -> None:
    # AppleScript 文字列としてパスを安全に埋め込む (json.dumps で " をエスケープ)。
    # 「POSIX file」ラッパーよりプレーンな POSIX パス文字列指定の方が確実。
    script = (
        'tell application "System Events" to tell every desktop '
        f"to set picture to {json.dumps(p)}"
    )
    subprocess.run(["osascript", "-e", script], check=True)


def _set_wallpaper_linux(p: str) -> None:
    uri = pathlib.Path(p).as_uri()  # file:///...
    # GNOME 系: light/dark 両方の picture-uri を更新し、全画面フィルになるよう zoom も。
    # picture-uri-dark は GNOME 42+ のキーなので、無い環境では check=False で握りつぶす。
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
    # GNOME でない WM / DE 向けフォールバック: feh があれば使う。
    # shutil.which なら `which` バイナリの有無に依存せず存在確認できる。
    if shutil.which("feh"):
        subprocess.run(["feh", "--bg-fill", p], check=True)
        return
    raise OSError("No supported wallpaper backend (tried gsettings, feh)")


# ---------------------------------------------------------------------------
# スライドショー (壁紙の自動ローテーション)
# ---------------------------------------------------------------------------
class Slideshow:
    """選択スキンの splash を一定間隔で順に壁紙に設定するバックグラウンドスレッド。

    start / stop は複数の HTTP ハンドラスレッドから呼ばれ得るので Lock で保護する。
    待機は Event.wait で行い、stop が即応する (長い interval を uninterruptible に
    しない)。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self, urls: list[str], interval_s: float) -> int:
        urls = [u for u in urls if validate_url(u)]
        interval_s = max(MIN_INTERVAL_S, float(interval_s))
        with self._lock:
            self._stop_locked()
            self._stop = threading.Event()
            self._thread = threading.Thread(
                target=self._run, args=(urls, interval_s, self._stop), daemon=True)
            self._thread.start()
        return len(urls)

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        if self._thread and self._thread.is_alive():
            self._stop.set()
        self._thread = None

    def _run(self, urls: list[str], interval_s: float, stop: threading.Event) -> None:
        i = 0
        while urls and not stop.is_set():
            try:
                set_wallpaper(download_image(urls[i % len(urls)]))
            except Exception as e:  # 1枚失敗してもローテーションは止めない
                print(f"[slideshow] skip: {e}", file=sys.stderr)
            i += 1
            stop.wait(interval_s)


SLIDESHOW = Slideshow()


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

    def do_GET(self) -> None:
        if self._path() == "/api/ping":
            self._json(200, {
                "app": "OpenLeagueDisplay",
                "local": True,
                "platform": platform.system(),
                "features": ["wallpaper", "slideshow"],
            })
            return
        super().do_GET()  # それ以外は通常の静的配信

    def do_POST(self) -> None:
        path = self._path()
        if not path.startswith("/api/"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        # CSRF 関門: カスタムヘッダ必須 (クロスサイトからは付けられない)
        if self.headers.get(CSRF_HEADER) is None:
            self._json(403, {"ok": False, "error": "forbidden"})
            return
        try:
            body = self._read_json()
            if path == "/api/wallpaper":
                self._handle_wallpaper(body)
            elif path == "/api/slideshow":
                self._handle_slideshow(body)
            elif path == "/api/slideshow/stop":
                SLIDESHOW.stop()
                self._json(200, {"ok": True})
            else:
                self._json(404, {"ok": False, "error": "not found"})
        except Exception as e:  # 何が起きても JSON で返す (フロントは ok を見る)
            self._json(500, {"ok": False, "error": str(e)})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw or b"{}")

    def _handle_wallpaper(self, body: dict) -> None:
        url = str(body.get("url", ""))
        if not validate_url(url):
            self._json(400, {"ok": False, "error": "invalid url"})
            return
        SLIDESHOW.stop()  # 単発設定は走行中のローテーションより優先 (競合回避)
        path = download_image(url)
        set_wallpaper(path)
        self._json(200, {"ok": True, "path": str(path)})

    def _handle_slideshow(self, body: dict) -> None:
        urls = [str(u) for u in (body.get("urls") or [])]
        urls = [u for u in urls if validate_url(u)]
        if not urls:
            self._json(400, {"ok": False, "error": "no valid urls"})
            return
        interval_s = float(body.get("interval", 300000)) / 1000.0
        count = SLIDESHOW.start(urls, interval_s)
        self._json(200, {"ok": True, "count": count})


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
