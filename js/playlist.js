/**
 * playlist.js — Queue and playlist management.
 *
 * Handles:
 * - Adding tracks to queue (queueTrack)
 * - Reordering via drag-and-drop (updateQueue, sortable)
 * - Shuffle, dedup, bump-to-top, move-to-bottom, delete
 * - Queue filtering (#queueFilter)
 * - Merge lists between playlists
 * - Queue from link (YouTube/SoundCloud URL drag-and-drop)
 * - SoundCloud API access via the site proxy (scSearch, resolveSCLink, scPlaylist)
 * - Import playlist from YouTube/SoundCloud (importList)
 * - List CRUD (create, delete, switch)
 * - playlistChanged event handler
 * - Tag editing (editTagsPrompt)
 */

firetable.actions = firetable.actions || {};

// ─── Switch View List ─────────────────────────────────────────────────────────
// Rebind the local queue listener to a different playlist so the queue panel
// shows and edits that playlist, WITHOUT saving to Firebase (does not change
// which playlist the DJ bot draws from).

firetable.actions.switchViewList = function (listID) {
  ftapi.queueRef.off("value", ftapi.queueBind);
  ftapi.queueRef = ftapi.lookup.listRef(listID);
  ftapi.queueBind = ftapi.queueRef.on('value', function (dataSnapshot) {
    var data = dataSnapshot.val();
    if (!data) data = {};
    ftapi.queue = data;
    ftapi.events.emit("playlistChanged", data, listID);
  });
};

// ─── Panel switching ──────────────────────────────────────────────────────────

/** Show the playlist itself (and its filter); hide the "add a track" search. */
firetable.ui.showQueuePanel = function () {
  $("#mainqueuestuff, #filterMachine").css("display", "block");
  $("#searchMachine, #addbox").css("display", "none");
  $("#cancelqsearch").hide();
  $("#qControlButtons").show();
};

/** Show the "add a track" search in place of the playlist. */
firetable.ui.showSearchPanel = function () {
  $("#mainqueuestuff, #filterMachine").css("display", "none");
  $("#searchMachine").css("display", "block");
  $("#addbox").css("display", "flex");
  $("#cancelqsearch").show();
  $("#qControlButtons").hide();
  $("#plmanager").css("display", "none");
};

// ─── Queue Track ─────────────────────────────────────────────────────────────

/**
 * Add a track to the current playlist queue.
 * If a search preview is active, cancels it and resumes the room song.
 *
 * @param {string} cid      - Content ID (YouTube video ID or SoundCloud track ID)
 * @param {string} name     - Track display name "Artist - Title"
 * @param {number} type     - MEDIA_YOUTUBE (1) or MEDIA_SOUNDCLOUD (2)
 * @param {boolean} [tobottom] - If true, don't bump to top of queue
 * @param {{img: string, url: string}} [extra] - Artwork / page URL to save with it
 */
firetable.actions.queueTrack = function (cid, name, type, tobottom, extra) {
  extra = extra || {};
  var info = { type: type, name: name, cid: cid, img: extra.img, url: extra.url };

  // Visual feedback: checkmark on the queue button
  $("#apv" + type + cid).find(".material-symbols-filled").text("check");
  $("#apv" + type + cid).css("color", firetable.orange);
  $("#apv" + type + cid).css("pointer-events", "none");
  setTimeout(function () {
    $("#apv" + type + cid).find(".material-symbols-filled").text("playlist_add");
    $("#apv" + type + cid).removeAttr("style");
  }, 3000);

  if (tobottom) {
    ftapi.actions.addToList(type, name, cid, false, null, extra.img, extra.url);
  } else {
    // Added and moved to the top in one atomic step
    ftapi.actions.addTrackToTop(ftapi.queueRef, info, firetable.preview, function (changePV) { if (changePV) firetable.preview = changePV; });
  }

  // Cancel any active search preview
  firetable.utilities.cancelSearchPreview();

  // Switch view back to queue
  firetable.ui.showQueuePanel();
};

// ─── Queue Reorder (Sortable) ────────────────────────────────────────────────

/**
 * Called when the user drags a song to a new position in the queue.
 * Reads the new DOM order and pushes it to the server.
 */
firetable.actions.updateQueue = function () {
  var arr = $('#mainqueue > div').map(function () {
    return this.id.slice(5);
  }).get();
  // Rows not on screen yet (long lists render in chunks) keep their order
  // after the dragged ones; reorderList handles that.
  ftapi.actions.reorderList(arr, firetable.preview, function (changePV) {
    if (changePV) firetable.preview = changePV;
  });
};

/** Shuffle the current playlist on the server. */
firetable.actions.shuffleQueue = function () {
  ftapi.actions.shuffleList(firetable.preview, function (changePV) {
    if (changePV) firetable.preview = changePV;
  });
};

/** Remove duplicate tracks from the current playlist. */
firetable.actions.removeDupesFromQueue = function (listID) {
  ftapi.actions.removeDuplicatesFromList(listID, firetable.actions.mergeFinished);
};

/** Show the merge result once the database has confirmed the writes. */
firetable.actions.mergeFinished = function (err) {
  $("#mergeHappening").hide();
  if (err) {
    firetable.ui.toast("Sorry, the merge could not be saved. Please try again.", "error");
    $("#mergeSetup").show();
    return;
  }
  $("#mergeCompleted").show();
};

/**
 * Move a track to the top of the queue.
 * @param {string} songid - Track key in the playlist
 */
firetable.actions.bumpSongInQueue = function (songid, cid) {
  ftapi.actions.moveTrackToTop(songid, ftapi.queueRef, firetable.preview, function (changePV) {
    if (changePV) firetable.preview = changePV;
  }, cid);
};

/**
 * Delete a track from the current playlist.
 * @param {string} id - Track key
 */
firetable.actions.deleteSong = function (id) {
  ftapi.actions.deleteTrack(id);
};

/**
 * Delete a track and run a queue search using the track's tags.
 * @param {string} id        - Track key
 * @param {string} tags      - Track tags (Artist - Song ...)
 * @param {number|string} type - MEDIA_YOUTUBE or MEDIA_SOUNDCLOUD
 */
firetable.actions.deleteSongAndSearch = function (id, tags, type) {
  firetable.actions.deleteSong(id);
  var query = String(tags || "").trim();
  if (!query) return;

  // Switch to Add to Playlist/search view before filling and submitting.
  firetable.ui.showSearchPanel();

  if (String(type) === String(MEDIA_SOUNDCLOUD)) {
    $("#scsearchSelect").trigger("click");
  } else {
    $("#ytsearchSelect").trigger("click");
  }

  $("#qsearch").focus().val(query);
  var enterEvent = $.Event("keyup");
  enterEvent.which = 13;
  enterEvent.keyCode = 13;
  $("#qsearch").trigger(enterEvent);
};

/**
 * Show the delete-track confirmation popover.
 * @param {string} songid   - Track key
 * @param {string} tags     - Track tags
 * @param {number|string} type - MEDIA_YOUTUBE or MEDIA_SOUNDCLOUD
 * @param {HTMLElement} anchorEl - Element to anchor the popover to
 */
firetable.actions.deleteSongPrompt = function (songid, tags, type, anchorEl) {
  var popoverEl = document.getElementById('deleteSongPopover');
  if (!popoverEl) {
    firetable.actions.deleteSong(songid);
    return;
  }

  if (popoverEl.matches(':popover-open')) popoverEl.hidePopover();
  $('.pvbar.deleting').removeClass('deleting');

  var $pvbar = $('.pvbar[data-key="' + songid + '"]').first();
  $pvbar.addClass('deleting');
  firetable.deletingPvbar = $pvbar;

  var $popover = $(popoverEl);
  $popover.data('songid', songid);
  $popover.data('tags', tags || '');
  $popover.data('type', type);

  popoverEl.style.visibility = 'hidden';
  popoverEl.showPopover();
  firetable.ui.positionPopover(anchorEl || $pvbar.find('.deletesong')[0], popoverEl, document.getElementById('deleteSongArrow'), 'bottom').then(function () {
    var primaryBtn = popoverEl.querySelector('.deleteSongConfirm');
    if (primaryBtn) primaryBtn.focus();
  });
};

/**
 * Show the shuffle confirmation popover.
 * @param {HTMLElement} anchorEl - Element to anchor the popover to
 */
