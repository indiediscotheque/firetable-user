/**
 * rail.js — the left column folded into a toolbar, on wide screens (1024px
 * and up). Loaded by its stand-in in js/lazy.js (which keeps its ways in:
 * the button at the column's bottom, the [ key and Settings' switch); css/rail.css
 * draws it. This keeps it working:
 * - folding and opening (set, toggle): html.rail, kept on this device
 *   (STORAGE.rail, which js/head.js reads before the first paint next time),
 *   the button's and Settings' state, the column fading to its new shape
 *   (not with reduced motion), and the same in every open tab;
 * - where the list under the toolbar's top starts and ends (--rail-top,
 *   --rail-foot), measured from the top part and the buttons at the bottom;
 * - peek: who's here (the people button, or a visitor's faces) or search
 *   opens the column whole, over the middle, for a moment (html.rail-peek).
 *   Escape, a click or the focus going outside, choosing a view, or the
 *   button (a collapse button while the column shows) puts it away;
 * - one tooltip, beside the icon or face under the pointer or the keyboard:
 *   what it does, or who it is and what they're up to;
 * - the count on the people button, and who that is in its tooltip;
 * - the account menu, folded, also has Open the column (light mode, the
 *   shortcuts and About are in it already), so the toolbar keeps to what's
 *   used all the time; community stays on it;
 * - the desk: when Live's middle is wide (66rem and up), your playlist down
 *   the left and the room's Recent, Fresh or Cards beside it, under the
 *   stage (html.rail-desk; css/rail.css lays it out).
 */
