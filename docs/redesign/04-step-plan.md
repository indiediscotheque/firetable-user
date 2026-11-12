# 04 · The steps

Each step is one pull request. Do them in order within a phase. Phases 2 and 3 can overlap once phase 1 is done. Follow the per-step routine in [01-ground-rules.md](01-ground-rules.md) every time.

Every step lists:
- **Goal:** what changes for people.
- **Rows:** the [inventory](02-feature-inventory.md) rows it touches. Walk all of them before merging.
- **Files and change:** where, and what, concretely.
- **Keep:** what must not change (ids, behaviour, data).
- **Check:** smoke-test additions (`tests/smoke.mjs`) and what to look at by hand.
- **Undo:** how to back it out.

Mark each step `✅ shipped in #PR` when it merges.

---

## Phase 0 · Foundations (no visible change)

### 0.1 Design tokens
- **Goal:** one set of colours, type sizes, spacing and radii, so later steps restyle by changing tokens instead of hunting hex values.
- **Rows:** none visibly (OT-01, OT-05 later).
- **Files and change:** `css/looks.css` `:root` (around line 100). Add the tokens from [03-target-design.md](03-target-design.md) ("Design tokens"): `--surface-0..4`, `--line-1..2`, `--text-1..4`, `--live`, `--ok`, `--fs-display`, `--fs-h2`, `--fs-h3`, `--fs-body`, `--fs-row`, `--fs-label`, `--space-1..8`, `--radius-row`, `--radius-btn`, `--radius-panel`, `--radius-dialog`, `--tap`, `--tap-stage`. **Define the old tokens in terms of the new ones where they mean the same** (`--color-text: var(--text-1)` and so on) but keep their current values for now: this step must not change a pixel. `css/discover.css` reads the same tokens (it already uses `--color-*`). `about/`, `privacy/` and `terms/` load `css/looks.css` and `css/fonts-local.css` too, so they get the tokens for free; screenshot them in 1.1.
- **Keep:** every current colour on screen (compare screenshots: identical).
- **Check:** smoke unchanged. Screenshots identical at all four widths.
- **Undo:** revert.

### 0.2 Screenshot harness
- **Goal:** before and after pictures for every later step, the same way every time.
- **Files and change:** new `tests/screens.mjs`, built from `tests/smoke.mjs`'s server, policy and emulator seeding (copy the seeding into a shared `tests/seed.mjs` that both import, so the data stays the same). It loads the site as four people (visitor; member; the DJ on deck; a mod) at 390×844, 1024×768, 1440×900 and 1920×1080, in Live (Playlists, Recent, Fresh, Cards, Chat, People) and Discover (Home, Charts, a genre, a DJ, Years), and with an empty stage and a full one with a waitlist. Saves PNGs to `tests/screens/<git short sha>/<role>-<width>-<view>.png` (add `tests/screens/` to `.gitignore`). `npm run screens` in `tests/package.json`.
- **Keep:** `tests/` is never deployed (already excluded in `deploy.yml` and `check-htaccess-scope.py`).
- **Check:** it runs locally and in a Claude cloud session (start the emulator without the proxy, as in [01-ground-rules.md](01-ground-rules.md)).
- **Undo:** delete the files.

### 0.3 "Try the new room" switch
- **Goal:** a way to ship the Phase 3 layout to people who choose it, and to switch it off for everyone at once.
- **Rows:** SE-13 (new).
- **Files and change:**
  - `js/constants.js`: `STORAGE.roomLayout = "firetableRoomLayout"` (and add to `eslint.config.mjs` if anything new is global).
  - `config.js.example`: document `newRoom: "off" | "optin" | "default"` (default `"optin"` when missing). Phase 5 sets `"default"`.
  - `index.html`, Settings tab (`#settings-tab`), a toggle `#roomV2Toggle` labelled "Try the new room" with one line under it: "A refined layout of the room. Everything is still there; switch back any time."
  - `js/ui.js`: `firetable.ui.applyRoomLayout()` sets `document.body.classList.toggle("ft-room-v2", on)` from config + storage, called in `initSettings` and when the toggle changes. It does nothing yet (no CSS uses the class).
- **Keep:** with the class off, nothing changes. With `newRoom: "off"` the toggle is hidden.
- **Check:** smoke: the toggle exists, flipping it toggles `body.ft-room-v2`, and it survives a reload (storage).
- **Undo:** revert; or set `newRoom: "off"` on the server.

