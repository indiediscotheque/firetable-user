/**
 * flame.js — the room's fire for the live stage (embed/stage/), drawn with a
 * plain 2D canvas: no libraries to load.
 *
 * A port of the site's fire (js/fire.js, PixiJS + GSAP) that keeps its look:
 * the same nine flame layers (colours, sizes, offsets, spread, wobble), the
 * same blob lifetimes, paths and easing, the same embers and stoke bursts,
 * and the same intensity curve from one fire to an overdrive at forty. When
 * changing one, change the other.
 *
 *   var f = stageFlame(document.getElementById("fyre"));
 *   f.ignite(count);      // a new 🔥: grow to `count` and stoke it
 *   f.setIntensity(0);    // out (stops drawing)
 *   f.setScale(k);        // its size, as a multiple of the site's
 */
(function () {
  "use strict";

  // ─── GSAP's eases, as js/fire.js uses them ──────────────────────────────
  var ease = {
    linear: function (t) { return t; },
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

  /** A path through the points (GSAP's bezier "thru"), timed by length so it moves steadily. */
  function pathThrough(pts) {
    var seg = [], total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) || 0.0001;
      seg.push(d);
      total += d;
    }
    return function (t) {
      var at = Math.max(0, Math.min(1, t)) * total, i = 0;
      while (i < seg.length - 1 && at > seg[i]) { at -= seg[i]; i++; }
      var u = at / seg[i];
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      var u2 = u * u, u3 = u2 * u;
      // Catmull-Rom through p1 → p2
      return {
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3)
      };
    };
  }

  /** A filled circle, drawn once and stamped many times (js/fire.js createCircleTexture). */
  var dots = {};
  function dot(radius, color) {
    var key = radius + ":" + color;
    if (dots[key]) return dots[key];
    var size = Math.max(2, Math.ceil(radius * 2));
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var x = c.getContext("2d");
    x.fillStyle = color;
    x.beginPath();
    x.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    x.fill();
    return (dots[key] = c);
  }

  // js/fire.js Stage: the layers, back to front
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
  var WIDTH_SCALE = 0.75 * 0.59; // js/fire.js widthScale

  window.stageFlame = function (box) {
    var canvas = document.createElement("canvas");
    box.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, dpr = 1, extra = 1;
    var layers = LAYERS.map(function (s) {
      return { s: s, y: s.offset, scaleX: s.scale, scaleY: s.scale, fireAlpha: 0.7, alpha: 1, coreBoost: s.coreBoost || 1, blobs: [], due: 0 };
    });
    var embers = [], emberDue = 0;
    var groupAlpha = 0, visible = false, motion = 1, count = 0;
    var stoke = null, raf = 0, last = 0;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      W = box.clientWidth || 320;
      H = box.clientHeight || 224;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
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
      var time = (2 + Math.random() * 1.5) * (0.3 + Math.random() * 0.6), k = Math.random();
      embers.push({
        born: now, life: time * 1000, color: EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
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

    function frame(now) {
      raf = 0;
      if (!visible && !embers.length && layers.every(function (L) { return !L.blobs.length; })) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      var dt = last ? Math.min(100, now - last) : 16;
      last = now;
      if (visible) {
        // each layer adds a blob every 50ms, the embers one every 300ms (js/fire.js intervals)
        layers.forEach(function (L) { L.due += dt; while (L.due >= 50) { L.due -= 50; addFlame(L, now); } });
        emberDue += dt;
        while (emberDue >= 300) { emberDue -= 300; addEmber(now); }
      }
      // the stoke: every layer but the last swells to 1.15 × 1.2 in 0.3s, then
      // bounces back to 1 over 1.4s; like GSAP's restart(), always from each
      // layer's own size (js/fire.js stokeAnimation)
      if (stoke !== null) {
        var t = now - stoke;
        for (var i = 0; i < layers.length - 1; i++) {
          var from = layers[i].s.scale;
          if (t < 300) {
            var u = ease.p2out(t / 300);
            layers[i].scaleX = from + (1.15 - from) * u;
            layers[i].scaleY = from + (1.2 - from) * u;
          } else {
            var v = ease.bounceOut(Math.min(1, (t - 300) / 1400));
            layers[i].scaleX = 1.15 + (1 - 1.15) * v;
            layers[i].scaleY = 1.2 + (1 - 1.2) * v;
          }
        }
        if (t >= 1700) stoke = null;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // the site's stage: centred, 90% down; then the flames' own scale
      var base = dpr * extra * WIDTH_SCALE;
      var ox = (W / 2) * dpr, oy = H * 0.9 * dpr;

      // embers first (they're under the flames in js/fire.js)
      embers = embers.filter(function (e) {
        var t = (now - e.born) / e.life;
        if (t >= 1) return false;
        var p = e.path(ease.p1out(t));
        var a = t < 0.5 ? 1 : 1 - ease.p1out((t - 0.5) / 0.5);
        var img = dot(10, e.color);
        ctx.globalAlpha = groupAlpha * a;
        ctx.setTransform(base * e.sx, 0, 0, base * e.sy, ox + p.x * base, oy + p.y * base);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        return true;
      });

      layers.forEach(function (L) {
        var img = dot(L.s.radius, L.s.color);
        var lx = ox + L.s.x * base, ly = oy + L.y * base;
        L.blobs = L.blobs.filter(function (b) {
          var t = (now - b.born) / b.life;
          if (t >= 1) return false;
          var p = b.path(t);
          var sc = b.s0 + (b.s1 - b.s0) * ease.p1out(t);
          // the layer's pivot (0, 10) and scale, then the blob's own
          var x = lx + L.scaleX * p.x * base, y = ly + L.scaleY * (p.y - 10) * base;
          ctx.globalAlpha = Math.min(1, groupAlpha * L.alpha * L.fireAlpha);
          ctx.setTransform(base * L.scaleX * sc, 0, 0, base * L.scaleY * sc, x, y);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
          return true;
        });
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    function run() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }

    /** js/fire.js setIntensity, number for number. */
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
      if (visible) run();
    }

    resize();
    window.addEventListener("resize", resize);
    setIntensity(0);

    return {
      setIntensity: setIntensity,
      /** A new 🔥 (js/fire.js ignite): grow, a burst of embers, the swell. */
      ignite: function (n) {
        if (typeof n === "number") setIntensity(n);
        var amount = Math.round((40 + Math.round(Math.random() * 20)) * Math.max(0.5, Math.min((count || 1) / 2.6, 6)));
        var now = performance.now();
        for (var i = 0; i < amount; i++) addEmber(now);
        stoke = now;
        run();
      },
      setScale: function (k) { extra = k; resize(); },
      canvas: canvas
    };
  };
})();
