// ESLint for firetable's browser scripts (plain <script> files sharing globals,
// loaded in the order listed in index.html). Run: npm run lint
import globals from "globals";
import { readFileSync } from "fs";

// File and function length (tools/line-limits.mjs, CLAUDE.md "File size"): 500
// lines of code a file and 80 a function, comments and blank lines not counted.
// Files already over keep their own cap, which only goes down; their long
// functions show as warnings (to split when they're next changed).
const LIMITS = JSON.parse(readFileSync(new URL("./tools/line-limits.json", import.meta.url), "utf8"));
const COUNTED = { skipBlankLines: true, skipComments: true };
const sizeRules = Object.entries(LIMITS).filter(([file]) => file !== "//").map(([file, cap]) => ({
  files: [file],
  rules: {
    "max-lines": ["error", { max: Math.max(500, cap.lines || 0), ...COUNTED }],
    ...(cap.longFunctions ? { "max-lines-per-function": ["warn", { max: 80, ...COUNTED, IIFEs: false }] } : {})
  }
}));

// Globals one app file defines and others use
const appGlobals = {
  ftconfigs: "readonly", firetable: "writable", ftapi: "writable", EventEmitter: "readonly",
  player: "writable", chatScroll: "readonly", chatPinned: "writable", $playlistItemTemplate: "writable",
  // constants.js
  MEDIA_YOUTUBE: "readonly", MEDIA_SOUNDCLOUD: "readonly", DEFAULT_VOLUME: "readonly",
  IDLE_TIMEOUT: "readonly", PREVIEW_DURATION: "readonly", ASPECT_RATIO: "readonly",
  COLOR_ORANGE: "readonly", STORAGE: "readonly", AVATAR_BASE_URL: "readonly",
  AVATAR_STYLES: "readonly", DEFAULT_AVATAR_STYLE: "readonly", GENERIC_AVATAR_URL: "readonly", Bouletmaton: "readonly",
  SC_API_PROXY_URL: "readonly", SC_RESOLVE_URL: "readonly", SC_PROXY_URL: "readonly",
  SC_API_TRACK_URL: "readonly", SC_PLAYER_PAGE_URL: "readonly", LASTFM_PROXY_URL: "readonly", AUDIENCE_URL: "readonly",
  CHAT_HISTORY_LIMIT: "readonly", HISTORY_PAGE_SIZE: "readonly",
  SEARCH_MAX_RESULTS: "readonly", IMPORT_PAGE_SIZE: "readonly",
  PREVIEW_BAR_INTERVAL: "readonly", PROGRESS_BAR_INTERVAL: "readonly",
  // seasons.js
  AVATAR_SEASONS: "readonly", LIGHTS_MONTHS: "readonly", SNOW_MONTHS: "readonly",
  // other app files
  ytAPI: "readonly", setup: "readonly", ftLazy: "readonly", ftLook: "readonly",
  // third-party libraries
  firebase: "readonly", twemoji: "readonly", linkifyStr: "readonly", FloatingUIDOM: "readonly",
  SC: "readonly", YT: "readonly"
};

// p5.js "global mode" functions used by glitch.js
const p5Globals = Object.fromEntries([
  "createCanvas", "resizeCanvas", "loadImage", "background", "clear", "image", "push", "pop",
  "translate", "scale", "floor", "random", "width", "height", "loop", "noLoop", "redraw"
].map((n) => [n, "readonly"]));

export default [
  { ignores: ["**/*.min.js", "js/twemoji.js", "js/popover-polyfill.js", "tools/**", "node_modules/**"] },
  {
    files: ["js/**/*.js", "embed/**/*.js"],
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
      "max-lines": ["error", { max: 500, ...COUNTED }],
      "max-lines-per-function": ["error", { max: 80, ...COUNTED, IIFEs: false }],
      "no-unused-vars": ["warn", { vars: "local", args: "none", caughtErrors: "none" }]
    }
  },
  { files: ["js/glitch.js"], languageOptions: { globals: p5Globals } },
  // the service worker (push notifications)
  {
    files: ["sw.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.serviceworker } },
    rules: { "no-undef": "error", "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }] }
  },
  ...sizeRules
];
