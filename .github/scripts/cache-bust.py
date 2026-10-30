#!/usr/bin/env python3
"""Point every "?v=" link at the current version of its file.

    cache-bust.py [ROOT]

Pages and stylesheets link this site's own files with a version, e.g.
js/chat.js?v=01.12.07, so browsers fetch a file again when it changes. The
deploy runs this on its copy of the site before uploading: each ?v= becomes
the first 10 characters of the file's SHA-256, so a changed file gets a new
link and an unchanged one stays cached. Nothing needs bumping by hand.

Stylesheets are done first, since pages link them and their own links (fonts)
change their contents. Links to files that aren't in the repo (config.js lives
only on the server) and to other sites are left as they are.
"""
import hashlib
import os
import re
import sys

LINK = re.compile(r"([A-Za-z0-9_./-]+)\?v=([0-9A-Za-z._-]*)")
SKIP_DIRS = {".git", ".github", "node_modules", "tools"}


def file_hash(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def rewrite(path, root):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    base = os.path.dirname(path)

    def swap(m):
        target, _old = m.group(1), m.group(2)
        full = os.path.join(root, target.lstrip("/")) if target.startswith("/") else os.path.join(base, target)
        full = os.path.normpath(full)
        if not full.startswith(os.path.abspath(root)) or not os.path.isfile(full):
            return m.group(0)
        return target + "?v=" + file_hash(full)

    new = LINK.sub(swap, text)
    if new != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        return True
    return False


def main(root="."):
    root = os.path.abspath(root)
    css, html = [], []
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for name in files:
            if name.endswith(".css"):
                css.append(os.path.join(d, name))
            elif name.endswith(".html"):
                html.append(os.path.join(d, name))
    changed = [os.path.relpath(p, root) for p in sorted(css) + sorted(html) if rewrite(p, root)]
    print("Versioned links updated in: " + (", ".join(changed) if changed else "nothing"))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
