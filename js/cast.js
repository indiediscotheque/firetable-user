/**
 * cast.js — "Play on a speaker or TV".
 *
 * The room's sound comes from YouTube's and SoundCloud's own players, which
 * no web casting API can hand to a speaker, so the cast button (#st-cast, on
 * the stage or in the player along the bottom) opens a guide (#st-castBox)
 * to sending this device's sound there: Google Cast from Chrome or Edge,
 * AirPlay, Android's Google Home app, or Bluetooth. The way that fits this
 * device and browser comes first and opens; the others stay one tap away.
 *
 * Depends on: state.js (firetable), install.js (platform), jQuery
 */

firetable.cast = {
  /** Chrome or Edge on a computer: they cast a tab (Brave and Opera don't). */
  canCastTab: function () {
    var ua = navigator.userAgent;
    if (firetable.install.platform() !== "desktop" || navigator.brave) return false;
    return /Edg\//.test(ua) || (/Chrome\//.test(ua) && !/OPR\/|Vivaldi/.test(ua));
  },
  isMac: function () {
    return firetable.install.platform() === "desktop" && /Macintosh/.test(navigator.userAgent);
  },

  /** The ways to try on this device, best first. */
  ways: function () {
    var c = firetable.cast;
    var p = firetable.install.platform();
    if (p === "ios") return ["airplay", "bluetooth", "chrome", "android"];
    if (p === "android") return ["android", "bluetooth", "chrome", "airplay"];
    var mine = c.canCastTab() ? ["chrome"] : [];
    if (c.isMac()) mine.push("airplay");
    mine.push("bluetooth");
    ["chrome", "airplay", "android"].forEach(function (w) { if (mine.indexOf(w) < 0) mine.push(w); });
    return mine;
  },

  open: function () {
    var dlg = document.getElementById("st-castBox");
    var box = document.getElementById("st-castWays");
    if (!dlg || !box) return;
    firetable.cast.ways().forEach(function (way, n) {
      var d = box.querySelector('[data-way="' + way + '"]');
      if (!d) return;
      d.open = n === 0;
      box.appendChild(d);
    });
    if (!dlg.open) dlg.showModal();
  },

  init: function () {
    $(document).on("click", "#st-cast", function (e) {
      e.preventDefault();
      firetable.cast.open();
    });
  }
};
