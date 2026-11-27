# 01 · Ground rules

Read this at the start of every session. It's the difference between a redesign that ships a step a day and one that breaks the room.

## The non-negotiables

1. **Build on what exists.** Restyle, relabel and rearrange the existing elements. Don't rewrite a module to change how it looks. A step that needs a rewrite is too big: split it.
2. **No feature is dropped.** [02-feature-inventory.md](02-feature-inventory.md) lists every one. Each step names the inventory rows it touches and proves they still work.
3. **Regulars first.** The people who DJ here every night have years of muscle memory. Phase 1 keeps every region where it is. Anything that moves a region needs the owner's yes first, then ships to everyone (there is no opt-in switch and no Classic mode, the owner, November 15, 2026). **Live's look is frozen too (round 4):** the stage, its colours, the name plates, the raised buttons, the fader and the `:id:` mark stay as they are. No step recolours or restyles Live. *(Lifted in part on November 13, 2026, at the owner's request, step 2.3c: with Discover on, the stage's buttons and utilities live in the player along the bottom, the DJs scale up to fill the stage, and every button and slider has the new flat look. The stage itself, its colours, name plates and the `:id:` mark stay.)*
4. **The DJs stand on the stage**, in front of the video or artwork, anchored to the stage floor. It's the room's signature. There is no option to hide them on the stage (the owner, November 15, 2026); the full-screen player is the view without them.
5. **Playlist (crate) management is a first-class part of Live**, not something you leave the room for.
6. **The `:id:` logo stays as it is** (`img/idlogo2.png`, `#roomlogo`).
7. **The library side is called Discover.** Not Explore, not Library.
8. **Small steps.** One pull request per step, each one shippable and revertible. Pushing to `master` deploys the site, so `master` must always be releasable.

## The owner's standing preferences (from the mockup reviews)

- No horizontally scrolling menus or rows. No rows of filter "bubbles" (chips). Filters go behind **one** menu button.
- The playlist switcher fits on one row.
- **Find tracks is a + in a circle**, as it is today.
- Song actions: one tap for what's done all the time (Fire, Grab, Link, Skip-your-own); small pick menus from a single button for the rest. **No full-page action sheets.**
- Compact row actions. Top and Bottom are small icons, as today, not big swipe buttons.
- Density is a feature: people want the data (plays, firsts, versions, BPM) and the tools.
- The desktop crate and the phone crate share one interface.
- Apple Music import is out. Spotify import waits for the owner's Spotify developer key.
- The design must not look "vibecoded": no gradient washes, no everything-is-a-pill, no generic icon sets, no blurred colour blobs. Use the site's own type (Inter, Roboto Mono for numbers and times) (Round 5: numbers in Inter with tabular figures; Roboto Mono for code and keys) and its own icons (Material Symbols, as today).

