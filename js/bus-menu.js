/**
 * bus-menu.js — "Catch the bus": when to step down from the decks.
 *
 * Every bus button opens it: your own on the deck's name plate and in the
 * waitlist, the bus button on a person's card (yours, or a mod's for someone
 * of lower rank), and the Turntable theme's DJ menu. It offers:
 *   - after this song (or your next one): !removeafter, the bus as it always was
 *   - after a number of songs, the one playing now included: !removeafter 3
 *   - in a while: !removeafter 30m (finishing the song playing then)
 *   - your own number of songs or minutes
 *   - stay on, when there's a bus to cancel: !dontremoveme
 * It also says where your set ends, when you've marked a song in your DJ
 * playlist for that (js/set-end.js).
 * A mod's choice for someone else ends with their name (!removeafter 3 Bea).
 * The bot owns table/ and waitlist/, so all of it is a bot command
 * (firetable-hostbot lib/bus.js); the seat it saves (removeAfter, busSongs,
 * busAt) is what firetable.people.bus puts into words.
 *
 * Loaded on first use: js/lazy.js has the stand-in, which loads this and
 * passes the call on.
 */
firetable.busMenu = (function () {
  "use strict";
  var MAX_SONGS = 50;        // the bot's limits (lib/bus.js)
  var MAX_MINUTES = 12 * 60;
  var SONGS = [2, 3, 5];
  var TIMES = [[15, "15 min"], [30, "30 min"], [60, "1 hr"], [120, "2 hrs"]];
  var el = null, box = null, arrow = null;
  var who = null; // {uid, name (someone else's), self}

  function esc(s) { return firetable.utilities.htmlEscape(String(s)); }

  /**
   * The bot command for a choice.
   * @param {{songs?: number, minutes?: number, stay?: boolean}} choice
   * @param {string} [name] - someone else's (mods)
   * @returns {string}
   */
  function command(choice, name) {
    var cmd = choice.stay ? "!dontremoveme"
      : choice.minutes ? "!removeafter " + choice.minutes + "m"
      : choice.songs > 1 ? "!removeafter " + choice.songs
      : "!removeafter";
    return cmd + (name ? " " + name : "");
  }

  /** Where someone is: their seat on the decks or in line, and whether they're playing now. */
  function seatOf(uid) {
    var lists = [firetable.tableData, firetable.waitlistData];
    for (var l = 0; l < lists.length; l++) {
      var list = lists[l] || {};
      for (var k in list) {
        if (Object.prototype.hasOwnProperty.call(list, k) && list[k] && list[k].id === uid) {
          return { seat: list[k], playing: l === 0 && !!firetable.song && firetable.song.djid === uid };
        }
      }
    }
    return { seat: null, playing: false };
  }

  /** The menu's element (made once). */
  function build() {
    el = document.createElement("div");
    el.id = "busMenu";
    el.className = "ft-popover";
    el.setAttribute("popover", "auto");
    el.insertAdjacentHTML("beforeend", '<div id="busMenuArrow" class="ft-arrow"></div>' +
      '<div class="ft-popover-box ft-menu bus-menu" role="menu" aria-labelledby="busMenuTitle"></div>');
    box = el.querySelector(".bus-menu");
    arrow = el.querySelector(".ft-arrow");
    box.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-bus]");
      if (!b || !box.contains(b)) return;
      var v = b.getAttribute("data-bus").split(":");
      choose(v[0] === "stay" ? { stay: true } : v[0] === "m" ? { minutes: +v[1] } : { songs: +v[1] });
    });
    box.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = Math.round(Number(box.querySelector(".bus-own-n").value));
      var minutes = box.querySelector(".bus-own-unit").value === "minutes";
      // checked here, not by the browser: the limit depends on the unit
      if (!(n >= 1 && n <= (minutes ? MAX_MINUTES : MAX_SONGS))) {
        box.querySelector(".bus-own-n").setAttribute("aria-invalid", "true");
        return;
      }
      choose(minutes ? { minutes: n } : { songs: n });
    });
    box.addEventListener("change", function (e) {
      if (!e.target.classList.contains("bus-own-unit")) return;
      box.querySelector(".bus-own-n").max = e.target.value === "minutes" ? MAX_MINUTES : MAX_SONGS;
    });
    document.body.appendChild(el);
  }

  /** Send it and close (the bot answers in chat, or privately for someone else). */
  function choose(choice) {
    var name = who && !who.self ? who.name : "";
    ftapi.actions.sendBotCommand(command(choice, name));
    el.hidePopover();
  }

  /** The chips: "after" songs, "in" times. */
  function chips(label, items) {
    return '<div class="bus-row"><span class="bus-row-label">' + label + '</span>' + items.map(function (it) {
      return '<button type="button" role="menuitem" class="butt graybutt bus-chip" data-bus="' + it[0] + '">' + esc(it[1]) + '</button>';
    }).join("") + "</div>";
  }

  /** Where your set ends, if you marked a track in your DJ playlist and it's the list on screen (js/set-end.js). */
  function setEnd() {
    var q = document.getElementById("mainqueue");
    return !!firetable.setEnd && !!q && q.classList.contains("is-djlist") && firetable.setEnd.find(firetable.queue);
  }

  /** The menu's contents, for this person as they are now. */
  function render() {
    var at = seatOf(who.uid);
    var now = firetable.people.bus(at.seat, at.playing);
    var title = who.self ? "Catch the bus" : "Send " + who.name + " home";
    var first = at.playing ? "After this song" : who.self ? "After my next song" : "After their next song";
    var html = '<div class="ft-menu-title" id="busMenuTitle">' + esc(title) + "</div>";
    if (now) html += '<p class="bus-now">' + esc((who.self ? "You're stepping down " : who.name + " steps down ") + now + ".") + "</p>";
    var end = who.self && setEnd();
    if (end) html += '<p class="bus-now">' + esc("Your set ends with " + end.name + (end.songs > 1 ? ", " + end.songs + " songs from now." : ", your next song.")) + "</p>";
    html += '<button type="button" role="menuitem" class="butt graybutt" data-bus="s:1"><i class="material-symbols-outlined" aria-hidden="true">departure_board</i> ' + first + "</button>";
    html += chips("After", SONGS.map(function (n) { return ["s:" + n, n + " songs"]; }));
    html += chips("In", TIMES.map(function (t) { return ["m:" + t[0], t[1]]; }));
    html += '<form class="bus-own" novalidate><label class="bus-row-label" for="busOwnN">Or</label>' +
      '<input id="busOwnN" class="bus-own-n" type="number" inputmode="numeric" min="1" max="' + MAX_SONGS + '" placeholder="4" aria-label="How many" />' +
      '<select class="bus-own-unit" aria-label="Songs or minutes"><option value="songs">songs</option><option value="minutes">minutes</option></select>' +
      '<button type="submit" class="butt bus-own-go">Go</button></form>';
    if (at.playing) html += '<p class="bus-hint">Songs count the one playing now.</p>';
    if (now) {
      html += '<hr class="ft-menu-sep" /><button type="button" role="menuitem" class="butt graybutt" data-bus="stay">' +
        '<i class="material-symbols-outlined" aria-hidden="true">close</i> ' + (who.self ? "Stay on (cancel the bus)" : "Let them stay") + "</button>";
    }
    box.innerHTML = html;
  }

  /**
   * Open the menu by a bus button.
   * @param {Element} anchor - what it opens next to
   * @param {string} uid - whose bus: yours, or (mods) someone of lower rank
   * @param {string} [name] - their name, when it isn't you
   */
  function open(anchor, uid, name) {
    if (!el) build();
    who = { uid: uid || ftapi.uid, self: !uid || uid === ftapi.uid, name: name || "" };
    if (!who.self && !who.name) {
      var u = ftapi.users && ftapi.users[who.uid];
      who.name = (u && u.username) || "";
      if (!who.name) return;
    }
    if (el.matches(":popover-open")) el.hidePopover();
    render();
    el.style.visibility = "hidden";
    el.showPopover();
    firetable.ui.positionPopover(anchor, el, arrow).then(function () {
      var first = box.querySelector("button[data-bus]");
      if (first) first.focus({ preventScroll: true });
    });
  }

  // What the menu shows follows the decks while it's open (a song ends, a bus is set)
  ["tableChanged", "waitlistChanged", "newSong"].forEach(function (ev) {
    ftapi.events.on(ev, function () {
      var typing = document.activeElement && document.activeElement.closest && document.activeElement.closest(".bus-own");
      if (el && who && el.matches(":popover-open") && !typing) render(); // not while someone types their own number
    });
  });

  return { open: open, command: command };
})();
