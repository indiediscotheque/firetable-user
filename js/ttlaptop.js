/**
 * ttlaptop.js — the Turntable theme's laptops, as they're kept.
 *
 * A DJ's laptop is its lid's colour and up to ten stickers, kept at
 * users/<uid>/ttLaptop as one short string the database rules check in one
 * pattern. This is that format, both ways, and what may be in it; the theme
 * (js/ttskin.js) draws laptops and edits them.
 *
 * Not in the page's scripts: js/lazy.js loads it just before js/ttskin.js.
 */
firetable.ttLaptop = (function () {
  "use strict";

  // Laptop stickers: the room's own and Turntable's gold ones are one picture
  // (img/tt/stickers.webp, tools/tt-art.py: same names, same order); the rest
  // are the emoji the chat already shows (Twemoji, from the same place).
  var STICKERS = ["id", "id9", "eight", "cake", "rohn", "heart", "happy", "wink", "laughing", "sad", "smh", "poop", "glowstick", "ttfm"];
  var EMOJI = ["1faa9", "1f525", "1f3a7", "1f4bf", "1f308", "2b50", "1f680", "1f47e", "1f496", "1f984", "1f918", "1f3b8", "1f3b9", "1f941", "1f3a4", "1f3b6",
    "1f4fc", "1f4fb", "26a1", "1f319", "1f6f8", "1f47d", "1f419", "1f412", "1f63a", "1f355", "1f32e", "1f32f", "2615", "1f369", "1f366", "1f352", "1f335", "1f344", "1f338", "1f30a", "1f389", "1f60e"];
  var LIDS = ["black", "silver", "white", "gold", "pink", "teal", "purple"];
  var MAX_STICKERS = 10;

  /**
   * A laptop, as kept at users/<uid>/ttLaptop: "lid;sticker,x,y,turn,size;…"
   * (x and y in % of the lid, turn in degrees, size in %), short enough for
   * the database rules to check in one pattern. A sticker can hang off the
   * lid's edge (the lid cuts it off): its middle as far as -40..140%. The
   * rules take x and y as 0..999, so one off the left or top is kept as
   * 1000 less it (-12 is 988); 0..100 are as they always were.
   */
  var POS_MIN = -40, POS_MAX = 140;
  function decodePos(n) { n = +n; return Math.max(POS_MIN, Math.min(POS_MAX, n >= 900 ? n - 1000 : n)); }
  function encodePos(v) { v = Math.round(v); return v < 0 ? 1000 + v : v; }
  /**
   * Where a sticker's middle can go: off the lid's edge as far as leaves a
   * fifth of it on (the lid is 96 by 66; a sticker is 30% of it wide, square).
   */
  var BLEED = 0.6;
  function keepOn(it) {
    var hx = 15 * it.s / 100, hy = hx * 96 / 66;
    it.x = Math.max(-hx * BLEED, Math.min(100 + hx * BLEED, it.x));
    it.y = Math.max(-hy * BLEED, Math.min(100 + hy * BLEED, it.y));
    return it;
  }
  function parse(str) {
    var out = { lid: "black", items: [] }; // Turntable's laptops were dark
    if (typeof str !== "string" || !/^[a-z]{3,6}(;[a-z0-9]{1,10},[0-9]{1,3},[0-9]{1,3},-?[0-9]{1,3},[0-9]{2,3}){0,10}$/.test(str)) return out;
    var parts = str.split(";");
    if (LIDS.indexOf(parts[0]) !== -1) out.lid = parts[0];
    parts.slice(1).forEach(function (p) {
      var f = p.split(",");
      if (!stickerOk(f[0])) return;
      out.items.push(keepOn({ id: f[0], x: decodePos(f[1]), y: decodePos(f[2]), r: Math.max(-180, Math.min(180, +f[3])), s: Math.max(40, Math.min(160, +f[4])) }));
    });
    return out;
  }
  function stringify(l) {
    return [l.lid].concat(l.items.slice(0, MAX_STICKERS).map(function (i) {
      return [i.id, encodePos(i.x), encodePos(i.y), Math.round(i.r), Math.round(i.s)].join(",");
    })).join(";");
  }
  function stickerOk(id) { return STICKERS.indexOf(id) !== -1 || (id.charAt(0) === "e" && EMOJI.indexOf(id.slice(1)) !== -1); }


  return { STICKERS: STICKERS, EMOJI: EMOJI, LIDS: LIDS, MAX_STICKERS: MAX_STICKERS, keepOn: keepOn, parse: parse, stringify: stringify };
})();