Added in round 4 (November 12, 2026):
- **The stage belongs to Live.** Nothing in Discover is drawn like it: no small stage, no song-colour tint, no `:id:` watermark, no name plates. One exception (the owner, November 13, 2026): the player bar along the bottom takes the playing song's artwork colour for its edge, progress, label and a faint wash; the panels stay flat.
- **A name plate means "DJing now".** Only the DJs on the stage stand on one. Everywhere else (Discover, the On Air card, chat, lists) a person is a circle avatar with the name beside it, as today.
- **Discover is for finding new music.** New releases lead its Home.
- **An On Air card** shows the room in Discover while the person isn't in the Live session.
- **No big filled gold buttons** in new work. Gold fill is for small marks (the THEME badge, a selected tab's underline, progress). A panel's main action is a dark button with gold text; play/pause is the one light button. Existing buttons in Live aren't restyled.
- **Phones get a bottom tab bar** (Home · Discover · Live · Library · You), so the screen is content, not buttons.

Round 5 (the owner, November 25, 2026), after a fresh-eyes review: the owner lifted these earlier rules and decisions, and the changes ship one pull request at a time: big filled gold buttons are allowed for the one main sign-up action (was: no big filled gold); numbers, times and dates use Inter with tabular figures, not Roboto Mono (Roboto Mono stays for code and keys); playlist rows show Top and ⋮, and with a mouse the rest on the row you point at or tab to; Discover's cover cards on touch screens keep play on the cover and move ⋮ and Save under the title; the Discover / Live switch moves into the header: its row on tablets, the first row under the logo on computers (was 2.2); Discover's left column gets narrower and its right column can fold, and the left column starts folded on 1024 to 1369px screens with a mouse once the device has signed in; in Live on computers the theme sits on the stage, over the song (Live's look was frozen), and stays in the header elsewhere; Reload leaves the bar's tools and the full-screen player's transport: it shows when a song stalls, and the full-screen player keeps it with its screen and cast; the desktop bar labels Fire; the phone tab bar is Discover · Live · Library · You (was 4.1's five), with Discover's pages as tiles at the top of its Home and a visitor's crate as their Library; on phones Fresh moves from Live's tabs to a Discover tile (was "Fresh kept"), while Live keeps Recent, which holds the mods' tools for past plays; going to the room has one name (Live) and one button (Listen live); Home's lead song keeps its own actions on its cover; Genres opens on a grid with the sound map behind a toggle; a visitor's empty crate column shows the room.

## The codebase you're working in

### Two repositories

| Repo | What | Deploys |
|---|---|---|
| `indiediscotheque/firetable-user` | The site: `index.html`, `js/`, `css/`, `api/` (PHP proxies), `about/`, `privacy/`, `terms/`, `embed/`, `tools/`, `tests/` | Every push to `master` publishes to DreamHost (`.github/workflows/deploy.yml`) after lint and checks |
| `indiediscotheque/firetable-hostbot` | The bot (`app.js`, `lib/`), the **database rules** (`firebase-rules.json`), the play history tools | The bot auto-updates from `master`; the rules are published by hand (its README, "database rules") |

Never change `mxew/firetable` or `mxew/firetable-hostbot` (Matt's originals), and don't suggest changes to them. Only `master` matters in both repos; ignore old `claude/*` and `ccr-*` branches unless they have an open pull request.

### No build step

- Plain `<script>` files loaded in a fixed order at the bottom of `index.html` (storage, config, `firetable.js`, then `seasons`, `constants`, `state`, `lazy`, `fire`, `helpers`, `emoji`, `lastfm`, `player`, `cards`, `chat`, `install`, `push`, `search`, `playlist`, `playlists`, `users`, `room`, `ui`, `discover`, `glitch`, `snow`, and `init` last). Order matters: each file uses globals from earlier ones.
- They share globals: `firetable` (state and UI, `js/state.js`), `ftapi` (database and auth, `js/firetable.js`), `ftconfigs` (`config.js`, server-only). A new script goes in `index.html` in the right place **and** its globals go in `eslint.config.mjs`.
- jQuery 4 (no jQuery UI: rows are reordered with `firetable.utilities.dragSort` in `js/helpers.js`, mouse, touch and Alt+arrow keys; the stage's volume is a native range input, `#slider`). Native `<dialog>` for modals, the Popover API (`popover="auto"`, `popovertarget`) with CSS anchor positioning (`anchor-name`, `position-anchor`) for menus, and Floating UI as the fallback positioner (`firetable.ui.positionPopover`).
- The `?v=` on local scripts, styles and fonts is set at deploy time from a hash of each file; nothing to bump by hand (except `config.js?v=`). `tools/subset-icons.py`'s docstring still says to bump versions; the deploy does it.

### Element ids are an API

JS binds to element ids everywhere (`$("#grab")`, `document.getElementById("plIndexBox")`), and `tests/smoke.mjs` checks many of them. **Never rename or delete an id.** To move something:
- **Rearrange with CSS** (`grid-template-areas`, `order`, container classes) where you can. `#mainGrid` and `#stage` already lay out by named grid areas.
- **Move the element itself** when CSS can't: take the existing node and re-parent it, the way `js/discover.js` moves the room's chat (`chatIn` / `chatBack`: a comment node marks its home, and it goes back on leave). Never clone or duplicate elements that have ids.
- New elements get new ids, prefixed by area: `st-` stage, `cr-` crate, `ch-` chat, `nav-` navigation, `im-` import, `pv-` player.

### Layout today

- `#mainGrid` (the whole app) is a CSS grid. Its areas are swapped by classes and breakpoints in `css/looks.css` ("Main Grid Layout" and the media queries after it):
  - **Phone, under 640px:** one column. `head`, `stage`, `nav` (the `#minimodeoptions` tabs: Playlists, Recent, Cards, Chat, People; Fresh is Discover's page since November 27, 2026), `content`. Classes `mmqueue` / `mmchat` / `mmusrs` choose the panel; `view-playlists` / `view-history` / `view-cards` choose the view.
  - **Tablet, 640 to 1023px:** two columns, 3fr and 2fr. Stage, nav and view on the left; chat or people on the right, switched by `#sidepanel-tabs`.
  - **Desktop, 1024px and up:** three columns, `var(--col-left)` (24vw), `var(--col-mid)` (min(46vw, 56rem)) and the rest. People (with the header) on the left, then stage, nav and view, then chat. *(Round 5, November 25, 2026, the owner: Discover's left column is 15rem and its middle takes the rest, the right column keeping Live's width (`--col-right`, `css/discover.css`); Discover's right column folds to a 3.5rem strip (`js/side-panel.js`, `html.side-shut`); and the left column starts folded into the toolbar on 1024 to 1369px screens with a mouse once the device has signed in, with no choice kept (`js/head.js`, `js/rail.js`). Live's columns don't change.)*
  - **Login state:** `#mainGrid.login` swaps in `#login` (welcome, room pulse, join or log in tabs) under the stage (Fresh, beside them until November 27, 2026, is Discover's page).
- **Discover** (`js/discover.js`, `css/discover.css`) is a second page built into `#mainGrid`, always (5.3, November 2026; it was the `config.js` option `discover: true`): `#discoverPage` holds `#dRail` (search, nav), `#dBrowse` (the view), `#dSide` (Playlists or the crate, and Chat; the song in full is the full-screen player `#pv-full`) (/ Playlists or Crate / Chat) and `#dMini` (the phone mini player). `body.ft-discover` shows it; `#modeTabs` (Discover | Live) switches.
- Breakpoints in use: 480, 639/640, 760, 799/800, 1023/1024, 1370 (min-width), and `max-height: 400px` for landscape phones. Don't invent new ones. New layout work uses 640, 1024, 1440 and 1920 as its reference widths.

### Styles

- `css/reset.css`, `css/fonts-local.css` (Inter, Open Sans, Roboto Mono, self-hosted variable fonts in `fonts/`, split by `tools/subset-fonts.py`: rerun it after adding text with new characters), `css/looks.css` (about 7,100 lines, the room), `css/discover.css` (Discover).
- Tokens live on `:root` near the top of `looks.css`: the redesign's (step 0.1: `--space-*`, `--fs-display` … `--fs-label`, `--radius-art` … `--radius-dialog`, `--radius-pill`, `--tap`, `--tap-stage`, `--dur-fast`, `--dur`, `--ease-out`), which new work uses, and the older names, which point at them where they mean the same (`--pad*`, `--radius-sm` / `--radius-md`, `--fs-title`, `--fs-micro`); the colours (`--color-bg`, `--color-accent` (the gold, `#cc9933`), `--color-text`, `--color-text-muted`, …), `--col-left`, `--col-mid`, `--col-right` (what Live's right column comes to, November 25, 2026), `--font-family`, `--font-numbers`. The room's accent can change per theme night (`colorsChanged` in `js/room.js` sets `--color-accent`), so anything accent-coloured must use the variable, never a literal gold.
- Colours: every grey comes from the palette on `:root` (`--color-bg-s2` … `--color-bg-t4`, `--color-text` … `--color-text-dim`, `--color-border`, `--color-icon`); `tools/check-colours.mjs` fails the lint on a grey written out anywhere else, unless its line says `/* own colour: why */`. White, black and see-through overlays are fine.
- Native CSS nesting is used; the deploy serves it flattened for older Safari (`tools/flatten-css.mjs`, README "older iPads"). `!important` exists (about 24 uses); don't add more.
- Older iPads (Safari 15.4 and up) must keep working: popovers there come from `js/popover-polyfill.js`, which marks an open one with the class `:popover-open`. Style open popovers through a class or an id the JS sets, not `:popover-open` alone (or add a separate `.\:popover-open` rule), and don't use newer JS than the site already does (README, "older iPads").
- Density (`#densityPicker`: compact, cozy, comfortable) sets classes the CSS reads; keep all three working.

### The security policy limits what you can load

`.htaccess` sends a strict Content-Security-Policy, and `.github/scripts/check-htaccess-scope.py` checks it in CI.
- `font-src 'self'`: **no Google Fonts.** Use the self-hosted fonts in `fonts/`. A new font must be added to `fonts/` as a woff2 and to `css/fonts-local.css`.
- Scripts only from this site and the exact CDN files listed, with Subresource Integrity. A new library needs its exact URL in the policy and an `integrity` hash (README, "third-party libraries"). Prefer no new libraries.
- `style-src 'self'`: inline `style="…"` attributes are allowed on the main site, but put real styling in the CSS files.
- Images: `https:` is allowed on the main site (album art comes from YouTube and SoundCloud).

### Icons are a subset font

`fonts/material-symbols-outlined.woff2` holds only the icons the site uses. **A new icon name shows as text until the font is rebuilt:**
```bash
pip install "fonttools[woff]" && python3 tools/subset-icons.py
```
The script finds icon names in the site's HTML, JS and CSS. Commit the new font with the step that first uses the icon. Use `material-symbols-outlined`, or `material-symbols-filled` for filled glyphs, as the existing code does.

### The database and the bot

- Firebase Realtime Database. The site reads and writes through `ftapi` (`js/firetable.js`) and some modules directly (`ftapi.db().ref(...)`).
- **Rules live in the hostbot repo** (`firebase-rules.json`, tested by `test/rules.test.mjs`). A step that writes a new path needs: the rule and a rules test in `firetable-hostbot`, the rules published, and the site degrading gracefully until they are (the established pattern: "with older rules the setting doesn't save", and a `.catch` that keeps the app going).
- The bot reacts to chat commands (`ftapi.actions.sendBotCommand("!skip")`) and publishes data the site reads (`discover/*`, `tagUpdate`, `songBpm`, `swap` suggestions on tracks, notices). If a step needs the bot to do something new, the bot change ships first.
- Paths the site uses (count of references): `users`, `discover`, `playlists`, `cards`, `chatData`, `chatFeed`, `mentions`, `pushSubs`, `banned`, `songHistory`, `playlistPrefs`, `nameClaim`, `typing`, `queues`, `grabs`, `globalTracks`, `globalSongs`, `globalWorks`, `waitlist`, `thescreen`, `theme`, `tagUpdate`, `tagLog`, `table`, `songToPlay`, `songBpm`, `bpm`, `pushKey`, `playlimit`, `playdex`, `notices`, `newMusic`, `lights`, `dance`, `colors`, `blocks`.

### Browser storage

`STORAGE` in `js/constants.js` lists every `localStorage` key (volume, mute, media off, chat images, avatars, song announcements, badoop, desktop notify, push state, screen control, avatar style, density, typing, broken check, list counts, Last.fm session, nav view, nav side, nav mobile). Discover adds `ft-crate`, `ft-crate-asked`, `ft-mode` and others in `js/discover.js`. New preferences go in `STORAGE`; `js/storage.js` keeps the app working when storage is blocked.

## The per-step routine

Do this for every step in [04-step-plan.md](04-step-plan.md):

1. **Read the step** and the inventory rows it lists. Open each file it names and find the functions and ids before changing anything.
2. **Branch** from current `master`: `redesign/<phase>-<step>-<short-name>`.
3. **Screenshot before** with the harness from step 0.2 (`cd tests && npm run screens`, or `node screens.mjs` with the emulators already running): 390, 1024, 1440 and 1920 wide, as a visitor, a member, a DJ on deck and a mod. Note the short sha of `master`; after the change, in the same session, run it again with `BASE=<that sha>`. (Take both in one session: whether YouTube's player plays in that machine changes the phone stage's layout, so pictures from another day or machine aren't a fair before.) and the contact sheet (`tests/screens/<sha>/index.html`) marks what changed. Put the changed pictures in the PR.
4. **Make the smallest change** that does the step. CSS first, then markup, then JS. Reuse existing functions (`firetable.ui.toast`, `openStealPicker`, `positionPopover`, `savePlaylistPrefs`, `formatRefusal`, ...).
5. **Run the checks:**
   ```bash
   npm ci && npm run lint
   ```
   ```bash
   cd tests && npm ci && npm run unit && npm run smoke
   ```
   ```bash
   cd tests && HOSTBOT_RULES=../../firetable-hostbot/firebase-rules.json npm run rules
   ```
   Add smoke checks for what the step adds (each step lists them). If the step moves a control, adds one or hides one behind a menu, update its route in `tests/reach.mjs` ("nothing lost") in the same change; `npm run reach` must pass, and so must `npm run a11y` (a step that fixes an accessibility finding takes its line out of the allowlist in `tests/a11y.mjs`; nothing new goes in). A step that writes something new to the database adds it to `tests/rules.mjs` too, so the hostbot's rules are checked for it. In a Claude cloud session the Firebase emulator's own requests trip the network proxy; start the emulators without the proxy and run the tests against them:
   ```bash
   cd tests && (env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx firebase emulators:start --only database,auth --project demo-smoke > /tmp/emu.log 2>&1 &)
   ```
   ```bash
   cd tests && NO_PROXY="localhost,127.0.0.1,::1" node smoke.mjs && HOSTBOT_RULES=../../firetable-hostbot/firebase-rules.json node rules.mjs
   ```
   A single "signal is aborted" page error is a known YouTube flake; run it again.
6. **Screenshot after** at the same sizes and roles, and compare.
7. **Walk the inventory rows** the step touches, by hand, in the browser. Keyboard too (Tab, Enter, Escape, arrows).
8. **Update the docs:** mark the step done in [04-step-plan.md](04-step-plan.md), the phase status in [README.md](README.md), and the inventory rows' "Now lives" column. Update the project `README.md` where it describes the feature.
9. **Commit, push, open a pull request** with before and after screenshots, the inventory rows touched, and how to check it. Ask the owner to look before merging steps that change what regulars see.
10. **After merge,** check the live site once the deploy finishes.

## Rolling back

- Every step is one pull request: revert it on GitHub to undo.
- There is no switch to turn a step off for some people: it ships to everyone, so a step that moves things must be small enough that reverting it is clean.
- Never change a database path's shape in a way an older site can't read. The site that's live and the one being reviewed must both work.

## Writing the words

The site speaks plainly: short sentences, no jargon, the person's own words ("Take the bus", "Grab", "Fire", "Step down", "Fresh"). Keep the room's established terms; Discover's are "New", "Charts", "Genres", "DJs", "Years", "Theme nights", "Recent plays". Buttons say what they do. Tooltips say what an icon does in a few words. Errors say what happened and what to do.
