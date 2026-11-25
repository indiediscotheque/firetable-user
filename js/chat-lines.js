/**
 * chat-lines.js — what a chat line gets besides its words.
 *
 * - A heading between two days ("Yesterday", "Today", "Monday, Nov 23"):
 *   the chat keeps its last messages whatever their age, and a time alone
 *   ("11:40pm", then "6:18pm") read as one evening.
 * - A flame before the bot's line that someone fired the song, the mark
 *   the people list gives whoever fired it.
 * - A command typed to the bot ("!skip") set as quietly as the bot's own
 *   lines: it isn't talk.
 * - The DANCE button under the bot's gift line.
 *
 * chat.js draws the message and calls these; the styles are in looks.css
 * (.ch-day, .ch-fire, .ch-cmd).
 */
firetable.chatLines = (function () {
  var FIRE_RE = /\bthinks this track is h0t\b/i;   // the bot's words for a fire (hostbot app.js)
  var CMD_RE = /^![a-z][\w-]*(\s|$)/i;              // "!skip", "!plays daft punk"
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var watching = false;

  /** An element of the page, or of the members' part while it's set aside for the sign-in screen (users.js). */
  function byId(id) {
    return document.getElementById(id) || (firetable.$appShell && firetable.$appShell.find("#" + id)[0]) || null;
  }

  /** Midnight at the start of a time's day, on this device's clock. */
  function dayOf(time) {
    var d = new Date(+time);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** "Today", "Yesterday", or the weekday and date ("Monday, Nov 23"). */
  function dayLabel(time, now) {
    var day = dayOf(time), today = dayOf(now === undefined ? Date.now() : now);
    if (day === today) return "Today";
    if (day === dayOf(today - 1)) return "Yesterday";
    return DAYS[new Date(day).getDay()] + ", " + firetable.utilities.shortDate(day);
  }

  /** The time of the last message drawn (song announcements carry none), or null in an empty chat. */
  function lastTime(chats) {
    for (var el = chats.lastElementChild; el; el = el.previousElementSibling) {
      var t = el.querySelector(".chatTime[data-time]");
      if (t) return +t.getAttribute("data-time");
    }
    return null;
  }

  /** Midnight passes, or the page comes back the next morning: "Today" is "Yesterday" now. */
  function relabel() {
    var chats = byId("chats");
    if (!chats) return;
    Array.prototype.forEach.call(chats.querySelectorAll(".ch-day[data-day]"), function (el) {
      var label = dayLabel(+el.getAttribute("data-day"));
      if (el.firstChild.textContent !== label) el.firstChild.textContent = label;
    });
  }

  /**
   * Before a message is drawn: when it's from another day than the one
   * above it, a heading for its day goes in first, and the message starts a
   * block of its own. A chat that begins today needs none.
   * @param {number} time - the message's time
   * @returns {boolean} whether a heading went in
   */
  function day(time) {
    var chats = byId("chats");
    if (!chats || !time) return false;
    var last = lastTime(chats);
    var isNew = last === null ? dayOf(time) !== dayOf(Date.now()) : dayOf(time) !== dayOf(last);
    if (!isNew) return false;
    var el = document.createElement("div");
    el.className = "ch-day";
    el.setAttribute("role", "separator");
    el.setAttribute("data-day", dayOf(time));
    el.appendChild(document.createElement("span")).textContent = dayLabel(time);
    chats.appendChild(el);
    firetable.lastChatPerson = false;
    firetable.lastChatId = false;
    relabel();
    if (!watching) {
      watching = true;
      document.addEventListener("visibilitychange", function () { if (!document.hidden) relabel(); });
    }
    return true;
  }

  /** The bot's line (by its account, or by its name on a line from before it was here). */
  function fromBot(chatData) {
    var u = ftapi.users && ftapi.users[chatData.id];
    return !!(u && u.hostbot) || String(chatData.name || "").toLowerCase() === "jarvis";
  }

  /** The bot gifting a dance: its line gets the DANCE button. */
  function danceButton(el) {
    if (el.querySelector(".chat-dance-wrap")) return;
    el.insertAdjacentHTML("beforeend", '<div class="chat-dance-wrap">' +
      '<button type="button" class="butt chat-dance-btn" aria-pressed="false">DANCE</button></div>');
    firetable.actions.syncDanceCtaButtons();
  }

  /**
   * After a message's line is drawn: what kind of line it is.
   * @param {Element} el - its .chatText
   * @param {Object} chatData - the message
   */
  function mark(el, chatData) {
    if (!el || chatData.hidden) return;
    var txt = firetable.ui.strip(chatData.txt || "");
    if (fromBot(chatData)) {
      if (FIRE_RE.test(txt)) el.classList.add("ch-fire");
      if (/\bgift(?:ed|ing)?\b/i.test(txt) && /\bdance\b/i.test(txt)) danceButton(el);
    } else if (CMD_RE.test(txt.trim())) {
      el.classList.add("ch-cmd");
    }
  }

  return { day: day, mark: mark, dayLabel: dayLabel, relabel: relabel };
})();
