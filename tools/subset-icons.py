#!/usr/bin/env python3
"""
Rebuild fonts/material-symbols-outlined.woff2 with only the icons firetable uses.

The full Material Symbols font is ~4 MB; firetable uses a few hundred of its
4,000+ icons. This keeps every icon whose name (or codepoint, e.g. &#xE887;)
appears in the site's HTML/JS/CSS, plus the alternate glyphs the font switches
to for filled icons, and all four variation axes (FILL, GRAD, opsz, wght), so
icons render exactly as with the full font.

Run it after using an icon the app hasn't used before:

    pip install "fonttools[woff]"
    python3 tools/subset-icons.py

Then bump the version (index.html ?v=, the font URL in css/looks.css and
firetable.version in js/state.js) so browsers fetch the new font.

Source font: tools/fonts/material-symbols-outlined.full.woff2 (not deployed).
"""
import glob
import os
import re
import subprocess
import sys

from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "tools", "fonts", "material-symbols-outlined.full.woff2")
OUTPUT = os.path.join(ROOT, "fonts", "material-symbols-outlined.woff2")


def lookups(gsub):
    for lookup in gsub.LookupList.Lookup:
        for st in lookup.SubTable:
            kind = lookup.LookupType
            if kind == 7:  # extension
                st, kind = st.ExtSubTable, st.ExtSubTable.LookupType
            yield kind, st


def main():
    font = TTFont(SOURCE)
    cmap = font.getBestCmap()
    char_of = {glyph: chr(cp) for cp, glyph in cmap.items()}
    gsub = font["GSUB"].table

    # icon name -> glyph (icons are ligatures of their name's letters)
    names = {}
    alternates = {}
    for kind, st in lookups(gsub):
        if kind == 4:
            for first, ligs in st.ligatures.items():
                for lig in ligs:
                    seq = [first] + list(lig.Component)
                    if all(g in char_of for g in seq):
                        names["".join(char_of[g] for g in seq)] = lig.LigGlyph
        elif kind == 1:
            for a, b in st.mapping.items():
                alternates.setdefault(a, set()).add(b)
        elif kind == 3:
            for a, bs in st.alternates.items():
                alternates.setdefault(a, set()).update(bs)

    # names and codepoints the site refers to (over-inclusive on purpose)
    used, codepoints = set(), set()
    for path in glob.glob(os.path.join(ROOT, "**", "*"), recursive=True):
        rel = os.path.relpath(path, ROOT)
        if not re.search(r"\.(html|js|css)$", path) or rel.startswith(("tools", "node_modules")) or ".min.js" in path:
            continue
        text = open(path, encoding="utf-8", errors="ignore").read()
        used.update(w for w in re.findall(r"[a-z0-9_]+", text) if w in names)
        codepoints.update(int(h, 16) for h in re.findall(r"&#x([0-9a-fA-F]{4,5});", text))
        codepoints.update(int(h, 16) for h in re.findall(r"\\u([eEfF][0-9a-fA-F]{3})", text))
    codepoints = {cp for cp in codepoints if cp in cmap}

    # the icons, plus every glyph they can switch to (filled variants etc.)
    keep = {names[n] for n in used} | {cmap[cp] for cp in codepoints}
    frontier = set(keep)
    while frontier:
        nxt = {b for g in frontier for b in alternates.get(g, ()) if b not in keep}
        keep |= nxt
        frontier = nxt

    letters = sorted(set("".join(used)))
    unicodes = [ord(c) for c in letters] + sorted(codepoints) + [0x20]
    glyph_file = OUTPUT + ".glyphs.txt"
    with open(glyph_file, "w") as f:
        f.write("\n".join(sorted(keep)))
    try:
        subprocess.run([
            sys.executable, "-m", "fontTools.subset", SOURCE,
            "--glyphs-file=" + glyph_file,
            "--unicodes=" + ",".join("U+%04X" % u for u in unicodes),
            "--no-layout-closure", "--layout-features=*", "--flavor=woff2",
            "--notdef-outline", "--name-IDs=*", "--name-languages=*",
            "--output-file=" + OUTPUT,
        ], check=True)
    finally:
        os.remove(glyph_file)
    print("%d icons (%d glyphs) -> %s, %d KB" % (len(used) + len(codepoints), len(keep), os.path.relpath(OUTPUT, ROOT), os.path.getsize(OUTPUT) // 1024))


if __name__ == "__main__":
    main()
