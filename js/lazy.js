/**
 * lazy.js — load what most visits never use only when it's first needed.
 *
 * The album-art glitch (p5.js, ~265 KB) shows only during SoundCloud songs
 * with the screen down. Most visits never need it, so it's loaded on first
 * use, not with the page. (The fire needs no library: js/flame.js.) Each is pinned to an exact version and checked with
 * Subresource Integrity, like the CDN scripts in index.html; when upgrading
 * one, update its integrity hash too (see the README).
 *
 * The site's own scripts load the same way (ftLazy.own): the Turntable theme
 * (js/ttskin.js), an easter egg, comes the first time someone goes in. Until
 * then firetable.tt is the stand-in at the end of this file.
 */

var ftLazy = (function () {
  var LIBS = {
    p5: {
      src: "https://cdnjs.cloudflare.com/ajax/libs/p5.js/0.5.7/p5.min.js",
      integrity: "sha384-Nc6Wpwz02/84Nk70wNI+ylNG2C8ynXTyEv7mPrL017fNCyPIP/hiEI1FVXGPuxvQ"
    }
  };
  var loading = {};

  /** Add a script to the page (once per key); resolves when it has run. */
  function script(key, src, integrity) {
    if (loading[key]) return loading[key];
    loading[key] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      if (integrity) {
        s.integrity = integrity;
        s.crossOrigin = "anonymous";
      }
      s.onload = function () { resolve(); };
      s.onerror = function () {
        delete loading[key]; // try again next time
        s.remove();
        reject(new Error("couldn't load " + src));
      };
      document.head.appendChild(s);
    });
    return loading[key];
  }

  /** Load one library (once); resolves when it has run. */
  function one(name) {
    return script(name, LIBS[name].src, LIBS[name].integrity);
  }

  /**
   * Load libraries in order (each runs before the next starts).
   * @param {Array<string>} names - keys of LIBS
   * @returns {Promise}
   */
  function load(names) {
    return names.reduce(function (p, name) {
      return p.then(function () { return one(name); });
    }, Promise.resolve());
  }

  /**
   * Load one of this site's own scripts (once), from the address in the
   * page's <meta name="..."> (index.html), so the deploy versions it like
   * every other link.
   * @param {string} meta - the meta's name, e.g. "tt-js"
   * @param {string} fallback - the script's path, without a meta
   * @returns {Promise}
   */
  function own(meta, fallback) {
    var m = document.querySelector('meta[name="' + meta + '"]');
    return script("own:" + meta, (m && m.content) || fallback);
  }

  return { load: load, own: own, LIBS: LIBS };
})();

/*
 * The Turntable theme's stand-in: the same calls as js/ttskin.js, and the
 * same ways in (/turntable in chat, the Konami code, the :id: logo clicked
 * three times, in Live). Going in loads the theme, starts it and goes in;
 * on a device where it was left on, it loads with the page. Until then
 * nothing is on, so the rest has nothing to do.
 */
firetable.tt = (function () {
  "use strict";
  var KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  var konami = 0, clicks = [], started = null;
  var noop = function () {};
  var stub;

  function inLive() { return !document.body.classList.contains("ft-discover"); }

  /** The real theme, loaded and started (once). */
  function real() {
    if (!started) {
      started = ftLazy.own("tt-js", "js/ttskin.js").then(function () {
        if (firetable.tt === stub) throw new Error("js/ttskin.js didn't set up the theme");
        firetable.tt.init();
      });
      started.catch(function (err) {
        started = null; // try again next time
        console.error("[firetable] the Turntable theme:", err);
        if (firetable.ui && firetable.ui.toast) firetable.ui.toast("The Turntable theme didn't load. Try again in a moment.", "error");
      });
    }
    return started;
  }

  /** A call that needs the real theme: made once it's here. */
  function later(name) {
    return function () {
      var args = arguments;
      real().then(function () { firetable.tt[name].apply(firetable.tt, args); }, noop);
    };
  }

  stub = {
    init: function () {
      var on = null;
      try { on = localStorage.getItem(STORAGE.ttSkin); } catch (e) { /* storage blocked */ }
      if (on === "1") { real(); return; }
      document.addEventListener("keydown", function (e) {
        if (started) return; // the theme listens for itself now
        var t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { konami = 0; return; }
        var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
        konami = k === KONAMI[konami] ? konami + 1 : (k === KONAMI[0] ? 1 : 0);
        if (konami === KONAMI.length) { konami = 0; if (inLive()) stub.toggle(); }
      });
      var logo = document.getElementById("roomlogo");
      if (logo) logo.addEventListener("click", function () {
        if (started || !inLive()) return;
        var now = Date.now();
        clicks = clicks.filter(function (t) { return now - t < 900; }).concat(now);
        if (clicks.length >= 3) { clicks = []; stub.toggle(); }
      });
    },
    enter: later("enter"),
    toggle: later("toggle"),
    leave: function () { if (started) later("leave").apply(null, arguments); },
    fires: noop,
    stage: noop,
    openPicker: noop,
    openLaptop: noop,
    isOn: function () { return false; }
  };
  return stub;
})();
