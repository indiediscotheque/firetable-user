/**
 * set-end.js — end your set on a song you pick.
 *
 * Your DJ playlist's ⋮ track menu (#trackMenuPopover, js/playlist.js) has
 * "Step down after this song". It marks that track (busStop: true, saved on
 * the track in your own list) and takes the mark off any other, so a list has
 * one. Played in your order, the songs above it and the marked one are your
 * set: when the bot starts the marked track it puts you on the bus, so you
 * step down after it, and drops the mark (firetable-hostbot lib/bus.js
 * endOfSet). The mark moves with the track when you drag or send it to the
 * top or bottom.
 *
 * The list draws a line under the marked track and tags it "Last song"
 * (css/looks.css, .pvbar.is-busstop) while it's your DJ playlist in your play
 * order. The bus menu (js/bus-menu.js) says where your set ends
 * (firetable.setEnd.find).
 */
firetable.setEnd = (function () {
  "use strict";
  var ON = "Step down after this song";
  var OFF = "Don't end my set here";

  /** The shown list is the one you DJ from (js/playlist.js firetable.ui.markDjList). */
  function isDjList() {
    var q = document.getElementById("mainqueue");
    return !!q && q.classList.contains("is-djlist");
  }

  /**
   * Where a list's set ends: the marked track, and how many songs until it's
   * done (in play order, broken tracks skipped, the marked one counted).
   * @param {Object} [list] - tracks by key (firetable.queue)
   * @returns {{key: string, name: string, songs: number}|null}
   */
  function find(list) {
    if (!list) return null;
    var songs = 0;
    var keys = Object.keys(list); // in play order, as the list numbers its rows (js/playlist.js)
    for (var i = 0; i < keys.length; i++) {
      var t = list[keys[i]];
      if (!t || t.flagged) continue;
      songs++;
      if (t.busStop) return { key: keys[i], name: String(t.name || ""), songs: songs };
    }
    return null;
  }

  /** Mark this track as the set's last (on), or take the mark off; one mark a list. */
  function mark(key, on) {
    var list = firetable.queue || {};
    var track = list[key];
    if (!track || !ftapi.queueRef) return Promise.resolve();
    var updates = {};
    Object.keys(list).forEach(function (k) {
      if (list[k] && list[k].busStop && k !== key) updates[k + "/busStop"] = null;
    });
    updates[key + "/busStop"] = on ? true : null;
    return ftapi.queueRef.update(updates).then(function () {
      firetable.ui.toast(on ? "You'll step down after " + (track.name || "this song") + ". The line in your list shows where your set ends."
        : "Your set won't end there.", "success");
    }, ftapi.saveFailed("where your set ends"));
  }

  // The item, shown on your DJ playlist's rows. The menu's items are written
  // when the playlist starts (js/playlist.js), so it's put in (again, if
  // need be) as the menu opens.
  var menu = document.getElementById("trackMenuPopover");
  // one of the shared song menu's items (js/helpers.js firetable.songMenu), after "Send to bottom"
  var M = firetable.songMenu;
  M.ITEMS.busstop = { icon: "departure_board", label: ON };
  if (M.ORDER.indexOf("busstop") === -1) M.ORDER.splice(M.ORDER.indexOf("bottom") + 1, 0, "busstop");
  function item() {
    var it = menu.querySelector('[data-act="busstop"]');
    if (it) return it;
    var html = M.item("busstop", M.ITEMS.busstop);
    var bottom = menu.querySelector('[data-act="bottom"]');
    if (bottom) bottom.insertAdjacentHTML("afterend", html);
    else menu.querySelector(".ft-menu").insertAdjacentHTML("beforeend", html);
    return menu.querySelector('[data-act="busstop"]');
  }
  /** The row the menu is open on (js/playlist.js sets firetable.trackMenuRow first), and its track. */
  function row() {
    var el = firetable.trackMenuRow && firetable.trackMenuRow[0];
    var key = el && el.getAttribute("data-key");
    return { key: key, track: key && firetable.queue ? firetable.queue[key] : null };
  }
  if (menu) {
    menu.addEventListener("beforetoggle", function (e) {
      if (e.newState !== "open") return;
      var it = item(), r = row();
      it.hidden = !r.track || !isDjList();
      it.lastChild.textContent = " " + (r.track && r.track.busStop ? OFF : ON); // the words after the icon
    });
    menu.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest('[data-act="busstop"]')) return;
      var r = row();
      if (r.track) mark(r.key, !r.track.busStop);
    });
  }

  return { find: find, mark: mark };
})();
