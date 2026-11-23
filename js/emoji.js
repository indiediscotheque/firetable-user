/**
 * emoji.js — Emoji picker, search, and shortname-to-unicode conversion.
 *
 * Emoji data (Emoji 17.0) comes from this site's own js/emoji-map.json (every
 * page) and js/emoji-picker.json (the picker's first open), both built by
 * tools/build-emoji.mjs. Converts :shortname: strings to unicode characters
 * in chat messages.
 */

firetable.emojis = {

  /**
   * Show all emoji results and section headers (resets any active search filter).
   */
  h: function () {
    firetable.emojis.lastSearch = "";
    var $root = $(firetable.emojis.results());
    $root.find(".pickerResult").show();
    $root.find("h3").show();
  },

  /** The picker's results (#pickerResults), also while the app shell is detached (the login screen). */
  results: function () {
    return document.getElementById("pickerResults") || (firetable.$appShell && firetable.$appShell.find("#pickerResults")[0]) || null;
  },

  /**
   * Test whether a picker emoji element matches a search query.
   * Checks both the visible text (the emoji itself) and the data-alternative-name attribute.
   * @param {jQuery} $el - The emoji span element
   * @param {string} query - Lowercase search term
   * @returns {boolean}
   */
  n: function ($el, query) {
    var altName = $el.attr("data-alternative-name");
    return ($el.text().toLowerCase().indexOf(query) >= 0) ||
           (altName != null && altName.toLowerCase().indexOf(query) >= 0);
  },

  /**
   * Toggle an emoji category section in the picker.
   * Clicking the same section twice resets to showing all sections.
   * @param {string} sec - The section button's element ID (e.g. "bpickersmileys_emotion")
   */
  sec: function (sec) {
    var selectedSec = $("#pickerNav > .on");
    var contentId = sec.substr(1); // strip the "b" prefix to get the content div ID

    if (selectedSec.length) {
      if (selectedSec[0].id === sec) {
        // Toggle off — back to full list
        $("#" + selectedSec[0].id).removeClass("on");
        $("#pickerContents div").show();
      } else {
        // Switch to new section
        $("#" + selectedSec[0].id).removeClass("on");
        $("#" + selectedSec[0].id.substr(1)).hide();
        $("#" + sec).addClass("on");
        $("#" + contentId).show();
      }
    } else {
      // First selection
      $("#" + sec).addClass("on");
      $("#pickerContents div").hide();
      $("#" + contentId).show();
    }
  },

  /**
   * Filter the emoji picker results by search text.
   * Hides section headers during search, shows all when cleared.
   * @param {string} val - Search text
   */
  niceSearch: function (val) {
    val = String(val || "").toLowerCase();
    if (val === (firetable.emojis.lastSearch || "")) return; // the same search again (change on blur)
    if (val.length === 0) {
      firetable.emojis.h();
      return;
    }
    firetable.emojis.lastSearch = val;
    var root = firetable.emojis.results();
    if (!root) return;
    // Hide headers during filtered search
    $(root).find("h3").hide();
    // ~1,900 emoji: decide every one first, then show and hide them in one
    // pass (jQuery's show() reads each one's style, a recalculation apiece
    // between the hides), matching against each one's words worked out once
    var els = root.querySelectorAll(".pickerResult");
    var show = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el._ftWords === undefined) {
        var altName = el.getAttribute("data-alternative-name");
        el._ftWords = el.textContent.toLowerCase() + "\n" + (altName != null ? altName.toLowerCase() : "");
      }
      show.push(el._ftWords.indexOf(val) >= 0);
    }
    for (var j = 0; j < els.length; j++) els[j].style.display = show[j] ? "" : "none";
  }
};

// ─── Emoji Map Loading & Conversion (extends firetable.utilities) ────────────

/**
 * Where the emoji data lives: this site's own files, built by
 * tools/build-emoji.mjs. index.html links them (#emojiMapData, preloaded) so
 * the deploy gives each a version from its contents.
 * @param {string} which - "map" or "picker"
 * @returns {string}
 */
function emojiDataUrl(which) {
  var link = document.getElementById("emojiMapData");
  if (which === "picker") return (link && link.getAttribute("data-picker")) || "js/emoji-picker.json";
  return (link && link.getAttribute("href")) || "js/emoji-map.json";
}

/**
 * Fetch firetable.emojiMap (shortname → emoji, with the old emojilib v2 names
 * and names Unicode has since changed). Small, read on every page: the chat,
 * the theme and notices all turn :shortnames: into emoji.
 */
