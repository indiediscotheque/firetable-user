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
    $(".pickerResult").show();
    $("#pickerResults h3").show();
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
    if (val.length === 0) {
      firetable.emojis.h();
      return;
    }
    // Hide headers during filtered search
    if ($("#pickerResults h3").is(":visible")) {
      $("#pickerResults h3").hide();
    }
    val = val.toLowerCase();
    $(".pickerResult").each(function (i, el) {
      if (firetable.emojis.n($(el), val)) {
        $(el).show();
      } else {
        $(el).hide();
      }
    });
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
 * Build the picker (category nav + emoji grid in #pickerNav / #pickerContents)
 * the first time it opens, from js/emoji-picker.json: only members chat, so
 * nobody else downloads it.
 * @returns {Promise<boolean>} whether the picker is built
 */
firetable.emojis.buildPicker = function () {
  if (firetable.emojis.pickerReady) return firetable.emojis.pickerReady;
  firetable.emojis.pickerReady = fetch(emojiDataUrl("picker"), { credentials: "same-origin" })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
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
