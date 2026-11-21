#!/usr/bin/env python3
"""
Build the Turntable theme's avatars (js/ttskin.js) from the community archive
of every Turntable.fm avatar (github.com/ttdevelopers/avatars, art by Yiying Lu
and the Turntable.fm staff). Never deployed (tools/).

    git clone --depth 1 https://github.com/ttdevelopers/avatars.git /tmp/tt-avatars
    pip install pillow numpy
    python3 tools/tt-avatars.py /tmp/tt-avatars

Writes, for each avatar, one sprite img/tt/av/<id>.webp holding its front and
back (as the archive draws them whole), then the head and body of each side
apart, so the room can rock a head on its body the way Turntable did. And
img/tt/avatars.json: per avatar, where each part sits in the sprite and where
it goes in the whole figure. And the avatar picker's pages, img/tt/pick/<tier>-<n>.webp:
one picture of PAGE fronts each, so a page of the picker is one request.

    python3 tools/tt-avatars.py /tmp/tt-avatars --pages   # only the picker's pages
"""
import json
import os
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tt-avatars"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img", "tt", "av")
PAGE, CELL_W, CELL_H = 16, 100, 128  # the picker: 4 x 4 a page, at twice its size on screen
GAP = 2  # transparent pixels between parts, so scaling never bleeds one into the next


def load(av, part):
    p = os.path.join(SRC, av + "_" + part + ".png")
    return Image.open(p).convert("RGBA") if os.path.exists(p) else None


def _xcorr(a, b):
    """Valid-mode cross-correlation of 2-D arrays a (big) and b (small), by FFT."""
    H, W = a.shape[0] + b.shape[0], a.shape[1] + b.shape[1]
    r = np.fft.irfft2(np.fft.rfft2(a, (H, W)) * np.conj(np.fft.rfft2(b, (H, W))), (H, W))
    return r[: a.shape[0] - b.shape[0] + 1, : a.shape[1] - b.shape[1] + 1]


def place(full, part):
    """Where `part` sits in `full`: the offset with the least squared difference
    over the part's opaque pixels (all offsets at once, by FFT)."""
    F = np.asarray(full, dtype=np.float64) / 255
    P = np.asarray(part, dtype=np.float64) / 255
    if P.shape[0] > F.shape[0] or P.shape[1] > F.shape[1]:
        return None
    M = (P[:, :, 3] > 0.8).astype(np.float64)
    n = M.sum()
    if n < 20:
        return None
    ssd = 0
    for c in range(4):
        f, p = F[:, :, c], P[:, :, c] * M
        ssd = ssd + _xcorr(f * f, M) - 2 * _xcorr(f, p) + (p * p).sum()
    y, x = np.unravel_index(np.argmin(ssd), ssd.shape)
    return (int(x), int(y)) if ssd[y, x] / n < 0.02 else None


def order(av):
    return (0, int(av)) if av.isdigit() else (1, av)


def tier(av):
    if not av.isdigit():
        return "special"
    n = int(av)
    if n >= 2000:
        return "gold"
    if n >= 1000:
        return "special"
    return "classic"


def pages(ids):
    """The picker's pages: PAGE fronts in a row, each fitted into its cell, standing on its floor."""
    out = os.path.join(ROOT, "img", "tt", "pick")
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    by = {}
    for av in ids:
        by.setdefault(tier(av), []).append(av)
    for t, avs in by.items():
        for n in range(0, len(avs), PAGE):
            sheet = Image.new("RGBA", (CELL_W * PAGE, CELL_H), (0, 0, 0, 0))
            for k, av in enumerate(avs[n:n + PAGE]):
                im = load(av, "FullFront")
                im.thumbnail((CELL_W - 4, CELL_H - 4), Image.LANCZOS)
                sheet.paste(im, (k * CELL_W + (CELL_W - im.width) // 2, CELL_H - im.height - 2), im)
            sheet.save(os.path.join(out, "%s-%d.webp" % (t, n // PAGE)), "WEBP", quality=86, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    ids = sorted({f[: -len("_FullFront.png")] for f in os.listdir(SRC) if f.endswith("_FullFront.png")}, key=order)
    pages(ids)
    if "--pages" in sys.argv:
        return
    manifest = []
    for av in ids:
        sides = {}
        parts = []
        for side, S in (("f", "Front"), ("b", "Back")):
            full = load(av, "Full" + S) or load(av, "Full" + ("Back" if S == "Front" else "Front"))
            head, body = load(av, "Head" + S), load(av, "Body" + S)
            entry = {"w": full.width, "h": full.height}
            parts.append(full)
            entry["x"] = None  # filled in below
            split = None
            if head is not None and body is not None and (head.size != full.size or body.size != full.size):
                hp, bp = place(full, head), place(full, body)
                if hp and bp:
                    split = (head, hp, body, bp)
            elif head is not None and body is not None:
                split = (head, (0, 0), body, (0, 0))  # already the figure's size
            sides[side] = (entry, full, split)
        # lay out: front, back, then the parts
        x = 0
        sheet_parts = []
        rec = {"id": av, "t": tier(av)}
        for side in ("f", "b"):
            entry, full, split = sides[side]
            entry["x"] = x
            sheet_parts.append((full, x))
            x += full.width + GAP
            if split:
                head, hp, body, bp = split
                entry["body"] = [x, body.width, body.height, bp[0], bp[1]]
                sheet_parts.append((body, x))
                x += body.width + GAP
                entry["head"] = [x, head.width, head.height, hp[0], hp[1]]
                sheet_parts.append((head, x))
                x += head.width + GAP
            rec[side] = entry
        H = max(p.height for p, _ in sheet_parts)
        sheet = Image.new("RGBA", (x - GAP, H), (0, 0, 0, 0))
        for p, px in sheet_parts:
            sheet.paste(p, (px, 0))
        rec["sw"], rec["sh"] = sheet.width, sheet.height
        sheet.save(os.path.join(OUT, av + ".webp"), "WEBP", quality=88, method=6)
        manifest.append(rec)
    with open(os.path.join(ROOT, "img", "tt", "avatars.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    split = sum(1 for r in manifest if "head" in r["f"])
    print(len(manifest), "avatars,", split, "with a head that rocks")


if __name__ == "__main__":
    main()
