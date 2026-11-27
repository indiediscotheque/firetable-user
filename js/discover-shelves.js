/**
 * Home's shelves of covers (New this week's, under its lead; Not played live
 * yet; Fresh in the room; New releases): two full rows each, however many
 * covers fit across (two on a phone is four songs, five across is ten). The
 * page draws more than fit (js/discover.js); this counts the grid's columns
 * and hides the rest, again whenever the page is redrawn or its width
 * changes. Each shelf's link has them all.
 *
 * Not played live yet (.d-norepeat) skips a song New this week already shows
 * (its lead, or a cover in its two rows), and the next takes its place: in
 * a week nobody had played yet the two were the same songs. A shelf left
 * with nothing hides. Without a week's row, nothing is skipped.
 */
(function () {
  "use strict";

  var ROWS = 2;
  var SHELF = "#dBrowse .ft-cards.d-compact";

  /** How many columns a grid has as laid out now (its computed tracks). */
  function columns(grid) {
    var tracks = getComputedStyle(grid).gridTemplateColumns;
    return Math.max(1, tracks && tracks !== "none" ? tracks.trim().split(/\s+/).length : 1);
  }

  /** One shelf: two rows of its songs, skipping those in `skip`. */
  function fit(grid, skip) {
    var room = columns(grid) * ROWS;
    var shown = 0;
    Array.prototype.forEach.call(grid.children, function (card) {
      var show = shown < room && !skip[card.getAttribute("data-cid")];
      card.classList.toggle("d-over", !show);
      if (show) shown++;
    });
    var section = grid.closest("section");
    if (section) section.classList.toggle("d-noshelf", !shown && grid.children.length > 0);
  }

  /** Every shelf on the page, New this week's first (what it shows, the rows below may skip). */
  function fitAll() {
    var week = {};
    document.querySelectorAll(SHELF).forEach(function (grid) {
      fit(grid, grid.classList.contains("d-norepeat") ? week : {});
      if (!grid.closest(".d-week")) return;
      grid.parentElement.querySelectorAll(".d-lead[data-cid], .d-compact > .pvbar:not(.d-over)[data-cid]").forEach(function (card) {
        week[card.getAttribute("data-cid")] = true;
      });
    });
  }

  function start() {
    var page = document.getElementById("dBrowse");
    if (!page || !window.ResizeObserver || !window.MutationObserver) return;
    var refit = firetable.utilities && firetable.utilities.oncePerFrame ? firetable.utilities.oncePerFrame(fitAll) : fitAll;
    // its width: the window, or a side column folding or opening
    new ResizeObserver(refit).observe(page);
    // a redraw: straight away, before the browser paints the new page
    new MutationObserver(fitAll).observe(page, { childList: true, subtree: true });
    fitAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
