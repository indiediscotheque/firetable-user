# 03 · Target design

What we're building towards. It comes from three rounds of mockups (the canvas "Indie Discotheque redesign", boards prefixed `R3` are current), an independent design review, and the owner's comments on each round. Where this file and a mockup disagree, **this file wins**: it includes the review's corrections.

## What changed between rounds, and why

- **Round 1** unified Discover and Live into one app with a player bar, but took the DJs off the stage and didn't show the crate. Rejected: the DJs on stage are the room's signature, and crate management is central.
- **Round 2** put the DJs back and the crate in a permanent side panel, with everything mapped. The review scored it 5/10: the stage shrank (the video about 38% smaller), avatars looked like they were "peeking out from behind a window", 14 regions competed at 1920 wide, gold meant eight things, and the playlist page left the room.
- **Round 3** refines **today's room** instead of replacing it: the stage keeps its full height with the DJs standing in front, the crate stays under the stage (Playlists · Recent · Fresh · Cards), people stay on the left and chat on the right. Discover gets the same frame and one player. Phones get a bottom tab bar. That's what this plan builds, in the order of [04-step-plan.md](04-step-plan.md).
- **Round 4** (November 12, 2026) keeps Live exactly as it looks today and spends the design on Discover and phones. The owner turned down a small stage, song-colour tints and name plates in Discover ("heavy and off balance"; people looked like they were all DJing), and the big filled gold buttons. Round 3's Live layout is on hold; its crate tools, menus and import stand.

## Round 4: what's current

Boards `R4 · …` on the canvas's "Round 4" page. Where this section and a later one disagree, this section wins.