firetable.rail = (function () {
  "use strict";

  var root = document.documentElement;
  var wide = window.matchMedia("(min-width: 1024px)");
  var hover = window.matchMedia("(hover: hover)");
  // what makes up the column: the header (the toolbar itself) and the lists under it
  var COLUMN = "#topbar, #usersbox, #pe-here, #dRail, #nav-railBtn";
  // the toolbar's top part, which the list starts under
  var TOP = ["roomlogo", "modeTabs", "themeSlot", "nav-railPeople"];
  // where the focus goes when the people list opens over the middle
  var FIRST_PERSON = "#allUsers .prson .ft-avatar[role=button], #pe-here";
  var $id = function (id) { return document.getElementById(id); };
  var peekFrom = null; // what had the focus before a peek

  function on() { return root.classList.contains("rail"); }
  function peeking() { return root.classList.contains("rail-peek"); }
  /** The toolbar is what's showing: folded, on a wide screen, outside the Turntable theme. */
  function showing() { return on() && wide.matches && !document.body.classList.contains("tt-skin"); }

  // ── Folding and opening ─────────────────────────────────────────────────

  var cssReady = null;
  /** css/rail.css, on the page and loaded (js/head.js may have added it already). */
  function css() {
    if (cssReady) return cssReady;
    cssReady = new Promise(function (resolve, reject) {
      var link = $id("nav-railCss");
      if (link && link.sheet) return resolve();
      if (!link) {
        var meta = document.querySelector('meta[name="rail-css"]');
        link = document.createElement("link");
        link.rel = "stylesheet";
        link.id = "nav-railCss";
        link.href = meta ? meta.content : "css/rail.css";
        document.head.appendChild(link);
      }
      link.addEventListener("load", function () { resolve(); });
      link.addEventListener("error", function () {
        cssReady = null; // try again next time
        link.remove();
        reject(new Error("couldn't load css/rail.css"));
      });
    });
    return cssReady;
  }

  function save(folded) {
    try {
      if (folded) localStorage.setItem(STORAGE.rail, "1");
      else localStorage.removeItem(STORAGE.rail);
    } catch (e) { /* storage blocked: it lasts this visit */ }
  }

  /**
   * Fold the column (true) or open it (false).
   * @param {boolean} folded
   * @param {boolean} [quiet] - don't keep the choice (another tab made it)
   * @returns {Promise<boolean>} folded or not, after
   */
  var going = null; // where a change on its way is going (the cross-fade puts it on a moment later)
  /** Folded, or where it's on its way to. */
  function wanted() { return going === null ? on() : going; }

  function set(folded, quiet) {
    folded = !!folded;
    if (folded === wanted()) { if (going === null) show(); return Promise.resolve(folded); }
    going = folded;
    return (folded ? css() : Promise.resolve()).then(function () {
      if (going !== folded) return wanted(); // changed again while the stylesheet loaded
      if (!quiet) save(folded);
      closePeek();
      swap(function () {
        root.classList.toggle("rail", folded);
        going = null;
        show();
        measure();
      });
      return folded;
    }, function (err) {
      going = null;
      console.error("[firetable] the toolbar:", err);
      if (firetable.ui && firetable.ui.toast) firetable.ui.toast("The toolbar didn't load. Try again in a moment.", "error");
      show();
      return on();
    });
  }

  /**
   * Make a change to the layout, the column fading in to its new shape (CSS,
   * html.rail-fade: not with reduced motion). Not a view transition: the page
   * takes no presses while one plays. After it, the parts that measure
   * themselves on a resize (the stage, the lists) do.
   */
  var fading = 0;
  function swap(change) {
    change();
    clearTimeout(fading);
    root.classList.remove("rail-fade");
    void root.offsetWidth; // start the fade again if it was already playing
    root.classList.add("rail-fade");
    fading = setTimeout(function () { root.classList.remove("rail-fade"); }, 400);
    window.dispatchEvent(new Event("resize"));
  }

  /**
   * The button says what a press does (its icon is CSS's): collapse while the
   * column shows, open or peeking over the middle; open while it's the toolbar.
   */
  function label() {
    var shut = on() && !peeking();
    var btn = $id("nav-railBtn");
    var tip = $id("tip-nav-railBtn");
    if (btn) {
      btn.setAttribute("aria-expanded", String(!shut));
      btn.setAttribute("aria-label", shut ? "Open the column" : "Collapse the column into a toolbar");
    }
    if (tip) tip.textContent = shut ? "Open the column ([)" : "Collapse the column ([)";
  }

  /** Every control shows the state: the button, Settings' switch, the account menu's extras. */
  function show() {
    var folded = on();
    var box = $id("railToggle");
    label();
    if (box) box.checked = folded;
    // a visitor's faces scroll in the toolbar: the keyboard reaches them too (Enter shows the names)
    var here = $id("pe-here");
    if (here) {
      if (showing()) here.setAttribute("tabindex", "0");
      else here.removeAttribute("tabindex");
    }
    accountItems();
    count();
    desk();
  }

  // ── Where the list starts and ends ──────────────────────────────────────

  /** --rail-top and --rail-foot: under the toolbar's top part, over its buttons at the bottom. */
  function measure() {
    if (!showing() || peeking()) return;
    var bar = $id("topbar");
    var utils = $id("topbarUtils");
    if (!bar || !utils) return;
    var box = bar.getBoundingClientRect();
    var top = 0;
    TOP.forEach(function (id) {
      var el = $id(id);
      if (el && el.getClientRects().length) top = Math.max(top, el.getBoundingClientRect().bottom - box.top);
    });
    var foot = box.bottom - utils.getBoundingClientRect().top;
    if (top > 0) root.style.setProperty("--rail-top", Math.ceil(top + 6) + "px");
    if (foot > 0) root.style.setProperty("--rail-foot", Math.ceil(foot) + "px");
  }
  var queued = false;
  /** Measure (and count) once, in the next frame. */
  function soon() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      measure();
      count();
      desk();
    });
  }
  var sizes = window.ResizeObserver ? new ResizeObserver(soon) : null;
  /** Watch the sizes of the toolbar and its parts (Discover adds its tabs once it's built), and the middle's. */
  function watchSizes() {
    if (!sizes) return;
    sizes.disconnect();
    ["topbar", "topbarUtils", "stage"].concat(TOP).forEach(function (id) {
      var el = $id(id);
      if (el) sizes.observe(el);
    });
  }

  // ── Peek: the column whole, over the middle ─────────────────────────────

  /**
   * @param {Element} [from] - where the focus goes back to after
   * @param {string} [focus] - a selector: move the focus into the column, there
   */
  function openPeek(from, focus) {
    if (!showing() || peeking()) return;
    peekFrom = from || document.activeElement;
    root.classList.add("rail-peek");
    hideTip();
    label();
    var btn = $id("nav-railPeople");
    if (btn) btn.setAttribute("aria-expanded", "true");
    var to = focus && document.querySelector(focus);
    if (to) {
      if (!to.matches("button, a, input, [tabindex]")) to.setAttribute("tabindex", "-1");
      to.focus({ preventScroll: true });
    }
  }

  /** @param {boolean} [back] - put the focus back where it was */
  function closePeek(back) {
    if (!peeking()) return;
    root.classList.remove("rail-peek");
    label();
    var btn = $id("nav-railPeople");
    if (btn) btn.setAttribute("aria-expanded", "false");
    var from = peekFrom;
    peekFrom = null;
    if (back && from && from.isConnected && from.getClientRects().length) from.focus({ preventScroll: true });
    soon();
  }

  /** Outside the column: anything that isn't it, a menu, a card or a dialog it opened. */
  function outside(t) {
    return !(t && t.closest && (t.closest(COLUMN) || t.closest("[popover], dialog, #ft-tooltip")));
  }

  function anyPopover() {
    try { return !!document.querySelector(":popover-open"); } catch (e) { return false; }
  }

  function bindPeek() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t.closest) return;
      var btn = t.closest("#nav-railPeople");
      if (btn) {
        if (peeking()) closePeek(true);
        else openPeek(btn, FIRST_PERSON);
        return;
      }
      // a visitor's faces have nothing to press: a press shows the names
      if (showing() && !peeking() && t.closest("#pe-here")) { openPeek($id("nav-railPeople"), FIRST_PERSON); return; }
      // a view chosen in Discover: the toolbar again
      if (peeking() && t.closest("#dNav .d-nav")) closePeek(false);
    });
    document.addEventListener("pointerdown", function (e) {
      if (peeking() && outside(e.target)) closePeek(false);
    }, true);
    document.addEventListener("focusin", function (e) {
      var t = e.target;
      // search (the toolbar's magnifier, the / key, or the header's search from Live)
      if (t.id === "dQ" && showing() && !peeking()) { openPeek(document.querySelector("#dNav .d-nav.on") || $id("dNav")); return; }
      // the room's video takes the focus by itself while it loads: that's not leaving
      if (peeking() && t.tagName !== "IFRAME" && outside(t)) closePeek(false);
    });
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.id === "pe-here" && showing() && !peeking()) {
        e.preventDefault();
        openPeek(e.target);
        return;
      }
      if (e.key !== "Escape" || !peeking() || document.querySelector("dialog[open]") || anyPopover()) return;
      closePeek(true);
    });
  }

  // ── The tooltip ─────────────────────────────────────────────────────────

  var TIPS = "#topbar button, #topbar a, #topbar .tab, #reconnecting, #dSearch, #dNav .d-nav, " +
    "#usersWaitlist .waitlist-item, #usersWaitlist .wlAddMeBtn, #allUsers .prson, #allUsers > .pe-groupHead, " +
    "#pe-here .pe-row";
  var tip = null;
  var tipFor = null;

  var text = function (el, sel) {
    var x = sel ? el.querySelector(sel) : el;
    return x ? x.textContent.replace(/\s+/g, " ").trim() : "";
  };
  var attr = function (el, sel, name) {
    var x = el.querySelector(sel);
    return (x && x.getAttribute(name)) || "";
  };

  /** A face in the people list: the name, then what they're up to (as the row says it). */
  function person(row) {
    return [
      text(row, ".prsnName") + (row.classList.contains("is-me") ? " (you)" : ""),
      attr(row, ".prsnRole", "aria-label"),
      attr(row, ".pe-now", "aria-label"),
      text(row, ".pe-next") ? "Next" : "",
      attr(row, ".pe-plays", "title"),
      text(row, ".pe-gone") || (row.classList.contains("idle") ? "Away" + (text(row, ".pe-away") ? " " + text(row, ".pe-away") : "") : ""),
      row.querySelector(".pe-fire") ? "Fired this song" : ""
    ].filter(Boolean).join(" · ");
  }

  /** What the tooltip says for `el`. */
  function tipText(el) {
    if (el.matches(".prson")) return person(el);
    if (el.matches(".waitlist-addme-row")) return "Hop on the decks";
    if (el.matches(".waitlist-item")) return text(el, ".waitlist-name") + " · " + text(el, ".wl-pos-num, .waitlist-pos") + " in line";
    if (el.matches(".wlAddMeBtn")) return "Hop on the decks";
    if (el.matches(".pe-row")) return [text(el, ".pe-name"), attr(el, ".pe-role", "aria-label"), el.classList.contains("is-dj") ? "DJ" : ""].filter(Boolean).join(" · ");
    if (el.id === "themePill") return el.classList.contains("no-theme") ? "No theme yet" : "Theme: " + text(el, "#themePillText");
    if (el.id === "dSearch") return "Search (/)";
    if (el.id === "reconnecting") return text(el) || "Reconnecting…";
    if (el.id === "nav-railPeople") return el.getAttribute("aria-label");
    if (el.matches(".d-nav")) return text(el, "span");
    return el.getAttribute("data-rail-title") || el.getAttribute("title") || el.getAttribute("aria-label") || text(el);
  }

  /** The element under `t` the tooltip is for, if any (not one with a tooltip of its own). */
  function tippable(t) {
    if (!showing() || peeking() || !t || !t.closest) return null;
    var el = t.closest(TIPS);
    if (!el || el.hasAttribute("aria-describedby") || el.id === "nav-signin" && !el.offsetParent) return null;
    return el;
  }

  function showTip(el) {
    var says = tipText(el);
    if (!says) { hideTip(); return; }
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "nav-railTip";
      tip.setAttribute("aria-hidden", "true"); // each says it to screen readers already
      document.body.appendChild(tip);
    }
    hideTip();
    // its own title would pop up too: held while the tooltip shows
    if (el.hasAttribute("title")) { el.setAttribute("data-rail-title", el.getAttribute("title")); el.removeAttribute("title"); }
    tip.textContent = says;
    var r = el.getBoundingClientRect();
    tip.style.left = Math.round(r.right + 10) + "px";
    var h = tip.offsetHeight;
    tip.style.top = Math.round(Math.min(Math.max(4, r.top + r.height / 2 - h / 2), window.innerHeight - h - 4)) + "px";
    tip.classList.add("is-on");
    tipFor = el;
  }

  function hideTip() {
    if (tip) tip.classList.remove("is-on");
    if (tipFor && tipFor.hasAttribute("data-rail-title")) {
      tipFor.setAttribute("title", tipFor.getAttribute("data-rail-title"));
      tipFor.removeAttribute("data-rail-title");
    }
    tipFor = null;
  }

  function bindTips() {
    document.addEventListener("pointerover", function (e) {
      if (!hover.matches || e.pointerType === "touch") return;
      var el = tippable(e.target);
      if (el === tipFor) return;
      if (el) showTip(el);
      else if (tipFor) hideTip();
    });
    document.addEventListener("pointerout", function (e) { if (tipFor && !e.relatedTarget) hideTip(); });
    document.addEventListener("focusin", function (e) {
      var el = tippable(e.target);
      var keys = false;
      try { keys = e.target.matches(":focus-visible"); } catch (x) { /* older browsers: no keyboard tips */ }
      if (el && keys) showTip(el);
      else if (tipFor) hideTip();
    });
    document.addEventListener("pointerdown", hideTip, true);
    document.addEventListener("scroll", function () { if (tipFor) hideTip(); }, true);
  }

  // ── Who's here: the count on the people button ──────────────────────────

  function count() {
    var btn = $id("nav-railPeople");
    if (!btn) return;
    var all = $id("numListeners");
    var n = all ? all.textContent.trim() : "";
    if (!n) n = text(document, "#pe-here .pe-count");
    if (!n) {
      var faces = document.querySelectorAll("#allUsers .prson[data-userid]").length;
      n = faces ? String(faces) : "";
    }
    var shown = btn.querySelector(".nav-railCount");
    if (shown && shown.textContent !== n) shown.textContent = n;
    // who that is, as the people list's header names each count (js/audience.js)
    var who = [];
    document.querySelectorAll("#usersStats .listenerType:not([hidden])").forEach(function (row) {
      var says = row.getAttribute("aria-label");
      if (says) who.push(says);
    });
    var label = (n ? n + " here" : "Who's here") + (who.length ? " (" + who.join(", ") + ")" : "") + ": show everyone";
    if (btn.getAttribute("aria-label") !== label) btn.setAttribute("aria-label", label);
  }

  function watchCount() {
    var counts = new MutationObserver(soon);
    ["usersStats", "pe-here", "allUsers"].forEach(function (id) {
      var el = $id(id);
      if (el) counts.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-label"] });
    });
  }

  // ── The account menu, folded: Open the column ──────────────────────────

  /**
   * Folded, the account menu also has Open the column (beside its Light mode,
   * Shortcuts and About, there at every width). Hidden while the column
   * shows, and in the Turntable theme.
   */
  function accountItems() {
    var about = $id("nav-acctAbout") || $id("nav-acctHelp");
    if (!about) return;
    if (!$id("nav-acctRail")) {
      about.insertAdjacentHTML("afterend", '<button type="button" role="menuitem" class="butt graybutt nav-acctItem" id="nav-acctRail" hidden>' +
        '<i class="material-symbols-outlined" aria-hidden="true">left_panel_open</i>Open the column</button>');
      $id("nav-acctRail").addEventListener("click", function () {
        $id("nav-accountMenu").hidePopover();
        set(false);
      });
    }
    $id("nav-acctRail").hidden = !showing();
  }

  // ── The desk: Live's middle, when it's wide ─────────────────────────────

  var DESK = 66 * 16; // the middle's width, in pixels, from which it's a desk
  var MAIN = null; // Live's own list of the panels a view change fades

  /** Live, a member's, on a wide screen with the column folded, and its middle wide enough. */
  function deskFits() {
    var grid = $id("mainGrid");
    var stage = $id("stage");
    if (!showing() || !grid || !stage || document.body.classList.contains("ft-discover") ||
      grid.classList.contains("login") || grid.classList.contains("pre-auth")) return false;
    return stage.getBoundingClientRect().width >= DESK;
  }

  function desk() {
    var fits = deskFits();
    var n = firetable.nav;
    if (fits !== root.classList.contains("rail-desk")) {
      root.classList.toggle("rail-desk", fits);
      if (n) {
        // the playlist stays put while the other side's tabs change: it doesn't fade with them
        if (!MAIN) MAIN = n._mainPanels;
        n._mainPanels = fits ? MAIN.filter(function (p) { return p !== "#queuebox"; }) : MAIN;
        if (!fits) n.apply(); // the tabs as they were
      }
      window.dispatchEvent(new Event("resize"));
    }
    if (fits) deskTabs();
  }

  /** On the desk the playlist is always there: with Playlists picked, Recent is beside it, its tab lit. */
  function deskTabs() {
    var n = firetable.nav;
    var recent = $id("mm-history");
    if (!n || !recent || n.view !== "playlists") return;
    if (!recent.classList.contains("on")) {
      recent.classList.add("on");
      recent.setAttribute("aria-selected", "true");
    }
    try { ftapi.watchFeed("history"); } catch (e) { /* signed out: no feeds */ }
  }

  // ── Start ───────────────────────────────────────────────────────────────

  // what in the body's classes changes the toolbar (others change all the time: the beat)
  var shape = function () {
    var b = document.body.classList;
    return [showing(), b.contains("ft-discover"), b.contains("disconnected")].join();
  };
  var was = shape();
  function settle() {
    var now = shape();
    if (now === was) return;
    was = now;
    if (!showing()) closePeek();
    hideTip();
    show();
    soon();
  }

  bindPeek();
  bindTips();
  watchSizes();
  watchCount();
  var bar = $id("topbar");
  if (bar) new MutationObserver(function () { watchSizes(); soon(); }).observe(bar, { childList: true });
  // the desk: the middle's width, and Live's view and tabs (firetable.nav.apply)
  var grid = $id("mainGrid");
  if (grid) new MutationObserver(function () { if (root.classList.contains("rail-desk")) deskTabs(); soon(); }).observe(grid, { attributes: true, attributeFilter: ["class"] });
  // Discover or Live, the Turntable theme, signing in: what the toolbar holds changes
  new MutationObserver(settle).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (wide.addEventListener) wide.addEventListener("change", settle);
  // another tab folded or opened it
  window.addEventListener("storage", function (e) {
    if (e.key !== STORAGE.rail && e.key !== null) return;
    var folded = false;
    try { folded = localStorage.getItem(STORAGE.rail) === "1"; } catch (x) { /* storage blocked */ }
    set(folded, true);
  });
  show();
  soon();

  return {
    isOn: on,
    set: set,
    /** Fold it, or open it, whichever it isn't. */
    toggle: function () {
      // over the middle for a moment: put it away, the toolbar again
      if (peeking()) { closePeek(false); return Promise.resolve(true); }
      return set(!wanted());
    },
    /** The column whole over the middle, for a moment (the people, or search). */
    peek: openPeek,
    unpeek: closePeek
  };
})();
