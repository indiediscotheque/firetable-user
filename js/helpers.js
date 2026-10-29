/**
 * helpers.js — General-purpose utility functions for firetable.
 *
 * Contains formatting helpers, HTML escaping, debounce, notification sound,
 * desktop notifications, chat scroll management, avatar URL builder,
 * and the critical `resumeCurrentSong()` helper that replaces 8+ duplicated
 * "calculate elapsed → load YT or SC" blocks from the original code.
 */

firetable.utilities = {

  // ─── Volume ───────────────────────────────────────────────────────────────

  /**
   * Return the effective playback volume, respecting mute state.
   * Avoids the `parseInt("0") || DEFAULT_VOLUME` bug that causes loud bursts.
   * @returns {number} 0 when muted, otherwise the stored volume (or DEFAULT_VOLUME).
   */
  getEffectiveVolume: function () {
    var muted = localStorage[STORAGE.mute];
    if (muted && muted !== "false") return 0;
    var vol = parseInt(localStorage[STORAGE.volume], 10);
    return isNaN(vol) ? DEFAULT_VOLUME : vol;
  },

  // ─── Avatar URL ──────────────────────────────────────────────────────────

  /**
   * Build an avatar URL for a user.
   * Supports Robohash (via proxy) and DiceBear (SVG).
   * Style lookup order:
   *   explicit `style` param (e.g. a trading card's stamped set)
   *   → room theme: ftconfigs.avatarset, else the seasonal theme (monsters in October)
   *   → ftapi.users[uid].avatarStyle → firetable.avatarStyle (own user cache)
   *   → "robohash:" + firetable.avatarset
   * @param {string} uid - User ID
   * @param {string} username - Display name
   * @param {string|null} [size="110x110"] - Dimensions (Robohash only)
   * @param {string} [style] - Style key e.g. "robohash:set1" or "dicebear:pixel-art"
   * @returns {string} Full avatar URL
   */
  avatarURL: function (uid, username, size, style) {
    size = size || "110x110";
    if (!style) {
      style = firetable.roomAvatarStyle
           || (ftapi.users && ftapi.users[uid] && ftapi.users[uid].avatarStyle)
           || (uid === ftapi.uid ? firetable.avatarStyle : null)
           || firetable.utilities.normalizeAvatarStyle(firetable.avatarset);
    }
    if (style.indexOf("dicebear:") === 0) {
      return "https://api.dicebear.com/9.x/" + style.slice(9) + "/svg?seed=" + encodeURIComponent(uid + username);
    }
    var set = style.indexOf("robohash:") === 0 ? style.slice(9) : style;
    return AVATAR_BASE_URL + uid + username + ".png?size=" + size + "&set=" + (set || "set1");
  },

  /**
   * Seasonal room avatar style for a date, from ftconfigs.avatarSeasons or
   * AVATAR_SEASONS. Returns null when no season matches or seasons are off.
   * @param {Date} [date=new Date()]
   * @returns {string|null}
   */
  seasonalAvatarStyle: function (date) {
    var seasons = (typeof ftconfigs !== "undefined" && ftconfigs.avatarSeasons !== undefined)
      ? ftconfigs.avatarSeasons
      : AVATAR_SEASONS;
    if (!Array.isArray(seasons)) return null;
    for (var i = 0; i < seasons.length; i++) {
      var season = seasons[i];
      if (season && firetable.utilities.inMonths(season.months, date)) {
        return firetable.utilities.normalizeAvatarStyle(season.style);
      }
    }
    return null;
  },

  /**
   * Is the date's local month (1-12) in the list?
   * @param {number[]} months
   * @param {Date} [date=new Date()]
   * @returns {boolean}
   */
  inMonths: function (months, date) {
    return Array.isArray(months) && months.indexOf((date || new Date()).getMonth() + 1) !== -1;
  },

  /**
   * Should the stage string lights be on by season (December by default)?
   * Uses ftconfigs.lightsMonths when set, else LIGHTS_MONTHS.
   * @param {Date} [date=new Date()]
   * @returns {boolean}
   */
  seasonalLights: function (date) {
    return firetable.utilities.inConfiguredMonths("lightsMonths", LIGHTS_MONTHS, date);
  },

  /**
   * Should the stage snow fall by season (January and February by default)?
   * Uses ftconfigs.snowMonths when set, else SNOW_MONTHS.
   * @param {Date} [date=new Date()]
   * @returns {boolean}
   */
  seasonalSnow: function (date) {
    return firetable.utilities.inConfiguredMonths("snowMonths", SNOW_MONTHS, date);
  },

  /**
   * inMonths() against ftconfigs[key] when config.js sets it, else defaults.
   * @param {string} key - ftconfigs key, e.g. "snowMonths"
   * @param {number[]} defaults
   * @param {Date} [date=new Date()]
   * @returns {boolean}
   */
  inConfiguredMonths: function (key, defaults, date) {
    var months = (typeof ftconfigs !== "undefined" && ftconfigs[key] !== undefined)
      ? ftconfigs[key]
      : defaults;
    return firetable.utilities.inMonths(months, date);
  },

  /**
   * Turn a config avatar value into a full style key.
   * Accepts a bare Robohash set ("set2") or a full key ("robohash:set2",
   * "dicebear:bottts"). Returns null for empty values.
   * @param {string} val
   * @returns {string|null}
   */
  normalizeAvatarStyle: function (val) {
    val = String(val || "").trim();
    if (!val) return null;
    return /^(robohash|dicebear):/.test(val) ? val : "robohash:" + val;
  },

  // ─── Playlist <option> Builder ───────────────────────────────────────────

  /**
   * Build an <option> element for a playlist picker.
   * The name is set as text so it is never parsed as live HTML. It is first
   * decoded through an inert <template> (no scripts run, no images load) so
   * entities like "&amp;" saved by YouTube imports, and whitespace, look
   * exactly as they did when names were inserted as HTML.
   * @param {string} value - Option value (playlist key)
   * @param {*} name - Playlist name
   * @param {string} [id] - Optional element id
   * @returns {jQuery}
   */
  playlistOption: function (value, name, id) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(name);
    var $opt = $('<option></option>').val(value).text(tpl.content.textContent);
    if (id) $opt.attr('id', id);
    return $opt;
  },

  /**
   * Add a playlist to both pickers: the one choosing which list is shown
   * (#listpicker) and the one choosing what the DJ plays (#djlistpicker).
   * @param {string} listID
   * @param {*} name
   */
  addPlaylistToPickers: function (listID, name) {
    $("#listpicker").append(firetable.utilities.playlistOption(listID, name, 'pdopt' + listID));
    $("#djlistpicker").append(firetable.utilities.playlistOption(listID, name));
  },

  // ─── What was playing ────────────────────────────────────────────────────

  /**
   * The song that was playing at a server time (ms), from the current song
   * and the Recent plays loaded so far, or null.
   * @param {number} time
   * @returns {{artist: string, title: string, dj: string}|null}
   */
  songPlayingAt: function (time) {
    time = Number(time);
    if (!time) return null;
    var best = null;
    var consider = function (started, duration, artist, title, dj) {
      started = Number(started);
      if (!started || started > time || (best && best.started >= started)) return;
      // a gap (nothing playing) after the song ended doesn't count
      if (duration && time > started + (Number(duration) + 30) * 1000) return;
      best = { started: started, artist: artist, title: title, dj: dj };
    };
    var s = firetable.song;
    if (s && s.cid != 0) consider(s.started, s.duration, s.artist, s.title, s.djname);
    (firetable._historyCache || []).forEach(function (h) { consider(h.when, h.duration, h.artist, h.title, h.dj); });
    return best;
  },

  // ─── Track links ─────────────────────────────────────────────────────────

  /**
   * A soundcloud.com page URL, or "" when `url` isn't one (only https links to
   * soundcloud.com are used as hrefs).
   * @param {*} url
   * @returns {string}
   */
  soundCloudPageUrl: function (url) {
    url = String(url || "");
    return /^https:\/\/(?:www\.|m\.)?soundcloud\.com\/[^\s"'<>]+$/i.test(url) ? url : "";
  },

  /**
   * Where a saved track's "Open on YouTube / SoundCloud" button goes.
   * SoundCloud tracks link to their page when it was saved with the track,
   * otherwise to SoundCloud's player page (the API URL needs a login).
   * @param {{type:number|string, cid:*, url:string}} track
   * @returns {string}
   */
  trackPageUrl: function (track) {
    if (String(track.type) === String(MEDIA_SOUNDCLOUD)) {
      return firetable.utilities.soundCloudPageUrl(track.url) ||
        SC_PLAYER_PAGE_URL + encodeURIComponent(SC_API_TRACK_URL + track.cid);
    }
    return "https://www.youtube.com/watch?v=" + encodeURIComponent(track.cid);
  },

  /**
   * Fields worth saving with a SoundCloud track (its page and artwork).
   * @param {Object} item - SoundCloud API track
   * @returns {{url: string, img: string}}
   */
  soundCloudExtras: function (item) {
    return {
      url: firetable.utilities.soundCloudPageUrl(item && item.permalink_url),
      img: /^https:\/\//i.test((item && item.artwork_url) || "") ? item.artwork_url : ""
    };
  },

  // ─── Song Title Parsing ──────────────────────────────────────────────────

  /**
   * Split a "Artist - Title" string into { artist, title }.
   * Falls back: if no " - " separator, artist = fallbackArtist, title = the string.
   * @param {string} raw - The raw title string (e.g. "Radiohead - Creep")
   * @param {string} [fallbackArtist=""] - Used when title has no " - " separator
   * @returns {{artist: string, title: string}}
   */
  parseArtistTitle: function (raw, fallbackArtist) {
    // Split on the FIRST " - " only, so "Band - Song - Live" keeps the full title.
    var sep = raw.indexOf(" - ");
    var artist = sep === -1 ? raw : raw.slice(0, sep);
    var title = sep === -1 ? undefined : raw.slice(sep + 3);
    // ...but drop a trailing " - Official Video" style suffix (only when it
    // follows another " - ", so a song actually called "Video" is untouched).
    if (title) {
      title = title.replace(/\s+-\s+(?:official\s+)?(?:hd\s+|4k\s+)?(?:music\s+video|lyric\s+video|video|audio|visuali[sz]er|lyrics)\s*$/i, "");
    }
    if (!title) {
      title = artist;
      artist = fallbackArtist || "";
    }
    // Drop bracketed upload junk like "(Official Music Video)", "[Official
    // Audio]" or "[HD]". Only brackets that contain nothing but junk words are
    // removed, so "(Video Mix)", "(Live Audio Session)", "(Remix)" etc. stay.
    var cleaned = title
      .replace(/\s*[\(\[]\s*(?:(?:official\s+)?(?:hd\s+|4k\s+)?(?:music\s+video|lyric\s+video|video|audio|visuali[sz]er|lyrics)|hd|hq|4k)\s*[\)\]]/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (cleaned) title = cleaned;
    return { artist: artist, title: title };
  },

  // ─── Hex ↔ RGB ───────────────────────────────────────────────────────────

  /**
   * Convert a hex colour string to an {r, g, b} object.
   * Handles both 3-char (#abc) and 6-char (#aabbcc) formats.
   * @param {string} hex
   * @returns {{r: number, g: number, b: number}|null}
   */
  hexToRGB: function (hex) {
    var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, function (m, r, g, b) {
      return r + r + g + g + b + b;
    });
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  },

  // ─── Canvas Text Wrapping ────────────────────────────────────────────────

  /**
   * Draw word-wrapped text onto a canvas context.
   * @param {CanvasRenderingContext2D} context
   * @param {string} text
   * @param {number} x - Starting X position
   * @param {number} y - Starting Y position
   * @param {number} maxWidth - Maximum line width in pixels
   * @param {number} lineHeight - Vertical spacing between lines
   * @returns {number} Number of extra lines drawn (0 if text fit on one line)
   */
  wrapText: function (context, text, x, y, maxWidth, lineHeight) {
    var words = text.split(' ');
    var line = '';
    var lines = 0;
    for (var n = 0; n < words.length; n++) {
      var testLine = line + words[n] + ' ';
      var metrics = context.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        context.fillText(line, x, y);
        line = words[n] + ' ';
        y += lineHeight;
        lines++;
      } else {
        line = testLine;
      }
    }
    context.fillText(line, x, y);
    return lines;
  },

  // ─── Sound / Notifications ───────────────────────────────────────────────

  /**
   * Play an audio notification (the "badoop" sound on @-mentions).
   * Respects the user's playBadoop setting.
   * @param {string} filename - Audio file path without extension (adds .mp3)
   */
  playSound: function (filename) {
    if (firetable.playBadoop) {
      document.getElementById("audilert").setAttribute('src', filename + ".mp3");
    }
  },

  /**
   * Show a browser desktop notification (if permission granted).
   * @param {Object} chatData - Chat message data {id, txt}
   * @param {string} namebo - Display name of the sender
   */
  desktopNotify: function (chatData, namebo) {
    // iPhone/iPad Safari has no Notification API, and Android Chrome throws on
    // `new Notification()`. Never let either break rendering the chat message.
    if (typeof Notification === "undefined") return;
    try {
      if (Notification.permission !== "granted") {
        Notification.requestPermission();
      } else {
        new Notification(namebo, {
          icon: firetable.utilities.avatarURL(chatData.id, namebo),
          body: chatData.txt
        });
      }
    } catch (e) {
      firetable.debug && console.log("desktop notification failed:", e);
    }
  },

  // ─── Screen (Video Stage) ────────────────────────────────────────────────

  /** Slide the video stage up (hide it) */
  screenUp: function () {
    $('body').removeClass('screen');
  },

  /** Slide the video stage down (show it) */
  screenDown: function () {
    $('body').addClass('screen');
  },

  /** Returns "count singular" or "count plural" (defaults to singular+"s") */
  pluralize: function (count, singular, plural) {
    return count + " " + (count === 1 ? singular : (plural || singular + "s"));
  },

  // ─── Chat Scroll ─────────────────────────────────────────────────────────

  /**
   * Check if the chat is scrolled to (or very near) the bottom.
   * Used to decide whether to auto-scroll on new messages.
   * @returns {boolean}
   */
  isChatPrettyMuchAtBottom: function () {
    if (!chatScroll || !chatScroll.contentWrapperEl) {
      return true;
    }

    var scrollable = chatScroll.contentEl.scrollHeight - chatScroll.el.clientHeight;
    var scrolled = chatScroll.contentWrapperEl.scrollTop;
    return (Math.abs(scrollable - scrolled) <= 25);
  },

  /** Scroll the chat container to the very bottom. */
  scrollToBottom: function () {
    if (!chatScroll || !chatScroll.contentWrapperEl) {
      return;
    }

    chatScroll.contentWrapperEl.scrollTop = chatScroll.contentEl.scrollHeight;
  },

  // ─── HTML / Text Processing ──────────────────────────────────────────────

  /**
   * Escape HTML special characters for safe insertion into the DOM.
   * @param {string} s - Raw string
   * @param {boolean} [preserveCR=false] - If true, preserves carriage returns as &#13;
   * @returns {string} Escaped string
   */
  htmlEscape: function (s, preserveCR) {
    preserveCR = preserveCR ? '&#13;' : '\n';
    return ('' + s)
      .replace(/&/g, '&amp;')
      .replace(/'/g, '&#39;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r\n/g, preserveCR)
      .replace(/[\r\n]/g, preserveCR);
  },

  /**
   * Return the normalized URL if `raw` is an http(s) link to a .jpg/.jpeg/
   * .gif/.png image, otherwise null. URL() percent-encodes quotes and spaces,
   * so the result is safe to put in an attribute.
   * @param {string} raw
   * @returns {string|null}
   */
  imageLinkUrl: function (raw) {
    var u;
    try { u = new URL(String(raw || "")); } catch (e) { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return /\.(?:jpe?g|gif|png)$/i.test(u.pathname) ? u.href : null;
  },

  /**
   * Decode HTML entities ("&amp;" → "&", "&#39;" → "'") without treating
   * anything as markup: a <textarea> parses its content as plain text, so no
   * elements are created and nothing loads or runs. Track names are stored as
   * plain text; this cleans up older names that were saved escaped and the
   * escaped titles the YouTube API returns.
   * @param {*} str
   * @returns {string}
   */
  decodeEntities: function (str) {
    str = String(str == null ? "" : str);
    if (str.indexOf("&") === -1) return str;
    var ta = document.createElement("textarea");
    ta.innerHTML = str;
    return ta.value;
  },

  // ─── Date / Time Formatting ──────────────────────────────────────────────

  /**
   * Format a timestamp as a short date string: M/D/YYYY
   * @param {number|string|Date} d - Timestamp or Date
   * @returns {string}
   */
  format_date: function (d) {
    var date = new Date(d);
    return (date.getMonth() + 1) + "/" + date.getDate() + "/" + date.getFullYear();
  },

  /**
   * Format a timestamp as a 12-hour time string: H:MMam/pm
   * @param {number|string|Date} d - Timestamp or Date
   * @returns {string}
   */
  format_time: function (d) {
    var date = new Date(d);
    var hours = date.getHours();
    var ampm = hours >= 12 ? "pm" : "am";
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    var minutes = date.getMinutes();
    var min = minutes > 9 ? "" + minutes : "0" + minutes;
    return hours + ":" + min + ampm;
  },

  // ─── Once per frame ──────────────────────────────────────────────────────

  /**
   * Wrap fn so any number of calls within one frame run it once, with the
   * arguments of the last call. In a hidden tab it waits until the tab is
   * shown again (no work nobody can see).
   * @param {Function} fn
   * @returns {Function}
   */
  oncePerFrame: function (fn) {
    var queued = false, lastArgs, lastThis;
    return function () {
      lastArgs = arguments;
      lastThis = this;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        fn.apply(lastThis, lastArgs);
      });
    };
  },

  // ─── Debounce ────────────────────────────────────────────────────────────

  /**
   * Create a debounced version of a function that delays invocation until
   * `wait` ms have elapsed since the last call.
   * @param {Function} func
   * @param {number} wait - Delay in milliseconds
   * @param {boolean} [immediate=false] - Trigger on leading edge instead of trailing
   * @returns {Function}
   */
  debounce: function (func, wait, immediate) {
    var timeout;
    return function () {
      var context = this;
      var args = arguments;
      var later = function () {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  },

  // ─── Chat @-Mention Click Handler ────────────────────────────────────────

  /**
   * Attach a click handler to an element that inserts "@username " into the chat input.
   * Works on .prson (user list), .ft-avatar (chat avatar), and .chatName elements.
   * @param {jQuery} element - jQuery-wrapped DOM element
   */
  chatAt: function (element) {
    element.on("click", function () {
      var nameToAt;
      if (element.hasClass("prson")) {
        nameToAt = $(this).find(".prsnName").text();
      } else if (element.hasClass("ft-avatar")) {
        nameToAt = $(this).next(".chatContent").find(".chatName").text();
      } else if (element.hasClass("chatName")) {
        nameToAt = $(this).text();
      }
      $("#newchat").val(function (i, val) {
        return val + "@" + nameToAt + " ";
      }).focus();
    });
  },

  // ─── @-Mention Autocomplete ──────────────────────────────────────────────

  /**
   * Enter @-mention mode: populate the list of all usernames + "everyone".
   */
  initAtLand: function () {
    firetable.atLand = true;
    firetable.atString = "";
    firetable.atUsers = ["everyone"];
    for (var user in ftapi.users) {
      firetable.atUsers.push(ftapi.users[user].username);
    }
    firetable.atUsersFiltered = firetable.atUsers.sort();
  },

  /**
   * Filter the @-mention dropdown to match the characters typed so far.
   */
  updateAtLand: function () {
    firetable.atUsersFiltered = firetable.atUsers
      .filter(function (user) {
        return user.toLowerCase().startsWith(firetable.atString.toLowerCase());
      })
      .sort();
    $('#atPicker').html('');
    if (firetable.atUsersFiltered.length) {
      for (var i = 0; i < firetable.atUsersFiltered.length; i++) {
        var $btn = $('<div class="atPickerThing"><button class="butt graybutt" role="option" aria-selected="false">@' + firetable.utilities.htmlEscape(firetable.atUsersFiltered[i]) + '</button></div>');
        if (i === 0) $btn.find('.butt').attr('aria-selected', 'true');
        $btn.appendTo('#atPicker');
      }
    } else {
      $('<div class="atPickerThing"><i>No users match</i></div>').appendTo('#atPicker');
    }
  },

  /**
   * Accept an @-mention selection: insert the name, close the picker.
   * @param {string} atPeep - Username to insert (without the @)
   */
  chooseAt: function (atPeep) {
    var $chatText = $('#newchat');
    // Remove the partial string the user typed after @
    if (firetable.atString.length > 0) {
      $chatText.val($chatText.val().slice(0, firetable.atString.length * -1));
    }
    $chatText.val($chatText.val() + atPeep + " ");
    firetable.utilities.exitAtLand();
  },

  /**
   * Exit @-mention mode: reset state and hide the picker.
   */
  exitAtLand: function () {
    firetable.atLand = false;
    firetable.atUsersFiltered = [];
    firetable.atString = "";
    $('#atPicker').removeClass('show').html('');
  },

  // ─── Cancel Search/Queue Preview ───────────────────────────────────────

  /**
   * If a search-result or queue preview is playing, stop it and resume
   * the current room song.  This pattern was duplicated 6+ times across
   * search handlers, cancelqsearch, queueTrack, etc.
   *
   * Returns true if a preview was actually cancelled, false otherwise.
   * @returns {boolean}
   */
  cancelSearchPreview: function () {
    if (!firetable.preview) return false;
    var prefix = String(firetable.preview).slice(0, 5);
    if (prefix !== "ytcid" && prefix !== "sccid") return false;

    $("#pv" + firetable.preview).html("&#xE037;");
    clearTimeout(firetable.ptimeout);
    firetable.ptimeout = null;
    $("#pvbar" + firetable.preview).css("background-image", "none").removeClass("previewing");
    clearInterval(firetable.movePvBar);
    firetable.movePvBar = null;
    firetable.preview = false;
    firetable.previewType = null;
    firetable.utilities.resumeCurrentSong();
    return true;
  },

  // ─── Resume Current Song (Deduplication Helper) ──────────────────────────

  /**
   * Resume playback of the current song at the correct elapsed position.
   *
   * This replaces the identical block of code that was copy-pasted 8+ times
   * across the original codebase (in pview, reloadtrack, queueTrack,
   * cancelqsearch, search handlers, newSong, initialize, SC READY, etc.).
   *
   * Calculates how much time has elapsed since the song started,
   * then loads either the YouTube player or SoundCloud widget at that offset.
   *
   * @param {Object} [opts] - Optional overrides
   * @param {boolean} [opts.forceVolume=false] - Also set volume after loading
   */
  resumeCurrentSong: function (opts) {
    opts = opts || {};
    if (!firetable.song) return;
    if (firetable.preview) return; // don't interrupt a preview

    var data = firetable.song;
    var timeSince = ftapi.now() - data.started;
    if (timeSince <= 0) timeSince = 0;

    var secSince = Math.floor(timeSince / 1000);

    var vol = firetable.utilities.getEffectiveVolume();

    if (data.type === MEDIA_YOUTUBE) {
      if (firetable.scLoaded) firetable.scwidget.pause();
      if (!firetable.ytLoaded) return; // the YouTube player starts this song itself once it's ready
      player.setVolume(vol);
      if (!firetable.disableMediaPlayback) {
        firetable.media.videoLoading();
        player.loadVideoById(data.cid, secSince, "large");
      }
    } else if (data.type === MEDIA_SOUNDCLOUD) {
      if (firetable.ytLoaded) player.stopVideo();
      firetable.scSeek = timeSince;
      if (!firetable.disableMediaPlayback) {
        firetable.scwidget.load(SC_API_TRACK_URL + data.cid, {
          auto_play: true,
          callback: function () {
            firetable.scwidget.setVolume(vol);
            firetable.scwidget.play();
          }
        });
        firetable.media.watchSoundCloud();
      }
    }
  }
};
