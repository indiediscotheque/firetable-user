/**
 * head.js — what must happen before the first paint, in one small request
 * (it blocks the page, so it stays short; README "light mode" explains it):
 * 1. iPhone/iPad viewport: maximum-scale=1 so tapping a field doesn't zoom.
 * 2. Light mode (ftLook): data-look="light" on <html>, and the color-scheme
 *    and theme-color metas (before this in <head>), so even the blank page
 *    before the stylesheets is the right colour. The stage, the full-screen
 *    player and the Turntable theme stay dark (css/looks.css, js/ttskin.js).
 * 3. The left column folded into a toolbar (js/rail.js): where it was left
 *    folded, or, with no choice kept, on a smaller computer screen with a
 *    mouse once this device has signed in, html.rail and its stylesheet
 *    (css/rail.css), so the page paints folded. And Discover's right column
 *    folded to a strip where it was left so (html.side-shut, js/side-panel.js).
 * Runs before storage.js, so it reads localStorage itself.
 */

// ── 1. The viewport on iPhone and iPad ──
(function () {
  var vp = document.querySelector('meta[name="viewport"]');
  if (vp && /interactive-widget/.test(vp.getAttribute("content") || "") &&
      (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))) {
    vp.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content");
  }
})();

// ── 2. Light mode ──
var ftLook = (function () {
  "use strict";

  var KEY = "firetableLook"; // STORAGE.look in js/constants.js
  var PREFS = ["dark", "light", "auto"];
  var BAR = { dark: "#181818", light: "#f1eee8" }; // the browser's bar: --color-bg in each look
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var listeners = [];
  var scheme = document.querySelector('meta[name="color-scheme"]');
  var bar = document.querySelector('meta[name="theme-color"]');

  function read() {
    var v = null;
    try { v = window.localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    return PREFS.indexOf(v) === -1 ? "dark" : v;
  }
  var pref = read();

  /** "light" or "dark": what the page wants, before the Turntable theme has its say. */
  function wanted() {
    if (pref === "auto") return media && media.matches ? "light" : "dark";
    return pref;
  }

  /** Turntable is on: it's drawn dark whatever the look. */
  function turntable() {
    return !!(document.body && document.body.classList.contains("tt-skin"));
  }

  /** Put the look on the page: data-look on <html>, the browser's bar colour, every control's state. */
  function apply() {
    var look = turntable() ? "dark" : wanted();
    if (look === "light") root.setAttribute("data-look", "light");
    else root.removeAttribute("data-look");
    // the browser's own drawing (the blank page before the stylesheets, scrollbars,
    // form controls) and its bar, in the same look
    if (scheme) scheme.setAttribute("content", look);
    if (bar) bar.setAttribute("content", BAR[look]);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](wanted(), pref); } catch (e) { /* one control's trouble isn't the page's */ }
    }
    return look;
  }

  function set(p) {
    if (PREFS.indexOf(p) === -1) p = "dark";
    pref = p;
    try {
      if (p === "dark") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, p);
    } catch (e) { /* storage blocked: it lasts this visit */ }
    // A page's worth of colours changes at once: each element's own transition is held
    // off, and where the browser can, the whole page cross-fades (a view transition)
    // instead of a hundred things fading at their own speeds. Not with reduced motion.
    var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var swap = function () {
      root.classList.add("look-switching");
      apply();
      setTimeout(function () { root.classList.remove("look-switching"); }, 60);
    };
    if (document.startViewTransition && !still && document.visibilityState === "visible") {
      try { document.startViewTransition(swap); } catch (e) { swap(); }
    } else swap();
    return wanted();
  }

  // the device's setting changed (sunset, or by hand): follow it when asked to
  if (media) {
    var follow = function () { if (pref === "auto") apply(); };
    if (media.addEventListener) media.addEventListener("change", follow);
    else if (media.addListener) media.addListener(follow);
  }
  // another tab changed it
  window.addEventListener("storage", function (e) {
    if (e.key === KEY || e.key === null) { pref = read(); apply(); }
  });

  apply();

  return {
    /** "dark" | "light" | "auto": the choice on this device */
    pref: function () { return pref; },
    /** "dark" | "light": what that choice means now (the device decides "auto") */
    current: wanted,
    isLight: function () { return wanted() === "light"; },
    set: set,
    /** Flip between dark and light (from "auto", to the other of what's showing). */
    toggle: function () { return set(wanted() === "light" ? "dark" : "light"); },
    apply: apply,
    /** fn(current, pref) runs now and on every change, so a control can show the state. */
    onChange: function (fn) { listeners.push(fn); try { fn(wanted(), pref); } catch (e) { /* ignore */ } }
  };
})();

// ── 3. The folded columns ──
// The left one where it was left folded ("1"; "0" is left open), or with no
// choice kept, from 1024 to 1369px wide with a mouse once this device has
// signed in (the same in js/rail.js); nothing downloads otherwise (js/lazy.js
// loads it the first time). blocking="render": a browser that knows it waits
// for the stylesheet before painting; the others draw the column open for a
// moment. Discover's right one where it was left folded.
(function () {
  "use strict";
  var root = document.documentElement;
  var on = null, known = null;
  try {
    on = window.localStorage.getItem("firetableRail"); // STORAGE.rail in js/constants.js
    known = window.localStorage.getItem("ft-has-account"); // js/users.js AUTH_KNOWN_KEY
    if (window.localStorage.getItem("firetableSide") === "1") root.classList.add("side-shut"); // STORAGE.side
  } catch (e) { /* storage blocked */ }
  var small = known && window.matchMedia && window.matchMedia("(min-width: 1024px) and (max-width: 1369px) and (hover: hover)").matches;
  if (on !== "1" && !(on === null && small)) return;
  root.classList.add("rail");
  var meta = document.querySelector('meta[name="rail-css"]');
  var css = document.createElement("link");
  css.rel = "stylesheet";
  css.id = "nav-railCss";
  css.href = meta ? meta.content : "css/rail.css";
  css.setAttribute("blocking", "render");
  document.head.appendChild(css);
})();