firetable.utilities.getEmojiMap = function () {
  firetable.emojiMap = {};
  fetch(emojiDataUrl("map"), { credentials: "same-origin" })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (map) { firetable.emojiMap = map; })
    .catch(function (err) { console.error("Failed to load emoji data:", err); });
};

/**
 * The picker's data (js/emoji-picker.json: groups of [emoji, shortname,
 * search words]), fetched once and shared by the picker and the chat's
 * :emoji suggestions. Only members chat, so nobody else downloads it.
 * @returns {Promise<Array>}
 */
firetable.emojis.pickerData = function () {
  if (firetable.emojis.pickerDataReady) return firetable.emojis.pickerDataReady;
  firetable.emojis.pickerDataReady = fetch(emojiDataUrl("picker"), { credentials: "same-origin" })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .catch(function (err) {
      firetable.emojis.pickerDataReady = null; // try again next time
      throw err;
    });
  return firetable.emojis.pickerDataReady;
};

/**
 * Build the picker (category nav + emoji grid in #pickerNav / #pickerContents)
 * the first time it opens, from js/emoji-picker.json: only members chat, so
 * nobody else downloads it.
 * @returns {Promise<boolean>} whether the picker is built
 */
firetable.emojis.buildPicker = function () {
  if (firetable.emojis.pickerReady) return firetable.emojis.pickerReady;
  firetable.emojis.pickerReady = firetable.emojis.pickerData()
    .then(function (groups) {
      // The app shell is detached on the login screen, so look there too
      var findEl = function (id) {
        return document.getElementById(id) || (firetable.$appShell && firetable.$appShell.find('#' + id)[0]) || null;
      };
      var nav = findEl("pickerNav"), contents = findEl("pickerContents");
      if (!nav || !contents) throw new Error("no picker");
      // One nav button (its first emoji as the icon) and one section per group
      groups.forEach(function (group) {
        var list = group.emojis || [];
        if (!list.length) return;
        $('<span></span>').attr({ id: "bpicker" + group.slug, title: group.name }).text(list[0][0]).appendTo(nav);
        var $section = $('<div></div>').attr("id", "picker" + group.slug).append($('<h3></h3>').text(group.name));
        var frag = document.createDocumentFragment();
        list.forEach(function (item) {
          var el = document.createElement("span");
          el.setAttribute("role", "button");
          el.className = "pickerResult";
          el.title = item[1];
          el.setAttribute("data-alternative-name", item[2]);
          el.textContent = item[0];
          frag.appendChild(el);
        });
        $section[0].appendChild(frag);
        $section.appendTo(contents);
      });
      twemoji.parse(nav);
      return true;
    })
    .catch(function (err) {
      console.error("Failed to load the emoji picker:", err);
      firetable.emojis.pickerReady = null; // try again next time it opens
      return false;
    });
  return firetable.emojis.pickerReady;
};

// ─── :emoji suggestions while typing (CH-20) ────────────────────────────────

/** The suggestions' index, rebuilt when the map or the search words change. */
var emojiSuggestIndex = { map: null, words: null, names: [], keywords: [] };

/**
 * Keep the picker's search words (from firetable.emojis.pickerData) so
 * suggestions also find an emoji by what it means (:happy finds 😀).
 * @param {Array} groups - js/emoji-picker.json
 */
firetable.emojis.setSearchWords = function (groups) {
  var words = [];
  (groups || []).forEach(function (group) {
    (group.emojis || []).forEach(function (item) {
      if (item && item[0] && item[1]) words.push({ emoji: item[0], name: item[1], words: String(item[2] || "").toLowerCase().split(",") });
    });
  });
  firetable.emojis.searchWords = words;
};

function emojiSuggestTable() {
  var idx = emojiSuggestIndex, map = firetable.emojiMap || {}, words = firetable.emojis.searchWords || null;
  if (idx.map === map && idx.words === words) return idx;
  idx.map = map;
  idx.words = words;
  idx.names = Object.keys(map).map(function (name, i) {
    return { name: name, emoji: map[name], parts: name.split(/[_-]/), order: i };
  });
  // the site's own :rohn:
  idx.names.push({ name: "rohn", emoji: "", custom: "rohnmoji", parts: ["rohn"], order: idx.names.length });
  // search words, by the name the chat will understand for each emoji
  var byEmoji = {};
  idx.names.forEach(function (e) {
    var had = byEmoji[e.emoji];
    if (!had || e.name.length < had.length) byEmoji[e.emoji] = e.name;
  });
  idx.keywords = (words || []).map(function (w, i) {
    var name = map[w.name] === w.emoji ? w.name : byEmoji[w.emoji];
    return name ? { name: name, emoji: w.emoji, words: w.words, order: idx.names.length + i } : null;
  }).filter(Boolean);
  return idx;
}

