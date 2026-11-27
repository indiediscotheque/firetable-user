/**
 * constants.js — Named constants used across the firetable application.
 *
 * Replaces magic numbers and hardcoded strings scattered throughout the
 * codebase with a single, documented source of truth.
 */

// ─── Media Types ─────────────────────────────────────────────────────────────
/** YouTube video */
var MEDIA_YOUTUBE = 1;
/** SoundCloud track */
var MEDIA_SOUNDCLOUD = 2;

// ─── Defaults ────────────────────────────────────────────────────────────────
/** Default player volume (0–100) */
var DEFAULT_VOLUME = 80;
/** How long before a user is marked idle (ms) — 5 minutes */
var IDLE_TIMEOUT = 5 * 60000;
/** How long a track preview plays before auto-stopping (ms) — 30 seconds */
var PREVIEW_DURATION = 30 * 1000;
/** Where a preview starts: a quarter of the way into the song, past the intro */
var PREVIEW_FROM = 0.25;
/** 16:9 aspect ratio used for the YouTube player sizing */
var ASPECT_RATIO = 16 / 9;
/** Default brand colour (firetable orange) */
var COLOR_ORANGE = "#cc9933";

// ─── Icons ───────────────────────────────────────────────────────────────────
/**
 * A song's save button, wherever it is (rows, cards, the bar, the stage's
 * Grab): + to save it, then, once it's in a playlist, a check in a disc,
 * filled and in the room's accent (css/looks.css, .is-saved). The plain check
 * alone has no filled form, and at a glance it looked like the +.
 */
var SAVE_ICON = "playlist_add";
var SAVED_ICON = "playlist_add_check_circle";

// ─── localStorage Keys ──────────────────────────────────────────────────────
/**
 * All localStorage key strings in one place.
 * Usage: localStorage[STORAGE.volume] instead of localStorage["firetableVol"]
 */
var STORAGE = {
  volume:             "firetableVol",
  mute:               "firetableMute",
  disableMedia:       "firetableDisableMedia",
  showImages:         "firetableShowImages",
  showAvatars:        "firetableShowAvatars",
  showSongAnnouncements: "firetableShowSongAnnouncements",
  badoop:             "firetableBadoop",
  notifyMentions:     "firetableDTNM",
  pushMentions:       "firetablePushMentions", // the uid that turned push on here
  pushEveryone:       "firetablePushEveryone",
  pushDevice:         "firetablePushDevice",   // this device's id under pushSubs/<uid>/
  pushSeen:           "firetablePushSeen",
  pushNudge:          "firetablePushNudge",
  screenControl:      "firetableScreenControl",
  avatarStyle:        "firetableAvatarStyle",
  density:            "firetableDensity",
  shareTyping:        "firetableShareTyping",
  brokenCheck:        "firetableBrokenCheck",
  listCounts:         "firetableListCounts.", // + uid: last known track counts per list
  lastfmSession:      "ftLastfmSession",
  navView:            "firetableNavView",
  navSide:            "firetableNavSide",
  navMobile:          "firetableNavMobile",
  ttSkin:             "firetableTurntable",   // "1": the Turntable theme is on, on this device (js/ttskin.js)
  ttAvatar:           "firetableTurntableAvatar", // your Turntable avatar, also kept at users/<uid>/ttAvatar
  ttLaptop:           "firetableTurntableLaptop", // your laptop's lid and stickers, also kept at users/<uid>/ttLaptop
  ttLayout:           "firetableTurntableLayout", // the theme's sidebars: "one" or "two"
  rail:               "firetableRail",        // the left column on this device, a person's choice (js/rail.js): "1" folded into a toolbar, "0" open; none: the width's default (folded on a smaller computer screen once the device has signed in). js/head.js reads it before this file loads
  side:               "firetableSide",        // "1": Discover's right column is folded to a strip on this device (js/side-panel.js). js/head.js reads it before this file loads
  look:               "firetableLook",        // light mode: "light" or "auto" (none: the dark site). js/head.js reads it before this file loads"
  guestId:            "firetableGuestId"          // a visitor's random id, so the people list counts each browser once (js/audience.js)
};

// ─── External Service URLs ──────────────────────────────────────────────────
/** Avatar / Robohash image base URL */
var AVATAR_BASE_URL = "https://indiediscotheque.com/robots/";
/**
 * The room's avatar styles, the only ones there are (a supermod picks one
 * for everyone in Mod tools). The first is the default; seasons.js makes
 * everyone a monster in October. Members' own Bouletmatons, switched on,
 * show whatever the style (helpers.js avatarURL); "bouletmaton" means robot
 * busts for everyone else. The bot's lib/avatars.js lists the same six.
 */
