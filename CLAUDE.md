# Notes for Claude

## Branches and repos to leave alone
- Only `master` matters. Don't report other branches (old `claude/*` or `ccr-*` ones) as outstanding work, and don't offer to merge, review or delete them, unless they have an open pull request or the user asks about them.
- Don't change Matt's original repos (`mxew/firetable`, `mxew/firetable-hostbot`) and don't suggest changes to them. Only change the indiediscotheque repos.

## Deploy
`.github/workflows/deploy.yml` uploads everything in the repo except what it lists in two exclude lists (the `skip=` upload line and the `case` line in the remove step). When you add a file that shouldn't be served on the site (docs, tooling), add it to both lists, and to `NOT_DEPLOYED` in `.github/scripts/check-htaccess-scope.py` (the lint check fails otherwise).

`music/` (the library's plain pages) isn't in git: the deploy builds it with `tools/plain-pages.mjs` and uploads it in its own step, deleting pages no longer built. The main upload skips it.

## Redesign
The site's design upgrade follows `docs/redesign/` (start at its README): small steps on top of what exists, never a rewrite. Read `01-ground-rules.md` before any design work, take the next unshipped step in `04-step-plan.md`, keep every feature in `02-feature-inventory.md`, and mark what shipped. `docs/` is never deployed.
