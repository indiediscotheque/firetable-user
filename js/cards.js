/**
 * cards.js — DJ card rendering on HTML5 Canvas.
 *
 * DJ cards are collectible items showing a song that was played, the DJ who
 * played it, album art, and a unique card number. They can be shared in chat
 * or gifted to the current DJ.
 *
 * Special card styles are selected via data.special (classic, id8, id9, v2).
 */

firetable.actions = firetable.actions || {};

firetable.actions.markCardRendered = function (cardid) {
  var $spot = $('#caseCardSpot' + cardid);
  if (!$spot.length) return;

  requestAnimationFrame(function () {
    $spot.addClass('is-rendered');
  });
};

$(document)
  .off('click.cardStatsToggle')
  .on('click.cardStatsToggle', '#cardStats .hist-day-header', function () {
    var $group = $(this).closest('.hist-day-group');
    $group.toggleClass('collapsed');
    $(this).attr('aria-expanded', String(!$group.hasClass('collapsed')));
  })
  .off('input.cardFilters change.cardFilters')
  .on('input.cardFilters change.cardFilters', '#cardFilterRow input, #cardFilterRow select', function () {
    firetable.actions.applyCardFilters();
  });

/**
 * Build a stats panel for the current card collection.
 * @param {Object} data - Card collection keyed by card ID
 * @returns {string} HTML for the stats panel
 */
firetable.actions.renderCardStats = function (data) {
  var keys = Object.keys(data || {});
  var total = keys.length;
  var minTemp = null;
  var maxTemp = null;
  var perDj = {};

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  keys.forEach(function (key) {
    var card = data[key] || {};
    var dj = (card.djname || 'Unknown DJ').trim() || 'Unknown DJ';
    var temp = Number(card.temp);

    perDj[dj] = (perDj[dj] || 0) + 1;

    if (!isNaN(temp)) {
      if (minTemp === null || temp < minTemp) minTemp = temp;
      if (maxTemp === null || temp > maxTemp) maxTemp = temp;
    }
  });

  var djRows = Object.keys(perDj).sort(function (a, b) {
    if (perDj[b] !== perDj[a]) return perDj[b] - perDj[a];
    return a.localeCompare(b);
  }).map(function (name) {
    return (
      '<span class="cardStatDjRow">' +
      '<span class="cardStatDjName">' + escapeHtml(name) + '</span>' +
      '<span class="cardStatDjCount">' + perDj[name] + '</span>' +
      '</span>'
    );
  }).join('');

  var djOptions = Object.keys(perDj).sort(function (a, b) {
    return a.localeCompare(b);
  }).map(function (name) {
    var safeName = escapeHtml(name);
    return '<option value="' + safeName + '">' + safeName + '</option>';
  }).join('');

  return (
    '<section id="cardStats">' +
    '<div class="cardStatsSummary">' +
    '<div class="cardStatTile"><span class="cardStatLabel">Total Cards</span><span class="cardStatValue">' + total + '</span></div>' +
    '<div class="cardStatTile"><span class="cardStatLabel">Unique DJs</span><span class="cardStatValue">' + Object.keys(perDj).length + '</span></div>' +
    '<div class="cardStatTile"><span class="cardStatLabel">Lowest Temp</span><span class="cardStatValue">' + (minTemp === null ? '--' : (minTemp + '°')) + '</span></div>' +
    '<div class="cardStatTile"><span class="cardStatLabel">Highest Temp</span><span class="cardStatValue">' + (maxTemp === null ? '--' : (maxTemp + '°')) + '</span></div>' +
    '</div>' +
    '<div class="cardStatDjBreakdown hist-day-group collapsed">' +
    '<div class="hist-day-header" role="button" aria-expanded="false">Cards Per DJ</div>' +
    '<div class="hist-day-items cardStatDjList">' + djRows + '</div>' +
    '</div>' +
    '<div id="cardFilterRow" class="cardFilterRow">' +
    '<div class="cardFilterControl"><input id="cardFilterText" class="cardFilterInput" type="text" placeholder="Search cards" aria-label="Filter cards by text" /></div>' +
    '<div class="cardFilterControl"><select id="cardFilterDj" class="cardFilterSelect" aria-label="Filter cards by DJ"><option value="">All DJs</option>' + djOptions + '</select></div>' +
    '<div class="cardFilterControl"><select id="cardSortBy" class="cardFilterSelect" aria-label="Sort cards by"><option value="cardnum">Card Number</option><option value="djname">DJ Name</option><option value="temp">Temp</option><option value="num">Num</option></select></div>' +
    '</div>' +
    '</section>'
  );
};

