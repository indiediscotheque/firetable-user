// "Nothing lost" (redesign step 0.4, docs/redesign/04-step-plan.md): every
// control people use is still in the page and can still be reached, by each
// role, at a phone's, a tablet's and a computer's width. Fails if a change
// removes or hides one.
//
// Each entry below is a feature from the inventory (docs/redesign/02-feature-
// inventory.md): who has it, which side of the site (Live or Discover), the
// visible controls a person taps to get there (`via`), and what must then be
// on screen (`target`). A step written "?#id" is tapped only when it's on
// screen (a tab on phones that's always open on computers). The list is the
// record of where everything lives: a pull request that moves a control
// behind a menu updates its `via` in the same change.
//
// Real accounts in the auth emulator (a member, the DJ on deck, a mod) and a
// visitor; the room is seed.mjs's livedIn, the same the screenshots use.
//
// Run (Java 21 for the emulators):
//   cd tests && npm ci && npm run reach
// With the emulators already running (a Claude cloud session: start them
// without the proxy, 01-ground-rules.md):
//   NO_PROXY="localhost,127.0.0.1,::1" node reach.mjs
// Narrow a run: ROLES=member,mod WIDTHS=390 ONLY=CR-,ST-11
// Never deployed. CI: .github/workflows/smoke.yml
import { chromium } from "playwright";
import { policy, config, putAs, serveSite, launchOptions, sleep, authAccount, useAuthEmulator, logInAs, cachePictures, openPage } from "./harness.mjs";
import { livedIn } from "./seed.mjs";

const NS = "demo-reach";
const put = putAs(NS);
const PASSWORD = "reach-pass-1";
const list = (v, all) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : all);
const ROLES = list(process.env.ROLES, ["visitor", "member", "dj", "mod"]);
const WIDTHS = list(process.env.WIDTHS, ["390", "1024", "1440"]).map(Number);
const ONLY = list(process.env.ONLY, null);
const SIZES = { 390: { width: 390, height: 844 }, 1024: { width: 1024, height: 768 }, 1440: { width: 1440, height: 900 } };

const ALL = ["visitor", "member", "dj", "mod"];
const IN = ["member", "dj", "mod"]; // signed in
const PHONE = [390];
const WIDE = [1024, 1440];

// shorthands for the routes
// phones: the bottom tab bar (4.1, Round 5) stands in for Live's Playlists tab (a member's Library),
// and Discover's row of pages is tiles at the top of its Home (one step or the other is on screen)
const tab = (t) => '?#nav-tabs [data-tab="' + t + '"]';
const playlists = ["?#mm-playlists", tab("library")];
const pages = (v) => ['?#dBrowse .d-tile[data-view="' + v + '"]', '?#dNav [data-view="' + v + '"]'];
const listMenu = [...playlists, "#cr-listBtn"];
const account = ["#loggedInUser"];
const chatTab = ["?#mmchat", "?#sp-chat"];
const peopleTab = ["?#mmusrs", "?#sp-people"];
const full = ["#pv-title"]; // phones: tapping the bar opens the full-screen player
const fullMore = [...full, '#pv-full [aria-label="More controls"]'];

/**
 * The features, by inventory row. `who`: the roles that have it; `widths`: only
 * at these; `mode`: live (default) or discover; `via`: the controls tapped in
 * order; `target`: what must be on screen after; `hash`: where the address must
 * end up; `notFor`: roles that must NOT see `notTarget` (straight away, no taps);
 * `known`: a gap already reported to the owner, listed rather than failed;
 * `start: "default"`: the left column as this device finds it with no choice
 * kept (a reload; from 1024 to 1369px it starts folded once the device has
 * signed in).
 */
