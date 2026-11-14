#!/usr/bin/env python3
"""Split the site's text fonts so visitors download only what a page uses.

    pip install fonttools brotli
    python3 tools/subset-fonts.py

Each variable font in tools/fonts/*.full.woff2 (the originals, never deployed)
becomes two files in fonts/:

  <name>.main.woff2  Latin (as Google Fonts serves it) plus every other
                     character this site's own pages and scripts show (·, …,
                     arrows, ▲ …) and the bot's (∞ for no play limit, from
                     firetable-hostbot when it's checked out next to this
                     repo, or HOSTBOT_DIR), so a normal visit needs only this one
  <name>.rest.woff2  everything else in the font (Cyrillic, Greek, Vietnamese,
                     symbols): fetched only when a page shows one of those
                     characters, e.g. in someone's chat message

and css/fonts-local.css gets an @font-face for each, with its unicode-range.
Both files keep the font's variable axes (weight, width, optical size) and all
its OpenType features, so text looks exactly as before. Run it again after
adding text with new characters to the site (the deploy doesn't).
"""
import glob
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "tools", "fonts")
OUT = os.path.join(ROOT, "fonts")
CSS = os.path.join(ROOT, "css", "fonts-local.css")

# Google Fonts' "latin" range
LATIN = ("U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, "
         "U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD")

# Characters that reach the page from the database (the bot), always kept
FROM_DATA = "∞"

# family, style, weight range, extra descriptors, source file stem
FACES = [
    ("Inter", "normal", "100 900", "", "Inter-VariableFont_opsz,wght"),
    ("Inter", "italic", "100 900", "", "Inter-Italic-VariableFont_opsz,wght"),
    ("Roboto Mono", "normal", "100 700", "", "RobotoMono-VariableFont_wght"),
    ("Roboto Mono", "italic", "100 700", "", "RobotoMono-Italic-VariableFont_wght"),
    ("Open Sans", "normal", "300 800", "  font-stretch: 75% 100%;\n", "OpenSans-VariableFont_wdth,wght"),
    ("Open Sans", "italic", "300 800", "  font-stretch: 75% 100%;\n", "OpenSans-Italic-VariableFont_wdth,wght"),
]


def parse_ranges(text):
    out = set()
    for part in text.split(","):
        a, _, b = part.strip()[2:].partition("-")
        out.update(range(int(a, 16), int(b or a, 16) + 1))
    return out


def to_ranges(points):
    points = sorted(points)
    out, i = [], 0
    while i < len(points):
        j = i
        while j + 1 < len(points) and points[j + 1] == points[j] + 1:
            j += 1
        a, b = points[i], points[j]
        out.append("U+%04X" % a if a == b else "U+%04X-%04X" % (a, b))
        i = j + 1
    return ", ".join(out)


def site_chars():
    """Every character in the site's own pages, scripts and styles."""
    files = glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "*", "index.html")) \
        + glob.glob(os.path.join(ROOT, "embed", "**", "*.*"), recursive=True) \
        + glob.glob(os.path.join(ROOT, "js", "*.js")) + glob.glob(os.path.join(ROOT, "css", "*.css")) \
        + [os.path.join(ROOT, "tools", "plain-pages.mjs")]
    bot = os.environ.get("HOSTBOT_DIR") or os.path.join(ROOT, "..", "firetable-hostbot")
    if os.path.isdir(bot):
        files += [os.path.join(bot, "app.js")] + glob.glob(os.path.join(bot, "lib", "**", "*.js"), recursive=True)
    else:
        print("note: no firetable-hostbot checkout at " + bot + " (HOSTBOT_DIR); only FROM_DATA covers the bot's text")
    chars = set(ord(c) for c in FROM_DATA)
    for f in files:
        if f.endswith(".min.js") or os.path.basename(f) == "twemoji.js":
            continue  # third-party code (twemoji draws emoji as images)
        try:
            text = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, IsADirectoryError):
            continue
        chars.update(ord(c) for c in text)
        # \\uXXXX escapes in scripts
        chars.update(int(h, 16) for h in re.findall(r"\\u([0-9a-fA-F]{4})", text))
    return chars


def build(stem, unicodes, out):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]      # every OpenType feature (tnum, case, ...)
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = True
    font = subset.load_font(os.path.join(SRC, stem + ".full.woff2"), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    subset.save_font(font, out, opts)
    return os.path.getsize(out)


def main():
    wanted = parse_ranges(LATIN) | site_chars()
    css = ["/* Local variable fonts (WOFF2), each split in two by tools/subset-fonts.py:",
           "   .main has Latin and every character the site's own text uses; .rest has",
           "   the rest of the font and only loads when a page shows one of those",
           "   characters. Don't edit by hand: run the tool. */", ""]
    for family, style, weight, extra, stem in FACES:
        cmap = set(TTFont(os.path.join(SRC, stem + ".full.woff2")).getBestCmap())
        main_set = cmap & wanted
        rest_set = cmap - main_set
        before = os.path.getsize(os.path.join(SRC, stem + ".full.woff2"))
        m = build(stem, main_set, os.path.join(OUT, stem + ".main.woff2"))
        r = build(stem, rest_set, os.path.join(OUT, stem + ".rest.woff2")) if rest_set else 0
        print("%-40s %7d -> main %7d + rest %7d  (%d + %d characters)" % (stem, before, m, r, len(main_set), len(rest_set)))
        for part, points in (("main", main_set), ("rest", rest_set)):
            if not points:
                continue
            css += ["@font-face {",
                    "  font-family: '%s';" % family,
                    "  font-style: %s;" % style,
                    "  font-weight: %s;" % weight]
            if extra:
                css.append(extra.rstrip("\n"))
            css += ["  font-display: swap;",
                    "  src: url('../fonts/%s.%s.woff2') format('woff2');" % (stem, part),
                    "  unicode-range: %s;" % to_ranges(points),
                    "}", ""]
    with open(CSS, "w", encoding="utf-8") as f:
        f.write("\n".join(css))
    print("wrote", os.path.relpath(CSS, ROOT))


if __name__ == "__main__":
    sys.exit(main())
