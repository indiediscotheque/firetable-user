/**
 * playlists.js — Playlist overview and playlist preferences (#118, #117).
 *
 * - firetable.plPrefs: your playlist preferences, kept in playlistPrefs/<uid>
 *     defaultList  which list is your default (★): it opens first
 *     defaultName  a name for the built-in list (queues/<uid>), "Default Playlist" if unset
 *     order        {listID: n} your own order for the lists
 *     format       {listID: "ytm"|"video"|"sc"} what a list is kept to: YouTube
 *                  Music, YouTube videos or SoundCloud. Unset: any source. The
 *                  bot's nightly swap suggestions are YouTube Music audio
 *                  tracks, the artist's videos for lists set to videos, and
 *                  none for SoundCloud lists (firetable-hostbot lib/swaps.js);
 *                  a SoundCloud list takes SoundCloud tracks only, and the
 *                  others YouTube tracks only.
 * - firetable.ui.fillPlaylistSelect(): every playlist <select> is filled through here
 * - The overview dialog (#plIndexBox): rename, reorder, set the default, choose
 *   the list you DJ from, choose what it's kept to, find a list by name, check
 *   for broken tracks (a row's ⋮ menu), and delete one or several at once.
 */

firetable.plPrefs = { defaultList: "0", defaultName: "", order: {}, format: {} };

// ─── Preferences ─────────────────────────────────────────────────────────────

/** Load your playlist preferences. Always resolves (defaults if unreadable). */
firetable.actions.loadPlaylistPrefs = function () {
  if (!ftapi.uid) return Promise.resolve(firetable.plPrefs);
  return ftapi.db().ref("playlistPrefs/" + ftapi.uid).once("value").then(function (snap) {
    var v = snap.val() || {};
    firetable.plPrefs = {
      defaultList: typeof v.defaultList === "string" ? v.defaultList : "0",
      defaultName: typeof v.defaultName === "string" ? v.defaultName : "",
      order: v.order || {},
      format: v.format && typeof v.format === "object" ? v.format : {}
    };
    return firetable.plPrefs;
  }, function () { return firetable.plPrefs; });
};

/** Save part of your preferences (merged). */
firetable.actions.savePlaylistPrefs = function (changes) {
  Object.keys(changes).forEach(function (k) {
    if (k.indexOf("order/") === 0) firetable.plPrefs.order[k.slice(6)] = changes[k];
    else if (k.indexOf("format/") === 0) {
      if (changes[k] === null) delete firetable.plPrefs.format[k.slice(7)];
      else firetable.plPrefs.format[k.slice(7)] = changes[k];
    }
    else firetable.plPrefs[k] = changes[k] === null ? (k === "defaultList" ? "0" : "") : changes[k];
  });
  return ftapi.db().ref("playlistPrefs/" + ftapi.uid).update(changes).catch(function (e) {
    console.warn("Couldn't save playlist preferences:", e && e.message);
  });
};

/** The built-in list's name. */
firetable.utilities.defaultListName = function () {
  return firetable.plPrefs.defaultName || "Default Playlist";
};

// ─── Formats ─────────────────────────────────────────────────────────────────

/** What a list can be kept to, and what each means for its tracks and swaps. */
firetable.utilities.LIST_FORMATS = {
  ytm: { name: "YouTube Music", help: "YouTube tracks only. Broken tracks get YouTube Music audio tracks as swaps." },
  video: { name: "YouTube videos", help: "YouTube tracks only. Broken tracks get the artist's own videos as swaps, never audio tracks." },
  sc: { name: "SoundCloud", help: "SoundCloud tracks only. No swaps for broken tracks." }
};

/** Does the list on screen take videos (its swaps are music videos, not audio tracks)? */
firetable.utilities.viewingVideoList = function () {
  return firetable.utilities.listFormat(firetable.viewListID || $("#listpicker").val() || "0") === "video";
};

/** A list's format: "ytm", "video" or "sc", or "" when it takes any source. */
firetable.utilities.listFormat = function (listID) {
  var f = (firetable.plPrefs.format || {})[String(listID == null ? "0" : listID)];
  return firetable.utilities.LIST_FORMATS[f] ? f : "";
};

/**
 * Why a track can't go in a list, or "" when it can: a SoundCloud list takes
 * SoundCloud tracks only; one kept to YouTube Music or videos, YouTube only.
 * @param {string} listID
 * @param {number} type - MEDIA_YOUTUBE or MEDIA_SOUNDCLOUD
 */
