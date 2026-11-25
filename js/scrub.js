/**
 * scrub.js — moving through a song on a seek bar: the time under the pointer.
 *
 * The player bar's progress line (#pv-seek, along the bar's top edge) and the
 * full-screen player's (#pv-fseek) are range inputs over a drawn bar
 * (.pb-track > .d-bar > i, js/discover.js). On one that can be moved through:
 *   - pointing at it shows the time a click would go to, and a paler stretch
 *     of the track up to there (--scrub-x), as YouTube's and Spotify's do;
 *   - dragging it moves the filled part and its handle with the pointer
 *     (.is-scrubbing; discover.js seeks when the drag ends).
 * The room's song can't be moved through (its input is disabled), so there's
 * nothing to show there. Nothing here plays or seeks: it only draws.
 */
(function () {
  "use strict";
  var tip = null;   // the one time label, moved into whichever track is in use
  var held = null;  // the track being dragged

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60);
  }

  /** The seek bar under an event, when its song can be moved through. */
  function trackOf(target) {
    var el = target && target.closest ? target.closest(".pb-track") : null;
    var range = el && el.querySelector("input[type=range]");
    return range && !range.disabled ? { el: el, range: range } : null;
  }

  /** Show the time at x (px from the track's left), kept inside the window at its ends. */
  function show(at, x) {
    var box = at.el.getBoundingClientRect();
    if (!box.width) return;
    x = Math.max(0, Math.min(box.width, x));
    if (!tip) {
      tip = document.createElement("span");
      tip.className = "pb-tip";
      tip.setAttribute("aria-hidden", "true");
    }
    if (tip.parentNode !== at.el) at.el.appendChild(tip);
    tip.textContent = clock((x / box.width) * Number(at.range.max || 0));
    var half = tip.offsetWidth / 2 + 4;
    tip.style.left = Math.max(half - box.left, Math.min(window.innerWidth - half - box.left, x)) + "px";
    at.el.style.setProperty("--scrub-x", x + "px");
  }

  function hide() {
    if (tip && tip.parentNode) {
      tip.parentNode.style.removeProperty("--scrub-x");
      tip.parentNode.removeChild(tip);
    }
  }

  function release() {
    if (held) held.classList.remove("is-scrubbing");
    held = null;
  }

  // a mouse over the track: the time under it
  document.addEventListener("pointermove", function (e) {
    if (held) return; // dragging: the input's own value leads (below)
    var at = e.pointerType === "mouse" ? trackOf(e.target) : null;
    if (at) show(at, e.clientX - at.el.getBoundingClientRect().left);
    else hide();
  });
  document.documentElement.addEventListener("pointerleave", hide); // out of the window
  window.addEventListener("blur", function () { release(); hide(); });

  // dragging (mouse, finger or arrow keys): the fill, the handle and the time follow the value
  document.addEventListener("input", function (e) {
    var at = trackOf(e.target);
    if (!at || e.target !== at.range) return;
    held = at.el;
    held.classList.add("is-scrubbing");
    var share = Number(at.range.value) / Math.max(1, Number(at.range.max));
    var fill = at.el.querySelector(".d-bar i");
    if (fill) fill.style.width = share * 100 + "%";
    show(at, share * at.el.getBoundingClientRect().width);
  });
  document.addEventListener("change", function (e) {
    if (!held || !held.contains(e.target)) return;
    release();
    // a mouse is still over it; a finger or a key has let go
    if (!e.target.matches(":hover")) hide();
  });
  document.addEventListener("pointercancel", function () { release(); hide(); });
})();
