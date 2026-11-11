/**
 * discover.js — Discover: the library side of the site.
 *
 * Off unless config.js sets `discover: true`. When on, a Discover / Live
 * switch sits under the room theme. Visitors open the site on Discover,
 * members on Live, and each person's last choice is remembered.
 *
 * Discover is its own page with the site's own parts: the left column keeps
 * the header and theme, then one line about the room (the song, the DJ, how
 * many are here, Listen in) and the views; the middle shows the library on
 * the Fresh cards and Recent rows; the right column is a player (Now playing)
 * and your crate or playlists.
 *
 * Views (phase 1): Home, New, Charts, Recent plays. The bot publishes the
 * charts, new releases and a chat peek under discover/ (firetable-hostbot's
 * lib/discover.js); song details come from the play history (globalTracks,
 * globalSongs) and tempos (bpm/), all public.
 *
 * Playback uses the room's own players, the way 30-second previews do:
 * firetable.preview = "discover" stops the room from re-syncing, and going
 * back to Live (or Listen in) picks the room up where it is now. Discover
 * plays whole songs and isn't scrobbled.
 *
 * Visitors save songs to a crate kept in this browser. The third save offers
 * to keep it; when they join, it becomes a playlist ("My Discover crate"),
 * their DJ playlist if they have none yet. "Step inside" shows Live as
 * visitors see it today, with the chat to read (discover/chat).
 *
 * Addresses: #discover, #discover/new, #discover/charts,
 * #discover/charts/<week|month|year|all>/<id>, #discover/recent, #live.
 */

