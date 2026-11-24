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

The deploy also serves the stylesheets with CSS nesting flattened (`tools/flatten-css.mjs`), for older iPads, then minifies every script and stylesheet with a source map beside each script (`tools/minify.mjs --maps`); the source keeps its nesting and stays readable. Don't hand-minify source files.

Lint fails when what the home page loads first grows past `tools/size-budget.json` (`tools/size-budget.mjs`). Prefer loading new parts on first use (`js/lazy.js`); raise the budget only on purpose, in the same pull request, saying why.

`music/` (the library's plain pages) isn't in git: the deploy builds it with `tools/plain-pages.mjs` and uploads it in its own step, deleting pages no longer built. The main upload skips it.

## jQuery
The site's scripts use jQuery in about 1,270 places. It stays until that's zero, but only shrinks:
- New code uses the browser's own DOM: `document.querySelector`/`querySelectorAll`, `classList`, `addEventListener`, `element.hidden`, `textContent`, `insertAdjacentHTML` with escaped values (`firetable.utilities.htmlEscape`), `fetch`. No new `$(…)`, `$.…` or jQuery plugins, in new files or old ones.
- A function you're changing anyway drops its jQuery in the same change when that's straightforward and the tests cover it. Don't convert code you aren't otherwise touching, and never in a sweeping rewrite.
- Lint enforces it (`tools/jquery-budget.mjs` against `tools/jquery-baseline.json`): a script with more jQuery than its baseline fails, and so does one with less until the baseline is lowered with it (`node tools/jquery-budget.mjs --write`, committed in the same pull request).
- When the count reaches zero, take jQuery's `<script>` out of `index.html` and its address out of the CSP in `.htaccess`.

## File size
New code stays small, and the big files only shrink. The limit is ESLint's `max-lines`: 500 lines of code a file and 80 a function (comments and blank lines don't count, so keep writing them).
- A new feature goes in a file of its own (a new `js/` script loaded where it's needed, or on first use through `js/lazy.js`), not into one of the big files. A function that would pass 80 lines is split into named helpers.
- The files already over (`discover.js` at about 4,100 lines, `playlist.js`, `ui.js`, `ttskin.js`, `firetable.js`, `room.js`, `chat.js` and others) keep today's size as their cap, and so does their count of long functions (`tools/line-limits.json`; lint shows those functions as warnings). When you're changing one substantially anyway, move a self-contained part out (with its tests passing) instead of adding to it. Never in a sweeping rewrite.
- `tools/line-limits.mjs` (lint) fails when a file or its long-function count grows, and when one shrinks without the record being lowered (`node tools/line-limits.mjs --write`, committed in the same pull request).

## Redesign
The redesign plan in `docs/redesign/` is closed (November 23, 2026): every step shipped or was dropped, and nothing is queued. Don't take work from `04-step-plan.md` or offer its dropped steps (Phase 3, 1.4 and the rest) again. It stays as the record of what changed and why. For any new design work, still read `01-ground-rules.md` first, keep every feature in `02-feature-inventory.md`, and work in small steps on top of what exists, never a rewrite. `docs/` is never deployed.
