/**
 * discover-shuffle.js — Shuffle, as a setting of Discover's player.
 *
 * Shuffle belongs to the player, not to a list: while it's on, Next picks a
 * song not heard yet from whatever list is playing (a playlist, a chart, a
 * genre, the crate), Previous goes back through the songs heard, and Play
 * starts on a random song. The list itself keeps its order (the crate's
 * Shuffle list is what reorders one). Off, the player goes down the list.
 * The setting is remembered in this browser.
 *
 * discover.js makes the one there is with firetable.discoverShuffle(deps):
 * deps are its player and helpers, handed over as functions.
 */
firetable.discoverShuffle = (function () {
  "use strict";
  var KEY = "ft-shuffle";
  var deps = null;
  var on = false;
  var listName = null;  // the list the history below is for
  var heard = {};       // its songs heard since shuffle came on, by type_cid
  var back = [];        // the songs before this one (type_cid), newest last
  var pick = -1;        // the song after this one, chosen ahead so the player can show it
  var goingBack = false;

  function id(t) { return t ? Number(t.type || 1) + "_" + t.cid : ""; }
  function tracks() { var l = deps.lists()[deps.player().list]; return l ? l.tracks : []; }
  function find(all, key) {
    for (var i = 0; i < all.length; i++) if (id(all[i]) === key) return i;
    return -1;
  }
  function forget(name) { listName = name; heard = {}; back = []; pick = -1; }

  /** A random song from `all` not heard yet, or -1 when every one has been. */
  function unheard(all) {
    var left = [];
    all.forEach(function (t, i) { if (!heard[id(t)]) left.push(i); });
    return left.length ? left[Math.floor(Math.random() * left.length)] : -1;
  }

  /** The last song heard before this one that's still in the list. */
  function previous() {
    var all = tracks();
    for (var j = back.length - 1; j >= 0; j--) {
      var at = find(all, back[j]);
      if (at !== -1) return { at: at, j: j };
    }
    return { at: -1, j: -1 };
  }

  /** The song after song `i`: the next down the list, or (shuffle) one not heard yet. -1: none. */
  function after(i) {
    var all = tracks();
    if (!on) return i + 1 < all.length ? i + 1 : -1;
    if (pick === -1 || !all[pick] || heard[id(all[pick])]) pick = unheard(all);
    return pick;
  }

  /** The song before song `i`: the one above it, or (shuffle) the one heard before it. -1: none. */
  function before(i) { return on ? previous().at : i - 1; }

  /** Where Next (`by` 1) or Previous (-1) goes from song `i`; -1 when nowhere. */
  function step(i, by) {
    if (by > 0 || !on) return by > 0 ? after(i) : i - 1;
    var p = previous();
    if (p.at !== -1) { back.length = p.j; goingBack = true; }
    return p.at;
  }

  /** discover.js's play() started `t` from list `name`; `was` is the song before it from the same list. */
  function played(name, t, was) {
    if (name !== listName) forget(name);
    else if (was && !goingBack && id(was) !== id(t)) back.push(id(was));
    goingBack = false;
    heard[id(t)] = true;
    pick = -1;
  }

  /** Play a list from the top, or (shuffle) from a random song. */
  function playAll(name) {
    var l = deps.lists()[name];
    if (!l || !l.tracks.length) return;
    forget(name);
    deps.play(name, on ? Math.floor(Math.random() * l.tracks.length) : 0);
  }

  /** Shuffle on or off. What's playing counts as heard; the rest are all to come. */
  function set(value, quiet) {
    on = !!value;
    deps.store.set(KEY, on);
    var t = deps.player().track;
    heard = {};
    pick = -1;
    if (t) heard[id(t)] = true;
    if (!quiet) deps.announce(on ? "Shuffle on" : "Shuffle off");
    deps.render();
  }

  /** The player's Shuffle button (the bar's and the full-screen player's), pressed while on. */
  function button(extra) {
    return '<button type="button" class="butt graybutt iconbutt d-shuffle' + (on ? " on" : "") + (extra ? " " + extra : "") +
      '" aria-pressed="' + on + '" title="' + (on ? "Shuffle is on" : "Shuffle") + '" aria-label="Shuffle">' + deps.ms("shuffle") + "</button>";
  }

  return function create(d) {
    deps = d;
    on = !!deps.store.get(KEY, false);
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".d-shuffle")) set(!on);
    });
    return {
      on: function () { return on; },
      after: after,
      before: before,
      step: step,
      played: played,
      playAll: playAll,
      /** The crate's Shuffle: shuffle on, and play it. */
      start: function (name) { set(true, true); playAll(name); },
      button: button
    };
  };
})();
