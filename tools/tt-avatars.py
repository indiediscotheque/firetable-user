#!/usr/bin/env python3
"""
Build the Turntable theme's avatars (js/ttskin.js) from the community archive
of every Turntable.fm avatar (github.com/ttdevelopers/avatars, art by Yiying Lu
and the Turntable.fm staff) and deepcut.fm's avatar data. Never deployed (tools/).

    git clone --depth 1 https://github.com/ttdevelopers/avatars.git /tmp/tt-avatars
    pip install pillow numpy
    python3 tools/tt-avatars.py /tmp/tt-avatars [/tmp/deepcut]

The room draws every side of every avatar the way Turntable did and deepcut.fm
(its revival) still does: a head picture over (or, for a few backs, under) a
body picture, each at its own place, so the head rocks and bobs on a body that
stays put, and nothing else moves (deepcut's blackswan/avatar-spriter: each
layer drawn at its offset, a head turning about its picture's middle). Where
each part goes, first found wins:

  1. Turntable's own dance sprite in the archive (<id>_front_bob.png): its first
     frame is the figure at rest, put together by Turntable from the parts, so
     each part is found in it exactly, and which is drawn over which. First,
     since deepcut typed some places in again (its gold avatars' heads lower
     than Turntable had them, two with a gap under the head).
  2. deepcut's own data (its /api/avatar.all: per avatar, per side, its layers
     in drawing order and their offsets) with deepcut's pictures of the parts.
     Fetched once into the second folder (default /tmp/deepcut).
  3. The archive's whole picture, each part found in it.
  4. The one the archive has no parts for at all (1004): the head is cut from
     the whole picture along its own outline (never a straight line), and the
     body under it carried up under the head's edge, so a head that moves
     never shows a hole.

Avatars in RETIRED are left out of the set (the room keeps their place in
its classics, js/ttskin.js RETIRED, so nobody's own classic changes).

Writes, for each avatar, one sprite img/tt/av/<id>.webp: the front's whole
picture (the circle avatars' face), then each side's body and head. And
img/tt/avatars.json: per avatar, per side (f, b), the figure's box `w` x `h`
(round what the parts show at rest: the feet on its bottom) and its parts
`body` and `head`: [x in the sprite, w, h, dx, dy in the box]; `u` when the
head is drawn under the body. The front also has `x` (its whole picture in the
sprite), `face` and `chin`. And the sprite's version (`v`, its hash, for its
link). And the avatar picker's pages, img/tt/pick/<tier>-<n>.webp: one picture
of PAGE fronts each, so a page of the picker is one request.

    python3 tools/tt-avatars.py /tmp/tt-avatars --pages   # only the picker's pages
    python3 tools/tt-avatars.py /tmp/tt-avatars --chins   # measure each front's chin and face again
    python3 tools/tt-avatars.py /tmp/tt-avatars --review /tmp/review   # sheets of every side at rest, rocked and bobbed

`chin`: how far down the front's box (in %) its chin is, where a DJ's laptop
lid lines up: the head's own picture, 0.9 of the way down what it shows.
`face`: [x, y, size] in the front's whole picture, the square a circle avatar
shows (chat, lists, the bar): the head down to the chin, leaving out thin bits
(antennae, antlers, ear tips) so the face fills the circle.
Chins and faces were checked by eye: kept from the manifest there is, measured
only for new avatars (--chins measures them all again).
"""
import hashlib
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

ARGS = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] != "--review"]
SRC = ARGS[0] if ARGS else "/tmp/tt-avatars"
DC = ARGS[1] if len(ARGS) > 1 else "/tmp/deepcut"
DC_HOST = "https://deepcut.live"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img", "tt", "av")
MANIFEST = os.path.join(ROOT, "img", "tt", "avatars.json")
PAGE, CELL_W, CELL_H = 16, 100, 128  # the picker: 4 x 4 a page, at twice its size on screen
FRONT_GAP = 36  # clear space after the front: a circle avatar's frame can reach past its edge
GAP = 2  # transparent pixels between parts, so scaling never bleeds one into the next
SIDES = (("f", "Front", "front"), ("b", "Back", "back"))
# left out of the set (keep js/ttskin.js RETIRED the same): 25, a photo of a person's head
# on a photo of their body, with no head or back of its own in the archive
RETIRED = {"25"}


