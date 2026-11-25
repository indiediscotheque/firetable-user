/**
 * dj-switch.js — the crate's DJ switch, beside its playlist picker (#cr-djTag).
 *
 * On the list you DJ from it reads "DJ list" and is pressed; on any other it
 * reads "DJ from this", and a tap makes the list on screen the one the room
 * plays from when it's your turn. The same in Live and in Discover's
 * Playlists tab (Live's own panel, moved over). All playlists does the same
 * for any list, and the stage's picker for the list it names.
 */
(function () {
  "use strict";

  /** Make `listID` the list the room plays from when you DJ. */
  firetable.actions.djFrom = function (listID) {
    listID = String(listID);
    ftapi.actions.switchDjList(listID); // tells everyone that draws it (djListChanged)
    var stage = document.getElementById("djlistpicker");
    if (stage) stage.value = listID;
    var me = ftapi.users && ftapi.users[ftapi.uid];
    if (me) me.selectedList = listID;
    firetable.ui.toast("You DJ from " + firetable.utilities.listName(listID) + " now", "success");
  };

  /** Draw the switch for the list on screen: pressed when it's the one you DJ from. */
  firetable.ui.drawDjSwitch = function (isDj) {
    var btn = document.getElementById("cr-djTag");
    if (!btn) return;
    btn.hidden = false;
    btn.classList.toggle("on", isDj);
    btn.setAttribute("aria-pressed", String(isDj));
    btn.title = isDj ? "You DJ from this playlist" : "DJ from this playlist: the room plays it when it's your turn";
    btn.querySelector("span").textContent = isDj ? "DJ list" : "DJ from this";
  };

  var btn = document.getElementById("cr-djTag");
  if (btn) {
    btn.addEventListener("click", function () {
      if (btn.getAttribute("aria-pressed") === "true") return; // already the one
      var pick = document.getElementById("listpicker");
      firetable.actions.djFrom(firetable.viewListID || (pick && pick.value) || "0");
    });
  }
})();
