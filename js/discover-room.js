/**
 * discover-room.js — the room, in a visitor's empty crate column; and the
 * "Keep your crate" dialog.
 *
 * A visitor (signed out) whose crate is empty had the crate's note, Join and
 * an empty column beside the page. Since Round 5 (the owner, November 25,
 * 2026) the room shows there, over the note (#pv-onair, the id of the On Air
 * card that redesign step 2.1 put in this column, folded into the player bar
 * by 2.3b): "In the room now · N here" (the bar's count), who's on the decks
 * (the DJ playing, then who's next, as the people list says it; a DJ who hid
 * their name from visitors is counted, "and N more", never named), the song's
 * fires, the guests and the radio's listeners, and what members do. Art and
 * text only: the song and Listen live are the bar's, Just played is Home's
 * Recent plays, and the chat is for members (the owner, November 13, 2026).
 * The people are circle avatars with their names: a name plate is for the
 * DJs on the stage. One save and the crate takes its place; taking the last
 * song out brings it back. Members never get it.
 *
 * While it can show it follows the room (the people, the decks, the song, the
 * guests and radio, and the song's fires: songFires, which anyone can read)
 * and draws only the card again, at most once a frame, so the column keeps
 * its scroll. Signing in lets songFires go.
 *
 * discover.js makes the one there is with firetable.discoverRoom(deps) the
 * first time either is wanted (js/lazy.js); deps are its helpers, handed over
 * as functions: esc, ms, db, djShown, robotLink, nameLink, peopleHere,
 * deckList, liveTrack, crate, artOf, joinButtons. It returns {html, keepCrate}.
 */
