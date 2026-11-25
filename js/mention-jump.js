/**
 * mention-jump.js — an @mention, tapped, takes you to it in the room's chat.
 *
 * A push or desktop notification, or a row in the @ inbox, brings you to
 * Live with the chat in view (its own tab on phones), the message that
 * mentioned you scrolled into the middle of the chat and lit for a moment,
 * and that mention marked read. A message older than the chat has loaded
 * leaves you at the newest one.
 *
 * Loaded on first use (js/lazy.js has the stand-in, and reads a tapped
 * notification's address when the app opens with one).
 */

firetable.mentionJump = (function () {
  "use strict";
  var SAFE_ID = /^[\w-]{1,64}$/;
  var FLASH_MS = 2400;
  var WAIT_MS = 6000; // a cold start: how long the chat may take to load

  /** Live, not Discover, and not behind the full-screen player. */
  function goLive() {
    var d = firetable.discover;
    var state = d && d.state ? d.state() : null;
    if (state && state.full) d.closeFull();
    if (state && state.mode === "live") return;
    var tab = document.querySelector('#modeTabs [data-mode="live"]') || document.querySelector('#nav-tabs [data-tab="live"]');
    if (tab) tab.click();
  }

  /** The chat on screen; resolves once it can be scrolled (phones fade it in). */
  function showChat() {
    var chat = document.getElementById("actualChat");
    if (!chat || chat.getClientRects().length) return Promise.resolve();
    firetable.nav.setMobileTab("mmchat");
    return new Promise(function (resolve) { setTimeout(resolve, firetable.nav._fadeMs * 2 + 50); });
  }

  /** The message's line in the chat (a follow-on line has its own id), or null. */
  function lineFor(id) {
    return SAFE_ID.test(id || "") ? document.getElementById("chattxt" + id) || document.getElementById("chat" + id) : null;
  }

  /** Wait (a cold start) for the message to be in the chat. */
  function whenLine(id) {
    var t = Date.now();
    return new Promise(function (resolve) {
      (function look() {
        var line = lineFor(id);
        if (line || !id || Date.now() - t > WAIT_MS || (firetable._chatBooted && Date.now() - t > 600)) return resolve(line);
        setTimeout(look, 150);
      })();
    });
  }

  /** Scroll the chat to the line (unpinned, so new messages don't pull it away) and light it. */
  function reveal(line) {
    var wrap = chatScroll && chatScroll.contentWrapperEl;
    if (!line || !wrap) return firetable.utilities.scrollToBottom();
    var at = line.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
    chatPinned = false;
    wrap.scrollTop = Math.max(0, at - (wrap.clientHeight - line.offsetHeight) / 2);
    if (firetable.utilities.chatDistanceFromBottom() > 25) document.getElementById("morechats").classList.add("show");
    else chatPinned = true;
    line.classList.remove("mentionFlash");
    void line.offsetWidth; // start the light again on a second tap
    line.classList.add("mentionFlash");
    setTimeout(function () { line.classList.remove("mentionFlash"); }, FLASH_MS);
  }

  /** That mention read (the inbox's badge counts it no more). */
  function markRead(id) {
    var items = (firetable.inbox && firetable.inbox.items) || [];
    if (!ftapi.uid || !items.some(function (m) { return m.id === id && !m.read; })) return;
    ftapi.db().ref("mentions/" + ftapi.uid + "/" + id + "/read").set(true).catch(function () {});
  }

  /**
   * Go to a mention in the room's chat.
   * @param {string} [id] - the chat message's id (no id: the newest message)
   * @returns {Promise}
   */
  function show(id) {
    var pop = document.getElementById("inboxPopover");
    if (pop && pop.matches(":popover-open")) pop.hidePopover();
    goLive();
    if (id) markRead(id);
    return showChat().then(function () { return whenLine(id); }).then(reveal);
  }

  // (resume is the stand-in's, for an app opened by a notification: done by now)
  return { show: show, lineFor: lineFor, resume: function () {} };
})();