firetable.utilities.formatRefusal = function (listID, type) {
  var f = firetable.utilities.listFormat(listID);
  if (!f) return "";
  var sc = Number(type) === MEDIA_SOUNDCLOUD;
  if (f === "sc" && !sc) return "\u201c" + firetable.utilities.listName(listID) + "\u201d is kept to SoundCloud tracks.";
  if (f !== "sc" && sc) return "\u201c" + firetable.utilities.listName(listID) + "\u201d is kept to YouTube tracks.";
  return "";
};

/** Is this your default list? */
firetable.utilities.isDefaultList = function (listID) {
  return String(listID) === String(firetable.plPrefs.defaultList || "0");
};

/**
 * Every list (the built-in one included) in your order. Until you reorder
 * them, the default comes first and the rest oldest first; lists you haven't
 * placed yet (new ones) go at the end.
 * @param {Object} allPlaylists - playlists/<uid> value
 * @returns {Array<{id:string, name:string, list:Object}>}
 */
firetable.utilities.sortedLists = function (allPlaylists) {
  var lists = [{ id: "0", name: firetable.utilities.defaultListName(), list: null, builtIn: true }];
  Object.keys(allPlaylists || {}).forEach(function (id) {
    var pl = allPlaylists[id];
    if (pl && typeof pl === "object") lists.push({ id: id, name: firetable.utilities.decodeEntities(String(pl.name || "Untitled")), list: pl.list || {} });
  });
  var order = firetable.plPrefs.order || {};
  var pos = function (l, i) { return typeof order[l.id] === "number" ? order[l.id] : 100000 + i; };
  lists.forEach(function (l, i) { l.pos = pos(l, i); });
  var customOrder = Object.keys(order).length > 0;
  lists.sort(function (a, b) {
    if (!customOrder) {
      var da = firetable.utilities.isDefaultList(a.id), db = firetable.utilities.isDefaultList(b.id);
      if (da !== db) return da ? -1 : 1;
    }
    return a.pos - b.pos;
  });
  return lists;
};

/** Known track counts per list id: { n, broken }. Filled as lists load. */
firetable.listCounts = firetable.listCounts || {};

/**
 * Option text for a list: a star marks the default, and the track count
 * (with any flagged ones) follows the name once it's known.
 */
firetable.utilities.listLabel = function (listID, name) {
  var c = firetable.listCounts[String(listID)];
  var count = c ? " (" + c.n.toLocaleString() + (c.broken ? ", " + c.broken.toLocaleString() + " ⚠" : "") + ")" : "";
  return (firetable.utilities.isDefaultList(listID) ? "★ " : "") + name + count;
};

/**
 * Store a list's track count and update its text in every picker.
 * @param {string} listID
 * @param {{n:number, broken:number}} stats
 */
firetable.ui.setListCount = function (listID, stats) {
  listID = String(listID);
  var prev = firetable.listCounts[listID];
  if (prev && prev.n === stats.n && prev.broken === stats.broken) return;
  firetable.listCounts[listID] = { n: stats.n, broken: stats.broken };
  firetable.ui.relabelList(listID);
  firetable.actions.saveListCounts();
};

/** Remember the counts on this device so they show right away next visit. */
firetable.actions.saveListCounts = function () {
  clearTimeout(firetable.actions.saveListCounts.timer);
  firetable.actions.saveListCounts.timer = setTimeout(function () {
    if (!ftapi.uid) return;
    try { localStorage.setItem(STORAGE.listCounts + ftapi.uid, JSON.stringify(firetable.listCounts)); } catch (e) { /* storage full or blocked */ }
  }, 500);
};

/** Show the counts saved last visit until fresh ones arrive. */
firetable.actions.restoreListCounts = function () {
  firetable.listCounts = {};
  if (!ftapi.uid) return;
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE.listCounts + ftapi.uid) || "{}");
    Object.keys(saved || {}).forEach(function (id) {
      var c = saved[id];
      if (c && typeof c.n === "number") firetable.listCounts[id] = { n: c.n, broken: Number(c.broken) || 0 };
    });
  } catch (e) { /* unreadable: start empty */ }
};

/**
 * Count every list's tracks (and flagged ones) in the background and put the
 * numbers in the pickers. A few lists at a time; never downloads whole lists.
 * @param {Object} allPlaylists - {listID: {name}}
 */
