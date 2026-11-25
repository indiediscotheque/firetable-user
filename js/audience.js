/**
 * audience.js — who's with the room besides the members in it: guests (on
 * the site without an account) and the radio stream's listeners, merged by
 * country. Both come from api/audience.php, asked once a minute.
 *
 * - A guest's page sends a heartbeat (a random id kept in this browser, so
 *   tabs count once, whether the room is sounding on it, and the device's
 *   time zone, which the server turns into a country), and gets the counts
 *   back. Robots and pages nobody is looking at or hearing don't send
 *   one, and closing the page or signing in says goodbye.
 * - A member's page only asks for the counts, while it's visible.
 *
 * Shown in the people list's header (#usersStats) and under the members
 * (#pe-audience; the members' own rows are js/people.js),
 * in a visitor's list (#pe-here, users.js) and the Turntable theme's People
 * (ttskin.js, on "audienceChanged").
 */
firetable.audience = (function () {
  var POLL_MS = 60000;  // the server reuses its answer for a minute anyway
  var WATCH_MS = 15000; // how soon a guest starting or stopping the room is counted
  var A = { data: null, key: "", at: 0, id: null, live: null, timer: 0, busy: false, started: false };

  /** An element of the page, or of the members' part while it's set aside for the sign-in screen (users.js). */
  function byId(id) {
    return document.getElementById(id) || (firetable.$appShell && firetable.$appShell.find("#" + id)[0]) || null;
  }
  /** The device's time zone ("Europe/Berlin"), for the guest's country; "" if the browser won't say. */
  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
  }

  /** "Germany" for "DE", in the page's language when the server didn't name it. */
  var regionNames = null;
  function countryName(code, name) {
    if (name) return name;
    try {
      regionNames = regionNames || new Intl.DisplayNames([document.documentElement.lang || "en"], { type: "region" });
      return regionNames.of(code) || code;
    } catch (e) { return code; }
  }

  function esc(s) { return firetable.utilities.htmlEscape(String(s)); }
  function ms(name, cls) { return '<span class="material-symbols-outlined' + (cls ? " " + cls : "") + '" aria-hidden="true">' + name + "</span>"; }

  /** Signed out, a person, and the page is really being shown. */
  function guest() {
    return !ftapi.loggedIn && !navigator.webdriver && !document.prerendering &&
      !/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview/i.test(navigator.userAgent || "");
  }

  /** The room is sounding on this page (Live picked, a song on, the browser letting it play). */
  function hearingRoom() {
    var d = firetable.discover, s = firetable.song;
    var on = d && d.state ? d.state().listening : true;
    return !!(on && s && s.cid && s.cid != 0 && !document.body.classList.contains("media-blocked"));
  }

  /** This browser's guest id: random, made here, kept so every tab counts as one guest. */
  function guestId() {
    if (A.id) return A.id;
    var id = null;
    try { id = localStorage.getItem(STORAGE.guestId); } catch (e) { /* storage blocked: this page's own id */ }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id || "")) {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      try { localStorage.setItem(STORAGE.guestId, id); } catch (e) { /* kept for this page only */ }
    }
    return (A.id = id);
  }

  /** Ask for the counts (a guest's ask is its heartbeat). Hidden pages wait, unless a guest is hearing the room. */
  function tick() {
    if (A.busy) return;
    var asGuest = guest();
    var live = asGuest && hearingRoom();
    if (document.hidden && !live) return;
    A.busy = true;
    A.live = live;
    var req = asGuest
      ? fetch(AUDIENCE_URL, { method: "POST", body: new URLSearchParams({ id: guestId(), live: live ? "1" : "0", tz: timeZone() }), cache: "no-store" })
      : fetch(AUDIENCE_URL, { cache: "no-store" });
    req.then(function (r) { return r.ok ? r.json() : null; })
      .then(take)
      .catch(function () { /* not set up here (or offline): the list stays as it is */ })
      .then(function () { A.busy = false; });
  }

  /** A guest leaving the page or signing in: stop counting them now rather than in two minutes. */
  function leave(beacon) {
    if (!A.id) return;
    var body = new URLSearchParams({ id: A.id, leave: "1" });
    if (beacon && navigator.sendBeacon && navigator.sendBeacon(AUDIENCE_URL, body)) return;
    fetch(AUDIENCE_URL, { method: "POST", body: body, keepalive: true }).catch(function () {});
  }

  function take(d) {
    if (!d || typeof d.guests !== "number") return;
    var s = d.stream && typeof d.stream.listeners === "number" ? d.stream : null;
    var places = function (list) {
      return (Array.isArray(list) ? list : []).filter(function (c) { return c && c.n > 0 && (c.name || /^[A-Z]{2}$/.test(c.code)); })
        .map(function (c) { var code = /^[A-Z]{2}$/.test(c.code) ? c.code : ""; return { code: code, name: countryName(code, String(c.name || "")), n: c.n | 0 }; });
    };
    var data = {
      guests: Math.max(0, d.guests | 0),
      guestsLive: Math.max(0, d.guestsLive | 0),
      guestCountries: places(d.guestCountries),
      guestsUnplaced: Math.max(0, d.guestsUnplaced | 0),
      stream: s ? {
        listeners: Math.max(0, s.listeners | 0),
        unplaced: Math.max(0, s.unplaced | 0),
        countries: places(s.countries)
      } : null
    };
    A.at = Date.now();
    var key = JSON.stringify(data);
    if (key === A.key) return;
    A.key = key;
    A.data = data;
    render();
  }

  function render() {
    renderStats();
    var box = byId("pe-audience");
    if (box) {
      var html = section("pe");
      box.hidden = !html;
      if (box.innerHTML !== html) { box.innerHTML = html; emojify(box); }
    }
    if (firetable.ui.renderRoomPulse) firetable.ui.renderRoomPulse(); // a visitor's list (#pe-here)
    ftapi.events.emit("audienceChanged", A.data);
  }

  /** Members online, not counting the room's bot. */
  function members() {
    var n = 0, users = ftapi.users || {};
    for (var uid in users) if (users.hasOwnProperty(uid) && users[uid] && !users[uid].hostbot) n++;
    return n;
  }

  /**
   * The people list's header: everyone with the room, then members in it,
   * guests on the site and radio listeners. Shown once the counts arrive.
   */
  function renderStats() {
    var box = byId("usersStats");
    if (!box) return;
    var d = A.data;
    box.classList.toggle("is-on", !!d);
    if (!d) return;
    var plural = firetable.utilities.pluralize;
    var m = members();
    var radio = d.stream ? d.stream.listeners : 0;
    // each count beside its icon, named on hover; one that's none is left out (the total still adds up)
    var set = function (id, n, label, shown) {
      var el = byId(id);
      if (!el) return;
      el.textContent = n;
      var row = el.closest(".listenerType");
      if (row) { row.title = label; row.setAttribute("aria-label", label); row.setAttribute("role", "img"); row.hidden = !shown; }
    };
    byId("numListeners").textContent = m + d.guests + radio;
    set("numRoomListeners", m, plural(m, "member", "members") + " in the room", true);
    set("pe-numGuests", d.guests, plural(d.guests, "guest", "guests") + " without an account" + (d.guestsLive ? ", " + d.guestsLive + " listening live" : ""), d.guests > 0);
    set("numStreamListeners", radio, plural(radio, "person", "people") + " listening on the radio", radio > 0);
  }

  /** "🇺🇸" from "US" (Windows draws the letters, so emojify swaps in Twemoji's picture). */
  function flag(code) {
    if (!code) return ms("public", "pe-flag");
    return '<span class="pe-flag" aria-hidden="true">' + String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 65, 0x1F1E6 + code.charCodeAt(1) - 65) + "</span>";
  }

  function emojify(el) {
    if (!window.twemoji) return;
    Array.prototype.forEach.call(el.querySelectorAll("span.pe-flag[aria-hidden]"), function (f) {
      if (f.firstElementChild || f.classList.contains("material-symbols-outlined")) return;
      try { twemoji.parse(f); } catch (e) { /* the letters stay */ }
    });
  }

  /**
   * The radio's listeners by country, then the guests and how many of them are listening live, as rows. p is the class
   * prefix: "pe" (the people lists) or "tt" (the Turntable theme).
   * @returns {string} HTML, or "" before the counts arrive
   */
  function section(p) {
    var d = A.data;
    if (!d) return "";
    var html = "";
    var row = function (c) {
      return '<li class="pe-audRow">' + flag(c.code) + '<span class="pe-audName">' + esc(c.name) + '</span><span class="pe-audN">' + c.n + "</span></li>";
    };
    var somewhere = function (n) {
      return n ? '<li class="pe-audRow is-unplaced">' + flag("") + '<span class="pe-audName">Somewhere</span><span class="pe-audN">' + n + "</span></li>" : "";
    };
    var label = function (what, n) { return what + " by country" + (n > 1 ? ", " + n + " countries" : ""); };
    // a group with nobody in it is left out: an empty heading and "No guests
    // right now." took four lines to say nothing
    if (d.stream && d.stream.listeners) {
      var rows = d.stream.countries.map(row).join("") + somewhere(d.stream.unplaced);
      html += '<h3 class="' + p + '-group pe-audHead">' + ms("radio") + "On the radio <span>" + d.stream.listeners + "</span></h3>" +
        (rows ? '<ul class="pe-audList" aria-label="' + label("Radio listeners", d.stream.countries.length) + '">' + rows + "</ul>" : "");
    }
    // where the guests are (from their time zones), then how many of them hear the room
    if (d.guests) {
      html += '<h3 class="' + p + '-group pe-audHead">' + ms("person") + "Guests <span>" + d.guests + "</span></h3>" +
        '<ul class="pe-audList" aria-label="' + label("Guests", d.guestCountries.length) + '">' + d.guestCountries.map(row).join("") + somewhere(d.guestsUnplaced) +
        '<li class="pe-audRow is-live">' + ms("headphones", "pe-flag") + '<span class="pe-audName">Listening live</span><span class="pe-audN">' + d.guestsLive + "</span></li></ul>";
    }
    return html;
  }

  return {
    start: function () {
      if (A.started || typeof fetch !== "function" || !window.URLSearchParams) return;
      A.started = true;
      tick();
      A.timer = setInterval(tick, POLL_MS);
      // a guest starting or stopping the room is counted within seconds, not a minute
      setInterval(function () { if (guest() && hearingRoom() !== A.live) tick(); }, WATCH_MS);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && Date.now() - A.at > POLL_MS) tick();
      });
      window.addEventListener("pagehide", function () { if (guest()) leave(true); });
      window.addEventListener("pageshow", function (e) { if (e.persisted) tick(); });
      ftapi.events.on("loggedIn", function () { leave(false); });
      ftapi.events.on("loggedOut", function () { setTimeout(tick, 0); });
      ftapi.events.on("usersChanged", firetable.utilities.oncePerFrame(renderStats));
    },
    /** The latest counts: {guests, guestsLive, stream: {listeners, unplaced, countries: [{code, name, n}]} | null}, or null. */
    data: function () { return A.data; },
    /** The radio and guests rows (see section). */
    html: section,
    emojify: emojify,
    /** For tests: show these counts as if the server sent them. */
    take: take
  };
})();