firetable.actions.applyCardFilters = function () {
  var $spots = $('#cardsMain .caseCardSpot');
  if (!$spots.length) return;

  var textFilter = String($('#cardFilterText').val() || '').toLowerCase().trim();
  var djFilter = String($('#cardFilterDj').val() || '').trim();
  var sortBy = String($('#cardSortBy').val() || 'cardnum');
  var spots = $spots.get();

  spots.sort(function (a, b) {
    var $a = $(a);
    var $b = $(b);
    var aVal;
    var bVal;

    if (sortBy === 'djname') {
      aVal = String($a.data('djname') || '');
      bVal = String($b.data('djname') || '');
      var byName = aVal.localeCompare(bVal);
      if (byName !== 0) return byName;
    } else {
      aVal = Number($a.data(sortBy));
      bVal = Number($b.data(sortBy));
      if (isNaN(aVal)) aVal = Number.POSITIVE_INFINITY;
      if (isNaN(bVal)) bVal = Number.POSITIVE_INFINITY;
      if (aVal !== bVal) return bVal - aVal;
    }

    return String($b.data('cardkey') || '').localeCompare(String($a.data('cardkey') || ''));
  });

  spots.forEach(function (spot) {
    var $spot = $(spot);
    var matchesText = !textFilter || String($spot.data('search') || '').indexOf(textFilter) !== -1;
    var matchesDj = !djFilter || String($spot.data('djname') || '') === djFilter;
    var visible = matchesText && matchesDj;
    $spot.toggle(visible);
    $('#cardsMain').append($spot);
  });
};

/**
 * Open the card case modal and render all cards the user owns.
 */
firetable.actions.cardCase = function () {
  $("#cardsMain").html("");
  ftapi.lookup.cardCollection(function (data) {
    if (!data) {
      var $empty = $('<p class="cardsEmpty"><span class="emoji">📭</span><br />You don\'t have any cards yet.</p>');
      $("#cardsMain").html($empty);
      twemoji.parse($("#cardsMain")[0]);
      return;
    }
    $("#cardsMain").append(firetable.actions.renderCardStats(data));
    for (var key in data) {
      if (!data.hasOwnProperty(key)) continue;
      var childData = data[key];
      firetable.debug && console.log('card:', childData);
      $("#cardsMain").append(
        '<span id="caseCardSpot' + key + '" class="caseCardSpot">' +
        '<canvas width="225" height="300" class="caseCard" id="cardMaker' + key + '"></canvas>' +
        '<span role="button" onclick="firetable.actions.giftCard(\'' + key + '\')" class="cardGiftChat">Gift to DJ</span>' +
        '<span role="button" onclick="firetable.actions.chatCard(\'' + key + '\')" class="cardShareChat">Share In Chat</span>' +
        '<span role="button" onclick="firetable.actions.viewLargerCard(\'' + key + '\')" class="cardViewLarger">View Larger</span>' +
        '</span>'
      );

      var $spot = $('#caseCardSpot' + key);
      var djName = String(childData.djname || 'Unknown DJ').trim() || 'Unknown DJ';
      var title = String(childData.title || '');
      var artist = String(childData.artist || '');
      var cardNum = Number(childData.cardnum);
      var temp = Number(childData.temp);
      var num = Number(childData.num);
      var searchText = [djName, title, artist, childData.cardnum, childData.num, childData.temp]
        .join(' ')
        .toLowerCase();

      $spot.data('cardkey', key);
      $spot.data('djname', djName);
      $spot.data('title', title);
      $spot.data('artist', artist);
      $spot.data('cardnum', isNaN(cardNum) ? Number.POSITIVE_INFINITY : cardNum);
      $spot.data('temp', isNaN(temp) ? Number.POSITIVE_INFINITY : temp);
      $spot.data('num', isNaN(num) ? Number.POSITIVE_INFINITY : num);
      $spot.data('search', searchText);
      $spot.removeClass('is-rendered');

      firetable.actions.displayCard(childData, key);
    }

    firetable.actions.applyCardFilters();
  });
};

/**
 * Share a card in chat (sends a message with the card ID attached).
 * @param {string} cardid - Card key
 */
