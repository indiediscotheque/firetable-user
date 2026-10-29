/**
 * chat.js — Chat message rendering, slash commands, and @-mention keyboard UI.
 *
 * Handles:
 * - Rendering incoming chat messages (newChat event)
 * - Grouping consecutive messages from the same user
 * - Inline image rendering (when setting is enabled)
 * - Text → link conversion
 * - Emoji shortname conversion + twemoji parsing
 * - Mod delete button on messages
 * - Slash commands (/mod, /block, /shrug, /tableflip, etc.)
 * - @-mention autocomplete keyboard navigation
 * - Chat removal (chatRemoved event)
 */

firetable.actions = firetable.actions || {};

firetable.actions.syncDanceCtaButtons = function () {
  var deckEl = document.getElementById('deck');
  var danceOn = document.body.classList.contains('dance-mode') || !!(deckEl && deckEl.classList.contains('dance'));
  $('.chat-dance-btn')
    .toggleClass('is-pressed', danceOn)
    .attr('aria-pressed', danceOn ? 'true' : 'false')
    .prop('disabled', danceOn);
};

firetable.actions.syncFireReactionButtons = function () {
  var userHasFire = !!(ftapi.uid && firetable.fireReactors && firetable.fireReactors[ftapi.uid]);
  $("#fire").toggleClass("on", userHasFire);
  if (userHasFire) {
    $("#cloud_with_rain").removeClass("on");
  }
};

firetable.actions.updateFireReactionDisplay = function () {
  if (!firetable.song) return;

  var count = firetable.fireCount || 0;
  var $fires = $(".npmsg" + firetable.song.cid).last().find(".npmsg-fires");

  firetable.actions.syncFireReactionButtons();

  if (!count) {
    if ($fires.length) {
      $fires.text("").removeAttr("style");
    }
    if (typeof window.firetableSetFyreIntensity === "function") {
      window.firetableSetFyreIntensity(0);
    }
    return;
  }

  var size = Math.min(10 + ((count - 1) * 5), 46);
  if ($fires.length) {
    $fires.text("🔥").css("font-size", size + "px");
  }

  if (typeof window.firetableIgniteFyre === "function") {
    window.firetableIgniteFyre(count);
  }
};

/** Is this chat text a 🔥 / 🌧 reaction? */
firetable.actions.isReactionText = function (txt) {
  return txt === ":fire:" || txt === "🔥" || txt === ":cloud_with_rain:" || txt === "🌧" || txt === ":fire_off:";
};

/**
 * Send a 🔥 / 🌧 reaction stamped with the song it's for, so one sent just
 * before a song ends doesn't count towards the next song (#90).
 * @param {string} txt
 */
firetable.actions.sendReaction = function (txt) {
  var started = firetable.song && firetable.song.cid != 0 && firetable.song.started;
  ftapi.actions.sendChat(txt, null, started ? { forSong: started } : null);
};

firetable.actions.processFireReactionMessage = function (chatData) {
  var rawTxt = firetable.ui.strip(chatData.txt || "");
  var isFire = rawTxt === ":fire:" || rawTxt === "🔥";
  var isFireOff = rawTxt === ":fire_off:";
  var isRain = rawTxt === ":cloud_with_rain:" || rawTxt === "🌧";

  if (!isFire && !isFireOff && !isRain) return false;

  if (!firetable.song || !firetable.song.started) {
    firetable.pendingFireReactions.push(chatData);
    return true;
  }

  if (chatData.time < firetable.song.started) {
    return true;
  }
  // Sent for another song (it arrived after the song changed)
  if (chatData.forSong && chatData.forSong !== firetable.song.started) {
    return true;
  }

  if (isRain) {
    if (firetable.fireReactors[chatData.id]) {
      delete firetable.fireReactors[chatData.id];
      firetable.fireCount = Math.max(0, firetable.fireCount - 1);
      firetable.actions.updateFireReactionDisplay();
    } else {
      firetable.actions.syncFireReactionButtons();
    }
    if (chatData.id === ftapi.uid) {
      $("#cloud_with_rain").addClass("on");
      $("#fire").removeClass("on");
    }
    return true;
  }

  if (isFireOff) {
    if (firetable.fireReactors[chatData.id]) {
      delete firetable.fireReactors[chatData.id];
      firetable.fireCount = Math.max(0, firetable.fireCount - 1);
      firetable.actions.updateFireReactionDisplay();
    } else {
      firetable.actions.syncFireReactionButtons();
    }
    return true;
  }

  if (!firetable.fireReactors[chatData.id]) {
    firetable.fireReactors[chatData.id] = true;
    firetable.fireCount += 1;
    firetable.actions.updateFireReactionDisplay();
  } else {
    firetable.actions.syncFireReactionButtons();
  }
  return true;
};

firetable.actions.replayPendingFireReactions = function () {
  if (!firetable.song || !firetable.pendingFireReactions.length) return;

  var pending = firetable.pendingFireReactions.slice().sort(function (a, b) {
    return (a.time || 0) - (b.time || 0);
  });
  firetable.pendingFireReactions = [];

  pending.forEach(function (chatData) {
    firetable.actions.processFireReactionMessage(chatData);
  });
};

