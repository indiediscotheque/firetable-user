/**
 * discover.js — Discover: the library side of the site.
 *
 * Always on (it was the config.js option `discover: true` until 5.3). A
 * Discover / Live switch sits under the room theme. Visitors open the site on Discover,
 * members on Live, and each person's last choice is remembered.
 *
 * Discover is its own page with the site's own parts: the left column keeps
 * the header and theme, then search and the views; the middle shows the
 * library; the right column is playlists (or the crate) and chat. The player is
 * the bar along the bottom, which also carries the room (On air / Live, Listen
 * in), so there's no separate room line. The bar opens the full-screen player:
 * the song in full and what goes with it (who found it, up next, the decks,
 * the chat), for a TV or a second screen, in Discover and in Live.
 *
 * Views: Home, New, Charts, Genres, DJs, Years, Recent plays, and a page
 * for each genre, DJ, artist, year and tempo (BPM). The bot publishes the charts, new
 * releases and a chat peek under discover/ (firetable-hostbot's
 * lib/discover.js); the weekly play history job publishes the library pages
 * under discover/lib/ (tools/history/library.js). Song details come from the
 * play history (globalTracks, globalSongs) and tempos (bpm/), all public.
 * DJs who turned off "Show my name on public pages" have no page and show as
 * nobody.
 *
 * Playback uses the room's own players, the way 30-second previews do:
 * firetable.preview = "discover" stops the room from re-syncing, and going
 * back to Live (or Listen in) picks the room up where it is now. Discover
 * plays whole songs, and they're scrobbled like the room's (lastfm.js asks
 * hearing() what's sounding).
 *
 * Visitors save songs to a crate kept in this browser. The third save offers
 * to keep it; when they join, it becomes a playlist ("My Discover crate"),
 * their DJ playlist if they have none yet. "Step inside" shows Live as
 * visitors see it today (the chat is for members only).
 *
 * Addresses: #discover, #discover/new, #discover/charts,
 * #discover/charts/<week|month|year|all>/<id>, #discover/genres[/<slug>],
 * #discover/djs[/<key>], #discover/years[/<year>], #discover/artist/<slug>,
 * #discover/bpm/<tempo>, #discover/recent, #live.
 */

// The YouTube player's own script leaves a fetch it cancelled unhandled when a
// song is stopped right after it starts (going to Live, Listen in, the next
// song): "signal is aborted". Nothing's wrong; it's not an error of ours.
window.addEventListener("unhandledrejection", function (e) {
  if (e.reason && e.reason.name === "AbortError") e.preventDefault();
});

// A library page from search (/music/..., tools/plain-pages.mjs) is this site
// with that page already filled in: from here on it's the site at the same
// Discover page (#discover/...), with nothing reloaded.
(function () {
  var route = document.querySelector('meta[name="ft-route"]');
  if (route && location.pathname !== "/") {
    try { history.replaceState(null, "", "/" + location.search + "#" + route.getAttribute("content")); } catch (e) { /* stays as it is */ }
  }
})();