firetable.actions.chatCard = function (cardid) {
  ftapi.actions.sendChat("Check out my card...", cardid);
};

/**
 * Open a near-fullscreen modal showing just the card canvas.
 * @param {string} cardid - Card key
 */
firetable.actions.viewLargerCard = function (cardid) {
  var $src = $('#cardMaker' + cardid);
  if (!$src.length) return;
  // Clone the canvas and draw the source into it at native resolution
  var srcCanvas = $src[0];
  var $dest = $('#cardViewLargerCanvas');
  var dest = $dest[0];
  dest.width  = srcCanvas.width;
  dest.height = srcCanvas.height;
  dest.getContext('2d').drawImage(srcCanvas, 0, 0);
  $('#overlay').addClass('show');
  $('#cardViewLargerModal').addClass('show');
};

/**
 * Gift a card to the current DJ (removes it from your collection).
 * @param {string} cardid - Card key
 */
firetable.actions.giftCard = function (cardid) {
  ftapi.actions.sendChat("!giftcard :gift:", cardid);
  $("#caseCardSpot" + cardid).remove();
};

/**
 * Fetch card data from the server and render it on a canvas.
 * Used when a card is shared in chat.
 * @param {string} cardid - Card key
 * @param {string} chatid - Chat element ID (for the canvas target)
 */
firetable.actions.showCard = function (cardid, chatid) {
  ftapi.lookup.card(cardid, function (data) {
    firetable.actions.displayCard(data, chatid);
  });
};

/**
 * Render a DJ card onto a canvas element.
 *
 * Layout (225×300px):
 * - Top bar: DJ name + coloured circle with card number
 * - Centre: Avatar image overlaid on gradient
 * - Accent stripe: Card metadata (number, temperature)
 * - Bottom: Song title, artist, album art thumbnail, date
 *
 * @param {Object} data - Card data from the server
 * @param {string} data.djname - DJ's display name
 * @param {string} data.djid - DJ's user ID
 * @param {string} data.title - Song title
 * @param {string} data.artist - Artist name
 * @param {string} data.image - Album art URL
 * @param {Object} data.colors - {color, txt} accent colours
 * @param {number} data.cardnum - Unique card serial number
 * @param {string} data.num - Display number (single digit on circle badge)
 * @param {number} data.temp - "Max operating temperature" gag value
 * @param {number} data.date - Timestamp when the card was created
 * @param {string} [data.set] - Robohash set override
 * @param {string|boolean} [data.special] - Card style key: false/empty (classic), "id8", "id9", or "v2"
 * @param {string} chatid - Suffix for the canvas element ID ("cardMaker" + chatid)
 */
