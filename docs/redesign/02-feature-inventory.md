# 02 · Feature inventory

Every feature and function the site has today (November 2026), where it lives, and where the redesign puts it. **Nothing on this list may be lost.** Each step in [04-step-plan.md](04-step-plan.md) cites the rows it touches by id (`ST-03`, `CR-12`, ...). When a step ships, update the "Goes to" column with what actually shipped.

**Round 4 (November 12, 2026):** Live's look is frozen and Discover goes first. Where a row's "Goes to" names a restyle in Live, [04-step-plan.md](04-step-plan.md) ("Round 4 changes to this phase") says what is left of that step.

Columns:
- **Who:** V visitor (not signed in), M member, D the DJ on deck, Mod mods and supermods, All everyone.
- **Today:** element ids, files and functions. `ui.js` means `js/ui.js`, and so on.
- **Goes to:** the step that changes it (`1.4` is phase 1, step 4), or "keep" (works and looks the same, only restyled by the token steps).

To re-check this list against the code, look for ids in `index.html`, `firetable.actions.*` / `firetable.ui.*` functions, `ftapi.events.on(...)` handlers, and the bot commands in `firetable-hostbot/app.js` (`command == "…"`).

---

## TB · Top bar and header (`#topbar`)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| TB-01 | Room logo `:id:` | All | `#roomlogo` (`img/idlogo2.png`, background image), title "Indie Discotheque" | keep, exactly as is |
| TB-02 | Room theme pill, with "Suggest a theme" | All | `#themePill` / `#themePillText` → `#themePopover` (`#themePopTitle`, `#themePopText`, `#themeSuggest` → `!suggest`) | 1.2 restyle; stays in the header |
| TB-03 | Community links (Facebook, Discord, Reddit, Last.fm, SoundCloud) | All | `#socialTrigger` → `#socialPopover` (`.sociallogo` links from `ftconfigs`) | 1.2 tooltip + label; phone: You tab (4.5) |
| TB-04 | About | All | `#roomInfo` → `about/` (or `ftconfigs.roomInfoUrl`) | 1.2; phone: You tab |
| TB-05 | Mentions inbox (@), unread badge, push hint | M | `#inboxTrigger`, `#inboxBadge` → `#inboxPopover` (`#inboxList`, `#inboxClear`, `#inboxPush*`); `chat.js` `watchInbox`, `renderInbox`, `markInboxRead`; `mentions/<uid>` | 1.2 restyle (a Mentions tab beside Chat went with Phase 3, dropped) |
| TB-06 | Profile and settings | M | `#loggedInUser` (avatar) → `#nav-accountMenu` (Profile, Account and sign-in, Settings, Mod tools, Get the app, Log out) → `#accountSettingsBox` (`firetable.ui.openAccount`) | 2.5 shipped; phone: You tab |
| TB-07 | Reconnecting notice | All | `#reconnecting` (`authReconnected` / `authDisconnected`) | keep, restyle 1.2 |
| TB-08 | Discover / Live switch | All | `#modeTabs` (built by `discover.js` `build()`), `ft-mode` in storage | keep on computers; on phones the bottom tab bar (4.1) |
| TB-09 | Search button (opens Discover search, `/` key) | All | `#dSearchOpen` (`discover.js`), `openSearch()` | keep |
| TB-10 | Light mode (November 24, 2026): the sun and moon in the header, Light mode in the account menu, Settings → Look (Dark, Light, Match this device), the `L` key, `/light` `/dark` `/auto` in chat; kept on the device | All | `#nav-look`, `#nav-acctLook`, `#lookPicker`; `js/head.js` (`ftLook`, `data-look="light"` on `<html>`, `STORAGE.look`); the light palette in `css/looks.css` and `css/discover.css` ("Light mode"). The stage and the full-screen player stay dark; the Turntable theme never turns light | keep |
| TB-11 | The left column folded into a toolbar (November 25, 2026), wide screens: the button by the logo, the `[` key, Settings → Fold the left column into a toolbar; kept on the device. Its icons do all the column does (Discover / Live, the theme, who's here with the count, the people as faces with tooltips, the waitlist and Hop on, Discover's search and views, the header's buttons); who's here or search opens the column over the middle for a moment | All | `#nav-railBtn`, `#nav-railPeople`, `#railToggle`; `js/rail.js` (loaded on first use; `js/lazy.js` stand-in), `css/rail.css`, `js/head.js` (`html.rail` before the first paint), `STORAGE.rail` | keep |

## ST · The stage (`#stage`, `#djStage`)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| ST-01 | The video (YouTube) or artwork (SoundCloud) on the stage screen | All | `#screenBox` > `#screenFrame` > `#playerArea` (YT iframe, `player.js` `onYouTubeIframeAPIReady`), `#scScreen` (SoundCloud art + `glitch.js` p5 effect), `#screenover` | unchanged (3.2's taller stage dropped with Phase 3) |
| ST-02 | **DJs standing on stage in front of the screen** (the room's signature) | All | `#deck` (the playing DJ, spotlight), `#ondeck` (next DJs), `room.js` `tableChanged`, `spotlightStateChanged`, avatar art from `firetable.utilities.avatarURL` | keep exactly (round 4: the stage's look is frozen). The owner, November 15, 2026: on a phone (under 640px, stage under 520px) with the screen up; desktops unchanged,, the DJ stands at the right beside the song and the stage is only as tall as they need (`#stage.dj-side`, `discover.css`); with the screen down it's 16:9 with the DJ in the middle |
| ST-03 | Hop on the decks (empty spot +) | M | spot "+" in `#ondeck` (`tableChanged`), `!addme` (`firetable.actions.hopOn`) | 1.10 clearer empty spot; 1.11 not in the bar (the owner, November 22, 2026: the open spot already does it); the open spot's button and the waitlist card's read **Hop on** (they read "Play", which means playing a song everywhere else; November 22, 2026) |
| ST-04 | DJ play counter / play limit on the name tag | All | `tableChanged`, `playLimitChanged` (`playlimit`) | keep; restyle 1.10 |
| ST-05 | Screen control: synced, always on, off | All | `#screenControl` (one button cycling `live_tv` / `tv` / `tv_off`), `#screenControlTip`, `ui.js` `updateScreenBtn` / `applyScreenSetting`, `STORAGE.screenControl`; room-wide `thescreen` (`!screen`, `!screenup`, `!screendown`) | ✅ 2.3c: with Discover on, `#screenControl` lives in the player bar (Live) and in the full-screen player, whose screen off / on is this same setting |
| ST-06 | Volume slider and mute | All | `#volplace` > `#slider`, `#volstatus`, `player.js` `initVolume`, `muteToggle`, `STORAGE.volume`, `STORAGE.mute` | ✅ 2.3c: with Discover on, the bar's volume and mute (`#pv-vol`, `.d-mute`, `setVolume` keeps `#slider` in step); the stage's `#volplace` / `#volstatus` stay in the hidden `#stageTopRight` |
| ST-07 | Reload audio | All | `#reloadtrack`, `player.js` `reloadtrack` | ✅ 2.3c: `#reloadtrack` in the player bar while it plays the room. The bar's tools keep one order, screen · reload · cast · volume · full screen, whatever state they come back from (`placeStage` puts all four in again, in order; November 22, 2026). Since November 24, 2026 a Discover song's own reload (`.d-reload`, `#pv-dtools`) sits in the same place, not beside next, and the volume and full screen never move (`#pv-tools`, `#pv-cast`, `#pv-fs`) |
| ST-08 | Full screen | All | `#fullscreenBtn` (hidden where unsupported) | ✅ 2.3c: with Discover on, `#fullscreenBtn` is in the player bar and opens the full-screen player (`#pv-full`, DI-27), which has the video and fills the screen itself; the stage's own full screen (#155) went with 5.3, Discover always on |
| ST-08b | Play on a speaker or TV (cast guide) | All | `#st-cast`, `#tip-st-cast`, `#st-castBox`, `cast.js` (`firetable.cast`) | ✅ added November 15, 2026: on the stage without Discover; with Discover in the player bar and, while it's open, the full-screen player's top tools (phones' way to it). Opens a guide to Google Cast (Chrome or Edge, Cast tab), AirPlay, Android's Google Home "Cast my audio" and Bluetooth, this device's way first and open. The songs play in YouTube's and SoundCloud's own players, so no web API can hand them to a speaker directly |
| ST-09 | Fire (🔥) | M | `#fire` → chat reaction `:fire:`; `chat.js` `sendReaction`, `processFireReactionMessage`, fire effect `fire.js` + `flame.js` (plain canvas), `!hot` | ✅ 2.3c: in the player bar with Discover on; 1.5 shows the count there |
| ST-10 | Rain (🌧) reaction | M | `#cloud_with_rain` state, `:cloud_with_rain:`, `!storm` | keep wherever it is reachable today; 1.5 keep the state |
| ST-11 | Grab (add the playing song to a playlist) | M | `#grab` → `#stealContain` / `#stealpicker` (`openStealPicker`, `fillStealPicker`), `recordGrab` (`grabs/<djid>`), `savedToast` with Undo | ✅ 2.3c: in the player bar with Discover on; 1.6 split button there: tap = last used playlist (Undo), ▾ = picker; 4.2: on phones the ▾ is in the full-screen player |
| ST-12 | Song link (open on YouTube or SoundCloud) | All | `#songlink` | ✅ 2.3c: in the player bar with Discover on |
| ST-13 | Skip your own track | D | `#skipTrigger` → `#skipPopover` (`.skipNowAction` → `!skip`) | keep: shows only on your song (in the player bar with Discover on, 2.3c) |
| ST-14 | Mod tools on the playing song: Skip, Fix tags, Flag ▸ | Mod | `#npModBtn` → `#npModMenu` (`#npSkip`, `#npFixTags` → `#tagEditorPopover`, `#npFlag` → `#flagMenuPopover`) | `#npModBtn` in the player bar with Discover on (2.3c); ✅ 1.7 plus Remove [DJ] from the decks (`#npRemoveDj`) and Add someone to the decks (`#npAddDj` → `#npAddDjMenu`) |
| ST-15 | "Tap to start audio" | All | `#tapToPlay` (autoplay blocked) | the bar says **On air** while the browser holds audio back (`body.media-blocked`, 2.3); 1.10 the overlay's words and one line of context. Since November 22, 2026 (the owner): one line, "Listen to the room", in the stage's lower left under the song, clear of the DJ; the line under it (who's playing what, how many are here) is gone, since the stage and the bar say it; `#tapToPlaySub` stays in the page, empty |
| ST-16 | String lights (December, or `!lights`) | All | `ul.lightrope`, `room.js` `lightsChanged`, `applyLights`, `seasons.js` `LIGHTS_MONTHS` | keep exactly |
| ST-17 | Snow (Jan, Feb) | All | `snow.js`, `SNOW_MONTHS` | keep exactly |
| ST-18 | Fire embers effect | All | `#fyre`, `fire.js` + `flame.js` (plain canvas, no libraries; sized to the DJ by `room.js`) | keep exactly |
| ST-19 | Dance mode | All | `danceStateChanged` (`dance`), `!dance` | keep |
| ST-20 | Beat-synced bobbing (BPM) | All | `room.js` `applyBeat` (`--beat`, `--bop`, `--beat-phase`), `songBpm`, `bpm/` | keep |
| ST-21 | Seasonal avatars (monsters in October, etc.) | All | `seasons.js` `AVATAR_SEASONS`, `ftconfigs.avatarset` | keep; check every stage state with non-robot sets (`tests/avatars.mjs`) |
| ST-22 | Theme colours (room accent per night) | All | `colorsChanged` (`colors`) sets `--color-accent` | keep; all new accent uses go through the variable |
| ST-23 | Stage backdrop with the `:id:` logo (when nothing plays) | All | `#stageBackdrop` | 1.10 the "decks are open" empty state |
| ST-24 | User card on a DJ's avatar (Take the bus, Step down, Add to / Remove from deck, Block); the name plate's own remove / step down takes two taps ("Tap to remove", November 15, 2026) | All / Mod | `#ft-user-tip` (`ui.js` user tip), `utt-*` buttons, `departure_board` | keep; 1.11 not repeated in the bar (the owner, November 22, 2026); the card's buttons go through `firetable.actions` |
| ST-25 | (new) "You're not listening live": a card in the stage's lower left while a Discover song plays in Live or the room is stopped, with Listen live | All | `#st-notlive`, `discover.js` `renderNotLive` | ✅ added November 13, 2026; keeps clear of the DJs, shrinks on a small stage |

## NP · Now playing facts

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| NP-01 | Title and artist (artist links to Discover) | All | `#track`, `#artist`, `newSong` | keep (1.4 dropped); stays top-left of the stage |
| NP-02 | Plays here · all versions | All | `#playStats` > `#playCount` (`tagUpdate`) | keep (1.4 dropped) |
| NP-03 | First played … by …, last played … by … | All | `#firstPlay`, `#lastPlay` | keep (1.4 dropped) |
| NP-04 | Tempo (BPM) | All | `#npBpm` | keep (1.4 dropped) |
| NP-05 | Album art thumbnail | All | `#albumArt` | keep (used on narrow layouts) |
| NP-06 | Progress bar | All | `#prgbar` > `#prgbarbar` | keep (1.8 superseded; the stage's bottom edge only if the owner asks) |
| NP-07 | Time: elapsed (`#timrUp`) and remaining (`#timr`, shown as −m:ss since November 15, 2026) | All | `room.js` `newSong` countdown | ✗ 1.8 superseded: −m:ss time left with "Time played" / "Time left" tooltips (November 15, 2026); the player bar leaves time out on the room's song |
| NP-08 | Song sheet (cover, links, tempo, source, plays, firsts, versions, Play, Save, Open, Copy link) from any title | All | `discover.js` `openSheet` (`.d-sheetlink`), `firetable.discover.songSheet` | keep; reachable from the stage title (1.4), and since 2.8 from "About this song" in a playlist row's ⋮ and Recent's ⋮ |

## DJ · Decks, waitlist, your turn

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| DJ-01 | Which playlist you DJ from | M | `#djlistpicker` in `#themebox` / `#djlistpickerWrap` ("You DJ from"), `#djlistOpen` (open it in Playlists), `ftapi.actions.switchDjList`, `users/<uid>/selectedList` | keep; labelled "You DJ from" (1.11, the rest of it dropped); out of sight while signed out (November 22, 2026: visitors were offered "You DJ from Default Playlist"). Since November 22, 2026 it reads as a status under the stage (headphones, "You DJ from", the name; the same select without its box, as wide as the name), and the crate's picker shows `#cr-djTag` "DJ list" while it shows that list, so the two pickers no longer look alike |
| DJ-02 | Your next tracks on deck | D | `#deckQueue` (empty); the DJ playlist's first song is marked Next in Playlists | 1.11 dropped (the owner, November 22, 2026): the playlist shows what's next |
| DJ-03 | Waitlist (with 4+ DJs) | All | `#usersWaitlist`, `waitlistChanged`, `room.js`, `!wait` | keep in the people column; 1.10 also a chip on the stage Since November 24, 2026, with nobody waiting the card is one line: the note and **Hop on**, which only someone who can hop on sees (a DJ on the decks had a greyed-out one); with four DJs the note says the decks are full |
| DJ-04 | Take the bus (step down after next play) | D | user card `utt-bus-btn`, `deckDepartureBtn`, `firetable.actions.toggleBus`, `!removeafter` / `!dontremoveme` (`!gottacatchmybus`) | keep; 1.11 not repeated in the bar (the owner, November 22, 2026) |
| DJ-05 | Step down | D | user card `utt-stepdown-btn`, the plate's own (two taps), `firetable.actions.stepDown`, `!removeme` | keep; 1.11 not repeated in the bar (the owner, November 22, 2026) |
| DJ-06 | Add / remove someone (mods) | Mod | user card `utt-deck-btn`, `utt-remove-deck-btn`, `#npRemoveDj`, `#npAddDj` / `#npAddDjMenu`, `firetable.actions.addDj` / `removeDj`, `!add`, `!remove` | keep; ✅ 1.7 also in the stage's mod menu |
| DJ-07 | Autopilot DJ (the bot plays when the decks are empty) | All | bot (`!autodj`, `!upbot`, `!downbot`) | keep; 1.10 the empty-decks state says the bot can step in |
| DJ-08 | Away DJs keep their seat for a while | All | bot ("away DJs") | keep |

## PE · People

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| PE-01 | People list with roles (bot, supermod, mod, member), DJs first | All | `#usersbox`, `#usersStats` (`#numListeners`, `#numRoomListeners`, `#numStreamListeners`), `#allUsers` > `#usersDJs`, `#usersBot`, `#usersSuper`, `#usersMod`, `#usersRegular`; `usersChanged`, `userJoined`, `userLeft`, `userChanged` | 1.12 role legend and readable size; stays left at 1024+, a tab on tablets and phones. Since November 22, 2026 only the bot, mods and supermods have a role icon (after the name, so names line up); a member's row has none Since November 24, 2026 the list is `js/people.js`: the DJs lead in deck order under **On the decks** (`#pe-djHead`, `#usersDJs`: who's playing, who's next, each one's plays this turn, who steps down after their next play), everyone else follows by name under **On the floor** (`#pe-floorHead`; the headings only while there are DJs), your own row says "you", and whoever fired the song that's on has a flame until the next one (`firesChanged`) |
| PE-02 | Radio listeners count | All | `#numStreamListeners` | keep. ✅ live since November 23, 2026: `#usersStats` shows everyone with the room (`#numListeners`), then members in it, guests (`#pe-numGuests`) and radio listeners, each named for screen readers (`js/audience.js`, `api/audience.php`) Since November 24, 2026 a count of none is left out, and the counts are in the heading's own type (they were Roboto Mono); the total has an icon too (a crowd, in place of the word "People", which stays for screen readers) |
| PE-02b | Who's listening elsewhere: the radio stream's listeners merged by country (flags, "Somewhere" for those it can't place) and guests on the site without an account, by country from their time zones (how many hear the room live) | All | `#pe-audience` under the members, the visitor's list `#pe-here`, the room pulse ("N on the radio"), the Turntable theme's People; `js/audience.js`, `api/audience.php` (heartbeats from guests, Broadcast Pal's `api/listeners.php` for the stream) | ✅ added November 23, 2026; keep (smoke checks it) Since November 24, 2026 a group with nobody in it is left out (no "No guests right now.") |
| PE-03 | User card (profile, DJ page link, cards they hold, block, deck controls) | All | `#ft-user-tip`, `ui.js` | keep |
| PE-04 | Block / unblock | M | user card `utt-block-btn`, `/block`, `/unblock`, `blocks/` | keep |
| PE-05 | Idle state | All | `js/state.js` (idleTracker), `users/<uid>/idle` | keep. In the people list the name greys and the role icon turns orange; a DJ who dropped off also says "away" at the row's end (an "idle" word there, added November 22, 2026, came out November 23 as redundant) Since November 24, 2026 presence is a dot on every face (green here, orange away), members' too; the role icon no longer changes colour, and from five minutes on an idle row says for how long ("47m", "3h", from `idle.since`) |

## CH · Chat

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| CH-01 | Chat messages, grouped by sender | M (visitors no longer read it, CH-19) | `#actualChat` > `#chatsWrap` > `#chats`, template `#chatKEY`, `chat.js` `setupChatEvents`, `chatFeed` / `chatData` | keep; 1.13 type and spacing Since November 25, 2026 (`js/chat-lines.js`): a heading where the day changes ("Yesterday", "Today", "Monday, Nov 23"; `.ch-day`), times in the chat's own type (they were Roboto Mono), and the role icon after a name is the people list's (filled) |
| CH-02 | Song announcements (the bot's "started playing …") | All | bot messages; Settings `#showSongAnnouncementsToggle` (`applySongAnnouncementVisibility`) | 1.13 one slim line each, setting kept |
| CH-03 | Images in chat | All | `#showImagesToggle`, `firetable.ui.showImages` | keep |
| CH-04 | Avatars in chat | All | `#showAvatarsToggle` | keep |
| CH-05 | Links made clickable | All | `linkify`, `textToLinks` | keep |
| CH-06 | Emoji picker | M | `#pickEmoji`, `#emojiPicker` (`#pickerNav`, `#pickerSearch`, `#pickerResults`), `emoji.js` (`js/emoji-picker.json`, loaded on first open) | keep |
| CH-07 | `:shortname:` emoji | M | `emoji.js` | keep |
| CH-08 | @mention picker | M | `#atPicker`, keyboard nav in `chat.js` | keep |
| CH-09 | Reactions on messages | M | `#reactPickerPopover`, `chatData/<id>/reactions/<emoji>/<uid>`, `toggleReaction`, `renderReactions` | keep |
| CH-10 | Typing indicator (and sharing yours) | M | `#typingIndicator`, `renderTyping`, `typing/`, Settings `#shareTypingToggle` | keep |
| CH-11 | "New messages" jump | All | `#morechats` | keep |
| CH-12 | Slash commands: /block, /unblock, /hot, /storm, /shrug, /tableflip, /unflip | M | `chat.js` (switch near "tableflip") | keep; 1.18 listed in the keyboard help |
| CH-13 | Bot commands typed in chat (`!plays`, `!firstplay`, `!bpm`, `!suggest`, `!link`, `!theme`, `!grab`, …) | All | the bot | keep; 1.18 help lists the common ones Since November 25, 2026 a command typed in chat ("!skip") is set as quietly as the bot's lines (`.ch-cmd`), and the bot's line that someone fired the song has the people list's flame before it (`.ch-fire`); the names the bot quotes in backticks keep their colour, in the chat's own type |
| CH-14 | Mod delete of a message | Mod | delete button on messages | keep |
| CH-15 | Badoop sound on @mention | M | `#badoopToggle`, `sound.mp3` | keep |
| CH-16 | Desktop notification on @mention | M | `#desktopNotifyMentionsToggle` | keep |
| CH-17 | Cards shared or gifted in chat, with a Grab button | M | `chat.js` `addGrabButton`, `claimGrab`, `watchGrab`, `.chat-grab-btn` | keep |
| CH-18 | Private notices from the bot (your track can't play, swaps ready, "are you there?") | M | `notices/<uid>`, `watchNotices`, `showNextNotice` (toast) | keep |
| CH-19 | Chat peek for visitors (read-only, Discover) | V | `discover/chat`, `#chatPeek` | ❌ retired in 2.3c (the owner's call, November 13, 2026: the chat is for members only); `#chatPeek` stays in the page, hidden |
| CH-20 | `:emoji` suggestions while typing (a colon and two letters lists matching emoji by name and search word; arrows, Tab/Enter, Esc, click) | M | `#ch-emojiSuggest`, `#ch-emojiSuggestList`, `emoji.js` `suggest` / `typedShortname`, `chat.js` | new (November 22, 2026) |

## CR · Playlists, the crate (`#queuebox`)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| CR-01 | View / edit a playlist (switch which one shows) | M | `#listpicker` (`#listpickerWrap`), `switchViewList`, `STORAGE`'d per uid | keep: the select stays (1.14 dropped, the owner, November 15, 2026). Was: 1.14 a one-row switcher button (★, name, count, broken) opening a searchable menu; the select stays in the DOM for the code |
| CR-02 | Playlist rows: art, Artist - Title, preview | M | `#mainqueue`, `queueBlockHTML`, `$playlistItemTemplate` | ✅ 1.15 (November 19, 2026): the place in the play order, **Title** · Artist in two tones (the stored "Artist - Title" unchanged), tags Next / Broken / Remix, length; same template, ids and data attributes |
| CR-03 | Row actions: top, bottom, YouTube, add to another playlist, delete | M | row buttons; `bumpSongInQueue`, move-to-bottom, `openStealPicker`, `deleteSongPrompt` (`#deleteSongPopover`) | ✅ 1.15: all visible on a computer, as before; rows under 28rem keep Top and ⋮ (⋮ has the rest) and drop the number, length and Remix |
| CR-04 | Track ⋮ menu: Swap for YouTube Music audio…, Send to bottom, Add to playlist, Open, Delete | M | `#trackMenuPopover` (`data-act`: swap, bottom, add, open, delete) | 1.15 plus Edit tags, Swap artist and title, Delete and search. ✅ 1.15 in part (November 15, 2026): Edit tags… (`tags`) and Swap artist and title (`swaptags`) added; ⋮ shows on every playlist row at every width ✅ 1.15 done (November 19, 2026): Delete and search for another (`delsearch`). |
| CR-05 | Drag to reorder | M | `firetable.utilities.dragSort` on `#mainqueue` (mouse, touch hold, Alt+arrows), `updateQueue` | keep |
| CR-06 | 30-second preview | M | `player.js` `pview`, Settings `#previewOverToggle` (plays over the room) | keep |
| CR-07 | Filter the playlist; Remixes only; Broken only | M | `#filterMachine` > `#queueFilterForm` > `#queueFilter`, `#queueFilterExtras` (`#queueFilterRemixOnly`, `#queueFilterBrokenOnly`, `#cr-dupesOnly`, `#cr-unplayedOnly`), `filterQueue` | 1.16 filter box + one "Show only" menu (tune icon) with Remixes, Broken, Not played here, Duplicates. ✅ 1.16 (November 15, 2026): the filter box and **Show only** (`#cr-showOnly` → `#cr-showOnlyMenu`, holding the same `#queueFilterExtras` checkboxes) with a red count badge (`#cr-showOnlyCount`). Since November 22, 2026 Show only, Sort and Select each have their own glyph (`tune`, `swap_vert`, `checklist`; they were three sets of stacked lines) and, from 1200px, their names beside them (`.cr-toolLabel`). ✅ Not played here yet (`#cr-unplayedOnly`, `checkPlayedHere`, November 23, 2026): the play history asked once a session per song, with a bar counting the check (`#cr-unplayedBar`, **Show all**) |
| CR-08 | Find tracks (YouTube / SoundCloud search, links) | M | `#addToQueueBttn` (+) → `#searchMachine` (`#qsearch`, `#searchSelects` `#ytsearchSelect` `#scsearchSelect`), `#searchResults`, `search.js` `ytAPI('search')` (100 quota units) | keep as a + in a circle; 1.17 results list restyle; format-aware source (done); YouTube results ranked for the target list (official artist videos first; audio tracks first for YouTube Music lists) and marked `.search-kind` (done) |
| CR-09 | Add from a pasted or dropped link | M | `ui.js` `LinkGrabber`, `queueFromLink`, `normalizeQueueLink` | keep; 1.17 a hint in Find tracks |
| CR-10 | Shuffle | M | `#shuffleQueue` → `#shuffleQueuePopover`, `shuffleQueue` | 1.16 in the playlist ⋮ menu (button kept on desktop). ✅ 1.16: Shuffle this playlist in the ⋮ menu (`#cr-listMenu`); the `#shuffleQueue` button stays on computers (1024 and up) |
| CR-11 | Merge playlists | M | `#mergeLists` → `#mergeContain` (`#mergepicker`, `#mergepicker2`, `#startMerge`, `#mergeHappening`, `#mergeCompleted`), `mergeLists` | 1.16 in the playlist ⋮ menu. ✅ 1.16: Merge playlists… in the ⋮ menu (`toggleMerge`, the arrow points at ⋮) |
| CR-12 | New playlist / Import playlist | M | `#plAddLauncher` → `#plAddPopover` (`#plAddCreate` → `#plmaker`; `#plAddImport` → `#importPromptBox`) | 1.14 in the switcher; import becomes 1.19. ✅ 1.16: New playlist and Import a playlist… in the ⋮ menu (`enterCreateMode`, `#importPromptBox`); while naming, `#plAddLauncher` is Cancel (`#queueControls.cr-creating`) |
| CR-13 | Delete playlist (type the name) | M | `#plDeleteLauncher` → `#deletePromptBox` (`#deleteConfirmInput`, `#pldeleteButton`) | 1.16 in the playlist ⋮ menu. ✅ 1.16: Delete this playlist… in the ⋮ menu (`#plDeleteLauncher`'s flow; off for the built-in list) |
| CR-14 | All Playlists overview: rename, reorder (drag, Alt+arrows), default ★, DJ from 🎧, check broken, open, delete one or several, new, find a list by name | M | `#plIndexBtn` → `#plIndexBox` (`playlists.js`): one aligned table with column labels, `#cr-plFilter`, `#cr-plSelectAll`, a row's ⋮ menu `#cr-plRowMenu` (Rename, Check for broken tracks, Delete), `#cr-plCreate` (Nov 2026) | 1.14 "Manage playlists…" in the switcher. ✅ 1.16: All playlists… in the ⋮ menu (`openPlaylistIndex`) |
| CR-15 | **What a list is kept to** (YouTube Music / YouTube videos / SoundCloud) | M | `.plx-format` in All Playlists, `playlistPrefs/<uid>/format`, `formatRefusal`, `matchSearchSource` (Nov 2026) | 1.14 also shown in the switcher menu |
| CR-16 | Track counts and broken counts per list (in every picker) | M | `listLabel`, `setListCount`, `loadListCounts`, `STORAGE.listCounts` | keep; shown in the switcher |
| CR-17 | Broken track check (YouTube / SoundCloud status), auto-check | M | `checkBrokenTracks`, `autoCheckBroken`, `setupBrokenCheck`, `STORAGE.brokenCheck`; All Playlists' row ⋮ menu (`#cr-plRowMenu`, Check for broken tracks) | 1.16 "Check for broken songs" in the playlist ⋮ menu. ✅ 1.16: Check for broken tracks in the ⋮ menu (`checkBrokenTracks`, the result in a toast) |
| CR-18 | Flags on tracks (broken, low quality, off theme), shown on rows | M / Mod | `flagged {date, code}`; `#flagMenuPopover`; bot `!flag`, `!flagplay` | keep |
| CR-19 | Swap suggestions (⇄ on a track, Swap, Preview, Open, Not this one) | M | `#swapPopover` (`#swapHead`), `swapPrompt`, `swapOne`, `activeSwap` | keep |
| CR-20 | Swap all / Show them bar | M | `#swapBar` (`#swapShowBtn`, `#swapAllBtn`), `renderSwapBar`, `swapAll` | keep, restyle 1.16 |
| CR-21 | Remove duplicates | M | `removeDupesFromQueue`, `removeDuplicatesFromList` | ✅ 1.16 (November 19, 2026): Remove duplicates in the playlist ⋮ menu, with how many went; Show only: Duplicates (`#cr-dupesOnly`) shows them first |
| CR-22 | Delete and search for another | M | `deleteSongAndSearch` | ✅ 1.15 (November 19, 2026): the row ⋮ (`data-act="delsearch"`) |
| CR-23 | Edit tags (Artist - Title) | M | `editTagsPrompt`, `#tagEditorPopover` (`#tagMachine`), `tagLog` | 1.15 row ⋮. ✅ 1.15 in part (November 15, 2026): a playlist track's tags before it's played, from its ⋮ (`renameQueueTrack` → `ftapi.actions.renameTrack`, with Undo); the hostbot plays it under that name and its first play saves those tags. ✅ (November 20, 2026): Title Case button (`.tagCase`, `firetable.utilities.apTitleCase`, AP style) beside Swap. ✅ (November 20, 2026): a fix goes on every copy of the old tags and a respelled artist on all their songs (tag log `fa`/`ft`; the hostbot's `lib/retag.js` spreads it and sends the mod a notice). ✅ (November 22, 2026): mods fix any song's tags from Discover's ⋮ (`firetable.tagEditTarget`; the room's own song through `!fixtags`); Discover's rows on screen take the fix at once, the hostbot puts it on the published charts and lists, and a song tagged before anyone played it keeps those tags for its first play |
| CR-24 | Undo after add / move / swap | M | `savedToast`, toast actions | keep; Select several's Delete adds one (1.17) |
| CR-25 | The built-in list ("Default Playlist", renamable) | M | `queues/<uid>`, `defaultListName`, `playlistPrefs/<uid>/defaultName` | keep; any list, the built-in one too, is renamed from the playlist ⋮ menu (`#cr-renameBox`, 1.16) or in All Playlists |
| CR-26 | Discover's "Save all" into a new playlist | M | `discover.js` `saveAll` | keep; also a source in Import (1.19) |
| CR-27 | Saved marks (this song is in your playlists) | M | `firetable.saved`, `markSaved` | keep |
| CR-28 | (new) Export a playlist as a list of songs ("Artist - Title" lines, a .txt) | M | `firetable.actions.exportList`, the playlist ⋮ menu | ✅ 1.16 (November 19, 2026) |
| CR-29 | (new) Sort a playlist by artist or title, view only | M | `#cr-sort`, `#cr-sortMenu`, `#cr-sortBar`, `firetable.actions.sortedQueueKeys` | ✅ 1.16 (November 19, 2026): the play order never changes; dragging is off while sorted; Back to your order |
| CR-30 | (new) Select several: tick songs (Shift for a run, or all shown), then Top, Bottom, Copy to…, Delete | M | `#cr-select`, `#cr-bulk`, `ftapi.actions.moveTracks` / `removeTracks` / `restoreTracks` / `addTracksToTop` | ✅ 1.17 (November 19, 2026): one step each; Top and Bottom keep their order; Delete asks once and has Undo |

## IM · Import

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| IM-01 | Import a YouTube playlist (search by name or paste a link) into a new playlist | M | `#importPromptBox` ("Playlist Import Machine"), `#importSources` (`#ytimportchoice`), `#plMachine`, `#importResults`, `search.js`, `playlist.js` `importList` | ✅ 1.19 step 1: link or name, results with song counts, `js/import.js` |
| IM-02 | Import a SoundCloud set | M | `#scimportchoice`, `scPlaylist` | ✅ 1.19 |
| IM-03 | (new) Preview what's inside, choose new or existing playlist, top or bottom, skip what you have, see what's missing | M | `#im-step2` | ✅ 1.19 step 2 (`firetable.importer.show`, Undo in the toast) |
| IM-04 | A list of songs or a CSV | M | `#listimportchoice`, `#im-listPane` (`#im-listText`, `#im-listFile`, `#im-listFind`), `firetable.importer.parseLine` / `parseCsv` / `showList`, `importJobs/<uid>` answered by the bot (firetable-hostbot `lib/imports.js`) | ✅ 1.20 |
| IM-05 | A Spotify playlist | M | `#spimportchoice` (shown while `discover/caps/spotify`), `#im-spPane` (`#im-spLink`, `#im-spFind`), `firetable.importer.parseSpotify` / `showSpotify`; `importJobs/<uid>` with `spotify: <id>`, read by the bot (firetable-hostbot `lib/spotify.js`, `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`) | ✅ 1.21 |
| IM-06 | (new) Paste a playlist link in any search box | M | today: "That's a SoundCloud playlist. Use Import…" | ✅ 1.19 `firetable.ui.offerImport` in Find tracks; `.d-importOffer` in Discover search |

## RE · Recent, Fresh, Cards (the tabs under the stage)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| RE-01 | Recent plays, grouped by day and hour, with DJ avatars | All | `#thehistoryWrap` > `#thehistory`, `newHistory`, `songHistory`, `HISTORY_PAGE_SIZE`, "Show older plays" | keep; 1.13 type |
| RE-02 | Filter Recent | All | `#histFilterBar` > `#histFilter` | keep |
| RE-03 | Recent row actions: YouTube, Grab, Edit (mods), Flag (mods), ⋮ | All / Mod | `#histMenuPopover` (open, tags, flag) | keep; edit and flag for mods only (as today) |
| RE-04 | Fresh (new to the room), with join prompt for visitors | All | `#discover` (the Live tab "Fresh"), `#freshIntro`, `#minijoin`, `#thediscovers`, `newProduce` | keep. Since November 22, 2026 it downloads the first time it's on screen (`room.js`, an IntersectionObserver on `#discover`), not only when its tab is chosen: beside the welcome at 640px and up, visitors have no Fresh tab and it showed loading rows for good. With nothing new it says so |
| RE-05 | Card case: stats (total, unique DJs, lowest and highest temp), cards per DJ, search, filter by DJ, sort | M | `#cardsWrap` > `#cardsMain`, `cards.js` (`#cardFilterRow`, `#cardFilterText`, `#cardFilterDj`, `#cardSortBy`) | 1.12 explain "temp". Since November 22, 2026 the cards come first: search and the two menus on one row, and the numbers (the tiles, what temp means, Cards per DJ) folded under **Stats: N cards from M DJs** (`.cardStatsMore`) |
| RE-06 | Card actions: share in chat, gift to the DJ, view larger, feature on your DJ page | M | `.cardShareChat`, `.cardGiftChat` (`#giftCardPopover`), `.cardViewLarger` (`#cardViewLargerModal`, `#cardPrev`, `#cardNext`), `.cardFeature` | keep |
| RE-07 | Print a card / gift card (bot) | All | `!printcard`, `!giftcard` | keep |

## NV · Navigation between panels

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| NV-01 | Phone tabs: Chat (first, and the default until you pick another, since November 15, 2026), Playlists, Recent, Fresh, Cards, People | All | `#minimodeoptions` (`#mm-playlists`, `#mm-history`, `#mm-discover`, `#mm-cards`, `#mmchat`, `#mmusrs`), `STORAGE.navMobile` | 4.1 bottom tab bar Home · Discover · Live · Library · You; Live keeps Chat · Recent · People · Cards ✅ 4.1: `#nav-tabs` under 640px (`discover.js` `goTab`/`renderTabs`); Live keeps Chat · Recent · Fresh · Cards · People; Playlists is Library. Since November 22, 2026 a member's stage (and the bar under it) stays with Chat on a phone: on Recent, Fresh, Cards and People it plays on out of sight, as it does behind Library, so those lists get the 245px it held; the player bar names the song on every tab. A visitor's Live keeps its stage |
| NV-02 | Tablet side tabs: Chat, People | All | `#sidepanel-tabs` (`#sp-chat`, `#sp-people`), `STORAGE.navSide` | keep |
| NV-03 | View under the stage (Playlists, Recent, Fresh, Cards) | All | `firetable.ui.showView`, `syncNavState`, `STORAGE.navView`, `#mainGrid.view-*` | keep |
| NV-04 | Addresses (`#live`, `#discover/...`) and back button | All | `discover.js` `route`, `writeAddress` | keep; 2.2 adds nothing new |
| NV-05 | (new) Skip links: the first Tab stops, out of sight until one has focus. Skip to the page (Discover), the chat box, your playlist, the player; each offered only while what it goes to is on screen. Tab starts from the top on Discover Home too, whose address `#discover` is also the Fresh panel's id | All | `#nav-skip`, `firetable.ui.setupSkipLinks` (`ui.js`) | ✅ added November 22, 2026 (the UX audit, H1); keep |
| NV-06 | (new, November 22, 2026) One Tab stop per song in Discover's page: the play button, which names its song ("Play Riviera by Kartell"). ← and → reach the song's title, artist, ⋮, Add and DJ; the menu key (or Shift F10) opens ⋮; Tab goes on to the next song. The lead card's "Play the week's N" and "Save all" keep their own stops. Mouse, touch and screen readers' own keys are unchanged | All | `discover.js` `rove`, `roveKey`, `playLabel`; listed in `#helpBox` | keep |

## AU · Joining, logging in, account

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| AU-01 | Welcome and room pulse for visitors | V | `#login` > `#welcomeInfo`, `#roomPulse` (`renderRoomPulse`) | 2.4; ✅ 4.1b ends with the same Join buttons as Discover, which open `#joinBox`. Since November 22, 2026, at 1024px and up the left column of a visitor's Live lists who is in the room (`#pe-here`, `renderRoomPeople`: DJs first, names only, nothing to press) and the line of faces steps aside |
| AU-02 | Create account (email, username, password, terms) | V | `#createscreen`, `#createAccountFormShell`, only in `#joinBox` (`openAuth`) | 2.5 shipped; ✅ 4.1b one form, in the dialog only; since November 22, 2026 its main buttons (Create account, Log in, Send reset link) are dark with gold words like every panel's main action, in sentence case, and the lines under the forms that repeated the tabs are gone |
| AU-03 | Log in, show password, forgot password | V | `#logscreen`, `#resetscreen`, `.showPass`; in `#joinBox` from the header | 2.5 shipped |
| AU-04 | Google sign-in (on; Apple won't be offered: the owner, November 22, 2026) | V | `#oauthBox`, `setupProviderSignIn`, `ftconfigs.signInProviders` | keep |
| AU-05 | Pick a username after Google sign-in | V | `#pickNameBox`, `setupPickName` | keep |
| AU-06 | Join box over the page (stay where you are) | V | `#joinBox` in `index.html`, `users.js` `openAuth` / `closeAuth`; `discover.js` `showSignIn` adds the crate note | 2.5 shipped: every page, Discover and Live |
| AU-07 | Change username | M | `#ac-nameForm` (`#changeUsername`, `#ac-saveName`), `#usernameResponse`, `nameClaim` | keep (Profile tab) |
| AU-08 | Avatar style (16 sets: Robohash robots, monsters, heads, cats; DiceBear sets) | M | `#avatarStylePicker`, `STORAGE.avatarStyle`, `users/<uid>/avatarStyle` | ✗ retired: members don't choose their own (the owner, November 19, 2026; 0.4 had found the picker hidden by `display: none`). A supermod sets everyone's style instead (MO-05); `#avatarPickerSection` stays in the page, hidden, and its options fill MO-05's menu |
| AU-09 | Log out | M | `#logOutButton` (Account tab), `#nav-logout` (account menu) | 2.5 shipped |
| AU-10 | Banned / suspended state | All | `userBanned`, `userUnbanned`, `banned/` | keep |
| AU-11 | (new) Account: email and sign-in method, change password (or a reset link), change email (confirmed by a link) | M | `#account-tab`, `ftapi.actions.accountInfo` / `changePassword` / `changeEmail` | 2.5 |

## SE · Settings (`#accountSettingsBox`, tabs Profile · Account · Settings · Mod)

| Id | Feature | Today | Goes to |
|---|---|---|---|
| SE-01 | Get the app card / install guide (iPhone, Android, computer; Install button) | `#getAppCard`, `#installAppBox`, `#installNow`, `install.js` | keep |
| SE-02 | Show my name on public pages | `#publicNameToggle`, `users/<uid>/publicName` | keep |
| SE-03 | Previews play over the room | `#previewOverToggle` | keep |
| SE-04 | Badoop sound | `#badoopToggle` | keep |
| SE-05 | Desktop notifications for @mentions | `#desktopNotifyMentionsToggle` | keep |
| SE-06 | Push @mentions to this device; test; @everyone; device list | `#pushMentionsToggle`, `#pushTest`, `#pushEveryoneLine` / `#pushEveryoneToggle`, `#pushDevices`, `push.js`, `sw.js`, `pushSubs/` | keep |
| SE-07 | Share typing | `#shareTypingToggle` | keep |
| SE-08 | Show images / avatars / song announcements in chat | `#showImagesToggle`, `#showAvatarsToggle`, `#showSongAnnouncementsToggle` | keep |
| SE-09 | View density (compact, cozy, comfortable) | `#densityPicker`, `applyDensity`, `STORAGE.density` | keep; the new layout supports all three |
| SE-10 | Disable media playback | `#mediaDisableToggle`, `STORAGE.disableMedia` | keep |
| SE-11 | Version | `#version` | keep |
| SE-12 | Last.fm scrobbling (connect, now playing, scrobble, love) of what each listener hears, Live or Discover (November 13, 2026) | `lastfm.js`, `api/lastfm.php`, `checkLastfmToken`, `STORAGE.lastfmSession` | keep |
| SE-13 | ~~(new) Try the new room~~ | — | dropped: no opt-in switch (the owner, November 15, 2026) |

## MO · Mod tools

| Id | Feature | Today | Goes to |
|---|---|---|---|
| MO-01 | Mod tab: find a user, suspend / ban (supercop), active suspensions | `#mod-tab`, `#supercopSearch`, `#supercopResponse`, `#activeSuspensions`, `banListChanged` | keep |
| MO-02 | Mod check (mod-only buttons show) | `modCheck` event | keep |
| MO-03 | Fix tags, flag, skip the playing song | `#npModMenu` | ✅ 1.7 (and the decks: remove the playing DJ, add someone) |
| MO-04 | Mod bot commands: `!skip`, `!remove`, `!add`, `!fixtags`, `!flagplay`, `!settheme`, `!lights*`, `!screen*`, `!killscreen`, `!review`/`!same`/`!different`, `!swapscan`, `!ytsync`, `!genrelists run`, `!ytmtest`, `!upbot`/`!downbot` | bot | keep; 1.18 mod help lists them |
| MO-05 | Everyone's avatar style (supermods): one of the room's six for the whole room (Robohash robot busts (default), monster busts, cats; DiceBear Notionists, Pixel Art; Bouletmaton: members' own, robot busts for the rest), or the room's default (`config.js` avatarset, else robot busts). Members' switched-on Bouletmatons show whatever the pick; in October everyone is a monster bust, the pick returns in November (the owner, November 21, 2026) | `#mo-avatarStyle` in `#mod-tab`, `ftapi.actions.setRoomSetting`, `roomSettings/avatarStyle` (hostbot rules; the bot's cards follow it), `roomSettingsChanged` → `firetable.roomAvatarStyle`, `firetable.avatarForced`, `firetable.utilities.redrawAvatars` | ✅ added November 19, 2026 (the owner's request); six styles November 20, 2026; keep |
| AU-12 | Your Bouletmaton: a builder for every part, in the Bouletmaton's own order and with its complete set (head, body, hair, mouth, eyes, eyebrows, nose, beard, ears, chin, face details, neckwear, glasses, earrings, in hand, hat; skin tone, hair and beard colour), starting from every choice at 1, Start over; always transparent, no background option, nothing made up. Members switch theirs on or off any time; switched on it's their avatar whatever the room's style, except October (monsters). With the room on Bouletmaton, members without one get the builder once a visit. Always in Profile | `#ac-bouletSection` (`#ac-bouletEdit`, `#ac-bouletOn`), `#bm-builderBox` (`#bm-use`), `js/avatar-builder.js`, `js/bouletmaton.js`, `img/bouletmaton/`, `users/<uid>/boulet`, `users/<uid>/bouletOn` (hostbot rules) | ✅ added November 20, 2026, opt-in November 21, 2026 (the owner's requests); keep |
| AV-01 | Every avatar style scaled for every circle and the stage (`html[data-avatars]` framing, `css/looks.css` `.ft-avatar`), checked by `tests/avatars.mjs` | `firetable.utilities.avatarKind`, `--av-zoom`, `--av-x`, `--av-y`, `--av-fill` | ✅ November 20, 2026; keep |
| AV-02 | No avatar yet: a DJ known only by a name (no uid to make a face from: the play history's older rows, a first DJ nobody here can place now) is the generic gray robot bust, the same one for all of them, never a face made from the name. Most often on Discover's DJs (timelines, a song's history, who plays a genre); also Live's Recent | `img/robot-generic.png` (Robohash's gray parts, `tools/robot-generic.py`), `GENERIC_AVATAR_URL`, `firetable.utilities.avatarURL` with no uid, `.d-noface` (`js/discover.js` `robot()`), framed as a robot bust whatever the room's style (`css/looks.css`) | ✅ added November 22, 2026 (the owner's request; it was a plain gray circle); keep |

## DI · Discover (`js/discover.js`, `css/discover.css`)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| DI-01 | Home: New this week (or New this month), Not played live yet, Room chart, DJs, Rising, Theme nights, Genres, On this day, Recent plays | All | `viewHome`, `leadCard`, `weekNew`, `unplayedNew`, `topDjs` | ✅ 2.4 (November 19, 2026) |
| DI-02 | New (this week, this month, 90 days, not played live yet; grid or list) | All | `viewNew`, `#dNewShow` | ✅ 2.6 (November 19, 2026): one Show menu instead of chips; This week first |
| DI-03 | Charts (week, month, year, all time; previous/next; genre; new releases only; movement; weeks; fires; share image; embed) | All | `viewCharts`, `chartImage`, `embedDialog`, `embed/chart/` | ✅ 2.6 and 1.9 (November 19, 2026): the period as one control, genre and new releases as drop-downs, Play the chart, Save as playlist, Share, who played each first, ties as "=n". On phones (November 22, 2026) a row in any list of songs puts its numbers (genre, movement, weeks, fires, plays) on a line under the artist, where plays were hidden and a long title wrapped a word a line; Share is its icon so Play, Save and Share sit on one row |
| DI-04 | Genres: sound map and tiles | All | `viewGenres`, `layoutMap`, `spreadMap`, `mosaic` | ✅ 2.7 in part (November 20, 2026): the room song's genre has a red dot and the genre you're hearing a gold outline (`mapMarks`, from the song's library record), a legend says so, and picking a genre shows its card under the map (`mapCard`: about, numbers, next door, its radio, Open) without leaving the page. Tonight's genres (the last 8 hours of plays, from the bot's `g` on Recent rows) get a small ring. Since November 22, 2026: a name has a halo in the page's colour so the middle lines pass behind it, tonight's ring is brighter the more of tonight was that genre (`--t`, `mapMarks`), and the legend says a bigger name was played here more |
| DI-05 | Genre page: Room favorites / New here / Deep cuts, by year, who plays it, next door, genre radio, YouTube Music playlist | All | `viewGenre`, `playRadio`, `ytmButton` | 2.7 overview strip above the list |
| DI-06 | DJs (sort by plays, firsts, fires, newest, name; find) | All | `viewDjs` | 2.7 |
| DI-07 | DJ page: their sound, most played, brought here first, similar DJs, recent sets, theme nights, cards held, featured cards, fires earned | All | `viewDj`, `cardsOf`, `featuredOf`, `drawCards`, `fires()` | ✅ 2.7 in part (November 20, 2026): opens on Brought here first (the first tab) when they have any, with Play what they brought here; Their sound as one stacked bar with a legend. facts as chips, recent sets one line a night (a theme night's line opens it) |
| DI-08 | Years and year pages | All | `viewYears`, `viewYear` | 2.7 covers on Years |
| DI-09 | Artist pages | All | `viewArtist` | 2.7 |
| DI-10 | Theme nights and night pages | All | `viewNights`, `viewNight` | 2.7 |
| DI-11 | Recent plays (last 100) | All | `recentTracks` | 2.7 the Live timeline component |
| DI-12 | Search (artists, genres, DJs, theme nights, songs; YouTube for members) | All | `viewSearch`, `searchYouTube`, `#dQ` | keep |
| DI-13 | The Discover player: Now playing, up next, previous / next, reload, open, mute, Save | All | `nowPanel`, `play`, `step`, `togglePause`, `mediaSession`, `#dSide`, `#dMini` | ✅ 2.3: the player bar `#dMini` (`renderBar`, `mainButton`, `seek`, `setVolume`); the song in full moved from the Now playing tab (removed) to the full-screen player (`renderFull`, `fullSide`, DI-27). Since November 15, 2026 (owner's call) the bar has no times or progress in Live while it plays the room: the stage shows them (`#timrUp`, `#timr`, `#prgbar`). One layout whatever it plays (November 24, 2026): play in the bar's middle, previous and next either side, the times outside those; progress is a line along the bar's top edge (`#pv-seek` over `#dBar`), with a handle, the time under the pointer and a drag that moves the fill (`js/scrub.js`); in Live on the room's song the edge is a whole line of the song's colour |
| DI-14 | Listen in (switch back to the room) | All | `listenIn` (was also `renderLiveLine` / `#dLive`) | ✅ 2.3: the bar's ● Live / On air states, `listenIn`, `stopRoom`, the other source one tap away (`#pv-switch`). The live line above search was removed as a duplicate (owner's call, November 13, 2026); Listen in is also under the song in the full-screen player (`#pv-fnext`) |
| DI-15 | Visitor crate (kept in the browser; third save offers to keep it; becomes "My Discover crate" on join) | V | `crate()`, `saveToCrate`, `openKeepCrate`, `importCrate`, `ft-crate` | 2.4 crate card in the left column |
| DI-16 | Step inside (Live as visitors see it, locked tabs: Join, Playlists, Recent, Cards) | V | `lockedTabs`, `.d-stepin` | keep |
| DI-17 | Members' playlist and chat in the right column | M | `playlistPanel`, `sideTabs`, `chatIn` / `chatBack` | ✅ 2.3: Playlists tab with switch, DJ from, filter, drag, Top / Bottom / Remove + Undo (`plAct`, `listReady`), Hop on; Chat for visitors too. Nov 25, 2026 (the owner's ask: the row above the panel read as duplicates): its Play / Shuffle play / DJ buttons went. A song's own ▶ starts the playlist there (no separate Play: the player bar has Previous / Next); Shuffle is a setting of the player (bar and full-screen, `js/discover-shuffle.js`) for any list, so Shuffle play is kept; DJ from is the crate's DJ switch beside the picker (`#cr-djTag`, Live too: DJ list / DJ from this) |
| DI-18 | Play a whole list (play the year, their favourites, genre radio), Save all | All | `playAllButton`, `saveAllButton` | keep |
| DI-19 | Song ⋮ menu (Save, add to playlist, open, share) | All | `openMenu`, `menuAct`, `firetable.songMenu` | ✅ 2.8 (November 20, 2026): its shared items (Play it in the room, About this song, Add to playlist… when signed in, Open, Copy the song's link) come from `firetable.songMenu`, in its order and words; the artist, genre and DJ links stay Discover's own. ✅ (November 22, 2026): Edit tags… (`tags`) for mods and supermods, on every Discover song (`canRetag`, `editTags`) |
| DI-20 | Share menu (link, image, embed) | All | `openShareMenu`, `copyLink` | keep |
| DI-21 | Library pages for search engines (`/music/…`) | All | `tools/plain-pages.mjs`, deploy step | keep; check every Discover step still renders in plain pages (smoke checks them) |
| DI-21b | (new, November 23, 2026) One address for each library page: Discover's genre, DJ, artist, year, chart, theme-night and New pages live at their `/music/…` address in the site (real links, Back and Forward, the tab's name); Home, search, tempo, Recent plays and Live keep a `#`; old `#discover/…` links still work. All 5,000 artists have pages, with their genres and "Sounds like"; the home page is sent with songs and links in it; sitemap dates, structured data, feeds, IndexNow | All | `js/discover.js` (Addresses), `tools/plain-pages.mjs`, `.htaccess` (the fallback), deploy step | keep; a new Discover page with a library address needs `pathOf` / `routeOfPath` in `js/discover.js` and a page in the tool |
| DI-21c | (new, November 23, 2026) A genre's page tells a little about it (About, under its songs: the bot's `genre-stories.md`) and links to The best of each year; a genre's year is a page of its own (`/music/genres/<slug>/<year>/`: its songs released that year, most played first, Play all, Save all, the other years, the year's other genres); a year's page lists its genres. Each library page has a share image (`card.jpg`) | All | `js/discover.js` (`viewGenreYear`, `genresOfYear`, `viewGenre`), `tools/plain-pages.mjs`, `tools/share-cards.mjs`; data: `discover/lib/genreYear/`, `genres/<slug>/ys`, `genre/<slug>/story` (firetable-hostbot `tools/history/library.js`) | keep |
| DI-22 | Found-via tracking for new accounts | V | `FOUND_KEY`, `users/<uid>/foundVia` | keep |
| DI-23 | (new) On Air card: the room in Discover's right column while you're not in it | All | today: "Pick any song to play it here" | ✅ 2.1: `#pv-onair` (`roomPanel`); since 2.3b the room in full is the full-screen player: the room's song and facts, decks, Listen in, the chat, Just played; the bar keeps On air / Listen in (`roomPanel` removed) |
| DI-24 | (new) Found by, and Play it in the room, in the player | All / M | today: first and last plays in the Now playing panel; Save | ✅ 2.3: Play it in the room (`.pb-toroom`, `toRoom` / `undoToRoom`); since 2.3b Found by is in the full-screen player (`#pv-fhist`), with the note and Undo (`#pv-toRoomNote`) |
| DI-27 | (new) The full-screen player: for a TV or a second screen, in Discover and Live | All | — | ✅ 2.3b, 2.3c: `#pv-full` (`openFull`, `renderFull`, `closeFull`), from the bar (`#fullscreenBtn`, `#pv-art`, a tap or click on the bar's own space) or F; the stage's `#screenControl` moved in (screen off: the song's own artwork; on: the video). Since November 15, 2026 (the owner: a passive listening mode) no DJs / Chat tabs or side panel: the cover beside the words on wide screens, filling the width on phones; under the song, Next (Play now), Play it in the room's Undo, and Listen in / Back to it (`fullNext`, `#pv-fnext`). The decks, Just played and the chat stay in Live and Discover |
| DI-25 | (new) New this week leads Home; Not played live yet, "Be the first" | All | `weekNew` (releases from the last 8 days), `leadCard`, `unplayedNew`, `newHead` (links into New on a filter) | ✅ 2.4 (November 19, 2026); New's own "This week" filter comes with 2.6. Under New this week, Not played live yet leaves out the songs that row already shows (November 22, 2026: in a week nobody had played yet the two rows were the same songs); its link still counts them all |
| DI-26 | (new) The room on the sound map | All | — | ✅ 2.7 (November 20, 2026): the room song's red dot, your gold outline and tonight's rings (`mapMarks`; tonight's from `g` on each Recent plays row, firetable-hostbot#61) |
| DI-28 | (new) Tempo pages: a song's BPM tag (sheet, full-screen player) opens the songs played here at that tempo, most played first, then those within 2 BPM; slower / faster, half and double time, Play all, Save all | All | `viewTempo`, `tempoPage`, `tempoTag`, `#discover/bpm/<n>`, reads `bpm/` (indexed by `bpm` in the hostbot's rules) | ✅ added November 15, 2026; the BPM tag is in the tags' own font |

## PH · Phone and app

| Id | Feature | Today | Goes to |
|---|---|---|---|
| PH-01 | Installable app (manifest, icons, Home Screen) | `manifest.webmanifest`, `icons/`, `install.js` | keep |
| PH-02 | Service worker: push, and an offline page | `sw.js` (since November 15, 2026 its fetch handler serves `offline.html` only when one of the site's own pages can't be reached; nothing else passes through it), `offline.html`, registered by `install.js` | keep; the redesign adds no caching of the app itself |
| PH-03 | Keyboard stays out of the way (fields scrolled into view), safe areas | `js/head.js`, `keepFocusedFieldVisible`, `env(safe-area-inset-*)` | keep; since November 22, 2026, while the chat box has focus on a phone and the keyboard is up, the stage and the bottom tab bar step aside (`body.kb-chat`, set in `keepFocusedFieldVisible`) so the conversation keeps the screen. The Turntable theme does the same (`css/ttskin.css`): its room steps out of sight, still playing, and its row in the page's grid closes |
| PH-04 | Wake lock while on deck | `ftapi.keepAwake` | keep |
| PH-05 | Media Session (lock-screen controls for Discover) | `mediaSession` | keep |

## OT · Other pages and services

| Id | Feature | Today | Goes to |
|---|---|---|---|
| OT-01 | About, Privacy, Terms pages | `about/`, `privacy/`, `terms/` | 1.2 share the tokens (step 0.1) |
| OT-02 | Chart embed for other sites | `embed/` (own policy) | keep |
| OT-03 | SoundCloud and Last.fm proxies | `api/soundcloud.php`, `api/lastfm.php`, `api/common.php` | keep |
| OT-04 | Storage fallback when blocked | `storage.js` | keep |
| OT-05 | Toasts, tooltips, form messages | `#ft-toast`, `#ft-tooltip`, `firetable.ui.toast`, `tooltip`, `formMessage` | keep (1.1 dropped in round 4) |
| OT-06 | Link previews: the room's title, description, canonical address, Open Graph and Twitter tags, `img/og.png`; library pages' own tags and covers | `index.html` head, `tools/plain-pages.mjs` | ✅ added November 15, 2026; keep (smoke checks one set per page) |
| OT-07 | A save the database refuses says so ("Couldn't save … Try again in a moment.", once per burst) | `ftapi.saveFailed` (`firetable.js`) | ✅ added November 14, 2026; new writes in later steps use it |
| OT-08 | The live stage for QueUp's screen: the stage with its screen up (cover, song, who picked it, tempo, the DJ at their plaque, the line, times, theme, who's online, the song's colours), the room's radio stream with Listen live, fire behind the DJ (`songFires` from the hostbot), one picture at any size | `embed/stage/` (own policy; only this site and QueUp may frame it; unlisted) | ✅ added November 15, 2026; keep (smoke checks it) |

## TT · The Turntable theme (an easter egg in Live; `js/ttskin.js`, `css/ttskin.css`)

Added November 21, 2026, at the owner's request. A skin over Live, off unless someone goes in; Live's own look is untouched. Every row below uses the room's own controls and data.

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| TT-01 | Ways in and out: `/turntable` or `/tt` in chat, the Konami code, the `:id:` logo three times; Back to Live (`#tt-exit`); kept per device; Live's alone (suspends in Discover, back with Live) | All | `firetable.tt.enter`, `leave`, `toggle`; `STORAGE.ttSkin`; `chat.js` slash commands | ✅ added |
| TT-02 | The music never stops: the room's player stays in place, placed over the left screen | All | `#screenBox` positioned by CSS (`--tt-s`, `--tt-x`, `--tt-y`), never re-parented | ✅ added |
| TT-03 | The room: stage, theme bubble, awesome meter, lights by fires, LED songboard (artist, title, times), the art on the screens (an art track's cover filling the right one) | All | `#tt-room`, `renderSong` (`artTrackZoom`), `renderVotes`, `renderTheme` | ✅ added |
| TT-04 | Awesome = Fire, Storm = take it back (never below none); Grab, its playlist picker and the song link on the songboard | M | `#tt-awesome` → `#fire`, `#tt-storm`, `#tt-grab` → `#grab`, `#tt-grabPick` → `#st-grabPick`, `#tt-link` → `#songlink` | ✅ added |
| TT-05 | DJs at their laptops (plays, the spotlight, Play Music), everyone on the floor in a place that stays theirs; the DJ playing nods on the beat, heads rock to fires, everyone bobs in dance mode; a DJ's menu on their laptop (Mention, card, DJ page; mods Skip, Step them down, Remove; supermods Mod / Unmod, Suspend; your own: stickers, the bus, Step down); click someone on the floor for their card | All | `renderSeats`, `renderCrowd`, `#tt-djmenu` (`djMenuItems`), `firetable.ui.tooltip.user` | ✅ added |
| TT-06 | Turntable avatars: all 627 unlocked (25 taken out), picked the first time in, changed from the account menu; Turntable faces only in the theme, never in Live | M | `#tt-picker`, `#nav-ttAvatar`, `faceAll`; `users/<uid>/ttAvatar` | ✅ added |
| TT-07 | Laptop sticker builder: lid colour, up to ten stickers dragged, turned by their corner and sized (keys too) | M | `#tt-laptopEdit`, `#nav-ttLaptop`, Stickers on your seat; `users/<uid>/ttLaptop` | ✅ added |
| TT-08 | The panel: Queue · Room · Chat, or two sidebars; Room's welcome, People here (DJs, Moderators, Bots, Audience), Recently played, Fresh, Cards; the DJ playlist picker in Queue | All | `#tt-tabs`, `#tt-pane`, `#tt-layout` (`STORAGE.ttLayout`), `moveDjPicker` | ✅ added |
