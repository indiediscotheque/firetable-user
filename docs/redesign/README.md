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
| 1 Inside today's layout | 1.16 shipped (rename, remove duplicates, export, the duplicates filter and a view-only sort, November 19, 2026; Not played here yet, November 23, 2026); 1.17 shipped (Select several: Top, Bottom, Copy to…, Delete with Undo, November 19, 2026); 1.15 shipped (the rows: number, Title · Artist, Next / Broken / Remix, and Delete and search for another, November 19, 2026); 1.1 (today's colours as one palette), 1.2 (the type floor), 1.5 (Fire's count), 1.6 (Grab with Undo), 1.7 (the mod menu), 1.10 (stage states), 1.12 (people and cards), 1.13 (chat and Recent), 1.18 (shortcuts), 1.19 to 1.21 (import: YouTube and SoundCloud, a list of songs, Spotify) shipped, November 20 to 22, 2026; 1.8 superseded; 1.14, 1.3 and 1.11 dropped; 1.9 moved to Phase 2; 1.4 on hold |
| 2 Discover (round 4) | 2.7 shipped (the sound map with the room's, your and tonight's genres, a genre's card under it; library pages: chips, top 10 then Show all, DJ pages, sets by night, Years with covers; each song once in every list); 2.8 shipped (one song menu: the same items, order and words in every ⋮); 2.6 shipped (New's Show menu; Charts' controls and actions; tied ranks, 1.9); 2.4 shipped (Home leads with New this week, Not played live yet, the top DJs); 2.5 shipped (joining, logging in, the account menu and Account tab); 2.1 and 2.3 shipped (the player bar along the bottom, the On Air card, and the right column for Playlists and Chat); 2.3b shipped (the full-screen player, for TVs and second screens, in Discover and Live, replacing the Now playing tab); 2.3c shipped (the player along the bottom of the whole site with the stage's utilities in it, audio that stays put between Discover and Live, modern buttons and sliders, the chat for members only) |
| 3 The new room | on hold |
| 4 Phones | 4.0 skipped and 4.5 covered by the header and account menu while today's tabs stay (the owner, November 20, 2026); 4.3 shipped (56px rows, the rest came with 1.15 to 1.17); 4.6 (the mini player) shipped with 2.3 and 2.3c; 4.1 (the bottom tab bar, November 20, 2026), 4.4 (Grab and the ⋮ menus as sheets, November 21, 2026) and 4.2 (Live on a phone, the bar as YouTube Music's, November 22, 2026) shipped. Phase 4 is done |
| 5 Clean-up | 5.3 shipped (Discover always on, November 20, 2026); 5.2 shipped (the ⌃ and a duplicate rule the phone work left dead, November 23, 2026; the switch, Live's tabs and Discover's pages stay for wider screens); 5.1, the default switch, dropped |

Also shipped outside the plan's steps (November 13 to 15, 2026): Play on a speaker or TV (`#st-cast`, ST-08b), tempo pages from a song's BPM tag (DI-28), the "You're not listening live" card on the stage (`#st-notlive`, ST-25), Last.fm scrobbling what each listener hears in Live or Discover, link previews and an offline page (OT-06, PH-02), a lighter first load (Latin font subset, a 42 KB icon font, the emoji data from this site), no jQuery UI (drag rows with touch, a native volume slider), saves that fail say so (OT-07), unit and database-rules tests beside the smoke test, and the live stage for QueUp's screen (`embed/stage/`, OT-08). And on November 21, 2026, at the owner's request, the Turntable theme: an easter egg skin over Live (TT-01 to TT-08), off unless someone goes in, so Live's frozen look is untouched.

## Next (November 23, 2026)

Everything in the working order set on November 15, 2026 has shipped: the safety net (0.1, 0.2, 0.4, 0.6, 1.1), New and Charts (2.4, 2.6), the crate (1.15 to 1.17, with Not played here yet), Discover always on (5.3), one song menu (2.8), the library pages and the sound map with tonight's rings (2.7), phones (4.1 to 4.6), Phase 1's Live steps the owner said yes to (1.2, 1.5, 1.6, 1.7, 1.10, 1.12, 1.13, 1.18 to 1.21) and the clean-up (5.2). Spotify import is on (the bot has its keys).

Nothing is queued. What's left waits for the owner:
- **1.4 The song facts on stage:** on hold (November 22, 2026); the mockup is described in the step.
- **Phase 3, the new room:** on hold since round 4; the step plan's Phase 3 note says in short what it is and what has already come another way.

New work starts from an owner request, added to the step plan as its own step (or "outside the plan's steps" above) with the inventory rows it touches.

### Decided (the owner, November 15, 2026)

- **1.18:** Fire is **H**, for "h0t tracks". F stays the full-screen player.
- **1.14:** dropped. The plain playlist select stays: it already shows each list's name and count, opens the phone's own picker, and jumps by typing on a computer; ⋮ has All playlists, New and Import. A custom switcher would add a tap and code for nothing new.
- **1.3:** no "hide the avatars" view. The DJs always stand on the stage; the full-screen player is the view without them. 1.3 was down to a clearer screen icon, then dropped (November 22, 2026): the button already cycles synced / always on / off with a glyph for each, and only its placeholder needed fixing.
- **Chip rows:** New and Charts come first (2.6). Discover's other rows of buttons (a genre's tabs, the DJs' sort, a DJ's tabs, the decades) stay as they are.
- **5.3:** Discover is always on. The site-without-Discover paths go (moved up to item 5).

Already done before this plan started (November 2026): All Playlists restyled to the room's look (one aligned table with column labels, quiet icon toggles, Find a playlist, select all, a ⋮ menu per list for Rename / Check for broken tracks / Delete, a Create button, and a phone layout), playlist formats (YouTube Music / YouTube videos / SoundCloud, in All Playlists; the bot's swap suggestions are audio tracks for YouTube Music and unset lists, the artist's videos for video lists, none for SoundCloud lists), and the hostbot's swap search looks songs up free first (the room's history, the year playlists, YouTube Music's search, people's playlists on YouTube, YouTube's search), with a paid search capped at `SWAP_API_UNITS` a day only for when the free searches don't answer (`!ytmtest` diagnoses what YouTube answers the bot).