def version(av):
    """The sprite's version for its link (?v=): the first 10 of its SHA-256, as the deploy's cache-bust.py does."""
    with open(os.path.join(OUT, av + ".webp"), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def load(av, part):
    p = os.path.join(SRC, av + "_" + part + ".png")
    return Image.open(p).convert("RGBA") if os.path.exists(p) else None


def alpha(im, t=128):
    return np.asarray(im)[:, :, 3] > t


# ─── deepcut's data ──────────────────────────────────────────────────────────

def deepcut():
    """deepcut's avatars (its /api/avatar.all), each part's picture fetched once into DC."""
    os.makedirs(DC, exist_ok=True)
    path = os.path.join(DC, "avatar.all.json")
    if not os.path.exists(path):
        with urllib.request.urlopen(DC_HOST + "/api/avatar.all", timeout=60) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
    with open(path) as f:
        avatars = json.load(f)[1]["avatars"]
    for av, a in avatars.items():
        for name in {l["name"] for side in a["states"].values() for l in side}:
            p = os.path.join(DC, av + "_" + name + ".png")
            if not os.path.exists(p):
                with urllib.request.urlopen(DC_HOST + a["images"][name], timeout=60) as r:
                    data = r.read()
                with open(p, "wb") as f:
                    f.write(data)
    return avatars


def dc_layers(av, a, side):
    """deepcut's layers for one side: [(role, picture, dx, dy)] in drawing order."""
    out = []
    for l in a["states"][side]:
        im = Image.open(os.path.join(DC, av + "_" + l["name"] + ".png")).convert("RGBA")
        out.append(("head" if l["name"].startswith("h") else "body", im, l["offset"][0], l["offset"][1]))
    return out


# ─── finding a part in a picture ─────────────────────────────────────────────

def _xcorr(a, b):
    """Valid-mode cross-correlation of 2-D arrays a (big) and b (small), by FFT."""
    H, W = a.shape[0] + b.shape[0], a.shape[1] + b.shape[1]
    r = np.fft.irfft2(np.fft.rfft2(a, (H, W)) * np.conj(np.fft.rfft2(b, (H, W))), (H, W))
    return r[: a.shape[0] - b.shape[0] + 1, : a.shape[1] - b.shape[1] + 1]


def _pad(full, part):
    """The picture with room round it, so a part can sit partly outside it."""
    px, py = part.width, part.height
    big = Image.new("RGBA", (full.width + 2 * px, full.height + 2 * py))
    big.paste(full, (px, py))
    return big, px, py


def match(full, part, hide=None):
    """Where `part` sits in `full` (it may reach past its edges), and how well:
    the offset with the least squared difference over the part's opaque pixels
    (all offsets at once, by FFT), and that difference a pixel. `hide`, a mask
    the size of `full`, is where something else is drawn over the part: not
    compared there, and each of the part's pixels it would hide costs a little
    (so a flat part can't hide behind it, the one place it matches everywhere)."""
    big, px, py = _pad(full, part)
    F = np.asarray(big, dtype=np.float64) / 255
    P = np.asarray(part, dtype=np.float64) / 255
    M = (P[:, :, 3] > 0.8).astype(np.float64)
    if M.sum() < 20:  # a faint part (a body that's only a shadow): all it shows
        M = (P[:, :, 3] > 0.05).astype(np.float64)
    n = M.sum()
    if n < 20:
        return None, 1e9
    Hm = np.zeros(F.shape[:2])
    if hide is not None:
        Hm[py:py + hide.shape[0], px:px + hide.shape[1]] = hide
    W = 1 - Hm
    ssd = 0.25 * _xcorr(Hm, M) if hide is not None else 0
    for c in range(4):
        f, p = F[:, :, c], P[:, :, c]
        ssd = ssd + _xcorr(W * f * f, M) - 2 * _xcorr(W * f, p * M) + _xcorr(W, M * p * p)
    y, x = np.unravel_index(np.argmin(ssd), ssd.shape)
    return (int(x) - px, int(y) - py), float(ssd[y, x] / n)


def stamp(shape, im, x, y, t=128):
    """`im`'s opaque pixels at (x, y), as a mask of `shape`."""
    m = np.zeros(shape, bool)
    a = alpha(im, t)
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + a.shape[1], shape[1]), min(y + a.shape[0], shape[0])
    if x1 > x0 and y1 > y0:
        m[y0:y1, x0:x1] = a[y0 - y:y1 - y, x0 - x:x1 - x]
    return m