### 0.4 "Nothing lost" smoke check
- **Goal:** a test that fails if a step removes or hides something people use.
- **Files and change:** `tests/smoke.mjs`: a list of required ids per role (from the inventory: `#fire`, `#grab`, `#songlink`, `#screenControl`, `#volstatus`, `#reloadtrack`, `#djlistpicker`, `#listpicker`, `#queueFilter`, `#addToQueueBttn`, `#shuffleQueue`, `#mergeLists`, `#plAddLauncher`, `#plIndexBtn`, `#plDeleteLauncher`, `#histFilter`, `#cardsMain`, `#pickEmoji`, `#newchat`, `#inboxTrigger`, `#loggedInUser`, `#themePill`, `#socialTrigger`, …). For each: exists, and is reachable (visible, or opened by a visible control: record which). Run it at 390, 1024 and 1440.
- **Check:** it passes today. Every later step keeps it passing; if a step moves a control behind a menu, update the list's "reached through" entry in the same PR.
- **Undo:** revert.

### 0.5 Icons for the plan
- **Goal:** every icon the plan needs is in the subset font before anyone uses it.
- **Files and change:** list the icons from [03-target-design.md](03-target-design.md) ("Icons") in a comment in `tools/subset-icons.py`'s keep list (or a small `tools/redesign-icons.txt` the script reads), run `python3 tools/subset-icons.py`, commit `fonts/material-symbols-outlined.woff2`.
- **Check:** the font grows by a few KB only. Every icon renders (temporary test page, not committed).
- **Undo:** revert the font.

---

## Phase 1 · Inside today's layout

Nothing moves region. Regulars find everything where it was.

