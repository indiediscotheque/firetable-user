/**
 * preview-run.js — the crate's Play button in Live: a preview of the top song.
 *
 * In Live the room is playing, so Play (#cr-playHere, before the picker)
 * doesn't take over: it previews the playlist's top song (the one the room
 * plays first when you DJ) for 30 seconds from a quarter of the way in
 * (PREVIEW_FROM, js/player.js), the way a song's own play button previews
 * it, and then the room's audio comes back. It doesn't go on to the next
 * song. The button says Stop meanwhile, and stops it early.
 *
 * In Discover the same button plays the playlist in full, in Discover's
 * player (js/discover-queue.js): this file draws it only while it's in Live.
 */
firetable.previewRun = (function () {
  "use strict";
  var playing = null; // the key this button is previewing, or null

  function btn() { return document.getElementById("cr-playHere"); }
  function inDiscover() { return document.body.classList.contains("d-queue-here"); }

  /** The playlist's top song, in play order (not the view's sort), or null. */
  function top() {
    var q = ftapi.queue || {};
    return Object.keys(q).sort(ftapi.utilities.compareKeys).filter(function (k) { return q[k] && q[k].cid != null; })[0] || null;
  }

  /** Is this button's preview still the one playing? (Another preview, or its end, takes over.) */
  function ours() {
    return !!playing && (firetable.preview === playing || (firetable.overlayPreview && firetable.overlayPreview.active()));
  }

  /** The button, as Live has it: Play the top song's preview, or Stop it. */
  function draw() {
    var b = btn();
    if (!b || inDiscover()) return;
    if (playing && !ours()) playing = null;
    var label = playing ? "Stop the preview" : "Preview the top song: 30 seconds, then back to the room";
    b.hidden = false;
    b.disabled = !playing && !top();
    b.title = label;
    b.setAttribute("aria-label", label);
    b.classList.toggle("on", !!playing);
    b.querySelector("i").textContent = playing ? "stop" : "play_arrow";
  }

  function type(key) { return ftapi.queue && ftapi.queue[key] ? ftapi.queue[key].type : MEDIA_YOUTUBE; }

  /** Stop the preview, when it's still this button's (the room comes back). */
  function stop() {
    if (ours()) firetable.actions.pview(playing, false, type(playing));
    playing = null;
    draw();
  }

  /** Forget it without touching what plays (another song's preview took over). */
  function drop() {
    if (!playing) return;
    playing = null;
    draw();
  }

  var b = btn();
  if (b) {
    b.addEventListener("click", function () {
      if (inDiscover()) return; // Discover's: js/discover-queue.js
      if (ours()) return stop();
      var key = top();
      if (!key) return;
      playing = key;
      firetable.actions.pview(key, false, type(key));
      draw();
    });
  }
  // a song's own preview takes over (capture: before the row's handler starts it)
  var rows = document.getElementById("mainqueue");
  if (rows) rows.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".previewicon")) drop(); }, true);
  // its 30 seconds are up: the room is back, and so is Play
  ftapi.events.on("previewEnded", function (id) { if (id === playing) drop(); });
  ftapi.events.on("playlistChanged", draw);

  return { draw: draw, stop: stop, drop: drop, running: function () { return !!playing; } };
})();
