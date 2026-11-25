/**
 * chat-send.js — the chat box's send button (the arrow at the right of the
 * box). It sends the way Enter does: chat.js's Enter handler does the
 * sending, slash commands and all, so the two can't drift apart.
 *
 * - Pressing it doesn't take focus from the box, so a phone's keyboard stays
 *   up and "is typing" isn't cleared between messages.
 * - An open :emoji suggestion list is closed first (as Escape would), so the
 *   button sends what's written rather than picking the suggestion.
 * - Nothing to send (empty or only spaces): nothing happens. The button shows
 *   it's idle then (looks.css, #chatSend).
 */
(function () {
  var form = document.getElementById("newchatForm");
  var box = document.getElementById("newchat");
  var send = document.getElementById("chatSend");
  if (!form || !box || !send) return;

  /** Press a key in the chat box, as if typed. */
  function key(name) {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  }

  // keep the box focused through the press (mouse, touch and pen)
  send.addEventListener("pointerdown", function (e) { e.preventDefault(); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (box.disabled || !box.value.trim()) return;
    if (firetable.emojiSuggest && firetable.emojiSuggest.open) key("Escape");
    key("Enter");
    box.focus();
  });
})();
