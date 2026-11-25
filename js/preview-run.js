/**
 * preview-run.js — the crate's Play button in Live: the playlist as previews.
 *
 * In Live the room is playing, so Play (#cr-playHere, before the picker)
 * doesn't take over: it plays the playlist on screen as 30-second previews,
 * one song after another in play order, each from a quarter of the way in
 * (PREVIEW_FROM, js/player.js), the way a song's own play button previews it.
 * The room comes back after each, as after any preview, and for good at the
 * end of the list. The button again stops it; so does previewing another
 * song, switching playlist or going to Discover.
 *
 * In Discover the same button plays the playlist in full, in Discover's
 * player (js/discover-queue.js): this file draws it only while it's in Live.
 */
firetable.previewRun = (function () {
  "use strict";
  var run = null; // { list: the playlist, id: the key previewing now, at: its place in it }

  function btn() { return document.getElementById("cr-playHere"); }
  function inDiscover() { return document.body.classList.contains("d-queue-here"); }

  /** The playlist on screen, in play order (not the view's sort). */
  function keys() {
    var q = ftapi.queue || {};
    return Object.keys(q).sort(ftapi.utilities.compareKeys).filter(function (k) { return q[k] && q[k].cid != null; });
  }

  /** The button, as Live has it: Play the previews, or Stop them. */
  function draw() {
    var b = btn();
    if (!b || inDiscover()) return;
    var label = run ? "Stop the previews" : "Preview this playlist: 30 seconds of each song";
    b.hidden = false;
    b.disabled = !run && !keys().length;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.classList.toggle("on", !!run);
    b.querySelector("i").textContent = run ? "stop" : "play_arrow";
  }

  /** Preview the song after the one that just played (the first, to start). */
  function next() {
    var all = keys();
    var i = run.id ? all.indexOf(run.id) + 1 : 0;
    if (run.id && i === 0) i = run.at; // it left the list meanwhile: the one now in its place
    var key = all[i];
    if (!key) return stop();
    run.id = key;
    run.at = i;
    firetable.actions.pview(key, false, ftapi.queue[key].type);
    var row = document.getElementById("pvbar" + key);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    draw();
  }

  function start() {
    if (firetable.overlayPreview && firetable.overlayPreview.active()) firetable.overlayPreview.stop();
    run = { list: String(firetable.viewListID || "0"), id: null, at: 0 };
    next();
  }

  /** Stop: the preview playing now too, when it's still ours (the room comes back). */
  function stop() {
    var was = run;
    run = null;
    draw();
    if (!was || !was.id) return;
    if (firetable.preview === was.id || (firetable.overlayPreview && firetable.overlayPreview.active())) {
      firetable.actions.pview(was.id, false, ftapi.queue && ftapi.queue[was.id] ? ftapi.queue[was.id].type : MEDIA_YOUTUBE);
    }
  }

  /** Forget the run without touching what plays (someone chose something else). */
  function drop() {
    if (!run) return;
    run = null;
    draw();
  }

  var b = btn();
  if (b) {
    b.addEventListener("click", function () {
      if (inDiscover()) return; // Discover's: js/discover-queue.js
      if (run) stop();
      else start();
    });
  }
  // a song's own preview takes over (capture: before the row's handler starts it)
  var rows = document.getElementById("mainqueue");
  if (rows) rows.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".previewicon")) drop(); }, true);
  ftapi.events.on("previewEnded", function (id) { if (run && id === run.id) next(); });
  // another playlist on screen ends it; a change to this one (a song added, moved) doesn't
  ftapi.events.on("playlistChanged", function (data, listID) {
    if (run && listID != null && String(listID) !== run.list) stop();
    draw();
  });

  return { draw: draw, stop: stop, drop: drop, running: function () { return !!run; } };
})();
