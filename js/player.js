/**
 * player.js — YouTube + SoundCloud media playback.
 *
 * Handles:
 * - YouTube IFrame API ready callback + player initialization
 * - SoundCloud Widget initialization (in init.js, widget events bound here)
 * - Volume slider + mute toggle
 * - Track preview (play a 30-second snippet of a song in the queue or search)
 * - Reload current track at correct elapsed position
 *
 * Uses the `firetable.utilities.resumeCurrentSong()` helper from helpers.js
 * to avoid duplicating the "calculate elapsed → load YT or SC" logic.
 */

// ─── YouTube IFrame API Callback ─────────────────────────────────────────────
/**
 * Called automatically by the YouTube IFrame API when it finishes loading.
 * Creates the YT.Player instance inside #playerArea.
 */
function onYouTubeIframeAPIReady() {
  var $screenFrame = $('#screenFrame');
  var frameH = $screenFrame.outerHeight() || $('#djStage').outerHeight();
  var frameW = $screenFrame.outerWidth() || (frameH * ASPECT_RATIO);
  player = new YT.Player('playerArea', {
    width: frameW,
    height: frameH,
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      iv_load_policy: 3, // no annotations / cards over the video
      rel: 0,            // related videos only from the same channel
      playsinline: 1     // iPhone: play inside the stage instead of going full screen
    },
    videoId: '5mGuCdlCcNM', // placeholder video
    events: {
      onReady: onPlayerReady,
      onStateChange: function (event) {
        // Only clear the reload spinner once the video actually starts playing,
        // not on intermediate states like UNSTARTED(-1) or BUFFERING(3) which
        // fire almost instantly and would kill the animation before it renders.
        if (event.data === YT.PlayerState.PLAYING) {
          $('#reloadtrack').removeClass('on working');
        }
        firetable.media.onYouTubeState(event.data);
      },
      onError: function () {
        firetable.media.onYouTubeError();
      }
    }
  });
}

/**
 * Called when the YouTube player is ready. Sets up:
 * - Volume from localStorage (or DEFAULT_VOLUME on first visit)
 * - Mute state from localStorage
 * - jQuery UI volume slider
 * - Resumes the current song if one is already playing
 *
 * @param {Object} event - YouTube player ready event
 */
function onPlayerReady(event) {
  firetable.ytLoaded = true;

  // ── Restore volume ──
  var vol = firetable.utilities.getEffectiveVolume();
  player.setVolume(vol);

  // ── Restore mute state ──
  var muted = localStorage[STORAGE.mute];
  if (typeof muted === "undefined") {
    localStorage[STORAGE.mute] = false;
    muted = "false";
    $("#volstatus").removeClass('on');
  }
  if (muted !== "false") {
    $("#volstatus i").html("&#xE04E;");
    $("#volstatus").addClass('on');
  }

  // ── Volume slider ──
  var sliderVol = parseInt(localStorage[STORAGE.volume], 10);
  if (isNaN(sliderVol)) sliderVol = DEFAULT_VOLUME;
  $("#slider").slider({
    orientation: "vertical",
    range: "min",
    min: 0,
    max: 100,
    value: sliderVol,
    step: 5,
    slide: function (event, ui) {
      player.setVolume(ui.value);
      firetable.scwidget.setVolume(ui.value);
      localStorage[STORAGE.volume] = ui.value;

      var isMuted = localStorage[STORAGE.mute];
      if (isMuted !== "false") {
        // Un-mute since user is dragging the slider
        localStorage[STORAGE.mute] = false;
        $("#volstatus i").html("&#xE050;");
        $("#volstatus").removeClass('on');
      } else if (ui.value === 0) {
        firetable.actions.muteToggle(true);
        $("#volstatus").addClass('on');
      }
    }
  });

  // ── Resume song if one was already playing when YT loaded ──
  if (firetable.song && firetable.song.type === MEDIA_YOUTUBE) {
    firetable.utilities.resumeCurrentSong();
  }
}

/**
 * Stub — YouTube fires this when playback state changes.
 * Currently unused but required by the API.
 */
function onPlayerStateChange(event) {
  // no-op
}

// ─── Mute / Volume Toggle ────────────────────────────────────────────────────

firetable.actions = firetable.actions || {};

/**
 * Toggle mute on/off. Stores previous volume to restore when un-muting.
 *
 * @param {boolean} [zeroMute=false] - If true, force-mute at volume 0
 *   (used when the slider is dragged to 0)
 */
