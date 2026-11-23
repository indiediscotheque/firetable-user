#!/usr/bin/env python3
"""Give every tracked file the time of the last commit that changed it.

    commit-times.py [REPO]

The deploy mirrors the site by size and time, so only files changed in git
differ from the server's copies. One `git log` over the whole history does
it, instead of one `git log -1 -- <file>` per file (thousands of them, most
of them avatar drawings: seconds instead of a minute). Needs the full
history (actions/checkout with fetch-depth: 0).
"""
import os
import subprocess
import sys


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True).stdout


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else "."
    tracked = set(f for f in git("ls-files", "-z", cwd=repo).split(b"\0") if f)
    # Newest first: "\x01<time>\n<path>\0<path>\0..." per commit
    times = {}
    when = None
    for tok in git("log", "--format=format:%x01%ct", "--name-only", "-z", "HEAD", cwd=repo).split(b"\0"):
        if tok.startswith(b"\x01"):
            head, _, tok = tok[1:].partition(b"\n")
            when = int(head)
        if tok and tok in tracked and tok not in times:
            times[tok] = when
    for path, t in times.items():
        full = os.path.join(os.fsencode(repo), path)
        if os.path.lexists(full) and not os.path.islink(full):
            os.utime(full, (t, t))
    print(f"Commit times on {len(times)} of {len(tracked)} files.")


if __name__ == "__main__":
    main()
