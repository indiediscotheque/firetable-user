/**
 * telemetry.js — what goes wrong and how fast the site feels, from real visits.
 *
 * Two kinds of report go straight to the room's database (its REST address,
 * with navigator.sendBeacon, so they leave even as the page closes and need
 * neither sign-in nor the Firebase library):
 *   - clientErrors: an error in this site's own scripts (message, file with
 *     its ?v= version, line, column, a short stack, the page, the browser).
 *     At most 5 a visit, each once; other sites' scripts (players, browser
 *     add-ons) aren't ours to fix and are left out.
 *   - clientVitals: once a visit, the first time the page is hidden or
 *     closed, how fast it felt: largest paint, response to input (the
 *     slowest), layout shift, first paint and server response (the Web
 *     Vitals), Live or Discover, phone or computer.
 * No user id, name or address goes with them: only whether someone's signed
 * in, and the browser's family and version. Anyone can add a report; only
 * the bot and supermods can read them, and the bot deletes them after two
 * weeks. The weekly Site health report (firetable-hostbot
 * tools/site-health.js) groups them and maps errors back to the source.
 *
 * Loaded right after config.js (it needs ftconfigs.firebase.databaseURL),
 * before the site's other scripts, so their errors are caught.
 */
(function () {
  "use strict";
  var cfg = window.ftconfigs && window.ftconfigs.firebase;
  if (!cfg || !cfg.databaseURL || typeof navigator.sendBeacon !== "function") return;
  var parts = String(cfg.databaseURL).split("?"); // the test emulator's address has ?ns=
  var base = parts[0].replace(/\/+$/, "");
  var query = parts[1] ? "?" + parts[1] : "";

  /** Send one report (fire and forget). */
  function send(node, data) {
    data.at = { ".sv": "timestamp" };
    var url = base + "/" + node + ".json" + query;
    var body = JSON.stringify(data);
    // a plain-text body: no preflight, and the database reads it as JSON
    try { if (navigator.sendBeacon(url, body)) return; } catch (e) { /* fall through */ }
    try { fetch(url, { method: "POST", body: body, keepalive: true, mode: "no-cors" }); } catch (e) { /* nothing more to do */ }
  }

  /** "Chrome 140 / Android": the browser's family and major version, and the system. */
  function browser() {
    var ua = navigator.userAgent || "";
    var os = /iPhone|iPod/.test(ua) ? "iOS" : /iPad/.test(ua) ? "iPadOS" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS" :
      /Mac OS X/.test(ua) ? (navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS") : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "other";
    var names = { Edg: "Edge", OPR: "Opera", CriOS: "Chrome", FxiOS: "Firefox", SamsungBrowser: "Samsung" };
    var m = ua.match(/(Edg|OPR|SamsungBrowser|CriOS|FxiOS|Firefox|Chrome)\/(\d+)/);
    var safari = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/);
    var name = m ? (names[m[1]] || m[1]) + " " + m[2] : safari ? "Safari " + safari[1] : "other";
    return (name + " / " + os).slice(0, 60);
  }

  /** The page, without anything personal: the first parts of its address and #. */
  function page() {
    var path = location.pathname.split("/").slice(0, 3).join("/") || "/";
    var hash = (location.hash || "").split("/")[0];
    return (path + hash).slice(0, 80);
  }

  /** The site's version: firetable.js's ?v= (the deploy sets it from the file). */
  function version() {
    var s = document.querySelector('script[src*="js/firetable.js"]');
    var m = s && /[?&]v=([0-9A-Za-z._-]{1,20})/.exec(s.getAttribute("src"));
    return m ? m[1] : "";
  }

  function signedIn() { return !!(window.ftapi && window.ftapi.uid); }

  // ─── Errors ────────────────────────────────────────────────────────────────
  var own = location.origin + "/";
  var sent = 0, seen = {};
  /** A path on this site ("js/chat.js?v=…"), or null for another site's file. */
  function ownFile(url) {
    url = String(url || "");
    if (!url) return "";
    return url.indexOf(own) === 0 ? url.slice(own.length) : null;
  }
  function report(message, file, line, col, stack) {
    if (sent >= 5) return;
    var m = String(message || "").slice(0, 300);
    // "Script error.": another site's script, and the browser won't say what
    if (!m || /^(Uncaught )?Script error\.?$/i.test(m)) return;
    var f = ownFile(file);
    if (f === null) return;
    // no file (a promise turned down): only when its stack passes through this site
    if (!f && stack && String(stack).indexOf(own) === -1) return;
    var key = m + "|" + f + "|" + line + "|" + col;
    if (seen[key]) return;
    seen[key] = true;
    sent++;
    var st = String(stack || "").split(own).join("").slice(0, 800);
    send("clientErrors", {
      m: m, f: f.slice(0, 120), l: Math.max(0, line | 0), c: Math.max(0, col | 0), st: st,
      p: page(), b: browser(), v: version(), u: signedIn()
    });
  }
  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window) return; // a picture or file that didn't load
    report(e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    // a fetch or player the site stopped on purpose
    if (r && (r.name === "AbortError" || /signal is aborted/i.test(r.message || ""))) return;
    var message = r && r.message ? (r.name ? r.name + ": " : "") + r.message : String(r);
    var stack = r && r.stack ? String(r.stack) : "";
    // where in this site's scripts it went wrong: the first of its frames that's ours
    var frame = /(https?:\/\/[^\s)]+?):(\d+):(\d+)/g, at = null, any = false, x;
    while ((x = frame.exec(stack))) {
      any = true;
      if (x[1].indexOf(own) === 0) { at = x; break; }
    }
    // only other sites' frames: theirs, unless the database turned down a write of ours
    if (any && !at && !/permission.?denied/i.test(message)) return;
    report("Unhandled: " + message, at ? at[1] : "", at ? at[2] : 0, at ? at[3] : 0, at ? stack : "");
  });

  // ─── How fast it felt (Web Vitals) ─────────────────────────────────────────
  var v = { lcp: null, fcp: null, inp: null, cls: 0, ttfb: null };
  function watch(type, fn, opts) {
    try {
      var o = { type: type, buffered: true };
      for (var k in opts) o[k] = opts[k];
      new PerformanceObserver(function (list) { list.getEntries().forEach(fn); }).observe(o);
    } catch (e) { /* this browser doesn't measure it */ }
  }
  watch("largest-contentful-paint", function (e) { v.lcp = e.startTime; });
  watch("paint", function (e) { if (e.name === "first-contentful-paint") v.fcp = e.startTime; });
  // layout shift: the worst burst (shifts under 1 s apart, 5 s at most), as Google counts it
  var burst = 0, burstStart = 0, lastShift = 0;
  watch("layout-shift", function (e) {
    if (e.hadRecentInput) return;
    if (burst && e.startTime - lastShift < 1000 && e.startTime - burstStart < 5000) burst += e.value;
    else { burst = e.value; burstStart = e.startTime; }
    lastShift = e.startTime;
    if (burst > v.cls) v.cls = burst;
  });
  // response to input: the slowest tap, click or key press
  watch("event", function (e) {
    if (e.interactionId && (v.inp === null || e.duration > v.inp)) v.inp = e.duration;
  }, { durationThreshold: 40 });
  watch("first-input", function (e) { if (v.inp === null || e.duration > v.inp) v.inp = e.duration; });
  try {
    var nav = performance.getEntriesByType("navigation")[0];
    if (nav && nav.responseStart > 0) v.ttfb = nav.responseStart;
  } catch (e) { /* no navigation timing */ }

  var flushed = false;
  function flush() {
    if (flushed) return;
    flushed = true;
    var out = { view: document.body && document.body.classList.contains("ft-discover") ? "discover" : "live",
      mob: !!(window.matchMedia && matchMedia("(pointer: coarse)").matches), b: browser(), v: version(), u: signedIn() };
    ["lcp", "fcp", "inp", "ttfb"].forEach(function (k) { if (typeof v[k] === "number" && v[k] >= 0) out[k] = Math.min(600000, Math.round(v[k])); });
    out.cls = Math.min(100, Math.round(v.cls * 1000) / 1000);
    send("clientVitals", out);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
})();
