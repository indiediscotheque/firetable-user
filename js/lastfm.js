/**
 * lastfm.js — Last.fm scrobbling integration.
 *
 * Handles: session management (connect/disconnect), nowPlaying updates,
 * scrobble submissions, and track.love.
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

  /** @type {number|null}  Unix timestamp (seconds) when the current song started */
  songStart: null,

  /** @type {number|null}  Duration of the current song in seconds */
  duration: null,

  /** @type {number|null}  setTimeout ID for the scrobble timer */
  timer: null,

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

  // ─── API Calls ─────────────────────────────────────────────────────────

  /** Is the user actually hearing the room right now? (not muted, media on, no preview) */
  _listening: function () {
    return !firetable.disableMediaPlayback && !firetable.preview &&
      firetable.utilities.getEffectiveVolume() > 0;
  },

  /** The current song's artist and cleaned-up title as plain text, plus the session key (null when nothing is playing). */
  _trackFields: function () {
    var song = firetable.song;
    if (!song || !song.artist || !song.title || !firetable.lastfm.sk) return null;
    return {
      sk:     firetable.lastfm.sk,
      artist: firetable.utilities.decodeEntities(song.artist),
      track:  firetable.lastfm._cleanForScrobble(firetable.utilities.decodeEntities(song.title))
    };
  },

  /**
   * Submit a scrobble (track.scrobble) for the current song.
   * Scheduled by room.js once enough of the track has played.
   */
  scrobble: function () {
    if (!firetable.lastfm._listening()) return;
    var fields = firetable.lastfm._trackFields();
    if (!fields) return;
    fields.timestamp = firetable.lastfm.songStart;
    if (firetable.lastfm.duration) fields.duration = firetable.lastfm.duration;
    firetable.lastfm.call('track.scrobble', fields, 'scrobbled');
  },

  /** Send a track.love for the current song. */
  love: function () {
    var fields = firetable.lastfm._trackFields();
    if (!fields) return;
    firetable.lastfm.call('track.love', fields, 'loved');
  },

  /**
   * Send a track.updateNowPlaying to Last.fm.
   * Called immediately when a new song starts.
   */
  nowPlaying: function () {
    if (!firetable.lastfm._listening()) return;
    var fields = firetable.lastfm._trackFields();
    if (!fields) return;
    if (firetable.lastfm.duration) fields.duration = firetable.lastfm.duration;
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
