/**
 * discover-tabs.js — the bottom tab bar, on phones (4.1; Round 5, the owner,
 * November 25, 2026).
 *
 * Discover · Live · Library · You. Discover is Discover's pages: its Home
 * starts with a tile for each of them (tiles(), and Fresh, which is Live's),
 * a page opens under the same tab, and the tab again goes back to Home (a
 * sheet open over the page closes first). The deploy's prebuilt home page
 * starts with the same tiles (tools/plain-pages.mjs --home). Live
 * is the stage with Chat, Recent, Cards and People. Library is a member's
 * playlists, with the screen to themselves, and a visitor's crate. You is the
 * account menu, or join and log in. Which tab is lit comes from where you
 * are (lit), so it never disagrees with the page. Under 640px the bar stands
 * in for #modeTabs, Discover's row of pages and Live's Playlists and Fresh
 * tabs, which stay in the page for wider screens.
 *
 * discover.js makes the one there is with firetable.discoverTabs(deps): deps
 * are its state and helpers, handed over as functions.
 */
firetable.discoverTabs = (function () {
  "use strict";
  var TABS = [
    { id: "discover", label: "Discover", icon: "explore" },
    { id: "live", label: "Live", icon: "sensors" },
    { id: "library", label: "Library", icon: "library_music" },
    { id: "you", label: "You", icon: "account_circle" }
  ];
  // Fresh reads the bot's newMusic feed (the first plays here of new uploads),
  // not Discover's New: it stays Live's panel (its view is "discover"), and on
  // phones its tile is here
  var FRESH = { id: "fresh", label: "Fresh", icon: "fiber_new", live: "discover" };
  var deps = null;
  var lastLiveTab = "mmchat";
  // Live as it was before Fresh's tile opened Fresh: put back when you leave
  // Fresh (Back or the Discover tab, the Live tab, or another way to one of
  // Live's tabs), as on a phone Fresh isn't one of them; nor is it kept for
  // the next visit
  var beforeFresh = null;
  var shown = null; // the mode the bar was last drawn for

  /**
   * The tab that's lit, from where you are: s is {mode ("discover" or
   * "live"), member, crate (Discover's sheet is open), view and section
   * (Live's: firetable.nav's view and mobileSection), welcome (Live is a
   * visitor's: the stage over the welcome, or over Fresh while it's the
   * view), theme (the Turntable theme is on)}.
   */
  function lit(s) {
    if (s.mode === "discover") return !s.member && s.crate ? "library" : "discover";
    if (!s.welcome && s.section === "view" && s.view === "playlists") return "library";
    // Fresh, from its tile: under Discover (the theme keeps it a page of its Room)
    if (!s.theme && s.view === "discover" && (s.section === "view" || s.welcome)) return "discover";
    return "live";
  }

  /** Where you are now, for lit(). */
  function now() {
    var D = deps.state(), n = firetable.nav || {}, body = document.body.classList, grid = document.getElementById("mainGrid");
    return { mode: D.mode, member: !!D.signedIn, crate: body.contains("d-sheet-open"), view: n.view, section: n.mobileSection,
      welcome: !!grid && grid.classList.contains("login"), theme: body.contains("tt-skin") };
  }

  function phone() { return window.matchMedia("(max-width: 639px)").matches; }

  /** The bar itself: discover.js puts it under the player bar. */
  function html() {
    return '<nav id="nav-tabs" aria-label="Sections">' + TABS.map(function (t) {
      return '<button type="button" class="nt-tab" data-tab="' + t.id + '"' + (t.id === "you" ? ' aria-haspopup="menu"' : "") + ">" +
        deps.ms(t.icon) + "<span>" + deps.esc(t.label) + "</span>" + (t.id === "live" ? '<i class="d-dot nt-dot" aria-hidden="true"></i>' : "") + "</button>";
    }).join("") + "</nav>";
  }

  /** Discover's pages as tiles, for the top of its Home (shown on phones only), and Fresh. */
  function tiles() {
    var pages = deps.views().filter(function (v) { return v.id !== "home"; }).concat([FRESH]);
    return '<nav class="d-tiles" aria-label="Discover\'s pages">' + pages.map(function (v) {
      return '<a class="d-tile" data-view="' + v.id + '" href="' + deps.hrefTo(v.live ? "live" : "discover/" + v.id) + '"' + (v.live ? ' data-live="' + v.live + '"' : "") + ">" +
        deps.ms(v.icon) + "<span>" + deps.esc(v.label) + "</span></a>";
    }).join("") + "</nav>";
  }

  /**
   * A Fresh to put away (putBack): Fresh from its tile, once you're back in
   * Discover; and on a phone, where Fresh isn't one of Live's tabs, any other
   * (left from a wider screen, the welcome's "learn more" for visitors, the
   * Turntable theme's Room, which opens its own again) on the way into
   * Discover, and a member's in Live, as only the tile opens it there (but
   * in the theme's Room).
   */
  function stray(s, moved) {
    if (beforeFresh) return moved && s.mode === "discover";
    if (s.view !== "discover" || !phone()) return false;
    return s.mode === "discover" ? moved : s.mode === "live" && !s.theme && !s.welcome && s.section === "view";
  }

  /** Live as it was before Fresh's tile, or else on its own first tab (Chat), kept for next time. */
  function putBack() {
    var n = firetable.nav, was = beforeFresh || { view: "playlists", section: n.mobileSection === "view" ? "chat" : n.mobileSection };
    beforeFresh = null;
    n.view = was.view;
    n.mobileSection = was.section;
    n.save();
  }

  function render() {
    var D = deps.state(), n = firetable.nav, s = now(), moved = D.mode !== shown;
    shown = D.mode;
    if (n && stray(s, moved)) {
      putBack();
      return n.apply(); // which draws the bar again
    }
    var tab = lit(s);
    if (beforeFresh && D.mode === "live" && tab !== "discover") { // on to Live's own tabs
      var was = beforeFresh.view;
      beforeFresh = null;
      // by another way than the Live tab (a mention's jump to Chat, say): Live's view
      // goes back as it was too (the theme's Room keeps Fresh as a page of its own)
      if (n.view === "discover" && !s.theme) {
        n.view = was;
        n.save();
        return n.apply();
      }
    }
    // in Live: Library and Fresh have the screen to themselves
    document.body.classList.toggle("nt-library", D.mode === "live" && tab === "library");
    document.body.classList.toggle("nt-fresh", D.mode === "live" && tab === "discover");
    document.querySelectorAll("#nav-tabs .nt-tab").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    // Live's own tab to go back to: never Fresh (a tile here) nor Playlists (Library). A visitor's
    // welcome is Playlists' view, and Live after they join or log in is Chat, not Library
    if (n && D.mode === "live" && tab === "live") {
      lastLiveTab = n.mobileSection === "chat" ? "mmchat" : n.mobileSection === "people" ? "mmusrs" :
        (n.view !== "discover" && n.view !== "playlists" && n._viewTabMap[n.view]) || "mmchat";
    }
  }

  /**
   * Discover: back to the page you left; pressed again, its Home (from the
   * top). An open sheet over the page (a visitor's crate, a member's
   * playlists or chat) only closes, so the page under it stays.
   */
  function toDiscover(here) {
    var body = document.body.classList, sheet = body.contains("d-sheet-open");
    body.remove("d-sheet-open");
    if (deps.state().mode !== "discover") deps.setMode("discover", { remember: true });
    else if (here === "discover" && !sheet) deps.setView("home");
  }

  /** Live: the tab you last had there. From Fresh, Fresh is put away first: Live is as it was before it. */
  function backToLive(at) {
    if (at === "discover") putBack();
    firetable.nav.setMobileTab(lastLiveTab);
  }

  /** A tab pressed. */
  function go(tab) {
    var D = deps.state(), here = lit(now());
    deps.closeMenu();
    if (tab === "you") {
      var who = document.getElementById(D.signedIn ? "loggedInUser" : "nav-signin");
      if (who) who.click();
      return;
    }
    if (tab === "discover") toDiscover(here);
    else if (tab === "library" && !D.signedIn) deps.openCrate();
    else {
      if (D.mode !== "live") deps.setMode("live", { remember: true });
      var at = lit(now());
      if (tab === "live" && at !== "live") backToLive(at);
      else if (tab === "library" && at !== "library") firetable.nav.setView("playlists");
    }
    render();
  }

  /**
   * A link into one of Live's panels (Fresh's tile; Discover's Recent plays,
   * "See every play in Live", for members): it goes to Live, so the phone's
   * Back comes back here, with that panel showing (data-live: its view). Set
   * first, straight away, so Live never shows anything else on the way.
   */
  function toPanel(e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[data-live]"), n = firetable.nav, view = a && a.getAttribute("data-live");
    if (!a || n._validViews.indexOf(view) === -1) return;
    var was = { view: n.view, section: n.mobileSection };
    n.view = view;
    n.mobileSection = "view";
    if (view !== "discover") n.save(); // Recent is one of Live's tabs, kept as one
    n.apply();
    if (view === "discover" && !beforeFresh) beforeFresh = was;
  }

  function create(d) {
    deps = d;
    document.addEventListener("click", toPanel);
    return { html: html, tiles: tiles, render: render, go: go, lit: function () { return lit(now()); } };
  }
  /** For tests: which tab is lit, for a given state (see lit). */
  create.lit = lit;
  return create;
})();
