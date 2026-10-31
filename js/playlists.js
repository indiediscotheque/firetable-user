/**
 * playlists.js — Playlist overview and playlist preferences (#118, #117).
 *
 * - firetable.plPrefs: your playlist preferences, kept in playlistPrefs/<uid>
 *     defaultList  which list is your default (★): it opens first
 *     defaultName  a name for the built-in list (queues/<uid>), "Default Playlist" if unset
 *     order        {listID: n} your own order for the lists
 * - firetable.ui.fillPlaylistSelect(): every playlist <select> is filled through here
 * - The overview dialog (#plIndexBox): rename, reorder, set the default, choose
 *   the list you DJ from, check for broken tracks and delete several at once.
 */

firetable.plPrefs = { defaultList: "0", defaultName: "", order: {} };

// ─── Preferences ─────────────────────────────────────────────────────────────

/** Load your playlist preferences. Always resolves (defaults if unreadable). */
firetable.actions.loadPlaylistPrefs = function () {
  if (!ftapi.uid) return Promise.resolve(firetable.plPrefs);
  return ftapi.db().ref("playlistPrefs/" + ftapi.uid).once("value").then(function (snap) {
    var v = snap.val() || {};
    firetable.plPrefs = {
      defaultList: typeof v.defaultList === "string" ? v.defaultList : "0",
      defaultName: typeof v.defaultName === "string" ? v.defaultName : "",
      order: v.order || {}
    };
    return firetable.plPrefs;
  }, function () { return firetable.plPrefs; });
};

