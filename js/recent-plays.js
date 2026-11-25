/**
 * recent-plays.js — songs the room played lately, marked in your playlist.
 *
 * The hostbot doesn't play a song again within a few hours (4 by default): on
 * a DJ's turn it plays the first track in their list that's neither flagged
 * nor played lately, and leaves the skipped ones where they are
 * (firetable-hostbot lib/repeats.js). It keeps those plays in playedRecently/
 * <type><cid> = { w: when it started, u: until when it's skipped, n: the
 * song's key (nameKey), dj: who played it }, a few dozen at a time.
 *
 * Here each playlist row whose track (or another upload of its song) is in
 * there gets a "Played 1h ago" tag saying until when it's skipped, so you can
 * pick another song, and the Next tag moves to the song that will really
 * play. Rows are marked as js/playlist.js draws them (a MutationObserver on
 * #mainqueue), again when a song starts, and when a play's hours are up.
 * Loaded once you're signed in (js/lazy.js, which has its stand-in).
 */
firetable.recentPlays = (function () {
  "use strict";
  var plays = {};  // "<type><cid>" -> { w, u, n, dj }
  var byName = {}; // nameKey -> the latest of those
  var watching = false, frame = 0, expiry = 0;
  var queueEl = document.getElementById("mainqueue");

  // The same as the hostbot's nameKey (lib/repeats.js): keep them in step.
  var NOISE = /[([][^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|remaster(?:ed)?|explicit|clip)\b[^)\]]*[)\]]/gi;
  var FEAT = /\s(?:feat\.?|ft\.?|featuring)\s[^()[\]]*/gi;
  var NOT_WORD = (function () {
    try { return new RegExp("[^\\p{L}\\p{N}]+", "gu"); } catch (e) { return /[^a-z0-9À-￿]+/g; } // older browsers
  })();
  /**
   * The key two uploads of the same song share; "" without "Artist - Title".
   * @param {string} name
   * @returns {string}
   */
  function nameKey(name) {
    var s = String(name == null ? "" : name);
    if (!/\S\s[-–—]\s\S/.test(s)) return "";
    return s.normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(NOISE, " ").replace(FEAT, " ").toLowerCase()
      .replace(/&/g, " and ").replace(NOT_WORD, " ").trim();
  }

  /**
   * When the room played this track (or another upload of its song), while
   * that keeps it from playing; otherwise null.
   * @param {Object} track - a playlist entry (type, cid, name)
   * @returns {{w: number, u: number, n?: string, dj?: string}|null}
   */
  function lately(track) {
    if (!track || track.cid == null) return null;
    var now = ftapi.now();
    var e = plays[String(track.type) + track.cid];
    if (e && e.u > now) return e;
    var n = nameKey(track.name);
    e = n ? byName[n] : null;
    return e && e.u > now ? e : null;
  }

  /** "1h", "25m", "1h 5m" */
  function ago(ms) {
    var min = Math.max(1, Math.round(ms / 60000));
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + "h" + (m && h < 2 ? " " + m + "m" : "") : m + "m";
  }

  function tagHtml(e) {
    var now = ftapi.now();
    var until = new Date(e.u - ftapi.serverTimeOffset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    var title = "The room played this " + ago(now - e.w) + " ago" + (e.dj ? " (" + e.dj + ")" : "") +
      ". When it comes up on your turn it's skipped and your next song plays, until " + until + ".";
    var t = firetable.utilities.htmlEscape(title);
    return '<span class="q-tag q-recent" title="' + t + '" aria-label="' + t + '">' +
      '<span class="material-symbols-outlined" aria-hidden="true">history</span><span class="q-recentText">Played ' + ago(now - e.w) + ' ago</span></span>';
  }

  /** Tag (or untag) these rows. */
  function markRows(rows) {
    var list = firetable.queue || {};
    rows.forEach(function (row) {
      var e = lately(list[row.getAttribute("data-key")]);
      var old = row.querySelector(".q-recent");
      row.classList.toggle("is-recent", !!e);
      if (old) old.remove();
      var name = e && row.querySelector(".q-name");
      if (name) name.insertAdjacentHTML("afterend", tagHtml(e));
    });
  }

  /**
   * The key of the song the bot plays next from this list: the first that's
   * neither flagged nor played lately (the first unflagged one when every
   * song was played lately).
   * @param {Object} [list] - tracks by key, in play order (firetable.queue)
   * @returns {string|null}
   */
  function nextKey(list) {
    var first = null;
    var keys = Object.keys(list || {});
    for (var i = 0; i < keys.length; i++) {
      var t = list[keys[i]];
      if (!t || t.flagged) continue;
      if (!first) first = keys[i];
      if (!lately(t)) return keys[i];
    }
    return first;
  }

  /** Move the Next tag (row 1's, js/playlist.js) to the song that will really play. */
  function markNext() {
    if (!queueEl) return;
    queueEl.querySelectorAll(".q-next-moved").forEach(function (el) { el.remove(); });
    queueEl.querySelectorAll(".pvbar.not-next").forEach(function (el) { el.classList.remove("not-next"); });
    var first = queueEl.querySelector(".q-next");
    var firstRow = first && first.closest(".pvbar");
    var key = nextKey(firetable.queue);
    if (!firstRow || !key || firstRow.getAttribute("data-key") === key) return;
    var row = document.getElementById("pvbar" + key);
    var name = row && row.querySelector(".q-name");
    if (!name) return; // not drawn yet: the observer comes back for it
    firstRow.classList.add("not-next");
    name.insertAdjacentHTML("afterend", '<span class="q-tag q-next q-next-moved">Next</span>');
  }

  /** Mark every row drawn, once per frame however often it's asked. */
  function refresh() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      if (!queueEl) return;
      markRows(Array.prototype.slice.call(queueEl.querySelectorAll(".pvbar")));
      markNext();
      scheduleExpiry();
    });
  }

  // Look again when the next play's hours are up.
  function scheduleExpiry() {
    clearTimeout(expiry);
    var now = ftapi.now(), soonest = Infinity;
    Object.keys(plays).forEach(function (id) { if (plays[id].u > now && plays[id].u < soonest) soonest = plays[id].u; });
    if (soonest !== Infinity) expiry = setTimeout(refresh, Math.min(soonest - now + 1000, 2147483647));
  }

  function reindex() {
    byName = {};
    Object.keys(plays).forEach(function (id) {
      var e = plays[id];
      if (e.n && (!byName[e.n] || byName[e.n].w <= e.w)) byName[e.n] = e;
    });
    refresh();
  }

  /** Start following playedRecently (once). */
  function watch() {
    if (watching || !window.ftapi || !ftapi.started) return;
    watching = true;
    var ref = ftapi.db().ref("playedRecently");
    var put = function (snap) {
      var e = snap.val();
      if (e && typeof e.w === "number" && typeof e.u === "number") plays[snap.key] = e;
      else delete plays[snap.key];
      reindex();
    };
    ref.on("child_added", put);
    ref.on("child_changed", put);
    ref.on("child_removed", function (snap) { delete plays[snap.key]; reindex(); });
  }

  // Rows js/playlist.js draws: the whole list (innerHTML) or a block at a time
  if (queueEl && typeof MutationObserver !== "undefined") {
    new MutationObserver(function (changes) {
      var rows = [];
      changes.forEach(function (c) {
        c.addedNodes.forEach(function (n) {
          if (n.nodeType === 1) rows.push.apply(rows, n.matches(".pvbar") ? [n] : n.querySelectorAll(".pvbar"));
        });
      });
      if (rows.length) markRows(rows);
      markNext();
    }).observe(queueEl, { childList: true });
  }
  // which list you DJ from decides where Next goes
  if (window.ftapi && ftapi.events) ftapi.events.on("djListChanged", refresh);

  return { watch: watch, lately: lately, nameKey: nameKey, nextKey: nextKey, refresh: refresh };
})();
