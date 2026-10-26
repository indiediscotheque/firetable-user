/**
 * search.js — YouTube and SoundCloud track & playlist search.
 *
 * Handles:
 * - Track search via YouTube Data API v3 + SoundCloud (through api/soundcloud.php)
 * - Direct link detection (youtube.com/watch, soundcloud.com/…, on.soundcloud.com/…)
 * - Playlist/import search via YouTube + SoundCloud
 * - Dubtrack import file parsing + import
 * - Search source toggle buttons (#ytsearchSelect, #scsearchSelect)
 * - Import source toggle tabs
 */

// ─── YouTube API Helper ──────────────────────────────────────────────────────

/**
 * Call the YouTube Data API v3 directly via AJAX.
 * Avoids gapi client entirely — no discovery loading, no Promise conflicts.
 * @param {string}   resource - API resource path (e.g. 'search', 'videos', 'playlistItems')
 * @param {Object}   params   - Query parameters (key is added automatically)
 * @param {Function} callback - Called with the raw API response object
 */
function ytAPI(resource, params, callback) {
  params.key = ftconfigs.youtubeKey;
  $.ajax({
    url: 'https://www.googleapis.com/youtube/v3/' + resource,
    data: params,
    type: 'GET',
    dataType: 'json',
    success: callback,
    error: function (xhr) {
      var msg = (xhr.responseJSON && xhr.responseJSON.error)
        ? xhr.responseJSON.error.code + ' ' + xhr.responseJSON.error.message
        : xhr.status + ' ' + xhr.statusText;
      console.error('YouTube API error:', msg, xhr.responseJSON || xhr.responseText);
      callback({ items: [] });
    }
  });
}

/**
 * Extract a query-string parameter value from a URL string.
 * @param {string} str - Full URL
 * @param {string} key - Parameter name
 * @returns {string} Decoded parameter value (or empty string)
 */
