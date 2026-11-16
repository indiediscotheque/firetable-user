/**
 * stage.js — the room's live stage, for another site's screen (QueUp's).
 *
 *   <iframe src="https://<site>/embed/stage/" allow="autoplay; encrypted-media; fullscreen"
 *     style="border:0;width:100%;aspect-ratio:16/9" title="Indie Discotheque, live"></iframe>
 *
 * Unlisted: nothing links here, it's never indexed, and .htaccess lets only
 * this site and QueUp frame it. It plays the room as it plays: the song's
 * video in step with everyone (muted until "Listen live", since browsers
 * won't start sound without a tap), the cover art filling the screen while
 * there's no video (SoundCloud songs), the song and who picked it, the DJs on the decks bobbing to the beat, the
 * theme and how many are in the room, in the playing song's colours.
 *
 * It reads the room's public nodes over Firebase's REST streaming API
 * (EventSource): no sign-in, no Firebase library, nothing written.
 *
 * Options: ?video=0 (the cover art, never the video),
 * ?volume=0-100 (the starting volume; a listener's own choice wins).
 */
(function () {
  "use strict";
  var cfg = typeof ftconfigs !== "undefined" ? ftconfigs : {};
  var el = function (id) { return document.getElementById(id); };
  var root = el("st");
  var site = new URL("../../", location.href).href;
  var dbUrl = String((cfg.firebase && cfg.firebase.databaseURL) || "").replace(/\/$/, "");
  var q = new URLSearchParams(location.search);
  var VIDEO = q.get("video") !== "0";
  var REVEAL_MS = 2500;  // YouTube's own title bar shows for a moment as a video starts
  var DRIFT_S = 3, SC_DRIFT_S = 1.5;
  var VOL_KEY = "ft-stage-volume", MUTE_KEY = "ft-stage-muted";
  var YT_TYPE = typeof MEDIA_YOUTUBE !== "undefined" ? MEDIA_YOUTUBE : 1;
  var SC_TYPE = typeof MEDIA_SOUNDCLOUD !== "undefined" ? MEDIA_SOUNDCLOUD : 2;
  var ROBOTS = typeof AVATAR_BASE_URL !== "undefined" ? AVATAR_BASE_URL : "https://indiediscotheque.com/robots/";
  var SC_TRACK = typeof SC_API_TRACK_URL !== "undefined" ? SC_API_TRACK_URL : "https://api.soundcloud.com/tracks/";
  var ACCENT = typeof COLOR_ORANGE !== "undefined" ? COLOR_ORANGE : "#cc9933";

  var S = {
    song: null, key: "", table: [], users: {}, bpm: null,
    sound: false, muted: read(MUTE_KEY) === "1",
    vol: clampVol(read(VOL_KEY) !== null ? read(VOL_KEY) : q.get("volume") !== null ? q.get("volume") : 80),
    yt: null, ytReady: false, ytFailed: false, revealTimer: null,
    sc: null, scReady: false, scWaiting: null
  };

  // ─── Small helpers ──────────────────────────────────────────────────────

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function clampVol(v) { v = Number(v); return isNaN(v) ? 80 : Math.max(0, Math.min(100, Math.round(v))); }
  /** Song and theme text is saved with entities (&amp;): decode it inertly. */
  function text(s) {
    var t = document.createElement("template");
    t.innerHTML = String(s == null ? "" : s);
    return (t.content.textContent || "").replace(/\s+/g, " ").trim();
  }
  function clock(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function absolute(u) { try { return new URL(u, site).href; } catch (e) { return ""; } }
  function cssUrl(u) { return u ? 'url("' + String(u).replace(/["\\\n]/g, encodeURIComponent) + '")' : ""; }
  function isYT(s) { return s && Number(s.type) === YT_TYPE; }
  function isSC(s) { return s && Number(s.type) === SC_TYPE; }
  /** Seconds into the room's song now, or null when there's none. */
  function pos() {
    var s = S.song;
    if (!s || !s.started) return null;
    var p = Math.max(0, (Date.now() - Number(s.started)) / 1000);
    return s.duration ? Math.min(p, Number(s.duration)) : p;
  }
  function note(msg) {
    var n = el("st-note");
    n.textContent = msg || "";
    n.hidden = !msg;
  }

  // ─── The room's data: Firebase REST streaming ───────────────────────────

  function dbHref(path) {
    var url = new URL(dbUrl);
    url.pathname = url.pathname.replace(/\/$/, "") + "/" + path + ".json";
    return url;
  }
  /** Put `val` at `path` ("/a/b") inside `obj`, as a stream's put does. */
  function place(obj, path, val) {
    var parts = String(path || "/").split("/").filter(Boolean);
    if (!parts.length) return val;
    var out = obj && typeof obj === "object" ? (Array.isArray(obj) ? obj.slice() : Object.assign({}, obj)) : {};
    var key = parts[0];
    var rest = "/" + parts.slice(1).join("/");
    var next = place(out[key], rest, val);
    if (next === null || next === undefined) delete out[key]; else out[key] = next;
    return out;
  }
  /** Follow one node; `cb` gets its whole value after every change. */
  function watch(path, cb) {
    var data = null, es = null, wait = 1000;
    function open() {
      es = new EventSource(dbHref(path).href);
      es.addEventListener("put", function (e) {
        var m = JSON.parse(e.data);
        data = place(data, m.path, m.data);
        wait = 1000;
        cb(data);
      });
      es.addEventListener("patch", function (e) {
        var m = JSON.parse(e.data);
        Object.keys(m.data || {}).forEach(function (k) { data = place(data, m.path.replace(/\/$/, "") + "/" + k, m.data[k]); });
        cb(data);
      });
      // the rules refuse it, or the stream was dropped for good: try again later
      es.addEventListener("cancel", retry);
      es.addEventListener("auth_revoked", retry);
      es.onerror = function () { if (es.readyState === EventSource.CLOSED) retry(); };
    }
    function retry() {
      if (es) es.close();
      setTimeout(open, wait);
      wait = Math.min(wait * 2, 60000);
    }
    open();
  }
  function once(path) {
    return fetch(dbHref(path).href).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  // ─── What's on: colours, theme, the song, the decks ─────────────────────

  function colors(c) {
    var color = c && typeof c.color === "string" && CSS.supports("color", c.color) ? c.color : ACCENT;
    var txt = c && typeof c.txt === "string" && CSS.supports("color", c.txt) ? c.txt : "#fff";
    root.style.setProperty("--acc", color);
    root.style.setProperty("--acc-txt", txt);
  }
  function theme(t) {
    t = text(t);
    el("st-theme").hidden = !t;
    el("st-themeText").textContent = t;
  }
  /** Colours and theme change with the song: read them as it starts, and again once the bot has set them. */
  function roomLooks() {
    var get = function () {
      once("colors").then(colors, function () { /* keep what's there */ });
      once("theme").then(theme, function () { /* keep what's there */ });
    };
    get();
    setTimeout(get, 3000);
  }

  /** The biggest cover there is, for the whole screen: YouTube's full-size
   *  frame and SoundCloud's original, else the usual size. */
  function bigArt(s, cb) {
    var small = artFor(s);
    var big = isYT(s) ? "https://i.ytimg.com/vi/" + encodeURIComponent(s.cid) + "/maxresdefault.jpg"
      : isSC(s) && /-t500x500\./.test(small) ? small.replace("-t500x500.", "-original.") : null;
    if (!big) return cb(small);
    var img = new Image();
    // YouTube answers a missing size with a 120 × 90 placeholder
    img.onload = function () { cb(img.naturalWidth > 200 ? big : small); };
    img.onerror = function () { cb(small); };
    img.src = big;
  }

  function artFor(s) {
    if (!s) return "";
    var img = s.image && s.image !== "img/idlogo.png" ? String(s.image) : (cfg.defaultAlbumArtUrl || "");
    if (isSC(s) && img) img = img.replace("-large", "-t500x500");
    // YouTube's widescreen frame: no black bars baked in (hqdefault has them), so cropped to the box it fills it
    if (isYT(s) && (!img || /ytimg\.com/.test(img))) img = "https://i.ytimg.com/vi/" + encodeURIComponent(s.cid) + "/mqdefault.jpg";
    return absolute(img || "img/idlogo.png");
  }

  function onSong(s) {
    var live = s && s.cid && String(s.cid) !== "0" && s.started;
    var key = live ? s.type + ":" + s.cid + ":" + s.started : "";
    var same = key === S.key;
    S.song = live ? s : null;
    S.key = key;
    root.classList.remove("is-loading");
    root.classList.toggle("is-quiet", !live);
    el("st-quiet").hidden = !!live;
    if (!live) {
      stopAll();
      showVideo(false);
      el("st-blur").style.backgroundImage = "";
      el("st-cover").style.backgroundImage = "";
      el("st-listen").hidden = true;
      renderDeck();
      return;
    }
    nowPlaying(s, same);
    if (same) return; // a tag fix: the words change, the music doesn't
    roomLooks();
    beat();
    note("");
    S.ytFailed = false;
    showVideo(false);
    root.classList.toggle("is-sc", isSC(s));
    el("st-listen").hidden = S.sound;
    play();
  }

  function nowPlaying(s, same) {
    var low = el("st-low");
    var fill = function () {
      var art = artFor(s);
      el("st-art").style.backgroundImage = cssUrl(art);
      el("st-blur").style.backgroundImage = cssUrl(art);
      if (!same) {
        el("st-cover").style.backgroundImage = cssUrl(art);
        bigArt(s, function (u) {
          if (S.song !== s || u === art) return;
          el("st-cover").style.backgroundImage = cssUrl(u);
          el("st-art").style.backgroundImage = cssUrl(u);
        });
      }
      el("st-title").textContent = text(s.title) || "Untitled";
      el("st-artist").textContent = text(s.artist);
      renderKicker();
      renderDeck();
      low.classList.remove("is-changing");
    };
    if (same) return fill();
    low.classList.add("is-changing");
    setTimeout(fill, 260);
  }

  function renderKicker() {
    var s = S.song;
    if (!s) return;
    var dj = s.djid && S.users[s.djid] && S.users[s.djid].username || s.djname;
    var bits = [];
    if (dj) bits.push("Picked by " + text(dj));
    if (S.bpm) bits.push(S.bpm + " BPM");
    el("st-kicker").textContent = bits.length ? bits.join(" · ") : "Now playing";
  }

  // Avatars, as the room shows them: the room's theme (config.js avatarset, or
  // the season's), else each person's own style (js/helpers.js avatarURL)
  function normStyle(v) { v = String(v || "").trim(); return !v ? null : /^(robohash|dicebear):/.test(v) ? v : "robohash:" + v; }
  var roomStyle = normStyle(cfg.avatarset) || (function () {
    var seasons = cfg.avatarSeasons !== undefined ? cfg.avatarSeasons : (typeof AVATAR_SEASONS !== "undefined" ? AVATAR_SEASONS : null);
    var month = new Date().getMonth() + 1;
    if (!Array.isArray(seasons)) return null;
    for (var i = 0; i < seasons.length; i++) {
      if (seasons[i] && Array.isArray(seasons[i].months) && seasons[i].months.indexOf(month) !== -1) return normStyle(seasons[i].style);
    }
    return null;
  })();
  function avatar(uid, name) {
    var u = S.users[uid] || {};
    var style = roomStyle || normStyle(u.avatarStyle) || "robohash:set1";
    if (style.indexOf("dicebear:") === 0) return "https://api.dicebear.com/9.x/" + style.slice(9) + "/svg?seed=" + encodeURIComponent(uid + name);
    return ROBOTS + encodeURIComponent(uid + name) + ".png?size=220x220&set=" + encodeURIComponent(style.slice(9) || "set1");
  }

  var deckHtml = "";
  function renderDeck() {
    var deck = el("st-deck");
    var seats = (Array.isArray(S.table) ? S.table : Object.keys(S.table || {}).map(function (k) { return S.table[k]; })).filter(function (d) { return d && d.id; });
    var on = S.song && S.song.djid;
    var html = seats.slice(0, 6).map(function (d) {
      var name = text((S.users[d.id] && S.users[d.id].username) || d.name || "DJ");
      var live = String(d.id) === String(on);
      return '<li class="st-dj' + (live ? " is-on" : "") + '"' + (live ? ' aria-current="true"' : "") + ">" +
        '<span class="st-face" style="background-image:' + escAttr(cssUrl(avatar(d.id, name))) + '"></span>' +
        '<span class="st-plate">' + escHtml(name) + "</span></li>";
    }).join("");
    if (html !== deckHtml) { deck.innerHTML = html; deckHtml = html; }
    deck.hidden = !seats.length;
    renderKicker();
  }
  function escHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function escAttr(s) { return escHtml(s); }

  function renderCount() {
    // who's online (status true), not the bot: the site's own count (js/users.js)
    var n = Object.keys(S.users || {}).filter(function (k) { return S.users[k] && S.users[k].status === true && !S.users[k].hostbot; }).length;
    var c = el("st-count");
    c.hidden = !n;
    c.textContent = n.toLocaleString("en-US") + " in the room";
  }

  /** The DJs bob to the song's tempo (songBpm, from the hostbot), as on the site. */
  function beat() {
    var b = S.bpmData, s = S.song;
    var bpm = b && s && Number(b.started) === Number(s.started) && Number(b.bpm);
    if (!(bpm >= 40 && bpm <= 250)) {
      S.bpm = null;
      root.classList.remove("has-beat");
    } else {
      S.bpm = Math.round(bpm);
      var bop = 120 / bpm;
      root.style.setProperty("--beat", (60 / bpm).toFixed(4) + "s");
      root.style.setProperty("--bop", bop.toFixed(4) + "s");
      root.style.setProperty("--beat-phase", (-(((Date.now() - Number(s.started)) / 1000) % bop)).toFixed(3) + "s");
      root.classList.add("has-beat");
    }
    renderKicker();
  }

  // ─── Playing it ─────────────────────────────────────────────────────────

  function effectiveVol() { return S.muted ? 0 : S.vol; }

  function play() {
    var s = S.song;
    if (!s) return;
    if (isYT(s)) {
      if (S.sc && S.scReady) S.sc.pause();
      if (!S.ytReady) return; // onReady plays it
      var at = pos();
      if (s.duration && at >= Number(s.duration) - 1) return; // over; the next one is on its way
      if (S.sound && !S.muted) S.yt.unMute(); else S.yt.mute();
      S.yt.setVolume(S.vol);
      S.yt.loadVideoById({ videoId: String(s.cid), startSeconds: at || 0, suggestedQuality: "large" });
    } else if (isSC(s)) {
      if (S.ytReady) S.yt.stopVideo();
      if (S.sound) scPlay();
    }
  }

  function stopAll() {
    if (S.ytReady) S.yt.stopVideo();
    if (S.sc && S.scReady) S.sc.pause();
  }

  function showVideo(on) {
    clearTimeout(S.revealTimer);
    if (!on) return root.classList.remove("has-video");
    S.revealTimer = setTimeout(function () {
      if (isYT(S.song) && !S.ytFailed && VIDEO) root.classList.add("has-video");
    }, REVEAL_MS);
  }

  window.onYouTubeIframeAPIReady = function () {
    S.yt = new YT.Player("st-yt", {
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, cc_load_policy: 0, playsinline: 1, rel: 0, origin: location.origin !== "null" ? location.origin : undefined },
      events: {
        onReady: function () {
          S.ytReady = true;
          var frame = S.yt.getIframe && S.yt.getIframe();
          if (frame) { frame.setAttribute("tabindex", "-1"); frame.setAttribute("title", "The room's video"); }
          if (isYT(S.song)) play();
        },
        onStateChange: function (e) {
          if (!isYT(S.song)) return;
          if (e.data === YT.PlayerState.PLAYING) {
            // no captions over the stage (some videos and viewers turn them on)
            try { S.yt.unloadModule("captions"); S.yt.unloadModule("cc"); } catch (x) { /* not loaded */ }
            showVideo(true);
            sync();
          } else if (e.data === YT.PlayerState.PAUSED && S.sound && !S.muted) {
            // something paused the room (the browser, a stalled stream): back in
            setTimeout(function () { if (S.ytReady && isYT(S.song) && S.yt.getPlayerState() === YT.PlayerState.PAUSED) S.yt.playVideo(); }, 1200);
          }
        },
        onError: function () {
          S.ytFailed = true;
          showVideo(false);
          if (isYT(S.song)) note("This one can't play outside YouTube. It's still on in the room.");
        }
      }
    });
  };

  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  var scScript = null;
  function scPlay() {
    var s = S.song;
    if (!isSC(s)) return;
    var url = SC_TRACK + encodeURIComponent(s.cid);
    var start = function () {
      if (!isSC(S.song) || S.song !== s) return;
      S.sc.setVolume(effectiveVol());
      S.sc.play();
    };
    scScript = scScript || loadScript("https://w.soundcloud.com/player/api.js");
    scScript.then(function () {
      if (!window.SC || !SC.Widget) throw new Error("no widget");
      if (S.sc) return S.scReady ? S.sc.load(url, { auto_play: true, show_artwork: false, callback: start }) : (S.scWaiting = start);
      var frame = el("st-sc");
      frame.src = "https://w.soundcloud.com/player/?" + new URLSearchParams({ url: url, auto_play: "true", show_artwork: "false" });
      S.sc = SC.Widget(frame);
      S.sc.bind(SC.Widget.Events.READY, function () {
        S.scReady = true;
        S.sc.bind(SC.Widget.Events.PLAY, function () { S.sc.setVolume(effectiveVol()); sync(); });
        S.sc.bind(SC.Widget.Events.ERROR, function () { note("This one won't play here right now. It's still on in the room."); });
        start();
        if (S.scWaiting) { var w = S.scWaiting; S.scWaiting = null; w(); }
      });
    }).catch(function () { note("SoundCloud's player didn't load. Open the room to hear this one."); });
  }

  /** Keep in step with the room (a slow load or a throttled tab drifts). */
  function sync() {
    var want = pos();
    var s = S.song;
    if (want === null || !s) return;
    if (s.duration && want >= Number(s.duration) - 1) return;
    if (isYT(s) && S.ytReady) {
      var data = S.yt.getVideoData && S.yt.getVideoData();
      if (data && data.video_id && data.video_id !== String(s.cid)) return;
      var at = S.yt.getCurrentTime && S.yt.getCurrentTime();
      if (typeof at === "number" && Math.abs(at - want) > DRIFT_S) S.yt.seekTo(want, true);
    } else if (isSC(s) && S.sc && S.scReady && S.sound) {
      S.sc.getPosition(function (ms) {
        if (isSC(S.song) && Math.abs(ms / 1000 - pos()) > SC_DRIFT_S) S.sc.seekTo(Math.round(pos() * 1000));
      });
    }
  }

  // ─── Sound controls ─────────────────────────────────────────────────────

  function applyVolume() {
    var v = effectiveVol();
    if (S.ytReady) {
      S.yt.setVolume(S.vol);
      if (S.sound && !S.muted) S.yt.unMute(); else S.yt.mute();
    }
    if (S.sc && S.scReady) S.sc.setVolume(v);
    el("st-vol").classList.toggle("is-muted", S.muted || !S.vol);
    el("st-mute").setAttribute("aria-label", S.muted ? "Unmute" : "Mute");
    el("st-volume").value = S.vol;
    el("st-volume").style.setProperty("--fill", (S.muted ? 0 : S.vol) + "%");
  }

  function listen() {
    S.sound = true;
    if (S.muted) { S.muted = false; write(MUTE_KEY, "0"); }
    el("st-listen").hidden = true;
    el("st-vol").hidden = false;
    root.classList.add("is-listening");
    applyVolume();
    var s = S.song;
    if (isYT(s) && S.ytReady) {
      S.yt.unMute();
      S.yt.playVideo();
      sync();
    } else if (isSC(s)) {
      scPlay();
    }
  }

  el("st-listen").addEventListener("click", listen);
  el("st-mute").addEventListener("click", function () {
    S.muted = !S.muted;
    if (!S.muted && !S.vol) S.vol = 50;
    write(MUTE_KEY, S.muted ? "1" : "0");
    applyVolume();
  });
  el("st-volume").addEventListener("input", function (e) {
    S.vol = clampVol(e.target.value);
    S.muted = !S.vol;
    write(VOL_KEY, String(S.vol));
    write(MUTE_KEY, S.muted ? "1" : "0");
    applyVolume();
  });
  document.addEventListener("keydown", function (e) {
    if (/^(input|textarea|select)$/i.test(e.target.tagName || "")) return;
    if (e.key === "m" || e.key === "M") { if (S.sound) el("st-mute").click(); else listen(); }
  });

  // the controls rest while the mouse does
  var idle = null;
  function wake() {
    root.classList.remove("is-idle");
    clearTimeout(idle);
    idle = setTimeout(function () { if (!root.querySelector(":focus-visible")) root.classList.add("is-idle"); }, 3500);
  }
  ["mousemove", "pointerdown", "keydown", "focusin"].forEach(function (t) { document.addEventListener(t, wake, { passive: true }); });
  wake();

  // ─── The clock ──────────────────────────────────────────────────────────

  function tick() {
    var s = S.song, p = pos();
    var len = s && Number(s.duration);
    el("st-prog").hidden = !s;
    if (!s) return;
    el("st-bar").style.transform = "scaleX(" + (len ? Math.min(1, p / len) : 0) + ")";
    el("st-at").textContent = clock(p);
    el("st-left").textContent = len ? "-" + clock(len - p) : "";
  }
  setInterval(tick, 500);
  setInterval(sync, 5000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { sync(); beat(); } });

  // ─── When something's in the way ────────────────────────────────────────

  setTimeout(function () {
    if (!S.ytReady && isYT(S.song)) note("YouTube's player didn't load here, so this song can't play. It's still on in the room.");
  }, 15000);
  document.addEventListener("securitypolicyviolation", function (e) {
    console.warn("Blocked by this page's policy:", e.violatedDirective, e.blockedURI);
  });
  // a new tab the frame isn't allowed to open: say where the room is instead
  root.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[target=_blank]");
    if (!a) return;
    e.preventDefault();
    var w = null;
    try { w = window.open(a.href, "_blank"); } catch (x) { /* not allowed here */ }
    if (w) { try { w.opener = null; } catch (x) { /* another site's window */ } return; }
    note("This screen can't open a new tab. The room is at " + new URL(site).host.replace(/^www\./, "") + ".");
    setTimeout(function () { note(""); }, 8000);
  });

  // ─── Start ──────────────────────────────────────────────────────────────

  var home = site + "#live";
  el("st-brand").href = home;
  el("st-open").href = home;
  el("st-quietLink").href = home;
  el("st-quietLink").textContent = new URL(site).host.replace(/^www\./, "");
  if (cfg.roomNameShort || cfg.roomName) el("st-name").textContent = cfg.roomNameShort || cfg.roomName;
  if (!VIDEO) root.classList.add("no-video");
  colors(null);
  applyVolume();

  if (!dbUrl || typeof EventSource === "undefined") {
    root.classList.remove("is-loading");
    el("st-title").textContent = "The stage isn't available right now";
    return;
  }
  watch("songToPlay", onSong);
  watch("table", function (t) { S.table = t || []; renderDeck(); });
  watch("users", function (u) { S.users = u || {}; renderCount(); renderDeck(); });
  watch("songBpm", function (b) { S.bpmData = b; beat(); });
})();
