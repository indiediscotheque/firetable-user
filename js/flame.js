/**
 * flame.js — the room's fire, drawn on a plain 2D canvas: no libraries to load.
 *
 * One engine for both stages: the site's (#fyre, js/fire.js places and drives
 * it) and the live stage for other sites (QueUp's screen). It keeps the look the
 * fire has always had (it began as PixiJS + GSAP): nine flame layers (colours,
 * sizes, offsets, spread, wobble), the same blob lifetimes, paths and easing,
 * the same embers and stoke bursts, and the same intensity curve from one fire
 * to an overdrive at forty.
 *
 * It costs nothing while out: it draws only while burning or while its last
 * blobs and embers fade, and stops while its box is off screen, hidden or the
 * tab is in the background. Its canvas follows its box (ResizeObserver) at the
 * screen's pixel density (up to 2×). With reduced motion asked for it burns
 * steadily: no ember bursts, no swell.
 *
 *   var f = ftFlame(document.getElementById("fyre"));
 *   f.ignite(count);      // a new 🔥: grow to `count` and stoke it
 *   f.setIntensity(0);    // out (stops drawing)
 *   f.setScale(k);        // its size: 1 is the fire for a 110px DJ in a 216px box
 *   f.destroy();          // gone, canvas and observers too
 */
