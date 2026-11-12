# 05 · Checklists and risks

Run the relevant checklists before every merge. Paste the ticked list into the pull request.

## The ten flows that must always work

Walk these by hand on every step that touches Live, at 1440 and 390 wide, as the role shown:

1. **Visitor:** open the site → Discover Home → play a song → save it to the crate (third save offers to keep it) → Step inside → Listen to the room → join with email.
2. **Member:** log in → the room plays → chat a message with an emoji and an @mention → react to a message → Fire → Grab to a playlist → Undo.
3. **Member:** open Playlists → switch list → filter → find a track on YouTube → add it to the top → drag it to third → preview it → delete it → Undo.
4. **Member:** hop on the decks → your song plays → see Skip and your fires → Take the bus → step down after the song.
5. **Member:** import a playlist (once 1.19 ships) into an existing list at the bottom → Undo.
6. **Member:** a broken track with a swap → ⇄ → Swap → Undo; Swap all.
7. **Member:** All Playlists → rename, reorder, set default ★, DJ from 🎧, set a format, delete two.
8. **Member:** Recent → filter → open on YouTube → Grab from a row; Cards → filter, sort, view larger, gift, feature.
9. **Mod:** skip the song, fix its tags, flag it, remove a DJ, suspend a test user and lift it.
10. **Member:** Settings → every toggle on and off (images, avatars, song lines, typing, badoop, desktop notify, push + test, density × 3, media off, previews over the room, public name, try the new room) → reload → still as set.

## Accessibility

- [ ] Every control is a real `<button>`, `<a href>`, `<input>` or `<select>` (the site's `ftRoleButton` handler exists for legacy `role="button"` elements; don't add more of those).
- [ ] Icon-only buttons have `aria-label` and a tooltip (`.ft-tip` with `aria-describedby`, as the header does).
- [ ] Text contrast at least 4.5:1 (3:1 for 24px and up). Check `--text-4` uses, row numbers, drag handles, zero counts.
- [ ] Nothing under 11px; labels people act on at 12px or more.
- [ ] Targets: 32px in dense desktop rows, 44px on the stage and on phones.
- [ ] Keyboard: Tab order follows the screen; menus open with Enter/Space, move with arrows, close with Escape and return focus to their button; dialogs trap focus (native `<dialog>` does).
- [ ] Popovers and toasts are announced (`role="status"` / `aria-live` as the toast does today).
- [ ] `prefers-reduced-motion`: no new motion without a reduced version.
- [ ] Colour is never the only signal (BROKEN has text, the live dot has a label).

## Performance

- [ ] No new library. If unavoidable: pinned, SRI, CSP updated, lazy-loaded like `lazy.js`.
- [ ] No new database listeners on large paths. Lists read only what they show (the site already counts lists with shallow reads; keep it that way).
- [ ] Lookups for expanded crate details (genre, BPM, room plays) are lazy, batched, cached for the session, and skipped for rows off screen.
- [ ] YouTube Data API quota: 10,000 units a day **shared by every visitor**. A search costs 100 units; a page of playlist items or a videos check, 1. Never add an automatic search. Prefer the bot's YouTube Music search (free) for matching.
- [ ] The stage keeps 60fps with fire, lights and snow on (check in the browser's performance panel on a mid-range laptop).
- [ ] CSS added to `looks.css` / `discover.css` is scoped (`.ft-room-v2`, `#cr-…`, `.st-…`) so it can't restyle unrelated parts.

## Security and the policy

- [ ] No new hosts in scripts, fonts, frames or connections without updating `.htaccess` and passing `check-htaccess-scope.py`.
- [ ] Text from the database or YouTube/SoundCloud goes into the page as text (`.text()`, `textContent`, `firetable.utilities.htmlEscape`, `esc` in `discover.js`), never as HTML.
- [ ] No secrets in the site (keys stay in `api/*-config.php` on the server or in the bot's `.env`).
- [ ] New database paths have rules and rules tests in `firetable-hostbot` before the site writes them.

## Phones

- [ ] 390 × 844 and 360 × 780; landscape (`max-height: 400px`).
- [ ] Safe areas (`env(safe-area-inset-*)`) at the top and the tab bar.
- [ ] The keyboard doesn't cover the chat box or a field being typed in (`keepFocusedFieldVisible`, `viewport.js`).
- [ ] The installed app (Home Screen) and the browser both.
- [ ] Wake lock while on deck still holds.

## Data and the bot

- [ ] The step works with the bot's current `firebase-rules.json`, or the rules change shipped and was published first.
- [ ] Older and newer sites can run side by side (the live site during a review): no path changes shape.
- [ ] Bot-driven features still appear: `tagUpdate` facts, `songBpm`, swaps, notices, fires, cards, theme, lights, screen state, dance.
- [ ] Discover data (`discover/*`, `discover/lib/*`) read only as published; nothing new required from the bot unless the step says so.

## Docs

- [ ] [02-feature-inventory.md](02-feature-inventory.md) rows updated ("Goes to" → what shipped).
- [ ] The step marked in [04-step-plan.md](04-step-plan.md) and the phase status in [README.md](README.md).
- [ ] The project `README.md` describes any changed behaviour.
- [ ] Any new file that shouldn't be served is in both lists in `.github/workflows/deploy.yml` and in `NOT_DEPLOYED` in `.github/scripts/check-htaccess-scope.py`.

## Risk register

| Risk | Where | What reduces it |
|---|---|---|
| Regulars lose muscle memory | Phase 3 | Phase 1 keeps regions; the new room is opt-in; Classic stays a season after the switch |
| Live's look drifts | Any step | Round 4 froze it: no step recolours or restyles the stage, plates, buttons or panels; the screenshot harness (0.2) compares Live before and after every step |
| A control disappears | Any step | Step 0.4's "nothing lost" smoke check; the inventory; the ten flows |
| The stage loses its signature | 1.10, 3.2 | DJs on stage by default; floor; full-height video; screenshots with every avatar family |
| YouTube quota runs out | Import, search | No automatic searches; bot-side YouTube Music matching (free); 1-unit checks |
| YouTube Music's song catalog stops answering the bot | Swaps, import matching | `catalogGate` stops YouTube Music searches and saves nothing for them; the free fallbacks (room history, year playlists, people's playlists on YouTube) carry on; `!ytmtest` |
| CSS growth makes later steps fragile | All | Tokens first; scoped selectors; delete Classic CSS in 5.2 |
| The big files get harder to change (`discover.js` 2,600 lines, `ui.js` 2,200, `playlist.js` 1,900) | Phases 1–3 | Add new code in small new functions or files (e.g. `js/crate.js` for the toolbar and menus), loaded in the right order, linted with their globals |
| Element moves break handlers | 3.3, 3.4, 4.5 | Move nodes, never clone; a comment node marks home (the `chatIn` pattern); smoke checks the handlers after moving |
| Visitors bounce before the room loads | 2.4 | Discover Home renders from published data first; the live card uses art, not a second player |
| Phone work is wasted if few use phones | Phase 4 | Measure first (server logs or ask the room) |