firetable.actions.displayCard = function (data, chatid) {
  firetable.debug && console.log("display card");

  function finishCardRender() {
    firetable.actions.markCardRendered(chatid);
  }

  // ── Normalize colours ──
  var defaultScheme = false;
  if (data.colors) {
    if (data.colors.color === "#fff" || data.colors.color === "#7f7f7f") {
      data.colors.color = firetable.orange;
      data.colors.txt = "#000";
      defaultScheme = true;
    }
  }

  // ── Default album art fallback ──
  if (data.image === "img/idlogo.png" && ftconfigs.defaultAlbumArtUrl.length) {
    data.image = ftconfigs.defaultAlbumArtUrl;
  }

  var set = data.set || "set1";
  var canvas = document.getElementById('cardMaker' + chatid);
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  var accentColor = (data.colors && data.colors.color) || firetable.orange;
  var accentText = (data.colors && data.colors.txt) || "#fff";
  var accentRgb = firetable.utilities.hexToRGB(accentColor) || { r: 244, g: 129, b: 11 };
  var specialName = (data.special === false || data.special === null || typeof data.special === "undefined")
    ? ""
    : String(data.special).toLowerCase().trim();
  var isV2Theme = specialName === "v2";
  var anniversary = specialName === "id8" ? "id8" : (specialName === "id9" ? "id9" : "");
  var heroX = 16;
  var heroY = 16;
  var heroW = 193;
  var heroH = 150;

  // ── Classic card theme (default, id8, id9) ─────────────────────────────
  if (!isV2Theme) {
    // Base layers
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 225, 300);

    ctx.fillStyle = defaultScheme ? "#fff" : accentColor;
    ctx.fillRect(1, 30, 223, 175);

    var legGrd = ctx.createLinearGradient(0, 0, 0, 175);
    legGrd.addColorStop(0, "rgba(0,0,0,0.75)");
    legGrd.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = legGrd;
    ctx.fillRect(1, 30, 223, 175);

    ctx.fillStyle = accentColor;
    ctx.fillRect(1, 205, 223, 10);

    ctx.fillStyle = "#151515";
    ctx.fillRect(1, 216, 223, 75);

    // DJ name
    ctx.fillStyle = "#eee";
    ctx.font = "700 11px Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(data.djname, 10, 20);

    // Footer
    ctx.font = "400 8px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Printed " + firetable.utilities.format_date(data.date) + " | " + ftconfigs.roomNameShort, 112.5, 299);

    // Title + artist
    ctx.fillStyle = "#eee";
    ctx.font = "700 10px Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    var legacyLinez = firetable.utilities.wrapText(ctx, data.title, 66, 240, 160, 15);
    ctx.font = "400 8px Helvetica, Arial, sans-serif";
    firetable.utilities.wrapText(ctx, data.artist, 66, 253 + (15 * legacyLinez), 160, 15);

    // Card info strip
    ctx.fillStyle = accentText;
    ctx.font = "400 9px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Card No. " + data.cardnum + " | DJ Card | Max Operating Temp " + data.temp + "\u00b0", 112.5, 214);

    // Num badge
    ctx.beginPath();
    ctx.arc(205, 15, 12, 0, 2 * Math.PI, false);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.fillStyle = accentText;
    ctx.font = "700 15px Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(data.num || ""), 200.5, 20);

    // Standard legacy image loader: avatar then album art
    var legacyDoImages = function () {
      var legAvatar = new Image();
      legAvatar.onload = function () {
        if (!ctx) return;
        ctx.drawImage(this, 20, 30, 175, 175);
        if (data.image) {
          var legAlbum = new Image();
          legAlbum.onload = function () {
            if (!ctx) return;
            var legH = data.image.match(/ytimg\.com/i) ? 28 : 50;
            ctx.drawImage(this, 10, 230, 50, legH);
            ctx = null;
            finishCardRender();
          };
          legAlbum.onerror = function () {
            ctx = null;
            finishCardRender();
          };
          legAlbum.src = data.image;
        } else {
          ctx = null;
          finishCardRender();
        }
      };
      legAvatar.src = firetable.utilities.avatarURL(data.djid, data.djname, "175x175");
    };

    // Legacy special edition overlays
    if (anniversary === "id8") {
      ctx.fillStyle = accentColor;
      ctx.fillRect(1, 30, 223, 10);
      ctx.fillStyle = accentText;
      ctx.font = "400 10px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Celebrating 8 Years of Indie Discotheque", 112.5, 38);

      var legCake = new Image();
      legCake.onload = function () {
        var c = canvas.getContext('2d');
        if (!c) return;
        c.drawImage(this, 10, 50, 35, 35);
        var legEight = new Image();
        legEight.onload = function () {
          var c2 = canvas.getContext('2d');
          if (!c2) return;
          c2.drawImage(this, 180, 50, 35, 35);
          legacyDoImages();
        };
        legEight.src = 'img/8.png';
      };
      legCake.src = 'img/cake.png';

    } else if (anniversary === "id9") {
      ctx.fillStyle = accentColor;
      ctx.fillRect(1, 30, 223, 10);
      ctx.fillStyle = accentText;
      ctx.font = "400 10px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Celebrating 9 Years of Indie Discotheque", 112.5, 38);

      var legArnold = new Image();
      legArnold.onload = function () {
        var c = canvas.getContext('2d');
        if (!c) return;
        c.drawImage(this, 5, 50, 45, 45);
        var legRobot = new Image();
        legRobot.onload = function () {
          var c2 = canvas.getContext('2d');
          if (!c2) return;
          c2.save();
          c2.translate(75 * 0.5, 75 * 0.5);
          c2.rotate(0.959931);
          c2.translate(-75 * 0.5, -75 * 0.5);
          c2.drawImage(this, 125, -81, 75, 75);
          c2.restore();
          var legId9 = new Image();
          legId9.onload = function () {
            var c3 = canvas.getContext('2d');
            if (!c3) return;
            c3.drawImage(this, 25, 40, 170, 170);
            var legAlbum2 = new Image();
            legAlbum2.onload = function () {
              var c4 = canvas.getContext('2d');
              if (!c4) return;
              var legH2 = data.image.match(/ytimg\.com/i) ? 28 : 50;
              c4.drawImage(this, 10, 230, 50, legH2);
              ctx = null;
              finishCardRender();
            };
            legAlbum2.onerror = function () {
              ctx = null;
              finishCardRender();
            };
            legAlbum2.src = data.image;
          };
          legId9.src = 'img/id9.png';
        };
        legRobot.src = firetable.utilities.avatarURL(data.djid, data.djname, "110x110");
      };
      legArnold.src = 'img/arnold.png';

    } else {
      legacyDoImages();
    }

    return;
  }
  // ── End legacy card theme ─────────────────────────────────────────────

  function roundedRect(x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fillRoundedRect(x, y, width, height, radius, color) {
    roundedRect(x, y, width, height, radius);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function strokeRoundedRect(x, y, width, height, radius, color, lineWidth) {
    roundedRect(x, y, width, height, radius);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function withRoundedClip(x, y, width, height, radius, drawFn) {
    ctx.save();
    roundedRect(x, y, width, height, radius);
    ctx.clip();
    drawFn();
    ctx.restore();
  }

  function drawTopLogo() {
    var slotX = 20;
    var slotY = 19;
    var slotH = 20;
    var padX = 4;
    var padY = 3;
    var logo = new Image();

    logo.onload = function () {
      var c = canvas.getContext('2d');
      if (!c) return;
      var logoRatio = logo.naturalWidth / logo.naturalHeight;
      var drawH = slotH - (padY * 2);
      var drawW = drawH * logoRatio;
      var drawX = slotX + padX;
      var drawY = slotY + padY;

      c.drawImage(logo, drawX, drawY, drawW, drawH);
    };
    logo.src = 'img/idlogo2.png';
  }

  function drawBaseCard() {
    var bg = ctx.createLinearGradient(0, 0, 225, 300);
    bg.addColorStop(0, "#08090d");
    bg.addColorStop(0.5, "#151925");
    bg.addColorStop(1, "#050608");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 225, 300);

    fillRoundedRect(8, 8, 209, 284, 20, "#0c1018");

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(118, 8);
    ctx.lineTo(217, 8);
    ctx.lineTo(217, 114);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.moveTo(8, 230);
    ctx.lineTo(94, 292);
    ctx.lineTo(8, 292);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    strokeRoundedRect(8, 8, 209, 284, 20, "rgba(255,255,255,0.08)", 1);
    strokeRoundedRect(13, 13, 199, 274, 16, "rgba(" + accentRgb.r + "," + accentRgb.g + "," + accentRgb.b + ",0.45)", 1.25);

    fillRoundedRect(heroX, heroY, heroW, heroH, 18, "#0b0d12");
    strokeRoundedRect(heroX, heroY, heroW, heroH, 18, "rgba(255,255,255,0.12)", 1);

    var heroOverlay = ctx.createLinearGradient(heroX, heroY, heroX, heroY + heroH);
    heroOverlay.addColorStop(0, "rgba(0,0,0,0.18)");
    heroOverlay.addColorStop(0.72, "rgba(0,0,0,0.01)");
    heroOverlay.addColorStop(1, "rgba(0,0,0,0.82)");
    fillRoundedRect(heroX, heroY, heroW, heroH, 18, heroOverlay);

    fillRoundedRect(16, 199, 193, 60, 16, "#11151f");
    fillRoundedRect(16, 252, 193, 32, 10, "rgba(255,255,255,0.06)");

    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(16, 155);
    ctx.lineTo(194, 155);
    ctx.lineTo(178, 190);
    ctx.lineTo(16, 190);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = accentText;
    ctx.font = "700 18px Inter, Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(data.djname, 24, 185);

    ctx.fillStyle = "rgba(255,255,255,0.56)";
    ctx.font = "600 12px Inter, Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(firetable.utilities.format_date(data.date), 24, 278);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 24px Inter, Helvetica, Arial, sans-serif";
    ctx.fillText(data.temp + "°", 203, 278);
    ctx.textAlign = "left";    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 13px Inter, Helvetica, Arial, sans-serif";
    var linez = firetable.utilities.wrapText(ctx, data.title, 24, 207, 118, 14);
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "400 9px Open Sans, Helvetica, Arial, sans-serif";
    firetable.utilities.wrapText(ctx, data.artist, 24, 220 + (linez * 14), 118, 11);
  }

  function drawHeroImage(image, backgroundImage, onDone) {
    withRoundedClip(heroX, heroY, heroW, heroH, 18, function () {
      if (backgroundImage) {
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.drawImage(backgroundImage, heroX, heroY, heroW, heroH);

        var bgShade = ctx.createLinearGradient(heroX, heroY, heroX, heroY + heroH);
        bgShade.addColorStop(0, "rgba(6,10,14,0.2)");
        bgShade.addColorStop(0.5, "rgba(6,10,14,0.34)");
        bgShade.addColorStop(1, "rgba(6,10,14,0.78)");
        ctx.fillStyle = bgShade;
        ctx.fillRect(heroX, heroY, heroW, heroH);

        ctx.globalAlpha = 0.18;
        ctx.fillStyle = accentColor;
        ctx.fillRect(heroX, heroY, heroW, heroH);
        ctx.restore();
      }

      var accentGlow = ctx.createRadialGradient(heroX + heroW * 0.82, heroY + 18, 10, heroX + heroW * 0.82, heroY + 18, 120);
      accentGlow.addColorStop(0, "rgba(" + accentRgb.r + "," + accentRgb.g + "," + accentRgb.b + ",0.48)");
      accentGlow.addColorStop(1, "rgba(" + accentRgb.r + "," + accentRgb.g + "," + accentRgb.b + ",0)");
      ctx.fillStyle = accentGlow;
      ctx.fillRect(heroX, heroY, heroW, heroH);

      var shade = ctx.createLinearGradient(heroX, heroY, heroX, heroY + heroH);
      shade.addColorStop(0, "rgba(6,10,14,0.08)");
      shade.addColorStop(0.58, "rgba(6,10,14,0.22)");
      shade.addColorStop(1, "rgba(6,10,14,0.9)");
      ctx.fillStyle = shade;
      ctx.fillRect(heroX, heroY, heroW, heroH);

      var imageRatio = image.naturalWidth / image.naturalHeight;
      var heroRatio = heroW / heroH;
      var drawW;
      var drawH;
      var drawX;
      var drawY;

      if (imageRatio > heroRatio) {
        drawW = heroW;
        drawH = drawW / imageRatio;
      } else {
        drawH = heroH;
        drawW = drawH * imageRatio;
      }

      drawX = heroX + ((heroW - drawW) / 2);
      drawY = heroY + (heroH - drawH);

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.drawImage(image, drawX, drawY, drawW, drawH);
      ctx.restore();
    });

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(heroX + 18, heroY + heroH - 24);
    ctx.lineTo(heroX + heroW - 18, heroY + heroH - 24);
    ctx.stroke();
    ctx.restore();

    onDone && onDone();
  }

  function drawAlbumBadge(image) {
    var albumX = 152;
    var albumY = 198;
    var albumW = 50;
    var albumH = image.src.match(/ytimg\.com/i) ? 33 : 50;
    var albumDrawY = albumY + ((50 - albumH) / 2);

    ctx.save();
    ctx.translate(albumX + 25, albumY + 25);
    ctx.rotate(-0.06);
    ctx.translate(-(albumX + 25), -(albumY + 25));
    fillRoundedRect(albumX - 3, albumY - 3, albumW + 6, 56, 12, "rgba(0,0,0,0.45)");
    fillRoundedRect(albumX, albumY, albumW, 50, 10, "rgba(255,255,255,0.08)");
    strokeRoundedRect(albumX, albumY, albumW, 50, 10, "rgba(255,255,255,0.22)", 1);
    withRoundedClip(albumX, albumY, albumW, 50, 10, function () {
      ctx.drawImage(image, albumX, albumDrawY, albumW, albumH);
      var stickerShade = ctx.createLinearGradient(albumX, albumY, albumX, albumY + 50);
      stickerShade.addColorStop(0, "rgba(255,255,255,0.12)");
      stickerShade.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = stickerShade;
      ctx.fillRect(albumX, albumY, albumW, 50);
    });
    ctx.restore();
  }

  function drawSpecialOverlay() {
    if (anniversary === "id8") {
      fillRoundedRect(28, 52, 169, 18, 9, "rgba(0,0,0,0.52)");
      ctx.fillStyle = "#fff5d6";
      ctx.font = "700 8px Inter, Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("EIGHT YEAR ANNIVERSARY EDITION", 112.5, 64.5);

      var cake = new Image();
      cake.onload = function () {
        var c = canvas.getContext('2d');
        if (!c) return;
        c.drawImage(this, 24, 76, 30, 30);
        var eight = new Image();
        eight.onload = function () {
          var c2 = canvas.getContext('2d');
          if (!c2) return;
          c2.drawImage(this, 171, 76, 30, 30);
        };
        eight.src = 'img/8.png';
      };
      cake.src = 'img/cake.png';
    } else if (anniversary === "id9") {
      fillRoundedRect(28, 52, 169, 18, 9, "rgba(0,0,0,0.52)");
      ctx.fillStyle = "#e9f7ff";
      ctx.font = "700 8px Inter, Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NINE YEAR ANNIVERSARY EDITION", 112.5, 64.5);

      var arnold = new Image();
      arnold.onload = function () {
        var c = canvas.getContext('2d');
        if (!c) return;
        c.drawImage(this, 22, 78, 44, 44);
        var bgImg = new Image();
        bgImg.onload = function () {
          var c2 = canvas.getContext('2d');
          if (!c2) return;
          c2.save();
          c2.drawImage(this, 144, 72, 68, 68);
          c2.restore();
        };
        bgImg.src = 'img/id9.png';
      };
      arnold.src = 'img/arnold.png';
    }
  }

  drawBaseCard();

  // ── Image Drawing ─────────────────────────────────────────────────────
  function buildAlbumImageCandidates(url) {
    if (!url || typeof url !== "string") return [];
    var candidates = [url];
    var ytMatch = url.match(/ytimg\.com\/vi\/([^\/?#]+)/i);
    if (ytMatch && ytMatch[1]) {
      var base = "https://i.ytimg.com/vi/" + ytMatch[1] + "/";
      candidates.push(base + "hqdefault.jpg");
      candidates.push(base + "mqdefault.jpg");
      candidates.push(base + "default.jpg");
    }
    return candidates.filter(function (src, idx, arr) {
      return src && arr.indexOf(src) === idx;
    });
  }

  function drawAlbumImage(onDone) {
    var candidates = buildAlbumImageCandidates(data.image);
    if (!candidates.length) {
      onDone && onDone(null);
      return;
    }

    var idx = 0;
    function tryNext() {
      if (idx >= candidates.length) {
        onDone && onDone(null);
        return;
      }
      var src = candidates[idx++];
      var albumImg = new Image();
      albumImg.onload = function () {
        if (!ctx) return;
        drawAlbumBadge(this);
        onDone && onDone(this);
      };
      albumImg.onerror = tryNext;
      albumImg.src = src;
    }

    tryNext();
  }

  /**
   * Default image loader: draws avatar + album art thumbnail.
   */
  var doImages = function () {
    var avatarImg = new Image();
    var albumImg = null;
    var heroDrawn = false;
    var albumBadgeDrawn = false;
    var avatarReady = false;

    function finishIfDone() {
      if (heroDrawn && albumBadgeDrawn) {
        ctx = null; // release context
        finishCardRender();
      }
    }

    function tryDrawHero() {
      if (!avatarReady || heroDrawn) return;
      heroDrawn = true;
      drawHeroImage(avatarImg, albumImg, function () {
        fillRoundedRect(160, 157, 40, 40, 22, "rgba(23,23,23,0.85)");
        ctx.textAlign = "center";
        ctx.fillStyle = accentColor;
        ctx.font = "700 24px Inter, Helvetica, Arial, sans-serif";
        ctx.fillText(String(data.num || "").slice(0, 2), 180, 185);
        drawTopLogo();
        ctx.fillStyle = "white";
        ctx.font = "600 14px Inter, Helvetica, Arial, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("#" + data.cardnum, 198, 34);
        drawSpecialOverlay();
        finishIfDone();
      });
    }

    function finalizeAlbumBadge() {
      if (albumBadgeDrawn) return;
      albumBadgeDrawn = true;
      finishIfDone();
    }
    avatarImg.onload = function () {
      avatarReady = true;
      tryDrawHero();
    };
    avatarImg.src = firetable.utilities.avatarURL(data.djid, data.djname, "175x175");

    drawAlbumImage(function (loadedAlbumImg) {
      if (loadedAlbumImg) albumImg = loadedAlbumImg;
      tryDrawHero();
      finalizeAlbumBadge();
    });
  };

  // All modern-theme variants use the same image pipeline.
  doImages();
};
