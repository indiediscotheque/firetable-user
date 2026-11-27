/**
 * side-panel.js — Discover's right column (#dSide: Playlists or the crate,
 * and Chat) folded to a strip on wide screens (1024px and up), so the
 * library's pages take the room, and open again (Round 5, November 25, 2026).
 * Its button (#nav-sideBtn, index.html) sits at the column's top right, past
 * its tabs; folded, at the strip's top, with Chat's unread count, so new
 * messages aren't missed. css/discover.css draws both from html.side-shut,
 * which js/head.js puts on before the first paint where it was left folded
 * (STORAGE.side), so the column never shows open first.
 * - Folding with Chat showing goes to Playlists first: Discover counts new
 *   messages only while Chat isn't showing. The button brings Chat back. So
 *   does the window widening again with it folded (Chat may have been opened
 *   in the narrower window's sheet).
 * - Whatever opens the column opens it again: the full-screen player's list
 *   button, a side tab.
 * - Another open tab follows.
 * - The button moves into Discover's page, just before the column, so Tab
 *   reaches it after the middle and before the column's tabs.
 * Phones and tablets have the column as a sheet, and the Turntable theme its
 * own layout: the button isn't there, and the sheet stays as it is.
 */
firetable.sidePanel = (function () {
  "use strict";

  var root = document.documentElement;
  var wide = window.matchMedia("(min-width: 1024px)"); // narrower, the column is a sheet: no strip
  var $id = function (id) { return document.getElementById(id); };
  var fromChat = false; // folded with Chat showing: the button opens it on Chat again
  var own = false; // this file pressing a side tab: nothing opening the column

  function shut() { return root.classList.contains("side-shut"); }

  /**
   * Chat showing in the column on a wide screen: Playlists (or the crate)
   * instead, as Discover counts new messages only while Chat isn't showing.
   * Narrower, the column is a sheet someone may be reading: left as it is.
   */
  function offChat() {
    var list = wide.matches && document.querySelector('#dSide [data-sidetab="chat"].on') && document.querySelector('#dSide [data-sidetab="list"]');
    if (!list) return;
    own = true;
    try { list.click(); } finally { own = false; }
    fromChat = true;
  }

  /** Chat's unread count, as its tab shows it ("" for none). */
  function unread() {
    var n = document.querySelector("#dSide .d-unread");
    return n ? n.textContent.trim() : "";
  }

  /**
   * The button and its tooltip say what a press does; folded, with Chat's
   * unread count. The count follows a colon, not brackets: the name must hold
   * the number the button shows, and checkers (axe) leave out bracketed words.
   */
  function show() {
    var btn = $id("nav-sideBtn");
    var tip = $id("tip-nav-sideBtn");
    if (!btn) return;
    var folded = shut();
    var n = folded ? unread() : "";
    var says = folded ? "Open the side panel" + (n ? ": " + n + " new in Chat" : "") : "Fold the side panel";
    var count = btn.querySelector(".d-unread");
    // only what changed: this runs on every change in the column
    if (btn.getAttribute("aria-label") !== says) btn.setAttribute("aria-label", says);
    if (btn.getAttribute("aria-expanded") !== String(!folded)) btn.setAttribute("aria-expanded", String(!folded));
    if (count && count.textContent !== n) count.textContent = n;
    if (tip && tip.textContent !== says) tip.textContent = says;
  }

  /**
   * Fold the column (true) or open it (false).
   * @param {boolean} folded
   * @param {boolean} [quiet] - not kept: another tab did it
   * @returns {boolean} folded or not, after
   */
  function set(folded, quiet) {
    folded = !!folded;
    if (folded) offChat();
    else fromChat = false;
    if (folded !== shut()) {
      root.classList.toggle("side-shut", folded);
      window.dispatchEvent(new Event("resize")); // what measures itself (the lists, the stage) does again
    }
    if (!quiet) {
      try {
        if (folded) localStorage.setItem(STORAGE.side, "1");
        else localStorage.removeItem(STORAGE.side);
      } catch (e) { /* storage blocked: it lasts this visit */ }
    }
    show();
    return folded;
  }

  // the button; and whatever opens the column (the full-screen player's list button, a side tab)
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (own || !t.closest) return;
    if (t.closest("#nav-sideBtn")) {
      var chat = shut() && fromChat && document.querySelector('#dSide [data-sidetab="chat"]');
      set(!shut());
      if (chat) chat.click(); // as it was left
    } else if (shut() && wide.matches && t.closest(".pvf-list, #dSide [data-sidetab]")) set(false);
  });
  // another tab folded or opened it
  window.addEventListener("storage", function (e) {
    if (e.key !== STORAGE.side && e.key !== null) return;
    var v = null;
    try { v = localStorage.getItem(STORAGE.side); } catch (x) { /* storage blocked */ }
    set(v === "1", true);
  });
  // wider again, folded: Chat may have been opened in the sheet meanwhile
  if (wide.addEventListener) wide.addEventListener("change", function () { if (shut()) offChat(); });
  // Discover builds its page as the page starts (js/init.js): the button goes in it, just before the
  // column (index.html has it beside the left column's fold button), and Chat's unread count follows the tab's
  document.addEventListener("DOMContentLoaded", function () {
    var side = $id("dSide"), btn = $id("nav-sideBtn"), tip = $id("tip-nav-sideBtn");
    if (side) {
      if (btn) side.parentNode.insertBefore(btn, side);
      if (tip) side.parentNode.insertBefore(tip, side); // after it: its tooltip shows on its hover or focus
      new MutationObserver(show).observe(side, { childList: true, subtree: true, characterData: true });
    }
    show();
  });
  show();

  return {
    /** Folded to a strip. */
    isShut: shut,
    set: set,
    /** Fold it, or open it, whichever it isn't. */
    toggle: function () { return set(!shut()); }
  };
})();
