/**
 * stage-state.js — what the stage says when nobody is playing.
 *
 * Two states, both moved out of room.js:
 *  - the decks' note (1.10, firetable.ui.renderStageState): with nobody on the
 *    decks, "The decks are open" over the deck's own join button;
 *  - the song card (#nowplaying) with nothing playing
 *    (firetable.ui.renderNoSong): "Nothing playing", what played last when
 *    it's known, and the room's own art. It used to keep a grey loading
 *    skeleton reading "Loading firetable…" on a first visit to a quiet room,
 *    and the song that had ended once the decks emptied. The player bar says
 *    "Nothing playing · The room is quiet" in the same words (js/discover.js).
 *
 * room.js's newSong hands the card over when there's no song (songToPlay
 * empty) or the bot's own stand-in for none (cid 0, "Nothing Is Playing"),
 * with its art and fade helpers, and draws the next song as it always has.
 * The stage keeps its look: only the card's words and art change. The
 * Turntable theme's songboard reads the same card (js/ttskin.js).
 */

/**
 * The stage's states (1.10): with nobody on the decks, "The decks are open"
 * over the deck's own join button. With only the room's bot there, the stage
 * says nothing: the bot is just the DJ. ("Listen to the room", shown while the browser holds
 * the sound back, is one line: the stage and the bar already say who's playing what.)
 */
firetable.ui.renderStageState = function () {
  var users = ftapi.users || {};
  var here = 0;
  for (var uid in users) if (users.hasOwnProperty(uid) && users[uid] && !users[uid].hostbot) here++;
  var hereText = here ? firetable.utilities.pluralize(here, "person", "people") + " here" : "";
  var djs = [];
  var table = firetable.tableData || {};
  for (var k in table) if (table.hasOwnProperty(k) && table[k]) djs.push(table[k]);
  var mine = djs.some(function (d) { return d.id === ftapi.uid; });
  var state = !djs.length ? "open" : null;
  var stage = document.getElementById("djStage");
  if (stage) {
    stage.classList.toggle("st-empty", state === "open");
  }
  var box = document.getElementById("st-state");
  if (box) {
    box.hidden = !state || mine;
    document.getElementById("st-stateText").textContent = state === "open"
      ? "The decks are open. Hop on and the room plays from your ★ playlist." + (hereText ? " " + hereText + "." : "")
      : "";
  }
};

(function () {
  "use strict";
  var quiet = false; // the card says Nothing playing
  var ended = null;  // the song that played last here: {title, artist}

  /** The room's newest play in Recent, once Recent has loaded (room.js keeps its plays). */
  function latestPlay() {
    var best = null;
    (firetable._historyCache || []).forEach(function (h) {
      if (h && h.title && (!best || (+h.when || 0) >= (+best.when || 0))) best = h;
    });
    return best;
  }

  /** "Last played: Night Drive · Glider", or nothing when it isn't known. */
  function lastLine() {
    var t = ended || latestPlay();
    if (!t) return "";
    var title = firetable.ui.strip(String(t.title || "")), artist = firetable.ui.strip(String(t.artist || ""));
    return "Last played: " + title + (artist ? " · " + artist : "");
  }

  /**
   * The quiet card's words are words: Discover makes the song card's title a
   * button that opens the song and its artist line links (js/discover.js
   * linkLive), and with no song there's nothing to open ("Last played: …"
   * would link to an artist called that). linkLive leaves text it has linked
   * already (data-linked) and a title while no song is on; the next song's
   * words are linked again.
   */
  function plain(track, artist) {
    track.classList.remove("d-sheetlink");
    ["role", "tabindex", "title"].forEach(function (a) { track.removeAttribute(a); });
    artist.setAttribute("data-linked", artist.textContent);
  }

  /**
   * Nothing playing: the song card says so (see the top of this file).
   * @param {Object|null} data - songToPlay: null, or the bot's stand-in (cid 0)
   * @param {function(string, boolean)} setArt - room.js setNowPlayingAlbumArt
   * @param {function(function)} fade - room.js animateNowPlayingChange (it also
   *   cancels a song's words still on their way in)
   */
  firetable.ui.renderNoSong = function (data, setArt, fade) {
    var was = firetable.song;
    if (was && was.cid && was.cid != 0) ended = { title: was.title, artist: was.artist };
    // as on a first visit to a quiet room: everything else reads no song, or
    // the bot's cid 0, as nothing playing (the player bar, Fire and Grab, Last.fm)
    firetable.song = data || null;
    quiet = true;
    firetable.media.hush(); // the room's players stop, unless a preview or Discover holds them
    // a SoundCloud song's screen (glitch.js) goes as it does for a video, and comes back with the next one (room.js)
    var sc = document.getElementById("scScreen");
    if (sc) sc.style.display = "none";
    firetable.ui.markCurrentDj();
    firetable.media.songChanged();
    firetable.ui.applyBeat(); // no tempo
    ["timrUp", "timr"].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = ""; });
    var link = document.getElementById("songlink");
    if (link) link.removeAttribute("href");
    fade(function () {
      var track = document.getElementById("track"), artist = document.getElementById("artist");
      track.classList.remove("skel");
      artist.classList.remove("skel");
      track.textContent = "Nothing playing";
      artist.textContent = lastLine();
      plain(track, artist);
      setArt(ftconfigs.defaultAlbumArtUrl || "img/idlogo.png", true);
    });
  };

  // a song is on: the card is the song's again (room.js draws it)
  ftapi.events.on("newSong", function (data) { if (data && data.cid && data.cid != 0) quiet = false; });
  // Recent arrived while it's quiet: what played last, if the song that ended isn't known
  ftapi.events.on("newHistory", firetable.utilities.oncePerFrame(function () {
    if (!quiet || ended) return;
    var line = lastLine(), artist = document.getElementById("artist");
    if (!artist || artist.textContent === line) return;
    artist.textContent = line;
    plain(document.getElementById("track"), artist);
  }));
})();