### 1.1 Apply the tokens
- **Goal:** the new colours and surfaces everywhere: darker page, clearer panels, consistent borders.
- **Rows:** all visually; OT-01, OT-05.
- **Files and change:** switch the old tokens' values to the new ones (`--color-bg` → `--surface-0`, panels to `--surface-1`, etc.). Replace hard-coded greys in `looks.css` and `discover.css` with tokens (search `#1`, `#2`, `#3`, `rgb(`, `rgba(`). Toasts and tooltips (`#ft-toast`, `#ft-tooltip`) to `--surface-3`. About, privacy and terms pages load `looks.css`, so check them too.
- **Keep:** the accent stays `var(--color-accent)` everywhere (theme nights change it). Contrast of every text colour at its size (check with the browser's contrast tool).
- **Check:** screenshots at all widths and roles; nothing becomes unreadable; theme colour change (`colors` in the database) still recolours the accent.
- **Undo:** revert.

### 1.2 Type floor and the header
- **Goal:** nothing smaller than 11px; labels look like labels; the header reads as one bar.
- **Rows:** TB-01 to TB-07.
- **Files and change:** replace every `font-size` under 11px in both CSS files (search `0.6`, `0.65`, `0.7rem`, `9px`, `10px`). Section and tab labels use `--fs-label`. Header: icon buttons 36px with the existing tooltips (`.ft-tip`); theme pill restyled (the gold THEME badge stays); `#reconnecting` as a small status chip.
- **Keep:** the logo exactly; every header button and its tooltip id.
- **Check:** no computed font-size under 11px (add a smoke check that walks visible text nodes at 1024 and 390 and reports any smaller).
- **Undo:** revert.

### 1.3 Stage controls, top-right, and player view
- **Goal:** clear, labelled screen controls; a way to hide avatars.
- **Rows:** ST-05 to ST-08, new player view.
- **Files and change:**
  - `#screenControl`: replace the `microwave` glyph with `smart_display` (video), `image` (art), `tv_off` (off); keep `updateScreenBtn` cycling as today, or open a three-item menu if the cycle confuses people (ask the owner).
  - `#stageTopRight`: 40px buttons in a column (today's order), tooltips kept.
  - New `#st-avatarsBtn` (`person_off` / `person`) toggling `body.ft-player-view` and `STORAGE.playerView`. CSS under `.ft-player-view` hides `#deck` and `#ondeck` avatars and shows a small chip (new `#st-djChip`) with "jarvis · Chris next" built from `tableChanged` data.
- **Keep:** the room-wide screen state (`thescreen`, `!screen*`) still wins over the local choice, as today.
- **Check:** smoke: `#st-avatarsBtn` toggles the class and the chip has the playing DJ's name; reload keeps it.
- **Undo:** revert.

### 1.4 The song facts on stage
- **Goal:** the song is easy to read; facts in a clear order.
- **Rows:** NP-01 to NP-05, NP-08.
- **Files and change:** `#npText` CSS: `#track` 18px bold, `#artist` 14px link, `#plays` lines at 12px `--text-3`; `#npBpm` and genre as small tags. Clicking `#track` opens the song sheet (`discover.js` `openSheet`, available when Discover is on; otherwise nothing).
- **Keep:** `tagUpdate` updates; the first/last lines' wording from the bot.
- **Check:** long titles wrap to three lines max with an ellipsis; facts don't cover the DJ.
- **Undo:** revert.

### 1.5 Stage actions, bottom-left
- **Goal:** 44px buttons with labels in tooltips; Fire shows its count.
- **Rows:** ST-09, ST-10, ST-12, ST-13.
- **Files and change:** `#stageActions` CSS (44px, `--radius-btn`, translucent `--surface-0` background). Fire count: find where the current song's fires are counted (`chat.js` `processFireReactionMessage` / `updateFireReactionDisplay`); expose the count and render it as a badge on `#fire` (new `#st-fireCount`). Reset on `newSong`.
- **Keep:** fire and rain behaviour, the fire effect, `#cloud_with_rain`.
- **Check:** smoke: sending a fire reaction increments the badge; a new song resets it.
- **Undo:** revert.

### 1.6 Grab: one tap, with Undo
- **Goal:** grabbing goes to the playlist you grabbed to last, in one tap; the picker is one tap further.
- **Rows:** ST-11, CR-24, CR-27.
- **Files and change:** `#grab` becomes the main half of a split button; add `#st-grabPick` (▾) beside it. `STORAGE.lastGrabList` remembers the list. Tap `#grab`: if a last list exists and still exists, add there (the existing add-to-bottom path in `ui.js`'s `#stealpicker` change handler, factored into `firetable.actions.grabTo(listID)`), then `savedToast` with **Undo** and a **Change** action that opens the picker. Otherwise open the picker (today's behaviour). `#st-grabPick` always opens `#stealContain`.
- **Keep:** `recordGrab` (credit to the DJ, `grabs/`); `formatRefusal` (a SoundCloud-only list refuses a YouTube song); the picker's existing options.
- **Check:** smoke: first grab opens the picker; picking stores the list; second grab adds without the picker and the toast offers Undo; Undo removes it.
- **Undo:** revert.

### 1.7 The mod menu on the playing song
- **Goal:** mods have the deck actions where they look.
- **Rows:** ST-14, DJ-06, MO-03.
- **Files and change:** `#npModMenu`: add "Remove [DJ] from the decks" (the same call as the user card's `remove-from-deck`) and "Add someone to the decks" (focuses the people list with a hint, or opens a name picker using `#atPicker`'s list). Keep Skip, Fix tags, Flag ▸.
- **Keep:** mod-only visibility (`modCheck`).
- **Check:** smoke as a mod: the two items exist; as a member: the menu button isn't there.
- **Undo:** revert.

### 1.8 Progress and time
- **Goal:** a thin progress line along the stage's bottom edge; time as elapsed / total.
- **Rows:** NP-06, NP-07.
- **Files and change:** `#prgbar` positioned at the bottom of `#djStage` (CSS only; same element and updater). `room.js` countdown: `#timrUp` shows elapsed, `#timr` shows the **total** (with remaining in its `title`). Roboto Mono.
- **Keep:** the progress updater's timing; the bot's song timing.
- **Check:** smoke: `#timr` equals the song's duration (the seeded song is 300s: "5:00").
- **Undo:** revert.

### 1.9 Tied ranks
- **Goal:** songs with the same plays share a rank ("=3") on charts, DJ pages and Rising.
- **Rows:** DI-03, DI-07.
- **Files and change:** `discover.js` `chartRows`, `rankedRows` and the Home chart: compute standard competition ranking; show `=n` when the previous or next row has the same plays. A note under the chart when ties exist: "Songs with the same number of plays share a rank."
- **Check:** smoke: seed two songs with equal plays and check both show "=1".
- **Undo:** revert.

### 1.10 Stage floor and states
- **Goal:** DJs stand on the stage, not behind a window; every state reads clearly.
- **Rows:** ST-02, ST-03, ST-15, ST-21, ST-23, DJ-03, DJ-07.
- **Files and change:**
  - **Floor:** a pseudo-element on `#djStage` (`::after`) with a gradient over the bottom ~110px, layered **above** `#screenBox` and **below** `#deck` / `#ondeck` (check the z-index rules near "The Stage" in `looks.css`). The playing DJ's name plate becomes light (`--text-1` background, dark text).
  - **Empty decks:** when `tableChanged` reports no DJs, add `.st-empty` to `#djStage`: the existing `#stageBackdrop` logo, a big dashed + (the existing join control) and the line "The decks are open. Hop on and the room plays from your ★ playlist." plus the listener count. If the autopilot DJ (`!autodj`) is on, say "The bot keeps the music going until someone hops on."
  - **Tap to start:** `#tapToPlay` text becomes "Listen to the room" with "[DJ] is playing [song] · N people here" under it.
  - **Waitlist chip:** new `#st-waitlist` (top-right of the stage, under the controls) fed by `waitlistChanged`: "Waitlist · 3 · you're 2nd". Hidden when empty.
- **Keep:** the spotlight logic (`spotlightStateChanged`, `useAnchor`), dance mode, lights, snow, embers, beat bob.
- **Check:** screenshots of the six stage states (03-target-design.md) with robots, monsters, cats and a DiceBear set. Smoke: empty table → `.st-empty`; seeded waitlist → chip text.
- **Undo:** revert.

### 1.11 The Your turn bar
- **Goal:** your deck controls and what you'll play next, in one bar under the stage.
- **Rows:** DJ-01, DJ-02, DJ-04, DJ-05, ST-03, ST-24.
- **Files and change:** `#themebox` keeps `#timrUp`, `#djlistpickerWrap` (with `#djlistpicker`, `#djlistOpen`, `#deckQueue`) and `#timr`. Restyle as one 44px bar: times, "You DJ from" + the select styled as a button (★ for the default), then a new `#st-next` ("You're up next with …", from `#deckQueue`'s data), then new buttons `#st-bus` (Take the bus) and `#st-stepdown` (Step down) that call the same handlers as the user card's `toggle-bus` and `step-down` (factor those into `firetable.actions.toggleBus()` / `stepDown()` in `ui.js` and call them from both). When you're not on the decks: `#st-hopon` ("Hop on the decks", `!addme`).
- **Keep:** `#djlistpicker`'s change handler (`users.js`) and `switchDjList`; the user card's buttons.
- **Check:** smoke as the DJ: `#st-bus` toggles the departure state the user card shows; as a member off deck: `#st-hopon` sends `!addme`.
- **Undo:** revert.

### 1.12 People and cards
- **Goal:** the people list is readable and its icons explained; card "temp" is explained.
- **Rows:** PE-01 to PE-03, RE-05.
- **Files and change:** `#usersbox` rows 36px, avatar 28px, role icon with a tooltip (Room bot, Supermod, Mod, Member, Listening on radio). `cards.js`: the "Lowest/Highest Temp" tiles and the sort option get a tooltip saying what temp measures (ask the owner for the exact meaning; it's in the bot's card printing, `!printcard`).
- **Check:** keyboard focus order through the list; tooltips readable.
- **Undo:** revert.

### 1.13 Chat and Recent
- **Goal:** chat reads like a conversation; the bot's song lines stop crowding it.
- **Rows:** CH-01 to CH-19, RE-01 to RE-03.
- **Files and change:** `chat.js`: when a message is from the hostbot and is a song announcement (the "started playing" pattern; the bot's text is in `firetable-hostbot/app.js`), add `.ch-song` to it. CSS: one slim 12px line ("♪ Chris played Dernière · Romain Muller · 2 plays") with the play count on the right. Fire reactions for a song collapse into "🔥 matt and scytheria fired this" under its line where `processFireReactionMessage` already groups them. Message text 14px, names 13px bold. Recent rows: two-tone title · artist, Roboto Mono times.
- **Keep:** `#showSongAnnouncementsToggle` hides song lines exactly as today; images, avatars, reactions, grab buttons on cards, mod delete, mentions highlighting.
- **Check:** smoke: a seeded bot announcement gets `.ch-song`; with the setting off it's hidden.
- **Undo:** revert.

### 1.14 The playlist switcher
- **Goal:** one button shows which playlist you're looking at and opens everything about your playlists.
- **Rows:** CR-01, CR-12, CR-13, CR-14, CR-15, CR-16, CR-25.
- **Files and change:**
  - New `#cr-switch` button in `#listpickerWrap`: ★ (if default), the name, the count, broken count in `--live` if any, ▾. It reads from `#listpicker` (which stays in the DOM, hidden, as the source of truth: choosing in the menu sets `#listpicker`'s value and triggers `change`).
  - New popover `#cr-switchMenu`: a filter box, every list from `firetable.utilities.sortedLists` with its count and format icon (CR-15), then **New playlist** (the existing `#plAddCreate` flow), **Import a playlist** (the import dialog), **Manage playlists…** (`#plIndexBtn`'s click).
  - Hide `#plIndexBtn` and `#plAddLauncher` in the toolbar (they stay in the DOM; the menu calls them).
- **Keep:** `switchViewList`, the stored view list per uid, `relabelList` (make it update `#cr-switch` too), `fillPlaylistSelect`.
- **Check:** smoke: the button shows the viewed list's name and count; choosing another list in the menu switches `#listpicker`; Manage opens `#plIndexBox`. Update step 0.4's "reached through" list.
- **Undo:** revert.

### 1.15 Crate rows and the row menu
- **Goal:** rows read at a glance; the actions you use are on the row, the rest in ⋮.
- **Rows:** CR-02 to CR-06, CR-18, CR-19, CR-22, CR-23.
- **Files and change:** `playlist.js` `queueBlockHTML` / the row template: number, cover, **Title** · Artist (split the stored "Artist - Title" for display only), a tag (NEXT on the first row of the list you DJ from; BROKEN when `flagged`; REMIX when the title says so, the same test the Remixes filter uses), length if known. Visible actions on desktop: Top, Bottom, Preview, YouTube/SoundCloud, Delete, ⋮. `#trackMenuPopover` gains Edit tags (`editTagsPrompt`), Swap artist and title, Delete and search for another (`deleteSongAndSearch`), Copy to playlist (the steal picker). On narrow rows (under 640) only Top and ⋮ stay visible; ⋮ has everything.
- **Keep:** sortable dragging; ⇄ swap button; flags' display; preview; the template's ids and data attributes.
- **Check:** smoke: each ⋮ item calls its function (stub and assert); narrow width shows Top and ⋮ only.
- **Undo:** revert.

### 1.16 The crate toolbar
- **Goal:** one row of tools; filters behind one button; playlist-wide actions in one menu.
- **Rows:** CR-07, CR-10, CR-11, CR-13, CR-17, CR-20, CR-21.
- **Files and change:**
  - Order: `#cr-switch`, the filter box (`#queueFilterForm`), **tune** `#cr-showOnly`, **sort** `#cr-sort`, `#shuffleQueue`, **select** `#cr-select` (1.17), ⋮ `#cr-listMenu`, the + `#addToQueueBttn` (gold circle).
  - `#cr-showOnly` opens a menu of checkboxes: Remixes, Broken (these drive the existing hidden `#queueFilterRemixOnly` / `#queueFilterBrokenOnly` inputs and `filterQueue`), Not played here yet and Duplicates (new filters in `filterQueue`: "not played here" needs `globalTracks` lookups; do it lazily for the list and cache, or leave it for later and ship the two existing ones first). A red count badge shows when a filter is on.
  - `#cr-sort`: **Your order** (the play order, default), Title, Artist, Recently added. Sorting other than Your order is **view only**: it never rewrites the list, shows a banner "Showing by title. Your play order hasn't changed." with **Back to your order**, and disables dragging while on.
  - `#cr-listMenu`: Rename (inline, `renameList`), Play this when I DJ (★, `savePlaylistPrefs({defaultList})` and `switchDjList` as the owner prefers: ask whether ★ means default-open or DJ-from; today they're separate and both stay), Shuffle the order (`shuffleQueuePrompt`), Remove duplicates (`removeDupesFromQueue`), Check for broken songs (`checkBrokenTracks`), Swap all to YouTube Music audio (`swapAll`, only when swaps exist), Merge into… (`#mergeLists` flow), Export (new: download the list as text "Artist - Title" lines; no server), Delete playlist (`#plDeleteLauncher` flow, disabled for the built-in list).
  - Hide `#mergeLists`, `#plDeleteLauncher`, `#queueFilterExtras` (still in the DOM).
- **Keep:** every function above unchanged; `#swapBar` (Swap all / Show them) still appears over the list when swaps exist.
- **Check:** smoke: every menu item reaches its function; filters still filter; view-only sort doesn't change `ftapi.queue` order.
- **Undo:** revert.

### 1.17 Select several
- **Goal:** move, copy or delete several songs at once.
- **Rows:** CR-03, CR-05, CR-24.
- **Files and change:** `#cr-select` toggles `.cr-selecting` on `#mainqueue`: a checkbox on each row, dragging off, and a floating neutral bar `#cr-bulk` ("3 selected · Top · Bottom · Copy to… · Delete · ×"). Top and Bottom keep the selected songs' relative order, done in one atomic rearrange (`ftapi.utilities.rearrangeList`, as `addTrackToTop` does). Copy to… uses the steal picker for several. Delete asks once ("Delete 3 songs?") and offers Undo (re-add at the same positions).
- **Keep:** preview, swap and flags on selected rows.
- **Check:** smoke: select 2 of 5, Top → they're first in their old order; Undo restores.
- **Undo:** revert.

### 1.18 Keyboard shortcuts and help
- **Goal:** fast hands for regulars.
- **Rows:** CH-12, CH-13, MO-04.
- **Files and change:** `ui.js`: one `keydown` listener (ignored while typing in an input, textarea or contenteditable, and while a dialog is open): **F** Fire, **G** Grab (1.6), **T** move selected to top (1.17), **M** mute, **/** search (exists in Discover), **?** opens `#helpBox`, a dialog listing shortcuts, the chat slash commands (`/block`, `/unblock`, `/hot`, `/storm`, `/shrug`, `/tableflip`, `/unflip`), the common bot commands (`!plays`, `!firstplay`, `!bpm`, `!suggest`, `!link`, `!theme`), and for mods their commands (MO-04).
- **Check:** smoke: pressing F with focus on the page sends a fire; with focus in `#newchat` it types "f".
- **Undo:** revert.

### 1.19 Import, step by step (YouTube and SoundCloud)
- **Goal:** see what's in a playlist before importing; import into a new or existing list; nothing dropped silently.
- **Rows:** IM-01, IM-02, IM-03, IM-06, CR-12, CR-15.
- **Files and change:**
  - Rework `#importPromptBox` (keep the id) into the two-step dialog of [03-target-design.md](03-target-design.md): step 1 one input (link or name) with source buttons YouTube | SoundCloud (today's `#ytimportchoice` / `#scimportchoice`, restyled as a segmented control), results showing the song count (and, later, how many the room has played).
  - Step 2 (new): fetch the songs (`playlistItems` pages for YouTube, 1 unit per 50; `scPlaylist` for SoundCloud), list them with private and deleted videos shown as "not available" instead of dropped, a "Put them in" choice (new playlist with a name; or an existing list from `sortedLists`, at the top or bottom), "Skip songs already in that playlist" (on), and **Import N songs**.
  - Import in the background (a progress line in the dialog, which can be closed; a toast when done with **Undo**, which removes exactly the added keys or the created list). Respect the target list's format (`formatRefusal`): YouTube songs into a SoundCloud list are refused with a message, and the reverse.
  - Paste-a-playlist-link: in Find tracks (`#qsearch`) and Discover search, a YouTube or SoundCloud playlist link shows "That's a playlist: [name] · N songs. **Import it**" (today's message is "Use Import…").
  - `playlist.js` `importList` gains `(id, name, type, opts)` with `opts.dest`, `opts.position`, `opts.skipExisting`, `opts.onProgress`; old callers keep working.
- **Keep:** the keyword search for playlists (100 units per search; show "Searching YouTube" so people know it's slow).
- **Check:** smoke with a stubbed `ytAPI`: a 3-song playlist with one deleted video lists 3 rows, imports 2 into an existing list at the top, Undo removes them.
- **Undo:** revert.

### 1.20 Import a list of songs (needs the bot)
- **Goal:** paste "Artist - Title" lines or upload a CSV, matched to the room's library first and YouTube Music next, for free.
- **Rows:** IM-04.
- **Bot first (`firetable-hostbot`):** an import job queue in the database: `importJobs/<uid>/<jobId>` = `{ items: [{a, t, dur?}], dest, position, format, status }` written by the site; the bot (a new `lib/imports.js`) matches each item: the room's library (the play history's songs, through an index the history job publishes, e.g. `discover/lib/songIndex` sharded by artist key, or `globalSongs` lookups by key), then the swap search's free sources in the same order (`lib/swaps.js`: the year playlists, `ytmusic.searchSongs` with `swaps.rankMatches` and `swaps.catalogGate`, people's playlists through `ytmusic.webPlaylists`, `ytmusic.webSearch`), then artist videos (OMV) within ~10 seconds of the length, then fan uploads and SoundCloud as choices only, checks playability (`videos.list`, 1 unit per 50), and writes `results` back. Rules and rules tests for `importJobs` (owner write, bot read and write, size limits). The playlist's format decides which kinds of match are acceptable (SoundCloud lists: SoundCloud only; video lists: videos allowed; YouTube Music: songs first).
- **Site:** the "A list of songs" source in the dialog: a textarea and a CSV upload (parse columns named artist/title/track name/artist name, as exported by common tools); then step 2 shows the bot's matches with "Played here", "Song", "Artist's video", "Fan upload", "Pick a version" (inline choices), "Not found" (search YouTube by hand: 100 units, or leave out).
- **Check:** hostbot unit tests for the matcher (like `test/unit.test.mjs`'s swap tests); rules tests; site smoke with a fake job result.
- **Undo:** revert both; the job queue is inert without the bot.

### 1.21 Import from Spotify (after the owner adds a key)
- **Goal:** paste a Spotify playlist link.
- **Rows:** IM-05.
- **Bot:** `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in `.env` (and `.env.example`, README); client-credentials token; read the playlist's tracks (name, artists, duration) and feed them into the 1.20 job. Spotify's own editorial and algorithmic playlists may not be readable by new apps; say so when a link fails.
- **Site:** the Spotify source appears only when the bot publishes that it can (e.g. `discover/caps/spotify = true`).
- **Undo:** revert; remove the key.

---

## Phase 2 · Discover in the shared frame

Discover already is a separate page (`#discoverPage`). These steps give it the new header, left column and one player. Visitors see it first, so it's the best place to show the new look.

### 2.1 Discover's left column as the shared nav
- **Rows:** DI-01 to DI-12, TB-08.
- **Change:** `#dRail` (`#dLive`, `#dSearch`, `#dNav`) restyled into the left column of [03-target-design.md](03-target-design.md): Home, **Live room** (with the live line from `renderLiveLine` as its subtitle), a DISCOVER label over the views (`VIEWS` in `discover.js`), then for visitors the crate card (DI-15) and at the bottom a small live card (album art with the DJs' avatars over it and **Listen in**; never a second video player).
- **Keep:** `setView`, routes, `renderRail`'s `aria-current`.
- **Check:** smoke's Discover checks; plain pages (`/music/…`) still render the same middle column.

### 2.2 The header search, and Live as a nav item
- **Rows:** TB-08, TB-09, DI-12.
- **Change:** `#dSearchOpen` (keep the id) becomes a search field in the top bar on desktop (an input that routes to `#discover/search/<words>` and focuses with `/`), the icon on phones. `#modeTabs` stays for one release but is hidden at 1024 and up, where the left column's Home / Live room items do the same (`setMode`).
- **Check:** `/` focuses search from Live and Discover; the address and back button behave as today.

### 2.3 One player
- **Rows:** DI-13, DI-14, DI-17.
- **Change:** `#dSide`'s tabs become NOW PLAYING · UP NEXT · CHAT (members) and a two-way switch **From Discover | The room, live** (`listenIn` / the Discover play path). When playing from Discover, a card shows the room's song with **Rejoin**. When the member becomes next on the decks (`tableChanged` / spotlight), switch back to the room by itself, with a toast.
- **Keep:** `firetable.preview = "discover"` mechanics; Media Session; no scrobbling from Discover.
- **Check:** smoke: playing a Discover song then marking the member as next on deck returns to the room.

### 2.4 Discover Home for a first visit
- **Rows:** DI-01, DI-15, AU-01, CH-19.
- **Change:** one dismissable line at the top for visitors (stored in `localStorage`); New this month as a 7-wide grid (fewer at narrow widths) with "first played by [DJ] · [date]" under each (from the new-releases data); the Room chart block with the period switch and tied ranks; Rising; Genres as tiles with one distinct cover each (pick covers no other tile uses).
- **Check:** screenshots as a visitor at all widths.

### 2.5 Joining and logging in
- **Rows:** AU-01 to AU-06.
- **Change:** restyle `#login`, `#authBox`, `#oauthBox`, the join box in Discover, `#pickNameBox` with the tokens; one column, 44px fields, the existing copy.
- **Check:** smoke's existing auth flow checks.

### 2.6 New and Charts controls
- **Rows:** DI-02, DI-03, DI-20.
- **Change:** New's three chips become one drop-down; Charts' period stays a segmented control (four items fit), genre and new-only become two drop-downs, actions **Play the chart**, **Save as playlist**, **Share**. Columns: rank (=), move, cover, song, genre, first here (avatar · DJ · date), weeks, plays; **peak** only once the bot publishes it.
- **Check:** smoke's chart checks; the chart image and embed unchanged.

### 2.7 Library pages
- **Rows:** DI-04 to DI-11.
- **Change:** the fixes from the review: the overview strip (their sound, similar DJs, recent sets / by year, who plays it, next door) above long lists; top 10 with "Show all"; fact chips in heroes; DJ pages default to "Brought here first"; "Their sound" as a stacked bar plus the top five genres; recent sets merged by night and clickable; Years with covers and "released in"; numbers through `n()` everywhere; genre map label collisions; a fallback cover for missing art (a generated colour block with the artist's initials, not the `:id:` logo).
- **Check:** screenshots of each page type; plain pages.

### 2.8 One song menu everywhere
- **Rows:** DI-19, CR-04, NP-08.
- **Change:** Discover's ⋮ (`openMenu`) and Live's track and history menus share the same items and order where they apply (Play, Grab ▸, Song page, Open, Copy link, Share as a card; mods: Edit tags, Flag ▸).

---

## Phase 3 · The new room, opt-in (`body.ft-room-v2`)

Everything here is CSS and element moves scoped to `.ft-room-v2`, so Classic is untouched.

### 3.1 The left column: nav over the room
- **Rows:** PE-01, DJ-03, NV-03.
- **Change:** new `#nav-rail` (Home, Live room, DISCOVER views) inserted at the top of `#usersbox` (desktop only), reusing Discover's routes. `#usersStats` becomes "IN THE ROOM · N" with the radio count; the waitlist card above the people.
- **Check:** with v2 off, `#nav-rail` is hidden; with it on, all items route.

### 3.2 The stage, full height
- **Rows:** ST-01, ST-02, ST-04.
- **Change:** `#djStage` height from `--stage-max-height` (33vh today) to about 440px at 1920 / 360px at 1440, the video at full height and 16:9; the playing DJ about 230px tall, next DJs about 84px, per 03-target-design.md. Check with SoundCloud art (square), dance mode, lights and snow.

### 3.3 Chat column tabs
- **Rows:** CH-01, TB-05, SE-08.
- **Change:** tabs CHAT · MENTIONS · ⚙ over `#actualChat`; MENTIONS shows `#inboxList` (move the node into the tab while v2 is on, like `chatIn`); ⚙ opens Settings at the chat toggles.

### 3.4 The crate, expanded
- **Rows:** CR-01 to CR-27, CR-08.
- **Change:** `#cr-expand` toggles `.cr-expanded`: the stage becomes the compact strip, the left column folds to icons, the crate gets the full table (genre, BPM, year, room plays, first here: fetched lazily for visible rows from `globalTracks` / `globalSongs` / `bpm`, cached, the way `discover.js` `loadDetails` does), and **Find tracks** opens as a tab in the right column (move `#searchMachine` and `#searchResults` there while expanded). **Back to the stage** restores it.
- **Check:** the room's audio and spotlight keep running; dragging still works.

### 3.5 1440 and 1024
- **Change:** the left column folds to a 64px rail with faces at 1440 (opens as an overlay); the Your turn bar's buttons become icons with tooltips; at 1024–1439 the three columns as today.

### 3.6 Owner and regulars' review
- Turn on "Try the new room" for the owner and a few regulars for two weeks. Collect what they miss. Fix before phase 5.

---

## Phase 4 · Phones

First, **find out how many visits come from phones.** The site has no analytics; use the server's access logs (DreamHost) or ask in the room. If phones are a small share, phase 4 can wait.

### 4.1 Bottom tab bar
- **Rows:** NV-01.
- **Change:** under 640px with v2 on, new `#nav-tabs` (Home · Discover · Live · Library · You) replaces `#minimodeoptions` (kept in the DOM; its handlers still run): Home and Discover route to Discover; Live shows the stage with Chat · Recent · People · Cards; Library shows Playlists full screen; You opens Settings as a page.

### 4.2 Live on a phone
- **Rows:** ST-*, NP-*, CH-*.
- **Change:** the stage full width at 16:9; the song row with Fire, Grab and ⋯ (44px); the You're next row; the tabs; about 320px of chat; a ⋮ on the stage for screen, avatars, full screen and reload.

### 4.3 Library on a phone
- **Rows:** CR-*.
- **Change:** the switcher + Find tracks on one row; the tool row (filter, tune, sort, select, ⋮); rows of 56px with Top and ⋮; hold to drag (jQuery UI sortable's `delay` on touch); Undo toasts.

### 4.4 Grab and More sheets
- **Change:** Grab's toast with Change; ⋯ as a short bottom sheet (the same menu as desktop, at 48px rows), with a separate Mods section.

### 4.5 The You tab
- **Rows:** TB-03 to TB-06, SE-*, AU-07 to AU-09, MO-01.
- **Change:** a page listing profile, settings, mentions, community links, install the app, about, privacy, terms, log out, and the Mod tab for mods. Reuses `#accountSettingsBox`'s contents (moved, not copied).

### 4.6 The mini player
- **Change:** above the tab bar: the room (art with the DJ's avatar, "● Live · jarvis", Fire) or the Discover song (art, title, Grab, play/pause). Reuses `#dMini`.

---

## Phase 5 · Default and clean-up

### 5.1 Make the new room the default
- Set `newRoom: "default"` in `config.js` on the server (no deploy needed). Settings shows "Use the classic room" for anyone who wants it back.

### 5.2 Retire Classic
- After a season with few people on Classic: remove the Classic-only CSS, the hidden duplicate controls (`#modeTabs`, `#minimodeoptions` handlers if unused), and the toggle. Update `README.md`, the inventory and step 0.4's list.
