/**
 * bouletmaton.js — Bouletmaton avatars: build one from its parts, draw it,
 * and hand out pictures the rest of the site can use as a plain URL.
 *
 * The drawings are the Bouletmaton's own (Boulet & Kek, zanorg.net/bouletmaton,
 * CC BY-NC-SA 3.0 FR), every one it has, under their own names in
 * img/bouletmaton/: skin-tone parts in peau1-4/, hair and beards in their 12
 * colours in coul1-12/, the rest at the top. Each is a 550 × 626 transparent
 * PNG (a few hang lower, 550 × 636) that lines up with the others when
 * stacked. They're stacked in the Bouletmaton's own order (PARTS), hair
 * lifted 15px as it does, on a transparent background: there is no background.
 *
 * A member's Bouletmaton is 19 numbers in a dot-separated code
 * (users/<uid>/boulet): skin tone (1-4), hair colour (1-12), beard colour
 * (1-12), then the 16 parts in the order they're drawn, each the drawing's
 * own number (the Bouletmaton's blank "none" drawings are left out of
 * img/bouletmaton/ and drawn as nothing; nose and ears can be hidden: 0).
 * Nobody has one until they build it: there are no made-up ones.
 *
 * The pictures are drawn in the browser (a canvas, then a blob: URL), which
 * takes a moment. url() and later() answer at once: with the finished picture
 * when there is one, else with a stand-in (blank.svg#bm=<key>) that's swapped
 * for the real one wherever it was put (inline styles, <img>) as soon as it's
 * ready. Every element showing a Bouletmaton is marked .bm-face, so it gets a
 * Bouletmaton's framing whatever the room's style is: its whole head in the
 * circles, measured from its own drawings (frame(), --bm-zoom/-x/-y).
 *
 * Plain script with no dependencies, so the embedded stage uses it too.
 * Defines window.Bouletmaton.
 */