firetable.actions.muteToggle = function (zeroMute) {
  var muted = localStorage[STORAGE.mute];
  var icon = "&#xE050;"; // volume_up icon

  if (zeroMute) {
    // Slider was dragged to 0 — mark as zero-muted
    icon = "&#xE04E;"; // volume_off icon
    muted = 0;

  } else if (typeof muted !== 'undefined') {
    if (muted !== "false") {
      // Currently muted → un-mute, restore saved volume
      if (parseInt(muted) === 0) {
        // Was zero-muted — restore to default volume
        $("#slider").slider("value", DEFAULT_VOLUME);
        player.setVolume(DEFAULT_VOLUME);
        firetable.scwidget.setVolume(DEFAULT_VOLUME);
        localStorage[STORAGE.volume] = DEFAULT_VOLUME;
      } else {
        // Restore the volume that was saved before muting
        var savedVol = parseInt(muted);
        $("#slider").slider("value", savedVol);
        player.setVolume(savedVol);
        firetable.scwidget.setVolume(savedVol);
        localStorage[STORAGE.volume] = savedVol;
      }
      muted = false;
    } else {
      // Not muted → mute: save current volume, set to 0
      icon = "&#xE04E;";
      muted = $("#slider").slider("value");
      $("#slider").slider('value', 0);
      player.setVolume(0);
      firetable.scwidget.setVolume(0);
      localStorage[STORAGE.volume] = 0;
    }
  } else {
    // First time — mute
    icon = "&#xE04E;";
    muted = $("#slider").slider("value");
    $("#slider").slider('value', 0);
    player.setVolume(0);
    firetable.scwidget.setVolume(0);
    localStorage[STORAGE.volume] = 0;
  }

  if (muted) {
    $("#volstatus").addClass('on');
  } else {
    $("#volstatus").removeClass('on');
  }
  $("#volstatus i").html(icon);
  localStorage[STORAGE.mute] = muted;
};

// ─── Track Preview ───────────────────────────────────────────────────────────

/**
 * Preview a song for 30 seconds. If the same song is already being previewed,
 * stop the preview and resume the current room song.
 *
 * @param {string} id - Song key (queue key or "ytcid..."/"sccid..." for search results)
 * @param {boolean} fromSearch - True if previewing from search results (id has prefix)
 * @param {number} type - MEDIA_YOUTUBE or MEDIA_SOUNDCLOUD
 * @param {boolean} [fromHist=false] - True if previewing from history (darker progress bar)
 */
firetable.actions.pview = function (id, fromSearch, type, fromHist) {
  if (firetable.preview === id) {
    // ── Already previewing this track → stop and resume room song ──
    clearTimeout(firetable.ptimeout);
    firetable.ptimeout = null;
    $("#pv" + firetable.preview).html("&#xE037;"); // play_arrow
    $("#pvbar" + firetable.preview).css("background-image", "none").removeClass("previewing");
    clearInterval(firetable.movePvBar);
    firetable.movePvBar = null;
    firetable.preview = false;
    firetable.previewType = null;

    firetable.utilities.resumeCurrentSong();

  } else {
    // ── Stop any existing preview ──
    if (firetable.preview) {
      $("#pv" + firetable.preview).html("&#xE037;");
      $("#pvbar" + firetable.preview).css("background-image", "none").removeClass("previewing");
    }

    firetable.preview = id;
    firetable.previewType = Number(type);
    var cid = fromSearch ? id.slice(5) : firetable.queue[id].cid;

    // Clear any existing preview timer
    if (firetable.ptimeout != null) {
      clearTimeout(firetable.ptimeout);
      firetable.ptimeout = null;
    }
    if (firetable.movePvBar != null) {
      clearInterval(firetable.movePvBar);
      firetable.movePvBar = null;
    }

    // ── Auto-stop after PREVIEW_DURATION ──
    firetable.pvCount = 0;
    firetable.ptimeout = setTimeout(function () {
      firetable.ptimeout = null;
      $("#pv" + firetable.preview).html("&#xE037;");
      $("#pvbar" + firetable.preview).css("background-image", "none").removeClass("previewing");
      clearInterval(firetable.movePvBar);
      firetable.movePvBar = null;
      firetable.pvCount = 0;
      firetable.preview = false;
      firetable.previewType = null;

      // Resume the room's current song
      firetable.utilities.resumeCurrentSong();
    }, PREVIEW_DURATION);

    // ── Show pause icon + animate progress bar ──
    $("#pvbar" + id).addClass("previewing");
    $("#pv" + id).html("&#xE034;"); // pause icon
    firetable.movePvBar = setInterval(function () {
      var pcnt = (firetable.pvCount / 29) * 100; // 29 = PREVIEW_DURATION/1000 - 1
      firetable.pvCount += 0.2;
      // Same accent as the rest of the app (not a separate hardcoded orange)
      $("#pvbar" + firetable.preview).css(
        "background-image",
        "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 27%, transparent) " + pcnt + "%, var(--color-bg-t1) " + pcnt + "%)"
      );
    }, PREVIEW_BAR_INTERVAL);

    // ── Start playing the preview from the beginning ──
    if (type == MEDIA_YOUTUBE) {
      if (firetable.scLoaded) firetable.scwidget.pause();
      if (!firetable.disableMediaPlayback) player.loadVideoById(cid, 0, "large");
    } else if (type == MEDIA_SOUNDCLOUD) {
      if (firetable.ytLoaded) player.stopVideo();
      firetable.scSeek = 0;
      if (!firetable.disableMediaPlayback) {
        firetable.scwidget.load(SC_API_TRACK_URL + cid, { auto_play: true });
      }
    }
  }
};