- **Live:** no change to its layout, colours or controls. Phase 1's steps add function inside it, in today's skin.
- **Colours:** today's variables (`--color-bg` `#181818`, `--color-bg-s2` `#111`, `--color-bg-t1` `#222`, `--color-border`, `--color-accent`). Panels in Discover are flat `--color-bg-t1`. No gradients, no tint from the song's cover.
- **People:** circle avatars with the name beside them. Name plates only on the stage.
- **Buttons:** today's raised `.butt` shape. A panel's main action is dark with gold text; play/pause is light; other buttons grey. No wide solid-gold buttons.
- **Discover's frame (computers):** today's three columns at today's widths. The left column is unchanged: logo, theme, Discover | Live, the live line with Listen in, search, the views.
- **Home:** leads with **New this week** (releases since Friday): the lead song's cover (208px at 1440), title, artist, genre and length, "Found by [avatar] Chris · Nov 6 · 1 play so far", **Play the week's 18**, **Save all**; the next six covers; "All 18 from this week". Then **Not played live yet** (four covers tagged "Be the first", release date, Save), Room chart, the six most-played DJs as circle avatars with play counts, Rising, then today's Theme nights, Genres, On this day and Recent plays. No intro text.
- **The On Air card (right column, while you're not in the room and nothing of yours is playing):** "On air in the room · N here", the room's cover, song, artist, "190 plays · first Mar 15, 2012", "matt on deck · Chris next" with circle avatars, a thin progress line, **Listen in**, **Step inside**, the chat peek, and **Just played** (four rows, "First play" tags). Art and text only, never a second player.
- **The player (right column, playing from Discover):** "Playing from New · this week · 12 of 18", cover, title, artist, genre and year, progress, previous / play-pause / next, volume, open, ⋮. **Found by**: the first DJ's avatar, "First played here Nov 8", "1 play so far" (older songs: "38 plays · last Nov 9 by scytheria", and "Rising: 7 plays in the last 4 weeks"). **Play it in the room** (members: to the top of the playlist they DJ from, and "Hop on" when a spot is open; visitors: "Join to play it in the room"), **Save** as a split button, Up next with "6 left", and at the bottom the room in one row with **Rejoin** or **Listen in**.
- **New:** one **Show** menu (This week, Last 90 days, Not played live yet), four covers across at 1440, each with who played it first and when, or "Nobody has played it yet" and "Be the first".
- **Genres, the sound map:** the genre the room is in has a red dot, the genres it passed through tonight have small rings, the genre you're hearing has a gold outline, with a legend under the map. Clicking a genre shows its card under the map (name, description, counts, next door, its radio, Open).
- **Phones:** a bottom tab bar, **Home · Discover · Live · Library · You**. Home: logo, theme, search, the room in one row with Listen in, then New this week, Not played live yet, the chart. Discover: search and the views. Live: the room. Library: playlists. You: profile, settings, mentions, community, about, install, log out. The player opens full screen from the mini player: cover, song, progress, three transport buttons, Found by, Save, Play it in the room, the room row. On phones the tab bar replaces the Discover | Live switch and the sideways row of view tabs.

## Design tokens

**Round 4: the colour table below is not applied.** Colours stay today's (see above). The type, spacing, radius and target-size tokens stand.

Add these to `:root` in `css/looks.css` in step 0.1, **mapped onto the existing variables** (the old names keep working). The values are the starting point; tune them on real screens.

### Colour

| Token | Value | Use |
|---|---|---|
| `--surface-0` | `#0F0F11` | page background (today `--color-bg` is `#181818`; move it in 0.1 and check every panel) |
| `--surface-1` | `#141417` | panels: people, chat, the crate area |
| `--surface-2` | `#1A1A1E` | inputs, rows on hover, the Your turn bar |
| `--surface-3` | `#222227` | buttons, menus |
| `--surface-4` | `#2E2E34` | selected segment, menu item on hover |
| `--line-1` | `#1E1E23` | dividers |
| `--line-2` | `#34343B` | input borders, menu borders |
| `--text-1` | `#ECECEF` | titles, primary text (maps `--color-text`) |
| `--text-2` | `#C4C4CC` | secondary text, icons |
| `--text-3` | `#A6A6B0` | metadata (maps `--color-text-subtle`) |
| `--text-4` | `#8E8E98` | labels, timestamps (maps `--color-text-muted`; never smaller than 12px on `--surface-0`/`-1`) |
| `--color-accent` | `#cc9933`, unchanged | **one job: the action you're most likely to take, and "on" states.** Fire, the + (Find tracks), primary buttons, the selected tab's underline, ★ default list. Never progress bars, name plates, selection bars or decoration. Theme nights may change it. |
| `--live` | `#E5534B` | the live dot, unread badges, destructive actions |
| `--ok` | `#5FC08A` | success ticks, rising (▲) |

Contrast: `--text-4` on `--surface-1` is 5.5:1, fine for text of 12px and up. Row numbers, drag handles and zero counts must be at least `--text-4` (the review found 2.2:1 grips and 3:1 numbers in the mockups).

### Type

Self-hosted only (`font-src 'self'`): **Inter** for everything, **Roboto Mono** for times and the numbers in tables. Use `font-variant-numeric: tabular-nums` for counts.

| Token | Size / weight | Use |
|---|---|---|
| `--fs-display` | 28px / 700 | page titles (Discover pages, dialogs) |
| `--fs-h2` | 20px / 700 | section titles |
| `--fs-h3` | 16px / 700 | the song on stage, card titles |
| `--fs-body` | 14px / 400 | chat, rows, menus |
| `--fs-row` | 13px / 600 + 400 | dense rows (crate, Recent, charts) |
| `--fs-meta` | 12px | metadata, timestamps, tags (existing token, keep) |
| `--fs-label` | 11px / 600, +0.08em, uppercase | section labels, tab labels only. **Nothing smaller than 11px anywhere.** |

### Space, size, shape

- Spacing on a 4px grid: 4, 8, 12, 16, 20, 24, 32.
- Targets: icon buttons 32px in dense desktop rows, **44px on the stage and everywhere on phones** (Fire, Grab, Link, ⋯, shield).
- Radii: 3–4px album art in rows; 6px rows, inputs, small buttons; 8px buttons, menus, tags; 10px stage, panels; 14px dialogs. **999px only** for avatars, the theme pill, live dots, badges and the + (Find tracks). Not every button is a pill.
- Shadows only on things that float (menus, dialogs, toasts, the bulk bar).
- Motion: 120–180ms ease-out for menus and hovers; respect `prefers-reduced-motion` (the site already does for typing dots, snow and the stage).

### Icons

Material Symbols Outlined, as today, in the subset font (see [01-ground-rules.md](01-ground-rules.md) for rebuilding it). Filled for "on" states (`material-symbols-filled`). Icons the plan introduces: `tune`, `checklist`, `open_in_full`, `close_fullscreen`, `person_off`, `vertical_align_top`, `vertical_align_bottom`, `find_replace`, `sell`, `graphic_eq`, `library_add`, `inventory_2`, `ios_share`, `equalizer`, `article`, `music_note`, `radio`, `home`, `explore`, `library_music`. Check each against the current subset before using it; some may already be there.

## The Live room, desktop (1920 and 1440)

**On hold since round 4.** Live keeps today's layout and look. Of this section, only what Phase 1 still lists is built (the Your turn bar, the crate toolbar and rows, Fire's count, slim song lines in chat).

Board `R3 · Live room · 1920`. Same regions as today at 1024px and up:

