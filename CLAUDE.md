# Notes for Claude

## Branches and repos to leave alone
- Only `master` matters. Don't report other branches (old `claude/*` or `ccr-*` ones) as outstanding work, and don't offer to merge, review or delete them, unless they have an open pull request or the user asks about them.
- Don't change Matt's original repos (`mxew/firetable`, `mxew/firetable-hostbot`) and don't suggest changes to them. Only change the indiediscotheque repos.

## Pull requests: open them and merge them
- When work is finished and its tests pass locally, open a pull request to `master` without waiting to be asked, and merge it yourself once it's ready: CI is green on its latest commit and it has no merge conflict.
- Don't merge with CI red or a conflict: fix the cause (never skip or disable a test), push, and merge when it's green.
- After merging, say what's needed to put it live (a bot restart, a workflow run, a deploy).

## Deploy
`.github/workflows/deploy.yml` uploads everything in the repo except what it lists in two exclude lists (the `skip=` upload line and the `case` line in the remove step). When you add a file that shouldn't be served on the site (docs, tooling), add it to both lists, and to `NOT_DEPLOYED` in `.github/scripts/check-htaccess-scope.py` (the lint check fails otherwise).

The deploy also serves the stylesheets with CSS nesting flattened (`tools/flatten-css.mjs`), for older iPads; the source keeps its nesting.

`music/` (the library's plain pages) isn't in git: the deploy builds it with `tools/plain-pages.mjs` and uploads it in its own step, deleting pages no longer built. The main upload skips it.

## Redesign
The redesign plan in `docs/redesign/` is closed (November 23, 2026): every step shipped or was dropped, and nothing is queued. Don't take work from `04-step-plan.md` or offer its dropped steps (Phase 3, 1.4 and the rest) again. It stays as the record of what changed and why. For any new design work, still read `01-ground-rules.md` first, keep every feature in `02-feature-inventory.md`, and work in small steps on top of what exists, never a rewrite. `docs/` is never deployed.