/**
 * Display a local-only response in chat (not sent to server).
 * Used for command feedback like block/unblock confirmations.
 * @param {string} txt - Message text
 */
firetable.actions.localChatResponse = function (txt) {
  if (txt.length) {
    if (!firetable._chatBooted) {
      firetable._chatBooted = true;
      var skels = document.querySelectorAll('#chats .ft-skeleton');
      for (var i = 0; i < skels.length; i++) skels[i].remove();
    }
    $("#chats").append($('<div class="newChat"><div class="lcrsp"></div></div>').find('.lcrsp').text(txt).end());
    firetable.utilities.scrollToBottom();
  }
};

// ─── Typing indicator (#33) ──────────────────────────────────────────────────
// typing/<uid> = {name, at}: written while you type (at most every 3 s),
// removed when you send, clear the box, leave it, go quiet for 5 s or
// disconnect. Entries older than 8 s are ignored, so a crashed tab can't
// leave someone "typing" forever.

firetable.typing = { others: {}, active: false, last: 0, idle: null };

/** Tell the room you're typing (or that you stopped). */
firetable.actions.setTyping = function (on) {
  var t = firetable.typing;
  if (!ftapi.uid) return;
  var ref = ftapi.db().ref('typing/' + ftapi.uid);
  clearTimeout(t.idle);
  if (!on || !firetable.shareTyping) {
    if (t.active) {
      t.active = false;
      ref.remove().catch(function () { /* rules not deployed yet */ });
    }
    return;
  }
  var now = Date.now();
  if (!t.active || now - t.last > 3000) {
    t.active = true;
    t.last = now;
    ref.onDisconnect().remove();
    ref.set({ name: ftapi.uname, at: firebase.database.ServerValue.TIMESTAMP })
      .catch(function () { t.active = false; });
  }
  t.idle = setTimeout(function () { firetable.actions.setTyping(false); }, 5000);
};

/** "alice is typing…" under the chat, from typing/ (fresh entries only). */
firetable.ui.renderTyping = function () {
  var names = [];
  var others = firetable.typing.others || {};
  for (var uid in others) {
    if (!others.hasOwnProperty(uid) || uid === ftapi.uid) continue;
    if (ftapi.blockedUsers && ftapi.blockedUsers[uid]) continue;
    var e = others[uid];
    if (!e || !e.name || ftapi.now() - Number(e.at || 0) > 8000) continue;
    names.push(String(e.name));
  }
  var $el = $('#typingIndicator');
  if (!names.length) { $el.removeClass('show').empty(); return; }
  var text = names.length === 1 ? names[0] + ' is typing'
    : names.length === 2 ? names[0] + ' and ' + names[1] + ' are typing'
    : names.length + ' people are typing';
  $el.empty().addClass('show')
    .append($('<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>'))
    .append($('<span class="typing-text"></span>').text(text));
};

// ─── Emoji reactions on chat messages (#51) ─────────────────────────────────
// chatData/<id>/reactions/<emoji>/<uid> = true. Each message on screen
// listens to its own reactions; the listener goes when the message does.

var CHAT_REACTIONS = [
  ["thumbsup", "👍"], ["heart", "❤️"], ["joy", "😂"], ["fire", "🔥"],
  ["open_mouth", "😮"], ["cry", "😢"], ["clap", "👏"], ["raised_hands", "🙌"]
];
firetable.reactionListeners = {};

/** The emoji for a reaction key (our set, then the emoji map, else :key:). */
firetable.utilities.reactionEmoji = function (key) {
  for (var i = 0; i < CHAT_REACTIONS.length; i++) if (CHAT_REACTIONS[i][0] === key) return CHAT_REACTIONS[i][1];
  var map = firetable.emojiMap;
  return (map && Object.prototype.hasOwnProperty.call(map, key)) ? map[key] : ":" + key + ":";
};

/** Add or remove your reaction. */
firetable.actions.toggleReaction = function (chatID, key) {
  if (!ftapi.uid || !chatID || !/^[a-z0-9_+-]{1,40}$/.test(key)) return;
  var ref = ftapi.db().ref("chatData/" + chatID + "/reactions/" + key + "/" + ftapi.uid);
  var mine = $("#reactions" + chatID + ' .reactChip[data-key="' + key + '"]').hasClass("mine");
  (mine ? ref.remove() : ref.set(true)).catch(function () {
    firetable.ui.toast("Reactions aren't available yet.", "error");
  });
};

