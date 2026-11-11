/**
 * embed.js — the room chart, for other sites to show in an iframe.
 *
 *   <iframe src="https://<site>/embed/chart/?period=week" width="400" height="640"
 *     style="border:0" title="Room chart"></iframe>
 *
 * period: week | month | year | all (default week); id: a chart (2026-W46,
 * 2026-11, 2026), or leave it out for the latest; rows: 5 to 40 (default 10).
 * It reads the public chart (discover/charts, published by the hostbot) over
 * Firebase's REST API: no sign-in, no Firebase library, nothing written.
 * Every link opens the room in a new tab.
 */
(function () {
  "use strict";
  var box = document.getElementById("chart");
  var cfg = typeof ftconfigs !== "undefined" ? ftconfigs : {};
  var room = cfg.roomNameShort || cfg.roomName || "the room";
  var dbUrl = String((cfg.firebase && cfg.firebase.databaseURL) || "").replace(/\/$/, "");
  var q = new URLSearchParams(location.search);
  var period = /^(week|month|year|all)$/.test(q.get("period") || "") ? q.get("period") : "week";
  var id = /^[\w-]{1,20}$/.test(q.get("id") || "") ? q.get("id") : null;
  var max = Math.max(5, Math.min(40, Number(q.get("rows")) || 10));
  var site = location.origin + "/";

  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var plural = function (n, one, many) { return Number(n || 0).toLocaleString("en-US") + " " + (Number(n) === 1 ? one : many); };
  var day = function (ms) { return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  function read(path) {
    var url = new URL(dbUrl);
    url.pathname = url.pathname.replace(/\/$/, "") + "/" + path + ".json";
    return fetch(url.href).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function title(c) {
    if (period === "all") return "All time";
    if (period === "year") return id;
    if (period === "month") { var m = /^(\d{4})-(\d\d)$/.exec(id); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : id; }
    return "Week " + Number(String(id).split("-W")[1]) + (c && c.from ? " · " + day(c.from) + " to " + day(c.to - 1) : "");
  }
  function show(c) {
    var rows = ((c && c.rows) || []).slice(0, max);
    var page = site + "music/charts/" + (period === "all" ? "all-time" : period + "/" + id) + "/";
    var open = site + "#discover/charts" + (period === "all" ? "/all" : "/" + period + "/" + id);
    if (!rows.length) { box.innerHTML = '<p class="e-note">No plays on this chart yet.</p>'; return; }
    box.innerHTML = '<header><a class="e-room" href="' + esc(site) + '" target="_blank" rel="noopener"><img src="../../img/idlogo.png" alt="" width="32" height="16" />' + esc(room) + "</a>" +
      '<h1><a href="' + esc(page) + '" target="_blank" rel="noopener">Room chart</a></h1><p>' + esc(title(c)) + (c.plays ? " · " + esc(plural(c.plays, "play", "plays")) : "") + "</p></header>" +
      "<ol>" + rows.map(function (r, i) {
        var art = Number(r.type || 1) === 1 ? "https://i.ytimg.com/vi/" + encodeURIComponent(r.cid) + "/mqdefault.jpg" : "../../img/idlogo.png";
        return '<li><span class="e-n">' + (i + 1) + '</span><img src="' + esc(art) + '" alt="" width="48" height="27" loading="lazy" />' +
          '<span class="e-song"><b>' + esc(r.t) + "</b><span>" + esc(r.a) + '</span></span><span class="e-plays">' + esc(plural(r.plays, "play", "plays")) + "</span></li>";
      }).join("") + "</ol>" +
      '<a class="e-open" href="' + esc(open) + '" target="_blank" rel="noopener">Listen on ' + esc(room) + "</a>";
  }
  if (!dbUrl) { box.innerHTML = '<p class="e-note">This chart isn\'t available.</p>'; return; }
  var latest = id || period === "all" ? Promise.resolve(id || "all") : read("discover/chartIds/" + period).then(function (ids) {
    var list = Object.keys(ids || {}).sort();
    return list[list.length - 1] || null;
  });
  latest.then(function (got) {
    id = got;
    if (!id) throw new Error("none");
    return read("discover/charts/" + period + "/" + id);
  }).then(show, function () { box.innerHTML = '<p class="e-note">This chart isn\'t available right now.</p>'; });
})();