def compose(layers, size, origin=(0, 0)):
    c = Image.new("RGBA", size)
    for _r, im, x, y in layers:
        layer = Image.new("RGBA", size)
        layer.paste(im, (x - origin[0], y - origin[1]))
        c = Image.alpha_composite(c, layer)
    return c


def differs(ref, layers):
    """How far the parts, put together, are from `ref`: the share of the figure's
    pixels shown by only one of the two, and the mean colour difference where both show."""
    got = compose(layers, ref.size)
    a, b = alpha(ref), alpha(got)
    n = max(a.sum(), 1)
    both = a & b
    col = np.abs(np.asarray(ref, dtype=int)[:, :, :3] - np.asarray(got, dtype=int)[:, :, :3])[both].mean() if both.any() else 255
    return ((a ^ b).sum() / n, col)


def found(ref, head, body):
    """The parts found in `ref` (a picture of the figure at rest), and which is drawn
    over which: ([(role, picture, x, y)] in drawing order, how far from `ref` they are)."""
    shape = (ref.height, ref.width)
    best = None
    # the part drawn last shows whole: found first, then the other with it hidden.
    # The head over the body first, as nearly every side has it: the other way only when it's closer
    for top, under, roles in ((head, body, ("body", "head")), (body, head, ("head", "body"))):
        tp, _ = match(ref, top)
        if tp is None:
            continue
        up, _ = match(ref, under, hide=stamp(shape, top, *tp))
        if up is None:
            continue
        layers = [(roles[0], under, up[0], up[1]), (roles[1], top, tp[0], tp[1])]
        d = differs(ref, layers)
        if best is None or d[0] < best[1][0] - 0.01:
            best = (layers, d)
    return best


# ─── the two with no head picture ────────────────────────────────────────────

def body_under(full, head_mask, rise=8):
    """The figure without its head, the body carried up under the head's edge: each
    column of the body that meets the head goes on up behind it (its top pixel
    repeated), `rise` pixels, so a head that moves shows the body's own colour."""
    a = np.asarray(full).copy()
    a[head_mask] = 0
    body = alpha(Image.fromarray(a), 40)
    for x in range(a.shape[1]):
        ys = np.nonzero(body[:, x])[0]
        if not len(ys):
            continue
        top = ys[0]
        if top == 0 or not head_mask[top - 1, x]:
            continue
        for y in range(top - 1, max(-1, top - 1 - rise), -1):
            if not head_mask[y, x]:
                break
            a[y, x] = a[top, x]
    return Image.fromarray(a)


