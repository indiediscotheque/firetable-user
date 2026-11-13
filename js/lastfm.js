/**
 * lastfm.js — Last.fm scrobbling integration.
 *
 * Handles: session management (connect/disconnect), and nowPlaying,
 * scrobbles and track.love for what this person is actually hearing: the
 * room's song in Live or a Discover song (see "What you're hearing").
 *
 * Every call goes through this site's signing proxy (api/lastfm.php,
 * LASTFM_PROXY_URL), which holds the app's API key and shared secret, so
 * neither ships to the browser. Session keys are stored in localStorage so
 * scrobbling persists across page reloads.
 */

firetable.lastfm = {

  /** @type {string|false}  Last.fm session key, or false if not connected */
  sk: false,

  /** @type {boolean}  The proxy said Last.fm isn't set up on this server; stop calling it */
  unavailable: false,

  // ─── Session Management ────────────────────────────────────────────────

  /**
   * Disconnect the Last.fm session and clear stored credentials.
   * Re-renders the settings link to allow re-connecting.
   */
  killSession: function () {
    firetable.lastfm.sk = false;
    localStorage[STORAGE.lastfmSession] = firetable.lastfm.sk;
    firetable.lastfm.renderToggle();
  },

  /**
   * Render the Settings link: "Set up" when disconnected, "Disconnect" when connected.
   */
  renderToggle: function () {
    $("#scrobtoggle").off('click.lastfm').on('click.lastfm', '.lastfmDisconnect', function (e) {
      e.preventDefault();
      firetable.lastfm.killSession();
    });
    if (firetable.lastfm.sk) {
      $("#scrobtoggle").html(
        '<a href="#" class="lastfmDisconnect">Disconnect Last.fm scrobbling</a>'
      );
    } else {
      $("#scrobtoggle").empty().append(
        $('<a>').attr('href', firetable.lastfm.connectURL()).text('Set up Last.fm scrobbling')
      );
    }
  },

  /**
   * The "Set up" link: the proxy sends the visitor to Last.fm's "allow
   * access" page, which comes back here with ?token=.
   * @returns {string}
   */
  connectURL: function () {
    var back = new URL(window.location.href);
    back.searchParams.delete('token');
    back.hash = '';
    var url = new URL(LASTFM_PROXY_URL);
    url.searchParams.set('action', 'connect');
    url.searchParams.set('cb', back.href);
    return url.href;
  },

  /**
   * Swap the one-time ?token= from Last.fm's redirect for a session key.
   * @param {string} token
   * @returns {Promise<void>}
   */
  connect: function (token) {
    return firetable.lastfm.call('auth.getSession', { token: token }, 'auth.getSession').then(function (res) {
      if (!res || !res.session || !res.session.key) return; // e.g. expired/used token: "Set up" stays
      firetable.lastfm.sk = res.session.key;
      localStorage[STORAGE.lastfmSession] = firetable.lastfm.sk;
      firetable.lastfm.renderToggle();
    });
  },

  // ─── What you're hearing ────────────────────────────────────────────────
  // Scrobbles follow what this person actually hears, not what the room
  // plays: the room's song (Live) or a Discover song, whichever is sounding.
  // Once a second we ask the players what's playing; time only counts while
  // a song is really audible (playing, not paused, buffering, blocked by the
  // browser, muted, or covered by a 30-second preview). A song that pauses,
  // or gives way to the other side and comes back, keeps the time it had.
  // Last.fm's rule decides the scrobble: a track over 30 s, once half of it
  // (or 4 minutes) has been heard.

  /** @type {Object<string, Object>}  The current play on each side: live and discover */
  _plays: { live: null, discover: null },
  /** @type {string|null}  The play last sent as "now playing" */
  _reported: null,
  /** @type {Object|null}  The play heard at the last tick */
  _last: null,
  /** @type {number}  ms timestamp of the last tick */
  _lastTick: 0,
  /** @type {boolean|null}  The SoundCloud widget's last answer to isPaused (it only answers later) */
  _scPaused: null,
  /** @type {number|null}  setInterval ID of the listening clock */
  _clock: null,
  TICK_MS: 1000,

  /** Start the listening clock (once; it idles while not connected). */
  start: function () {
    var L = firetable.lastfm;
    if (L._clock) return;
    L._lastTick = Date.now();
    L._clock = setInterval(L._tick, L.TICK_MS);
  },

  /** A play record for one hearing of one song. */
  _play: function (key, source, song) {
    return { key: key, source: source, cid: String(song.cid), type: Number(song.type || MEDIA_YOUTUBE),
      artist: song.artist, title: song.title, duration: Number(song.duration) || 0,
      start: null, heard: 0, scrobbled: false };
  },

  /** The room's song, as a play (the same one until the room moves on). */
  _livePlay: function () {
    var L = firetable.lastfm, s = firetable.song;
    if (!s || !s.cid || s.cid == 0) return null;
    var key = "live:" + s.started + ":" + s.cid;
    var p = L._plays.live;
    if (!p || p.key !== key) p = L._plays.live = L._play(key, "live", s);
    // a tag fix that arrived meanwhile is what gets scrobbled
    p.artist = s.artist; p.title = s.title;
    if (s.duration) p.duration = Number(s.duration);
    return p;
  },

  /** Discover's song, as a play, while it's the one sounding (not paused). */
  _discoverPlay: function () {
    var L = firetable.lastfm;
    var d = firetable.discover && firetable.discover.hearing && firetable.discover.hearing();
    if (!d) return null;
    var key = "discover:" + d.play + ":" + d.cid;
    var p = L._plays.discover;
    if (!p || p.key !== key) p = L._plays.discover = L._play(key, "discover", d);
    if (d.duration) p.duration = Number(d.duration);
    return p;
  },

  /** Is the room's player really sounding this song right now? */
  _sounding: function (p) {
    if (p.type === MEDIA_YOUTUBE) {
      if (!firetable.ytLoaded || typeof player === "undefined" || !player.getPlayerState) return false;
      if (player.getPlayerState() !== 1) return false; // PLAYING (not buffering, paused, ended…)
      var v = player.getVideoData && player.getVideoData();
      return !(v && v.video_id && v.video_id !== p.cid);
    }
    if (!firetable.scLoaded || !firetable.scwidget) return false;
    firetable.scwidget.isPaused(function (paused) { firetable.lastfm._scPaused = !!paused; });
    return firetable.lastfm._scPaused === false;
  },

  /** The play this person is hearing right now, or null. */
  _hearing: function () {
    var L = firetable.lastfm;
    if (firetable.disableMediaPlayback || firetable.utilities.getEffectiveVolume() <= 0) return null;
    var p;
    if (firetable.preview === "discover") p = L._discoverPlay(); // a Discover song (or the room stopped)
    else if (firetable.preview) return null;                     // a 30-second preview
    else if (firetable.overlayPreview && firetable.overlayPreview.active()) return null; // a preview over the room
    else if (document.body.classList.contains("media-blocked")) return null; // the browser held the room back
    else p = L._livePlay();
    return p && L._sounding(p) ? p : null;
  },

  /** Once a second: count what was heard, update now playing, scrobble when due. */
  _tick: function () {
    var L = firetable.lastfm;
    var now = Date.now();
    var elapsed = (now - L._lastTick) / 1000;
    L._lastTick = now;
    if (!L.sk || L.unavailable) { L._last = null; return; }
    var p = L._hearing();
    if (!p) { L._last = null; return; }
    if (p.start == null) p.start = Math.floor(now / 1000);
    // heard since the last tick only if it was the same song then too; a
    // late tick counts (background tabs run timers late) but a sleep doesn't
    if (L._last === p) p.heard += Math.min(elapsed, document.hidden ? 65 : 5);
    L._last = p;
    if (L._reported !== p.key) {
      L._reported = p.key;
      L.nowPlaying(p);
    }
    if (!p.scrobbled && p.duration > 30 && p.heard >= Math.min(p.duration / 2, 240)) {
      p.scrobbled = true;
      L.scrobble(p);
    }
  },

  // ─── API Calls ─────────────────────────────────────────────────────────

  /** A play's artist and cleaned-up title as plain text, plus the session key (null when there's nothing to send). */
  _trackFields: function (p) {
    if (!p || !p.artist || !p.title || !firetable.lastfm.sk) return null;
    return {
      sk:     firetable.lastfm.sk,
      artist: firetable.utilities.decodeEntities(p.artist),
      track:  firetable.lastfm._cleanForScrobble(firetable.utilities.decodeEntities(p.title))
    };
  },

  /**
   * Submit a scrobble (track.scrobble) for a play: called by the listening
   * clock once enough of it has been heard. The timestamp is when this
   * person started hearing it.
   * @param {Object} p - a play from _hearing
   */
  scrobble: function (p) {
    var fields = firetable.lastfm._trackFields(p);
    if (!fields) return;
    fields.timestamp = p.start;
    if (p.duration) fields.duration = Math.round(p.duration);
    firetable.lastfm.call('track.scrobble', fields, 'scrobbled');
  },

  /** Send a track.love for what you're hearing (or, failing that, the room's song). */
  love: function () {
    var L = firetable.lastfm;
    var fields = L._trackFields(L._last || L._livePlay());
    if (!fields) return;
    L.call('track.love', fields, 'loved');
  },

  /**
   * Send a track.updateNowPlaying: called by the listening clock whenever a
   * different song starts sounding for this person.
   * @param {Object} p - a play from _hearing
   */
  nowPlaying: function (p) {
    var fields = firetable.lastfm._trackFields(p);
    if (!fields) return;
    if (p.duration) fields.duration = Math.round(p.duration);
    firetable.lastfm.call('track.updateNowPlaying', fields, 'nowplaying updated');
  },

  /**
   * POST one Last.fm call to the signing proxy.
   * @param {string} method - Last.fm method, e.g. "track.scrobble"
   * @param {Object} fields - the call's fields (no api_key/api_sig: the proxy adds them)
   * @param {string} what - label for log messages
   * @returns {Promise<Object|null>} Last.fm's answer, or null when the call failed
   */
  call: function (method, fields, what) {
    if (firetable.lastfm.unavailable) return Promise.resolve(null);
    var body = new URLSearchParams({ method: method });
    $.each(fields, function (k, v) {
      if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
    });
    return fetch(LASTFM_PROXY_URL, { method: 'POST', body: body, credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return { error: 'HTTP ' + r.status }; })
          .then(function (res) { return firetable.lastfm._handle(res, what, r.status); });
      })
      .catch(function (err) {
        console.error("Last.fm " + what + " failed:", err);
        return null;
      });
  },

  /**
   * Strip common YouTube title suffixes that pollute scrobble data.
   * e.g. " (Official Audio)", " (Official Video)"
   * @param {string} title
   * @returns {string} Cleaned title
   */
  _cleanForScrobble: function (title) {
    return title.replace(/ \([oO]fficial (?:[aA]udio|[vV]ideo)\)/, "");
  },

  /**
   * Check an answer from the proxy. Last.fm's own errors carry a numeric
   * code; an invalid/revoked session (9) disconnects, so the "Set up Last.fm
   * scrobbling" link comes back instead of failing silently forever. The
   * proxy's errors are text; 501 means Last.fm isn't set up on this server.
   * @param {Object} res - parsed JSON answer
   * @param {string} what - label for log messages
   * @param {number} [status] - HTTP status
   * @returns {Object|null} res when it succeeded, otherwise null
   */
  _handle: function (res, what, status) {
    if (res && !res.error) {
      firetable.debug && console.log("Last.fm " + what);
      return res;
    }
    var err = res && res.error;
    console.warn("Last.fm " + what + " failed:", err, (res && res.message) || '');
    if (err === 9) firetable.lastfm.killSession();
    if (status === 501) firetable.lastfm.unavailable = true;
    return null;
  }
};
