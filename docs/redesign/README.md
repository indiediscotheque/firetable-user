# The redesign, step by step

This folder is the plan for upgrading the Indie Discotheque site's design **one small step at a time, on top of what exists**. It is not a rewrite. Every step leaves the site working, keeps every feature, and can ship on its own.

Read these in order before touching anything:

| File | What it's for |
|---|---|
| [01-ground-rules.md](01-ground-rules.md) | How to work: the constraints of this codebase (no build step, jQuery, fixed element ids, the Content-Security-Policy, the icon font subset, both repos), the per-step routine, how to test and screenshot, and how to roll back. **Read first, every session.** |
| [02-feature-inventory.md](02-feature-inventory.md) | Every feature and function the site has today, where it lives in the code, and where it ends up after the redesign. Nothing may be dropped; tick each one off as the steps reach it. |
| [03-target-design.md](03-target-design.md) | What we're building towards: the decisions from three rounds of mockups and an independent review, the owner's feedback, the design tokens, every screen and menu. |
| [04-step-plan.md](04-step-plan.md) | The steps themselves, in order, grouped into five phases. Each has its goal, the files, what to change, what must not change, how to check it, and how to undo it. |
| [05-checklists.md](05-checklists.md) | Accessibility, performance, security, phone, data and hostbot checks to run on every step, plus the risk register. |

**The mockups:** the design canvas "Indie Discotheque redesign" on claude.ai, private to the owner. Round 4 (its "Round 4" page, boards prefixed `R4`) is current for Discover and phones. Round 3 (`R3`) is still current for the crate tools, the pick menus and import, and is on hold for Live's layout and look. Ask the owner for the link if you need to look at it; everything needed to build is written down here, so the canvas is a reference, not a dependency.

## The shape of it

**No opt-in switch (the owner, November 15, 2026).** There is no "Try the new room" and no Classic to keep: every step ships to everyone when it merges, and undoing one means reverting its pull request.

**Order since round 4 (November 12, 2026):** Phase 0, then Phase 2 (Discover), then Phase 4 (phones), then Phase 1's Live steps one at a time, each with the owner's yes. Phase 3 is on hold. Live's look is frozen ([01-ground-rules.md](01-ground-rules.md)).

1. **Phase 0, foundations (no visible change):** design tokens, a screenshot harness, tests.
2. **Phase 1, inside today's layout:** every improvement that doesn't move a region: readable text, labelled controls, small pick menus, the one-row crate toolbar, bulk select, playlist import, the "your turn" bar, stage states. Regulars keep their muscle memory.
3. **Phase 2, Discover:** new releases lead Home, an On Air card shows the room, the player gains "Found by" and "Play it in the room", and the sound map shows where the room is. Today's frame and colours; nothing in Live changes.
4. **Phase 3, the new room: on hold.** Round 3's rearranged Live layout isn't being built. Live keeps today's layout and look.
5. **Phase 4, phones:** a bottom tab bar (Home · Discover · Live · Library · You), for everyone at once. **Phase 5:** remove the controls the tab bar replaced.

## Status

Keep this table current as steps ship (one line per step in [04-step-plan.md](04-step-plan.md); mark them there too).

