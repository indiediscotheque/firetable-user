# Notes for Claude

## Branches and repos to leave alone
- Only `master` matters. Don't report other branches (old `claude/*` or `ccr-*` ones) as outstanding work, and don't offer to merge, review or delete them, unless they have an open pull request or the user asks about them.
- Don't change Matt's original repos (`mxew/firetable`, `mxew/firetable-hostbot`) and don't suggest changes to them. Only change the indiediscotheque repos.

## Deploy
`.github/workflows/deploy.yml` uploads everything in the repo except what it lists in two exclude lists (the `skip=` upload line and the `case` line in the remove step). When you add a file that shouldn't be served on the site (docs, tooling), add it to both lists, and to `NOT_DEPLOYED` in `.github/scripts/check-htaccess-scope.py` (the lint check fails otherwise).