```
┌──────────────┬───────────────────────────────────────────────┬──────────────────┐
│ Header: logo · theme pill · search · @ · community · about · avatar             │
├──────────────┼───────────────────────────────────────────────┼──────────────────┤
│ Nav          │ STAGE (full height video, DJs in front)       │ CHAT · MENTIONS  │
│ Home         │                                               │                  │
│ Live room ●  │                                               │ slim song lines  │
│ DISCOVER     ├───────────────────────────────────────────────┤ messages         │
│ New … Recent │ Your turn bar: 1:24/4:50 · You DJ from ★… ·   │ fire lines       │
│──────────    │ Up next … · Take the bus · Step down          │                  │
│ IN THE ROOM  ├───────────────────────────────────────────────┤                  │
│ waitlist     │ PLAYLISTS · RECENT · FRESH · CARDS            │                  │
│ people…      │ crate toolbar (one row)                       │                  │
│              │ crate rows …                                  │ composer         │
└──────────────┴───────────────────────────────────────────────┴──────────────────┘
```

- **Header** (`#topbar`): the logo as is; the theme pill; **a search field** (Discover's search, `/` focuses it); then @ (with unread badge), community, about, your avatar. Same icons as today, each with a tooltip.
- **Left column** (today `#usersbox` region, 272px at 1920): the navigation first (Home, **Live room** with "jarvis on deck · 7 here", then a DISCOVER label over New, Charts, Genres, DJs, Years, Theme nights, Recent plays), a divider, then **IN THE ROOM · N** (radio count beside it), a waitlist card ("No waitlist · 1 spot open on the decks", or the list), then the people list with role icons and a legend on hover. This is today's people column with the nav added above it, so regulars still find people top-left.
- **The stage** (`#djStage`, about 440px tall at 1920):
  - The video fills the stage's **full height** at 16:9, centred (today's behaviour; square artwork for SoundCloud).
  - A **floor**: a gradient from transparent to the stage background over the bottom ~110px, so avatars stand on something.
  - **The playing DJ** stands big, centre-front, overlapping the video's lower part, with a light name plate under their feet ("jarvis · 3 plays"). **The next DJs** stand small at the bottom-right, with a dashed + "Hop on the decks" when a spot is open. This is today's arrangement; the floor is what fixes "peeking out of a window".
  - **Top-left:** the song's title (18px, bold), artist (a link), then "22 plays · 31 all versions / first Sep 30, 2022 / last Nov 10 by scytheria", then small tags (genre, year, BPM). Today's place for this.
  - **Top-right, a column of 40px buttons:** screen (synced video / art / off), volume (opens the slider), reload, full screen, **hide avatars** (player view). Today's place.
  - **Bottom-left, 44px buttons:** **Fire** with its count, **Grab** as a split button (tap: add to the last playlist you grabbed to, with Undo; ▾: pick), **Link**, **⋯** (more), and the **shield** for mods only. Today's place. **Skip** appears here only while your own song plays.
  - **Progress** as a 3px line along the stage's bottom edge.
- **Your turn bar** (`#themebox` today, under the stage): `1:24 / 4:50` (elapsed / total), "You DJ from [★ 2026 | Indie Discotheque ▾]" (the existing `#djlistpicker`), "You're up next with Closer to the Ground · Supertaste", **Take the bus**, **Step down**. For people not on the decks it says "Hop on the decks" instead.
- **Under the stage:** today's tabs, PLAYLISTS · RECENT · FRESH · CARDS.
- **The crate toolbar, one row:** the playlist switcher button (★, name, count, ▾), a filter box ("Filter this playlist"), **tune** (Show only: Remixes, Broken, Not played here yet, Duplicates, Genre ▸, BPM; a red count badge when on), sort, shuffle, **select** (checklist), **expand** (open_in_full), ⋮ (playlist options), and the gold **+** in a circle (Find tracks).
- **Crate rows** (40px): number, cover, **Title** · Artist in two tones, a tag when it matters (NEXT, BROKEN, REMIX), genre, length, then **Top, Bottom, Preview, YouTube, Delete, ⋮**. All visible on desktop, as today.
- **Right column, chat:** tabs CHAT · MENTIONS · ⚙ (chat settings: song lines, images, avatars). Song announcements are one slim line: "♪ **Chris** played Dernière · Romain Muller · 2 plays". Fires appear as a small line under the song ("🔥 matt and scytheria fired this"). The composer has emoji, the text box ("Chat a thing"), @ and share-a-card.

**At 1440:** the left column folds to a 64px icon rail with the room's faces under it (tap to open the full column as an overlay), the chat column is 340px, the stage 360px tall, and the Your turn bar uses icon buttons with tooltips for Take the bus and Step down. **At 1024 to 1439:** today's three columns, restyled. **At 640 to 1023:** today's two columns, restyled; the Your turn bar wraps to two lines.

