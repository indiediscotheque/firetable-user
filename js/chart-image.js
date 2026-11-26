/**
 * chart-image.js — Discover's Share → Save as an image: the chart on show as
 * a picture (1080 × 1350, for posts and stories), drawn on a canvas in the
 * site's colours and type, then saved as a file, or handed to a phone's share
 * sheet.
 *
 * Most visits never make one, so js/discover.js loads this the first time
 * (js/lazy.js, ftLazy.own) and hands it the chart:
 *   firetable.chartImage({ title, file, rows: [{ t, a, plays, art }] })
 * The ranks and the plays line up right: a canvas has no equal-width digits.
 */
firetable.chartImage = (function () {
  "use strict";
  var W = 1080, H = 1350, PAD = 72;
  var TOP = PAD + 260, ROW_H = 86;  // where the songs start, and each one's height
  // a song's cover box, beside its rank, then where its words start and how wide they may be
  var AX = PAD + 64, AW = 112, AH = 63;
  var TX = AX + AW + 28, TW = W - PAD - TX - 170;

  /** A picture, or null when it won't load (its row keeps the grey box). */
  function load(src) {
    return new Promise(function (ok) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { ok(img); };
      img.onerror = function () { ok(null); };
      img.src = src;
    });
  }

  /** The text, cut short with … to fit max pixels in the canvas's font. */
  function fit(g, text, max) {
    text = String(text || "");
    if (g.measureText(text).width <= max) return text;
    while (text.length > 1 && g.measureText(text + "…").width > max) text = text.slice(0, -1);
    return text + "…";
  }

  /** Words in one font and colour: cut to max when given, and ending at x when right. */
  function write(g, font, colour, text, x, y, max, right) {
    g.font = font;
    g.fillStyle = colour;
    g.textAlign = right ? "right" : "left";
    g.fillText(max ? fit(g, text, max) : String(text), x, y);
  }

  /** The dark page, the :id: logo, the room's name, "Room chart" and which one. */
  function drawHead(g, logo, title) {
    g.fillStyle = "#181818";
    g.fillRect(0, 0, W, H);
    if (logo) g.drawImage(logo, PAD, PAD, 96, 48);
    write(g, "700 22px Inter", "#b3b3b3", String(ftconfigs.roomName || "").toUpperCase(), PAD + 120, PAD + 34);
    write(g, "700 64px Inter", "#ffffff", "Room chart", PAD, PAD + 150);
    write(g, "500 30px Inter", "#cc9933", title, PAD, PAD + 200, W - PAD * 2);
  }

  /** One song: its rank, its cover (the middle of it, at 16:9), title, artist and plays, and a line under it. */
  function drawRow(g, t, art, i) {
    var y = TOP + i * ROW_H;
    write(g, "700 28px Inter", "#ffffff", String(i + 1), PAD + 40, y + 46, 0, true);
    g.fillStyle = "#282828";
    g.fillRect(AX, y + 8, AW, AH);
    if (art) {
      var sh = art.width * (AH / AW) > art.height ? art.height : art.width * (AH / AW);
      g.drawImage(art, 0, (art.height - sh) / 2, art.width, sh, AX, y + 8, AW, AH);
    }
    write(g, "500 30px Inter", "#ffffff", t.t, TX, y + 36, TW);
    write(g, "400 24px Inter", "#b3b3b3", t.a, TX, y + 68, TW);
    write(g, "400 22px Inter", "#888888", firetable.utilities.pluralize(t.plays, "play", "plays"), W - PAD, y + 50, 0, true);
    g.fillStyle = "#333333";
    g.fillRect(PAD, y + ROW_H - 2, W - PAD * 2, 1);
  }

  /** The picture to a phone's share sheet, or saved as a file. */
  function save(canvas, file, title) {
    canvas.toBlob(function (blob) {
      if (!blob) return firetable.ui.toast("Couldn't make the image.", "error");
      var f = typeof File === "function" ? new File([blob], file, { type: "image/png" }) : null;
      if (f && navigator.canShare && navigator.canShare({ files: [f] }) && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
        navigator.share({ files: [f], title: "Room chart · " + title }).catch(function () {});
        return;
      }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      firetable.ui.toast("Saved " + file, "success");
    }, "image/png");
  }

  /**
   * Draw the chart, once its type, the logo and the covers are here, and save it.
   * @param {{title: string, file: string, rows: Array<{t: string, a: string, plays: number, art: string}>}} chart
   * @returns {Promise}
   */
  return function (chart) {
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var g = canvas.getContext("2d");
    var fonts = document.fonts && document.fonts.load ? Promise.all(["700 40px Inter", "500 30px Inter", "400 24px Inter"].map(function (f) { return document.fonts.load(f); })) : Promise.resolve();
    return Promise.all([fonts, load("img/idlogo.png")].concat(chart.rows.map(function (t) { return load(t.art); }))).then(function (got) {
      drawHead(g, got[1], chart.title);
      chart.rows.forEach(function (t, i) { drawRow(g, t, got[i + 2], i); });
      write(g, "500 26px Inter", "#cc9933", location.host.replace(/^www\./, "") + "/music/charts/", PAD, H - PAD + 10);
      save(canvas, chart.file, chart.title);
    });
  };
})();
