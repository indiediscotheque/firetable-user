/**
 * preview-over.js — previews over the room (Settings → "Previews play over the room").
 *
 * Moved out of player.js as it stands: player.js's track preview hands a
 * YouTube preview to it when the setting is on.
 */

/**
 * With Settings → "Previews play over the room" on, a 30-second preview plays
 * in a second, hidden YouTube player while the room keeps playing at a fifth
 * of its volume, and the room comes back up when the preview ends. The room's
 * own player is never borrowed, so nothing about the room has to catch up
 * afterwards. SoundCloud previews (and Discover) still use the room's player.
 */
firetable.overlayPreview = (function () {
  var KEY = "ft-preview-over";
  var DUCK = 0.2;
  var pv = null;
  var ready = false;
  var pending = null;
  var state = { id: null, timer: null, bar: null, count: 0 };

  function on() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function wanted(type) {
    return on() && Number(type) === MEDIA_YOUTUBE && typeof YT !== "undefined" && !!YT.Player &&
      !firetable.disableMediaPlayback && firetable.preview !== "discover";
  }
  /** The room's volume: a fifth while a preview plays over it. (Always set:
   *  YouTube's player reports a new volume a moment late.) */
  function duck(down) {
    var v = firetable.utilities.getEffectiveVolume();
    var want = down ? Math.round(v * DUCK) : v;
    if (firetable.ytLoaded) player.setVolume(want);
    if (firetable.scLoaded && firetable.scwidget) firetable.scwidget.setVolume(want);
  }
  function make(cb) {
    pending = cb;
    if (pv) { if (ready) { pending = null; cb(); } return; }
    var host = document.createElement("div");
    host.id = "pvOverPlayer";
    document.body.appendChild(host);
    pv = new YT.Player("pvOverPlayer", {
      width: 320,
      height: 180,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1 },
      events: {
        onReady: function () { ready = true; keepFocusOut("pvOverPlayer"); var f = pending; pending = null; if (f) f(); },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.PLAYING) firetable.media.toQuarter(pv, state.id);
          if (e.data === YT.PlayerState.ENDED) stop();
        },
        onError: function () { stop(); firetable.ui.toast("That song can't be previewed here."); }
      }
    });
    keepFocusOut("pvOverPlayer");
  }
  /** The row being previewed: its progress (`pcnt`, or null for none) and its play / pause icon. */
  function paint(id, pcnt) {
    var row = document.getElementById("pvbar" + id), icon = document.getElementById("pv" + id);
    if (row) {
      row.classList.toggle("previewing", pcnt != null);
      row.style.backgroundImage = pcnt == null ? "none" : pcnt === 0 ? "" :
        "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 27%, transparent) " + pcnt + "%, var(--color-bg-t1) " + pcnt + "%)";
    }
    firetable.ui.previewIcon(icon, pcnt != null); // its glyph and its name (js/player.js)
  }
  function stop() {
    if (!state.id) return;
    clearTimeout(state.timer);
    clearInterval(state.bar);
    paint(state.id, null);
    state.id = null;
    if (pv && ready) pv.stopVideo();
    duck(false);
  }
  function toggle(id, fromSearch) {
    if (state.id === id) return stop();
    stop();
    var cid = fromSearch ? id.slice(5) : firetable.queue[id] && firetable.queue[id].cid;
    if (!cid) return;
    state.id = id;
    state.count = 0;
    paint(id, 0);
    state.timer = setTimeout(stop, PREVIEW_DURATION);
    firetable.media.quarterFor = id;
    state.bar = setInterval(function () {
      state.count += PREVIEW_BAR_INTERVAL / 1000;
      var pcnt = Math.min(100, (state.count / (PREVIEW_DURATION / 1000 - 1)) * 100);
      paint(state.id, pcnt);
      duck(true); // a new song in the room sets its own volume: keep it down
      if (pv && ready) pv.setVolume(firetable.utilities.getEffectiveVolume());
    }, PREVIEW_BAR_INTERVAL);
    duck(true);
    make(function () {
      if (state.id !== id) return;
      pv.setVolume(firetable.utilities.getEffectiveVolume());
      pv.loadVideoById(String(cid), 0, "small");
    });
  }
  return { on: on, wanted: wanted, toggle: toggle, stop: stop, active: function () { return !!state.id; }, KEY: KEY };
})();
