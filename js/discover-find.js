/**
 * discover-find.js — Search's songs: every song the room has played, your
 * own playlists, and then YouTube.
 *
 * The library: firetable-hostbot's weekly Play history job publishes every
 * song played here (discover/lib/songs), and the site's deploy turns it into
 * small static files on the web host, one per word start (music/find/w-*.json, built
 * by tools/plain-pages.mjs with build() below, so both sides split words the
 * same way). A search downloads the one file for its longest word, a few KB
 * the browser keeps, and never touches the database. A song matches when
 * every word typed starts a word of its artist or title.
 *
 * Your playlists: read once a visit, on your first search, and kept in this
 * browser. Later visits ask the database only for each list's track keys (a
 * shallow read) and download just the tracks added since, or a list in full
 * once a day; the list open in Playlists is already here and costs nothing.
 *
 * YouTube: on Enter or its button, for members. Each search costs the site's
 * YouTube quota (100 units), so it never runs as you type.
 *
 * discover.js makes the one there is with firetable.discoverFind(deps), on the
 * first search (js/lazy.js); deps are its helpers, handed over as functions.
 * The word helpers (fold, words, keyOf, build) also work without a page.
 */
firetable.discoverFind = (function () {
  "use strict";
  var BASE = "music/find/";
  var SHARD_MAX = 1500;    // a word start's file holds this many songs before it splits by one more letter
  var DEPTH_MAX = 6;       // and splits at most this deep
  var SHOW = 40;           // songs shown from each source
  var CHECK_EVERY = 30 * 60 * 1000;      // your playlists: ask again after this long
  var REREAD_EVERY = 24 * 3600 * 1000;   // and read each list in full again after this long
  var FEW_NEW = 25;        // more new tracks than this in a list: read the list in full
  var CACHE_KEY = "ft-find-lists-";
  var CACHE_MAX = 2500000; // characters: a bigger cache isn't kept
  // Words too common to choose a file by (a song is still found by them, alongside another word)
  var STOP = {};
  ("the an of and in on to at by for from with feat ft featuring vs remix mix edit version original radio extended " +
    "remaster remastered official video audio live prod").split(" ").forEach(function (w) { STOP[w] = true; });

  // ─── Words ──────────────────────────────────────────────────────────────

  /** Lowercase, without accents, apostrophes or the dots of initials: "Röyksopp's" -> "royksopps", "D.A.N.C.E." -> "dance". */
  function fold(s) {
    return String(s == null ? "" : s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/(^|[^\p{L}\p{N}.])((?:[\p{L}\p{N}]\.){2,}[\p{L}\p{N}]?)/gu, function (m, pre, initials) { return pre + initials.replace(/\./g, ""); })
      .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ł/g, "l")
      .replace(/['’`]/g, "").replace(/&/g, " and ");
  }
  /** The words of a text, folded. */
  function words(s) { return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function len(w) { return Array.from(w).length; }
  /** The file name for a word's first n letters: letters and digits as they are, anything else by its code. */
  function keyOf(w, n) {
    return Array.from(w).slice(0, n).map(function (c) { return /[a-z0-9]/.test(c) ? c : "_" + c.codePointAt(0).toString(16); }).join("");
  }
  /** The words a song is filed under: two letters or more, not the common ones, each once. */
  function fileWords(row) {
    var seen = {};
    return words(row[0] + " " + row[1]).filter(function (w) {
      if (seen[w] || STOP[w] || len(w) < 2) return false;
      seen[w] = true;
      return true;
    });
  }

  /**
   * The static files for the library's search, from every song (the deploy
   * runs this: tools/plain-pages.mjs). Each word start gets a file of the
   * songs with a word starting so, most played first; one with more than
   * SHARD_MAX keeps its most played and splits by one more letter.
   * @param {Array<Array>} rows - [artist, title, type, cid, plays], most played first
   * @param {string} hash - the index's version (discover/lib/meta songsHash)
   * @returns {{index: {v: number, hash: string, songs: number, split: string[]}, files: Object<string, Array<Array>>}}
   */
  function build(rows, hash) {
    var wordsOf = rows.map(fileWords);
    var files = {}, split = [];
    var place = function (key, n, ids) {
      files[key] = ids.slice(0, SHARD_MAX).map(function (i) { return rows[i]; });
      if (ids.length <= SHARD_MAX || n >= DEPTH_MAX) return;
      split.push(key);
      group(ids, n, function (w) { return len(w) > n && keyOf(w, n) === key; });
    };
    var group = function (ids, n, fits) {
      var by = {}, order = [];
      ids.forEach(function (i) {
        var keys = {};
        wordsOf[i].forEach(function (w) { if (fits(w)) keys[keyOf(w, n + 1)] = true; });
        Object.keys(keys).forEach(function (k) { if (!by[k]) { by[k] = []; order.push(k); } by[k].push(i); });
      });
      order.forEach(function (k) { place(k, n + 1, by[k]); });
    };
    group(rows.map(function (r, i) { return i; }), 1, function () { return true; });
    return { index: { v: 1, hash: String(hash || ""), songs: rows.length, split: split.sort() }, files: files };
  }

  /** The file a typed word is looked up in, given the index's split word starts. */
  function fileFor(word, split) {
    var n = 2;
    while (n < len(word) && split[keyOf(word, n)]) n++;
    return keyOf(word, n);
  }
  /** The word to look up by: the longest that isn't too common, else the longest. */
  function lookupWord(toks) {
    var ok = toks.filter(function (w) { return len(w) >= 2; });
    var pick = ok.filter(function (w) { return !STOP[w]; });
    return (pick.length ? pick : ok).sort(function (a, b) { return len(b) - len(a); })[0] || null;
  }
  /** Every typed word starts a word of the text. */
  function hit(toks, text) {
    var ws = words(text);
    return toks.every(function (t) { return ws.some(function (w) { return w.indexOf(t) === 0; }); });
  }
  /** Best first: the artist or title is what was typed, then starts with it, then the rest (each most played first). */
  function ranked(list, toks, artistOf, titleOf) {
    var q = toks.join(" ");
    var score = function (x) {
      var a = words(artistOf(x)).join(" "), t = words(titleOf(x)).join(" ");
      return a === q || t === q ? 3 : a.indexOf(q) === 0 || t.indexOf(q) === 0 ? 2 : 1;
    };
    return list.map(function (x, i) { return { x: x, s: score(x), i: i }; })
      .sort(function (a, b) { return b.s - a.s || a.i - b.i; }).map(function (o) { return o.x; });
  }

  var api = function (deps) { return create(deps); };
  api.fold = fold;
  api.words = words;
  api.keyOf = keyOf;
  api.fileFor = fileFor;
  api.build = build;
  api.SHARD_MAX = SHARD_MAX;
  if (typeof document === "undefined") return api; // the deploy's build: no page

  // ─── One per page ───────────────────────────────────────────────────────

  function create(deps) {
    var lib = libraryFinder(deps);
    var mine = playlistFinder(deps);
    var yt = youtubeFinder(deps);
    return {
      /** Ready the library's index for the first letters. */
      warm: function () { lib.index(); },
      /** Search's song sections (HTML) and how many songs they show; `pending` while something loads. */
      sections: function (query) { return sections(deps, query, lib, mine, yt); },
      youtube: yt.search,
      /** Forget your playlists (signing out). */
      forget: mine.forget
    };
  }

  /** "Songs" (the library, and songs on pages opened this visit), "In your playlists" and "On YouTube". */
  function sections(deps, query, lib, mine, yt) {
    var esc = deps.esc, toks = words(query), out = { html: "", found: 0, pending: false };
    var list = function (name, label, title, tracks, right) {
      deps.setList(name, label + ": " + query, tracks);
      if (!tracks.length) return;
      out.found += tracks.length;
      out.html += "<section>" + deps.head(title) + '<div class="ft-rows d-rowlist">' + tracks.map(function (t, i) {
        return deps.row(t, name, i, { dj: deps.djShown(t.djid, t.dj), right: right(t) });
      }).join("") + "</div></section>";
    };
    var plays = function (t) { return t.plays ? '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + "</span>" : ""; };
    var songs = lib.find(toks);
    if (songs === undefined) out.pending = true;
    list("search", "Search", "Songs", withLoaded(deps, songs || [], toks), plays);
    if (deps.signedIn()) {
      var have = mine.find(toks);
      if (have === undefined) out.pending = true;
      list("search-mine", "Your playlists", "In your playlists", have || [], function (t) {
        return '<span class="d-num">' + esc(t.lists[0] + (t.lists.length > 1 ? " +" + (t.lists.length - 1) : "")) + "</span>";
      });
      out.html += yt.html(query);
    }
    if (out.pending) out.html += deps.loading();
    return out;
  }

  /** The library's songs, then any on pages opened this visit (new releases, charts...) it doesn't have. */
  function withLoaded(deps, songs, toks) {
    if (!toks.length) return songs;
    var seen = {}, out = songs.slice();
    songs.forEach(function (t) { seen[t.type + "_" + t.cid] = true; });
    deps.loaded().forEach(function (t) {
      var k = (t.type || 1) + "_" + t.cid;
      if (seen[k] || !t.cid || out.length >= SHOW + 20) return;
      if (hit(toks, t.a + " " + t.t)) { seen[k] = true; out.push(Object.assign({ type: Number(t.type || 1) }, t)); }
    });
    return out;
  }

  // ─── The library (static files, no database) ────────────────────────────

  function libraryFinder(deps) {
    var idx;            // undefined: not asked; null: none (this site has no index); else the index
    var asking = null;
    var files = {};     // key -> rows, or null when it couldn't be read
    var want = {};
    var get = function (path) {
      return fetch(new URL(BASE + path, document.baseURI).href, { cache: path === "index.json" ? "no-cache" : "default" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    };
    var index = function () {
      if (idx !== undefined || asking) return idx;
      asking = get("index.json").then(function (x) {
        idx = x && x.v === 1 && Array.isArray(x.split) ? x : null;
        if (idx) { var s = {}; idx.split.forEach(function (k) { s[k] = true; }); idx.splitSet = s; }
      }, function () { idx = null; }).then(function () { asking = null; deps.changed(); });
      return idx;
    };
    var file = function (key) {
      if (key in files || want[key]) return files[key];
      want[key] = true;
      get("w-" + key + ".json?v=" + encodeURIComponent(idx.hash)).then(function (rows) { files[key] = Array.isArray(rows) ? rows : []; },
        function (e) { firetable.debug && console.log("[find] no file for " + key, e && e.message); files[key] = null; })
        .then(function () { delete want[key]; deps.changed(); });
      return undefined;
    };
    /** The songs for typed words: undefined while loading, [] for none (or no index). */
    var find = function (toks) {
      var w = lookupWord(toks);
      if (!w) return [];
      if (index() === undefined) return undefined;
      if (!idx) return [];
      var rows = file(fileFor(w, idx.splitSet));
      if (rows === undefined) return undefined;
      var got = (rows || []).filter(function (r) { return hit(toks, r[0] + " " + r[1]); });
      return ranked(got, toks, function (r) { return r[0]; }, function (r) { return r[1]; }).slice(0, SHOW)
        .map(function (r) { return { a: r[0], t: r[1], type: Number(r[2]) || 1, cid: String(r[3]), plays: r[4] || 0 }; });
    };
    return { index: index, find: find };
  }

  // ─── Your playlists (read once, then only what changed) ─────────────────

  function playlistFinder(deps) {
    var state = null;    // {uid, checked, lists: {id: {name, at, keys: {key: [type, cid, name, img, url]}}}}
    var reading = null;
    var store = function () {
      try {
        var s = JSON.stringify(state);
        if (s.length <= CACHE_MAX) localStorage.setItem(CACHE_KEY + state.uid, s);
        else localStorage.removeItem(CACHE_KEY + state.uid);
      } catch (e) { /* storage off or full: read again next visit */ }
    };
    var restore = function (uid) {
      var s = null;
      try { s = JSON.parse(localStorage.getItem(CACHE_KEY + uid) || "null"); } catch (e) { /* none */ }
      return s && s.uid === uid && s.lists ? s : { uid: uid, checked: 0, lists: {} };
    };
    var refresh = function () {
      var now = Date.now();
      reading = listNames().then(function (all) {
        Object.keys(state.lists).forEach(function (id) { if (!(id in all)) delete state.lists[id]; });
        return queue(Object.keys(all).map(function (id) {
          return function () { return readList(state, id, all[id], now); };
        }), 4).then(function () { state.checked = now; store(); });
      }).catch(function (e) {
        // try again in a minute, not on every keystroke
        console.warn("[find] couldn't read your playlists:", e && e.message);
        state.checked = now - CHECK_EVERY + 60000;
      }).then(function () { reading = null; deps.changed(); });
    };
    /** The songs in your playlists for typed words: undefined while they're first read. */
    var find = function (toks) {
      var uid = ftapi.uid;
      if (!uid || !toks.length) return [];
      if (!state || state.uid !== uid) state = restore(uid);
      var fresh = Date.now() - state.checked < CHECK_EVERY;
      if (!fresh && !reading) refresh();
      if (!state.checked && reading) return undefined;
      return search(toks);
    };
    var search = function (toks) {
      var by = {}, out = [];
      var add = function (t, name) {
        if (!t || t.cid == null || !t.name || !hit(toks, t.name)) return;
        var k = Number(t.type || 1) + "_" + t.cid;
        if (by[k]) { if (by[k].lists.indexOf(name) === -1) by[k].lists.push(name); return; }
        var p = firetable.utilities.parseArtistTitle(String(t.name));
        by[k] = { type: Number(t.type || 1), cid: String(t.cid), a: p.artist, t: p.title, img: t.img, url: t.url, lists: [name] };
        out.push(by[k]);
      };
      // the list open in Playlists, as it is now (it's already here)
      var openId = firetable._queueList != null ? String(firetable._queueList) : null;
      if (openId !== null && firetable.queue) {
        var openName = firetable.utilities.listName(openId);
        Object.keys(firetable.queue).forEach(function (k) { add(firetable.queue[k], openName); });
      }
      Object.keys(state.lists).forEach(function (id) {
        if (id === openId) return;
        var l = state.lists[id];
        Object.keys(l.keys).forEach(function (k) { var c = l.keys[k]; add({ type: c[0], cid: c[1], name: c[2], img: c[3], url: c[4] }, l.name); });
      });
      return ranked(out, toks, function (t) { return t.a; }, function (t) { return t.t; }).slice(0, SHOW);
    };
    /** Signing out: nothing of your playlists stays in this browser. */
    var forget = function () {
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(CACHE_KEY) === 0) localStorage.removeItem(k); }); } catch (e) { /* storage off */ }
      state = null;
    };
    return { find: find, forget: forget };
  }

  /**
   * Bring one list's copy up to date: in full when it's new here or a day
   * old, else only the tracks added since (a shallow read of its keys).
   */
  function readList(state, id, name, now) {
    var path = String(id) === "0" ? "queues/" + ftapi.uid : "playlists/" + ftapi.uid + "/" + id + "/list";
    var had = state.lists[id];
    // the list open in Playlists is already here: no read at all
    if (firetable.queue && firetable._queueList != null && String(firetable._queueList) === String(id)) {
      state.lists[id] = { name: name, at: now, keys: compact(firetable.queue) };
      return Promise.resolve();
    }
    var full = function () {
      return ftapi.db().ref(path).once("value").then(function (snap) {
        state.lists[id] = { name: name, at: now, keys: compact(snap.val()) };
      });
    };
    if (!had || now - (had.at || 0) > REREAD_EVERY) return full();
    had.name = name;
    return ftapi.utilities.shallowKeys(path).then(function (keys) {
      Object.keys(had.keys).forEach(function (k) { if (!keys[k]) delete had.keys[k]; });
      var added = Object.keys(keys).filter(function (k) { return !had.keys[k]; });
      if (added.length > FEW_NEW) return full();
      return Promise.all(added.map(function (k) {
        return ftapi.db().ref(path + "/" + k).once("value").then(function (s) { var c = compact({ x: s.val() }).x; if (c) had.keys[k] = c; });
      }));
    }, full);
  }

  /** Your lists' names by id ("0" is the Default playlist), from what the pickers know, else a shallow read. */
  function listNames() {
    var known = firetable.allPlaylists || {};
    var named = function (all) {
      var out = { 0: "Default Playlist" };
      Object.keys(all || {}).forEach(function (id) { out[id] = (all[id] && all[id].name) || "your playlist"; });
      return out;
    };
    if (Object.keys(known).length) return Promise.resolve(named(known));
    return new Promise(function (resolve) { ftapi.lookup.listNames(function (all) { resolve(named(all)); }); });
  }

  /** A list's tracks as kept here: key -> [type, cid, name, img, url] (img and url only when there are). */
  function compact(list) {
    var out = {};
    Object.keys(list || {}).forEach(function (k) {
      var t = list[k];
      if (!t || t.cid == null || typeof t.name !== "string") return;
      var row = [Number(t.type || 1), String(t.cid), t.name.slice(0, 300)];
      if (t.img || t.url) row.push(t.img || "", t.url || "");
      out[k] = row;
    });
    return out;
  }

  /** Run promise-making jobs, `n` at a time. */
  function queue(jobs, n) {
    var next = 0;
    var worker = function () {
      if (next >= jobs.length) return Promise.resolve();
      var job = jobs[next++];
      return job().catch(function (e) { console.warn("[find]", e && e.message); }).then(worker);
    };
    return Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  }

  // ─── YouTube (members, on Enter) ────────────────────────────────────────

  function youtubeFinder(deps) {
    var yt = { q: null, rows: null };
    var esc = deps.esc;
    /** YouTube's results for a search, with the room's plays for each. */
    var search = function (query) {
      if (typeof ytAPI !== "function" || !query || yt.q === query) return;
      yt = { q: query, rows: null };
      deps.changed();
      ytAPI("search", { q: query, type: "video", part: "snippet", maxResults: SEARCH_MAX_RESULTS }, function (res) {
        var rows = ((res && res.items) || []).map(function (item) {
          var cid = item.id && (item.id.videoId || item.id);
          var p = firetable.utilities.parseArtistTitle(firetable.ui.strip(firetable.utilities.youtubeTrackName(item.snippet.title, item.snippet.channelTitle, item.snippet.description)));
          return { type: MEDIA_YOUTUBE, cid: cid, a: p.artist, t: p.title };
        }).filter(function (t) { return t.cid; });
        Promise.all(rows.map(function (t) {
          return ftapi.db().ref("globalTracks/1" + t.cid).once("value").then(function (s) {
            var v = s.val();
            if (!v || !v.song) return;
            return ftapi.db().ref("globalSongs/" + v.song + "/plays").once("value").then(function (pl) { t.plays = pl.val() || 0; });
          }).catch(function () {});
        })).then(function () {
          if (yt.q !== query) return;
          yt.rows = rows;
          deps.changed();
        });
      });
    };
    var html = function (query) {
      if (yt.q !== query || !yt.rows) {
        return '<section><button type="button" class="butt graybutt d-ytsearch">' + deps.ms("travel_explore") + "<span>" +
          (yt.q === query ? "Searching YouTube…" : "Search YouTube for “" + esc(query) + "”") + "</span></button></section>";
      }
      deps.setList("search-yt", "YouTube: " + query, yt.rows);
      return "<section>" + deps.head("On YouTube") + (yt.rows.length ? '<div class="ft-rows d-rowlist">' + yt.rows.map(function (t, i) {
        return deps.row(t, "search-yt", i, { right: t.plays ? '<span class="d-num">' + esc(firetable.utilities.pluralize(t.plays, "play", "plays")) + " here</span>" : '<span class="d-new">not played here</span>' });
      }).join("") + "</div>" : deps.emptyNote("Nothing on YouTube for that.")) + "</section>";
    };
    return { search: search, html: html };
  }

  return api;
})();