var AVATAR_STYLES = [
  { value: "robohash:set1", label: "Robohash robots", kind: "robohash" },
  { value: "robohash:set2", label: "Robohash monsters", kind: "robohash" },
  { value: "robohash:set4", label: "Robohash cats", kind: "robohash" },
  { value: "dicebear:notionists", label: "DiceBear Notionists", kind: "notionists" },
  { value: "dicebear:pixel-art", label: "DiceBear Pixel Art", kind: "pixel-art" },
  { value: "bouletmaton", label: "Bouletmaton (members' own; robots for the rest)", kind: "bouletmaton" }
];
var DEFAULT_AVATAR_STYLE = AVATAR_STYLES[0].value;
/**
 * The generic gray robot bust: whoever has no avatar yet. Faces are made
 * from uid + name, so a DJ known only by a name (the play history's older
 * rows, a first DJ nobody here can place now) has none; they all get this
 * one picture, never someone else's face (helpers.js avatarURL, Discover's
 * robot()). Made from Robohash's own gray robot parts
 * (tools/robot-generic.py), so it sits in its picture like every robot bust;
 * css/looks.css frames it as one whatever the room's style. Next to this
 * script's js/ folder, so it works from any page.
 */
var GENERIC_AVATAR_URL = (function () {
  var me = typeof document !== "undefined" && document.currentScript && document.currentScript.src;
  try { return new URL("../img/robot-generic.png", me || document.baseURI).href; } catch (e) { return "img/robot-generic.png"; }
})();
/**
 * This site's SoundCloud API proxy (api/soundcloud.php). Handles keyword
 * search, link resolving and playlist import with an OAuth token.
 * Override with ftconfigs.soundcloudProxyURL if it lives elsewhere.
 */
// Resolved against the page URL now, like the page's own js/ files, so the
// later history.replaceState() route changes can't break it.
var SC_API_PROXY_URL = new URL(
  (typeof ftconfigs !== "undefined" && ftconfigs.soundcloudProxyURL) || "api/soundcloud.php",
  document.baseURI
).href;
/**
 * Legacy SoundCloud link resolver (takes the URL path as ?q=). Keep it: without
 * a registered SoundCloud app (README "soundcloud") it's how pasted links and
 * playlist imports work.
 */
var SC_RESOLVE_URL = "https://thompsn.com/resolvesc/";
/** Legacy SoundCloud lookup-by-id proxy (fallback; ?type=…&q=ID) */
var SC_PROXY_URL = "https://thompsn.com/soundcloud/";
/** SoundCloud API track base URL (for the player widget; opening it in a tab gives 401) */
var SC_API_TRACK_URL = "https://api.soundcloud.com/tracks/";
/** SoundCloud's player page: a working link for tracks saved without their page URL */
var SC_PLAYER_PAGE_URL = "https://w.soundcloud.com/player/?visual=true&url=";
/**
 * This site's Last.fm signing proxy (api/lastfm.php), which keeps the app's
 * shared secret on the server. Override with ftconfigs.lastfmProxyURL if it
 * lives elsewhere.
 */
var LASTFM_PROXY_URL = new URL(
  (typeof ftconfigs !== "undefined" && ftconfigs.lastfmProxyURL) || "api/lastfm.php",
  document.baseURI
).href;
/**
 * Guests on the site and the radio stream's listeners by country, for the
 * people list (api/audience.php, js/audience.js). Override with
 * ftconfigs.audienceURL if it lives elsewhere.
 */
var AUDIENCE_URL = new URL(
  (typeof ftconfigs !== "undefined" && ftconfigs.audienceURL) || "api/audience.php",
  document.baseURI
).href;

// ─── History Limits ──────────────────────────────────────────────────────────
/** Chat messages loaded when joining (older ones are pruned by the bot anyway) */
var CHAT_HISTORY_LIMIT = 50;
/** Recent plays loaded at first; "Show older plays" loads this many more each time */
var HISTORY_PAGE_SIZE = 100;

// ─── Search Result Limits ───────────────────────────────────────────────────
/** Max results returned from YouTube / SoundCloud searches */
var SEARCH_MAX_RESULTS = 15;
/** Max results per page for YouTube playlist import pagination */
var IMPORT_PAGE_SIZE = 50;

// ─── Preview Bar Update Interval ────────────────────────────────────────────
/** How often the preview progress bar updates (ms) */
var PREVIEW_BAR_INTERVAL = 200;
/** How often the song progress bar updates (ms) */
var PROGRESS_BAR_INTERVAL = 500;