firetable.discover = (function () {
  var D = {
    on: false,
    mode: null,          // "discover" | "live"
    view: "home",        // home | new | charts | recent
    chart: { period: "week", id: null },
    newFilter: "month",  // month | days90 | unplayed
    newLayout: "grid",
    sideTab: "now",      // now | list
    data: { new: null, charts: {}, chartIds: {}, chat: null },
    listening: false,
    signedIn: false
  };

  var CRATE_KEY = "ft-crate";
  var CRATE_ASKED_KEY = "ft-crate-asked";
  var MODE_KEY = "ft-mode";
  var FOUND_KEY = "ft-found";
  var NEW_MONTH_DAYS = 31;

  var esc = function (s) { return firetable.utilities.htmlEscape(s == null ? "" : String(s)); };
  var ms = function (name, filled) { return '<i class="material-symbols-' + (filled ? "filled" : "outlined") + '" aria-hidden="true">' + name + "</i>"; };
  var store = {
    get: function (k, fallback) { try { var v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } }
  };
  var db = function () { return ftapi.db(); };

  // ─── Songs ──────────────────────────────────────────────────────────────

  /** A song's artwork: YouTube's thumbnail, or what the source gave. */
  function artOf(t) {
    if (t.img) return t.img;
    if (Number(t.type || 1) === MEDIA_YOUTUBE) return "https://i.ytimg.com/vi/" + encodeURIComponent(t.cid) + "/mqdefault.jpg";
    return (ftconfigs.defaultAlbumArtUrl) || "img/idlogo.png";
  }
  function linkOf(t) {
    if (t.url) return t.url;
    return Number(t.type || 1) === MEDIA_YOUTUBE ? "https://www.youtube.com/watch?v=" + encodeURIComponent(t.cid) : "";
  }
  /** Is this member's name hidden from visitors? */
  function nameHidden(uid) {
    var u = uid && ftapi.users && ftapi.users[uid];
    return !!(u && u.publicName === false);
  }
  /** Who to show for a DJ: hidden for visitors when they opted out. */
  function djShown(uid, name) {
    if (!name) return null;
    if (!D.signedIn && nameHidden(uid)) return null;
    return { uid: uid || name, name: name };
  }
  function robot(dj, size) {
    if (!dj) return "";
    return '<span class="ft-avatar pv-dj-avatar dj-avatar-tip" role="img" aria-label="' + esc(dj.name) + '" style="background-image:url(' +
      esc(firetable.utilities.avatarURL(dj.uid, dj.name, size || "40x40")) + ')"></span>';
  }
  function saveButton(t) {
    return '<button type="button" class="histeal material-symbols-outlined row-icon" title="Add to playlist" aria-label="Add to playlist">playlist_add</button>';
  }
  function openButton(t) {
    var url = linkOf(t);
    if (!url) return "";
    return '<a class="row-icon tracklink-btn material-symbols-outlined" target="_blank" rel="noopener" href="' + esc(url) + '" title="Open the song" aria-label="Open the song">open_in_new</a>';
  }
  function rowAttrs(t, list, i) {
    return ' data-cid="' + esc(t.cid) + '" data-type="' + esc(t.type || 1) + '" data-list="' + esc(list) + '" data-i="' + i + '"';
  }

  /** A song as a Fresh card. */
  function card(t, list, i, meta) {
    var playing = isPlaying(list, i);
    return '<div class="pvbar' + (playing ? " previewing" : "") + '"' + rowAttrs(t, list, i) + ">" +
      '<div class="pv-art discart" style="background-image:url(' + esc(artOf(t)) + ')">' +
      '<button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + (isSounding(list, i) ? "Pause" : "Play") + '">' + (isSounding(list, i) ? "pause" : "play_arrow") + "</button></div>" +
      '<div class="qtxt"><div class="listwords"><div class="fresh-title"><span class="fresh-track-title">' + esc(t.t) + '</span><span class="fresh-track-artist">' + esc(t.a) + "</span></div>" +
      openButton(t) + saveButton(t) + "</div>" +
      '<div class="fresh-meta">' + robot(meta.dj) + '<span class="histdj">' + esc(meta.who || "") + '</span><span class="histdate">' + esc(meta.date || "") + '</span><span class="histtime">' + esc(meta.extra || "") + "</span></div></div></div>";
  }

  /** A song as a Recent row on the timeline. */
  function row(t, list, i, meta) {
    var playing = isPlaying(list, i);
    return '<div class="hist-entry"><span class="hist-timestamp' + (meta.rank ? " d-rank" : "") + '">' + esc(meta.stamp || "") + "</span>" +
      (meta.dj ? robot(meta.dj) : '<span class="ft-avatar pv-dj-avatar dj-avatar-tip d-nobody" aria-hidden="true"></span>') +
      '<div class="pvbar' + (playing ? " previewing" : "") + '"' + rowAttrs(t, list, i) + ">" +
      '<div class="pv-art histart" style="background-image:url(' + esc(artOf(t)) + ')"><button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + (isSounding(list, i) ? "Pause" : "Play") + '">' + (isSounding(list, i) ? "pause" : "play_arrow") + "</button></div>" +
      '<div class="listwords"><div class="histlink"><span class="hist-track-title">' + esc(t.t) + '</span><span class="hist-track-artist">' + esc(t.a) + "</span></div></div>" +
      (meta.right ? '<span class="d-right">' + meta.right + "</span>" : "") +
      openButton(t) + saveButton(t) + "</div></div>";
  }

  function emptyNote(text) { return '<p class="d-empty">' + esc(text) + "</p>"; }
  function loading() { return '<p class="d-empty">Loading…</p>'; }

  // ─── Lists the views show (also what plays next) ────────────────────────

  var lists = {};  // name -> { label, tracks }

  function setList(name, label, tracks) { lists[name] = { label: label, tracks: tracks }; }

  function newTracks() {
    var all = (D.data.new && D.data.new.tracks) || [];
    var now = Date.now();
    return all.filter(function (t) {
      if (D.newFilter === "unplayed") return !t.plays;
      if (D.newFilter === "month") return t.rel && now - new Date(t.rel).getTime() <= NEW_MONTH_DAYS * 86400000;
      return true;
    }).map(function (t) { return Object.assign({ type: 1 }, t); });
  }

  function newMeta(t) {
    var dj = t.dj ? djShown(t.djid, t.dj) : null;
    if (!t.plays) return { who: "Not played live yet", date: "", extra: "" };
    return { dj: dj, who: "", date: "first " + firetable.utilities.shortDate(t.first), extra: firetable.utilities.pluralize(t.plays, "play", "plays") };
  }

  function chartRows(chart) {
    return ((chart && chart.rows) || []).map(function (r) {
      return { type: r.type || 1, cid: r.cid, a: r.a, t: r.t, plays: r.plays, mv: r.mv, wks: r.wks, dj: r.dj, djid: r.djid, first: r.first };
    });
  }

  function recentTracks() {
    var cache = (firetable._historyCache || []).slice().reverse();
    var seen = {};
    return cache.filter(function (h) {
      if (!h || !h.cid || seen[h.histID]) return false;
      seen[h.histID] = true;
      return true;
    }).slice(0, 100).map(function (h) {
      return { type: h.type || 1, cid: h.cid, a: h.artist, t: h.title, img: h.img, url: h.url, when: h.when, dj: h.dj, djid: h.djid };
    });
  }

  // ─── Views ──────────────────────────────────────────────────────────────

  var VIEWS = [
    { id: "home", label: "Home", icon: "home" },
    { id: "new", label: "New", icon: "new_releases" },
    { id: "charts", label: "Charts", icon: "leaderboard" },
    { id: "recent", label: "Recent plays", icon: "history" }
  ];

  function head(title, link, linkTo) {
    return '<div class="d-head"><h2>' + esc(title) + "</h2>" + (link ? '<a href="#' + esc(linkTo) + '">' + esc(link) + "</a>" : "") + "</div>";
  }
  function chips(name, options, on) {
    return '<div class="d-chips" role="group">' + options.map(function (o) {
      return '<button type="button" class="d-chip' + (o[0] === on ? " on" : "") + '" data-' + name + '="' + esc(o[0]) + '" aria-pressed="' + (o[0] === on) + '">' + esc(o[1]) + "</button>";
    }).join("") + "</div>";
  }
  function layoutButtons(on) {
    return '<div class="d-layout"><button type="button" class="butt graybutt iconbutt' + (on === "grid" ? " on" : "") + '" data-layout="grid" title="Grid" aria-label="Grid">' + ms("grid_view") + "</button>" +
      '<button type="button" class="butt graybutt iconbutt' + (on === "list" ? " on" : "") + '" data-layout="list" title="List" aria-label="List">' + ms("view_list") + "</button></div>";
  }

  function newList(tracks, layout, listName, max) {
    tracks = max ? tracks.slice(0, max) : tracks;
    if (!tracks.length) return emptyNote(D.data.new ? "No new releases here yet. The bot adds them once a day." : "Loading…");
    if (layout === "list") {
      return '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
        var m = newMeta(t);
        return row(t, listName, i, { stamp: firetable.utilities.shortDate(t.rel), dj: m.dj, right: m.extra || "new" });
      }).join("") + "</div>";
    }
    return '<div class="ft-cards">' + tracks.map(function (t, i) { return card(t, listName, i, newMeta(t)); }).join("") + "</div>";
  }

  function movement(mv) {
    if (mv === "new") return '<span class="d-mv new">new</span>';
    if (mv === "re") return '<span class="d-mv re">back</span>';
    if (typeof mv === "number" && mv > 0) return '<span class="d-mv up">▲' + mv + "</span>";
    if (typeof mv === "number" && mv < 0) return '<span class="d-mv down">▼' + (-mv) + "</span>";
    if (mv === 0) return '<span class="d-mv same">·</span>';
    return "";
  }
  function chartList(tracks, listName, max, period) {
    tracks = max ? tracks.slice(0, max) : tracks;
    if (!tracks.length) return emptyNote("No plays in this chart yet.");
    return '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
      var right = (period === "week" ? movement(t.mv) : "") + '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>";
      return row(t, listName, i, { stamp: "#" + (i + 1), rank: true, dj: djShown(t.djid, t.dj), right: right });
    }).join("") + "</div>";
  }

  function recentList(tracks, listName, max) {
    tracks = max ? tracks.slice(0, max) : tracks;
    if (!tracks.length) return emptyNote("Loading…");
    return '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
      return row(t, listName, i, { stamp: firetable.utilities.format_time(t.when), dj: djShown(t.djid, t.dj) });
    }).join("") + "</div>";
  }

  function chartTitle(period, id) {
    if (period === "all") return "All time";
    if (period === "year") return id;
    if (period === "month") {
      var m = /^(\d{4})-(\d\d)$/.exec(id || "");
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }) : id;
    }
    var c = D.data.charts["week/" + id];
    if (c && c.from) {
      var to = new Date(c.to - 1);
      return "Week " + Number(id.split("-W")[1]) + " · " + firetable.utilities.shortDate(c.from) + " to " + firetable.utilities.shortDate(to.getTime());
    }
    return id ? "Week " + Number(id.split("-W")[1]) : "";
  }

  /** The id of the current period, as the bot names it. */
  function currentId(period) {
    var d = new Date();
    if (period === "year") return String(d.getFullYear());
    if (period === "month") return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1);
    if (period === "all") return "all";
    var ids = Object.keys(D.data.chartIds.week || {}).sort();
    return ids.length ? ids[ids.length - 1] : null;
  }

  function renderBrowse() {
    var el = document.getElementById("dBrowse");
    if (!el) return;
    var h = "";
    if (D.view === "home") {
      var nt = newTracks();
      var wk = currentId("week");
      var chart = chartRows(wk && D.data.charts["week/" + wk]);
      var recent = recentTracks();
      setList("home-new", "New this month", nt);
      setList("home-chart", "Room chart · this week", chart);
      setList("home-recent", "Recent plays", recent);
      h += "<section>" + head("New this month", "All new releases", "discover/new") + newList(nt, "grid", "home-new", 6) + "</section>";
      h += "<section>" + head("Room chart · this week", "Full chart", "discover/charts") + chartList(chart, "home-chart", 5, "week") + "</section>";
      h += "<section>" + head("Recent plays", "All recent plays", "discover/recent") + recentList(recent, "home-recent", 5) + "</section>";
    } else if (D.view === "new") {
      var tracks = newTracks();
      setList("new", "New releases", tracks);
      h += '<div class="d-headrow"><h2>New</h2>' + chips("new", [["month", "This month"], ["days90", "Last 90 days"], ["unplayed", "Not played live yet"]], D.newFilter) + layoutButtons(D.newLayout) + "</div>";
      h += '<p class="d-fact">' + esc(firetable.utilities.pluralize(tracks.length, "song", "songs")) + " from this year's playlist, newest first</p>";
      h += newList(tracks, D.newLayout, "new");
    } else if (D.view === "charts") {
      var period = D.chart.period;
      var id = D.chart.id || currentId(period);
      var key = period + "/" + id;
      if (id && D.data.charts[key] === undefined) loadChart(period, id);
      var c = D.data.charts[key];
      var rows = chartRows(c);
      setList("chart", "Room chart · " + chartTitle(period, id), rows);
      h += '<div class="d-headrow"><h2>Room chart</h2>' + chips("period", [["week", "Week"], ["month", "Month"], ["year", "Year"], ["all", "All time"]], period) + "</div>";
      var stepper = "";
      if (period !== "all") {
        var ids = Object.keys(D.data.chartIds[period] || {}).sort();
        var at = ids.indexOf(id);
        stepper = '<button type="button" class="butt graybutt iconbutt" data-step="-1" title="Earlier" aria-label="Earlier"' + (at > 0 ? "" : " disabled") + ">" + ms("chevron_left") + "</button>" +
          '<button type="button" class="butt graybutt iconbutt" data-step="1" title="Later" aria-label="Later"' + (at > -1 && at < ids.length - 1 ? "" : " disabled") + ">" + ms("chevron_right") + "</button>";
      }
      var fact = c && c.plays ? " · " + firetable.utilities.pluralize(c.plays, "play", "plays") + " by " + firetable.utilities.pluralize(c.djs || 0, "DJ", "DJs") : "";
      h += '<div class="d-headrow">' + stepper + '<p class="d-fact"><b>' + esc(chartTitle(period, id)) + "</b>" + esc(fact) + (period === "all" ? " · from the room's whole history" : "") + "</p>" +
        '<button type="button" class="butt graybutt iconbutt d-share" title="Copy a link to this chart" aria-label="Copy a link to this chart">' + ms("share") + "</button></div>";
      h += c === undefined ? loading() : chartList(rows, "chart", 0, period);
    } else if (D.view === "recent") {
      var rt = recentTracks();
      setList("recent", "Recent plays", rt);
      h += '<div class="d-headrow"><h2>Recent plays</h2></div><p class="d-fact">The last 100 songs played live</p>';
      h += recentList(rt, "recent");
    }
    el.innerHTML = h;
    firetable.ui.markSaved();
  }

  function renderRail() {
    document.querySelectorAll("#dNav [data-view]").forEach(function (b) {
      var on = b.getAttribute("data-view") === D.view;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }

  // ─── The room, in one line ──────────────────────────────────────────────

  function peopleHere() {
    var n = 0;
    for (var uid in ftapi.users || {}) {
      if (ftapi.users.hasOwnProperty(uid) && !ftapi.users[uid].hostbot) n++;
    }
    return n;
  }
  function renderLiveLine() {
    var el = document.getElementById("dLive");
    if (!el) return;
    var s = firetable.song;
    var n = peopleHere();
    var here = n ? " · " + n + " here" : "";
    if (!s || !s.cid || s.cid == 0) {
      el.innerHTML = '<span class="d-live-text"><b>The room is quiet</b><span>' + esc((n ? n + " here" : "Nobody on the decks")) + "</span></span>";
      return;
    }
    el.innerHTML = '<span class="d-live-art" style="background-image:url(' + esc(firetable.imgCache && firetable.imgCache[s.cid] || artOf({ cid: s.cid, type: s.type, img: s.image })) + ')"></span>' +
      '<span class="d-live-text"><b>' + esc(firetable.utilities.decodeEntities(s.title || "")) + "</b><span>" + '<i class="d-dot" aria-hidden="true"></i>' +
      esc((s.djname ? s.djname + " on deck" : "Live") + here) + "</span></span>" +
      (D.listening
        ? '<span class="d-listening">' + ms("hearing") + " Listening</span>"
        : '<button type="button" class="butt graybutt small d-listen">Listen in</button>');
  }

  // ─── The right column ───────────────────────────────────────────────────

  var details = {}; // "type_cid" -> {plays, first, firstDj, last, lastDj, genres, bpm}

  function loadDetails(t) {
    var k = t.type + "_" + t.cid;
    if (details[k]) return Promise.resolve(details[k]);
    var out = {};
    var up = db().ref("globalTracks/" + t.type + t.cid).once("value").then(function (s) {
      var u = s.val() || {};
      out.first = u.first_play_date; out.firstDj = u.first_play_dj; out.last = u.last_play_date; out.lastDj = u.last_play_dj;
      if (!u.song) return null;
      return db().ref("globalSongs/" + u.song).once("value").then(function (g) {
        var v = g.val() || {};
        out.plays = v.plays;
        if (v.first_play_date) { out.first = v.first_play_date; out.firstDj = v.first_play_dj; }
        if (v.last_play_date) { out.last = v.last_play_date; out.lastDj = v.last_play_dj; }
        out.genres = v.genres || [];
      });
    }).catch(function () {});
    var tempo = db().ref("bpm/" + firetable.utilities.grabKey(t.type, t.cid)).once("value").then(function (s) {
      var v = s.val();
      if (v && (v.bpm || typeof v === "number")) out.bpm = Math.round(v.bpm || v);
    }).catch(function () {});
    return Promise.all([up, tempo]).then(function () { details[k] = out; return out; });
  }

  function sideTabs() {
    var listLabel = D.signedIn ? "Playlists" : "Crate" + (crate().length ? " (" + crate().length + ")" : "");
    return '<div class="tabs d-sidetabs" role="tablist">' +
      '<button type="button" role="tab" class="tab' + (D.sideTab === "now" ? " on" : "") + '" data-sidetab="now" aria-selected="' + (D.sideTab === "now") + '">Now playing</button>' +
      '<button type="button" role="tab" class="tab' + (D.sideTab === "list" ? " on" : "") + '" data-sidetab="list" aria-selected="' + (D.sideTab === "list") + '">' + esc(listLabel) + "</button></div>";
  }

  function renderSide() {
    var el = document.getElementById("dSide");
    if (!el) return;
    var h = sideTabs();
    if (D.sideTab === "list") h += D.signedIn ? playlistPanel() : cratePanel();
    else h += D.listening ? listeningPanel() : nowPanel();
    el.innerHTML = '<div class="d-sidebody">' + h + "</div>";
    if (D.sideTab === "now" && !D.listening && P.track) fillDetails(P.track);
    renderMini();
    firetable.ui.markSaved();
  }

  function nowPanel() {
    var t = P.track;
    if (!t) {
      return '<div class="d-panel d-panel-empty"><p>Pick any song to play it here, start to finish.</p>' +
        '<p class="d-fact">Or <button type="button" class="linkButton d-listen">listen in</button> to the room.</p></div>';
    }
    var list = lists[P.list];
    var pos = list ? " · " + (P.i + 1) + " of " + list.tracks.length : "";
    var saved = firetable.saved.where(t.type, t.cid);
    return '<div class="d-panel">' +
      '<div class="d-from">' + ms("queue_music") + "<span>Playing from " + esc((list && list.label) || "Discover") + esc(pos) + "</span></div>" +
      '<div class="d-cover" style="background-image:url(' + esc(artOf(t)) + ')"></div>' +
      '<div class="d-now"><span class="d-title">' + esc(t.t) + '</span><span class="d-artist">' + esc(t.a) + "</span></div>" +
      '<div class="d-tags" id="dTags"></div>' +
      '<div class="d-hist" id="dHist"></div>' +
      progress() +
      '<div class="d-ctrls">' +
      '<button type="button" class="butt graybutt iconbutt d-prev" title="Previous" aria-label="Previous">' + ms("skip_previous", true) + "</button>" +
      '<button type="button" class="butt iconbutt d-toggle d-big" title="' + (P.paused ? "Play" : "Pause") + '" aria-label="' + (P.paused ? "Play" : "Pause") + '">' + ms(P.paused ? "play_arrow" : "pause", true) + "</button>" +
      '<button type="button" class="butt graybutt iconbutt d-next" title="Next" aria-label="Next">' + ms("skip_next", true) + "</button>" +
      '<span class="d-gap"></span>' +
      (linkOf(t) ? '<a class="butt graybutt iconbutt" target="_blank" rel="noopener" href="' + esc(linkOf(t)) + '" title="Open the song" aria-label="Open the song">' + ms("open_in_new") + "</a>" : "") +
      '<button type="button" class="butt graybutt iconbutt d-mute" title="Mute" aria-label="Mute">' + ms(firetable.utilities.getEffectiveVolume() ? "volume_up" : "volume_off") + "</button>" +
      "</div>" +
      '<div class="d-save"><button type="button" class="butt small d-savebtn' + (saved ? " is-saved" : "") + '">' + (saved ? "Saved" : "Save") + "</button><span>" +
      esc(saved ? "in " + saved : D.signedIn ? "to a playlist" : "to your crate, kept in this browser") + "</span></div>" +
      upNext() + "</div>";
  }

  function progress() {
    return '<div class="d-prog"><span id="dAt">0:00</span><span class="d-bar"><i id="dBar"></i></span><span id="dLen">' + esc(P.len ? clock(P.len) : "") + "</span></div>";
  }

  function upNext() {
    var list = lists[P.list];
    if (!list) return "";
    var next = list.tracks.slice(P.i + 1, P.i + 4);
    if (!next.length) return "";
    return '<div class="d-upnext"><div class="d-label">' + ms("queue_music") + "<span>Up next · " + esc(firetable.utilities.pluralize(list.tracks.length - P.i - 1, "song", "songs") + " left") + "</span></div>" +
      next.map(function (t, k) {
        return '<button type="button" class="d-mini-row" data-list="' + esc(P.list) + '" data-i="' + (P.i + 1 + k) + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(t)) + ')"></span>' +
          '<span class="d-mini-text"><b>' + esc(t.t) + "</b><span>" + esc(t.a) + "</span></span></button>";
      }).join("") + "</div>";
  }

  function fillDetails(t) {
    loadDetails(t).then(function (d) {
      if (!P.track || P.track.cid !== t.cid) return;
      var tags = (d.genres || []).slice(0, 2).map(function (g) { return '<span class="d-tag">' + esc(g) + "</span>"; });
      if (t.rel) tags.push('<span class="d-tag d-numtag">' + esc(t.rel.slice(0, 4)) + "</span>");
      if (d.bpm) tags.push('<span class="d-tag d-numtag">' + esc(d.bpm) + " BPM</span>");
      var tagEl = document.getElementById("dTags");
      if (tagEl) tagEl.innerHTML = tags.join("");
      var lines = [];
      var plays = d.plays || t.plays;
      // the history's answer, or what the list that's playing already knew
      var firstAt = d.first || t.first;
      var firstName = d.first ? d.firstDj : t.dj;
      var firstUid = d.first ? null : t.djid;
      if (plays) lines.push("<b>" + esc(firetable.utilities.pluralize(plays, "play", "plays")) + "</b> in the room");
      var first = firstAt ? djShown(firstUid, firstName) : null;
      if (firstAt) lines.push((first ? robot(first) : "") + "first played " + esc(firetable.utilities.shortDate(firstAt)) + (first ? " by " + esc(first.name) : ""));
      if (d.last && d.last !== firstAt) {
        var last = djShown(null, d.lastDj);
        lines.push("last played " + esc(firetable.utilities.shortDate(d.last)) + (last ? " by " + esc(last.name) : ""));
      }
      if (!firstAt && !plays) lines.push("Nobody has played this live yet. It could be you.");
      var histEl = document.getElementById("dHist");
      if (histEl) histEl.innerHTML = lines.map(function (l) { return "<p>" + l + "</p>"; }).join("");
    });
  }

  function listeningPanel() {
    var s = firetable.song;
    var chat = (D.data.chat && D.data.chat.msgs) || [];
    var title = s ? firetable.utilities.decodeEntities(s.title || "") : "";
    var artist = s ? firetable.utilities.decodeEntities(s.artist || "") : "";
    return '<div class="d-panel">' +
      '<div class="d-from"><i class="d-dot" aria-hidden="true"></i><span>Live · listening in</span></div>' +
      (s ? '<div class="d-cover" style="background-image:url(' + esc(firetable.imgCache && firetable.imgCache[s.cid] || artOf({ cid: s.cid, type: s.type, img: s.image })) + ')"></div>' +
        '<div class="d-now"><span class="d-title">' + esc(title) + '</span><span class="d-artist">' + esc(artist) + "</span></div>" +
        '<div class="d-hist"><p>' + esc((s.djname ? s.djname + " on deck" : "Live") + " · " + peopleHere() + " here") + "</p></div>" : "") +
      '<div class="d-ctrls"><button type="button" class="butt graybutt iconbutt d-mute" title="Mute" aria-label="Mute">' + ms(firetable.utilities.getEffectiveVolume() ? "volume_up" : "volume_off") + "</button>" +
      '<span class="d-gap"></span>' + (P.track ? '<button type="button" class="butt graybutt small d-mypick">' + ms("arrow_back") + " My pick</button>" : "") + "</div>" +
      '<div class="d-upnext"><div class="d-label">' + ms("forum") + "<span>Live chat</span></div>" + chatList(chat.slice(-6)) +
      '<button type="button" class="butt d-stepin">Step inside</button><p class="d-fact d-center">See the stage, the DJs and everyone in the room.</p></div></div>';
  }

  function chatList(msgs) {
    if (!msgs.length) return '<p class="d-fact">The chat is quiet right now.</p>';
    return '<div class="d-chat">' + msgs.map(function (m) {
      var who = m.n ? { uid: m.uid, name: m.n } : null;
      return '<div class="d-chatline">' + (who ? robot(who) : '<span class="ft-avatar pv-dj-avatar d-nobody" aria-hidden="true"></span>') +
        "<span><b>" + esc(who ? who.name : "a member") + "</b>" + esc(m.txt) + "</span></div>";
    }).join("") + "</div>";
  }

  // ─── Crate (visitors) ───────────────────────────────────────────────────

  function crate() { var c = store.get(CRATE_KEY, []); return Array.isArray(c) ? c : []; }
  function setCrate(c) { store.set(CRATE_KEY, c); refreshCrateMarks(); }
  function refreshCrateMarks() {
    if (D.signedIn) return;
    var session = {};
    crate().forEach(function (t) { session[firetable.saved.key(t.type, t.cid)] = "your crate"; });
    firetable.saved.session = session;
    firetable.ui.markSaved();
  }

  function saveToCrate(t) {
    var c = crate();
    if (c.some(function (x) { return String(x.cid) === String(t.cid) && String(x.type) === String(t.type); })) {
      firetable.ui.toast("That song is already in your crate");
      return;
    }
    c.push({ type: Number(t.type || 1), cid: t.cid, a: t.a, t: t.t, img: t.img || null, url: t.url || null });
    setCrate(c);
    firetable.ui.toast("Saved to your crate", "success", {
      action: { label: "Undo", fn: function () {
        setCrate(crate().filter(function (x) { return !(String(x.cid) === String(t.cid) && String(x.type) === String(t.type)); }));
        renderSide();
      } }
    });
    renderSide();
    if (c.length >= 3 && !store.get(CRATE_ASKED_KEY, false)) {
      store.set(CRATE_ASKED_KEY, true);
      setTimeout(openKeepCrate, 600);
    }
  }

  function cratePanel() {
    var c = crate();
    var rows = c.map(function (t, i) {
      return '<div class="d-listrow"><button type="button" class="d-mini-row" data-list="crate" data-i="' + i + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(t)) + ')"></span>' +
        '<span class="d-mini-text"><b>' + esc(t.t) + "</b><span>" + esc(t.a) + "</span></span></button>" +
        '<button type="button" class="butt graybutt iconbutt d-unsave" data-i="' + i + '" title="Remove" aria-label="Remove ' + esc(t.t) + ' from your crate">' + ms("close") + "</button></div>";
    }).join("");
    setList("crate", "Your crate", c);
    return '<div class="d-panel">' +
      (c.length ? '<p class="d-fact">' + esc(firetable.utilities.pluralize(c.length, "song", "songs")) + " · kept in this browser</p>" + rows
        : '<p class="d-fact">Tap ' + ms("playlist_add") + " on any song to save it here. No account needed.</p>") +
      '<p class="d-fact">Join and this crate becomes your first playlist, ready to play for the room.</p>' +
      joinButtons() + "</div>";
  }

  function joinButtons() {
    var google = firetable.utilities.signInProviders().indexOf("google") !== -1;
    var g = document.querySelector('#oauthBox .oauthBttn[data-provider="google"] svg');
    return '<div class="d-join">' +
      (google ? '<button type="button" class="butt oauthBttn d-google">' + (g ? g.outerHTML : "") + "Continue with Google</button>" : "") +
      '<button type="button" class="butt d-createaccount">Create Account</button>' +
      '<button type="button" class="linkButton d-login">Log In</button></div>';
  }

  function openKeepCrate() {
    var c = crate();
    var dlg = document.getElementById("keepCrateBox");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "keepCrateBox";
      dlg.setAttribute("aria-labelledby", "keepCrateTitle");
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) {
        if (e.target.closest(".closeModal, .d-notnow")) dlg.close();
      });
    }
    dlg.innerHTML = '<div class="modalBox"><div class="modalHeader"><h2 id="keepCrateTitle">Keep your crate</h2>' +
      '<button type="button" class="butt graybutt iconbutt closeModal" title="Close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="modalContent d-keep"><p>' + esc(firetable.utilities.pluralize(c.length, "song", "songs")) + " saved. Join and your crate becomes a playlist you can play for the room" +
      (peopleHere() ? ", with " + peopleHere() + " people here right now" : "") + ".</p>" +
      '<div class="d-keep-list">' + c.slice(-3).map(function (t) {
        return '<div class="d-mini-row"><span class="d-mini-art" style="background-image:url(' + esc(artOf(t)) + ')"></span><span class="d-mini-text"><b>' + esc(t.t) + "</b><span>" + esc(t.a) + "</span></span></div>";
      }).join("") + "</div>" +
      "<p>Joining also opens the chat, the people in the room and the decks.</p>" + joinButtons() +
      '<button type="button" class="butt graybutt d-notnow">Not now</button><p class="d-fact">Not now keeps the crate in this browser.</p></div></div>';
    if (!dlg.open) dlg.showModal();
  }

  /** On joining: the crate becomes a playlist (their DJ playlist if it's their first). */
  function importCrate() {
    var c = crate();
    if (!c.length || !ftapi.uid) return;
    ftapi.lookup.listNames(function (all) {
      var first = !all || !Object.keys(all).length;
      var name = "My Discover crate";
      var id = ftapi.actions.createList(name);
      var ref = ftapi.lookup.listRef(id);
      var updates = {};
      c.forEach(function (t) {
        var key = ref.push().key;
        var track = { type: t.type, cid: t.cid, name: (t.a ? t.a + " - " : "") + t.t };
        if (t.img) track.img = t.img;
        if (t.url) track.url = t.url;
        updates[key] = track;
      });
      ref.update(updates).then(function () {
        store.set(CRATE_KEY, []);
        firetable.allPlaylists = firetable.allPlaylists || {};
        firetable.allPlaylists[id] = { name: name, list: {} };
        if (first) ftapi.actions.switchList(id);
        firetable.ui.toast(first ? "Your crate is now your DJ playlist: " + name : "Your crate is now the playlist " + name, "success");
      }, function () {
        firetable.ui.toast("Couldn't save your crate as a playlist. It's still in this browser.", "error");
      });
    });
  }

  // ─── Playlists (members) ────────────────────────────────────────────────

  function playlistPanel() {
    var queue = ftapi.queue || {};
    var keys = Object.keys(queue);
    var tracks = keys.map(function (k) {
      var q = queue[k] || {};
      var parts = String(q.name || "").split(" - ");
      var a = parts.length > 1 ? parts.shift() : "";
      return { type: q.type || 1, cid: q.cid, a: a, t: parts.join(" - ") || q.name, img: q.img, url: q.url, flagged: !!q.flagged };
    }).filter(function (t) { return t.cid != null; });
    var listID = ftapi.selectedListThing;
    var name = firetable.utilities.listName(listID);
    setList("playlist", name, tracks);
    var rows = tracks.slice(0, 100).map(function (t, i) {
      var isNew = firetable.saved.session[firetable.saved.key(t.type, t.cid)];
      return '<div class="d-listrow' + (isNew ? " d-added" : "") + (t.flagged ? " d-flagged" : "") + '"><span class="d-n">' + (i + 1) + "</span>" +
        '<button type="button" class="d-mini-row" data-list="playlist" data-i="' + i + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(t)) + ')"></span>' +
        '<span class="d-mini-text"><b>' + esc(t.t) + "</b><span>" + esc(t.a) + "</span></span></button></div>";
    }).join("");
    return '<div class="d-panel">' +
      '<div class="d-listhead"><b>' + esc(name) + "</b><span>" + esc(firetable.utilities.pluralize(tracks.length, "song", "songs")) + "</span>" +
      '<span class="d-dj">' + ms("headphones") + " Your DJ playlist</span></div>" +
      (tracks.length ? '<p class="d-label d-plain">Plays next when you DJ</p>' + rows : '<p class="d-fact">Empty. Save songs here with ' + ms("playlist_add") + ".</p>") +
      (tracks.length > 100 ? '<p class="d-fact">The first 100 of ' + tracks.length + ". The rest are in Live, under Playlists.</p>" : "") +
      '<p class="d-fact">Songs you saved this visit are marked. Manage every playlist in Live, under Playlists.</p></div>';
  }

  // ─── The player ─────────────────────────────────────────────────────────

  var P = { track: null, list: null, i: 0, paused: false, len: 0, at: 0, timer: null };

  function isPlaying(list, i) { return !!(P.track && !D.listening && P.list === list && P.i === i); }
  function isSounding(list, i) { return isPlaying(list, i) && !P.paused; }

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60);
  }

  /** Stop a 30-second preview first, the way the room does. */
  function cancelPreview() {
    if (!firetable.preview || firetable.preview === "discover") return;
    clearTimeout(firetable.ptimeout);
    firetable.ptimeout = null;
    clearInterval(firetable.movePvBar);
    firetable.movePvBar = null;
    $("#pvbar" + firetable.preview).css("background-image", "none").removeClass("previewing");
    firetable.preview = false;
  }

  function play(listName, i, startAt, auto) {
    var list = lists[listName];
    var t = list && list.tracks[i];
    if (!t) return;
    cancelPreview();
    D.listening = false;
    P.track = t; P.list = listName; P.i = i; P.paused = false; P.len = t.dur || 0; P.at = startAt || 0;
    firetable.preview = "discover";
    firetable.previewType = Number(t.type || 1);
    if (firetable.disableMediaPlayback) {
      firetable.ui.toast("Media playback is turned off in Settings");
    } else if (Number(t.type || 1) === MEDIA_YOUTUBE) {
      if (firetable.scLoaded) firetable.scwidget.pause();
      if (firetable.ytLoaded) {
        player.setVolume(firetable.utilities.getEffectiveVolume());
        player.loadVideoById(String(t.cid), startAt || 0, "large");
      }
    } else {
      if (firetable.ytLoaded) player.stopVideo();
      firetable.scSeek = (startAt || 0) * 1000;
      firetable.scwidget.load(SC_API_TRACK_URL + t.cid, { auto_play: true });
    }
    startTicking();
    if (!auto) D.sideTab = "now";
    renderSide();
    renderBrowse();
    renderLiveLine();
  }

  /** Give the players back to the room (Live, Listen in). */
  function release() {
    stopTicking();
    if (firetable.preview !== "discover") return;
    firetable.preview = false;
    firetable.previewType = null;
    if (firetable.ytLoaded) player.stopVideo();
    if (firetable.scLoaded) firetable.scwidget.pause();
    firetable.utilities.resumeCurrentSong();
  }

  function togglePause() {
    if (!P.track) return;
    if (firetable.preview !== "discover") return play(P.list, P.i, P.at);
    P.paused = !P.paused;
    if (Number(P.track.type || 1) === MEDIA_YOUTUBE) {
      if (firetable.ytLoaded) { if (P.paused) player.pauseVideo(); else player.playVideo(); }
    } else if (firetable.scLoaded) {
      if (P.paused) firetable.scwidget.pause(); else firetable.scwidget.play();
    }
    renderSide();
    renderBrowse();
  }

  function step(by) {
    var list = lists[P.list];
    if (!list) return;
    var i = P.i + by;
    if (i < 0 || i >= list.tracks.length) {
      if (by > 0) { // the end of the list
        P.paused = true;
        stopTicking();
        renderSide();
        renderBrowse();
      }
      return;
    }
    play(P.list, i, 0, true);
  }

  function startTicking() {
    stopTicking();
    P.timer = setInterval(function () {
      if (firetable.preview !== "discover" || !P.track) return;
      var done = function (at, len) {
        if (typeof at === "number") P.at = at;
        if (len) P.len = len;
        var a = document.getElementById("dAt"), l = document.getElementById("dLen"), b = document.getElementById("dBar");
        if (a) a.textContent = clock(P.at);
        if (l && P.len) l.textContent = clock(P.len);
        if (b) b.style.width = (P.len ? Math.min(100, (P.at / P.len) * 100) : 0) + "%";
        var mb = document.getElementById("dMiniBar");
        if (mb) mb.style.width = (P.len ? Math.min(100, (P.at / P.len) * 100) : 0) + "%";
      };
      if (Number(P.track.type || 1) === MEDIA_YOUTUBE) {
        if (firetable.ytLoaded && player.getCurrentTime) done(player.getCurrentTime(), player.getDuration && player.getDuration());
      } else if (firetable.scLoaded) {
        firetable.scwidget.getPosition(function (pos) {
          firetable.scwidget.getDuration(function (len) { done(pos / 1000, len / 1000); });
        });
      }
    }, 500);
  }
  function stopTicking() { clearInterval(P.timer); P.timer = null; }

  // ─── The phone's player bar ─────────────────────────────────────────────

  function renderMini() {
    var el = document.getElementById("dMini");
    if (!el) return;
    var t = D.listening ? null : P.track;
    var s = firetable.song;
    if (!t && !(D.listening && s)) { el.hidden = true; return; }
    el.hidden = false;
    var title = t ? t.t : firetable.utilities.decodeEntities(s.title || "");
    var artist = t ? t.a : (s.djname ? s.djname + " on deck" : "Live");
    var art = t ? artOf(t) : (firetable.imgCache && firetable.imgCache[s.cid]) || artOf({ cid: s.cid, type: s.type, img: s.image });
    el.innerHTML = '<button type="button" class="d-mini-open" aria-label="Open the player"><span class="d-mini-art" style="background-image:url(' + esc(art) + ')"></span>' +
      '<span class="d-mini-text"><b>' + esc(title) + "</b><span>" + esc(artist) + "</span></span></button>" +
      (t ? (D.signedIn ? "" : '<button type="button" class="butt graybutt iconbutt d-savebtn" aria-label="Save">' + ms(firetable.saved.where(t.type, t.cid) ? "playlist_add_check" : "playlist_add") + "</button>") +
        '<button type="button" class="butt graybutt iconbutt d-toggle" aria-label="' + (P.paused ? "Play" : "Pause") + '">' + ms(P.paused ? "play_arrow" : "pause", true) + "</button>" +
        '<button type="button" class="butt graybutt iconbutt d-next" aria-label="Next">' + ms("skip_next", true) + "</button>" : "") +
      '<span class="d-minibar"><i id="dMiniBar"></i></span>';
  }

  // ─── Mode and addresses ─────────────────────────────────────────────────

  function route() {
    var h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (h === "live") return { mode: "live" };
    var m = /^discover(?:\/(new|charts|recent))?(?:\/(week|month|year|all)(?:\/([\w-]+))?)?$/.exec(h);
    if (!m) return null;
    return { mode: "discover", view: m[1] || "home", period: m[2] || null, id: m[3] || null };
  }
  function addressFor() {
    if (D.mode === "live") return "#live";
    if (D.view === "home") return "#discover";
    if (D.view === "charts") {
      var id = D.chart.id || currentId(D.chart.period);
      return "#discover/charts" + (D.chart.period !== "week" || D.chart.id ? "/" + D.chart.period + (id && D.chart.period !== "all" ? "/" + id : "") : "");
    }
    return "#discover/" + D.view;
  }
  function writeAddress() {
    var want = addressFor();
    if (location.hash !== want) history.replaceState(null, "", want);
  }

  function setMode(mode, opts) {
    opts = opts || {};
    var changed = D.mode !== mode;
    D.mode = mode;
    document.body.classList.toggle("ft-discover", mode === "discover");
    document.querySelectorAll("#modeTabs [data-mode]").forEach(function (b) {
      var on = b.getAttribute("data-mode") === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on);
    });
    if (opts.remember) store.set(MODE_KEY, mode);
    if (mode === "live") {
      if (changed) { release(); D.listening = false; }
      window.dispatchEvent(new Event("resize")); // the stage measures itself again
    } else {
      if (!D.signedIn && !store.get(FOUND_KEY, null)) store.set(FOUND_KEY, (addressFor().replace(/^#/, "") || "discover").slice(0, 200));
      ensureData();
      renderAll();
    }
    renderLiveLine();
    writeAddress();
  }

  function setView(view) {
    D.view = view;
    renderRail();
    renderBrowse();
    writeAddress();
    var b = document.getElementById("dBrowse");
    if (b) b.scrollTop = 0;
  }

  function renderAll() {
    renderRail();
    renderBrowse();
    renderSide();
    renderLiveLine();
  }

  // ─── Data ───────────────────────────────────────────────────────────────

  var watching = false;
  function ensureData() {
    if (watching) return;
    watching = true;
    try { ftapi.watchFeed("history"); } catch (e) { /* signed out before the feeds exist */ }
    db().ref("discover/new").on("value", function (s) {
      D.data.new = s.val() || { tracks: [] };
      if (D.view === "home" || D.view === "new") renderBrowse();
    }, quiet);
    db().ref("discover/chartIds/week").on("value", function (s) {
      D.data.chartIds.week = s.val() || {};
      var wk = currentId("week");
      if (wk) loadChart("week", wk, true);
      if (D.view === "charts" || D.view === "home") renderBrowse();
    }, quiet);
    ["month", "year"].forEach(function (p) {
      db().ref("discover/chartIds/" + p).once("value").then(function (s) { D.data.chartIds[p] = s.val() || {}; if (D.view === "charts") renderBrowse(); }, quiet);
    });
    db().ref("discover/chat").on("value", function (s) {
      D.data.chat = s.val();
      renderLiveLine();
      if (D.listening) renderSide();
      renderPeek();
    }, quiet);
  }
  function quiet(err) { firetable.debug && console.log("[discover] not readable yet:", err && err.message); }

  var liveCharts = {};
  function loadChart(period, id, live) {
    var key = period + "/" + id;
    if (liveCharts[key]) return;
    liveCharts[key] = true;
    var ref = db().ref("discover/charts/" + period + "/" + id);
    var got = function (s) {
      D.data.charts[key] = s.val() || null;
      if (D.view === "charts" || (D.view === "home" && period === "week")) renderBrowse();
    };
    if (live) ref.on("value", got, quiet);
    else ref.once("value").then(got, function () { D.data.charts[key] = null; renderBrowse(); });
  }

  // ─── Visitors' Live: the chat to read ───────────────────────────────────

  function renderPeek() {
    var el = document.getElementById("chatPeek");
    if (!el) return;
    if (D.signedIn) { el.hidden = true; return; }
    var chat = D.data.chat || {};
    el.hidden = false;
    el.innerHTML = '<div class="d-head"><h2>Live chat</h2><span class="d-fact">' +
      esc(chat.hour ? firetable.utilities.pluralize(chat.hour, "message", "messages") + " this hour" : "") + "</span></div>" +
      chatList((chat.msgs || []).slice(-8)) +
      '<div class="d-peekjoin"><span>You\'re reading the live chat. Join to say hi.</span><button type="button" class="butt d-createaccount">Join the Chat</button></div>';
  }

  // ─── Events ─────────────────────────────────────────────────────────────

  function onClick(e) {
    var t = e.target;
    var b;
    if ((b = t.closest("#modeTabs [data-mode]"))) return setMode(b.getAttribute("data-mode"), { remember: true });
    if ((b = t.closest("#dNav [data-view]"))) return setView(b.getAttribute("data-view"));
    if ((b = t.closest(".d-listen"))) return listenIn();
    if ((b = t.closest(".d-stepin"))) return setMode("live", { remember: true });
    if ((b = t.closest(".d-mypick"))) { D.listening = false; return play(P.list, P.i, P.at); }
    if ((b = t.closest("[data-sidetab]"))) { D.sideTab = b.getAttribute("data-sidetab"); return renderSide(); }
    if ((b = t.closest(".d-chip[data-new]"))) { D.newFilter = b.getAttribute("data-new"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-period]"))) { D.chart = { period: b.getAttribute("data-period"), id: null }; renderBrowse(); return writeAddress(); }
    if ((b = t.closest("[data-layout]"))) { D.newLayout = b.getAttribute("data-layout"); store.set("ft-new-layout", D.newLayout); return renderBrowse(); }
    if ((b = t.closest("[data-step]"))) {
      var ids = Object.keys(D.data.chartIds[D.chart.period] || {}).sort();
      var at = ids.indexOf(D.chart.id || currentId(D.chart.period)) + Number(b.getAttribute("data-step"));
      if (ids[at]) { D.chart.id = ids[at]; renderBrowse(); writeAddress(); }
      return;
    }
    if ((b = t.closest(".d-share"))) return copyLink();
    if ((b = t.closest(".d-toggle"))) return togglePause();
    if ((b = t.closest(".d-next"))) return step(1);
    if ((b = t.closest(".d-prev"))) return step(-1);
    if ((b = t.closest(".d-mute"))) { firetable.actions.muteToggle(); return setTimeout(renderSide, 50); }
    if ((b = t.closest(".d-savebtn"))) return P.track && save(P.track, b);
    if ((b = t.closest(".d-unsave"))) {
      var c = crate();
      c.splice(Number(b.getAttribute("data-i")), 1);
      setCrate(c);
      return renderSide();
    }
    if ((b = t.closest(".d-google"))) {
      return ftapi.actions.logInWithProvider("google", function (error) { firetable.ui.toast(firetable.ui.authErrorMessage(error), "error"); });
    }
    if ((b = t.closest(".d-createaccount, .d-login"))) return showSignIn(b.classList.contains("d-login"));
    if ((b = t.closest(".d-mini-open"))) { document.body.classList.toggle("d-sheet-open"); return; }
    if ((b = t.closest(".d-mini-row[data-list]"))) return play(b.getAttribute("data-list"), Number(b.getAttribute("data-i")));
    var rowEl = t.closest("#dBrowse .pvbar[data-list]");
    if (rowEl) {
      var list = rowEl.getAttribute("data-list"), i = Number(rowEl.getAttribute("data-i"));
      var track = lists[list] && lists[list].tracks[i];
      if (t.closest(".histeal")) { e.stopPropagation(); return track && save(track, t.closest(".histeal")); }
      if (t.closest(".tracklink-btn")) return;
      if (t.closest(".d-play, .pv-art")) return isPlaying(list, i) ? togglePause() : play(list, i);
    }
  }

  function save(t, btn) {
    if (!D.signedIn) return saveToCrate(t);
    firetable.actions.openStealPicker($(btn), { cid: t.cid, type: Number(t.type || 1), title: (t.a ? t.a + " - " : "") + t.t, img: t.img || artOf(t), url: t.url || "", djid: t.djid || "" }, "left");
  }

  function listenIn() {
    if (firetable.preview === "discover") P.paused = false;
    D.listening = true;
    D.sideTab = "now";
    release();
    renderSide();
    renderBrowse();
    renderLiveLine();
  }

  function showSignIn(login) {
    var dlg = document.getElementById("keepCrateBox");
    if (dlg && dlg.open) dlg.close();
    setMode("live", { remember: true });
    setTimeout(function () {
      var link = document.getElementById(login ? "loginlink" : "signuplink");
      if (link) link.click();
      var form = document.getElementById("login");
      if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function copyLink() {
    var url = location.href.split("#")[0] + addressFor();
    var done = function () { firetable.ui.toast("Link copied", "success"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { firetable.ui.toast(url); });
    else firetable.ui.toast(url);
  }

  // ─── Build the page ─────────────────────────────────────────────────────

  function build() {
    var tabs = document.createElement("div");
    tabs.id = "modeTabs";
    tabs.className = "tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Discover or Live");
    tabs.innerHTML = '<button type="button" role="tab" class="tab" data-mode="discover" aria-selected="false">Discover</button>' +
      '<button type="button" role="tab" class="tab" data-mode="live" aria-selected="false"><i class="d-dot" aria-hidden="true"></i>Live</button>';
    document.getElementById("topbar").appendChild(tabs);

    var page = document.createElement("div");
    page.id = "discoverPage";
    page.setAttribute("role", "region");
    page.setAttribute("aria-label", "Discover");
    page.innerHTML = '<div id="dRail"><div id="dLive" class="d-live" aria-live="polite"></div><nav id="dNav" aria-label="Discover">' +
      VIEWS.map(function (v) { return '<button type="button" class="d-nav" data-view="' + v.id + '">' + ms(v.icon) + "<span>" + esc(v.label) + "</span></button>"; }).join("") +
      '</nav></div><div id="dBrowse" class="scroll-view"></div><aside id="dSide" aria-label="Player"></aside><div id="dMini" hidden></div>';
    document.getElementById("mainGrid").appendChild(page);

    // visitors' Live: the chat, above Fresh
    var fresh = document.getElementById("discover");
    if (fresh) {
      var peek = document.createElement("div");
      peek.id = "chatPeek";
      peek.hidden = true;
      fresh.insertBefore(peek, fresh.firstChild);
    }
  }

  // the room's player says a Discover song ended or couldn't play
  function onEnded() {
    if (firetable.preview !== "discover") return;
    failures = 0;
    step(1);
  }
  // three songs in a row that can't play: something's blocking the player,
  // so stop instead of running through the whole list
  var failures = 0;
  function onFailed() {
    if (firetable.preview !== "discover") return;
    failures++;
    if (failures >= 3) {
      failures = 0;
      P.paused = true;
      stopTicking();
      renderSide();
      firetable.ui.toast("These songs won't play in this browser right now. A blocker or the network may be stopping YouTube.", "error");
      return;
    }
    firetable.ui.toast("That song can't play here. Skipping it.");
    setTimeout(function () { step(1); }, 800);
  }

  function signedIn(on) {
    D.signedIn = on;
    if (on) {
      firetable.saved.session = {};
      importCrate();
      var found = store.get(FOUND_KEY, null);
      var me = ftapi.users && ftapi.users[ftapi.uid];
      if (found && !(me && me.foundVia)) {
        db().ref("users/" + ftapi.uid + "/joined").once("value").then(function (s) {
          // only for an account made in the last two days
          if (s.val() && Date.now() - s.val() < 2 * 86400000) {
            db().ref("users/" + ftapi.uid + "/foundVia").set(String(found).slice(0, 200)).catch(function () {});
          }
          store.set(FOUND_KEY, null);
        });
      }
    } else {
      refreshCrateMarks();
    }
    var r = route();
    var mode = (r && r.mode) || store.get(MODE_KEY, null) || (on ? "live" : "discover");
    if (r && r.view) applyRoute(r);
    D.listening = false;
    setMode(mode);
    renderSide();
    renderPeek();
  }

  function applyRoute(r) {
    if (r.view) D.view = r.view;
    if (r.period) D.chart = { period: r.period, id: r.id || null };
  }

  return {
    init: function () {
      D.on = typeof ftconfigs !== "undefined" && ftconfigs.discover === true;
      if (!D.on) return;
      document.body.classList.add("ft-has-discover");
      D.newLayout = store.get("ft-new-layout", "grid") === "list" ? "list" : "grid";
      build();
      // the left column starts below the header, whatever its height
      var topbar = document.getElementById("topbar");
      var measure = function () { document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px"); };
      measure();
      if (window.ResizeObserver) new ResizeObserver(measure).observe(topbar);
      document.addEventListener("click", onClick);
      window.addEventListener("hashchange", function () {
        var r = route();
        if (!r) return;
        applyRoute(r);
        setMode(r.mode, { remember: true });
        if (r.mode === "discover") setView(D.view);
      });
      if (firetable.scwidget && window.SC && SC.Widget) {
        firetable.scwidget.bind(SC.Widget.Events.FINISH, onEnded);
      }
      ftapi.events.on("loggedIn", function () { signedIn(true); });
      ftapi.events.on("loggedOut", function () { signedIn(false); });
      ftapi.events.on("newSong", function () {
        renderLiveLine();
        if (D.listening) renderSide();
      });
      ftapi.events.on("usersChanged", firetable.utilities.oncePerFrame(function () {
        renderLiveLine();
        if (D.mode === "discover" && D.view !== "new") renderBrowse();
      }));
      ftapi.events.on("newHistory", firetable.utilities.oncePerFrame(function () {
        if (D.mode === "discover" && (D.view === "recent" || D.view === "home")) renderBrowse();
      }));
      ftapi.events.on("playlistChanged", function () {
        if (D.mode === "discover" && D.signedIn && D.sideTab === "list") renderSide();
      });
      // before sign-in is known: visitors' default, so the page isn't empty
      var r = route();
      if (r) applyRoute(r);
      setMode((r && r.mode) || store.get(MODE_KEY, null) || "discover");
    },
    onEnded: onEnded,
    onFailed: onFailed,
    /** For tests: act as signed in or out without a real sign-in. */
    testSignedIn: signedIn,
    /** For tests: what's on screen. */
    state: function () { return { mode: D.mode, view: D.view, listening: D.listening, playing: P.track && P.track.cid, list: P.list, i: P.i }; }
  };
})();
