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
    var refusal = dest !== "new" ? firetable.utilities.formatRefusal(dest, S.meta.type) : "";
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
      if (gone) bits.push(gone + " not available");
      if (skipped) bits.push(skipped + " already there");
      if (repeats) bits.push(plural(repeats, "repeat"));
      if (refusal) setStatus(refusal + " Choose another playlist or a new one.", "error");
      else setStatus(bits.join(" · "));
      var btn = el("im-go");
      btn.textContent = "Import " + plural(go.length, "song");
      btn.disabled = !!refusal || !go.length || (dest === "new" && !named.value.trim());
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
      if (s.why || s.skip) {
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
      if (r.unavailable) extra.push(r.unavailable + " not available");
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