const FEATURES = [
  // ── the header (TB) ──
  { row: "TB-01", name: "The :id: logo", who: ALL, target: "#roomlogo" },
  // in Live on a computer a member's theme is the left column's first section; a visitor's, and everywhere else, in the header (November 27, 2026)
  { row: "TB-02", name: "The theme, and Suggest a theme (Live: the left column)", who: IN, widths: WIDE, via: ["#usersbox #themePill"], target: "#themeSuggest" },
  { row: "TB-02", name: "The theme, and Suggest a theme (Live, visitors: the header)", who: ["visitor"], widths: WIDE, via: ["#topbar #themePill"], target: "#themeSuggest" },
  { row: "TB-02", name: "The theme, and Suggest a theme (Live on a phone: the header)", who: ALL, widths: PHONE, via: ["#topbar #themePill"], target: "#themeSuggest" },
  { row: "TB-02", name: "The theme, and Suggest a theme (Discover: the header)", who: ALL, mode: "discover", via: ["#topbar #themePill"], target: "#themeSuggest" },
  { row: "TB-03", name: "Community links", who: ALL, via: ["#socialTrigger"], target: "#socialPopover" },
  // a member's About and light mode are in the account menu, at every width; a visitor's (no account menu) in the header
  { row: "TB-04", name: "About (visitors: the header)", who: ["visitor"], target: "#roomInfo" },
  { row: "TB-04", name: "About (the account menu)", who: IN, via: account, target: "#nav-acctAbout" },
  { row: "TB-05", name: "Mentions inbox", who: IN, via: ["#inboxTrigger"], target: "#inboxList", notFor: ["visitor"], notTarget: "#inboxTrigger" },
  { row: "TB-06", name: "The account menu", who: IN, via: account, target: "#nav-accountMenu" },
  { row: "TB-10", name: "Light mode (visitors: the header's sun)", who: ["visitor"], target: "#nav-look" },
  { row: "TB-10", name: "Light mode (the account menu)", who: IN, via: account, target: "#nav-acctLook" },
  { row: "TB-08", name: "Discover / Live: to Live", who: ALL, widths: WIDE, mode: "discover", via: ['#modeTabs [data-mode="live"]'], target: "#stage", hash: "#live" },
  { row: "TB-08", name: "Discover / Live: to Discover", who: ALL, widths: WIDE, via: ['#modeTabs [data-mode="discover"]'], target: "#dBrowse", hash: "#discover" },
  // the left column folded into a toolbar (wide screens), and back: its button opens it again (close)
  { row: "TB-11", name: "Fold the left column into a toolbar", who: ALL, widths: WIDE, via: ["#nav-railBtn"], target: "#nav-railPeople", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: who's here, with names, over the middle", who: IN, widths: WIDE, via: ["#nav-railBtn", "#nav-railPeople"], target: "#usersDJs .prson .ft-avatar", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: who's here, with names, over the middle (visitors)", who: ["visitor"], widths: WIDE, via: ["#nav-railBtn", "#nav-railPeople"], target: "#pe-here .pe-row", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: Discover's search, over the middle", who: ALL, widths: WIDE, mode: "discover", via: ["#nav-railBtn", "#dSearch"], target: "#dQ", close: ["#nav-railBtn"] },
  // folded: community on the toolbar; a member's light mode, about and shortcuts in the account menu (a visitor's on the toolbar)
  { row: "TB-11", name: "Toolbar: community", who: ALL, widths: WIDE, via: ["#nav-railBtn", "#socialTrigger"], target: "#socialPopover", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: light mode (the account menu)", who: IN, widths: WIDE, via: ["#nav-railBtn", "#loggedInUser"], target: "#nav-acctLook", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: about (the account menu)", who: IN, widths: WIDE, via: ["#nav-railBtn", "#loggedInUser"], target: "#nav-acctAbout", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: shortcuts (the account menu)", who: IN, widths: WIDE, via: ["#nav-railBtn", "#loggedInUser", "#nav-acctHelp"], target: "#helpBox", close: [] },
  { row: "TB-11", name: "Toolbar: open the column (the account menu)", who: IN, widths: WIDE, via: ["#nav-railBtn", "#loggedInUser", "#nav-acctRail"], target: "#usersDJs .prson .prsnName" },
  { row: "TB-11", name: "Toolbar: light mode and about (visitors)", who: ["visitor"], widths: WIDE, via: ["#nav-railBtn", "#nav-look"], target: "#roomInfo", close: ["#nav-look", "#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: who's here, then collapse it back to the toolbar", who: ALL, widths: WIDE, via: ["#nav-railBtn", "#nav-railPeople", "#nav-railBtn"], target: "#nav-railPeople", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: mentions", who: IN, widths: WIDE, via: ["#nav-railBtn", "#inboxTrigger"], target: "#inboxList", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: your account", who: IN, widths: WIDE, via: ["#nav-railBtn", "#loggedInUser"], target: "#nav-accountMenu", close: ["#nav-railBtn"] },
  { row: "TB-11", name: "Toolbar: Discover's pages", who: ALL, widths: WIDE, mode: "discover", via: ["#nav-railBtn", '#dNav [data-view="charts"]'], target: "#dBrowse", hash: "#discover/charts", close: ["#nav-railBtn"] },
  // a smaller computer screen starts with it folded once the device has signed in (Round 5): its button opens it
  { row: "TB-11", name: "A smaller screen: it starts folded once signed in here; the button opens it", who: IN, widths: [1024], start: "default", via: ["#nav-railBtn"], target: "#usersDJs .prson .prsnName" },
  // ── phones: the bottom tab bar (NV-01): Discover · Live · Library · You (Round 5, November 25, 2026) ──
  { row: "NV-01", name: "Tab bar: Discover (from Live, the page you left)", who: ALL, widths: PHONE, via: ['#nav-tabs [data-tab="discover"]'], target: "#dBrowse", hash: "#discover" },
  { row: "NV-01", name: "Tab bar: Discover again: Home, with its pages as tiles", who: ALL, widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="discover"]'], target: '#dBrowse .d-tiles [data-view="years"]', hash: "#discover" },
  { row: "NV-01", name: "Tab bar: Live", who: ALL, widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="live"]'], target: "#stage", hash: "#live" },
  { row: "NV-01", name: "Tab bar: Library", who: IN, widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="library"]'], target: "#mainqueue", hash: "#live" },
  { row: "NV-01", name: "Tab bar: Library (visitors: their crate, over Discover)", who: ["visitor"], widths: PHONE, via: ['#nav-tabs [data-tab="library"]'], target: "#dSide .d-listpanel", hash: "#discover" },
  { row: "NV-01", name: "Tab bar: You (the account menu)", who: IN, widths: PHONE, via: ['#nav-tabs [data-tab="you"]'], target: "#nav-accountMenu" },
  { row: "NV-01", name: "Tab bar: You (join or log in)", who: ["visitor"], widths: PHONE, via: ['#nav-tabs [data-tab="you"]'], target: "#joinBox #newemail" },
  { row: "AU-02", name: "Join or log in", who: ["visitor"], via: ["#nav-signin"], target: "#joinBox #newemail", notFor: IN, notTarget: "#nav-signin" },
  { row: "AU-07", name: "Profile: change username", who: IN, via: [...account, '#nav-accountMenu [data-acct="profile-tab"]'], target: "#changeUsername" },
  // AU-08, members choosing their avatar style: retired (the owner, November 19, 2026); a supermod sets everyone's (MO-05)
  { row: "AU-12", name: "Profile: build your Bouletmaton", who: IN, via: [...account, '#nav-accountMenu [data-acct="profile-tab"]', "#ac-bouletEdit"], target: "#bm-builderBox #bm-save" },
  { row: "AU-11", name: "Account: email, password", who: IN, via: [...account, '#nav-accountMenu [data-acct="account-tab"]'], target: "#ac-passForm" },
  { row: "AU-09", name: "Log out", who: IN, via: account, target: "#nav-logout" },
  { row: "CH-13", name: "Shortcuts and commands", who: IN, via: [...account, "#nav-acctHelp"], target: "#helpBox .helpKeys" },
  { row: "SE-*", name: "Settings", who: IN, via: [...account, '#nav-accountMenu [data-acct="settings-tab"]'], target: "#densityPicker" },
  { row: "TB-10", name: "Light mode (Settings: Look)", who: IN, via: [...account, '#nav-accountMenu [data-acct="settings-tab"]'], target: "#lookPicker" },
  { row: "MO-05", name: "Mod tools: everyone's avatar style (supermods)", who: ["mod"], via: [...account, '#nav-accountMenu [data-acct="mod-tab"]'], target: "#mo-avatarStyle" },
  { row: "MO-01", name: "Mod tools: suspend a user (supermods)", who: ["mod"], via: [...account, '#nav-accountMenu [data-acct="mod-tab"]'], target: "#supercopSearch" },

  // ── the stage and its tools (ST, NP), in the player bar since 2.3c ──
  { row: "ST-02", name: "The DJs on the stage", who: ALL, target: "#deck .avtr" },
  // phones: the DJs up next and the open spots are in the People tab
  { row: "ST-03", name: "Hop on the decks (an open spot)", who: ["member", "mod"], via: peopleTab, target: "#ondeck .ondeck-slot.empty" },
  { row: "ST-05", name: "Screen: video, art, off", who: ALL, widths: WIDE, target: "#screenControl" },
  { row: "ST-05", name: "Screen: video, art, off (phone: in the full-screen player)", who: ALL, widths: PHONE, via: full, target: "#screenControl" },
  { row: "ST-06", name: "Volume", who: ALL, widths: WIDE, target: "#pv-vol" },
  // the room's reload: at the full-screen player's top, with its screen and cast (Round 5: the bar shows it only while a song stalls)
  { row: "ST-07", name: "Reload audio (the full-screen player)", who: ALL, widths: WIDE, via: ["#fullscreenBtn"], target: "#pv-full #reloadtrack" },
  { row: "ST-07", name: "Reload audio (phone: the full-screen player)", who: ALL, widths: PHONE, via: full, target: "#pv-full #reloadtrack" },
  { row: "ST-08", name: "Full screen", who: ALL, widths: WIDE, via: ["#fullscreenBtn"], target: "#pv-full" },
  { row: "ST-08", name: "Full screen (phone: tap the bar)", who: ALL, widths: PHONE, via: full, target: "#pv-full" },
  { row: "ST-08b", name: "Play on a speaker or TV", who: ALL, widths: WIDE, via: ["#st-cast"], target: "#st-castWays" },
  { row: "ST-08b", name: "Play on a speaker or TV (phone: from the full-screen player)", who: ALL, widths: PHONE, via: [...full, "#st-cast"], target: "#st-castWays" },
  { row: "ST-09", name: "Fire", who: IN, target: "#fire" },
  { row: "ST-11", name: "Grab to a playlist", who: IN, via: ["#grab"], target: "#stealpicker" },
  { row: "ST-11", name: "Grab: choose the playlist (▾)", who: IN, widths: WIDE, via: ["#st-grabPick"], target: "#stealpicker" },
  // phones (4.2): the ▾ is in the full-screen player's More; the bar's Grab and its toast's Change open the picker too
  { row: "ST-11", name: "Grab: choose the playlist (▾, phone: the full-screen player's More)", who: IN, widths: PHONE, via: [...fullMore, "#st-grabPick"], target: "#stealpicker" },
  { row: "ST-12", name: "Open the song on YouTube or SoundCloud", who: IN, widths: WIDE, target: "#songlink" },
  { row: "ST-12", name: "Open the song (phone: the full-screen player's More)", who: IN, widths: PHONE, via: fullMore, target: "#songlink" },
  { row: "ST-13", name: "Skip your own song (phone: the full-screen player's More)", who: ["dj"], widths: PHONE, via: [...fullMore, "#skipTrigger"], target: "#skipPopover .skipNowAction" },
  { row: "ST-13", name: "Skip your own song", who: ["dj"], widths: WIDE, via: ["#skipTrigger"], target: "#skipPopover .skipNowAction", notFor: ["member"], notTarget: "#skipTrigger" },
  { row: "ST-14", name: "Mod tools on the song (phone: the full-screen player's More)", who: ["mod"], widths: PHONE, via: [...fullMore, "#npModBtn"], target: "#npFixTags" },
  { row: "ST-14", name: "Mod tools on the song: skip, fix tags, flag", who: ["mod"], widths: WIDE, via: ["#npModBtn"], target: "#npFixTags", notFor: ["member", "dj"], notTarget: "#npModBtn" },
  { row: "DJ-06", name: "Mod tools on the song: remove the playing DJ (1.7)", who: ["mod"], widths: WIDE, via: ["#npModBtn"], target: "#npRemoveDj" },
  { row: "DJ-06", name: "Mod tools on the song: add someone to the decks (1.7)", who: ["mod"], widths: WIDE, via: ["#npModBtn", "#npAddDj"], target: "#npAddDjFind" },
  { row: "DJ-06", name: "Mod tools on the song: add someone (phone: the full-screen player's More)", who: ["mod"], widths: PHONE, via: [...fullMore, "#npModBtn", "#npAddDj"], target: "#npAddDjFind" },
  { row: "ST-24", name: "A DJ's user card (from the DJs up next)", who: IN, via: [...peopleTab, "#ondeck .ondeck-slot:not(.empty)"], target: "#ft-user-tip" },
  // phones: a member's stage is on Live's Chat tab (the lists have the screen on the others)
  { row: "NP-01", name: "The song's title and artist", who: ALL, via: chatTab, target: "#track" },
  { row: "NP-02", name: "Plays here", who: ALL, widths: WIDE, target: "#playStats" },
  { row: "NP-02", name: "Plays here (phone: the full-screen player)", who: ALL, widths: PHONE, via: full, target: "#pv-fhist" },
  { row: "NP-08", name: "The song sheet from the player", who: ALL, widths: WIDE, via: ["#pv-title .d-sheetlink"], target: ".d-sheet" },
  { row: "NP-08", name: "The song sheet (phone: tap the bar, then the title)", who: ALL, widths: PHONE, via: [...full, "#pv-ftitle .d-sheetlink"], target: ".d-sheet" },

  // ── decks, people, chat (DJ, PE, CH) ──
  { row: "DJ-01", name: "Which playlist you DJ from", who: IN, via: chatTab, target: "#djlistpicker" },
  // the same choice from the crate, the only one-tap way in Discover and a phone's Library, and from All playlists
  { row: "DJ-01", name: "DJ from the list on screen (the crate's switch)", who: IN, via: playlists, target: "#cr-djTag" },
  { row: "DJ-01", name: "DJ from the list on screen (the crate's switch, in Discover)", who: IN, widths: WIDE, mode: "discover", target: "#cr-djTag" },
  { row: "DJ-01", name: "DJ from any list (All playlists' headphones)", who: IN, via: [...listMenu, '#cr-listMenu [data-act="all"]'], target: "#plIndexList .plx-dj" },
  { row: "DJ-03", name: "The waitlist", who: IN, via: peopleTab, target: "#usersWaitlist" },
  { row: "PE-01", name: "The people in the room", who: IN, via: peopleTab, target: "#allUsers" },
  { row: "CH-01", name: "Chat", who: IN, via: chatTab, target: "#chats" },
  { row: "CH-01", name: "Chat: write a message", who: IN, via: chatTab, target: "#newchat" },
  { row: "CH-06", name: "Emoji picker", who: IN, via: [...chatTab, "#pickEmoji"], target: "#pickerSearch" },

  // ── playlists (CR) ──
  { row: "CR-01", name: "Switch playlist", who: IN, via: playlists, target: "#listpicker" },
  { row: "CR-02", name: "Playlist rows", who: IN, via: playlists, target: "#mainqueue .pvbar" },
  { row: "CR-03", name: "Row: send to top", who: IN, via: playlists, target: "#mainqueue .pvbar .bumpsongs" },
  { row: "CR-04", name: "Row: ⋮ menu (bottom, add, edit tags, swap, open, delete)", who: IN, via: [...playlists, "#mainqueue .pvbar .row-more"], target: "#trackMenuPopover" },
  // Bottom, Open, Add and Delete are on the row only where a mouse points (round 5, November 25, 2026); ⋮ has them everywhere
  { row: "CR-03", name: "Row: send to bottom (⋮)", who: IN, via: [...playlists, "#mainqueue .pvbar .row-more"], target: '#trackMenuPopover [data-act="bottom"]' },
  { row: "CR-03", name: "Row: open on YouTube or SoundCloud (⋮)", who: IN, via: [...playlists, "#mainqueue .pvbar .row-more"], target: '#trackMenuPopover [data-act="open"]' },
  { row: "CR-03", name: "Row: add to another playlist (⋮)", who: IN, via: [...playlists, "#mainqueue .pvbar .row-more", '#trackMenuPopover [data-act="add"]'], target: "#stealpicker" },
  { row: "CR-03", name: "Row: delete (⋮)", who: IN, via: [...playlists, "#mainqueue .pvbar .row-more", '#trackMenuPopover [data-act="delete"]'], target: "#deleteSongPopover .deleteSongConfirm" },
  { row: "CR-07", name: "Filter the playlist", who: IN, via: playlists, target: "#queueFilter" },
  { row: "CR-07", name: "Show only: Remixes, Broken", who: IN, via: [...playlists, "#cr-showOnly"], target: "#cr-showOnlyMenu" },
  { row: "CR-08", name: "Find tracks", who: IN, via: [...playlists, "#addToQueueBttn"], target: "#qsearch", close: ["#cancelqsearch"] },
  { row: "CR-10", name: "Shuffle", who: IN, via: [...listMenu, '#cr-listMenu [data-act="shuffle"]'], target: "#shuffleQueuePopover" },
  { row: "CR-11", name: "Merge playlists", who: IN, via: [...listMenu, '#cr-listMenu [data-act="merge"]'], target: "#mergepicker", close: ['#cr-listBtn', '#cr-listMenu [data-act="merge"]'] },
  { row: "CR-12", name: "New playlist", who: IN, via: [...listMenu, '#cr-listMenu [data-act="new"]'], target: "#plmaker", close: ["#plAddLauncher"] },
  { row: "CR-12", name: "Import a playlist", who: IN, via: [...listMenu, '#cr-listMenu [data-act="import"]'], target: "#importPromptBox #importSources" },
  { row: "IM-04", name: "Import a list of songs", who: IN, via: [...listMenu, '#cr-listMenu [data-act="import"]', "#listimportchoice"], target: "#im-listText" },
  { row: "IM-05", name: "Import a Spotify playlist (when the bot's Spotify keys work)", who: IN, via: [...listMenu, '#cr-listMenu [data-act="import"]', "#spimportchoice"], target: "#im-spLink" },
  // (off for the built-in list, which the test views)
  { row: "CR-13", name: "Delete this playlist", who: IN, via: listMenu, target: '#cr-listMenu [data-act="delete"]' },
  { row: "CR-14", name: "All playlists", who: IN, via: [...listMenu, '#cr-listMenu [data-act="all"]'], target: "#plIndexList" },
  { row: "CR-17", name: "Check for broken tracks", who: IN, via: listMenu, target: '#cr-listMenu [data-act="check"]' },
  { row: "CR-21", name: "Remove duplicates", who: IN, via: listMenu, target: '#cr-listMenu [data-act="dupes"]' },
  { row: "CR-25", name: "Rename this playlist", who: IN, via: [...listMenu, '#cr-listMenu [data-act="rename"]'], target: "#cr-renameInput" },
  { row: "CR-28", name: "Export the playlist as a list of songs", who: IN, via: listMenu, target: '#cr-listMenu [data-act="export"]' },
  { row: "CR-07", name: "Show only: Duplicates", who: IN, via: [...playlists, "#cr-showOnly"], target: "#cr-dupesOnly" },
  { row: "CR-07", name: "Show only: Not played here yet", who: IN, via: [...playlists, "#cr-showOnly"], target: "#cr-unplayedOnly" },
  { row: "CR-30", name: "Select several: Top, Bottom, Copy to…, Delete", who: IN, via: [...playlists, "#cr-select"], target: "#cr-bulkTop" },
  { row: "CR-29", name: "Sort the playlist (view only)", who: IN, via: [...playlists, "#cr-sort"], target: '#cr-sortMenu input[value="artist"]' },

  // ── Recent, Fresh, Cards (RE) ──
  { row: "RE-01", name: "Recent plays", who: IN, via: ["#mm-history"], target: "#thehistory .pvbar" },
  { row: "RE-02", name: "Filter Recent", who: IN, via: ["#mm-history"], target: "#histFilter" },
  // Discover's Recent plays links members to every play, in Live's Recent (where the mods' tools for a past play are)
  { row: "RE-01", name: "Recent plays (Discover's Recent plays: See every play in Live)", who: IN, mode: "discover", via: [...pages("recent"), '#dBrowse a[data-live="history"]'],
    target: "#thehistory .pvbar", hash: "#live" },
  { row: "RE-04", name: "Fresh", who: IN, widths: WIDE, via: ["#mm-discover"], target: "#thediscovers" },
  { row: "RE-04", name: "Fresh (visitors: beside the welcome)", who: ["visitor"], widths: WIDE, target: "#thediscovers" },
  // phones: Fresh is a tile on Discover's Home (Round 5), opening Live's Fresh with the screen to itself
  { row: "RE-04", name: "Fresh (phone: its tile on Discover's Home)", who: ALL, widths: PHONE, mode: "discover", via: ['#dBrowse .d-tile[data-view="fresh"]'], target: "#thediscovers", hash: "#live" },
  { row: "RE-05", name: "Cards", who: IN, via: ["#mm-cards"], target: "#cardsMain" },
  // visitors in Live: tabs showing what joining opens, and the room's recent plays
  { row: "DI-16", name: "Live for visitors: Join, and what joining opens", who: ["visitor"], target: "#dLocked [data-locked]" },
  { row: "DI-16", name: "Live for visitors: Recent", who: ["visitor"], via: ['#dLocked [data-locked="recent"]'], target: ".d-lockedlist" },

  // ── Discover (DI) ──
  { row: "DI-12", name: "Search", who: ALL, mode: "discover", target: "#dQ" },
  { row: "DI-01", name: "Home", who: ALL, mode: "discover", target: "#dBrowse .ft-cards .pvbar" },
  { row: "DI-02", name: "New", who: ALL, mode: "discover", via: pages("new"), hash: "#discover/new", target: "#dBrowse .pvbar" },
  { row: "DI-03", name: "Charts", who: ALL, mode: "discover", via: pages("charts"), hash: "#discover/charts", target: "#dBrowse .pvbar" },
  // Genres opens on its grid; the sound map is behind Grid | Map (the owner, November 25, 2026)
  { row: "DI-04", name: "Genres (its grid)", who: ALL, mode: "discover", via: pages("genres"), hash: "#discover/genres", target: "#dBrowse .d-gcard" },
  { row: "DI-26", name: "Genres: the sound map (Map)", who: ALL, mode: "discover", via: [...pages("genres"), '#dBrowse .d-segbtn[data-gview="map"]'], hash: "#discover/genres", target: "#dBrowse .d-mapg" },
  { row: "DI-06", name: "DJs", who: ALL, mode: "discover", via: pages("djs"), hash: "#discover/djs", target: "#dBrowse" },
  { row: "DI-08", name: "Years", who: ALL, mode: "discover", via: pages("years"), hash: "#discover/years", target: "#dBrowse" },
  { row: "DI-10", name: "Theme nights", who: ALL, mode: "discover", via: pages("themes"), hash: "#discover/themes", target: "#dBrowse" },
  { row: "DI-11", name: "Recent plays", who: ALL, mode: "discover", via: pages("recent"), hash: "#discover/recent", target: "#dBrowse .pvbar" },
  { row: "DI-13", name: "The player bar", who: ALL, mode: "discover", target: "#dMini .pb-main" },
  { row: "DI-14", name: "Listen live / stop the room", who: ALL, mode: "discover", target: "#dMini .pb-main" },
  { row: "DI-27", name: "The full-screen player", who: ALL, widths: WIDE, mode: "discover", via: ["#fullscreenBtn"], target: "#pv-full" },
  { row: "DI-27", name: "The full-screen player (phone: tap the bar)", who: ALL, widths: PHONE, mode: "discover", via: full, target: "#pv-full" },
  { row: "DI-19", name: "A song's ⋮ menu", who: ALL, mode: "discover", via: ["#dBrowse .pvbar .d-more"], target: "#dMenu" },
  // Home's lead song keeps its own ⋮ and save on its cover, at every width; the week's Play and Save all are
  // New this week's heading's (Round 5, November 25, 2026)
  { row: "DI-19", name: "Home: the lead song's ⋮ (on its cover)", who: ALL, mode: "discover", via: ["#dBrowse .d-lead .d-leadart .d-more"], target: "#dMenu" },
  { row: "DI-01", name: "Home: the lead song's save (on its cover)", who: ALL, mode: "discover", target: "#dBrowse .d-lead .d-leadart .histeal" },
  { row: "DI-18", name: "Home: Play the week's N (New this week's heading)", who: ALL, mode: "discover", target: "#dBrowse .d-week .d-head .d-playall" },
  { row: "DI-18", name: "Home: Save all (New this week's heading)", who: ALL, mode: "discover", target: "#dBrowse .d-week .d-head .d-saveall" },
  // a cover's ⋮ and save: over its corner with a mouse, under the song's name on a touch screen (round 5, November 25, 2026)
  { row: "DI-19", name: "A cover's ⋮ (phones: under the song's name)", who: ALL, widths: PHONE, mode: "discover", via: ["#dBrowse .d-compact .pvbar .d-more"], target: "#dMenu" },
  { row: "DI-01", name: "A cover's save (phones: under the song's name)", who: ALL, widths: PHONE, mode: "discover", target: "#dBrowse .d-compact .pvbar .histeal" },
  { row: "DI-17", name: "Members' playlist beside the player", who: IN, widths: WIDE, mode: "discover", target: "#dSide" },
  { row: "DI-15", name: "Visitors' crate", who: ["visitor"], widths: WIDE, mode: "discover", target: "#dSide" },
  // the right column folds to a strip and opens again, from its button (its open icon shows only folded; Round 5)
  { row: "DI-17", name: "Members' playlist: fold the right column, and open it again", who: IN, widths: WIDE, mode: "discover", via: ["#nav-sideBtn", "#nav-sideBtn .nav-sideOpen"], target: "#dSide #mainqueue .pvbar" },
  { row: "DI-15", name: "Visitors' crate: fold the right column, and open it again", who: ["visitor"], widths: WIDE, mode: "discover", via: ["#nav-sideBtn", "#nav-sideBtn .nav-sideOpen"], target: "#dSide .d-listpanel" },
  // while a visitor's crate is empty, the room over its note (Round 5, November 25, 2026); never for members
  { row: "DI-23", name: "The room, in a visitor's empty crate column", who: ["visitor"], widths: WIDE, mode: "discover", target: "#pv-onair", notFor: IN, notTarget: "#pv-onair" },
  // last, as it leaves a Discover pick playing: a pick's reload is in its ⋮ (the bar's on computers; on
  // phones the full-screen player's, behind More), as the bar shows its own only while the song stalls
  { row: "ST-07", name: "Reload audio (a playing pick's ⋮)", who: ALL, widths: WIDE, mode: "discover", via: ["#dBrowse .d-week .d-head .d-playall", "#dMini .d-more"], target: '#dMenu [data-act="reload"]' },
  { row: "ST-07", name: "Reload audio (phone: a playing pick's ⋮, in the full-screen player's More)", who: ALL, widths: PHONE, mode: "discover", via: ["#dBrowse .ft-cards .pvbar .d-play", ...fullMore, "#pv-facts .d-more"], target: '#dMenu [data-act="reload"]' },
  // phones (Round 5): a visitor's crate is the tab bar's Library; a member's chat in Discover is a sheet from the full-screen player
  { row: "DI-15", name: "Visitors' crate (phone: the tab bar's Library)", who: ["visitor"], widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="library"]'], target: "#dSide .d-listpanel" },
  { row: "DI-17", name: "Members' chat in Discover (phone: the full-screen player's More, Playlists, then Chat)", who: IN, widths: PHONE, mode: "discover",
    via: [...fullMore, "#pv-full .pvf-list", '#dSide [data-sidetab="chat"]'], target: "#dSide #newchat" }
].filter((f) => !ONLY || ONLY.some((o) => f.row.startsWith(o)));

// ── the room ────────────────────────────────────────────────────────────────
const now = Date.now();
const people = {
  member: { email: "mira@reach.test", name: "mira" },
  dj: { email: "rook@reach.test", name: "rook" },
  // a supermod: a mod's tools, and the account menu's Mod tools (supermods only)
  mod: { email: "modsy@reach.test", name: "modsy", mod: true, supermod: true }
};
for (const p of Object.values(people)) p.uid = await authAccount(p.email, PASSWORD);
const { data, decks } = livedIn(now, people);
await put("/", data);
const setDecks = async (d) => { for (const [k, v] of Object.entries(d)) await put("/" + k, v); };

/** Is `sel` on screen and not covered: the topmost element at its middle is it, or inside it. */
async function onScreen(page, sel, timeout = 3000) {
  const loc = page.locator(sel).first();
  try { await loc.waitFor({ state: "visible", timeout }); } catch (e) { return "not visible"; }
  await loc.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
  // a person taps once the page has stopped moving: let the scroll's own events
  // (Discover closes an open ⋮ menu on a scroll) arrive before the tap, not after it
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return "off screen";
    // something a person can tap: the middle of the part on screen, or near its top left
    // (a long list's middle can sit under the player bar; an avatar's corner is see-through)
    const top = Math.max(r.top, 0), left = Math.max(r.left, 0);
    const bottom = Math.min(r.bottom, innerHeight), right = Math.min(r.right, innerWidth);
    const points = [[(left + right) / 2, (top + bottom) / 2], [left + Math.min((right - left) / 2, 20), top + Math.min((bottom - top) / 2, 20)]];
    let hit = null;
    for (const [x, y] of points) {
      hit = document.elementFromPoint(Math.min(innerWidth - 1, x), Math.min(innerHeight - 1, y));
      if (!hit || el === hit || el.contains(hit) || hit.contains(el)) return "";
    }
    return "covered by " + (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + (hit.className && typeof hit.className === "string" ? "." + hit.className.trim().split(/\s+/).join(".") : ""));
  });
}

/**
 * Back to a known state: menus, popovers, dialogs and the full-screen player
 * closed, both side columns open; or with `start` "default", the left column
 * as the device finds it with no choice kept (a reload).
 */
async function reset(page, mode, start) {
  if (start === "default") {
    await page.evaluate(() => localStorage.removeItem("firetableRail"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.firetable && firetable.started && window.ftapi && ftapi.uid && document.querySelector("#mainqueue .pvbar"), null, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll(":popover-open").forEach((p) => { try { p.hidePopover(); } catch (e) { /* fine */ } });
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    if (window.firetable && firetable.discover && firetable.discover.state().full) firetable.discover.closeFull();
    document.body.classList.remove("d-sheet-open");
  });
  // the left column open (TB-11 folds it). From 1024 to 1369px it starts folded once the device has signed
  // in, so opening it here is kept as a person's choice ("0"): it stays open after a reload, as before
  if (start !== "default") {
    await page.evaluate(() => firetable.rail.isOn() && firetable.rail.set(false));
    await page.waitForFunction(() => !document.documentElement.classList.contains("rail"), null, { timeout: 3000 }).catch(() => {});
  }
  // Discover's right column open (DI-17 folds it)
  await page.evaluate(() => firetable.sidePanel.isShut() && firetable.sidePanel.set(false));
  await page.waitForFunction(() => { const f = document.getElementById("pv-full"); return !f || !f.checkVisibility(); }, null, { timeout: 3000 }).catch(() => {});
  const want = mode === "discover" ? "#discover" : "#live";
  if (await page.evaluate(() => firetable.discover.address()) !== want) await page.evaluate((h) => { location.hash = h; }, want);
  await sleep(250);
  // phones: Live's own tabs, out of the Library tab and Fresh (each has the screen to itself)
  const tapped = mode !== "discover" && await page.evaluate(() => {
    const b = document.querySelector('#nav-tabs [data-tab="live"]');
    if (!b || !b.offsetParent || !/\bnt-(library|fresh)\b/.test(document.body.className)) return false;
    b.click();
    return true;
  });
  if (tapped) await sleep(450);
}

const browser = await chromium.launch(launchOptions());
const { server, SITE } = await serveSite({ csp: policy({ auth: true }), configJs: config(NS) });
let checked = 0;
const failures = [];
const known = new Set();
try {
  for (const role of ROLES) {
    for (const w of WIDTHS) {
      await setDecks(role === "dj" ? decks.mine(people.dj) : decks.normal());
      const phone = w < 640;
      const context = await browser.newContext({ viewport: SIZES[w] || { width: w, height: 900 }, isMobile: phone, hasTouch: phone });
      await cachePictures(context);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await useAuthEmulator(page);
      await openPage(page, SITE);
      if (role === "visitor") await page.waitForFunction(() => document.querySelectorAll("#dBrowse .ft-cards .pvbar").length > 0, null, { timeout: 30000 });
      else {
        await logInAs(page, people[role].email, PASSWORD, people[role].uid);
        await page.waitForFunction(() => ftapi.users && Object.keys(ftapi.users).length > 3 && document.querySelector("#mainqueue .pvbar"), null, { timeout: 20000 }).catch(() => {});
        // A refresh in Live keeps Live's playlist panel there (signing in on
        // load put it in Discover's hidden column until you went there and back)
        if (role === "member") {
          await page.evaluate(() => { location.hash = "#live"; });
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForFunction((u) => window.ftapi && ftapi.uid === u && document.body.classList.contains("d-member") && document.querySelector("#mainqueue .pvbar"), people[role].uid, { timeout: 30000 }).catch(() => {});
          const where = await page.evaluate(() => ({ mode: firetable.discover.state().mode, away: document.body.classList.contains("d-queue-here") }));
          if (where.mode !== "live" || where.away) failures.push(role + " " + w + ": after a refresh in Live, its playlist panel isn't in Live (" + JSON.stringify(where) + ")");
        }
      }
      console.log("-- " + role + " at " + w + " wide");
      for (const f of FEATURES) {
        if (f.widths && !f.widths.includes(w)) continue;
        const has = f.who.includes(role);
        const mustNot = f.notFor && f.notFor.includes(role);
        if (!has && !mustNot) continue;
        checked++;
        await reset(page, f.mode, f.start);
        const label = f.row + " " + f.name;
        if (mustNot) {
          const shown = await onScreen(page, f.notTarget, 300);
          if (!shown) failures.push(role + " " + w + ": " + label + ": " + f.notTarget + " shows, but shouldn't for a " + role);
          continue;
        }
        let why = "";
        if (f.known) { known.add(f.row + " " + f.name + ": " + f.known); continue; }
        for (const step of f.via || []) {
          const optional = step.startsWith("?");
          const sel = optional ? step.slice(1) : step;
          const state = await onScreen(page, sel, optional ? 200 : 3000);
          if (state) {
            if (optional) continue;
            why = "can't tap " + sel + " (" + state + ")";
            break;
          }
          // onScreen has checked it's in sight and not covered; force, since Playwright
          // won't tap something that moves (the DJs bob to the beat)
          try { await page.locator(sel).first().click({ timeout: 3000, force: true }); } catch (e) { why = "tapping " + sel + " failed: " + e.message.split("\n")[0]; break; }
          await sleep(250);
        }
        if (!why) {
          const state = await onScreen(page, f.target);
          if (state) why = f.target + " " + state + (f.via ? " after " + f.via.join(" → ") : "");
        }
        if (!why && f.hash && !(await page.evaluate(() => firetable.discover.address())).startsWith(f.hash)) why = "the address is " + await page.evaluate(() => firetable.discover.address()) + ", not " + f.hash;
        if (why) failures.push(role + " " + w + ": " + label + ": " + why);
        else if (f.close) for (const c of f.close) await page.locator(c).first().click({ timeout: 1000 }).catch(() => {});
        process.stdout.write(why ? "x" : ".");
      }
      console.log("");
      if (errors.length) failures.push(role + " " + w + ": page errors: " + [...new Set(errors)].join("; "));
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log("\n" + checked + " checks, " + failures.length + " failed");
if (known.size) console.log("  Known gaps (not failed; listed in the inventory):\n  - " + [...known].join("\n  - "));
if (failures.length) {
  console.log("  FAIL " + failures.join("\n  FAIL "));
  process.exitCode = 1;
}
