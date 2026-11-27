/**
 * discover-queue.js — Live's playlists, in Discover's Playlists tab.
 *
 * Members manage their playlists in Discover with exactly what Live has:
 * Live's own panel (#queuebox) moves into Discover's right column while its
 * Playlists tab is open, and goes back when they leave it, the way the room's
 * chat does. So everything about a playlist works the same in both places:
 * the picker, All playlists, New / Import, Merge, Rename, Shuffle, Remove
 * duplicates, Check for broken tracks, Export, Delete, Find tracks, the
 * filter with Show only and Sort, Select several, drag to reorder, each
 * song's Top / Bottom / Add to playlist / Delete / ⋮, swaps and flags.
 *
 * What Discover adds around it, for its own player:
 *   - a song's play button plays it here, in the bar (the whole song, then the
 *     rest of the playlist), where Live plays a 30-second preview; a search
 *     result in Find tracks plays here the same way
 *   - where you stand on the decks, under the list (which list you DJ from
 *     is chosen as in Live: the crate's DJ switch by the picker, "You DJ from
 *     this" on that list, or All playlists' headphones, each through
 *     firetable.actions.djFrom)
 *   - the song playing here, and the songs saved this visit, are marked
 *
 * discover.js makes the one there is with firetable.discoverQueue(deps): deps
 * are its own player and helpers, handed over as functions.
 */
