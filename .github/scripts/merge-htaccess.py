#!/usr/bin/env python3
"""Merge the repo's .htaccess into the server's copy as a marked block.

    merge-htaccess.py REPO_HTACCESS SERVER_HTACCESS OUT

The repo file goes between "# BEGIN firetable" and "# END firetable" at the
top of the server file. Everything outside that block (DreamHost's own rules,
redirects, anything added by hand) is kept as is. An older block is replaced,
and a server copy that was wholly the repo's (the legacy "# firetable-managed"
marker, no block) is replaced entirely.

SERVER_HTACCESS may be missing or empty. Exit code: 0 = OUT differs from the
server copy, 3 = already up to date.
"""
import re
import sys

BEGIN = "# BEGIN firetable"
END = "# END firetable"
NOTE = "# Managed by the firetable-user deploy; edit .htaccess in the repo, not here.\n"


def read(path):
    try:
        with open(path, encoding="utf-8", newline="") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def main(repo_path, server_path, out_path):
    repo = read(repo_path).replace("\r\n", "\n").strip("\n") + "\n"
    server = read(server_path)
    eol = "\r\n" if "\r\n" in server else "\n"
    text = server.replace("\r\n", "\n")

    block_re = re.compile(r"^" + re.escape(BEGIN) + r"[^\n]*\n.*?^" + re.escape(END) + r"[^\n]*(\n|$)",
                          re.S | re.M)
    if block_re.search(text):
        rest = block_re.sub("", text)
    elif re.search(r"^# firetable-managed\s*$", text, re.M):
        rest = ""  # the whole file was an earlier copy of the repo's
    else:
        rest = text
    rest = rest.lstrip("\n")

    merged = BEGIN + "\n" + NOTE + repo + END + "\n"
    if rest.strip():
        merged += "\n" + rest
        if not merged.endswith("\n"):
            merged += "\n"
    merged = merged.replace("\n", eol)

    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(merged)
    return 3 if merged == server else 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(main(*sys.argv[1:]))