(function (root) {
  "use strict";

  // Where the drawings are: img/bouletmaton/ next to this script's js/ folder,
  // so it works from any page (the room, the embedded stage).
  var BASE = (function () {
    var me = document.currentScript && document.currentScript.src;
    try { return new URL("../img/bouletmaton/", me || document.baseURI).href; } catch (e) { return "img/bouletmaton/"; }
  })();

  /** The Bouletmaton's canvas; every drawing lines up on it. */
  var W = 550, H = 626;
  /** The finished picture is square: the whole drawing, centred, feet at the bottom. */
  var SIDE = H;

  var SKINS = 4, COLOURS = 12;
  /** The skin tones and hair and beard colours, for the builder's swatches (sampled from the drawings). */
  var SKIN_SWATCHES = ["#e4d0a7", "#e6e4b8", "#ae9666", "#6b5326"];
  var HAIR_SWATCHES = ["#c68a43", "#fae489", "#897136", "#564110", "#29210f", "#5f5f5f",
    "#344d8b", "#f1efe8", "#fc869b", "#42ff40", "#d81bda", "#ff2535"];

  /**
   * The 16 parts, back to front: the Bouletmaton's own stacking (its
   * interface.js: body, neckwear, head, chin, mouth, eyes, beard, eyebrows,
   * face details, glasses, nose, hair, ears, earrings, hat, then what's in
   * hand). `dir`: "skin" (peauN/), "hair" or "beard" (coulN/), or "" (the top
   * folder). `max` is the last drawing; `blank` the one that's a blank (none);
   * `hide` means 0 hides it (nose, ears). In hand also has the Bouletmaton's
   * three fur coats (21-23) and its hidden extras (24-27: sec1-4).
   */
  var PARTS = [
    { key: "body",   label: "Body",         dir: "skin",  file: "cor",     max: 62 },
    { key: "neck",   label: "Neckwear",     dir: "",      file: "col",     max: 27, blank: 27 },
    { key: "head",   label: "Head",         dir: "skin",  file: "tete",    max: 54 },
    { key: "chin",   label: "Chin",         dir: "skin",  file: "menton",  max: 17, blank: 1 },
    { key: "mouth",  label: "Mouth",        dir: "skin",  file: "bou",     max: 93 },
    { key: "eyes",   label: "Eyes",         dir: "",      file: "ye",      max: 96 },
    { key: "beard",  label: "Beard",        dir: "beard", file: "bar",     max: 25, blank: 25 },
    { key: "brows",  label: "Eyebrows",     dir: "",      file: "so",      max: 42 },
    { key: "detail", label: "Face details", dir: "",      file: "tache",   max: 18, blank: 18 },
    { key: "glasses", label: "Glasses",     dir: "",      file: "lunette", max: 21, blank: 21 },
    { key: "nose",   label: "Nose",         dir: "skin",  file: "nez",     max: 32, hide: true },
    { key: "hair",   label: "Hair",         dir: "hair",  file: "coi",     max: 72, blank: 72 },
    { key: "ears",   label: "Ears",         dir: "skin",  file: "ore",     max: 18, hide: true },
    { key: "acc",    label: "Earrings",     dir: "",      file: "boucle",  max: 25, blank: 25 },
    { key: "hat",    label: "Hat",          dir: "",      file: "chapo",   max: 33, blank: 33 },
    { key: "hand",   label: "In hand",      dir: "skin",  file: "divers",  max: 27, blank: 20 }
  ];
  /** Hair the Bouletmaton doesn't lift (its "hack position"). */
  var HAIR_UNLIFTED = [19, 25, 31];
  var HAIR_LIFT = 15;
  var CODE_RE = /^[1-4]\.([1-9]|1[0-2])\.([1-9]|1[0-2])(\.\d{1,2}){16}$/;

  // ─── The code ────────────────────────────────────────────────────────────

  /** Is `v` one of the part's choices: 1-max, or 0 where it can be hidden. */
  function allowed(part, v) { return v === 0 ? !!part.hide : v >= 1 && v <= part.max; }

  /**
   * A code as {skin, hair, beard, parts: {key: n}}, or null when it isn't a
   * whole, valid Bouletmaton.
   * @param {*} code
   */
  function decode(code) {
    if (typeof code !== "string" || !CODE_RE.test(code)) return null;
    var n = code.split(".").map(Number);
    var out = { skin: n[0], hair: n[1], beard: n[2], parts: {} };
    for (var i = 0; i < PARTS.length; i++) {
      if (!allowed(PARTS[i], n[i + 3])) return null;
      out.parts[PARTS[i].key] = n[i + 3];
    }
    return out;
  }

  /** The code for {skin, hair, beard, parts}; anything left out or out of range is 1. */
  function encode(b) {
    var one = function (v, max) { v = Math.round(Number(v)); return v >= 1 && v <= max ? v : 1; };
    var nums = [one(b && b.skin, SKINS), one(b && b.hair, COLOURS), one(b && b.beard, COLOURS)];
    PARTS.forEach(function (part) {
      var v = Math.round(Number(b && b.parts && b.parts[part.key]));
      nums.push(allowed(part, v) ? v : 1);
    });
    return nums.join(".");
  }

  function isCode(v) { return decode(v) !== null; }

  /** Where a new Bouletmaton starts: every choice at 1. */
  var FIRST = encode({});

  /** The drawing for a part's choice (a URL), or null for none. */
  function drawingOf(part, v, b) {
    if (!v || v === part.blank) return null;
    if (part.key === "hand" && v > 23) return BASE + "sec" + (v - 23) + ".png"; // the hidden extras
    var dir = part.dir === "skin" ? "peau" + b.skin + "/" : part.dir === "hair" ? "coul" + b.hair + "/" : part.dir === "beard" ? "coul" + b.beard + "/" : "";
    return BASE + dir + part.file + v + ".png";
  }

  /** The drawings to stack for a code, back to front: [{url, dy}] (dy: the hair's lift). */
  function layers(code) {
    var b = decode(code);
    if (!b) return [];
    var out = [];
    PARTS.forEach(function (part) {
      var v = b.parts[part.key], url = drawingOf(part, v, b);
      if (!url) return;
      out.push({ url: url, dy: part.key === "hair" && HAIR_UNLIFTED.indexOf(v) === -1 ? -HAIR_LIFT : 0 });
    });
    return out;
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
   * Draw a code into `canvas` (or a new one), `px` square: the whole drawing,
   * centred, its foot at the bottom, on a transparent background. Each
   * drawing at its own size (a few hang lower than the rest).
   * @returns {Promise<HTMLCanvasElement>}
   */
  function draw(code, px, canvas) {
    var parts = layers(code);
    return Promise.all(parts.map(function (l) { return load(l.url); })).then(function (imgs) {
      var c = canvas || document.createElement("canvas");
      c.width = c.height = px;
      var g = c.getContext("2d");
      g.clearRect(0, 0, px, px);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      var k = px / SIDE, x = (SIDE - W) / 2 * k;
      imgs.forEach(function (img, i) {
        if (img) g.drawImage(img, x, (SIDE - H + parts[i].dy) * k, (img.naturalWidth || W) * k, (img.naturalHeight || H) * k);
      });
      return c;
    });
  }

  /** The parts that make up the head (everything but body, neckwear and what's in hand). */
  var HEAD_PARTS = ["head", "chin", "mouth", "eyes", "beard", "brows", "detail", "glasses", "nose", "hair", "ears", "acc", "hat"];
  /** Below this (the picture's px) is chest: long hair and beards don't stretch the head's box. */
  var HEAD_FLOOR = 480;
  /** A typical head's framing, until a Bouletmaton's own is measured (and in css/looks.css). */
  var FRAME = { zoom: 160, x: 60.6, y: 31.7 };

  /**
   * Where the whole head is in a Bouletmaton's picture, as the circles'
   * framing: {zoom, x, y} (background-size height and background-position,
   * in %), a square around the head, hair, ears and hat with a little room.
   * Measured from the drawings themselves, so a tall hat or big hair fits.
   * @returns {Promise<{zoom:number, x:number, y:number}>}
   */
  function frame(code) {
    var parts = layers(code), b = decode(code);
    if (!b) return Promise.resolve(FRAME);
    var heads = {};
    HEAD_PARTS.forEach(function (key) {
      var part = PARTS.filter(function (p) { return p.key === key; })[0];
      var u = drawingOf(part, b.parts[key], b);
      if (u) heads[u] = true;
    });
    return Promise.all(parts.map(function (l) { return load(l.url); })).then(function (imgs) {
      var k = 4, n = Math.ceil(SIDE / k), c = document.createElement("canvas");
      c.width = c.height = n;
      var g = c.getContext("2d"), x0 = (SIDE - W) / 2 / k;
      imgs.forEach(function (img, i) {
        if (img && heads[parts[i].url]) g.drawImage(img, x0, (SIDE - H + parts[i].dy) / k, (img.naturalWidth || W) / k, (img.naturalHeight || H) / k);
      });
      var data;
      try { data = g.getImageData(0, 0, n, n).data; } catch (e) { return FRAME; }
      var minX = n, minY = n, maxX = -1, maxY = -1, floor = Math.min(n, Math.ceil(HEAD_FLOOR / k));
      for (var y = 0; y < floor; y++) for (var x = 0; x < n; x++) {
        if (data[(y * n + x) * 4 + 3] < 40) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (maxX < 0) return FRAME;
      minX *= k; maxX = (maxX + 1) * k; minY *= k; maxY = (maxY + 1) * k;
      var side = Math.min(600, Math.max(360, Math.max(maxX - minX, maxY - minY) * 1.16));
      var round = function (v) { return Math.round(v * 100) / 100; };
      var at = function (mid) { return round((mid - side / 2) / (SIDE - side) * 100); };
      return { zoom: round(SIDE / side * 100), x: at((minX + maxX) / 2), y: at((minY + maxY) / 2) };
    });
  }

  /** The picture sizes made: small (lists, chat) and big (the stage, big faces, cards). */
  function bucket(px) { return px > 256 ? 512 : 256; }

  var pictures = {}; // code@px -> Promise<blob URL>
  var ready = {};    // code@px -> blob URL, once drawn
  var faces = {};    // blob URL -> its framing in the circles: the pictures that are Bouletmatons (for .bm-face)
  /**
   * The finished picture of a code, as a blob: URL (made once per code and size).
   * @returns {Promise<string>}
   */
  function picture(code, px) {
    px = bucket(px || 256);
    var key = code + "@" + px;
    if (!pictures[key]) {
      pictures[key] = Promise.all([draw(code, px), frame(code).catch(function () { return FRAME; })]).then(function (both) {
        var c = both[0];
        return new Promise(function (ok) {
          var done = function (blob) {
            var url = blob ? URL.createObjectURL(blob) : c.toDataURL("image/png");
            ready[key] = url;
            faces[url] = both[1];
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
  var resolved = {}; // stand-in key -> URL
  var asked = {};    // stand-in key -> true once it's being made
  var sweepTimer = 0;
  var observer = null;
  var STAND_IN_RE = /url\((["']?)([^"')]*#bm=([^"')]+))\1\)/g;
  var URL_RE = /url\((["']?)([^"')]+)\1\)/;

  /** This inline background's Bouletmaton framing, or null when it isn't one. */
  function faceOf(bg) { var m = URL_RE.exec(bg || ""); return (m && faces[m[2]]) || null; }
  /** Is this inline background a Bouletmaton? */
  function isFace(bg) { return !!faceOf(bg); }
  var FRAME_VARS = { zoom: "--bm-zoom", x: "--bm-x", y: "--bm-y" };
  /** Put a Bouletmaton's own framing on its element (css/looks.css .bm-face reads it), or take it off. */
  function setFrame(el, f) {
    Object.keys(FRAME_VARS).forEach(function (k) {
      var v = f ? f[k] + "%" : "";
      if (el.style.getPropertyValue(FRAME_VARS[k]) === v) return;
      if (v) el.style.setProperty(FRAME_VARS[k], v); else el.style.removeProperty(FRAME_VARS[k]);
    });
  }

  /** Put the finished pictures in place of their stand-ins, and mark every Bouletmaton (.bm-face). */
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
    // a Bouletmaton's framing wherever one is shown, and only there
    var marked = document.querySelectorAll('[style*="blob:"], .bm-face');
    for (var k = 0; k < marked.length; k++) {
      var f = faceOf(marked[k].style.backgroundImage), face = !!f;
      if (face !== marked[k].classList.contains("bm-face")) marked[k].classList.toggle("bm-face", face);
      setFrame(marked[k], f);
    }
  }
  function soon() { if (!sweepTimer) sweepTimer = setTimeout(sweep, 30); }
  /** Watch for stand-ins and pictures put on the page after they were ready. */
  function watch() {
    if (observer || typeof MutationObserver === "undefined" || !document.documentElement) return;
    observer = new MutationObserver(function () { soon(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "src"] });
  }

  /**
   * A Bouletmaton's picture, as a URL to use straight away (a stand-in until
   * it's drawn).
   * @param {string} code
   * @param {number} [px] - the size it's shown at, in device pixels
   * @returns {string}
   */
  function url(code, px) {
    px = bucket(px || 256);
    var key = code + "@" + px;
    watch();
    if (ready[key]) { soon(); return ready[key]; }
    if (!asked[key]) { asked[key] = true; picture(code, px).then(function (u) { resolved[key] = u; soon(); }); }
    return STAND_IN + "#bm=" + key;
  }

  /**
   * A picture that takes a lookup to choose (someone not in the room: their
   * Bouletmaton, or the room's style): a stand-in now, replaced by what
   * `make` resolves to (any URL). Made once per key.
   * @param {string} key - letters, digits and . @ _ - only
   * @param {function(): Promise<string>} make
   * @returns {string}
   */
  function later(key, make) {
    watch();
    if (resolved[key]) return resolved[key];
    if (!asked[key]) {
      asked[key] = true;
      Promise.resolve().then(make).catch(function () { return null; }).then(function (u) {
        if (u) { resolved[key] = u; soon(); } else delete asked[key];
      });
    }
    return STAND_IN + "#bm=" + key;
  }

  /** Forget the looked-up pictures whose keys start with `prefix` (someone changed theirs). */
  function forget(prefix) {
    Object.keys(asked).forEach(function (k) {
      if (k.indexOf(prefix) === 0 && k.indexOf("@") !== -1 && !/^\d/.test(k)) { delete asked[k]; delete resolved[k]; }
    });
  }

  /** FNV-1a: a short, stable key for a string (a name in a stand-in key). */
  function hash(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(36);
  }

  root.Bouletmaton = {
    PARTS: PARTS, SKINS: SKINS, COLOURS: COLOURS, SIDE: SIDE, BASE: BASE, FIRST: FIRST,
    SKIN_SWATCHES: SKIN_SWATCHES, HAIR_SWATCHES: HAIR_SWATCHES, HAIR_UNLIFTED: HAIR_UNLIFTED,
    decode: decode, encode: encode, isCode: isCode, layers: layers, drawingOf: drawingOf,
    draw: draw, frame: frame, FRAME: FRAME, picture: picture, url: url, later: later, forget: forget, sweep: sweep, hash: hash, isFace: isFace
  };
})(window);
