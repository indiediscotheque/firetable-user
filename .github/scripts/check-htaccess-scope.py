#!/usr/bin/env python3
"""Check the Content-Security-Policy in .htaccess covers all of firetable.

The policy sits in an <If "%{REQUEST_URI} =~ m#...#"> block so other sites in
folders on the same server (such as /basement) don't get it. This fails when a
file or folder the deploy publishes isn't in that list, or when the list would
also catch a path that isn't firetable's.

    check-htaccess-scope.py [.htaccess]
"""
import re
import subprocess
import sys

# Never published by the deploy (keep in step with deploy.yml's excludes)
NOT_DEPLOYED = {
    ".htaccess", ".github", ".gitignore", "tools", "node_modules", "package.json",
    "package-lock.json", "eslint.config.mjs", "README.md", "config.js.example",
}
# Server-only files the deploy never uploads but the site serves
SERVER_ONLY = {"config.js"}
# Paths that must stay outside the policy
OUTSIDE = ["/basement", "/basement/", "/basement/index.html", "/basement/js/main.js",
           "/aboutx", "/jsx/", "/other/index.html"]


def main(path=".htaccess"):
    text = open(path, encoding="utf-8").read()
    m = re.search(r'<If\s+"%\{REQUEST_URI\}\s*=~\s*m#(.+?)#">\s*\n\s*Header always set Content-Security-Policy',
                  text)
    if not m:
        sys.exit(f"{path}: no <If \"%{{REQUEST_URI}} =~ m#...#\"> right before the Content-Security-Policy")
    scope = re.compile(m.group(1))

    tracked = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split()
    top = {f.split("/", 1)[0] for f in tracked} - NOT_DEPLOYED | SERVER_ONLY
    inside = ["/"]
    for name in sorted(top):
        inside += [f"/{name}", f"/{name}/index.html"] if any(f.startswith(name + "/") for f in tracked) else [f"/{name}"]

    errors = [f"{p} is published but doesn't get the CSP: add it to the list in {path}"
              for p in inside if not scope.search(p)]
    errors += [f"{p} isn't firetable's but would get the CSP" for p in OUTSIDE if scope.search(p)]
    for e in errors:
        print(f"::error file={path}::{e}")
    if errors:
        return 1
    print(f"CSP scope covers {len(top)} published top-level paths and leaves other folders alone.")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
