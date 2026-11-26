/**
 * discover-map.js — Genres' sound map: every genre the room plays, across
 * from band-made to machine-made and up by tempo, each name as big as its
 * plays (in the decade chosen). On it, a red dot on the room song's genre, a
 * ring on each genre played tonight (brighter: more of tonight was that
 * genre), a gold outline on the one you're hearing, and a legend for the
 * marks showing. Picking a genre shows its card under the map (what it is,
 * its numbers, next door, its radio and its page), and the page stays.
 *
 * Genres opens on its grid (the owner, November 25, 2026): the map is behind
 * Grid | Map, and nothing of it loads until someone wants it. discover.js
 * makes the one there is with firetable.discoverMap(deps) the first time Map
 * is pressed (js/lazy.js). deps are discover.js's helpers, handed over as
 * functions: esc, ms, n, hrefTo, mosaic, lib, genreSlug, liveTrack,
 * loadDetails; hearing (the song you hear: Discover's, else the room's);
 * decade (the decade chosen, or null); picked and setPicked (the genre picked
 * on the map, kept for the visit).
 */
firetable.discoverMap = (function () {
  "use strict";
  var deps = null, esc, n, hrefTo; // discover.js's helpers (there's one map a page)
  var mapWatch = null;
  var marking = 0;
  var TONIGHT_MS = 8 * 3600000;

  /**
   * The map's fact, the map, what its marks mean, and the picked genre's card.
   * @param {Array<Object>} list - every genre (with its slug), the biggest first
   * @param {Function} weight - a genre's plays (in the decade chosen)
   * @param {number} top - the biggest genre's
   * @returns {string}
   */
  function html(list, weight, top) {
    var bpms = list.map(function (g) { return g.bpm; }).filter(Boolean);
    var lo = Math.min.apply(null, bpms.length ? bpms : [100]), hi = Math.max.apply(null, bpms.length ? bpms : [130]);
    if (hi - lo < 10) { lo -= 5; hi += 5; }
    var decade = deps.decade();
    var h = '<p class="d-fact">' + esc(list.length) + " sounds the room plays" + (decade ? ", sized by plays in the " + esc(decade) + "s" : "") + ". Across: played by a band, or made on machines. Up: faster.</p>";
    h += '<div class="d-map" role="list" aria-label="Sound map">' +
      '<span class="d-axis d-axis-up">' + esc(hi) + " BPM</span>" +
      '<span class="d-axis d-axis-down">' + esc(lo) + " BPM</span>" +
      '<span class="d-axis d-axis-left">Band-made</span><span class="d-axis d-axis-right">Machine-made</span>' +
      list.map(function (g) { return label(g, weight, top, lo, hi); }).join("") + "</div>";
    // what the marks mean (the room's genre and yours are found after the page draws: marks)
    h += '<p class="d-maplegend" id="dMapLegend"><span class="d-mlsize">Bigger: played here more</span><span class="d-mlroom">The room is playing</span><span class="d-mltonight">Played tonight (brighter: more)</span><span class="d-mlhear">You\'re hearing</span><span class="d-mlpick">Picked: its card is below</span></p>';
    h += '<div class="d-mapcard" id="dMapCard" aria-live="polite">' + mapCard(deps.picked()) + "</div>";
    return h;
  }

  /** A genre's name on the map: across by how it's made, up by its usual tempo. */
  function label(g, weight, top, lo, hi) {
    var decade = deps.decade(), pick = deps.picked();
    var x = 6 + (g.x == null ? 0.5 : g.x) * 88;
    var y = g.bpm ? 8 + (1 - (g.bpm - lo) / (hi - lo)) * 80 : 48;
    var size = Math.sqrt(weight(g) / top);
    return '<a role="listitem" class="d-mapg' + (decade && !weight(g) ? " d-quiet" : "") + (pick === g.slug ? " is-picked" : "") + '" href="' + hrefTo("discover/genres/" + g.slug) + '" data-slug="' + esc(g.slug) + '"' + (pick === g.slug ? ' aria-current="true"' : "") + ' data-y="' + y.toFixed(1) + '" style="left:' + x.toFixed(1) + "%;top:" + y.toFixed(1) + "%;--s:" + size.toFixed(2) + '" title="' +
      esc(g.name + " · " + n(g.plays) + " plays" + (g.bpm ? " · usually " + g.bpm + " BPM" : "")) + '">' + esc(g.name) + "</a>";
  }

  /** Spread the map's labels so none sit on top of another (or the axis labels), then mark it. */
  function layout() {
    var box = document.querySelector("#dBrowse .d-map");
    if (!box) return;
    if (window.ResizeObserver && mapWatch !== box) {
      mapWatch = box;
      new ResizeObserver(function () { if (box.isConnected) spreadMap(box); }).observe(box);
    }
    spreadMap(box);
    marks();
  }

  /**
   * The sound map's marks: a red dot on the room song's genre, a gold outline
   * on the genre you're hearing (the room's, unless Discover is playing).
   * The genre comes from the song's library record (loadDetails).
   */
  function marks() {
    var box = document.querySelector("#dBrowse .d-map");
    if (!box) return;
    var turn = ++marking;
    var room = deps.liveTrack();
    var mine = deps.hearing();
    var genreOf = function (t) {
      if (!t) return Promise.resolve(null);
      if (t.g) return Promise.resolve(deps.genreSlug(t.g));
      return deps.loadDetails(t).then(function (d) { return d.genres && d.genres[0] ? deps.genreSlug(d.genres[0]) : null; });
    };
    // tonight: the genres of the room's plays in the last 8 hours (the bot adds g to each Recent row)
    var history = ftapi.watchFeed ? ftapi.watchFeed("history").catch(function () {}) : Promise.resolve();
    Promise.all([genreOf(room), genreOf(mine), history]).then(function (gs) {
      if (turn !== marking || !box.isConnected) return;
      var since = Date.now() - TONIGHT_MS, tonight = {};
      (firetable._historyCache || []).forEach(function (h) {
        if (h && h.g && (h.when || 0) >= since) tonight[deps.genreSlug(h.g)] = (tonight[deps.genreSlug(h.g)] || 0) + 1;
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
    var all = deps.lib("genres") || {};
    var g = slug && all[slug];
    if (!g) return '<p class="d-fact">Pick a genre on the map to see it here.</p>';
    var facts = [n(g.songs) + " songs", n(g.plays) + " plays"];
    if (g.bpm) facts.push("usually " + g.bpm + " BPM");
    if (g.first) facts.push("played here since " + g.first);
    var next = (g.next || []).filter(function (k) { return all[k]; });
    return '<div class="d-mapcardin">' + deps.mosaic(g.covers) + '<div class="d-mapcardtext"><h3>' + esc(g.name) + "</h3>" +
      (g.about ? '<p class="d-about">' + esc(g.about) + "</p>" : "") + '<p class="d-fact">' + esc(facts.join(" · ")) + "</p>" +
      (next.length ? '<p class="d-fact">Next door: ' + next.map(function (k) { return '<a class="d-mapnext" href="' + hrefTo("discover/genres/" + k) + '" data-slug="' + esc(k) + '">' + esc(all[k].name) + "</a>"; }).join(", ") + "</p>" : "") + "</div>" +
      '<div class="d-actions"><button type="button" class="butt d-panelmain d-radio" data-slug="' + esc(slug) + '">' + deps.ms("radio") + "<span>" + esc(g.name) + " radio</span></button>" +
      '<a class="butt graybutt" href="' + hrefTo("discover/genres/" + slug) + '">' + deps.ms("arrow_forward") + "<span>Open " + esc(g.name) + "</span></a></div></div>";
  }

  /** Pick a genre on the map: its card shows under the map, and the page stays. */
  function pick(slug) {
    deps.setPicked(slug);
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

  /** The map, made with discover.js's helpers: what it draws, and the calls that keep it up to date. */
  return function (helpers) {
    deps = helpers;
    esc = helpers.esc;
    n = helpers.n;
    hrefTo = helpers.hrefTo;
    return { html: html, layout: layout, marks: marks, pick: pick };
  };
})();