/** Draw the reaction chips under a message. */
firetable.ui.renderReactions = function (chatID, reactions) {
  var $bar = $("#reactions" + chatID);
  if (!$bar.length) return;
  $bar.empty();
  var keys = Object.keys(reactions || {}).filter(function (k) {
    return reactions[k] && Object.keys(reactions[k]).length;
  });
  keys.forEach(function (key) {
    var uids = Object.keys(reactions[key]);
    var names = uids.map(function (u) {
      return (ftapi.users[u] && ftapi.users[u].username) || (u === ftapi.uid ? ftapi.uname : null);
    }).filter(Boolean);
    var label = (names.length ? names.join(", ") : firetable.utilities.pluralize(uids.length, "person", "people")) + " reacted";
    var $chip = $('<button type="button" class="reactChip"></button>')
      .attr({ "data-key": key, title: label, "aria-label": label + " with " + key.replace(/_/g, " ") })
      .toggleClass("mine", uids.indexOf(ftapi.uid) !== -1)
      .append($('<span class="reactEmoji"></span>').text(firetable.utilities.reactionEmoji(key)))
      .append($('<span class="reactCount"></span>').text(uids.length));
    $bar.append($chip);
  });
  $bar.toggleClass("has-reactions", keys.length > 0);
  if (keys.length && typeof twemoji !== "undefined") twemoji.parse($bar[0]);
};

/** Start listening to a message's reactions (once). */
firetable.actions.watchReactions = function (chatID) {
  if (!chatID || firetable.reactionListeners[chatID]) return;
  var ref = ftapi.db().ref("chatData/" + chatID + "/reactions");
  var fn = ref.on("value", function (snap) {
    firetable.ui.renderReactions(chatID, snap.val());
  }, function () { /* not readable (blocked) or rules not deployed */ });
  firetable.reactionListeners[chatID] = { ref: ref, fn: fn };
};

/** Stop listening for messages that left the chat. */
firetable.actions.unwatchReactions = function (chatID) {
  var l = firetable.reactionListeners[chatID];
  if (!l) return;
  l.ref.off("value", l.fn);
  delete firetable.reactionListeners[chatID];
};

// ─── Text Processing Helpers ─────────────────────────────────────────────────

firetable.ui = firetable.ui || {};

/**
 * Convert URLs in plain text to clickable <a> links. All other text is
 * HTML-escaped, so the result is safe to insert as HTML.
 * @param {string} text - Raw plain text
 * @param {boolean} [themeBox=false] - unused, kept for API compat
 * @returns {string} Escaped HTML with URLs wrapped in anchor tags
 */
firetable.ui.textToLinks = function (text, themeBox) {
  // Without linkify, still escape: callers insert the result as HTML.
  if (typeof linkifyStr !== 'function') return firetable.utilities.htmlEscape(text);
  return linkifyStr(text, {
    target: '_blank',
    rel: 'noopener noreferrer',
    attributes: { tabindex: '-1' }
  });
};

/**
 * Upgrade image links in linkified HTML to inline <img> embeds (when the
 * "Show images" setting is on). Only anchors made by textToLinks() are
 * matched; the href is re-validated with imageLinkUrl() and escaped again.
 * Auto-scrolls chat if the user was already at the bottom when the image loads.
 * @param {string} chatTxt - HTML from textToLinks()
 * @returns {string}
 */
firetable.ui.showImages = function (chatTxt) {
  if (!firetable.showImages) return chatTxt;

  return chatTxt.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>[^<]*<\/a>/gi, function (anchor, href) {
    var decoded = firetable.parser
      ? firetable.parser.parseFromString(href, 'text/html').body.textContent
      : href;
    var imageUrl = firetable.utilities.imageLinkUrl(decoded);
    if (!imageUrl) return anchor;
    var safeUrl = firetable.utilities.htmlEscape(imageUrl);
    // load/error are handled by the listeners below (no inline handlers)
    return '<a class="inlineImgLink" href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" tabindex="-1">' +
           '<img src="' + safeUrl + '" class="inlineImage" alt="" />' +
           '<span role="button" class="hideImage">&times;</span></a>';
  });
};

// Inline chat images: keep the chat pinned to the bottom when one loads while
// the user is already there, and hide ones that fail. load/error don't
// bubble, so these listen in the capture phase.
document.addEventListener('load', function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('inlineImage') &&
      firetable.utilities.isChatPrettyMuchAtBottom()) {
    firetable.utilities.scrollToBottom();
  }
}, true);
document.addEventListener('error', function (e) {
  var link = e.target && e.target.classList && e.target.classList.contains('inlineImage') &&
    e.target.closest('.inlineImgLink');
  if (link) link.style.display = 'none';
}, true);

/**
 * Strip HTML from a string using DOMParser.
 * @param {string} html - Raw HTML string
 * @returns {string} Plain text content
 */
firetable.ui.strip = function (html) {
  var doc = firetable.parser.parseFromString(html, 'text/html');
  return doc.body.textContent || "";
};

/**
 * Process raw chat text into safe HTML:
 * strip HTML → set aside code spans → escape + linkify → set aside links →
 * inline markdown → emoji → put links (or inline images) back → newlines → code.
 * Markdown runs after escaping so its tags aren't escaped away, and links are
 * set aside so markdown or emoji never touch a URL.
 * @param {string} rawTxt - Unprocessed chat text
 * @returns {string} Formatted HTML string safe for insertion
 */
