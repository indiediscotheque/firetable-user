/**
 * discover-fresh.js — Fresh, one of Discover's pages (the owner, November 27,
 * 2026).
 *
 * The first plays here of new uploads: the bot's newMusic feed (about the
 * last 100, firetable.js ftapi.feeds.fresh), newest first, on Discover's
 * cards. Not Discover's New, which is the bot's list of recent releases:
 * Fresh is what the room's DJs played here first. It was Live's panel (its
 * own tab, the column beside a visitor's welcome, a page of the Turntable
 * theme's Room, a tile on a phone that opened Live); now it's Discover's at
 * every width: #discover/fresh, in Discover's row of pages and a phone's
 * tiles, and a shelf on Home. Its songs play whole in Discover, save to your
 * playlists (a visitor's crate), and open their song sheet, like every
 * other card there.
 *
 * discover.js loads this the first time Home or Fresh is drawn (js/lazy.js,
 * the fresh-js meta in index.html), makes the one there is with
 * firetable.discoverFresh(deps) and calls changed() to draw it. deps are its
 * helpers (card, loading, emptyNote, head, djShown, setList), its state()
 * and render(), which draws Discover's page again. The feed downloads then,
 * and stays live: a new first play redraws the page that shows it.
 */
firetable.discoverFresh = (function () {
  "use strict";
  var SHELF = 6; // the cards on Home's shelf

  /** One play from the feed, as the song Discover's cards and player take. */
  function track(p) {
    return { type: Number(p.type) || 1, cid: p.cid, a: firetable.ui.strip(p.artist || ""), t: firetable.ui.strip(p.title || ""), img: p.img, url: p.url, when: p.when, dj: p.dj, djid: p.djid };
  }

  /** The feed as it arrived (oldest first) as Fresh: newest first, each play once, songs only. */
  function newestFirst(feed) {
    var seen = {};
    return feed.slice().reverse().filter(function (p) {
      if (!p || !p.cid || seen[p.histID]) return false;
      seen[p.histID] = true;
      return true;
    }).map(track);
  }

  function create(deps) {
    var feed = [];
    var started = false;
    var ready = false; // the first download is in

    /** Discover's page again, when it's one that shows Fresh (Fresh or Home). */
    function changed() {
      var D = deps.state();
      if (D.mode === "discover" && (D.view === "fresh" || D.view === "home")) deps.render();
    }

    /** Download the feed the first time it's wanted; it stays live after. */
    function start() {
      if (started) return;
      started = true;
      try {
        ftapi.watchFeed("fresh").then(function () {
          ready = true;
          changed();
        });
      } catch (e) { started = false; /* before Firebase starts: the next draw asks again */ }
    }

    function tracks() { return newestFirst(feed); }

    /** Who played it first here and when, under the card (the DJ only where they show their name). */
    function meta(t) {
      var dj = deps.djShown(t.djid, t.dj);
      return { dj: dj, who: dj ? dj.name : "", date: firetable.utilities.shortDate(t.when), extra: firetable.utilities.format_time(t.when) };
    }

    function cards(list, name, compact) {
      return '<div class="ft-cards' + (compact ? " d-compact" : "") + '">' + list.map(function (t, i) { return deps.card(t, name, i, meta(t)); }).join("") + "</div>";
    }

    /** The page itself (#discover/fresh). */
    function page() {
      start();
      var list = tracks();
      deps.setList("fresh", "Fresh", list);
      var h = '<div class="d-headrow"><h2>Fresh</h2></div><p class="d-fact">The first plays here of new uploads, newest first</p>';
      if (list.length) return h + cards(list, "fresh");
      return h + (ready ? deps.emptyNote("Nothing new yet. Songs show here the first time the room plays them.") : deps.loading());
    }

    /** Home's shelf: the newest few, and the page a tap away. Nothing once it's known there are none. */
    function shelf() {
      start();
      var list = tracks();
      if (ready && !list.length) return "";
      deps.setList("home-fresh", "Fresh", list);
      return "<section>" + deps.head("Fresh in the room", "All of Fresh", "discover/fresh") + '<p class="d-fact">New music people played here lately</p>' +
        (list.length ? cards(list.slice(0, SHELF), "home-fresh", true) : deps.loading()) + "</section>";
    }

    // A first play arriving: kept, and drawn where it shows (a run of them, once)
    var redraw = firetable.utilities.oncePerFrame(changed);
    ftapi.events.on("newProduce", function (p) {
      feed.push(p);
      if (ready) redraw();
    });
    return { page: page, shelf: shelf, tracks: tracks, changed: changed };
  }
  return create;
})();
