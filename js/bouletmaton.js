/**
 * bouletmaton.js — Bouletmaton avatars: build one from its parts, draw it,
 * and hand out pictures the rest of the site can use as a plain URL.
 *
 * A Bouletmaton is 18 numbers in a dot-separated code (users/<uid>/boulet):
 * the skin tone (1-4), the hair colour (1-12), then the 16 parts in the
 * order they're drawn, back to front (PARTS below; 0 = none for the parts
 * you can leave off). The parts are the Bouletmaton's own drawings
 * (img/bouletmaton/, from indiediscotheque/bouletmaton), 550 × 626
 * transparent PNGs that line up when stacked. There is no background: a
 * Bouletmaton is always drawn on a transparent one.
 *
 * Everyone has one: until a member makes their own, they get one made from
 * their uid (random(), the same everywhere it's drawn, and the same as the
 * bot's lib/avatars.js randomBoulet, which stamps it on printed cards).
 *
 * The pictures are drawn in the browser (a canvas, then a blob: URL), which
 * takes a moment. url() answers at once: with the finished picture when it
 * has one, else with a stand-in (blank.svg#bm=<key>) that's swapped for the
 * real one wherever it was put (inline styles, <img>) as soon as it's drawn.
 *
 * Plain script with no dependencies, so the embedded stage
 * uses it too. Defines window.Bouletmaton.
 */
