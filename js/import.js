/**
 * import.js — Import a playlist from YouTube or SoundCloud, step by step (1.19).
 *
 * Step 1 (#im-step1): find the playlist — paste its link or search by name
 * (search.js fills #importResults). Each result shows its song count.
 * Step 2 (#im-step2): see its songs before importing. Private and deleted
 * videos are listed as "Not available" instead of being dropped, and so are
 * songs already in the chosen playlist or in this one twice. Choose a new
 * playlist (named) or one you have (top or bottom), then Import N songs.
 * The import is one write; its toast offers Undo (removes exactly what was
 * added, or the new playlist) and Open.
 *
 * A list of songs (1.20, #im-listPane): pasted "Artist - Title" lines or a
 * CSV. Step 2 asks the room's bot to find each one (importJobs/<uid>/<job>,
 * firetable-hostbot lib/imports.js): the room's own upload first, then free
 * lookups, of the kind the destination playlist takes. Each song shows what
 * was found (Played here, Song, Video, SoundCloud), with a pick where there's
 * more than one, or Not found. Importing then works as for a playlist.
 *
 * Also: firetable.importer.parseLink / peek for "That's a playlist: … Import it"
 * in Find tracks and Discover search.
 */

firetable.importer = (function () {
  var I = {};
  var S = { meta: null, songs: null, token: 0 };

  var box = function () { return document.getElementById("importPromptBox"); };
  var plural = function (n, one, many) { return firetable.utilities.pluralize(n, one, many); };

  // ─── Links ────────────────────────────────────────────────────────────────

  /**
   * A YouTube or SoundCloud playlist link in some text, or null. A YouTube
   * video link that also names a list (watch?v=…&list=…) is a song, not this.
   * @param {string} text
   * @returns {{type:number, id?:string, url?:string}|null}
   */
  I.parseLink = function (text) {
    text = String(text || "").trim();
    if (!/^https?:\/\//i.test(text) && !/^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|soundcloud\.com|on\.soundcloud\.com)\//i.test(text)) return null;
    var yt = text.match(/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/(\S*)$/i);
    if (yt) {
      var list = (yt[1].match(/[?&]list=([\w-]{10,64})/) || [])[1];
      if (!list) return null;
      if (/^playlist\b/i.test(yt[1]) || !/[?&]v=|^watch|^[\w-]{11}(?:[?&]|$)/.test(yt[1])) return { type: MEDIA_YOUTUBE, id: list };
      return null;
    }
    if (firetable.utilities.isSCLink(text) && (/soundcloud\.com\/[^/?#]+\/sets\/[^/?#]+/i.test(text) || /on\.soundcloud\.com\//i.test(text))) {
      return { type: MEDIA_SOUNDCLOUD, url: text };
    }
    return null;
  };

  var peeked = {};
  /**
   * What a playlist link points to: {type, id, name, by, count, href}, or null
   * when it isn't a public playlist. Cached for the visit.
   * @param {string|Object} link - text, or parseLink's result
   * @returns {Promise<Object|null>}
   */
  I.peek = function (link) {
    var p = typeof link === "string" ? I.parseLink(link) : link;
    if (!p) return Promise.resolve(null);
    var key = p.type + ":" + (p.id || p.url);
    if (peeked[key]) return peeked[key];
    var out;
    if (p.type === MEDIA_YOUTUBE) {
      out = new Promise(function (resolve) {
        ytAPI("playlists", { id: p.id, part: "snippet,contentDetails" }, function (res) {
          var item = res && res.items && res.items[0];
          if (!item) return resolve(null);
          resolve({
            type: MEDIA_YOUTUBE, id: p.id,
            name: firetable.ui.strip(item.snippet.title || "YouTube playlist"),
            by: firetable.ui.strip(item.snippet.channelTitle || ""),
            count: item.contentDetails ? item.contentDetails.itemCount : null,
            href: "https://www.youtube.com/playlist?list=" + encodeURIComponent(p.id)
          });
        });
      });
    } else {
      out = Promise.resolve(firetable.actions.resolveSCLink(p.url)).then(function (item) {
        return I.fromSoundCloud(item);
      }, function () { return null; });
    }
    peeked[key] = out;
    out.then(function (m) { if (!m) delete peeked[key]; });
    return out;
  };

  /** A SoundCloud set (resolve / search result) as a playlist, or null. */
  I.fromSoundCloud = function (item) {
    if (!item || item.kind !== "playlist" || item.sharing === "private") return null;
    return {
      type: MEDIA_SOUNDCLOUD, id: String(item.id),
      name: firetable.ui.strip(item.title || "SoundCloud playlist"),
      by: firetable.ui.strip((item.user && item.user.username) || ""),
      count: typeof item.track_count === "number" ? item.track_count : null,
      href: /^https:\/\//i.test(item.permalink_url || "") ? item.permalink_url : ""
    };
  };

  /** "Night Drive · 64 songs" */
  I.describe = function (meta) {
    return meta.name + (typeof meta.count === "number" ? " · " + plural(meta.count, "song") : "");
  };

  // ─── Songs ────────────────────────────────────────────────────────────────

  /**
   * Every song in a playlist, in its order, the ones that can't play kept and
   * marked: [{type, cid, name, img?, url?, why?}] (why: "Private video",
   * "Deleted video", "Not available").
   * @param {Object} meta - {type, id}
   * @param {Function} [onProgress] - (loaded, total|null)
   * @returns {Promise<Object[]>}
   */
  I.fetchSongs = function (meta, onProgress) {
    if (Number(meta.type) === MEDIA_SOUNDCLOUD) {
      return Promise.resolve(firetable.actions.scPlaylist(meta.id)).then(function (info) {
        var tracks = (info && info.tracks) || [];
        if (info && info.title && !meta.name) meta.name = info.title;
        return tracks.map(function (t) {
          if (!t || !t.id) return { type: MEDIA_SOUNDCLOUD, cid: "", name: "Unknown", why: "Not available" };
          var name = "Unknown";
          if (t.title) {
            var parsed = firetable.utilities.parseArtistTitle(t.title, (t.user && t.user.username) || "");
            name = parsed.artist + " - " + parsed.title;
          }
          var extras = firetable.utilities.soundCloudExtras(t);
          var song = { type: MEDIA_SOUNDCLOUD, cid: t.id, name: name, img: extras.img, url: extras.url };
          if (t.sharing === "private" || t.streamable === false) song.why = "Not available";
          return song;
        });
      });
    }
    return new Promise(function (resolve) {
      var songs = [];
      var page = function (token) {
        var params = { playlistId: meta.id, maxResults: IMPORT_PAGE_SIZE, part: "snippet,status" };
        if (token) params.pageToken = token;
        ytAPI("playlistItems", params, function (res) {
          (res.items || []).forEach(function (item) {
            var sn = item.snippet || {};
            var raw = firetable.utilities.decodeEntities(sn.title || "");
            var cid = sn.resourceId && sn.resourceId.videoId;
            var privacy = item.status && item.status.privacyStatus;
            var why = raw === "Private video" || privacy === "private" ? "Private video"
              : raw === "Deleted video" || privacy === "privacyStatusUnspecified" ? "Deleted video"
              : !cid ? "Not available" : "";
            // the same page says who uploaded each video and its description:
            // the artist comes free ("Band - Topic" -> "Band")
            var song = { type: MEDIA_YOUTUBE, cid: cid || "", name: why ? raw : firetable.utilities.youtubeTrackName(sn.title, sn.videoOwnerChannelTitle, sn.description) };
            if (why) song.why = why;
            songs.push(song);
          });
          var total = res.pageInfo && res.pageInfo.totalResults;
          if (onProgress) onProgress(songs.length, total || null);
          if (res.nextPageToken && songs.length < 5000) page(res.nextPageToken);
          else resolve(songs);
        });
      };
      page();
    });
  };

  /** cid → true for a list's tracks */
  var contents = function (listID) {
    return ftapi.lookup.listRef(listID).once("value").then(function (snap) {
      var have = {};
      snap.forEach(function (c) { var t = c.val(); if (t && t.cid) have[t.type + "_" + t.cid] = true; });
      return have;
    });
  };

  /**
   * Which songs go in, given what's already in the list: each song gets
   * .skip ("Already there" / "Twice in this playlist") or .why, or neither.
   * @param {Object[]} songs
   * @param {Object|null} have - contents() of the destination, or null for a new list
   * @param {boolean} skipExisting
   * @returns {Object[]} the ones that go in
   */
  I.plan = function (songs, have, skipExisting) {
    var seen = {};
    return songs.filter(function (s) {
      delete s.skip;
      if (s.why) return false;
      var k = s.type + "_" + s.cid;
      if (skipExisting && seen[k]) { s.skip = "Twice in this playlist"; return false; }
      if (skipExisting && have && have[k]) { s.skip = "Already there"; return false; }
      seen[k] = true;
      return true;
    });
  };

  // ─── Importing ────────────────────────────────────────────────────────────

  var lean = function (s) {
    var t = { type: s.type, name: s.name, cid: s.cid };
    if (s.img) t.img = s.img;
    if (s.url) t.url = s.url;
    return ftapi.utilities.leanTrack(t);
  };

  /**
   * Import a playlist's songs. Old callers pass (id, name, type) and get a new
   * playlist with every song that can play, as before.
   * @param {string} id - Playlist/set ID
   * @param {string} name - Name for a new list
   * @param {number} type - MEDIA_YOUTUBE or MEDIA_SOUNDCLOUD
   * @param {Object} [opts]
   * @param {string} [opts.dest] - an existing list's ID; none makes a new list
   * @param {string} [opts.position] - "top" or "bottom" (default) in an existing list
   * @param {boolean} [opts.skipExisting] - leave out songs already there (default true)
   * @param {Object[]} [opts.songs] - fetchSongs' result, if already fetched
   * @param {Function} [opts.onProgress] - (loaded, total) while fetching
   * @returns {Promise<{listID, keys, created, added, skipped, unavailable}>}
   */
  I.importList = function (id, name, type, opts) {
    opts = opts || {};
    type = Number(type);
    var dest = opts.dest != null && opts.dest !== "" && opts.dest !== "new" ? String(opts.dest) : null;
    var skipExisting = opts.skipExisting !== false;
    if (dest) {
      var refusal = firetable.utilities.formatRefusal(dest, type);
      if (refusal) return Promise.reject(new Error(refusal));
    }
    var songs = opts.songs ? Promise.resolve(opts.songs) : I.fetchSongs({ type: type, id: id, name: name }, opts.onProgress);
    return songs.then(function (all) {
      return (dest ? contents(dest) : Promise.resolve(null)).then(function (have) {
        var go = I.plan(all, have, skipExisting);
        // songs the room has tags for go in written the room's way
        return ftapi.utilities.roomTags(go.map(function (s) { return { type: s.type, cid: s.cid, name: s.name }; })).then(function (named) {
          return go.map(function (s, i) { return Object.assign({}, s, { name: named[i].name }); });
        });
      }).then(function (go) {
        var result = {
          listID: dest, keys: [], created: !dest, added: go.length,
          skipped: all.filter(function (s) { return s.skip === "Already there"; }).length,
          repeats: all.filter(function (s) { return s.skip === "Twice in this playlist"; }).length,
          unavailable: all.filter(function (s) { return s.why; }).length
        };
        if (!dest) {
          var listID = ftapi.actions.createList(name);
          firetable.utilities.addPlaylistToPickers(listID, name);
          result.listID = listID;
          if (!go.length) return result;
          var ref = ftapi.lookup.listRef(listID), update = {};
          go.forEach(function (s) { var k = ref.push().key; update[k] = lean(s); result.keys.push(k); });
          return ref.update(update).then(function () { return result; });
        }
        if (!go.length) return result;
        var dref = ftapi.lookup.listRef(dest);
        var fresh = go.map(function (s) { return { key: dref.push().key, track: lean(s), cid: String(s.cid) }; });
        if (opts.position === "top") {
          return new Promise(function (resolve, reject) {
            ftapi.utilities.rearrangeList(dref, function (items) {
              return fresh.map(function (f) { return { key: f.key, track: f.track }; }).concat(items);
            }, function (err, moves) {
              if (err || !moves) return reject(err || new Error("The playlist changed. Try again."));
              if (dest === String(ftapi.selectedListThing || "") || dest === $("#listpicker").val()) {
                ftapi.utilities.previewMover(firetable.preview, function (pv) { firetable.preview = pv; })(null, moves);
              }
              result.keys = fresh.map(function (f) { return moves[f.key]; });
              result.cids = fresh.map(function (f) { return f.cid; });
              resolve(result);
            }, fresh.map(function (f) { return f.key; }));
          });
        }
        var upd = {};
        fresh.forEach(function (f) { upd[f.key] = f.track; result.keys.push(f.key); });
        result.cids = fresh.map(function (f) { return f.cid; });
        return dref.update(upd).then(function () { return result; });
      });
    });
  };

  /**
   * Take an import back: the new playlist, or exactly the tracks it added
   * (each only if its place still holds the song it put there).
   * @param {Object} result - importList's result
   */
  I.undo = function (result) {
    if (result.created) {
      firetable.actions.deleteLists([result.listID]);
      return Promise.resolve();
    }
    var ref = ftapi.lookup.listRef(result.listID);
    return ref.once("value").then(function (snap) {
      var now = snap.val() || {}, upd = {}, n = 0;
      result.keys.forEach(function (k, i) {
        if (now[k] && (!result.cids || String(now[k].cid) === result.cids[i])) { upd[k] = null; n++; }
      });
      return n ? ref.update(upd) : null;
    });
  };

  // ─── A list of songs (1.20) ───────────────────────────────────────────────

  var MAX_LIST = 500;
  var SEPARATORS = [" - ", " \u2013 ", " \u2014 ", " -- "];
  var clip = function (v) { return String(v || "").trim().slice(0, 300); };
  var clock = function (secs) {
    secs = Math.round(Number(secs) || 0);
    return Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
  };

  /**
   * One pasted line as a song: {a, t, d?}, or null for a line that isn't one.
   * "Artist - Title" (or – or —), "Artist<tab>Title", with numbering, bullets
   * and a trailing length ("3:45" or "(3:45)") taken off.
   * @param {string} line
   * @returns {{a:string, t:string, d?:number}|null}
   */
  I.parseLine = function (line) {
    var text = String(line || "").replace(/\s+$/, "");
    if (!text.trim() || /^\s*(#|\/\/)/.test(text)) return null;
    text = text.replace(/^\s*(?:\d{1,4}[.):\]]?\s+|[-*\u2022\u00b7]\s+)/, "");
    var d = 0;
    var len = text.match(/\s*[([]?(\d{1,2}):([0-5]\d)[)\]]?\s*$/);
    if (len && len.index > 0) {
      d = Number(len[1]) * 60 + Number(len[2]);
      text = text.slice(0, len.index);
    }
    var a = "", t = text.trim();
    if (t.indexOf("\t") !== -1) {
      var cols = t.split("\t").map(function (c) { return c.trim(); }).filter(Boolean);
      a = cols[0] || "";
      t = cols.slice(1).join(" ") || "";
    } else {
      for (var i = 0; i < SEPARATORS.length; i++) {
        var at = t.indexOf(SEPARATORS[i]);
        if (at > 0) { a = t.slice(0, at); t = t.slice(at + SEPARATORS[i].length); break; }
      }
    }
    a = clip(a);
    t = clip(t);
    if (!t) return null;
    var song = { a: a, t: t };
    if (d > 0) song.d = d;
    return song;
  };

  /** CSV (or TSV) rows: [[field, ...], ...], quotes and all. */
  var csvRows = function (text) {
    var first = text.split(/\r?\n/, 1)[0];
    var delim = first.indexOf("\t") !== -1 ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
    var rows = [], row = [], field = "", quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"' && field === "") quoted = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (f) { return String(f).trim(); }); });
  };

  /**
   * A CSV export's songs, or null when the text isn't a CSV with artist and
   * title columns. Column names other services use: Artist / Artist Name(s) /
   * Artists, Title / Track / Track Name / Name / Song, Duration (ms) / Duration / Time.
   * @param {string} text
   * @returns {Array<{a, t, d?}>|null}
   */
  I.parseCsv = function (text) {
    var rows = csvRows(String(text || ""));
    if (rows.length < 2) return null;
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase().replace(/[^a-z()]+/g, " ").trim(); });
    var find = function (names) {
      for (var i = 0; i < head.length; i++) if (names.indexOf(head[i]) !== -1) return i;
      return -1;
    };
    var ai = find(["artist", "artists", "artist name", "artist name(s)", "artist names", "artist s", "artist name s", "album artist"]);
    var ti = find(["title", "track", "track name", "track title", "name", "song", "song name", "song title"]);
    if (ti === -1 || ai === -1) return null;
    var ms = find(["duration (ms)", "duration ms", "track duration (ms)", "time (ms)"]);
    var di = ms !== -1 ? ms : find(["duration", "time", "length"]);
    return rows.slice(1).map(function (r) {
      var t = clip(r[ti]);
      if (!t) return null;
      var song = { a: clip(String(r[ai] || "").replace(/\s*;\s*/g, ", ")), t: t };
      var raw = di !== -1 ? String(r[di] || "").trim() : "";
      var d = ms !== -1 ? Math.round(Number(raw) / 1000)
        : /^\d{1,2}:\d{2}$/.test(raw) ? Number(raw.split(":")[0]) * 60 + Number(raw.split(":")[1]) : Number(raw);
      if (d > 0 && d <= 86400) song.d = d;
      return song;
    }).filter(Boolean);
  };

  /** What someone pasted or picked: a CSV export, or one song per line. */
  I.readSongs = function (text) {
    return I.parseCsv(text) || String(text || "").split(/\r?\n/).map(I.parseLine).filter(Boolean);
  };

  // the bot's answer for the list on show: {id, ref, fn, format, status, n, timer}
  var L = { job: null };
  var stopJob = function () {
    var job = L.job;
    if (!job) return;
    L.job = null;
    clearTimeout(job.timer);
    if (job.fn) job.ref.off("value", job.fn);
    job.ref.remove().catch(function () { /* already gone */ });
  };
  // what the destination takes: a new playlist is YouTube Music
  var jobFormat = function () {
    var dest = destVal();
    return dest === "new" ? "ytm" : (firetable.utilities.listFormat(dest) || "ytm");
  };
  var pickLabel = function (p, all) {
    var label = p.src === "room" ? "Played here" : Number(p.type) === MEDIA_SOUNDCLOUD ? "SoundCloud" : p.kind === "a" ? "Song" : "Video";
    var same = all.filter(function (q) { return q !== p && (q.src === "room") === (p.src === "room") && q.kind === p.kind; }).length;
    return same && p.dur ? label + " \u00b7 " + clock(p.dur) : label;
  };
  /** Use a song's pick k (or none: -1), as the playlist importer takes it. */
  var choose = function (s, k) {
    s.pick = k;
    var p = k >= 0 && s.picks ? s.picks[k] : null;
    delete s.img;
    delete s.url;
    if (!p) {
      s.type = S.meta.type;
      s.cid = "";
      s.name = s.orig;
      s.why = s.state === "look" ? "Looking\u2026" : s.found === "later" ? "Try later" : s.picks && s.picks.length ? "Left out" : "Not found";
      return;
    }
    delete s.why;
    s.type = Number(p.type) || MEDIA_YOUTUBE;
    s.cid = String(p.cid);
    s.name = (p.artist ? p.artist + " - " : "") + (p.title || s.orig);
    if (p.img) s.img = p.img;
    if (p.url) s.url = p.url;
  };
  var askBot = function () {
    stopJob();
    if (!S.meta || !S.meta.list || !window.ftapi || !ftapi.uid) return;
    var format = jobFormat();
    S.meta.format = format;
    S.meta.type = format === "sc" ? MEDIA_SOUNDCLOUD : MEDIA_YOUTUBE;
    S.songs.forEach(function (s) { s.state = "look"; s.picks = null; s.found = ""; choose(s, -1); });
    var ref = ftapi.db().ref("importJobs/" + ftapi.uid).push();
    var job = { id: ref.key, ref: ref, fn: null, format: format, status: "new", n: 0, timer: null };
    L.job = job;
    var items = S.list.map(function (it) { return it.d ? { a: it.a, t: it.t, d: it.d } : { a: it.a, t: it.t }; });
    ref.set({ items: items, format: format, status: "new", at: firebase.database.ServerValue.TIMESTAMP }).then(function () {
      if (L.job !== job) return;
      job.fn = ref.on("value", function (snap) { if (L.job === job) answered(job, snap.val()); });
      job.timer = setTimeout(function () {
        if (L.job === job && job.status === "new") setStatus("The room's bot hasn't started on these yet. It may be busy or away; leave this open, or try again later.");
      }, 20000);
    }, function () {
      if (L.job !== job) return;
      L.job = null;
      setStatus("The room's bot can't look songs up yet. Try again later.", "error");
    });
    refresh();
  };
  var answered = function (job, val) {
    if (!val) return;
    job.status = val.status;
    job.n = Number(val.n) || 0;
    var results = val.results || {};
    S.songs.forEach(function (s, i) {
      var r = results[i];
      if (!r || s.state === "done") return;
      s.state = "done";
      s.found = r.s;
      s.picks = Array.isArray(r.picks) ? r.picks.filter(function (p) { return p && p.cid; }) : [];
      choose(s, s.picks.length ? 0 : -1);
    });
    if (job.status === "failed") {
      S.songs.forEach(function (s) { if (s.state === "look") { s.state = "done"; s.found = "later"; choose(s, -1); } });
    }
    refresh();
    if (job.status === "failed") setStatus(val.note || "The room's bot couldn't look these up. Try again later.", "error");
  };

  /** Step 2 for a list of songs: what the bot finds for each, where they go. */
  I.showList = function (list, name) {
    S.token++;
    S.list = list.slice(0, MAX_LIST);
    S.meta = { list: true, name: name || "Imported songs", by: "", count: S.list.length, type: MEDIA_YOUTUBE };
    S.songs = S.list.map(function (it) {
      var orig = (it.a ? it.a + " - " : "") + it.t;
      return { orig: orig, name: orig, type: MEDIA_YOUTUBE, cid: "", state: "look", why: "Looking\u2026" };
    });
    el("im-step1").hidden = true;
    el("im-step2").hidden = false;
    el("im-back").hidden = false;
    el("importTitle").textContent = "Import your list";
    el("im-name").textContent = S.meta.name;
    el("im-link").hidden = true;
    el("im-meta").textContent = plural(S.list.length, "song") + " \u00b7 found by the room's bot";
    el("im-newName").value = S.meta.name;
    fillDest();
    askBot();
  };

  var listInput = function () {
    var songs = I.readSongs(el("im-listText").value);
    var n = songs.length;
    el("im-listCount").textContent = !n ? "" : plural(n, "song") + (n > MAX_LIST ? " (the first " + MAX_LIST + " will be looked up)" : "");
    var btn = el("im-listFind");
    btn.disabled = !n;
    btn.textContent = n ? "Find " + plural(Math.min(n, MAX_LIST), "song") : "Find the songs";
    return songs;
  };

  // ─── The dialog ───────────────────────────────────────────────────────────

  var el = function (id) { return document.getElementById(id); };

  /** Open the dialog: at step 1, or straight at a playlist's songs. */
  I.open = function (meta) {
    var d = box();
    if (!d) return;
    if (!d.open) d.showModal();
    if (meta) I.show(meta);
    else I.back();
  };

  I.back = function () {
    stopJob();
    S.token++;
    S.meta = null;
    S.songs = null;
    el("im-step2").hidden = true;
    el("im-step1").hidden = false;
    el("im-back").hidden = true;
    el("importTitle").textContent = "Import a playlist";
    var input = el("plMachine");
    if (input) setTimeout(function () { input.focus(); }, 0);
  };

  /** Step 2: a playlist's songs, where they go, Import N songs. */
  I.show = function (meta) {
    var token = ++S.token;
    S.meta = meta;
    S.songs = null;
    el("im-step1").hidden = true;
    el("im-step2").hidden = false;
    el("im-back").hidden = false;
    el("importTitle").textContent = "Import “" + meta.name + "”";
    el("im-name").textContent = meta.name;
    var link = el("im-link");
    if (meta.href) { link.href = meta.href; link.hidden = false; } else link.hidden = true;
    link.title = "Open on " + (Number(meta.type) === MEDIA_SOUNDCLOUD ? "SoundCloud" : "YouTube");
    link.setAttribute("aria-label", link.title);
    el("im-meta").textContent = [meta.by ? "by " + meta.by : "", typeof meta.count === "number" ? plural(meta.count, "song") : "",
      Number(meta.type) === MEDIA_SOUNDCLOUD ? "SoundCloud" : "YouTube"].filter(Boolean).join(" · ");
    el("im-newName").value = meta.name;
    fillDest();
    el("im-songs").innerHTML = "";
    setStatus("Loading the songs…");
    el("im-go").disabled = true;
    el("im-go").textContent = "Import";
    I.fetchSongs(meta, function (n, total) {
      if (token === S.token) setStatus("Loading the songs… " + n + (total ? " of " + total : ""));
    }).then(function (songs) {
      if (token !== S.token) return;
      S.songs = songs;
      if (!songs.length) { setStatus("No songs in that playlist (or it isn't public)."); return; }
      refresh();
    }, function (err) {
      if (token === S.token) setStatus((err && err.message) || "Couldn't load that playlist.");
    });
  };

  var destVal = function () {
    var r = document.querySelector('input[name="im-dest"]:checked');
    return r && r.value === "have" ? el("im-destList").value : "new";
  };

  var fillDest = function () {
    var sel = el("im-destList");
    var keep = sel.value;
    sel.innerHTML = "";
    firetable.utilities.sortedLists(firetable.allPlaylists).forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name;
      sel.appendChild(o);
    });
    if (keep && sel.querySelector('option[value="' + CSS.escape(keep) + '"]')) sel.value = keep;
    else sel.value = $("#listpicker").val() || "0";
  };

  var setStatus = function (msg, kind) {
    var s = el("im-status");
    s.textContent = msg || "";
    s.className = "im-status" + (kind ? " is-" + kind : "");
  };

  var haveCache = { id: null, have: null };
  /** Re-plan and redraw step 2 for the current choices. */
  var refresh = function () {
    if (!S.songs) return;
    var token = S.token;
    var dest = destVal();
    var skip = el("im-skip").checked;
    var named = el("im-newName");
    named.disabled = dest !== "new";
    el("im-destList").disabled = el("im-pos").disabled = dest === "new";
    // a list of songs asks again when the destination takes another kind
    if (S.meta.list && L.job && jobFormat() !== L.job.format) return askBot();
    var looking = S.meta.list && (!L.job || L.job.status !== "done");
    var refusal = dest !== "new" && !S.meta.list ? firetable.utilities.formatRefusal(dest, S.meta.type) : "";
    var haveP = dest === "new" ? Promise.resolve(null)
      : haveCache.id === dest ? Promise.resolve(haveCache.have)
      : contents(dest).then(function (h) { haveCache = { id: dest, have: h }; return h; });
    haveP.then(function (have) {
      if (token !== S.token) return;
      var go = I.plan(S.songs, have, skip);
      draw();
      var gone = S.songs.filter(function (s) { return s.why; }).length;
      var skipped = S.songs.filter(function (s) { return s.skip === "Already there"; }).length;
      var repeats = S.songs.filter(function (s) { return s.skip === "Twice in this playlist"; }).length;
      var bits = [plural(go.length, "song") + " to import"];
      if (S.meta.list) {
        var missing = S.songs.filter(function (s) { return s.why === "Not found" || s.why === "Try later"; }).length;
        if (missing) bits.push(missing + " not found");
        var out = S.songs.filter(function (s) { return s.why === "Left out"; }).length;
        if (out) bits.push(out + " left out");
        gone = 0;
      }
      if (gone) bits.push(gone + " not available");
      if (skipped) bits.push(skipped + " already there");
      if (repeats) bits.push(plural(repeats, "repeat"));
      if (refusal) setStatus(refusal + " Choose another playlist or a new one.", "error");
      else if (looking && L.job) setStatus("Looking for the songs\u2026 " + L.job.n + " of " + S.songs.length);
      else if (!looking || go.length) setStatus(bits.join(" · "));
      var btn = el("im-go");
      btn.textContent = looking ? "Finding the songs\u2026" : "Import " + plural(go.length, "song");
      btn.disabled = looking || !!refusal || !go.length || (dest === "new" && !named.value.trim());
    });
  };
  I.refresh = function () { haveCache = { id: null, have: null }; refresh(); };

  var draw = function () {
    var ol = el("im-songs");
    var frag = document.createDocumentFragment();
    S.songs.forEach(function (s, i) {
      var li = document.createElement("li");
      li.className = "im-song" + (s.why || s.skip ? " is-out" : "");
      var num = document.createElement("span");
      num.className = "im-num";
      num.textContent = i + 1;
      var name = document.createElement("span");
      name.className = "im-songName";
      var sep = s.name.indexOf(" - ");
      var t = document.createElement("span");
      t.className = "im-title";
      t.textContent = sep > 0 ? s.name.slice(sep + 3) : s.name;
      name.appendChild(t);
      if (sep > 0) {
        var a = document.createElement("span");
        a.className = "im-artist";
        a.textContent = s.name.slice(0, sep);
        name.appendChild(a);
      }
      li.appendChild(num);
      li.appendChild(name);
      if (S.meta && S.meta.list && !s.skip) {
        li.appendChild(listTag(s, i));
      } else if (s.why || s.skip) {
        var tag = document.createElement("span");
        tag.className = "im-tag" + (s.why ? " is-gone" : "");
        tag.textContent = s.why ? "Not available" : s.skip;
        if (s.why && s.why !== "Not available") tag.title = s.why;
        li.appendChild(tag);
      }
      frag.appendChild(li);
    });
    ol.innerHTML = "";
    ol.appendChild(frag);
  };

  // a list song's tag: what was found (a pick when there's more than one), or Not found
  var listTag = function (s, i) {
    var wrap = document.createElement("span");
    wrap.className = "im-found";
    if (s.state === "look") {
      wrap.innerHTML = '<span class="im-tag is-looking">Looking\u2026</span>';
      return wrap;
    }
    var picks = s.picks || [];
    if (!picks.length) {
      var tag = document.createElement("span");
      tag.className = "im-tag is-gone";
      tag.textContent = s.found === "later" ? "Try later" : "Not found";
      if (s.found === "later") tag.title = "The room's bot ran out of searches for today";
      wrap.appendChild(tag);
      var find = document.createElement("a");
      find.className = "im-findLink row-icon material-symbols-outlined";
      find.href = "https://music.youtube.com/search?q=" + encodeURIComponent(s.orig);
      find.target = "_blank";
      find.rel = "noopener";
      find.title = "Search for it on YouTube Music";
      find.setAttribute("aria-label", "Search for " + s.orig + " on YouTube Music");
      find.textContent = "search";
      wrap.appendChild(find);
      return wrap;
    }
    var sel = document.createElement("select");
    sel.className = "im-tag im-pick" + (s.pick < 0 ? " is-out" : "");
    sel.setAttribute("data-i", i);
    sel.setAttribute("aria-label", "Which version of " + s.orig);
    picks.forEach(function (p, k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = pickLabel(p, picks);
      sel.appendChild(o);
    });
    var none = document.createElement("option");
    none.value = -1;
    none.textContent = "Leave out";
    sel.appendChild(none);
    sel.value = String(s.pick);
    var p0 = picks[s.pick];
    if (p0) sel.title = (p0.artist ? p0.artist + " - " : "") + p0.title + (p0.plays ? " \u00b7 played here " + plural(p0.plays, "time") : "");
    wrap.appendChild(sel);
    return wrap;
  };

  var run = function () {
    if (!S.songs || !S.meta) return;
    var meta = S.meta;
    var dest = destVal();
    var name = dest === "new" ? el("im-newName").value.trim().slice(0, 100) : "";
    if (dest === "new" && !name) return;
    var btn = el("im-go");
    btn.disabled = true;
    setStatus("Importing…");
    I.importList(meta.id, name, meta.type, {
      dest: dest, position: el("im-pos").value, skipExisting: el("im-skip").checked, songs: S.songs
    }).then(function (r) {
      var listName = r.created ? name : firetable.utilities.listName(r.listID);
      var d = box();
      if (d && d.open) d.close();
      I.back();
      var extra = [];
      if (r.skipped) extra.push(r.skipped + " already there");
      if (r.repeats) extra.push(plural(r.repeats, "repeat"));
      if (r.unavailable) extra.push(r.unavailable + (meta.list ? " not found" : " not available"));
      firetable.ui.toast("Imported " + plural(r.added, "song") + " into “" + listName + "”" +
        (extra.length ? " (" + extra.join(", ") + " left out)" : "") + ".", "success", { actions: [
        { label: "Undo", fn: function () {
          I.undo(r).then(function () {
            firetable.ui.toast(r.created ? "Import undone: “" + listName + "” is gone." : "Import undone.");
          });
        } },
        { label: "Open", fn: function () {
          if (firetable.nav && firetable.nav.setView) firetable.nav.setView("playlists");
          $("#listpicker").val(r.listID).trigger("change");
        } }
      ] });
    }, function (err) {
      setStatus((err && err.message) || "That import didn't work. Nothing was added.", "error");
      btn.disabled = false;
    });
  };

  I.init = function () {
    if (!box()) return;
    // the source tabs: a playlist (YouTube, SoundCloud) or a list of songs
    $("#importSources .tab").on("click", function () {
      var list = this.id === "listimportchoice";
      el("importContent").hidden = list;
      el("im-listPane").hidden = !list;
      el("importTitle").textContent = list ? "Import a list of songs" : "Import a playlist";
      if (list) setTimeout(function () { el("im-listText").focus(); }, 0);
    });
    $("#im-listText").on("input", listInput);
    $("#im-listFile").on("change", function () {
      var file = this.files && this.files[0];
      this.value = "";
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { el("im-listCount").textContent = "That file is too big for a list of songs."; return; }
      var reader = new FileReader();
      reader.onload = function () {
        var songs = I.readSongs(String(reader.result || ""));
        el("im-listText").value = songs.map(function (s) { return (s.a ? s.a + " - " : "") + s.t + (s.d ? " (" + clock(s.d) + ")" : ""); }).join("\n");
        S.fileName = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
        listInput();
      };
      reader.readAsText(file);
    });
    $("#im-listFind").on("click", function () {
      var songs = listInput();
      if (!songs.length) return;
      I.showList(songs, S.fileName || "Imported songs");
    });
    $("#im-songs").on("change", ".im-pick", function () {
      var s = S.songs && S.songs[Number(this.getAttribute("data-i"))];
      if (!s) return;
      choose(s, Number(this.value));
      refresh();
    });
    box().addEventListener("close", stopJob);
    $("#im-back").on("click", I.back);
    $("#im-go").on("click", run);
    $('input[name="im-dest"]').on("change", function () {
      if (this.value === "have") el("im-destList").focus();
      refresh();
    });
    $("#im-destList").on("change", function () {
      document.querySelector('input[name="im-dest"][value="have"]').checked = true;
      refresh();
    });
    $("#im-skip, #im-pos").on("change", refresh);
    $("#im-newName").on("input", refresh).on("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); run(); } });
  };

  return I;
})();

// Old callers: importList(id, name, type) still makes a new playlist
firetable.actions.importList = function (id, name, type, opts) {
  return firetable.importer.importList(id, name, type, opts);
};