(function () {
  "use strict";

  // ─── easing (GSAP's Power1/2.easeOut and Bounce.easeOut) ────────────────
  var ease = {
    p1out: function (t) { return 1 - (1 - t) * (1 - t); },
    p2out: function (t) { return 1 - Math.pow(1 - t, 3); },
    bounceOut: function (t) {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
      if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
      t -= 2.625 / 2.75;
      return 7.5625 * t * t + 0.984375;
    }
  };

  /**
   * A path through the points (Catmull-Rom), timed by length so it moves
   * steadily. Writes into `out` so a frame allocates nothing.
   */
  function pathThrough(pts) {
    var seg = [], total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) || 0.0001;
      seg.push(d);
      total += d;
    }
    var last = pts.length - 1;
    return function (t, out) {
      var at = (t < 0 ? 0 : t > 1 ? 1 : t) * total, j = 0;
      while (j < seg.length - 1 && at > seg[j]) { at -= seg[j]; j++; }
      var u = at / seg[j], u2 = u * u, u3 = u2 * u;
      var p0 = pts[j > 0 ? j - 1 : 0], p1 = pts[j], p2 = pts[j + 1], p3 = pts[j + 2 > last ? last : j + 2];
      out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3);
      out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3);
      return out;
    };
  }

  /**
   * A filled circle, drawn once and stamped many times. Drawn at SUPER × its
   * radius so a big fire on a 2× screen stays round and smooth when stamped.
   */
  var SUPER = 3;
  var dots = {};
  function dot(radius, color) {
    var key = radius + ":" + color;
    if (dots[key]) return dots[key];
    var size = Math.max(2, Math.ceil(radius * 2 * SUPER));
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var x = c.getContext("2d");
    x.fillStyle = color;
    x.beginPath();
    x.arc(size / 2, size / 2, radius * SUPER, 0, Math.PI * 2);
    x.fill();
    return (dots[key] = c);
  }

  // the layers, back to front
  var LAYERS = [
    { color: "#A91F00", scale: 1.18, offset: -34, x: -30, radius: 50, spread: 92, wobble: 1.12 },
    { color: "#A91F00", scale: 1.18, offset: -34, x: 30, radius: 50, spread: 92, wobble: 1.12 },
    { color: "#E23B00", scale: 1.08, offset: -22, x: -18, radius: 42, spread: 82, wobble: 1.05 },
    { color: "#E23B00", scale: 1.08, offset: -22, x: 18, radius: 42, spread: 82, wobble: 1.05 },
    { color: "#FE8200", scale: 0.98, offset: -8, x: -8, radius: 34, spread: 66, wobble: 0.96 },
    { color: "#FE8200", scale: 0.98, offset: -8, x: 8, radius: 34, spread: 66, wobble: 0.96 },
    { color: "#FBE416", scale: 0.92, offset: 8, x: 0, radius: 30, spread: 50, wobble: 0.9, coreBoost: 1.95 },
    { color: "#FFF27A", scale: 0.84, offset: 15, x: 0, radius: 24, spread: 40, wobble: 0.86, coreBoost: 2.25 },
    { color: "#FDFDB4", scale: 0.76, offset: 24, x: 0, radius: 22, spread: 34, wobble: 0.82, coreBoost: 2.55 }
  ];
  var EMBER_COLORS = ["#FE9C00", "#FEA600", "#E27100"];
  var EMBER_RADIUS = 10;
  var WIDTH_SCALE = 0.75 * 0.59; // the flames' own scale in their box
  var FLAME_EVERY = 50, EMBER_EVERY = 300; // ms between new blobs (each layer) and embers
  var MAX_EMBERS = 600;
  var MAX_DPR = 2;

  var reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  window.ftFlame = function (box) {
    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    box.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, dpr = 1, extra = 1;
    var layers = LAYERS.map(function (s) {
      return { s: s, img: dot(s.radius, s.color), y: s.offset, scaleX: s.scale, scaleY: s.scale, fireAlpha: 0.7, alpha: 1, coreBoost: s.coreBoost || 1, blobs: [], due: 0 };
    });
    var emberImgs = EMBER_COLORS.map(function (c) { return dot(EMBER_RADIUS, c); });
    var embers = [], emberDue = 0;
    var groupAlpha = 0, visible = false, motion = 1, count = 0;
    var stoke = null, raf = 0, last = 0, onScreen = true, dirty = false;
    var pt = { x: 0, y: 0 };

    function resize() {
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      W = box.clientWidth;
      H = box.clientHeight;
      var cw = Math.round(W * dpr), ch = Math.round(H * dpr);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      dirty = true;
      run();
    }

    function addFlame(L, now) {
      var s = L.s, time = 1 + Math.random() * 0.4, m = motion;
      L.blobs.push({
        born: now, life: time * 1000,
        s0: 1 + Math.random() * (1.4 * s.wobble), s1: 0.45 + Math.random() * (0.9 * s.wobble),
        path: pathThrough([
          { x: 0, y: 0 },
          { x: Math.random() * (s.spread * 2 * m) - s.spread * m, y: Math.random() * -20 },
          { x: Math.random() * (s.spread * 2.4 * m) - s.spread * 1.2 * m, y: Math.random() * -50 - 50 },
          { x: Math.random() * (s.spread * m) - (s.spread * m) / 2, y: (-150 + Math.random() * -100) * Math.min(1.35, 1 + (m - 1) * 0.6) }
        ])
      });
    }
    function addEmber(now) {
      if (embers.length >= MAX_EMBERS) return;
      var time = (2 + Math.random() * 1.5) * (0.3 + Math.random() * 0.6), k = Math.random();
      embers.push({
        born: now, life: time * 1000, img: emberImgs[Math.floor(Math.random() * emberImgs.length)],
        sx: 0.4 * k, sy: 0.5 * k,
        path: pathThrough([
          { x: Math.random() * 160 - 80, y: -100 },
          { x: Math.random() * 260 - 130, y: -100 + Math.random() * -20 },
          { x: Math.random() * 280 - 140, y: -100 + Math.random() * -50 },
          { x: Math.random() * 320 - 160, y: -200 + Math.random() * -50 },
          { x: Math.random() * 380 - 190, y: -250 + Math.random() * -100 },
          { x: Math.random() * 620 - 310, y: -500 + Math.random() * -150 }
        ])
      });
    }

    function idle() {
      if (visible || embers.length) return false;
      for (var i = 0; i < layers.length; i++) if (layers[i].blobs.length) return false;
      return true;
    }

    function frame(now) {
      raf = 0;
      if (idle()) {
        if (dirty) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }
        return;
      }
      if (!onScreen || !W || !H) { last = 0; return; } // resumes when seen again (observers call run)
      var dt = last ? Math.min(100, now - last) : 16;
      last = now;
      if (visible) {
        for (var li = 0; li < layers.length; li++) {
          var L0 = layers[li];
          L0.due += dt;
          while (L0.due >= FLAME_EVERY) { L0.due -= FLAME_EVERY; addFlame(L0, now); }
        }
        emberDue += dt;
        while (emberDue >= EMBER_EVERY) { emberDue -= EMBER_EVERY; addEmber(now); }
      }
      // the stoke: every layer but the last swells to 1.15 × 1.2 in 0.3s, then
      // bounces back to 1 over 1.4s, always from each layer's own size
      if (stoke !== null) {
        var st = now - stoke;
        for (var i = 0; i < layers.length - 1; i++) {
          var from = layers[i].s.scale;
          if (st < 300) {
            var u = ease.p2out(st / 300);
            layers[i].scaleX = from + (1.15 - from) * u;
            layers[i].scaleY = from + (1.2 - from) * u;
          } else {
            var v = ease.bounceOut(Math.min(1, (st - 300) / 1400));
            layers[i].scaleX = 1.15 + (1 - 1.15) * v;
            layers[i].scaleY = 1.2 + (1 - 1.2) * v;
          }
        }
        if (st >= 1700) stoke = null;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty = true;
      // centred, 90% down the box; then the flames' own scale (per stamped pixel: ÷ SUPER)
      var base = dpr * extra * WIDTH_SCALE;
      var px = base / SUPER;
      var ox = (W / 2) * dpr, oy = H * 0.9 * dpr;

      // embers first: they're under the flames
      var en = 0;
      for (var ei = 0; ei < embers.length; ei++) {
        var e = embers[ei], et = (now - e.born) / e.life;
        if (et >= 1) continue;
        embers[en++] = e;
        var ep = e.path(ease.p1out(et), pt);
        ctx.globalAlpha = groupAlpha * (et < 0.5 ? 1 : 1 - ease.p1out((et - 0.5) / 0.5));
        ctx.setTransform(px * e.sx, 0, 0, px * e.sy, ox + ep.x * base, oy + ep.y * base);
        ctx.drawImage(e.img, -e.img.width / 2, -e.img.height / 2);
      }
      embers.length = en;

      for (var k = 0; k < layers.length; k++) {
        var L = layers[k], img = L.img;
        var lx = ox + L.s.x * base, ly = oy + L.y * base;
        var blobs = L.blobs, n = 0, hw = img.width / 2, hh = img.height / 2;
        ctx.globalAlpha = Math.min(1, groupAlpha * L.alpha * L.fireAlpha);
        for (var bi = 0; bi < blobs.length; bi++) {
          var b = blobs[bi], t = (now - b.born) / b.life;
          if (t >= 1) continue;
          blobs[n++] = b;
          var p = b.path(t, pt);
          var sc = b.s0 + (b.s1 - b.s0) * ease.p1out(t);
          // the layer's pivot (0, 10) and scale, then the blob's own
          ctx.setTransform(px * L.scaleX * sc, 0, 0, px * L.scaleY * sc, lx + L.scaleX * p.x * base, ly + L.scaleY * (p.y - 10) * base);
          ctx.drawImage(img, -hw, -hh);
        }
        blobs.length = n;
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    function run() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

    /** How big the fire burns: one 🔥 to eight grows it, eight to forty is its overdrive. */
    function setIntensity(n) {
      count = Math.max(0, n || 0);
      var baseCap = 8, overdriveCap = 40;
      var normalized = Math.min(count, baseCap) / baseCap;
      var overdriveNorm = Math.min(Math.max(0, count - baseCap) / (overdriveCap - baseCap), 1);
      visible = count > 0;
      var heightProgress = 0.32 + normalized * 0.68 + overdriveNorm * 0.35;
      motion = 1 + overdriveNorm * 0.9;
      groupAlpha = visible ? Math.min(1, 0.28 + normalized * 0.58 + overdriveNorm * 0.28) : 0;
      layers.forEach(function (L, i) {
        L.y = L.s.offset * heightProgress;
        var weight = 1 - i / (layers.length * 1.35);
        L.fireAlpha = visible ? Math.min((0.08 + normalized * 0.62 + overdriveNorm * 0.28) * weight * L.coreBoost, 1) : 0;
        L.alpha = visible ? Math.min(1, 0.88 + overdriveNorm * 0.18) : 0;
      });
      if (!visible) { embers.length = 0; layers.forEach(function (L) { L.blobs.length = 0; L.due = 0; }); emberDue = 0; stoke = null; }
      run();
    }

    // follow the box's size, and rest while it's off screen
    var ro = null, io = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(resize); ro.observe(box); }
    else window.addEventListener("resize", resize);
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(function (entries) {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) run();
      });
      io.observe(box);
    }
    // the screen's density changes (a window dragged to another screen, or zoom)
    var dprQuery = null;
    function watchDpr() {
      if (!window.matchMedia) return;
      if (dprQuery) dprQuery.removeEventListener("change", onDpr);
      dprQuery = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
      dprQuery.addEventListener("change", onDpr);
    }
    function onDpr() { resize(); watchDpr(); }
    watchDpr();

    resize();
    setIntensity(0);

    return {
      setIntensity: setIntensity,
      /** A new 🔥: grow, a burst of embers, the swell (only the growing with reduced motion). */
      ignite: function (n) {
        if (typeof n === "number") setIntensity(n);
        if (reduced && reduced.matches) return;
        var amount = Math.round((40 + Math.round(Math.random() * 20)) * Math.max(0.5, Math.min((count || 1) / 2.6, 6)));
        var now = performance.now();
        for (var i = 0; i < amount; i++) addEmber(now);
        stoke = now;
        run();
      },
      setScale: function (k) {
        k = Number(k) > 0 ? Number(k) : 1;
        if (k !== extra) { extra = k; resize(); }
      },
      resize: resize,
      destroy: function () {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
        if (io) io.disconnect();
        if (dprQuery) dprQuery.removeEventListener("change", onDpr);
        canvas.remove();
      },
      canvas: canvas
    };
  };
})();
