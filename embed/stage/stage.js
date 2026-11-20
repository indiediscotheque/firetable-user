/**
 * stage.js — the room's live stage, for another site's screen (QueUp's).
 *
 *   <iframe src="https://<site>/embed/stage/" allow="autoplay"
 *     style="border:0;width:100%;aspect-ratio:16/9" title="Indie Discotheque, live"></iframe>
 *
 * Unlisted: nothing links here, it's never indexed, and .htaccess lets only
 * this site and QueUp frame it. It looks like the room's stage with its screen
 * up (the song's cover and words, the DJ playing standing at their plaque and
 * bobbing to the beat, the others in line, the times and the theme, in the
 * playing song's colours) and scales as one picture to any size of box
 * (stage.css). The sound is the room's radio stream (Icecast, STREAM below;
 * config.js stageStreamURL to change it): it starts by itself where the
 * browser allows, else with "Listen live".
 *
 * It reads the room's public nodes over Firebase's REST streaming API
 * (EventSource): no sign-in, no Firebase library, nothing written. Two
 * streams: the song (songToPlay) and the hostbot's stage summary (stage:
 * who's in the room and at the table, the song's colours, theme, tempo,
 * facts and fires), one small node written only when what it shows changes.
 * The database bills every byte it sends, so it never follows users/ (every
 * member there has ever been). Until the hostbot publishes stage/, it falls
 * back to the old way: the table, users and songFires streamed, and the
 * song's looks read every minute.
 *
 * Fire: when people call the song hot (🔥 in the room's chat, which only
 * members can read), the site's fire burns behind the DJ (flame.js: js/fire.js
 * drawn with a plain canvas), bigger with every fire. The hostbot publishes the count for the playing song
 * at songFires ({ started, count }, readable by anyone); until it does, no fire.
 *
 * Options: ?volume=0-100 (the starting volume; a listener's own choice
 * wins), ?autoplay=0 (always wait for "Listen live").
 */
