/**
 * theme-slot.js — where the room's theme sits. In Live on a computer (1024px
 * and up) with the left column open, it's the column's first section: under
 * the counts of who's here, over the DJ waitlist and the decks, with the rest
 * of the room's state (the owner, November 27, 2026: it had been on the stage,
 * over the song, since round 5, and crowded the song's title there).
 * #themeSlot (the pill, which opens #themePopover) goes into #usersbox, after
 * #usersStats. Everywhere else it's in the header, where index.html puts it:
 * in Discover (a row under Discover | Live), with the column folded (the
 * toolbar's theme icon, css/rail.css), on phones and tablets, for a visitor
 * (whose column is #pe-here, drawn whole by js/people.js), and in the
 * Turntable theme (js/ttskin.js), which shows the theme its own way.
 *
 * The element itself moves, never a copy (ids are an API): while it's in the
 * column a comment keeps its place in the header, as js/discover.js keeps the
 * chat's. It's placed again when Discover or Live changes, the window crosses
 * 1024px, the column folds or opens, the Turntable theme goes on or off, and
 * signing in or out adds or takes away the room's panels (#appShell).
 * css/looks.css draws it in the column ("The theme in Live's left column").
 */
firetable.themeSlot = (function () {
  "use strict";

  var wide = window.matchMedia("(min-width: 1024px)");
  var home = null; // the comment that keeps its place in the header while it's in the column
  // kept, not looked up: signing out takes the room's panels out of the page, the theme with them
  var slotEl = null;

  /** In the column: Live, at a computer's width, the column open, in the room's own look. */
  function inColumn() {
    var b = document.body.classList;
    return wide.matches && !b.contains("ft-discover") && !b.contains("tt-skin") &&
      !document.documentElement.classList.contains("rail");
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
    if (focused) slot.querySelector("#themePill").focus({ preventScroll: true });
  }

  /** Put the theme where it belongs now (nothing moves while it's there already). */
  function place() {
    var slot = slotEl || (slotEl = document.getElementById("themeSlot"));
    var box = document.getElementById("usersbox"); // a member's room panels only (#appShell)
    var grid = document.getElementById("mainGrid");
    if (!slot) return;
    if (box && grid && !grid.classList.contains("login") && inColumn()) {
      if (slot.parentNode === box) return;
      if (!home) {
        home = document.createComment("themeSlot");
        slot.parentNode.insertBefore(home, slot);
      }
      var stats = document.getElementById("usersStats");
      move(slot, box, stats && stats.parentNode === box ? stats.nextSibling : box.firstChild);
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
    // signing in or out puts the room's panels in or takes them out, and the grid's class says which (js/users.js)
    var grid = document.getElementById("mainGrid");
    if (grid) watch.observe(grid, { childList: true, attributes: true, attributeFilter: ["class"] });
    if (wide.addEventListener) wide.addEventListener("change", place);
  }

  return { init: init, place: place };
})();
