#!/usr/bin/env python3
"""
Build the Turntable theme's room art (js/ttskin.js, css/ttskin.css) from the
community archive of Turntable.fm's room assets (github.com/ttdevelopers/image-assets)
and this site's own images. Never deployed (tools/).

    git clone --depth 1 https://github.com/ttdevelopers/image-assets.git /tmp/tt-image-assets
    pip install pillow
    python3 tools/tt-art.py /tmp/tt-image-assets

Writes img/tt/<name>.webp for the stage, and img/tt/stickers.webp: every
laptop sticker that isn't an emoji in one picture (STICKERS below; the order
is the sticker's place in it, and js/ttskin.js lists the same names).
"""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tt-image-assets"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img", "tt")

ART = ["stage.png", "floor.jpg", "curtain.png", "lights0Add.png", "lights2Normal.png", "dj-light.png",
       "board.png", "dial.png", "needle.png", "dj-table.png", "screen.png"]

# (name, file): the room's own first, then Turntable's gold stickers
STICKERS = [
    ("id", os.path.join(ROOT, "img", "idlogo.png")),
    ("id9", os.path.join(ROOT, "img", "id9.png")),
    ("eight", os.path.join(ROOT, "img", "8.png")),
    ("cake", os.path.join(ROOT, "img", "cake.png")),
    ("rohn", os.path.join(ROOT, "img", "rohn.png")),
    ("heart", "gold_heart.png"), ("happy", "gold_happy.png"), ("wink", "gold_wink.png"),
    ("laughing", "gold_laughing.png"), ("sad", "gold_sad.png"), ("smh", "gold_smh.png"),
    ("poop", "gold_poop.png"), ("glowstick", "gold_glowstick.png"),
]
CELL = 160


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in ART:
        im = Image.open(os.path.join(SRC, f))
        im = im.convert("RGB" if f.endswith(".jpg") else "RGBA")
        im.save(os.path.join(OUT, os.path.splitext(f)[0] + ".webp"), "WEBP", quality=82 if f.endswith(".jpg") else 88, method=6)
    sheet = Image.new("RGBA", (CELL * len(STICKERS), CELL), (0, 0, 0, 0))
    for k, (name, f) in enumerate(STICKERS):
        im = Image.open(f if os.path.isabs(f) else os.path.join(SRC, f)).convert("RGBA")
        im.thumbnail((CELL - 8, CELL - 8), Image.LANCZOS)
        sheet.paste(im, (k * CELL + (CELL - im.width) // 2, (CELL - im.height) // 2), im)
    sheet.save(os.path.join(OUT, "stickers.webp"), "WEBP", quality=88, method=6)
    print(len(ART), "pictures and", len(STICKERS), "stickers")


if __name__ == "__main__":
    main()
