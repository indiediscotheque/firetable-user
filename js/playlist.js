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
 * - SoundCloud URL resolution (resolveSCLink, scGet)
 * - Import playlist from YouTube/SoundCloud (importList)
 * - Dubtrack import (dubtrackImport, dubtrackImportFileSelect)
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
  if (listID == "0") {
    ftapi.queueRef = firebase.app("firetable").database().ref("queues/" + ftapi.uid);
  } else {
    ftapi.queueRef = firebase.app("firetable").database().ref("playlists/" + ftapi.uid + "/" + listID + "/list");
  }
  ftapi.queueBind = ftapi.queueRef.on('value', function (dataSnapshot) {
    var data = dataSnapshot.val();
    if (!data) data = {};
    ftapi.queue = data;
    ftapi.events.emit("playlistChanged", data, listID);
  });
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
 */
firetable.actions.queueTrack = function (cid, name, type, tobottom) {
  var info = { type: type, name: name, cid: cid };

  // Visual feedback: checkmark on the queue button
  $("#apv" + type + cid).find(".material-symbols-filled").text("check");
  $("#apv" + type + cid).css("color", firetable.orange);
  $("#apv" + type + cid).css("pointer-events", "none");
  setTimeout(function () {
    $("#apv" + type + cid).find(".material-symbols-filled").text("playlist_add");
    $("#apv" + type + cid).removeAttr("style");
  }, 3000);

  var cuteid = ftapi.actions.addToList(type, name, cid, false, function () {
    firetable.debug && console.log('queue track id:', cuteid);
    if (!tobottom) firetable.actions.bumpSongInQueue(cuteid);
  });

  // Cancel any active search preview
  firetable.utilities.cancelSearchPreview();

  // Switch view back to queue
  $("#mainqueuestuff").css("display", "block");
  $("#filterMachine").css("display", "block");
  $("#searchMachine").css("display", "none");
  $("#addbox").css("display", "none");
  $("#cancelqsearch").hide();
  $("#qControlButtons").show();
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
firetable.actions.removeDupesFromQueue = function () {
  ftapi.actions.removeDuplicatesFromList();
  $("#mergeCompleted").show();
  $("#mergeHappening").hide();
};

/**
 * Move a track to the top of the queue.
 * @param {string} songid - Track key in the playlist
 */
firetable.actions.bumpSongInQueue = function (songid) {
  ftapi.actions.moveTrackToTop(songid, ftapi.queueRef, firetable.preview, function (changePV) {
    if (changePV) firetable.preview = changePV;
  });
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
  $("#mainqueuestuff").css("display", "none");
  $("#filterMachine").css("display", "none");
  $("#searchMachine").css("display", "block");
  $("#addbox").css("display", "flex");
  $("#cancelqsearch").show();
  $("#qControlButtons").hide();
  $("#plmanager").css("display", "none");

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


/**
 * Filter visible queue items by a search string.
 * @param {string} val - Filter text (empty string shows all)
 */
firetable.actions.filterQueue = function (val) {
  var textFilter = String(typeof val === "string" ? val : $("#queueFilter").val() || "").toLowerCase().trim();
  var remixOnly = $("#queueFilterRemixOnly").is(":checked");
  var brokenOnly = $("#queueFilterBrokenOnly").is(":checked");
  var visibleCount = 0;

  $("#mainqueue .pvbar").each(function (p, q) {
    var $row = $(q);
    var tags = String($row.attr("data-tags") || "");
    var searchText = tags.toLowerCase();
    var matchesText = !textFilter || searchText.indexOf(textFilter) !== -1;
    var matchesRemix = !remixOnly || /\([^)]*\)/.test(tags);
    var isBroken = String($row.attr("data-broken") || "0") === "1";
    var matchesBroken = !brokenOnly || isBroken;

    var show = matchesText && matchesRemix && matchesBroken;
    $row.toggle(show);
    if (show) visibleCount += 1;
  });

  $("#mainqueue").toggleClass("overFiltered", visibleCount === 0 && $("#mainqueue .pvbar").length > 0);
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
    firetable.actions.removeDupesFromQueue();
    return;
  }
  if (dest == -1) {
    var newname = firetable.utilities.format_date(Date.now()) + " Copy of " + sourceName;
    dest = ftapi.actions.createList(newname);
    $("#listpicker").append('<option id="pdopt' + dest + '" value="' + dest + '">' + newname + '</option>');
    $("#djlistpicker").append('<option value="' + dest + '">' + newname + '</option>');
  }
  ftapi.actions.mergeLists(source, dest, function () {
    $("#mergeCompleted").show();
    $("#mergeHappening").hide();
  });
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
 * Why: YouTube API/gapi can be unavailable or hang in some sessions; oEmbed keeps
 * artist/title labels working, and final ID fallback avoids silent no-op.
 */
firetable.actions.queueYoutubeWithFallback = function (youtubeId) {
  var settled = false;

  var queueFromTitle = function (id, rawTitle, rawArtist) {
    var artist = String(rawArtist || "").replace(" - Topic", "");
    var parsed = firetable.utilities.parseArtistTitle(rawTitle || ("YouTube - " + id), artist);
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

  if (typeof youtubeAPIReady === "function") {
    youtubeAPIReady(function () {
      try {
        gapi.client.youtube.videos.list({
          id: youtubeId,
          part: "snippet",
          maxResults: 1
        }).execute(queueFromResponse);
      } catch (err) {
        firetable.debug && console.log("queueFromLink yt gapi error:", err);
        queueFromOEmbed("gapi error");
      }
    });
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
    firetable.actions.resolveSCLink(incomingLink, function (tracks) {
      if (tracks) {
        var parsed = firetable.utilities.parseArtistTitle(tracks.title, tracks.user.username);
        firetable.actions.queueTrack(tracks.id, parsed.artist + " - " + parsed.title, MEDIA_SOUNDCLOUD);
      }
    });
  }
};

// ─── SoundCloud Resolution ───────────────────────────────────────────────────

/**
 * Resolve a SoundCloud URL to track/playlist metadata via proxy.
 * @param {string} link     - Full SoundCloud URL
 * @param {Function} callback - Called with the resolved response object
 */
firetable.actions.resolveSCLink = function (link, callback) {
  var importantStuff = link.replace("https://soundcloud.com/", "").replace("http://soundcloud.com/", "");
  $.ajax({
    url: SC_RESOLVE_URL + importantStuff,
    type: 'GET',
    dataType: 'json',
    success: function (res) {
      console.log(res);
      callback(res.response);
    }
  });
};

/**
 * Generic SoundCloud API GET request via proxy.
 * @param {string} type     - Resource type (e.g. 'playlists')
 * @param {string} q        - Query/ID
 * @param {Function} callback - Called with the response
 */
firetable.actions.scGet = function (type, q, callback) {
  $.ajax({
    url: SC_PROXY_URL + "?type=" + type + "&q=" + q,
    type: 'GET',
    dataType: 'json',
    success: function (res) {
      console.log(res);
      callback(res.response);
    }
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
  $("#overlay").removeClass('show');
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
          $("#listpicker").append('<option id="pdopt' + listid + '" value="' + listid + '">' + name + '</option>');
          $("#djlistpicker").append('<option value="' + listid + '">' + name + '</option>');
          for (var i = 0; i < finalList.length; i++) {
            var goodTitle = finalList[i].snippet.title;
            if (goodTitle !== "Private video" && goodTitle !== "Deleted video") {
              ftapi.actions.addToList(MEDIA_YOUTUBE, goodTitle, finalList[i].snippet.resourceId.videoId, listid);
            }
          }
        }
      });
    };
    fetchPage(); // start with first page

  } else if (type === MEDIA_SOUNDCLOUD) {
    firetable.actions.scGet('playlists', id, function (listinfo) {
      firetable.debug && console.log('sc tracks:', listinfo.tracks);
      var listid = ftapi.actions.createList(name);
      $("#listpicker").append('<option id="pdopt' + listid + '" value="' + listid + '">' + name + '</option>');
      $("#djlistpicker").append('<option value="' + listid + '">' + name + '</option>');
      for (var i = 0; i < listinfo.tracks.length; i++) {
        var goodTitle;
        if (listinfo.tracks[i].title) {
          var parsed = firetable.utilities.parseArtistTitle(listinfo.tracks[i].title, listinfo.tracks[i].user.username);
          goodTitle = parsed.artist + " - " + parsed.title;
        } else {
          goodTitle = "Unknown";
        }
        ftapi.actions.addToList(MEDIA_SOUNDCLOUD, goodTitle, listinfo.tracks[i].id, listid);
      }
    });
  }
};

