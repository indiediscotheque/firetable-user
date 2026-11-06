/**
 * emoji.js — Emoji picker, search, and shortname-to-unicode conversion.
 *
 * Loads emoji data (Emoji 17.0) from unpkg CDN (unicode-emoji-json + emojilib),
 * builds the picker DOM, and converts :shortname: strings to unicode
 * characters in chat messages.
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
 * Fetch emoji data from CDN and build:
 * 1. firetable.emojiMap — shortname → unicode lookup
 * 2. Picker DOM — category nav + emoji grid in #pickerNav / #pickerContents
 */
firetable.utilities.getEmojiMap = function () {
  firetable.emojiMap = {};
  (async function () {
    try {
      var requests = EMOJI_URLS.map(function (src) {
        return fetch(src.url, { integrity: src.integrity, mode: "cors", credentials: "omit" });
      });
      var responses = await Promise.all(requests);
      var promises = responses.map(function (response) { return response.json(); });
      var data = await Promise.all(promises);

      var groups = data[0], oldLib = data[1], keywords = data[2];

      // emojilib v2: emoji char -> its old shortname
      var oldmojis = {};
      Object.keys(oldLib).forEach(function (oldSlug) { oldmojis[oldLib[oldSlug].char] = oldSlug; });

      // The app shell is detached on the login screen, so look there too
      var findEl = function (id) {
        return document.getElementById(id) || (firetable.$appShell && firetable.$appShell.find('#' + id)[0]) || null;
      };
      var $nav = $(findEl("pickerNav"));
      var $contents = $(findEl("pickerContents"));

      // One nav button (its first emoji as the icon) and one section per group
      groups.forEach(function (group) {
        var list = group.emojis || [];
        if (!list.length) return;
        $('<span></span>').attr({ id: "bpicker" + group.slug, title: group.name }).text(list[0].emoji).appendTo($nav);
        var $section = $('<div></div>').attr("id", "picker" + group.slug).append($('<h3></h3>').text(group.name));
        var frag = document.createDocumentFragment();
        list.forEach(function (item) {
          firetable.emojiMap[item.slug] = item.emoji;
          var words = (keywords[item.emoji] || []).slice();
          if (oldmojis[item.emoji]) words.push(oldmojis[item.emoji]);
          var el = document.createElement("span");
          el.setAttribute("role", "button");
          el.className = "pickerResult";
          el.title = item.slug;
          el.setAttribute("data-alternative-name", words.join(","));
          el.textContent = item.emoji;
          frag.appendChild(el);
        });
        $section[0].appendChild(frag);
        $section.appendTo($contents);
      });

      // Old emojilib v2 shortnames (:smile:, :+1:) and names Unicode has since changed
      Object.keys(oldmojis).forEach(function (emoji) { firetable.emojiMap[oldmojis[emoji]] = emoji; });
      Object.keys(EMOJI_RENAMED).forEach(function (oldName) {
        var now = firetable.emojiMap[EMOJI_RENAMED[oldName]];
        if (now && !Object.prototype.hasOwnProperty.call(firetable.emojiMap, oldName)) firetable.emojiMap[oldName] = now;
      });
      if ($nav[0]) twemoji.parse($nav[0]);
    } catch (err) {
      console.error("Failed to load emoji data:", err);
    }
  })();
};

/**
 * Replace :shortname: emoji codes in a string with unicode characters.
 * Special-cases the custom :rohn: emoji.
 * @param {string} str - Text containing :shortname: codes
 * @returns {string} Text with shortnames replaced by unicode or custom HTML
 */
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