firetable.actions.loadListCounts = function (allPlaylists) {
  var uid = ftapi.uid;
  var ids = ["0"].concat(Object.keys(allPlaylists || {}));
  // forget lists that are gone
  Object.keys(firetable.listCounts).forEach(function (id) {
    if (ids.indexOf(id) === -1) delete firetable.listCounts[id];
  });
  firetable.listCountsLoaded = Date.now();
  var next = 0;
  var worker = function () {
    if (next >= ids.length || ftapi.uid !== uid) return Promise.resolve();
    var id = ids[next++];
    return ftapi.lookup.listCount(id).then(function (s) {
      // the list you're viewing is counted live; don't overwrite it
      if (ftapi.uid === uid && id !== firetable.liveCountID) firetable.ui.setListCount(id, s);
    }, function (err) {
      console.warn("[firetable] couldn't count the tracks in list " + id + ":", err && err.message);
    }).then(worker);
  };
  var workers = [];
  for (var i = 0; i < Math.min(4, ids.length); i++) workers.push(worker());
  return Promise.all(workers).then(function () { firetable.actions.saveListCounts(); });
};

// Recount when you come back to the tab after a while (the bot flags tracks
// and plays from your lists while you're away).
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible" || !ftapi.uid || !firetable.listCountsLoaded) return;
  if (Date.now() - firetable.listCountsLoaded < 15 * 60 * 1000) return;
  firetable.listCountsLoaded = Date.now();
  ftapi.lookup.listNames(function (all) { firetable.actions.loadListCounts(all); });
});

/**
 * Fill a playlist <select>.
 * @param {jQuery} $sel
 * @param {Object} allPlaylists
 * @param {Array<{value:string, text:string}>} [lead] - options to put first
 * @param {string} [idPrefix] - id for each option (id + listID)
 */
firetable.ui.fillPlaylistSelect = function ($sel, allPlaylists, lead, idPrefix) {
  var keep = $sel.val();
  $sel.empty();
  (lead || []).forEach(function (o) { $sel.append($("<option></option>").val(o.value).text(o.text)); });
  firetable.utilities.sortedLists(allPlaylists).forEach(function (l) {
    if (l.list && !l.builtIn) firetable.listCounts[String(l.id)] = firetable.utilities.listStats(l.list, l.id);
    var $o = $("<option></option>").val(l.id).attr("data-name", l.name).text(firetable.utilities.listLabel(l.id, l.name));
    if (idPrefix && l.id !== "0") $o.attr("id", idPrefix + l.id);
    $sel.append($o);
  });
  if (keep != null && $sel.find("option").filter(function () { return this.value === keep; }).length) $sel.val(keep);
};

/** Fill the "view" and "DJ from" pickers. */
firetable.ui.fillPlaylistPickers = function (allPlaylists) {
  firetable.allPlaylists = allPlaylists || {};
  firetable.ui.fillPlaylistSelect($("#listpicker"), allPlaylists, null, "pdopt");
  firetable.ui.fillPlaylistSelect($("#djlistpicker"), allPlaylists);
};

/** Update a list's name (and star, and count) in every picker without reloading them. */
firetable.ui.relabelList = function (listID, name) {
  $("#listpicker, #djlistpicker, #stealpicker, #mergepicker, #mergepicker2").find("option").each(function () {
    if (this.value !== String(listID)) return;
    if (name != null) this.setAttribute("data-name", name);
    var label = this.getAttribute("data-name");
    if (label != null) this.textContent = firetable.utilities.listLabel(listID, label);
  });
};

// ─── Overview dialog ─────────────────────────────────────────────────────────

firetable.plIndex = { lists: [], selected: {} };

/** Track count, how many are flagged, and how many of those have a swap ready. */
firetable.utilities.listStats = function (tracks, listID) {
  var n = 0, broken = 0, swaps = 0;
  Object.keys(tracks || {}).forEach(function (k) {
    if (!tracks[k]) return;
    n++;
    if (tracks[k].flagged) broken++;
    if (firetable.utilities.activeSwap(tracks[k], listID)) swaps++;
  });
  return { n: n, broken: broken, swaps: swaps };
};

firetable.actions.openPlaylistIndex = function () {
  var dlg = document.getElementById("plIndexBox");
  firetable.plIndex.selected = {};
  $("#cr-plFilter").val("");
  $("#cr-plNone").prop("hidden", true);
  $("#plIndexList").removeClass("is-filtered").html('<li class="plx-empty">Loading your playlists…</li>');
  if (!dlg.open) dlg.showModal();
  Promise.all([firetable.actions.loadPlaylistPrefs(), ftapi.db().ref("queues/" + ftapi.uid).once("value")]).then(function (res) {
    ftapi.lookup.allLists(function (all) {
      firetable.allPlaylists = all || {};
      firetable.plIndex.defaultTracks = res[1].val() || {};
      firetable.ui.renderPlaylistIndex();
    });
  });
};