firetable.ui.formatChatText = function (rawTxt) {
  // \x01 and \x02 are reserved as placeholder markers below
  var txt = firetable.ui.strip(rawTxt).replace(/[\x01\x02]/g, '');

  // Inline code spans: content is escaped and immune to markdown, links, emoji.
  // strip() decodes entities (e.g. "&lt;" -> "<"), so escaping here matters.
  var codeSpans = [];
  txt = txt.replace(/`([^`\n]+)`/g, function (_, inner) {
    codeSpans.push('<code>' + firetable.utilities.htmlEscape(inner) + '</code>');
    // Spaces keep linkify from treating the marker as part of a URL
    return ' \x01' + (codeSpans.length - 1) + '\x01 ';
  });

  // Escape everything and wrap URLs in <a> tags
  txt = firetable.ui.textToLinks(txt);

  // Set links aside so markdown and emoji can't change them
  var links = [];
  txt = txt.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, function (anchor) {
    links.push(anchor);
    return '\x02' + (links.length - 1) + '\x02';
  });

  // Inline markdown on escaped text — bold before italic so ** is consumed first
  txt = txt.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  txt = txt.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  txt = txt.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

  txt = firetable.utilities.emojiShortnamestoUnicode(txt);

  // Restore links, upgrading image links when "Show images" is on
  txt = txt.replace(/\x02(\d+)\x02/g, function (_, i) {
    return firetable.ui.showImages(links[parseInt(i, 10)]);
  });

  // Newlines → <br> (for bot/system messages)
  txt = txt.replace(/\n/g, '<br>');

  // Restore code spans (dropping the spaces added around the markers)
  txt = txt.replace(/ ?\x01(\d+)\x01 ?/g, function (_, i) {
    return codeSpans[parseInt(i, 10)];
  });

  return txt;
};

// ─── Chat Event Binding ──────────────────────────────────────────────────────

/**
 * Set up all chat-related ftapi event listeners and keyboard handlers.
 * Called once from firetable.ui.init().
 */
firetable.ui.setupChatEvents = function () {
  var $chatTemplate = $('#chatKEY').remove();

  function isJarvisGiftDanceMessage(chatData) {
    var fromHostbot = !!(ftapi.users[chatData.id] && ftapi.users[chatData.id].hostbot);
    var senderName = (chatData.name || '').toLowerCase();
    var fromJarvisName = senderName === 'jarvis';
    if (!fromHostbot && !fromJarvisName) return false;

    var rawTxt = firetable.ui.strip(chatData.txt || '');
    var mentionsGift = /\bgift(?:ed|ing)?\b/i.test(rawTxt);
    var mentionsDance = /!dance\b/i.test(rawTxt) || /\bdance\b/i.test(rawTxt);
    return mentionsGift && mentionsDance;
  }

  function appendDanceCta($chatText) {
    if (!$chatText || !$chatText.length) return;
    if ($chatText.find('.chat-dance-wrap').length) return;
    $chatText.append(
      '<div class="chat-dance-wrap">' +
      '<button type="button" class="butt chat-dance-btn" aria-pressed="false">DANCE</button>' +
      '</div>'
    );
    firetable.actions.syncDanceCtaButtons();
  }

  // ── Chat Collapse: hide messages longer than 7 lines behind "show more" ──
  function maybeCollapseChat(el) {
    if (!el) return;
    var $el = $(el);
    var brCount = ($el.html().match(/<br>/gi) || []).length;
    if (brCount < 7) return;
    $el.addClass('is-collapsed');
    var $btn = $('<button class="chat-expand-btn" type="button">show more</button>');
    $btn.insertAfter($el);
    $btn.on('click', function () {
      var collapsed = $el.hasClass('is-collapsed');
      $el.toggleClass('is-collapsed', !collapsed);
      $btn.text(collapsed ? 'show less' : 'show more');
    });
  }

  // ── Incoming Chat Messages ──
  ftapi.events.on("newChat", function (chatData) {
    if (chatData.botCmd) return;

    if (firetable.actions.processFireReactionMessage(chatData)) {
      return;
    }

    var namebo = chatData.id;
    var utitle = "";
    var atBottom = firetable.utilities.isChatPrettyMuchAtBottom();

    // Resolve current user's display name for @-mention detection
    var you = ftapi.uid;
    if (ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].username) {
      you = ftapi.users[ftapi.uid].username;
    }

    // Resolve sender's display name and role
    if (ftapi.users[chatData.id]) {
      if (ftapi.users[chatData.id].username) namebo = ftapi.users[chatData.id].username;
      if (ftapi.users[chatData.id].mod) utitle = "shield";
      if (ftapi.users[chatData.id].supermod) utitle = "local_police";
      if (ftapi.users[chatData.id].hostbot) utitle = "smart_toy";
    } else if (chatData.name) {
      namebo = chatData.name;
    }

    // ── @-mention detection ──
    // Mention styling should apply even for older messages loaded from history,
    // but sound/desktop alerts should only fire for recent messages.
    // "@name" must be the whole name (@bob isn't @bobby); any case.
    // Only mods, supermods and the bot can ping the whole room with @everyone.
    var nameRe = new RegExp("@" + String(you).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_])", "i");
    var sender = ftapi.users[chatData.id] || {};
    var canPingAll = !!(sender.mod || sender.supermod || sender.hostbot);
    var hasMention = nameRe.test(chatData.txt || "") ||
      (canPingAll && /@everyone(?![A-Za-z0-9_])/i.test(chatData.txt || ""));
    if (hasMention) {
      var timeSinceMessage = ftapi.now() - chatData.time;
      if (timeSinceMessage < 10 * 1000) {
        firetable.utilities.playSound("sound");
        if (firetable.desktopNotifyMentions) {
          firetable.utilities.desktopNotify(chatData, namebo);
        }
      }
    }

    // ── Check if we can delete this message (mod powers) ──
    var canDelete = function () {
      try {
        if (!ftapi.users[ftapi.uid].mod && !ftapi.users[ftapi.uid].supermod) return false;
        if (ftapi.users[chatData.id]) {
          if (ftapi.users[chatData.id].mod || ftapi.users[chatData.id].supermod) return false;
        }
        return !chatData.hidden;
      } catch (e) {
        return false;
      }
    };

    // Format the message text
    var txtOut = firetable.ui.formatChatText(chatData.txt);
    if (chatData.hidden) txtOut = "[message removed]";

    if (chatData.id === firetable.lastChatPerson && !hasMention) {
      // ── Group with previous message from same user ──
      $("#chat" + firetable.lastChatId + " .chatContent").append(
        '<div id="chattxt' + chatData.chatID + '" class="chatText"></div>'
      );
      $("#chatTime" + firetable.lastChatId).text(firetable.utilities.format_time(chatData.time)).attr('data-time', chatData.time);
      $("#chattxt" + chatData.chatID).html(txtOut);
      $('<div class="chatReactions"></div>').attr('id', 'reactions' + chatData.chatID).insertAfter("#chattxt" + chatData.chatID);

      if (canDelete()) {
        $("#chattxt" + chatData.chatID).addClass("deleteMe");
        $("#chattxt" + chatData.chatID).append('<button type="button" class="modDelete" aria-label="Delete message">&times;</button>');
        $("#chattxt" + chatData.chatID).find(".modDelete").on('click', function () {
          ftapi.actions.deleteChat(chatData.feedID);
        });
      }
      twemoji.parse(document.getElementById("chattxt" + chatData.chatID));
      maybeCollapseChat(document.getElementById("chattxt" + chatData.chatID));
      if (isJarvisGiftDanceMessage(chatData)) {
        appendDanceCta($("#chattxt" + chatData.chatID));
      }

    } else {
      // ── New message block (different user or @-mention break) ──
      var $chatthing = $chatTemplate.clone();
      $chatthing.attr('id', "chat" + chatData.chatID);
      $chatthing.find('.ft-avatar').css(
        'background-image',
        "url(" + firetable.utilities.avatarURL(chatData.id, namebo) + ")"
      );
      $chatthing.find('.utitle').html(utitle);
      $chatthing.find('.chatTime')
        .attr('id', "chatTime" + chatData.chatID)
        .attr('data-time', chatData.time)
        .html(firetable.utilities.format_time(chatData.time));
      if (hasMention) $chatthing.addClass('badoop');

      $chatthing.find(".chatText").html(txtOut).attr('id', "chattxt" + chatData.chatID);
      $('<div class="chatReactions"></div>').attr('id', 'reactions' + chatData.chatID).insertAfter($chatthing.find(".chatText"));
      $chatthing.find(".chatName").text(namebo);

      // Click-to-@ on avatar and name
      firetable.utilities.chatAt($chatthing.find('.ft-avatar'));
      firetable.utilities.chatAt($chatthing.find('.chatName'));
      twemoji.parse($chatthing.find(".chatText")[0]);
      $chatthing.appendTo("#chats");
      if (!firetable._chatBooted) {
        firetable._chatBooted = true;
        document.querySelectorAll('#chats .ft-skeleton').forEach(function(el) { el.remove(); });
      }
      maybeCollapseChat($chatthing.find('.chatText')[0]);
      if (isJarvisGiftDanceMessage(chatData)) {
        appendDanceCta($chatthing.find('.chatText'));
      }

      if (canDelete()) {
        $chatthing.find(".chatText").addClass("deleteMe");
        $chatthing.find(".chatText").append('<button type="button" class="modDelete" aria-label="Delete message">&times;</button>');
        $chatthing.find(".modDelete").on('click', function () {
          ftapi.actions.deleteChat(chatData.feedID);
        });
      }

      firetable.lastChatPerson = chatData.id;
      firetable.lastChatId = chatData.chatID;
    }

    // ── Inline card rendering ──
    if (chatData.card) {
      $("#chattxt" + chatData.chatID).append(
        '<canvas width="225" height="300" class="chatCard" id="cardMaker' + chatData.chatID + '"' +
        ' role="button" tabindex="0" aria-label="View card larger" title="View larger"></canvas>'
      );
      firetable.actions.showCard(chatData.card, chatData.chatID);
    }

    // Reactions (not on removed messages)
    var $txt = $("#chattxt" + chatData.chatID);
    if (!chatData.hidden && ftapi.uid) {
      $txt.attr('data-chat', chatData.chatID).append('<button type="button" class="reactAdd material-symbols-outlined" title="Add reaction" aria-label="Add reaction" aria-haspopup="menu">add_reaction</button>');
      firetable.actions.watchReactions(chatData.chatID);
    }

    // Auto-scroll if user was at bottom or is the sender
    if (atBottom || ftapi.uid === chatData.id) {
      firetable.utilities.scrollToBottom();
    }

    // ── Chat pruning: remove oldest messages to prevent unbounded DOM growth ──
    // Canvases (card shares), avatar background-images, and twemoji nodes all
    // hold memory that never gets freed without this.
    var MAX_CHAT_MESSAGES = 200;
    var $allChats = $('#chats').children();
    if ($allChats.length > MAX_CHAT_MESSAGES) {
      var $gone = $allChats.slice(0, $allChats.length - MAX_CHAT_MESSAGES);
      $gone.find('.chatText[data-chat]').each(function () { firetable.actions.unwatchReactions(this.getAttribute('data-chat')); });
      $gone.remove();
      // Invalidate grouping state so the next message always starts a fresh block
      firetable.lastChatPerson = false;
      firetable.lastChatId = false;
    }
  });

  // ── Chat Removal (mod delete) ──
  ftapi.events.on("chatRemoved", function (data) {
    $("#chattxt" + data.chatID).text("[message removed]");
    firetable.actions.unwatchReactions(data.chatID);
    $("#reactions" + data.chatID).remove();
    try {
      if (ftapi.users[ftapi.uid].mod || ftapi.users[ftapi.uid].supermod) {
        $("#chattxt" + data.chatID).removeClass("deleteMe");
      }
    } catch (e) {}
  });

  // ── Hide inline image button ──
  $(document).on('click', '.hideImage', function (e) {
    e.stopPropagation();
    e.preventDefault();
    $(this).closest('.chatText').toggleClass('hideImg');
  });

  // ── Typing indicator ──
  ftapi.db().ref('typing').on('value', function (snap) {
    firetable.typing.others = snap.val() || {};
    firetable.ui.renderTyping();
  }, function () { /* rules not deployed yet: no indicator */ });
  setInterval(firetable.ui.renderTyping, 2000); // drop stale entries
  $("#newchat").on('input.typing', function () {
    var v = $(this).val();
    // bot commands and slash commands aren't chat
    firetable.actions.setTyping(!!v.trim() && !/^[!\/]/.test(v));
  }).on('blur.typing', function () {
    firetable.actions.setTyping(false);
  });
  ftapi.events.on('loggedOut', function () { firetable.typing.active = false; });

  // ── Chat Input: Auto-grow textarea fallback (for browsers without field-sizing: content) ──
  function growChatInput() {
    var el = document.getElementById('newchat');
    if (!el) return;
    el.style.height = 'auto';
    var maxH = 128; // matches max-height: 8rem
    var newH = Math.min(el.scrollHeight, maxH);
    el.style.height = newH + 'px';
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }
  $("#newchat").on('input', growChatInput);

  // ── Chat Input: Send Message + Slash Commands ──
  $("#newchat").on("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      var txt = $("#newchat").val();
      if (txt === "") return;

      // Hot/Rain emoji toggle for quick reactions
      if (txt === ":fire:" || txt === "🔥") {
        $("#cloud_with_rain").removeClass("on");
        $("#fire").addClass("on");
      } else if (txt === ":cloud_with_rain:" || txt === "🌧") {
        $("#cloud_with_rain").addClass("on");
        $("#fire").removeClass("on");
      }

      // ── Slash Commands ──
      var matches = txt.match(/^(?:[\/])(\w+)\s*(.*)/i);
      if (matches) {
        var command = matches[1].toLowerCase();
        var args = matches[2];

        switch (command) {
          case "mod":
            var personToMod = firetable.actions.uidLookup(args);
            if (personToMod) ftapi.actions.modUser(personToMod);
            break;
          case "unmod":
            var personToUnmod = firetable.actions.uidLookup(args);
            if (personToUnmod) ftapi.actions.unmodUser(personToUnmod);
            break;
          case "block":
            if (args) {
              ftapi.actions.blockUser(args, function (response) {
                firetable.actions.localChatResponse(response);
              });
            }
            break;
          case "unblock":
            if (args) {
              ftapi.actions.unblockUser(args, function (response) {
                firetable.actions.localChatResponse(response);
              });
            }
            break;
          case "hot":
            firetable.actions.sendReaction(":fire:");
            $("#cloud_with_rain").removeClass("on");
            $("#fire").addClass("on");
            break;
          case "storm":
            firetable.actions.sendReaction(":cloud_with_rain:");
            $("#cloud_with_rain").addClass("on");
            $("#fire").removeClass("on");
            break;
          case "shrug":
            ftapi.actions.sendChat((args ? args + " " : "") + "¯\\_(ツ)_/¯");
            break;
          case "tableflip":
            ftapi.actions.sendChat((args ? args + " " : "") + "(╯°□°）╯︵ ┻━┻");
            break;
          case "unflip":
            ftapi.actions.sendChat((args ? args + " " : "") + "┬─┬ ノ( ゜-゜ノ)");
            break;
        }
      } else {
        // Regular chat message (🔥 / 🌧 typed on their own are reactions)
        if (firetable.actions.isReactionText(txt)) firetable.actions.sendReaction(txt);
        else ftapi.actions.sendChat(txt);
      }

      $("#newchat").val("").trigger('input');
      firetable.actions.setTyping(false);
      $("#emojiPicker").slideUp();
      $("#pickEmoji").removeClass("on");
      firetable.utilities.exitAtLand();

    } else if (e.key === "Enter" && e.shiftKey) {
      // Shift+Enter: insert newline (textarea handles this natively — just don't prevent it)
      return;

    } else if (e.key === "@") {
      // ── @-mention autocomplete trigger ──
      if (firetable.atLand) {
        firetable.utilities.exitAtLand(); // double @@ cancels
      } else {
        firetable.utilities.initAtLand();
        $('#atPicker').addClass('show');
        for (var i = 0; i < firetable.atUsersFiltered.length; i++) {
          var $item = $('<div class="atPickerThing"><button class="butt graybutt" role="option" aria-selected="false">@' +
            firetable.utilities.htmlEscape(firetable.atUsersFiltered[i]) + '</button></div>');
          if (i === 0) $item.find('.butt').attr('aria-selected', 'true');
          $item.appendTo('#atPicker');
        }
      }

    } else if (firetable.atLand) {
      // ── @-mention: filter as user types ──
      // Ignore pure modifier keys (Shift, Control, Alt, Meta, CapsLock, etc.)
      if (e.key.length > 1 && !e.key.match(/^[0-9a-zA-Z_]$/)) {
        return;
      } else if (e.key === " " || e.key === "Spacebar") {
        firetable.utilities.exitAtLand();
      } else if (!e.key.match(/^[0-9a-zA-Z_]$/)) {
        firetable.utilities.exitAtLand();
      } else {
        firetable.atString += e.key;
        firetable.utilities.updateAtLand();
      }
    }
  });

  // ── @-mention: dismiss picker when input loses focus ──
  $("#newchat").on('blur', function () {
    if (firetable.atLand) {
      // Small delay so click on a picker button registers before we tear it down
      setTimeout(function () {
        if (!$('#atPicker').is(':focus-within') && !$('#atPicker .butt:focus').length) {
          firetable.utilities.exitAtLand();
        }
      }, 150);
    }
  });

  // ── @-mention: backspace/arrow navigation ──
  $("#newchat").on("keyup", function (e) {
    if (!firetable.atLand) return;
    if (e.key === "Backspace") {
      if (!firetable.atString) {
        firetable.utilities.exitAtLand();
      } else {
        firetable.atString = firetable.atString.slice(0, -1);
        firetable.utilities.updateAtLand();
      }
    } else if (e.key === "ArrowUp") {
      $('#atPicker .butt:last').focus();
    } else if (e.key === "ArrowDown") {
      $('#atPicker .butt:first').focus();
    }
  });

  // ── @-mention: Tab to auto-complete (selects the highlighted item) ──
  $("#newchat").on("keydown", function (e) {
    if (!firetable.atLand) return;
    if (e.key === "Tab") {
      e.preventDefault();
      var $active = $('#atPicker .butt[aria-selected="true"]').first();
      var name = $active.length
        ? $active.text().replace('@', '')
        : (firetable.atUsersFiltered[0] || null);
      if (name) firetable.utilities.chooseAt(name);
      else firetable.utilities.exitAtLand();
    }
  });

  // ── @-mention: click on dropdown item ──
  $(document).on('click', '#atPicker .butt', function (e) {
    e.preventDefault();
    firetable.utilities.chooseAt($(this).text().replace("@", ""));
    setTimeout(function () {
      var tempText = $("#newchat").val();
      $('#newchat').focus().val('');
      $('#newchat').val(tempText);
    }, 250);
  });

  // ── @-mention: arrow keys move aria-selected highlight (focus stays on input) ──
  $(document).on('keydown', '#atPicker .butt', function (e) {
    if (e.key === "ArrowUp") {
      var $prev = $(this).closest('.atPickerThing').prev('.atPickerThing');
      var $target = $prev.length ? $prev.find('.butt') : $('#atPicker .butt').last();
      $('#atPicker .butt').attr('aria-selected', 'false');
      $target.attr('aria-selected', 'true').focus();
    } else if (e.key === "ArrowDown") {
      var $next = $(this).closest('.atPickerThing').next('.atPickerThing');
      var $target2 = $next.length ? $next.find('.butt') : $('#atPicker .butt').first();
      $('#atPicker .butt').attr('aria-selected', 'false');
      $target2.attr('aria-selected', 'true').focus();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      firetable.utilities.chooseAt($(this).text().replace('@', ''));
      $('#newchat').focus();
    } else if (e.key === "Escape") {
      firetable.utilities.exitAtLand();
      $('#newchat').focus();
    }
  });

  // ── @-mention: arrow keys from input move selection into picker ──
  $(document).on('keydown', '#newchat', function (e) {
    if (!firetable.atLand) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      var $first = $('#atPicker .butt[aria-selected="true"]').first();
      if (!$first.length) $first = $('#atPicker .butt').first();
      $first.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      var $last = $('#atPicker .butt').last();
      if ($last.length) $last.focus();
    } else if (e.key === "Escape") {
      firetable.utilities.exitAtLand();
    }
  });

  // ── Reactions: picker + chips ──
  var reactPop = document.getElementById('reactPickerPopover');
  var $picker = $(reactPop).find('.reactPicker');
  CHAT_REACTIONS.forEach(function (r) {
    $('<button type="button" role="menuitem" class="reactPick"></button>')
      .attr({ 'data-key': r[0], title: r[0].replace(/_/g, ' '), 'aria-label': r[0].replace(/_/g, ' ') })
      .text(r[1]).appendTo($picker);
  });
  if (typeof twemoji !== 'undefined') twemoji.parse($picker[0]);
  $('#chats').on('click', '.reactAdd', function (e) {
    e.stopPropagation();
    var chatID = $(this).closest('.chatText').attr('data-chat');
    if (reactPop.matches(':popover-open')) { reactPop.hidePopover(); if (firetable.reactingTo === chatID) return; }
    firetable.reactingTo = chatID;
    reactPop.style.visibility = 'hidden';
    reactPop.showPopover();
    firetable.ui.positionPopover(this, reactPop, document.getElementById('reactPickerArrow'), 'top').then(function () {
      var first = reactPop.querySelector('.reactPick');
      if (first) first.focus();
    });
  }).on('click', '.reactChip', function () {
    firetable.actions.toggleReaction($(this).closest('.chatReactions').attr('id').replace('reactions', ''), $(this).attr('data-key'));
  });
  $(reactPop).on('click', '.reactPick', function () {
    var chatID = firetable.reactingTo;
    reactPop.hidePopover();
    var key = $(this).attr('data-key');
    // picking one you already gave just keeps it
    if (!$("#reactions" + chatID + ' .reactChip.mine[data-key="' + key + '"]').length) firetable.actions.toggleReaction(chatID, key);
  }).on('keydown', function (e) {
    var $items = $(reactPop).find('.reactPick');
    var idx = $items.index($items.filter(':focus'));
    if (e.key === 'ArrowRight') { e.preventDefault(); $items.eq((idx + 1) % $items.length).focus(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); $items.eq((idx - 1 + $items.length) % $items.length).focus(); }
  });
  // names in chip tooltips fill in as the people list arrives
  ftapi.events.on('usersChanged', firetable.utilities.oncePerFrame(function () {
    Object.keys(firetable.reactionListeners).forEach(function (id) {
      var $bar = $('#reactions' + id);
      if ($bar.hasClass('has-reactions')) firetable.reactionListeners[id].ref.once('value', function (s) { firetable.ui.renderReactions(id, s.val()); });
    });
  }));

    // ── Shared cards: tap to view larger ──
  $("#chats").on("click", ".chatCard", function () {
    firetable.actions.viewLargerCard(this.id.replace("cardMaker", ""));
  });

  // ── "More chats" scroll-to-bottom button ──
  $("#morechats .butt").on("click", function () {
    firetable.utilities.scrollToBottom();
  });

  // ── Fire / Rain reaction buttons ──
  $("#fire").on("click", function () {
    if (ftapi.uid && firetable.fireReactors[ftapi.uid]) {
      firetable.actions.sendReaction(":cloud_with_rain:");
      $("#cloud_with_rain").addClass("on");
      $("#fire").removeClass("on");
    } else {
      firetable.actions.sendReaction(":fire:");
    }
  });
  $("#cloud_with_rain").on("click", function () {
    firetable.actions.sendReaction(":cloud_with_rain:");
    $("#cloud_with_rain").addClass("on");
    $("#fire").removeClass("on");
  });

  $(document)
    .off('click.chatDanceCta')
    .on('click.chatDanceCta', '.chat-dance-btn', function () {
      if ($(this).hasClass('is-pressed')) return;
      ftapi.actions.sendBotCommand('!dance');
      $(this)
        .addClass('is-pressed')
        .attr('aria-pressed', 'true')
        .prop('disabled', true);
    });
};