(function (root) {
  "use strict";

  // Where the parts are: img/bouletmaton/ next to this script's js/ folder,
  // so it works from any page (the room, the embedded stage).
  var BASE = (function () {
    var me = document.currentScript && document.currentScript.src;
    try { return new URL("../img/bouletmaton/", me || document.baseURI).href; } catch (e) { return "img/bouletmaton/"; }
  })();

  /** Each drawing is this big; every part lines up on it. */
  var W = 550, H = 626;
  /** The finished picture is square: the whole drawing, centred, nothing cut off. */
  var SIDE = H;

  var SKINS = 4, HAIRS = 12;
  /** The skin tones and hair colours, for the builder's swatches (sampled from the drawings). */
  var SKIN_SWATCHES = ["#e4d0a7", "#e6e4b8", "#ae9666", "#6b5326"];
  var HAIR_SWATCHES = ["#c68a43", "#fae489", "#897136", "#564110", "#29210f", "#5f5f5f",
    "#344d8b", "#f1efe8", "#fc869b", "#42ff40", "#d81bda", "#ff2535"];

  /**
   * The 16 parts, back to front. `dir` "skin" and "hair" are the folders for
   * the chosen skin tone (skintoneN/) and hair colour (haircolorN/). `min`
   * and `max` are the file numbers; `p` is how often a made-up Bouletmaton
   * has the part (only for parts that can be left off, `none: true`).
   */
  var PARTS = [
    { key: "body",    label: "Body",        dir: "skin",            file: "body",          min: 1, max: 62 },
    { key: "head",    label: "Head",        dir: "skin",            file: "head",          min: 1, max: 54 },
    { key: "ears",    label: "Ears",        dir: "skin",            file: "ear",           min: 1, max: 18 },
    { key: "chin",    label: "Chin",        dir: "skin",            file: "chin",          min: 2, max: 17, none: true, p: 0.85 },
    { key: "mouth",   label: "Mouth",       dir: "skin",            file: "mouth",         min: 1, max: 93 },
    { key: "nose",    label: "Nose",        dir: "skin",            file: "nose",          min: 1, max: 32 },
    { key: "eyes",    label: "Eyes",        dir: "eyes",            file: "eyes",          min: 1, max: 96 },
    { key: "brows",   label: "Eyebrows",    dir: "eyebrows",        file: "eyebrows",      min: 1, max: 42 },
    { key: "detail",  label: "Face details", dir: "facedetails",    file: "facedetail",    min: 1, max: 17, none: true, p: 0.25 },
    { key: "beard",   label: "Beard",       dir: "hair",            file: "beard",         min: 1, max: 24, none: true, p: 0.3 },
    { key: "neck",    label: "Neck",        dir: "neckaccessories", file: "neckaccessory", min: 1, max: 12, none: true, p: 0.2 },
    { key: "hair",    label: "Hair",        dir: "hair",            file: "hair",          min: 1, max: 71, none: true, p: 0.9 },
    { key: "glasses", label: "Glasses",     dir: "glasses",         file: "glasses",       min: 1, max: 20, none: true, p: 0.25 },
    { key: "acc",     label: "Earrings and piercings", dir: "headaccessories", file: "headaccessory", min: 1, max: 24, none: true, p: 0.15 },
    { key: "hat",     label: "Hat",         dir: "hats",            file: "hat",           min: 1, max: 32, none: true, p: 0.2 },
    { key: "hand",    label: "In hand",     dir: "skin",            file: "handaccessory", min: 1, max: 19, none: true, p: 0.08 }
  ];
  var COUNT = 2 + PARTS.length;
  var CODE_RE = /^[1-4]\.([1-9]|1[0-2])(\.\d{1,2}){16}$/;

  // ─── The code ────────────────────────────────────────────────────────────

  /**
   * A code as {skin, hair, parts: {key: n}}, or null when it isn't a whole,
   * valid Bouletmaton (wrong length, a number out of range).
   * @param {*} code
   * @returns {?{skin: number, hair: number, parts: Object<string, number>}}
   */
  function decode(code) {
    if (typeof code !== "string" || !CODE_RE.test(code)) return null;
    var n = code.split(".").map(Number);
    var out = { skin: n[0], hair: n[1], parts: {} };
    for (var i = 0; i < PARTS.length; i++) {
      var part = PARTS[i], v = n[i + 2];
      if (v === 0 ? !part.none : (v < part.min || v > part.max)) return null;
      out.parts[part.key] = v;
    }
    return out;
  }

  /** The code for {skin, hair, parts}; a part left out or out of range is its first (or none). */
  function encode(b) {
    var clamp = function (v, lo, hi) { v = Math.round(Number(v)); return v >= lo && v <= hi ? v : lo; };
    var nums = [clamp(b && b.skin, 1, SKINS), clamp(b && b.hair, 1, HAIRS)];
    PARTS.forEach(function (part) {
      var v = Math.round(Number(b && b.parts && b.parts[part.key]));
      nums.push(v === 0 && part.none ? 0 : clamp(v, part.min, part.max));
    });
    return nums.join(".");
  }

  function isCode(v) { return decode(v) !== null; }

  // ─── Everyone's own until they make one ──────────────────────────────────

  /** FNV-1a over the string's UTF-16 units: a 32-bit seed. */
  function hash(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  /** mulberry32: numbers in [0, 1) from a seed. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * A Bouletmaton made up from `seed` (a uid): always the same one for the
   * same seed. Each part takes two numbers from the generator (has it, which
   * one), whether or not it can be left off, so the parts don't shift when
   * the odds change. Must match the bot's lib/avatars.js randomBoulet.
   * @param {string} seed
   * @returns {string} code
   */
  function random(seed) {
    var r = rng(hash(seed));
    var nums = [1 + Math.floor(r() * SKINS), 1 + Math.floor(r() * HAIRS)];
    PARTS.forEach(function (part) {
      var has = r(), which = r();
      nums.push(part.none && has >= part.p ? 0 : part.min + Math.floor(which * (part.max - part.min + 1)));
    });
    return nums.join(".");
  }

  /** The pictures to stack for a code, back to front (URLs). */
  function layers(code) {
    var b = decode(code);
    if (!b) return [];
    return PARTS.map(function (part) {
      var v = b.parts[part.key];
      if (!v) return null;
      var dir = part.dir === "skin" ? "skintone" + b.skin : part.dir === "hair" ? "haircolor" + b.hair : part.dir;
      return BASE + dir + "/" + part.file + v + ".png";
    }).filter(Boolean);
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────

  var images = {}; // url -> Promise<HTMLImageElement|null>
  function load(url) {
    if (!images[url]) {
      images[url] = new Promise(function (ok) {
        var img = new Image();
        img.decoding = "async";
        img.onload = function () { ok(img); };
        img.onerror = function () { delete images[url]; ok(null); };
        img.src = url;
      });
    }
    return images[url];
  }

  /**
   * Draw a code into `canvas` (or a new one), `px` square: the whole
   * drawing, centred, on a transparent background.
   * @param {string} code
   * @param {number} px
   * @param {HTMLCanvasElement} [canvas]
   * @returns {Promise<HTMLCanvasElement>}
   */
  function draw(code, px, canvas) {
    var urls = layers(code);
    return Promise.all(urls.map(load)).then(function (imgs) {
      var c = canvas || document.createElement("canvas");
      c.width = c.height = px;
      var g = c.getContext("2d");
      g.clearRect(0, 0, px, px);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      var k = px / SIDE;
      var x = (SIDE - W) / 2 * k, y = (SIDE - H) * k;
      imgs.forEach(function (img) { if (img) g.drawImage(img, x, y, W * k, H * k); });
      return c;
    });
  }

  /** The picture sizes made: small (lists, chat) and big (the stage, big faces, cards). */
  function bucket(px) { return px > 256 ? 512 : 256; }

  var pictures = {}; // code@px -> Promise<blob URL>
  var ready = {};    // code@px -> blob URL, once drawn
  /**
   * The finished picture of a code, as a blob: URL (made once per code and size).
   * @param {string} code
   * @param {number} [px=256]
   * @returns {Promise<string>}
   */
  function picture(code, px) {
    px = bucket(px || 256);
    var key = code + "@" + px;
    if (!pictures[key]) {
      pictures[key] = draw(code, px).then(function (c) {
        return new Promise(function (ok) {
          var done = function (blob) {
            var url = blob ? URL.createObjectURL(blob) : c.toDataURL("image/png");
            ready[key] = url;
            ok(url);
          };
          if (c.toBlob) c.toBlob(done, "image/webp", 0.92); else done(null);
        });
      });
    }
    return pictures[key];
  }

  // ─── Stand-ins, swapped when the picture is ready ────────────────────────

  var STAND_IN = BASE + "blank.svg";
  var resolved = {}; // stand-in key -> blob URL
  var asked = {};    // stand-in key -> true once it's being made
  var sweepTimer = 0;
  var observer = null;
  var STAND_IN_RE = /url\((["']?)([^"')]*#bm=([^"')]+))\1\)/g;

  /** Put the finished pictures in place of their stand-ins, everywhere on the page. */
  function sweep() {
    sweepTimer = 0;
    var els = document.querySelectorAll('[style*="#bm="]');
    for (var i = 0; i < els.length; i++) {
      var bg = els[i].style.backgroundImage;
      if (!bg || bg.indexOf("#bm=") === -1) continue;
      var next = bg.replace(STAND_IN_RE, function (m, q, url, key) {
        return resolved[key] ? 'url("' + resolved[key] + '")' : m;
      });
      if (next !== bg) els[i].style.backgroundImage = next;
    }
    var imgs = document.querySelectorAll('img[src*="#bm="]');
    for (var j = 0; j < imgs.length; j++) {
      var key = imgs[j].getAttribute("src").split("#bm=")[1];
      if (resolved[key]) imgs[j].src = resolved[key];
    }
  }
  function soon() { if (!sweepTimer) sweepTimer = setTimeout(sweep, 30); }
  /** Watch for stand-ins put on the page after their picture was ready. */
  function watch() {
    if (observer || typeof MutationObserver === "undefined" || !document.documentElement) return;
    observer = new MutationObserver(function () { soon(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "src"] });
  }

  /** How a member's code is found (the site sets these; the embed passes codes itself). */
  var api = {
    /** uid -> code, or null for "none saved" (use theirs from random()), or undefined for "not known yet". */
    lookup: function (uid) { return null; },
    /** uid -> Promise of their code or null, for someone not known yet. */
    fetch: function (uid) { return Promise.resolve(null); }
  };

  /**
   * A picture for a member, as a URL to use straight away (a stand-in until
   * it's drawn). `code` when known (a printed card's), else theirs.
   * @param {string} uid
   * @param {number} [px] - the size it's shown at, in device pixels
   * @param {string} [code]
   * @returns {string}
   */
  function url(uid, px, code) {
    px = bucket(px || 256);
    if (code === undefined) code = api.lookup(uid);
    if (code === null || (code !== undefined && !isCode(code))) code = random(uid || "");
    if (code !== undefined) {
      var key = code + "@" + px;
      if (ready[key]) return ready[key];
      resolved[key] = resolved[key] || null;
      if (!asked[key]) { asked[key] = true; picture(code, px).then(function (u) { resolved[key] = u; soon(); }); }
      watch();
      return STAND_IN + "#bm=" + key;
    }
    // Not known yet (someone not in the room): look them up, then draw
    var ukey = "u" + uid + "@" + px;
    if (resolved[ukey]) return resolved[ukey];
    if (!asked[ukey]) {
      asked[ukey] = true;
      // a lookup that doesn't answer (offline, older rules) draws the made-up one after a while
      var timeout = new Promise(function (ok) { setTimeout(function () { ok(null); }, 5000); });
      Promise.race([Promise.resolve(api.fetch(uid)), timeout]).catch(function () { return null; }).then(function (c) {
        return picture(isCode(c) ? c : random(uid), px);
      }).then(function (u) { resolved[ukey] = u; soon(); });
    }
    watch();
    return STAND_IN + "#bm=" + ukey;
  }

  /** Forget a member's looked-up picture (they made a new Bouletmaton). */
  function forget(uid) {
    Object.keys(asked).forEach(function (k) {
      if (k.indexOf("u" + uid + "@") === 0) { delete asked[k]; delete resolved[k]; }
    });
  }

  root.Bouletmaton = {
    PARTS: PARTS, SKINS: SKINS, HAIRS: HAIRS, COUNT: COUNT, SIDE: SIDE,
    SKIN_SWATCHES: SKIN_SWATCHES, HAIR_SWATCHES: HAIR_SWATCHES, BASE: BASE,
    decode: decode, encode: encode, isCode: isCode, random: random, layers: layers,
    draw: draw, picture: picture, url: url, forget: forget, sweep: sweep, api: api
  };
})(window);
