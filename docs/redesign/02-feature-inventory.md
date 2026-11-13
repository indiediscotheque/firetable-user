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
| TB-05 | Mentions inbox (@), unread badge, push hint | M | `#inboxTrigger`, `#inboxBadge` → `#inboxPopover` (`#inboxList`, `#inboxClear`, `#inboxPush*`); `chat.js` `watchInbox`, `renderInbox`, `markInboxRead`; `mentions/<uid>` | 1.2 restyle; 3.6 also a Mentions tab beside Chat |
| TB-06 | Profile and settings | M | `#loggedInUser` (avatar) → `#nav-accountMenu` (Profile, Account and sign-in, Settings, Mod tools, Get the app, Log out) → `#accountSettingsBox` (`firetable.ui.openAccount`) | 2.5 shipped; phone: You tab |
| TB-07 | Reconnecting notice | All | `#reconnecting` (`authReconnected` / `authDisconnected`) | keep, restyle 1.2 |
| TB-08 | Discover / Live switch | All | `#modeTabs` (built by `discover.js` `build()`), `ft-mode` in storage | keep on computers; on phones the bottom tab bar (4.1) |
| TB-09 | Search button (opens Discover search, `/` key) | All | `#dSearchOpen` (`discover.js`), `openSearch()` | keep |

## ST · The stage (`#stage`, `#djStage`)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| ST-01 | The video (YouTube) or artwork (SoundCloud) on the stage screen | All | `#screenBox` > `#screenFrame` > `#playerArea` (YT iframe, `player.js` `onYouTubeIframeAPIReady`), `#scScreen` (SoundCloud art + `glitch.js` p5 effect), `#screenover` | 3.2 full stage height, unchanged mechanics |
| ST-02 | **DJs standing on stage in front of the screen** (the room's signature) | All | `#deck` (the playing DJ, spotlight), `#ondeck` (next DJs), `room.js` `tableChanged`, `spotlightStateChanged`, avatar art from `firetable.utilities.avatarURL` | keep exactly (round 4: the stage's look is frozen) |
| ST-03 | Hop on the decks (empty spot +) | M | spot "+" in `#ondeck` (`tableChanged`), `!addme` | 1.10 clearer empty spot; 1.11 "Your turn" bar |
| ST-04 | DJ play counter / play limit on the name tag | All | `tableChanged`, `playLimitChanged` (`playlimit`) | keep; restyle 1.10 |
| ST-05 | Screen control: synced, video, art, off | All | `#screenControl` (the "microwave" icon), `#screenControlTip`, `ui.js` `updateScreenBtn` / `applyScreenSetting`, `STORAGE.screenControl`; room-wide `thescreen` (`!screen`, `!screenup`, `!screendown`) | ✅ 2.3c: with Discover on, `#screenControl` lives in the player bar (Live) and in the full-screen player, whose screen off / on is this same setting |
| ST-06 | Volume slider and mute | All | `#volplace` > `#slider`, `#volstatus`, `player.js` `initVolume`, `muteToggle`, `STORAGE.volume`, `STORAGE.mute` | ✅ 2.3c: with Discover on, the bar's volume and mute (`#pv-vol`, `.d-mute`, `setVolume` keeps `#slider` in step); the stage's `#volplace` / `#volstatus` stay in the hidden `#stageTopRight` |
| ST-07 | Reload audio | All | `#reloadtrack`, `player.js` `reloadtrack` | ✅ 2.3c: `#reloadtrack` in the player bar while it plays the room |
| ST-08 | Full screen | All | `#fullscreenBtn` (hidden where unsupported) | ✅ 2.3c: with Discover on, `#fullscreenBtn` is in the player bar and opens the full-screen player (`#pv-full`, DI-27), which has the video and fills the screen itself; without Discover, today's stage full screen (`ui.js`, #155) |
| ST-09 | Fire (🔥) | M | `#fire` → chat reaction `:fire:`; `chat.js` `sendReaction`, `processFireReactionMessage`, fire effect `fire.js` (PixiJS, lazy), `!hot` | 1.5 shows the count; same place (bottom-left of stage) |
| ST-10 | Rain (🌧) reaction | M | `#cloud_with_rain` state, `:cloud_with_rain:`, `!storm` | keep wherever it is reachable today; 1.5 keep the state |
| ST-11 | Grab (add the playing song to a playlist) | M | `#grab` → `#stealContain` / `#stealpicker` (`openStealPicker`, `fillStealPicker`), `recordGrab` (`grabs/<djid>`), `savedToast` with Undo | 1.6 split button: tap = last used playlist (Undo), ▾ = picker |
| ST-12 | Song link (open on YouTube or SoundCloud) | All | `#songlink` | keep, 1.5 label |
| ST-13 | Skip your own track | D | `#skipTrigger` → `#skipPopover` (`.skipNowAction` → `!skip`) | keep: shows only on your song |
| ST-14 | Mod tools on the playing song: Skip, Fix tags, Flag ▸ | Mod | `#npModBtn` → `#npModMenu` (`#npSkip`, `#npFixTags` → `#tagEditorPopover`, `#npFlag` → `#flagMenuPopover`) | 1.7 plus "Remove from the decks" |
| ST-15 | "Tap to start audio" | All | `#tapToPlay` (autoplay blocked) | 1.10 "Listen to the room" overlay with one line of context |
| ST-16 | String lights (December, or `!lights`) | All | `ul.lightrope`, `room.js` `lightsChanged`, `applyLights`, `seasons.js` `LIGHTS_MONTHS` | keep exactly |
| ST-17 | Snow (Jan, Feb) | All | `snow.js`, `SNOW_MONTHS` | keep exactly |
| ST-18 | Fire embers effect | All | `#fyre`, `fire.js` (PixiJS + GSAP via `lazy.js`) | keep exactly |
| ST-19 | Dance mode | All | `danceStateChanged` (`dance`), `!dance` | keep |
| ST-20 | Beat-synced bobbing (BPM) | All | `room.js` `applyBeat` (`--beat`, `--bop`, `--beat-phase`), `songBpm`, `bpm/` | keep |
| ST-21 | Seasonal avatars (monsters in October, etc.) | All | `seasons.js` `AVATAR_SEASONS`, `ftconfigs.avatarset` | keep; check every stage state with non-robot sets |
| ST-22 | Theme colours (room accent per night) | All | `colorsChanged` (`colors`) sets `--color-accent` | keep; all new accent uses go through the variable |
| ST-23 | Stage backdrop with the `:id:` logo (when nothing plays) | All | `#stageBackdrop` | 1.10 the "decks are open" empty state |
| ST-24 | User card on a DJ's avatar (Take the bus, Step down, Add to / Remove from deck, Block) | All / Mod | `#ft-user-tip` (`ui.js` user tip), `utt-*` buttons, `departure_board` | keep; 1.11 your own controls also in the Your turn bar |