/** The line under a list's name: its tracks, flagged ones and swaps ready. */
firetable.ui.playlistIndexMeta = function ($meta, s, viewing) {
  $meta.empty();
  $('<span class="plx-n"></span>').text(s.n.toLocaleString() + (s.n === 1 ? " track" : " tracks")).appendTo($meta);
  if (s.broken) $('<span class="plx-flagged"></span>').text(s.broken.toLocaleString() + " flagged").attr("title", "Tracks that didn't play: check them, or swap them from the list").appendTo($meta);
  if (s.swaps) $('<span class="plx-swaps"></span>').text(s.swaps.toLocaleString() + (s.swaps === 1 ? " swap" : " swaps") + " ready").appendTo($meta);
  if (viewing) $('<span class="plx-tag"></span>').text("Open now").appendTo($meta);
};

firetable.ui.renderPlaylistIndex = function () {
  var lists = firetable.plIndex.lists = firetable.utilities.sortedLists(firetable.allPlaylists);
  var djList = String((ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].selectedList) || ftapi.selectedListThing || "0");
  var viewing = String(firetable.viewListID || $("#listpicker").val() || "0");
  var $list = $("#plIndexList").empty();
  lists.forEach(function (l) {
    var tracks = l.builtIn ? firetable.plIndex.defaultTracks : l.list;
    var s = firetable.utilities.listStats(tracks, l.id);
    firetable.ui.setListCount(l.id, s);
    var isDefault = firetable.utilities.isDefaultList(l.id), isDj = l.id === djList;
    var $row = $('<li class="plx-row" role="listitem"></li>').attr("data-id", l.id)
      .toggleClass("is-default", isDefault).toggleClass("is-dj", isDj).toggleClass("is-viewing", l.id === viewing);
    $('<button type="button" class="plx-handle material-symbols-outlined" aria-label="Move (or use Alt + arrow keys)" title="Drag to reorder">drag_indicator</button>')
      .attr("aria-label", "Move " + l.name + " (Alt + arrow keys)").appendTo($row);
    var $check = $('<input type="checkbox" class="plx-check">').attr("aria-label", "Select " + l.name);
    if (l.builtIn) $check.prop("disabled", true).attr("title", "This list can't be deleted");
    $check.prop("checked", !!firetable.plIndex.selected[l.id]).appendTo($row);
    var $main = $('<div class="plx-main"></div>').appendTo($row);
    $('<input type="text" class="plx-name" maxlength="80" spellcheck="false" enterkeyhint="done">')
      .val(l.name).attr({ "aria-label": "Name of " + l.name, title: "Click to rename" }).appendTo($main);
    firetable.ui.playlistIndexMeta($('<div class="plx-meta"></div>').appendTo($main), s, l.id === viewing);
    // what the list is kept to (and whether its broken tracks get YouTube Music swaps)
    var fmt = firetable.utilities.listFormat(l.id);
    var $fmt = $('<select class="plx-format"></select>')
      .attr({ "aria-label": "What " + l.name + " is kept to", title: fmt ? firetable.utilities.LIST_FORMATS[fmt].help : "Any source. Broken tracks get YouTube Music audio tracks as swaps." })
      .toggleClass("is-set", !!fmt);
    $fmt.append($('<option value=""></option>').text("Any source"));
    Object.keys(firetable.utilities.LIST_FORMATS).forEach(function (k) {
      $fmt.append($("<option></option>").val(k).text(firetable.utilities.LIST_FORMATS[k].name));
    });
    $fmt.val(fmt).appendTo($row);
    $('<button type="button" class="plx-icon plx-star"><i class="material-symbols-outlined">star</i></button>')
      .attr({ "aria-pressed": isDefault ? "true" : "false", "aria-label": isDefault ? l.name + " is your default" : "Make " + l.name + " your default", title: isDefault ? "Your default: it opens first" : "Make this your default" })
      .appendTo($row);
    $('<button type="button" class="plx-icon plx-dj"><i class="material-symbols-outlined">headphones</i></button>')
      .attr({ "aria-pressed": isDj ? "true" : "false", "aria-label": "DJ from " + l.name, title: isDj ? "You DJ from this list" : "DJ from this list" })
      .appendTo($row);
    $('<button type="button" class="plx-icon plx-open"><i class="material-symbols-outlined">arrow_forward</i></button>')
      .attr({ "aria-label": "Open " + l.name, title: "Open" }).appendTo($row);
    $('<button type="button" class="plx-icon plx-more" aria-haspopup="menu" aria-expanded="false"><i class="material-symbols-outlined">more_vert</i></button>')
      .attr({ "aria-label": "More for " + l.name, title: "Rename, check for broken tracks, delete" })
      .attr("data-empty", s.n ? null : "1").appendTo($row);
    $list.append($row);
  });
  $("#cr-plTotal").text(lists.length);
  firetable.ui.filterPlaylistIndex();
  firetable.ui.updatePlaylistIndexBulk();
};