firetable.discoverQueue = (function () {
  "use strict";
  var LIST = "playlist"; // Discover's name for the playlist on screen (and "playlist-was" for one switched away from mid-play)
  var deps = null, esc = null, ms = null;
  var home = null; // where #queuebox lives in Live
  var watcher = null;

  function queuebox() { return document.getElementById("queuebox"); }
  function hostOf() { return document.querySelector("#dSide .d-queuehost"); }
  /** Is Live's panel in Discover's column now? */
  function here() { var q = queuebox(), h = hostOf(); return !!(q && h && h.contains(q)); }

  /** The playlist you DJ from. */
  function djList() {
    var pick = document.getElementById("djlistpicker");
    var me = ftapi.users && ftapi.users[ftapi.uid];
    return String((pick && pick.value) || (me && me.selectedList) || "0");
  }
  /** The playlist on screen (Live's picker: one list on screen across the site). */
  function viewList() {
    var pick = document.getElementById("listpicker");
    return String(firetable.viewListID || (pick && pick.value) || "0");
  }

  /** The playlist on screen, in play order, in Discover's shape. */
  function tracks() {
    var queue = ftapi.queue || {};
    return Object.keys(queue).sort(ftapi.utilities.compareKeys).map(function (k) {
      var q = queue[k] || {};
      var parts = firetable.utilities.decodeEntities(String(q.name || "")).split(" - ");
      var a = parts.length > 1 ? parts.shift() : "";
      return { key: k, type: Number(q.type || 1), cid: q.cid, a: a, t: parts.join(" - ") || q.name, img: q.img, url: q.url, flagged: !!q.flagged };
    }).filter(function (t) { return t.cid != null; });
  }

  /**
   * Discover's copy of the playlist, for Play, Next and Previous. A song
   * playing from it keeps its place when the list is reordered; when the
   * list on screen changes to another, the one playing carries on as it was.
   */
  function sync() {
    var all = tracks();
    var p = deps.player();
    var label = firetable.utilities.listName(viewList());
    if (p.list === LIST && p.track && p.track.key) {
      var at = all.map(function (t) { return t.key; }).indexOf(p.track.key);
      if (at !== -1) p.i = at;
      else {
        var was = deps.lists()[LIST];
        if (was) deps.setList(LIST + "-was", was.label, was.tracks);
        p.list = LIST + "-was";
      }
    }
    deps.setList(LIST, label, all);
    return all;
  }

  // ─── Moving the panel ───────────────────────────────────────────────────

  function moveIn(host) {
    var q = queuebox();
    if (!q || !host || host.contains(q)) return;
    if (!home) {
      home = document.createComment("queuebox");
      q.parentNode.insertBefore(home, q);
    }
    host.appendChild(q);
    document.body.classList.add("d-queue-here");
    host.addEventListener("click", onPlayClick, true);
    // Live draws the rows again on every change (and long lists a block at a time): mark them each time
    var rows = document.getElementById("mainqueue"), found = document.getElementById("searchResults");
    if (rows && window.MutationObserver) {
      watcher = new MutationObserver(firetable.utilities.oncePerFrame(mark));
      watcher.observe(rows, { childList: true });
      if (found) watcher.observe(found, { childList: true }); // Find tracks' results play here too
    }
    // (no resize event: the list's scrollbar gutter has its own ResizeObserver
    // (ui.js), and a synthetic one made every listener on the page lay it all
    // out again, at once, in the middle of the switch)
  }

  /** Live gets its panel back. */
  function back() {
    var q = queuebox();
    document.body.classList.remove("d-queue-here");
    if (watcher) { watcher.disconnect(); watcher = null; }
    if (!q || !home || !home.parentNode) return;
    var host = q.parentNode;
    if (host) host.removeEventListener("click", onPlayClick, true);
    clearMarks();
    home.parentNode.insertBefore(q, home);
    home.parentNode.removeChild(home);
    home = null;
  }

  // ─── Discover's part ────────────────────────────────────────────────────

  /** The Playlists tab: Live's panel, the decks. */
  function html(tabs) {
    return '<div class="d-sidebody d-sidequeue" data-tab="list">' + tabs +
      '<div class="d-queuehost"></div><div class="pl-deck" id="pv-deckline"></div></div>';
  }

  /** Show it in #dSide (drawn by discover.js with html()). */
  function show() {
    if (!here()) moveIn(hostOf());
    refresh();
  }

  /** The decks, after any change to the list, the seats or what plays. */
  function refresh() {
    var all = sync();
    var deck = document.getElementById("pv-deckline");
    if (deck) deck.innerHTML = deckLine(viewList() === djList(), all.length);
    mark();
  }

  /** Under the playlist: where you stand on the decks. */
  function deckLine(isDj, n) {
    var d = deps.deckState();
    if (!isDj) return '<p class="d-fact">The room plays from ' + esc(firetable.utilities.listName(djList())) + " when you DJ.</p>";
    if (d.on) return '<p class="d-fact">' + ms("headphones") + " You're on the decks. The room plays from the top of this list.</p>";
    if (d.waiting) return '<p class="d-fact">' + ms("queue_music") + " You're #" + esc(d.place) + " in line for the decks.</p>";
    if (!n) return "";
    return '<button type="button" class="butt darkbutt d-joinwait">' + ms("queue_music") + "<span>Hop on the decks</span></button>" +
      '<p class="d-fact d-center">' + (d.open ? "A spot is open. The room plays this list, from the top." : "You'll take the decks when a spot opens.") + "</p>";
  }

  // ─── Playing here ───────────────────────────────────────────────────────

  /** A song's play button in Live's panel plays it in Discover's bar, not as a preview. */
  function onPlayClick(e) {
    var btn = e.target.closest && e.target.closest(".previewicon");
    var row = btn && btn.closest(".pvbar[data-key]");
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    if (row.closest("#mainqueue")) return playRow(row.getAttribute("data-key"));
    if (row.closest("#searchResults")) return playFound(row);
  }

  function playRow(key) {
    var p = deps.player();
    if (deps.active() && p.list === LIST && p.track && p.track.key === key) return deps.togglePause();
    var at = sync().map(function (t) { return t.key; }).indexOf(key);
    if (at !== -1) deps.play(LIST, at);
  }

  /** A search result in Find tracks: on its own, as Discover plays any song. */
  function playFound(row) {
    var key = row.getAttribute("data-key") || "";
    var cid = row.getAttribute("data-cid");
    var p = deps.player();
    if (deps.active() && p.list === "found" && p.track && String(p.track.cid) === String(cid)) return deps.togglePause();
    var name = (row.querySelector(".listwords") || {}).textContent || "";
    var parsed = firetable.utilities.parseArtistTitle(name.trim(), "");
    var art = row.querySelector(".q-art");
    var img = art && /url\(["']?([^"')]+)/.exec(art.style.backgroundImage || "");
    var t = { type: key.indexOf("sccid") === 0 ? MEDIA_SOUNDCLOUD : MEDIA_YOUTUBE, cid: cid, a: parsed.artist, t: parsed.title || name.trim(), img: img ? img[1] : undefined };
    deps.setList("found", "Find tracks", [t]);
    deps.play("found", 0);
  }

  /** The song playing here, the songs saved this visit, and what each play button does here. */
  function mark() {
    var rows = document.querySelector("#dSide #mainqueue");
    if (!rows) return;
    var p = deps.player();
    var key = deps.active() && p.list === LIST && p.track ? p.track.key : null;
    rows.querySelectorAll(".pvbar.d-playing").forEach(function (r) { if (r.getAttribute("data-key") !== key) markRow(r, false); });
    var row = key && document.getElementById("pvbar" + key);
    if (row && rows.contains(row)) markRow(row, true, !p.paused);
    var session = (firetable.saved && firetable.saved.session) || {};
    rows.querySelectorAll(".pvbar[data-cid]").forEach(function (r) {
      r.classList.toggle("d-added", !!session[firetable.saved.key(r.getAttribute("data-type") || 1, r.getAttribute("data-cid"))]);
      if (!r.classList.contains("d-playing")) playLabel(r.querySelector(".previewicon"), false, false);
    });
    // Find tracks' results: the one sounding in the bar says Pause, as a playlist row does (playFound)
    var found = deps.active() && p.list === "found" && p.track ? String(p.track.cid) : null;
    document.querySelectorAll("#dSide #searchResults .pvbar").forEach(function (r) {
      var on = found !== null && r.getAttribute("data-cid") === found;
      playLabel(r.querySelector(".previewicon"), on, on && !p.paused);
    });
  }
  /**
   * A play button here plays its song in the bar, the whole song: Pause while
   * it sounds, Play here otherwise (Live's own say Preview: js/player.js).
   * Only what changed is written: this runs over the whole list on each redraw.
   */
  function playLabel(icon, on, sounding) {
    if (!icon) return;
    var glyph = on && sounding ? "\ue034" : "\ue037"; // pause / play_arrow
    var label = on && sounding ? "Pause" : "Play here";
    if (icon.textContent !== glyph) icon.textContent = glyph;
    if (icon.getAttribute("aria-label") !== label) icon.setAttribute("aria-label", label);
  }
  function markRow(row, on, sounding) {
    row.classList.toggle("d-playing", on);
    playLabel(row.querySelector(".previewicon"), on, sounding);
    if (on) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
  }
  /** Back in Live: no marks, and every play button is Live's preview again. */
  function clearMarks() {
    document.querySelectorAll("#mainqueue .pvbar, #searchResults .pvbar").forEach(function (r) {
      r.classList.remove("d-playing", "d-added");
      r.removeAttribute("aria-current");
      firetable.ui.previewIcon(r.querySelector(".previewicon"), !!firetable.preview && firetable.preview === r.getAttribute("data-key"));
    });
  }

  return function create(d) {
    deps = d;
    esc = d.esc;
    ms = d.ms;
    // the decks line says which list you DJ from
    ftapi.events.on("djListChanged", function () { if (here()) refresh(); });
    return { html: html, show: show, back: back, here: here, refresh: refresh, mark: mark, djList: djList };
  };
})();