## NP · Now playing facts

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| NP-01 | Title and artist (artist links to Discover) | All | `#track`, `#artist`, `newSong` | 1.4 hierarchy; stays top-left of the stage |
| NP-02 | Plays here · all versions | All | `#playStats` > `#playCount` (`tagUpdate`) | 1.4 |
| NP-03 | First played … by …, last played … by … | All | `#firstPlay`, `#lastPlay` | 1.4 |
| NP-04 | Tempo (BPM) | All | `#npBpm` | 1.4 |
| NP-05 | Album art thumbnail | All | `#albumArt` | keep (used on narrow layouts) |
| NP-06 | Progress bar | All | `#prgbar` > `#prgbarbar` | 1.8 along the stage's bottom edge (same element) |
| NP-07 | Time: elapsed (`#timrUp`) and remaining (`#timr`) | All | `room.js` `newSong` countdown | 1.8 elapsed / total, plus remaining on hover |
| NP-08 | Song sheet (cover, links, tempo, source, plays, firsts, versions, Play, Save, Open, Copy link) from any title | All | `discover.js` `openSheet` (`.d-sheetlink`) | keep; reachable from the stage title (1.4) |

## DJ · Decks, waitlist, your turn

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| DJ-01 | Which playlist you DJ from | M | `#djlistpicker` in `#themebox` / `#djlistpickerWrap`, `#djlistOpen` (open it in Playlists), `ftapi.actions.switchDjList`, `users/<uid>/selectedList` | 1.11 the Your turn bar keeps this exact select, restyled as a button with ★ |
| DJ-02 | Your next tracks on deck | D | `#deckQueue` | 1.11 "Up next: …" in the bar |
| DJ-03 | Waitlist (with 4+ DJs) | All | `#usersWaitlist`, `waitlistChanged`, `room.js`, `!wait` | keep in the people column; 1.10 also a chip on the stage |
| DJ-04 | Take the bus (step down after next play) | D | user card `utt-bus-btn`, `deckDepartureBtn`, `!removeafter` / `!dontremoveme` (`!gottacatchmybus`) | 1.11 also in the Your turn bar |
| DJ-05 | Step down | D | user card `utt-stepdown-btn`, `!removeme` | 1.11 also in the bar |
| DJ-06 | Add / remove someone (mods) | Mod | user card `utt-deck-btn`, `utt-remove-deck-btn`, `!add`, `!remove` | keep; 1.7 also in the stage's mod menu |
| DJ-07 | Autopilot DJ (the bot plays when the decks are empty) | All | bot (`!autodj`, `!upbot`, `!downbot`) | keep; 1.10 the empty-decks state says the bot can step in |
| DJ-08 | Away DJs keep their seat for a while | All | bot ("away DJs") | keep |

