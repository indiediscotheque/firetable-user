/**
 * discover-tabs.js — the bottom tab bar, on phones (4.1; Round 5, the owner,
 * November 25, 2026).
 *
 * Discover · Live · Library · You. Discover is Discover's pages: its Home
 * starts with a tile for each of them (tiles(), Fresh among them since it
 * moved from Live, November 27, 2026), a page opens under the same tab, and
 * the tab again goes back to Home (a sheet open over the page closes first). The deploy's prebuilt home page
 * starts with the same tiles (tools/plain-pages.mjs --home). Live
 * is the stage with Chat, Recent, Cards and People. Library is a member's
 * playlists, with the screen to themselves, and a visitor's crate. You is the
 * account menu, or join and log in. Which tab is lit comes from where you
 * are (lit), so it never disagrees with the page. Under 640px the bar stands
 * in for #modeTabs, Discover's row of pages and Live's Playlists tab, which
 * stay in the page for wider screens.
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
  var deps = null;
  var lastLiveTab = "mmchat";

  /**
   * The tab that's lit, from where you are: s is {mode ("discover" or
   * "live"), member, crate (Discover's sheet is open), view and section
   * (Live's: firetable.nav's view and mobileSection), welcome (Live is a
   * visitor's: the stage over the welcome)}.
   */
  function lit(s) {
    if (s.mode === "discover") return !s.member && s.crate ? "library" : "discover";
    if (!s.welcome && s.section === "view" && s.view === "playlists") return "library";
    return "live";
  }

  /** Where you are now, for lit(). */
  function now() {
    var D = deps.state(), n = firetable.nav || {}, body = document.body.classList, grid = document.getElementById("mainGrid");
    return { mode: D.mode, member: !!D.signedIn, crate: body.contains("d-sheet-open"), view: n.view, section: n.mobileSection,
      welcome: !!grid && grid.classList.contains("login") };
  }

  /** The bar itself: discover.js puts it under the player bar. */
  function html() {
    return '<nav id="nav-tabs" aria-label="Sections">' + TABS.map(function (t) {
      return '<button type="button" class="nt-tab" data-tab="' + t.id + '"' + (t.id === "you" ? ' aria-haspopup="menu"' : "") + ">" +
        deps.ms(t.icon) + "<span>" + deps.esc(t.label) + "</span>" + (t.id === "live" ? '<i class="d-dot nt-dot" aria-hidden="true"></i>' : "") + "</button>";
    }).join("") + "</nav>";
  }

  /** Discover's pages as tiles, for the top of its Home (shown on phones only). */
  function tiles() {
    var pages = deps.views().filter(function (v) { return v.id !== "home"; });
    return '<nav class="d-tiles" aria-label="Discover\'s pages">' + pages.map(function (v) {
      return '<a class="d-tile" data-view="' + v.id + '" href="' + deps.hrefTo("discover/" + v.id) + '">' + deps.ms(v.icon) + "<span>" + deps.esc(v.label) + "</span></a>";
    }).join("") + "</nav>";
  }

  function render() {
    var D = deps.state(), n = firetable.nav, tab = lit(now());
    // in Live: Library has the screen to itself
    document.body.classList.toggle("nt-library", D.mode === "live" && tab === "library");
    document.querySelectorAll("#nav-tabs .nt-tab").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    // Live's own tab to go back to: never Playlists (Library). A visitor's welcome is
    // Playlists' view, and Live after they join or log in is Chat, not Library
    if (n && D.mode === "live" && tab === "live") {
      lastLiveTab = n.mobileSection === "chat" ? "mmchat" : n.mobileSection === "people" ? "mmusrs" :
        (n.view !== "playlists" && n._viewTabMap[n.view]) || "mmchat";
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
      if (tab === "live" && at !== "live") firetable.nav.setMobileTab(lastLiveTab);
      else if (tab === "library" && at !== "library") firetable.nav.setView("playlists");
    }
    render();
  }

  /**
   * A link into one of Live's panels (Discover's Recent plays, "See every
   * play in Live", for members): it goes to Live, so the phone's Back comes
   * back here, with that panel showing (data-live: its view). Set first,
   * straight away, so Live never shows anything else on the way.
   */
  function toPanel(e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[data-live]"), n = firetable.nav, view = a && a.getAttribute("data-live");
    if (!a || n._validViews.indexOf(view) === -1) return;
    n.view = view;
    n.mobileSection = "view";
    n.save();
    n.apply();
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