/** Show only the lists whose name has what's typed in Find a playlist. */
firetable.ui.filterPlaylistIndex = function () {
  var fold = function (t) { return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
  var q = fold($("#cr-plFilter").val() || "").trim();
  var shown = 0;
  $("#plIndexList .plx-row").each(function () {
    var match = !q || fold($(this).find(".plx-name").val()).indexOf(q) !== -1;
    this.hidden = !match;
    if (match) shown++;
  });
  // reordering a filtered list would scramble the hidden ones: only when all show
  $("#plIndexList").toggleClass("is-filtered", !!q);
  $("#cr-plNone").prop("hidden", shown > 0 || !q);
  $("#cr-plTotal").text(q ? shown + " of " + firetable.plIndex.lists.length : firetable.plIndex.lists.length);
};

firetable.ui.updatePlaylistIndexBulk = function () {
  var ids = Object.keys(firetable.plIndex.selected).filter(function (k) { return firetable.plIndex.selected[k]; });
  $("#plIndexBulk").prop("hidden", !ids.length);
  $("#plIndexBox .plx-new").prop("hidden", !!ids.length);
  $("#plIndexDelete").text(ids.length === 1 ? "Delete 1 playlist" : "Delete " + ids.length + " playlists").removeClass("confirming");
  $("#plIndexCount").text(ids.length + " selected");
  var $boxes = $("#plIndexList .plx-row:not([hidden]) .plx-check:not(:disabled)");
  var on = $boxes.filter(":checked").length;
  $("#cr-plSelectAll").prop({ checked: !!$boxes.length && on === $boxes.length, indeterminate: on > 0 && on < $boxes.length, disabled: !$boxes.length });
};

/** Save the order shown in the dialog. */
firetable.actions.savePlaylistOrder = function () {
  var changes = {};
  $("#plIndexList .plx-row").each(function (i) { changes["order/" + this.getAttribute("data-id")] = i; });
  firetable.actions.savePlaylistPrefs(changes);
  firetable.ui.fillPlaylistPickers(firetable.allPlaylists);
};

/** Rename a list (the built-in one's name lives in your preferences). */
firetable.actions.renameList = function (listID, name) {
  name = String(name || "").trim().slice(0, 80);
  if (String(listID) === "0") {
    var builtInName = name === "Default Playlist" ? "" : name;
    if (builtInName === firetable.plPrefs.defaultName) return Promise.resolve();
    return firetable.actions.savePlaylistPrefs({ defaultName: builtInName || null }).then(function () {
      firetable.ui.relabelList("0", firetable.utilities.defaultListName());
    });
  }
  if (!name) return Promise.resolve();
  var pl = firetable.allPlaylists && firetable.allPlaylists[listID];
  if (pl && firetable.utilities.decodeEntities(String(pl.name)) === name) return Promise.resolve();
  if (pl) pl.name = name;
  return ftapi.db().ref("playlists/" + ftapi.uid + "/" + listID + "/name").set(name).then(function () {
    firetable.ui.relabelList(listID, name);
  });
};

/** Delete several lists, moving the DJ list / view / default off them first. */
firetable.actions.deleteLists = function (ids) {
  ids = ids.filter(function (id) { return id && id !== "0"; });
  if (!ids.length) return;
  var gone = function (id) { return ids.indexOf(String(id)) !== -1; };
  if (gone(firetable.plPrefs.defaultList)) firetable.actions.savePlaylistPrefs({ defaultList: null });
  var fallback = firetable.plPrefs.defaultList || "0";
  var djList = (ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].selectedList) || ftapi.selectedListThing;
  if (gone(djList)) { ftapi.actions.switchDjList(fallback); $("#djlistpicker").val(fallback); }
  var listUpdates = {}, orderUpdates = {};
  ids.forEach(function (id) {
    listUpdates[id] = null;
    orderUpdates["order/" + id] = null;
    orderUpdates["format/" + id] = null;
    if (firetable.allPlaylists) delete firetable.allPlaylists[id];
    delete firetable.plPrefs.order[id];
    if (firetable.plPrefs.format) delete firetable.plPrefs.format[id];
  });
  ftapi.db().ref("playlists/" + ftapi.uid).update(listUpdates);
  ftapi.db().ref("playlistPrefs/" + ftapi.uid).update(orderUpdates).catch(function () { /* rules not deployed yet */ });
  var viewing = $("#listpicker").val();
  firetable.ui.fillPlaylistPickers(firetable.allPlaylists);
  if (gone(viewing)) $("#listpicker").val(fallback).trigger("change");
};

