/**
 * people.js — the members' people list (#allUsers).
 *
 * Who is here, in the order the room cares about:
 * - "On the decks": the DJs in deck order, with who's playing, who's next,
 *   each one's plays this turn and who steps down when (the bot's bus: after
 *   their next play, after a number of songs, or at a time).
 *   The stage shows the DJs as small faces; this is where their names are.
 * - "On the floor": everyone else (the bot, supermods, mods, members), by
 *   name. People on the waitlist are in the waitlist's card above (room.js).
 *
 * Every face has a dot: green for here, orange for away (the tab hidden, or
 * five minutes without a touch), and from five minutes on the row says for
 * how long. A DJ who dropped off the site keeps their row, marked "away".
 * Whoever fired the song that's on has a flame until the next one.
 *
 * The radio's listeners and the guests are js/audience.js; a visitor's list
 * (#pe-here) is users.js; the card a face opens is ui.js.
 */
firetable.people = (function () {
  var DECK_SIZE = 4;          // from the fifth DJ on, people wait (the waitlist's own words)
  var AWAY_FROM = 5 * 60000;  // a tab hidden for a moment isn't worth a time
  var TICK_MS = 60000;
  var started = false;

  /** An element of the page, or of the members' part while it's set aside for the sign-in screen (users.js). */
  function byId(id) {
    return document.getElementById(id) || (firetable.$appShell && firetable.$appShell.find("#" + id)[0]) || null;
  }
  function esc(s) { return firetable.utilities.htmlEscape(String(s)); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /**
   * When a DJ steps down, from their seat in table/ or waitlist/ (the bot's
   * lib/bus.js): "after this song", "after this song and 2 more", "after
   * next play", "after 3 more songs", "at 9:45 PM", or "" when they aren't leaving.
   * @param {Object} [seat] - {removeAfter, busSongs (songs left, the one playing included), busAt (a time)}
   * @param {boolean} [playing] - their song is the one on now
   */
  function bus(seat, playing) {
    if (!seat) return "";
    if (seat.busAt > 0) return "at " + new Date(seat.busAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    var left = seat.busSongs > 1 ? seat.busSongs | 0 : seat.removeAfter ? 1 : 0;
    if (!left) return "";
    if (playing) return left === 1 ? "after this song" : "after this song and " + (left - 1) + " more";
    return left === 1 ? "after next play" : "after " + left + " more songs";
  }

  /** The icon and name of a role that differs from a member's, or null. */
  function roleOf(u) {
    if (u.hostbot) return { icon: "smart_toy", name: "Room bot", box: "usersBot" };
    if (u.supermod) return { icon: "local_police", name: "Supermod", box: "usersSuper" };
    if (u.mod) return { icon: "shield", name: "Mod", box: "usersMod" };
    return null;
  }

  /**
   * Remember a person's role, so a DJ who drops off the site (and out of
   * ftapi.users) keeps the right icon on their row.
   */
  function remember(u) {
    if (!u || !u.userid) return;
    firetable.ghostRoleCache = firetable.ghostRoleCache || {};
    firetable.ghostRoleCache[u.userid] = { mod: !!u.mod, supermod: !!u.supermod, hostbot: !!u.hostbot, avatarStyle: u.avatarStyle || null };
  }

  /** The DJs in deck order (the database's own: the bot decides the seats). */
  function decks() {
    var list = [], t = firetable.tableData || {};
    for (var k in t) if (own(t, k) && t[k] && t[k].id) list.push(t[k]);
    return list;
  }

  /** Who's on the waitlist, by id: their rows are in the waitlist's card. */
  function waiting() {
    var ids = {}, w = firetable.waitlistData || {};
    for (var k in w) if (own(w, k) && w[k] && w[k].id) ids[w[k].id] = true;
    return ids;
  }

  /** "12m", "3h", "2d": how long since `since` (server time), or "" under five minutes. */
  function awayFor(since) {
    var ms = Date.now() + (ftapi.serverTimeOffset || 0) - since;
    if (!since || !(ms >= AWAY_FROM)) return "";
    var min = Math.floor(ms / 60000);
    if (min < 60) return min + "m";
    if (min < 1440) return Math.floor(min / 60) + "h";
    return Math.floor(min / 1440) + "d";
  }

  /** Away: their tab hidden, or five minutes without a touch (state.js). Never the bot, or a DJ who isn't on the site. */
  function isIdle(p) {
    var u = p.user || {};
    return !p.ghost && !u.hostbot && !!(u.idle && u.idle.isIdle);
  }

  /**
   * Someone's status, by the same rule as their row here (for the Turntable
   * theme and the profile card): {away, since, time, label}. `time` is "12m"
   * from five minutes on; `label` is what to say ("Here", "Away for 12m",
   * "Not on the site" for a DJ who dropped off).
   */
  function status(uid) {
    var u = ftapi.users && ftapi.users[uid];
    if (!u) return { gone: true, away: false, since: 0, time: "", label: "Not on the site" };
    var away = isIdle({ user: u });
    var since = away ? +u.idle.since || 0 : 0;
    var time = since ? awayFor(since) : "";
    return { gone: false, away: away, since: since, time: time, label: away ? "Away" + (time ? " for " + time : "") : "Here" };
  }

  /** What a DJ's row says at its end: playing or next, leaving, and plays this turn. */
  function djMeta(p) {
    var html = "";
    if (p.playing) html += '<span class="material-symbols-outlined pe-now" role="img" title="Playing now" aria-label="Playing now">graphic_eq</span>';
    else if (p.next) html += '<span class="pe-next">Next</span>';
    if (p.leaving) html += '<span class="material-symbols-filled pe-leaving" role="img" title="Steps down ' + esc(p.leaving) + '" aria-label="Steps down ' + esc(p.leaving) + '">departure_board</span>';
    var limit = firetable.playlimit || "∞";
    var plays = p.plays | 0;
    return html + '<span class="pe-plays" title="' + plays + " of " + limit + ' plays this turn">' + plays + "/" + esc(limit) + "</span>";
  }

  /**
   * A person's row. `p`: {id, name, user (their record, or the remembered
   * role of a DJ who dropped off), ghost, dj, playing, next, leaving, plays}.
   */
  function rowHTML(p) {
    var u = p.user || {};
    var role = roleOf(u);
    var name = esc(p.name);
    var idle = isIdle(p);
    var since = idle ? +u.idle.since || 0 : 0;
    var away = since ? awayFor(since) : "";
    var fired = !p.playing && firetable.fireReactors && firetable.fireReactors[p.id];
    var meta = (fired ? '<span class="material-symbols-filled pe-fire" role="img" title="Fired this song" aria-label="Fired this song">mode_heat</span>' : "") +
      (p.playing && !p.dj ? '<span class="material-symbols-outlined pe-now" role="img" title="Playing now" aria-label="Playing now">graphic_eq</span>' : "") +
      (p.dj ? djMeta(p) : "") +
      (p.ghost ? '<span class="pe-gone">away</span>' : "") +
      (since ? '<span class="pe-away" data-since="' + since + '"' + (away ? ' title="Away for ' + away + '"' : "") + ">" + away + "</span>" : "");
    return '<div class="ft-avatar" role="button" tabindex="0" aria-label="' + name + ' — profile" style="background-image:url(' +
      esc(firetable.utilities.avatarURL(p.id, p.name)) + ');">' +
      '<span class="material-symbols-outlined blockon">' + (u.blocked ? "block" : "") + "</span></div>" +
      (p.ghost ? "" : '<span class="pe-dot" aria-hidden="true"></span>') +
      (role ? '<span class="material-symbols-filled prsnRole" role="img" title="' + role.name + '" aria-label="' + role.name + '">' + role.icon + "</span>" : "") +
      '<div class="prsnNameRole"><span class="prsnName">' + name + "</span>" + (idle ? '<span class="sr-only"> (away)</span>' : "") + "</div>" +
      (p.id === ftapi.uid ? '<span class="pe-you">you</span>' : "") +
      (meta ? '<span class="pe-meta">' + meta + "</span>" : "");
  }

  /** The row's element: #user<uid>, with the classes the rest of the site reads (.prson, .idle, .ghost, .blockd). */
  function rowEl(p) {
    var u = p.user || {};
    var el = document.createElement("div");
    el.className = "prson" + (u.blocked ? " blockd" : "") + (p.ghost ? " ghost" : "") +
      (isIdle(p) ? " idle" : "") +
      (p.dj ? " is-dj" : "") + (p.playing ? " is-playing" : "") + (p.id === ftapi.uid ? " is-me" : "");
    el.id = "user" + p.id;
    el.setAttribute("data-userid", p.id);
    el.innerHTML = rowHTML(p);
    return el;
  }

  /** The DJs' rows, in deck order: a DJ who isn't on the site right now is a ghost. */
  function djRows(users, playingId) {
    var djs = decks();
    var at = -1;
    djs.forEach(function (d, i) { if (d.id === playingId) at = i; });
    return djs.map(function (d, i) {
      var live = users[d.id];
      return {
        id: d.id, name: (live && live.username) || d.name || d.id, dj: true, ghost: !live,
        user: live || (firetable.ghostRoleCache && firetable.ghostRoleCache[d.id]) || {},
        playing: i === at, next: djs.length > 1 && at > -1 && i === (at + 1) % djs.length,
        leaving: bus(d, i === at), plays: d.plays
      };
    });
  }

  /** Everyone else who is here and not waiting, by name. */
  function floorRows(users, skip, playingId) {
    var rows = [];
    for (var uid in users) {
      if (!own(users, uid) || !users[uid] || skip[uid]) continue;
      rows.push({ id: uid, name: users[uid].username || uid, user: users[uid], playing: uid === playingId });
    }
    return rows.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; });
  }

  function setHead(id, shown, count) {
    var head = byId(id);
    if (!head) return;
    head.hidden = !shown;
    var n = head.querySelector(".pe-count");
    if (n && count !== undefined) n.textContent = count;
  }

  /** Draw the list again from the room as it is now (people, decks, waitlist, song). */
  function render() {
    var boxes = {};
    ["usersDJs", "usersBot", "usersSuper", "usersMod", "usersRegular"].forEach(function (id) { boxes[id] = byId(id); });
    if (!boxes.usersRegular) return;
    var users = ftapi.users || {};
    for (var uid in users) {
      if (!own(users, uid) || !users[uid]) continue;
      users[uid].userid = uid;
      if (ftapi.blockedUsers && ftapi.blockedUsers[uid]) users[uid].blocked = true;
      remember(users[uid]);
    }
    var playingId = firetable.song && firetable.song.cid && firetable.song.cid != 0 ? firetable.song.djid : null;
    var djs = djRows(users, playingId);
    var skip = waiting();
    djs.forEach(function (d) { skip[d.id] = true; });
    var floor = floorRows(users, skip, playingId);

    var parts = {};
    for (var id in boxes) if (boxes[id]) parts[id] = document.createDocumentFragment();
    djs.forEach(function (p) { (parts.usersDJs || parts.usersRegular).appendChild(rowEl(p)); });
    floor.forEach(function (p) {
      var role = roleOf(p.user);
      (parts[role ? role.box : "usersRegular"] || parts.usersRegular).appendChild(rowEl(p));
    });
    for (var b in parts) boxes[b].replaceChildren(parts[b]);

    // the headings only when there are two groups to tell apart
    setHead("pe-djHead", djs.length > 0, djs.length + "/" + DECK_SIZE);
    setHead("pe-floorHead", djs.length > 0 && floor.length > 0);
    if (firetable.ui.tooltip && firetable.ui.tooltip.refreshUserTip) firetable.ui.tooltip.refreshUserTip();
  }

  /** Once a minute: how long each idle person has been away (here, and in the Turntable theme's list). */
  function tick() {
    if (document.hidden) return;
    var list = byId("allUsers");
    var els = [].slice.call(document.querySelectorAll(".pe-away[data-since]"));
    if (list && !list.isConnected) els = els.concat([].slice.call(list.querySelectorAll(".pe-away[data-since]")));
    els.forEach(function (el) {
      var away = awayFor(+el.getAttribute("data-since"));
      if (el.textContent !== away) el.textContent = away;
      if (away) el.title = "Away for " + away;
    });
  }

  return {
    start: function () {
      if (started) return;
      started = true;
      var draw = firetable.utilities.oncePerFrame(render);
      // Several updates can land at once (presence, idle, blocks, the decks
      // and the song changing together): draw at most once per frame.
      ["usersChanged", "tableChanged", "waitlistChanged", "newSong", "playLimitChanged", "spotlightStateChanged", "firesChanged"].forEach(function (ev) {
        ftapi.events.on(ev, draw);
      });
      ftapi.events.on("userJoined", remember);
      ftapi.events.on("userChanged", remember);
      setInterval(tick, TICK_MS);
      document.addEventListener("visibilitychange", tick);
    },
    render: render,
    status: status,
    bus: bus,
    /** For tests: "12m" for a time `ms` ago. */
    awayFor: awayFor
  };
})();
