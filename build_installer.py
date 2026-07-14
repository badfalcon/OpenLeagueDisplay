#!/usr/bin/env python3
"""Local wrapper that builds the desktop exe AND installer/windows.iss (Windows only).

CI (release.yml) installs Inno Setup on the runner and calls ISCC.exe directly.
This is the local equivalent, for building setup.exe by hand from PyCharm's
"Build installer (Inno Setup)" Run Configuration. The script is stdlib-only
(project policy; PyInstaller is invoked as a subprocess, not imported).

The exe is REBUILT by default, every time. The installer only wraps whatever
dist/OpenLeagueDisplay.exe already is — and the exe bundles the whole frontend
(index.html / js / data.json), so a stale exe means the setup.exe silently ships
old code even though the installer build itself "succeeded". That failure mode is
invisible at build time, so the default is the safe order (exe → installer) and
skipping is the explicit exception.

Prerequisites:
  1. pip install pyinstaller pywebview   (only needed unless --skip-exe)
  2. Inno Setup 6 installed (ISCC.exe). If not installed:
       winget install JRSoftware.InnoSetup

Usage:
  python build_installer.py                 # rebuild exe, then build setup.exe (AppVersion=dev)
  python build_installer.py 1.2.3           # same, with AppVersion=1.2.3
  python build_installer.py --skip-exe      # wrap the existing dist exe as-is (shows its build time)

Output: installer/out/OpenLeagueDisplay-windows-setup.exe
"""
import datetime
import os
import pathlib
import shutil
import subprocess
import sys

# Windows consoles default to cp932/cp1252, which can't print this script's own messages
# (em dash etc.) and crashes with UnicodeEncodeError. Same fix as generate_data.py / local_app.py.
for _stream in (sys.stdout, sys.stderr):
    try:
        if _stream is not None:
            _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

ROOT = pathlib.Path(__file__).resolve().parent
ISS = ROOT / "installer" / "windows.iss"
EXE = ROOT / "dist" / "OpenLeagueDisplay.exe"
OUT = ROOT / "installer" / "out" / "OpenLeagueDisplay-windows-setup.exe"


def find_iscc() -> str | None:
    """Find ISCC.exe in PATH, then the standard install locations. None if not found."""
    found = shutil.which("ISCC") or shutil.which("ISCC.exe")
    if found:
        return found
    # Standard (admin) install location + winget's per-user install location (%LOCALAPPDATA%\Programs)
    bases = (
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("ProgramFiles"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs") if os.environ.get("LOCALAPPDATA") else None,
    )
    for base in bases:
        if not base:
            continue
        for ver in ("Inno Setup 6", "Inno Setup 5"):
            cand = pathlib.Path(base) / ver / "ISCC.exe"
            if cand.is_file():
                return str(cand)
    return None


def find_build_python() -> str | None:
    """The interpreter to run PyInstaller with: this one if it has PyInstaller, else the repo venv.

    The fallback exists because IDE run configurations can launch this script with an unrelated
    interpreter (a stale SDK pin from another project did exactly that), and "No module named
    PyInstaller" would then fail a build that the repo's own .venv could complete just fine.
    """
    candidates = [sys.executable, str(ROOT / ".venv" / "Scripts" / "python.exe")]
    for cand in candidates:
        if not cand or not pathlib.Path(cand).is_file():
            continue
        probe = subprocess.run([cand, "-m", "PyInstaller", "--version"],
                               capture_output=True, text=True)
        if probe.returncode == 0:
            return cand
    return None


def build_exe() -> bool:
    """Rebuild dist/OpenLeagueDisplay.exe with PyInstaller."""
    python = find_build_python()
    if python is None:
        print(
            "PyInstaller not found (checked this interpreter and .venv). Install the build deps:\n"
            "  pip install pyinstaller pywebview\n"
            "or, to wrap the existing dist exe as-is: python build_installer.py --skip-exe",
            file=sys.stderr,
        )
        return False
    if python != sys.executable:
        print(f"(this interpreter has no PyInstaller; using the repo venv: {python})")
    cmd = [python, "-m", "PyInstaller", "--noconfirm", str(ROOT / "local_app.spec")]
    print("[1/2] Rebuilding the exe:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        print("\nPyInstaller failed — see its output above.", file=sys.stderr)
        return False
    return True


def main() -> int:
    if sys.platform != "win32":
        print("Windows only (Inno Setup is Windows-only).", file=sys.stderr)
        return 2
    args = sys.argv[1:]
    skip_exe = "--skip-exe" in args
    positional = [a for a in args if not a.startswith("-")]
    version = positional[0] if positional else "dev"

    if skip_exe:
        if not EXE.is_file():
            print(
                f"--skip-exe, but there is no exe to wrap: {EXE} is missing\n"
                "  python -m PyInstaller --noconfirm local_app.spec",
                file=sys.stderr,
            )
            return 2
        # Skipping means shipping whatever this file happens to be — make its age visible so a
        # stale exe (the exact trap the default rebuild exists to prevent) is at least on screen.
        built = datetime.datetime.fromtimestamp(EXE.stat().st_mtime)
        print(f"[1/2] Skipping the exe rebuild — wrapping dist exe built {built:%Y-%m-%d %H:%M}")
    elif not build_exe():
        return 2

    iscc = find_iscc()
    if not iscc:
        print(
            "Inno Setup (ISCC.exe) not found. Please install it:\n"
            "  winget install JRSoftware.InnoSetup",
            file=sys.stderr,
        )
        return 2

    cmd = [iscc, f"/DAppVersion={version}", str(ISS)]
    print("[2/2] Building the installer:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd)
    if result.returncode == 0:
        print(f"\nDone: {OUT}" if OUT.is_file() else "\nBuild succeeded (output dir: installer/out)")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