firetable.ui.setupPlaylistIndex = function () {
  var dlg = document.getElementById("plIndexBox");
  var $list = $("#plIndexList");
  $("#plIndexBtn").on("click", firetable.actions.openPlaylistIndex);

  // ── Drag the handle to reorder (mouse, touch and pen) ──
  // Pointer events instead of jQuery UI sortable, which ignores drags that
  // start on a button and doesn't know touch at all.
  var drag = null;
  var currentOrder = function () {
    return $list.children(".plx-row").map(function () { return this.getAttribute("data-id"); }).get().join(",");
  };
  var scroller = $list[0]; // the list scrolls; the help text and new-list box stay put
  var onDragMove = function (e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    e.preventDefault();
    var y = e.clientY, before = null;
    $list.children(".plx-row").each(function () {
      if (this === drag.row) return;
      var r = this.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = this; return false; }
    });
    if (before) { if (drag.row.nextElementSibling !== before) $list[0].insertBefore(drag.row, before); }
    else if ($list[0].lastElementChild !== drag.row) $list[0].appendChild(drag.row);
    // keep scrolling when dragging near the top or bottom of the dialog
    if (scroller) {
      var sr = scroller.getBoundingClientRect();
      if (y < sr.top + 40) scroller.scrollTop -= 10;
      else if (y > sr.bottom - 40) scroller.scrollTop += 10;
    }
  };
  var onDragEnd = function (e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragEnd);
    document.removeEventListener("pointercancel", onDragEnd);
    drag.row.classList.remove("is-dragging");
    $list.removeClass("is-sorting");
    var moved = currentOrder() !== drag.from;
    var $handle = $(drag.row).find(".plx-handle");
    drag = null;
    if (moved) firetable.actions.savePlaylistOrder();
    $handle.trigger("focus");
  };
  // Moving the row in the DOM drops pointer capture, so follow the pointer
  // on the document for the length of the drag.
  $list.on("pointerdown", ".plx-handle", function (e) {
    if (e.button !== 0 || drag || $list.hasClass("is-filtered")) return;
    e.preventDefault();
    var row = this.closest(".plx-row");
    drag = { row: row, pointer: e.pointerId, from: currentOrder() };
    row.classList.add("is-dragging");
    $list.addClass("is-sorting");
    document.addEventListener("pointermove", onDragMove, { passive: false });
    document.addEventListener("pointerup", onDragEnd);
    document.addEventListener("pointercancel", onDragEnd);
  });

  $list
    // Keyboard reordering on the handle
    .on("keydown", ".plx-handle", function (e) {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || $list.hasClass("is-filtered")) return;
      e.preventDefault();
      var $row = $(this).closest(".plx-row");
      if (e.key === "ArrowUp") $row.prev().before($row); else $row.next().after($row);
      $(this).trigger("focus");
      firetable.actions.savePlaylistOrder();
    })
    .on("change", ".plx-check", function () {
      firetable.plIndex.selected[$(this).closest(".plx-row").attr("data-id")] = this.checked;
      firetable.ui.updatePlaylistIndexBulk();
    })
    .on("keydown", ".plx-name", function (e) {
      if (e.key === "Enter") { e.preventDefault(); this.blur(); }
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        var l = firetable.plIndex.lists.filter(function (x) { return x.id === $(this).closest(".plx-row").attr("data-id"); }, this)[0];
        if (l) this.value = l.name;
        this.blur();
      }
    })
    .on("blur", ".plx-name", function () {
      var $row = $(this).closest(".plx-row"), id = $row.attr("data-id");
      var val = this.value.trim();
      if (!val) { this.value = id === "0" ? firetable.utilities.defaultListName() : (firetable.plIndex.lists.filter(function (x) { return x.id === id; })[0] || {}).name || ""; return; }
      firetable.actions.renameList(id, val);
      firetable.plIndex.lists.forEach(function (x) { if (x.id === id) x.name = val; });
      $row.find(".plx-check").attr("aria-label", "Select " + val);
    })
    .on("click", ".plx-star", function () {
      var id = $(this).closest(".plx-row").attr("data-id");
      if (firetable.utilities.isDefaultList(id)) return;
      firetable.actions.savePlaylistPrefs({ defaultList: id === "0" ? null : id });
      firetable.ui.fillPlaylistPickers(firetable.allPlaylists);
      firetable.ui.renderPlaylistIndex();
      $list.find('.plx-row[data-id="' + id + '"] .plx-star').trigger("focus");
    })
    .on("change", ".plx-format", function () {
      var id = $(this).closest(".plx-row").attr("data-id");
      var val = this.value;
      var change = {};
      change["format/" + id] = val || null;
      firetable.actions.savePlaylistPrefs(change);
      this.title = val ? firetable.utilities.LIST_FORMATS[val].help : "Any source. Broken tracks get YouTube Music audio tracks as swaps.";
      $(this).toggleClass("is-set", !!val);
      var onScreen = String(id) === String(firetable.viewListID || $("#listpicker").val());
      if (onScreen) firetable.ui.matchSearchSource(id);
      // suggestions that don't fit the new format go (the bot finds ones that do)
      firetable.actions.clearMisfitSwaps(id).then(function () {
        if (onScreen && firetable.queue) firetable.ui.renderSwapBar(firetable.queue);
      }, function () {});
      firetable.ui.toast(val ? "\u201c" + firetable.utilities.listName(id) + "\u201d: " + firetable.utilities.LIST_FORMATS[val].help : "\u201c" + firetable.utilities.listName(id) + "\u201d takes any source.", "notice");
    })
    .on("click", ".plx-dj", function () {
      var id = $(this).closest(".plx-row").attr("data-id");
      ftapi.actions.switchDjList(id);
      $("#djlistpicker").val(id);
      if (ftapi.users[ftapi.uid]) ftapi.users[ftapi.uid].selectedList = id;
      firetable.ui.renderPlaylistIndex();
      $list.find('.plx-row[data-id="' + id + '"] .plx-dj').trigger("focus");
    })
    .on("click", ".plx-more", function () { openRowMenu(this); })
    .on("click", ".plx-open", function () {
      var id = $(this).closest(".plx-row").attr("data-id");
      dlg.close();
      if (firetable.nav.view !== "playlists" || firetable.nav.mobileSection !== "view") firetable.nav.setView("playlists");
      $("#listpicker").val(id).trigger("change");
    });

  $("#plIndexDelete").on("click", function () {
    var ids = Object.keys(firetable.plIndex.selected).filter(function (k) { return firetable.plIndex.selected[k]; });
    if (!ids.length) return;
    var $b = $(this);
    if (!$b.hasClass("confirming")) {
      // second click deletes: the names are listed so nothing goes by surprise
      var names = firetable.plIndex.lists.filter(function (l) { return ids.indexOf(l.id) !== -1; }).map(function (l) { return l.name; });
      $b.addClass("confirming").text("Yes, delete for good");
      $("#plIndexCount").text("Delete " + names.join(", ") + "? This can't be undone.");
      return;
    }
    firetable.actions.deleteLists(ids);
    firetable.plIndex.selected = {};
    firetable.ui.renderPlaylistIndex();
  });
  $("#plIndexClearSel").on("click", function () {
    firetable.plIndex.selected = {};
    $list.find(".plx-check").prop("checked", false);
    firetable.ui.updatePlaylistIndexBulk();
  });
  // ── New playlist: type a name, then Enter or Create ──
  var createList = function () {
    var input = document.getElementById("plIndexNew");
    var val = input.value.trim();
    if (!val) return;
    var id = ftapi.actions.createList(val);
    firetable.allPlaylists[id] = { name: val, list: {} };
    firetable.utilities.addPlaylistToPickers(id, val);
    input.value = "";
    $("#cr-plCreate").prop("disabled", true);
    $("#cr-plFilter").val("");
    firetable.ui.renderPlaylistIndex();
    var row = $list.find('.plx-row[data-id="' + id + '"]')[0];
    if (row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row.classList.add("is-new");
      setTimeout(function () { row.classList.remove("is-new"); }, 1600);
    }
    firetable.ui.toast("Made \u201c" + val + "\u201d.", "notice");
  };
  $("#plIndexNew").on("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); createList(); }
  }).on("input", function () { $("#cr-plCreate").prop("disabled", !this.value.trim()); });
  $("#cr-plCreate").on("click", createList);

  // ── Find a playlist ──
  $("#cr-plFilter").on("input", function () {
    firetable.ui.filterPlaylistIndex();
    firetable.ui.updatePlaylistIndexBulk();
  }).on("keydown", function (e) {
    // Escape clears the box first, then closes the dialog
    if (e.key === "Escape" && this.value) { e.preventDefault(); e.stopPropagation(); this.value = ""; $(this).trigger("input"); }
  });

  // ── Select every list shown (not the built-in one) ──
  $("#cr-plSelectAll").on("change", function () {
    var on = this.checked;
    $list.find(".plx-row:not([hidden]) .plx-check:not(:disabled)").each(function () {
      this.checked = on;
      firetable.plIndex.selected[$(this).closest(".plx-row").attr("data-id")] = on;
    });
    firetable.ui.updatePlaylistIndexBulk();
  });

  // ── A row's ⋮ menu: Rename, Check for broken tracks, Delete ──
  var menu = document.getElementById("cr-plRowMenu");
  var menuBtn = null;
  var checkList = function (id) {
    var $row = $list.find('.plx-row[data-id="' + id + '"]');
    var $meta = $row.find(".plx-meta");
    var $more = $row.find(".plx-more").prop("disabled", true).addClass("is-busy");
    $row.addClass("is-checking");
    $meta.text("Checking for broken tracks…");
    firetable.actions.checkBrokenTracks(id, {
      onProgress: function (done, total) { $meta.text("Checking… " + done.toLocaleString() + " of " + total.toLocaleString()); }
    }).then(function (r) {
      $meta.text(firetable.utilities.brokenSummary(r));
    }, function (err) {
      $meta.text((err && err.message) || "The check didn't finish.");
    }).always(function () { $more.prop("disabled", false).removeClass("is-busy"); $row.removeClass("is-checking"); });
  };
  var openRowMenu = function (btn) {
    if (menu.matches(":popover-open")) {
      var same = menuBtn === btn;
      menu.hidePopover();
      if (same) return;
    }
    menuBtn = btn;
    var id = $(btn).closest(".plx-row").attr("data-id");
    $(menu).find('[data-act="delete"]').prop("disabled", id === "0").attr("title", id === "0" ? "This list can't be deleted" : null);
    $(menu).find('[data-act="check"]').prop("disabled", !!btn.getAttribute("data-empty"));
    $(btn).addClass("on").attr("aria-expanded", "true");
    menu.style.visibility = "hidden";
    menu.showPopover();
    firetable.ui.positionPopover(btn, menu, document.getElementById("cr-plRowMenuArrow"), "bottom-end").then(function () {
      var first = menu.querySelector('[role="menuitem"]:not(:disabled)');
      if (first) first.focus();
    });
  };
  menu.addEventListener("toggle", function (e) {
    if (e.newState === "closed" && menuBtn) $(menuBtn).removeClass("on").attr("aria-expanded", "false");
  });
  $(menu).on("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    var items = $(menu).find('[role="menuitem"]:not(:disabled)').get();
    var i = items.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1);
    items[(i + items.length) % items.length].focus();
  }).on("click", "[data-act]", function () {
    var act = this.getAttribute("data-act");
    var $row = $(menuBtn).closest(".plx-row"), id = $row.attr("data-id");
    menu.hidePopover();
    if (!id) return;
    if (act === "rename") {
      var name = $row.find(".plx-name")[0];
      name.focus();
      name.select();
    } else if (act === "check") {
      checkList(id);
    } else if (act === "delete" && id !== "0") {
      // just this one: the bulk bar asks to confirm, naming it
      firetable.plIndex.selected = {};
      firetable.plIndex.selected[id] = true;
      $list.find(".plx-check").each(function () { this.checked = $(this).closest(".plx-row").attr("data-id") === id; });
      firetable.ui.updatePlaylistIndexBulk();
      $("#plIndexDelete").trigger("click").trigger("focus");
    }
  });

  ftapi.events.on("loggedOut", function () {
    firetable.plPrefs = { defaultList: "0", defaultName: "", order: {}, format: {} };
    firetable.listCounts = {};
    firetable.listCountsLoaded = 0;
    firetable.liveCountID = null;
    if (dlg.open) dlg.close();
  });
};