## The crate, expanded

Board `R3 · Live room · crate expanded`. The **expand** button shrinks the stage to a 168px strip (video with the DJs still standing in it, the song, Fire, Grab, Link, ⋯, "You're up next", **Back to the stage**), folds the left column to icons, and gives the crate the full width:
- Columns: select, #, cover, Title · artist (+ tag), genre, BPM, year, room plays, first here (DJ · month year), length, actions.
- **Select mode:** checkboxes, and a **neutral (light) bar** floating at the bottom: "3 selected · Top · Bottom · Copy to… · Delete · ×".
- The row ⋮ opens a small menu (below).
- **Find tracks** opens in the right panel beside chat (a FIND TRACKS tab): a segmented control YouTube | SoundCloud | The room's library, the search box, "Adds to [playlist] at the [top ▾]", then "Played here before" results first and source results after, each with Preview and Add. A dashed note: "Paste or drop a YouTube or SoundCloud link anywhere in the crate to add it."
- The room keeps playing; nothing leaves Live.

## The small pick menus

Board `R3 · The small pick menus`. Every menu is a popover (today's pattern) of 32–36px rows, with no repeats of what's already on screen:

| Menu | Opens from | Items |
|---|---|---|
| **Grab** | ▾ on Grab | search, playlists with checkboxes (several at once), "last used" and "already in" marks, New playlist |
| **More ⋯ (stage)** | ⋯ | Edit tags, Flag ▸ (Broken, Low audio quality, Off theme), Swap audio ▸, Song page, Share as a card, Copy link |
| **Mod tools** | shield (mods) | Skip this song, Fix tags, Flag in the DJ's playlists ▸, Remove [DJ] from the decks, Add someone to the decks |
| **Playlist switcher** | the switcher button | search, lists (★ marks the one you DJ from; count and broken count each), New playlist, Import a playlist, Manage playlists… (opens today's All Playlists) |
| **Show only** | tune | Remixes, Broken, Not played here yet, Duplicates (each with a count), Genre ▸, BPM range |
| **Playlist options ⋮** | ⋮ in the toolbar | Rename, Play this when I DJ (★), Shuffle the order, Remove duplicates, Check for broken songs, Swap all to YouTube Music audio, Merge into…, Export, Delete playlist (red) |
| **A song in your crate ⋮** | ⋮ on a row | Copy to playlist ▸, Edit tags, Swap artist and title, Swap for YouTube Music audio, Delete and search for another |
| **Keyboard** | `?` | F Fire, G Grab to last used, T move selected to top, / search, M mute, ? all shortcuts |

## Every stage state

**Round 4:** the wording of each state and the waitlist chip stand. The floor gradient and the light name plate are dropped: the stage is drawn as today.

Board `R3 · Every stage state`. Each must be built and checked:
1. **A visitor's first second:** the room visible behind a dark veil with "▶ Listen to the room" and one line ("jarvis is playing Me & Youphoria · 7 people here"). Replaces `#tapToPlay`'s words, same element.
2. **Nobody on the decks:** the `:id:` backdrop (today's `#stageBackdrop`), one big dashed + and "The decks are open. Hop on and the room plays from your ★ playlist. 3 people are listening."
3. **Full decks with a waitlist:** four DJs, no open spot, a chip top-right "Waitlist · 3 · you're 2nd".
4. **Player view:** avatars hidden, one chip "jarvis · Chris next" bottom-left, the person button top-right to bring them back. Remembered per device; Stage view stays the default.
5. **Artwork, long titles, other avatar sets:** square art at full height; long titles wrap in the side column; cats, monsters and DiceBear sets stand on the same floor.
6. **Your song:** you're the big DJ; **Skip** appears; Fire shows the count you've received; "matt and 5 others fired your song". Lights and snow as their seasons say.

## Import

Boards `R3 · Import 1` and `Import 2`, and the phone pair.
- **Four ways in:** "Import a playlist…" in the playlist switcher; pasting a playlist link in any search box ("That's a playlist: Night Drive · 64 songs. **Import it**"); a new member's empty library ("Bring your playlists"); "Save as playlist" on any Discover page.
- **Step 1, choose:** one box for a link or a name. Sources: **YouTube** (YouTube Music too), **SoundCloud**, **Spotify** (once the bot has a key), **A list of songs** (paste "Artist - Title" lines or upload a CSV), **From the room** (a DJ's set, theme night, chart, year or genre). **No Apple Music.** Search results show the song count and how many the room has already played; open one to see its songs.
- **Step 2, check:** where they go (a new playlist, named; or one you have, at the top or bottom); options: keep the source's order, prefer versions the room has played (they keep their history), play this when I DJ. Every song beside its match: "Played here", "Song" (a YouTube Music audio track), "Artist's video", "Fan upload", "SoundCloud", "Pick a version" (choices shown inline), "Not found" (use the studio version, search YouTube, or leave it out). Preview, swap and leave out on every row.
- **Step 3, import:** runs in the background ("Import 63 songs"), progress shown, the room keeps playing, Undo from the playlist afterwards. Nothing is dropped without being shown.
- **Matching costs:** the room's own library first (free), then YouTube Music search on the bot (free, `lib/ytmusic.js`), then the playability check (1 YouTube unit per 50). Only "Search YouTube" by hand spends 100 units, and only when someone chooses it. A playlist's format (YouTube Music, videos, SoundCloud) decides which kinds of match it accepts.

## Discover in the same frame

**Superseded by "Round 4: what's current" above,** except Charts (period control, two drop-downs, Play the chart, Save as playlist, Share, tied ranks) and the return to the room when your turn comes.

Boards `R3 · Discover home` and `R3 · Charts`.
- The **same header and left column** as Live: Home is selected; a "Your crate" card for visitors (3 songs saved, kept in this browser, becomes your first playlist when you join); a small **live stage card** at the bottom (the video with the DJs standing in it, "Me & Youphoria · Röyksopp · jarvis", **Listen in**).
- **Home for a first visit:** one dismissable line ("A room of real DJs playing alt dance, nu-disco and synth, live, since 2016. Everything they've played is here to dig through: 98 DJs, every year since 2006, charts every week." + "See the room"), New this month (7 × 2 covers, each with who first played it and when), Room chart (Week / Month / Year / All time segmented; tied songs share a rank shown as "=1", with a note), Rising, Genres as small tiles with one distinct cover each.
- **Charts:** the period control, the month or week with ‹ ›, "3,412 plays by 14 DJs so far", two drop-downs (genre; all songs / new releases) instead of chips, **Play the chart**, **Save as playlist**, **Share**. Columns: rank (ties as =), move (▲ ▼ NEW —), cover, song, genre, first here (avatar · DJ · date), weeks, peak, plays, Grab and ⋮.
- **One player** (the right column): tabs NOW PLAYING · UP NEXT · CHAT, and a two-way switch **From Discover | The room, live**. Playing from Discover mutes the room; a card shows what the room is playing with **Rejoin**; when your turn on the decks comes, the room comes back by itself. Up next, previous, play/pause, next, Grab (split), Link, volume.

## Phones

**Round 4:** the tab bar and the You tab stand and move up the order (Phase 4 runs after Phase 2). Home and the player are as in "Round 4: what's current". Live and Library on a phone below are still the plan, behind "Try the new room" for members.

Boards `R3 · Phone · …`. Bottom tab bar: **Home · Discover · Live · Library · You** (44px targets, 11px labels). A mini player sits above it, showing the room or what you're playing from Discover.
- **Live:** header (logo, theme pill, @ with badge); the stage **full width at 16:9** (390 × 219) with the playing DJ standing in front and the next DJs small at the right; a ⋮ on the stage for video/art, avatars, full screen and reload; the song row (title, "Röyksopp · 22 plays · 1:24 / 4:50", **Fire** with count, **Grab**, **⋯**); a "You're next · Closer to the Ground" row (bus button, opens Library); tabs CHAT · RECENT · PEOPLE · CARDS; about 320px of chat; the composer. Fresh moves to the Discover tab.
- **Library:** one row with the playlist switcher (★, name, count, broken) and the gold +; one row of tools (filter, tune with a dot when on, sort, select, ⋮); rows of 56px with a **one-tap Top** and ⋮ (Bottom, Preview, YouTube, Copy to, Edit tags, Delete…); hold a row to drag; "Glider moved to the top · Undo". Swipe can be added later as a shortcut, never the only way.
- **Grab and More:** a toast "Grabbed to Nu-disco keepers · Change"; ⋯ opens a **short** sheet (6 rows: Open on YouTube, Grab to another playlist ▸, Edit tags, Flag ▸, Swap audio ▸, Stage ▸) and a separate Mods section for mods. Not a full page.
- **Discover tab:** search, an 8-tile grid of sections (New, Charts, Genres, DJs, Years, Themes, Recent, Fresh), New this month as a 3-column grid, the chart's top 3.
- **You tab:** profile, settings, mentions, community links, install the app, about, privacy, terms, log out (and the Mod tab for mods).
