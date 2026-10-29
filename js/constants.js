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
/** 16:9 aspect ratio used for the YouTube player sizing */
var ASPECT_RATIO = 16 / 9;
/** Default brand colour (firetable orange) */
var COLOR_ORANGE = "#cc9933";

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
  screenControl:      "firetableScreenControl",
  avatarStyle:        "firetableAvatarStyle",
  density:            "firetableDensity",
  shareTyping:        "firetableShareTyping",
  brokenCheck:        "firetableBrokenCheck",
  lastfmSession:      "ftLastfmSession",
  navView:            "firetableNavView",
  navSide:            "firetableNavSide",
  navMobile:          "firetableNavMobile"
};

// ─── External Service URLs ──────────────────────────────────────────────────
/** Avatar / Robohash image base URL */
var AVATAR_BASE_URL = "https://indiediscotheque.com/robots/";
/**
 * Seasonal room avatar themes, checked against the visitor's local date.
 * months are 1-12. Used only when ftconfigs.avatarset is empty.
 * Override with ftconfigs.avatarSeasons, or set it to false to turn off.
 */
var AVATAR_SEASONS = [
  { months: [10], style: "set2" } // October: spooky monsters
];
/**
 * Months (1-12) when the stage string lights turn on by themselves, checked
 * against the visitor's local date. The manual "lights" switch in Firebase
 * turns them on any time of year.
 * Override with ftconfigs.lightsMonths, or set it to false to turn off.
 */
var LIGHTS_MONTHS = [12]; // December
/**
 * Months (1-12) with subtle snowfall on the stage (visitor's local date).
 * Override with ftconfigs.snowMonths, or set it to false to turn off.
 */
var SNOW_MONTHS = [1, 2]; // January and February
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
/** Legacy SoundCloud link resolver (fallback; takes the URL path as ?q=) */
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

// ─── Emoji Data Sources ─────────────────────────────────────────────────────
/** Exact versions, checked with Subresource Integrity when fetched */
var EMOJI_URLS = [
  { url: "https://unpkg.com/unicode-emoji-json@0.3.0/data-by-group.json", integrity: "sha384-d1qaRGroEtfyQyqsz7inMLNoSB7O4uGtKgKXB9DdiE1gm1xuOOxPF+ljQj/vwB0F" },
  { url: "https://unpkg.com/emojilib@2.4.0/emojis.json", integrity: "sha384-uPYLJyYHqrmSMGbd6WnbkvIvF3ta0lPsa9FU0u5mU/ea8G11HlacTMpr2IyplN2d" },
  { url: "https://unpkg.com/emojilib@3.0.4/dist/emoji-en-US.json", integrity: "sha384-SKTZEsmwjSonhLYsjUIm1DdaCmnRLA3oASU0EG7srbWYeiwjuVoD7AQNLVA+88Ux" }
];

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

