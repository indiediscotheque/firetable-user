/**
 * discover.js — Discover: the library side of the site.
 *
 * Always on (it was the config.js option `discover: true` until 5.3). A
 * Discover / Live switch sits in the header, by the room theme. Visitors open the site on Discover,
 * members on Live, and each person's last choice is remembered.
 *
 * Discover is its own page with the site's own parts: the left column keeps
 * the header and theme, then search and the views; the middle shows the
 * library; the right column is playlists (Live's own panel, js/discover-queue.js;
 * the crate for visitors) and chat. The player is
 * the bar along the bottom, which also carries the room (On air / Live, Listen
 * live), so there's no separate room line. The bar opens the full-screen player:
 * the song in full and what goes with it (who found it, up next, the decks,
 * the chat), for a TV or a second screen, in Discover and in Live.
 *
 * Views: Home, New, Fresh (js/discover-fresh.js), Charts, Genres, DJs, Years,
 * Recent plays, and a page for each genre, DJ, artist, year and tempo (BPM). The bot publishes the charts, new
 * releases and a chat peek under discover/ (firetable-hostbot's
 * lib/discover.js); the weekly play history job publishes the library pages
 * under discover/lib/ (tools/history/library.js). Song details come from the
 * play history (globalTracks, globalSongs) and tempos (bpm/), all public.
 * DJs who turned off "Show my name on public pages" have no page and show as
 * nobody.
 *
 * Playback uses the room's own players, the way 30-second previews do:
 * firetable.preview = "discover" stops the room from re-syncing, and going
 * back to Live (or Listen live) picks the room up where it is now. Discover
 * plays whole songs, and they're scrobbled like the room's (lastfm.js asks
 * hearing() what's sounding).
 *
 * Visitors save songs to a crate kept in this browser. The third save offers
 * to keep it; when they join, it becomes a playlist ("My Discover crate"),
 * their DJ playlist if they have none yet. "Go to Live" shows Live as
 * visitors see it today (the chat is for members only).
 *
 * Addresses. A page of the library has a real one, the same address its page
 * for search engines is served from (tools/plain-pages.mjs), so a link someone
 * copies, shares or follows from a search is one address with one preview:
 *   /music/new/, /music/charts/[<week|month|year>/<id>/ | all-time/],
 *   /music/genres/[<slug>/[<year>/]], /music/djs/[<key>/], /music/years/[<year>/],
 *   /music/artists/<slug>/, /music/themes/[<id>/]
 * and the library's own lists, which the site shows as they were built:
 *   /music/ (the library), /music/artists/, /music/artists-a-z/<letter>/
 * The rest keep a #: #discover (Home), #discover/search/<words>,
 * #discover/bpm/<tempo>, #discover/fresh, #discover/recent, #live. Every page also answers to
 * its old #discover/... address, which becomes the real one.
 */

// The YouTube player's own script leaves a fetch it cancelled unhandled when a
// song is stopped right after it starts (going to Live, Listen live, the next
// song): "signal is aborted". Nothing's wrong; it's not an error of ours.
window.addEventListener("unhandledrejection", function (e) {
  if (e.reason && e.reason.name === "AbortError") e.preventDefault();
});

// A library page from search (/music/..., tools/plain-pages.mjs) is this site
// with that page already filled in: from here on it's the site on the same
// Discover page, at the same address, with nothing reloaded.
//
// A library address with no page built yet (a DJ's first week, this week's
// chart before the next deploy) is answered with the site itself (.htaccess):
// it opens that Discover page, and tells search engines not to keep the
// address until its own page exists.
(function () {
  var built = document.querySelector('meta[name="ft-route"]');
  if (!built && /\/music\//.test(location.pathname)) {
    var no = document.querySelector('meta[name="robots"]');
    if (!no) {
      no = document.createElement("meta");
      no.name = "robots";
      document.head.appendChild(no);
    }
    no.content = "noindex";
    var canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.parentNode.removeChild(canon);
  }
})();

