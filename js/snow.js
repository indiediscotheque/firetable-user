/**
 * snow.js — Subtle seasonal snowfall on the stage.
 *
 * Draws on a canvas layered over the stage backdrop and screen, behind the
 * DJs. Runs only in the snow months (January and February by default, see
 * SNOW_MONTHS / ftconfigs.snowMonths), pauses while the tab is hidden, and
 * stays off for visitors who prefer reduced motion.
 *
 * Depends on: firetable.utilities.seasonalSnow (helpers.js)
 */

firetable.snow = (function () {
  var MAX_FLAKES = 120;
  var AREA_PER_FLAKE = 5000; // px² of stage per flake
  var MAX_DPR = 2;

  var canvas = null;
  var ctx = null;
  var flakes = [];
  var width = 0;
  var height = 0;
  var dpr = 1;
  var running = false;
  var frame = 0;
  var lastTime = 0;
  var resizeObserver = null;
  var reducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function makeFlake(anywhere) {
    var depth = Math.random(); // 0 = far, 1 = near
    return {
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : -4,
      r: 0.6 + depth * 1.6,
      speed: 10 + depth * 28,               // px per second
      drift: (Math.random() - 0.5) * 8,     // steady sideways px per second
      sway: 4 + Math.random() * 10,         // sway amplitude px
      phase: Math.random() * Math.PI * 2,
      freq: 0.4 + Math.random() * 0.8,      // sway speed
      alpha: 0.2 + depth * 0.45
    };
  }

  function targetCount() {
    return Math.min(MAX_FLAKES, Math.round((width * height) / AREA_PER_FLAKE));
  }

  function resize() {
    if (!canvas) return;
    var stage = canvas.parentNode;
    width = stage.clientWidth;
    height = stage.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var want = targetCount();
    while (flakes.length < want) flakes.push(makeFlake(true));
    flakes.length = want;
  }

  function tick(now) {
    if (!running) return;
    var dt = Math.min((now - (lastTime || now)) / 1000, 0.1); // cap after stalls
    lastTime = now;
    var t = now / 1000;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.y += f.speed * dt;
      f.x += f.drift * dt;
      if (f.y - f.r > height) {
        flakes[i] = f = makeFlake(false);
      }
      if (f.x < -10) f.x += width + 20;
      else if (f.x > width + 10) f.x -= width + 20;

      ctx.globalAlpha = f.alpha;
      ctx.beginPath();
      ctx.arc(f.x + Math.sin(t * f.freq + f.phase) * f.sway, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (running || !canvas || document.hidden) return;
    running = true;
    lastTime = 0;
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    running = false;
    cancelAnimationFrame(frame);
  }

  function enable() {
    if (canvas) return;
    var stage = document.getElementById("djStage");
    if (!stage) return;
    canvas = document.createElement("canvas");
    canvas.id = "stageSnow";
    canvas.setAttribute("aria-hidden", "true");
    // Above the backdrop and screen, below the DJs and string lights.
    var screenBox = document.getElementById("screenBox");
    stage.insertBefore(canvas, screenBox ? screenBox.nextSibling : stage.firstChild);
    ctx = canvas.getContext("2d");
    flakes = [];
    resize();
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
    } else {
      window.addEventListener("resize", resize);
    }
    requestAnimationFrame(function () { if (canvas) canvas.classList.add("on"); });
    start();
  }

  function disable() {
    if (!canvas) return;
    pause();
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener("resize", resize);
    resizeObserver = null;
    canvas.remove();
    canvas = ctx = null;
    flakes = [];
  }

  /** Turn snow on or off for today's date and the visitor's motion setting. */
  function sync() {
    var want = firetable.utilities.seasonalSnow(new Date()) && !(reducedMotion && reducedMotion.matches);
    if (want) enable();
    else disable();
  }

  function init() {
    sync();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pause();
      else start();
    });
    if (reducedMotion) {
      if (reducedMotion.addEventListener) reducedMotion.addEventListener("change", sync);
      else if (reducedMotion.addListener) reducedMotion.addListener(sync);
    }
    // Re-check hourly so an open tab starts on Jan 1 and stops on Mar 1.
    setInterval(sync, 60 * 60 * 1000);
  }

  return { init: init, sync: sync };
})();