// ─── Dubtrack Import ─────────────────────────────────────────────────────────

/**
 * Import tracks from the parsed Dubtrack export file.
 * Expects firetable.dtImportList and firetable.dtImportName to be populated
 * by dubtrackImportFileSelect().
 */
firetable.actions.dubtrackImport = function () {
  $("#importDubResults").html("importing (0/" + firetable.dtImportList.length + ")...");
  $("#dubimportButton").hide();
  var listid = ftapi.actions.createList(firetable.dtImportName);
  var name = firetable.dtImportName;
  $("#listpicker").append('<option id="pdopt' + listid + '" value="' + listid + '">' + name + '</option>');
  $("#djlistpicker").append('<option value="' + listid + '">' + name + '</option>');

  var trackarray = firetable.dtImportList;
  for (var e = 0; e < trackarray.length; e++) {
    var thetype = trackarray[e].type === "soundcloud" ? MEDIA_SOUNDCLOUD : MEDIA_YOUTUBE;
    var numbo = e + 1;
    $("#importDubResults").html("importing (" + numbo + "/" + firetable.dtImportList.length + ")...");
    if (numbo === firetable.dtImportList.length) {
      $("#importDubResults").html("Import complete! You can now select another file if you'd like to do another!");
    }
    ftapi.actions.addToList(thetype, trackarray[e].name, trackarray[e].cid, listid);
  }
};