firetable.discover = (function () {
  var D = {
    on: false,
    mode: null,          // "discover" | "live"
    view: "home",        // home | new | charts | genres | djs | years | recent | artist
    sub: null,           // the genre, DJ, artist or year a page is about
    year: null,          // a genre's page for one year's releases (genres/<slug>/<year>)
    chart: { period: "week", id: null },
    newFilter: null,     // week | month | days90 | unplayed (null: this week when it has any, else this month)
    newLayout: "grid",
    sideTab: "list",     // list | chat
    chartGenre: null,    // the chart, narrowed to one genre
    chartNew: false,     // the chart, new releases only
    genreTab: "fav",     // fav | newHere | deep
    genreView: "grid",   // Genres as grid | map (the sound map: js/discover-map.js); kept for the visit, never stored
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
    // no uid to make their face from: no avatar yet, so the generic gray robot bust (.d-noface), never someone else's face
    return '<span class="ft-avatar pv-dj-avatar dj-avatar-tip' + (dj.uid ? "" : " d-noface") + '" role="img" aria-label="' + esc(dj.name) + '" style="background-image:url(' +
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
  // ─── Addresses ──────────────────────────────────────────────────────────
  // The site's folder ("/"), and the library's under it. A page under
  // /music/ is still this site: <base href="/"> keeps its files where they are.
  var SITE_PATH = new URL(".", document.baseURI).pathname;
  var MUSIC_PATH = SITE_PATH + "music/";
  var SLUG = /^[a-z0-9_-]{1,80}$/i;
  /** "discover/genres/house" (an address after #, or made from a path) as {mode, view, sub, period, id}; null when it isn't one. */
  function parseRoute(h) {
    if (h === "live") return { mode: "live" };
    var p = String(h || "").split("/");
    if (p[0] !== "discover") return null;
    var view = p[1] || "home";
    if (VIEW_IDS.indexOf(view) === -1) return null;
    var r = { mode: "discover", view: view, sub: null, period: null, id: null, year: null };
    if (view === "charts") {
      if (/^(week|month|year|all)$/.test(p[2] || "")) { r.period = p[2]; r.id = /^[\w-]+$/.test(p[3] || "") ? p[3] : null; }
    } else if (view === "search") {
      r.sub = p.slice(2).join("/").slice(0, 100) || null;
    } else if (view === "genres" || view === "djs" || view === "years" || view === "artist" || view === "themes") {
      r.sub = SLUG.test(p[2] || "") ? p[2] : null;
      if (view === "artist" && !r.sub) return null;
      // a genre's songs from one year: genres/<slug>/<year>
      if (view === "genres" && r.sub && /^(?:19|20)\d\d$/.test(p[3] || "")) r.year = p[3];
    } else if (view === "bpm") {
      if (!isTempo(Number(p[2]))) return null;
      r.sub = String(Number(p[2]));
    } else if (view === "page") {
      // one of the library's own lists (PAGES): shown as it was built
      r.sub = p.slice(2).join("/");
      if (!PAGES.test(r.sub)) return null;
    }
    return r;
  }
  // The library's lists with no Discover page of their own: its front page, the artists, and the artists by letter
  var PAGES = /^(?:library|artists|artists-a-z\/[a-z0-9-]{1,5})$/;
  /** The library address of a page, or null for the pages that keep a # (Home, search, tempo, Fresh, Recent plays, Live). */
  function pathOf(r) {
    if (!r || r.mode !== "discover") return null;
    var v = r.view;
    if (v === "new") return MUSIC_PATH + "new/";
    if (v === "charts") {
      if (!r.period || (r.period === "week" && !r.id)) return MUSIC_PATH + "charts/";
      if (r.period === "all") return MUSIC_PATH + "charts/all-time/";
      return r.id ? MUSIC_PATH + "charts/" + r.period + "/" + r.id + "/" : null;
    }
    if (v === "genres" || v === "djs" || v === "years" || v === "themes") return MUSIC_PATH + v + "/" + (r.sub ? r.sub + "/" + (v === "genres" && r.year ? r.year + "/" : "") : "");
    if (v === "artist") return r.sub ? MUSIC_PATH + "artists/" + r.sub + "/" : null;
    if (v === "page") return MUSIC_PATH + (r.sub === "library" ? "" : r.sub + "/");
    return null;
  }
  /** A library address ("/music/genres/house/") as the words after #, or "" when it isn't one. */
  function routeOfPath(path) {
    if (String(path).indexOf(MUSIC_PATH) !== 0 || /\.[a-z0-9]+$/i.test(path)) return ""; // not its feeds or sitemap
    var p = path.slice(MUSIC_PATH.length).replace(/\/+$/, "").split("/");
    try { p = p.map(decodeURIComponent); } catch (e) { return ""; }
    if (!p[0]) return "discover/page/library";
    if (p[0] === "artists") return p[1] ? "discover/artist/" + p[1] : "discover/page/artists";
    if (p[0] === "artists-a-z") return "discover/page/" + p.join("/");
    if (p[0] === "charts" && p[1] === "all-time") return "discover/charts/all";
    return "discover/" + p.join("/");
  }
  /** Where a link or the address bar points: its #, else its path. */
  function routeAt(loc) {
    var h = "";
    try { h = decodeURIComponent((loc.hash || "").replace(/^#/, "")); } catch (e) { /* not one of ours */ }
    return parseRoute(h) || parseRoute(routeOfPath(loc.pathname));
  }
  /** The address of a page, from the words after its # ("discover/genres/house"): its library address when it has one. */
  function urlTo(words) {
    return pathOf(parseRoute(words)) || SITE_PATH + "#" + words;
  }
  /** The same, for an href in markup. */
  function hrefTo(words) { return esc(urlTo(words)); }
  /** A link of the site's that opens a Discover page or Live (not one to another site, a file or a new tab). */
  function routeLink(a) {
    if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return null;
    if (a.pathname !== SITE_PATH && a.pathname.indexOf(MUSIC_PATH) !== 0) return null;
    if (a.pathname === SITE_PATH && !/^#(discover|live)/.test(a.hash)) return null;
    return routeAt(a);
  }

  // how the history splits "A & B", "A x B", "A vs. B"... into artists
  var ARTIST_SPLIT = /(\s*(?:,|;|\s&\s|\s\+\s|\s+and\s+|\s+x\s+|\s+vs\.?\s+|\s+versus\s+|\s+with\s+|\s+\/\s+|\s+×\s+|、)\s*)/i;
  /** The artist line, with each artist in it linking to their page. */
  function artistLinks(a) {
    var text = String(a || "");
    if (!text) return "";
    return text.split(ARTIST_SPLIT).map(function (part, i) {
      if (i % 2 || !part.trim() || !artistSlug(part)) return esc(part);
      return '<a class="d-alink" href="' + hrefTo("discover/artist/" + artistSlug(part)) + '">' + esc(part) + "</a>";
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
    return key ? '<a class="d-djlink" href="' + hrefTo("discover/djs/" + key) + '" title="' + esc(dj.name) + '">' + robot(dj, size) + "</a>" : robot(dj, size);
  }
  /** A name, linking to their DJ page when they have one. */
  function nameLink(dj) {
    if (!dj) return "";
    var key = djKey(dj.uid, dj.name);
    return key ? '<a class="d-namelink" href="' + hrefTo("discover/djs/" + key) + '">' + esc(dj.name) + "</a>" : esc(dj.name);
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
    return '<div class="hist-entry"><span class="hist-timestamp' + (meta.rank ? " d-rank" : meta.dated ? " d-date" : "") + '">' + esc(meta.stamp || "") + "</span>" +
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
  /** A heading whose link opens New on one of its filters; `acts` (buttons for the whole list) after the link. */
  function newHead(title, link, filter, acts) {
    return '<div class="d-head"><h2>' + esc(title) + '</h2><a href="' + hrefTo("discover/new") + '" data-newfilter="' + esc(filter) + '">' + esc(link) + "</a>" + (acts || "") + "</div>";
  }
  /**
   * Home's lead: the week's most played new release, big, with who found it.
   * The cover holds only its play button; the song's own ⋮ and save sit under
   * its words (.d-leadown), as on the covers under it, so nothing covers the
   * art. The week's Play and Save all are in the heading above (viewHome).
   */
  function leadCard(t, list) {
    var u = firetable.utilities, dot = '<span aria-hidden="true">·</span>';
    var dj = t.plays && t.dj ? djShown(t.djid, t.dj) : null, on = t.first ? " on " + esc(u.shortDate(t.first)) : "";
    var found = t.plays
      ? '<p class="d-leadfound">' + (dj ? robotLink(dj) + "<span>Found by " + nameLink(dj) + on + "</span>" : "<span>First played here" + on + "</span>") +
        dot + "<span>" + esc(u.pluralize(t.plays, "play", "plays")) + (t.plays === 1 ? " so far" : "") + "</span></p>"
      : '<p class="d-leadfound"><span class="d-befirst">Be the first</span>' + dot + "<span>nobody has played it here yet</span></p>";
    // genre, length and release day as one quiet line, not three pills
    var meta = [t.g ? '<a href="' + hrefTo("discover/genres/" + genreSlug(t.g)) + '">' + esc(t.g) + "</a>" : "", t.dur ? "<span>" + esc(clock(t.dur)) + "</span>" : "",
      t.rel ? "<span>Out " + esc(u.shortDate(new Date(String(t.rel).slice(0, 10) + "T12:00:00").getTime())) + "</span>" : ""].filter(Boolean).join(dot);
    return '<div class="pvbar d-lead' + (isPlaying(list, 0) ? " previewing" : "") + '"' + rowAttrs(t, list, 0) + ">" +
      '<div class="pv-art discart d-leadart" style="background-image:url(' + esc(artOf(t)) + ')">' +
      '<button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + playLabel(t, list, 0) + '">' + (isSounding(list, 0) ? "pause" : "play_arrow") + "</button></div>" +
      '<div class="d-leadtext"><p class="d-kicker">' + (t.plays ? "Most played" : "Just out") + "</p>" +
      '<h3 class="d-leadtitle"><span class="d-sheetlink" role="button" tabindex="0">' + esc(t.t) + "</span></h3>" +
      '<p class="d-leadartist">' + artistLinks(t.a) + "</p>" + (meta ? '<p class="d-leadmeta">' + meta + "</p>" : "") + found +
      '<div class="d-leadown">' + moreButton() + saveButton(t) + "</div></div></div>";
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
      return '<a class="d-djtile" href="' + hrefTo("discover/djs/" + d.key) + '">' + robot({ uid: d.djid, name: d.name }, "110x110") +
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
    { id: "fresh", label: "Fresh", icon: "fiber_new" },
    { id: "charts", label: "Charts", icon: "leaderboard" },
    { id: "genres", label: "Genres", icon: "category" },
    { id: "djs", label: "DJs", icon: "headphones" },
    { id: "years", label: "Years", icon: "calendar_month" },
    { id: "themes", label: "Theme nights", icon: "nightlife" },
    { id: "recent", label: "Recent plays", icon: "history" }
  ];
  var VIEW_IDS = VIEWS.map(function (v) { return v.id; }).concat(["artist", "search", "bpm", "page"]);

  function head(title, link, linkTo) {
    return '<div class="d-head"><h2>' + esc(title) + "</h2>" + (link ? '<a href="' + hrefTo(linkTo) + '">' + esc(link) + "</a>" : "") + "</div>";
  }
  function chips(name, options, on, label) {
    return '<div class="d-chips" role="group"' + (label ? ' aria-label="' + esc(label) + '"' : "") + ">" + options.map(function (o) {
      return '<button type="button" class="d-chip' + (o[0] === on ? " on" : "") + '" data-' + name + '="' + esc(o[0]) + '" aria-pressed="' + (o[0] === on) + '">' + esc(o[1]) + "</button>";
    }).join("") + "</div>";
  }
  /** One of a few ways to see a page, as one control (Charts' period, Genres' Grid | Map). */
  function seg(name, label, options, on) {
    return '<div class="d-seg" role="group" aria-label="' + esc(label) + '">' + options.map(function (o) {
      return '<button type="button" class="d-segbtn' + (o[0] === on ? " on" : "") + '" data-' + name + '="' + esc(o[0]) + '" aria-pressed="' + (o[0] === on) + '">' + esc(o[1]) + "</button>";
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
    return g ? '<a class="d-g" href="' + hrefTo("discover/genres/" + genreSlug(g)) + '">' + esc(g) + "</a>" : "";
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
    else if (v === "genres") h = D.sub ? (D.year ? viewGenreYear(D.sub, D.year) : viewGenre(D.sub)) : viewGenres();
    else if (v === "djs") h = D.sub ? viewDj(D.sub) : viewDjs();
    else if (v === "years") h = D.sub ? viewYear(D.sub) : viewYears();
    else if (v === "artist") h = viewArtist(D.sub);
    else if (v === "bpm") h = viewTempo(Number(D.sub));
    else if (v === "themes") h = D.sub ? viewNight(D.sub) : viewNights();
    else if (v === "search") h = viewSearch(D.sub || "");
    else if (v === "page") h = viewPage(D.sub);
    else if (v === "fresh") h = fresh("page");
    else if (v === "recent") {
      var rt = recentTracks();
      setList("recent", "Recent plays", rt);
      h += '<div class="d-headrow"><h2>Recent plays</h2></div><p class="d-fact">The last 100 songs played live' + (D.signedIn ? ' · <a href="' + hrefTo("live") + '" data-live="history">See every play in Live</a>' : "") + "</p>";
      h += recentList(rt, "recent");
    }
    // a page from search keeps its filled-in copy until the live one has its data
    if (D.prerendered) {
      if (/class="d-loading"/.test(h)) return;
      D.prerendered = false;
    }
    // The same page as is there (coming back from Live, the database sending
    // what it sent before) isn't built again: rebuilding Home's hundreds of
    // covers made the switch from Live slow, and lost the place on the page.
    var same = h === el._drawn && el.firstChild, keep = !same && pressed(el);
    if (!same) { el.innerHTML = h; el._drawn = h; }
    if (keep && el.querySelector(keep)) el.querySelector(keep).focus({ preventScroll: true });
    writeTitle(); // a page's name can arrive with its data
    if (!same && v === "genres" && !D.sub) layoutMap();
    if (!same && v === "djs" && D.sub) drawCards();
    firetable.ui.markSaved();
  }

  // A control that draws the page again keeps the focus once it's drawn
  // (Genres' Grid | Map and decades, Charts' period, steps and drop-downs, the
  // other chips, a genre's radio on the map's card); it stays where it was on
  // screen, so the page doesn't scroll to it
  var REDRAWS = ["data-gview", "data-decade", "data-period", "data-step", "data-gtab", "data-djtab", "data-djsort", "data-layout", "data-more", "data-slug"];
  /** The focused control in the page, as a selector that finds it again; null when it's none of those. */
  function pressed(el) {
    var a = document.activeElement;
    if (!a || a === el || !el.contains(a) || !a.matches("button, select")) return null;
    if (a.id) return "#" + CSS.escape(a.id);
    var at = REDRAWS.filter(function (x) { return a.hasAttribute(x); })[0];
    return at ? a.tagName.toLowerCase() + (a.classList.length ? "." + CSS.escape(a.classList[0]) : "") + "[" + at + '="' + CSS.escape(a.getAttribute(at)) + '"]' : null;
  }

  /** A shelf on Home: the first few, and the rest a tap away. */
  function more(id, total, shown) {
    if (total <= shown) return "";
    return '<button type="button" class="linkButton d-homemore" data-more="' + esc(id) + '">' + (D.homeMore[id] ? "Show fewer" : "Show all " + total) + "</button>";
  }

  function viewHome() {
    var h = tabBar.tiles(); // Discover's pages, on phones (js/discover-tabs.js)
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
      h += '<section class="d-week">' + newHead("New this week", "See all " + week.length, "week",
        '<span class="d-actions d-headacts">' + playAllButton("home-week", "Play all", "Play the week's " + week.length) + "</span>") + leadCard(week[0], "home-week") +
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
    h += fresh("shelf"); // the first plays here of new uploads
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
        '<div class="d-chips d-genrechips">' + genres.map(function (g) { return '<a class="d-chip" href="' + hrefTo("discover/genres/" + g.slug) + '">' + esc(g.name) + "</a>"; }).join("") + "</div></section>";
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
    h += '<div class="d-headrow"><h2>Room chart</h2>' + seg("period", "Period", [["week", "Week"], ["month", "Month"], ["year", "Year"], ["all", "All time"]], period) + "</div>";
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
  var libAsked = {}; // path -> the read, done once it's in libData
  /** discover/lib/<path>, read once: undefined while it loads, null if there's none. */
  function lib(path) {
    if (!libAsked[path]) {
      libAsked[path] = db().ref("discover/lib/" + path).once("value").then(function (s) { libLoaded(path, s.val()); }, function (err) { quiet(err); libLoaded(path, null); });
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
    return '<a class="d-back" href="' + hrefTo(to) + '">' + ms("arrow_back") + "<span>" + esc(label) + "</span></a>";
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
  function playAllButton(listName, label, hint) {
    return '<button type="button" class="butt d-playall d-panelmain" data-list="' + esc(listName) + '"' + (hint ? ' title="' + esc(hint) + '"' : "") + ">" + ms("play_arrow", true) + "<span>" + esc(label) + "</span></button>" +
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
      return row(t, listName, i, { stamp: t.first ? firetable.utilities.shortDate(t.first) : "", dated: true, dj: djShown(t.djid, t.dj), right: '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" });
    }).join(""));
  }
  function person(p, fact, more) {
    var dj = djShown(p.djid, p.dj || p.name);
    if (!dj) return "";
    var key = p.key && (lib("djs") || {})[p.key] ? p.key : djKey(dj.uid, dj.name);
    var inner = robot(dj, "80x80") + '<span class="d-person-text"><b>' + esc(dj.name) + "</b><span>" + fact + "</span>" + (more ? "<span>" + more + "</span>" : "") + "</span>";
    return key ? '<a class="d-person" href="' + hrefTo("discover/djs/" + key) + '">' + inner + "</a>" : '<span class="d-person">' + inner + "</span>";
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
    // a decade: each genre ordered (and on the map sized) by its plays then (all time: every play)
    var decs = {};
    list.forEach(function (g) { Object.keys(g.dec || {}).forEach(function (d) { decs[d] = (decs[d] || 0) + g.dec[d]; }); });
    var decList = Object.keys(decs).filter(function (d) { return decs[d] > 0; }).sort().reverse();
    if (D.mapDecade && !decs[D.mapDecade]) D.mapDecade = null;
    var weight = function (g) { return D.mapDecade ? ((g.dec || {})[D.mapDecade] || 0) : (g.plays || 0); };
    list = list.slice().sort(function (a, b) { return weight(b) - weight(a); });
    var top = list.length ? weight(list[0]) || 1 : 1;
    // the grid, or the sound map behind Map (the owner, November 25, 2026); the decades drive both
    var h = '<div class="d-headrow"><h2>Genres</h2>' + seg("gview", "Show genres as", [["grid", "Grid"], ["map", "Map"]], D.genreView) + "</div>" +
      (decList.length > 1 ? chips("decade", [["", "All time"]].concat(decList.map(function (d) { return [d, d + "s"]; })), D.mapDecade || "", "Decade") : "");
    if (D.genreView === "map") return h + (soundMap ? soundMap.html(list, weight, top) : mapWaiting());
    // the grid, in the plain page's words (/music/genres/)
    h += '<p class="d-fact">' + esc(list.length) + " sounds the room plays, most played " + (D.mapDecade ? "in the " + esc(D.mapDecade) + "s " : "") + "first</p>";
    return h + '<div class="d-gcards">' + list.map(function (g) {
      return '<a class="d-gcard" href="' + hrefTo("discover/genres/" + g.slug) + '">' + mosaic(g.covers) +
        '<span class="d-gname">' + esc(g.name) + '</span><span class="d-gfact d-num">' + (D.mapDecade ? esc(n(weight(g))) + " plays in the " + esc(D.mapDecade) + "s" : esc(n(g.songs)) + " songs · " + esc(n(g.plays)) + " plays") + "</span></a>";
    }).join("") + "</div>";
  }

  // The sound map (js/discover-map.js): loaded the first time Map is pressed,
  // then kept for the visit. Until it's here the page shows the site's
  // skeleton in the map's shape; if it can't load, Genres goes back to its
  // grid and a note says so (pressing Map again tries again).
  var soundMap = null, mapWait = null;
  function onGenres() { return D.mode === "discover" && D.view === "genres" && !D.sub; }
  function mapReady() {
    if (mapWait) return mapWait;
    mapWait = ftLazy.own("map-js", "js/discover-map.js").then(function () {
      soundMap = firetable.discoverMap({
        esc: esc, ms: ms, n: n, hrefTo: hrefTo, mosaic: mosaic, lib: lib, genreSlug: genreSlug, liveTrack: liveTrack, loadDetails: loadDetails,
        hearing: function () { return discoverActive() ? P.track : liveTrack(); },
        decade: function () { return D.mapDecade; },
        picked: function () { return D.mapPick; },
        setPicked: function (slug) { D.mapPick = slug; }
      });
    }).catch(function (err) {
      mapWait = null; // try again next time
      console.error("[firetable] the sound map:", err);
      D.genreView = "grid";
      if (onGenres()) firetable.ui.toast("The map didn't load. Try again in a moment.", "error");
    }).then(function () { if (onGenres()) renderBrowse(); });
    return mapWait;
  }
  function mapWaiting() {
    mapReady();
    // a line for the map's fact, then its frame: the map arrives where its frame was
    return '<div class="d-loading" role="status" aria-label="Loading"><span class="d-skeltext" aria-hidden="true"><span class="skel"></span></span></div><div class="d-map skel" aria-hidden="true"></div>';
  }
  /** The map's labels spread and marked, once it's drawn. */
  function layoutMap() { if (soundMap) soundMap.layout(); }
  /** The room's marks on the map (its song's genre, tonight's, yours), when it's showing. */
  function mapMarks() { if (soundMap) soundMap.marks(); }

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
    // a few sentences about it (the bot's genre-stories.md)
    var story = (page.story || []).filter(Boolean);
    if (story.length) h += '<section class="d-story">' + head("About " + g.name) + story.map(function (para) { return "<p>" + esc(para) + "</p>"; }).join("") + "</section>";
    // its songs from each year's releases, a page a year
    if ((g.ys || []).length) {
      h += "<section>" + head("The best of each year") + '<p class="d-fact">' + esc(g.name) + ' released that year, most played here first</p><div class="d-chips">' +
        g.ys.slice().reverse().map(function (y) { return '<a class="d-chip d-num" href="' + hrefTo("discover/genres/" + slug + "/" + y) + '">' + esc(y) + "</a>"; }).join("") + "</div></section>";
    }
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
        next.map(function (k) { return '<a class="d-chip" href="' + hrefTo("discover/genres/" + k) + '">' + esc(all[k].name) + "</a>"; }).join("") + "</div></section>";
    }
    return h;
  }

  /** A genre's songs released in one year, most played here first ("the best nu-disco of 2014"). */
  function viewGenreYear(slug, year) {
    var all = lib("genres");
    var g = all && all[slug];
    var page = lib("genreYear/" + slug + "_" + year);
    var h = back("discover/genres/" + slug, g ? g.name : "Genre");
    if (all === undefined || page === undefined) return h + loading();
    if (!g || !page) return h + emptyNote("There's no page for " + (g ? g.name + " in " : "this genre in ") + year + " yet. A year gets one when the room has played enough of its songs.");
    var tracks = withType(page.top);
    setList("genre-year", g.name + " · " + year, tracks);
    h += '<div class="d-pagehead">' + mosaic(tracks.slice(0, 4).map(function (t) { return t.type + "_" + t.cid; }), true) +
      '<div class="d-pagetext"><h2>' + esc("The best " + g.name + " of " + year) + "</h2>" +
      factChips([firetable.utilities.pluralize(page.songs, "song", "songs") + " released in " + year + " played here"].concat(page.plays ? [n(page.plays) + " plays"] : [])) +
      '<div class="d-actions">' + playAllButton("genre-year", "Play all") + "</div></div></div>";
    h += "<section>" + head("Most played here") + rankedRows(tracks, "genre-year") + "</section>";
    var others = (g.ys || []).filter(function (y) { return String(y) !== String(year); });
    if (others.length) {
      h += "<section>" + head("Other years") + '<div class="d-chips">' + others.slice().reverse().map(function (y) {
        return '<a class="d-chip d-num" href="' + hrefTo("discover/genres/" + slug + "/" + y) + '">' + esc(y) + "</a>";
      }).join("") + "</div></section>";
    }
    h += genresOfYear(year, slug);
    return h;
  }
  /** The genres with a page for a year's releases, as links (leaving out `not`), with the year's own page. */
  function genresOfYear(year, not) {
    var all = lib("genres") || {};
    var list = Object.keys(all).filter(function (k) { return k !== not && (all[k].ys || []).some(function (y) { return String(y) === String(year); }); })
      .sort(function (x, y) { return (all[y].plays || 0) - (all[x].plays || 0); });
    if (!list.length) return "";
    return "<section>" + head(not ? "More from " + year : year + " by genre", not ? "All of " + year : "", "discover/years/" + year) + '<div class="d-chips">' + list.map(function (k) {
      return '<a class="d-chip" href="' + hrefTo("discover/genres/" + k + "/" + year) + '">' + esc(all[k].name) + "</a>";
    }).join("") + "</div></section>";
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
          var name = x.slug ? '<a href="' + hrefTo("discover/genres/" + x.slug) + '">' + esc(x.g) + "</a>" : "<span>" + esc(x.g) + "</span>";
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
          ? '<a class="d-set d-setlink" href="' + hrefTo("discover/themes/" + night.id) + '">' + day + '<span class="d-settheme">' + esc(night.theme) + "</span>" + what + "</a>"
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
  // genres, DJs and theme nights. Songs come from js/discover-find.js, loaded
  // on the first search: every song played here (static files, no database),
  // members' own playlists, and YouTube on Enter (each search costs the
  // site's YouTube quota, so it's for people who can add what they find).

  var fold = function (x) { return String(x || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };
  function matches(q, text) { return fold(text).indexOf(q) !== -1; }
  var finder = null;
  /** Search's song finder (js/discover-find.js), loaded once; resolves with it. */
  function findReady() {
    return finder ? Promise.resolve(finder) : ftLazy.own("find-js", "js/discover-find.js").then(function () {
      finder = finder || firetable.discoverFind({
        esc: esc, ms: ms, head: head, row: row, emptyNote: emptyNote, loading: loading, djShown: djShown, setList: setList,
        signedIn: function () { return D.signedIn; },
        // songs on pages opened this visit: new releases, charts and the rest
        loaded: function () {
          var pool = (D.data.new && D.data.new.tracks) || [];
          Object.keys(lists).forEach(function (name) { if (!/^search/.test(name)) pool = pool.concat(lists[name].tracks || []); });
          return pool;
        },
        changed: function () { if (D.mode === "discover" && D.view === "search") renderBrowse(); }
      });
      return finder;
    });
  }

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
      return '<a class="d-person" href="' + hrefTo("discover/artist/" + k) + '"><span class="d-person-text"><b>' + esc(ai[k][0]) + "</b><span>" + esc(firetable.utilities.pluralize(ai[k][1], "play", "plays")) + "</span></span></a>";
    }).join("") + "</div>", artists.length);
    // genres
    var gs = genreList().filter(function (g) { return matches(q, g.name); }).slice(0, 12);
    h += section("Genres", '<div class="d-chips">' + gs.map(function (g) { return '<a class="d-chip" href="' + hrefTo("discover/genres/" + g.slug) + '">' + esc(g.name) + "</a>"; }).join("") + "</div>", gs.length);
    // DJs
    var dall = lib("djs") || {};
    var djs = Object.keys(dall).filter(function (k) { return matches(q, dall[k].name); }).sort(function (a, b) { return (dall[b].plays || 0) - (dall[a].plays || 0); }).slice(0, 8);
    h += section("DJs", '<div class="d-people">' + djs.map(function (k) {
      return person({ djid: dall[k].djid, name: dall[k].name, key: k }, esc(firetable.utilities.pluralize(dall[k].plays, "play", "plays")));
    }).join("") + "</div>", djs.length);
    // theme nights
    var nights = nightIndex().filter(function (n) { return matches(q, n.theme); }).slice(0, 6);
    h += section("Theme nights", '<div class="d-nights">' + nights.map(nightRow).join("") + "</div>", nights.length);
    // songs: the whole library, your playlists, then YouTube (js/discover-find.js)
    if (!finder) findReady().then(function () { if (D.view === "search") renderBrowse(); }, quiet);
    var songs = finder ? finder.sections(query) : { html: loading(), found: 0, pending: true };
    h += songs.html;
    found += songs.found;
    if (!found && !songs.pending && !D.signedIn) h += emptyNote("Nothing in the room's library for that yet.");
    return h;
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
    return '<a class="d-night" href="' + hrefTo("discover/themes/" + n.id) + '"><b>' + esc(n.theme) + "</b><span>" + esc(nightDate(n) + " · " + firetable.utilities.pluralize(n.n, "song", "songs") +
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
      ((a.g || []).length ? '<p class="d-fact d-sound">' + a.g.map(function (g) { return '<a class="d-tag" href="' + hrefTo("discover/genres/" + genreSlug(g)) + '">' + esc(g) + "</a>"; }).join("") + "</p>" : "") +
      (a.first ? '<p class="d-fact">First played here ' + esc(firetable.utilities.shortDate(a.first)) + (firstDj ? " by " + nameLink(firstDj) : "") + "</p>" : "") +
      '<div class="d-actions">' + playAllButton("artist", "Play all") + "</div></div></div>";
    h += "<section>" + head("Most played here") + rankedRows(tracks, "artist") + "</section>";
    // artists the same DJs play (the weekly play history job works them out)
    var like = (a.sim || []).filter(function (x) { return x && x.k && x.n; });
    if (like.length) {
      h += "<section>" + head("Sounds like") + '<p class="d-fact">Artists the same DJs play</p><div class="d-chips">' +
        like.map(function (x) { return '<a class="d-chip" href="' + hrefTo("discover/artist/" + x.k) + '">' + esc(x.n) + "</a>"; }).join("") + "</div></section>";
    }
    var who = (a.djs || []).map(function (p) { return person(p, esc(firetable.utilities.pluralize(p.plays, "play", "plays"))); }).filter(Boolean);
    if (who.length) h += "<section>" + head("Who plays them") + '<div class="d-people">' + who.join("") + "</div></section>";
    return h;
  }

  // The library's own lists (its front page, every artist, the artists by
  // letter) are built once a week with the pages for search engines
  // (tools/plain-pages.mjs). Discover shows them as built: arriving on one, it's
  // already in the page; from a link, it's read from the same address.
  var builtPages = {};   // sub -> { html, title } | null (not there) ; undefined while it's read
  function viewPage(sub) {
    var got = builtPages[sub];
    if (got === undefined) {
      builtPages[sub] = false; // asked
      var url = pathOf({ mode: "discover", view: "page", sub: sub });
      fetch(url, { credentials: "same-origin" }).then(function (res) { return res.ok ? res.text() : null; }).then(function (text) {
        var doc = text ? new DOMParser().parseFromString(text, "text/html") : null;
        var el = doc && doc.querySelector("#dBrowse[data-prerendered]");
        builtPages[sub] = el && doc.querySelector('meta[name="ft-route"][content="discover/page/' + sub + '"]') ? { html: el.innerHTML, title: doc.title } : null;
      }, function () { builtPages[sub] = null; }).then(function () { if (D.view === "page" && D.sub === sub) renderBrowse(); });
    }
    if (got) return got.html;
    if (got === null) return '<div class="d-headrow"><h2>The library</h2></div>' + emptyNote("This page of the library isn't built yet. It's made with the weekly play history update.");
    return loading();
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
      return '<a class="d-yearrow' + (v.covers && v.covers.length ? " has-covers" : "") + '" href="' + hrefTo("discover/years/" + y) + '">' +
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
    h += genresOfYear(y, null);
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
    return '<a class="d-tag d-bpmtag" href="' + hrefTo("discover/bpm/" + bpm) + '" title="' + esc("Songs played here at " + bpm + " BPM") + '">' + esc(bpm) + " BPM</a>";
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
    return isTempo(n) ? '<a href="' + hrefTo("discover/bpm/" + n) + '">' + esc(label) + "</a>" : "";
  }

  function viewTempo(bpm) {
    var page = tempoPage(bpm);
    var title = bpm + " BPM";
    var step = function (to, dir, label) {
      return isTempo(to) ? '<a class="butt graybutt iconbutt" href="' + hrefTo("discover/bpm/" + to) + '" title="' + esc(label + ": " + to + " BPM") + '" aria-label="' + esc(label + ": " + to + " BPM") + '">' + ms(dir) + "</a>"
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
    // Live's panel and chat come over only while Discover is on screen: drawn in
    // Live (a refresh signs in after setMode), they'd vanish into its hidden column
    if (!el || D.mode !== "discover") { queue.back(); chatBack(); renderBar(); renderFull(); firetable.ui.markSaved(); return; }
    if (D.sideTab !== "list" && !(D.sideTab === "chat" && D.signedIn)) D.sideTab = "list";
    // the chat's tab: only its tabs change, so the chat keeps its place
    if (D.sideTab === "chat" && D.signedIn && el.querySelector(".d-chathost #actualChat")) {
      var bar = el.querySelector(".d-sidetabs");
      if (bar) bar.outerHTML = sideTabs();
      renderBar();
      return;
    }
    // Playlists, for members: Live's own panel. Only the tabs and Discover's
    // bar around it are drawn again, so the panel keeps its place, filter and search
    if (D.sideTab === "list" && D.signedIn) {
      chatBack();
      if (queue.here()) el.querySelector(".d-sidetabs").outerHTML = sideTabs();
      else el.innerHTML = queue.html(sideTabs());
      queue.show();
      renderBar();
      renderFull();
      firetable.ui.markSaved();
      return;
    }
    queue.back();
    var old = el.querySelector(".d-sidebody");
    var scroll = old && old.getAttribute("data-tab") === D.sideTab ? old.scrollTop : 0;
    chatBack();
    if (D.sideTab === "chat" && D.signedIn) {
      D.unread = 0;
      el.innerHTML = '<div class="d-sidebody d-sidechat" data-tab="chat">' + sideTabs() + '<div class="d-chathost"></div></div>';
      chatIn(el.querySelector(".d-chathost"));
      renderBar();
      return;
    }
    el.innerHTML = '<div class="d-sidebody" data-tab="' + D.sideTab + '">' + sideTabs() + cratePanel() + "</div>";
    if (scroll) el.querySelector(".d-sidebody").scrollTop = scroll;
    renderBar();
    renderFull();
    firetable.ui.markSaved();
  }

  /** One of the right column's tabs; on phones and tablets the column is a sheet over the page. */
  function showSide(tab) {
    D.sideTab = tab;
    renderSide();
    if (matchMedia("(max-width: 1023px)").matches) document.body.classList.add("d-sheet-open");
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
    queue.mark();
  }

  function toRoomNote(t, saved) {
    if (!D.signedIn) return esc(saved ? "In your crate. " : "") + "Join and your songs play for the room when it's your turn on the decks.";
    if (P.inRoom && String(P.inRoom.cid) === String(t.cid)) {
      var d = deckState();
      return esc("First in " + firetable.utilities.listName(P.inRoom.list) + ". ") +
        (d.on ? "You're on the decks: it's your next song." : d.waiting ? "You're #" + d.place + " in line for the decks." : '<button type="button" class="linkButton d-joinwait">Hop on the decks</button> to play it.') +
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
      var tags = (d.genres || []).slice(0, 2).map(function (g) { return '<a class="d-tag" href="' + hrefTo("discover/genres/" + genreSlug(g)) + '">' + esc(g) + "</a>"; });
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
      setTimeout(openKeepCrate, 600);
    }
  }

  function cratePanel() {
    var c = crate();
    setList("crate", "Your crate", c);
    var rows = c.map(function (t, i) {
      return '<li class="d-listrow pl-row' + (isPlaying("crate", i) ? " is-playing" : "") + '" data-list="crate" data-i="' + i + '"><span class="d-n">' + (i + 1) + "</span>" +
        '<button type="button" class="d-mini-row" data-list="crate" data-i="' + i + '"><span class="sr-only">Play </span><span class="d-mini-art" style="background-image:url(' + esc(artOf(t)) + ')"></span>' +
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
        : roomCard() + '<p class="d-fact">Tap ' + ms("playlist_add") + " on any song, or Save in the player, to keep it here. No account needed.</p>") +
      '<p class="d-fact">Join and this crate becomes your first playlist, ready to play for the room.</p>' +
      joinButtons() + "</div>";
  }

  /** A visitor's Library on a phone (the tab bar): Discover, with the crate's sheet over it. */
  function openCrate() { if (D.mode !== "discover") setMode("discover", { remember: true }); showSide("list"); }

  function joinButtons() {
    var google = firetable.utilities.signInProviders().indexOf("google") !== -1;
    var g = document.querySelector('#oauthBox .oauthBttn[data-provider="google"] svg');
    return '<div class="d-join">' +
      (google ? '<button type="button" class="butt oauthBttn d-google">' + (g ? g.outerHTML : "") + "Continue with Google</button>" : "") +
      '<button type="button" class="butt d-createaccount">Join</button>' +
      '<p class="d-fact d-center">Already a member? <button type="button" class="linkButton d-login">Log in</button></p></div>';
  }

  // ─── The room, in a visitor's empty crate column (Round 5) ──────────────
  // js/discover-room.js: who's on the decks, how many are here, the song's
  // fires, the guests and the radio, over the crate's note while the crate is
  // empty; and the "Keep your crate" dialog. Loaded the first time either is
  // wanted (js/lazy.js). If it can't load, the note and Join are as they were,
  // and the dialog waits for the next save.
  var roomSide = null;
  function roomReady() {
    return roomSide ? Promise.resolve(roomSide) : ftLazy.own("room-js", "js/discover-room.js").then(function () {
      return (roomSide = roomSide || firetable.discoverRoom({ esc: esc, ms: ms, db: db, djShown: djShown, robotLink: robotLink, nameLink: nameLink,
        peopleHere: peopleHere, deckList: deckList, liveTrack: liveTrack, crate: crate, artOf: artOf, joinButtons: joinButtons }));
    });
  }
  /**
   * The room's card, for a visitor once the page knows they're signed out
   * (users.js marks #mainGrid .login), so a member never sees it flash before
   * their sign-in arrives, and never gets it. "" until the module is here.
   */
  function roomCard() {
    if (!document.querySelector("#mainGrid.login")) return "";
    if (!roomSide) roomReady().then(renderSide, quiet);
    return roomSide ? roomSide.html() : "";
  }
  // Keep your crate, once a browser: marked asked as it opens, so if the module can't load the next save
  // offers it again (and a fourth save while it loads doesn't open it twice)
  function openKeepCrate() { roomReady().then(function (r) { if (!store.get(CRATE_ASKED_KEY, false)) { store.set(CRATE_ASKED_KEY, true); r.keepCrate(); } }, quiet); }

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
  // Live's own playlist panel, moved into the Playlists tab (js/discover-queue.js):
  // everything Live does with a playlist, with the decks beside it.
  var queue = firetable.discoverQueue({
    esc: esc, ms: ms, setList: setList, deckState: deckState,
    lists: function () { return lists; },
    player: function () { return P; },
    active: function () { return discoverActive(); },
    play: function (list, i) { play(list, i); },
    togglePause: function () { togglePause(); }
  });
  // Shuffle, a setting of the player for whatever list plays (js/discover-shuffle.js)
  var shuffle = firetable.discoverShuffle({
    ms: ms, store: store, announce: function (m) { announce(m); },
    lists: function () { return lists; },
    player: function () { return P; },
    play: function (list, i) { play(list, i); },
    render: function () { renderBar(); renderFull(); }
  });
  // The bottom tab bar, on phones (4.1): js/discover-tabs.js
  var tabBar = firetable.discoverTabs({
    esc: esc, ms: ms, hrefTo: hrefTo, closeMenu: closeMenu, setMode: setMode, setView: setView, openCrate: openCrate,
    state: function () { return D; }, views: function () { return VIEWS; }
  });
  function renderTabs() { tabBar.render(); }
  // Fresh, the first plays here of new uploads: js/discover-fresh.js, loaded the first time
  // Home or Fresh is drawn (js/lazy.js). part is "page" or "shelf"; until it's here, rows loading
  var freshPage = null, freshAsked = null;
  function fresh(part) {
    if (freshPage) return freshPage[part]();
    freshAsked = freshAsked || ftLazy.own("fresh-js", "js/discover-fresh.js").then(function () {
      freshPage = firetable.discoverFresh({ card: card, loading: loading, emptyNote: emptyNote, head: head, djShown: djShown, setList: setList, state: function () { return D; }, render: renderBrowse });
      freshPage.changed();
    }, function (err) { freshAsked = null; quiet(err); }); // the next draw asks again
    return part === "page" ? '<div class="d-headrow"><h2>Fresh</h2></div>' + loading() : "<section>" + loading() + "</section>";
  }

  function djList() { return queue.djList(); }

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
      firetable.ui.toast(msg, "success", { duration: 6000, action: d.on || d.waiting ? { label: "Undo", fn: undoToRoom } : { label: "Hop on", fn: hopOn } });
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
   * and another when your song starts, each with Listen live. Discover never
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
        duration: 8000, action: { label: "Listen live", fn: listenIn }
      });
      return;
    }
    var order = deckList();
    if (order.length > 1 && order[1].id === ftapi.uid && discoverActive() && turnNoted !== s.started) {
      turnNoted = s.started;
      firetable.ui.toast("You're up next on the decks. Your Discover pick keeps playing.", "notice", {
        duration: 7000, action: { label: "Listen live", fn: listenIn }
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

  // play: counts each start of a song (a new listen for Last.fm; pausing or Listen live keeps it)
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
    shuffle.played(listName, t, P.list === listName && P.track);
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

  /** Give the players back to the room (Live, Listen live). */
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
    announce(s ? "Listening live: " + s.t + (s.dj ? ", " + s.dj + " on deck" : "") : "The room is quiet");
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

  /** A pick's reload (the bar's when YouTube stops on it, the full-screen player's, its ⋮): it plays again from a moment before. */
  function reloadPick() { return P.track && play(P.list, P.i, Math.max(0, P.at - 2), true); }

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
    var i = shuffle.step(P.i, by);
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
    // nothing to see in a hidden tab (the next tick after it's shown catches up)
    if (document.hidden) return;
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
  // screen, reload and the cast button go into the full-screen player's top
  // while it's open, in the bar's order with a Discover song's own reload
  // (#pv-fdtools) where the room's is: screen · reload · cast · fill · close
  // (its Video is the stage's screen down; on phones it's the only player with
  // room for them). In the bar they keep one order, with a Discover song's own
  // reload (#pv-dtools) where the room's is, and the volume before full
  // screen: screen · reload · cast · volume · full screen. Reload rests out of
  // sight there and shows when YouTube stops on the song (css/discover.css); a
  // pick's is in its ⋮ too (openMenu).
  var STAGE_TOOLS = [["screenControl", "screenControlTip", "pv-tools", "pv-fscreen"], ["reloadtrack", "tip-reloadtrack", "pv-tools", "pv-fscreen"],
    ["st-cast", "tip-st-cast", "pv-cast", "pv-fcast"], ["fullscreenBtn", "tip-fullscreenBtn", "pv-fs", null]];
  // a Discover song's reload, the same in the bar and the full-screen player
  var RELOAD_SONG = '<button type="button" class="butt graybutt iconbutt d-reload" title="Reload audio (if it stalls)" aria-label="Reload audio">' + ms("refresh") + "</button>";
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
        '<button type="button" class="butt graybutt small d-listen st-nl-go" title="' + esc("Listen live: " + liveTrack().t) + '"><i class="d-dot" aria-hidden="true"></i>Listen live</button>';
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
        esc(blocked() ? "Your browser held the room's sound back. Press play" : "Not listening · press play to listen live") + "</span>";
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
      keep.innerHTML = '<button type="button" class="butt graybutt iconbutt d-savebtn pb-save' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "Saved in " + saved + ". Save again" : D.signedIn ? "Save to a playlist" : "Save to your crate") + '" aria-label="' + esc(saved ? "Saved in " + saved : "Save") + '">' + ms(saved ? SAVED_ICON : SAVE_ICON) + "</button>";
    } else if (live && !D.signedIn) {
      keep.innerHTML = '<button type="button" class="butt graybutt iconbutt pb-joinfire" title="Join to fire this song" aria-label="Join to fire this song">' + ms("mode_heat") + "</button>" +
        '<button type="button" class="butt graybutt iconbutt pb-savelive' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "In your crate" : "Save to your crate") + '" aria-label="' + esc(saved ? "In your crate" : "Save to your crate") + '">' + ms(saved ? SAVED_ICON : SAVE_ICON) + "</button>";
    } else keep.innerHTML = "";

    // transport
    var tr = document.getElementById("pv-transport");
    var idx = P.i;
    var mainLabel = "Play", mainIcon = "play_arrow";
    if (kind === "discover" || kind === "pick") { mainIcon = P.paused || kind === "pick" ? "play_arrow" : "pause"; mainLabel = mainIcon === "pause" ? "Pause" : "Play"; }
    else if (kind === "live") { mainIcon = "stop"; mainLabel = "Stop listening to the room"; }
    else if (kind === "onair") mainLabel = "Listen live";
    var disc = kind === "discover" || kind === "pick";
    tr.innerHTML = (disc ? '<button type="button" class="butt graybutt iconbutt d-prev" title="Previous" aria-label="Previous"' + (shuffle.before(idx) < 0 && P.at <= 3 ? " disabled" : "") + ">" + ms("skip_previous", true) + "</button>" : "") +
      '<button type="button" class="butt iconbutt pb-main d-big" title="' + mainLabel + '" aria-label="' + mainLabel + '"' + (kind === "quiet" ? " disabled" : "") + ">" + ms(mainIcon, true) + "</button>" +
      (disc ? '<button type="button" class="butt graybutt iconbutt d-next" title="Next" aria-label="Next"' + (shuffle.after(idx) < 0 ? " disabled" : "") + ">" + ms("skip_next", true) + "</button>" : "");
    // a Discover song's reload: among the tools, where the room's own reload is (shown while it stalls;
    // drawn again only when it changes, so the bar redrawing meanwhile doesn't start its wait over)
    redraw(document.getElementById("pv-dtools"), disc ? shuffle.button() + RELOAD_SONG : "");

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
      acts.innerHTML = live && D.mode === "discover" ? '<button type="button" class="butt graybutt small d-stepin pb-stepin" title="Go to Live: the stage, the DJs, everyone">' + ms("sensors") + "<span>Go to Live</span></button>" : "";
    }

    // the other source, one tap away
    var sw = document.getElementById("pv-switch");
    if (disc && s) {
      sw.innerHTML = '<button type="button" class="pb-other d-listen" title="Listen live: ' + esc(s.t) + '"><span class="d-mini-art" style="background-image:url(' + esc(artOf(s)) + ')"></span>' +
        '<span class="d-mini-text"><b><i class="d-dot" aria-hidden="true"></i>The room</b><span>' + esc(s.t) + "</span></span><span class=\"pb-otherdo\">Listen live</span></button>";
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
      // the stage's own screen and reload (placeStage moves them in): screen on, off or synced; a
      // Discover song's own reload where the room's is; then the stage's cast button
      '<span class="pb-host" id="pv-fscreen"></span><span class="pb-host" id="pv-fdtools"></span><span class="pb-host" id="pv-fcast"></span>' +
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
   * tap away (the room's song with Listen live, or a paused pick with Back to it).
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
      var next = list && list.tracks[shuffle.after(P.i)];
      if (next) out += line("pvf-playnext", "Next", next, "Play now");
      if (t && P.inRoom && String(P.inRoom.cid) === String(t.cid)) out += '<p class="pvf-line pvf-note" id="pv-toRoomNote">' + toRoomNote(t, firetable.saved.where(t.type, t.cid)) + "</p>";
      if (s) out += line("d-listen", '<i class="d-dot" aria-hidden="true"></i>The room', s, "Listen live");
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
        esc(blocked() ? "Your browser held the room's sound back. Press play" : "Not listening · press play to listen live") + "</span>";
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
      keep = '<button type="button" class="butt graybutt iconbutt d-savebtn' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "Saved in " + saved + ". Save again" : D.signedIn ? "Save to a playlist" : "Save to your crate") + '" aria-label="' + esc(saved ? "Saved in " + saved : "Save") + '">' + ms(saved ? SAVED_ICON : SAVE_ICON) + "</button>";
      var done = P.inRoom && String(P.inRoom.cid) === String(t.cid);
      var label = !D.signedIn ? "Join to play it in the room" : done ? "First in your DJ playlist" : "Play it in the room";
      keep += '<button type="button" class="butt graybutt iconbutt d-toroom' + (done ? " is-done" : "") + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + ms(done ? "check" : "queue_play_next") + "</button>";
      acts = (url ? '<a class="butt graybutt iconbutt" target="_blank" rel="noopener" href="' + esc(url) + '" title="Open on ' + openOn + '" aria-label="Open on ' + openOn + '">' + ms("open_in_new") + "</a>" : "") +
        '<button type="button" class="butt graybutt iconbutt d-more" title="More" aria-label="More about this song" aria-haspopup="menu">' + ms("more_vert") + "</button>";
    } else if (room && !D.signedIn) {
      keep = '<button type="button" class="butt graybutt iconbutt pb-joinfire" title="Join to fire this song" aria-label="Join to fire this song">' + ms("mode_heat") + "</button>" +
        '<button type="button" class="butt graybutt iconbutt pb-savelive' + (saved ? " is-saved" : "") + '" title="' + esc(saved ? "In your crate" : "Save to your crate") + '" aria-label="' + esc(saved ? "In your crate" : "Save to your crate") + '">' + ms(saved ? SAVED_ICON : SAVE_ICON) + "</button>";
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
    else if (kind === "onair") { mainIcon = "play_arrow"; mainLabel = "Listen live"; }
    else { mainIcon = "play_arrow"; mainLabel = "Play"; }
    tr = (disc ? '<button type="button" class="butt graybutt iconbutt d-prev" title="Previous (Shift + ←)" aria-label="Previous"' + (shuffle.before(P.i) < 0 && P.at <= 3 ? " disabled" : "") + ">" + ms("skip_previous", true) + "</button>" : "") +
      '<button type="button" class="butt iconbutt pvf-main d-big" title="' + mainLabel + ' (Space)" aria-label="' + mainLabel + '"' + (kind === "quiet" ? " disabled" : "") + ">" + ms(mainIcon, true) + "</button>" +
      (disc ? '<button type="button" class="butt graybutt iconbutt d-next" title="Next (Shift + →)" aria-label="Next"' + (shuffle.after(P.i) < 0 ? " disabled" : "") + ">" + ms("skip_next", true) + "</button>" + shuffle.button("pb-small") : "");
    redraw(document.getElementById("pv-ftransport"), tr);
    // reload is at the top with the screen and cast, not beside play: the room's is the stage's own (placeStage)
    redraw(document.getElementById("pv-fdtools"), disc ? RELOAD_SONG : "");
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
    lingerData();
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
    return routeAt(location) || parseRoute((document.querySelector('meta[name="ft-route"]') || {}).content || "");
  }
  function addressFor() {
    if (D.mode === "live") return "#live";
    if (D.view === "home") return "#discover";
    if (D.view === "charts") {
      var id = D.chart.id || currentId(D.chart.period);
      return "#discover/charts" + (D.chart.period !== "week" || D.chart.id ? "/" + D.chart.period + (id && D.chart.period !== "all" ? "/" + id : "") : "");
    }
    return "#discover/" + D.view + (D.sub ? "/" + (D.view === "search" ? encodeURIComponent(D.sub) : D.sub) + (D.view === "genres" && D.year ? "/" + D.year : "") : "");
  }
  /** The page that's showing, as {mode, view, sub, period, id}. */
  function current() {
    return { mode: D.mode, view: D.view, sub: D.sub, year: D.view === "genres" ? D.year : null, period: D.view === "charts" ? D.chart.period : null, id: D.view === "charts" ? D.chart.id : null };
  }
  /** This page's address: its own in the library when it has one, else the site's with a #. */
  function urlFor() {
    return (D.mode === "discover" && pathOf(current())) || SITE_PATH + addressFor();
  }
  function writeAddress() {
    var want = urlFor();
    if (location.pathname + location.hash !== want) {
      var cut = want.indexOf("#");
      try { history.replaceState(history.state, "", (cut === -1 ? want : want.slice(0, cut)) + location.search + (cut === -1 ? "" : want.slice(cut))); } catch (e) { /* stays as it is */ }
    }
    handled = location.href;
    writeTitle();
  }
  // The tab's name follows the page (history, bookmarks, a shared tab). The
  // page someone arrived on keeps the title it was sent with.
  var HOME_TITLE = (document.querySelector('meta[name="ft-home-title"]') || {}).content || document.title;
  var landed = document.querySelector('meta[name="ft-route"]') ? null : false;
  var handled = location.href;
  function titleFor() {
    if (D.mode !== "discover" || D.view === "home") return HOME_TITLE;
    var room = ftconfigs.roomName || "firetable";
    var v = D.view, name = "";
    if (v === "genres" && D.sub) name = ((libData.genres || {})[D.sub] || {}).name ? "Best " + libData.genres[D.sub].name + " songs" + (D.year ? " of " + D.year : "") : "";
    else if (v === "djs" && D.sub) name = (libData["dj/" + D.sub] || (libData.djs || {})[D.sub] || {}).name ? (libData["dj/" + D.sub] || libData.djs[D.sub]).name + ", DJ" : "";
    else if (v === "artist") { name = (libData["artist/" + D.sub] || {}).name || ((libData.artistIndex || {})[D.sub] || [])[0] || ""; if (name) name += ": top songs"; }
    else if (v === "page") return (builtPages[D.sub] || {}).title || "The library · " + room;
    else if (v === "years" && D.sub) name = "The best songs of " + D.sub;
    else if (v === "bpm") name = D.sub + " BPM songs";
    else if (v === "search") name = D.sub ? "Search: " + D.sub : "Search";
    else if (v === "charts") name = "Charts";
    else if (v === "new") name = "New releases";
    if (!name) name = (VIEWS.filter(function (x) { return x.id === v; })[0] || {}).label || "";
    return name ? name + " · " + room : HOME_TITLE;
  }
  function writeTitle() {
    var at = location.pathname + location.hash;
    if (landed === null) landed = at;
    if (landed === at) return;
    landed = false;
    var t = titleFor();
    if (document.title !== t) document.title = t;
  }
  /** Go to a page from its words after # ("discover/djs/matt"), as a link to it would. */
  function goTo(words) {
    var r = parseRoute(words);
    if (!r) return;
    try { history.pushState(null, "", urlTo(words)); } catch (e) { /* the page still changes */ }
    openRoute(r);
  }
  /** Show the page an address names (a link, Back and Forward, a # typed or set). */
  function openRoute(r) {
    closeMenu();
    applyRoute(r);
    setMode(r.mode, { remember: true });
    if (r.mode === "discover") setView(D.view, D.sub, D.year);
  }
  function onAddress() {
    if (location.href === handled) return;
    handled = location.href;
    var r = route();
    if (r) openRoute(r);
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
    // which it is, Listen live takes you to the room, a song in Discover away from it.
    if (!D.src) setSrc("live"); // the room plays until something is picked
    if (mode === "live") {
      lingerData();
      chatBack();
      queue.back();
      if (D.sideTab === "chat") D.sideTab = "list";
      document.body.classList.remove("d-sheet-open");
      // the stage measures itself again, after Live is on screen: measured straight
      // away, it laid the whole page out twice before the switch could show
      if (changed) requestAnimationFrame(function () { setTimeout(function () { window.dispatchEvent(new Event("resize")); }); });
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
    findReady().then(function (f) { f.warm(); }, quiet);
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

  function setView(view, sub, year) {
    D.view = view;
    D.sub = sub || null;
    D.year = (view === "genres" && sub && year) || null;
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
    lockedTabs();
  }
  function quiet(err) { firetable.debug && console.log("[discover] not readable yet:", err && err.message); }
  // Leaving for Live lets go of it only after a few minutes there: going back
  // and forth (the usual) found it all again each time, and drew Discover's
  // page four more times as each part came back.
  function lingerData() { clearTimeout(lingerData.at); lingerData.at = setTimeout(releaseData, 3 * 60000); }
  /** Stop following Discover's live data once neither Discover nor the full player is open. */
  function releaseData() {
    if (!watching || D.mode === "discover" || F.open) return;
    watching = false;
    following.splice(0).forEach(function (f) { f[0].off("value", f[1]); });
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

  // (The chat is for members only, the owner's call, November 2026: no chat to read for visitors, only lockedTabs.)

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
    if ((b = t.closest("#nav-tabs [data-tab]"))) return tabBar.go(b.getAttribute("data-tab"));
    if (soundMap && (b = t.closest("#dBrowse .d-mapg, #dBrowse .d-mapnext")) && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      return soundMap.pick(b.getAttribute("data-slug"));
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
    if (F.open && routeLink(t.closest("#pv-full a[href]"))) closeFull(); // an artist, genre or DJ page: show it
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
    if ((b = t.closest(".pvf-list"))) { closeFull(); return showSide("list"); }
    if ((b = t.closest(".d-stepdown"))) {
      var was = deckState();
      ftapi.actions.sendBotCommand("!removeme");
      return firetable.ui.toast(was.on ? "Stepping down from the decks" : "Leaving the line for the decks");
    }
    if ((b = t.closest("[data-sidetab]"))) { D.sideTab = b.getAttribute("data-sidetab"); if (D.sideTab === "chat") D.unread = 0; return renderSide(); }
    // the player bar
    if ((b = t.closest(".pb-main"))) return mainButton();
    if ((b = t.closest(".d-toroom-undo"))) return undoToRoom();
    if ((b = t.closest(".d-toroom"))) {
      var room = P.track;
      if (D.signedIn && P.inRoom && room && String(P.inRoom.cid) === String(room.cid)) return firetable.ui.toast("It's already first in " + firetable.utilities.listName(P.inRoom.list) + ".", "notice", { action: { label: "Undo", fn: undoToRoom } });
      return toRoom(room);
    }
    if ((b = t.closest(".pb-joinfire"))) return showSignIn("create");
    if ((b = t.closest(".pb-savelive"))) return liveTrack() && save(liveTrack(), b);
    // the playlist panel
    if ((b = t.closest(".pl-shuffle"))) return shuffle.start(b.getAttribute("data-list"));
    if ((b = t.closest(".pl-cratetop"))) {
      var cr = crate();
      var moved = cr.splice(Number(b.getAttribute("data-i")), 1);
      setCrate(moved.concat(cr));
      return renderSide();
    }
    if ((b = t.closest("#dLocked [data-locked]"))) { lockedTab = b.getAttribute("data-locked"); return lockedTabs(); }
    if ((b = t.closest(".d-chatnav"))) { D.unread = 0; return showSide("chat"); }
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
    if ((b = t.closest(".d-segbtn[data-gview]"))) { D.genreView = b.getAttribute("data-gview"); return renderBrowse(); }
    if ((b = t.closest(".d-homemore"))) { var k = b.getAttribute("data-more"); D.homeMore[k] = !D.homeMore[k]; return renderBrowse(); }
    if ((b = t.closest("#dSearchOpen"))) return openSearch();
    if (t.closest(".d-import")) return D.importMeta && firetable.importer.open(D.importMeta);
    if ((b = t.closest(".d-sheetlink"))) { e.preventDefault(); return openSheet(songFrom(b)); }
    if ((b = t.closest("#thehistory .pv-dj-avatar"))) {
      var key = djKey(b.getAttribute("data-avatar-uid"), b.getAttribute("aria-label"));
      if (key) return goTo("discover/djs/" + key);
    }
    if ((b = t.closest(".d-ytsearch"))) return findReady().then(function (f) { f.youtube(D.sub || ""); }, quiet);
    if ((b = t.closest(".d-playall"))) return shuffle.playAll(b.getAttribute("data-list"));
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
    if ((b = t.closest(".d-reload"))) return reloadPick();
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
        if (el !== main) el.setAttribute("tabindex", "-1");
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

  /**
   * A genre's radio: its favorites, new finds and deep cuts, shuffled. From
   * the map's card its songs may not be read yet: read them (once, as its page
   * does), then play, unless something else was asked for meanwhile: another
   * radio (the last one asked for plays), a song, Listen in, a pause, the room
   * stopped.
   */
  var radioAsk = 0;
  function playRadio(slug) {
    var page = lib("genre/" + slug), ask = ++radioAsk, was = P.play + "|" + D.src + "|" + P.paused;
    if (page === undefined) return libAsked["genre/" + slug].then(function () { if (ask === radioAsk && P.play + "|" + D.src + "|" + P.paused === was) playRadio(slug); });
    var g = (libData.genres || {})[slug];
    if (!page || !g) return firetable.ui.toast("There's no radio for this genre yet. " + LIB_LATER);
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
    artistsOf(t.a).slice(0, 3).forEach(function (a) { h += item("person", "Go to " + esc(a), 'href="' + hrefTo("discover/artist/" + artistSlug(a)) + '"'); });
    if (t.g) h += item("category", "More " + esc(t.g), 'href="' + hrefTo("discover/genres/" + genreSlug(t.g)) + '"');
    var dj = t.dj ? djShown(t.djid, t.dj) : null;
    var key = dj && djKey(dj.uid, dj.name);
    if (key) h += item("headphones", esc(dj.name) + "'s DJ page", 'href="' + hrefTo("discover/djs/" + key) + '"');
    if (url) h += act("copy");
    // the song playing in the bar: reload it, if it stalls (the bar keeps its reload out of sight until then)
    if (discoverActive() && String(P.track.cid) === String(t.cid)) h += item("refresh", "Reload audio", 'href="#" data-act="reload"');
    if (canRetag(t)) h += act("tags");
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
    if (act === "reload") return reloadPick();
    if (act === "toroom" && t) return toRoom(t);
    if (act === "sheet" && t) return openSheet(t);
    if (act === "add" && t) return save(t, opener || b);
    if (act === "copy" && t) firetable.songMenu.copyLink(linkOf(t));
    if (act === "tags" && t) return editTags(t, opener && opener.isConnected ? opener : b);
  }

  // ─── Fixing a song's tags (mods) ────────────────────────────────────────
  // The site's tag editor, as on Recent: saving fixes the upload's tags for
  // the room (globalTracks, and the tag log the hostbot spreads to every copy
  // and to Discover's published charts and lists). The room's own song goes
  // through !fixtags, so the stage shows it too. What's on screen here takes
  // the new tags at once.

  /** Mods can fix a song's tags: any upload with a valid id. */
  function canRetag(t) {
    return !!(ftapi.uid && ftapi.isMod && t && t.cid != null && /^[12][A-Za-z0-9_-]{1,64}$/.test(Number(t.type || 1) + String(t.cid)));
  }
  function editTags(t, anchor) {
    if (!canRetag(t)) return;
    var type = Number(t.type || 1), cid = String(t.cid);
    var before = (t.a ? t.a + " - " : "") + (t.t || "");
    $(".pvbar.editing").removeClass("editing");
    firetable.editingPvbar = null;
    firetable.tagEditNowPlaying = null;
    firetable.ui.openTagEditor(anchor, before, "bottom");
    firetable.tagEditTarget = {
      save: function (tag) {
        if (tag === before) return;
        var s = firetable.song;
        var playing = s && String(s.cid) === cid && Number(s.type || 1) === type;
        var shown = function () { retagged(type, cid, tag); };
        if (playing) {
          ftapi.actions.sendBotCommand("!fixtags " + tag);
          firetable.ui.toast("Tags sent: " + tag, "success");
          return shown();
        }
        ftapi.actions.editTag(type, cid, tag, null, "discover", function (err) {
          if (err) return firetable.ui.toast("Couldn't save those tags. Please try again.", "error");
          firetable.ui.toast("Tags saved: " + tag, "success");
          shown();
        });
      }
    };
  }
  /** The song's rows everywhere Discover keeps them, as the hostbot's retag does. */
  function eachSongRow(value, type, cid, fn, seen) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (value.cid != null && String(value.cid) === cid && Number(value.type || 1) === type && (typeof value.a === "string" || typeof value.t === "string")) return fn(value);
    Object.keys(value).forEach(function (k) { eachSongRow(value[k], type, cid, fn, seen); });
  }
  function retagged(type, cid, tag) {
    var sep = tag.indexOf(" - ");
    var a = sep === -1 ? tag : tag.slice(0, sep), ti = sep === -1 ? "" : tag.slice(sep + 3);
    var seen = new Set();
    [D.data, libData, lists, P.track, sheetTrack, menuTrack].forEach(function (v) {
      eachSongRow(v, type, cid, function (row) { row.a = a; row.t = ti; }, seen);
    });
    delete details[type + "_" + cid]; // its history may now be another song's
    if (P.track && String(P.track.cid) === cid && Number(P.track.type || 1) === type && discoverActive()) mediaSession(P.track);
    if (D.mode === "discover") renderBrowse();
    renderSide();
    renderBar();
    renderFull(true);
    var dlg = document.getElementById("dSheetBox");
    if (dlg && dlg.open && sheetTrack && String(sheetTrack.cid) === cid && Number(sheetTrack.type || 1) === type) openSheet(sheetTrack);
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
  // Live's Recent and stage are drawn by room.js; this only adds to
  // what's there, watching for new rows: artist names link to their pages,
  // a DJ's robot to their DJ page, and a song's title opens its sheet.

  function linkLive(root) {
    root.querySelectorAll(".hist-track-artist, #artist").forEach(function (el) {
      if (el.closest("#dBrowse")) return;
      var text = el.textContent;
      if (!text || el.getAttribute("data-linked") === text) return;
      el.setAttribute("data-linked", text);
      el.innerHTML = artistLinks(text);
    });
    root.querySelectorAll(".hist-track-title, #track").forEach(function (el) {
      // (the stage card's title with no song on is words: there's nothing to open, js/stage-state.js)
      if (el.closest("#dBrowse") || el.classList.contains("d-sheetlink") || (el.id === "track" && !liveTrack())) return;
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
    var artistEl = bar.querySelector(".hist-track-artist");
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
        if (routeLink(e.target.closest("a[href]"))) return dlg.close();
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
      '<button type="button" class="butt graybutt d-sheetsave' + (saved ? " is-saved" : "") + '">' + ms(saved ? SAVED_ICON : SAVE_ICON) + "<span>" + (saved ? "Saved" : "Save") + "</span></button>" +
      (link ? '<a class="butt graybutt iconbutt" href="' + esc(link) + '" target="_blank" rel="noopener" title="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '" aria-label="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '">' + ms("open_in_new") + "</a>" +
        '<button type="button" class="butt graybutt iconbutt d-sheetcopy" title="Copy the song\'s link" aria-label="Copy the song\'s link">' + ms("link") + "</button>" : "") +
      "</div></div></div>";
    if (!dlg.open) dlg.showModal();
    loadDetails(t).then(function (d) {
      if (sheetTrack !== t) return;
      var tags = (d.genres || []).slice(0, 3).map(function (g) { return '<a class="d-tag" href="' + hrefTo("discover/genres/" + genreSlug(g)) + '">' + esc(g) + "</a>"; });
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

  /** The chart on show as a picture (1080 × 1350, for posts and stories): js/chart-image.js draws it, loaded the first time. */
  function chartImage() {
    var period = D.chart.period;
    var id = D.chart.id || currentId(period);
    var rows = chartRows(D.data.charts[period + "/" + id]).slice(0, 10);
    if (!rows.length) return firetable.ui.toast("This chart has no songs yet.");
    firetable.ui.toast("Making the image…");
    ftLazy.own("chart-image-js", "js/chart-image.js").then(function () {
      return firetable.chartImage({ title: chartTitle(period, id), file: "room-chart-" + (period === "all" ? "all-time" : id) + ".png",
        rows: rows.map(function (t) { return { t: t.t, a: t.a, plays: t.plays, art: artOf(t) }; }) });
    }).catch(function (err) {
      console.error("[firetable] the chart's image:", err);
      firetable.ui.toast("Couldn't make the image.", "error");
    });
  }

  /** The code to put the chart on another site, always showing the latest. */
  function embedDialog() {
    var period = D.chart.period;
    var src = location.origin + "/embed/chart/?period=" + period + (D.chart.id && period !== "all" ? "&id=" + encodeURIComponent(D.chart.id) : "");
    // a line of credit under it, a real link to this chart's page (a link inside the frame doesn't count as one from their site)
    var code = '<iframe src="' + src + '" width="400" height="640" style="border:0;border-radius:8px" title="' + esc(ftconfigs.roomName || "Room") + ' chart" loading="lazy"></iframe>' +
      '\n<p style="margin:4px 0 0;font:12px sans-serif"><a href="' + esc(location.origin + (pathOf(current()) || MUSIC_PATH + "charts/")) + '">' + esc(ftconfigs.roomName || "Room") + " chart</a></p>";
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
    var url = location.origin + urlFor();
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
    // named: the toolbar draws each one's icon as a word (css/rail.css ::before), which was read in its name
    tabs.innerHTML = '<button type="button" role="tab" class="tab" data-mode="discover" aria-selected="false" aria-label="Discover">Discover</button>' +
      '<button type="button" role="tab" class="tab" data-mode="live" aria-selected="false" aria-label="Live"><i class="d-dot" aria-hidden="true"></i>Live</button>';
    document.getElementById("topbar").insertBefore(tabs, document.getElementById("topbarUtils")); // before the icons: Tab goes logo, theme, switch, icons
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
      '<input type="search" id="dQ" placeholder="Artists, songs, genres, DJs" aria-label="Search the library" autocomplete="off" enterkeyhint="search" /></form>' +
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
    document.getElementById("dMini").insertAdjacentHTML("afterend", tabBar.html());
    if (filledHtml) {
      document.getElementById("dBrowse").innerHTML = filledHtml;
      D.prerendered = true;
      var here = route();
      if (here && here.view === "page") builtPages[here.sub] = { html: filledHtml, title: document.title };
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
      // the stage's screen, reload, cast and full screen (placeStage moves them in), around a Discover song's reload and the volume
      '<div class="pb-tools"><span class="pb-host" id="pv-tools"></span><span class="pb-host" id="pv-dtools"></span><span class="pb-host" id="pv-cast"></span></div>' +
      '<div class="pb-vol"><button type="button" class="butt graybutt iconbutt d-mute" aria-label="Mute">' + ms("volume_up") + "</button>" +
      '<input type="range" id="pv-vol" min="0" max="100" step="5" value="50" aria-label="Volume" /></div>' +
      '<div class="pb-tools pb-fs"><span class="pb-host" id="pv-fs"></span></div></div>' +
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
    // unless they've gone to Live or Listen, or picked another song, in meanwhile
    var was = P.play;
    setTimeout(function () { if (P.play === was && firetable.preview === "discover" && discoverActive()) step(1); }, 800);
  }

  function signedIn(on) {
    D.signedIn = on;
    document.body.classList.toggle("d-member", !!on);
    if (!on) { chatBack(); queue.back(); if (D.sideTab === "chat") D.sideTab = "list"; if (finder) finder.forget(); }
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
    lockedTabs();
  }

  function applyRoute(r) {
    if (r.view) {
      if (r.view !== D.view || r.sub !== D.sub) { D.genreTab = "fav"; D.djTab = null; D.showAll = {}; }
      D.view = r.view;
      D.sub = r.sub || null;
      D.year = r.year || null;
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
      // the left column starts below the header, whatever its height. Live's
      // header and Discover's differ: each keeps its own (Discover's on its
      // left column, Live's on the page), so switching doesn't change a value
      // on the page, which made the browser restyle all of it every time
      var topbar = document.getElementById("topbar");
      var measure = function () { (D.mode === "discover" && document.getElementById("dRail") || document.documentElement).style.setProperty("--topbar-h", topbar.offsetHeight + "px"); };
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
            renderRail();
            renderBrowse();
            writeAddress();
          }, 200);
          return;
        }
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
      });
      document.addEventListener("submit", function (e) {
        if (e.target.id !== "dSearch") return;
        e.preventDefault();
        var v = document.getElementById("dQ").value.trim();
        if (!v) return;
        clearTimeout(typed);
        setView("search", v);
        if (D.signedIn && !(firetable.importer && firetable.importer.parseLink(v))) findReady().then(function (f) { f.youtube(v); }, quiet);
      });
      window.addEventListener("resize", function () { closeMenu(); });
      document.addEventListener("scroll", function () { closeMenu(); }, true);
      // DJ pages, for linking names (a small list); after the page has settled
      setTimeout(function () { lib("djs"); }, 2500);
      // A link to one of the site's pages opens it here, at its own address,
      // with nothing reloaded. On window: after every other click handler, where
      // the browser itself would have followed the link.
      window.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest("a[href]");
        // a button written as a link: under <base href="/"> its "#" would leave a library page for the home page
        if (a && a.getAttribute("href") === "#") return e.preventDefault();
        var r = routeLink(a);
        if (!r) return;
        e.preventDefault();
        if (a.pathname + a.hash !== location.pathname + location.hash) {
          try { history.pushState(null, "", a.pathname + a.hash); } catch (err) { /* the page still changes */ }
        }
        handled = location.href;
        openRoute(r);
      });
      window.addEventListener("popstate", onAddress);
      window.addEventListener("hashchange", onAddress);
      // (SoundCloud's FINISH reaches onEnded through the widget's own binding, player.js)
      ftapi.events.on("loggedIn", function () { signedIn(true); });
      // (then the side again: the room's card waits for #mainGrid .login, which users.js's
      // showLoginScreen sets in a handler bound after this one, in js/init.js)
      ftapi.events.on("loggedOut", function () { signedIn(false); setTimeout(renderSide, 0); });
      // after room.js's own (bound later, in ui.init), which sets firetable.song: the bar showed the song before
      ftapi.events.on("newSong", function () { setTimeout(function () {
        mapMarks();
        renderFull(true);
        yourTurn();
        if (D.src === "live" && liveTrack()) mediaSession(liveTrack(), true);
        renderBar();
      }, 0); });
      // a mod fixed the room song's tags: the bar and Now playing follow
      // (after room.js, whose handler corrects firetable.song first)
      ftapi.events.on("tagUpdate", function (data) { setTimeout(function () { tagsFixed(data); }, 0); });
      // the room's seats and line: the bar's and panels' "you're next", Hop on
      var seats = firetable.utilities.oncePerFrame(function () {
        renderFull();
        if (queue.here()) queue.refresh();
        renderBar();
      });
      ["tableChanged", "waitlistChanged", "spotlightStateChanged"].forEach(function (ev) { ftapi.events.on(ev, seats); });
      // the browser holding the room's sound back (or letting it go) changes what the bar says
      // (and the stage's screen going up or down changes the full player's view)
      // (and the right column's sheet opening or closing lights the tab bar: a visitor's crate is their Library)
      var wasBlocked = blocked(), wasScreen = fullView(), wasSheet = false;
      new MutationObserver(function () {
        if (document.body.classList.contains("d-sheet-open") !== wasSheet) { wasSheet = !wasSheet; renderTabs(); }
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
      // Home, Fresh, Charts and Recent show people's names and faces (and hide the
      // ones who asked): redraw them only when those change, not on every
      // tab someone hides or shows (idle), which rebuilt every shelf
      var browseUsers = null;
      ftapi.events.on("usersChanged", firetable.utilities.oncePerFrame(function () {
        renderFull(); // "N here"
        renderBar();
        var sig = firetable.utilities.usersSig();
        if (sig === browseUsers) return;
        browseUsers = sig;
        if (D.mode === "discover" && /^(home|fresh|charts|recent)$/.test(D.view)) renderBrowse();
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
      return key ? urlTo("discover/djs/" + key) : null;
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
    /** The page showing, as the words after # ("#discover/genres/house", "#live"), whatever its address looks like. */
    address: function () { return addressFor(); },
    /** Its address in the address bar. */
    url: function () { return urlFor(); },
    state: function () { return { tab: tabBar.lit(), mode: D.mode, view: D.view, listening: D.listening, playing: P.track && P.track.cid, list: P.list, i: P.i, full: F.open, fullView: fullView() }; }
  };
})();
