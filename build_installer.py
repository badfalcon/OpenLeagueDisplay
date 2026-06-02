#!/usr/bin/env python3
"""installer/windows.iss を Inno Setup でビルドするローカル用ラッパー (Windows 専用)。

CI (release.yml) はランナーに Inno Setup を入れて ISCC.exe を直接呼ぶ。これはその
ローカル版で、PyCharm の Run Configuration "Build installer (Inno Setup)" から手元で
setup.exe を作るためのもの。ISCC.exe は Python ではないので、前提チェック付きの薄い
ラッパーにして「先に exe を作る」「Inno Setup を入れる」を分かりやすく案内する。
スクリプトは stdlib のみ (プロジェクト方針)。

前提:
  1. 先に PyInstaller ビルドで dist/OpenLeagueDisplay.exe を作る
     (Run ▸ "Build desktop exe (PyInstaller)" / python -m PyInstaller --noconfirm local_app.spec)
  2. Inno Setup 6 がインストール済み (ISCC.exe)。未導入なら:
       winget install JRSoftware.InnoSetup

使い方:
  python build_installer.py            # AppVersion=dev でビルド
  python build_installer.py 1.2.3      # AppVersion=1.2.3

出力: installer/out/OpenLeagueDisplay-windows-setup.exe
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
    """ISCC.exe を PATH → 標準インストール先の順に探す。見つからなければ None。"""
    found = shutil.which("ISCC") or shutil.which("ISCC.exe")
    if found:
        return found
    # 標準 (管理者) インストール先 + winget の per-user インストール先 (%LOCALAPPDATA%\Programs)
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
        print("Windows 専用です (Inno Setup は Windows のみ)。", file=sys.stderr)
        return 2
    if not EXE.is_file():
        print(
            f"先に exe をビルドしてください: {EXE} がありません\n"
            "  Run ▸ 'Build desktop exe (PyInstaller)'  または\n"
            "  python -m PyInstaller --noconfirm local_app.spec",
            file=sys.stderr,
        )
        return 2
    iscc = find_iscc()
    if not iscc:
        print(
            "Inno Setup (ISCC.exe) が見つかりません。インストールしてください:\n"
            "  winget install JRSoftware.InnoSetup",
            file=sys.stderr,
        )
        return 2

    version = sys.argv[1] if len(sys.argv) > 1 else "dev"
    cmd = [iscc, f"/DAppVersion={version}", str(ISS)]
    print("実行:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd)
    if result.returncode == 0:
        print(f"\n完成: {OUT}" if OUT.is_file() else "\nビルド成功 (出力先: installer/out)")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
