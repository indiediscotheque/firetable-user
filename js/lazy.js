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

  /**
   * The Konami code, heard anywhere on the page, the chat box included.
   * Done in a text box, its last two keys ("b", "a") don't stay there as text.
   * @param {Function} done - called when the code is entered
   * @returns {Function} the keydown listener
   */
  function konami(done) {
    var CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    var at = 0;
    return function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) { at = 0; return; }
      var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
      at = k === CODE[at] ? at + 1 : (k === CODE[0] ? 1 : 0);
      if (at < CODE.length) return;
      at = 0;
      e.preventDefault(); // the "a" isn't typed anywhere, even where going in or out moves the focus
      unType(e.target);
      done();
    };
  }

  /** The code ended in a text box: take back the "b" typed there. */
  function unType(t) {
    if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName) || typeof t.selectionStart !== "number") return;
    var end = t.selectionStart;
    if (end !== t.selectionEnd || end < 1 || t.value.charAt(end - 1).toLowerCase() !== "b") return;
    t.value = t.value.slice(0, end - 1) + t.value.slice(end);
    t.setSelectionRange(end - 1, end - 1);
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return { load: load, own: own, konami: konami, LIBS: LIBS };
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
  var clicks = [], started = null;
  var noop = function () {};
  var stub;

  function inLive() { return !document.body.classList.contains("ft-discover"); }

  /** The real theme, loaded and started (once). */
  function real() {
    if (!started) {
      started = ftLazy.own("tt-laptop-js", "js/ttlaptop.js").then(function () {
        return ftLazy.own("tt-js", "js/ttskin.js");
      }).then(function () {
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
      var heard = ftLazy.konami(function () { if (inLive()) stub.toggle(); });
      document.addEventListener("keydown", function (e) {
        if (!started) heard(e); // once it's loaded, the theme listens for itself
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

/*
 * Going to an @mention in the room's chat (js/mention-jump.js, loaded the
 * first time a mention is tapped). A tapped notification that opens the app
 * comes with #mentions/<message id>: that's Live (#live) from the start, so
 * the page opens there, and the message is shown once you're signed in and
 * the chat has loaded (firetable.mentionJump.resume, from js/chat.js). A row
 * in the @ inbox (or its Show button) goes there too.
 */
firetable.mentionJump = (function () {
  "use strict";
  var pending = null;
  var tapped = /^#mentions(?:\/([\w-]{1,64}))?$/.exec(location.hash);
  if (tapped) {
    pending = tapped[1] || "";
    try { history.replaceState(history.state, "", location.pathname + location.search + "#live"); } catch (e) { /* stays as it is */ }
  }
  var stub = {
    /** Go to a mention (its chat message's id) in Live's chat. */
    show: function (id) {
      return ftLazy.own("mention-js", "js/mention-jump.js").then(function () {
        if (firetable.mentionJump === stub) throw new Error("js/mention-jump.js didn't load");
        return firetable.mentionJump.show(id);
      }).catch(function (err) {
        console.error("[firetable] going to the mention:", err);
      });
    },
    /** Signed in, the chat loaded: show the mention a notification opened the app for. */
    resume: function () {
      if (pending === null || !ftapi.uid || !firetable._chatBooted) return;
      var id = pending;
      pending = null;
      firetable.mentionJump.show(id);
    }
  };
  // the inbox's rows: Show, or the row itself (not its other buttons or links)
  document.addEventListener("click", function (e) {
    var row = e.target.closest && e.target.closest("#inboxList .inboxItem[data-id]");
    if (row && (e.target.closest(".inboxGo") || !e.target.closest("button, a"))) firetable.mentionJump.show(row.getAttribute("data-id"));
  });
  return stub;
})();
