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

**Order since round 4 (November 12, 2026):** Phase 0, then Phase 2 (Discover), then Phase 4 (phones), then Phase 1's Live steps one at a time, each with the owner's yes. Phase 3 is on hold. Live's look is frozen ([01-ground-rules.md](01-ground-rules.md)).

1. **Phase 0, foundations (no visible change):** design tokens, a screenshot harness, an opt-in switch for the new room layout, tests.
2. **Phase 1, inside today's layout:** every improvement that doesn't move a region: readable text, labelled controls, small pick menus, the one-row crate toolbar, bulk select, playlist import, the "your turn" bar, stage states. Regulars keep their muscle memory.
3. **Phase 2, Discover:** new releases lead Home, an On Air card shows the room, the player gains "Found by" and "Play it in the room", and the sound map shows where the room is. Today's frame and colours; nothing in Live changes.
4. **Phase 3, the new room: on hold.** Round 3's rearranged Live layout isn't being built. Live keeps today's layout and look.
5. **Phase 4, phones:** a bottom tab bar (Home · Discover · Live · Library · You), for visitors at once and for members behind "Try the new room". **Phase 5:** switch the default for members, keep Classic one more season, then retire it.

## Status

Keep this table current as steps ship (one line per step in [04-step-plan.md](04-step-plan.md); mark them there too).

| Phase | Status |
|---|---|
| 0 Foundations | not started |
| 1 Inside today's layout | not started |
| 2 Discover (round 4) | 2.5 shipped (joining, logging in, the account menu and Account tab); 2.1 and 2.3 shipped (the player bar along the bottom, the On Air card, and the right column for Playlists and Chat); 2.3b shipped (the full-screen player, for TVs and second screens, in Discover and Live, replacing the Now playing tab); 2.3c shipped (the player along the bottom of the whole site with the stage's utilities in it, audio that stays put between Discover and Live, modern buttons and sliders, the chat for members only) |
| 3 The new room | on hold |
| 4 Phones | not started |
| 5 Default and clean-up | not started |

Already done before this plan started (November 2026): All Playlists restyled to the room's look (one aligned table with column labels, quiet icon toggles, Find a playlist, select all, a ⋮ menu per list for Rename / Check for broken tracks / Delete, a Create button, and a phone layout), playlist formats (YouTube Music / YouTube videos / SoundCloud, in All Playlists; the bot's swap suggestions are audio tracks for YouTube Music and unset lists, the artist's videos for video lists, none for SoundCloud lists), and the hostbot's swap search looks songs up free first (the room's history, the year playlists, YouTube Music's search, people's playlists on YouTube, YouTube's search), with a paid search capped at `SWAP_API_UNITS` a day only for when the free searches don't answer (`!ytmtest` diagnoses what YouTube answers the bot).