firetable.discover = (function () {
  var D = {
    on: false,
    mode: null,          // "discover" | "live"
    view: "home",        // home | new | charts | genres | djs | years | recent | artist
    sub: null,           // the genre, DJ, artist or year a page is about
    chart: { period: "week", id: null },
    newFilter: null,     // week | month | days90 | unplayed (null: this week when it has any, else this month)
    newLayout: "grid",
    sideTab: "list",     // list | chat
    chartGenre: null,    // the chart, narrowed to one genre
    chartNew: false,     // the chart, new releases only
    genreTab: "fav",     // fav | newHere | deep
    djTab: null,         // most | firstHere; null: Brought here first when they have any (2.7)
    showAll: {},         // long lists opened past their top 10, by list and page
    djSort: "plays",     // plays | firsts | fires | since | name
    djFind: "",
    homeMore: {},
    data: { new: null, charts: {}, chartIds: {} },
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
  /**
   * A member's uid from their name, for records that keep only the name
   * (the play history's first and last DJ, older rows). Faces are made from
   * uid + name, so the name can't stand in for the uid. Looks in the room's
   * people, names seen this visit, then the library's DJs.
   * @returns {string|null}
   */
  function uidOf(name) {
    if (!name) return null;
    var want = String(name).toLowerCase();
    var users = (ftapi && ftapi.users) || {};
    for (var id in users) {
      if (Object.prototype.hasOwnProperty.call(users, id) && users[id] && String(users[id].username || "").toLowerCase() === want) return id;
    }
    var known = firetable.knownNames || {};
    for (var k in known) {
      if (Object.prototype.hasOwnProperty.call(known, k) && String(known[k]).toLowerCase() === want) return k;
    }
    var key = djIndex().byName[want];
    var d = key && (lib("djs") || {})[key];
    return (d && d.djid) || null;
  }
  /** Who to show for a DJ: hidden for visitors when they opted out. */
  function djShown(uid, name) {
    if (!name) return null;
    uid = uid || uidOf(name);
    if (!D.signedIn && nameHidden(uid)) return null;
    return { uid: uid, name: name };
  }
  function robot(dj, size) {
    if (!dj) return "";
    // no uid to make their face from: a plain circle, never someone else's face
    if (!dj.uid) return '<span class="ft-avatar pv-dj-avatar dj-avatar-tip d-noface" role="img" aria-label="' + esc(dj.name) + '"></span>';
    return '<span class="ft-avatar pv-dj-avatar dj-avatar-tip" role="img" aria-label="' + esc(dj.name) + '" style="background-image:url(' +
      esc(firetable.utilities.avatarURL(dj.uid, dj.name, size || "40x40")) + ')"></span>';
  }
  function saveButton(t) {
    return '<button type="button" class="histeal material-symbols-outlined row-icon" title="Add to playlist" aria-label="Add to playlist">playlist_add</button>';
  }
  /** The genre page's key, as the history job names it: "Soul & R&B" -> "soul-and-randb". */
  function genreSlug(g) {
    return String(g || "").toLowerCase().replace(/[-_/]+/g, " ").replace(/&/g, "and").replace(/\s+/g, " ").trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  /** An artist page's key: "Röyksopp & Robyn" -> "royksopp-and-robyn". */
  function artistSlug(name) {
    return String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ł/g, "l")
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  // how the history splits "A & B", "A x B", "A vs. B"... into artists
  var ARTIST_SPLIT = /(\s*(?:,|;|\s&\s|\s\+\s|\s+and\s+|\s+x\s+|\s+vs\.?\s+|\s+versus\s+|\s+with\s+|\s+\/\s+|\s+×\s+|、)\s*)/i;
  /** The artist line, with each artist in it linking to their page. */
  function artistLinks(a) {
    var text = String(a || "");
    if (!text) return "";
    return text.split(ARTIST_SPLIT).map(function (part, i) {
      if (i % 2 || !part.trim() || !artistSlug(part)) return esc(part);
      return '<a class="d-alink" href="#discover/artist/' + esc(artistSlug(part)) + '">' + esc(part) + "</a>";
    }).join("");
  }
  /** The artists named in an artist line. */
  function artistsOf(a) {
    return String(a || "").split(ARTIST_SPLIT).filter(function (p, i) { return !(i % 2) && p.trim() && artistSlug(p); }).map(function (p) { return p.trim(); });
  }
  /** A DJ's page key, when they have one (25+ plays, name shown). */
  function djKey(uid, name) {
    var ix = djIndex();
    if (uid && ix.byUid[uid]) return ix.byUid[uid];
    if (name && ix.byName[String(name).toLowerCase()]) return ix.byName[String(name).toLowerCase()];
    return null;
  }
  var djIx = null;
  function djIndex() {
    if (djIx) return djIx;
    var all = lib("djs");
    if (!all) return { byUid: {}, byName: {} };
    djIx = { byUid: {}, byName: {} };
    Object.keys(all).forEach(function (k) {
      var d = all[k] || {};
      if (d.djid) djIx.byUid[d.djid] = k;
      if (d.name) djIx.byName[String(d.name).toLowerCase()] = k;
    });
    return djIx;
  }
  /** Someone's robot, linking to their DJ page when they have one. */
  function robotLink(dj, size) {
    if (!dj) return "";
    var key = djKey(dj.uid, dj.name);
    return key ? '<a class="d-djlink" href="#discover/djs/' + esc(key) + '" title="' + esc(dj.name) + '">' + robot(dj, size) + "</a>" : robot(dj, size);
  }
  /** A name, linking to their DJ page when they have one. */
  function nameLink(dj) {
    if (!dj) return "";
    var key = djKey(dj.uid, dj.name);
    return key ? '<a class="d-namelink" href="#discover/djs/' + esc(key) + '">' + esc(dj.name) + "</a>" : esc(dj.name);
  }
  function moreButton() {
    return '<button type="button" class="row-icon material-symbols-outlined d-more" title="More" aria-label="More" aria-haspopup="menu">more_vert</button>';
  }
  /** The play button's name: it is the song's one Tab stop, so it says which song. */
  function playLabel(t, list, i) {
    return esc((isSounding(list, i) ? "Pause " : "Play ") + (t.t || "this song") + (t.a ? " by " + t.a : ""));
  }
  function rowAttrs(t, list, i) {
    return ' data-cid="' + esc(t.cid) + '" data-type="' + esc(t.type || 1) + '" data-list="' + esc(list) + '" data-i="' + i + '"';
  }

  /** A song as a Fresh card. */
  function card(t, list, i, meta) {
    var playing = isPlaying(list, i);
    return '<div class="pvbar' + (playing ? " previewing" : "") + '"' + rowAttrs(t, list, i) + ">" +
      '<div class="pv-art discart" style="background-image:url(' + esc(artOf(t)) + ')">' +
      '<button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + playLabel(t, list, i) + '">' + (isSounding(list, i) ? "pause" : "play_arrow") + "</button></div>" +
      '<div class="qtxt"><div class="listwords"><div class="fresh-title"><span class="fresh-track-title d-sheetlink" role="button" tabindex="0">' + esc(t.t) + '</span><span class="fresh-track-artist">' + artistLinks(t.a) + "</span></div>" +
      moreButton() + saveButton(t) + "</div>" +
      '<div class="fresh-meta">' + robotLink(meta.dj) + (meta.tag ? '<span class="d-tag d-befirst">' + esc(meta.tag) + "</span>" : "") + '<span class="histdj">' + esc(meta.who || "") + '</span><span class="histdate">' + esc(meta.date || "") + '</span><span class="histtime">' + esc(meta.extra || "") + "</span></div></div></div>";
  }

  /** A song as a Recent row on the timeline. */
  function row(t, list, i, meta) {
    var playing = isPlaying(list, i);
    return '<div class="hist-entry"><span class="hist-timestamp' + (meta.rank ? " d-rank" : "") + '">' + esc(meta.stamp || "") + "</span>" +
      (meta.dj ? robotLink(meta.dj) : '<span class="ft-avatar pv-dj-avatar dj-avatar-tip d-nobody" aria-hidden="true"></span>') +
      '<div class="pvbar' + (playing ? " previewing" : "") + '"' + rowAttrs(t, list, i) + ">" +
      '<div class="pv-art histart" style="background-image:url(' + esc(artOf(t)) + ')"><button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + playLabel(t, list, i) + '">' + (isSounding(list, i) ? "pause" : "play_arrow") + "</button></div>" +
      '<div class="listwords"><div class="histlink"><span class="hist-track-title d-sheetlink" role="button" tabindex="0">' + esc(t.t) + '</span><span class="hist-track-artist">' + artistLinks(t.a) + "</span></div></div>" +
      (meta.right ? '<span class="d-right">' + meta.right + "</span>" : "") +
      moreButton() + saveButton(t) + "</div></div>";
  }

  function emptyNote(text) { return '<p class="d-empty">' + esc(text) + "</p>"; }
  /** The site's skeleton shimmer, in the shape of the rows that will come. */
  function loading() {
    var rowSkel = '<div class="ft-skeleton d-skelrow" aria-hidden="true"><span class="skel d-skelart"></span><span class="d-skeltext"><span class="skel"></span><span class="skel"></span></span></div>';
    return '<div class="d-loading" role="status" aria-label="Loading">' + rowSkel + rowSkel + rowSkel + rowSkel + rowSkel + "</div>";
  }

  // ─── Lists the views show (also what plays next) ────────────────────────

  var lists = {};  // name -> { label, tracks }

  function setList(name, label, tracks) { lists[name] = { label: label, tracks: tracks }; }

  function newTracks() {
    var all = (D.data.new && D.data.new.tracks) || [];
    var now = Date.now();
    return all.filter(function (t) {
      if (D.newFilter === "unplayed") return !t.plays;
      if (D.newFilter === "week") return t.rel && String(t.rel).slice(0, 10) >= weekStart();
      if (D.newFilter === "month") return t.rel && now - new Date(t.rel).getTime() <= NEW_MONTH_DAYS * 86400000;
      return true;
    }).map(function (t) { return Object.assign({ type: 1 }, t); });
  }

  /** Home's shelf: the newest releases, whatever the New view's filter is. */
  function homeNew() {
    var all = (D.data.new && D.data.new.tracks) || [];
    return all.slice().sort(function (x, y) { return String(y.rel || "").localeCompare(String(x.rel || "")); })
      .slice(0, 18).map(function (t) { return Object.assign({ type: 1 }, t); });
  }

  // New this week: the last 8 days (today and the 7 before), so last Friday's
  // releases stay until the next Friday's arrive, and the shelf never empties at once
  var WEEK_DAYS = 8;
  /** The first day of New this week, as YYYY-MM-DD in local time. */
  function weekStart() {
    var d = new Date();
    d.setDate(d.getDate() - (WEEK_DAYS - 1));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  /** New this week: releases from the last 8 days, the most played first (newest first on ties). */
  function weekNew() {
    var from = weekStart();
    return ((D.data.new && D.data.new.tracks) || []).filter(function (t) { return t.rel && String(t.rel).slice(0, 10) >= from; })
      .sort(function (x, y) { return (y.plays || 0) - (x.plays || 0) || String(y.rel || "").localeCompare(String(x.rel || "")); })
      .map(function (t) { return Object.assign({ type: 1 }, t); });
  }
  /** New releases nobody has played here yet, the newest first. */
  function unplayedNew() {
    return ((D.data.new && D.data.new.tracks) || []).filter(function (t) { return !t.plays; })
      .sort(function (x, y) { return String(y.rel || "").localeCompare(String(x.rel || "")); })
      .map(function (t) { return Object.assign({ type: 1 }, t); });
  }
  /** A heading whose link opens New on one of its filters. */
  function newHead(title, link, filter) {
    return '<div class="d-head"><h2>' + esc(title) + '</h2><a href="#discover/new" data-newfilter="' + esc(filter) + '">' + esc(link) + "</a></div>";
  }
  /** Home's lead: the week's most played new release, big, with who found it. */
  function leadCard(t, list, count) {
    var u = firetable.utilities;
    var dj = t.plays && t.dj ? djShown(t.djid, t.dj) : null;
    var found = t.plays
      ? '<p class="d-leadfound">' + (dj ? robotLink(dj) + "<span>Found by " + nameLink(dj) + "</span>" : "<span>First played here</span>") +
        (t.first ? "<span>·</span><span>" + esc(u.shortDate(t.first)) + "</span>" : "") +
        "<span>·</span><span>" + esc(u.pluralize(t.plays, "play", "plays")) + (t.plays === 1 ? " so far" : "") + "</span></p>"
      : '<p class="d-leadfound"><span class="d-tag d-befirst">Be the first</span><span>Nobody has played it here yet</span></p>';
    var tags = (t.g ? '<a class="d-tag" href="#discover/genres/' + esc(genreSlug(t.g)) + '">' + esc(t.g) + "</a>" : "") + (t.dur ? '<span class="d-tag d-numtag">' + esc(clock(t.dur)) + "</span>" : "") +
      (t.rel ? '<span class="d-tag d-numtag">out ' + esc(u.shortDate(new Date(String(t.rel).slice(0, 10) + "T12:00:00").getTime())) + "</span>" : "");
    return '<div class="pvbar d-lead' + (isPlaying(list, 0) ? " previewing" : "") + '"' + rowAttrs(t, list, 0) + ">" +
      '<div class="pv-art discart d-leadart" style="background-image:url(' + esc(artOf(t)) + ')">' +
      '<button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + playLabel(t, list, 0) + '">' + (isSounding(list, 0) ? "pause" : "play_arrow") + "</button></div>" +
      '<div class="d-leadtext"><p class="d-kicker">' + (t.plays ? "The week's most played" : "New this week") + "</p>" +
      '<h3 class="d-leadtitle"><span class="d-sheetlink" role="button" tabindex="0">' + esc(t.t) + "</span></h3>" +
      '<p class="d-leadartist">' + artistLinks(t.a) + "</p>" +
      (tags ? '<div class="d-tags">' + tags + "</div>" : "") + found +
      '<div class="d-leadacts">' + playAllButton(list, "Play the week's " + count) + moreButton() + saveButton(t) + "</div></div></div>";
  }
  /** Home: the six DJs with the most plays here, as faces with names. */
  function topDjs() {
    var all = lib("djs");
    if (!all) return "";
    var top = Object.keys(all).map(function (k) { return Object.assign({ key: k }, all[k]); })
      .filter(function (d) { return d.name && djShown(d.djid, d.name); })
      .sort(function (x, y) { return (y.plays || 0) - (x.plays || 0); }).slice(0, 6);
    if (!top.length) return "";
    return "<section>" + head("DJs", "All DJs", "discover/djs") + '<div class="d-djrow">' + top.map(function (d) {
      return '<a class="d-djtile" href="#discover/djs/' + esc(d.key) + '">' + robot({ uid: d.djid, name: d.name }, "110x110") +
        '<span class="d-djname">' + esc(d.name) + '</span><span class="d-num">' + esc(firetable.utilities.pluralize(d.plays || 0, "play", "plays")) + "</span></a>";
    }).join("") + "</div></section>";
  }

  function newMeta(t) {
    var dj = t.dj ? djShown(t.djid, t.dj) : null;
    if (!t.plays) return { tag: "Be the first", who: "Nobody has played it yet", date: "", extra: "" };
    return { dj: dj, who: "", date: "first " + firetable.utilities.shortDate(t.first), extra: firetable.utilities.pluralize(t.plays, "play", "plays") };
  }

  function chartRows(chart) {
    // Among songs with the same plays (in a quiet week, most of the chart) the ones
    // the room fired come first, most fires first; the rest keep the bot's order.
    // They still share a rank: fires order a tie, they never break it.
    return ranked(((chart && chart.rows) || []).map(function (r) {
      return { type: r.type || 1, cid: r.cid, a: r.a, t: r.t, plays: r.plays, fires: r.fires || 0, mv: r.mv, wks: r.wks, dj: r.dj, djid: r.djid, first: r.first, g: r.g || null };
    }).sort(function (x, y) { return (y.plays || 0) - (x.plays || 0) || y.fires - x.fires; }), "plays");
  }
  /**
   * Standard competition ranking (redesign step 1.9): songs with the same count
   * share a rank ("=3", and the next is 5th). Adds rank and tie to each row of
   * a list already sorted by `key`, most first.
   */
  function ranked(rows, key) {
    rows.forEach(function (r, i) {
      var prev = rows[i - 1], next = rows[i + 1];
      r.rank = prev && prev[key] === r[key] ? prev.rank : i + 1;
      r.tie = !!((prev && prev[key] === r[key]) || (next && next[key] === r[key]));
    });
    return rows;
  }
  /** A rank as shown: "#3", or "=3" when it's shared. */
  function rankStamp(r, i) { return (r.tie ? "=" : "#") + (r.rank || i + 1); }
  var TIE_NOTE = '<p class="d-fact d-tienote">Songs with the same number of plays share a rank.</p>';

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
    { id: "genres", label: "Genres", icon: "category" },
    { id: "djs", label: "DJs", icon: "headphones" },
    { id: "years", label: "Years", icon: "calendar_month" },
    { id: "themes", label: "Theme nights", icon: "nightlife" },
    { id: "recent", label: "Recent plays", icon: "history" }
  ];
  var VIEW_IDS = VIEWS.map(function (v) { return v.id; }).concat(["artist", "search", "bpm"]);

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

  function newList(tracks, layout, listName, max, compact, page) {
    tracks = max ? tracks.slice(0, max) : tracks;
    if (!tracks.length) return D.data.new ? emptyNote("No new releases here yet. The bot adds them once a day.") : loading();
    if (layout === "list") {
      return '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
        var m = newMeta(t);
        return row(t, listName, i, { stamp: firetable.utilities.shortDate(t.rel), dj: m.dj, right: m.extra || "new" });
      }).join("") + "</div>";
    }
    return '<div class="ft-cards' + (compact ? " d-compact" : "") + (page ? " d-newgrid" : "") + '">' + tracks.map(function (t, i) { return card(t, listName, i, newMeta(t)); }).join("") + "</div>";
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
      var first = t.first ? djShown(t.djid, t.dj) : null;
      var right = genreLink(t.g) +
        (t.first ? '<span class="d-firsthere" title="First played here">' + (first ? esc(first.name) + " · " : "") + esc(firetable.utilities.shortDate(t.first)) + "</span>" : "") +
        (t.fires ? '<span class="d-fires" title="' + esc(firetable.utilities.pluralize(t.fires, "fire", "fires")) + ' (not counted)">' + ms("local_fire_department") + '<span class="d-num">' + esc(t.fires) + "</span></span>" : "") +
        (period === "week" ? movement(t.mv) + (t.wks > 1 ? '<span class="d-num d-wks" title="weeks in a row on the chart">' + esc(t.wks) + " wks</span>" : "") : "") +
        '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>";
      return row(t, listName, i, { stamp: rankStamp(t, i), rank: true, dj: djShown(t.djid, t.dj), right: right });
    }).join("") + "</div>" + (tracks.some(function (t) { return t.tie; }) ? TIE_NOTE : "");
  }

  function genreLink(g) {
    return g ? '<a class="d-g" href="#discover/genres/' + esc(genreSlug(g)) + '">' + esc(g) + "</a>" : "";
  }

  function recentList(tracks, listName, max) {
    tracks = max ? tracks.slice(0, max) : tracks;
    if (!tracks.length) return loading();
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
    var v = D.view;
    if (v === "home") h = viewHome();
    else if (v === "new") h = viewNew();
    else if (v === "charts") h = viewCharts();
    else if (v === "genres") h = D.sub ? viewGenre(D.sub) : viewGenres();
    else if (v === "djs") h = D.sub ? viewDj(D.sub) : viewDjs();
    else if (v === "years") h = D.sub ? viewYear(D.sub) : viewYears();
    else if (v === "artist") h = viewArtist(D.sub);
    else if (v === "bpm") h = viewTempo(Number(D.sub));
    else if (v === "themes") h = D.sub ? viewNight(D.sub) : viewNights();
    else if (v === "search") h = viewSearch(D.sub || "");
    else if (v === "recent") {
      var rt = recentTracks();
      setList("recent", "Recent plays", rt);
      h += '<div class="d-headrow"><h2>Recent plays</h2></div><p class="d-fact">The last 100 songs played live</p>';
      h += recentList(rt, "recent");
    }
    // a page from search keeps its filled-in copy until the live one has its data
    if (D.prerendered) {
      if (/class="d-loading"/.test(h)) return;
      D.prerendered = false;
    }
    el.innerHTML = h;
    if (v === "genres" && !D.sub) layoutMap();
    if (v === "djs" && D.sub) drawCards();
    firetable.ui.markSaved();
  }

  /** A shelf on Home: the first few, and the rest a tap away. */
  function more(id, total, shown) {
    if (total <= shown) return "";
    return '<button type="button" class="linkButton d-homemore" data-more="' + esc(id) + '">' + (D.homeMore[id] ? "Show fewer" : "Show all " + total) + "</button>";
  }

  function viewHome() {
    var h = "";
    // the newest 18 releases: this month's, then the rest of the last 90 days
    var nt = homeNew();
    var monthOnly = nt.every(function (t) { return t.rel && Date.now() - new Date(t.rel).getTime() <= NEW_MONTH_DAYS * 86400000; });
    var newTitle = monthOnly ? "New this month" : "New releases";
    var wk = currentId("week");
    var chart = chartRows(wk && D.data.charts["week/" + wk]);
    var recent = recentTracks();
    var rising = ((lib("rising") || {}).rows || []).map(function (r) { return Object.assign({ type: 1 }, r); });
    var today = lib("onThisDay/" + monthDay()) || [];
    setList("home-new", newTitle, nt);
    setList("home-chart", "Room chart · this week", chart);
    setList("home-rising", "Rising", rising);
    setList("home-today", "On this day", today);
    setList("home-recent", "Recent plays", recent);
    // New this week leads, once there are six; until then the newest releases
    var week = weekNew();
    if (week.length >= 6) {
      setList("home-week", "New this week", week);
      h += '<section class="d-week">' + newHead("New this week", "All " + week.length + " from this week", "week") + leadCard(week[0], "home-week", week.length) +
        '<div class="ft-cards d-compact">' + week.slice(1, 7).map(function (t, i) { return card(t, "home-week", i + 1, newMeta(t)); }).join("") + "</div></section>";
    } else {
      h += "<section>" + newHead(newTitle, "All new releases", "days90") + newList(nt, "grid", "home-new", 18, true) + "</section>";
    }
    // Under New this week, a song its row already shows stays out of this one
    // (in a week nobody had played yet the two rows were the same four songs).
    // The link still counts them all, and New lists them all. Without a week's
    // row the newest releases lead instead, and this row is as it was.
    var allUnplayed = unplayedNew();
    var above = {};
    if (week.length >= 6) week.slice(0, 7).forEach(function (t) { above[t.cid] = true; });
    var unplayed = allUnplayed.filter(function (t) { return !above[t.cid]; });
    if (unplayed.length) {
      setList("home-unplayed", "Not played live yet", unplayed);
      h += "<section>" + newHead("Not played live yet", "All " + allUnplayed.length, "unplayed") +
        '<div class="ft-cards d-compact">' + unplayed.slice(0, 6).map(function (t, i) {
          return card(t, "home-unplayed", i, { tag: "Be the first", date: t.rel ? "out " + firetable.utilities.shortDate(new Date(String(t.rel).slice(0, 10) + "T12:00:00").getTime()) : "" });
        }).join("") + "</div></section>";
    }
    h += "<section>" + head("Room chart · this week", "Full chart", "discover/charts") + chartList(chart, "home-chart", 5, "week") + "</section>";
    h += topDjs();
    if (rising.length) {
      var rn = D.homeMore.rising ? rising.length : 5;
      ranked(rising, "recent");
      h += "<section>" + head("Rising") + '<p class="d-fact">Played more in the last four weeks than the four before</p>' +
        '<div class="ft-rows d-rowlist">' + rising.slice(0, rn).map(function (t, i) {
          return row(t, "home-rising", i, { stamp: rankStamp(t, i), rank: true, dj: djShown(t.djid, t.dj),
            right: '<span class="d-mv up">▲' + esc(t.up) + '</span><span class="d-num">' + esc(firetable.utilities.pluralize(t.recent, "play", "plays")) + "</span>" });
        }).join("") + "</div>" + more("rising", rising.length, 5) + "</section>";
    }
    var nights = nightIndex().slice(0, 3);
    if (nights.length) h += "<section>" + head("Theme nights", "All theme nights", "discover/themes") + '<div class="d-nights">' + nights.map(nightRow).join("") + "</div></section>";
    var genres = genreList().slice(0, 12);
    if (genres.length) {
      h += "<section>" + head("Genres", "All genres", "discover/genres") +
        '<div class="d-chips d-genrechips">' + genres.map(function (g) { return '<a class="d-chip" href="#discover/genres/' + esc(g.slug) + '">' + esc(g.name) + "</a>"; }).join("") + "</div></section>";
    }
    if (today.length) {
      var d = new Date();
      h += "<section>" + head("On this day") + '<p class="d-fact">First played here on ' + esc(d.toLocaleString("en-US", { month: "long", day: "numeric" })) + " in years past</p>" +
        '<div class="ft-rows d-rowlist">' + today.map(function (t, i) {
          return row(t, "home-today", i, { stamp: t.first ? String(new Date(t.first).getFullYear()) : "", dj: djShown(t.djid, t.dj),
            right: '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" });
        }).join("") + "</div></section>";
    }
    h += "<section>" + head("Recent plays", "All recent plays", "discover/recent") + recentList(recent, "home-recent", 5) + "</section>";
    return h;
  }

  // New's one Show menu (round 4: filters behind one button, no rows of chips)
  var NEW_SHOW = [["week", "This week"], ["month", "This month"], ["days90", "Last 90 days"], ["unplayed", "Not played live yet"]];
  var NEW_FACT = { week: "released in the last 8 days", month: "released this month", days90: "released in the last 90 days", unplayed: "nobody has played here yet" };
  function viewNew() {
    if (!D.newFilter) D.newFilter = weekNew().length ? "week" : "month";
    var tracks = newTracks();
    var label = (NEW_SHOW.filter(function (o) { return o[0] === D.newFilter; })[0] || NEW_SHOW[1])[1];
    setList("new", "New · " + label.toLowerCase(), tracks);
    return '<div class="d-headrow"><h2>New</h2>' +
      '<label class="d-show"><span>Show</span><select id="dNewShow" class="d-select">' + NEW_SHOW.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === D.newFilter ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select></label>" + layoutButtons(D.newLayout) + "</div>" +
      '<p class="d-fact">' + esc(firetable.utilities.pluralize(tracks.length, "song", "songs")) + " " + esc(NEW_FACT[D.newFilter] || "") + ", newest first</p>" +
      newList(tracks, D.newLayout, "new", 0, false, true);
  }

  function viewCharts() {
    var h = "";
    var period = D.chart.period;
    var id = D.chart.id || currentId(period);
    var key = period + "/" + id;
    if (id && D.data.charts[key] === undefined) loadChart(period, id);
    var c = D.data.charts[key];
    var all = chartRows(c);
    // the genres on this chart, most rows first, to narrow it to one
    var count = {};
    all.forEach(function (r) { if (r.g) count[r.g] = (count[r.g] || 0) + 1; });
    var gs = Object.keys(count).sort(function (x, y) { return count[y] - count[x]; }).slice(0, 8);
    if (D.chartGenre && !count[D.chartGenre]) D.chartGenre = null;
    // new releases only: songs out in the last 90 days (discover/new)
    var fresh = {};
    ((D.data.new && D.data.new.tracks) || []).forEach(function (t) { fresh[t.cid] = true; });
    var rows = all.filter(function (r) { return (!D.chartGenre || r.g === D.chartGenre) && (!D.chartNew || fresh[r.cid]); });
    setList("chart", "Room chart · " + chartTitle(period, id) + (D.chartNew ? " · new releases" : "") + (D.chartGenre ? " · " + D.chartGenre : ""), rows);
    h += '<div class="d-headrow"><h2>Room chart</h2><div class="d-seg" role="group" aria-label="Period">' +
      [["week", "Week"], ["month", "Month"], ["year", "Year"], ["all", "All time"]].map(function (o) {
        return '<button type="button" class="d-segbtn' + (o[0] === period ? " on" : "") + '" data-period="' + o[0] + '" aria-pressed="' + (o[0] === period) + '">' + o[1] + "</button>";
      }).join("") + "</div></div>";
    var stepper = "";
    if (period !== "all") {
      var ids = Object.keys(D.data.chartIds[period] || {}).sort();
      var at = ids.indexOf(id);
      stepper = '<button type="button" class="butt graybutt iconbutt" data-step="-1" title="Earlier" aria-label="Earlier"' + (at > 0 ? "" : " disabled") + ">" + ms("chevron_left") + "</button>" +
        '<button type="button" class="butt graybutt iconbutt" data-step="1" title="Later" aria-label="Later"' + (at > -1 && at < ids.length - 1 ? "" : " disabled") + ">" + ms("chevron_right") + "</button>";
    }
    var fact = c && c.plays ? " · " + firetable.utilities.pluralize(c.plays, "play", "plays") + " by " + firetable.utilities.pluralize(c.djs || 0, "DJ", "DJs") : "";
    h += '<div class="d-headrow">' + stepper + '<p class="d-fact"><b>' + esc(chartTitle(period, id)) + "</b>" + esc(fact) + (period === "all" ? " · from the room's whole history" : "") + "</p></div>";
    // genre and new releases only: two drop-downs (round 4: no rows of chips)
    h += '<div class="d-headrow d-chartctl">' +
      (gs.length > 1 ? '<label class="d-show"><span class="sr-only">Genre</span><select id="dChartGenre" class="d-select"><option value="">All genres</option>' +
        gs.map(function (g) { return '<option value="' + esc(g) + '"' + (D.chartGenre === g ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("") + "</select></label>" : "") +
      '<label class="d-show"><span class="sr-only">Which songs</span><select id="dChartWhich" class="d-select"><option value="">All songs</option>' +
        '<option value="new"' + (D.chartNew ? " selected" : "") + ">New releases only</option></select></label>" +
      '<span class="d-chartacts">' + (rows.length ? '<button type="button" class="butt d-playall d-panelmain" data-list="chart">' + ms("play_arrow", true) + "<span>Play the chart</span></button>" +
        saveAllButton("chart", "Save as playlist") : "") +
      '<button type="button" class="butt graybutt d-share" title="Share this chart: a link, a picture or an embed" aria-label="Share this chart">' + ms("share") + "<span>Share</span></button></span></div>";
    h += c === undefined ? loading() : rows.length || !all.length ? chartList(rows, "chart", 0, period)
      : emptyNote(D.chartNew ? "No new releases on this chart." : "Nothing in this genre on this chart.");
    return h;
  }

  // ─── The library: genres, DJs, artists, years ───────────────────────────

  var libData = {};
  var libAsked = {};
  /** discover/lib/<path>, read once: undefined while it loads, null if there's none. */
  function lib(path) {
    if (!libAsked[path]) {
      libAsked[path] = true;
      db().ref("discover/lib/" + path).once("value").then(function (s) { libLoaded(path, s.val()); }, function (err) { quiet(err); libLoaded(path, null); });
    }
    return libData[path];
  }
  function libLoaded(path, val) {
    libData[path] = val;
    if (path === "djs") djIx = null;
    if (D.mode === "discover") renderBrowse();
    if (path === "djs" || /^(genre|dj|artist)\//.test(path)) renderSide();
  }
  function libWaiting(val, missing) {
    if (val === undefined) return loading();
    return val === null ? emptyNote(missing) : "";
  }
  var LIB_LATER = "This arrives with the weekly play history update.";

  function monthDay() {
    var d = new Date();
    return (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }
  function n(x) { return Number(x || 0).toLocaleString("en-US"); }
  function back(to, label) {
    return '<a class="d-back" href="#' + esc(to) + '">' + ms("arrow_back") + "<span>" + esc(label) + "</span></a>";
  }
  function coverOf(key) {
    var i = String(key || "").indexOf("_");
    return artOf({ type: Number(key.slice(0, i)) || 1, cid: key.slice(i + 1) });
  }
  /** A page's facts as chips under its title (2.7): "120 plays", "usually Friday nights"… */
  function factChips(facts) {
    return '<ul class="d-fact d-facts">' + facts.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>";
  }
  function mosaic(covers, big) {
    var c = (covers || []).slice(0, 4);
    while (c.length < 4) c.push(null);
    return '<span class="d-mosaic' + (big ? " big" : "") + '" aria-hidden="true">' + c.map(function (k) {
      return "<i" + (k ? ' style="background-image:url(' + esc(coverOf(k)) + ')"' : "") + "></i>";
    }).join("") + "</span>";
  }
  function playAllButton(listName, label) {
    return '<button type="button" class="butt d-playall d-panelmain" data-list="' + esc(listName) + '">' + ms("play_arrow", true) + "<span>" + esc(label) + "</span></button>" +
      saveAllButton(listName);
  }
  // The genre's playlist on YouTube Music, once the bot has made it (discover/ytm)
  var ytmLists, ytmAsked = false;
  function ytmButton(slug, name) {
    if (!ytmAsked) {
      ytmAsked = true;
      db().ref("discover/ytm").once("value").then(function (s) { ytmLists = s.val() || {}; if (ytmLists[D.sub] && D.view === "genres") renderBrowse(); },
        function (err) { quiet(err); ytmLists = {}; });
    }
    var id = ytmLists && ytmLists[slug];
    if (!id || !/^[\w-]+$/.test(id)) return "";
    return '<a class="butt graybutt d-ytm" href="https://music.youtube.com/playlist?list=' + esc(id) + '" target="_blank" rel="noopener" title="' + esc("The " + name + " room favorites as a playlist on YouTube Music") + '">' +
      ms("open_in_new") + "<span>YouTube Music</span></a>";
  }
  function saveAllButton(listName, label) {
    return '<button type="button" class="butt graybutt d-saveall" data-list="' + esc(listName) + '" title="' + (D.signedIn ? "Save these songs as a new playlist" : "Save these songs to your crate") + '">' +
      ms("playlist_add") + "<span>" + esc(label || "Save all") + "</span></button>";
  }
  /**
   * A long list shows its top 10 and "Show all N" (2.7); Play and Save still
   * take the whole list. Once shown, a list stays open while you're on the page.
   */
  var CAP = 10;
  function capped(listName, count, rowsHtml) {
    var key = listName + "/" + (D.sub || D.view);
    if (count <= CAP + 2 || D.showAll[key]) return '<div class="ft-rows d-rowlist">' + rowsHtml + "</div>";
    return '<div class="ft-rows d-rowlist d-capped">' + rowsHtml + "</div>" +
      '<button type="button" class="butt graybutt d-showall" data-showall="' + esc(key) + '">' + ms("expand_more") + "<span>Show all " + esc(n(count)) + "</span></button>";
  }
  function rankedRows(tracks, listName, rightOf) {
    if (!tracks.length) return emptyNote("Nothing here yet.");
    // ranked by plays when the list is in play order; a list in another order keeps its places
    var byPlays = tracks.every(function (t, i) { return !i || (tracks[i - 1].plays || 0) >= (t.plays || 0); });
    var ranks = byPlays ? ranked(tracks.map(function (t) { return { plays: t.plays || 0 }; }), "plays") : [];
    return capped(listName, tracks.length, tracks.map(function (t, i) {
      return row(t, listName, i, { stamp: ranks[i] ? rankStamp(ranks[i], i) : "#" + (i + 1), rank: true, dj: djShown(t.djid, t.dj), right: rightOf ? rightOf(t) : '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" });
    }).join("")) + (ranks.some(function (r) { return r.tie; }) ? TIE_NOTE : "");
  }
  function datedRows(tracks, listName) {
    if (!tracks.length) return emptyNote("Nothing here yet.");
    return capped(listName, tracks.length, tracks.map(function (t, i) {
      return row(t, listName, i, { stamp: t.first ? firetable.utilities.shortDate(t.first) : "", dj: djShown(t.djid, t.dj), right: '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" });
    }).join(""));
  }
  function person(p, fact, more) {
    var dj = djShown(p.djid, p.dj || p.name);
    if (!dj) return "";
    var key = p.key && (lib("djs") || {})[p.key] ? p.key : djKey(dj.uid, dj.name);
    var inner = robot(dj, "80x80") + '<span class="d-person-text"><b>' + esc(dj.name) + "</b><span>" + fact + "</span>" + (more ? "<span>" + more + "</span>" : "") + "</span>";
    return key ? '<a class="d-person" href="#discover/djs/' + esc(key) + '">' + inner + "</a>" : '<span class="d-person">' + inner + "</span>";
  }
  /**
   * A library list, ready to show: each song once (the same upload, or the
   * same artist and title, counts as a repeat), whatever the published data
   * holds. The history job checks this too; this keeps a page right meanwhile.
   */
  function withType(list) {
    var seen = {};
    return (list || []).map(function (t) { return Object.assign({ type: 1 }, t); }).filter(function (t) {
      var a = Number(t.type) + "_" + t.cid, b = String(t.a || "").toLowerCase().trim() + "|" + String(t.t || "").toLowerCase().trim();
      if (seen[a] || (t.t && seen[b])) return false;
      seen[a] = seen[b] = true;
      return true;
    });
  }

  /** Every genre, most played first. */
  function genreList() {
    var all = lib("genres") || {};
    return Object.keys(all).map(function (k) { return Object.assign({ slug: k }, all[k]); })
      .sort(function (x, y) { return (y.plays || 0) - (x.plays || 0); });
  }

  function viewGenres() {
    var all = lib("genres");
    var wait = libWaiting(all, "Genres arrive with the weekly play history update.");
    if (wait) return '<div class="d-headrow"><h2>Genres</h2></div>' + wait;
    var list = genreList();
    var bpms = list.map(function (g) { return g.bpm; }).filter(Boolean);
    var lo = Math.min.apply(null, bpms.length ? bpms : [100]), hi = Math.max.apply(null, bpms.length ? bpms : [130]);
    if (hi - lo < 10) { lo -= 5; hi += 5; }
    // a decade: each genre sized by its plays then (all time: every play)
    var decs = {};
    list.forEach(function (g) { Object.keys(g.dec || {}).forEach(function (d) { decs[d] = (decs[d] || 0) + g.dec[d]; }); });
    var decList = Object.keys(decs).filter(function (d) { return decs[d] > 0; }).sort().reverse();
    if (D.mapDecade && !decs[D.mapDecade]) D.mapDecade = null;
    var weight = function (g) { return D.mapDecade ? ((g.dec || {})[D.mapDecade] || 0) : (g.plays || 0); };
    list = list.slice().sort(function (a, b) { return weight(b) - weight(a); });
    var top = list.length ? weight(list[0]) || 1 : 1;
    var h = '<div class="d-headrow"><h2>Genres</h2>' + (decList.length > 1 ? chips("decade", [["", "All time"]].concat(decList.map(function (d) { return [d, d + "s"]; })), D.mapDecade || "") : "") + "</div>" +
      '<p class="d-fact">' + esc(list.length) + " sounds the room plays" + (D.mapDecade ? ", sized by plays in the " + D.mapDecade + "s" : "") + ". Across: played by a band, or made on machines. Up: faster.</p>";
    h += '<div class="d-map" role="list" aria-label="Sound map">' +
      '<span class="d-axis d-axis-up">' + esc(hi) + " BPM</span>" +
      '<span class="d-axis d-axis-down">' + esc(lo) + " BPM</span>" +
      '<span class="d-axis d-axis-left">Band-made</span><span class="d-axis d-axis-right">Machine-made</span>' +
      list.map(function (g) {
        var x = 6 + (g.x == null ? 0.5 : g.x) * 88;
        var y = g.bpm ? 8 + (1 - (g.bpm - lo) / (hi - lo)) * 80 : 48;
        var size = Math.sqrt(weight(g) / top);
        return '<a role="listitem" class="d-mapg' + (D.mapDecade && !weight(g) ? " d-quiet" : "") + (D.mapPick === g.slug ? " is-picked" : "") + '" href="#discover/genres/' + esc(g.slug) + '" data-slug="' + esc(g.slug) + '"' + (D.mapPick === g.slug ? ' aria-current="true"' : "") + ' data-y="' + y.toFixed(1) + '" style="left:' + x.toFixed(1) + "%;top:" + y.toFixed(1) + "%;--s:" + size.toFixed(2) + '" title="' +
          esc(g.name + " · " + n(g.plays) + " plays" + (g.bpm ? " · usually " + g.bpm + " BPM" : "")) + '">' + esc(g.name) + "</a>";
      }).join("") + "</div>";
    // what the marks mean (the room's genre and yours are found after the page draws: mapMarks)
    h += '<p class="d-maplegend" id="dMapLegend"><span class="d-mlsize">Bigger: played here more</span><span class="d-mlroom">The room is playing</span><span class="d-mltonight">Played tonight (brighter: more)</span><span class="d-mlhear">You\'re hearing</span><span class="d-mlpick">Picked: its card is below</span></p>';
    h += '<div class="d-mapcard" id="dMapCard" aria-live="polite">' + mapCard(D.mapPick) + "</div>";
    h += '<div class="d-gcards">' + list.map(function (g) {
      return '<a class="d-gcard" href="#discover/genres/' + esc(g.slug) + '">' + mosaic(g.covers) +
        '<span class="d-gname">' + esc(g.name) + '</span><span class="d-gfact d-num">' + (D.mapDecade ? esc(n(weight(g))) + " plays in the " + esc(D.mapDecade) + "s" : esc(n(g.songs)) + " songs · " + esc(n(g.plays)) + " plays") + "</span></a>";
    }).join("") + "</div>";
    return h;
  }

  /** Spread the map's labels so none sit on top of another (or the axis labels). */
  var mapWatch = null;
  function layoutMap() {
    var box = document.querySelector("#dBrowse .d-map");
    if (!box) return;
    if (window.ResizeObserver && mapWatch !== box) {
      mapWatch = box;
      new ResizeObserver(function () { if (box.isConnected) spreadMap(box); }).observe(box);
    }
    spreadMap(box);
    mapMarks();
  }

  /**
   * The sound map's marks: a red dot on the room song's genre, a gold outline
   * on the genre you're hearing (the room's, unless Discover is playing).
   * The genre comes from the song's library record (loadDetails).
   */
  var marking = 0;
  var TONIGHT_MS = 8 * 3600000;
  function mapMarks() {
    var box = document.querySelector("#dBrowse .d-map");
    if (!box) return;
    var turn = ++marking;
    var room = liveTrack();
    var mine = discoverActive() ? P.track : room;
    var genreOf = function (t) {
      if (!t) return Promise.resolve(null);
      if (t.g) return Promise.resolve(genreSlug(t.g));
      return loadDetails(t).then(function (d) { return d.genres && d.genres[0] ? genreSlug(d.genres[0]) : null; });
    };
    // tonight: the genres of the room's plays in the last 8 hours (the bot adds g to each Recent row)
    var history = ftapi.watchFeed ? ftapi.watchFeed("history").catch(function () {}) : Promise.resolve();
    Promise.all([genreOf(room), genreOf(mine), history]).then(function (gs) {
      if (turn !== marking || !box.isConnected) return;
      var since = Date.now() - TONIGHT_MS, tonight = {};
      (firetable._historyCache || []).forEach(function (h) {
        if (h && h.g && (h.when || 0) >= since) tonight[genreSlug(h.g)] = (tonight[genreSlug(h.g)] || 0) + 1;
      });
      var most = Math.max.apply(null, Object.keys(tonight).map(function (k) { return tonight[k]; }).concat(1));
      box.querySelectorAll(".d-mapg").forEach(function (el) {
        var slug = el.getAttribute("data-slug");
        el.classList.toggle("d-room", !!gs[0] && slug === gs[0]);
        el.classList.toggle("d-hear", !!gs[1] && slug === gs[1]);
        el.classList.toggle("d-tonight", !!tonight[slug]);
        // the ring is brighter the more of tonight was this genre: on a full
        // evening nearly every genre has one, and they all looked the same
        if (tonight[slug]) el.style.setProperty("--t", (tonight[slug] / most).toFixed(2));
        else el.style.removeProperty("--t");
      });
      var legend = document.getElementById("dMapLegend");
      if (legend) {
        legend.classList.toggle("has-room", !!gs[0] && !!box.querySelector(".d-room"));
        legend.classList.toggle("has-hear", !!gs[1] && !!box.querySelector(".d-hear"));
        legend.classList.toggle("has-tonight", !!box.querySelector(".d-tonight"));
      }
    });
  }

  /** A genre's card under the sound map: what it is, its numbers, next door, its radio and its page. */
  function mapCard(slug) {
    var all = lib("genres") || {};
    var g = slug && all[slug];
    if (!g) return '<p class="d-fact">Pick a genre on the map to see it here.</p>';
    var facts = [n(g.songs) + " songs", n(g.plays) + " plays"];
    if (g.bpm) facts.push("usually " + g.bpm + " BPM");
    if (g.first) facts.push("played here since " + g.first);
    var next = (g.next || []).filter(function (k) { return all[k]; });
    return '<div class="d-mapcardin">' + mosaic(g.covers) + '<div class="d-mapcardtext"><h3>' + esc(g.name) + "</h3>" +
      (g.about ? '<p class="d-about">' + esc(g.about) + "</p>" : "") + '<p class="d-fact">' + esc(facts.join(" · ")) + "</p>" +
      (next.length ? '<p class="d-fact">Next door: ' + next.map(function (k) { return '<a class="d-mapnext" href="#discover/genres/' + esc(k) + '" data-slug="' + esc(k) + '">' + esc(all[k].name) + "</a>"; }).join(", ") + "</p>" : "") +
      '<div class="d-actions"><button type="button" class="butt d-panelmain d-radio" data-slug="' + esc(slug) + '">' + ms("radio") + "<span>" + esc(g.name) + " radio</span></button>" +
      '<a class="butt graybutt" href="#discover/genres/' + esc(slug) + '">' + ms("arrow_forward") + "<span>Open " + esc(g.name) + "</span></a></div></div></div>";
  }
  /** Pick a genre on the map: its card shows under the map, and the page stays. */
  function pickGenre(slug) {
    D.mapPick = slug;
    var box = document.querySelector("#dBrowse .d-map");
    if (box) box.querySelectorAll(".d-mapg").forEach(function (el) {
      var on = el.getAttribute("data-slug") === slug;
      el.classList.toggle("is-picked", on);
      if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
    });
    var card = document.getElementById("dMapCard");
    if (card) card.innerHTML = mapCard(slug);
  }
  function spreadMap(box) {
    var W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    var labels = Array.prototype.slice.call(box.querySelectorAll(".d-mapg"));
    labels.forEach(function (el) { el.style.top = el.getAttribute("data-y") + "%"; });
    var outer = box.getBoundingClientRect();
    var placed = Array.prototype.slice.call(box.querySelectorAll(".d-axis")).map(function (a) {
      var r = a.getBoundingClientRect();
      return { l: r.left - outer.left, r: r.right - outer.left, t: r.top - outer.top, b: r.bottom - outer.top };
    });
    var hits = function (r) { return placed.some(function (p) { return r.l < p.r && r.r > p.l && r.t < p.b && r.b > p.t; }); };
    labels.forEach(function (el) {
      var w = el.offsetWidth, h = el.offsetHeight;
      var cx = el.offsetLeft, cy = el.offsetTop; // the label's centre (it's moved back by half its size)
      var at = function (y) { return { l: cx - w / 2 - 2, r: cx + w / 2 + 2, t: y - h / 2, b: y + h / 2 }; };
      var y = cy;
      var step = Math.max(4, h * 0.5);
      // the nearest free spot above or below; where it's full, it stays put
      for (var k = 1; hits(at(y)) && Math.ceil(k / 2) * step <= H; k++) {
        var c = cy + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step;
        if (c >= h / 2 && c <= H - h / 2 && !hits(at(c))) { y = c; break; }
      }
      el.style.top = y + "px";
      placed.push(at(y));
    });
  }

  function viewGenre(slug) {
    var all = lib("genres");
    var g = all && all[slug];
    var page = lib("genre/" + slug);
    var h = back("discover/genres", "Genres");
    if (all === undefined || page === undefined) return h + loading();
    if (!g || !page) return h + emptyNote("There's no page for this genre yet. " + LIB_LATER);
    var facts = [n(g.songs) + " songs", n(g.plays) + " plays"];
    if (g.bpm) facts.push("usually " + g.bpm + " BPM");
    if (g.first) facts.push("played here since " + g.first);
    if (g.djs) facts.push(firetable.utilities.pluralize(g.djs, "DJ", "DJs"));
    var tabs = { fav: ["Room favorites", page.fav], newHere: ["New here", page.newHere], deep: ["Deep cuts", page.deep] };
    var tab = tabs[D.genreTab] ? D.genreTab : "fav";
    var tracks = withType(tabs[tab][1]);
    setList("genre", g.name + " · " + tabs[tab][0], tracks);
    h += '<div class="d-pagehead">' + mosaic(g.covers, true) + '<div class="d-pagetext"><h2>' + esc(g.name) + "</h2>" +
      (g.about ? '<p class="d-about">' + esc(g.about) + "</p>" : "") + factChips(facts) +
      '<div class="d-actions"><button type="button" class="butt d-panelmain d-radio" data-slug="' + esc(slug) + '">' + ms("radio") + "<span>Play " + esc(g.name) + " radio</span></button>" +
      saveAllButton("genre") + ytmButton(slug, g.name) + "</div></div></div>";
    h += "<section>" + '<div class="d-headrow">' + chips("gtab", [["fav", "Room favorites"], ["newHere", "New here"], ["deep", "Deep cuts"]], tab) + "</div>" +
      '<p class="d-fact">' + esc(tab === "fav" ? "Most played in the room" : tab === "newHere" ? "Played here for the first time lately" : "Played here once or twice, last played first") + "</p>" +
      (tab === "fav" ? rankedRows(tracks, "genre") : datedRows(tracks, "genre")) + "</section>";
    var years = page.years || {};
    var ys = Object.keys(years).sort();
    if (ys.length > 1) {
      var max = Math.max.apply(null, ys.map(function (y) { return years[y]; }));
      h += "<section>" + head("By year") + '<p class="d-fact">Songs first played here each year</p><div class="d-years" role="img" aria-label="' +
        esc(ys.map(function (y) { return y + ": " + years[y]; }).join(", ")) + '">' + ys.map(function (y, i) {
          var label = i === 0 || i === ys.length - 1 || Number(y) % 5 === 0;
          return '<span class="d-yb" title="' + esc(y + ": " + years[y] + " songs") + '"><i style="height:' + Math.max(3, Math.round((years[y] / max) * 100)) + '%"></i><b>' + (label ? esc(y) : "") + "</b></span>";
        }).join("") + "</div></section>";
    }
    var who = (page.who || []).map(function (p) { return person(p, esc(firetable.utilities.pluralize(p.plays, "play", "plays"))); }).filter(Boolean);
    if (who.length) h += "<section>" + head("Who plays it") + '<div class="d-people">' + who.join("") + "</div></section>";
    var next = (g.next || []).filter(function (k) { return all[k]; });
    if (next.length) {
      h += "<section>" + head("Next door") + '<p class="d-fact">Genres its songs share most</p><div class="d-chips">' +
        next.map(function (k) { return '<a class="d-chip" href="#discover/genres/' + esc(k) + '">' + esc(all[k].name) + "</a>"; }).join("") + "</div></section>";
    }
    return h;
  }

  function viewDjs() {
    var all = lib("djs");
    var h = '<div class="d-headrow"><h2>DJs</h2></div>';
    var wait = libWaiting(all, "DJ pages arrive with the weekly play history update.");
    if (wait) return h + wait;
    var list = Object.keys(all).map(function (k) { return Object.assign({ key: k }, all[k]); });
    h += '<p class="d-fact">' + esc(firetable.utilities.pluralize(list.length, "DJ", "DJs")) + " with 25 or more plays here</p>";
    h += '<div class="d-headrow">' + chips("djsort", [["plays", "Most plays"], ["firsts", "Most firsts"]].concat(fires() && fires().index ? [["fires", "Most fires"]] : [], [["since", "Newest"], ["name", "A to Z"]]), D.djSort) +
      '<input type="search" class="d-find" id="dDjFind" placeholder="Find a DJ" aria-label="Find a DJ" value="' + esc(D.djFind) + '"></div>';
    h += '<div id="dDjList" class="d-people d-people-wide">' + djRows(list) + "</div>";
    return h;
  }
  function djRows(list) {
    var fireCount = function (d) { var f = firesOf(d.djid); return f ? f.fires : 0; };
    var by = {
      plays: function (x, y) { return (y.plays || 0) - (x.plays || 0); },
      firsts: function (x, y) { return (y.firsts || 0) - (x.firsts || 0); },
      fires: function (x, y) { return fireCount(y) - fireCount(x) || (y.plays || 0) - (x.plays || 0); },
      since: function (x, y) { return (y.since || 0) - (x.since || 0); },
      name: function (x, y) { return String(x.name).localeCompare(String(y.name)); }
    }[D.djSort];
    var q = D.djFind.trim().toLowerCase();
    var shown = list.filter(function (d) { return !q || String(d.name).toLowerCase().indexOf(q) !== -1; }).sort(by);
    if (!shown.length) return emptyNote("No DJ by that name.");
    return shown.map(function (d) {
      var fact = (d.since ? "since " + new Date(d.since).getFullYear() + " · " : "") + n(d.plays) + " plays · " + n(d.firsts) + " firsts" +
        (fireCount(d) ? " · " + firetable.utilities.pluralize(fireCount(d), "fire", "fires") : "");
      return person({ djid: d.djid, name: d.name, key: d.key }, esc(fact), esc((d.g || []).join(", ")));
    }).join("");
  }

  function viewDj(key) {
    var d = lib("dj/" + key);
    var h = back("discover/djs", "DJs");
    var wait = libWaiting(d, "There's no page for this DJ. DJs get one after 25 plays here, unless they've turned it off.");
    if (wait) return h + wait;
    var dj = { uid: d.djid || uidOf(d.name), name: d.name };
    var facts = [];
    if (d.since) facts.push("here since " + new Date(d.since).getFullYear());
    facts.push(n(d.plays) + " plays");
    if (d.firsts) facts.push(n(d.firsts) + " songs brought here first");
    if (d.when) facts.push("usually " + d.when);
    if (d.cards) facts.push(firetable.utilities.pluralize(d.cards, "trading card", "trading cards"));
    var litFacts = firesOf(d.djid);
    if (litFacts && litFacts.fires) facts.push(firetable.utilities.pluralize(litFacts.fires, "fire", "fires"));
    var tab = D.djTab === "most" || D.djTab === "firstHere" ? D.djTab : ((d.firstHere || []).length ? "firstHere" : "most");
    var tracks = withType(tab === "most" ? d.most : d.firstHere);
    setList("dj", d.name + " · " + (tab === "most" ? "Most played" : "Brought here first"), tracks);
    h += '<div class="d-pagehead">' + '<span class="d-bigrobot">' + robot(dj, "160x160") + '</span><div class="d-pagetext"><h2>' + esc(d.name) + "</h2>" + factChips(facts) +
      '<div class="d-actions">' + playAllButton("dj", tab === "firstHere" ? "Play what they brought here" : "Play their favorites") + "</div></div></div>";
    var cardButton = function (c) {
      return '<button type="button" class="d-card" data-card="' + esc(c.key) + '" aria-label="' + esc("Card: " + (c.djname || "") + ", " + (c.artist || "") + " - " + (c.title || "")) + '">' +
        '<canvas width="225" height="300" id="cardMakerdj' + esc(c.key) + '"></canvas></button>';
    };
    var pickedKeys = [];
    if (d.djid) {
      var mine = D.signedIn && d.djid === ftapi.uid;
      var picked = featuredOf(d.djid); // undefined while loading
      pickedKeys = (picked || []).map(function (c) { return c.key; });
      if (picked && (picked.length || mine)) {
        h += "<section>" + '<div class="d-head"><h2>Featured cards</h2>' + (mine ? '<button type="button" class="linkButton d-pickcards">' + (picked.length ? "Change" : "Choose cards") + "</button>" : "") + "</div>" +
          (picked.length ? '<p class="d-fact">Picked by ' + esc(d.name) + "</p>" + '<div class="d-cards">' + picked.map(cardButton).join("") + "</div>"
            : '<p class="d-fact">Pick up to 6 cards from your card case to show here.</p>') + "</section>";
      }
    }
    var taste = d.taste || [];
    if (taste.length) {
      // one stacked bar: their top five genres, then everything else (2.7)
      var top = taste.filter(function (x) { return x.slug; }).slice(0, 5);
      var rest = Math.max(0, 100 - top.reduce(function (sum, x) { return sum + (x.pct || 0); }, 0));
      var parts = top.map(function (x, i) { return { g: x.g, slug: x.slug, pct: x.pct || 0, k: i }; });
      if (rest > 0) parts.push({ g: "Everything else", pct: rest, k: "rest" });
      h += "<section>" + head("Their sound") + '<div class="d-taste">' +
        '<div class="d-stack" role="img" aria-label="' + esc(parts.map(function (x) { return x.g + " " + x.pct + "%"; }).join(", ")) + '">' +
        parts.map(function (x) { return '<i class="d-sw-' + x.k + '" style="flex-grow:' + Math.max(0.5, x.pct) + '" title="' + esc(x.g + " · " + x.pct + "%") + '"></i>'; }).join("") + "</div>" +
        '<ul class="d-stacklegend">' + parts.map(function (x) {
          var name = x.slug ? '<a href="#discover/genres/' + esc(x.slug) + '">' + esc(x.g) + "</a>" : "<span>" + esc(x.g) + "</span>";
          return '<li><i class="d-sw-' + x.k + '" aria-hidden="true"></i>' + name + '<span class="d-num">' + esc(x.pct) + "%</span></li>";
        }).join("") + "</ul></div></section>";
    }
    h += "<section>" + '<div class="d-headrow">' + chips("djtab", [["firstHere", "Brought here first"], ["most", "Most played"]], tab) + "</div>" +
      (tab === "most"
        ? rankedRows(tracks, "dj", function (t) { return '<span class="d-num" title="' + esc(firetable.utilities.pluralize(t.by, "play", "plays") + " by " + d.name) + '">' + esc(firetable.utilities.pluralize(t.by, "play", "plays")) + "</span>"; })
        : datedRows(tracks, "dj")) + "</section>";
    var lit = firesOf(d.djid);
    if (lit && lit.fires) {
      var ranks = (fires().index || []).map(function (x) { return x.djid; });
      var place = ranks.indexOf(d.djid) + 1;
      var hot = withType(lit.songs || []);
      setList("djfires", d.name + " · Most fires", hot);
      h += "<section>" + head("Fires earned") + '<p class="d-fact">' + esc(firetable.utilities.pluralize(lit.fires, "fire", "fires") + " on " + firetable.utilities.pluralize(lit.plays, "play", "plays") +
          (fires().since ? " since " + new Date(fires().since).toLocaleString("en-US", { month: "short", year: "numeric" }) : "") +
          (place && ranks.length > 1 ? " · #" + place + " of " + ranks.length + " DJs" : "")) + "</p>" +
        rankedRows(hot, "djfires", function (t) {
          return fireBadge(t.fires) + (t.plays > 1 ? '<span class="d-num" title="' + esc("best play: " + firetable.utilities.pluralize(t.top, "fire", "fires")) + '">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" : "");
        }) + "</section>";
    }
    var similar = (d.similar || []).map(function (p) { return person(p, esc(p.pct + "% alike")); }).filter(Boolean);
    if (similar.length) h += "<section>" + head("Similar DJs") + '<p class="d-fact">The most songs in common</p><div class="d-people">' + similar.join("") + "</div></section>";
    // recent sets, one line a night (2.7): a set after midnight belongs to the night before
    var nightsOf = [];
    (d.sets || []).forEach(function (x) {
      var key = new Date(x.at - 6 * 3600000).toDateString();
      var last = nightsOf[nightsOf.length - 1];
      if (last && last.key === key) { last.n += x.n; last.sets++; last.at = Math.min(last.at, x.at); }
      else nightsOf.push({ key: key, at: x.at, n: x.n, sets: 1 });
    });
    if (nightsOf.length) {
      var nights = nightIndex();
      h += "<section>" + head("Recent sets") + '<div class="d-sets">' + nightsOf.map(function (x) {
        var when = new Date(x.at);
        var night = nightAt(nights, x.at);
        var day = '<span class="d-num">' + esc(when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: when.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })) + "</span>";
        var what = "<span>" + esc(firetable.utilities.pluralize(x.n, "song", "songs") + (x.sets > 1 ? " in " + x.sets + " sets" : "")) + "</span>";
        // a theme night's line opens that night's page
        return night
          ? '<a class="d-set d-setlink" href="#discover/themes/' + esc(night.id) + '">' + day + '<span class="d-settheme">' + esc(night.theme) + "</span>" + what + "</a>"
          : '<div class="d-set">' + day + "<span></span>" + what + "</div>";
      }).join("") + "</div></section>";
    }
    if (d.djid) {
      var held = (cardsOf(d.djid) || []).filter(function (c) { return pickedKeys.indexOf(c.key) === -1; });
      if (held.length) {
        h += "<section>" + head(pickedKeys.length ? "More of their cards" : "Their cards") + '<p class="d-fact">Trading cards ' + esc(d.name) + " holds" + (d.cards > held.length ? ", the latest " + held.length + " of " + d.cards : "") + "</p>" +
          '<div class="d-cards">' + held.map(cardButton).join("") + "</div></section>";
      }
    }
    return h;
  }

  // ─── One search for both sides ──────────────────────────────────────────
  // The room's own library answers at once: artists (the 5,000 most played),
  // genres, DJs, theme nights and songs already loaded here. Members can also
  // look on YouTube (Enter): each search costs the site's YouTube quota, so
  // it's for people who can add what they find.

  var fold = function (x) { return String(x || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };
  function matches(q, text) { return fold(text).indexOf(q) !== -1; }
  var yt = { q: null, rows: null };

  function viewSearch(query) {
    var q = fold(query).trim();
    var input = document.getElementById("dQ");
    if (input && document.activeElement !== input && input.value !== query) input.value = query;
    var h = '<div class="d-headrow"><h2>Search</h2></div>';
    if (q.length < 2) return h + emptyNote("Type an artist, a song, a genre or a DJ.");
    // a YouTube or SoundCloud playlist link: offer to import it (1.19)
    var plLink = D.signedIn && firetable.importer && firetable.importer.parseLink(query);
    if (plLink) {
      if (D.importFor !== query) {
        D.importFor = query;
        D.importMeta = undefined;
        firetable.importer.peek(plLink).then(function (meta) {
          if (D.importFor !== query) return;
          D.importMeta = meta;
          if (D.view === "search") renderBrowse();
        });
      }
      var m = D.importMeta;
      return h + '<section class="d-importOffer">' + (m === undefined ? emptyNote("That's a playlist. Looking it up…")
        : m ? '<p class="d-empty">' + esc("That's a playlist: " + firetable.importer.describe(m) + ".") + ' <button type="button" class="butt d-import">' + ms("playlist_add") + "<span>Import it</span></button></p>"
        : emptyNote("That's a playlist link, but it isn't public or it's gone.")) + "</section>";
    }
    var found = 0;
    var section = function (title, body, n) { found += n; return n ? "<section>" + head(title) + body + "</section>" : ""; };
    // artists
    var ai = lib("artistIndex") || {};
    var artists = Object.keys(ai).filter(function (k) { return matches(q, ai[k][0]); }).sort(function (a, b) { return ai[b][1] - ai[a][1]; }).slice(0, 8);
    h += section("Artists", '<div class="d-people">' + artists.map(function (k) {
      return '<a class="d-person" href="#discover/artist/' + esc(k) + '"><span class="d-person-text"><b>' + esc(ai[k][0]) + "</b><span>" + esc(firetable.utilities.pluralize(ai[k][1], "play", "plays")) + "</span></span></a>";
    }).join("") + "</div>", artists.length);
    // genres
    var gs = genreList().filter(function (g) { return matches(q, g.name); }).slice(0, 12);
    h += section("Genres", '<div class="d-chips">' + gs.map(function (g) { return '<a class="d-chip" href="#discover/genres/' + esc(g.slug) + '">' + esc(g.name) + "</a>"; }).join("") + "</div>", gs.length);
    // DJs
    var dall = lib("djs") || {};
    var djs = Object.keys(dall).filter(function (k) { return matches(q, dall[k].name); }).sort(function (a, b) { return (dall[b].plays || 0) - (dall[a].plays || 0); }).slice(0, 8);
    h += section("DJs", '<div class="d-people">' + djs.map(function (k) {
      return person({ djid: dall[k].djid, name: dall[k].name, key: k }, esc(firetable.utilities.pluralize(dall[k].plays, "play", "plays")));
    }).join("") + "</div>", djs.length);
    // theme nights
    var nights = nightIndex().filter(function (n) { return matches(q, n.theme); }).slice(0, 6);
    h += section("Theme nights", '<div class="d-nights">' + nights.map(nightRow).join("") + "</div>", nights.length);
    // songs already here: new releases, charts and every page opened this visit
    var seen = {};
    var songs = [];
    var pool = (((D.data.new && D.data.new.tracks) || []).map(function (t) { return Object.assign({ type: 1 }, t); }));
    Object.keys(lists).forEach(function (name) { if (name !== "search" && name !== "search-yt") pool = pool.concat(lists[name].tracks || []); });
    pool.forEach(function (t) {
      var k = (t.type || 1) + "_" + t.cid;
      if (seen[k] || !t.cid || songs.length >= 30) return;
      if (matches(q, t.t) || matches(q, t.a)) { seen[k] = true; songs.push(t); }
    });
    setList("search", "Search: " + query, songs);
    h += section("Songs", '<div class="ft-rows d-rowlist">' + songs.map(function (t, i) {
      return row(t, "search", i, { dj: djShown(t.djid, t.dj), right: t.plays ? '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" : "" });
    }).join("") + "</div>", songs.length);
    // YouTube, for members
    if (D.signedIn) {
      if (yt.q === query && yt.rows) {
        setList("search-yt", "YouTube: " + query, yt.rows);
        h += "<section>" + head("On YouTube") + (yt.rows.length ? '<div class="ft-rows d-rowlist">' + yt.rows.map(function (t, i) {
          return row(t, "search-yt", i, { right: t.plays ? '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + " here</span>" : '<span class="d-new">not played here</span>' });
        }).join("") + "</div>" : emptyNote("Nothing on YouTube for that.")) + "</section>";
      } else {
        h += '<section><button type="button" class="butt graybutt d-ytsearch">' + ms("travel_explore") + "<span>Search YouTube for “" + esc(query) + "”</span></button></section>";
      }
    }
    if (!found && !D.signedIn) h += emptyNote("Nothing in the room's library for that yet.");
    return h;
  }

  /** YouTube's results for a search, with the room's plays for each. */
  function searchYouTube(query) {
    if (typeof ytAPI !== "function") return;
    yt = { q: query, rows: null };
    renderBrowse();
    ytAPI("search", { q: query, type: "video", part: "snippet", maxResults: SEARCH_MAX_RESULTS }, function (res) {
      var rows = ((res && res.items) || []).map(function (item) {
        var cid = item.id && (item.id.videoId || item.id);
        var p = firetable.utilities.parseArtistTitle(firetable.ui.strip(firetable.utilities.youtubeTrackName(item.snippet.title, item.snippet.channelTitle, item.snippet.description)));
        return { type: MEDIA_YOUTUBE, cid: cid, a: p.artist, t: p.title };
      }).filter(function (t) { return t.cid; });
      Promise.all(rows.map(function (t) {
        return db().ref("globalTracks/1" + t.cid).once("value").then(function (s) {
          var v = s.val();
          if (!v || !v.song) return;
          return db().ref("globalSongs/" + v.song + "/plays").once("value").then(function (pl) { t.plays = pl.val() || 0; });
        }).catch(function () {});
      })).then(function () {
        if (yt.q !== query) return;
        yt.rows = rows;
        if (D.view === "search") renderBrowse();
      });
    });
  }

  // ─── Theme nights (discover/themes, from the bot) ──────────────────────

  var themeData = {};
  var themeAsked = {};
  function themes(path) {
    if (!themeAsked[path]) {
      themeAsked[path] = true;
      db().ref("discover/themes/" + path).once("value").then(function (s) { themeData[path] = s.val(); themesLoaded(); }, function (err) { quiet(err); themeData[path] = null; themesLoaded(); });
    }
    return themeData[path];
  }
  function themesLoaded() { if (D.mode === "discover") renderBrowse(); }

  // Fires earned (discover/fires, rebuilt daily by the bot): each DJ's fires
  // and most-fired songs; undefined while it loads, null when there are none
  var fireData, fireAsked = false;
  function fires() {
    if (!fireAsked) {
      fireAsked = true;
      db().ref("discover/fires").once("value").then(function (s) { fireData = s.val(); if (D.mode === "discover" && D.view === "djs") renderBrowse(); },
        function (err) { quiet(err); fireData = null; });
    }
    return fireData;
  }
  function firesOf(djid) {
    var f = fires();
    return (f && f.djs && djid && f.djs[djid]) || null;
  }
  function fireBadge(n, title) {
    return n ? '<span class="d-fires" title="' + esc(title || firetable.utilities.pluralize(n, "fire", "fires")) + '">' + ms("local_fire_department") + '<span class="d-num">' + esc(n) + "</span></span>" : "";
  }
  /** Every theme night, newest first ([] while it loads or before there are any). */
  function nightIndex() {
    var all = themes("index") || {};
    return Object.keys(all).map(function (k) { return Object.assign({ id: k }, all[k]); }).sort(function (a, b) { return b.from - a.from; });
  }
  function nightAt(nights, at) {
    for (var i = 0; i < nights.length; i++) if (at >= nights[i].from - 3600000 && at <= nights[i].to + 3600000) return nights[i];
    return null;
  }
  function nightDate(n, withYear) {
    var d = new Date(n.from);
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: withYear || d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  }
  function nightRow(n) {
    return '<a class="d-night" href="#discover/themes/' + esc(n.id) + '"><b>' + esc(n.theme) + "</b><span>" + esc(nightDate(n) + " · " + firetable.utilities.pluralize(n.n, "song", "songs") +
      ((n.djs || []).length ? " · " + n.djs.join(", ") : "")) + "</span></a>";
  }

  function viewNights() {
    var all = themes("index");
    var h = '<div class="d-headrow"><h2>Theme nights</h2></div>';
    if (all === undefined) return h + loading();
    var list = nightIndex();
    if (!list.length) return h + emptyNote("The room's theme is saved with every song from now on. Each night played under a theme shows up here, ready to play again.");
    return h + '<p class="d-fact">Every night the room played under a theme, newest first</p><div class="d-nights">' + list.map(nightRow).join("") + "</div>";
  }

  function viewNight(id) {
    var n = themes("night/" + id);
    var h = back("discover/themes", "Theme nights");
    var wait = libWaiting(n, "There's no theme night here.");
    if (wait) return h + wait;
    var rows = withType(n.rows);
    setList("night", n.theme + " · " + nightDate(n), rows);
    var time = function (ms) { return new Date(ms).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase(); };
    var fires = rows.reduce(function (a, t) { return a + (t.f || 0); }, 0);
    h += '<div class="d-pagehead">' + mosaic(rows.slice(0, 4).map(function (t) { return t.type + "_" + t.cid; }), true) +
      '<div class="d-pagetext"><h2>' + esc(n.theme) + '</h2><p class="d-fact">' + esc(nightDate(n, true) + " · " + time(n.from) + " to " + time(n.to) + " · " + firetable.utilities.pluralize(n.n, "song", "songs") +
        (fires ? " · " + firetable.utilities.pluralize(fires, "fire", "fires") : "")) + "</p>" +
      ((n.djs || []).length ? '<p class="d-fact">' + n.djs.map(function (name) { return nameLink({ uid: name, name: name }); }).join(", ") + "</p>" : "") +
      '<div class="d-actions">' + playAllButton("night", "Play the night") + "</div></div></div>";
    h += '<section><div class="ft-rows d-rowlist">' + rows.map(function (t, i) {
      return row(t, "night", i, { stamp: time(t.w), dj: djShown(t.djid, t.dj),
        right: t.f ? '<span class="d-fires" title="' + esc(firetable.utilities.pluralize(t.f, "fire", "fires")) + '">' + ms("local_fire_department") + '<span class="d-num">' + esc(t.f) + "</span></span>" : "" });
    }).join("") + "</div></section>";
    return h;
  }

  // ─── A DJ's trading cards (cards/, drawn by js/cards.js) ────────────────

  var cardData = {};
  function cardsOf(uid) {
    if (!(uid in cardData)) {
      cardData[uid] = undefined;
      db().ref("cards").orderByChild("owner").equalTo(uid).limitToLast(12).once("value").then(function (s) {
        var out = [];
        s.forEach(function (c) { out.push(Object.assign({ key: c.key }, c.val())); });
        cardData[uid] = out.reverse();
        if (D.mode === "discover" && D.view === "djs") renderBrowse();
      }, function (err) { quiet(err); cardData[uid] = []; });
    }
    return cardData[uid];
  }
  // The cards a DJ picked for their page (users/<uid>/featured), still theirs
  var featuredData = {};
  var featuredAsk = {}; // uid -> the lookup in flight, so a stale answer is dropped
  function featuredOf(uid) {
    if (!(uid in featuredData)) {
      featuredData[uid] = undefined;
      var ask = featuredAsk[uid] = {};
      var current = function () { return featuredAsk[uid] === ask; };
      db().ref("users/" + uid + "/featured").once("value").then(function (s) {
        var v = s.val() || {};
        var ids = Object.keys(v).sort().map(function (k) { return v[k]; }).filter(function (id) { return typeof id === "string" && id; });
        return Promise.all(ids.map(function (id) {
          return db().ref("cards/" + id).once("value").then(function (c) { return c.val() ? Object.assign({ key: id }, c.val()) : null; }, function () { return null; });
        }));
      }).then(function (cards) {
        if (!current()) return; // forgotten (picks changed) while this was loading
        featuredData[uid] = cards.filter(function (c) { return c && c.owner === uid && c.djname; });
        if (D.mode === "discover" && D.view === "djs") renderBrowse();
      }, function (err) { quiet(err); if (current()) featuredData[uid] = []; });
    }
    return featuredData[uid];
  }
  function drawCards() {
    if (!firetable.actions.displayCard) return;
    document.querySelectorAll("#dBrowse .d-card[data-card]").forEach(function (b) {
      var key = b.getAttribute("data-card");
      var all = [];
      [cardData, featuredData].forEach(function (src) { Object.keys(src).forEach(function (u) { (src[u] || []).forEach(function (c) { all.push(c); }); }); });
      var c = all.find(function (x) { return x.key === key; });
      if (c) firetable.actions.displayCard(JSON.parse(JSON.stringify(c)), "dj" + key);
    });
  }

  /** Save a whole list: a new playlist for members, the crate for visitors. */
  function saveAll(listName) {
    var list = lists[listName];
    if (!list || !list.tracks.length) return;
    var tracks = list.tracks.slice();
    if (!D.signedIn) {
      var c = crate();
      var have = {};
      c.forEach(function (t) { have[t.type + "_" + t.cid] = true; });
      var added = 0;
      tracks.forEach(function (t) {
        if (have[(t.type || 1) + "_" + t.cid]) return;
        c.push({ type: Number(t.type || 1), cid: t.cid, a: t.a, t: t.t, img: t.img || null, url: t.url || null });
        added++;
      });
      setCrate(c);
      renderSide();
      firetable.ui.toast(added ? "Saved " + firetable.utilities.pluralize(added, "song", "songs") + " to your crate" : "They're all in your crate already", added ? "success" : null);
      return;
    }
    var name = String(list.label || "Discover").slice(0, 60);
    var id = ftapi.actions.createList(name);
    var ref = ftapi.lookup.listRef(id);
    var updates = {};
    tracks.forEach(function (t) {
      var track = { type: Number(t.type || 1), cid: t.cid, name: (t.a ? t.a + " - " : "") + t.t, from: "discover" };
      if (t.img) track.img = t.img;
      if (t.url) track.url = t.url;
      updates[ref.push().key] = track;
      firetable.saved.session[firetable.saved.key(track.type, track.cid)] = name;
    });
    ref.update(updates).then(function () {
      firetable.allPlaylists = firetable.allPlaylists || {};
      firetable.allPlaylists[id] = { name: name, list: {} };
      firetable.ui.markSaved();
      firetable.ui.toast("Saved " + firetable.utilities.pluralize(tracks.length, "song", "songs") + " as the playlist " + name, "success");
    }, function () { firetable.ui.toast("Couldn't save those songs. Try again.", "error"); });
  }

  function viewArtist(slug) {
    var a = lib("artist/" + slug);
    if (a === undefined) return loading();
    if (!a) {
      return '<div class="d-headrow"><h2>Artist</h2></div>' + emptyNote("There's no page for this artist yet. Artists get one after 5 plays here, with the weekly play history update.");
    }
    var tracks = withType(a.rows);
    setList("artist", a.name, tracks);
    var facts = [firetable.utilities.pluralize(a.songs, "song", "songs") + " played here", n(a.plays) + " plays"];
    var firstDj = a.firstDj ? djShown(a.firstDjid, a.firstDj) : null;
    var h = '<div class="d-pagehead">' + mosaic(tracks.slice(0, 4).map(function (t) { return t.type + "_" + t.cid; }), true) +
      '<div class="d-pagetext"><h2>' + esc(a.name) + "</h2>" + factChips(facts) +
      (a.first ? '<p class="d-fact">First played here ' + esc(firetable.utilities.shortDate(a.first)) + (firstDj ? " by " + nameLink(firstDj) : "") + "</p>" : "") +
      '<div class="d-actions">' + playAllButton("artist", "Play all") + "</div></div></div>";
    h += "<section>" + head("Most played here") + rankedRows(tracks, "artist") + "</section>";
    var who = (a.djs || []).map(function (p) { return person(p, esc(firetable.utilities.pluralize(p.plays, "play", "plays"))); }).filter(Boolean);
    if (who.length) h += "<section>" + head("Who plays them") + '<div class="d-people">' + who.join("") + "</div></section>";
    return h;
  }

  function viewYears() {
    var all = lib("years");
    var h = '<div class="d-headrow"><h2>Years</h2></div>';
    var wait = libWaiting(all, "Years arrive with the weekly play history update.");
    if (wait) return h + wait;
    var ys = Object.keys(all).sort().reverse();
    h += '<p class="d-fact">The room\'s playlist of each year\'s releases, and how much of it was played here</p>';
    h += '<div class="d-yearlist">' + ys.map(function (y) {
      var v = all[y] || {};
      var pct = v.songs ? Math.round((v.played / v.songs) * 100) : 0;
      return '<a class="d-yearrow' + (v.covers && v.covers.length ? " has-covers" : "") + '" href="#discover/years/' + esc(y) + '">' +
        (v.covers && v.covers.length ? mosaic(v.covers) : "") + '<b class="d-num">' + esc(y) + "</b>" +
        '<span class="d-yeartext"><span>' + esc(n(v.songs)) + " songs released in " + esc(y) + " · " + esc(n(v.played)) + " played here · " + esc(n(v.plays)) + " plays</span>" +
        (v.genre ? "<span>mostly " + esc(v.genre) + "</span>" : "") + "</span>" +
        '<span class="d-bar" title="' + esc(pct + "% played here") + '"><i style="width:' + pct + '%"></i></span></a>';
    }).join("") + "</div>";
    return h;
  }

  function viewYear(y) {
    var all = lib("years");
    var page = lib("year/" + y);
    var h = back("discover/years", "Years");
    if (page === undefined || all === undefined) return h + loading();
    if (!page) return h + emptyNote("There's no page for " + y + " yet. " + LIB_LATER);
    var v = (all || {})[y] || {};
    var top = withType(page.top), extra = withType(page.more);
    setList("year", y + " · Most played", top);
    setList("year-more", y + " · Not played here yet", extra);
    h += '<div class="d-pagehead">' + mosaic(top.slice(0, 4).map(function (t) { return t.type + "_" + t.cid; }), true) +
      '<div class="d-pagetext"><h2 class="d-num">' + esc(y) + "</h2>" +
      factChips([n(v.songs) + " songs released in " + y, n(v.played) + " played here"].concat(v.plays ? [n(v.plays) + " plays"] : [], v.genre ? ["mostly " + v.genre] : [])) +
      '<div class="d-actions">' + playAllButton("year", "Play the year") + "</div></div></div>";
    h += "<section>" + head("Most played here") + rankedRows(top, "year") + "</section>";
    if (extra.length) {
      h += "<section>" + head("Not played here yet") + '<p class="d-fact">From ' + esc(y) + "'s playlist. Play one for the room.</p>" +
        '<div class="ft-cards">' + extra.map(function (t, i) { return card(t, "year-more", i, { tag: "Be the first", who: "Nobody has played it yet" }); }).join("") + "</div></section>";
    }
    return h;
  }

  // ─── Tempo pages: the songs played here at one BPM ──────────────────────
  // The bot keeps each track's tempo in bpm/<type>_<cid> (from Deezer, or
  // set with !bpm), so a tempo's page asks bpm/ for the tempos around it and
  // looks the songs up in the play history (globalTracks, globalSongs).
  // "128 BPM" is every tempo that rounds to 128; Close by is two either side.

  var BPM_MIN = 40, BPM_MAX = 250, BPM_NEAR = 2, BPM_FRESH = 5 * 60000;
  var tempoPages = {};  // n -> undefined while it loads, null if it can't, else {at, near}
  var tempoAsked = {};  // n -> when it was asked
  var tempoSongs = {};  // "type_cid" -> Promise of the song, or null

  function isTempo(x) { return x === Math.round(x) && x >= BPM_MIN && x <= BPM_MAX; }
  /** A song's tempo as a tag that opens the songs played here at that tempo. */
  function tempoTag(bpm) {
    if (!isTempo(bpm)) return '<span class="d-tag">' + esc(bpm) + " BPM</span>";
    return '<a class="d-tag d-bpmtag" href="#discover/bpm/' + bpm + '" title="' + esc("Songs played here at " + bpm + " BPM") + '">' + esc(bpm) + " BPM</a>";
  }
  /** The history's song for a tempo's key, as a library row: {type, cid, t, a, plays, first, dj, song}. */
  function tempoSong(key) {
    if (!tempoSongs[key]) {
      var cut = key.indexOf("_");
      var type = Number(key.slice(0, cut)) || 1, cid = key.slice(cut + 1);
      tempoSongs[key] = db().ref("globalTracks/" + type + cid).once("value").then(function (s) {
        var u = s.val();
        if (!u || !u.title) return null;
        var t = { type: type, cid: cid, t: u.title, a: u.artist || "", plays: Number(u.plays) || 0, first: u.first_play_date || null, dj: u.first_play_dj || null, song: u.song || null };
        if (!u.song) return t;
        return db().ref("globalSongs/" + u.song).once("value").then(function (g) {
          var v = g.val() || {};
          if (v.plays) t.plays = Number(v.plays) || t.plays;
          if (v.first_play_date) { t.first = v.first_play_date; t.dj = v.first_play_dj || t.dj; }
          return t;
        }, function () { return t; });
      }).catch(function () { return null; });
    }
    return tempoSongs[key];
  }
  /** bpm/<n>'s page: undefined while it loads (the last one stays up while it's asked again). */
  function tempoPage(n) {
    if (!tempoAsked[n] || Date.now() - tempoAsked[n] > BPM_FRESH) {
      tempoAsked[n] = Date.now();
      db().ref("bpm").orderByChild("bpm").startAt(n - BPM_NEAR - 0.5).endAt(n + BPM_NEAR + 0.49).once("value").then(function (s) {
        var found = [];
        s.forEach(function (c) {
          var b = Number((c.val() || {}).bpm);
          if (b >= BPM_MIN && b <= BPM_MAX) found.push({ key: c.key, bpm: b });
        });
        return Promise.all(found.map(function (f) {
          return tempoSong(f.key).then(function (t) { return t && Object.assign({}, t, { bpm: f.bpm }); });
        })).then(function (songs) {
          // one row per song: its uploads share the history's song
          var seen = {};
          songs = songs.filter(Boolean).sort(function (x, y) { return (y.plays - x.plays) || Math.abs(x.bpm - n) - Math.abs(y.bpm - n); })
            .filter(function (t) { var k = t.song || t.type + "_" + t.cid; if (seen[k]) return false; seen[k] = true; return true; });
          tempoLoaded(n, {
            at: songs.filter(function (t) { return Math.round(t.bpm) === n; }),
            near: songs.filter(function (t) { return Math.round(t.bpm) !== n; })
              .sort(function (x, y) { return (Math.abs(x.bpm - n) - Math.abs(y.bpm - n)) || (y.plays - x.plays); }).slice(0, 50)
          });
        });
      }).catch(function (err) { quiet(err); tempoLoaded(n, tempoPages[n] || null); });
    }
    return tempoPages[n];
  }
  function tempoLoaded(n, val) {
    tempoPages[n] = val;
    if (D.mode === "discover" && D.view === "bpm" && Number(D.sub) === n) renderBrowse();
  }
  function tempoLink(n, label) {
    return isTempo(n) ? '<a href="#discover/bpm/' + n + '">' + esc(label) + "</a>" : "";
  }

  function viewTempo(bpm) {
    var page = tempoPage(bpm);
    var title = bpm + " BPM";
    var step = function (to, dir, label) {
      return isTempo(to) ? '<a class="butt graybutt iconbutt" href="#discover/bpm/' + to + '" title="' + esc(label + ": " + to + " BPM") + '" aria-label="' + esc(label + ": " + to + " BPM") + '">' + ms(dir) + "</a>"
        : '<button type="button" class="butt graybutt iconbutt" disabled aria-label="' + esc(label) + '">' + ms(dir) + "</button>";
    };
    var h = '<div class="d-headrow">' + step(bpm - 1, "chevron_left", "Slower") + step(bpm + 1, "chevron_right", "Faster") + '<p class="d-fact">Songs by tempo, from Deezer or set in chat with !bpm</p></div>';
    if (page === undefined) return h + loading();
    if (page === null) return h + emptyNote("Tempos can't be looked up right now. Try again in a moment.");
    var at = page.at, near = page.near;
    setList("bpm", title, at);
    setList("bpm-near", "Close to " + title, near);
    var plays = at.reduce(function (sum, t) { return sum + (t.plays || 0); }, 0);
    var feel = [tempoLink(bpm / 2, "Half time: " + bpm / 2 + " BPM"), tempoLink(bpm * 2, "Double time: " + bpm * 2 + " BPM")].filter(Boolean);
    h += '<div class="d-pagehead">' + mosaic(at.concat(near).slice(0, 4).map(function (t) { return t.type + "_" + t.cid; }), true) +
      '<div class="d-pagetext"><h2>' + esc(title) + '</h2><p class="d-fact">' + esc(at.length ? firetable.utilities.pluralize(at.length, "song", "songs") + " played here · " + n(plays) + " plays" : "No songs played here at this tempo yet") + "</p>" +
      (feel.length ? '<p class="d-fact">' + feel.join(" · ") + "</p>" : "") +
      (at.length ? '<div class="d-actions">' + playAllButton("bpm", "Play all") + "</div>" : "") + "</div></div>";
    h += "<section>" + head("Most played at " + title) +
      (at.length ? rankedRows(at, "bpm") : emptyNote("A song's tempo comes from Deezer the first time it plays here. The DJ or a mod can set it in chat with !bpm " + bpm + ".")) + "</section>";
    if (near.length) {
      h += "<section>" + head("Close by") + '<p class="d-fact">' + esc("Within " + BPM_NEAR + " BPM, closest first") + "</p>" +
        '<div class="ft-rows d-rowlist">' + near.map(function (t, i) {
          return row(t, "bpm-near", i, { stamp: String(Math.round(t.bpm)), dj: djShown(t.djid, t.dj), right: '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" });
        }).join("") + "</div></section>";
    }
    return h;
  }

  function renderRail() {
    document.querySelectorAll("#dNav [data-view]").forEach(function (b) {
      var on = b.getAttribute("data-view") === D.view;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    renderTabs();
  }

  // ─── The bottom tab bar, on phones (4.1) ─────────────────────────────────
  // Home (Discover's Home) · Discover (search and the list of its pages) ·
  // Live (the stage with Chat, Recent, Fresh, Cards, People) · Library (the
  // playlists, full screen) · You (the account menu, or join / log in). Which
  // tab is lit comes from where you are, so it never disagrees with the page;
  // under 640px it stands in for #modeTabs, Discover's row of pages and Live's
  // Playlists tab, which stay in the page for wider screens.

  var NAV_TABS = [
    { id: "home", label: "Home", icon: "home" },
    { id: "discover", label: "Discover", icon: "explore" },
    { id: "live", label: "Live", icon: "sensors" },
    { id: "library", label: "Library", icon: "library_music" },
    { id: "you", label: "You", icon: "account_circle" }
  ];
  var lastLiveTab = "mmchat";

  function tabsHtml() {
    return '<nav id="nav-tabs" aria-label="Sections">' + NAV_TABS.map(function (t) {
      return '<button type="button" class="nt-tab" data-tab="' + t.id + '"' + (t.id === "you" ? ' aria-haspopup="menu"' : "") + ">" +
        ms(t.icon) + "<span>" + esc(t.label) + "</span>" + (t.id === "live" ? '<i class="d-dot nt-dot" aria-hidden="true"></i>' : "") + "</button>";
    }).join("") + "</nav>";
  }

  /** The tab that's lit: where you are now. */
  function navTab() {
    if (D.mode === "discover") return D.browse || D.view !== "home" ? "discover" : "home";
    var n = firetable.nav;
    return n && n.mobileSection === "view" && n.view === "playlists" ? "library" : "live";
  }

  function renderTabs() {
    var tab = navTab();
    document.body.classList.toggle("nt-browse", D.mode === "discover" && !!D.browse);
    document.body.classList.toggle("nt-library", tab === "library");
    document.querySelectorAll("#nav-tabs .nt-tab").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    var n = firetable.nav;
    if (n && D.mode === "live" && tab === "live") lastLiveTab = n.mobileSection === "chat" ? "mmchat" : n.mobileSection === "people" ? "mmusrs" : n._viewTabMap[n.view] || "mmchat";
  }

  function goTab(tab) {
    var n = firetable.nav;
    var here = navTab();
    closeMenu();
    if (tab === "you") {
      var who = document.getElementById(D.signedIn ? "loggedInUser" : "nav-signin");
      if (who) who.click();
      return;
    }
    if (tab === "home") {
      D.browse = false;
      if (D.mode === "discover") setView("home");
      else { D.view = "home"; D.sub = null; setMode("discover", { remember: true }); }
    } else if (tab === "discover") {
      // the tab you're on goes back to its list; from elsewhere, back to the page you left
      D.browse = here === "discover" || D.view === "home";
      if (D.mode !== "discover") setMode("discover", { remember: true });
      renderTabs();
      var b = document.getElementById(D.browse ? "dRail" : "dBrowse");
      if (b) b.scrollTop = 0;
    } else if (tab === "live") {
      if (D.mode !== "live") setMode("live", { remember: true });
      if (here === "library" || navTab() === "library") n.setMobileTab(lastLiveTab);
    } else if (tab === "library") {
      if (D.mode !== "live") setMode("live", { remember: true });
      if (navTab() !== "library") n.setView("playlists");
    }
    renderTabs();
  }

  // ─── The room ────────────────────────────────────────────────────────────

  function peopleHere() {
    var n = 0;
    for (var uid in ftapi.users || {}) {
      if (ftapi.users.hasOwnProperty(uid) && !ftapi.users[uid].hostbot) n++;
    }
    return n;
  }
  // ─── The right column ───────────────────────────────────────────────────
  // The player itself is the bar along the bottom (below), and the song in
  // full is the full-screen player it opens. The right column is for what
  // you work with beside it: Playlists (members: switch, filter, reorder,
  // play; visitors: the crate) and Chat (members: the room's own chat;
  // visitors: the chat to read).

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
        out.work = v.work || null;
        if (!v.work) return null;
        return db().ref("globalWorks/" + v.work + "/versions").once("value").then(function (w) { out.versions = w.val() || 1; });
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
    var tab = function (id, label) { return '<button type="button" role="tab" class="tab' + (D.sideTab === id ? " on" : "") + '" data-sidetab="' + id + '" aria-selected="' + (D.sideTab === id) + '">' + label + "</button>"; };
    var unread = D.signedIn && D.unread ? ' <span class="d-unread" aria-label="' + D.unread + ' new">' + (D.unread > 99 ? "99+" : D.unread) + "</span>" : "";
    // the chat is for members only
    return '<div class="tabs d-sidetabs" role="tablist" aria-label="With the player">' + tab("list", esc(listLabel)) + (D.signedIn ? tab("chat", "Chat" + unread) : "") +
      '<button type="button" class="butt graybutt iconbutt d-sheetclose" title="Close" aria-label="Close">' + ms("expand_more") + "</button></div>";
  }

  // ─── Live chat, for members in Discover ─────────────────────────────────
  // The room's own chat (#actualChat) moves into the right panel's Chat tab
  // and goes back when they leave it: one chat, with everything it does.
  var chatHome = null;
  function chatIn(host) {
    var chat = document.getElementById("actualChat");
    if (!chat || !host || host.contains(chat)) return;
    if (!chatHome) {
      chatHome = document.createComment("chat");
      chat.parentNode.insertBefore(chatHome, chat);
    }
    host.appendChild(chat);
    document.body.classList.add("d-chat-here");
    if (firetable.utilities.scrollToBottom) firetable.utilities.scrollToBottom();
  }
  function chatBack() {
    var chat = document.getElementById("actualChat");
    document.body.classList.remove("d-chat-here");
    if (!chat || !chatHome || !chatHome.parentNode) return;
    chatHome.parentNode.insertBefore(chat, chatHome);
    chatHome.parentNode.removeChild(chatHome);
    chatHome = null;
    if (firetable.utilities.scrollToBottom) firetable.utilities.scrollToBottom();
  }

  function renderSide() {
    var el = document.getElementById("dSide");
    if (!el) return;
    if (D.sideTab !== "list" && !(D.sideTab === "chat" && D.signedIn)) D.sideTab = "list";
    // the chat's tab: only its tabs change, so the chat keeps its place
    if (D.sideTab === "chat" && D.signedIn && el.querySelector(".d-chathost #actualChat")) {
      var bar = el.querySelector(".d-sidetabs");
      if (bar) bar.outerHTML = sideTabs();
      renderBar();
      return;
    }
    var old = el.querySelector(".d-sidebody");
    var scroll = old && old.getAttribute("data-tab") === D.sideTab ? old.scrollTop : 0;
    var filterFocused = document.activeElement && document.activeElement.id === "pv-plfilter";
    chatBack();
    if (D.sideTab === "chat" && D.signedIn) {
      D.unread = 0;
      el.innerHTML = '<div class="d-sidebody d-sidechat" data-tab="chat">' + sideTabs() + '<div class="d-chathost"></div></div>';
      chatIn(el.querySelector(".d-chathost"));
      renderBar();
      return;
    }
    var body = D.signedIn ? playlistPanel() : cratePanel();
    el.innerHTML = '<div class="d-sidebody" data-tab="' + D.sideTab + '">' + sideTabs() + body + "</div>";
    if (scroll) el.querySelector(".d-sidebody").scrollTop = scroll;
    if (D.sideTab === "list" && D.signedIn) listReady(filterFocused);
    renderBar();
    renderFull();
    firetable.ui.markSaved();
  }

  /** After play, pause or next: the list keeps its scroll and filter, only the marks move. */
  function refreshSide() {
    if (D.sideTab === "list") markPlaying();
    renderBar();
    renderFull();
  }
  function markPlaying() {
    document.querySelectorAll("#dSide .pl-row[data-list], #dSide .d-listrow[data-list]").forEach(function (r) {
      var on = isPlaying(r.getAttribute("data-list"), Number(r.getAttribute("data-i")));
      r.classList.toggle("is-playing", on);
      var b = r.querySelector(".d-mini-row");
      if (b) b.setAttribute("aria-current", on ? "true" : "false");
    });
  }

  function toRoomNote(t, saved) {
    if (!D.signedIn) return esc(saved ? "In your crate. " : "") + "Join and your songs play for the room when it's your turn on the decks.";
    if (P.inRoom && String(P.inRoom.cid) === String(t.cid)) {
      var d = deckState();
      return esc("First in " + firetable.utilities.listName(P.inRoom.list) + ". ") +
        (d.on ? "You're on the decks: it's your next song." : d.waiting ? "You're #" + d.place + " in line for the decks." : '<button type="button" class="linkButton d-joinwait">' + (d.open ? "Hop on the decks" : "Join the waitlist") + "</button> to play it.") +
        ' <button type="button" class="linkButton d-toroom-undo">Undo</button>';
    }
    return esc(saved ? "Saved in " + saved + ". " : "") + "Play it in the room puts it first in your DJ playlist, " + esc(firetable.utilities.listName(djList())) + ".";
  }

  /** Who's on the decks: the DJ playing, then the order after them. */
  function deckList() {
    var table = firetable.tableData;
    var out = [];
    for (var k in table || {}) {
      if (Object.prototype.hasOwnProperty.call(table, k) && table[k] && table[k].id) out.push({ id: table[k].id, name: table[k].name });
    }
    var s = firetable.song;
    var at = -1;
    for (var i = 0; i < out.length; i++) if (s && out[i].id === s.djid) at = i;
    if (at < 0) at = Math.min(Math.max(0, Number(firetable.playdex) || 0), Math.max(0, out.length - 1));
    return out.slice(at).concat(out.slice(0, at));
  }
  /** The history's facts about a song, in the full player: tags, plays, who found it first. */
  function fillDetails(t, live) {
    if (!t) return;
    loadDetails(t).then(function (d) {
      var now = fullTrack();
      if (!F.open || !now || String(now.cid) !== String(t.cid)) return;
      d = Object.assign({}, d, liveFacts(t));
      var tags = (d.genres || []).slice(0, 2).map(function (g) { return '<a class="d-tag" href="#discover/genres/' + esc(genreSlug(g)) + '">' + esc(g) + "</a>"; });
      if (t.rel) tags.push('<span class="d-tag d-numtag">' + esc(t.rel.slice(0, 4)) + "</span>");
      tags.push('<span class="d-tag">' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + "</span>");
      if (d.bpm) tags.push(tempoTag(d.bpm));
      var tagEl = document.getElementById("pv-ftags");
      if (tagEl) tagEl.innerHTML = tags.join("");
      var lines = [];
      var plays = d.plays || t.plays;
      // the history's answer, or what the list that's playing already knew
      var firstAt = d.first || t.first;
      var firstName = d.first ? d.firstDj : t.dj;
      var firstUid = d.first ? null : t.djid;
      var first = firstAt ? djShown(firstUid, firstName) : null;
      if (firstAt) lines.push((first ? robotLink(first) : "") + "<span>" + (first ? nameLink(first) + " first played it here " : "First played here ") + esc(firetable.utilities.shortDate(firstAt)) + "</span>");
      if (plays) {
        var last = d.last && d.last !== firstAt ? djShown(null, d.lastDj) : null;
        lines.push("<span><b>" + esc(firetable.utilities.pluralize(plays, "play", "plays")) + "</b>" + (plays === 1 ? " so far" : "") +
          (d.last && d.last !== firstAt ? " · last " + esc(firetable.utilities.shortDate(d.last)) + (last ? " by " + nameLink(last) : "") : "") + "</span>");
      }
      if (d.versions > 1) lines.push("<span>" + esc(d.versions) + " versions of this song have played here</span>");
      var rising = ((lib("rising") || {}).rows || []).filter(function (r) { return String(r.cid) === String(t.cid); })[0];
      if (rising) lines.push('<span class="d-rising">▲ Rising: ' + esc(firetable.utilities.pluralize(rising.recent, "play", "plays")) + " in the last 4 weeks</span>");
      if (!firstAt && !plays) lines.push(live ? "<span>Its first play here: you're hearing it now.</span>" : '<span class="d-tag d-befirst">Be the first</span><span>Nobody has played this live yet.</span>');
      var histEl = document.getElementById("pv-fhist");
      if (histEl) histEl.innerHTML = lines.map(function (l) { return "<p>" + l + "</p>"; }).join("");
    });
  }

  /**
   * The bot's facts about the room's song (tagUpdate, rewritten when a mod
   * fixes its tags): fresher than the history Discover reads, so they win.
   */
  function liveFacts(t) {
    var u = firetable.tagUpdate;
    var a = u && u.adamData;
    if (!a || String(u.cid) !== String(t.cid)) return {};
    var out = {};
    if (a.playcount > 0) out.plays = a.playcount;
    if (a.first_play) { out.first = a.first_play; out.firstDj = a.first_play_dj; }
    if (a.last_play) { out.last = a.last_play; out.lastDj = a.last_play_dj; }
    return out;
  }

  /** A mod fixed the room song's tags (room.js has already corrected firetable.song). */
  function tagsFixed(data) {
    var s = firetable.song;
    if (!data || !s || String(s.cid) !== String(data.cid)) return;
    delete details[s.type + "_" + s.cid]; // its history may now be another song's
    var live = liveTrack();
    // the same song playing from Discover takes the new tags too
    if (live && P.track && String(P.track.cid) === String(live.cid) && Number(P.track.type || 1) === live.type) {
      P.track.t = live.t;
      P.track.a = live.a;
      if (discoverActive()) mediaSession(P.track);
    }
    renderFull(true);
    if (D.src === "live" && live) mediaSession(live, true);
    renderBar();
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
    setList("crate", "Your crate", c);
    var rows = c.map(function (t, i) {
      return '<li class="d-listrow pl-row' + (isPlaying("crate", i) ? " is-playing" : "") + '" data-list="crate" data-i="' + i + '"><span class="d-n">' + (i + 1) + "</span>" +
        '<button type="button" class="d-mini-row" data-list="crate" data-i="' + i + '" aria-label="Play ' + esc(t.t) + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(t)) + ')"></span>' +
        '<span class="d-mini-text"><b>' + esc(t.t) + "</b><span>" + esc(t.a) + "</span></span></button>" +
        '<span class="pl-acts">' +
        (i ? '<button type="button" class="row-icon material-symbols-outlined pl-cratetop" data-i="' + i + '" title="Move to the top" aria-label="Move ' + esc(t.t) + ' to the top">vertical_align_top</button>' : "") +
        '<button type="button" class="row-icon material-symbols-outlined d-unsave" data-i="' + i + '" title="Remove" aria-label="Remove ' + esc(t.t) + ' from your crate">close</button></span></li>';
    }).join("");
    return '<div class="d-panel d-listpanel">' +
      (c.length ? '<div class="d-listhead"><b>Your crate</b><span>' + esc(firetable.utilities.pluralize(c.length, "song", "songs")) + " · kept in this browser</span></div>" +
        '<div class="pl-tools"><button type="button" class="butt darkbutt small d-playall" data-list="crate">' + ms("play_arrow", true) + "<span>Play</span></button>" +
        '<button type="button" class="butt graybutt small pl-shuffle" data-list="crate">' + ms("shuffle") + "<span>Shuffle</span></button></div>" +
        '<ol class="pl-rows">' + rows + "</ol>"
        : '<p class="d-fact">Tap ' + ms("playlist_add") + " on any song, or Save in the player, to keep it here. No account needed.</p>") +
      '<p class="d-fact">Join and this crate becomes your first playlist, ready to play for the room.</p>' +
      joinButtons() + "</div>";
  }

  function joinButtons() {
    var google = firetable.utilities.signInProviders().indexOf("google") !== -1;
    var g = document.querySelector('#oauthBox .oauthBttn[data-provider="google"] svg');
    return '<div class="d-join">' +
      (google ? '<button type="button" class="butt oauthBttn d-google">' + (g ? g.outerHTML : "") + "Continue with Google</button>" : "") +
      '<button type="button" class="butt darkbutt d-createaccount">Create account</button>' +
      '<p class="d-fact d-center">Already a member? <button type="button" class="linkButton d-login">Log in</button></p></div>';
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
        var track = { type: t.type, cid: t.cid, name: (t.a ? t.a + " - " : "") + t.t, from: "discover" };
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
  // The playlist open in Live's Playlists (one list on screen across the
  // site): switch lists, pick the one you DJ from, filter, drag to reorder,
  // Top / Bottom / Remove with Undo, and play it here. Everything goes
  // through the same ftapi actions Live uses.

  var PL_SHOWN = 300;
  function djList() {
    var v = $("#djlistpicker").val();
    var me = ftapi.users && ftapi.users[ftapi.uid];
    return String(v || (me && me.selectedList) || "0");
  }
  function viewList() { return String(firetable.viewListID || $("#listpicker").val() || "0"); }
  function queueTracks() {
    var queue = ftapi.queue || {};
    return Object.keys(queue).sort(ftapi.utilities.compareKeys).map(function (k) {
      var q = queue[k] || {};
      var parts = String(q.name || "").split(" - ");
      var a = parts.length > 1 ? parts.shift() : "";
      return { key: k, type: q.type || 1, cid: q.cid, a: a, t: parts.join(" - ") || q.name, img: q.img, url: q.url, flagged: !!q.flagged };
    }).filter(function (t) { return t.cid != null; });
  }

  function playlistPanel() {
    var listID = viewList();
    var name = firetable.utilities.listName(listID);
    var tracks = queueTracks();
    var isDj = listID === djList();
    setList("playlist", name, tracks);
    var opts = Array.prototype.map.call(document.querySelectorAll("#listpicker option"), function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === listID ? " selected" : "") + ">" + esc(o.textContent) + (o.value === djList() ? " · DJ" : "") + "</option>";
    }).join("") || '<option value="0">Default Playlist</option>';
    var shown = D.plAll ? tracks : tracks.slice(0, PL_SHOWN);
    var rows = shown.map(function (t, i) {
      var isNew = firetable.saved.session[firetable.saved.key(t.type, t.cid)];
      return '<li class="pl-row d-listrow' + (isNew ? " d-added" : "") + (t.flagged ? " d-flagged" : "") + (isPlaying("playlist", i) ? " is-playing" : "") + '" data-key="' + esc(t.key) + '" data-cid="' + esc(t.cid) + '" data-list="playlist" data-i="' + i + '">' +
        '<span class="pl-grip material-symbols-outlined" aria-hidden="true" title="Drag to reorder">drag_indicator</span><span class="d-n">' + (i + 1) + "</span>" +
        '<button type="button" class="d-mini-row" data-list="playlist" data-i="' + i + '" aria-label="Play ' + esc(t.t) + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(t)) + ')"></span>' +
        '<span class="d-mini-text"><b>' + esc(t.t) + (i === 0 && isDj ? ' <span class="d-tag pl-next">Next</span>' : "") + (t.flagged ? ' <span class="d-tag pl-broken" title="This song can\'t play">⚠ Broken</span>' : "") + "</b><span>" + esc(t.a) + "</span></span></button>" +
        '<span class="pl-acts">' +
        (i ? '<button type="button" class="row-icon material-symbols-outlined pl-top" title="Move to the top" aria-label="Move ' + esc(t.t) + ' to the top">vertical_align_top</button>' : "") +
        (i < tracks.length - 1 ? '<button type="button" class="row-icon material-symbols-outlined pl-bottom" title="Send to the bottom" aria-label="Send ' + esc(t.t) + ' to the bottom">vertical_align_bottom</button>' : "") +
        '<button type="button" class="row-icon material-symbols-outlined pl-del" title="Remove" aria-label="Remove ' + esc(t.t) + ' from ' + esc(name) + '">delete</button></span></li>';
    }).join("");
    return '<div class="d-panel d-listpanel">' +
      '<div class="pl-head"><label class="sr-only" for="pv-listpick">Playlist</label><select id="pv-listpick" class="pl-pick">' + opts + "</select>" +
      '<button type="button" class="butt graybutt iconbutt pl-dj' + (isDj ? " on" : "") + '" aria-pressed="' + isDj + '" title="' + (isDj ? "You DJ from this playlist" : "DJ from this playlist") + '" aria-label="' + (isDj ? "You DJ from this playlist" : "DJ from this playlist") + '">' + ms("headphones", isDj) + "</button></div>" +
      (tracks.length ? '<div class="pl-tools"><input type="search" id="pv-plfilter" class="pl-filter" placeholder="Filter this playlist" aria-label="Filter this playlist" autocomplete="off" value="' + esc(D.plFilter || "") + '" />' +
        '<button type="button" class="butt darkbutt small d-playall" data-list="playlist" title="Play it here, from the top">' + ms("play_arrow", true) + "<span>Play</span></button>" +
        '<button type="button" class="butt graybutt iconbutt small pl-shuffle" data-list="playlist" title="Shuffle play (the playlist keeps its order)" aria-label="Shuffle play">' + ms("shuffle") + "</button></div>" +
        '<ol class="pl-rows" id="pv-plrows" aria-label="' + esc(name) + '">' + rows + "</ol>" +
        '<p class="d-fact pl-nomatch" hidden>No songs in this playlist match.</p>' +
        (tracks.length > shown.length ? '<button type="button" class="linkButton pl-all">Show all ' + esc(tracks.length) + " songs</button>" : "")
        : '<p class="d-fact">Empty. Save songs here with ' + ms("playlist_add") + ", or Play it in the room from the player.</p>") +
      '<div class="pl-deck" id="pv-deckline">' + deckLine(isDj, tracks.length) + "</div>" +
      '<p class="d-fact">Drag ' + ms("drag_indicator") + " to reorder. Songs saved this visit are marked. Every playlist tool is in Live, under Playlists.</p></div>";
  }

  /** Under the DJ playlist: where you stand on the decks. */
  function deckLine(isDj, n) {
    var d = deckState();
    if (!isDj) return '<p class="d-fact">The room plays from ' + esc(firetable.utilities.listName(djList())) + " when you DJ.</p>";
    if (d.on) return '<p class="d-fact">' + ms("headphones") + " You're on the decks. The room plays from the top of this list.</p>";
    if (d.waiting) return '<p class="d-fact">' + ms("queue_music") + " You're #" + esc(d.place) + " in line for the decks.</p>";
    if (!n) return "";
    return '<button type="button" class="butt darkbutt d-joinwait">' + ms("queue_music") + "<span>" + (d.open ? "Hop on the decks" : "Join the waitlist") + "</span></button>" +
      '<p class="d-fact d-center">' + (d.open ? "A spot is open. The room plays this list, from the top." : "You'll take the decks when a spot opens.") + "</p>";
  }

  /** Filter, drag and the list's buttons, once it's on screen. */
  function listReady(refocus) {
    var input = document.getElementById("pv-plfilter");
    if (input) {
      applyFilter();
      if (refocus) { input.focus(); var v = input.value; input.setSelectionRange(v.length, v.length); }
    }
    var rowsEl = document.getElementById("pv-plrows");
    if (!rowsEl || rowsEl._ftDrag) return;
    rowsEl._ftDrag = true; // the list is redrawn as a new element, so this runs once per drawing
    rowsEl.classList.toggle("is-sort-off", !!D.plFilter);
    firetable.utilities.dragSort(rowsEl, {
      items: ".pl-row",
      handle: ".pl-grip",
      disabled: function () { return !!D.plFilter; },
      onUpdate: function () {
        var keys = $(rowsEl).children("li").map(function () { return this.getAttribute("data-key"); }).get();
        ftapi.actions.reorderList(keys);
        firetable.ui.toast("Order saved", "success");
      }
    });
  }
  function applyFilter() {
    var q = fold(String(D.plFilter || "").trim());
    var rows = document.querySelectorAll("#pv-plrows > li");
    var shown = 0;
    rows.forEach(function (r) {
      var hit = !q || fold(r.textContent).indexOf(q) !== -1;
      r.hidden = !hit;
      if (hit) shown++;
    });
    var none = document.querySelector("#dSide .pl-nomatch");
    if (none) none.hidden = !(q && !shown);
    var rowsEl = document.getElementById("pv-plrows");
    if (rowsEl) rowsEl.classList.toggle("is-sort-off", !!q); // no dragging while filtered: hide the grips
  }

  function rowTrack(btn) {
    var li = btn.closest(".pl-row[data-key]");
    if (!li) return null;
    var key = li.getAttribute("data-key");
    var q = (ftapi.queue || {})[key];
    return q ? { key: key, cid: li.getAttribute("data-cid"), track: q } : null;
  }
  function plAct(kind, btn) {
    var r = rowTrack(btn);
    if (!r) return;
    var label = firetable.utilities.decodeEntities(String(r.track.name || "That song"));
    if (kind === "top") return ftapi.actions.moveTrackToTop(r.key, null, null, null, r.cid);
    if (kind === "bottom") return ftapi.actions.moveTrackToBottom(r.key, null, r.cid);
    var ref = ftapi.queueRef;
    var name = firetable.utilities.listName(viewList());
    ftapi.actions.deleteTrack(r.key, function (err) {
      if (err) return firetable.ui.toast("Couldn't remove it. Try again.", "error");
      firetable.saved.unmark(r.track.type, r.track.cid);
      firetable.ui.toast("Removed " + label + " from " + name, "notice", {
        action: { label: "Undo", fn: function () {
          ref.child(r.key).set(r.track).then(function () { firetable.ui.toast("Put back in " + name, "success"); },
            function () { firetable.ui.toast("Couldn't put it back. Find it in Recent or search.", "error"); });
        } }
      });
    });
  }

  // ─── The room, as Discover plays alongside it ───────────────────────────

  function blocked() { return document.body.classList.contains("media-blocked"); }
  /** The room's song in Discover's shape, or null when the room is quiet. */
  function liveTrack() {
    var s = firetable.song;
    if (!s || !s.cid || s.cid == 0) return null;
    return { type: Number(s.type || 1), cid: s.cid, a: firetable.utilities.decodeEntities(s.artist || ""), t: firetable.utilities.decodeEntities(s.title || ""),
      img: (firetable.imgCache && firetable.imgCache[s.cid]) || s.image, url: s.url, dj: s.djname, djid: s.djid, started: s.started, dur: s.duration, now: true };
  }
  function has(list) { return ftapi.keepAwake && ftapi.keepAwake.has ? ftapi.keepAwake.has(list) : false; }
  /** Where the member stands: on the decks, in line (and where), and whether a spot is open. */
  function deckState() {
    var table = firetable.tableData || {};
    var seats = Object.keys(table).filter(function (k) { return table[k] && table[k].id; }).length;
    var place = 0;
    var wl = firetable.waitlistData || {};
    Object.keys(wl).forEach(function (k, i) { if (wl[k] && wl[k].id === ftapi.uid) place = i + 1; });
    return { on: !!ftapi.uid && has(table), waiting: !!place, place: place, open: seats < DECK_SPOTS };
  }
  function toRoom(t) {
    if (!t) return;
    if (!D.signedIn) return showSignIn("create");
    var dest = djList();
    var type = Number(t.type || 1);
    var refusal = firetable.utilities.formatRefusal(dest, type);
    if (refusal) return firetable.ui.toast(refusal, "error");
    var ref = ftapi.lookup.listRef(dest);
    var name = firetable.utilities.listName(dest);
    var info = { type: type, name: (t.a ? t.a + " - " : "") + t.t, cid: t.cid, img: t.img || artOf(t), url: firetable.utilities.soundCloudPageUrl(t.url || ""), from: "discover" };
    ftapi.actions.addTrackToTop(ref, info, null, null, function (err, key) {
      if (err) return firetable.ui.toast("Couldn't add it to " + name + ". Try again.", "error");
      if (t.djid) firetable.actions.recordGrab(t.djid, type, t.cid);
      firetable.saved.mark(type, t.cid, name);
      P.inRoom = { cid: t.cid, type: type, key: key, ref: ref, list: dest };
      var d = deckState();
      var msg = d.on ? "First in " + name + ": your next song on the decks." : d.waiting ? "First in " + name + ". It plays when your turn comes." : "First in " + name + ". It plays the next time you DJ.";
      firetable.ui.toast(msg, "success", { duration: 6000, action: d.on || d.waiting ? { label: "Undo", fn: undoToRoom } : { label: d.open ? "Hop on" : "Join the waitlist", fn: hopOn } });
      refreshSide();
      renderSide();
    });
  }
  function undoToRoom() {
    var r = P.inRoom;
    if (!r) return;
    P.inRoom = null;
    r.ref.child(r.key).remove().then(function () {
      firetable.saved.unmark(r.type, r.cid);
      firetable.ui.toast("Taken back out of " + firetable.utilities.listName(r.list));
      renderSide();
    }, function () { firetable.ui.toast("Couldn't take it out. It's still first in " + firetable.utilities.listName(r.list) + ".", "error"); });
  }
  function hopOn() {
    var d = deckState();
    if (d.on || d.waiting) return;
    ftapi.actions.sendBotCommand("!addme");
    if (D.mode !== "discover") return firetable.ui.toast(d.open ? "You're hopping on the decks." : "You're in line for the decks.", "success");
    firetable.ui.toast(d.open ? "You're hopping on the decks. Keep digging: Discover tells you when your song starts."
      : "You're in line for the decks. Keep digging: Discover tells you when your song starts.", "success", { duration: 6000 });
  }

  /**
   * Your turn on the decks, while you're in Discover: a toast one song before
   * and another when your song starts, each with Listen in. Discover never
   * switches what you hear by itself: members DJ from here while they dig or
   * play a list, and the room is one tap away.
   */
  var turnNoted = null, songNoted = null;
  /**
   * Is the room's song still playing, with time left to hear it? The room keeps
   * the last song until the bot starts the next one, so a page that catches up
   * in that gap (woken from sleep, reloaded, just signed in) sees a song that
   * has already ended.
   */
  function stillOn(s) {
    var elapsed = (ftapi.now() - Number(s.started || 0)) / 1000;
    var dur = Number(s.duration || 0);
    return elapsed >= 0 && (dur > 0 ? elapsed < dur - 10 : elapsed < 60);
  }
  function yourTurn() {
    var s = firetable.song;
    if (!D.signedIn || !ftapi.uid || !s || !s.cid || s.cid == 0 || !stillOn(s)) return;
    if (s.djid === ftapi.uid) {
      if ((D.src === "live" && !blocked()) || songNoted === s.started) return;
      songNoted = s.started;
      firetable.ui.toast("Your song is on in the room.", "notice", {
        duration: 8000, action: { label: "Listen in", fn: listenIn }
      });
      return;
    }
    var order = deckList();
    if (order.length > 1 && order[1].id === ftapi.uid && discoverActive() && turnNoted !== s.started) {
      turnNoted = s.started;
      firetable.ui.toast("You're up next on the decks. Your Discover pick keeps playing.", "notice", {
        duration: 7000, action: { label: "Listen in", fn: listenIn }
      });
    }
  }

  // ─── The player ─────────────────────────────────────────────────────────
  // One player for Discover, along the bottom like any music app's. It plays
  // either a song from Discover (through the room's own players, with the
  // room silent meanwhile) or the room itself, live: the bar says which in
  // words, colour and controls, and the other is always one tap away.
  //   D.src "discover": a Discover song (playing or paused)
  //         "live":     the room, as it plays (the stage's buttons come along)
  //         "off":      the room stopped by you; nothing sounds

  // play: counts each start of a song (a new listen for Last.fm; pausing or Listen in keeps it)
  var P = { track: null, list: null, i: 0, paused: false, len: 0, at: 0, timer: null, inRoom: null, play: 0 };
  var DECK_SPOTS = 4;

  function setSrc(src) { D.src = src; D.listening = src === "live"; setTimeout(mapMarks, 0); }
  function discoverActive() { return !!(P.track && D.src === "discover"); }
  function isPlaying(list, i) { return discoverActive() && P.list === list && P.i === i; }
  function isSounding(list, i) { return isPlaying(list, i) && !P.paused; }

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60);
  }

  /** Stop a 30-second preview first, the way the room does. */
  function cancelPreview() {
    if (firetable.overlayPreview) firetable.overlayPreview.stop();
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
    if (!auto) failures = 0; // someone chose this one: count failures from here
    setSrc("discover");
    // the same song picked up where it waited is the same listen
    if (!(P.track && String(P.track.cid) === String(t.cid) && startAt)) P.play++;
    P.track = t; P.list = listName; P.i = i; P.paused = false; P.len = t.dur || 0; P.at = startAt || 0;
    setTimeout(mapMarks, 0); // the genre you're hearing, on the sound map
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
      firetable.media.scLoad(t.cid, { auto_play: true });
    }
    startTicking();
    mediaSession(t);
    refreshSide();
    renderBrowse();
    if (!auto) announce("Playing " + t.t + (t.a ? " by " + t.a : "") + ", from " + (list.label || "Discover"));
  }

  /** The phone's lock screen, headphones and media keys follow what the bar plays. */
  function mediaSession(t, live) {
    var session = navigator.mediaSession;
    if (!session || typeof MediaMetadata !== "function") return;
    try {
      session.metadata = t ? new MediaMetadata({ title: t.t || "", artist: t.a || "", album: (ftconfigs.roomName || "") + (live ? " · Live" : " · Discover"), artwork: [{ src: artOf(t), sizes: "320x180", type: "image/jpeg" }] }) : null;
      var on = function (action, fn) { try { session.setActionHandler(action, fn); } catch (e) { /* not on this browser */ } };
      if (live) {
        on("play", t ? listenIn : null);
        on("pause", t ? stopRoom : null);
        on("nexttrack", null);
        on("previoustrack", null);
      } else {
        on("play", t ? function () { if (P.paused) togglePause(); } : null);
        on("pause", t ? function () { if (!P.paused) togglePause(); } : null);
        on("nexttrack", t ? function () { step(1); } : null);
        on("previoustrack", t ? function () { step(-1); } : null);
      }
      session.playbackState = !t ? "none" : live ? "playing" : P.paused ? "paused" : "playing";
    } catch (e) { /* a browser without it */ }
  }

  /** Give the players back to the room (Live, Listen in). */
  function release() {
    mediaSession(null);
    if (firetable.preview !== "discover") return;
    firetable.preview = false;
    firetable.previewType = null;
    if (firetable.ytLoaded) player.stopVideo();
    if (firetable.scLoaded) firetable.scwidget.pause();
    firetable.utilities.resumeCurrentSong();
  }

  function listenIn() {
    if (discoverActive()) P.paused = true; // your pick waits where it was
    setSrc("live");
    release();
    // a tap is a gesture: if the browser held the room's audio back, start it now
    if (blocked() && firetable.media && firetable.media.tapToPlay) firetable.media.tapToPlay();
    var s = liveTrack();
    if (s) mediaSession(s, true);
    renderSide();
    renderBrowse();
    announce(s ? "Listening to the room live: " + s.t + (s.dj ? ", " + s.dj + " on deck" : "") : "The room is quiet");
  }

  /** Stop hearing the room without leaving Discover (live can't be paused, only left). */
  function stopRoom() {
    setSrc("off");
    firetable.preview = "discover"; // the room's players stay quiet, as for a Discover song
    firetable.previewType = null;
    if (firetable.ytLoaded) player.stopVideo();
    if (firetable.scLoaded) firetable.scwidget.pause();
    mediaSession(null);
    renderSide();
    announce("Stopped listening to the room");
  }

  function togglePause() {
    if (!P.track) return;
    if (!discoverActive() || firetable.preview !== "discover") return play(P.list, P.i, P.at);
    P.paused = !P.paused;
    if (Number(P.track.type || 1) === MEDIA_YOUTUBE) {
      if (firetable.ytLoaded) { if (P.paused) player.pauseVideo(); else player.playVideo(); }
    } else if (firetable.scLoaded) {
      if (P.paused) firetable.scwidget.pause(); else firetable.scwidget.play();
    }
    try { navigator.mediaSession.playbackState = P.paused ? "paused" : "playing"; } catch (e) { /* none */ }
    refreshSide();
    renderBrowse();
  }

  /** The bar's big button: whatever stopping or starting means for what it shows. */
  function mainButton() {
    if (discoverActive()) return togglePause();
    var s = liveTrack();
    if (s && D.src === "live" && !blocked()) return stopRoom();
    if (s) return listenIn();
    if (P.track) return play(P.list, P.i, P.at);
  }

  function step(by) {
    var list = lists[P.list];
    if (!list) return;
    // back, a few seconds in: the start of this song (as every player does)
    if (by < 0 && P.at > 3 && discoverActive()) { P.play++; return seek(0); } // a new listen
    var i = P.i + by;
    if (i < 0 || i >= list.tracks.length) {
      if (by > 0) { // the end of the list
        P.paused = true;
        refreshSide();
        renderBrowse();
        announce("That's the end of " + list.label);
      }
      return;
    }
    play(P.list, i, 0, true);
    announce("Next: " + P.track.t + (P.track.a ? " by " + P.track.a : ""));
  }

  function seek(sec) {
    if (!discoverActive() || firetable.preview !== "discover") return;
    sec = Math.max(0, Math.min(P.len || sec, sec));
    P.at = sec;
    if (Number(P.track.type || 1) === MEDIA_YOUTUBE) { if (firetable.ytLoaded && player.seekTo) player.seekTo(sec, true); }
    else if (firetable.scLoaded) firetable.scwidget.seekTo(sec * 1000);
    paint(sec, P.len);
  }

  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    firetable.utilities.setPlayersVolume(v);
    localStorage[STORAGE.volume] = v;
    if (localStorage[STORAGE.mute] && localStorage[STORAGE.mute] !== "false") localStorage[STORAGE.mute] = false; // moving it un-mutes
    else if (v === 0) firetable.actions.muteToggle(true);
    firetable.ui.paintVolumeSlider(v);
    firetable.ui.renderMuteButton();
    renderVolume();
  }
  function renderVolume() {
    var v = firetable.utilities.getEffectiveVolume();
    lastVolume = v;
    ["pv-vol", "pv-fvol"].forEach(function (id) {
      var range = document.getElementById(id);
      if (!range) return;
      if (document.activeElement !== range) range.value = v;
      range.style.setProperty("--pct", v + "%");
      range.setAttribute("aria-valuetext", v ? v + "%" : "Muted");
    });
    var icon = v === 0 ? "volume_off" : v < 50 ? "volume_down" : "volume_up";
    document.querySelectorAll("#dMini .d-mute, #pv-full .d-mute").forEach(function (b) {
      if (b.getAttribute("data-icon") !== icon) { b.innerHTML = ms(icon); b.setAttribute("data-icon", icon); }
      b.setAttribute("aria-label", v === 0 ? "Unmute" : "Mute");
      b.setAttribute("title", v === 0 ? "Unmute" : "Mute");
      b.setAttribute("aria-pressed", String(v === 0));
    });
  }
  var lastVolume = null;

  function startTicking() {
    if (P.timer) return;
    P.timer = setInterval(tick, 500);
    tick();
  }
  function tick() {
    // the stage's own mute (or a key) may have changed it meanwhile
    if (F.open && firetable.utilities.getEffectiveVolume() !== lastVolume) { renderVolume(); renderFull(); }
    if (discoverActive()) {
      if (firetable.preview !== "discover") return;
      var done = function (at, len) {
        if (typeof at === "number" && !isNaN(at)) P.at = at;
        if (len) P.len = len;
        paint(P.at, P.len);
      };
      if (Number(P.track.type || 1) === MEDIA_YOUTUBE) {
        if (firetable.ytLoaded && player.getCurrentTime) done(player.getCurrentTime(), player.getDuration && player.getDuration());
      } else if (firetable.scLoaded) {
        firetable.scwidget.getPosition(function (pos) {
          firetable.scwidget.getDuration(function (len) { done(pos / 1000, len / 1000); });
        });
      }
      return;
    }
    var s = firetable.song;
    if (s && s.cid && s.cid != 0) paint(Math.max(0, (ftapi.now() - s.started) / 1000), s.duration || 0);
    else paint(0, 0);
  }
  function paint(at, len) {
    var pct = len ? Math.min(100, (at / len) * 100) : 0;
    if (D.seeking) return;
    var set = function (id, fn) { var el = document.getElementById(id); if (el) fn(el); };
    ["dAt", "pv-fat"].forEach(function (id) { set(id, function (el) { el.textContent = len || at ? clock(at) : ""; }); });
    // the full player counts down, as the room's timer does
    set("dLen", function (el) { el.textContent = len ? clock(len) : ""; });
    set("pv-flen", function (el) { el.textContent = len ? "-" + clock(Math.max(0, len - at)) : ""; });
    ["dBar", "dMiniBar", "pv-fbar"].forEach(function (id) { set(id, function (el) { el.style.width = pct + "%"; }); });
    ["pv-seek", "pv-fseek"].forEach(function (id) {
      set(id, function (range) {
        range.max = Math.max(1, Math.round(len || 1));
        range.value = Math.round(at);
        range.setAttribute("aria-valuetext", clock(at) + " of " + clock(len));
      });
    });
  }

  /** Spoken once for screen readers when what's playing changes. */
  function announce(text) {
    var el = document.getElementById("pv-announce");
    if (!el) return;
    el.textContent = "";
    setTimeout(function () { el.textContent = text; }, 50);
  }

  // ─── The bar ────────────────────────────────────────────────────────────
  // Built once (build()); renderBar fills in what changes. The stage's own
  // Fire, Grab, Link, Skip and Mod tools buttons move into the bar while
  // you're in Discover, so the room's song can be fired, grabbed, skipped
  // and fixed from here exactly as each person's role allows (body.is-mod,
  // body.is-current-dj and signed in decide, as on the stage), and go back
  // to the stage for Live.

  var STAGE_BUTTONS = [["fire", "tip-fire", "pv-livekeep"], ["grab", "tip-grab", "pv-livekeep"], ["st-grabPick", "tip-st-grabPick", "pv-livekeep"], ["songlink", "tip-songlink", "pv-liveacts"],
    ["skipTrigger", "tip-skipTrigger", "pv-liveacts"], ["npModBtn", "tip-npModBtn", "pv-liveacts"]];
  // The stage's own utilities: its screen (synced, on, off), reload, play on a
  // speaker or TV, and full screen. With the player along the bottom they live
  // in it too, in Discover and Live, and the stage is left to the DJs. The
  // screen and the cast button go into the full-screen player while it's open
  // (its Video is the stage's screen down; on phones it's the only player with
  // room for the cast button).
  var STAGE_TOOLS = [["screenControl", "screenControlTip", "pv-tools", "pv-fscreen"], ["reloadtrack", "tip-reloadtrack", "pv-tools", null],
    ["st-cast", "tip-st-cast", "pv-tools", "pv-fscreen"], ["fullscreenBtn", "tip-fullscreenBtn", "pv-tools", null]];
  // Where the stage's buttons are: in the bar along the bottom, or in the
  // full-screen player while it's open. The stage keeps none.
  var stageAt = "stage";
  function placeStage() {
    var want = F.open ? "full" : "bar";
    if (want === stageAt) return;
    var host = function (b) { return document.getElementById(want === "full" ? "pv-fstage" : b[2]); };
    if (!STAGE_BUTTONS.every(function (b) { return document.getElementById(b[0]) && host(b); })) return;
    // Every tool is put in again, in this list's order, the ones that stay
    // where they are too: screen and cast coming back from the full-screen
    // player used to land after reload and full screen, so the bar's tools
    // changed places from one state to the next.
    STAGE_TOOLS.forEach(function (b) {
      var el = document.getElementById(b[0]);
      var h = document.getElementById(want === "full" && b[3] ? b[3] : b[2]);
      if (!el || !h) return;
      var focused = document.activeElement === el;
      h.appendChild(el);
      var tip = document.getElementById(b[1]);
      if (tip) h.appendChild(tip);
      if (focused) el.focus();
    });
    // a menu open on a button that moves would point at nothing
    ["npModMenu", "npAddDjMenu", "skipPopover", "flagPopover", "tagEditorPopover"].forEach(function (id) {
      var p = document.getElementById(id);
      try { if (p && p.matches(":popover-open")) p.hidePopover(); } catch (e) { /* none */ }
    });
    if (firetable.stealSourceBtn && firetable.stealSourceBtn.is("#grab")) $("#stealContain").hide();
    STAGE_BUTTONS.forEach(function (b) {
      var h = host(b);
      h.appendChild(document.getElementById(b[0]));
      var tip = document.getElementById(b[1]);
      if (tip) h.appendChild(tip);
    });
    stageAt = want;
  }

  /**
   * In Live while you hear Discover (or have stopped the room): a card in the
   * stage's lower left says you aren't hearing the room, with Listen live.
   */
  var notLiveHtml = "";
  function renderNotLive() {
    var el = document.getElementById("st-notlive");
    if (!el) return;
    var show = D.mode === "live" && !!liveTrack() && (discoverActive() || D.src === "off");
    var html = "";
    if (show) {
      var t = discoverActive() ? P.track : null;
      var line = t && !P.paused ? "Playing from Discover: " + t.t + (t.a ? " · " + t.a : "")
        : t ? "Discover is paused" : "You turned the room's sound off";
      html = '<span class="st-nl-text"><b>' + ms(t ? "explore" : "volume_off") + 'You\'re not listening live</b><span>' + esc(line) + "</span></span>" +
        '<button type="button" class="butt graybutt small d-listen st-nl-go" title="You\'re not listening live. Listen in to the room"><i class="d-dot" aria-hidden="true"></i>Listen live</button>';
    }
    el.hidden = !show;
    if (html !== notLiveHtml) { el.innerHTML = html; notLiveHtml = html; }
  }

  function barKind() {
    if (discoverActive()) return "discover";
    if (liveTrack()) return D.src === "live" && !blocked() ? "live" : "onair";
    return P.track ? "pick" : "quiet";
  }

  // ─── The bar's colour: the playing song's artwork ───────────────────────
  // A small copy of the cover is read once per song (YouTube's and
  // SoundCloud's art allow it, as the chart image already relies on): the
  // most vivid colour family in it, made light enough to read on the dark
  // bar. Grey or unreadable art keeps the room's accent.
  var tones = {}; // "type_cid" -> "#rrggbb" or null
  function toneOf(t) {
    var k = t.type + "_" + t.cid;
    if (k in tones) return Promise.resolve(tones[k]);
    return new Promise(function (ok) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        var tone = null;
        try {
          var c = document.createElement("canvas");
          c.width = c.height = 24;
          var g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(img, 0, 0, 24, 24);
          tone = pickTone(g.getImageData(0, 0, 24, 24).data);
        } catch (e) { tone = null; } // art that can't be read: the accent
        tones[k] = tone;
        ok(tone);
      };
      img.onerror = function () { tones[k] = null; ok(null); };
      img.src = artOf(t);
    });
  }
  /** The cover's most vivid hue family, averaged, lifted to read on the bar. */
  function pickTone(px) {
    var bins = [];
    var total = 0;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      var r = px[i] / 255, gr = px[i + 1] / 255, b = px[i + 2] / 255;
      var max = Math.max(r, gr, b), min = Math.min(r, gr, b), l = (max + min) / 2, d = max - min;
      if (l < 0.12 || l > 0.92 || d < 0.08) continue; // black, white and grey say nothing
      var s = d / (1 - Math.abs(2 * l - 1));
      var h = max === r ? ((gr - b) / d + 6) % 6 : max === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
      var w = s * (1 - Math.abs(l - 0.5));
      var bin = bins[Math.floor(h * 2) % 12] || (bins[Math.floor(h * 2) % 12] = { w: 0, r: 0, g: 0, b: 0 });
      bin.w += w; bin.r += px[i] * w; bin.g += px[i + 1] * w; bin.b += px[i + 2] * w;
      total += w;
    }
    var best = null;
    bins.forEach(function (x) { if (x && (!best || x.w > best.w)) best = x; });
    if (!best || total < 6) return null;
    var hsl = toHsl(best.r / best.w, best.g / best.w, best.b / best.w);
    return "hsl(" + Math.round(hsl[0]) + " " + Math.round(Math.min(85, Math.max(40, hsl[1]))) + "% " + Math.round(Math.min(70, Math.max(58, hsl[2]))) + "%)";
  }
  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = 60 * (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4);
    }
    return [h, s * 100, l * 100];
  }
  /** The stage's colour for the room's song (the bot's, set by colorsChanged), or null. */
  function stageColor() {
    var c = firetable.color;
    return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null;
  }
  /**
   * The bar's colour: while it plays the room, the stage's own colour, so the
   * bar and the stage always match; a Discover song's is read from its cover.
   */
  function applyTone(t, room) {
    var el = document.getElementById("dMini");
    if (!el) return;
    if (!t) { el.style.removeProperty("--pb-art"); el.removeAttribute("data-tone-for"); return; }
    var k = t.type + "_" + t.cid;
    var set = function (tone) {
      if (el.getAttribute("data-tone-for") !== k) return; // the song changed meanwhile
      if (tone) el.style.setProperty("--pb-art", tone); else el.style.removeProperty("--pb-art");
    };
    el.setAttribute("data-tone-for", k);
    if (room && stageColor()) return set(stageColor());
    if (k in tones) set(tones[k]); else toneOf(t).then(set);
  }

  var lastKind = null;
  function renderBar() {
    var el = document.getElementById("dMini");
    if (!el) return;
    placeStage();
    var kind = barKind();
    var s = liveTrack();
    var t = kind === "discover" || kind === "pick" ? P.track : s;
    var list = lists[P.list];
    var live = kind === "live" || kind === "onair";
    applyTone(t, live);
    el.className = "pb is-" + kind + (live ? " is-room" : "") + (P.paused && (kind === "discover" || kind === "pick") ? " is-paused" : "") + (blocked() ? " is-blocked" : "") + (D.signedIn ? " is-member" : "");
    el.setAttribute("aria-label", live ? "Player: the room, live" : kind === "quiet" ? "Player" : "Player: Discover");
    if (kind !== lastKind) { lastKind = kind; document.body.setAttribute("data-pb", kind); }
    // in Live while you hear a Discover song (or nothing), the stage's screen stays up:
    // the room's players are carrying your song, not the room's video
    document.body.classList.toggle("pb-elsewhere", discoverActive() || D.src === "off");
    renderNotLive();

    // where it's from
    var src = document.getElementById("pv-src");
    var n = peopleHere();
    if (kind === "discover" || kind === "pick") {
      var pos = list && list.tracks.length > 1 ? " · " + (P.i + 1) + " of " + list.tracks.length : "";
      src.innerHTML = '<span class="pb-kind">' + ms("explore") + "Discover</span><span>" + esc(((list && list.label) || "Discover") + pos) + "</span>";
    } else if (kind === "live") {
      src.innerHTML = '<span class="pb-kind pb-livekind"><i class="d-dot" aria-hidden="true"></i>Live</span><span>' + esc((s.dj ? s.dj + " on deck" : "The room") + (n ? " · " + n + " here" : "")) + "</span>";
    } else if (kind === "onair") {
      src.innerHTML = '<span class="pb-kind pb-livekind is-off"><i class="d-dot" aria-hidden="true"></i>On air</span><span>' +
        esc(blocked() ? "Your browser held the room's sound back. Press play" : "Not listening · press play to listen in") + "</span>";
    } else {
      src.innerHTML = '<span class="pb-kind is-off">' + ms("music_off") + "Nothing playing</span><span>" + esc(n ? n + " here · " : "") + "The room is quiet</span>";
    }

    // the song
    var art = document.getElementById("pv-art");
    art.querySelector(".pb-cover").style.backgroundImage = t ? "url(" + JSON.stringify(artOf(t)) + ")" : "";
    var face = art.querySelector(".pb-face");
    var dj = live && s && s.dj ? djShown(s.djid, s.dj) : null;
    face.innerHTML = dj ? robot(dj, "40x40") : "";
    art.setAttribute("aria-label", t ? "Open the full-screen player: " + t.t : "Open the full-screen player");
    document.getElementById("pv-title").innerHTML = t ? '<span class="d-sheetlink" role="button" tabindex="0" data-src="' + (live ? "live" : "discover") + '" title="About this song">' + esc(t.t) + "</span>" :
      "<span>" + (kind === "quiet" ? "Pick any song to play it here" : "") + "</span>";
    document.getElementById("pv-artist").innerHTML = t ? artistLinks(t.a) : '<span>New, Charts, Genres: everything the room has played</span>';

    // keep it: Save for a Discover song; the stage's Fire and Grab for the room's (members),
    // Save to the crate and Join to fire for visitors
    var keep = document.getElementById("pv-dkeep");
    var saved = t ? firetable.saved.where(t.type, t.cid) : "";
    if (kind === "discover" || kind === "pick") {
      keep.innerHTML = '<button type="button" class="butt graybutt iconbutt d-savebtn pb-save' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "Saved in " + saved + ". Save again" : D.signedIn ? "Save to a playlist" : "Save to your crate") + '" aria-label="' + esc(saved ? "Saved in " + saved : "Save") + '">' + ms(saved ? "playlist_add_check" : "playlist_add") + "</button>";
    } else if (live && !D.signedIn) {
      keep.innerHTML = '<button type="button" class="butt graybutt iconbutt pb-joinfire" title="Join to fire this song" aria-label="Join to fire this song">' + ms("mode_heat") + "</button>" +
        '<button type="button" class="butt graybutt iconbutt pb-savelive' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "In your crate" : "Save to your crate") + '" aria-label="' + esc(saved ? "In your crate" : "Save to your crate") + '">' + ms(saved ? "playlist_add_check" : "playlist_add") + "</button>";
    } else keep.innerHTML = "";

    // transport
    var tr = document.getElementById("pv-transport");
    var idx = P.i, total = list ? list.tracks.length : 0;
    var mainLabel, mainIcon;
    if (kind === "discover" || kind === "pick") { mainIcon = P.paused || kind === "pick" ? "play_arrow" : "pause"; mainLabel = mainIcon === "pause" ? "Pause" : "Play"; }
    else if (kind === "live") { mainIcon = "stop"; mainLabel = "Stop listening to the room"; }
    else if (kind === "onair") { mainIcon = "play_arrow"; mainLabel = "Listen in to the room"; }
    else { mainIcon = "play_arrow"; mainLabel = "Play"; }
    var disc = kind === "discover" || kind === "pick";
    tr.innerHTML = (disc ? '<button type="button" class="butt graybutt iconbutt d-prev" title="Previous" aria-label="Previous"' + (idx <= 0 && P.at <= 3 ? " disabled" : "") + ">" + ms("skip_previous", true) + "</button>" : "") +
      '<button type="button" class="butt iconbutt pb-main d-big" title="' + mainLabel + '" aria-label="' + mainLabel + '"' + (kind === "quiet" ? " disabled" : "") + ">" + ms(mainIcon, true) + "</button>" +
      (disc ? '<button type="button" class="butt graybutt iconbutt d-next" title="Next" aria-label="Next"' + (idx >= total - 1 ? " disabled" : "") + ">" + ms("skip_next", true) + "</button>" +
        '<button type="button" class="butt graybutt iconbutt d-reload pb-small" title="Reload the song (if it stalls)" aria-label="Reload the song">' + ms("refresh") + "</button>" : "");

    // progress: a Discover song can be moved through; the room can't
    var seekEl = document.getElementById("pv-seek");
    seekEl.disabled = !disc;
    seekEl.setAttribute("aria-label", disc ? "Seek" : "The room's song so far (it plays live)");
    if (!disc && kind !== "live" && kind !== "onair") paint(0, 0);

    // side actions
    var acts = document.getElementById("pv-dacts");
    if (disc && t) {
      acts.setAttribute("data-list", P.list || "");
      acts.setAttribute("data-i", String(P.i));
      var done = P.inRoom && String(P.inRoom.cid) === String(t.cid);
      var url = linkOf(t);
      acts.innerHTML = '<button type="button" class="butt graybutt iconbutt d-toroom pb-toroom' + (done ? " is-done" : "") + '" title="' + esc(!D.signedIn ? "Join to play it in the room" : done ? "First in your DJ playlist" : "Play it in the room") + '" aria-label="' + esc(!D.signedIn ? "Join to play it in the room" : done ? "First in your DJ playlist" : "Play it in the room") + '">' + ms(done ? "check" : "queue_play_next") + "</button>" +
        (url ? '<a class="butt graybutt iconbutt pb-open" target="_blank" rel="noopener" href="' + esc(url) + '" title="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '" aria-label="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '">' + ms("open_in_new") + "</a>" : "") +
        '<button type="button" class="butt graybutt iconbutt d-more" title="More" aria-label="More about this song" aria-haspopup="menu">' + ms("more_vert") + "</button>";
    } else {
      acts.removeAttribute("data-list");
      acts.innerHTML = live && D.mode === "discover" ? '<button type="button" class="butt graybutt small d-stepin pb-stepin" title="Go to the room: the stage, the DJs, everyone">' + ms("login") + "<span>Step inside</span></button>" : "";
    }

    // the other source, one tap away
    var sw = document.getElementById("pv-switch");
    if (disc && s) {
      sw.innerHTML = '<button type="button" class="pb-other d-listen" title="Listen in to the room: ' + esc(s.t) + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(s)) + ')"></span>' +
        '<span class="d-mini-text"><b><i class="d-dot" aria-hidden="true"></i>The room</b><span>' + esc(s.t) + "</span></span><span class=\"pb-otherdo\">Listen in</span></button>";
    } else if (!disc && P.track) {
      sw.innerHTML = '<button type="button" class="pb-other d-mypick" title="Back to ' + esc(P.track.t) + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(P.track)) + ')"></span>' +
        '<span class="d-mini-text"><b>' + ms("explore") + "Your pick</b><span>" + esc(P.track.t) + "</span></span><span class=\"pb-otherdo\">Back to it</span></button>";
    } else sw.innerHTML = "";

    renderVolume();
    tick();
  }


  // ─── The full-screen player ─────────────────────────────────────────────
  // Made to be left on: a TV, a projector, a second monitor. The bar opens it
  // (its cover, its full-screen button, or F), in Discover and Live alike; it
  // grows out of the bar and shrinks back into it, and plays what the bar
  // plays. Its background is the song's colour (the room's, as the stage has
  // it; a Discover song's, read from its cover), changing with every song.
  // The stage's own screen button moves in: screen off shows the song's own
  // artwork, screen on lowers the video behind the same view, like the stage
  // (the room's own player, moved into place by CSS: an iframe that's moved
  // in the page reloads). Beside the song: up next in Discover, the decks and
  // what just played in the room, and for members a tab with the room's own
  // chat. Everyone has what their role allows: the stage's Fire, Grab, Link,
  // Skip and Mod tools move in from the bar, members can hop on or step down,
  // and visitors get Save to the crate and Join. The theme, the :id: mark and
  // the clock stay on screen; the controls rest when nobody's touching
  // anything, and the screen is kept awake while it's open.

  var F = { open: false, closing: null, idle: null, from: null, shown: null, art: null, bgLayer: 0, lock: null };

  function fullEl() { return document.getElementById("pv-full"); }
  /** What the full player shows: what the bar shows, what you hear. */
  function fullKind() {
    return barKind(); // what you hear, in Discover and in Live alike
  }
  function fullTrack() {
    var k = fullKind();
    return k === "discover" || k === "pick" ? P.track : liveTrack();
  }
  function canVideo(t) { return !!t && Number(t.type || 1) === MEDIA_YOUTUBE && !firetable.disableMediaPlayback; }

  /**
   * The song's own artwork, as the stage's now playing shows it: the image the
   * room (or the library) has for the song, SoundCloud's at 500px. Never a
   * video frame blown up.
   */
  function songArt(t) {
    var art = artOf(t);
    return /-large\.(jpg|png)/.test(art) ? art.replace(/-large\.(jpg|png)/, "-t500x500.$1") : art;
  }

  /**
   * A YouTube song's sharpest still, for the big cover: the 320px thumbnail
   * goes soft blown up on a TV. YouTube keeps several sizes, not all of them
   * for every video, and a missing one comes back as a 120px grey stand-in,
   * so try them largest first and keep the first real one. maxres is the 16:9
   * frame; sd and hq are 4:3 with the frame letterboxed inside (box: true, the
   * cover zooms past the bars). Resolves null when none beats the thumbnail.
   */
  var hiArts = {};
  function hiArt(t) {
    var art = artOf(t);
    if (!t || Number(t.type || 1) !== MEDIA_YOUTUBE || !t.cid || (t.img && !/ytimg\.com\/vi(_webp)?\//i.test(art))) return Promise.resolve(null);
    var id = String(t.cid);
    if (hiArts[id]) return hiArts[id];
    var base = "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/";
    var sizes = [{ f: "maxresdefault.jpg", box: false }, { f: "sddefault.jpg", box: true }, { f: "hqdefault.jpg", box: true }];
    hiArts[id] = new Promise(function (resolve) {
      var i = 0;
      (function next() {
        if (i >= sizes.length) return resolve(null);
        var size = sizes[i++];
        var img = new Image();
        img.onload = function () { if (img.naturalWidth > 120) resolve({ url: base + size.f, box: size.box }); else next(); };
        img.onerror = next;
        img.src = base + size.f;
      })();
    });
    return hiArts[id];
  }

  function fullHtml() {
    var name = esc((document.getElementById("roomlogo") || {}).title || "Indie Discotheque");
    var iconBtn = function (id, icon, label, extra) {
      return '<button type="button" id="' + id + '" class="butt graybutt iconbutt pvf-iconbtn" title="' + label + '" aria-label="' + label + '"' + (extra || "") + ">" + ms(icon) + "</button>";
    };
    return '<header class="pvf-top">' +
      '<div class="pvf-brand"><span class="pvf-logo" role="img" aria-label="' + name + '"></span>' +
      '<span class="pvf-roomtext"><b>' + name + '</b><span id="pv-ftheme"></span></span></div>' +
      '<div class="pvf-tools">' +
      // the stage's own screen button (placeStage moves it in): screen on, off or synced
      '<span class="pb-host" id="pv-fscreen"></span>' +
      iconBtn("pv-ffs", "fullscreen", "Fill the screen", " hidden") +
      iconBtn("pv-fclose", "close_fullscreen", "Close the player (Esc)") +
      "</div></header>" +
      '<div class="pvf-body">' +
      '<section class="pvf-now" aria-labelledby="pv-ftitle">' +
      '<div class="pvf-visual"><div class="pvf-art" id="pv-fart"><span class="pvf-cover"></span></div>' +
      "</div>" +
      '<div class="pvf-text"><div class="pvf-src" id="pv-fsrc"></div>' +
      '<h2 class="pvf-title" id="pv-ftitle"></h2><p class="pvf-artist" id="pv-fartist"></p>' +
      '<div class="d-tags pvf-tags" id="pv-ftags"></div><div class="d-hist pvf-hist" id="pv-fhist"></div>' +
      '<div class="pvf-next" id="pv-fnext"></div></div>' +
      "</section>" +
      "</div>" +
      '<footer class="pvf-bar">' +
      '<div class="pvf-time"><span id="pv-fat" class="pb-at"></span><span class="pb-track pvf-track"><span class="d-bar"><i id="pv-fbar"></i></span>' +
      '<input type="range" id="pv-fseek" min="0" max="1" step="1" value="0" aria-label="Seek" /></span><span id="pv-flen" class="pb-len"></span></div>' +
      '<div class="pvf-ctrls">' +
      '<div class="pvf-keep"><span class="pb-host" id="pv-fstage"></span><span class="pb-host" id="pv-fkeep"></span></div>' +
      '<div class="pvf-transport" id="pv-ftransport"></div>' +
      '<div class="pvf-right"><span class="pb-host" id="pv-facts"></span>' +
      '<div class="pb-vol"><button type="button" class="butt graybutt iconbutt d-mute" aria-label="Mute">' + ms("volume_up") + "</button>" +
      '<input type="range" id="pv-fvol" min="0" max="100" step="5" value="50" aria-label="Volume" /></div></div>' +
      // phones: the rest of the controls wait behind this
      '<button type="button" class="butt graybutt iconbutt pvf-morebtn" title="More controls" aria-label="More controls" aria-expanded="false">' + ms("more_horiz") + "</button>" +
      "</div></footer>";
  }
  function buildFull() {
    if (fullEl()) return;
    var el = document.createElement("div");
    el.id = "pv-full";
    el.className = "pvf";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Full-screen player");
    el.hidden = true;
    el.innerHTML = fullHtml();
    // the song's colour and cover, behind everything: under the stage's screen, so
    // lowering the screen for Video covers it as it covers the stage's backdrop
    var bg = document.createElement("div");
    bg.id = "pv-fullbg";
    bg.setAttribute("aria-hidden", "true");
    bg.hidden = true;
    bg.innerHTML = '<i class="pvf-bgart"></i><i class="pvf-bgart"></i>';
    document.body.appendChild(bg);
    document.body.appendChild(el);
    window.addEventListener("resize", firetable.utilities.oncePerFrame(placeScreen));
    ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { el.addEventListener(ev, wake, { passive: true }); });
    var fs = document.getElementById("pv-ffs");
    if (fs && document.documentElement.requestFullscreen && document.fullscreenEnabled) fs.hidden = false;
    document.addEventListener("fullscreenchange", renderFsButton);
    document.addEventListener("visibilitychange", function () { if (F.open && document.visibilityState === "visible") keepScreenOn(true); });
  }

  /** The room's theme, as the header shows it. */
  function themeText() {
    var pill = document.getElementById("themePill");
    var text = document.getElementById("themePillText");
    return pill && text && !pill.classList.contains("no-theme") ? text.textContent.trim() : "";
  }

  /**
   * Under the song, quietly (the player is for listening): what's next in the
   * list, Play it in the room's Undo once it's used, and the other source one
   * tap away (the room's song with Listen in, or a paused pick with Back to it).
   */
  function fullNext(kind) {
    var s = liveTrack();
    var line = function (cls, label, t, act, attrs) {
      return '<button type="button" class="pvf-line ' + cls + '"' + (attrs || "") + ' title="' + esc(act + ": " + t.t) + '">' +
        '<span class="pvf-linelabel">' + label + '</span><span class="pvf-linetext"><b>' + esc(t.t) + "</b>" + (t.a ? "<span>" + esc(t.a) + "</span>" : "") + "</span>" +
        '<span class="pvf-linedo">' + act + "</span></button>";
    };
    var out = "";
    if (kind === "discover" || kind === "pick") {
      var t = P.track;
      var list = lists[P.list];
      var next = list && list.tracks[P.i + 1];
      if (next) out += line("pvf-playnext", "Next", next, "Play now");
      if (t && P.inRoom && String(P.inRoom.cid) === String(t.cid)) out += '<p class="pvf-line pvf-note" id="pv-toRoomNote">' + toRoomNote(t, firetable.saved.where(t.type, t.cid)) + "</p>";
      if (s) out += line("d-listen", '<i class="d-dot" aria-hidden="true"></i>The room', s, "Listen in");
    } else if (P.track && !(s && String(s.cid) === String(P.track.cid))) {
      out += line("d-mypick", ms("explore") + "Your pick", P.track, "Back to it");
    }
    return out;
  }

  /** Keep focus on the same control when a part of the player is drawn again. */
  function redraw(el, html) {
    if (el.innerHTML === html) return;
    var a = document.activeElement;
    var key = a && el.contains(a) ? (a.id ? "#" + a.id : a.className ? "." + String(a.className).trim().split(/\s+/).join(".") : null) : null;
    el.innerHTML = html;
    if (key) { var again = el.querySelector(key); if (again) again.focus({ preventScroll: true }); }
  }

  function renderFsButton() {
    var b = document.getElementById("pv-ffs");
    if (!b) return;
    var on = document.fullscreenElement === document.documentElement;
    b.innerHTML = ms(on ? "fullscreen_exit" : "fullscreen");
    b.setAttribute("aria-label", on ? "Leave full screen" : "Fill the screen");
    b.setAttribute("title", on ? "Leave full screen" : "Fill the screen");
  }
  function renderFullTools() {
    var el = fullEl();
    if (!el) return;
    var theme = themeText();
    var th = document.getElementById("pv-ftheme");
    if (th) th.innerHTML = theme ? ms("palette") + "<span>" + esc(theme) + "</span>" : esc(peopleHere() ? firetable.utilities.pluralize(peopleHere(), "person", "people") + " here" : "");
  }

  /**
   * Draw the full player for what's playing now. Everything but the song's
   * details (looked up once per song, or again when asked) comes from what's
   * already on hand, so this is cheap to call on any change.
   */
  function renderFull(details) {
    var el = fullEl();
    if (!el || !F.open) return;
    placeStage();
    var kind = fullKind();
    var t = fullTrack();
    var room = kind === "live" || kind === "onair";
    var disc = kind === "discover" || kind === "pick";
    var s = liveTrack();
    var key = t ? t.type + "_" + t.cid + (room ? "_room" : "") : kind;
    // the stage's screen down: the video behind (a Discover song's own, or the room's screen)
    var video = fullView() === "video" && (room ? !!t : canVideo(t));
    var vol = firetable.utilities.getEffectiveVolume();
    var sounding = disc ? discoverActive() && !P.paused : kind === "live" && vol > 0;
    ["discover", "pick", "live", "onair", "quiet"].forEach(function (k) { el.classList.toggle("is-" + k, k === kind); });
    el.classList.toggle("is-room", room);
    el.classList.toggle("is-member", !!D.signedIn);
    el.classList.toggle("is-video", video);
    el.classList.toggle("is-sounding", sounding);
    el.classList.toggle("is-paused", disc && P.paused);
    document.body.classList.toggle("pv-full-video", video);
    applyFullTone(t, room);
    placeScreen();

    // where it's from
    var n = peopleHere();
    var src;
    if (disc) src = '<span class="pb-kind">' + ms("explore") + "Discover</span><span>" + esc((lists[P.list] && lists[P.list].label) || "Discover") + "</span>";
    else if (kind === "live") {
      var dj = s && s.dj ? djShown(s.djid, s.dj) : null;
      src = '<span class="pb-kind pb-livekind"><i class="d-dot" aria-hidden="true"></i>Live</span>' + (dj ? robotLink(dj) : "") +
        "<span>" + (dj ? nameLink(dj) + " on the decks" : esc(s && s.dj ? s.dj + " on the decks" : "The room")) + esc(n ? " · " + n + " here" : "") + "</span>";
    } else if (kind === "onair") {
      src = '<span class="pb-kind pb-livekind is-off"><i class="d-dot" aria-hidden="true"></i>On air</span><span>' +
        esc(blocked() ? "Your browser held the room's sound back. Press play" : "Not listening · press play to listen in") + "</span>";
    } else src = '<span class="pb-kind is-off">' + ms("music_off") + "Nothing playing</span><span>" + esc(n ? n + " here · " : "") + "The room is quiet</span>";
    redraw(document.getElementById("pv-fsrc"), src);

    // the song
    var titleEl = document.getElementById("pv-ftitle");
    var artistEl = document.getElementById("pv-fartist");
    var title = t ? '<span class="d-sheetlink" role="button" tabindex="0" data-src="' + (room ? "live" : "discover") + '" title="About this song">' + esc(t.t) + "</span>"
      : esc(D.mode === "discover" ? "Pick any song to play it here" : "The room is quiet");
    redraw(titleEl, title);
    redraw(artistEl, t ? artistLinks(t.a) : esc(D.mode === "discover" ? "New, Charts, Genres: everything the room has played" : "When someone hops on the decks, their song shows here."));
    if (key !== F.shown || details) {
      F.shown = key;
      document.getElementById("pv-ftags").innerHTML = "";
      document.getElementById("pv-fhist").innerHTML = t ? "<p>" + ms("hourglass_empty") + "Looking it up…</p>" : "";
      if (t) fillDetails(t, room);
      setFullArt(t);
    }

    // controls
    var keep = "", acts = "", tr = "";
    var saved = t ? firetable.saved.where(t.type, t.cid) : "";
    var url = t ? linkOf(t) : "";
    var openOn = t && Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud";
    if (disc) {
      keep = '<button type="button" class="butt graybutt iconbutt d-savebtn' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "Saved in " + saved + ". Save again" : D.signedIn ? "Save to a playlist" : "Save to your crate") + '" aria-label="' + esc(saved ? "Saved in " + saved : "Save") + '">' + ms(saved ? "playlist_add_check" : "playlist_add") + "</button>";
      var done = P.inRoom && String(P.inRoom.cid) === String(t.cid);
      var label = !D.signedIn ? "Join to play it in the room" : done ? "First in your DJ playlist" : "Play it in the room";
      keep += '<button type="button" class="butt graybutt iconbutt d-toroom' + (done ? " is-done" : "") + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + ms(done ? "check" : "queue_play_next") + "</button>";
      acts = (url ? '<a class="butt graybutt iconbutt" target="_blank" rel="noopener" href="' + esc(url) + '" title="Open on ' + openOn + '" aria-label="Open on ' + openOn + '">' + ms("open_in_new") + "</a>" : "") +
        '<button type="button" class="butt graybutt iconbutt d-more" title="More" aria-label="More about this song" aria-haspopup="menu">' + ms("more_vert") + "</button>";
    } else if (room && !D.signedIn) {
      keep = '<button type="button" class="butt graybutt iconbutt pb-joinfire" title="Join to fire this song" aria-label="Join to fire this song">' + ms("mode_heat") + "</button>" +
        '<button type="button" class="butt graybutt iconbutt pb-savelive' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "In your crate" : "Save to your crate") + '" aria-label="' + esc(saved ? "In your crate" : "Save to your crate") + '">' + ms(saved ? "playlist_add_check" : "playlist_add") + "</button>";
    }
    if (D.mode === "discover") acts += '<button type="button" class="butt graybutt iconbutt pvf-list" title="' + (D.signedIn ? "Playlists" : "Your crate") + '" aria-label="' + (D.signedIn ? "Playlists" : "Your crate") + '">' + ms("queue_music") + "</button>";
    var factsEl = document.getElementById("pv-facts");
    if (disc) { factsEl.setAttribute("data-list", P.list || ""); factsEl.setAttribute("data-i", String(P.i)); } else factsEl.removeAttribute("data-list");
    redraw(document.getElementById("pv-fkeep"), keep);
    redraw(factsEl, acts);

    // as the bar's: the same in Discover and Live, since it plays what you hear
    var mainIcon, mainLabel;
    if (disc) { mainIcon = P.paused || kind === "pick" ? "play_arrow" : "pause"; mainLabel = mainIcon === "pause" ? "Pause" : "Play"; }
    else if (kind === "live") { mainIcon = "stop"; mainLabel = "Stop listening to the room"; }
    else if (kind === "onair") { mainIcon = "play_arrow"; mainLabel = "Listen in to the room"; }
    else { mainIcon = "play_arrow"; mainLabel = "Play"; }
    var total = lists[P.list] ? lists[P.list].tracks.length : 0;
    tr = (disc ? '<button type="button" class="butt graybutt iconbutt d-prev" title="Previous (Shift + ←)" aria-label="Previous"' + (P.i <= 0 && P.at <= 3 ? " disabled" : "") + ">" + ms("skip_previous", true) + "</button>" : "") +
      '<button type="button" class="butt iconbutt pvf-main d-big" title="' + mainLabel + ' (Space)" aria-label="' + mainLabel + '"' + (kind === "quiet" ? " disabled" : "") + ">" + ms(mainIcon, true) + "</button>" +
      (disc ? '<button type="button" class="butt graybutt iconbutt d-next" title="Next (Shift + →)" aria-label="Next"' + (P.i >= total - 1 ? " disabled" : "") + ">" + ms("skip_next", true) + "</button>" +
        '<button type="button" class="butt graybutt iconbutt d-reload pb-small" title="Reload the song (if it stalls)" aria-label="Reload the song">' + ms("refresh") + "</button>"
        : room ? '<button type="button" class="butt graybutt iconbutt pvf-reloadroom pb-small" title="Reload the room\'s audio (if it stalls)" aria-label="Reload the room\'s audio">' + ms("refresh") + "</button>" : "");
    redraw(document.getElementById("pv-ftransport"), tr);
    var seekEl = document.getElementById("pv-fseek");
    seekEl.disabled = !disc;
    seekEl.setAttribute("aria-label", disc ? "Seek" : "The room's song so far (it plays live)");
    if (kind === "quiet") paint(0, 0);

    // under the song: what's next, and the other source
    redraw(document.getElementById("pv-fnext"), fullNext(kind));
    renderFullTools();
    renderVolume();
    firetable.ui.markSaved();
    tick();
  }

  /** The song's own artwork, big (it turns over to the next song's, as the stage's does), and the backdrop behind everything. */
  function setFullArt(t) {
    var el = fullEl();
    var art = el.querySelector(".pvf-art");
    var cover = el.querySelector(".pvf-cover");
    var layers = document.querySelectorAll("#pv-fullbg .pvf-bgart");
    if (!t) {
      cover.style.backgroundImage = "";
      cover.classList.remove("is-box");
      F.art = null;
      layers.forEach(function (l) { l.classList.remove("on"); });
      return;
    }
    var src = songArt(t);
    if (F.art === src) return;
    var first = !F.art;
    F.art = src;
    var url = "url(" + JSON.stringify(src) + ")";
    // the cover: the sharpest still once it's in, the thumbnail until then
    var best = null;
    var swapped = false;
    var paint = function () {
      cover.style.backgroundImage = best ? "url(" + JSON.stringify(best.url) + ")" : url;
      cover.classList.toggle("is-box", !!(best && best.box));
    };
    var swap = function () { swapped = true; paint(); };
    hiArt(t).then(function (hi) {
      if (!hi || F.art !== src) return;
      best = hi;
      if (swapped) paint(); // else the flip's swap paints it
    });
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (first || reduce || !art.animate || !art.offsetParent) swap();
    else {
      art.animate([{ transform: "perspective(900px) rotateY(0)" }, { transform: "perspective(900px) rotateY(90deg)" }], { duration: 260, easing: "ease-in" })
        .finished.then(function () {
          swap();
          art.animate([{ transform: "perspective(900px) rotateY(-90deg)" }, { transform: "perspective(900px) rotateY(0)" }], { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" });
        }, swap);
    }
    F.bgLayer = 1 - F.bgLayer;
    layers[F.bgLayer].style.backgroundImage = url;
    layers[F.bgLayer].classList.add("on");
    layers[1 - F.bgLayer].classList.remove("on");
  }
  /**
   * The song's colour: the background, the progress and the labels.
   * The room's song has the colour the bot gives it (the stage's, firetable.color);
   * a Discover song the one read from its cover, as the bar takes it.
   */
  function applyFullTone(t, room) {
    var el = fullEl();
    var bg = document.getElementById("pv-fullbg");
    var set = function (tone) {
      [el, bg].forEach(function (x) {
        if (!x) return;
        if (tone) x.style.setProperty("--pb-art", tone); else x.style.removeProperty("--pb-art");
      });
    };
    var roomColor = room ? stageColor() : null;
    var k = !t ? "" : t.type + "_" + t.cid + (roomColor ? "|" + roomColor : "");
    if (el.getAttribute("data-tone-for") === k) return;
    el.setAttribute("data-tone-for", k);
    if (!t) return set(null);
    if (roomColor) return set(roomColor);
    var key = t.type + "_" + t.cid;
    var done = function (tone) { if (el.getAttribute("data-tone-for") === k) set(tone); };
    if (key in tones) done(tones[key]); else toneOf(t).then(done);
  }
  /** The stage's screen: down (the video) or up (the artwork). One setting for the stage and the player. */
  function fullView() {
    return document.body.classList.contains("screen") ? "video" : "audio";
  }
  /**
   * On a phone the video goes where the cover is (the screen is as wide as
   * the phone), not in the middle of the page under the words.
   */
  function placeScreen() {
    if (!F.open) return;
    var art = document.querySelector("#pv-full .pvf-art");
    var r = art && art.getBoundingClientRect();
    if (r && r.width) document.documentElement.style.setProperty("--pvf-art-top", Math.round(r.top) + "px");
  }

  /** The big button: what stopping or starting means here. */
  function fullMain() { return mainButton(); }

  /** V: the screen on or off, as the stage's screen button sets it (and for the stage too). */
  function setFullView(view) {
    var val = view === "video" ? "on" : "off";
    try { localStorage[STORAGE.screenControl] = val; } catch (e) { /* private window */ }
    firetable.screenControl = val;
    firetable.ui.applyScreenSetting();
    firetable.ui.updateScreenBtn(val);
    renderFull();
    announce(val === "on" ? "Screen on: the video" : "Screen off: the artwork");
  }

  /** The rectangle the player grows out of, and shrinks back into. */
  function originRect(from) {
    var bar = document.getElementById("dMini");
    if (bar && bar.offsetParent) return bar.getBoundingClientRect();
    var stage = document.getElementById("djStage");
    if (from && from.id === "fullscreenBtn" && stage && stage.offsetParent) return stage.getBoundingClientRect();
    if (from && from.isConnected && from.getBoundingClientRect) {
      var r = from.getBoundingClientRect();
      if (r.width) return r;
    }
    return null;
  }
  function animateFull(opening, r) {
    var el = fullEl();
    if (!el.animate) return Promise.resolve();
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var W = window.innerWidth, H = window.innerHeight;
    var px = function (v) { return Math.round(Math.max(0, v)) + "px"; };
    var from = r ? "inset(" + px(r.top) + " " + px(W - r.right) + " " + px(H - r.bottom) + " " + px(r.left) + " round 12px)" : "inset(100% 0px 0px 0px round 12px)";
    var full = "inset(0px 0px 0px 0px round 0px)";
    var frames = reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ clipPath: from, opacity: 0.5 }, { clipPath: full, opacity: 1 }];
    if (!opening) frames.reverse();
    var timing = { duration: reduce ? 160 : opening ? 480 : 320, easing: opening ? "cubic-bezier(.2,.8,.2,1)" : "cubic-bezier(.4,0,.7,.2)" };
    var a = el.animate(frames, timing);
    var bg = document.getElementById("pv-fullbg");
    if (bg && bg.animate) bg.animate(frames, timing);
    if (opening && !reduce) {
      // the bar's cover flies up into the big one
      var small = document.querySelector("#pv-art .pb-cover");
      var big = el.querySelector(".pvf-art");
      if (small && small.offsetParent && big && big.offsetParent) {
        var s = small.getBoundingClientRect(), b = big.getBoundingClientRect();
        if (b.width && b.height) {
          big.animate([{ transformOrigin: "0 0", transform: "translate(" + (s.left - b.left) + "px," + (s.top - b.top) + "px) scale(" + (s.width / b.width) + "," + (s.height / b.height) + ")" },
            { transformOrigin: "0 0", transform: "none" }], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
        }
      }
      el.querySelectorAll(".pvf-top, .pvf-text, .pvf-bar").forEach(function (part, i) {
        part.animate([{ opacity: 0, transform: "translateY(" + (i === 0 ? -12 : 16) + "px)" }, { opacity: 1, transform: "none" }],
          { duration: 420, delay: 120 + i * 50, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
      });
    }
    return a.finished.catch(function () {});
  }

  function openFull(from) {
    var el = fullEl();
    if (!el || F.open) return;
    F.open = true;
    F.closing = null;
    F.from = from || document.activeElement;
    ensureData();
    closeMenu();
    document.body.classList.remove("d-sheet-open");
    el.hidden = false;
    el.classList.remove("is-idle", "show-more");
    document.getElementById("pv-fullbg").hidden = false;
    document.body.classList.remove("pv-full-closing");
    document.body.classList.add("pv-full-on");
    // the page and the bar wait underneath: the player is the page now
    ["mainGrid", "dMini"].forEach(function (id) { var x = document.getElementById(id); if (x) x.inert = true; });
    renderFull(true);
    startTicking();
    renderFsButton();
    animateFull(true, originRect(F.from));
    var close = document.getElementById("pv-fclose");
    if (close) close.focus({ preventScroll: true });
    wake();
    keepScreenOn(true);
    announce("Full-screen player open. Escape closes it.");
  }

  function closeFull() {
    if (!F.open) return;
    var el = fullEl();
    closeMenu();
    if (document.fullscreenElement === document.documentElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    F.open = false;
    clearTimeout(F.idle);
    keepScreenOn(false);
    releaseData();
    ["mainGrid", "dMini"].forEach(function (id) { var x = document.getElementById(id); if (x) x.inert = false; });
    placeStage();
    renderBar();
    if (D.mode === "discover") renderSide();
    var to = originRect(F.from);
    document.body.classList.add("pv-full-closing"); // the video fades as the player shrinks
    var closing = F.closing = animateFull(false, to).then(function () {
      if (F.open || F.closing !== closing) return; // opened again meanwhile
      el.hidden = true;
      document.getElementById("pv-fullbg").hidden = true;
      document.body.classList.remove("pv-full-on", "pv-full-video", "pv-full-closing");
      window.dispatchEvent(new Event("resize")); // the stage measures itself again
    });
    var back = F.from && F.from.isConnected && F.from.offsetParent ? F.from : document.getElementById("fullscreenBtn");
    if (back && back.focus) back.focus({ preventScroll: true });
  }

  /** The controls rest when nobody's touching anything; the song and the room stay. */
  function wake() {
    var el = fullEl();
    if (!el || !F.open) return;
    el.classList.remove("is-idle");
    clearTimeout(F.idle);
    F.idle = setTimeout(function () {
      if (!F.open) return;
      var a = document.activeElement;
      var busy = document.querySelector("dialog[open], #dMenu:not([hidden])") || $("#stealContain").is(":visible") || (a && el.contains(a) && a.matches("input[type=range]"));
      try { busy = busy || document.querySelector(".ft-popover:popover-open"); } catch (e) { /* no popovers */ }
      if (busy) return wake();
      el.classList.add("is-idle");
      el.classList.remove("show-more");
      var more = el.querySelector(".pvf-morebtn");
      if (more) more.setAttribute("aria-expanded", "false");
    }, 3500);
  }

  /** Keep a TV's screen on while the player is open (where the browser can). */
  function keepScreenOn(on) {
    if (!on) {
      if (F.lock) F.lock.release().catch(function () {});
      F.lock = null;
      return;
    }
    if (F.lock || !navigator.wakeLock || document.visibilityState !== "visible") return;
    navigator.wakeLock.request("screen").then(function (lock) {
      if (!F.open) return lock.release();
      F.lock = lock;
      lock.addEventListener("release", function () { if (F.lock === lock) F.lock = null; });
    }).catch(function () { /* not allowed here; the screen may sleep */ });
  }

  // ─── Mode and addresses ─────────────────────────────────────────────────

  function route() {
    var h;
    try { h = decodeURIComponent((location.hash || "").replace(/^#/, "")); } catch (e) { return null; }
    if (h === "live") return { mode: "live" };
    var p = h.split("/");
    if (p[0] !== "discover") return null;
    var view = p[1] || "home";
    if (VIEW_IDS.indexOf(view) === -1) return null;
    var r = { mode: "discover", view: view, sub: null, period: null, id: null };
    if (view === "charts") {
      if (/^(week|month|year|all)$/.test(p[2] || "")) { r.period = p[2]; r.id = /^[\w-]+$/.test(p[3] || "") ? p[3] : null; }
    } else if (view === "search") {
      r.sub = p.slice(2).join("/").slice(0, 100) || null;
    } else if (view === "genres" || view === "djs" || view === "years" || view === "artist" || view === "themes") {
      r.sub = /^[a-z0-9_-]{1,80}$/i.test(p[2] || "") ? p[2] : null;
      if (view === "artist" && !r.sub) return null;
    } else if (view === "bpm") {
      if (!isTempo(Number(p[2]))) return null;
      r.sub = String(Number(p[2]));
    }
    return r;
  }
  function addressFor() {
    if (D.mode === "live") return "#live";
    if (D.view === "home") return "#discover";
    if (D.view === "charts") {
      var id = D.chart.id || currentId(D.chart.period);
      return "#discover/charts" + (D.chart.period !== "week" || D.chart.id ? "/" + D.chart.period + (id && D.chart.period !== "all" ? "/" + id : "") : "");
    }
    return "#discover/" + D.view + (D.sub ? "/" + (D.view === "search" ? encodeURIComponent(D.sub) : D.sub) : "");
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
    // Going between Discover and Live never changes what you hear: the bar says
    // which it is, Listen in takes you to the room, a song in Discover away from it.
    if (!D.src) setSrc("live"); // the room plays until something is picked
    if (mode === "live") {
      releaseData();
      chatBack();
      if (D.sideTab === "chat") D.sideTab = "list";
      document.body.classList.remove("d-sheet-open");
      if (changed) window.dispatchEvent(new Event("resize")); // the stage measures itself again
      renderBar();
    } else {
      if (!D.signedIn && !store.get(FOUND_KEY, null)) store.set(FOUND_KEY, (addressFor().replace(/^#/, "") || "discover").slice(0, 200));
      ensureData();
      renderAll();
    }
    placeStage();
    startTicking();
    renderFull(true);
    writeAddress();
    renderTabs();
  }

  function openSearch() {
    if (D.mode !== "discover") setMode("discover", { remember: true });
    var input = document.getElementById("dQ");
    if (input) { input.focus(); input.select(); keepFocusFromPlayers(input); }
    lib("artistIndex"); // ready for the first letters
  }

  /**
   * YouTube's player takes the focus itself when it finishes loading, so
   * opening search while the room's video starts sent the first letters to
   * the video. For a moment after, focus that jumps from `el` into a player's
   * frame comes back to `el`; anything the person does themselves stands.
   */
  function keepFocusFromPlayers(el) {
    var until = Date.now() + 2000;
    function back() {
      setTimeout(function () {
        var a = document.activeElement;
        if (Date.now() < until && a && a.tagName === "IFRAME" && el.isConnected) el.focus();
      }, 0);
    }
    el.addEventListener("blur", back);
    setTimeout(function () { el.removeEventListener("blur", back); }, 2000);
  }

  function setView(view, sub) {
    D.view = view;
    D.sub = sub || null;
    D.browse = false;
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
  }

  // ─── Data ───────────────────────────────────────────────────────────────

  // Discover's live data is followed only while Discover (or the full player)
  // is open: the database bills every byte it sends, and the bot rewrites the
  // week's chart after every song, so a visit mustn't keep costing for the
  // rest of the session. Coming back follows it again (and catches up).
  var watching = false;
  var following = []; // [ref, fn] of each live listener
  var liveKeys = {}; // the charts followed live (the week's), let go with the rest
  function follow(ref, fn) {
    ref.on("value", fn, quiet);
    following.push([ref, fn]);
  }
  function ensureData() {
    if (watching) return;
    watching = true;
    try { ftapi.watchFeed("history"); } catch (e) { /* signed out before the feeds exist */ }
    follow(db().ref("discover/new"), function (s) {
      D.data.new = s.val() || { tracks: [] };
      if (D.view === "home" || D.view === "new") renderBrowse();
    });
    follow(db().ref("discover/chartIds/week"), function (s) {
      D.data.chartIds.week = s.val() || {};
      var wk = currentId("week");
      if (wk) loadChart("week", wk, true);
      if (D.view === "charts" || D.view === "home") renderBrowse();
    });
    ["month", "year"].forEach(function (p) {
      if (D.data.chartIds[p]) return; // read on an earlier visit (they change once a month, a year)
      db().ref("discover/chartIds/" + p).once("value").then(function (s) { D.data.chartIds[p] = s.val() || {}; if (D.view === "charts") renderBrowse(); }, quiet);
    });
    // (the bot's public chat peek, discover/chat, isn't read: the chat is for members only)
    renderPeek();
  }
  function quiet(err) { firetable.debug && console.log("[discover] not readable yet:", err && err.message); }
  /** Stop following Discover's live data once neither Discover nor the full player is open. */
  function releaseData() {
    if (!watching || D.mode === "discover" || F.open) return;
    watching = false;
    following.forEach(function (f) { f[0].off("value", f[1]); });
    following = [];
    Object.keys(liveKeys).forEach(function (key) { delete liveCharts[key]; });
    liveKeys = {};
  }

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
    if (live) { follow(ref, got); liveKeys[key] = true; }
    else ref.once("value").then(got, function () { D.data.charts[key] = null; renderBrowse(); });
  }

  // ─── Visitors' Live: what joining opens, shown not hidden ────────────────
  // Join (the welcome, with the same Join and Log in as Discover, which open
  // the site's one sign-in dialog), Playlists, Recent and Cards. Each
  // shows what it is, with the real thing where visitors can see it (the
  // room's recent plays, the latest printed cards).

  var lockedTab = "join";
  function lockedTabs() {
    var login = document.getElementById("login");
    if (!login || D.signedIn) return;
    if (!document.getElementById("dLocked")) {
      var bar = document.createElement("div");
      bar.id = "dLocked";
      bar.className = "tabs";
      bar.setAttribute("role", "tablist");
      bar.setAttribute("aria-label", "In the room");
      var pane = document.createElement("div");
      pane.id = "dLockedPane";
      pane.hidden = true;
      login.insertBefore(pane, login.firstChild);
      login.insertBefore(bar, login.firstChild);
    }
    var tabs = [["join", "Join"], ["playlists", "Playlists"], ["recent", "Recent"], ["cards", "Cards"]];
    document.getElementById("dLocked").innerHTML = tabs.map(function (t) {
      return '<button type="button" role="tab" class="tab' + (lockedTab === t[0] ? " on" : "") + '" data-locked="' + t[0] + '" aria-selected="' + (lockedTab === t[0]) + '">' + t[1] + "</button>";
    }).join("");
    var paneEl = document.getElementById("dLockedPane");
    var join = lockedTab === "join";
    paneEl.hidden = join;
    var welcome = document.getElementById("welcomeInfo");
    if (welcome) welcome.hidden = !join;
    var joinLine = joinButtons();
    var slot = welcome && welcome.querySelector(".au-join");
    if (slot && !slot.querySelector(".d-join")) slot.innerHTML = joinLine;
    if (join) { paneEl.innerHTML = ""; return; }
    if (lockedTab === "playlists") {
      var n = crate().length;
      paneEl.innerHTML = '<div class="d-locked">' + ms("queue_music") + "<h3>Your playlists</h3><p>Save songs from anywhere in the room or Discover, keep them in order, and play them for the room when it's your turn on the decks.</p>" +
        (n ? "<p>Your crate of " + esc(firetable.utilities.pluralize(n, "song", "songs")) + " becomes your first playlist.</p>" : "") + joinLine + "</div>";
    } else if (lockedTab === "recent") {
      var rt = recentTracks().slice(0, 30);
      setList("live-recent", "Recent plays", rt);
      paneEl.innerHTML = '<div class="d-locked d-lockedlist"><p>The last songs played in the room. Play any of them in Discover, or save them to your crate.</p>' +
        recentList(rt, "live-recent") + joinLine + "</div>";
      firetable.ui.markSaved();
    } else if (lockedTab === "cards") {
      var latest = latestCards();
      paneEl.innerHTML = '<div class="d-locked">' + ms("style") + "<h3>Trading cards</h3><p>Cards are printed as DJs play. Members grab them, collect them and give them to DJs. Join to start yours.</p>" +
        (latest && latest.length ? '<div class="d-cards">' + latest.map(function (c) {
          return '<span class="d-card"><canvas width="225" height="300" id="cardMakerdj' + esc(c.key) + '"></canvas></span>';
        }).join("") + "</div>" : "") + joinLine + "</div>";
      if (latest && firetable.actions.displayCard) latest.forEach(function (c) { firetable.actions.displayCard(JSON.parse(JSON.stringify(c)), "dj" + c.key); });
    }
  }
  var lastCards;
  function latestCards() {
    if (lastCards === undefined) {
      lastCards = null;
      db().ref("cards").limitToLast(12).once("value").then(function (s) {
        var out = [];
        // cards the bot printed whole (old test rows can lack the art)
        s.forEach(function (c) { var v = c.val(); if (v && v.djname && v.title) out.push(Object.assign({ key: c.key }, v)); });
        lastCards = out.reverse().slice(0, 3);
        if (lockedTab === "cards") lockedTabs();
      }, function () { lastCards = []; });
    }
    return lastCards;
  }

  // ─── Visitors' Live: the chat to read ───────────────────────────────────

  /** The chat is for members only (the owner's call, November 2026): no chat to read for visitors. */
  function renderPeek() {
    lockedTabs();
    var el = document.getElementById("chatPeek");
    if (el) el.hidden = true;
  }

  // ─── Events ─────────────────────────────────────────────────────────────

  // The player bar opens the full-screen player wherever it's clicked or
  // tapped, as YouTube Music's does (the owner, November 22, 2026); its buttons
  // still do their own thing. On a phone the title and artist open it too
  // (the song's page and the artist are a tap away there); with a mouse
  // they're links of their own.
  function barTapOpens(t) {
    if (!t.closest || !t.closest("#dMini")) return false;
    var hit = t.closest("button, a, input, select, label, [role='button']");
    if (!hit || hit.classList.contains("d-mini-open")) return true;
    var phone = matchMedia("(max-width: 639px)").matches;
    return phone && (hit.classList.contains("d-sheetlink") || !!hit.closest(".pb-artist"));
  }

  function onClick(e) {
    var t = e.target;
    var b;
    if (barTapOpens(t)) { e.preventDefault(); return openFull(document.getElementById("pv-art")); }
    if ((b = t.closest("#modeTabs [data-mode]"))) return setMode(b.getAttribute("data-mode"), { remember: true });
    if ((b = t.closest("#nav-tabs [data-tab]"))) return goTab(b.getAttribute("data-tab"));
    if ((b = t.closest("#dBrowse .d-mapg, #dBrowse .d-mapnext")) && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      return pickGenre(b.getAttribute("data-slug"));
    }
    if ((b = t.closest("#dNav [data-view]"))) return setView(b.getAttribute("data-view"));
    if ((b = t.closest(".d-listen"))) return listenIn();
    if ((b = t.closest(".d-stepin"))) return setMode("live", { remember: true });
    if ((b = t.closest(".d-mypick"))) {
      if (!P.track) return;
      if (D.mode !== "discover") setMode("discover", { remember: true });
      return play(P.list, P.i, P.at);
    }
    // the full-screen player
    if ((b = t.closest("#fullscreenBtn"))) return F.open ? closeFull() : openFull(b);
    if (F.open && t.closest("#pv-full a[href^='#discover']")) closeFull(); // an artist, genre or DJ page: show it
    if ((b = t.closest(".pvf-main"))) return fullMain();
    if ((b = t.closest("#pv-fclose"))) return closeFull();
    if ((b = t.closest(".pvf-morebtn"))) {
      var more = fullEl().classList.toggle("show-more");
      b.setAttribute("aria-expanded", String(more));
      b.innerHTML = ms(more ? "close" : "more_horiz");
      return;
    }
    if ((b = t.closest("#pv-ffs"))) {
      if (document.fullscreenElement) return document.exitFullscreen().catch(function () {});
      return document.documentElement.requestFullscreen().catch(function () { firetable.ui.toast("This browser won't fill the screen from here."); });
    }
    if ((b = t.closest(".pvf-reloadroom"))) { $("#reloadtrack").trigger("click"); return firetable.ui.toast("Reloading the room's audio"); }
    if ((b = t.closest(".pvf-list"))) {
      closeFull();
      D.sideTab = "list";
      renderSide();
      if (matchMedia("(max-width: 1023px)").matches) document.body.classList.add("d-sheet-open");
      return;
    }
    if ((b = t.closest(".d-stepdown"))) {
      var was = deckState();
      ftapi.actions.sendBotCommand("!removeme");
      return firetable.ui.toast(was.on ? "Stepping down from the decks" : "Leaving the line for the decks");
    }
    if ((b = t.closest("[data-sidetab]"))) { D.sideTab = b.getAttribute("data-sidetab"); if (D.sideTab === "chat") D.unread = 0; return renderSide(); }
    // the player bar
    if ((b = t.closest(".pb-main"))) return mainButton();
    if ((b = t.closest(".pb-expand"))) return openFull(b);
    if ((b = t.closest(".d-toroom-undo"))) return undoToRoom();
    if ((b = t.closest(".d-toroom"))) {
      var room = P.track;
      if (D.signedIn && P.inRoom && room && String(P.inRoom.cid) === String(room.cid)) return firetable.ui.toast("It's already first in " + firetable.utilities.listName(P.inRoom.list) + ".", "notice", { action: { label: "Undo", fn: undoToRoom } });
      return toRoom(room);
    }
    if ((b = t.closest(".pb-joinfire"))) return showSignIn("create");
    if ((b = t.closest(".pb-savelive"))) return liveTrack() && save(liveTrack(), b);
    // the playlist panel
    if ((b = t.closest(".pl-dj"))) return djFrom(viewList());
    if ((b = t.closest(".pl-top"))) return plAct("top", b);
    if ((b = t.closest(".pl-bottom"))) return plAct("bottom", b);
    if ((b = t.closest(".pl-del"))) return plAct("delete", b);
    if ((b = t.closest(".pl-all"))) { D.plAll = true; return renderSide(); }
    if ((b = t.closest(".pl-shuffle"))) return shufflePlay(b.getAttribute("data-list"));
    if ((b = t.closest(".pl-cratetop"))) {
      var cr = crate();
      var moved = cr.splice(Number(b.getAttribute("data-i")), 1);
      setCrate(moved.concat(cr));
      return renderSide();
    }
    if ((b = t.closest("#dLocked [data-locked]"))) { lockedTab = b.getAttribute("data-locked"); return lockedTabs(); }
    if ((b = t.closest(".d-chatnav"))) { D.sideTab = "chat"; D.unread = 0; renderSide(); document.body.classList.add("d-sheet-open"); return; }
    if ((b = t.closest(".d-chip[data-new]"))) { D.newFilter = b.getAttribute("data-new"); return renderBrowse(); }
    // Home's links into New pick its filter, then the address takes them there
    if ((b = t.closest("a[data-newfilter]"))) D.newFilter = b.getAttribute("data-newfilter");
    if ((b = t.closest("[data-period]"))) { D.chart = { period: b.getAttribute("data-period"), id: null }; renderBrowse(); return writeAddress(); }
    if ((b = t.closest(".d-chip[data-gtab]"))) { D.genreTab = b.getAttribute("data-gtab"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-djtab]"))) { D.djTab = b.getAttribute("data-djtab"); return renderBrowse(); }
    if ((b = t.closest(".d-showall"))) {
      D.showAll[b.getAttribute("data-showall")] = true;
      var rowsBox = b.previousElementSibling;
      if (rowsBox) {
        rowsBox.classList.remove("d-capped");
        var next = rowsBox.querySelectorAll(".hist-entry")[CAP];
        if (next) { var go = next.querySelector("button, a, [tabindex]"); if (go) go.focus(); }
      }
      return b.remove();
    }
    if ((b = t.closest(".d-chip[data-djsort]"))) { D.djSort = b.getAttribute("data-djsort"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-decade]"))) { D.mapDecade = b.getAttribute("data-decade") || null; return renderBrowse(); }
    if ((b = t.closest(".d-homemore"))) { var k = b.getAttribute("data-more"); D.homeMore[k] = !D.homeMore[k]; return renderBrowse(); }
    if ((b = t.closest("#dSearchOpen"))) return openSearch();
    if (t.closest(".d-import")) return D.importMeta && firetable.importer.open(D.importMeta);
    if ((b = t.closest(".d-sheetlink"))) { e.preventDefault(); return openSheet(songFrom(b)); }
    if ((b = t.closest("#thehistory .pv-dj-avatar, #thediscovers .pv-dj-avatar"))) {
      var key = djKey(b.getAttribute("data-avatar-uid"), b.getAttribute("aria-label"));
      if (key) { location.hash = "#discover/djs/" + key; return; }
    }
    if ((b = t.closest(".d-ytsearch"))) return searchYouTube(D.sub || "");
    if ((b = t.closest(".d-playall"))) return play(b.getAttribute("data-list"), 0);
    if ((b = t.closest(".d-saveall"))) return saveAll(b.getAttribute("data-list"));
    if (t.closest(".d-pickcards")) {
      // the card case is in Live
      setMode("live");
      if (firetable.nav && firetable.nav.setView) firetable.nav.setView("cards");
      return;
    }
    if ((b = t.closest(".d-card[data-card]"))) return firetable.actions.viewLargerCard && firetable.actions.viewLargerCard("dj" + b.getAttribute("data-card"));
    if ((b = t.closest(".d-joinwait"))) return hopOn();
    if ((b = t.closest(".d-radio"))) return playRadio(b.getAttribute("data-slug"));
    if ((b = t.closest(".d-more"))) { e.stopPropagation(); return openMenu(b); }
    if ((b = t.closest("#dMenu [data-share]"))) { e.preventDefault(); var how = b.getAttribute("data-share"); closeMenu(true); return how === "link" ? copyLink() : how === "image" ? chartImage() : embedDialog(); }
    if ((b = t.closest("#dMenu [data-act]"))) { e.preventDefault(); return menuAct(b); }
    if ((b = t.closest("#dMenu a"))) { closeMenu(); return; }
    if (!t.closest("#dMenu")) closeMenu();
    if ((b = t.closest("[data-layout]"))) { D.newLayout = b.getAttribute("data-layout"); store.set("ft-new-layout", D.newLayout); return renderBrowse(); }
    if ((b = t.closest("[data-step]"))) {
      var ids = Object.keys(D.data.chartIds[D.chart.period] || {}).sort();
      var at = ids.indexOf(D.chart.id || currentId(D.chart.period)) + Number(b.getAttribute("data-step"));
      if (ids[at]) { D.chart.id = ids[at]; renderBrowse(); writeAddress(); }
      return;
    }
    if ((b = t.closest(".d-share"))) { e.stopPropagation(); return openShareMenu(b); }
    if ((b = t.closest(".d-toggle"))) return togglePause();
    if ((b = t.closest(".d-reload"))) return P.track && play(P.list, P.i, Math.max(0, P.at - 2), true);
    if ((b = t.closest(".d-next"))) return step(1);
    if ((b = t.closest(".d-prev"))) return step(-1);
    if ((b = t.closest(".d-mute"))) { firetable.actions.muteToggle(); return renderVolume(); }
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
    if ((b = t.closest(".d-createaccount, .d-login"))) return showSignIn(b.classList.contains("d-login") ? "login" : "create");
    if ((b = t.closest(".d-mini-open"))) return openFull(b);
    if (t.closest(".d-sheetclose")) { document.body.classList.remove("d-sheet-open"); return renderBar(); }
    if (t.closest(".pvf-playnext")) return step(1);
    if ((b = t.closest(".d-mini-row[data-list]"))) {
      // a song from a list beside Discover (the crate, a playlist): it plays in Discover
      if (D.mode !== "discover") setMode("discover", { remember: true });
      return play(b.getAttribute("data-list"), Number(b.getAttribute("data-i")));
    }
    var rowEl = t.closest("#dBrowse .pvbar[data-list], #dLockedPane .pvbar[data-list]");
    if (rowEl) {
      if (rowEl.closest("#dLockedPane") && t.closest(".d-play, .pv-art")) {
        var pick = Number(rowEl.getAttribute("data-i"));
        setMode("discover", { remember: true });
        return play(rowEl.getAttribute("data-list"), pick);
      }
      var list = rowEl.getAttribute("data-list"), i = Number(rowEl.getAttribute("data-i"));
      var track = lists[list] && lists[list].tracks[i];
      if (t.closest(".histeal")) { e.stopPropagation(); return track && save(track, t.closest(".histeal")); }
      if (t.closest(".tracklink-btn")) return;
      if (t.closest(".d-play, .pv-art")) return isPlaying(list, i) ? togglePause() : play(list, i);
    }
  }

  // ─── One Tab stop per song ───────────────────────────────────────────────
  // A card was five or six stops (play, title, each artist, ⋮, Add, the DJ):
  // Home's first row of six covers took 30 presses to cross. Each song in the
  // page is now one stop, its play button; ← and → walk the rest of that song,
  // the menu key opens ⋮, and Tab goes on to the next song. Every control
  // still works with the mouse, touch and a screen reader's own keys.
  var ROVE_STOPS = "button, a[href], [tabindex]";
  /** A song's box: the row with its DJ beside it, or the card. */
  function songBox(el) {
    var bar = el && el.closest && el.closest("#dBrowse .pvbar[data-list]");
    return bar ? (bar.closest(".hist-entry") || bar) : null;
  }
  function songStops(box) {
    return Array.prototype.filter.call(box.querySelectorAll(ROVE_STOPS), function (el) { return !el.disabled && el.getClientRects().length > 0; });
  }
  /** Leave each song one Tab stop. Runs as Tab is pressed, so it covers whatever was drawn since. */
  function rove() {
    var bars = document.querySelectorAll("#dBrowse .pvbar[data-list]");
    for (var n = 0; n < bars.length; n++) {
      var bar = bars[n];
      if (bar._roved) continue;
      bar._roved = true;
      var stops = songStops(bar.closest(".hist-entry") || bar);
      var play = bar.querySelector(".d-play");
      // (Settings can turn the play buttons off: then the title is the stop)
      var main = play && stops.indexOf(play) !== -1 ? play : stops.filter(function (el) { return el.classList.contains("d-sheetlink"); })[0] || stops[0];
      stops.forEach(function (el) {
        // "Play the week's 6" and "Save all" on the lead card are about the whole list, so they keep their stops
        if (el !== main && !el.classList.contains("butt")) el.setAttribute("tabindex", "-1");
      });
    }
  }
  function roveKey(e) {
    if (e.key === "Tab") return rove();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var box = songBox(e.target);
    if (!box || /^(input|textarea|select)$/i.test(e.target.tagName || "")) return;
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      var more = box.querySelector(".d-more");
      if (more) { e.preventDefault(); more.focus(); more.click(); }
      return;
    }
    if (e.shiftKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    var stops = songStops(box), at = stops.indexOf(e.target);
    if (at === -1) return;
    e.preventDefault();
    var to = stops[at + (e.key === "ArrowRight" ? 1 : -1)];
    if (to) to.focus();
  }

  /** Make a playlist the one the room plays from when you DJ (as All Playlists does). */
  function djFrom(id) {
    if (!D.signedIn || djList() === id) return;
    ftapi.actions.switchDjList(id);
    $("#djlistpicker").val(id);
    if (ftapi.users && ftapi.users[ftapi.uid]) ftapi.users[ftapi.uid].selectedList = id;
    if (firetable.ui.renderPlaylistIndex) firetable.ui.renderPlaylistIndex();
    firetable.ui.toast("You DJ from " + firetable.utilities.listName(id) + " now", "success");
    renderSide();
  }

  /** Play a list in a shuffled order, here only: the list itself keeps its order. */
  function shufflePlay(name) {
    var list = lists[name];
    if (!list || !list.tracks.length) return;
    var all = list.tracks.slice();
    for (var i = all.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = all[i]; all[i] = all[j]; all[j] = x; }
    setList("shuffle", list.label + " · shuffled", all);
    play("shuffle", 0);
  }

  /** A genre's radio: its favorites, new finds and deep cuts, shuffled. */
  function playRadio(slug) {
    var page = libData["genre/" + slug];
    var g = (libData.genres || {})[slug];
    if (!page || !g) return;
    var seen = {};
    var all = withType([].concat(page.fav || [], page.newHere || [], page.deep || [])).filter(function (t) {
      var k = t.type + "_" + t.cid;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    for (var i = all.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = all[i]; all[i] = all[j]; all[j] = x; }
    setList("radio", g.name + " radio", all);
    play("radio", 0);
  }

  // ─── A song's menu (⋮) ──────────────────────────────────────────────────

  var menuTrack = null;
  function menuEl() {
    var m = document.getElementById("dMenu");
    if (m) return m;
    m = document.createElement("div");
    m.id = "dMenu";
    m.setAttribute("role", "menu");
    m.hidden = true;
    document.body.appendChild(m);
    // phones: the menu is a sheet from the bottom; a tap on the page around it only closes it (4.4)
    var scrim = document.createElement("div");
    scrim.id = "dMenuScrim";
    scrim.setAttribute("aria-hidden", "true");
    m.insertAdjacentElement("afterend", scrim);
    m.addEventListener("keydown", function (e) {
      var items = Array.prototype.slice.call(m.querySelectorAll("[role=menuitem]"));
      var at = items.indexOf(document.activeElement);
      if (e.key === "Escape") { closeMenu(true); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
      }
    });
    return m;
  }
  var menuButton = null;
  function openMenu(btn) {
    var rowEl = btn.closest("[data-list]");
    var list = rowEl && lists[rowEl.getAttribute("data-list")];
    var t = list && list.tracks[Number(rowEl.getAttribute("data-i"))];
    if (!t) return;
    var m = menuEl();
    if (!m.hidden && menuButton === btn) return closeMenu();
    menuTrack = t;
    menuButton = btn;
    var item = function (icon, label, attrs) {
      return '<a role="menuitem" tabindex="-1" class="d-menuitem" ' + attrs + ">" + ms(icon) + "<span>" + label + "</span></a>";
    };
    // the shared items (firetable.songMenu), in their shared order and words
    var I = firetable.songMenu.ITEMS;
    var act = function (name, label) { return item(I[name].icon, label || I[name].label, 'href="#" data-act="' + name + '"'); };
    var h = "";
    var url = linkOf(t);
    h += act("toroom", D.signedIn ? null : "Join to play it in the room");
    h += act("sheet");
    if (D.signedIn) h += act("add");
    if (url) h += item(I.open.icon, Number(t.type || 1) === MEDIA_YOUTUBE ? "Open on YouTube" : "Open on SoundCloud", 'href="' + esc(url) + '" target="_blank" rel="noopener"');
    artistsOf(t.a).slice(0, 3).forEach(function (a) { h += item("person", "Go to " + esc(a), 'href="#discover/artist/' + esc(artistSlug(a)) + '"'); });
    if (t.g) h += item("category", "More " + esc(t.g), 'href="#discover/genres/' + esc(genreSlug(t.g)) + '"');
    var dj = t.dj ? djShown(t.djid, t.dj) : null;
    var key = dj && djKey(dj.uid, dj.name);
    if (key) h += item("headphones", esc(dj.name) + "'s DJ page", 'href="#discover/djs/' + esc(key) + '"');
    if (url) h += act("copy");
    m.innerHTML = h;
    m.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    var r = btn.getBoundingClientRect();
    var w = m.offsetWidth, hh = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + "px";
    m.style.top = (r.bottom + hh + 8 > window.innerHeight ? Math.max(8, r.top - hh - 4) : r.bottom + 4) + "px";
    var first = m.querySelector("[role=menuitem]");
    if (first) first.focus();
  }
  function closeMenu(refocus) {
    var m = document.getElementById("dMenu");
    if (!m || m.hidden) return;
    m.hidden = true;
    if (menuButton) {
      menuButton.removeAttribute("aria-expanded");
      if (refocus && menuButton.isConnected) menuButton.focus();
    }
    menuButton = null;
  }
  function menuAct(b) {
    var act = b.getAttribute("data-act");
    var t = menuTrack, opener = menuButton;
    closeMenu(true);
    if (act === "toroom" && t) return toRoom(t);
    if (act === "sheet" && t) return openSheet(t);
    if (act === "add" && t) return save(t, opener || b);
    if (act === "copy" && t) firetable.songMenu.copyLink(linkOf(t));
  }

  function save(t, btn) {
    if (!D.signedIn) return saveToCrate(t);
    firetable.actions.openStealPicker($(btn), { cid: t.cid, type: Number(t.type || 1), title: (t.a ? t.a + " - " : "") + t.t, img: t.img || artOf(t), url: t.url || "", djid: t.djid || "", from: "discover" }, "left");
  }

  /**
   * Join or log in without leaving the page: the site's sign-in dialog
   * (users.js openAuth), with a word about the visitor's crate.
   * @param {"create"|"login"} which
   */
  function showSignIn(which) {
    var keep = document.getElementById("keepCrateBox");
    if (keep && keep.open) keep.close();
    if (D.signedIn) return;
    lockedTab = "join"; // the form, whatever tab Live was showing
    lockedTabs();
    var n = crate().length;
    firetable.ui.openAuth(which, { note: n
      ? "Your crate of " + firetable.utilities.pluralize(n, "song", "songs") + " comes with you. It becomes a playlist you can play for the room."
      : null });
  }

  // ─── Every name is a door: Live's lists and stage, and the song sheet ───
  // Live's Recent, Fresh and stage are drawn by room.js; this only adds to
  // what's there, watching for new rows: artist names link to their pages,
  // a DJ's robot to their DJ page, and a song's title opens its sheet.

  function linkLive(root) {
    root.querySelectorAll(".hist-track-artist, .fresh-track-artist, #artist").forEach(function (el) {
      if (el.closest("#dBrowse")) return;
      var text = el.textContent;
      if (!text || el.getAttribute("data-linked") === text) return;
      el.setAttribute("data-linked", text);
      el.innerHTML = artistLinks(text);
    });
    root.querySelectorAll(".hist-track-title, .fresh-track-title, #track").forEach(function (el) {
      if (el.closest("#dBrowse") || el.classList.contains("d-sheetlink")) return;
      el.classList.add("d-sheetlink");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("title", "About this song");
    });
  }
  function watchLive() {
    var grid = document.getElementById("mainGrid");
    if (!grid || !window.MutationObserver) return;
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; linkLive(document); });
    }).observe(grid, { childList: true, subtree: true, characterData: true });
    linkLive(document);
  }

  /** A song from a title someone tapped: in Discover's lists, Live's rows or the stage. */
  function songFrom(el) {
    var src = el.getAttribute && el.getAttribute("data-src");
    if (src === "discover") return P.track;
    if (src === "live") return liveTrack();
    var rowEl = el.closest("[data-list]");
    if (rowEl && rowEl.closest("#dBrowse")) {
      var l = lists[rowEl.getAttribute("data-list")];
      return l && l.tracks[Number(rowEl.getAttribute("data-i"))];
    }
    if (el.id === "track") return liveTrack();
    var bar = el.closest(".pvbar");
    if (!bar || !bar.getAttribute("data-cid")) return null;
    var avatar = (bar.closest(".hist-entry") || bar).querySelector(".pv-dj-avatar");
    var artistEl = bar.querySelector(".hist-track-artist, .fresh-track-artist");
    return { type: Number(bar.getAttribute("data-type") || 1), cid: bar.getAttribute("data-cid"), a: artistEl ? artistEl.textContent : "", t: el.textContent,
      img: bar.getAttribute("data-img") || null, url: (bar.querySelector(".tracklink-btn") || {}).href || null,
      dj: avatar && avatar.getAttribute("aria-label"), djid: avatar && avatar.getAttribute("data-avatar-uid") };
  }

  var sheetTrack = null;
  function openSheet(t) {
    if (!t || !t.cid) return;
    sheetTrack = t;
    var dlg = document.getElementById("dSheetBox");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "dSheetBox";
      dlg.setAttribute("aria-labelledby", "dSheetTitle");
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) {
        var b;
        if (e.target === dlg || e.target.closest(".closeModal")) return dlg.close();
        if (e.target.closest("a[href^='#discover']")) return dlg.close();
        if ((b = e.target.closest(".d-sheetplay"))) {
          dlg.close();
          setList("sheet", "Song", [sheetTrack]);
          if (D.mode !== "discover") setMode("discover", { remember: true });
          return play("sheet", 0);
        }
        if ((b = e.target.closest(".d-sheetsave"))) return save(sheetTrack, b);
        if ((b = e.target.closest(".d-sheetcopy"))) firetable.songMenu.copyLink(linkOf(sheetTrack));
      });
    }
    var link = linkOf(t);
    var saved = firetable.saved.where(t.type, t.cid);
    dlg.innerHTML = '<div class="modalBox"><div class="modalHeader"><h2 id="dSheetTitle">About this song</h2>' +
      '<button type="button" class="butt graybutt iconbutt closeModal" title="Close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="modalContent d-sheet"><div class="d-sheethead"><span class="d-cover" style="background-image:url(' + esc(artOf(t)) + ')"></span>' +
      '<div class="d-now"><span class="d-title">' + esc(t.t) + '</span><span class="d-artist">' + artistLinks(t.a) + "</span>" +
      '<div class="d-tags" id="dSheetTags"></div></div></div>' +
      '<div class="d-hist" id="dSheetHist"><p>' + ms("hourglass_empty") + "Looking it up…</p></div>" +
      '<div class="d-actions"><button type="button" class="butt d-panelmain d-sheetplay">' + ms("play_arrow", true) + "<span>Play" + (D.mode === "discover" ? "" : " in Discover") + "</span></button>" +
      '<button type="button" class="butt graybutt d-sheetsave' + (saved ? " is-saved" : "") + '">' + ms(saved ? "playlist_add_check" : "playlist_add") + "<span>" + (saved ? "Saved" : "Save") + "</span></button>" +
      (link ? '<a class="butt graybutt iconbutt" href="' + esc(link) + '" target="_blank" rel="noopener" title="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '" aria-label="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '">' + ms("open_in_new") + "</a>" +
        '<button type="button" class="butt graybutt iconbutt d-sheetcopy" title="Copy the song\'s link" aria-label="Copy the song\'s link">' + ms("link") + "</button>" : "") +
      "</div></div></div>";
    if (!dlg.open) dlg.showModal();
    loadDetails(t).then(function (d) {
      if (sheetTrack !== t) return;
      var tags = (d.genres || []).slice(0, 3).map(function (g) { return '<a class="d-tag" href="#discover/genres/' + esc(genreSlug(g)) + '">' + esc(g) + "</a>"; });
      if (t.rel) tags.push('<span class="d-tag d-numtag">' + esc(t.rel.slice(0, 4)) + "</span>");
      if (d.bpm) tags.push(tempoTag(d.bpm));
      tags.push('<span class="d-tag">' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + "</span>");
      var lines = [];
      if (t.now) {
        var on = t.dj ? djShown(t.djid, t.dj) : null;
        lines.push((on ? robotLink(on) : '<i class="d-dot" aria-hidden="true"></i>') + "<span>playing in the room now" + (on ? ", " + nameLink(on) + " on deck" : "") + "</span>");
      }
      var plays = d.plays || t.plays;
      if (plays) lines.push("<span><b>" + esc(firetable.utilities.pluralize(plays, "play", "plays")) + "</b> in the room</span>");
      var first = d.first ? djShown(null, d.firstDj) : null;
      if (d.first) lines.push((first ? robotLink(first) : "") + "<span>first played " + esc(firetable.utilities.shortDate(d.first)) + (first ? " by " + nameLink(first) : "") + "</span>");
      if (d.last && d.last !== d.first) {
        var last = djShown(null, d.lastDj);
        lines.push((last ? robotLink(last) : "") + "<span>last played " + esc(firetable.utilities.shortDate(d.last)) + (last ? " by " + nameLink(last) : "") + "</span>");
      }
      if (d.versions > 1) lines.push("<span>" + esc(d.versions) + " versions of this song have played here</span>");
      if (!plays && !d.first && !t.now) lines.push("<span>Nobody has played this live yet. It could be you.</span>");
      var tg = document.getElementById("dSheetTags"), hi = document.getElementById("dSheetHist");
      if (tg) tg.innerHTML = tags.join("");
      if (hi) hi.innerHTML = lines.map(function (l) { return "<p>" + l + "</p>"; }).join("");
    });
  }

  // ─── Sharing a chart: a link, an image, an embed ────────────────────────

  function openShareMenu(btn) {
    var m = menuEl();
    if (!m.hidden && menuButton === btn) return closeMenu();
    menuButton = btn;
    var item = function (icon, label, how) { return '<a role="menuitem" tabindex="-1" class="d-menuitem" href="#" data-share="' + how + '">' + ms(icon) + "<span>" + label + "</span></a>"; };
    m.innerHTML = item("link", "Copy a link", "link") + item("image", "Save as an image", "image") + item("code", "Put it on your site", "embed");
    m.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    var r = btn.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + "px";
    m.style.top = (r.bottom + 4) + "px";
    m.querySelector("[role=menuitem]").focus();
  }

  /** The chart on show as a picture (1080 × 1350, for posts and stories), drawn here. */
  function chartImage() {
    var period = D.chart.period;
    var id = D.chart.id || currentId(period);
    var c = D.data.charts[period + "/" + id];
    var rows = chartRows(c).slice(0, 10);
    if (!rows.length) return firetable.ui.toast("This chart has no songs yet.");
    firetable.ui.toast("Making the image…");
    var W = 1080, H = 1350, PAD = 72;
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var g = canvas.getContext("2d");
    var load = function (src) {
      return new Promise(function (ok) {
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () { ok(img); };
        img.onerror = function () { ok(null); };
        img.src = src;
      });
    };
    var fonts = document.fonts && document.fonts.load ? Promise.all(["700 40px Inter", "500 30px Inter", "400 24px Inter", "700 28px 'Roboto Mono'"].map(function (f) { return document.fonts.load(f); })) : Promise.resolve();
    Promise.all([fonts, load("img/idlogo.png")].concat(rows.map(function (t) { return load(artOf(t)); }))).then(function (got) {
      var logo = got[1];
      var arts = got.slice(2);
      var fit = function (text, max) {
        text = String(text || "");
        if (g.measureText(text).width <= max) return text;
        while (text.length > 1 && g.measureText(text + "…").width > max) text = text.slice(0, -1);
        return text + "…";
      };
      g.fillStyle = "#181818";
      g.fillRect(0, 0, W, H);
      if (logo) g.drawImage(logo, PAD, PAD, 96, 48);
      g.fillStyle = "#b3b3b3";
      g.font = "700 22px Inter";
      g.fillText(String(ftconfigs.roomName || "").toUpperCase(), PAD + 120, PAD + 34);
      g.fillStyle = "#ffffff";
      g.font = "700 64px Inter";
      g.fillText("Room chart", PAD, PAD + 150);
      g.fillStyle = "#cc9933";
      g.font = "500 30px Inter";
      g.fillText(fit(chartTitle(period, id), W - PAD * 2), PAD, PAD + 200);
      var top = PAD + 260, rowH = 86;
      rows.forEach(function (t, i) {
        var y = top + i * rowH;
        g.fillStyle = "#ffffff";
        g.font = "700 28px 'Roboto Mono'";
        g.textAlign = "right";
        g.fillText(String(i + 1), PAD + 40, y + 46);
        g.textAlign = "left";
        var art = arts[i];
        var ax = PAD + 64, aw = 112, ah = 63;
        g.fillStyle = "#282828";
        g.fillRect(ax, y + 8, aw, ah);
        if (art) {
          var sh = art.width * (ah / aw) > art.height ? art.height : art.width * (ah / aw);
          g.drawImage(art, 0, (art.height - sh) / 2, art.width, sh, ax, y + 8, aw, ah);
        }
        var tx = ax + aw + 28, tw = W - PAD - tx - 170;
        g.fillStyle = "#ffffff";
        g.font = "500 30px Inter";
        g.fillText(fit(t.t, tw), tx, y + 36);
        g.fillStyle = "#b3b3b3";
        g.font = "400 24px Inter";
        g.fillText(fit(t.a, tw), tx, y + 68);
        g.fillStyle = "#888888";
        g.font = "400 22px 'Roboto Mono'";
        g.textAlign = "right";
        g.fillText(firetable.utilities.pluralize(t.plays, "play", "plays"), W - PAD, y + 50);
        g.textAlign = "left";
        g.fillStyle = "#333333";
        g.fillRect(PAD, y + rowH - 2, W - PAD * 2, 1);
      });
      g.fillStyle = "#cc9933";
      g.font = "500 26px Inter";
      g.fillText(location.host.replace(/^www\./, "") + "/music/charts/", PAD, H - PAD + 10);
      canvas.toBlob(function (blob) {
        if (!blob) return firetable.ui.toast("Couldn't make the image.", "error");
        var name = "room-chart-" + (period === "all" ? "all-time" : id) + ".png";
        var file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
          navigator.share({ files: [file], title: "Room chart · " + chartTitle(period, id) }).catch(function () {});
          return;
        }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        firetable.ui.toast("Saved " + name, "success");
      }, "image/png");
    });
  }

  /** The code to put the chart on another site, always showing the latest. */
  function embedDialog() {
    var period = D.chart.period;
    var src = location.origin + "/embed/chart/?period=" + period + (D.chart.id && period !== "all" ? "&id=" + encodeURIComponent(D.chart.id) : "");
    var code = '<iframe src="' + src + '" width="400" height="640" style="border:0;border-radius:8px" title="' + (ftconfigs.roomName || "Room") + ' chart" loading="lazy"></iframe>';
    var dlg = document.getElementById("dEmbedBox");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "dEmbedBox";
      dlg.setAttribute("aria-labelledby", "dEmbedTitle");
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) {
        if (e.target.closest(".closeModal") || e.target === dlg) return dlg.close();
        if (e.target.closest(".d-copycode")) {
          var text = dlg.querySelector("textarea").value;
          var done = function () { firetable.ui.toast("Code copied", "success"); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { dlg.querySelector("textarea").select(); });
          else dlg.querySelector("textarea").select();
        }
      });
    }
    dlg.innerHTML = '<div class="modalBox"><div class="modalHeader"><h2 id="dEmbedTitle">Put the chart on your site</h2>' +
      '<button type="button" class="butt graybutt iconbutt closeModal" title="Close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="modalContent d-embed"><p>Paste this where the chart should go. ' + (D.chart.id && period !== "all" ? "It shows this chart." : "It always shows the latest " + (period === "all" ? "all-time chart" : period + "'s chart") + ".") +
      " Each song links back here.</p>" +
      '<textarea readonly rows="4" aria-label="The code">' + esc(code) + "</textarea>" +
      '<button type="button" class="butt d-copycode">Copy the code</button>' +
      '<iframe src="' + esc(src) + '" width="400" height="640" title="Preview" loading="lazy"></iframe></div></div>';
    if (!dlg.open) dlg.showModal();
  }

  function copyLink() {
    var url = location.href.split("#")[0] + addressFor();
    var done = function () { firetable.ui.toast("Link copied", "success"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { firetable.ui.toast(url); });
    else firetable.ui.toast(url);
  }

  // ─── Build the page ─────────────────────────────────────────────────────

  function build() {
    // a page from search comes with its Discover page filled in: start from that
    var filled = document.querySelector("#discoverPage #dBrowse[data-prerendered]");
    var filledHtml = filled ? filled.innerHTML : null;
    var old = document.getElementById("discoverPage");
    if (old) old.parentNode.removeChild(old);

    var tabs = document.createElement("div");
    tabs.id = "modeTabs";
    tabs.className = "tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Discover or Live");
    tabs.innerHTML = '<button type="button" role="tab" class="tab" data-mode="discover" aria-selected="false">Discover</button>' +
      '<button type="button" role="tab" class="tab" data-mode="live" aria-selected="false"><i class="d-dot" aria-hidden="true"></i>Live</button>';
    document.getElementById("topbar").appendChild(tabs);
    // one search for both sides: from Live, the button opens it in Discover
    var utils = document.getElementById("topbarUtils");
    if (utils && !document.getElementById("dSearchOpen")) {
      var sb = document.createElement("button");
      sb.type = "button";
      sb.id = "dSearchOpen";
      sb.className = "header_icon";
      sb.title = "Search the library (/)";
      sb.setAttribute("aria-label", "Search the library");
      sb.innerHTML = ms("search");
      utils.insertBefore(sb, utils.firstChild);
    }

    var page = document.createElement("div");
    page.id = "discoverPage";
    page.setAttribute("role", "region");
    page.setAttribute("aria-label", "Discover");
    page.innerHTML = '<div id="dRail">' +
      '<form id="dSearch" role="search"><i class="material-symbols-outlined" aria-hidden="true">search</i>' +
      '<input type="search" id="dQ" placeholder="Search artists, songs, genres, DJs" aria-label="Search the library" autocomplete="off" enterkeyhint="search" /></form>' +
      '<nav id="dNav" aria-label="Discover">' +
      VIEWS.map(function (v) { return '<button type="button" class="d-nav" data-view="' + v.id + '">' + ms(v.icon) + "<span>" + esc(v.label) + "</span></button>"; }).join("") +
      '<button type="button" class="d-nav d-chatnav">' + ms("forum") + "<span>Chat</span></button>" +
      '</nav></div><div id="dBrowse" class="scroll-view"></div><section id="dSide" aria-label="Playlists and chat"></section>';
    var grid = document.getElementById("mainGrid");
    grid.appendChild(page);
    // the player along the bottom of the whole site, under Discover and Live alike
    var oldBar = document.getElementById("dMini");
    if (oldBar) oldBar.parentNode.removeChild(oldBar);
    grid.insertAdjacentHTML("afterend", barHtml());
    var oldTabs = document.getElementById("nav-tabs");
    if (oldTabs) oldTabs.parentNode.removeChild(oldTabs);
    document.getElementById("dMini").insertAdjacentHTML("afterend", tabsHtml());
    if (filledHtml) {
      document.getElementById("dBrowse").innerHTML = filledHtml;
      D.prerendered = true;
    }

    // visitors' Live: the chat, above Fresh
    var fresh = document.getElementById("discover");
    if (fresh) {
      var peek = document.createElement("div");
      peek.id = "chatPeek";
      peek.hidden = true;
      fresh.insertBefore(peek, fresh.firstChild);
    }
  }

  /** The player bar's frame: renderBar fills it in. */
  function barHtml() {
    return '<div id="dMini" class="pb is-quiet" role="region" aria-label="Player">' +
      '<span class="pb-line" aria-hidden="true"><i id="dMiniBar"></i></span>' +
      '<div class="pb-now">' +
      '<button type="button" id="pv-art" class="pb-art d-mini-open" aria-label="Open the full-screen player" aria-haspopup="dialog"><span class="pb-cover"></span><span class="pb-face"></span></button>' +
      '<div class="pb-text"><span class="pb-src" id="pv-src"></span><span class="pb-title" id="pv-title"></span><span class="pb-artist" id="pv-artist"></span></div>' +
      '<div class="pb-keep"><span class="pb-host" id="pv-livekeep"></span><span class="pb-host" id="pv-dkeep"></span></div></div>' +
      '<div class="pb-mid"><div class="pb-transport" id="pv-transport"></div>' +
      '<div class="pb-time"><span id="dAt" class="pb-at"></span><span class="pb-track"><span class="d-bar"><i id="dBar"></i></span>' +
      '<input type="range" id="pv-seek" min="0" max="1" step="1" value="0" aria-label="Seek" /></span><span id="dLen" class="pb-len"></span></div></div>' +
      '<div class="pb-side"><div class="pb-acts"><span class="pb-host" id="pv-liveacts"></span><span class="pb-host" id="pv-dacts"></span></div>' +
      '<div class="pb-switch" id="pv-switch"></div>' +
      '<div class="pb-vol"><button type="button" class="butt graybutt iconbutt d-mute" aria-label="Mute">' + ms("volume_up") + "</button>" +
      '<input type="range" id="pv-vol" min="0" max="100" step="5" value="50" aria-label="Volume" /></div>' +
      // the stage's screen, reload and full screen (placeStage moves them in)
      '<div class="pb-tools"><span class="pb-host" id="pv-tools"></span></div>' +
      '<button type="button" class="butt graybutt iconbutt pb-expand" title="Open the player" aria-label="Open the full-screen player" aria-haspopup="dialog">' + ms("expand_less") + "</button></div>" +
      '<span id="pv-announce" class="sr-only" aria-live="polite"></span></div>';
  }

  // the room's player says a Discover song ended or couldn't play
  function onEnded() {
    if (firetable.preview !== "discover" || !discoverActive()) return;
    failures = 0;
    step(1);
  }
  // three songs in a row that can't play: something's blocking the player,
  // so stop instead of running through the whole list
  var failures = 0;
  function onFailed() {
    if (firetable.preview !== "discover" || !discoverActive()) return;
    failures++;
    if (failures >= 3) {
      failures = 0;
      P.paused = true;
      refreshSide();
      firetable.ui.toast("These songs won't play in this browser right now. A blocker or the network may be stopping YouTube.", "error");
      return;
    }
    firetable.ui.toast("That song can't play here. Skipping it.");
    // unless they've gone to Live or Listen in meanwhile
    setTimeout(function () { if (firetable.preview === "discover" && discoverActive()) step(1); }, 800);
  }

  function signedIn(on) {
    D.signedIn = on;
    document.body.classList.toggle("d-member", !!on);
    if (!on) { chatBack(); if (D.sideTab === "chat") D.sideTab = "list"; }
    if (on) firetable.ui.closeAuth();
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
    if (!on) P.inRoom = null;
    setMode(mode);
    renderSide();
    renderPeek();
  }

  function applyRoute(r) {
    if (r.view) {
      if (r.view !== D.view || r.sub !== D.sub) { D.genreTab = "fav"; D.djTab = null; D.showAll = {}; }
      D.view = r.view;
      D.sub = r.sub || null;
    }
    if (r.period) D.chart = { period: r.period, id: r.id || null };
  }

  return {
    init: function () {
      // Discover is part of the site (5.3): no config.js switch any more
      document.body.classList.add("ft-has-discover");
      D.newLayout = store.get("ft-new-layout", "grid") === "list" ? "list" : "grid";
      build();
      buildFull();
      // Live's way in: the stage's full-screen button opens the full-screen player (it fills the screen from there)
      var fsBtn = document.getElementById("fullscreenBtn");
      if (fsBtn) {
        fsBtn.hidden = false;
        fsBtn.setAttribute("aria-label", "Full-screen player");
        fsBtn.setAttribute("aria-haspopup", "dialog");
        var fsTip = document.getElementById("tip-fullscreenBtn");
        if (fsTip) fsTip.textContent = "Full-screen player (F)";
      }
      // the left column starts below the header, whatever its height
      var topbar = document.getElementById("topbar");
      var measure = function () { document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px"); };
      measure();
      if (window.ResizeObserver) new ResizeObserver(measure).observe(topbar);
      document.addEventListener("click", onClick);
      watchLive();
      var typed = null;
      document.addEventListener("input", function (e) {
        if (e.target.id === "pv-fvol") return setVolume(e.target.value);
        if (e.target.id === "pv-fseek") { D.seeking = true; var fat = document.getElementById("pv-fat"); if (fat) fat.textContent = clock(Number(e.target.value)); return; }
        if (e.target.id === "dQ") {
          clearTimeout(typed);
          var v = e.target.value;
          typed = setTimeout(function () {
            D.view = "search";
            D.sub = v.trim() || null;
            D.browse = false;
            renderRail();
            renderBrowse();
            writeAddress();
          }, 200);
          return;
        }
        if (e.target.id === "pv-plfilter") { D.plFilter = e.target.value; return applyFilter(); }
        if (e.target.id === "pv-vol") return setVolume(e.target.value);
        if (e.target.id === "pv-seek") { D.seeking = true; var at = document.getElementById("dAt"); if (at) at.textContent = clock(Number(e.target.value)); return; }
        if (e.target.id !== "dDjFind") return;
        D.djFind = e.target.value;
        var all = libData.djs || {};
        var box = document.getElementById("dDjList");
        if (box) box.innerHTML = djRows(Object.keys(all).map(function (k) { return Object.assign({ key: k }, all[k]); }));
      });
      document.addEventListener("keydown", roveKey, true);
      document.addEventListener("keydown", function (e) {
        var menuWasOpen = !!document.querySelector("#dMenu:not([hidden])");
        if (e.key === "Escape") closeMenu(true);
        if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("d-sheetlink")) { e.preventDefault(); openSheet(songFrom(e.target)); return; }
        // space, outside a text box or button: play / pause Discover's song
        var typing = /^(input|textarea|select|button|a)$/i.test(e.target.tagName || "") || e.target.isContentEditable || (e.target.closest && e.target.closest("[role=button], dialog"));
        var inText = /^(input|textarea|select)$/i.test(e.target.tagName || "") || e.target.isContentEditable;
        var plainKey = !e.ctrlKey && !e.metaKey && !e.altKey;
        // the full-screen player: F opens and closes it, V turns the screen on or off, Escape leaves
        if (F.open && e.key === "Escape" && !menuWasOpen && !document.querySelector("dialog[open]") && !$("#stealContain").is(":visible") &&
          !(e.target.closest && e.target.closest("#actualChat"))) {
          var pop = null;
          try { pop = document.querySelector(".ft-popover:popover-open"); } catch (x) { /* no popovers */ }
          if (!pop) { e.preventDefault(); closeFull(); return; }
        }
        if (plainKey && !inText && (e.key === "f" || e.key === "F") && !document.querySelector("dialog[open]")) { e.preventDefault(); if (F.open) closeFull(); else openFull(document.activeElement); return; }
        if (F.open && plainKey && !inText && (e.key === "v" || e.key === "V")) { e.preventDefault(); setFullView(fullView() === "video" ? "audio" : "video"); return; }
        if (F.open && e.key === " " && !typing && fullKind() !== "quiet") { e.preventDefault(); fullMain(); return; }
        if (e.key === " " && !typing && barKind() !== "quiet") {
          e.preventDefault();
          mainButton();
          return;
        }
        // Shift + arrows: next / previous in Discover's list
        if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft") && discoverActive() && !/^(input|textarea|select)$/i.test(e.target.tagName || "")) {
          e.preventDefault();
          step(e.key === "ArrowRight" ? 1 : -1);
          return;
        }
        // Escape closes the phone panel (menus and dialogs handle their own first)
        if (e.key === "Escape" && document.body.classList.contains("d-sheet-open") && !document.querySelector("dialog[open], #dMenu:not([hidden])")) {
          document.body.classList.remove("d-sheet-open");
          return;
        }
        // "/" anywhere outside a text box: search
        if (e.key === "/" && !/^(input|textarea|select)$/i.test((e.target.tagName || "")) && !e.target.isContentEditable) {
          e.preventDefault();
          openSearch();
        }
      });
      document.addEventListener("change", function (e) {
        if (e.target.id === "pv-seek" || e.target.id === "pv-fseek") { D.seeking = false; return seek(Number(e.target.value)); }
        if (e.target.id === "dNewShow") { D.newFilter = e.target.value; return renderBrowse(); }
        if (e.target.id === "dChartGenre") { D.chartGenre = e.target.value || null; return renderBrowse(); }
        if (e.target.id === "dChartWhich") { D.chartNew = e.target.value === "new"; return renderBrowse(); }
        if (e.target.id === "pv-listpick") {
          D.plFilter = ""; D.plAll = false;
          // the same switch as Live's Playlists picker: one list on screen across the site
          $("#listpicker").val(e.target.value).trigger("change");
        }
      });
      document.addEventListener("submit", function (e) {
        if (e.target.id !== "dSearch") return;
        e.preventDefault();
        var v = document.getElementById("dQ").value.trim();
        if (!v) return;
        clearTimeout(typed);
        setView("search", v);
        if (D.signedIn && yt.q !== v && !(firetable.importer && firetable.importer.parseLink(v))) searchYouTube(v);
      });
      window.addEventListener("resize", function () { closeMenu(); });
      document.addEventListener("scroll", function () { closeMenu(); }, true);
      // DJ pages, for linking names (a small list); after the page has settled
      setTimeout(function () { lib("djs"); }, 2500);
      window.addEventListener("hashchange", function () {
        var r = route();
        if (!r) return;
        closeMenu();
        applyRoute(r);
        setMode(r.mode, { remember: true });
        if (r.mode === "discover") setView(D.view, D.sub);
      });
      // (SoundCloud's FINISH reaches onEnded through the widget's own binding, player.js)
      ftapi.events.on("loggedIn", function () { signedIn(true); });
      ftapi.events.on("loggedOut", function () { signedIn(false); });
      ftapi.events.on("newSong", function () {
        mapMarks();
        renderFull(true);
        yourTurn();
        if (D.src === "live" && liveTrack()) mediaSession(liveTrack(), true);
        renderBar();
      });
      // a mod fixed the room song's tags: the bar and Now playing follow
      // (after room.js, whose handler corrects firetable.song first)
      ftapi.events.on("tagUpdate", function (data) { setTimeout(function () { tagsFixed(data); }, 0); });
      // the room's seats and line: the bar's and panels' "you're next", Hop on
      var seats = firetable.utilities.oncePerFrame(function () {
        renderFull();
        var line = document.getElementById("pv-deckline");
        if (line) line.innerHTML = deckLine(viewList() === djList(), queueTracks().length);
        renderBar();
      });
      ["tableChanged", "waitlistChanged", "spotlightStateChanged"].forEach(function (ev) { ftapi.events.on(ev, seats); });
      // the browser holding the room's sound back (or letting it go) changes what the bar says
      // (and the stage's screen going up or down changes the full player's view)
      var wasBlocked = blocked(), wasScreen = fullView();
      new MutationObserver(function () {
        if (blocked() === wasBlocked && fullView() === wasScreen) return;
        wasBlocked = blocked();
        wasScreen = fullView();
        renderBar();
        renderFull();
      }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
      // the bar's height, for the phone's full player and the page's last row
      var barEl = document.getElementById("dMini"), tabsEl = document.getElementById("nav-tabs");
      if (barEl && window.ResizeObserver) {
        var barRo = new ResizeObserver(function () {
          document.documentElement.style.setProperty("--pb-h", (barEl.offsetHeight + (tabsEl ? tabsEl.offsetHeight : 0)) + "px");
        });
        barRo.observe(barEl);
        if (tabsEl) barRo.observe(tabsEl);
      }
      ftapi.events.on("usersChanged", firetable.utilities.oncePerFrame(function () {
        renderFull(); // "N here"
        renderBar();
        if (D.mode === "discover" && /^(home|charts|recent)$/.test(D.view)) renderBrowse();
      }));
      // a play, or its genre arriving a moment later: tonight's rings on the sound map
      ftapi.events.on("editedHistory", firetable.utilities.oncePerFrame(function () { setTimeout(mapMarks, 0); }));
      ftapi.events.on("newHistory", firetable.utilities.oncePerFrame(function () {
        setTimeout(mapMarks, 0);
        if (D.mode === "discover" && (D.view === "recent" || D.view === "home")) renderBrowse();
        renderFull(); // the song's plays
      }));
      // the room's tempo (room.js sets --beat first) and theme, for the full player
      ftapi.events.on("songBpm", function () { setTimeout(function () { renderFull(); }, 0); });
      ftapi.events.on("newTheme", function () { setTimeout(renderFullTools, 0); });
      // the stage's colour changed (each song, set by room.js first): the bar and the full player follow
      ftapi.events.on("colorsChanged", function () { setTimeout(function () { renderBar(); renderFull(); }, 0); });
      var chatLoaded = false;
      ftapi.events.on("chatHistoryLoaded", function () { chatLoaded = true; });
      ftapi.events.on("newChat", function (c) {
        if (!chatLoaded || !D.signedIn || D.mode !== "discover" || D.sideTab === "chat" || (c && c.id === ftapi.uid)) return;
        D.unread = (D.unread || 0) + 1;
        var bar = document.querySelector("#dSide .d-sidetabs");
        if (bar) bar.outerHTML = sideTabs();
        var nav = document.querySelector(".d-chatnav .d-unread");
        if (nav) nav.textContent = D.unread > 99 ? "99+" : D.unread;
        else if (document.querySelector(".d-chatnav")) document.querySelector(".d-chatnav").insertAdjacentHTML("beforeend", '<span class="d-unread">' + D.unread + "</span>");
      });
      ftapi.events.on("playlistChanged", firetable.utilities.oncePerFrame(function () {
        if (D.mode === "discover" && D.signedIn && D.sideTab === "list") renderSide();
      }));
      // before sign-in is known: visitors' default, so the page isn't empty
      var r = route();
      if (r) applyRoute(r);
      setMode((r && r.mode) || store.get(MODE_KEY, null) || "discover");
    },
    onEnded: onEnded,
    onFailed: onFailed,
    /** True when the full-screen player is here (Discover on): the stage's full-screen button opens it. */
    fullPlayer: function () { return true; },
    /** "About this song" for any song: {cid, type, t (title), a (artist)[, url][, img]} (firetable.songMenu.sheet) */
    songSheet: function (t) { openSheet(t); },
    /** Open or close the full-screen player (for tests, and a way in from elsewhere). */
    openFull: function () { openFull(); },
    closeFull: function () { closeFull(); },
    /** A member's DJ page address, when they have one (for the room's user card). */
    djPage: function (uid, name) {
      var key = djKey(uid, name);
      return key ? "#discover/djs/" + key : null;
    },
    /** Picks changed in the card case: read them again on the next DJ page. */
    forgetFeatured: function (uid) { delete featuredData[uid]; delete featuredAsk[uid]; },
    /**
     * The Discover song this person is hearing, for Last.fm (lastfm.js), or
     * null when none is (paused, Live, the room stopped). play changes with
     * each new listen of a song.
     */
    hearing: function () {
      if (!discoverActive() || P.paused || firetable.preview !== "discover") return null;
      var t = P.track;
      return { play: P.play, cid: t.cid, type: Number(t.type || 1), artist: t.a || "", title: t.t || "", duration: P.len || t.dur || 0 };
    },
    /** For tests: act as signed in or out without a real sign-in. */
    testSignedIn: signedIn,
    /** The bottom tab bar follows Live's tabs too (firetable.nav.apply). */
    renderTabs: function () { renderTabs(); },
    /** For tests: what's on screen. */
    state: function () { return { tab: navTab(), browse: !!D.browse, mode: D.mode, view: D.view, listening: D.listening, playing: P.track && P.track.cid, list: P.list, i: P.i, full: F.open, fullView: fullView() }; }
  };
})();