| Phase | Status |
|---|---|
| 0 Foundations | done: 0.1 (tokens), 0.2 (the screenshot harness), 0.4 (nothing lost) and 0.6 (accessibility) shipped; 0.3 (the opt-in switch) and 0.5 (icons up front) dropped |
| 1 Inside today's layout | 1.16 shipped (rename, remove duplicates, export, the duplicates filter and a view-only sort, November 19, 2026; the Not played here yet filter waits); 1.15 shipped (the rows: number, Title · Artist, Next / Broken / Remix, and Delete and search for another, November 19, 2026); 1.8 superseded; 1.14 dropped; 1.9 moved to Phase 2; 1.3, 1.5 and 1.10 narrowed by what Phase 2 did (see the step plan's notes) |
| 2 Discover (round 4) | 2.6 shipped (New's Show menu; Charts' controls and actions; tied ranks, 1.9); 2.4 shipped (Home leads with New this week, Not played live yet, the top DJs); 2.5 shipped (joining, logging in, the account menu and Account tab); 2.1 and 2.3 shipped (the player bar along the bottom, the On Air card, and the right column for Playlists and Chat); 2.3b shipped (the full-screen player, for TVs and second screens, in Discover and Live, replacing the Now playing tab); 2.3c shipped (the player along the bottom of the whole site with the stage's utilities in it, audio that stays put between Discover and Live, modern buttons and sliders, the chat for members only) |
| 3 The new room | on hold |
| 4 Phones | not started; 4.6 (the mini player) mostly shipped with 2.3 and 2.3c; 4.0, measure first, added. Live on a phone got Chat first, −m:ss time left and two-tap remove (November 15, 2026) |
| 5 Clean-up | not started (5.1, the default switch, dropped; 5.3, Discover always on, approved and moved up the order) |

Also shipped outside the plan's steps (November 13 to 15, 2026): Play on a speaker or TV (`#st-cast`, ST-08b), tempo pages from a song's BPM tag (DI-28), the "You're not listening live" card on the stage (`#st-notlive`, ST-25), Last.fm scrobbling what each listener hears in Live or Discover, link previews and an offline page (OT-06, PH-02), a lighter first load (Latin font subset, a 42 KB icon font, the emoji data from this site), no jQuery UI (drag rows with touch, a native volume slider), saves that fail say so (OT-07), unit and database-rules tests beside the smoke test, and the live stage for QueUp's screen (`embed/stage/`, OT-08).

## Next, in this order (realigned November 15, 2026)

Phase 2's player work is in, plus a stream of owner requests. What isn't in is the safety net Phase 0 promised: controls now move between the stage, the player bar and the full-screen player, or hide in the DOM behind a menu, and only the smoke test's hand-written checks guard them. So:

1. ~~0.2 Screenshot harness~~ ✅ and ~~0.4 "Nothing lost"~~ ✅ (`tests/reach.mjs`: where every control lives, checked in CI).
2. ~~0.6 Accessibility check~~ ✅ (`tests/a11y.mjs`) and ~~0.1 tokens~~ ✅ (type, space, radius, targets and motion on `:root`; colours stay).
3. ~~2.4 Home leads with new releases~~ ✅ and ~~2.6 New and Charts, with 1.9's tied ranks~~ ✅. New and Charts matter most (the owner, November 15, 2026).
4. **The crate:** ~~finish 1.16~~ ✅ and ~~1.15's rows~~ ✅, **then 1.17 Select several.** The owner started these; each stays in today's skin.
5. **5.3 Discover always on.** Approved; done early because every later step then has one way to work instead of two. Safe once 0.4 guards the controls.
6. **2.8 One song menu everywhere.** The crate row's ⋮ grew in 1.15; Recent's and Discover's menus now lag it.
7. **2.7 Library pages and the sound map.** The trail on the map waits for the hostbot to put the genre on recent plays.
8. **Phase 4, phones**, starting with 4.0 (measure), then 4.1, 4.5, 4.3, 4.4; 4.2 and 4.6 are mostly done.
9. **Phase 1's Live steps**, one at a time with the owner's yes: 1.6 Grab, 1.19 Import, 1.5 Fire's count, 1.11 Your turn, 1.10 states, 1.18 shortcuts, 1.7, 1.12, 1.13, 1.2, 1.3 (the screen glyph only), 1.4. 1.20 waits for the bot's import job, 1.21 for a Spotify key.
10. **Phase 5:** 5.2 after Phase 4 has been live a few weeks.

### Decided (the owner, November 15, 2026)

- **1.18:** Fire is **H**, for "h0t tracks". F stays the full-screen player.
- **1.14:** dropped. The plain playlist select stays: it already shows each list's name and count, opens the phone's own picker, and jumps by typing on a computer; ⋮ has All playlists, New and Import. A custom switcher would add a tap and code for nothing new.
- **1.3:** no "hide the avatars" view. The DJs always stand on the stage; the full-screen player is the view without them. 1.3 is down to a clearer screen icon.
- **Chip rows:** New and Charts come first (2.6). Discover's other rows of buttons (a genre's tabs, the DJs' sort, a DJ's tabs, the decades) stay as they are.
- **5.3:** Discover is always on. The site-without-Discover paths go (moved up to item 5).

Already done before this plan started (November 2026): All Playlists restyled to the room's look (one aligned table with column labels, quiet icon toggles, Find a playlist, select all, a ⋮ menu per list for Rename / Check for broken tracks / Delete, a Create button, and a phone layout), playlist formats (YouTube Music / YouTube videos / SoundCloud, in All Playlists; the bot's swap suggestions are audio tracks for YouTube Music and unset lists, the artist's videos for video lists, none for SoundCloud lists), and the hostbot's swap search looks songs up free first (the room's history, the year playlists, YouTube Music's search, people's playlists on YouTube, YouTube's search), with a paid search capped at `SWAP_API_UNITS` a day only for when the free searches don't answer (`!ytmtest` diagnoses what YouTube answers the bot).
