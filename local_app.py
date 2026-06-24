#!/usr/bin/env python3
"""
Local-mode server
=================
A superset of serve.py (static serving only) that adds a wallpaper-setting API
without breaking serve.py. When this is running, the frontend (js/local.js)
detects /api/ping and switches to "local mode", letting the user multi-select
splashes, confirm, and apply them all at once via "Set as wallpaper". One image
becomes a static wallpaper; two or more become an OS-native slideshow
(Windows=IDesktopWallpaper / macOS=System Events folder rotation / Linux
GNOME=slideshow XML), so the OS keeps rotating even after the app closes and the
Settings app correctly shows the background type as "slideshow". On GitHub Pages
there is no /api/ping (404), so nothing changes = graceful degradation from a
single codebase.

Wallpaper setting and image fetching use only the Python standard library
(urllib / ctypes [direct COM calls] / winreg / subprocess / threading).
pywebview is the only optional dependency: when present it gives a native window,
otherwise it falls back to the default browser, so it is never required.

Run:
    python local_app.py            # port 8000, native window (if pywebview is present)
    python local_app.py 8080       # specify port
    python local_app.py --no-window   # server only, no window (for CI / curl tests)
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

# With Windows' default console encoding (cp932 / cp1252), printing non-ASCII
# characters in startup logs (em dash, etc.) crashes immediately with
# UnicodeEncodeError. Force stdout/stderr to UTF-8 (with an existence check since
# they can be None in a windowed build). Same approach as generate_data.py.
for _stream in (sys.stdout, sys.stderr):
    try:
        if _stream is not None:
            _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

HOST = "127.0.0.1"  # never exposed externally (first gate against SSRF / hijacking)

# PyInstaller onefile extracts its payload to sys._MEIPASS. For a normal run it's
# this file's directory. Using it as the static-serving root removes the cwd dependency.
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

# Pin the splash fetch source to this host only. Blocks SSRF redirection to
# file://, internal IPs, or arbitrary domains. CDragon is the official mirror of
# the global assets.
ALLOWED_HOST = "raw.communitydragon.org"

# CSRF gate. POSTs to /api require this header. A cross-site "simple request"
# cannot set a custom header (adding one triggers a CORS preflight, and this
# server returns no allow for OPTIONS so it gets rejected) = only same-origin
# (= our own frontend) can hit it.
CSRF_HEADER = "X-OLD-Local"

# Server-side minimum interval for the wallpaper slideshow (runaway guard). UI default is 5 min.
MIN_INTERVAL_S = 10
# Download cap. Defense-in-depth that rejects huge files / non-image responses.
MAX_BYTES = 25 * 1024 * 1024
# POST body cap for /api. A legitimate {urls:[...], interval} fits in tens of KB,
# so 1MB is plenty (cap to avoid reading a huge body into memory).
MAX_BODY_BYTES = 1 * 1024 * 1024

# Wallpaper-apply progress. /api/wallpaper blocks for one request until every
# image has been downloaded in sequence, so the frontend polls this done/total
# from a separate thread via GET /api/wallpaper/progress to show a progress gauge
# (prevents it looking "frozen" with many images). ThreadingHTTPServer can serve
# the GET on another thread during the POST. Only one apply is expected at a time.
_wp_progress = {"done": 0, "total": 0}
_wp_progress_lock = threading.Lock()


def set_wp_progress(done: int, total: int) -> None:
    with _wp_progress_lock:
        _wp_progress["done"] = done
        _wp_progress["total"] = total


# ---------------------------------------------------------------------------
# Image cache
# ---------------------------------------------------------------------------
def cache_dir() -> pathlib.Path:
    """Where downloaded wallpapers are stored.

    A persistent per-user directory, not /tmp. Linux (gsettings) and macOS set
    the wallpaper by *file-path reference* (they don't copy the image), so
    storing in /tmp (which is wiped on reboot) would break the wallpaper at next
    login. Being unreadable by other users also mitigates privacy / TOCTOU.
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
    """Folder dedicated to the "currently active wallpaper set".

    The OS-native slideshow *references the folder* and rotates the images inside
    it, so only the images the user selected this time must be in here. On each
    apply we clear it and refill it with the selected images. Kept separate from
    cache_dir() directly (the sha1 store of the full download history).
    """
    d = cache_dir() / "current"
    d.mkdir(parents=True, exist_ok=True)
    return d


def prune_current_set(keep: set) -> pathlib.Path:
    """Delete files in current_set_dir not in `keep` (a set of filenames); return the dir.

    The point is not a blanket wipe but "keep only the currently displayed file".
    The OS-native slideshow holds onto the displayed image path, so deleting it
    leaves the path pointing at nothing and the screen goes black (verified on
    real Windows hardware). Calling this with the live file in `keep` on each
    apply cleans up the old set while preserving the displayed file, preventing
    the black screen.
    """
    d = current_set_dir()
    for p in d.iterdir():
        if p.is_file() and p.name not in keep:
            p.unlink()
    return d


def live_wallpaper_names() -> set:
    """Set of basenames of wallpaper files currently shown on the desktop.

    Used to learn "which files must not be deleted" to prevent the black screen.
    Implemented on Windows only (the problem is the native slideshow holding the
    displayed path). Other OSes / failure return an empty set = fall back to
    deleting the whole old set (the prior behavior).
    """
    if platform.system() == "Windows":
        try:
            return _win_live_wallpaper_names()
        except Exception:
            return set()
    return set()


def validate_url(url: str) -> bool:
    """Allow only https + ALLOWED_HOST (SSRF defense rejecting file:// and internal IPs)."""
    try:
        u = urllib.parse.urlparse(url)
    except ValueError:
        return False
    return u.scheme == "https" and u.hostname == ALLOWED_HOST


def safe_filename(url: str) -> str:
    """Build a deterministic, collision-resistant filename from a URL. The body is
    the URL's sha1 to avoid path traversal / overlong-name issues; only the
    extension (image types only) is carried over from the original."""
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    return hashlib.sha1(url.encode("utf-8")).hexdigest() + ext


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Re-validate every redirect target with validate_url (defense-in-depth).

    validate_url only sees the initial URL, so this prevents urllib from silently
    following a redirect should CDragon ever return one to a different host or an
    internal address. Legitimate same-host redirects are allowed, so image
    fetching still works.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not validate_url(newurl):
            raise urllib.error.HTTPError(
                newurl, code, "redirect to disallowed host blocked", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_SafeRedirectHandler())


def download_image(url: str, dest_dir: pathlib.Path | None = None) -> pathlib.Path:
    """Download a validated URL into dest_dir (default cache_dir) and return its absolute path.

    Skips re-downloading if a file with the same sha1 name already exists. Writes
    to a temp file then atomically os.replace's it into place, so concurrent
    writes to the same path can't let the wallpaper-setting side read a
    half-written file.
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

    # Make the tmp name unique per thread (with PID alone, the slideshow thread
    # and a manual apply fetching the same URL concurrently would fight over the
    # same tmp and one os.replace would get FileNotFoundError). Mixing in the
    # thread ID prevents the collision.
    tmp = dest.with_suffix(dest.suffix + f".{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return dest


# ---------------------------------------------------------------------------
# Wallpaper setting (per OS) — 1 image=static / 2+=OS-native slideshow
# ---------------------------------------------------------------------------
# We dropped the old approach of re-setting a static image on our own timer and
# leaned on each OS's "native slideshow" mechanism. This makes (1) the Settings
# app show the correct background type "slideshow" and (2) the OS keep rotating
# even after the app closes. With a single image we set a static wallpaper, which
# also serves as the "cancel slideshow and go back to one image" operation.
def set_wallpaper_static(path: pathlib.Path) -> None:
    """Set the single selected image as a static wallpaper. Raises on failure."""
    p = str(path)
    system = platform.system()
    if system == "Windows":
        _win_set_wallpaper(p)
    elif system == "Darwin":
        _mac_set_wallpaper(p)
    else:
        _linux_set_wallpaper(p)


def set_slideshow(folder: pathlib.Path, interval_s: float, shuffle: bool = False) -> None:
    """Set the images in `folder` as an OS-native slideshow (for 2+ images)."""
    interval_s = max(MIN_INTERVAL_S, float(interval_s))
    system = platform.system()
    if system == "Windows":
        _win_set_slideshow(folder, interval_s, shuffle)
    elif system == "Darwin":
        _mac_set_slideshow(folder, interval_s, shuffle)
    else:
        _linux_set_slideshow(folder, interval_s, shuffle)


# ---- Windows: IDesktopWallpaper (COM) ----------------------------------------
# The COM API the Settings app itself uses. Unlike the legacy SystemParametersInfoW,
# it stays consistent with the Settings app's background type and recently-used
# images, and the slideshow becomes OS-managed (continues after the app exits).
# We call the vtable directly from ctypes with no extra dependency (keeping the
# stdlib-only policy). WINFUNCTYPE / windll / HRESULT are Windows-only, so any
# reference to them must stay inside a function body (= only ever runs on Windows).
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
    """Return a callable for vtable[index] of the COM interface pointer `ptr`.
    The first argument is the `this` pointer."""
    vtable = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    proto = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)
    return proto(vtable[index])


def _com_release(ptr) -> None:
    if ptr:
        _vtbl(ptr, 2, ctypes.c_ulong, [])(ptr)  # IUnknown::Release (slot 2)


def _desktop_wallpaper():
    """Create an IDesktopWallpaper (requires prior CoInitialize). Caller must _com_release it."""
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
        # If COM is somehow unavailable, fall back to the legacy SPI (defense-in-depth).
        print(f"[wallpaper] IDesktopWallpaper failed ({e}); SPI fallback", file=sys.stderr)
        _win_set_wallpaper_spi(p)


def _win_com_set_wallpaper(p: str) -> None:
    ctypes.windll.ole32.CoInitializeEx(None, _COINIT_APARTMENTTHREADED)
    dw = None
    try:
        dw = _desktop_wallpaper()
        # SetWallpaper(NULL, path) sometimes doesn't take effect when the previous
        # state was a slideshow, so set it explicitly per monitor
        # (_win_pin_current_image). This cancels the slideshow and yields a static
        # wallpaper (as intended: a single image also cancels the slideshow).
        _win_pin_current_image(dw, p)
        # SetPosition(FILL) (slot 10)
        _vtbl(dw, 10, ctypes.HRESULT, [ctypes.c_int])(dw, _DWPOS_FILL)
    finally:
        if dw:
            _com_release(dw)
        ctypes.windll.ole32.CoUninitialize()


def _win_pin_current_image(dw, image_path: str) -> None:
    """Explicitly set each monitor's "currently displayed wallpaper" to the existing file image_path.

    Since SetWallpaper(NULL, path) sometimes doesn't take effect when the previous
    state was a slideshow, we SetWallpaper using each monitor ID obtained from
    GetMonitorDevicePathAt. Used both for static wallpaper setting
    (_win_com_set_wallpaper) and for recovering from the abnormal case where, after
    setting a slideshow, the displayed image points at a nonexistent path
    (_win_set_slideshow's fallback). This call has the side effect of cancelling
    the slideshow and dropping to static, so it is NOT used in the normal slideshow
    path (the black screen is prevented on the prune_current_set side by "not
    deleting the displayed file"). The string returned by GetMonitorDevicePathAt is
    CoTaskMem, so it is freed explicitly.
    """
    count = ctypes.c_uint(0)
    # GetMonitorDevicePathCount (slot 6)
    if _vtbl(dw, 6, ctypes.HRESULT, [ctypes.POINTER(ctypes.c_uint)])(dw, ctypes.byref(count)) < 0:
        return
    for i in range(count.value):
        mid = ctypes.c_void_p()
        # GetMonitorDevicePathAt (slot 5)
        if _vtbl(dw, 5, ctypes.HRESULT, [ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p)])(
                dw, i, ctypes.byref(mid)) < 0:
            continue
        try:
            monitor_id = ctypes.wstring_at(mid) if mid else None
            if monitor_id:
                # SetWallpaper(monitorID, path) (slot 3)
                _vtbl(dw, 3, ctypes.HRESULT, [ctypes.c_wchar_p, ctypes.c_wchar_p])(
                    dw, monitor_id, image_path)
        finally:
            if mid:
                ctypes.windll.ole32.CoTaskMemFree(mid)


def _win_current_wallpaper_paths(dw) -> list:
    """List of wallpaper file paths each monitor is currently displaying (GetWallpaper, slot 4).

    If the return value contains a nonexistent path, the state is "displayed file
    is gone and the screen is black". The output strings are CoTaskMem, so they
    are freed.
    """
    out = []
    count = ctypes.c_uint(0)
    if _vtbl(dw, 6, ctypes.HRESULT, [ctypes.POINTER(ctypes.c_uint)])(dw, ctypes.byref(count)) < 0:
        return out
    for i in range(count.value):
        mid = ctypes.c_void_p()
        if _vtbl(dw, 5, ctypes.HRESULT, [ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p)])(
                dw, i, ctypes.byref(mid)) < 0:
            continue
        wp = ctypes.c_void_p()
        try:
            monitor_id = ctypes.wstring_at(mid) if mid else None
            # GetWallpaper(monitorID, out) (slot 4)
            if _vtbl(dw, 4, ctypes.HRESULT, [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_void_p)])(
                    dw, monitor_id, ctypes.byref(wp)) == 0 and wp:
                out.append(ctypes.wstring_at(wp))
        finally:
            if mid:
                ctypes.windll.ole32.CoTaskMemFree(mid)
            if wp:
                ctypes.windll.ole32.CoTaskMemFree(wp)
    return out


def _win_live_wallpaper_names() -> set:
    """Set of basenames of the wallpaper files Windows is currently displaying. Empty set on failure."""
    ctypes.windll.ole32.CoInitializeEx(None, _COINIT_APARTMENTTHREADED)
    dw = None
    try:
        dw = _desktop_wallpaper()
        return {os.path.basename(p) for p in _win_current_wallpaper_paths(dw) if p}
    except OSError:
        return set()
    finally:
        if dw:
            _com_release(dw)
        ctypes.windll.ole32.CoUninitialize()


def _win_set_slideshow(folder: pathlib.Path, interval_s: float, shuffle: bool) -> None:
    ctypes.windll.ole32.CoInitializeEx(None, _COINIT_APARTMENTTHREADED)
    psi = ctypes.c_void_p()
    psia = ctypes.c_void_p()
    dw = None
    try:
        dw = _desktop_wallpaper()
        # Build the folder's IShellItem -> IShellItemArray and pass it to SetSlideshow
        iid_si = _guid(_IID_IShellItem)
        iid_sia = _guid(_IID_IShellItemArray)
        hr = ctypes.windll.shell32.SHCreateItemFromParsingName(
            ctypes.c_wchar_p(str(folder)), None, ctypes.byref(iid_si), ctypes.byref(psi))
        if hr < 0:
            raise ctypes.WinError(hr)
        hr = ctypes.windll.shell32.SHCreateShellItemArrayFromShellItem(
            psi, ctypes.byref(iid_sia), ctypes.byref(psia))
        if hr < 0:
            raise ctypes.WinError(hr)
        # SetSlideshow(items) (slot 12). restype=HRESULT auto-raises OSError on
        # failure (negative value) per ctypes' behavior, so the core failure
        # propagates to the caller and returns to the frontend as "failed".
        _vtbl(dw, 12, ctypes.HRESULT, [ctypes.c_void_p])(dw, psia)
        # SetSlideshowOptions(options, tickMs) (slot 14, minimum tick is 1000ms) and
        # SetPosition(FILL) (slot 10) are cosmetic. By this point the slideshow
        # itself is established, so on failure we just log and continue treating
        # the apply as successful.
        opts = _DSO_SHUFFLEIMAGES if shuffle else 0
        try:
            _vtbl(dw, 14, ctypes.HRESULT, [ctypes.c_int, ctypes.c_uint])(
                dw, opts, int(interval_s * 1000))
            _vtbl(dw, 10, ctypes.HRESULT, [ctypes.c_int])(dw, _DWPOS_FILL)
        except OSError as e:
            print(f"[wallpaper] slideshow options/position failed: {e}", file=sys.stderr)
        # SetSlideshow doesn't switch the "currently displayed image"; Windows keeps
        # showing the current image it holds (rotation begins from the next tick).
        # Since the caller doesn't delete the displayed file (prune_current_set keeps
        # the live one), it normally stays a valid image and doesn't go black. If the
        # current image somehow points at a nonexistent path (abnormal case, already
        # black, etc.), pin an existing image to recover. The slideshow may drop to
        # static in that case, but that beats a black screen (it returns to rotating
        # once the displayed file is valid at the next apply).
        current = _win_current_wallpaper_paths(dw)
        if current and not all(os.path.isfile(p) for p in current):
            images = sorted(str(p) for p in folder.iterdir()
                            if p.is_file() and p.suffix.lower() in _IMG_EXTS)
            if images:
                _win_pin_current_image(dw, images[0])
    finally:
        _com_release(psia)
        _com_release(psi)
        _com_release(dw)
        ctypes.windll.ole32.CoUninitialize()


def _win_set_wallpaper_spi(p: str) -> None:
    """Legacy SPI fallback (for when COM is unavailable). Sets the display style to fill."""
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
    # System Events' native "point at a folder and rotate at a fixed interval" rotation.
    # picture rotation: 0=off, 1=interval, 2=on login/wake from sleep.
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
    # GNOME's native slideshow points picture-uri at a <background> XML. We write
    # a chain that shows each image for `duration` seconds and transitions to the
    # next (wrapping back to the first at the end to loop).
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
    # Non-GNOME (feh) can't rotate on a timer, so fall back to the first image as static.
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
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(http.server.SimpleHTTPRequestHandler):
    """Static serving stays as SimpleHTTPRequestHandler; only /api/* is handled ourselves."""

    # Quiet the log a bit (don't emit the health-check-like GET /api/ping every time)
    def log_message(self, fmt: str, *args) -> None:
        p = self.path or ""
        if "/api/ping" in p or "/api/wallpaper/progress" in p:  # silence frequent polling
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
        # DNS-rebinding defense. The server binds only to 127.0.0.1, so legitimate
        # access always has a loopback-literal Host. Even if a malicious site
        # rebinds its own domain to 127.0.0.1 to become same-origin and fires with
        # X-OLD-Local attached, the Host header is still the attacker's domain so
        # it's rejected here (reinforces the CSRF gate).
        host = self.headers.get("Host", "")
        hostname = host.rsplit(":", 1)[0].strip("[]") if host else ""
        return hostname in ("127.0.0.1", "localhost", "::1")

    def do_GET(self) -> None:
        path = self._path()
        if path == "/api/ping":
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
        if path == "/api/wallpaper/progress":
            # For progress polling during apply (read-only, so no CSRF header needed; only check Host).
            if not self._host_ok():
                self._json(403, {"ok": False, "error": "bad host"})
                return
            with _wp_progress_lock:
                self._json(200, {"done": _wp_progress["done"], "total": _wp_progress["total"]})
            return
        super().do_GET()  # everything else is normal static serving

    def do_POST(self) -> None:
        path = self._path()
        if not path.startswith("/api/"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        # DNS-rebinding defense: reject any non-loopback Host (reinforces the CSRF gate)
        if not self._host_ok():
            self._json(403, {"ok": False, "error": "bad host"})
            return
        # CSRF gate: custom header required (cross-site can't attach it)
        if self.headers.get(CSRF_HEADER) is None:
            self._json(403, {"ok": False, "error": "forbidden"})
            return
        try:
            body = self._read_json()
            if path == "/api/wallpaper":
                self._handle_wallpaper(body)
            else:
                self._json(404, {"ok": False, "error": "not found"})
        except Exception as e:  # always reply in JSON whatever happens (the frontend checks ok)
            self._json(500, {"ok": False, "error": str(e)})

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > MAX_BODY_BYTES:
            raise ValueError("request body too large")
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw or b"{}")

    def _handle_wallpaper(self, body: dict) -> None:
        """Download the selected URLs into the current folder and dispatch to static/slideshow by count.

        body: {urls: [...], interval: ms, shuffle: bool}. Also accepts a singular
        url for backward compat. 1 image -> static wallpaper (also cancels the
        slideshow); 2+ -> OS-native slideshow.
        """
        urls = [str(u) for u in (body.get("urls") or [])]
        if not urls and body.get("url"):
            urls = [str(body["url"])]  # backward compat with the old {url} form
        urls = [u for u in urls if validate_url(u)]
        if not urls:
            self._json(400, {"ok": False, "error": "no valid urls"})
            return

        # Black-screen prevention: before cleaning the previous set, find the
        # "currently displayed file" and keep only that. The OS-native slideshow
        # holds onto the displayed image path, so deleting it leaves the path
        # pointing at nothing and the screen goes black (verified on real Windows
        # hardware). The displayed file survives until the slideshow rotates onward
        # to the new set, then gets cleaned at the next apply (once it's no longer displayed).
        folder = current_set_dir()
        keep = live_wallpaper_names() | {safe_filename(u) for u in urls}
        prune_current_set(keep)
        # Download one at a time while updating progress (the frontend polls /api/wallpaper/progress).
        set_wp_progress(0, len(urls))
        paths = []
        for u in urls:
            paths.append(download_image(u, folder))
            set_wp_progress(len(paths), len(urls))

        if len(paths) == 1:
            set_wallpaper_static(paths[0])
            mode = "static"
        else:
            interval_s = float(body.get("interval", 300000)) / 1000.0
            set_slideshow(folder, interval_s, shuffle=bool(body.get("shuffle", False)))
            mode = "slideshow"
        self._json(200, {"ok": True, "count": len(paths), "mode": mode})


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
def _serve(port: int) -> http.server.ThreadingHTTPServer:
    # ThreadingHTTPServer: serve other requests (stop / static) even during an
    # image download (up to ~20s). directory= makes the serving root explicit and
    # removes the cwd dependency (supports PyInstaller bundling).
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

    # Native window if pywebview is present. GUIs require the main thread
    # (especially on macOS), so run the server on a separate (daemon) thread and
    # start webview on the main thread.
    if not no_window:
        try:
            import webview  # pywebview
        except ImportError:
            webview = None
        if webview is not None:
            # Try a native window. Even with pywebview present, a broken GUI backend
            # (e.g. no WebKitGTK / no DISPLAY on Linux) makes create_window/start
            # throw something other than ImportError, so in that case switch to the
            # browser and keep the server alive while waiting.
            server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            server_thread.start()
            try:
                webview.create_window("OpenLeagueDisplay", url, width=1280, height=800)
                # Explicitly specify the Windows taskbar/titlebar icon. With nothing
                # specified, pywebview extracts the icon from the running exe
                # (winforms.py), but if extraction fails (e.g. under UPX compression)
                # it falls back to the default icon. Pass the bundled icon.ico
                # directly to make it reliable. macOS uses the different .icns format
                # and Linux is backend-dependent, so only pass it on Windows.
                start_kwargs = {}
                icon_path = os.path.join(BASE_DIR, "icon.ico")
                if sys.platform == "win32" and os.path.isfile(icon_path):
                    start_kwargs["icon"] = icon_path
                webview.start(**start_kwargs)
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
        # pywebview not installed: open the default browser and run the server in the foreground
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