## PE · People

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| PE-01 | People list with roles (bot, supermod, mod, member), DJs first | All | `#usersbox`, `#usersStats` (`#numListeners`, `#numRoomListeners`, `#numStreamListeners`), `#allUsers` > `#usersDJs`, `#usersBot`, `#usersSuper`, `#usersMod`, `#usersRegular`; `usersChanged`, `userJoined`, `userLeft`, `userChanged` | 1.12 role legend and readable size; stays left at 1024+, a tab on tablets and phones |
| PE-02 | Radio listeners count | All | `#numStreamListeners` | keep |
| PE-03 | User card (profile, DJ page link, cards they hold, block, deck controls) | All | `#ft-user-tip`, `ui.js` | keep |
| PE-04 | Block / unblock | M | user card `utt-block-btn`, `/block`, `/unblock`, `blocks/` | keep |
| PE-05 | Idle state | All | `idle.min.js`, `users/<uid>/idle` | keep |

## CH · Chat

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| CH-01 | Chat messages, grouped by sender | All (V reads in Discover) | `#actualChat` > `#chatsWrap` > `#chats`, template `#chatKEY`, `chat.js` `setupChatEvents`, `chatFeed` / `chatData` | keep; 1.13 type and spacing |
| CH-02 | Song announcements (the bot's "started playing …") | All | bot messages; Settings `#showSongAnnouncementsToggle` (`applySongAnnouncementVisibility`) | 1.13 one slim line each, setting kept |
| CH-03 | Images in chat | All | `#showImagesToggle`, `firetable.ui.showImages` | keep |
| CH-04 | Avatars in chat | All | `#showAvatarsToggle` | keep |
| CH-05 | Links made clickable | All | `linkify`, `textToLinks` | keep |
| CH-06 | Emoji picker | M | `#pickEmoji`, `#emojiPicker` (`#pickerNav`, `#pickerSearch`, `#pickerResults`), `emoji.js` (unpkg data) | keep |
| CH-07 | `:shortname:` emoji | M | `emoji.js` | keep |
| CH-08 | @mention picker | M | `#atPicker`, keyboard nav in `chat.js` | keep |
| CH-09 | Reactions on messages | M | `#reactPickerPopover`, `chatData/<id>/reactions/<emoji>/<uid>`, `toggleReaction`, `renderReactions` | keep |
| CH-10 | Typing indicator (and sharing yours) | M | `#typingIndicator`, `renderTyping`, `typing/`, Settings `#shareTypingToggle` | keep |
| CH-11 | "New messages" jump | All | `#morechats` | keep |
| CH-12 | Slash commands: /block, /unblock, /hot, /storm, /shrug, /tableflip, /unflip | M | `chat.js` (switch near "tableflip") | keep; 1.18 listed in the keyboard help |
| CH-13 | Bot commands typed in chat (`!plays`, `!firstplay`, `!bpm`, `!suggest`, `!link`, `!theme`, `!grab`, …) | All | the bot | keep; 1.18 help lists the common ones |
| CH-14 | Mod delete of a message | Mod | delete button on messages | keep |
| CH-15 | Badoop sound on @mention | M | `#badoopToggle`, `sound.mp3` | keep |
| CH-16 | Desktop notification on @mention | M | `#desktopNotifyMentionsToggle` | keep |
| CH-17 | Cards shared or gifted in chat, with a Grab button | M | `chat.js` `addGrabButton`, `claimGrab`, `watchGrab`, `.chat-grab-btn` | keep |
| CH-18 | Private notices from the bot (your track can't play, swaps ready, "are you there?") | M | `notices/<uid>`, `watchNotices`, `showNextNotice` (toast) | keep |
| CH-19 | Chat peek for visitors (read-only, Discover) | V | `discover/chat`, `#chatPeek` | ❌ retired in 2.3c (the owner's call, November 13, 2026: the chat is for members only); `#chatPeek` stays in the page, hidden |

## CR · Playlists, the crate (`#queuebox`)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| CR-01 | View / edit a playlist (switch which one shows) | M | `#listpicker` (`#listpickerWrap`), `switchViewList`, `STORAGE`'d per uid | 1.14 a one-row switcher button (★, name, count, broken) opening a searchable menu; the select stays in the DOM for the code |
| CR-02 | Playlist rows: art, Artist - Title, preview | M | `#mainqueue`, `queueBlockHTML`, `$playlistItemTemplate` | 1.15 two-tone "Title · Artist", same template |
| CR-03 | Row actions: top, bottom, YouTube, add to another playlist, delete | M | row buttons; `bumpSongInQueue`, move-to-bottom, `openStealPicker`, `deleteSongPrompt` (`#deleteSongPopover`) | 1.15 Top, Bottom, Preview, Open, Delete visible; ⋮ for the rest |
| CR-04 | Track ⋮ menu: Swap for YouTube Music audio…, Send to bottom, Add to playlist, Open, Delete | M | `#trackMenuPopover` (`data-act`: swap, bottom, add, open, delete) | 1.15 plus Edit tags, Swap artist and title, Delete and search |
| CR-05 | Drag to reorder | M | jQuery UI `sortable` on `#mainqueue`, `updateQueue` | keep |
| CR-06 | 30-second preview | M | `player.js` `pview`, Settings `#previewOverToggle` (plays over the room) | keep |
| CR-07 | Filter the playlist; Remixes only; Broken only | M | `#filterMachine` > `#queueFilterForm` > `#queueFilter`, `#queueFilterExtras` (`#queueFilterRemixOnly`, `#queueFilterBrokenOnly`), `filterQueue` | 1.16 filter box + one "Show only" menu (tune icon) with Remixes, Broken, Not played here, Duplicates |
| CR-08 | Find tracks (YouTube / SoundCloud search, links) | M | `#addToQueueBttn` (+) → `#searchMachine` (`#qsearch`, `#searchSelects` `#ytsearchSelect` `#scsearchSelect`), `#searchResults`, `search.js` `ytAPI('search')` (100 quota units) | keep as a + in a circle; 1.17 results list restyle; format-aware source (done); YouTube results ranked for the target list (official artist videos first; audio tracks first for YouTube Music lists) and marked `.search-kind` (done) |
| CR-09 | Add from a pasted or dropped link | M | `ui.js` `LinkGrabber`, `queueFromLink`, `normalizeQueueLink` | keep; 1.17 a hint in Find tracks |
| CR-10 | Shuffle | M | `#shuffleQueue` → `#shuffleQueuePopover`, `shuffleQueue` | 1.16 in the playlist ⋮ menu (button kept on desktop) |
| CR-11 | Merge playlists | M | `#mergeLists` → `#mergeContain` (`#mergepicker`, `#mergepicker2`, `#startMerge`, `#mergeHappening`, `#mergeCompleted`), `mergeLists` | 1.16 in the playlist ⋮ menu |
| CR-12 | New playlist / Import playlist | M | `#plAddLauncher` → `#plAddPopover` (`#plAddCreate` → `#plmaker`; `#plAddImport` → `#importPromptBox`) | 1.14 in the switcher; import becomes 1.19 |
| CR-13 | Delete playlist (type the name) | M | `#plDeleteLauncher` → `#deletePromptBox` (`#deleteConfirmInput`, `#pldeleteButton`) | 1.16 in the playlist ⋮ menu |
| CR-14 | All Playlists overview: rename, reorder (drag, Alt+arrows), default ★, DJ from 🎧, check broken, open, delete one or several, new, find a list by name | M | `#plIndexBtn` → `#plIndexBox` (`playlists.js`): one aligned table with column labels, `#cr-plFilter`, `#cr-plSelectAll`, a row's ⋮ menu `#cr-plRowMenu` (Rename, Check for broken tracks, Delete), `#cr-plCreate` (Nov 2026) | 1.14 "Manage playlists…" in the switcher |
| CR-15 | **What a list is kept to** (YouTube Music / YouTube videos / SoundCloud) | M | `.plx-format` in All Playlists, `playlistPrefs/<uid>/format`, `formatRefusal`, `matchSearchSource` (Nov 2026) | 1.14 also shown in the switcher menu |
| CR-16 | Track counts and broken counts per list (in every picker) | M | `listLabel`, `setListCount`, `loadListCounts`, `STORAGE.listCounts` | keep; shown in the switcher |
| CR-17 | Broken track check (YouTube / SoundCloud status), auto-check | M | `checkBrokenTracks`, `autoCheckBroken`, `setupBrokenCheck`, `STORAGE.brokenCheck`; All Playlists' row ⋮ menu (`#cr-plRowMenu`, Check for broken tracks) | 1.16 "Check for broken songs" in the playlist ⋮ menu |
| CR-18 | Flags on tracks (broken, low quality, off theme), shown on rows | M / Mod | `flagged {date, code}`; `#flagMenuPopover`; bot `!flag`, `!flagplay` | keep |
| CR-19 | Swap suggestions (⇄ on a track, Swap, Preview, Open, Not this one) | M | `#swapPopover` (`#swapHead`), `swapPrompt`, `swapOne`, `activeSwap` | keep |
| CR-20 | Swap all / Show them bar | M | `#swapBar` (`#swapShowBtn`, `#swapAllBtn`), `renderSwapBar`, `swapAll` | keep, restyle 1.16 |
| CR-21 | Remove duplicates | M | `removeDupesFromQueue` | 1.16 playlist ⋮ menu |
| CR-22 | Delete and search for another | M | `deleteSongAndSearch` | 1.15 row ⋮ |
| CR-23 | Edit tags (Artist - Title) | M | `editTagsPrompt`, `#tagEditorPopover` (`#tagMachine`), `tagLog` | 1.15 row ⋮ |
| CR-24 | Undo after add / move / swap | M | `savedToast`, toast actions | keep |
| CR-25 | The built-in list ("Default Playlist", renamable) | M | `queues/<uid>`, `defaultListName`, `playlistPrefs/<uid>/defaultName` | keep |
| CR-26 | Discover's "Save all" into a new playlist | M | `discover.js` `saveAll` | keep; also a source in Import (1.19) |
| CR-27 | Saved marks (this song is in your playlists) | M | `firetable.saved`, `markSaved` | keep |

## IM · Import

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| IM-01 | Import a YouTube playlist (search by name or paste a link) into a new playlist | M | `#importPromptBox` ("Playlist Import Machine"), `#importSources` (`#ytimportchoice`), `#plMachine`, `#importResults`, `search.js`, `playlist.js` `importList` | 1.19 the new import dialog, step 1 |
| IM-02 | Import a SoundCloud set | M | `#scimportchoice`, `scPlaylist` | 1.19 |
| IM-03 | (new) Preview what's inside, choose new or existing playlist, top or bottom, skip what you have, see what's missing | M | — | 1.19 step 2 |
| IM-04 | (new) A list of songs or a CSV | M | — | 1.20 (needs the bot's matching job) |
| IM-05 | (new) Spotify link | M | — | 1.21, after the owner adds a Spotify key to the bot |
| IM-06 | (new) Paste a playlist link in any search box | M | today: "That's a SoundCloud playlist. Use Import…" | 1.19 offers to import it |

## RE · Recent, Fresh, Cards (the tabs under the stage)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| RE-01 | Recent plays, grouped by day and hour, with DJ avatars | All | `#thehistoryWrap` > `#thehistory`, `newHistory`, `songHistory`, `HISTORY_PAGE_SIZE`, "Show older plays" | keep; 1.13 type |
| RE-02 | Filter Recent | All | `#histFilterBar` > `#histFilter` | keep |
| RE-03 | Recent row actions: YouTube, Grab, Edit (mods), Flag (mods), ⋮ | All / Mod | `#histMenuPopover` (open, tags, flag) | keep; edit and flag for mods only (as today) |
| RE-04 | Fresh (new to the room), with join prompt for visitors | All | `#discover` (the Live tab "Fresh"), `#freshIntro`, `#minijoin`, `#thediscovers`, `newProduce` | keep |
| RE-05 | Card case: stats (total, unique DJs, lowest and highest temp), cards per DJ, search, filter by DJ, sort | M | `#cardsWrap` > `#cardsMain`, `cards.js` (`#cardFilterRow`, `#cardFilterText`, `#cardFilterDj`, `#cardSortBy`) | 1.12 explain "temp" |
| RE-06 | Card actions: share in chat, gift to the DJ, view larger, feature on your DJ page | M | `.cardShareChat`, `.cardGiftChat` (`#giftCardPopover`), `.cardViewLarger` (`#cardViewLargerModal`, `#cardPrev`, `#cardNext`), `.cardFeature` | keep |
| RE-07 | Print a card / gift card (bot) | All | `!printcard`, `!giftcard` | keep |

## NV · Navigation between panels

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| NV-01 | Phone tabs: Playlists, Recent, Fresh, Cards, Chat, People | All | `#minimodeoptions` (`#mm-playlists`, `#mm-history`, `#mm-discover`, `#mm-cards`, `#mmchat`, `#mmusrs`), `STORAGE.navMobile` | 4.1 bottom tab bar Home · Discover · Live · Library · You; Live keeps Chat · Recent · People · Cards |
| NV-02 | Tablet side tabs: Chat, People | All | `#sidepanel-tabs` (`#sp-chat`, `#sp-people`), `STORAGE.navSide` | keep |
| NV-03 | View under the stage (Playlists, Recent, Fresh, Cards) | All | `firetable.ui.showView`, `syncNavState`, `STORAGE.navView`, `#mainGrid.view-*` | keep |
| NV-04 | Addresses (`#live`, `#discover/...`) and back button | All | `discover.js` `route`, `writeAddress` | keep; 2.2 adds nothing new |

## AU · Joining, logging in, account

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| AU-01 | Welcome and room pulse for visitors | V | `#login` > `#welcomeInfo`, `#roomPulse` (`renderRoomPulse`) | 2.4 |
| AU-02 | Create account (email, username, password, terms) | V | `#createscreen`, `#createAccountFormShell`; from anywhere: `#nav-signin` → `#joinBox` (`openAuth`) | 2.5 shipped |
| AU-03 | Log in, show password, forgot password | V | `#logscreen`, `#resetscreen`, `.showPass`; in `#joinBox` from the header | 2.5 shipped |
| AU-04 | Google / Apple sign-in | V | `#oauthBox`, `setupProviderSignIn`, `ftconfigs.signInProviders` | keep |
| AU-05 | Pick a username after Google sign-in | V | `#pickNameBox`, `setupPickName` | keep |
| AU-06 | Join box over the page (stay where you are) | V | `#joinBox` in `index.html`, `users.js` `openAuth` / `closeAuth`; `discover.js` `showSignIn` adds the crate note | 2.5 shipped: every page, Discover and Live |
| AU-07 | Change username | M | `#ac-nameForm` (`#changeUsername`, `#ac-saveName`), `#usernameResponse`, `nameClaim` | keep (Profile tab) |
| AU-08 | Avatar style (16 sets: Robohash robots, monsters, heads, cats; DiceBear sets) | M | `#avatarStylePicker`, `STORAGE.avatarStyle`, `users/<uid>/avatarStyle` | keep; every stage state checked with each family |
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
| SE-12 | Last.fm scrobbling (connect, now playing, scrobble, love) | `lastfm.js`, `api/lastfm.php`, `checkLastfmToken`, `STORAGE.lastfmSession` | keep |
| SE-13 | (new) Try the new room | — | 0.3 |

## MO · Mod tools

| Id | Feature | Today | Goes to |
|---|---|---|---|
| MO-01 | Mod tab: find a user, suspend / ban (supercop), active suspensions | `#mod-tab`, `#supercopSearch`, `#supercopResponse`, `#activeSuspensions`, `banListChanged` | keep |
| MO-02 | Mod check (mod-only buttons show) | `modCheck` event | keep |
| MO-03 | Fix tags, flag, skip the playing song | `#npModMenu` | 1.7 |
| MO-04 | Mod bot commands: `!skip`, `!remove`, `!add`, `!fixtags`, `!flagplay`, `!settheme`, `!lights*`, `!screen*`, `!killscreen`, `!review`/`!same`/`!different`, `!swapscan`, `!ytsync`, `!genrelists run`, `!ytmtest`, `!upbot`/`!downbot` | bot | keep; 1.18 mod help lists them |

## DI · Discover (`js/discover.js`, `css/discover.css`)

| Id | Feature | Who | Today | Goes to |
|---|---|---|---|---|
| DI-01 | Home: New this month, Room chart, Rising, Theme nights, Genres, On this day, Recent plays | All | `viewHome` | 2.4 |
| DI-02 | New (this month, 90 days, not played live yet; grid or list) | All | `viewNew` | 2.6 one filter menu instead of chips |
| DI-03 | Charts (week, month, year, all time; previous/next; genre; new releases only; movement; weeks; fires; share image; embed) | All | `viewCharts`, `chartImage`, `embedDialog`, `embed/chart/` | 2.6 two drop-downs + Share; ties shown as "=" (1.9) |
| DI-04 | Genres: sound map and tiles | All | `viewGenres`, `layoutMap`, `spreadMap`, `mosaic` | 2.7 label collisions, distinct covers |
| DI-05 | Genre page: Room favorites / New here / Deep cuts, by year, who plays it, next door, genre radio, YouTube Music playlist | All | `viewGenre`, `playRadio`, `ytmButton` | 2.7 overview strip above the list |
| DI-06 | DJs (sort by plays, firsts, fires, newest, name; find) | All | `viewDjs` | 2.7 |
| DI-07 | DJ page: their sound, most played, brought here first, similar DJs, recent sets, theme nights, cards held, featured cards, fires earned | All | `viewDj`, `cardsOf`, `featuredOf`, `drawCards`, `fires()` | 2.7 fact chips, discoveries default tab, clickable sets |
| DI-08 | Years and year pages | All | `viewYears`, `viewYear` | 2.7 covers on Years |
| DI-09 | Artist pages | All | `viewArtist` | 2.7 |
| DI-10 | Theme nights and night pages | All | `viewNights`, `viewNight` | 2.7 |
| DI-11 | Recent plays (last 100) | All | `recentTracks` | 2.7 the Live timeline component |
| DI-12 | Search (artists, genres, DJs, theme nights, songs; YouTube for members) | All | `viewSearch`, `searchYouTube`, `#dQ` | keep |
| DI-13 | The Discover player: Now playing, up next, previous / next, reload, open, mute, Save | All | `nowPanel`, `play`, `step`, `togglePause`, `mediaSession`, `#dSide`, `#dMini` | ✅ 2.3: the player bar `#dMini` (`renderBar`, `mainButton`, `seek`, `setVolume`); the song in full moved from the Now playing tab (removed) to the full-screen player (`renderFull`, `fullSide`, DI-27) |
| DI-14 | Listen in (switch back to the room) | All | `listenIn` (was also `renderLiveLine` / `#dLive`) | ✅ 2.3: the bar's ● Live / On air states, `listenIn`, `stopRoom`, the other source one tap away (`#pv-switch`). The live line above search was removed as a duplicate (owner's call, November 13, 2026); its chat count stays in visitors' chat in the full-screen player |
| DI-15 | Visitor crate (kept in the browser; third save offers to keep it; becomes "My Discover crate" on join) | V | `crate()`, `saveToCrate`, `openKeepCrate`, `importCrate`, `ft-crate` | 2.4 crate card in the left column |
| DI-16 | Step inside (Live as visitors see it, locked tabs: Join, Playlists, Recent, Cards) | V | `lockedTabs`, `.d-stepin` | keep |
| DI-17 | Members' playlist and chat in the right column | M | `playlistPanel`, `sideTabs`, `chatIn` / `chatBack` | ✅ 2.3: Playlists tab with switch, DJ from, filter, drag, Top / Bottom / Remove + Undo (`plAct`, `listReady`), Play / Shuffle, Hop on; Chat for visitors too |
| DI-18 | Play a whole list (play the year, their favourites, genre radio), Save all | All | `playAllButton`, `saveAllButton` | keep |
| DI-19 | Song ⋮ menu (Save, add to playlist, open, share) | All | `openMenu`, `menuAct` | 2.8 same items as Live's song menu |
| DI-20 | Share menu (link, image, embed) | All | `openShareMenu`, `copyLink` | keep |
| DI-21 | Library pages for search engines (`/music/…`) | All | `tools/plain-pages.mjs`, deploy step | keep; check every Discover step still renders in plain pages (smoke checks them) |
| DI-22 | Found-via tracking for new accounts | V | `FOUND_KEY`, `users/<uid>/foundVia` | keep |
| DI-23 | (new) On Air card: the room in Discover's right column while you're not in it | All | today: "Pick any song to play it here" | ✅ 2.1: `#pv-onair` (`roomPanel`); since 2.3b the room in full is the full-screen player: the room's song and facts, decks, Listen in, the chat, Just played; the bar keeps On air / Listen in (`roomPanel` removed) |
| DI-24 | (new) Found by, and Play it in the room, in the player | All / M | today: first and last plays in the Now playing panel; Save | ✅ 2.3: Play it in the room (`.pb-toroom`, `toRoom` / `undoToRoom`); since 2.3b Found by is in the full-screen player (`#pv-fhist`), with the note and Undo (`#pv-toRoomNote`) |
| DI-27 | (new) The full-screen player: for a TV or a second screen, in Discover and Live | All | — | ✅ 2.3b, 2.3c: `#pv-full` (`openFull`, `renderFull`, `closeFull`), from the bar (`#fullscreenBtn`, `.pb-expand`, `#pv-art`) or F; the stage's `#screenControl` moved in (screen off: the song's own artwork; on: the video); DJs / Chat tabs (`setFullTab`, members) |
| DI-25 | (new) New this week leads Home; Not played live yet, "Be the first" | All | today: New's "not played live yet" filter | 2.4, 2.6 |
| DI-26 | (new) The room on the sound map | All | — | 2.7 (the trail needs the bot's genre on recent plays) |

## PH · Phone and app

| Id | Feature | Today | Goes to |
|---|---|---|---|
| PH-01 | Installable app (manifest, icons, Home Screen) | `manifest.webmanifest`, `icons/`, `install.js` | keep |
| PH-02 | Service worker for push (no fetch handler) | `sw.js` | keep (never add a fetch handler as part of the redesign) |
| PH-03 | Keyboard stays out of the way (fields scrolled into view), safe areas | `viewport.js`, `keepFocusedFieldVisible`, `env(safe-area-inset-*)` | keep |
| PH-04 | Wake lock while on deck | `ftapi.keepAwake` | keep |
| PH-05 | Media Session (lock-screen controls for Discover) | `mediaSession` | keep |

## OT · Other pages and services

| Id | Feature | Today | Goes to |
|---|---|---|---|
| OT-01 | About, Privacy, Terms pages | `about/`, `privacy/`, `terms/` | 1.2 share the tokens (step 0.1) |
| OT-02 | Chart embed for other sites | `embed/` (own policy) | keep |
| OT-03 | SoundCloud and Last.fm proxies | `api/soundcloud.php`, `api/lastfm.php`, `api/common.php` | keep |
| OT-04 | Storage fallback when blocked | `storage.js` | keep |
| OT-05 | Toasts, tooltips, form messages | `#ft-toast`, `#ft-tooltip`, `firetable.ui.toast`, `tooltip`, `formMessage` | 1.1 restyle |
