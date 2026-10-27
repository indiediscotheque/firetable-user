// ESLint for firetable's browser scripts (plain <script> files sharing globals,
// loaded in the order listed in index.html). Run: npm run lint
import globals from "globals";

// Globals one app file defines and others use
const appGlobals = {
  ftconfigs: "readonly", firetable: "writable", ftapi: "writable", EventEmitter: "readonly",
  player: "writable", chatScroll: "readonly", $playlistItemTemplate: "writable",
  // constants.js
  MEDIA_YOUTUBE: "readonly", MEDIA_SOUNDCLOUD: "readonly", DEFAULT_VOLUME: "readonly",
  IDLE_TIMEOUT: "readonly", PREVIEW_DURATION: "readonly", ASPECT_RATIO: "readonly",
  COLOR_ORANGE: "readonly", STORAGE: "readonly", AVATAR_BASE_URL: "readonly",
  AVATAR_SEASONS: "readonly", LIGHTS_MONTHS: "readonly", SNOW_MONTHS: "readonly",
  SC_API_PROXY_URL: "readonly", SC_RESOLVE_URL: "readonly", SC_PROXY_URL: "readonly",
  SC_API_TRACK_URL: "readonly", LASTFM_API_URL: "readonly", EMOJI_URLS: "readonly",
  CHAT_HISTORY_LIMIT: "readonly", HISTORY_PAGE_SIZE: "readonly",
  SEARCH_MAX_RESULTS: "readonly", IMPORT_PAGE_SIZE: "readonly",
  PREVIEW_BAR_INTERVAL: "readonly", PROGRESS_BAR_INTERVAL: "readonly",
  YT_LOGO_SVG: "readonly", SC_LOGO_SVG: "readonly",
  // other app files
  ytAPI: "readonly", serialize: "readonly", calcMD5: "readonly", setup: "readonly",
  // third-party libraries
  firebase: "readonly", twemoji: "readonly", linkifyStr: "readonly", FloatingUIDOM: "readonly",
  IdleJs: "readonly", SC: "readonly", YT: "readonly",
  PIXI: "readonly", TweenMax: "readonly", TimelineMax: "readonly",
  Power0: "readonly", Power1: "readonly", Power2: "readonly", Bounce: "readonly"
};

// p5.js "global mode" functions used by glitch.js
const p5Globals = Object.fromEntries([
  "createCanvas", "loadImage", "background", "clear", "image", "push", "pop",
  "translate", "floor", "random", "width", "height", "loop", "noLoop"
].map((n) => [n, "readonly"]));

export default [
  { ignores: ["**/*.min.js", "js/twemoji.js", "js/md5.js", "tools/**", "node_modules/**"] },
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, $: "readonly", jQuery: "readonly", ...appGlobals }
    },
    rules: {
      "no-undef": "error",
      "no-redeclare": ["error", { builtinGlobals: false }],
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-self-assign": "error",
      "no-cond-assign": "error",
      "no-unused-vars": ["warn", { vars: "local", args: "none", caughtErrors: "none" }]
    }
  },
  { files: ["js/glitch.js"], languageOptions: { globals: p5Globals } },
  // fire.js keeps its original animation (one tween lists `ease` twice; the
  // second one is what runs). Left as is so the fire looks exactly the same.
  { files: ["js/fire.js"], rules: { "no-dupe-keys": "off", "no-redeclare": "off" } }
];