/** Save part of your preferences (merged). */
firetable.actions.savePlaylistPrefs = function (changes) {
  Object.keys(changes).forEach(function (k) {
    if (k.indexOf("order/") === 0) firetable.plPrefs.order[k.slice(6)] = changes[k];
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
};

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
    if (l.list && !l.builtIn) firetable.listCounts[String(l.id)] = firetable.utilities.listStats(l.list);
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

/** Track count and how many are flagged. */
firetable.utilities.listStats = function (tracks) {
  var n = 0, broken = 0;
  Object.keys(tracks || {}).forEach(function (k) {
    if (!tracks[k]) return;
    n++;
    if (tracks[k].flagged) broken++;
  });
  return { n: n, broken: broken };
};

firetable.actions.openPlaylistIndex = function () {
  var dlg = document.getElementById("plIndexBox");
  firetable.plIndex.selected = {};
  $("#plIndexList").html('<p class="plx-empty">Loading your playlists…</p>');
  if (!dlg.open) dlg.showModal();
  Promise.all([firetable.actions.loadPlaylistPrefs(), ftapi.db().ref("queues/" + ftapi.uid).once("value")]).then(function (res) {
    ftapi.lookup.allLists(function (all) {
      firetable.allPlaylists = all || {};
      firetable.plIndex.defaultTracks = res[1].val() || {};
      firetable.ui.renderPlaylistIndex();
    });
  });
};

firetable.ui.renderPlaylistIndex = function () {
  var lists = firetable.plIndex.lists = firetable.utilities.sortedLists(firetable.allPlaylists);
  var djList = String((ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].selectedList) || ftapi.selectedListThing || "0");
  var viewing = String(firetable.viewListID || $("#listpicker").val() || "0");
  var $list = $("#plIndexList").empty();
  lists.forEach(function (l) {
    var tracks = l.builtIn ? firetable.plIndex.defaultTracks : l.list;
    var s = firetable.utilities.listStats(tracks);
    firetable.ui.setListCount(l.id, s);
    var isDefault = firetable.utilities.isDefaultList(l.id);
    var $row = $('<li class="plx-row" role="listitem"></li>').attr("data-id", l.id)
      .toggleClass("is-default", isDefault).toggleClass("is-dj", l.id === djList).toggleClass("is-viewing", l.id === viewing);
    $('<button type="button" class="plx-handle material-symbols-outlined" aria-label="Move (or use Alt + arrow keys)" title="Drag to reorder">drag_indicator</button>').appendTo($row);
    var $check = $('<input type="checkbox" class="plx-check">').attr("aria-label", "Select " + l.name);
    if (l.builtIn) $check.prop("disabled", true).attr("title", "This list can't be deleted");
    $check.prop("checked", !!firetable.plIndex.selected[l.id]).appendTo($row);
    var $main = $('<div class="plx-main"></div>').appendTo($row);
    $('<input type="text" class="plx-name" maxlength="80" spellcheck="false" enterkeyhint="done">')
      .val(l.name).attr("aria-label", "Name of " + l.name).appendTo($main);
    var meta = s.n + (s.n === 1 ? " track" : " tracks") + (s.broken ? " · " + s.broken + " flagged" : "");
    $('<div class="plx-meta"></div>').text(meta).appendTo($main);
    var $acts = $('<div class="plx-actions"></div>').appendTo($row);
    $('<button type="button" class="butt graybutt iconbutt plx-star"><i class="material-symbols-outlined">star</i></button>')
      .attr({ "aria-pressed": isDefault ? "true" : "false", "aria-label": isDefault ? l.name + " is your default" : "Make " + l.name + " your default", title: isDefault ? "Your default list" : "Make default" })
      .appendTo($acts);
    $('<button type="button" class="butt graybutt iconbutt plx-dj"><i class="material-symbols-outlined">headphones</i></button>')
      .attr({ "aria-pressed": l.id === djList ? "true" : "false", "aria-label": "DJ from " + l.name, title: l.id === djList ? "You DJ from this list" : "DJ from this list" })
      .appendTo($acts);
    $('<button type="button" class="butt graybutt iconbutt plx-check-broken"><i class="material-symbols-outlined">troubleshoot</i></button>')
      .attr({ "aria-label": "Check " + l.name + " for broken tracks", title: "Check for broken tracks" })
      .prop("disabled", !s.n).appendTo($acts);
    $('<button type="button" class="butt graybutt iconbutt plx-open"><i class="material-symbols-outlined">arrow_forward</i></button>')
      .attr({ "aria-label": "Open " + l.name, title: "Open" }).appendTo($acts);
    $list.append($row);
  });
  firetable.ui.updatePlaylistIndexBulk();
};

firetable.ui.updatePlaylistIndexBulk = function () {
  var ids = Object.keys(firetable.plIndex.selected).filter(function (k) { return firetable.plIndex.selected[k]; });
  $("#plIndexBulk").prop("hidden", !ids.length);
  $("#plIndexDelete").text(ids.length === 1 ? "Delete 1 playlist" : "Delete " + ids.length + " playlists").removeClass("confirming");
  $("#plIndexCount").text(ids.length + " selected");
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
    if (firetable.allPlaylists) delete firetable.allPlaylists[id];
    delete firetable.plPrefs.order[id];
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
    if (e.button !== 0 || drag) return;
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
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
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
    })
    .on("click", ".plx-star", function () {
      var id = $(this).closest(".plx-row").attr("data-id");
      if (firetable.utilities.isDefaultList(id)) return;
      firetable.actions.savePlaylistPrefs({ defaultList: id === "0" ? null : id });
      firetable.ui.fillPlaylistPickers(firetable.allPlaylists);
      firetable.ui.renderPlaylistIndex();
      $list.find('.plx-row[data-id="' + id + '"] .plx-star').trigger("focus");
    })
    .on("click", ".plx-dj", function () {
      var id = $(this).closest(".plx-row").attr("data-id");
      ftapi.actions.switchDjList(id);
      $("#djlistpicker").val(id);
      if (ftapi.users[ftapi.uid]) ftapi.users[ftapi.uid].selectedList = id;
      firetable.ui.renderPlaylistIndex();
      $list.find('.plx-row[data-id="' + id + '"] .plx-dj').trigger("focus");
    })
    .on("click", ".plx-check-broken", function () {
      var $btn = $(this), id = $btn.closest(".plx-row").attr("data-id");
      var $meta = $btn.closest(".plx-row").find(".plx-meta");
      $btn.prop("disabled", true).addClass("on");
      firetable.actions.checkBrokenTracks(id, {
        onProgress: function (done, total) { $meta.text("Checking… " + done + " of " + total); }
      }).then(function (r) {
        $meta.text(firetable.utilities.brokenSummary(r));
      }, function (err) {
        $meta.text((err && err.message) || "The check didn't finish.");
      }).always(function () { $btn.prop("disabled", false).removeClass("on"); });
    })
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
  $("#plIndexNew").on("keydown", function (e) {
    if (e.key !== "Enter") return;
    var val = this.value.trim();
    if (!val) return;
    var id = ftapi.actions.createList(val);
    firetable.allPlaylists[id] = { name: val, list: {} };
    firetable.utilities.addPlaylistToPickers(id, val);
    this.value = "";
    firetable.ui.renderPlaylistIndex();
  });

  ftapi.events.on("loggedOut", function () {
    firetable.plPrefs = { defaultList: "0", defaultName: "", order: {} };
    if (dlg.open) dlg.close();
  });
};
