#!/usr/bin/env python3
"""
icon.ico 再生成スクリプト
=========================
favicon.svg のブランドマーク (角丸の濃紺背景 + ゴールドの "L") を Pillow で直接
描画し、Windows の exe / インストーラ / ショートカット用の icon.ico を作る。

icon.ico は ogp.png / screenshot.png と同じ「小さなブランド資産」としてリポジトリに
コミットしてある (~10KB)。CI でビルド時生成はしない。ブランド (favicon.svg) を
変えた時だけ手元でこれを実行し、生成された icon.ico をコミットし直す。

なぜ SVG をラスタライズせず描画するか: ImageMagick の RSVG デリゲートは GitHub
Actions の Windows ランナーで `unable to read image data ... RenderRSVGImage` で
落ちることが確認できた。図形が単純なので、SVG を介さず同じ矩形/角丸を Pillow で
描く方が確実 (依存は Pillow だけ、システムライブラリ不要)。

**図形は favicon.svg と一致させること** — 片方を変えたら両方直す。色は site の
--bg / --gold と同じ。

実行 (uv なら依存を汚さず一発):
    uv run --with pillow python make_icon.py     # → icon.ico
    # もしくは: pip install pillow && python make_icon.py [出力パス]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

BG = (7, 6, 11, 255)        # favicon.svg の #07060b (角丸背景)
GOLD = (212, 168, 87, 255)  # #d4a857 ("L" とセリフ)

# .ico に詰めるサイズ (大きい順)。256 は PNG 圧縮エントリとして格納される。
SIZES = [256, 128, 64, 48, 32, 16]


def render(px: int) -> Image.Image:
    """64 単位の viewBox を px 四方に描く。アンチエイリアスのため 4x で描いて縮小する。"""
    ss = 4
    n = px * ss
    s = n / 64.0  # 1 SVG 単位あたりのピクセル数
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def rect(x0: float, y0: float, x1: float, y1: float) -> None:
        d.rectangle([x0 * s, y0 * s, x1 * s, y1 * s], fill=GOLD)

    # 角丸の濃紺背景 (favicon.svg: rect 64x64 rx=10)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=10 * s, fill=BG)

    # "L" 本体 (path M20 12 L20 52 L48 52, stroke-width 7, square cap / miter join)。
    # stroke を 2 本の矩形で再現する: square cap は端を半幅 (3.5) 延長、miter join は
    # 角を矩形で埋めるので、矩形表現が SVG のレンダリング結果と一致する。
    rect(16.5, 8.5, 23.5, 55.5)   # 縦棒: 上端 square cap → 12-3.5=8.5、下は角まで
    rect(16.5, 48.5, 51.5, 55.5)  # 横棒: 右端 square cap → 48+3.5=51.5、左は角を共有

    # セリフ (favicon.svg の 2 本の line, stroke-width 3, 既定の butt cap)
    rect(14.0, 10.5, 26.0, 13.5)  # 上の横線 (y=12 中心)
    rect(46.5, 46.0, 49.5, 58.0)  # 下の縦線 (x=48 中心)

    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "icon.ico")
    out.parent.mkdir(parents=True, exist_ok=True)
    master = render(max(SIZES))
    master.save(out, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"==> {out} ({out.stat().st_size} bytes, sizes={SIZES})")


if __name__ == "__main__":
    main()
