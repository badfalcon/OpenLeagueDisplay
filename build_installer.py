#!/usr/bin/env python3
"""Local wrapper that builds installer/windows.iss with Inno Setup (Windows only).

CI (release.yml) installs Inno Setup on the runner and calls ISCC.exe directly.
This is the local equivalent, for building setup.exe by hand from PyCharm's
"Build installer (Inno Setup)" Run Configuration. Since ISCC.exe isn't Python,
this is a thin wrapper with prerequisite checks that clearly guides "build the exe
first" and "install Inno Setup". The script is stdlib-only (project policy).

Prerequisites:
  1. Build dist/OpenLeagueDisplay.exe first with PyInstaller
     (Run ▸ "Build desktop exe (PyInstaller)" / python -m PyInstaller --noconfirm local_app.spec)
  2. Inno Setup 6 installed (ISCC.exe). If not installed:
       winget install JRSoftware.InnoSetup

Usage:
  python build_installer.py            # build with AppVersion=dev
  python build_installer.py 1.2.3      # AppVersion=1.2.3

Output: installer/out/OpenLeagueDisplay-windows-setup.exe
"""
import os
import pathlib
import shutil
import subprocess
import sys

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


def main() -> int:
    if sys.platform != "win32":
        print("Windows only (Inno Setup is Windows-only).", file=sys.stderr)
        return 2
    if not EXE.is_file():
        print(
            f"Build the exe first: {EXE} is missing\n"
            "  Run ▸ 'Build desktop exe (PyInstaller)'  or\n"
            "  python -m PyInstaller --noconfirm local_app.spec",
            file=sys.stderr,
        )
        return 2
    iscc = find_iscc()
    if not iscc:
        print(
            "Inno Setup (ISCC.exe) not found. Please install it:\n"
            "  winget install JRSoftware.InnoSetup",
            file=sys.stderr,
        )
        return 2

    version = sys.argv[1] if len(sys.argv) > 1 else "dev"
    cmd = [iscc, f"/DAppVersion={version}", str(ISS)]
    print("Running:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd)
    if result.returncode == 0:
        print(f"\nDone: {OUT}" if OUT.is_file() else "\nBuild succeeded (output dir: installer/out)")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