// ─── Reload Track ────────────────────────────────────────────────────────────

/**
 * Reload the current song at the correct elapsed position.
 * Shows a loading spinner on the reload button.
 */
firetable.actions.reloadtrack = function () {
  $('#reloadtrack').addClass('on working');
  firetable.utilities.resumeCurrentSong();
};

// ─── Media State (video screen + autoplay feedback) ──────────────────────────

/**
 * Keeps the stage honest about what the YouTube player is doing:
 * - `yt-stalled` on <body>: YouTube is the active media but not playing, so the
 *   video screen stays up and YouTube's own title / play button / "Watch on
 *   YouTube" bar never show through the stage.
 * - `media-blocked` on <body>: the browser blocked autoplay (or paused it), so
 *   the "Tap to start audio" pill is shown.
 * Short gaps (loading the next video) are ignored via STALL_MS.
 */
firetable.media = {
  /** @type {number|null}  Last YT.PlayerState, or null when unknown (new song) */
  ytState: null,
  /** @type {boolean}  The current video failed to load */
  ytError: false,
  /** @type {boolean}  User asked to reveal YouTube's own player (autoplay still blocked) */
  directTap: false,
  /** @type {boolean}  Screen was lowered only so the user could tap YouTube's play button */
  forcedScreen: false,
  STALL_MS: 1500,
  _stallTimer: null,
  _tapTimer: null,

  _isPlaying: function (state) {
    return state === 1 || state === 3; // PLAYING or BUFFERING
  },

  /** YouTube player state changed. */
  onYouTubeState: function (state) {
    var m = firetable.media;
    m.ytState = state;
    clearTimeout(m._stallTimer);
    if (m._isPlaying(state)) {
      m.ytError = false;
      m.directTap = false;
      clearTimeout(m._tapTimer);
      if (m.forcedScreen) {
        m.forcedScreen = false;
        firetable.ui.applyScreenSetting && firetable.ui.applyScreenSetting();
      }
      m.refresh();
      return;
    }
    m._stallTimer = setTimeout(m.refresh, m.STALL_MS);
  },

  /** YouTube could not play the video (removed, private, embed blocked…). */
  onYouTubeError: function () {
    firetable.media.ytError = true;
    firetable.media.refresh();
  },

  /** A new room song started: forget the old player state. */
  songChanged: function () {
    var m = firetable.media;
    clearTimeout(m._stallTimer);
    m.ytState = null;
    m.ytError = false;
    m.refresh();
  },

  /** Re-evaluate the body classes. */
  refresh: function () {
    var m = firetable.media;
    var ytActive = firetable.preview
      ? firetable.previewType === MEDIA_YOUTUBE
      : !!(firetable.song && firetable.song.type === MEDIA_YOUTUBE && firetable.song.cid != 0);
    var s = m.ytState;
    var known = s !== null && s !== undefined;
    var stalled = ytActive && known && !m._isPlaying(s) && !m.directTap;
    var blocked = stalled && !firetable.preview && !firetable.disableMediaPlayback &&
      !m.ytError && (s === -1 || s === 2 || s === 5); // UNSTARTED, PAUSED, CUED
    document.body.classList.toggle('yt-stalled', stalled);
    document.body.classList.toggle('media-blocked', blocked);
  },

  /** "Tap to start audio": the tap is a user gesture, so playback is allowed now. */
  tapToPlay: function () {
    var m = firetable.media;
    document.body.classList.remove('media-blocked');
    firetable.utilities.resumeCurrentSong();
    clearTimeout(m._tapTimer);
    m._tapTimer = setTimeout(function () {
      if (m._isPlaying(m.ytState)) return;
      // Still blocked (some phones only accept a tap inside the video itself):
      // lower the screen so YouTube's own play button can be tapped.
      m.directTap = true;
      if (!document.body.classList.contains('screen')) {
        m.forcedScreen = true;
        firetable.utilities.screenDown();
      }
      m.refresh();
    }, 2500);
  }
};