firetable.actions.shuffleQueuePrompt = function (anchorEl) {
  var popoverEl = document.getElementById('shuffleQueuePopover');
  if (!popoverEl) {
    firetable.actions.shuffleQueue();
    return;
  }

  if (popoverEl.matches(':popover-open')) {
    popoverEl.hidePopover();
    return;
  }

  $('#shuffleQueue').addClass('on');
  popoverEl.style.visibility = 'hidden';
  popoverEl.showPopover();
  firetable.ui.positionPopover(anchorEl || document.getElementById('shuffleQueue'), popoverEl, document.getElementById('shuffleQueueArrow'), 'bottom').then(function () {
    var primaryBtn = popoverEl.querySelector('.shuffleQueueConfirm');
    if (primaryBtn) primaryBtn.focus();
  });
};

/**
 * Parse a queue track duration into seconds.
 * Accepts numeric seconds/ms or strings like "3:45" and "1:02:03".
 * @param {number|string} rawDuration - raw duration value from queue payload
 * @returns {number} whole seconds (0 when unknown)
 */
firetable.actions.parseTrackDurationSeconds = function (rawDuration) {
  if (rawDuration === null || typeof rawDuration === "undefined") return 0;

  if (typeof rawDuration === "number" && isFinite(rawDuration)) {
    if (rawDuration <= 0) return 0;
    // Large values are likely milliseconds.
    if (rawDuration > 10000) return Math.max(0, Math.round(rawDuration / 1000));
    return Math.round(rawDuration);
  }

  var str = String(rawDuration).trim();
  if (!str) return 0;

  if (/^\d+$/.test(str)) {
    return firetable.actions.parseTrackDurationSeconds(Number(str));
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    var bits = str.split(':').map(function (part) { return Number(part); });
    if (bits.length === 2) return (bits[0] * 60) + bits[1];
    return (bits[0] * 3600) + (bits[1] * 60) + bits[2];
  }

  return 0;
};

/**
 * Format seconds into m:ss or h:mm:ss.
 * @param {number} seconds - integer seconds
 * @returns {string} formatted duration text
 */
firetable.actions.formatTrackDuration = function (seconds) {
  var total = Math.max(0, Math.floor(Number(seconds) || 0));
  var hrs = Math.floor(total / 3600);
  var mins = Math.floor((total % 3600) / 60);
  var secs = total % 60;

  if (hrs > 0) {
    return hrs + ":" + String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }
  return mins + ":" + String(secs).padStart(2, "0");
};


/** True when the text filter or either filter checkbox is in use. */
firetable.actions.queueFilterActive = function () {
  return !!(String($("#queueFilter").val() || "").trim() ||
    $("#queueFilterRemixOnly").is(":checked") ||
    $("#queueFilterBrokenOnly").is(":checked"));
};

/**
 * Show only the queue rows that match the filter text and checkboxes.
 * Rows are hidden with a class, and only rows whose state changes are
 * touched, so clearing the filter on a list of thousands of tracks is one
 * style pass rather than one per row.
 * @param {string} [val]  - Filter text (empty string shows all; omitted reads #queueFilter)
 * @param {Element[]} [rows] - Only filter these rows (newly rendered ones); defaults to every row
 */
firetable.actions.filterQueue = function (val, rows) {
  var textFilter = String(typeof val === "string" ? val : $("#queueFilter").val() || "").toLowerCase().trim();
  var remixOnly = $("#queueFilterRemixOnly").is(":checked");
  var brokenOnly = $("#queueFilterBrokenOnly").is(":checked");
  var container = document.getElementById("mainqueue");
  if (!container) return;
  var list = rows || container.querySelectorAll(".pvbar");

  // Decide every row first, then write, so the browser never recalculates
  // styles between rows.
  var toHide = [], toShow = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var tags = row.getAttribute("data-tags") || "";
    var show = (!textFilter || tags.toLowerCase().indexOf(textFilter) !== -1) &&
      (!remixOnly || /\([^)]*\)/.test(tags)) &&
      (!brokenOnly || row.getAttribute("data-broken") === "1");
    var hidden = row.classList.contains("ft-filtered");
    if (show && hidden) toShow.push(row);
    else if (!show && !hidden) toHide.push(row);
  }
  for (i = 0; i < toShow.length; i++) toShow[i].classList.remove("ft-filtered");
  for (i = 0; i < toHide.length; i++) toHide[i].classList.add("ft-filtered");

  var anyRows = container.querySelector(".pvbar") !== null;
  var anyShown = container.querySelector(".pvbar:not(.ft-filtered)") !== null;
  container.classList.toggle("overFiltered", anyRows && !anyShown);
};

// ─── Merge / Copy Lists ──────────────────────────────────────────────────────

/**
 * Merge (copy) tracks from one playlist into another.
 * If source === dest, deduplicates instead.
 * If dest === -1, creates a new playlist copy.
 * @param {string} source     - Source list ID
 * @param {string} dest       - Destination list ID (or -1 for new)
 * @param {string} sourceName - Display name of the source list
 */
firetable.actions.mergeLists = function (source, dest, sourceName) {
  if (source === dest) {
    firetable.actions.removeDupesFromQueue(source);
    return;
  }
  if (dest == -1) {
    var newname = firetable.utilities.format_date(Date.now()) + " Copy of " + sourceName;
    dest = ftapi.actions.createList(newname);
    firetable.utilities.addPlaylistToPickers(dest, newname);
  }
  ftapi.actions.mergeLists(source, dest, firetable.actions.mergeFinished);
};

// ─── Queue From Link (Drag & Drop URLs) ─────────────────────────────────────

/**
 * Parse a YouTube or SoundCloud URL and add the track to the queue.
 * Called by the LinkGrabber when a URL is dragged onto the queue area.
 * @param {string} link - Full URL
 */
firetable.actions.extractYoutubeVideoId = function (link) {
  var url = String(link || "").trim();
  if (!url) return "";

  try {
    var parsed = new URL(url, window.location.href);
    var host = String(parsed.hostname || "").toLowerCase();

    if (host.indexOf("youtu.be") !== -1) {
      return parsed.pathname.replace(/^\/+/, "").split("/")[0];
    }

    if (host.indexOf("youtube.com") !== -1 || host.indexOf("youtube-nocookie.com") !== -1) {
      var vParam = parsed.searchParams.get("v");
      if (vParam) return vParam;

      var parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" && parts[1]) return parts[1];
      if (parts[0] === "embed" && parts[1]) return parts[1];
      if (parts[0] === "watch" && parts[1]) return parts[1];
    }
  } catch (err) {
    firetable.debug && console.log("youtube id parse failed:", err);
  }

  var fallback = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/i);
  return fallback ? fallback[1] : "";
};

/**
 * Normalize dropped URLs from browser drag payloads.
 * Needed because some drags omit protocol (e.g. "www.youtube.com/..." or "//...").
 */