// ─── Platform Logo SVGs ──────────────────────────────────────────────────────
var YT_LOGO_SVG  = '<svg aria-hidden="true" focusable="false" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" width="1em" height="1em"><path fill="currentColor" d="M549.655 124.083c-6.281-23.65-24.787-42.276-48.284-48.597C458.781 64 288 64 288 64S117.22 64 74.629 75.486c-23.497 6.322-42.003 24.947-48.284 48.597-11.412 42.867-11.412 132.305-11.412 132.305s0 89.438 11.412 132.305c6.281 23.65 24.787 41.5 48.284 47.821C117.22 448 288 448 288 448s170.78 0 213.371-11.486c23.497-6.321 42.003-24.171 48.284-47.821 11.412-42.867 11.412-132.305 11.412-132.305s0-89.438-11.412-132.305zm-317.51 213.508V175.185l142.739 81.205-142.739 81.201z"/></svg>';
var SC_LOGO_SVG  = '<svg aria-hidden="true" focusable="false" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" width="1em" height="1em"><path fill="currentColor" d="M111.4 256.3l5.8 65-5.8 68.3c-.3 2.5-2.2 4.4-4.4 4.4s-4.2-1.9-4.2-4.4l-5.6-68.3 5.6-65c0-2.2 1.9-4.2 4.2-4.2 2.2 0 4.1 2 4.4 4.2zm21.4-45.6c-2.8 0-4.7 2.2-5 5l-5 105.6 5 68.3c.3 2.8 2.2 5 5 5 2.5 0 4.7-2.2 4.7-5l5.8-68.3-5.8-105.6c0-2.8-2.2-5-4.7-5zm25.5-24.1c-3.1 0-5.3 2.2-5.6 5.3l-4.4 130 4.4 67.8c.3 3.1 2.5 5.3 5.6 5.3 2.8 0 5.3-2.2 5.3-5.3l5.3-67.8-5.3-130c0-3.1-2.5-5.3-5.3-5.3zM7.2 283.2c-1.4 0-2.2 1.1-2.5 2.5L0 321.3l4.7 35c.3 1.4 1.1 2.5 2.5 2.5s2.2-1.1 2.5-2.5l5.6-35-5.6-35.6c-.3-1.4-1.1-2.5-2.5-2.5zm23.6-21.9c-1.4 0-2.5 1.1-2.5 2.5l-6.4 57.5 6.4 56.1c0 1.7 1.1 2.8 2.5 2.8s2.5-1.1 2.8-2.5l7.2-56.4-7.2-57.5c-.3-1.4-1.4-2.5-2.8-2.5zm25.3-11.4c-1.7 0-3.1 1.4-3.3 3.3L47 321.3l5.8 65.8c.3 1.7 1.7 3.1 3.3 3.1 1.7 0 3.1-1.4 3.1-3.1l6.9-65.8-6.9-68.1c0-1.9-1.4-3.3-3.1-3.3zm25.3-2.2c-1.9 0-3.6 1.4-3.6 3.6l-5.8 70 5.8 67.8c0 2.2 1.7 3.6 3.6 3.6s3.6-1.4 3.9-3.6l6.4-67.8-6.4-70c-.3-2.2-2-3.6-3.9-3.6zm241.4-110.9c-1.1-.8-2.8-1.4-4.2-1.4-2.2 0-4.2.8-5.6 1.9-1.9 1.7-3.1 4.2-3.3 6.7v.8l-3.3 176.7 1.7 32.5 1.7 31.7c.3 4.7 4.2 8.6 8.9 8.6s8.6-3.9 8.6-8.6l3.9-64.2-3.9-177.5c-.4-3-2-5.8-4.5-7.2zm-26.7 15.3c-1.4-.8-2.8-1.4-4.4-1.4s-3.1.6-4.4 1.4c-2.2 1.4-3.6 3.9-3.6 6.7l-.3 1.7-2.8 160.8s0 .3 3.1 65.6v.3c0 1.7.6 3.3 1.7 4.7 1.7 1.9 3.9 3.1 6.4 3.1 2.2 0 4.2-1.1 5.6-2.5 1.7-1.4 2.5-3.3 2.5-5.6l.3-6.7 3.1-58.6-3.3-162.8c-.3-2.8-1.7-5.3-3.9-6.7zm-111.4 22.5c-3.1 0-5.8 2.8-5.8 6.1l-4.4 140.6 4.4 67.2c.3 3.3 2.8 5.8 5.8 5.8 3.3 0 5.8-2.5 6.1-5.8l5-67.2-5-140.6c-.2-3.3-2.7-6.1-6.1-6.1zm376.7 62.8c-10.8 0-21.1 2.2-30.6 6.1-6.4-70.8-65.8-126.4-138.3-126.4-17.8 0-35 3.3-50.3 9.4-6.1 2.2-7.8 4.4-7.8 9.2v249.7c0 5 3.9 8.6 8.6 9.2h218.3c43.3 0 78.6-35 78.6-78.3.1-43.6-35.2-78.9-78.5-78.9zm-296.7-60.3c-4.2 0-7.5 3.3-7.8 7.8l-3.3 136.7 3.3 65.6c.3 4.4 3.6 7.8 7.8 7.8 4.4 0 7.8-3.3 7.8-7.8l3.6-65.6-3.6-136.7c0-4.4-3.3-7.8-7.8-7.8z"/></svg>';
