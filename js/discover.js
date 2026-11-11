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
 * Views: Home, New, Charts, Genres, DJs, Years, Recent plays, and a page
 * for each genre, DJ, artist and year. The bot publishes the charts, new
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
 * plays whole songs and isn't scrobbled.
 *
 * Visitors save songs to a crate kept in this browser. The third save offers
 * to keep it; when they join, it becomes a playlist ("My Discover crate"),
 * their DJ playlist if they have none yet. "Step inside" shows Live as
 * visitors see it today, with the chat to read (discover/chat).
 *
 * Addresses: #discover, #discover/new, #discover/charts,
 * #discover/charts/<week|month|year|all>/<id>, #discover/genres[/<slug>],
 * #discover/djs[/<key>], #discover/years[/<year>], #discover/artist/<slug>,
 * #discover/recent, #live.
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
    newFilter: "month",  // month | days90 | unplayed
    newLayout: "grid",
    sideTab: "now",      // now | list
    chartGenre: null,    // the chart, narrowed to one genre
    chartNew: false,     // the chart, new releases only
    genreTab: "fav",     // fav | newHere | deep
    djTab: "most",       // most | firstHere
    djSort: "plays",     // plays | firsts | since | name
    djFind: "",
    homeMore: {},
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
  function rowAttrs(t, list, i) {
    return ' data-cid="' + esc(t.cid) + '" data-type="' + esc(t.type || 1) + '" data-list="' + esc(list) + '" data-i="' + i + '"';
  }

  /** A song as a Fresh card. */
  function card(t, list, i, meta) {
    var playing = isPlaying(list, i);
    return '<div class="pvbar' + (playing ? " previewing" : "") + '"' + rowAttrs(t, list, i) + ">" +
      '<div class="pv-art discart" style="background-image:url(' + esc(artOf(t)) + ')">' +
      '<button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + (isSounding(list, i) ? "Pause" : "Play") + '">' + (isSounding(list, i) ? "pause" : "play_arrow") + "</button></div>" +
      '<div class="qtxt"><div class="listwords"><div class="fresh-title"><span class="fresh-track-title d-sheetlink" role="button" tabindex="0">' + esc(t.t) + '</span><span class="fresh-track-artist">' + artistLinks(t.a) + "</span></div>" +
      moreButton() + saveButton(t) + "</div>" +
      '<div class="fresh-meta">' + robotLink(meta.dj) + '<span class="histdj">' + esc(meta.who || "") + '</span><span class="histdate">' + esc(meta.date || "") + '</span><span class="histtime">' + esc(meta.extra || "") + "</span></div></div></div>";
  }

  /** A song as a Recent row on the timeline. */
  function row(t, list, i, meta) {
    var playing = isPlaying(list, i);
    return '<div class="hist-entry"><span class="hist-timestamp' + (meta.rank ? " d-rank" : "") + '">' + esc(meta.stamp || "") + "</span>" +
      (meta.dj ? robotLink(meta.dj) : '<span class="ft-avatar pv-dj-avatar dj-avatar-tip d-nobody" aria-hidden="true"></span>') +
      '<div class="pvbar' + (playing ? " previewing" : "") + '"' + rowAttrs(t, list, i) + ">" +
      '<div class="pv-art histart" style="background-image:url(' + esc(artOf(t)) + ')"><button type="button" class="material-symbols-filled previewicon d-play" aria-label="' + (isSounding(list, i) ? "Pause" : "Play") + '">' + (isSounding(list, i) ? "pause" : "play_arrow") + "</button></div>" +
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

  function newMeta(t) {
    var dj = t.dj ? djShown(t.djid, t.dj) : null;
    if (!t.plays) return { who: "Not played live yet", date: "", extra: "" };
    return { dj: dj, who: "", date: "first " + firetable.utilities.shortDate(t.first), extra: firetable.utilities.pluralize(t.plays, "play", "plays") };
  }

  function chartRows(chart) {
    return ((chart && chart.rows) || []).map(function (r, i) {
      return { type: r.type || 1, cid: r.cid, a: r.a, t: r.t, plays: r.plays, fires: r.fires || 0, mv: r.mv, wks: r.wks, dj: r.dj, djid: r.djid, first: r.first, g: r.g || null, rank: i + 1 };
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
    { id: "genres", label: "Genres", icon: "category" },
    { id: "djs", label: "DJs", icon: "headphones" },
    { id: "years", label: "Years", icon: "calendar_month" },
    { id: "themes", label: "Theme nights", icon: "nightlife" },
    { id: "recent", label: "Recent plays", icon: "history" }
  ];
  var VIEW_IDS = VIEWS.map(function (v) { return v.id; }).concat(["artist", "search"]);

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

  function newList(tracks, layout, listName, max, compact) {
    tracks = max ? tracks.slice(0, max) : tracks;
    if (!tracks.length) return D.data.new ? emptyNote("No new releases here yet. The bot adds them once a day.") : loading();
    if (layout === "list") {
      return '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
        var m = newMeta(t);
        return row(t, listName, i, { stamp: firetable.utilities.shortDate(t.rel), dj: m.dj, right: m.extra || "new" });
      }).join("") + "</div>";
    }
    return '<div class="ft-cards' + (compact ? " d-compact" : "") + '">' + tracks.map(function (t, i) { return card(t, listName, i, newMeta(t)); }).join("") + "</div>";
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
      var right = genreLink(t.g) +
        (t.fires ? '<span class="d-fires" title="' + esc(firetable.utilities.pluralize(t.fires, "fire", "fires")) + ' (not counted)">' + ms("local_fire_department") + '<span class="d-num">' + esc(t.fires) + "</span></span>" : "") +
        (period === "week" ? movement(t.mv) + (t.wks > 1 ? '<span class="d-num d-wks" title="weeks in a row on the chart">' + esc(t.wks) + " wks</span>" : "") : "") +
        '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>";
      return row(t, listName, i, { stamp: "#" + (t.rank || i + 1), rank: true, dj: djShown(t.djid, t.dj), right: right });
    }).join("") + "</div>";
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
    h += "<section>" + head(newTitle, "All new releases", "discover/new") + newList(nt, "grid", "home-new", 18, true) + "</section>";
    h += "<section>" + head("Room chart · this week", "Full chart", "discover/charts") + chartList(chart, "home-chart", 5, "week") + "</section>";
    if (rising.length) {
      var rn = D.homeMore.rising ? rising.length : 5;
      h += "<section>" + head("Rising") + '<p class="d-fact">Played more in the last four weeks than the four before</p>' +
        '<div class="ft-rows d-rowlist">' + rising.slice(0, rn).map(function (t, i) {
          return row(t, "home-rising", i, { stamp: "#" + (i + 1), rank: true, dj: djShown(t.djid, t.dj),
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

  function viewNew() {
    var tracks = newTracks();
    setList("new", "New releases", tracks);
    return '<div class="d-headrow"><h2>New</h2>' + chips("new", [["month", "This month"], ["days90", "Last 90 days"], ["unplayed", "Not played live yet"]], D.newFilter) + layoutButtons(D.newLayout) + "</div>" +
      '<p class="d-fact">' + esc(firetable.utilities.pluralize(tracks.length, "song", "songs")) + " from this year's playlist, newest first</p>" +
      newList(tracks, D.newLayout, "new");
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
    h += '<div class="d-chips" role="group" aria-label="Which songs">' +
      '<button type="button" class="d-chip' + (D.chartNew ? "" : " on") + '" data-cnew="" aria-pressed="' + !D.chartNew + '">All songs</button>' +
      '<button type="button" class="d-chip' + (D.chartNew ? " on" : "") + '" data-cnew="1" aria-pressed="' + !!D.chartNew + '">New releases</button></div>';
    if (gs.length > 1) {
      h += '<div class="d-chips" role="group" aria-label="Genre">' +
        '<button type="button" class="d-chip' + (D.chartGenre ? "" : " on") + '" data-cgenre="" aria-pressed="' + !D.chartGenre + '">All genres</button>' +
        gs.map(function (g) {
          return '<button type="button" class="d-chip' + (D.chartGenre === g ? " on" : "") + '" data-cgenre="' + esc(g) + '" aria-pressed="' + (D.chartGenre === g) + '">' + esc(g) + "</button>";
        }).join("") + "</div>";
    }
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
  function mosaic(covers, big) {
    var c = (covers || []).slice(0, 4);
    while (c.length < 4) c.push(null);
    return '<span class="d-mosaic' + (big ? " big" : "") + '" aria-hidden="true">' + c.map(function (k) {
      return "<i" + (k ? ' style="background-image:url(' + esc(coverOf(k)) + ')"' : "") + "></i>";
    }).join("") + "</span>";
  }
  function playAllButton(listName, label) {
    return '<button type="button" class="butt d-playall" data-list="' + esc(listName) + '">' + ms("play_arrow", true) + "<span>" + esc(label) + "</span></button>" +
      saveAllButton(listName);
  }
  function saveAllButton(listName) {
    return '<button type="button" class="butt graybutt d-saveall" data-list="' + esc(listName) + '" title="' + (D.signedIn ? "Save these songs as a new playlist" : "Save these songs to your crate") + '">' +
      ms("playlist_add") + "<span>Save all</span></button>";
  }
  function rankedRows(tracks, listName, rightOf) {
    if (!tracks.length) return emptyNote("Nothing here yet.");
    return '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
      return row(t, listName, i, { stamp: "#" + (i + 1), rank: true, dj: djShown(t.djid, t.dj), right: rightOf ? rightOf(t) : '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" });
    }).join("") + "</div>";
  }
  function datedRows(tracks, listName) {
    if (!tracks.length) return emptyNote("Nothing here yet.");
    return '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
      return row(t, listName, i, { stamp: t.first ? firetable.utilities.shortDate(t.first) : "", dj: djShown(t.djid, t.dj), right: '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" });
    }).join("") + "</div>";
  }
  function person(p, fact, more) {
    var dj = djShown(p.djid, p.dj || p.name);
    if (!dj) return "";
    var key = p.key && (lib("djs") || {})[p.key] ? p.key : djKey(dj.uid, dj.name);
    var inner = robot(dj, "80x80") + '<span class="d-person-text"><b>' + esc(dj.name) + "</b><span>" + fact + "</span>" + (more ? "<span>" + more + "</span>" : "") + "</span>";
    return key ? '<a class="d-person" href="#discover/djs/' + esc(key) + '">' + inner + "</a>" : '<span class="d-person">' + inner + "</span>";
  }
  function withType(list) { return (list || []).map(function (t) { return Object.assign({ type: 1 }, t); }); }

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
        return '<a role="listitem" class="d-mapg' + (D.mapDecade && !weight(g) ? " d-quiet" : "") + '" href="#discover/genres/' + esc(g.slug) + '" data-y="' + y.toFixed(1) + '" style="left:' + x.toFixed(1) + "%;top:" + y.toFixed(1) + "%;--s:" + size.toFixed(2) + '" title="' +
          esc(g.name + " · " + n(g.plays) + " plays" + (g.bpm ? " · usually " + g.bpm + " BPM" : "")) + '">' + esc(g.name) + "</a>";
      }).join("") + "</div>";
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
      (g.about ? '<p class="d-about">' + esc(g.about) + "</p>" : "") + '<p class="d-fact">' + esc(facts.join(" · ")) + "</p>" +
      '<div class="d-actions"><button type="button" class="butt d-radio" data-slug="' + esc(slug) + '">' + ms("radio") + "<span>Play " + esc(g.name) + " radio</span></button>" +
      saveAllButton("genre") + "</div></div></div>";
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
    h += '<div class="d-headrow">' + chips("djsort", [["plays", "Most plays"], ["firsts", "Most firsts"], ["since", "Newest"], ["name", "A to Z"]], D.djSort) +
      '<input type="search" class="d-find" id="dDjFind" placeholder="Find a DJ" aria-label="Find a DJ" value="' + esc(D.djFind) + '"></div>';
    h += '<div id="dDjList" class="d-people d-people-wide">' + djRows(list) + "</div>";
    return h;
  }
  function djRows(list) {
    var by = {
      plays: function (x, y) { return (y.plays || 0) - (x.plays || 0); },
      firsts: function (x, y) { return (y.firsts || 0) - (x.firsts || 0); },
      since: function (x, y) { return (y.since || 0) - (x.since || 0); },
      name: function (x, y) { return String(x.name).localeCompare(String(y.name)); }
    }[D.djSort];
    var q = D.djFind.trim().toLowerCase();
    var shown = list.filter(function (d) { return !q || String(d.name).toLowerCase().indexOf(q) !== -1; }).sort(by);
    if (!shown.length) return emptyNote("No DJ by that name.");
    return shown.map(function (d) {
      var fact = (d.since ? "since " + new Date(d.since).getFullYear() + " · " : "") + n(d.plays) + " plays · " + n(d.firsts) + " firsts";
      return person({ djid: d.djid, name: d.name, key: d.key }, esc(fact), esc((d.g || []).join(", ")));
    }).join("");
  }

  function viewDj(key) {
    var d = lib("dj/" + key);
    var h = back("discover/djs", "DJs");
    var wait = libWaiting(d, "There's no page for this DJ. DJs get one after 25 plays here, unless they've turned it off.");
    if (wait) return h + wait;
    var dj = { uid: d.djid || d.name, name: d.name };
    var facts = [];
    if (d.since) facts.push("here since " + new Date(d.since).getFullYear());
    facts.push(n(d.plays) + " plays");
    if (d.firsts) facts.push(n(d.firsts) + " songs brought here first");
    if (d.when) facts.push("usually " + d.when);
    if (d.cards) facts.push(firetable.utilities.pluralize(d.cards, "trading card", "trading cards"));
    var tab = D.djTab === "firstHere" ? "firstHere" : "most";
    var tracks = withType(tab === "most" ? d.most : d.firstHere);
    setList("dj", d.name + " · " + (tab === "most" ? "Most played" : "Brought here first"), tracks);
    h += '<div class="d-pagehead">' + '<span class="d-bigrobot">' + robot(dj, "160x160") + '</span><div class="d-pagetext"><h2>' + esc(d.name) + '</h2><p class="d-fact">' + esc(facts.join(" · ")) + "</p>" +
      '<div class="d-actions">' + playAllButton("dj", "Play their favorites") + "</div></div></div>";
    var taste = d.taste || [];
    if (taste.length) {
      h += "<section>" + head("Their sound") + '<div class="d-taste">' + taste.map(function (x) {
        var name = x.slug ? '<a href="#discover/genres/' + esc(x.slug) + '">' + esc(x.g) + "</a>" : "<span>" + esc(x.g) + "</span>";
        return '<div class="d-tasterow' + (x.slug ? "" : " d-other") + '">' + name + '<span class="d-bar"><i style="width:' + Math.max(1, x.pct) + '%"></i></span><span class="d-num">' + esc(x.pct) + "%</span></div>";
      }).join("") + "</div></section>";
    }
    h += "<section>" + '<div class="d-headrow">' + chips("djtab", [["most", "Most played"], ["firstHere", "Brought here first"]], tab) + "</div>" +
      (tab === "most"
        ? rankedRows(tracks, "dj", function (t) { return '<span class="d-num" title="' + esc(firetable.utilities.pluralize(t.by, "play", "plays") + " by " + d.name) + '">' + esc(firetable.utilities.pluralize(t.by, "play", "plays")) + "</span>"; })
        : datedRows(tracks, "dj")) + "</section>";
    var similar = (d.similar || []).map(function (p) { return person(p, esc(p.pct + "% alike")); }).filter(Boolean);
    if (similar.length) h += "<section>" + head("Similar DJs") + '<p class="d-fact">The most songs in common</p><div class="d-people">' + similar.join("") + "</div></section>";
    var sets = d.sets || [];
    if (sets.length) {
      var nights = nightIndex();
      h += "<section>" + head("Recent sets") + '<div class="d-sets">' + sets.map(function (x) {
        var when = new Date(x.at);
        var night = nightAt(nights, x.at);
        return '<div class="d-set"><span class="d-num">' + esc(when.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: when.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })) +
          "</span>" + (night ? '<a class="d-settheme" href="#discover/themes/' + esc(night.id) + '">' + esc(night.theme) + "</a>" : "<span></span>") +
          "<span>" + esc(firetable.utilities.pluralize(x.n, "song", "songs")) + "</span></div>";
      }).join("") + "</div></section>";
    }
    if (d.djid) {
      var held = cardsOf(d.djid);
      if (held && held.length) {
        h += "<section>" + head("Their cards") + '<p class="d-fact">Trading cards ' + esc(d.name) + " holds" + (d.cards > held.length ? ", the latest " + held.length + " of " + d.cards : "") + "</p>" +
          '<div class="d-cards">' + held.map(function (c) {
            return '<button type="button" class="d-card" data-card="' + esc(c.key) + '" aria-label="' + esc("Card: " + (c.djname || "") + ", " + (c.artist || "") + " - " + (c.title || "")) + '">' +
              '<canvas width="225" height="300" id="cardMakerdj' + esc(c.key) + '"></canvas></button>';
          }).join("") + "</div></section>";
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
        var p = firetable.utilities.parseArtistTitle(firetable.ui.strip(item.snippet.title), firetable.ui.strip(item.snippet.channelTitle).replace(" - Topic", ""));
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
  function drawCards() {
    if (!firetable.actions.displayCard) return;
    document.querySelectorAll("#dBrowse .d-card[data-card]").forEach(function (b) {
      var key = b.getAttribute("data-card");
      var all = [];
      Object.keys(cardData).forEach(function (u) { (cardData[u] || []).forEach(function (c) { all.push(c); }); });
      var c = all.find(function (x) { return x.key === key; });
      if (c) firetable.actions.displayCard(JSON.parse(JSON.stringify(c)), "dj" + key);
    });
  }

  /** Save a whole list: a new playlist for members, the crate for visitors. */
  function saveAll(listName) {
    var list = lists[listName];
    if (!list || !list.tracks.length) return;
    var tracks = list.tracks.slice(0, 50);
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
      '<div class="d-pagetext"><h2>' + esc(a.name) + '</h2><p class="d-fact">' + esc(facts.join(" · ")) + "</p>" +
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
    h += '<p class="d-fact">The room\'s playlist for each year, and how much of it was played here</p>';
    h += '<div class="d-yearlist">' + ys.map(function (y) {
      var v = all[y] || {};
      var pct = v.songs ? Math.round((v.played / v.songs) * 100) : 0;
      return '<a class="d-yearrow" href="#discover/years/' + esc(y) + '"><b class="d-num">' + esc(y) + "</b>" +
        '<span class="d-yeartext"><span>' + esc(n(v.songs)) + " songs · " + esc(n(v.played)) + " played here · " + esc(n(v.plays)) + " plays</span>" +
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
      '<div class="d-pagetext"><h2 class="d-num">' + esc(y) + '</h2><p class="d-fact">' + esc(n(v.songs) + " songs on the playlist · " + n(v.played) + " played here" + (v.genre ? " · mostly " + v.genre : "")) + "</p>" +
      '<div class="d-actions">' + playAllButton("year", "Play the year") + "</div></div></div>";
    h += "<section>" + head("Most played here") + rankedRows(top, "year") + "</section>";
    if (extra.length) {
      h += "<section>" + head("Not played here yet") + '<p class="d-fact">From ' + esc(y) + "'s playlist. Play one for the room.</p>" +
        '<div class="ft-cards">' + extra.map(function (t, i) { return card(t, "year-more", i, { who: "Not played live yet" }); }).join("") + "</div></section>";
    }
    return h;
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
      esc((s.djname ? s.djname + " on deck" : "Live") + here) + "</span>" +
      (D.data.chat && D.data.chat.hour ? '<span class="d-live-chat">' + ms("forum") + esc(firetable.utilities.pluralize(D.data.chat.hour, "message", "messages") + " this hour") + "</span>" : "") +
      "</span>" +
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
    return '<div class="tabs d-sidetabs" role="tablist">' + tab("now", "Now playing") + tab("list", esc(listLabel)) +
      (D.signedIn ? tab("chat", "Chat" + (D.unread ? ' <span class="d-unread" aria-label="' + D.unread + ' new">' + (D.unread > 99 ? "99+" : D.unread) + "</span>" : "")) : "") +
      '<button type="button" class="butt graybutt iconbutt d-sheetclose" title="Close" aria-label="Close">' + ms("close") + "</button></div>";
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
    if (D.sideTab === "chat" && !(D.signedIn && D.mode === "discover")) D.sideTab = "now";
    // the chat's tab: only its tabs change, so the chat keeps its place
    if (D.sideTab === "chat" && el.querySelector(".d-chathost #actualChat")) {
      var bar = el.querySelector(".d-sidetabs");
      if (bar) bar.outerHTML = sideTabs();
      renderMini();
      return;
    }
    chatBack();
    var h = sideTabs();
    if (D.sideTab === "chat") {
      D.unread = 0;
      el.innerHTML = '<div class="d-sidebody d-sidechat">' + sideTabs() + '<div class="d-chathost"></div></div>';
      chatIn(el.querySelector(".d-chathost"));
      renderMini();
      return;
    }
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
      '<div class="d-now"><span class="d-title">' + esc(t.t) + '</span><span class="d-artist">' + artistLinks(t.a) + "</span></div>" +
      '<div class="d-tags" id="dTags"></div>' +
      '<div class="d-hist" id="dHist"></div>' +
      progress() +
      '<div class="d-ctrls">' +
      '<button type="button" class="butt graybutt iconbutt d-prev" title="Previous" aria-label="Previous">' + ms("skip_previous", true) + "</button>" +
      '<button type="button" class="butt iconbutt d-toggle d-big" title="' + (P.paused ? "Play" : "Pause") + '" aria-label="' + (P.paused ? "Play" : "Pause") + '">' + ms(P.paused ? "play_arrow" : "pause", true) + "</button>" +
      '<button type="button" class="butt graybutt iconbutt d-next" title="Next" aria-label="Next">' + ms("skip_next", true) + "</button>" +
      '<span class="d-gap"></span>' +
      '<button type="button" class="butt graybutt iconbutt d-reload" title="Reload the song (if it stalls)" aria-label="Reload the song">' + ms("refresh") + "</button>" +
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
      var tags = (d.genres || []).slice(0, 2).map(function (g) { return '<a class="d-tag" href="#discover/genres/' + esc(genreSlug(g)) + '">' + esc(g) + "</a>"; });
      if (t.rel) tags.push('<span class="d-tag d-numtag">' + esc(t.rel.slice(0, 4)) + "</span>");
      tags.push('<span class="d-tag">' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + "</span>");
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
      if (firstAt) lines.push((first ? robotLink(first) : "") + "<span>first played " + esc(firetable.utilities.shortDate(firstAt)) + (first ? " by " + nameLink(first) : "") + "</span>");
      if (d.last && d.last !== firstAt) {
        var last = djShown(null, d.lastDj);
        lines.push("<span>last played " + esc(firetable.utilities.shortDate(d.last)) + (last ? " by " + nameLink(last) : "") + "</span>");
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
      (ftapi.keepAwake && ftapi.keepAwake.wanted ? "" : tracks.length ? '<button type="button" class="butt d-joinwait">' + ms("queue_music") + "<span>Play it for the room</span></button>" +
        '<p class="d-fact d-center">Joins the waitlist. You take the decks in Live.</p>' : "") +
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
    mediaSession(t);
    if (!auto) D.sideTab = "now";
    renderSide();
    renderBrowse();
    renderLiveLine();
  }

  /** The phone's lock screen, headphones and media keys control Discover's player. */
  function mediaSession(t) {
    var session = navigator.mediaSession;
    if (!session || typeof MediaMetadata !== "function") return;
    try {
      session.metadata = t ? new MediaMetadata({ title: t.t || "", artist: t.a || "", album: (ftconfigs.roomName || "") + " · Discover", artwork: [{ src: artOf(t), sizes: "320x180", type: "image/jpeg" }] }) : null;
      var on = function (action, fn) { try { session.setActionHandler(action, fn); } catch (e) { /* not on this browser */ } };
      on("play", t ? function () { if (P.paused) togglePause(); } : null);
      on("pause", t ? function () { if (!P.paused) togglePause(); } : null);
      on("nexttrack", t ? function () { step(1); } : null);
      on("previoustrack", t ? function () { step(-1); } : null);
    } catch (e) { /* a browser without it */ }
  }

  /** Give the players back to the room (Live, Listen in). */
  function release() {
    mediaSession(null);
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
    if (!list || D.mode !== "discover") return;
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
    if (mode === "live") {
      chatBack();
      if (D.sideTab === "chat") D.sideTab = "now";
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

  function openSearch() {
    if (D.mode !== "discover") setMode("discover", { remember: true });
    var input = document.getElementById("dQ");
    if (input) { input.focus(); input.select(); }
    lib("artistIndex"); // ready for the first letters
  }

  function setView(view, sub) {
    D.view = view;
    D.sub = sub || null;
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

  // ─── Visitors' Live: what joining opens, shown not hidden ────────────────
  // Above the sign-in form: Join (the form), Playlists, Recent and Cards. Each
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
    ["welcomeInfo", "authBox"].forEach(function (id) { var el = document.getElementById(id); if (el) el.hidden = !join; });
    if (join) { paneEl.innerHTML = ""; return; }
    var joinLine = '<div class="d-lockjoin"><button type="button" class="butt d-createaccount">Join the room</button>' +
      '<span>Already a member? <button type="button" class="linkButton d-login">Log in</button></span></div>';
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

  function renderPeek() {
    lockedTabs();
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
    if ((b = t.closest("[data-sidetab]"))) { D.sideTab = b.getAttribute("data-sidetab"); if (D.sideTab === "chat") D.unread = 0; return renderSide(); }
    if ((b = t.closest("#dLocked [data-locked]"))) { lockedTab = b.getAttribute("data-locked"); return lockedTabs(); }
    if ((b = t.closest(".d-chatnav"))) { D.sideTab = "chat"; D.unread = 0; renderSide(); document.body.classList.add("d-sheet-open"); return; }
    if ((b = t.closest(".d-chip[data-new]"))) { D.newFilter = b.getAttribute("data-new"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-period]"))) { D.chart = { period: b.getAttribute("data-period"), id: null }; renderBrowse(); return writeAddress(); }
    if ((b = t.closest(".d-chip[data-cgenre]"))) { D.chartGenre = b.getAttribute("data-cgenre") || null; return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-cnew]"))) { D.chartNew = !!b.getAttribute("data-cnew"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-gtab]"))) { D.genreTab = b.getAttribute("data-gtab"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-djtab]"))) { D.djTab = b.getAttribute("data-djtab"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-djsort]"))) { D.djSort = b.getAttribute("data-djsort"); return renderBrowse(); }
    if ((b = t.closest(".d-chip[data-decade]"))) { D.mapDecade = b.getAttribute("data-decade") || null; return renderBrowse(); }
    if ((b = t.closest(".d-homemore"))) { var k = b.getAttribute("data-more"); D.homeMore[k] = !D.homeMore[k]; return renderBrowse(); }
    if ((b = t.closest("#dSearchOpen"))) return openSearch();
    if ((b = t.closest(".d-sheetlink"))) { e.preventDefault(); return openSheet(songFrom(b)); }
    if ((b = t.closest("#thehistory .pv-dj-avatar, #thediscovers .pv-dj-avatar"))) {
      var key = djKey(b.getAttribute("data-avatar-uid"), b.getAttribute("aria-label"));
      if (key) { location.hash = "#discover/djs/" + key; return; }
    }
    if ((b = t.closest(".d-ytsearch"))) return searchYouTube(D.sub || "");
    if ((b = t.closest(".d-playall"))) return play(b.getAttribute("data-list"), 0);
    if ((b = t.closest(".d-saveall"))) return saveAll(b.getAttribute("data-list"));
    if ((b = t.closest(".d-card[data-card]"))) return firetable.actions.viewLargerCard && firetable.actions.viewLargerCard("dj" + b.getAttribute("data-card"));
    if ((b = t.closest(".d-joinwait"))) { ftapi.actions.sendBotCommand("!addme"); firetable.ui.toast("You're on the waitlist. The decks are in Live.", "success"); return setMode("live", { remember: true }); }
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
    if ((b = t.closest(".d-createaccount, .d-login"))) return showSignIn(b.classList.contains("d-login") ? "login" : "create");
    if ((b = t.closest(".d-mini-open"))) { document.body.classList.toggle("d-sheet-open"); return; }
    if (t.closest(".d-sheetclose")) { document.body.classList.remove("d-sheet-open"); return; }
    if ((b = t.closest(".d-mini-row[data-list]"))) return play(b.getAttribute("data-list"), Number(b.getAttribute("data-i")));
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
    var h = "";
    var url = linkOf(t);
    if (url) h += item("open_in_new", Number(t.type || 1) === MEDIA_YOUTUBE ? "Open on YouTube" : "Open the song", 'href="' + esc(url) + '" target="_blank" rel="noopener"');
    artistsOf(t.a).slice(0, 3).forEach(function (a) { h += item("person", "Go to " + esc(a), 'href="#discover/artist/' + esc(artistSlug(a)) + '"'); });
    if (t.g) h += item("category", "More " + esc(t.g), 'href="#discover/genres/' + esc(genreSlug(t.g)) + '"');
    var dj = t.dj ? djShown(t.djid, t.dj) : null;
    var key = dj && djKey(dj.uid, dj.name);
    if (key) h += item("headphones", esc(dj.name) + "'s DJ page", 'href="#discover/djs/' + esc(key) + '"');
    if (url) h += item("link", "Copy the song's link", 'href="#" data-act="copy"');
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
    var t = menuTrack;
    closeMenu(true);
    if (act === "copy" && t) {
      var url = linkOf(t);
      var done = function () { firetable.ui.toast("Link copied", "success"); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { firetable.ui.toast(url); });
      else firetable.ui.toast(url);
    }
  }

  function save(t, btn) {
    if (!D.signedIn) return saveToCrate(t);
    firetable.actions.openStealPicker($(btn), { cid: t.cid, type: Number(t.type || 1), title: (t.a ? t.a + " - " : "") + t.t, img: t.img || artOf(t), url: t.url || "", djid: t.djid || "", from: "discover" }, "left");
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

  /**
   * Join or log in without leaving the page: the sign-in form (#login) moves
   * into a dialog and goes back where it was when the dialog closes. In
   * Live, where visitors already see the form, it just scrolls to it.
   * @param {"create"|"login"} which
   */
  var loginHome = null;
  function showSignIn(which) {
    var keep = document.getElementById("keepCrateBox");
    if (keep && keep.open) keep.close();
    var login = document.getElementById("login");
    if (!login || D.signedIn) return;
    lockedTab = "join"; // the form, whatever tab Live was showing
    lockedTabs();
    firetable.ui.showAuth(which);
    if (D.mode === "live" && login.offsetParent && !login.closest("#joinBox")) {
      login.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(function () { firetable.ui.showAuth(which, { focus: true }); }, 300);
      return;
    }
    var dlg = joinBox();
    var n = crate().length;
    dlg.querySelector("#joinTitle").textContent = which === "login" ? "Welcome back" : "Join " + (ftconfigs.roomName || "the room");
    dlg.querySelector(".d-joinnote").textContent = n
      ? "Your crate of " + firetable.utilities.pluralize(n, "song", "songs") + " comes with you. It becomes a playlist you can play for the room."
      : "Members chat, save playlists, and take a turn on the decks.";
    if (!login.closest("#joinBox")) {
      loginHome = document.createComment("login");
      login.parentNode.insertBefore(loginHome, login);
      dlg.querySelector(".modalContent").appendChild(login);
    }
    if (!dlg.open) dlg.showModal();
    firetable.ui.showAuth(which, { focus: true });
  }
  function joinBox() {
    var dlg = document.getElementById("joinBox");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.id = "joinBox";
    dlg.setAttribute("aria-labelledby", "joinTitle");
    dlg.innerHTML = '<div class="modalBox"><div class="modalHeader"><h2 id="joinTitle"></h2>' +
      '<button type="button" class="butt graybutt iconbutt closeModal" title="Close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="modalContent"><p class="d-joinnote"></p></div></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener("click", function (e) {
      if (e.target.closest(".closeModal") || e.target === dlg) dlg.close();
    });
    // the tabs say which form is open, so the title follows them
    dlg.addEventListener("click", function (e) {
      var b = e.target.closest("[data-auth]");
      if (b) dlg.querySelector("#joinTitle").textContent = b.getAttribute("data-auth") === "create" ? "Join " + (ftconfigs.roomName || "the room") : "Welcome back";
    });
    dlg.addEventListener("close", putLoginBack);
    return dlg;
  }
  function putLoginBack() {
    if (!loginHome) return;
    var login = document.getElementById("login");
    if (login && login.closest("#joinBox") && loginHome.parentNode) loginHome.parentNode.insertBefore(login, loginHome);
    if (loginHome.parentNode) loginHome.parentNode.removeChild(loginHome);
    loginHome = null;
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
    var rowEl = el.closest("[data-list]");
    if (rowEl && rowEl.closest("#dBrowse")) {
      var l = lists[rowEl.getAttribute("data-list")];
      return l && l.tracks[Number(rowEl.getAttribute("data-i"))];
    }
    if (el.id === "track") {
      var s = firetable.song;
      if (!s || !s.cid) return null;
      return { type: Number(s.type || 1), cid: s.cid, a: firetable.utilities.decodeEntities(s.artist || ""), t: firetable.utilities.decodeEntities(s.title || ""),
        img: (firetable.imgCache && firetable.imgCache[s.cid]) || s.image, url: s.url, dj: s.djname, djid: s.djid, now: true };
    }
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
        if ((b = e.target.closest(".d-sheetcopy"))) {
          var url = linkOf(sheetTrack);
          var done = function () { firetable.ui.toast("Link copied", "success"); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { firetable.ui.toast(url); });
          else firetable.ui.toast(url);
        }
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
      '<div class="d-actions"><button type="button" class="butt d-sheetplay">' + ms("play_arrow", true) + "<span>Play" + (D.mode === "discover" ? "" : " in Discover") + "</span></button>" +
      '<button type="button" class="butt graybutt d-sheetsave' + (saved ? " is-saved" : "") + '">' + ms(saved ? "playlist_add_check" : "playlist_add") + "<span>" + (saved ? "Saved" : "Save") + "</span></button>" +
      (link ? '<a class="butt graybutt iconbutt" href="' + esc(link) + '" target="_blank" rel="noopener" title="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '" aria-label="Open on ' + (Number(t.type || 1) === MEDIA_YOUTUBE ? "YouTube" : "SoundCloud") + '">' + ms("open_in_new") + "</a>" +
        '<button type="button" class="butt graybutt iconbutt d-sheetcopy" title="Copy the song\'s link" aria-label="Copy the song\'s link">' + ms("link") + "</button>" : "") +
      "</div></div></div>";
    if (!dlg.open) dlg.showModal();
    loadDetails(t).then(function (d) {
      if (sheetTrack !== t) return;
      var tags = (d.genres || []).slice(0, 3).map(function (g) { return '<a class="d-tag" href="#discover/genres/' + esc(genreSlug(g)) + '">' + esc(g) + "</a>"; });
      if (t.rel) tags.push('<span class="d-tag d-numtag">' + esc(t.rel.slice(0, 4)) + "</span>");
      if (d.bpm) tags.push('<span class="d-tag d-numtag">' + esc(d.bpm) + " BPM</span>");
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
    page.innerHTML = '<div id="dRail"><div id="dLive" class="d-live" aria-live="polite"></div>' +
      '<form id="dSearch" role="search"><i class="material-symbols-outlined" aria-hidden="true">search</i>' +
      '<input type="search" id="dQ" placeholder="Search artists, songs, genres, DJs" aria-label="Search the library" autocomplete="off" enterkeyhint="search" /></form>' +
      '<nav id="dNav" aria-label="Discover">' +
      VIEWS.map(function (v) { return '<button type="button" class="d-nav" data-view="' + v.id + '">' + ms(v.icon) + "<span>" + esc(v.label) + "</span></button>"; }).join("") +
      '<button type="button" class="d-nav d-chatnav">' + ms("forum") + "<span>Chat</span></button>" +
      '</nav></div><div id="dBrowse" class="scroll-view"></div><aside id="dSide" aria-label="Player"></aside><div id="dMini" hidden></div>';
    document.getElementById("mainGrid").appendChild(page);
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
    // unless they've gone to Live or Listen in meanwhile
    setTimeout(function () { if (firetable.preview === "discover" && D.mode === "discover") step(1); }, 800);
  }

  function signedIn(on) {
    D.signedIn = on;
    document.body.classList.toggle("d-member", !!on);
    if (!on) { chatBack(); if (D.sideTab === "chat") D.sideTab = "now"; }
    var join = document.getElementById("joinBox");
    if (on && join && join.open) join.close();
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
    if (r.view) {
      if (r.view !== D.view || r.sub !== D.sub) { D.genreTab = "fav"; D.djTab = "most"; }
      D.view = r.view;
      D.sub = r.sub || null;
    }
    if (r.period) D.chart = { period: r.period, id: r.id || null };
  }

  return {
    init: function () {
      D.on = typeof ftconfigs !== "undefined" && ftconfigs.discover === true;
      if (!D.on) {
        // a page from search, with Discover since turned off: just the room
        var filled = document.getElementById("discoverPage");
        if (filled) filled.parentNode.removeChild(filled);
        document.body.classList.remove("ft-discover", "ft-has-discover");
        return;
      }
      document.body.classList.add("ft-has-discover");
      D.newLayout = store.get("ft-new-layout", "grid") === "list" ? "list" : "grid";
      build();
      // the left column starts below the header, whatever its height
      var topbar = document.getElementById("topbar");
      var measure = function () { document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px"); };
      measure();
      if (window.ResizeObserver) new ResizeObserver(measure).observe(topbar);
      document.addEventListener("click", onClick);
      watchLive();
      var typed = null;
      document.addEventListener("input", function (e) {
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
        if (e.target.id !== "dDjFind") return;
        D.djFind = e.target.value;
        var all = libData.djs || {};
        var box = document.getElementById("dDjList");
        if (box) box.innerHTML = djRows(Object.keys(all).map(function (k) { return Object.assign({ key: k }, all[k]); }));
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeMenu(true);
        if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("d-sheetlink")) { e.preventDefault(); openSheet(songFrom(e.target)); return; }
        // space, outside a text box or button: play / pause Discover's song
        if (e.key === " " && D.mode === "discover" && P.track && !D.listening && !/^(input|textarea|select|button|a)$/i.test(e.target.tagName || "") && !e.target.isContentEditable && !(e.target.closest && e.target.closest("[role=button], dialog"))) {
          e.preventDefault();
          togglePause();
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
      document.addEventListener("submit", function (e) {
        if (e.target.id !== "dSearch") return;
        e.preventDefault();
        var v = document.getElementById("dQ").value.trim();
        if (!v) return;
        clearTimeout(typed);
        setView("search", v);
        if (D.signedIn && yt.q !== v) searchYouTube(v);
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
        if (D.mode === "discover" && /^(home|charts|recent)$/.test(D.view)) renderBrowse();
      }));
      ftapi.events.on("newHistory", firetable.utilities.oncePerFrame(function () {
        if (D.mode === "discover" && (D.view === "recent" || D.view === "home")) renderBrowse();
      }));
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
    /** A member's DJ page address, when they have one (for the room's user card). */
    djPage: function (uid, name) {
      if (!D.on) return null;
      var key = djKey(uid, name);
      return key ? "#discover/djs/" + key : null;
    },
    /** For tests: act as signed in or out without a real sign-in. */
    testSignedIn: signedIn,
    /** For tests: what's on screen. */
    state: function () { return { mode: D.mode, view: D.view, listening: D.listening, playing: P.track && P.track.cid, list: P.list, i: P.i }; }
  };
})();
