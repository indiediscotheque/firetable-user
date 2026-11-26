/**
 * theme-slot.js — where the room's theme sits (the owner's round 5, November
 * 25, 2026). In Live on a computer (1024px and up) it's on the stage, over
 * the song: #themeSlot (the pill, which opens #themePopover) goes into the
 * song card, #npText, before #track, with the left column open or folded into
 * the toolbar (js/rail.js: the stage shows it, so the toolbar needs no theme
 * icon in Live). Everywhere else it's in the header, where index.html puts
 * it: in Discover (whose stage is out of sight), on phones and tablets, and
 * in the Turntable theme (js/ttskin.js), which shows the theme its own way.
 *
 * The element itself moves, never a copy (ids are an API): while it's on the
 * stage a comment keeps its place in the header, as js/discover.js keeps the
 * chat's. It's placed again when Discover or Live changes, the window crosses
 * 1024px, the column folds or opens, or the Turntable theme goes on or off.
 * css/looks.css draws it on the stage ("The theme on Live's stage").
 */
firetable.themeSlot = (function () {
  "use strict";

  var wide = window.matchMedia("(min-width: 1024px)");
  var home = null; // the comment that keeps its place in the header while it's on the stage

  /** On the stage: Live, at a computer's width, in the room's own look. */
  function onStage() {
    var b = document.body.classList;
    return wide.matches && !b.contains("ft-discover") && !b.contains("tt-skin");
  }

  /**
   * Move it before `before` in `parent`. An open popover closes, since it was
   * placed beside where the pill was, and the keyboard's place stays on the
   * pill: if it was on the pill or in its popover (closing hands it back to
   * the pill, which the move would then drop), it's on the pill after.
   */
  function move(slot, parent, before) {
    var pop = document.getElementById("themePopover");
    var focused = slot.contains(document.activeElement) || !!pop && pop.contains(document.activeElement);
    try { if (pop && pop.matches(":popover-open")) pop.hidePopover(); } catch (e) { /* no popovers */ }
    parent.insertBefore(slot, before);
    if (focused) document.getElementById("themePill").focus({ preventScroll: true });
  }

  /** Put the theme where it belongs now (nothing moves while it's there already). */
  function place() {
    var slot = document.getElementById("themeSlot");
    var card = document.getElementById("npText");
    if (!slot || !card) return;
    if (onStage()) {
      if (slot.parentNode === card) return;
      if (!home) {
        home = document.createComment("themeSlot");
        slot.parentNode.insertBefore(home, slot);
      }
      var track = document.getElementById("track");
      move(slot, card, track && track.parentNode === card ? track : card.firstChild);
    } else if (home && home.parentNode) {
      move(slot, home.parentNode, home);
      home.parentNode.removeChild(home);
      home = null;
    }
  }

  function init() {
    place();
    // Discover or Live and the Turntable theme are the body's classes; the folded column is <html>'s
    var watch = new MutationObserver(place);
    watch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    if (wide.addEventListener) wide.addEventListener("change", place);
  }

  return { init: init, place: place };
})();
