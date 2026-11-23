#!/usr/bin/env python3
"""
Build img/robot-generic.png (GENERIC_AVATAR_URL in js/constants.js): the gray
robot bust of anyone with no avatar yet, a DJ known only by a name, so with no
uid to make a face from (js/helpers.js avatarURL, js/discover.js robot()).
Never deployed (tools/).

It's put together from Robohash's own gray robot parts (set 1, by Zikri
Kader, robohash.org), the way Robohash stacks them, so it sits in its picture
like every other robot bust and takes the same framing: the plain dome head
with a slit visor on the collared shoulders (the pair that fills an avatar
circle best), no mouth and no accessory, with every colour taken out.

    pip download robohash --no-deps -d /tmp/robohash
    unzip -q /tmp/robohash/robohash-*.whl -d /tmp/robohash
    pip install pillow
    python3 tools/robot-generic.py /tmp/robohash/robohash/sets/set1/grey
"""
import glob
import os
import sys

from PIL import Image, ImageOps

# Robohash's layer order (body, face, mouth, eyes, accessory) and the drawing
# of each that the generic robot uses; None leaves the layer out.
PARTS = [("Body", 9), ("Face", 3), ("Mouth", None), ("Eyes", 8), ("Accessory", None)]
SIDE = 300  # Robohash's own size
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "img", "robot-generic.png")


def part(base, kind, n):
    """Robohash's drawing `n` of a part, e.g. .../003#01Body/002#grey_body-04.png."""
    folder = [d for d in os.listdir(base) if d.endswith(kind)][0]
    return Image.open(glob.glob(os.path.join(base, folder, "*-%02d.png" % n))[0]).convert("RGBA")


def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit(__doc__)
    robot = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
    for kind, n in PARTS:
        if n:
            robot = Image.alpha_composite(robot, part(sys.argv[1], kind, n))
    # gray all through (the outlines are maroon, the visor red), kept as gray and alpha
    gray = Image.merge("LA", (ImageOps.grayscale(robot.convert("RGB")), robot.getchannel("A")))
    gray.save(OUT, optimize=True)
    print("%s: %d bytes" % (os.path.normpath(OUT), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
