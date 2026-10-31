/**
 * room.js — Room state event handlers.
 *
 * Handles all ftapi events related to room state:
 * - newSong: Load new track, start countdown/progress, Last.fm scrobble timer
 * - newProduce / newHistory: Render discover/history items
 * - editedHistory: Update edited tag in history list
 * - modCheck: Show/hide mod-only edit buttons
 * - newTheme: Display the current room theme
 * - tagUpdate: Update now-playing metadata when tags are edited
 * - screenStateChanged / danceStateChanged: Toggle video screen / dance mode
 * - lightsChanged / colorsChanged: Festive lights CSS + accent color
 * - tableChanged: Render the DJ table (up to 4 spots)
 * - waitlistChanged: Render the waitlist
 * - spotlightStateChanged / playLimitChanged: Highlight active DJ, update limit
 * - banListChanged: Render active suspensions in mod panel
 *
 * BUG FIXES applied in this file:
 * - `firstpart == "sc"` → `firstpart = "sc"` (was comparison, should be assignment)
 *   This caused SoundCloud tracks in history/discover to always get "yt" prefix.
 */

// ─── Beat (#143) ──────────────────────────────────────────────────────────────

/**
 * Match the stage animations to the playing song's tempo (from songBpm). Sets
 * --beat (one beat), --bop (one DJ bob: a beat, or two for fast songs) and
 * --beat-phase (so the bobbing lines up with the song's start, not page load)
 * on <html>, and shows "128 BPM" under the artist.
 */
firetable.ui.applyBeat = function () {
  var b = firetable.songBpm, s = firetable.song, root = document.documentElement;
  var bpm = b && s && b.started === s.started && Number(b.bpm);
  var $label = $("#npBpm");
  if (!(bpm >= 40 && bpm <= 250)) {
    document.body.classList.remove("has-beat");
    root.style.removeProperty("--beat");
    root.style.removeProperty("--bop");
    root.style.removeProperty("--beat-phase");
    $label.prop("hidden", true).text("");
    return;
  }
  var beat = 60 / bpm;
  var bop = bpm > 150 ? beat * 2 : beat;
  var elapsed = Math.max(0, (ftapi.now() - s.started) / 1000);
  root.style.setProperty("--beat", beat.toFixed(4) + "s");
  root.style.setProperty("--bop", bop.toFixed(4) + "s");
  root.style.setProperty("--beat-phase", (-(elapsed % (beat * 2))).toFixed(3) + "s");
  document.body.classList.add("has-beat");
  $label.prop("hidden", false).text(Math.round(bpm) + " BPM")
    .attr("title", b.src === "manual" ? "Tempo set by the DJ or a mod" : "Tempo from Deezer. The DJ or a mod can fix it with !bpm 128");
};

// ─── History Item Renderer ────────────────────────────────────────────────────

/**
 * Build and attach a history/discover item to the DOM.
 * Extracted from the nearly-identical newProduce / newHistory handlers.
 *
 * @param {Object} data          - Track data from ftapi
 * @param {jQuery} $template     - Cloneable template element
 * @param {string} containerSel  - jQuery selector for the target container
 * @param {boolean} [older]      - Recent plays only: add below everything shown
 *                                 (for "Show older plays") instead of on top
 */
function renderHistoryItem(data, $template, containerSel, older) {
  if (data.img === "img/idlogo.png" && ftconfigs.defaultAlbumArtUrl.length) {
    data.img = ftconfigs.defaultAlbumArtUrl;
  }

  // BUG FIX: was `firstpart == "sc"` (comparison), now `firstpart = "sc"` (assignment)
  var firstpart = "yt";
  if (data.type == 2) firstpart = "sc";

  var pkey = firstpart + "cid" + data.cid;
  var $histItem = $template.clone();

  $histItem.attr('id', "pvbar" + pkey)
           .attr("data-key", pkey)
           .attr("data-histid", data.histID)
           .attr("data-list", containerSel === "#thediscovers" ? "newMusic" : "songHistory")
           .attr("data-cid", data.cid)
           .attr("data-type", data.type)
           .attr("data-tag", data.artist + " - " + data.title);

  // Preview button
  $histItem.find('.previewicon').attr('id', "pv" + pkey).on('click', function () {
    firetable.actions.pview(
      $(this).closest('.pvbar').attr('data-key'),
      true,
      $(this).closest('.pvbar').attr('data-type'),
      true
    );
  });

  // Track link
  var titleText = firetable.ui.strip(data.title || "");
  var artistText = firetable.ui.strip(data.artist || "");
  var isFresh = containerSel === "#thediscovers";
  var $histLink = $histItem.find(isFresh ? '.fresh-title' : '.histlink').attr('id', data.histID);
  if (isFresh) {
    $histLink.html(
      '<span class="fresh-track-title">' + firetable.utilities.htmlEscape(titleText) + '</span>' +
      '<span class="fresh-track-artist">' + firetable.utilities.htmlEscape(artistText) + '</span>'
    );
  } else {
    $histLink.text(artistText + " - " + titleText);
  }
  var platform = data.type == MEDIA_SOUNDCLOUD ? 'SoundCloud' : 'YouTube';
  $histItem.find('.tracklink-btn')
    .attr({ href: data.url || '', title: 'Open on ' + platform, 'aria-label': 'Open on ' + platform })
    .html(data.type == MEDIA_SOUNDCLOUD ? SC_LOGO_SVG : YT_LOGO_SVG);

  // Edit tags button (mod only)
  $histItem.find('.edittags').on('click', function () {
    var popoverEl = document.getElementById('tagEditorPopover');
    var $pvbar = $(this).closest('.pvbar');
    if (popoverEl.matches(':popover-open') && firetable.editingPvbar && firetable.editingPvbar.is($pvbar)) {
      popoverEl.hidePopover();
    } else {
      firetable.actions.editTagsPrompt(
        $pvbar.attr('data-key'),
        $pvbar.attr('data-tag') || (data.artist + " - " + data.title),
        this
      );
    }
  });
  if (!ftapi.isMod) $histItem.find('.edittags').hide();

  // Flag (mods, #167): flags this track in the DJ's playlists via the bot
  $histItem.find('.flagplay').on('click', function () {
    firetable.ui.openFlagMenu(this, { histID: data.histID, label: (data.artist || '') + ' - ' + (data.title || '') });
  });

  // Metadata
  $histItem.find('.histdj').text(data.dj);
  $histItem.find('.pv-dj-avatar')
    .attr({ 'data-avatar-uid': data.djid || null, 'data-avatar-size': '40x40' })
    .css('background-image', 'url(' + firetable.utilities.avatarURL(data.djid || data.dj, data.dj, '40x40') + ')')
    .attr('aria-label', data.dj);
  $histItem.find('.dj-avatar-tip').attr('label', data.dj);
  $histItem.find('.histdate').text(firetable.utilities.format_date(data.when));
  $histItem.find('.histtime').text(firetable.utilities.format_time(data.when));

  // Add-to-playlist button (shows playlist picker dropdown)
  $histItem.find('.histeal').attr('id', "apv" + data.type + data.cid).on('click', function () {
    var $btn = $(this);
    var btnCid = $(this).closest('.pvbar').attr('data-cid');
    var btnType = parseInt($(this).closest('.pvbar').attr('data-type'), 10);
    var btnImg = $(this).closest('.pvbar').attr('data-img') || '';
    // Recent rows use .histlink; Fresh rows use .fresh-title (with artist/title spans)
    var $histlink = $(this).closest('.pvbar').find('.histlink, .fresh-title').first();
    var $trackTitle = $histlink.find('.fresh-track-title');
    var $trackArtist = $histlink.find('.fresh-track-artist');
    var btnTitle = ($trackTitle.length && $trackArtist.length)
      ? $trackArtist.text().trim() + ' - ' + $trackTitle.text().trim()
      : $histlink.text();

    firetable.actions.openStealPicker($btn, { cid: btnCid, type: btnType, title: btnTitle, img: btnImg, url: data.url || '', djid: data.djid || '' });
  });

  // Album art
  $histItem.find('.pv-art').css('background-image', 'url(' + data.img + ')');
  // Cache img by cid so playlist renderer can use it even without Firebase storage
  if (data.img && data.cid) {
    firetable.imgCache = firetable.imgCache || {};
    firetable.imgCache[data.cid] = data.img;
  }
  $histItem.attr('data-img', data.img || '');

  if (containerSel === "#thehistory") {
    var dateKey = firetable.utilities.format_date(data.when);
    var when = new Date(data.when);
    var dateLabel = when.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var $dayGroup = $('#thehistory .hist-day-group[data-date="' + dateKey + '"]');
    if ($dayGroup.length === 0) {
      $dayGroup = $(
        '<div class="hist-day-group" data-date="' + dateKey + '">' +
        '<div class="hist-day-header" role="button" tabindex="0" aria-expanded="true">' + dateLabel + '</div>' +
        '<div class="hist-day-items"></div>' +
        '</div>'
      );
      if (!older) $dayGroup.prependTo('#thehistory');
      else if ($('#histMore').length) $dayGroup.insertBefore('#histMore');
      else $dayGroup.appendTo('#thehistory');
    }
    var timeStr = firetable.utilities.format_time(data.when);
    var $avatar = $histItem.find('.dj-avatar-tip').detach();
    var entryHour = new Date(data.when).getHours();
    var $entry = $('<div class="hist-entry" data-hour="' + entryHour + '" data-when="' + Number(data.when) + '"></div>');
    $('<span class="hist-timestamp">' + timeStr + '</span>').appendTo($entry);
    $avatar.appendTo($entry);
    $histItem.appendTo($entry);
    var $dayItems = $dayGroup.find('.hist-day-items');

    if (older) {
      // Below the newer plays; an hour marker (labelled with the newer play's
      // hour, like the ones added on top) goes between them when the hour changes
      var $prevEntry = $dayItems.children('.hist-entry').last();
      $entry.appendTo($dayItems);
      if ($prevEntry.length) {
        var prevHour = parseInt($prevEntry.attr('data-hour'), 10);
        if (prevHour !== entryHour) {
          var prevDate = new Date(parseInt($prevEntry.attr('data-when'), 10));
          prevDate.setMinutes(0, 0, 0);
          $('<div class="hist-hour-marker"><span class="hist-hour-label">' +
            prevDate.toLocaleTimeString(undefined, { hour: 'numeric' }) + '</span></div>').insertAfter($prevEntry);
        }
      }
      return;
    }
    $entry.prependTo($dayItems);

    // Insert an hour marker when crossing an hour boundary
    var $nextEntry = $entry.next('.hist-entry');
    if ($nextEntry.length) {
      var nextHour = parseInt($nextEntry.attr('data-hour'), 10);
      if (entryHour !== nextHour) {
        var markerDate = new Date(data.when);
        markerDate.setMinutes(0, 0, 0);
        var hourLabel = markerDate.toLocaleTimeString(undefined, { hour: 'numeric' });
        $('<div class="hist-hour-marker"><span class="hist-hour-label">' + hourLabel + '</span></div>').insertAfter($entry);
      }
    }
  } else {
    $histItem.prependTo(containerSel);
  }
}