/**
 * Emoji whose :shortname: (or search words, once loaded) match what's being
 * typed, best first: the exact name, names that start with it, names with a
 * word that starts with it, an exact search word, names that contain it, then
 * search words that start with it. Each emoji once, under its best name.
 * @param {string} query - What follows the colon (":cow" or "cow")
 * @param {number} [limit=10]
 * @returns {Array<{name: string, emoji: string, custom?: string}>}
 */
firetable.emojis.suggest = function (query, limit) {
  var q = String(query || "").toLowerCase().replace(/^:/, "");
  if (!q || !/^[a-z0-9_+-]+$/.test(q)) return [];
  limit = limit || 10;
  var idx = emojiSuggestTable(), best = {};
  // by rank; then names by length, search-word matches in the picker's order
  function cmp(a, b) {
    return a.rank - b.rank || (a.rank === 3 || a.rank === 5 ? 0 : a.name.length - b.name.length) || a.order - b.order;
  }
  function offer(key, name, emoji, custom, rank, order) {
    var e = { name: name, emoji: emoji, custom: custom, rank: rank, order: order };
    if (!best[key] || cmp(e, best[key]) < 0) best[key] = e;
  }
  idx.names.forEach(function (e) {
    var rank = e.name === q ? 0
      : e.name.indexOf(q) === 0 ? 1
      : e.parts.some(function (p) { return p.indexOf(q) === 0; }) ? 2
      : q.length > 2 && e.name.indexOf(q) > 0 ? 4 : -1;
    if (rank >= 0) offer(e.custom || e.emoji, e.name, e.emoji, e.custom, rank, e.order);
  });
  if (q.length > 1) idx.keywords.forEach(function (k) {
    var rank = k.words.indexOf(q) >= 0 ? 3
      : k.words.some(function (w) { return w.indexOf(q) === 0; }) ? 5 : -1;
    if (rank >= 0) offer(k.emoji, k.name, k.emoji, undefined, rank, k.order);
  });
  return Object.keys(best).map(function (k) { return best[k]; })
    .sort(cmp)
    .slice(0, limit)
    .map(function (e) { return e.custom ? { name: e.name, emoji: e.emoji, custom: e.custom } : { name: e.name, emoji: e.emoji }; });
};

/**
 * The :shortname being typed just before the caret, if any: a colon at the
 * start or after a space or bracket, then two or more name characters (so
 * times, links and :) don't count). Covers the rest of a name the caret is in.
 * @param {string} value - The chat box's text
 * @param {number} caret - The caret's position
 * @returns {?{start: number, end: number, query: string}}
 */
firetable.emojis.typedShortname = function (value, caret) {
  var before = String(value).slice(0, caret);
  var m = /(^|[\s(\[{"'])(:([a-z0-9_+-]{2,40}))$/i.exec(before);
  if (!m) return null;
  var after = /^[a-z0-9_+-]*:?/i.exec(String(value).slice(caret))[0];
  return { start: caret - m[2].length, end: caret + after.length, query: m[3].toLowerCase() };
};

/**
 * Replace :shortname: emoji codes in a string with unicode characters.
 * Special-cases the custom :rohn: emoji.
 * @param {string} str - Text containing :shortname: codes
 * @returns {string} Text with shortnames replaced by unicode or custom HTML
 */
/** :shortnames: to plain emoji characters, for text that isn't HTML (toasts). */
firetable.utilities.emojiShortnamesToText = function (str) {
  var map = firetable.emojiMap;
  return String(str).replace(/:([a-z0-9_+-]+):/gi, function (match, shortname) {
    return map && Object.prototype.hasOwnProperty.call(map, shortname) ? map[shortname] : match;
  });
};

firetable.utilities.emojiShortnamestoUnicode = function (str) {
  // HTML tags are matched first and passed through untouched, so a
  // shortname-like run inside an attribute (e.g. a URL) is never replaced.
  return str.replace(/(<[^>]*>)|:([a-z0-9_+-]+):/gi, function (match, tag, shortname) {
    if (tag) return tag;
    var map = firetable.emojiMap;
    if (map && Object.prototype.hasOwnProperty.call(map, shortname)) {
      return '<span title="' + match + '">' + map[shortname] + '</span>';
    } else if (shortname === "rohn") {
      return '<span class="rohnmoji" title=":rohn:"></span>';
    }
    return match; // unknown shortname — leave as-is
  });
};
