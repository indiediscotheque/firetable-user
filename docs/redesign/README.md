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

**The mockups:** the design canvas "Indie Discotheque redesign" on claude.ai (round 3 boards, prefixed `R3`), private to the owner. Ask the owner for the link if you need to look at it; everything needed to build is written down here, so the canvas is a reference, not a dependency.

## The shape of it

1. **Phase 0, foundations (no visible change):** design tokens, a screenshot harness, an opt-in switch for the new room layout, tests.
2. **Phase 1, inside today's layout:** every improvement that doesn't move a region: readable text, labelled controls, small pick menus, the one-row crate toolbar, bulk select, playlist import, the "your turn" bar, stage states. Regulars keep their muscle memory.
3. **Phase 2, Discover in the shared frame:** Discover gets the new left column and the one player; visitors use it most and regulars least.
4. **Phase 3, the new room, opt-in:** "Try the new room" in Settings turns on the refined Live layout (same components, regions rearranged). Classic stays the default until the owner says so.
5. **Phase 4, phones,** after checking how many visits come from phones. **Phase 5:** switch the default, keep Classic one more season, then retire it.

## Status

Keep this table current as steps ship (one line per step in [04-step-plan.md](04-step-plan.md); mark them there too).

| Phase | Status |
|---|---|
| 0 Foundations | not started |
| 1 Inside today's layout | not started |
| 2 Discover in the shared frame | not started |
| 3 The new room (opt-in) | not started |
| 4 Phones | not started |
| 5 Default and clean-up | not started |

Already done before this plan started (November 2026): All Playlists restyled to the room's look (one aligned table with column labels, quiet icon toggles, Find a playlist, select all, a ⋮ menu per list for Rename / Check for broken tracks / Delete, a Create button, and a phone layout), playlist formats (YouTube Music / YouTube videos / SoundCloud, in All Playlists; the bot's swap suggestions are audio tracks for YouTube Music and unset lists, the artist's videos for video lists, none for SoundCloud lists), and the hostbot's swap search looks songs up free first (the room's history, the year playlists, YouTube Music's search, people's playlists on YouTube, YouTube's search), with a paid search capped at `SWAP_API_UNITS` a day only for when the free searches don't answer (`!ytmtest` diagnoses what YouTube answers the bot).
