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
 * then firetable.tt is the stand-in at the end of this file. So do going to
 * an @mention (js/mention-jump.js) and the bus menu (js/bus-menu.js).
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

/*
 * The bus menu (js/bus-menu.js, loaded the first time a bus button is
 * tapped): when to step down, after a song or more or in a while. If it
 * can't load, the button does what it always did: the bus after the next
 * song, or off it.
 */
firetable.busMenu = (function () {
  "use strict";
  var stub = {
    /**
     * @param {Element} anchor - the bus button
     * @param {string} [uid] - whose bus (yours when left out)
     * @param {string} [name] - their name, a mod's for someone else
     */
    open: function (anchor, uid, name) {
      return ftLazy.own("bus-js", "js/bus-menu.js").then(function () {
        if (firetable.busMenu === stub) throw new Error("js/bus-menu.js didn't load");
        return firetable.busMenu.open(anchor, uid, name);
      }).catch(function (err) {
        console.error("[firetable] the bus menu:", err);
        var self = !uid || uid === ftapi.uid;
        var on = !!(firetable.people && firetable.people.bus(firetable.ui.djStatus(uid || ftapi.uid).entry));
        firetable.actions.toggleBus(!on, self ? "" : name);
      });
    }
  };
  return stub;
})();

/*
 * Songs the room played lately, marked in your playlist (js/recent-plays.js,
 * loaded once you're signed in: only members have playlists). Until then
 * nothing is marked.
 */
firetable.recentPlays = (function () {
  "use strict";
  var stub = {
    /** Load it, then follow what the room played lately. */
    watch: function () {
      return ftLazy.own("recent-js", "js/recent-plays.js").then(function () {
        if (firetable.recentPlays === stub) throw new Error("js/recent-plays.js didn't load");
        return firetable.recentPlays.watch();
      }).catch(function (err) {
        console.error("[firetable] songs played lately:", err);
      });
    }
  };
  if (window.ftapi && ftapi.events) ftapi.events.on("loggedIn", function () { firetable.recentPlays.watch(); });
  return stub;
})();

/*
 * The left column folded into a toolbar, on wide screens (js/rail.js, and
 * css/rail.css, loaded the first time it's folded; where it was left folded,
 * or where it starts folded (a smaller computer screen, once the device has
 * signed in), js/head.js put both on before the first paint and the script
 * loads with the page). Its ways in stay here, so they work before it's
 * loaded and go to the real thing once it is: the button at the column's
 * bottom, the [ key and Settings' switch; and so does the window narrowing
 * into that range with no choice kept, which folds it (not a choice).
 */
firetable.rail = (function () {
  "use strict";
  var root = document.documentElement;
  var loading = null;
  var stub;

  /** The real thing, loaded (once). */
  function real() {
    if (!loading) {
      loading = ftLazy.own("rail-js", "js/rail.js").then(function () {
        if (firetable.rail === stub) throw new Error("js/rail.js didn't set up the toolbar");
      });
      loading.catch(function (err) {
        loading = null; // try again next time
        console.error("[firetable] the toolbar:", err);
        if (firetable.ui && firetable.ui.toast) firetable.ui.toast("The toolbar didn't load. Try again in a moment.", "error");
      });
    }
    return loading;
  }

  stub = {
    isOn: function () { return root.classList.contains("rail"); },
    toggle: function () { return real().then(function () { return firetable.rail.toggle(); }, function () {}); },
    set: function (on, quiet) { return real().then(function () { return firetable.rail.set(on, quiet); }, function () {}); }
  };

  /** [ : not while typing, with Ctrl, Cmd or Alt held, over a dialog, or where there's no column to fold. */
  function railKey(e) {
    if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.isComposing) return false;
    var t = e.target;
    if (/^(input|textarea|select)$/i.test(t.tagName || "") || t.isContentEditable) return false;
    if (document.querySelector("dialog[open]") || document.body.classList.contains("tt-skin")) return false;
    return !!(window.matchMedia && window.matchMedia("(min-width: 1024px)").matches);
  }
  document.addEventListener("keydown", function (e) {
    if (!railKey(e)) return;
    e.preventDefault();
    firetable.rail.toggle();
  });
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#nav-railBtn")) firetable.rail.toggle();
  });
  var box = document.getElementById("railToggle");
  if (box) {
    box.checked = stub.isOn();
    box.addEventListener("change", function () { firetable.rail.set(box.checked); });
  }
  if (stub.isOn()) real();
  // into a smaller computer screen's range (the same in js/head.js), with no choice kept, once the
  // device has signed in: folded, quietly (still so once it's loaded: the window may have moved on)
  var small = window.matchMedia && window.matchMedia("(min-width: 1024px) and (max-width: 1369px) and (hover: hover)");
  var byDefault = function () {
    var v = null, known = null;
    try { v = localStorage.getItem(STORAGE.rail); known = localStorage.getItem("ft-has-account"); } catch (e) { /* storage blocked */ }
    return small.matches && v === null && !!known;
  };
  if (small && small.addEventListener) small.addEventListener("change", function () {
    if (firetable.rail !== stub || !byDefault()) return;
    real().then(function () { if (byDefault()) firetable.rail.set(true, true); }, function () {});
  });
  return stub;
})();