(function () {
  "use strict";
  var cfg = typeof ftconfigs !== "undefined" ? ftconfigs : {};
  var el = function (id) { return document.getElementById(id); };
  var root = el("st");
  var audio = el("st-audio");
  var site = new URL("../../", location.href).href;
  var dbUrl = String((cfg.firebase && cfg.firebase.databaseURL) || "").replace(/\/$/, "");
  var q = new URLSearchParams(location.search);
  // the room's radio: every song, whatever it plays from (another host needs
  // adding to media-src in .htaccess)
  var STREAM = absoluteUrl(cfg.stageStreamURL || "https://radio.howtojointheindiediscothequewaitlist.com/stream.ogg");
  var AUTOPLAY = q.get("autoplay") !== "0";
  var VOL_KEY = "ft-stage-volume", MUTE_KEY = "ft-stage-muted";
  var YT_TYPE = typeof MEDIA_YOUTUBE !== "undefined" ? MEDIA_YOUTUBE : 1;
  var SC_TYPE = typeof MEDIA_SOUNDCLOUD !== "undefined" ? MEDIA_SOUNDCLOUD : 2;
  var ROBOTS = typeof AVATAR_BASE_URL !== "undefined" ? AVATAR_BASE_URL : "https://indiediscotheque.com/robots/";
  var ACCENT = typeof COLOR_ORANGE !== "undefined" ? COLOR_ORANGE : "#cc9933";
  var ROOM = cfg.roomNameShort || cfg.roomName || "Indie Discotheque";

  var S = {
    song: null, key: "", table: [], users: {}, online: null, staged: false, bpm: null, bpmData: null, theme: "", firesData: null, fires: 0,
    sound: false, muted: read(MUTE_KEY) === "1",
    vol: clampVol(read(VOL_KEY) !== null ? read(VOL_KEY) : q.get("volume") !== null ? q.get("volume") : 80),
    retry: null, retryWait: 2000
  };

  // ─── Small helpers ──────────────────────────────────────────────────────

  function absoluteUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return ""; } }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function clampVol(v) { v = Number(v); return isNaN(v) ? 80 : Math.max(0, Math.min(100, Math.round(v))); }
  /** Song and theme text is saved with entities (&amp;): decode it inertly. */
  function text(s) {
    var t = document.createElement("template");
    t.innerHTML = String(s == null ? "" : s);
    return (t.content.textContent || "").replace(/\s+/g, " ").trim();
  }
  /** As the site's stage timers (formatClock in js/room.js): 03:07. */
  function clock(secs) {
    secs = Math.max(0, Math.floor(secs || 0));
    var m = Math.floor(secs / 60), x = secs % 60;
    return (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function absolute(u) { try { return new URL(u, site).href; } catch (e) { return ""; } }
  function cssUrl(u) { return u ? 'url("' + String(u).replace(/["\\\n]/g, encodeURIComponent) + '")' : ""; }
  function escHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function isYT(s) { return s && Number(s.type) === YT_TYPE; }
  function isSC(s) { return s && Number(s.type) === SC_TYPE; }
  /** Seconds into the room's song now, or null when there's none. */
  function pos() {
    var s = S.song;
    if (!s || !s.started) return null;
    var p = Math.max(0, (Date.now() - Number(s.started)) / 1000);
    return s.duration ? Math.min(p, Number(s.duration)) : p;
  }
  /** Pixels in 1em right now (the box's size: stage.css). */
  function em() { return parseFloat(getComputedStyle(document.body).fontSize) || 16; }
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
  /**
   * Follow one node; `cb` gets its whole value after every change, `onFail`
   * (optional) hears when the stream is refused or lost (it's tried again).
   * @returns {{close: function()}}
   */
  function watch(path, cb, onFail) {
    var data = null, es = null, wait = 1000, closed = false;
    function open() {
      if (closed) return;
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
      es.addEventListener("cancel", failed);
      es.addEventListener("auth_revoked", failed);
      es.onerror = function () { if (es.readyState === EventSource.CLOSED) failed(); };
    }
    function failed() {
      if (closed) return;
      if (onFail) onFail();
      retry();
    }
    function retry() {
      if (es) es.close();
      setTimeout(open, wait);
      wait = Math.min(wait * 2, 60000);
    }
    open();
    return { close: function () { closed = true; if (es) es.close(); } };
  }
  function once(path) {
    return fetch(dbHref(path).href).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  // ─── The stage summary (stage/), or the old way until there is one ───────

  var old = null, stageWait = null;
  /** The hostbot's summary: who's here and at the table, the song's looks and fires. */
  function onStage(st) {
    if (!st || typeof st !== "object") { S.staged = false; oldWay(); return; }
    clearTimeout(stageWait);
    if (!S.staged) { S.staged = true; S.users = {}; endOldWay(); }
    S.online = st.online;
    S.table = (Array.isArray(st.deck) ? st.deck : []).filter(function (d) { return d && d.id; })
      .map(function (d) { return { id: String(d.id), name: d.n, av: d.av }; });
    colors(st.colors);
    theme(st.theme);
    S.bpmData = st.bpm || null;
    beat();
    tagged(st.tag || null);
    S.firesData = st.fires || null;
    fire();
    renderCount();
    renderDeck();
  }
  /** Before the hostbot publishes stage/: the table, users and fires streamed, the looks read. */
  function oldWay() {
    if (old) return;
    old = {
      streams: [
        watch("table", function (t) { if (!S.staged) { S.table = t || []; renderDeck(); } }),
        watch("users", function (u) { if (!S.staged) { S.users = u || {}; renderCount(); renderDeck(); } }),
        watch("songFires", function (f) { if (!S.staged) { S.firesData = f; fire(); } })
      ],
      poll: setInterval(function () { if (S.song && !S.staged) readLooks(); }, 60000)
    };
    if (S.song) roomLooks();
  }
  function endOldWay() {
    if (!old) return;
    old.streams.forEach(function (w) { w.close(); });
    clearInterval(old.poll);
    looksTimers.forEach(clearTimeout);
    old = null;
  }

  // ─── What's on: colours, theme, the song, the decks ─────────────────────

  function colors(c) {
    var color = c && typeof c.color === "string" && CSS.supports("color", c.color) ? c.color : ACCENT;
    var txt = c && typeof c.txt === "string" && CSS.supports("color", c.txt) ? c.txt : "#fff";
    root.style.setProperty("--acc", color);
    root.style.setProperty("--acc-txt", txt);
  }
  /** The theme, under the stage (the room's name when there's none). */
  function theme(t) {
    t = text(t);
    S.theme = t;
    el("st-theme").classList.toggle("no-theme", !t);
    el("st-themeText").textContent = t || ROOM;
  }
  /** Colours and theme change with the song: read them as it starts, and again once the bot has set them. */
  /**
   * What the bot sets for each song, read when it starts and again as the bot
   * fills it in (its colours at once, the tempo and the plays a few seconds
   * later), then every minute for a mod's fix. Read, not streamed: a browser
   * keeps only six connections to one server, and the live streams (the song,
   * the decks, who's here, the fires) take four.
   */
  var looksTimers = [];
  function readLooks() {
    // an answer that lands after the stage summary arrived is the old way's: the summary wins
    var oldWay = function (fn) { return function (v) { if (!S.staged) fn(v); }; };
    var keep = function () { /* keep what's there */ };
    once("colors").then(oldWay(colors), keep);
    once("theme").then(oldWay(theme), keep);
    once("songBpm").then(oldWay(function (b) { S.bpmData = b; beat(); }), keep);
    once("tagUpdate").then(oldWay(tagged), keep);
  }
  function roomLooks() {
    looksTimers.forEach(clearTimeout);
    looksTimers = [0, 3000, 10000, 30000].map(function (ms) { return setTimeout(readLooks, ms); });
  }
  /** The bot's facts on the song (and a mod's tag fix): the words follow. */
  function tagged(t) {
    S.tag = t;
    if (S.song && tagFor(S.song)) nowPlaying(S.song, true);
  }

  function artFor(s) {
    if (!s) return "";
    var img = s.image && s.image !== "img/idlogo.png" ? String(s.image) : (cfg.defaultAlbumArtUrl || "");
    if (isSC(s) && img) img = img.replace("-large", "-t500x500");
    // YouTube's widescreen frame: no black bars baked in (hqdefault has them), so cropped square it fills the cover
    if (isYT(s) && (!img || /ytimg\.com/.test(img))) img = "https://i.ytimg.com/vi/" + encodeURIComponent(s.cid) + "/mqdefault.jpg";
    return absolute(img || "img/idlogo.png");
  }
  /** The sharpest cover there is, for a big box: YouTube's full-size frame, SoundCloud's original. */
  function bigArt(s, cb) {
    var small = artFor(s);
    var big = isYT(s) ? "https://i.ytimg.com/vi/" + encodeURIComponent(s.cid) + "/maxresdefault.jpg"
      : isSC(s) && /-t500x500\./.test(small) ? small.replace("-t500x500.", "-original.") : null;
    if (!big) return;
    var img = new Image();
    // YouTube answers a missing size with a 120 × 90 placeholder
    img.onload = function () { if (img.naturalWidth > 200) cb(big); };
    img.src = big;
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
    el("st-listen").hidden = S.sound || !live;
    mediaSession();
    tick();
    if (!live) { renderDeck(); return; }
    nowPlaying(s, same);
    if (same) return; // a tag fix: only the words change
    if (!S.staged) roomLooks(); // the stage summary brings them otherwise
    beat();
    S.fires = 0;
    fire();
  }

  function nowPlaying(s, same) {
    var box = el("st-now");
    var fill = function () {
      var art = artFor(s);
      el("st-art").style.backgroundImage = cssUrl(art);
      if (!same) bigArt(s, function (u) { if (S.song === s) el("st-art").style.backgroundImage = cssUrl(u); });
      var t = tagFor(s);
      el("st-title").textContent = text(t && t.track_name || s.title) || "Untitled";
      el("st-artist").textContent = text(t && t.artist || s.artist);
      renderKicker();
      renderDeck();
      box.classList.remove("is-changing");
    };
    // the first song shows at once; later ones fade across
    if (same || !box.dataset.shown) { box.dataset.shown = "1"; return fill(); }
    box.classList.add("is-changing");
    setTimeout(fill, 200);
  }

  /**
   * The bot's facts on the playing song (tagUpdate.adamData, public): its
   * plays in the room, and its first and last; a mod's tag fix too.
   */
  function tagFor(s) {
    var t = S.tag;
    return t && s && t.adamData && String(t.cid) === String(s.cid) ? t.adamData : null;
  }
  /** As the site's stage: "Apr 14" this year, "Apr 14, 2013" before (js/helpers.js shortDate). */
  function shortDate(d) {
    var date = new Date(d);
    if (isNaN(date)) return "";
    var out = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()] + " " + date.getDate();
    return date.getFullYear() === new Date().getFullYear() ? out : out + ", " + date.getFullYear();
  }
  /** "first Apr 14, 2013 by matt", the DJ only when known (js/room.js playLine). */
  function playLine(word, date, dj) { return word + " " + shortDate(date) + (dj ? " by " + text(dj) : ""); }
  /**
   * Under the artist, as the room's stage shows it: the tempo, the room's
   * plays and the fires; then the first and last plays. (Who picked it is on
   * the deck.)
   */
  function renderKicker() {
    var s = S.song;
    if (!s) return;
    var a = tagFor(s) || {};
    var stats = [];
    if (S.bpm) stats.push(S.bpm + " BPM");
    if (Number(a.playcount) > 0) {
      stats.push(Number(a.playcount).toLocaleString("en-US") + (Number(a.playcount) === 1 ? " play" : " plays") +
        (Number(a.all_versions_playcount) > Number(a.playcount) ? " · " + Number(a.all_versions_playcount).toLocaleString("en-US") + " all versions" : ""));
    }
    if (S.fires) stats.push("\uD83D\uDD25 " + S.fires);
    el("st-kicker").textContent = stats.join(" · ");
    var plays = [];
    if (a.first_play) plays.push(playLine("first", a.first_play, a.first_play_dj));
    if (a.last_play) plays.push(playLine("last", a.last_play, a.last_play_dj));
    el("st-plays").textContent = plays.join(" · ");
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
  /** A DJ's picture, asked for at the size it's drawn (`ems` tall) on this screen, so it's sharp at any size. */
  function avatar(uid, name, ems, av) {
    var u = S.users[uid] || {};
    var style = roomStyle || normStyle(av || u.avatarStyle) || "robohash:set1";
    if (style.indexOf("dicebear:") === 0) return "https://api.dicebear.com/9.x/" + style.slice(9) + "/svg?seed=" + encodeURIComponent(uid + name);
    var px = Math.min(600, Math.max(60, Math.ceil(ems * em() * (window.devicePixelRatio || 1) / 60) * 60));
    return ROBOTS + encodeURIComponent(uid + name) + ".png?size=" + px + "x" + px + "&set=" + encodeURIComponent(style.slice(9) || "set1");
  }

  var deckHtml = "", lineHtml = "";
  /** The DJ playing on the deck, at their plaque; the others in line beside it (the site's #deck and #ondeck). */
  function renderDeck() {
    var seats = (Array.isArray(S.table) ? S.table : Object.keys(S.table || {}).map(function (k) { return S.table[k]; }))
      .filter(function (d) { return d && d.id; });
    var on = S.song && S.song.djid;
    var nameOf = function (d) { return text((S.users[d.id] && S.users[d.id].username) || d.name || "DJ"); };
    var playing = seats.filter(function (d) { return String(d.id) === String(on); })[0] || (S.song ? null : seats[0]);
    var html = playing ? '<li class="st-spot" aria-current="true"><span class="st-avtr" style="background-image:' +
      escHtml(cssUrl(avatar(playing.id, nameOf(playing), 8, playing.av))) + '"></span><span class="st-plaque">' + escHtml(nameOf(playing)) + "</span></li>" : "";
    var line = seats.filter(function (d) { return d !== playing; }).slice(0, 6).map(function (d) {
      return '<li title="' + escHtml(nameOf(d)) + '" aria-label="' + escHtml(nameOf(d)) + '" style="background-image:' + escHtml(cssUrl(avatar(d.id, nameOf(d), 3.8, d.av))) + '"></li>';
    }).join("");
    if (html !== deckHtml) { el("st-deck").innerHTML = html; deckHtml = html; }
    if (line !== lineHtml) { el("st-ondeck").innerHTML = line; lineHtml = line; }
    renderKicker();
  }

  function renderCount() {
    // who's online (status true), not the bot: the site's own count (js/users.js)
    var n = S.staged ? Math.max(0, Number(S.online) || 0)
      : Object.keys(S.users || {}).filter(function (k) { return S.users[k] && S.users[k].status === true && !S.users[k].hostbot; }).length;
    var c = el("st-count");
    c.hidden = !n;
    c.textContent = n.toLocaleString("en-US") + " in the room";
  }

  /** The DJ bobs to the song's tempo (songBpm, from the hostbot), as on the site. */
  function beat() {
    var b = S.bpmData, s = S.song;
    var bpm = b && s && Number(b.started) === Number(s.started) && Number(b.bpm);
    if (!(bpm >= 40 && bpm <= 250)) {
      S.bpm = null;
      root.classList.remove("has-beat");
    } else {
      S.bpm = Math.round(bpm);
      var bop = 120 / bpm; // one bob every two beats
      root.style.setProperty("--beat", (60 / bpm).toFixed(4) + "s");
      root.style.setProperty("--bop", bop.toFixed(4) + "s");
      root.style.setProperty("--beat-phase", (-(((Date.now() - Number(s.started)) / 1000) % bop)).toFixed(3) + "s");
      root.classList.add("has-beat");
    }
    renderKicker();
  }

  /**
   * Fire: the song's 🔥 count (songFires, from the hostbot) for the song
   * playing now, as the room's stage shows it (js/chat.js
   * updateFireReactionDisplay): each new fire stokes it and it grows with the
   * count; none and it goes out.
   */
  var flame = null;
  function fire() {
    var f = S.firesData, s = S.song;
    var n = f && s && Number(f.started) === Number(s.started) ? Math.max(0, Math.floor(Number(f.count) || 0)) : 0;
    var changed = n !== S.fires;
    S.fires = n;
    root.classList.toggle("has-fire", n > 0);
    if (changed && (n || flame) && typeof window.stageFlame === "function") {
      flame = flame || window.stageFlame(el("fyre"));
      fyreScale();
      if (n) flame.ignite(n); else flame.setIntensity(0);
    }
    renderKicker();
  }
  /** The fire is drawn for a stage the site's size: scale it with the box (the site's #fyre is 216px wide, for its 160px deck spot). */
  function fyreScale() { if (flame) flame.setScale(el("fyre").clientWidth / 216); }
  window.addEventListener("resize", fyreScale);

  // ─── The sound: the room's radio stream ─────────────────────────────────

  function applyVolume() {
    audio.volume = S.vol / 100;
    audio.muted = S.muted || !S.vol;
    el("st-vol").classList.toggle("is-muted", S.muted || !S.vol);
    el("st-mute").setAttribute("aria-label", S.muted ? "Unmute" : "Mute");
    el("st-volume").value = S.vol;
    el("st-volume").style.setProperty("--fill", (S.muted ? 0 : S.vol) + "%");
  }

  /** Join the stream at its live edge (a fresh connection, never a stale buffer). */
  function tuneIn() {
    clearTimeout(S.retry);
    audio.src = STREAM + (STREAM.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
    return audio.play();
  }

  function listening(on) {
    S.sound = on;
    el("st-listen").hidden = on || !S.song;
    el("st-vol").hidden = !on;
    root.classList.toggle("is-listening", on);
    mediaSession();
  }

  function listen() {
    if (S.muted) { S.muted = false; write(MUTE_KEY, "0"); }
    applyVolume();
    listening(true);
    tuneIn().catch(function (e) {
      if (e && e.name === "NotAllowedError") return listening(false);
      reconnect();
    });
  }

  function stopListening() {
    clearTimeout(S.retry);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    listening(false);
  }

  /** The stream dropped (the network, the server restarting): back in, a little later each time. */
  function reconnect() {
    if (!S.sound) return;
    clearTimeout(S.retry);
    root.classList.add("is-buffering");
    S.retry = setTimeout(function () {
      tuneIn().catch(function () { reconnect(); });
    }, S.retryWait);
    S.retryWait = Math.min(S.retryWait * 2, 30000);
  }
  audio.addEventListener("playing", function () {
    S.retryWait = 2000;
    root.classList.remove("is-buffering");
  });
  audio.addEventListener("waiting", function () { if (S.sound) root.classList.add("is-buffering"); });
  ["error", "ended", "stalled"].forEach(function (t) { audio.addEventListener(t, reconnect); });

  /** The song on the listener's lock screen and media keys. */
  function mediaSession() {
    if (!("mediaSession" in navigator)) return;
    var s = S.song;
    try {
      navigator.mediaSession.metadata = s ? new MediaMetadata({
        title: text(s.title), artist: text(s.artist), album: ROOM + " · live",
        artwork: [{ src: artFor(s), sizes: "512x512" }]
      }) : null;
      navigator.mediaSession.playbackState = S.sound ? "playing" : "paused";
      navigator.mediaSession.setActionHandler("play", function () { listen(); });
      navigator.mediaSession.setActionHandler("pause", function () { stopListening(); });
    } catch (e) { /* not supported here */ }
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
  // the stream holds a connection open: let go of it while the page is gone
  window.addEventListener("pagehide", function () { clearTimeout(S.retry); audio.pause(); });

  // a frame that can't open a new tab: say where the room is instead
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

  // a much bigger or smaller box: ask for avatars drawn sharp at the new size
  var lastEm = em();
  window.addEventListener("resize", function () {
    var now = em();
    if (Math.abs(now - lastEm) / lastEm < 0.25) return;
    lastEm = now;
    deckHtml = lineHtml = "";
    renderDeck();
  });

  // ─── The clock ──────────────────────────────────────────────────────────

  function tick() {
    var s = S.song, p = pos();
    var len = s && Number(s.duration);
    el("st-bar").style.transform = "scaleX(" + (s && len ? Math.min(1, p / len) : 0) + ")";
    el("st-at").textContent = s ? clock(p) : "";
    el("st-left").textContent = s && len ? "−" + clock(Math.ceil(len - p)) : "";
  }
  setInterval(tick, 500);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) beat(); });

  // ─── Start ──────────────────────────────────────────────────────────────

  var home = site + "#live";
  el("st-open").href = home;
  el("st-theme").href = home;
  el("st-quietLink").href = home;
  el("st-quietLink").textContent = new URL(site).host.replace(/^www\./, "");
  theme("");
  colors(null);
  applyVolume();
  // where the page that shows this allows it (allow="autoplay" and a visit it
  // knows), the radio starts by itself; otherwise "Listen live" waits
  if (AUTOPLAY) {
    S.sound = true;
    tuneIn().then(function () { listening(true); }, function () { S.sound = false; stopListening(); });
  }

  if (!dbUrl || typeof EventSource === "undefined") {
    root.classList.remove("is-loading");
    el("st-title").textContent = "The stage isn't available right now";
    return;
  }
  watch("songToPlay", onSong);
  watch("stage", onStage, function () { if (!S.staged) oldWay(); });
  // no summary yet (an older hostbot, or the rules not published): the old way
  stageWait = setTimeout(function () { if (!S.staged) oldWay(); }, 10000);
})();