firetable.actions.normalizeQueueLink = function (link) {
  var out = String(link || "").trim();
  out = out.replace(/^["'<>\s]+|["'<>\s]+$/g, "");
  if (/^\/\//.test(out)) out = "https:" + out;
  if (!/^https?:\/\//i.test(out) && /^(www\.|(?:m\.)?youtube\.com\/|youtu\.be\/|soundcloud\.com\/)/i.test(out)) {
    out = "https://" + out;
  }
  return out;
};

/**
 * Queue YouTube by id with layered metadata fallbacks.
 * Why: the YouTube Data API can be unavailable or hang in some sessions; oEmbed keeps
 * artist/title labels working, and final ID fallback avoids silent no-op.
 */
firetable.actions.queueYoutubeWithFallback = function (youtubeId) {
  var settled = false;

  var queueFromTitle = function (id, rawTitle, rawArtist) {
    var artist = String(rawArtist || "").replace(" - Topic", "");
    var title = firetable.utilities.decodeEntities(rawTitle || ("YouTube - " + id));
    var parsed = firetable.utilities.parseArtistTitle(title, firetable.utilities.decodeEntities(artist));
    firetable.actions.queueTrack(id, parsed.artist + " - " + parsed.title, MEDIA_YOUTUBE);
  };

  var queueFallback = function (reason) {
    if (settled) return;
    settled = true;
    firetable.debug && console.log("queueFromLink yt fallback:", reason);
    firetable.actions.queueTrack(youtubeId, "YouTube - " + youtubeId, MEDIA_YOUTUBE);
  };

  var queueFromOEmbed = function (reason) {
    $.ajax({
      url: "https://www.youtube.com/oembed",
      type: "GET",
      dataType: "json",
      data: { url: "https://www.youtube.com/watch?v=" + youtubeId, format: "json" },
      timeout: 5000,
      success: function (res) {
        if (settled) return;
        settled = true;
        queueFromTitle(youtubeId, res && res.title, res && res.author_name);
      },
      error: function () {
        queueFallback(reason + " + oembed error");
      }
    });
  };

  var queueFromResponse = function (response) {
    if (settled) return;
    var items = response && (response.items || (response.result && response.result.items));
    if (items && items.length) {
      settled = true;
      var item = items[0];
      queueFromTitle(item.id || youtubeId, item.snippet.title, item.snippet.channelTitle);
      return;
    }
    queueFromOEmbed("no items");
  };

  // If YouTube API hangs, still queue via oEmbed/title fallback.
  setTimeout(function () {
    queueFromOEmbed("metadata timeout");
  }, 4000);

  if (typeof ytAPI === "function") {
    ytAPI("videos", { id: youtubeId, part: "snippet", maxResults: 1 }, queueFromResponse);
    return;
  }

  queueFromOEmbed("no youtube api available");
};

firetable.actions.queueFromLink = function (link) {
  var incomingLink = firetable.actions.normalizeQueueLink(link);
  if (!incomingLink) return;

  var youtubeId = firetable.actions.extractYoutubeVideoId(incomingLink);
  if (youtubeId) {
    firetable.debug && console.log("yt");
    firetable.actions.queueYoutubeWithFallback(youtubeId);
  } else if (incomingLink.match(/soundcloud.com/i)) {
    firetable.debug && console.log("sc");
    firetable.actions.resolveSCLink(incomingLink, function (item) {
      if (item && item.kind === "track") {
        var parsed = firetable.utilities.parseArtistTitle(item.title, item.user.username);
        firetable.actions.queueTrack(item.id, parsed.artist + " - " + parsed.title, MEDIA_SOUNDCLOUD, false,
          firetable.utilities.soundCloudExtras(item));
      } else {
        firetable.actions.localChatResponse("That SoundCloud link isn't a track. Use Import to add a whole playlist.");
      }
    }, function (err) {
      firetable.actions.localChatResponse("Couldn't add that SoundCloud link: " + err.message);
    });
  }
};

// ─── SoundCloud API ──────────────────────────────────────────────────────────
//
// SoundCloud only answers OAuth-signed requests, so the browser can't call its
// API directly (the old SC.get() SDK calls now fail with 401). Everything goes
// through this site's own proxy (api/soundcloud.php) when it's set up. Link
// lookups and playlist imports fall back to the legacy thompsn.com proxy,
// which can't do keyword search.

/** True once the site proxy turns out to be missing or unconfigured. */
firetable.scProxyDown = false;

/** Build a rejected jQuery promise carrying {status, message, unavailable}. */
firetable.utilities.scReject = function (status, message, unavailable) {
  return $.Deferred().reject({ status: status, message: message, unavailable: !!unavailable }).promise();
};

/** Call api/soundcloud.php. Resolves with its JSON, rejects with an error object. */
firetable.actions.scProxy = function (params) {
  if (firetable.scProxyDown) return firetable.utilities.scReject(501, "SoundCloud proxy unavailable", true);
  return $.ajax({ url: SC_API_PROXY_URL, data: params, type: "GET", dataType: "json", timeout: 20000 })
    .then(null, function (xhr) {
      var apiMsg = xhr.responseJSON && xhr.responseJSON.error;
      // 404 / 405 / 501 / non-JSON (no PHP on this host) mean the proxy isn't
      // usable: stop trying it this session and fall back where possible.
      var down = xhr.status === 404 || xhr.status === 405 || xhr.status === 501 ||
        (!apiMsg && xhr.status !== 0 && xhr.status !== 429);
      if (down) {
        firetable.scProxyDown = true;
        console.warn("SoundCloud proxy (" + SC_API_PROXY_URL + ") unavailable:", apiMsg || (xhr.status + " " + xhr.statusText),
          "- see api/soundcloud-config.php.example to enable keyword search.");
      }
      return firetable.utilities.scReject(xhr.status, apiMsg || "Couldn't reach SoundCloud.", down || xhr.status === 0);
    });
};

/** GET the legacy proxy; it wraps results as {response: item} and returns {} when nothing matches. */
firetable.actions.scLegacy = function (url) {
  return $.ajax({ url: url, type: "GET", dataType: "json", timeout: 20000 }).then(
    function (res) {
      var item = res && res.response;
      return (item && item.id) ? item : firetable.utilities.scReject(404, "Not found on SoundCloud (it may be private or deleted).");
    },
    function (xhr) {
      return firetable.utilities.scReject(xhr.status, "Couldn't reach SoundCloud.");
    }
  );
};

/** Does this text look like a SoundCloud link? (soundcloud.com, www., m., on.) */
firetable.utilities.isSCLink = function (txt) {
  return /^\s*(?:https?:\/\/)?(?:(?:www|m|on)\.)?soundcloud\.com\/\S+/i.test(String(txt || ""));
};

/**
 * Keyword search.
 * @param {string} type - 'tracks' or 'playlists'
 * @param {string} q    - Search text
 * @returns {Promise<Array>} Matching tracks/playlists
 */
firetable.actions.scSearch = function (type, q) {
  return firetable.actions.scProxy({ action: "search", type: type, q: q, limit: SEARCH_MAX_RESULTS })
    .then(function (res) { return (res && res.collection) || []; }, function (err) {
      if (err.unavailable) {
        err.message = "SoundCloud keyword search isn't available right now. Paste a soundcloud.com link instead.";
      }
      return $.Deferred().reject(err);
    });
};

/**
 * Resolve a SoundCloud URL to track/playlist/user metadata.
 * @param {string}   link       - SoundCloud URL
 * @param {Function} [callback] - Called with the resolved item
 * @param {Function} [onError]  - Called with {status, message} on failure
 * @returns {Promise<Object>}
 */
firetable.actions.resolveSCLink = function (link, callback, onError) {
  var url = String(link || "").trim();
  var legacy = function () {
    var m = url.match(/^(?:https?:\/\/)?(?:(?:www|m)\.)?soundcloud\.com\/([^?#\s]+)/i);
    if (!m) {
      return firetable.utilities.scReject(400, "Short on.soundcloud.com links can't be looked up right now. Open the link and paste the full soundcloud.com address.");
    }
    // The legacy resolver takes the path as ?q=…, slashes intact.
    var path = m[1].replace(/\/+$/, "").split("/").map(function (seg) {
      try { seg = decodeURIComponent(seg); } catch (e) { /* keep as typed */ }
      return encodeURIComponent(seg);
    }).join("/");
    return firetable.actions.scLegacy(SC_RESOLVE_URL + "?q=" + path);
  };
  var p = firetable.actions.scProxy({ action: "resolve", url: url })
    .then(function (res) { return res.item; }, function (err) {
      return err.unavailable ? legacy() : $.Deferred().reject(err);
    });
  p.then(function (item) { if (callback) callback(item); }, function (err) {
    console.warn("SoundCloud resolve failed:", err.message);
    if (onError) onError(err);
  });
  return p;
};

/**
 * Fetch a playlist with its tracks (for import).
 * @param {string|number} id
 * @returns {Promise<Object>} Playlist with a .tracks array
 */
firetable.actions.scPlaylist = function (id) {
  return firetable.actions.scProxy({ action: "playlist", id: id })
    .then(function (res) { return res.item; }, function (err) {
      return err.unavailable
        ? firetable.actions.scLegacy(SC_PROXY_URL + "?type=playlists&q=" + encodeURIComponent(id))
        : $.Deferred().reject(err);
    });
};

// ─── Playlist Import ─────────────────────────────────────────────────────────

/**
 * Import a full playlist from YouTube or SoundCloud into a new local list.
 * YouTube playlists are paginated (50 items per page).
 * @param {string} id   - Playlist/set ID
 * @param {string} name - Display name for the new local list
 * @param {number} type - MEDIA_YOUTUBE (1) or MEDIA_SOUNDCLOUD (2)
 */
firetable.actions.importList = function (id, name, type) {
  document.querySelectorAll("dialog[open]").forEach(function (d) { d.close(); });
  $("#importResults").html("");
  $("#plMachine").val("");

  if (type === MEDIA_YOUTUBE) {
    var finalList = [];

    var fetchPage = function (pageToken) {
      var params = {
        playlistId: id,
        maxResults: IMPORT_PAGE_SIZE,
        part: "snippet"
      };
      if (pageToken) params.pageToken = pageToken;

      ytAPI('playlistItems', params, function (response) {
        if (response.items && response.items.length) {
          for (var idx = 0; idx < response.items.length; idx++) {
            finalList.push(response.items[idx]);
          }
        }
        if (response.nextPageToken) {
          fetchPage(response.nextPageToken);
        } else {
          // All pages fetched — create the list
          firetable.debug && console.log(finalList);
          var listid = ftapi.actions.createList(name);
          firetable.utilities.addPlaylistToPickers(listid, name);
          for (var i = 0; i < finalList.length; i++) {
            var goodTitle = firetable.utilities.decodeEntities(finalList[i].snippet.title);
            if (goodTitle !== "Private video" && goodTitle !== "Deleted video") {
              ftapi.actions.addToList(MEDIA_YOUTUBE, goodTitle, finalList[i].snippet.resourceId.videoId, listid);
            }
          }
        }
      });
    };
    fetchPage(); // start with first page

  } else if (type === MEDIA_SOUNDCLOUD) {
    firetable.actions.scPlaylist(id).then(function (listinfo) {
      var tracks = (listinfo && listinfo.tracks) || [];
      firetable.debug && console.log('sc tracks:', tracks);
      var listid = ftapi.actions.createList(name);
      firetable.utilities.addPlaylistToPickers(listid, name);
      for (var i = 0; i < tracks.length; i++) {
        var goodTitle;
        if (tracks[i].title) {
          var parsed = firetable.utilities.parseArtistTitle(tracks[i].title, (tracks[i].user && tracks[i].user.username) || "");
          goodTitle = parsed.artist + " - " + parsed.title;
        } else {
          goodTitle = "Unknown";
        }
        var extras = firetable.utilities.soundCloudExtras(tracks[i]);
        ftapi.actions.addToList(MEDIA_SOUNDCLOUD, goodTitle, tracks[i].id, listid, null, extras.img, extras.url);
      }
      firetable.actions.localChatResponse("Imported " + firetable.utilities.pluralize(tracks.length, "song") + " from SoundCloud into \"" + name + "\".");
    }, function (err) {
      firetable.actions.localChatResponse("SoundCloud import failed: " + err.message);
    });
  }
};

// ─── Tag Editing ─────────────────────────────────────────────────────────────

/**
 * Show the tag editor prompt on a history item.
 * @param {string} songid - data-key of the history item
 * @param {string} tag    - Current "Artist - Title" string
 */
firetable.actions.editTagsPrompt = function (songid, tag, anchorEl) {
  var popoverEl = document.getElementById('tagEditorPopover');
  if (popoverEl.matches(':popover-open')) popoverEl.hidePopover();
  firetable.tagEditNowPlaying = null;
  $('.pvbar.editing').removeClass('editing');
  var $pvbar = $('.pvbar[data-key="' + songid + '"]').first();
  $pvbar.addClass('editing');
  firetable.editingPvbar = $pvbar;
  $(popoverEl).find('.tagMachine').val(tag);
  popoverEl.style.visibility = 'hidden';
  popoverEl.showPopover();
  firetable.ui.positionPopover(anchorEl || $pvbar.find('.edittags')[0], popoverEl, document.getElementById('tagEditorArrow'), 'bottom').then(function () {
    $(popoverEl).find('.tagMachine')[0].focus();
  });
  firetable.debug && console.log('edit tags song id:', songid);
};

// ─── Queue item HTML builder ─────────────────────────────────────────────────

function buildQueueItemHTML(key, track, isPreview) {
  // Names are plain text; decode ones older code saved HTML-escaped
  var trackName = firetable.utilities.decodeEntities(track.name || "Unknown");
  var safeTrackName = firetable.utilities.htmlEscape(trackName);

  var trackSeconds = firetable.actions.parseTrackDurationSeconds(
    track.duration || track.length || track.dur || track.time ||
    track.seconds || track.msecs || track.ms || 0
  );
  var durationHtml = trackSeconds > 0
    ? '<span class="trackDuration">' + firetable.actions.formatTrackDuration(trackSeconds) + '</span>'
    : '';

  var isYT = String(track.type) === String(MEDIA_YOUTUBE);
  var artUrl = isYT
    ? 'https://i.ytimg.com/vi/' + track.cid + '/mqdefault.jpg'
    : (track.img || (firetable.imgCache && firetable.imgCache[track.cid]) || '');
  if (!artUrl && ftconfigs.defaultAlbumArtUrl) artUrl = ftconfigs.defaultAlbumArtUrl;
  var artStyle = artUrl ? ' style="background-image:url(' + firetable.utilities.htmlEscape(artUrl) + ')"' : '';
  var artClass = artUrl ? 'q-art' : 'q-art no-art';

  var trackUrl = firetable.utilities.htmlEscape(firetable.utilities.trackPageUrl(track));
  var platform = isYT ? 'YouTube' : 'SoundCloud';

  var flagHtml = '';
  if (track.flagged) {
    var flagLabel = 'broken', flagIcon = 'warning';
    if      (track.flagged.code === 2 || track.flagged.code === 5) { flagLabel = 'unavailable'; }
    else if (track.flagged.code === 3)  { flagLabel = 'blocked in the US'; }
    else if (track.flagged.code === 6)  { flagLabel = 'not embeddable'; }
    else if (track.flagged.code === 7)  { flagLabel = 'age restricted'; }
    else if (track.flagged.code === 8)  { flagLabel = 'broken (manual)'; }
    else if (track.flagged.code === 9)  { flagLabel = 'low audio quality'; flagIcon = 'disc_full'; }
    else if (track.flagged.code === 10) { flagLabel = 'offtheme'; flagIcon = 'flag'; }
    var flagTitle = firetable.utilities.htmlEscape(
      'Flagged as ' + flagLabel + ' on ' + firetable.utilities.format_date(track.flagged.date) + '. Click to remove flag.'
    );
    flagHtml = '<button type="button" class="track-warning" title="' + flagTitle + '" aria-label="' + flagTitle + '"><span class="material-symbols-filled" aria-hidden="true"> ' + flagIcon + ' </span></button>';
  }

  return (
    '<div class="pvbar' + (isPreview ? ' previewing' : '') + '" id="pvbar' + key + '"' +
    ' data-key="' + key + '" data-type="' + track.type + '"' +
    ' data-cid="' + firetable.utilities.htmlEscape(String(track.cid)) + '"' +
    ' data-tags="' + safeTrackName + '" data-broken="' + (track.flagged ? '1' : '0') + '"' +
    ' data-track-seconds="' + (trackSeconds || '') + '">' +
    '<div class="pvbarWrap">' +
    '<div class="' + artClass + '"' + artStyle + '></div>' +
    '<button id="pv' + key + '" class="material-symbols-filled previewicon">' + (isPreview ? '&#xE034;' : '&#xE037;') + '</button>' +
    (track.flagged ? flagHtml : '<span class="track-warning"></span>') +
    '<div class="listwords">' + safeTrackName + durationHtml + '</div>' +
    // Order matches Recent / Fresh: move actions, link, add, destructive last
    '<button type="button" class="material-symbols-outlined row-icon bumpsongs" title="Send to top" aria-label="Send to top">vertical_align_top</button>' +
    '<button type="button" class="material-symbols-outlined row-icon bottomsongs" title="Send to bottom" aria-label="Send to bottom">vertical_align_bottom</button>' +
    '<button type="button" class="material-symbols-outlined row-icon closeeditor" title="Close tags editor" aria-label="Close tags editor">close</button>' +
    '<a class="row-icon tracklink-btn" target="_blank" rel="noopener" href="' + trackUrl + '" title="Open on ' + platform + '" aria-label="Open on ' + platform + '">' + (isYT ? YT_LOGO_SVG : SC_LOGO_SVG) + '</a>' +
    '<button type="button" class="material-symbols-outlined row-icon histeal" title="Add to playlist" aria-label="Add to playlist">playlist_add</button>' +
    '<button type="button" class="material-symbols-outlined row-icon deletesong" title="Delete track" aria-label="Delete track">delete</button>' +
    '<button type="button" class="material-symbols-outlined row-icon row-more" title="More" aria-label="More track options" aria-haspopup="menu" aria-expanded="false">more_vert</button>' +
    '</div></div>'
  );
}

// ─── Playlist Event Binding ──────────────────────────────────────────────────

/**
 * Set up the playlistChanged event handler and queue-related UI bindings.
 * Called once from firetable.ui.init().
 */
/** Track count (and flagged count) next to the playlist name (#210). */
firetable.ui.renderListCount = function (tracks) {
  var n = 0, flagged = 0;
  Object.keys(tracks || {}).forEach(function (k) {
    if (!tracks[k]) return;
    n++;
    if (tracks[k].flagged) flagged++;
  });
  var label = n.toLocaleString() + (n === 1 ? " track" : " tracks") + (flagged ? ", " + flagged + " flagged" : "");
  $("#listCount").prop("hidden", false).attr({ title: label, "aria-label": label })
    .text(n.toLocaleString())
    .toggleClass("has-flagged", flagged > 0);
};

firetable.ui.setupPlaylistEvents = function () {

  // ── Sortable drag-and-drop queue ──
  $('#mainqueue').sortable({
    start: function (event, ui) {
      ui.item.data('start_pos', ui.item.index());
    },
    update: function () {
      firetable.debug && console.log("UPDATE");
      firetable.actions.updateQueue();
    }
  });

  // ── Delegated event handlers — set up once, work for all current and future items ──
  $('#mainqueue')
    .on('click', '.previewicon', function () {
      var $p = $(this).closest('.pvbar');
      firetable.actions.pview($p.attr('data-key'), false, $p.attr('data-type'));
    })
    .on('click', '.bumpsongs', function () {
      var $p = $(this).closest('.pvbar');
      firetable.actions.bumpSongInQueue($p.attr('data-key'), $p.attr('data-cid'));
    })
    .on('click', '.bottomsongs', function () {
      var $p = $(this).closest('.pvbar');
      var oldID = $p.attr('data-key');
      ftapi.actions.moveTrackToBottom(oldID, function (newID) {
        if (firetable.preview && firetable.preview === oldID) {
          firetable.preview = newID;
          $('#pv' + newID).html('&#xE034;');
        }
      }, $p.attr('data-cid'));
    })
    .on('click', '.track-warning', function () {
      var $p = $(this).closest('.pvbar');
      ftapi.actions.unflagTrack($p.attr('data-key'));
      $p.attr('data-broken', '0');
      $(this).replaceWith('<span class="track-warning"></span>');
    })
    .on('click', '.deletesong', function () {
      var popoverEl = document.getElementById('deleteSongPopover');
      var $p = $(this).closest('.pvbar');
      if (popoverEl && popoverEl.matches(':popover-open') && firetable.deletingPvbar && firetable.deletingPvbar.is($p)) {
        popoverEl.hidePopover();
        return;
      }
      firetable.actions.deleteSongPrompt($p.attr('data-key'), $p.attr('data-tags') || $p.find('.listwords').text(), $p.attr('data-type'), this);
    })
    .on('click', '.edittags', function () {
      var popoverEl = document.getElementById('tagEditorPopover');
      var $p = $(this).closest('.pvbar');
      if (popoverEl.matches(':popover-open') && firetable.editingPvbar && firetable.editingPvbar.is($p)) {
        popoverEl.hidePopover();
      } else {
        firetable.actions.editTagsPrompt($p.attr('data-key'), $p.attr('data-tags') || $p.find('.listwords').text(), this);
      }
    })
    .on('click', '.closeeditor', function () {
      document.getElementById('tagEditorPopover').hidePopover();
    })
    .on('click', '.histeal', function () {
      firetable.actions.openStealPicker($(this), queueRowTarget($(this).closest('.pvbar')));
    })
    .on('click', '.row-more', function () {
      openTrackMenu(this);
    });

  /** Track info used by the "add to playlist" picker for a playlist row. */
  function queueRowTarget($p) {
    var track = (firetable.queue && firetable.queue[$p.attr('data-key')]) || {};
    return {
      cid: $p.attr('data-cid'),
      type: $p.attr('data-type'),
      title: $p.attr('data-tags') || $p.find('.listwords').text(),
      img: track.img || '',
      url: track.url || ''
    };
  }

  // ── Narrow rows: ⋮ menu (Send to bottom / Add to playlist / Open / Delete) ──
  var trackMenuEl = document.getElementById('trackMenuPopover');

  function openTrackMenu(btn) {
    var $p = $(btn).closest('.pvbar');
    if (trackMenuEl.matches(':popover-open')) {
      var sameRow = firetable.trackMenuRow && firetable.trackMenuRow.is($p);
      trackMenuEl.hidePopover();
      if (sameRow) return;
    }
    firetable.trackMenuRow = $p;
    firetable.trackMenuBtn = btn;
    var $link = $p.find('.tracklink-btn');
    var $menu = $(trackMenuEl);
    $menu.find('[data-act="open"]').attr('href', $link.attr('href') || '#');
    $menu.find('.ft-menu-open-label').text($link.attr('title') || 'Open track');
    $menu.find('.ft-menu-open-logo').html($link.find('svg').prop('outerHTML') || '');
    $(btn).addClass('on').attr('aria-expanded', 'true');
    trackMenuEl.style.visibility = 'hidden';
    trackMenuEl.showPopover();
    firetable.ui.positionPopover(btn, trackMenuEl, document.getElementById('trackMenuArrow'), 'bottom-end').then(function () {
      var first = trackMenuEl.querySelector('[role="menuitem"]');
      if (first) first.focus();
    });
  }

  trackMenuEl.addEventListener('toggle', function (e) {
    if (e.newState === 'closed' && firetable.trackMenuBtn) {
      $(firetable.trackMenuBtn).removeClass('on').attr('aria-expanded', 'false');
    }
  });

  $(trackMenuEl)
    .on('click', '[data-act]', function (e) {
      var act = $(this).attr('data-act');
      var $p = firetable.trackMenuRow;
      var btn = firetable.trackMenuBtn;
      trackMenuEl.hidePopover();
      if (!$p || !$p.length) return;
      if (act === 'open') return; // the link opens the track itself
      e.preventDefault();
      if (act === 'bottom') {
        $p.find('.bottomsongs').trigger('click');
      } else if (act === 'add') {
        firetable.actions.openStealPicker($(btn), queueRowTarget($p));
      } else if (act === 'delete') {
        firetable.actions.deleteSongPrompt($p.attr('data-key'), $p.attr('data-tags') || $p.find('.listwords').text(), $p.attr('data-type'), btn);
      }
    })
    .on('keydown', function (e) {
      var $items = $(trackMenuEl).find('[role="menuitem"]');
      var idx = $items.index($items.filter(':focus'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        $items.eq((idx + 1) % $items.length).focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        $items.eq((idx - 1 + $items.length) % $items.length).focus();
      }
    });

  // ── Playlist changed: re-render the queue ──
  ftapi.events.on("playlistChanged", function (okdata, listID) {
    firetable.queue = okdata;
    firetable.ui.renderListCount(okdata);
    // Each render gets a number; chunks from an older render stop when a
    // newer one starts, so stale rows never get appended to the new list.
    var renderGen = firetable._queueRenderGen = (firetable._queueRenderGen || 0) + 1;

    var container = document.getElementById('mainqueue');
    var keys = okdata ? Object.keys(okdata) : [];

    // Is this an update to the playlist already on screen (send to top/bottom,
    // delete, reorder, add) rather than a playlist being opened?
    var listKey = String(listID);
    var isUpdate = firetable._queueShownList === listKey &&
      container.querySelector('.pvbar') !== null;
    firetable._queueShownList = listKey;

    if (!keys.length) {
      container.innerHTML = '';
      firetable.actions.filterQueue('');
      return;
    }

    // Updates: redraw every row in one pass and keep the scroll position, so
    // the list doesn't collapse to 30 rows and visibly re-grow.
    var FIRST = isUpdate ? keys.length : Math.min(30, keys.length);
    var scroller = document.getElementById('queuelist');
    var keepScroll = isUpdate && scroller ? scroller.scrollTop : null;
    var html = '';
    for (var i = 0; i < FIRST; i++) {
      var k = keys[i];
      html += buildQueueItemHTML(k, okdata[k], k === firetable.preview);
    }
    container.innerHTML = html;

    firetable.actions.filterQueue($('#queueFilter').val() || '');

    if (keepScroll !== null) scroller.scrollTop = keepScroll;

    if (keys.length <= FIRST) return;

    // Render remaining items in idle-time batches to keep the first paint fast
    var CHUNK = 50;
    var idx = FIRST;
    var schedule = window.requestIdleCallback
      ? function (fn) { requestIdleCallback(fn, { timeout: 300 }); }
      : function (fn) { setTimeout(fn, 0); };

    function renderNextChunk() {
      if (renderGen !== firetable._queueRenderGen) return; // superseded
      var end = Math.min(idx + CHUNK, keys.length);
      var frag = document.createDocumentFragment();
      var tmp = document.createElement('div');
      var chunkHtml = '';
      for (var j = idx; j < end; j++) {
        var ck = keys[j];
        chunkHtml += buildQueueItemHTML(ck, okdata[ck], ck === firetable.preview);
      }
      tmp.innerHTML = chunkHtml;
      var newRows = Array.prototype.slice.call(tmp.children);
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      container.appendChild(frag);
      idx = end;
      // Apply the active filter to just the newly added rows
      if (firetable.actions.queueFilterActive()) {
        firetable.actions.filterQueue($('#queueFilter').val() || '', newRows);
      }
      if (idx < keys.length) schedule(renderNextChunk);
    }

    schedule(renderNextChunk);
  });

  // ── Queue filter input ──
  // "input" covers typing, paste, cut, undo and the search box's clear (X)
  // button. Bursts of input are folded into one filter pass per frame.
  var queueFilterFrame = 0;
  $("#queueFilter").on("input search", function () {
    if (queueFilterFrame) return;
    queueFilterFrame = requestAnimationFrame(function () {
      queueFilterFrame = 0;
      firetable.actions.filterQueue($("#queueFilter").val() || "");
    });
  });
  $("#queueFilterRemixOnly").on("change", function () {
    firetable.actions.filterQueue($("#queueFilter").val() || "");
  });
  $("#queueFilterBrokenOnly").on("change", function () {
    firetable.actions.filterQueue($("#queueFilter").val() || "");
  });

  // ── Shuffle button ──
  $("#shuffleQueue").off('click.shuffleQueueConfirm').on('click.shuffleQueueConfirm', function () {
    firetable.actions.shuffleQueuePrompt(this);
  });

  // ── Add-to-queue toggle ──
  $("#addToQueueBttn").on("click", firetable.ui.showSearchPanel);

  // ── Cancel search / back to queue ──
  $("#cancelqsearch").on("click", function () {
    firetable.ui.showQueuePanel();
    firetable.utilities.cancelSearchPreview();
  });

  // ── Create new playlist ──
  $("#plmaker").on("keyup", function (e) {
    if (e.key === 'Escape') {
      $(this).val('');
      exitCreateMode();
      return;
    }
    if (e.which !== 13) return;
    var val = $(this).val();
    if (val) {
      var listid = ftapi.actions.createList(val);
      firetable.utilities.addPlaylistToPickers(listid, val);
      $("#listpicker").val(listid).change();
      $("#djlistpicker").val(listid);
      ftapi.actions.switchDjList(listid);
      $(this).val('');
      exitCreateMode();
    }
  });

  function enterCreateMode() {
    $("#listpicker, #listCount").hide();
    $("#plmanager").css("display", "flex");
    $("#plIndexBtn, #addToQueueBttn, #mergeLists, #shuffleQueue, #plDeleteLauncher").hide().next(".ft-tip").hide();
    $("#plAddLauncher").next(".ft-tip").text("Cancel Create Playlist");
    $("#plAddLauncher i").text("close");
    $("#mainqueuestuff, #filterMachine").css("display", "none");
    $("#plmaker").focus();
  }

  function exitCreateMode() {
    $("#plmanager").css("display", "none");
    $("#listpicker, #listCount").show();
    $("#plIndexBtn, #addToQueueBttn, #mergeLists, #shuffleQueue, #plDeleteLauncher").show().next(".ft-tip").show();
    $("#plAddLauncher").next(".ft-tip").text("New / Import playlist");
    $("#plAddLauncher i").text("add");
    $("#mainqueuestuff, #filterMachine").css("display", "block");
  }

  // ── Delete playlist ──
  $("#pldeleteButton").on("click", function () {
    var val = $("#listpicker").val();
    if (!val || val === "0") return;
    firetable.debug && console.log('playlist delete:', val);
    firetable.actions.deleteLists([val]);
    document.getElementById("deletePromptBox").close();
    $("#deleteConfirmInput").val('');
    $("#pldeleteButton").prop('disabled', true);
  });

  // ── Delete confirm input live check ──
  $("#deleteConfirmInput").on("input", function () {
    var target = $("#deleteConfirmTarget").text();
    $("#pldeleteButton").prop('disabled', $(this).val() !== target);
  });

  // ── Delete launcher ──
  $("#plDeleteLauncher").on("click", function () {
    var val = $("#listpicker").val();
    if (!val || val === "0") {
      return; // nothing to delete
    }
    var name = $("#listpicker option:selected").text();
    $("#deleteConfirmTarget").text(name);
    $("#deleteConfirmInput").val('');
    $("#pldeleteButton").prop('disabled', true);
    document.getElementById("deletePromptBox").showModal();
  });

  // ── Add-new popover toggle ──
  function openPlAddMenu() {
    var $pop = $("#plAddPopover");
    var btn = $("#plAddLauncher");
    $pop.addClass('show');
    btn.attr('aria-expanded', 'true');
    var btnOffset = btn.offset();
    $pop.css({
      top: btnOffset.top + btn.outerHeight() + 4,
      left: btnOffset.left + btn.outerWidth() - $pop.outerWidth()
    });
    $pop.find('[role=menuitem]').first().focus();
  }

  function closePlAddMenu(returnFocus) {
    $("#plAddPopover").removeClass('show');
    $("#plAddLauncher").attr('aria-expanded', 'false');
    if (returnFocus) $("#plAddLauncher").focus();
  }

  $("#plAddLauncher").on("click", function (e) {
    e.stopPropagation();
    // If we're in create mode, this button acts as cancel
    if ($("#plmanager").is(":visible")) {
      $("#plmaker").val('');
      exitCreateMode();
      return;
    }
    var $pop = $("#plAddPopover");
    if ($pop.hasClass('show')) {
      closePlAddMenu(true);
      return;
    }
    // Show first so outerWidth() is measurable, then position
    openPlAddMenu();
  });

  $("#plAddPopover").on("keydown", function (e) {
    var $items = $(this).find('[role=menuitem]');
    var $focused = $items.filter(':focus');
    var idx = $items.index($focused);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      $items.eq((idx + 1) % $items.length).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      $items.eq((idx - 1 + $items.length) % $items.length).focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      $items.first().focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      $items.last().focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePlAddMenu(true);
    } else if (e.key === 'Tab') {
      closePlAddMenu(false);
    }
  });

  $(document).on("click.plAddPopover", function () {
    closePlAddMenu(false);
  });

  $("#plAddPopover").on("click", function (e) {
    e.stopPropagation();
  });

  // ── Popover: Create Playlist ──
  $("#plAddCreate").on("click", function () {
    closePlAddMenu(false);
    enterCreateMode();
  });

  // ── Popover: Import Playlist ──
  $("#plAddImport").on("click", function () {
    closePlAddMenu(false);
    document.getElementById("importPromptBox").showModal();
  });

  // ── Merge lists UI ──
  function closeMergeContain() {
    $("#mergeSetup").show();
    $("#mergeCompleted").hide();
    $("#mergeHappening").hide();
    $("#mergeContain").hide();
    $("#mergeLists").removeClass('on');
  }

  $("#mergeLists").on("click", function () {
    var $this = $(this);
    var isHidden = $("#mergeContain").is(":hidden");
    if (isHidden) {
      ftapi.lookup.listNames(function (allPlaylists) {
        firetable.ui.fillPlaylistSelect($("#mergepicker"), allPlaylists);
        firetable.ui.fillPlaylistSelect($("#mergepicker2"), allPlaylists, [{ value: "-1", text: "Create New Copy" }]);
        if (ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].selectedList) {
          $("#mergepicker").val(ftapi.users[ftapi.uid].selectedList).change();
          $("#mergepicker2").val(-1).change();
        }
        $("#mergeContain").show();
        $this.addClass('on');
        // Point the arrow at the merge button wherever it sits in the toolbar
        var box = document.getElementById('mergeContain').getBoundingClientRect();
        var btn = $this[0].getBoundingClientRect();
        var arrow = document.getElementById('mergeArrow');
        var half = parseFloat(getComputedStyle(arrow).borderLeftWidth) || 16;
        arrow.style.right = Math.max(0, box.right - (btn.left + btn.width / 2) - half) + 'px';
      });
    } else {
      closeMergeContain();
    }
  });
  $("#startMerge").on("click", function () {
    var source = $("#mergepicker").val();
    var sourceName = $("#mergepicker option:selected").text();
    var dest = $("#mergepicker2").val();
    $("#mergeSetup").hide();
    $("#mergeHappening").show();
    firetable.debug && console.log(sourceName + " -> " + $("#mergepicker2 option:selected").text());
    firetable.actions.mergeLists(source, dest, sourceName);
  });
  $("#mergeOK").on("click", function () {
    closeMergeContain();
  });

  // Dismiss merge popover when clicking outside of it.
  $(document)
    .off('click.mergeContainDismiss')
    .on('click.mergeContainDismiss', function (e) {
      if ($("#mergeContain").is(':hidden')) return;
      if ($(e.target).closest('#mergeContain, #mergeLists').length) return;
      closeMergeContain();
    })
    .off('keydown.mergeContainDismiss')
    .on('keydown.mergeContainDismiss', function (e) {
      if (e.key === 'Escape' && !$("#mergeContain").is(':hidden')) {
        closeMergeContain();
      }
    });

  // ── Tag editing (Enter in .tagMachine) ──
  $(document).on("keyup", ".tagMachine", function (e) {
    if (e.which !== 13) return;
    var np = firetable.tagEditNowPlaying;
    if (np) {
      var tag = String($(this).val() || "").trim();
      if (tag.indexOf(" - ") < 1 || tag.indexOf(" - ") > tag.length - 4) {
        firetable.ui.toast("Check yr tags: use Artist - Song Title.", "error");
        return;
      }
      if (firetable.song && String(firetable.song.cid) === String(np.cid)) {
        ftapi.actions.sendBotCommand("!fixtags " + tag);
        firetable.ui.toast("Tags sent: " + tag, "success");
      } else {
        firetable.ui.toast("That song has ended. Fix it from Recent instead.", "error");
      }
      document.getElementById('tagEditorPopover').hidePopover();
      return;
    }
    var $pvbar = firetable.editingPvbar;
    if (!$pvbar || !$pvbar.length) return;
    var val = $(this).val();
    if (!val) return;
    var yargo = val.split(" - ");
    if (!yargo[0] || !yargo[1]) {
      firetable.ui.toast("Check yr tags: use Artist - Song Title.", "error");
    } else {
      ftapi.actions.editTag(
        $pvbar.attr('data-type'),
        $pvbar.attr('data-cid'),
        val,
        $pvbar.attr('data-histid'),
        $pvbar.attr('data-list'),
        function (error) {
          if (error) firetable.ui.toast("Couldn't save those tags. Please try again.", "error");
        }
      );
      $pvbar.attr('data-tag', val);
      document.getElementById('tagEditorPopover').hidePopover();
    }
  });

  // ── Tag editor popover cleanup on auto-dismiss ──
  document.getElementById('tagEditorPopover').addEventListener('toggle', function (e) {
    if (e.newState === 'closed') firetable.tagEditNowPlaying = null;
    if (e.newState === 'closed' && firetable.editingPvbar) {
      firetable.editingPvbar.removeClass('editing');
      firetable.editingPvbar = null;
    }
  });

  // ── Delete confirmation popover actions ──
  $(document)
    .off('click.deleteSongConfirm')
    .on('click.deleteSongConfirm', '#deleteSongPopover .deleteSongConfirm', function () {
      var popoverEl = document.getElementById('deleteSongPopover');
      var $popover = $(popoverEl);
      firetable.actions.deleteSong($popover.data('songid'));
      popoverEl.hidePopover();
    })
    .off('click.deleteSongConfirmSearch')
    .on('click.deleteSongConfirmSearch', '#deleteSongPopover .deleteSongAndSearch', function () {
      var popoverEl = document.getElementById('deleteSongPopover');
      var $popover = $(popoverEl);
      firetable.actions.deleteSongAndSearch(
        $popover.data('songid'),
        $popover.data('tags'),
        $popover.data('type')
      );
      popoverEl.hidePopover();
    })
    .off('click.deleteSongConfirmCancel')
    .on('click.deleteSongConfirmCancel', '#deleteSongPopover .deleteSongCancel', function () {
      var popoverEl = document.getElementById('deleteSongPopover');
      popoverEl.hidePopover();
    })
    .off('keydown.deleteSongConfirmKeys')
    .on('keydown.deleteSongConfirmKeys', '#deleteSongPopover', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hidePopover();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        $(this).find('.deleteSongConfirm').trigger('click');
      }
    })
    .off('click.shuffleQueueConfirm')
    .on('click.shuffleQueueConfirm', '#shuffleQueuePopover .shuffleQueueConfirm', function () {
      var popoverEl = document.getElementById('shuffleQueuePopover');
      firetable.actions.shuffleQueue();
      popoverEl.hidePopover();
    })
    .off('click.shuffleQueueCancel')
    .on('click.shuffleQueueCancel', '#shuffleQueuePopover .shuffleQueueCancel', function () {
      var popoverEl = document.getElementById('shuffleQueuePopover');
      popoverEl.hidePopover();
    })
    .off('keydown.shuffleQueueKeys')
    .on('keydown.shuffleQueueKeys', '#shuffleQueuePopover', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hidePopover();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        $(this).find('.shuffleQueueConfirm').trigger('click');
      }
    });

  document.getElementById('deleteSongPopover').addEventListener('toggle', function (e) {
    if (e.newState === 'closed' && firetable.deletingPvbar) {
      firetable.deletingPvbar.removeClass('deleting');
      firetable.deletingPvbar = null;
    }
  });

  document.getElementById('shuffleQueuePopover').addEventListener('toggle', function (e) {
    if (e.newState === 'closed') {
      $('#shuffleQueue').removeClass('on');
    }
  });
};

// ─── Broken-track check (#92) ────────────────────────────────────────────────
// Looks up every track in a playlist and flags the ones that can't play here:
// YouTube videos that are gone, private, not embeddable, age-restricted,
// blocked in the US or premieres that haven't started, and SoundCloud tracks
// that are gone, blocked or only a 30-second preview. The hostbot checks each
// track with the same rules (and codes) before it plays (lib/checks.js). Tracks
// that were flagged automatically but play fine again get their flag cleared.
// Manual flags (broken / low quality / off-theme) are never touched.
//
// Cost: one YouTube API call (1 quota unit) per 50 tracks, one SoundCloud
// proxy call per 50 tracks. Each list is also re-checked quietly in the
// background when you open it, at most once a week.

/** Flag codes the checker may set or clear. */
var AUTO_FLAG_CODES = [1, 2, 3, 4, 5, 6, 7];
var BROKEN_RECHECK_MS = 7 * 24 * 3600 * 1000;

firetable.brokenCheck = { running: false };
/** The playlist on screen (may differ from the one the DJ plays from). */
firetable.viewListID = "0";

/** Is there a usable YouTube API key? */
firetable.utilities.hasYouTubeKey = function () {
  var k = typeof ftconfigs !== "undefined" && ftconfigs.youtubeKey;
  return !!k && !/^(x+|no-yt-key)$/i.test(k);
};

/** Why a YouTube video can't play here (a flag code), or 0 when it's fine. */
firetable.utilities.youTubeProblem = function (item) {
  if (!item) return 2;
  var st = item.status || {}, cd = item.contentDetails || {}, sn = item.snippet || {};
  if (st.privacyStatus === "private" || /^(deleted|failed|rejected)$/.test(st.uploadStatus || "")) return 2;
  if (st.embeddable === false) return 6;
  var rr = cd.regionRestriction;
  if (rr && ((rr.allowed && rr.allowed.indexOf("US") === -1) || (rr.blocked && rr.blocked.indexOf("US") !== -1))) return 3;
  if (cd.contentRating && cd.contentRating.ytRating === "ytAgeRestricted") return 7;
  if (sn.liveBroadcastContent === "upcoming") return 5; // a premiere that hasn't started
  return 0;
};

/** YouTube videos.list for up to 50 ids. Resolves {id: item}; rejects on API errors. */
firetable.actions.ytVideoStatus = function (ids) {
  return $.ajax({
    url: "https://www.googleapis.com/youtube/v3/videos",
    data: {
      part: "status,contentDetails,snippet",
      id: ids.join(","),
      maxResults: 50,
      fields: "items(id,status(embeddable,privacyStatus,uploadStatus),contentDetails(regionRestriction,contentRating/ytRating),snippet/liveBroadcastContent)",
      key: ftconfigs.youtubeKey
    },
    dataType: "json",
    timeout: 20000
  }).then(function (res) {
    var out = {};
    (res && res.items || []).forEach(function (it) { out[it.id] = it; });
    return out;
  });
};

/**
 * SoundCloud status for up to 50 track ids. Resolves {id: track|null}; null
 * means SoundCloud says it's gone. Ids it couldn't check are left out.
 */
firetable.actions.scTrackStatus = function (ids) {
  return firetable.actions.scProxy({ action: "tracks", ids: ids.join(",") }).then(function (res) {
    var found = {}, out = {};
    (res && res.collection || []).forEach(function (t) { if (t && t.id) found[t.id] = t; });
    ids.forEach(function (id) { out[id] = found[id] || null; });
    return out;
  }, function (err) {
    if (!err || !err.unavailable) return $.Deferred().reject(err).promise();
    // No site proxy: ask the legacy one, one track at a time
    var out = {};
    return ids.reduce(function (p, id) {
      return p.then(function () {
        return firetable.actions.scLegacy(SC_PROXY_URL + "?type=tracks&q=" + encodeURIComponent(id)).then(
          function (t) { out[id] = t; },
          function (e) { if (e && e.status === 404) out[id] = null; } // network trouble: unknown, skip
        ).then(function () { return firetable.utilities.wait(250); });
      });
    }, $.Deferred().resolve().promise()).then(function () { return out; });
  });
};

/** Why a SoundCloud track can't play here, or 0. Promo snippets (30-second previews) never play. */
firetable.utilities.soundCloudProblem = function (t) {
  if (!t) return 5;
  if (t.access === "blocked" || t.policy === "BLOCK" || t.streamable === false || t.sharing === "private") return 5;
  if (t.access === "preview" || t.policy === "SNIP") return 5;
  if (Number(t.full_duration) > Number(t.duration) + 1000) return 5;
  return 0;
};

/** Promise that resolves after ms. */
firetable.utilities.wait = function (ms) {
  return $.Deferred(function (d) { setTimeout(d.resolve, ms); }).promise();
};

/**
 * Check a playlist and update its flags.
 * @param {string} listID - "0" for the default list
 * @param {{quiet?:boolean, onProgress?:function(number, number)}} [opts]
 * @returns {Promise<{checked:number, total:number, broken:number, newlyBroken:number, fixed:number, skipped:number, error?:string}>}
 */
firetable.actions.checkBrokenTracks = function (listID, opts) {
  opts = opts || {};
  var bc = firetable.brokenCheck;
  if (bc.running) return $.Deferred().reject({ message: "A check is already running." }).promise();
  bc.running = true;
  var ref = ftapi.lookup.listRef(listID);
  var result = { checked: 0, total: 0, broken: 0, newlyBroken: 0, fixed: 0, skipped: 0 };
  var progress = function () { if (opts.onProgress) opts.onProgress(result.checked + result.skipped, result.total); };

  return $.when(ref.once("value")).then(function (snap) {
    var tracks = snap.val() || {};
    var yt = {}, sc = {}; // cid -> [keys]
    Object.keys(tracks).forEach(function (key) {
      var t = tracks[key];
      if (!t || !t.cid) return;
      var bucket = String(t.type) === "2" ? sc : yt;
      (bucket[t.cid] = bucket[t.cid] || []).push(key);
      result.total++;
    });
    progress();
    var updates = {};
    var now = ftapi.now();
    var apply = function (bucket, statuses, problemFor) {
      Object.keys(statuses).forEach(function (cid) {
        var code = problemFor(statuses[cid]);
        (bucket[cid] || []).forEach(function (key) {
          var flag = tracks[key].flagged;
          var auto = !flag || AUTO_FLAG_CODES.indexOf(flag.code) !== -1;
          result.checked++;
          if (code) {
            result.broken++;
            if (!flag) { updates[key + "/flagged"] = { date: now, code: code }; result.newlyBroken++; }
            else if (auto && flag.code !== code) updates[key + "/flagged"] = { date: now, code: code };
          } else if (flag && auto) {
            updates[key + "/flagged"] = null;
            result.fixed++;
          }
        });
      });
    };
    var chunks = function (obj) {
      var ids = Object.keys(obj), out = [];
      for (var i = 0; i < ids.length; i += 50) out.push(ids.slice(i, i + 50));
      return out;
    };
    var skip = function (bucket, ids) {
      ids.forEach(function (cid) { result.skipped += (bucket[cid] || []).length; });
      progress();
    };
    var step = $.Deferred().resolve().promise();
    var ytChunks = chunks(yt);
    if (!firetable.utilities.hasYouTubeKey()) {
      ytChunks.forEach(function (ids) { skip(yt, ids); });
      if (ytChunks.length) result.error = "YouTube checks need an API key.";
    } else {
      ytChunks.forEach(function (ids, n) {
        step = step.then(function () {
          if (n) return firetable.utilities.wait(150);
        }).then(function () {
          if (result.ytDown) return skip(yt, ids);
          return firetable.actions.ytVideoStatus(ids).then(function (items) {
            var statuses = {};
            ids.forEach(function (id) { statuses[id] = items[id] || null; });
            apply(yt, statuses, firetable.utilities.youTubeProblem);
            progress();
          }, function (xhr) {
            // Quota, bad key, offline: don't guess, stop asking YouTube
            result.ytDown = true;
            result.error = "YouTube didn't answer (" + ((xhr && xhr.status) || "offline") + "), so some tracks weren't checked.";
            skip(yt, ids);
          });
        });
      });
    }
    chunks(sc).forEach(function (ids) {
      step = step.then(function () {
        if (result.scDown) return skip(sc, ids);
        return firetable.actions.scTrackStatus(ids).then(function (statuses) {
          apply(sc, statuses, firetable.utilities.soundCloudProblem);
          skip(sc, ids.filter(function (id) { return !(id in statuses); }));
          progress();
        }, function () {
          result.scDown = true;
          result.error = "SoundCloud didn't answer, so some tracks weren't checked.";
          skip(sc, ids);
        });
      });
    });
    return step.then(function () {
      // Only touch tracks that are still in the list
      return ref.once("value").then(function (s2) {
        var live = s2.val() || {};
        Object.keys(updates).forEach(function (path) { if (!live[path.split("/")[0]]) delete updates[path]; });
        return Object.keys(updates).length ? ref.update(updates) : null;
      });
    });
  }).then(function () {
    try { localStorage[firetable.utilities.brokenCheckKey(listID)] = String(Date.now()); } catch (e) { /* private mode */ }
    bc.running = false;
    return result;
  }, function (err) {
    bc.running = false;
    return $.Deferred().reject(err).promise();
  });
};

firetable.utilities.brokenCheckKey = function (listID) {
  return STORAGE.brokenCheck + ":" + ftapi.uid + ":" + (listID || "0");
};

/** One line summing up a check. */
firetable.utilities.brokenSummary = function (r) {
  var parts = [];
  if (!r.checked && r.skipped) return r.error || "Couldn't check this playlist right now.";
  parts.push(r.broken ? (r.broken + (r.broken === 1 ? " track can't play" : " tracks can't play") + " and " + (r.broken === 1 ? "is" : "are") + " flagged ⚠") : "Every track checked out fine.");
  if (r.fixed) parts.push(r.fixed + " old " + (r.fixed === 1 ? "flag" : "flags") + " cleared.");
  if (r.skipped) parts.push(r.skipped + (r.skipped === 1 ? " track" : " tracks") + " couldn't be checked.");
  return parts.join(" ");
};

/** Quietly re-check a list you open if it hasn't been checked for a week. */
firetable.actions.autoCheckBroken = function (listID) {
  if (!ftapi.uid || firetable.brokenCheck.running || !firetable.utilities.hasYouTubeKey()) return;
  var last = 0;
  try { last = Number(localStorage[firetable.utilities.brokenCheckKey(listID)]) || 0; } catch (e) { return; }
  if (Date.now() - last < BROKEN_RECHECK_MS) return;
  firetable.actions.checkBrokenTracks(listID, { quiet: true }).then(function (r) {
    if (r.newlyBroken) {
      firetable.ui.toast(r.newlyBroken + (r.newlyBroken === 1 ? " track" : " tracks") + " in this playlist can't play anymore and " + (r.newlyBroken === 1 ? "was" : "were") + " flagged ⚠", "error");
    }
  }, function () { /* try again next time */ });
};

firetable.ui.setupBrokenCheck = function () {
  // Background re-check when a list is opened (not on every edit)
  var lastList = null;
  ftapi.events.on("playlistChanged", function (data, listID) {
    var id = String(listID == null ? "0" : listID);
    firetable.viewListID = id;
    if (id === lastList) return;
    lastList = id;
    setTimeout(function () { if (firetable.viewListID === id) firetable.actions.autoCheckBroken(id); }, 4000);
  });
  ftapi.events.on("loggedOut", function () { lastList = null; firetable.viewListID = "0"; });
};