/**
 * Parse a Dubtrack HTML export file and prepare it for import.
 * Populates firetable.dtImportName and firetable.dtImportList.
 * @param {Event} evt - File input change event
 */
firetable.ui.dubtrackImportFileSelect = function (evt) {
  var file = evt.target.files[0];
  var reader = new FileReader();
  reader.readAsText(file);
  reader.onload = function (event) {
    try {
      var allthestuff = event.currentTarget.result;
      firetable.dtImportName = firetable.ui.strip(allthestuff.split('<h4>')[1].split('</h4>')[0]);
      var hams = allthestuff.split('<li class="list-group-item list-group-item-dark" ');
      hams.shift();
      firetable.dtImportList = [];
      for (var i = 0; i < hams.length; i++) {
        var thingsRegex = /(type\=\"(.*))(" id\=\"(.*)\")>(.*)<\/li>/gm;
        var matches = thingsRegex.exec(hams[i]);
        firetable.dtImportList.push({
          type: matches[2],
          cid: matches[4],
          name: firetable.ui.strip(matches[5])
        });
      }
      if (firetable.dtImportList.length) {
        $("#importDubResults").text("Ok... import " + firetable.dtImportName + " (" + firetable.utilities.pluralize(firetable.dtImportList.length, "track") + ")?");
        $("#dubimportButton").show();
      } else {
        $("#importDubResults").text("ERROR... NO TRAX?");
        $("#dubimportButton").hide();
      }
    } catch (e) {
      console.log(e);
      $("#importDubResults").text("ERROR");
      $("#dubimportButton").hide();
    }
  };
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

// ─── Playlist Event Binding ──────────────────────────────────────────────────

/**
 * Set up the playlistChanged event handler and queue-related UI bindings.
 * Called once from firetable.ui.init().
 */
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

  // ── Playlist changed: re-render the queue ──
  ftapi.events.on("playlistChanged", function (okdata, listID) {
    firetable.queue = okdata;
    $('#mainqueue').html("");

    for (var key in okdata) {
      if (!okdata.hasOwnProperty(key)) continue;
      var thisone = okdata[key];
      var $newli = $playlistItemTemplate.clone();
      var psign = (key === firetable.preview) ? "&#xE034;" : "&#xE037;";
      var trackName = String(thisone.name || "Unknown");
      var safeTrackName = firetable.utilities.htmlEscape(trackName);
      var trackSeconds = firetable.actions.parseTrackDurationSeconds(
        thisone.duration || thisone.length || thisone.dur || thisone.time || thisone.seconds || thisone.msecs || thisone.ms || 0
      );
      var durationHtml = trackSeconds > 0
        ? '<span class="trackDuration">' + firetable.actions.formatTrackDuration(trackSeconds) + '</span>'
        : '';

      $newli.attr('id', "pvbar" + key)
            .attr("data-key", key)
            .attr("data-type", thisone.type)
        .attr("data-cid", thisone.cid)
        .attr("data-tags", trackName)
        .attr("data-broken", thisone.flagged ? "1" : "0")
        .attr("data-track-seconds", trackSeconds || "");

      // Album art thumbnail
      var artUrl = (thisone.type == MEDIA_YOUTUBE)
        ? 'https://i.ytimg.com/vi/' + thisone.cid + '/mqdefault.jpg'
        : (thisone.img || (firetable.imgCache && firetable.imgCache[thisone.cid]) || '');
      if (artUrl) $newli.find('.q-art').css('background-image', 'url(' + artUrl + ')');

      // Preview button
      $newli.find('.previewicon').attr('id', "pv" + key).on('click', function () {
        firetable.actions.pview(
          $(this).closest('.pvbar').attr('data-key'),
          false,
          $(this).closest('.pvbar').attr('data-type')
        );
      }).html(psign);

      // Track title
      $newli.find('.listwords').html(safeTrackName + durationHtml);

      // Bump to top
      $newli.find('.bumpsongs').on('click', function () {
        firetable.actions.bumpSongInQueue($(this).closest('.pvbar').attr('data-key'));
      });

      // Move to bottom
      $newli.find('.bottomsongs').on('click', function () {
        var oldID = $(this).closest('.pvbar').attr('data-key');
        ftapi.actions.moveTrackToBottom(oldID, function (newID) {
          if (firetable.preview && firetable.preview === oldID) {
            firetable.preview = newID;
            $("#pv" + newID).html("&#xE034;");
          }
        });
      });

      // Flagged track warning icon
      if (thisone.flagged) {
        var flagLabel = "broken";
        var flagIcon = "warning";
        if (thisone.flagged.code === 7) {
          flagLabel = "age restricted";
        } else if (thisone.flagged.code === 8) {
          flagLabel = "broken (manual)";
        } else if (thisone.flagged.code === 9) {
          flagLabel = "low audio quality";
          flagIcon = "disc_full";
        } else if (thisone.flagged.code === 10) {
          flagLabel = "offtheme";
          flagIcon = "flag";
        }
        $newli.find('.track-warning')
          .html('<span class="material-symbols-filled"> ' + flagIcon + ' </span>')
          .prop('title', 'Flagged as ' + flagLabel + ' on ' + firetable.utilities.format_date(thisone.flagged.date) + '. Click to remove flag.')
          .on('click', function () {
            ftapi.actions.unflagTrack($(this).closest('.pvbar').attr('data-key'));
            $(this).html("");
          });
      }

      // Delete button
      $newli.find('.deletesong').on('click', function () {
        var popoverEl = document.getElementById('deleteSongPopover');
        var $pvbar = $(this).closest('.pvbar');
        if (popoverEl && popoverEl.matches(':popover-open') && firetable.deletingPvbar && firetable.deletingPvbar.is($pvbar)) {
          popoverEl.hidePopover();
          return;
        }
        firetable.actions.deleteSongPrompt(
          $pvbar.attr('data-key'),
          $pvbar.attr('data-tags') || $pvbar.find('.listwords').text(),
          $pvbar.attr('data-type'),
          this
        );
      });

      // Edit tags button
      $newli.find('.edittags').on('click', function () {
        var popoverEl = document.getElementById('tagEditorPopover');
        var $pvbar = $(this).closest('.pvbar');
        if (popoverEl.matches(':popover-open') && firetable.editingPvbar && firetable.editingPvbar.is($pvbar)) {
          popoverEl.hidePopover();
        } else {
          firetable.actions.editTagsPrompt(
            $pvbar.attr('data-key'),
            $pvbar.attr('data-tags') || $pvbar.find('.listwords').text(),
            this
          );
        }
      });

      // Close editor button
      $newli.find('.closeeditor').on('click', function () {
        document.getElementById('tagEditorPopover').hidePopover();
      });

      if (!ftapi.isMod) $newli.find('.edittags, .closeeditor').hide();

      // External track link
      var trackUrl = String(thisone.type) === String(MEDIA_YOUTUBE)
        ? 'https://www.youtube.com/watch?v=' + thisone.cid
        : SC_API_TRACK_URL + thisone.cid;
      $newli.find('.tracklink-btn').attr('href', trackUrl);

      // Add-to-playlist button
      $newli.find('.histeal').on('click', function () {
        var $btn = $(this);
        var $pvbar = $btn.closest('.pvbar');
        var btnCid = $pvbar.attr('data-cid');
        var btnType = $pvbar.attr('data-type');
        var btnTitle = firetable.utilities.htmlEscape($pvbar.attr('data-tags') || $pvbar.find('.listwords').text());

        if (firetable.stealSourceBtn && firetable.stealSourceBtn.is($btn) && !$("#stealContain").is(':hidden')) {
          $btn.removeClass('on');
          firetable.stealSourceBtn = null;
          firetable.stealTarget = null;
          $("#stealContain").hide();
          return;
        }

        ftapi.lookup.allLists(function (allPlaylists) {
          $("#stealpicker").html(
            '<option value="-1">Where to?</option>' +
            '<option value="0">Default Queue</option>'
          );
          for (var key in allPlaylists) {
            if (allPlaylists.hasOwnProperty(key)) {
              $("#stealpicker").append(
                '<option value="' + key + '">' + allPlaylists[key].name + '</option>'
              );
            }
          }
          if (firetable.stealSourceBtn) firetable.stealSourceBtn.removeClass('on');
          $("#grab").removeClass('on');
          firetable.stealSourceBtn = $btn;
          firetable.stealTarget = { cid: btnCid, type: btnType, title: btnTitle };
          $btn.addClass('on');
          var stealContainEl = document.getElementById('stealContain');
          stealContainEl.style.visibility = 'hidden';
          $("#stealContain").show();
          firetable.ui.positionPopover($btn[0], stealContainEl, document.getElementById('stealArrow'), 'left');
        });
      });

      $('#mainqueue').append($newli);
    }

    firetable.actions.filterQueue($("#queueFilter").val() || "");
  });

  // ── Queue filter input ──
  $("#queueFilter").on("change paste keyup", function () {
    firetable.actions.filterQueue($(this).val());
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
  $("#addToQueueBttn").bind("click", function () {
    $("#mainqueuestuff").css("display", "none");
    $("#filterMachine").css("display", "none");
    $("#searchMachine").css("display", "block");
    $("#addbox").css("display", "flex");
    $("#cancelqsearch").show();
    $("#qControlButtons").hide();
    $("#plmanager").css("display", "none");
  });

  // ── Cancel search / back to queue ──
  $("#cancelqsearch").bind("click", function () {
    $("#mainqueuestuff").css("display", "block");
    $("#filterMachine").css("display", "block");
    $("#searchMachine").css("display", "none");
    $("#cancelqsearch").hide();
    $("#qControlButtons").show();
    $("#addbox").css("display", "none");
    firetable.utilities.cancelSearchPreview();
  });

  // ── Create new playlist ──
  $("#plmaker").bind("keyup", function (e) {
    if (e.which !== 13) return;
    var val = $(this).val();
    if (val) {
      var listid = ftapi.actions.createList(val);
      $("#listpicker").append('<option id="pdopt' + listid + '" value="' + listid + '">' + val + '</option>');
      $("#djlistpicker").append('<option value="' + listid + '">' + val + '</option>');
      $("#listpicker").val(listid).change();
      $("#djlistpicker").val(listid);
      ftapi.actions.switchDjList(listid);
    }
  });

  // ── Delete playlist ──
  $("#pldeleteButton").bind("click", function () {
    var val = $("#deletepicker").val();
    firetable.debug && console.log('playlist delete:', val);
    if ($("#listpicker").val() === val) {
      $("#listpicker").val("0").change();
    }
    if (ftapi.selectedListThing === val) {
      ftapi.actions.switchDjList("0");
      $("#djlistpicker").val("0");
    }
    ftapi.actions.deleteList(val);
    $("#pdopt" + val).remove();
    $("#djlistpicker option[value='" + val + "']").remove();
    $("#overlay").removeClass('show');
  });

  // ── Import launcher ──
  $("#plimportLauncher").bind("click", function () {
    $("#overlay").addClass('show');
    $(".modalThing").removeClass('show');
    $('#importPromptBox').addClass('show');
  });

  // ── Delete launcher ──
  $("#pldeleteLauncher").bind("click", function () {
    ftapi.lookup.allLists(function (allPlaylists) {
      $("#deletepicker").html("");
      for (var key in allPlaylists) {
        if (allPlaylists.hasOwnProperty(key)) {
          $("#deletepicker").append('<option value="' + key + '">' + allPlaylists[key].name + '</option>');
        }
      }
      $("#overlay").addClass('show');
      $(".modalThing").removeClass('show');
      $('#deletePromptBox').addClass('show');
    });
  });

  // ── Dubtrack import file select ──
  $('#dubtrackimportfile').bind('change', firetable.ui.dubtrackImportFileSelect);
  $("#importDubGo").bind("click", firetable.actions.dubtrackImport);

  // ── Merge lists UI ──
  function closeMergeContain() {
    $("#mergeSetup").show();
    $("#mergeCompleted").hide();
    $("#mergeHappening").hide();
    $("#mergeContain").hide();
    $("#mergeLists").removeClass('on');
  }

  $("#mergeLists").bind("click", function () {
    var $this = $(this);
    var isHidden = $("#mergeContain").is(":hidden");
    if (isHidden) {
      ftapi.lookup.allLists(function (allPlaylists) {
        $("#mergepicker").html('<option value="0">Default Queue</option>');
        $("#mergepicker2").html('<option value="-1">Create New Copy</option><option value="0">Default Queue</option>');
        for (var key in allPlaylists) {
          if (allPlaylists.hasOwnProperty(key)) {
            $("#mergepicker").append('<option value="' + key + '">' + allPlaylists[key].name + '</option>');
            $("#mergepicker2").append('<option value="' + key + '">' + allPlaylists[key].name + '</option>');
          }
        }
        if (ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].selectedList) {
          $("#mergepicker").val(ftapi.users[ftapi.uid].selectedList).change();
          $("#mergepicker2").val(-1).change();
        }
        $("#mergeContain").show();
        $this.addClass('on');
      });
    } else {
      closeMergeContain();
    }
  });
  $("#startMerge").bind("click", function () {
    var source = $("#mergepicker").val();
    var sourceName = $("#mergepicker option:selected").text();
    var dest = $("#mergepicker2").val();
    $("#mergeSetup").hide();
    $("#mergeHappening").show();
    firetable.debug && console.log(sourceName + " -> " + $("#mergepicker2 option:selected").text());
    firetable.actions.mergeLists(source, dest, sourceName);
  });
  $("#mergeOK").bind("click", function () {
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
    var $pvbar = firetable.editingPvbar;
    if (!$pvbar || !$pvbar.length) return;
    var val = $(this).val();
    if (!val) return;
    var yargo = val.split(" - ");
    if (!yargo[0] || !yargo[1]) {
      alert("check yr tags");
    } else {
      ftapi.actions.editTag(
        $pvbar.attr('data-type'),
        $pvbar.attr('data-cid'),
        val,
        $pvbar.attr('data-histid')
      );
      document.getElementById('tagEditorPopover').hidePopover();
    }
  });

  // ── Tag editor popover cleanup on auto-dismiss ──
  document.getElementById('tagEditorPopover').addEventListener('toggle', function (e) {
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
