#!/usr/bin/env python3
"""
icon.ico regeneration script
============================
Draws favicon.svg's brand mark (rounded dark-navy background + gold "L")
directly with Pillow to produce icon.ico for the Windows exe / installer /
shortcut.

icon.ico is committed to the repo (~10KB) as a "small brand asset" like
ogp.png / screenshot.png; it is not generated at build time in CI. Run this
locally only when the brand (favicon.svg) changes, then re-commit the
generated icon.ico.

Why draw instead of rasterizing the SVG: ImageMagick's RSVG delegate was
observed to fail on the GitHub Actions Windows runner with
`unable to read image data ... RenderRSVGImage`. The shape is simple, so
drawing the same rectangles/rounded corners with Pillow is more reliable
(only dependency is Pillow, no system libraries needed).

**Keep the shape in sync with favicon.svg** — change one, change both. Colors
match the site's --bg / --gold.

Run (uv keeps deps out of your environment, one shot):
    uv run --with pillow python make_icon.py     # -> icon.ico
    # or: pip install pillow && python make_icon.py [output path]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

BG = (7, 6, 11, 255)        # favicon.svg's #07060b (rounded background)
GOLD = (212, 168, 87, 255)  # #d4a857 ("L" and serifs)

# Sizes to pack into the .ico (largest first). 256 is stored as a PNG-compressed entry.
SIZES = [256, 128, 64, 48, 32, 16]


def render(px: int) -> Image.Image:
    """Draw the 64-unit viewBox at px x px. Render at 4x and downscale for antialiasing."""
    ss = 4
    n = px * ss
    s = n / 64.0  # pixels per SVG unit
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def rect(x0: float, y0: float, x1: float, y1: float) -> None:
        d.rectangle([x0 * s, y0 * s, x1 * s, y1 * s], fill=GOLD)

    # Rounded dark-navy background (favicon.svg: rect 64x64 rx=10)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=10 * s, fill=BG)

    # "L" body (path M20 12 L20 52 L48 52, stroke-width 7, square cap / miter join).
    # Reproduce the stroke with 2 rectangles: square cap extends ends by half-width
    # (3.5), miter join fills the corner with a rectangle, so the rectangle form
    # matches the SVG's rendered result.
    rect(16.5, 8.5, 23.5, 55.5)   # vertical bar: top square cap -> 12-3.5=8.5, bottom to corner
    rect(16.5, 48.5, 51.5, 55.5)  # horizontal bar: right square cap -> 48+3.5=51.5, left shares corner

    # Serifs (favicon.svg's 2 lines, stroke-width 3, default butt cap)
    rect(14.0, 10.5, 26.0, 13.5)  # top horizontal line (centered at y=12)
    rect(46.5, 46.0, 49.5, 58.0)  # bottom vertical line (centered at x=48)

    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "icon.ico")
    out.parent.mkdir(parents=True, exist_ok=True)
    master = render(max(SIZES))
    master.save(out, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"==> {out} ({out.stat().st_size} bytes, sizes={SIZES})")


if __name__ == "__main__":
    main()