def cut_head(full):
    """The head cut from the whole picture along its own outline (1004: a big round
    head over a little body): the picture's top piece once the shirt is taken out,
    the colour the body shows under the neck."""
    rgba = np.asarray(full).astype(int)
    op = rgba[:, :, 3] > 40
    # the neck: where the figure, narrowing from its widest (the head), first widens again
    widths = op.sum(axis=1)
    neck = int(np.argmax(widths))
    while neck + 1 < op.shape[0] and widths[neck + 1] <= widths[neck]:
        neck += 1
    # the shirt: its colour just under the neck, down the middle
    mid = np.nonzero(op[neck + 2])[0]
    shirt = rgba[neck + 2, mid[len(mid) // 2], :3]
    near = (np.abs(rgba[:, :, :3] - shirt).sum(axis=2) < 60) & op
    # the head: every piece above the neck once the shirt is taken out
    free = op & ~near
    free[neck + 1:] = False
    keep = free
    # the head's soft edge (its outline's half-clear pixels) stays with the head
    edge = op & ~keep & ~near
    grown = keep.copy()
    grown[1:] |= keep[:-1]
    grown[:-1] |= keep[1:]
    grown[:, 1:] |= keep[:, :-1]
    grown[:, :-1] |= keep[:, 1:]
    return keep | (edge & grown & (np.arange(op.shape[0])[:, None] <= neck + 1))


def cut_layers(full):
    head_mask = cut_head(full)
    a = np.asarray(full).copy()
    a[~head_mask] = 0
    head = Image.fromarray(a)
    body = body_under(full, head_mask)
    # each part kept to what it shows, the head over the body
    hb, bb = head.getbbox(), body.getbbox()
    return [("body", body.crop(bb), bb[0], bb[1]), ("head", head.crop(hb), hb[0], hb[1])]


def sound(layers):
    """Whether a head and body put together make one figure: they meet (within 2 px),
    the body isn't all hidden, and it stands under the head, not up behind it
    (Turntable's own sprite of 2063 draws its body behind the head's top; deepcut's
    places for 2022 and 2024 leave a gap under the head). A body that's only a faint
    shadow on the floor (the ornament) is one whatever."""
    l = min(x for _r, im, x, y in layers)
    t = min(y for _r, im, x, y in layers)
    r = max(x + im.width for _r, im, x, y in layers) - l + 4
    b = max(y + im.height for _r, im, x, y in layers) - t + 4
    m = {role: stamp((b, r), im, x - l + 2, y - t + 2) for role, im, x, y in layers}
    head, body = m["head"], m["body"]
    if not body.any():
        return True
    near = head.copy()
    for _ in range(2):
        g = near.copy()
        g[1:] |= near[:-1]
        g[:-1] |= near[1:]
        g[:, 1:] |= near[:, :-1]
        g[:, :-1] |= near[:, 1:]
        near = g
    shown = body if layers[-1][0] == "body" else body & ~head
    rows = lambda a: np.nonzero(a.any(axis=1))[0]
    hr, br = rows(head), rows(body)
    tall = max(hr[-1], br[-1]) - min(hr[0], br[0]) + 1
    return bool((near & body).any()) and shown.sum() >= 0.05 * body.sum() and br[-1] >= hr[-1] - 0.25 * tall


def side_layers(av, S, s, dc):
    """[(role, picture, x, y)] in drawing order, and where they came from."""
    head, body = load(av, "Head" + S), load(av, "Body" + S)
    full = load(av, "Full" + S)
    sprite = load(av, s + "_bob")
    rest = None
    if sprite is not None and sprite.width % 3 == 0 and sprite.height % 4 == 0:
        # 12 frames, 3 across (deepcut's makeSprite at 20 a second): the first is the figure at rest
        rest = sprite.crop((0, 0, sprite.width // 3, sprite.height // 4))
    if head is not None and body is not None and rest is not None:
        got = found(rest, head, body)
        # Turntable's own drawing (to the pixel, or near it where a part was drawn again:
        # the gold avatars' glowing heads), before deepcut's data: deepcut typed some
        # places in again, the gold avatars' heads lower than Turntable had them
        near = (0.04, 12) if av in dc else (0.12, 24)
        if got and got[1][0] < near[0] and got[1][1] < near[1] and sound(got[0]):
            return got[0], "turntable's sprite"
    if av in dc:
        got = dc_layers(av, dc[av], s)
        if sound(got):
            return got, "deepcut"
    if head is not None and body is not None and full is not None:
        got = found(full, head, body)
        # the parts put together show what the picture does (some whole pictures are
        # drawn a little apart from their parts: the parts are what the room drew)
        if got and got[1][0] < 0.12 and got[1][1] < 24 and sound(got[0]):
            return got[0], "the whole picture"
    return cut_layers(full or load(av, "FullFront")), "cut along the head's outline"


def boxed(layers):
    """The layers in the box round what they show (the feet on its bottom): their places in it."""
    l = t = 1 << 30
    r = b = -(1 << 30)
    for _role, im, x, y in layers:
        bb = im.getbbox()
        if not bb:
            continue
        l, t = min(l, x + bb[0]), min(t, y + bb[1])
        r, b = max(r, x + bb[2]), max(b, y + bb[3])
    return [(role, im, x - l, y - t) for role, im, x, y in layers], (r - l, b - t), (l, t)


# ─── chins and faces ─────────────────────────────────────────────────────────

def chin(entry, head):
    """% down the front's box where the chin is: 0.9 of the way down what the head shows."""
    _x, _w, _h, _dx, dy = entry["head"]
    bb = head.getbbox() or (0, 0, 0, head.height)
    return round(min(85, max(40, (dy + bb[1] + (bb[3] - bb[1]) * 0.9) / entry["h"] * 100)))


# id: [x, y, size], for the few whose outline has no neck to find (a gorilla, a mosquito, Frankenstein, the turkeys), checked by eye on the review sheet
FACE_OVERRIDES = {
    "23": [108, -6, 78], "129": [-6, -8, 120], "272": [94, 11, 70],
    "330": [44, -6, 100], "352": [40, 2, 88], "353": [32, -6, 100],
}


def face(av, full, chin_row):
    """The square a circle avatar shows, in the front's whole picture's pixels
    (chin_row: the chin's row in that picture)."""
    if av in FACE_OVERRIDES:
        return FACE_OVERRIDES[av]
    a = alpha(full, 60)
    h, w = a.shape
    chin_row = int(round(chin_row))
    widths = a.sum(axis=1)
    filled = [i for i in range(h) if widths[i]]
    if not filled:
        return [0, 0, min(w, h)]
    top = filled[0]
    band = a[top:max(top + 1, chin_row)]
    maxw = band.sum(axis=1).max()
    # only truly thin bits up top (antennae, a feather) don't count: hair, ears and hats do
    rows = [i for i in range(band.shape[0]) if band[i].sum() >= maxw * 0.18]
    t, b = top + rows[0], top + rows[-1]
    body = a[t:b + 1]
    colsum = body.sum(axis=0)
    cols = [j for j in range(w) if colsum[j] >= (b - t + 1) * 0.06]
    l, r = cols[0], cols[-1]
    fw, fh = r - l + 1, b - t + 1
    # the whole head inside the circle, with a little room: a round head's box needs about
    # 1.15 of its larger side across to clear the circle's edge
    size = max(fw, fh) * 1.16
    cx, cy = l + fw / 2, t + fh / 2
    return [round(cx - size / 2), round(cy - size / 2), round(size)]


# ─── building ────────────────────────────────────────────────────────────────

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


def make(job):
    """One avatar: each side's parts found, its sprite written, its manifest entry."""
    av, dc, k = job
    rec = {"id": av, "t": tier(av)}
    full_front = load(av, "FullFront")
    pieces = [(full_front, 0)]
    x = full_front.width + FRONT_GAP
    review, log = {}, []
    for s, S, side in SIDES:
        layers, how = side_layers(av, S, side, dc)
        layers, (w, h), _origin = boxed(layers)
        entry = {"w": w, "h": h}
        for role, im, dx, dy in layers:
            entry[role] = [x, im.width, im.height, dx, dy]
            pieces.append((im, x))
            x += im.width + GAP
        if layers[0][0] == "head":
            entry["u"] = 1
        rec[s] = entry
        review[av + s] = layers
        log.append((av + s, how))
        if s == "f":
            entry["x"] = 0
            head = next(im for role, im, *_ in layers if role == "head")
            entry["chin"] = k["chin"] if "chin" in k else chin(entry, head)
            if "face" in k:
                entry["face"] = k["face"]
            else:
                # the chin in the whole picture: the figure found in it, else lined up at the feet
                at, score = match(full_front, compose(layers, (w, h)))
                oy = at[1] if at and score < 0.05 else full_front.height - h
                entry["face"] = face(av, full_front, oy + entry["chin"] / 100 * h)
    sheet = Image.new("RGBA", (x - GAP, max(p.height for p, _ in pieces)))
    for p, px in pieces:
        sheet.paste(p, (px, 0))
    rec["sw"], rec["sh"] = sheet.width, sheet.height
    sheet.save(os.path.join(OUT, av + ".webp"), "WEBP", quality=88, method=6)
    rec["v"] = version(av)
    return rec, review, log


def build(ids, dc, kept, log):
    from multiprocessing import Pool
    with Pool() as pool:
        made = pool.map(make, [(av, dc, kept.get(av, {})) for av in ids])
    manifest, review = [], {}
    for rec, rv, lg in made:
        manifest.append(rec)
        review.update(rv)
        log.extend(lg)
    return manifest, review


def pose(layers, size, move):
    """The figure with its head moved as deepcut moves it: (x, y, degrees), turning about the head picture's middle."""
    pad = 24
    c = Image.new("RGBA", (size[0] + 2 * pad, size[1] + 2 * pad), (58, 58, 72, 255))
    for role, im, x, y in layers:
        mx, my, ang = move if role == "head" else (0, 0, 0)
        p = im.rotate(-ang, resample=Image.BICUBIC, expand=True) if ang else im
        cx, cy = x + im.width / 2 + mx, y + im.height / 2 + my
        layer = Image.new("RGBA", c.size)
        layer.paste(p, (int(round(cx - p.width / 2)) + pad, int(round(cy - p.height / 2)) + pad))
        c = Image.alpha_composite(c, layer)
    return c


def review_sheets(review, manifest, out, per=24):
    """Every side at rest, rocked both ways (10 degrees, 6 px), small-rocked and bobbed (7 px)."""
    from PIL import ImageDraw
    os.makedirs(out, exist_ok=True)
    moves = [(0, 0, 0), (6, 3, 10), (-6, 3, -10), (4, 2, 6), (0, 7, 0)]
    keys = list(review)
    by = {r["id"]: r for r in manifest}
    for n in range(0, len(keys), per):
        rows = []
        for k in keys[n:n + per]:
            e = by[k[:-1]][k[-1]]
            rows.append((k, [pose(review[k], (e["w"], e["h"]), m) for m in moves]))
        W = max(sum(i.width + 6 for i in r) for _, r in rows) + 70
        H = sum(max(i.height for i in r) + 6 for _, r in rows)
        c = Image.new("RGBA", (W, H), (30, 30, 36, 255))
        d = ImageDraw.Draw(c)
        y = 0
        for k, r in rows:
            d.text((4, y + 4), k, fill="white")
            xx = 70
            for i in r:
                c.alpha_composite(i, (xx, y))
                xx += i.width + 6
            y += max(i.height for i in r) + 6
        c.save(os.path.join(out, "review-%03d.png" % (n // per)))


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
    ids = sorted({f[: -len("_FullFront.png")] for f in os.listdir(SRC) if f.endswith("_FullFront.png")} - RETIRED, key=order)
    pages(ids)
    if "--pages" in sys.argv:
        return
    kept = {}
    if os.path.exists(MANIFEST) and "--chins" not in sys.argv:
        with open(MANIFEST) as f:
            kept = {r["id"]: r["f"] for r in json.load(f)}
    log = []
    manifest, review = build(ids, deepcut(), kept, log)
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    for av in os.listdir(OUT):
        if av[:-5] not in {r["id"] for r in manifest}:
            os.remove(os.path.join(OUT, av))
    from collections import Counter
    print(len(manifest), "avatars,", len(log), "sides, each a head and a body:",
          ", ".join("%d from %s" % (n, how) for how, n in Counter(h for _, h in log).most_common()))
    if "--review" in sys.argv:
        review_sheets(review, manifest, sys.argv[sys.argv.index("--review") + 1])


if __name__ == "__main__":
    main()