firetable.discoverRoom = (function () {
  "use strict";
  var EVENTS = ["usersChanged", "tableChanged", "spotlightStateChanged", "newSong", "audienceChanged"];
  var deps = null, esc, ms; // discover.js's helpers (there's one card a page)
  var fires = null;    // songFires as the hostbot writes it: {started, count}
  var firesRef = null; // followed while the card can show
  var following = false;
  var drawn = "";      // the card as last drawn

  function plural(n, one, many) { return firetable.utilities.pluralize(n, one, many); }

  /** The song's fires: songFires' count while it's for the song playing now (the rule the stage for other sites keeps), else 0. */
  function fireCount() {
    var s = deps.liveTrack();
    if (!fires || !s || Number(fires.started) !== Number(s.started)) return 0;
    return Math.max(0, Math.floor(Number(fires.count) || 0));
  }

  /** One DJ's row: their face and name, each opening their DJ page, and Playing now or Next (js/people.js's words). */
  function djRow(dj, playing, next) {
    return '<li class="pe-row">' + deps.robotLink(dj) + '<span class="pe-name">' + deps.nameLink(dj) + "</span>" +
      (playing ? '<span class="material-symbols-outlined pe-now" role="img" title="Playing now" aria-label="Playing now">graphic_eq</span>'
        : next ? '<span class="pe-next">Next</span>' : "") + "</li>";
  }

  /** Who's on the decks, the DJ playing first; the stage's words when nobody is. */
  function decks() {
    var list = deps.deckList();
    if (!list.length) return '<p class="d-fact">The decks are open.</p>';
    var song = deps.liveTrack();
    var on = !!(song && song.djid && song.djid === list[0].id); // deckList puts the DJ playing first
    var rows = "", hidden = 0;
    list.forEach(function (d, i) {
      var dj = deps.djShown(d.id, d.name);
      if (dj) rows += djRow(dj, on && i === 0, on && i === 1);
      else hidden++;
    });
    return '<h3 class="d-label">On the decks</h3>' + (rows ? '<ul class="pe-list">' + rows + "</ul>" : "") +
      (hidden ? '<p class="d-fact">' + esc(rows ? "and " + hidden + " more" : plural(hidden, "DJ", "DJs")) + "</p>" : "");
  }

  /** "Plus 2 guests and 4 on the radio.", a count that's none left out (the people list's words, js/audience.js). */
  function elsewhere() {
    var a = firetable.audience && firetable.audience.data();
    var parts = [];
    if (a && a.guests) parts.push(plural(a.guests, "guest", "guests"));
    if (a && a.stream && a.stream.listeners) parts.push(a.stream.listeners + " on the radio");
    return parts.length ? '<p class="d-fact">Plus ' + esc(parts.join(" and ")) + ".</p>" : "";
  }

  /** The card. */
  function card() {
    var here = deps.peopleHere(), lit = fireCount();
    return '<section id="pv-onair" class="d-onair" aria-labelledby="pv-onairHead">' +
      '<h2 class="d-label" id="pv-onairHead"><i class="d-dot" aria-hidden="true"></i>In the room now' + (here ? " · " + esc(here) + " here" : "") + "</h2>" +
      decks() +
      (lit ? '<p class="d-fact"><span class="d-fires">' + ms("local_fire_department") + "</span> " + esc(plural(lit, "fire", "fires") + " on this song") + "</p>" : "") +
      elsewhere() +
      '<p class="d-fact">Members chat with the room and take a turn on the decks.</p></section>';
  }

  /**
   * The card drawn again where it is, when it changed: nothing else in the
   * column moves, and a link that had the keyboard's focus keeps it.
   */
  var redraw = firetable.utilities.oncePerFrame(function () {
    var el = document.getElementById("pv-onair");
    if (!el) return;
    var html = card();
    if (html === drawn) return;
    drawn = html;
    var at = Array.prototype.indexOf.call(el.querySelectorAll("a"), document.activeElement);
    el.outerHTML = html;
    var again = document.querySelectorAll("#pv-onair a")[at];
    if (at !== -1 && again) again.focus();
  });

  function onFires(snap) {
    fires = snap.val();
    redraw();
  }
  /** Signed in: the card is gone for good, and songFires with it (it comes back if they sign out). */
  function letGo() {
    if (firesRef) firesRef.off("value", onFires);
    firesRef = null;
    fires = null;
  }
  /** Follow the room while the card can show: its events once, and songFires till they sign in. */
  function follow() {
    if (!firesRef) {
      firesRef = deps.db().ref("songFires");
      firesRef.on("value", onFires, function () { /* not readable here: no fires line */ });
    }
    if (following) return;
    following = true;
    EVENTS.forEach(function (ev) { ftapi.events.on(ev, redraw); });
    ftapi.events.on("loggedIn", letGo);
  }

  /** The card's HTML for a visitor's empty crate column (discover.js cratePanel). */
  function html() {
    follow();
    drawn = card();
    return drawn;
  }

  /** "Keep your crate": what the third save offers (Join, or Not now, which keeps the crate in this browser). */
  function keepCrate() {
    var c = deps.crate();
    var here = deps.peopleHere();
    var dlg = document.getElementById("keepCrateBox");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "keepCrateBox";
      dlg.setAttribute("aria-labelledby", "keepCrateTitle");
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) {
        if (e.target.closest(".closeModal, .d-notnow")) dlg.close();
      });
    }
    dlg.innerHTML = '<div class="modalBox"><div class="modalHeader"><h2 id="keepCrateTitle">Keep your crate</h2>' +
      '<button type="button" class="butt graybutt iconbutt closeModal" title="Close" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="modalContent d-keep"><p>' + esc(plural(c.length, "song", "songs")) + " saved. Join and your crate becomes a playlist you can play for the room" +
      (here ? ", with " + esc(plural(here, "person", "people")) + " here right now" : "") + ".</p>" +
      '<div class="d-keep-list">' + c.slice(-3).map(function (t) {
        return '<div class="d-mini-row"><span class="d-mini-art" style="background-image:url(' + esc(deps.artOf(t)) + ')"></span><span class="d-mini-text"><b>' + esc(t.t) + "</b><span>" + esc(t.a) + "</span></span></div>";
      }).join("") + "</div>" +
      "<p>Joining also opens the chat, the people in the room and the decks.</p>" + deps.joinButtons() +
      '<button type="button" class="butt graybutt d-notnow">Not now</button><p class="d-fact">Not now keeps the crate in this browser.</p></div></div>';
    if (!dlg.open) dlg.showModal();
  }

  /** The card and the dialog, made with discover.js's helpers. */
  return function (helpers) {
    letGo(); // helpers handed over again (a test's): songFires is followed through the new ones
    deps = helpers;
    esc = helpers.esc;
    ms = helpers.ms;
    return { html: html, keepCrate: keepCrate };
  };
})();
