/**
 * look.js — light mode.
 *
 * The site is dark; light mode is a choice kept on this device: "dark" (the
 * default), "light", or "auto" (follow the device's own setting). It's read
 * here, in <head>, before the stylesheets paint, so a light page never
 * flashes dark first. It puts data-look="light" on <html>, and css/looks.css
 * and css/discover.css swap their palette under it (the "Light mode" sections).
 *
 * What stays dark in light mode, on purpose: the stage (the song's colours,
 * the screen, the DJs on their name plates) and the full-screen player. They
 * are the room's media, like a lit stage in a bright room. The Turntable
 * theme (js/ttskin.js) is its own world and is never drawn light: while it's
 * on, data-look is taken off and comes back when it goes.
 *
 * Ways to switch: the sun/moon in the header, Light mode in the account
 * menu, Settings → Playback and display → Look, or /light, /dark and /auto
 * in chat. Loaded before storage.js, so it reads localStorage itself.
 */
var ftLook = (function () {
  "use strict";

  var KEY = "firetableLook"; // STORAGE.look in js/constants.js
  var PREFS = ["dark", "light", "auto"];
  var BAR = { dark: "#181818", light: "#f1eee8" }; // the browser's bar: --color-bg in each look
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  var listeners = [];

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
    var bar = document.querySelector('meta[name="theme-color"]');
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