function getQueryStringValue(str, key) {
  return unescape(
    str.replace(
      new RegExp("^(?:.*[&\\?]" + escape(key).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"),
      "$1"
    )
  );
}

// ─── Track Search Setup ──────────────────────────────────────────────────────

/**
 * Bind the track search (#qsearch) and import search (#plMachine) keyup handlers.
 * Called once from firetable.ui.init().
 */
firetable.ui.setupSearchEvents = function () {
  var $searchItemTemplate = $('#searchResults .pvbar').remove();

  // Status line in a results box (text only, so messages can't inject HTML).
  var showStatus = function (sel, msg) {
    $(sel).empty().append($('<p class="searchStatus"></p>').text(msg));
  };

  // ── Shared helper: bind addtolist + queuetrack buttons on a search result row ──
  var bindSearchResultButtons = function ($srli, mediaCid, mediaType) {
    $srli.find('.addtolist').on('click', function () {
      var listid = $("#listpicker").val();
      var title = firetable.utilities.htmlEscape($srli.find('.listwords').text());
      var cuteid = ftapi.actions.addToList(mediaType, title, mediaCid, listid);
      if (!listid || listid === "0") {
        ftapi.actions.moveTrackToTop(cuteid, ftapi.queueRef, firetable.preview, function(changePV) {
          if (changePV) firetable.preview = changePV;
        });
      } else {
        var plRef = firebase.app("firetable").database().ref("playlists/" + ftapi.uid + "/" + listid + "/list");
        ftapi.actions.moveTrackToTop(cuteid, plRef);
      }
      var $fb = $srli.find('.search-feedback');
      $fb.text('added').addClass('visible');
      setTimeout(function () { $fb.removeClass('visible'); }, 2000);
    });

    $srli.find('.queuetrack').on('click', function () {
      var title = firetable.utilities.htmlEscape($srli.find('.listwords').text());
      firetable.actions.openStealPicker($(this), { cid: mediaCid, type: mediaType, title: title });
    });
  };

  // ── Track Search (Enter in #qsearch) ──
  $("#qsearch").bind("keyup", function (e) {
    if (e.which !== 13) return;
    var txt = $.trim($("#qsearch").val());
    if (!txt) return;
    var source = firetable.utilities.isSCLink(txt) ? MEDIA_SOUNDCLOUD : firetable.searchSelectsChoice;

    if (source === MEDIA_YOUTUBE) {
      // ── YouTube Track Search ──
      var showYTResults = function (response) {
        firetable.debug && console.log('queue search:', response);
        $('#searchResults').html("");
        firetable.utilities.cancelSearchPreview();

        var srchItems = response.items;
        $.each(srchItems, function (index, item) {
          var thecid = item.kind === "youtube#searchResult" ? item.id.videoId : item.id;
          var parsed = firetable.utilities.parseArtistTitle(
            item.snippet.title,
            item.snippet.channelTitle.replace(" - Topic", "")
          );
          var vidTitle = parsed.artist + " - " + parsed.title;
          var pkey = "ytcid" + thecid;

          var $srli = $searchItemTemplate.clone();
          $srli.attr('id', "pvbar" + pkey)
               .attr("data-key", pkey)
               .attr("data-cid", thecid);
          $srli.find('.q-art').css('background-image', 'url(https://img.youtube.com/vi/' + thecid + '/mqdefault.jpg)');
          $srli.find('.previewicon').attr('id', "pv" + pkey).on('click', function () {
            firetable.actions.pview($(this).closest('.pvbar').attr('data-key'), true, MEDIA_YOUTUBE);
          });
          // strip() decodes entities and drops tags (YouTube returns titles
          // HTML-escaped); .text() keeps the result from being parsed as HTML.
          $srli.find('.listwords').text(firetable.ui.strip(vidTitle));
          $srli.find('.pvbarWrap').append('<a class="tracklink-btn" target="_blank" href="https://www.youtube.com/watch?v=' + thecid + '" title="Open on YouTube">' + YT_LOGO_SVG + '</a>');
          bindSearchResultButtons($srli, thecid, MEDIA_YOUTUBE);
          $("#searchResults").append($srli);
        });
      };

      // Check if it's a direct YouTube URL
      var directLink = false;
      var thecid = false;
      if (txt.match(/youtube.com\/watch/)) {
        thecid = getQueryStringValue(txt, "v");
        if (thecid) directLink = true;
      }

      if (directLink) {
        firetable.debug && console.log("direct yt link found");
        ytAPI('videos', { id: thecid, part: 'snippet', maxResults: 1 }, showYTResults);
      } else {
        $('#searchResults').html('<p class="searchStatus">Searching…</p>');
        ytAPI('search', { q: txt, type: 'video', part: 'snippet', maxResults: SEARCH_MAX_RESULTS }, showYTResults);
      }

    } else if (source === MEDIA_SOUNDCLOUD) {
      // ── SoundCloud Track Search ──
      var q = txt;

      var showSCResults = function (tracks) {
        firetable.debug && console.log('sc tracks:', tracks);
        $('#searchResults').html("");
        firetable.utilities.cancelSearchPreview();
        if (!tracks.length) {
          showStatus('#searchResults', 'No playable SoundCloud tracks found.');
          return;
        }

        $.each(tracks, function (index, item) {
          var parsed = firetable.utilities.parseArtistTitle(item.title, (item.user && item.user.username) || "");
          var vidTitle = parsed.artist + " - " + parsed.title;
          var pkey = "sccid" + item.id;

          var $srli = $searchItemTemplate.clone();
          $srli.attr('id', "pvbar" + pkey)
               .attr("data-key", pkey)
               .attr("data-cid", item.id);
          if (item.artwork_url) $srli.find('.q-art').css('background-image', 'url(' + item.artwork_url + ')');
          $srli.find('.previewicon').attr('id', "pv" + pkey).on('click', function () {
            firetable.actions.pview($(this).closest('.pvbar').attr('data-key'), true, MEDIA_SOUNDCLOUD);
          });
          $srli.find('.listwords').text(firetable.ui.strip(vidTitle));
          var $scLink = $('<a class="tracklink-btn" target="_blank" rel="noopener" title="Open on SoundCloud"></a>').html(SC_LOGO_SVG);
          if (/^https:\/\/(?:[a-z0-9-]+\.)?soundcloud\.com\//i.test(item.permalink_url || '')) $scLink.attr('href', item.permalink_url);
          $srli.find('.pvbarWrap').append($scLink);
          bindSearchResultButtons($srli, item.id, MEDIA_SOUNDCLOUD);
          $("#searchResults").append($srli);
        });
      };

      var showSCError = function (err) {
        firetable.utilities.cancelSearchPreview();
        showStatus('#searchResults', err.message || "SoundCloud search failed.");
      };

      showStatus('#searchResults', 'Searching…');
      if (firetable.utilities.isSCLink(q)) {
        firetable.debug && console.log("sc direct link found");
        firetable.actions.resolveSCLink(q).then(function (item) {
          if (item && item.kind === "track") return showSCResults([item]);
          showStatus('#searchResults', item && item.kind === "playlist"
            ? "That's a SoundCloud playlist. Use Import to add it as a list."
            : "That SoundCloud link isn't a track.");
        }, showSCError);
      } else {
        firetable.actions.scSearch('tracks', q).then(showSCResults, showSCError);
      }
    }
  });

  // ── Search Source Toggle Buttons ──
  $("#ytsearchSelect").bind("click", function () {
    $("#scsearchSelect").removeClass("on").attr("aria-selected", "false");
    $(this).addClass("on").attr("aria-selected", "true");
    firetable.searchSelectsChoice = MEDIA_YOUTUBE;
  });
  $("#scsearchSelect").bind("click", function () {
    $("#ytsearchSelect").removeClass("on").attr("aria-selected", "false");
    $(this).addClass("on").attr("aria-selected", "true");
    firetable.searchSelectsChoice = MEDIA_SOUNDCLOUD;
  });

  // ── Import Source Toggle Tabs ──
  $("#ytimportchoice").bind("click", function () {
    firetable.debug && console.log("yt import");
    firetable.importSelectsChoice = MEDIA_YOUTUBE;
  });
  $("#scimportchoice").bind("click", function () {
    firetable.debug && console.log("sc import");
    firetable.importSelectsChoice = MEDIA_SOUNDCLOUD;
  });
  $("#importSources .tab").bind("click", function () {
    $(this).siblings().removeClass('on');
    $(this).addClass('on');
  });

  // ── Import result row builder ──
  // Builds the row with text nodes and a real click handler (no inline
  // onclick), so playlist titles from YouTube/SoundCloud can't inject HTML/JS.
  // `importName` is passed to importList() unchanged, exactly as before.
  var appendImportResult = function (label, href, listID, importName, type) {
    var $row = $('<div class="importResult"></div>');
    $('<div class="imtxt"></div>').text(firetable.ui.strip(label)).appendTo($row);
    var $link = $('<a target="_blank" class="importLinkCheck"><i class="material-symbols-filled">&#xE250;</i></a>');
    if (/^https:\/\//i.test(href || '')) $link.attr('href', href);
    $row.append($link).append(' ');
    $('<i role="button" class="material-symbols-filled" title="Import">&#xE02E;</i>')
      .on('click', function () {
        firetable.actions.importList(String(listID), importName, type);
      })
      .appendTo($row);
    $("#importResults").append($row);
  };

  // ── Playlist/Import Search (#plMachine) ──
  $("#plMachine").bind("keyup", function (e) {
    if (e.which !== 13) return;
    var val = $("#plMachine").val();
    if (!val) return;
    $("#importResults").html("");
    $("#plMachine").val("");
    var searchFrom = firetable.importSelectsChoice;

    if (searchFrom === MEDIA_YOUTUBE) {
      // ── YouTube Playlist Search ──
      var listID;
      var directLink = false;

      // Check for direct playlist URL
      if (val.match(/youtube.com\/watch/) || val.match(/youtube.com\/playlist/)) {
        listID = getQueryStringValue(val, "list");
        if (listID) directLink = true;
      }

      if (directLink) {
        ytAPI('playlists', { id: listID, part: 'snippet' }, function (response) {
          if (response.items && response.items.length === 1) {
            var item = response.items[0];
            appendImportResult(
              item.snippet.title + ' by ' + item.snippet.channelTitle,
              'https://www.youtube.com/playlist?list=' + encodeURIComponent(listID),
              listID, item.snippet.title, MEDIA_YOUTUBE
            );
          }
        });
      } else {
        ytAPI('search', { q: val, type: 'playlist', part: 'snippet', maxResults: SEARCH_MAX_RESULTS }, function (response) {
          firetable.debug && console.log('import search results:', response);
          $.each(response.items || [], function (index, item) {
            appendImportResult(
              item.snippet.title + ' by ' + item.snippet.channelTitle,
              'https://www.youtube.com/playlist?list=' + encodeURIComponent(item.id.playlistId),
              item.id.playlistId, item.snippet.title, MEDIA_YOUTUBE
            );
          });
        });
      }

    } else if (searchFrom === MEDIA_SOUNDCLOUD) {
      // ── SoundCloud Playlist Search ──
      var appendSCList = function (item) {
        appendImportResult(
          item.title + ' by ' + ((item.user && item.user.username) || 'unknown') + ' (' + firetable.utilities.pluralize(item.track_count, "song") + ')',
          item.permalink_url, item.id, item.title, MEDIA_SOUNDCLOUD
        );
      };
      var showImportError = function (err) {
        showStatus('#importResults', err.message || "SoundCloud search failed.");
      };

      showStatus('#importResults', 'Searching…');
      if (firetable.utilities.isSCLink(val)) {
        // Direct set URL (also accepts short on.soundcloud.com links)
        firetable.actions.resolveSCLink(val).then(function (item) {
          $("#importResults").html("");
          if (item && item.kind === "playlist" && item.sharing !== "private") return appendSCList(item);
          showStatus('#importResults', "That link isn't a public SoundCloud playlist.");
        }, showImportError);
      } else {
        // Keyword search for playlists
        firetable.actions.scSearch('playlists', val).then(function (lists) {
          $("#importResults").html("");
          lists = $.grep(lists, function (item) { return item.sharing !== "private"; });
          if (!lists.length) return showStatus('#importResults', 'No public SoundCloud playlists found.');
          $.each(lists, function (i, item) { appendSCList(item); });
        }, showImportError);
      }
    }
  });
};