/**
 * Format whole seconds as MM:SS (minutes keep counting past 59, e.g. 62:08).
 * @param {number} secs
 * @returns {string}
 */
function formatClock(secs) {
  secs = Math.max(0, secs || 0);
  var m = Math.floor(secs / 60), sec = secs % 60;
  return (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
}

/**
 * Make a song title / artist / DJ name safe to place inside HTML.
 * strip() matches how #track and #artist display these values (entities
 * decoded, tags dropped); htmlEscape() stops the result being parsed as HTML.
 * @param {*} value
 * @returns {string}
 */
function nowPlayingText(value) {
  if (value === undefined || value === null) return '';
  return firetable.utilities.htmlEscape(firetable.ui.strip(String(value)));
}

// ─── Room Event Binding ──────────────────────────────────────────────────────

/**
 * Set up all room-state ftapi event handlers.
 * Called once from firetable.ui.init().
 */
/**
 * Show or hide the stage string lights: manual switch OR seasonal (December).
 */
firetable.ui.applyLights = function () {
  firetable.lights = firetable.lightsManual || firetable.utilities.seasonalLights(new Date());
  $("body").toggleClass("lights-on", firetable.lights);
};

firetable.ui.setupRoomEvents = function () {
  var NOW_PLAYING_TEXT_FADE_MS = 180;
  var NOW_PLAYING_ALBUM_FLIP_MS = 560;

  function positionFyreAtActiveDJ() {
    var $fyre = $("#fyre");
    var $stage = $("#djStage");
    if (!$fyre.length || !$stage.length) return;

    var $activeSpot = $("#deck .spot:not(.empty)").first();
    if (!$activeSpot.length) {
      $fyre.hide();
      return;
    }

    var stageRect = $stage[0].getBoundingClientRect();
    var spotRect = $activeSpot[0].getBoundingClientRect();
    var centerX = spotRect.left - stageRect.left + (spotRect.width / 2);
    var width = Math.max(96, Math.min(spotRect.width * 1.35, stageRect.width * 0.45));
    var height = Math.max(120, Math.min(spotRect.width * 2.1, stageRect.height * 0.9));

    $fyre.css({
      left: centerX + "px",
      width: width + "px",
      height: height + "px"
    }).show();

    if (firetable.fyreStage && typeof firetable.fyreStage.onResize === "function") {
      firetable.fyreStage.onResize();
    }
  }

  // useAnchor: keep the DJ already shown as playing in the spotlight, wherever
  // their seat moved to. The table and the spotlight index arrive as separate
  // updates, so a seat number alone can briefly point at the wrong DJ (someone
  // who just joined would show as playing, or the on-deck order would start
  // from the wrong seat).
  function renderDeckAndQueue(data, activeIdx, useAnchor) {
    var deckHtml = '';
    var onDeckDjs = [];
    var isSelfOnDeck = false;

    if (data) {
      // Collect all DJs in Firebase's natural for-in order.
      // The bot controls slot assignment and playdex; for-in in V8 preserves
      // Firebase's child ordering, so activeIdx correctly indexes into allDjs.
      // Do NOT sort by key — the bot may use non-push-key schemes (numeric slots,
      // user IDs, etc.) where key order ≠ queue order.
      var allDjs = [];
      for (var key in data) {
        if (!data.hasOwnProperty(key)) continue;
        var dj = data[key];
        if (dj.id === ftapi.uid) isSelfOnDeck = true;
        allDjs.push({ tableKey: key, id: dj.id, name: dj.name, plays: dj.plays, removeAfter: dj.removeAfter });
      }

      // Seats can shift mid-song (a DJ joins or leaves before the spotlight).
      // Unless a song change is still being animated in, keep the highlight on
      // the DJ whose song is playing.
      var anchored = false;
      if (useAnchor && firetable.displayedDjId) {
        for (var a = 0; a < allDjs.length; a++) {
          if (allDjs[a].id === firetable.displayedDjId) { activeIdx = a; anchored = true; break; }
        }
      }
      var songDj = firetable.song && firetable.song.djid;
      if (!anchored && songDj && firetable._djActiveTimer === undefined &&
          !(allDjs[activeIdx] && allDjs[activeIdx].id === songDj)) {
        for (var d = 0; d < allDjs.length; d++) {
          if (allDjs[d].id === songDj) { activeIdx = d; break; }
        }
      }

      if (!(activeIdx >= 0 && activeIdx < allDjs.length)) activeIdx = 0;
      firetable.displayedDjId = allDjs.length ? allDjs[activeIdx].id : null;
      firetable.displayedPlaydex = activeIdx;

      if (activeIdx < allDjs.length) {
        var activeEntry = allDjs[activeIdx];
        var tableKey = activeEntry.tableKey;
        var djId = activeEntry.id;
        var djName = activeEntry.name;
        var djPlays = activeEntry.plays;

        var isGhost = !!(ftapi.users !== null && typeof ftapi.users === 'object' && !ftapi.users[djId]);
        var isSelf = djId === ftapi.uid;
        var ownUser = ftapi.uid && ftapi.users && ftapi.users[ftapi.uid];
        var isMod = ownUser && (ownUser.mod || ownUser.supermod);
        var isHostbot = !!(ftapi.users && ftapi.users[djId] && ftapi.users[djId].hostbot);
        var showBtn = isSelf || isMod;
        var showDeparture = isSelf && !isHostbot;
        var btnIcon = isSelf ? 'close' : 'person_remove';
        var btnTitle = isSelf ? 'Step down' : 'Remove from deck';
        var actionBtn = showBtn
          ? '<button class="iconbutt deckRemoveBtn" data-userid="' + djId + '" data-tablekey="' + tableKey + '" title="' + btnTitle + '"><i class="material-symbols-filled">' + btnIcon + '</i></button>'
          : '';
        var departureIndicator;
        if (showDeparture) {
          var djDisplayName = firetable.utilities.htmlEscape(djName);
          var hasPending = _pendingDeparture.hasOwnProperty(djId);
          var removeAfterValue = hasPending ? _pendingDeparture[djId] : activeEntry.removeAfter;
          if (hasPending && !!activeEntry.removeAfter === !!_pendingDeparture[djId]) {
            delete _pendingDeparture[djId];
          }
          var departureTitleOff = isSelf ? 'Step down after your next play' : 'Have ' + djDisplayName + ' step down after their next play';
          var departureTitleOn  = isSelf ? "Don't step down after your next play" : "Don't have " + djDisplayName + ' step down after their next play';
          var departureTitle = removeAfterValue ? departureTitleOn : departureTitleOff;
          departureIndicator = '<button class="iconbutt deckDepartureBtn' + (removeAfterValue ? ' on' : '') + '" data-tablekey="' + tableKey + '" data-userid="' + djId + '" data-djname="' + djDisplayName + '" title="' + departureTitle + '"><i class="material-symbols-filled">departure_board</i></button>';
        } else if (activeEntry.removeAfter) {
          departureIndicator = '<span class="removemeIcon material-symbols-filled" title="Stepping down after this song">departure_board</span>';
        } else {
          departureIndicator = '';
        }

        deckHtml = '<div id="spt0" class="spot' + (isGhost ? ' ghost' : '') + '">' +
          '<div class="avtr animate" id="avtr0" style="background-image: url(' +
          firetable.utilities.htmlEscape(firetable.utilities.avatarURL(djId, djName)) + ');"></div>' +
          '<div id="djthing0" class="djplaque djActive">' +
          '<div class="djname">' + firetable.utilities.htmlEscape(djName) + '</div>' +
          departureIndicator + actionBtn +
          '<div class="playcount">' + djPlays + '/<span id="plimit0">' + firetable.playlimit + '</span></div>' +
          '</div></div>';
      }

      // Build on-deck in rotation order: the DJ immediately after the active one
      // goes first, wrapping around so the previously-active DJ is always last.
      for (var j = 1; j < allDjs.length; j++) {
        var rotIdx = (activeIdx + j) % allDjs.length;
        var entry = allDjs[rotIdx];
        onDeckDjs.push({ tableKey: entry.tableKey, id: entry.id, name: entry.name, plays: entry.plays });
      }

      if (!deckHtml) {
        var stepUpBtn = isSelfOnDeck
          ? '&nbsp;'
          : '<button class="butt graybutt small addmeButt" role="button">Play <span class="material-symbols-filled">queue_music</span></button>';
        deckHtml = '<div class="spot empty"><div class="djplaque">' + stepUpBtn + '</div></div>';
      }
    } else {
      deckHtml = '<div class="spot empty"><div class="djplaque"><button class="butt graybutt small addmeButt" role="button">Play <span class="material-symbols-filled">queue_music</span></button></div></div>';
    }

    // Always render exactly 3 on-deck slots to the right of the active DJ;
    var ondeckHtml = '<div class="on-deck">';
    for (var s = 0; s < 3; s++) {
      var odj = onDeckDjs[s];
      if (odj) {
        ondeckHtml += '<button class="ondeck-slot" data-djid="' + odj.id + '" data-plays="' + (odj.plays || 0) + '" aria-label="' +
          firetable.utilities.htmlEscape(odj.name) + '">' +
          '<div class="ft-avatar" style="background-image: url(' +
          firetable.utilities.htmlEscape(firetable.utilities.avatarURL(odj.id, odj.name, '40x40')) + ')"></div>' +
          '</button>';
      } else {
        ondeckHtml += '<button class="ondeck-slot empty" aria-label="Add to DJ list"' + (isSelfOnDeck ? ' disabled' : '') + '></button>';
      }
    }
    ondeckHtml += '</div>';

    $("#deck").html(deckHtml);
    $("#ondeck").html(ondeckHtml);
    $("#deckQueue").empty();

    firetable.ui.applyDeckPlacement && firetable.ui.applyDeckPlacement();

    $("#deck").off('click.addme').on('click.addme', '.addmeButt', function () {
      ftapi.actions.sendBotCommand("!addme");
    });
    $("#ondeck").off('click.addme').on('click.addme', '.ondeck-slot.empty', function () {
      ftapi.actions.sendBotCommand("!addme");
    });
    // Only your own departure button is drawn. The bot keeps its own copy of
    // the deck (and the rules only let the bot write table/), so this always
    // goes through a bot command.
    $("#deck").off('click.departure').on('click.departure', '.deckDepartureBtn', function () {
      var $btn = $(this);
      var userId = $btn.attr('data-userid');
      if (userId !== ftapi.uid) return;
      var newIsOn = !$btn.hasClass('on');
      $btn.toggleClass('on', newIsOn);
      $btn.attr('title', newIsOn
        ? 'You are taking the bus after your next play'
        : 'You will not be taking the bus after your next play');
      _pendingDeparture[userId] = newIsOn ? true : null;
      ftapi.actions.sendBotCommand(newIsOn ? '!removeafter' : '!dontremoveme');
    });
    $("#deck").off('click.remove').on('click.remove', '.deckRemoveBtn', function () {
      var userId = $(this).attr('data-userid');
      if (userId === ftapi.uid) {
        ftapi.actions.sendBotCommand("!removeme");
      } else {
        var djName = firetable.tableData && (function () {
          for (var k in firetable.tableData) {
            if (firetable.tableData.hasOwnProperty(k) && firetable.tableData[k].id === userId)
              return firetable.tableData[k].name;
          }
        })();
        if (djName) ftapi.actions.sendBotCommand("!remove " + djName);
      }
    });

    positionFyreAtActiveDJ();
  }

  function applyDjActive(idx) {
    renderDeckAndQueue(firetable.tableData, idx);
  }

  function toCssBackgroundImage(url) {
    if (!url) return 'none';
    // Resolve against the page: a relative path inside a CSS variable would
    // otherwise resolve against css/ (e.g. the default "img/idlogo.png").
    try { url = new URL(String(url), document.baseURI).href; } catch (e) { /* keep as-is */ }
    return 'url("' + String(url).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")';
  }

  function setNowPlayingAlbumArt(imageUrl, animate) {
    var artEl = document.getElementById('albumArt');
    if (!artEl) return;
    artEl.classList.remove('skel');

    var currentUrl = artEl.dataset.albumArtCurrent || '';
    var nextUrl = imageUrl || '';
    var cssImage = toCssBackgroundImage(nextUrl);

    clearTimeout(firetable.albumArtFlipTimer);

    if (!animate || !artEl.dataset.albumArtReady) {
      artEl.style.setProperty('--album-art-front', cssImage);
      artEl.style.setProperty('--album-art-back', cssImage);
      artEl.classList.remove('is-flipping');
      artEl.dataset.albumArtReady = 'true';
      artEl.dataset.albumArtCurrent = nextUrl;
      return;
    }

    if (currentUrl === nextUrl) return;

    artEl.style.setProperty('--album-art-back', cssImage);
    artEl.classList.add('is-flipping');
    firetable.albumArtFlipTimer = setTimeout(function () {
      artEl.classList.add('is-flip-resetting');
      artEl.style.setProperty('--album-art-front', cssImage);
      artEl.style.setProperty('--album-art-back', cssImage);
      artEl.classList.remove('is-flipping');
      void artEl.offsetWidth;
      artEl.classList.remove('is-flip-resetting');
      artEl.dataset.albumArtCurrent = nextUrl;
    }, NOW_PLAYING_ALBUM_FLIP_MS);
  }

  function animateNowPlayingChange(updateFn) {
    var $nowPlaying = $('#nowplaying');
    clearTimeout(firetable.nowPlayingTextTimer);

    if (!$nowPlaying.data('nowPlayingAnimated')) {
      updateFn();
      $nowPlaying.data('nowPlayingAnimated', 'true');
      return;
    }

    $nowPlaying.addClass('is-transitioning');
    firetable.nowPlayingTextTimer = setTimeout(function () {
      updateFn();
      requestAnimationFrame(function () {
        $nowPlaying.removeClass('is-transitioning');
      });
    }, NOW_PLAYING_TEXT_FADE_MS);
  }

  $(window).off('resize.fyrePosition').on('resize.fyrePosition', positionFyreAtActiveDJ);

  // ── Discover (Recently Played by Others) ──
  var $discoverItem = $('#thediscovers .pvbar').remove();
  firetable._produceCache = firetable._produceCache || [];
  ftapi.events.on('newProduce', function (data) {
    firetable._produceCache.push(data);
    renderHistoryItem(data, $discoverItem, "#thediscovers");
  });

  // ── History (Your Play History) ──
  var $historyItem = $('#thehistory .pvbar').remove();
  firetable._historyCache = firetable._historyCache || [];

  // Filter Recent plays. Only the plays are hidden: day headers and hour
  // markers always stay, so the timeline keeps its shape with no matches and
  // plays come back as soon as the text matches again. Every row is decided
  // before any is changed, so a long history is restyled once, not per row.
  function applyHistoryFilter() {
    var q = ($("#histFilter").val() || "").toLowerCase().trim();
    var root = document.getElementById("thehistory");
    if (!root) return;
    var entries = root.querySelectorAll(".hist-entry");
    var hide = [], shown = 0;
    for (var i = 0; i < entries.length; i++) {
      var link = entries[i].querySelector(".histlink");
      var dj = entries[i].querySelector(".histdj");
      var text = ((link ? link.textContent : "") + " " + (dj ? dj.textContent : "")).toLowerCase();
      hide.push(q.length > 0 && text.indexOf(q) === -1);
      if (!hide[i]) shown++;
    }
    for (i = 0; i < entries.length; i++) entries[i].classList.toggle("ft-filtered", hide[i]);
    root.classList.toggle("overFiltered", q.length > 0 && entries.length > 0 && shown === 0);
  }

  $(document).on('input.histfilter', '#histFilter', applyHistoryFilter);

  $(document).on('click', '#thehistory .hist-day-header', function () {
    var $group = $(this).closest('.hist-day-group').toggleClass('collapsed');
    $(this).attr('aria-expanded', String(!$group.hasClass('collapsed')));
  });

  // Only the latest plays load at first. Scrolling near the bottom of the
  // list loads the next page automatically (the button is a fallback), all
  // the way back through the stored history.
  firetable._historyHasOlder = true;
  var historyLoading = false;
  var historyObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) loadOlderHistory();
      }, { root: document.getElementById('thehistory'), rootMargin: '0px 0px 600px 0px' })
    : null;

  function syncHistoryMoreButton() {
    var show = firetable._historyHasOlder && ftapi.historyLoaded >= HISTORY_PAGE_SIZE;
    var $btn = $('#histMore');
    if (!show) {
      if ($btn.length && historyObserver) historyObserver.unobserve($btn[0]);
      $btn.remove();
      return;
    }
    if (!$btn.length) {
      $btn = $('<button type="button" id="histMore" class="butt graybutt small">Show older plays</button>');
    }
    $btn.prop('disabled', false).text('Show older plays').appendTo('#thehistory'); // always last
    if (historyObserver) { historyObserver.unobserve($btn[0]); historyObserver.observe($btn[0]); }
  }

  function loadOlderHistory() {
    if (historyLoading || !firetable._historyHasOlder) return;
    historyLoading = true;
    $('#histMore').prop('disabled', true).text('Loading older plays…');
    ftapi.lookup.olderHistory(function (plays, hasMore) {
      historyLoading = false;
      firetable._historyHasOlder = hasMore;
      // plays come oldest-first; add newest-first below what's shown
      for (var i = plays.length - 1; i >= 0; i--) {
        renderHistoryItem(plays[i], $historyItem, "#thehistory", true);
      }
      firetable._historyCache = plays.concat(firetable._historyCache);
      applyHistoryFilter();
      syncHistoryMoreButton(); // re-observing loads the next page if still in view
    });
  }
  $(document).on('click', '#histMore', loadOlderHistory);

  var historyButtonSoon = firetable.utilities.oncePerFrame(syncHistoryMoreButton);
  ftapi.events.on('newHistory', function (data) {
    firetable._historyCache.push(data);
    renderHistoryItem(data, $historyItem, "#thehistory");
    applyHistoryFilter();
    historyButtonSoon();
  });

  // ── Re-render history/discover after re-login ──
  // Firebase won't re-fire child_added for already-seen items after a logout/login
  // cycle, so replay from cache into the now-reattached containers.
  ftapi.events.on('loggedIn', function () {
    if (firetable._produceCache && firetable._produceCache.length) {
      $('#thediscovers').empty();
      firetable._produceCache.forEach(function (data) {
        renderHistoryItem(data, $discoverItem, "#thediscovers");
      });
    }
    if (firetable._historyCache && firetable._historyCache.length) {
      $('#thehistory').empty();
      firetable._historyCache.forEach(function (data) {
        renderHistoryItem(data, $historyItem, "#thehistory");
      });
      applyHistoryFilter();
      syncHistoryMoreButton();
    }
  });

  // ── Edited History (tag correction) ──
  // A tag correction: from a mod here, or from the live window of recent plays
  ftapi.events.on('editedHistory', function (data) {
    var tag = data.artist + " - " + data.title;
    var el = document.getElementById(data.histID);
    if (el) {
      var $el = $(el);
      var $title = $el.find('.fresh-track-title'), $artist = $el.find('.fresh-track-artist');
      if ($title.length && $artist.length) {
        $title.text(firetable.ui.strip(data.title || ''));
        $artist.text(firetable.ui.strip(data.artist || ''));
      } else {
        $el.text(firetable.ui.strip(data.artist || '') + " - " + firetable.ui.strip(data.title || ''));
      }
      $el.closest('.pvbar').attr('data-tag', tag);
    }
    // keep the cached copies (used to redraw after logging back in) in step
    [firetable._historyCache, firetable._produceCache].forEach(function (cache) {
      (cache || []).forEach(function (item) {
        if (item.histID === data.histID) { item.artist = data.artist; item.title = data.title; }
      });
    });
    applyHistoryFilter();
  });

  // body.is-current-dj while your own song plays: shows the stage's skip
  // button to DJs who aren't mods (mods skip from Mod tools)
  firetable.ui.markCurrentDj = function () {
    var song = firetable.song;
    $("body").toggleClass("is-current-dj", !!(ftapi.uid && song && song.cid != 0 && song.djid === ftapi.uid));
  };

  // ── Mod Check (show edit buttons for mods) ──
  ftapi.events.on('modCheck', function (data) {
    if (data) $(".edittags").show();
    $("body").toggleClass("is-mod", !!data);
  });
  ftapi.events.on('loggedOut', function () { $("body").removeClass("is-mod is-current-dj"); });
  ftapi.events.on('loggedIn', function () { firetable.ui.markCurrentDj(); });

  // ── Flag a track (mods): now playing (#125) or a play in Recent (#167) ──
  var flagMenuEl = document.getElementById('flagMenuPopover');
  firetable.ui.openFlagMenu = function (btn, target) {
    var same = firetable.flagTarget && firetable.flagBtn === btn;
    if (flagMenuEl.matches(':popover-open')) flagMenuEl.hidePopover();
    if (same) return;
    firetable.flagTarget = target;
    firetable.flagBtn = btn;
    $('#flagMenuTitle').text('Flag "' + firetable.ui.strip(target.label || '') + '" as');
    flagMenuEl.style.visibility = 'hidden';
    flagMenuEl.showPopover();
    firetable.ui.positionPopover(btn, flagMenuEl, document.getElementById('flagMenuArrow'), 'bottom').then(function () {
      var first = flagMenuEl.querySelector('[role="menuitem"]');
      if (first) first.focus();
    });
  };
  flagMenuEl.addEventListener('toggle', function (e) {
    if (e.newState === 'closed') { firetable.flagTarget = null; firetable.flagBtn = null; }
  });
  $(flagMenuEl).on('click', '[data-flag]', function () {
    var t = firetable.flagTarget, reason = $(this).attr('data-flag');
    flagMenuEl.hidePopover();
    if (!t) return;
    if (t.histID) {
      ftapi.actions.sendBotCommand('!flagplay ' + t.histID + ' ' + reason);
    } else if (firetable.song && firetable.song.started === t.started) {
      ftapi.actions.sendBotCommand('!flag ' + reason);
    } else {
      firetable.ui.toast("That song has ended. Flag it from Recent instead.", "error");
    }
  }).on('keydown', function (e) {
    var $items = $(flagMenuEl).find('[role="menuitem"]');
    var idx = $items.index($items.filter(':focus'));
    if (e.key === 'ArrowDown') { e.preventDefault(); $items.eq((idx + 1) % $items.length).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); $items.eq((idx - 1 + $items.length) % $items.length).focus(); }
  });
  // ── Mod tools menu on the stage ──
  var npModMenu = document.getElementById('npModMenu');
  var npModBtn = document.getElementById('npModBtn');
  npModMenu.addEventListener('toggle', function (e) {
    npModBtn.classList.toggle('on', e.newState === 'open');
    if (e.newState !== 'open') return;
    npModMenu.style.visibility = 'hidden';
    firetable.ui.positionPopover(npModBtn, npModMenu, document.getElementById('npModArrow')).then(function () {
      var first = npModMenu.querySelector('[role="menuitem"]');
      if (first) first.focus();
    });
  });
  $(npModMenu).on('keydown', function (e) {
    var $items = $(npModMenu).find('[role="menuitem"]');
    var idx = $items.index($items.filter(':focus'));
    if (e.key === 'ArrowDown') { e.preventDefault(); $items.eq((idx + 1) % $items.length).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); $items.eq((idx - 1 + $items.length) % $items.length).focus(); }
  });

  // Skip is a mod action (#233); the DJ playing now skips their own track
  // with the stage's skip button instead.
  $('#npSkip').on('click', function () {
    npModMenu.hidePopover();
    if (!firetable.song || firetable.song.cid == 0) return;
    ftapi.actions.sendBotCommand('!skip');
  });

  $('#npFlag').on('click', function () {
    npModMenu.hidePopover();
    if (!firetable.song || firetable.song.cid == 0) return;
    firetable.ui.openFlagMenu(npModBtn, { started: firetable.song.started, label: firetable.song.artist + ' - ' + firetable.song.title });
  });

  // ── Fix the tags of the song playing now (mods, #136) ──
  // Same editor as Recent rows; saving sends the bot's !fixtags, which
  // corrects the global tags and what everyone sees right away.
  $("#npFixTags").on("click", function () {
    npModMenu.hidePopover();
    var popoverEl = document.getElementById('tagEditorPopover');
    if (popoverEl.matches(':popover-open') && firetable.tagEditNowPlaying) { popoverEl.hidePopover(); return; }
    if (!firetable.song || firetable.song.cid == 0) return;
    if (popoverEl.matches(':popover-open')) popoverEl.hidePopover();
    firetable.tagEditNowPlaying = { cid: firetable.song.cid, type: firetable.song.type };
    $(popoverEl).find('.tagMachine').val(firetable.ui.strip(firetable.song.artist + " - " + firetable.song.title));
    popoverEl.style.visibility = 'hidden';
    popoverEl.showPopover();
    firetable.ui.positionPopover(npModBtn, popoverEl, document.getElementById('tagEditorArrow')).then(function () {
      $(popoverEl).find('.tagMachine')[0].focus();
    });
  });

  // ── Theme (#87) ──
  // A pill in the top bar; tapping it opens #themePopover.
  var themePill = document.getElementById('themePill');
  var themePillText = document.getElementById('themePillText');
  var themePop = document.getElementById('themePopover');
  var themePopText = document.getElementById('themePopText');
  var lastTheme;

  themePill.setAttribute('aria-expanded', 'false');
  themePop.addEventListener('toggle', function (e) {
    var open = e.newState === 'open';
    themePill.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    // suggesting needs an account
    document.getElementById('themeSuggest').hidden = !ftapi.uid;
    themePop.style.visibility = 'hidden';
    firetable.ui.positionPopover(themePill, themePop, document.getElementById('themeArrow'), 'bottom');
  });

  // Start a !suggest in chat, keeping anything already typed there
  $('#themeSuggest').on('click', function () {
    themePop.hidePopover();
    if (!$('#actualChat').is(':visible')) firetable.nav.setMobileTab('mmchat');
    var $chat = $('#newchat');
    var draft = $chat.val().trim();
    if (!/^!suggest\b/i.test(draft)) $chat.val(('!suggest ' + draft).trim() + ' ').trigger('input');
    // chat may still be fading in on smaller screens
    setTimeout(function () {
      var el = $chat[0];
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, firetable.nav._fadeMs * 2 + 50);
  });

  ftapi.events.on("newTheme", function (data) {
    data = data || null;
    var changed = lastTheme !== undefined && data !== lastTheme;
    lastTheme = data;

    var pillText = themePillText, popText = themePopText;
    themePill.classList.toggle("no-theme", !data);
    popText.classList.toggle("no-theme", !data);

    if (!data) {
      pillText.textContent = "none yet";
      popText.textContent = "No theme right now.";
      $("#themePopHint").text("Suggest one and the room votes on it in chat.");
    } else {
      var plain = firetable.ui.strip(data);
      var dress = function (html) { // emoji + `code`, on already-escaped text
        html = firetable.utilities.emojiShortnamestoUnicode(html);
        return html.replace(/`(.*?)`/g, function (x, code) { return "<code>" + code + "</code>"; });
      };
      // the pill is a button, so no links inside it; the popover gets them
      pillText.innerHTML = dress(firetable.utilities.htmlEscape(plain));
      popText.innerHTML = dress(firetable.ui.textToLinks(plain, true));
      // links in the popover should be reachable by keyboard
      $(popText).find("a").removeAttr("tabindex");
      $("#themePopHint").text("Want something else? Suggest a new theme and the room votes on it in chat.");
      twemoji.parse(pillText);
      twemoji.parse(popText);
    }

    if (changed) {
      themePill.classList.remove("is-new");
      void themePill.offsetWidth; // restart the glow
      themePill.classList.add("is-new");
    }
  });
  themePill.addEventListener("animationend", function () { themePill.classList.remove("is-new"); });

  // "first 4/14/2013 by matt"; the DJ only when known (plays from before the
  // room logged its DJs, e.g. Last.fm's, have none)
  function playLine(word, date, dj) {
    return word + " " + firetable.utilities.format_date(date) + (dj ? " by " + dj : "");
  }

  // ── Tag Update (metadata correction while song is playing) ──
  ftapi.events.on("tagUpdate", function (data) {
    firetable.debug && console.log("TAG UPDATE", data);
    firetable.tagUpdate = data;
    if (!firetable.song) return;
    if (firetable.song.cid !== data.cid || !data.adamData.track_name) return;

    $("#track").text(firetable.ui.strip(data.adamData.track_name));
    $("#artist").text(firetable.ui.strip(data.adamData.artist));
    firetable.song.title = firetable.ui.strip(data.adamData.track_name);
    firetable.song.artist = firetable.ui.strip(data.adamData.artist);

    var nicename = firetable.song.djname;
    var showPlaycount = data.adamData.playcount && data.adamData.playcount > 0;

    if (data.adamData.last_play) {
      $("#lastPlay").text(playLine("last", data.adamData.last_play, data.adamData.last_play_dj));
    } else {
      $("#lastPlay").text("");
    }
    if (data.adamData.first_play) {
      $("#firstPlay").text(playLine("first", data.adamData.first_play, data.adamData.first_play_dj));
    } else {
      $("#firstPlay").text("");
    }

    var doTheScrollThing = firetable.utilities.isChatPrettyMuchAtBottom();
    if (showPlaycount) {
      var count = data.adamData.playcount;
      $("#playCount").text(firetable.utilities.pluralize(count, "play"));
      $(".npmsg" + data.cid).last().find(".npmsg").html(
        'DJ <strong>' + nowPlayingText(nicename) + '</strong> started playing <strong>' + nowPlayingText(data.adamData.track_name) + '</strong> by <strong>' + nowPlayingText(data.adamData.artist) + '</strong><br/>This song has been played ' + firetable.utilities.pluralize(count, "time") + '.'
      );
    } else {
      $("#playCount").text("");
      $(".npmsg" + data.cid).last().find(".npmsg").html(
        'DJ <strong>' + nowPlayingText(nicename) + '</strong> started playing <strong>' + nowPlayingText(data.adamData.track_name) + '</strong> by <strong>' + nowPlayingText(data.adamData.artist) + '</strong>'
      );
    }
    if (doTheScrollThing) firetable.utilities.scrollToBottom();
  });

  // ── Song tempo: the DJ bops (and dance mode dances) on the beat (#143) ──
  ftapi.events.on('songBpm', function (data) {
    firetable.songBpm = data;
    firetable.ui.applyBeat();
  });

  // ── New Song ──
  ftapi.events.on('newSong', function (data) {
    firetable.fireCount = 0;
    firetable.fireReactors = {};
    if (typeof window.firetableSetFyreIntensity === 'function') {
      window.firetableSetFyreIntensity(0);
    }
    $("#playCount, #lastPlay, #firstPlay").text("");
    window.dispatchEvent(new Event('resize'));
    $("#cloud_with_rain, #fire").removeClass("on");

    // Fade the progress bar out, then reset it
    var $prg = $("#prgbar");
    $prg.css("opacity", "0");
    if (firetable.moveBar != null) {
      clearInterval(firetable.moveBar);
      firetable.moveBar = null;
    }
    setTimeout(function () {
      // ftconfigs.accentColor isn't in config.js.example; fall back to the
      // room's current colour (same one the progress gradient uses).
      var emptyColor = ftconfigs.accentColor || firetable.color;
      $prg.css("background", "color-mix(in srgb, " + emptyColor + " 50%, black)");
      $prg.css("opacity", "1");
    }, 450);

    // Empty room (no song): stop here instead of crashing on missing fields
    if (!data) return;

    // Check if tagUpdate has pre-corrected metadata for this track
    var showPlaycount = false;
    if (firetable.tagUpdate && data.cid === firetable.tagUpdate.cid && firetable.tagUpdate.adamData.track_name) {
      data.title = firetable.tagUpdate.adamData.track_name;
      data.artist = firetable.tagUpdate.adamData.artist;
      if (firetable.tagUpdate.adamData.last_play) {
        $("#lastPlay").text(playLine("last", firetable.tagUpdate.adamData.last_play, firetable.tagUpdate.adamData.last_play_dj));
      }
      if (firetable.tagUpdate.adamData.first_play) {
        $("#firstPlay").text(playLine("first", firetable.tagUpdate.adamData.first_play, firetable.tagUpdate.adamData.first_play_dj));
      }
      if (firetable.tagUpdate.adamData.playcount > 0) {
        showPlaycount = true;
        $("#playCount").text(firetable.utilities.pluralize(firetable.tagUpdate.adamData.playcount, "play"));
      }
    }

    if (data.image === "img/idlogo.png" && ftconfigs.defaultAlbumArtUrl.length) {
      data.image = ftconfigs.defaultAlbumArtUrl;
    }
    var displayImage = data.type === MEDIA_SOUNDCLOUD
      ? data.image.replace('-large', '-t500x500')
      : data.image;
    var nextTitle = firetable.ui.strip(data.title);
    var nextArtist = firetable.ui.strip(data.artist);

    animateNowPlayingChange(function () {
      // Re-read from firetable.song at callback time so any tagUpdate correction
      // that arrived during the 180ms animation delay isn't overwritten.
      // Falls back to nextTitle/nextArtist on the synchronous first-paint path
      // where firetable.song hasn't been set to the new song yet.
      var displayTitle  = (firetable.song && firetable.song.cid === data.cid) ? firetable.song.title  : nextTitle;
      var displayArtist = (firetable.song && firetable.song.cid === data.cid) ? firetable.song.artist : nextArtist;
      document.getElementById('track').classList.remove('skel');
      document.getElementById('artist').classList.remove('skel');
      $("#track").text(displayTitle);
      $("#artist").text(displayArtist);
      $("#songlink").attr("href", data.url);
      setNowPlayingAlbumArt(displayImage, true);
    });

    // Calculate elapsed time
    var timeSince = ftapi.now() - data.started;
    if (timeSince <= 0) timeSince = 0;
    var secSince = Math.floor(timeSince / 1000);
    var timeLeft = data.duration - secSince;
    firetable.song = data;
    firetable.ui.markCurrentDj();
    firetable.media.songChanged();
    firetable.ui.applyBeat();
    firetable.debug && console.log("NEW TRACK", data);

    // ── Last.fm scrobble timer ──
    if (firetable.lastfm.timer != null) {
      clearTimeout(firetable.lastfm.timer);
      firetable.lastfm.timer = null;
    }
    if (firetable.lastfm.sk && data.cid !== 0) {
      firetable.lastfm.duration = Math.floor(timeLeft);
      firetable.lastfm.songStart = Math.floor(ftapi.now() / 1000);
      // Last.fm's rule: scrobble tracks over 30 s once at least half of
      // them (or 4 minutes) has been heard — not when joining near the end.
      var willHear = timeLeft - 3;
      if (data.duration > 30 && willHear >= Math.min(data.duration / 2, 240)) {
        firetable.lastfm.timer = setTimeout(function () {
          firetable.lastfm.timer = null;
          firetable.lastfm.scrobble();
        }, willHear * 1000);
      }
      firetable.lastfm.nowPlaying();
    }

    // ── Platform-specific UI + playback ──
    if (data.type === MEDIA_YOUTUBE) {
      $("#scScreen").hide();
      $("#songlink").html(YT_LOGO_SVG);

      if (firetable.ytLoaded && !firetable.preview) {
        if (firetable.scLoaded) firetable.scwidget.pause();
        var thevol = firetable.utilities.getEffectiveVolume();
        player.setVolume(thevol);
        firetable.scwidget.setVolume(thevol);
        if (!firetable.disableMediaPlayback) player.loadVideoById(data.cid, secSince, "large");
      }

    } else if (data.type === MEDIA_SOUNDCLOUD) {
      $("#scScreen").show();
      $("#songlink").html(SC_LOGO_SVG);

      var biggerImg = data.image.replace('-large', '-t500x500');
      firetable.scImg = biggerImg;
      setNowPlayingAlbumArt(biggerImg, false);
      try { setup(biggerImg); } catch (e) {
        firetable.debug && console.log('big image error:', e);
      }

      if (firetable.scLoaded && !firetable.preview) {
        if (firetable.ytLoaded) player.stopVideo();
        firetable.scSeek = timeSince;
        if (!firetable.disableMediaPlayback) {
          firetable.scwidget.load(SC_API_TRACK_URL + data.cid, {
            auto_play: true,
            single_active: false,
            callback: function () {
              var vol = firetable.utilities.getEffectiveVolume();
              // (YouTube may not have loaded, e.g. blocked by an extension)
              if (firetable.ytLoaded) player.setVolume(vol);
              firetable.scwidget.setVolume(vol);
              // Explicitly play — auto_play can be suppressed in background tabs
              firetable.scwidget.play();
            }
          });
          firetable.media.watchSoundCloud();
        }
      }
    }

    // ── Now-playing chat message ──
    if (data.cid !== 0) {
      var nicename = data.djid;
      if (ftapi.users[data.djid] && ftapi.users[data.djid].username) {
        nicename = ftapi.users[data.djid].username;
      }

      if (firetable.nonpmsg) {
        firetable.nonpmsg = false;
      } else {
        var doTheScrollThing = firetable.utilities.isChatPrettyMuchAtBottom();
        var npmsgTime = firetable.utilities.format_time(Date.now());
        var npmsgHTML;
        if (showPlaycount) {
          npmsgHTML = '<div class="newChat nowplayn npmsg' + nowPlayingText(data.cid) + '"><span class="material-symbols-outlined">music_note_2</span><div class="npmsg">DJ <strong>' + nowPlayingText(nicename) + '</strong> started playing <strong>' + nowPlayingText(data.title) + '</strong> by <strong>' + nowPlayingText(data.artist) + '</strong><br/>This song has been played ' + firetable.utilities.pluralize(firetable.tagUpdate.adamData.playcount, "time") + '.</div><span class="chatTime npmsg-time">' + npmsgTime + '</span><span class="npmsg-fires"></span>';
        } else {
          npmsgHTML = '<div class="newChat nowplayn npmsg' + nowPlayingText(data.cid) + '"><span class="material-symbols-outlined">music_note_2</span><div class="npmsg">DJ <strong>' + nowPlayingText(nicename) + '</strong> started playing <strong>' + nowPlayingText(data.title) + '</strong> by <strong>' + nowPlayingText(data.artist) + '</strong></div><span class="chatTime npmsg-time">' + npmsgTime + '</span><span class="npmsg-fires"></span>';
        }
        $("#chats").append(npmsgHTML);
        firetable.utilities.chatAdded(doTheScrollThing);
        firetable.lastChatPerson = false;
        firetable.lastChatId = false;
      }
    }

    firetable.actions.replayPendingFireReactions();

    // ── Time left, time elapsed and progress bar (one timer, server clock) ──
    var tick = function (withBar) {
      var song = firetable.song;
      if (!song) return;
      var elapsed = Math.max(0, (ftapi.now() - song.started) / 1000);
      $("#timrUp").text(formatClock(Math.floor(elapsed)));
      $("#timr").text(formatClock(Math.ceil((song.duration || 0) - elapsed)));
      if (!withBar) return;
      var pcnt = (elapsed / song.duration) * 100;
      $("#prgbar").css("background", "linear-gradient(90deg, " + firetable.color + " " + pcnt + "%, color-mix(in srgb, " + firetable.color + " 50%, black) " + pcnt + "%)");
    };
    tick(false); // the bar fades in on its own (above), so just the clocks now
    firetable.moveBar = setInterval(function () { tick(true); }, PROGRESS_BAR_INTERVAL);
  });

  // ── Screen State ──
  ftapi.events.on("screenStateChanged", function (data) {
    firetable.debug && console.log('thescreen:', data);
    firetable.screenSyncPos = data;
    if (firetable.screenControl === "sync" && !firetable.media.forcedScreen) {
      firetable.ui.applyScreenSetting();
    }
    firetable.ui.updateScreenBtn(firetable.screenControl);
  });

  // ── Dance Mode ──
  ftapi.events.on("danceStateChanged", function (data) {
    firetable.debug && console.log('dance check:', data);
    if (data) {
      var danceTempoSec = 1.15;
      var danceMoves = ['dance-move-1', 'dance-move-2', 'dance-move-3'];
      document.querySelectorAll('.ft-avatar:not(.skel), .avtr').forEach(function (el) {
        el.classList.toggle('dance-start-right', Math.random() >= 0.5);
        el.classList.remove('dance-move-1', 'dance-move-2', 'dance-move-3');
        el.classList.add(danceMoves[Math.floor(Math.random() * danceMoves.length)]);
        el.style.setProperty('--dance-delay', (-Math.random() * danceTempoSec).toFixed(3) + 's');
      });
      $("#deck").addClass("dance");
      $("body").addClass("dance-mode");
    } else {
      $("#deck").removeClass("dance");
      $("body").removeClass("dance-mode");
      document.querySelectorAll('.ft-avatar, .avtr').forEach(function (el) {
        el.style.removeProperty('--dance-delay');
        el.classList.remove('dance-move-1', 'dance-move-2', 'dance-move-3');
      });
      document.querySelectorAll('.dance-start-right').forEach(function (el) {
        el.classList.remove('dance-start-right');
      });
    }
    if (firetable.actions && typeof firetable.actions.syncDanceCtaButtons === 'function') {
      firetable.actions.syncDanceCtaButtons();
    }
  });

  // ── Festive Lights ──
  // On when the manual Firebase switch is on, or automatically in December.
  ftapi.events.on("lightsChanged", function (data) {
    firetable.debug && console.log('lights check:', data);
    firetable.lightsManual = !!data;
    firetable.ui.applyLights();
  });
  firetable.ui.applyLights();
  // Re-check hourly so an open tab switches on Dec 1 and off Jan 1.
  setInterval(firetable.ui.applyLights, 60 * 60 * 1000);

  // ── Waitlist ──
  ftapi.events.on("waitlistChanged", function (data) {
    firetable.waitlistData = data;

    // Restore any users previously hidden due to waitlist
    $('#allUsers .prson[data-waitlist-hidden]').show().removeAttr('data-waitlist-hidden');

    var html = '';
    var hasEntries = false;
    var selfInWaitlist = false;
    if (data) {
      var countr = 1;
      for (var key in data) {
        if (data.hasOwnProperty(key)) {
          hasEntries = true;
          var userId = data[key].id;
          // Look up role icon from live user data
          var userInfo = ftapi.users && ftapi.users[userId];
          var roleicon = 'person';
          var roleiconclass = 'material-symbols-filled';
          if (userInfo) {
            if (userInfo.mod)      { roleicon = 'shield';       roleiconclass = 'material-symbols-filled-outlined'; }
            if (userInfo.supermod) { roleicon = 'local_police'; roleiconclass = 'material-symbols-filled'; }
            if (userInfo.hostbot)  { roleicon = 'smart_toy';    roleiconclass = 'material-symbols-filled'; }
          }

          var isSelf = userId === ftapi.uid;
          if (isSelf) selfInWaitlist = true;
          var isHostbot = !!(userInfo && userInfo.hostbot);
          var showDeparture = isSelf && !isHostbot;
          var removeAfterValue = data[key].removeAfter;
          var wlName = firetable.utilities.htmlEscape(data[key].name);
          var departureTitleOff = isSelf ? 'Step down after your next play' : 'Have ' + wlName + ' step down after their next play';
          var departureTitleOn  = isSelf ? "Don't step down after your next play" : "Don't have " + wlName + ' step down after their next play';
          var departureBtn = showDeparture
            ? '<button class="iconbutt deckDepartureBtn' + (removeAfterValue ? ' on' : '') + '" data-wlkey="' + key + '" data-userid="' + userId + '" data-djname="' + wlName + '" title="' + (removeAfterValue ? departureTitleOn : departureTitleOff) + '"><i class="material-symbols-filled">departure_board</i></button>'
            : '';

          var posEl = showDeparture
            ? '<button class="waitlist-pos" data-wlkey="' + key + '" data-userid="' + userId + '" data-djname="' + wlName + '" title="Remove from waitlist"><span class="wl-pos-num">' + countr + '</span><i class="material-symbols-filled wl-pos-icon">close</i></button>'
            : '<span class="waitlist-pos">' + countr + '</span>';

          html += '<div class="waitlist-item" data-userid="' + userId + '">' +
            posEl +
            '<span class="waitlist-name">' +
            wlName +
            '</span>' +
            departureBtn +
            '<span class="' + roleiconclass + ' prsnRole">' + roleicon + '</span>' +
            '<div class="ft-avatar" role="button" tabindex="0" aria-label="' + wlName + ' — profile" style="background-image:url(' +
            firetable.utilities.htmlEscape(firetable.utilities.avatarURL(userId, data[key].name)) +
            ');"></div>' +
            '</div>';

          // Hide this user from the regular user list
          $('#user' + userId).attr('data-waitlist-hidden', '1').hide();
          countr++;
        }
      }
    }
    var $wl = $('#usersWaitlist');
    var wlLabel = '<div class="waitlist-label"><span class="material-symbols-filled">queue_music</span> DJ Waitlist</div>';
    var isSelfOnDeck = !!(ftapi.uid && firetable.tableData && (function () {
      for (var k in firetable.tableData) {
        if (firetable.tableData.hasOwnProperty(k) && firetable.tableData[k].id === ftapi.uid) return true;
      }
    })());
    var showJoinBtn = !!(ftapi.uid && !selfInWaitlist && !isSelfOnDeck);
    if (hasEntries) {
      var addMeRow = '';
      if (showJoinBtn) {
        var selfData = ftapi.uid && ftapi.users && ftapi.users[ftapi.uid];
        var selfRoleicon = 'person';
        var selfRoleiconclass = 'material-symbols-filled';
        if (selfData) {
          if (selfData.mod)      { selfRoleicon = 'shield';       selfRoleiconclass = 'material-symbols-filled-outlined'; }
          if (selfData.supermod) { selfRoleicon = 'local_police'; selfRoleiconclass = 'material-symbols-filled'; }
        }
        var selfName = selfData && selfData.username ? firetable.utilities.htmlEscape(selfData.username) : '';
        addMeRow = '<div class="waitlist-item waitlist-addme-row">' +
          '<span class="waitlist-pos">' + countr + '</span>' +
          '<span class="waitlist-name">' + selfName + '</span>' +
          '<button class="iconbutt deckDepartureBtn" disabled title="Step down after your next play"><i class="material-symbols-filled">departure_board</i></button>' +
          '<span class="' + selfRoleiconclass + ' prsnRole">' + selfRoleicon + '</span>' +
          '<div class="ft-avatar" title="Join the DJ Waitlist"></div>' +
          '</div>';
      }
      $wl.html(wlLabel + html + addMeRow).addClass('has-entries');
    } else {
      $wl.html(
        wlLabel +
        '<div class="waitlist-empty">' +
        '<span class="waitlist-empty-msg">Less than 4 DJs = no need to wait!</span>' +
        (ftapi.uid && !selfInWaitlist ? '<button class="butt graybutt small wlAddMeBtn"' + (isSelfOnDeck ? ' disabled' : '') + '>Play <span class="material-symbols-filled">queue_music</span></button>' : '') +
        '</div>'
      ).removeClass('has-entries');
    }
  });

  // ── DJ Table ──
  var _pendingDeparture = {}; // userId -> true|null while bot command is in-flight
  ftapi.events.on("tableChanged", function (data) {
    firetable.tableData = data;
    var _activeIdx = (firetable.displayedPlaydex !== undefined) ? firetable.displayedPlaydex : firetable.playdex;
    renderDeckAndQueue(data, _activeIdx, true);

    $('#usersWaitlist').off('click.wladdme').on('click.wladdme', '.waitlist-addme-row .ft-avatar, .wlAddMeBtn', function () {
      ftapi.actions.sendBotCommand('!addme');
    });
    // Waitlist changes go through the bot: it owns waitlist/ and would
    // overwrite direct writes (which the database rules refuse anyway).
    $('#usersWaitlist').off('click.wlremove').on('click.wlremove', 'button.waitlist-pos', function () {
      var userId = $(this).attr('data-userid');
      if (userId === ftapi.uid) {
        ftapi.actions.sendBotCommand('!removeme');
        return;
      }
      var entry = null;
      for (var k in firetable.waitlistData || {}) {
        if (firetable.waitlistData.hasOwnProperty(k) && firetable.waitlistData[k].id === userId) entry = firetable.waitlistData[k];
      }
      var person = ftapi.users && ftapi.users[userId];
      var name = (person && person.username) || (entry && entry.name);
      if (name) ftapi.actions.sendBotCommand('!remove ' + name); // mod-only on the bot side
    });
    $('#usersWaitlist').off('click.departure').on('click.departure', '.deckDepartureBtn', function () {
      var $btn = $(this);
      if ($btn.attr('data-userid') !== ftapi.uid) return; // only drawn for yourself
      var newIsOn = !$btn.hasClass('on');
      $btn.toggleClass('on', newIsOn);
      $btn.attr('title', newIsOn ? "Don't step down after your next play" : 'Step down after your next play');
      ftapi.actions.sendBotCommand(newIsOn ? '!removeafter' : '!dontremoveme');
    });

    if (firetable.ui && firetable.ui.syncGhostUsers) firetable.ui.syncGhostUsers();
    if (firetable.ui && firetable.ui.renderRoomPulse) firetable.ui.renderRoomPulse();
    // Re-render the waitlist UI so the Play button reflects updated deck membership
    if (firetable.waitlistData !== undefined) {
      ftapi.events.emit('waitlistChanged', firetable.waitlistData);
    }
  });

  // Re-render deck when user data arrives (mod status affects button visibility),
  // at most once per frame however many updates arrive together
  ftapi.events.on("usersChanged", firetable.utilities.oncePerFrame(function () {
    if (firetable.tableData !== undefined) {
      ftapi.events.emit("tableChanged", firetable.tableData);
    }
  }));

  // ── Spotlight (Active DJ Index) ──
  ftapi.events.on("spotlightStateChanged", function (data) {
    firetable.playdex = data;

    // Same song, seats just moved (someone joined or left): update right away
    var seat = firetable.tableData && firetable.tableData[data];
    if (seat && firetable.song && seat.id === firetable.song.djid) {
      clearTimeout(firetable._djActiveTimer);
      firetable._djActiveTimer = undefined;
      firetable.displayedPlaydex = data;
      applyDjActive(data);
      return;
    }

    // Defer both avatar animation and djActive plaque switch until colorsChanged
    // fires so they switch at the same moment the color transition starts.
    // Also defer fyre repositioning so it doesn't flash to the new DJ before
    // the visual highlight actually updates.
    clearTimeout(firetable._djActiveTimer);
    firetable._djActiveTimer = setTimeout(function () {
      firetable.displayedPlaydex = firetable.playdex;
      applyDjActive(firetable.displayedPlaydex);
      positionFyreAtActiveDJ();
      firetable._djActiveTimer = undefined;
    }, 2000); // fallback if colorsChanged never follows
  });

  // ── Play Limit ──
  ftapi.events.on("playLimitChanged", function (data) {
    firetable.playlimit = data;
    $("#plimit0").text(data);
    $("#deckQueue .deckqueue-plays").each(function () {
      var plays = $(this).text().split('/')[0];
      $(this).text(plays + '/' + data);
    });
  });

  // ── Ban List ──
  ftapi.events.on("banListChanged", function (data) {
    $("#activeSuspensions").html("");
    for (var key in data) {
      if (data[key]) {
        ftapi.lookup.userByName(key, function (person) {
          $("#activeSuspensions").append(
            '<div class="importResult"><div class="imtxt">' + firetable.utilities.htmlEscape(person.username) + '</div>' +
            '<button type="button" data-userid="' + firetable.utilities.htmlEscape(person.userid) + '" class="material-symbols-filled row-icon unbanButton" title="Unsuspend" aria-label="Unsuspend ' + firetable.utilities.htmlEscape(person.username) + '">&#xE5C9;</button></div>'
          );
        });
      }
    }
  });

  $("#activeSuspensions").off('click.unban').on('click.unban', '.unbanButton', function () {
    firetable.actions.unban($(this).attr('data-userid'));
  });

  // ── Colors Changed (Accent Color) ──
  ftapi.events.on("colorsChanged", function (data) {
    firetable.debug && console.log("COLOR CHANGE!", data);

    data = data || {}; // no colors saved yet → fall back to the default orange
    firetable.color = data.color;
    firetable.countcolor = data.txt;
    if (!data.color || data.color === "#fff" || data.color === "#7f7f7f") {
      firetable.color = firetable.orange;
      firetable.countcolor = "#fff";
    }
    // Apply deferred djActive switch — highlight changes as color transition starts
    if (firetable._djActiveTimer !== undefined) {
      clearTimeout(firetable._djActiveTimer);
      firetable._djActiveTimer = undefined;
      firetable.displayedPlaydex = firetable.playdex;
      applyDjActive(firetable.displayedPlaydex);
    }
    // Update custom color styles
    $('.customColorStyles').remove();
    $("head").append(
      "<style class='customColorStyles'>#stage { --color-accent: " + firetable.color + "; --color-on-accent: " + firetable.countcolor + "; } " +
      "#stage .accent:not(#fire), #stage .butt:not(.graybutt):not(#fire) { color: " + firetable.countcolor + "; } " +
      "#stage .iconbutt.on:not(.deckDepartureBtn):not(#fire) { color: " + firetable.color + "; border-bottom: 1px solid " + firetable.color + "66; box-shadow: inset 0 0 1rem " + firetable.color + "33; } " +
      "#themebox { background-color: " + firetable.color + "33; }</style>"
    );

  });
};
