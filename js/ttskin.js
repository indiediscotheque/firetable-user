/**
 * ttskin.js — the Turntable theme: an easter egg in Live.
 *
 * A skin over the room that looks like the Turntable.fm people remember:
 * the stage with its truss and speaker stacks, the LED songboard, the
 * awesome meter, the DJs behind their laptops, everyone standing on the floor
 * as a Turntable avatar, and the Queue · Room · Chat panel on the right. It's
 * the same room underneath: every control is the room's own (Fire is
 * Awesome, Storm takes your fire back, Grab is the heart), the screen is the
 * room's own player, and nothing here pauses or reloads it.
 *
 * Ways in (Live only): type /turntable in chat, the Konami code, or click the
 * :id: logo three times. The way out is the "Back to Live" button in the bar
 * (or the same again). The choice is remembered on this device.
 *
 * Avatars: everyone picks one the first time in (every avatar is unlocked;
 * Turntable avatar in the account menu changes it). It's kept at
 * users/<uid>/ttAvatar so the room sees it, only in this theme: Live never
 * shows one, and this theme never shows a Live avatar. Laptop stickers (the
 * account menu, or Stickers on your seat) are kept at users/<uid>/ttLaptop.
 * Art: the community archive of every Turntable.fm avatar and room asset
 * (github.com/ttdevelopers), built by tools/tt-avatars.py.
 */
firetable.tt = (function () {
  "use strict";

  var W = 1468; // the stage art's width: everything on it is placed in its units
  var FLOOR = 745; // where the floor's first row stands; the rest spread down to the bottom of the room
  var SEATS = 4; // the bot's deck
  var BOT_AVATAR = "58", PAGE = 16;
  var TIERS = [{ id: "classic", label: "Classic" }, { id: "gold", label: "Gold" }, { id: "special", label: "Specials" }];
  // Laptop stickers: the room's own and Turntable's gold ones are one picture
  // (img/tt/stickers.webp, tools/tt-art.py: same names, same order); the rest
  // are the emoji the chat already shows (Twemoji, from the same place).
  var STICKERS = ["id", "id9", "eight", "cake", "rohn", "heart", "happy", "wink", "laughing", "sad", "smh", "poop", "glowstick"];
  var EMOJI = ["1faa9", "1f525", "1f3a7", "1f4bf", "1f308", "2b50", "1f680", "1f47e", "1f496", "1f984", "1f918", "1f3b8", "1f3b9", "1f941", "1f3a4", "1f3b6",
    "1f4fc", "1f4fb", "26a1", "1f319", "1f6f8", "1f47d", "1f419", "1f412", "1f63a", "1f355", "1f32e", "1f369", "1f366", "1f352", "1f335", "1f344", "1f338", "1f30a", "1f389", "1f60e"];
  var LIDS = ["silver", "black", "white", "gold", "pink", "teal", "purple"];
  var MAX_STICKERS = 10;

  var S = {
    pref: false,       // on, on this device
    active: false,     // drawn now (on, and in Live)
    built: false,
    tab: "room",       // queue | room | chat
    layout: "one",     // one sidebar (Queue · Room · Chat) or two (Queue on the left, Room · Chat on the right)
    sub: null,         // the Room tab's page: people | recent | fresh | cards (null: its front)
    list: null, byId: {}, tiers: {},
    ready: null,       // the avatars' list, loading
    seats: {}, crowd: {}, // the figures on the stage, by uid
    pick: { tier: "classic", page: 0 },
    timer: 0, ro: null, mo: null, chatMo: null, konami: 0, logoClicks: [],
    marker: null
  };

  var $id = function (id) { return document.getElementById(id); };
  var esc = function (s) { return firetable.utilities.htmlEscape(String(s == null ? "" : s)); };
  var ms = function (name, cls) { return '<i class="' + (cls || "material-symbols-outlined") + '" aria-hidden="true">' + name + "</i>"; };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };

  /** A string's small stable number (FNV-1a), for places and laptops that don't move between visits. */
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ─── The avatars ──────────────────────────────────────────────────────────

  function loadAvatars() {
    if (S.ready) return S.ready;
    S.ready = fetch("img/tt/avatars.json").then(function (r) {
      if (!r.ok) throw new Error("avatars " + r.status);
      return r.json();
    }).then(function (list) {
      S.list = list;
      list.forEach(function (a) {
        S.byId[a.id] = a;
        (S.tiers[a.t] = S.tiers[a.t] || []).push(a.id);
      });
      return list;
    }).catch(function (e) {
      S.ready = null;
      throw e;
    });
    return S.ready;
  }

  function validId(id) { return typeof id === "string" && /^[0-9a-f]{1,24}$/.test(id) && !!S.byId[id]; }

  /** Someone's avatar: what they picked, else one of the classics that stays theirs. */
  function avatarOf(uid) {
    var u = ftapi.users && ftapi.users[uid];
    if (uid && uid === ftapi.uid) {
      var mine = myAvatar();
      if (mine) return mine;
    }
    if (u && validId(u.ttAvatar)) return u.ttAvatar;
    if (u && u.hostbot && S.byId[BOT_AVATAR]) return BOT_AVATAR;
    var classic = S.tiers.classic || [];
    return classic.length ? classic[hash(String(uid || "guest")) % classic.length] : (S.list && S.list[0].id);
  }

  function myAvatar() {
    var u = ftapi.uid && ftapi.users && ftapi.users[ftapi.uid];
    if (u && validId(u.ttAvatar)) return u.ttAvatar;
    var local = store.get(STORAGE.ttAvatar);
    return validId(local) ? local : null;
  }

  function saveAvatar(id) {
    store.set(STORAGE.ttAvatar, id);
    var me = ftapi.uid && ftapi.users && ftapi.users[ftapi.uid];
    if (me) me.ttAvatar = id; // drawn now; the database echoes it back
    render();
    if (!ftapi.uid) return;
    // with older database rules this doesn't save: the room then sees your
    // usual one, and you see your pick on this device
    ftapi.db().ref("users/" + ftapi.uid + "/ttAvatar").set(id).catch(function () {
      firetable.ui.toast("Your avatar shows on this device. The room will see it once the site's database is updated.");
    });
  }

  // absolute: a url() in a CSS variable is read against the stylesheet that uses it
  function abs(path) { return new URL(path, document.baseURI).href; }
  function src(id) { return abs("img/tt/av/" + id + ".webp"); }

  // ─── Laptops ──────────────────────────────────────────────────────────────

  /**
   * A laptop, as kept at users/<uid>/ttLaptop: "lid;sticker,x,y,turn,size;…"
   * (x and y in % of the lid, turn in degrees, size in %), short enough for
   * the database rules to check in one pattern.
   */
  function parseLaptop(str) {
    var out = { lid: "silver", items: [] };
    if (typeof str !== "string" || !/^[a-z]{3,6}(;[a-z0-9]{1,10},[0-9]{1,3},[0-9]{1,3},-?[0-9]{1,3},[0-9]{2,3}){0,10}$/.test(str)) return out;
    var parts = str.split(";");
    if (LIDS.indexOf(parts[0]) !== -1) out.lid = parts[0];
    parts.slice(1).forEach(function (p) {
      var f = p.split(",");
      if (!stickerOk(f[0])) return;
      out.items.push({ id: f[0], x: Math.min(100, +f[1]), y: Math.min(100, +f[2]), r: Math.max(-180, Math.min(180, +f[3])), s: Math.max(40, Math.min(160, +f[4])) });
    });
    return out;
  }
  function stringifyLaptop(l) {
    return [l.lid].concat(l.items.slice(0, MAX_STICKERS).map(function (i) {
      return [i.id, Math.round(i.x), Math.round(i.y), Math.round(i.r), Math.round(i.s)].join(",");
    })).join(";");
  }
  function stickerOk(id) { return STICKERS.indexOf(id) !== -1 || (id.charAt(0) === "e" && EMOJI.indexOf(id.slice(1)) !== -1); }

  function laptopOf(uid) {
    if (uid && uid === ftapi.uid) {
      var local = store.get(STORAGE.ttLaptop);
      var me = ftapi.users && ftapi.users[uid];
      return parseLaptop((me && me.ttLaptop) || local);
    }
    var u = ftapi.users && ftapi.users[uid];
    return parseLaptop(u && u.ttLaptop);
  }

  /** A sticker's picture, as CSS for its element. */
  function stickerStyle(id) {
    var k = STICKERS.indexOf(id);
    if (k !== -1) return "background-image:url(" + abs("img/tt/stickers.webp") + ");background-size:" + (STICKERS.length * 100) + "% 100%;background-position:" + (k * 100 / (STICKERS.length - 1)).toFixed(3) + "% 0";
    return "background-image:url(" + (typeof twemoji !== "undefined" ? twemoji.base : "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/") + "svg/" + id.slice(1) + ".svg);background-size:contain;background-position:center";
  }

  function stickersHtml(l, editable) {
    return l.items.map(function (i, n) {
      var st = "left:" + i.x + "%;top:" + i.y + "%;--r:" + i.r + "deg;--s:" + (i.s / 100) + ";" + stickerStyle(i.id);
      return editable
        ? '<button type="button" class="tt-sticker" data-n="' + n + '" style="' + st + '" aria-label="Sticker ' + (n + 1) + '"></button>'
        : '<span class="tt-sticker" style="' + st + '"></span>';
    }).join("");
  }

  function laptopHtml(uid) {
    var l = laptopOf(uid);
    return '<span class="tt-laptop" data-lid="' + l.lid + '" aria-hidden="true"><span class="tt-lid">' + stickersHtml(l, false) + "</span></span>";
  }

  /**
   * One figure, front (f) or back (b), standing on its feet at the bottom
   * centre of its box. Its head and body are drawn apart when the art has
   * them, so the head can rock on the body the way Turntable's did.
   */
  function figure(id, side) {
    var a = S.byId[id];
    var el = document.createElement("span");
    el.className = "tt-fig";
    if (!a) return el;
    var s = a[side];
    el.dataset.av = id;
    el.style.cssText = "--w:" + s.w + "px;--h:" + s.h + "px;--img:url(" + src(id) + ");--sw:" + a.sw + "px;--sh:" + a.sh + "px";
    var part = function (cls, x, w, h, dx, dy) {
      return '<span class="' + cls + '" style="left:' + dx + "px;top:" + dy + "px;width:" + w + "px;height:" + h + "px;background-position:-" + x + 'px 0"></span>';
    };
    el.innerHTML = s.head
      ? part("tt-body", s.body[0], s.body[1], s.body[2], s.body[3], s.body[4]) + part("tt-head", s.head[0], s.head[1], s.head[2], s.head[3], s.head[4])
      : part("tt-whole", s.x, s.w, s.h, 0, 0);
    return el;
  }

  /**
   * A face for lists, chat and the bar: the front's head (or the top of the
   * whole figure), centred in whatever circle it's drawn in (percentages, so
   * one style fits every size).
   */
  function faceStyle(id) {
    var a = S.byId[id];
    if (!a) return "";
    var f = a.f, x, w, h;
    if (f.head) { x = f.head[0]; w = f.head[1]; h = Math.min(f.head[2], f.head[1] * 1.1); }
    else { x = f.x; w = f.w; h = Math.min(f.h, f.w); }
    var m = Math.max(w, h), bw = a.sw / m, bh = a.sh / m;
    var px = (-x / m + (1 - w / m) / 2) / (1 - bw), py = ((1 - h / m) / 2) / (1 - bh);
    return "--tt-face:url(" + src(id) + ");--tt-fsize:" + (bw * 100).toFixed(2) + "% " + (bh * 100).toFixed(2) + "%;--tt-fpos:" +
      (px * 100).toFixed(2) + "% " + (isFinite(py) ? (py * 100).toFixed(2) : 0) + "%";
  }

  // ─── Building the room ────────────────────────────────────────────────────

  function build() {
    if (S.built) return;
    S.built = true;
    var stage = $id("djStage");

    // a section, not a div: the stage's own rules place every div in it
    var room = document.createElement("section");
    room.id = "tt-room";
    room.setAttribute("aria-label", "The room");
    room.innerHTML =
      '<div class="tt-floor" aria-hidden="true"></div>' +
      '<div class="tt-canvas">' +
        '<div class="tt-curtain" aria-hidden="true"></div>' +
        '<div class="tt-beams" aria-hidden="true"></div>' +
        '<div class="tt-stageart" aria-hidden="true"></div>' +
        '<div class="tt-bulbs" aria-hidden="true"></div>' +
        '<div class="tt-screen tt-screenL" aria-hidden="true"><div class="tt-screenart" id="tt-artL"></div></div>' +
        '<div class="tt-screen tt-screenR" aria-hidden="true"><div class="tt-screenart" id="tt-artR"></div></div>' +
        '<p id="tt-theme" class="tt-theme" hidden></p>' +
        '<div class="tt-meter" aria-hidden="true"><span class="tt-needle" id="tt-needle"></span></div>' +
        '<div class="tt-board" id="tt-board">' +
          '<button type="button" class="tt-vote tt-storm" id="tt-storm" aria-label="Storm: take back your fire" title="Storm: take back your fire">' + ms("thunderstorm", "material-symbols-filled") + "</button>" +
          '<div class="tt-songboard" role="status" aria-live="off">' +
            '<div class="tt-led tt-line1" id="tt-line1"><span></span></div>' +
            '<div class="tt-led tt-line2" id="tt-line2"><span></span></div>' +
            '<div class="tt-led tt-times"><span id="tt-at">0:00</span><span class="tt-prog"><i id="tt-prog"></i></span><span id="tt-left">0:00</span></div>' +
  '<div class="tt-snag" role="group" aria-label="This song">' +
            '<button type="button" id="tt-grab" class="tt-chip" aria-label="Grab: add to your playlist" title="Grab: add to your playlist">' + ms("favorite", "material-symbols-filled") + "<span>Grab</span></button>" +
            '<button type="button" id="tt-grabPick" class="tt-chip tt-chipIcon" aria-label="Choose the playlist" title="Choose the playlist">' + ms("arrow_drop_down") + "</button>" +
            '<button type="button" id="tt-link" class="tt-chip tt-chipIcon" aria-label="Song link" title="Song link">' + ms("link") + "</button>" +
          "</div>" +
          "</div>" +
          '<button type="button" class="tt-vote tt-awesome" id="tt-awesome" aria-label="Awesome! (Fire)" title="Awesome! (Fire)">' + ms("thumb_up", "material-symbols-filled") + '<span class="tt-count" id="tt-count" hidden></span></button>' +
        "</div>" +
        '<div class="tt-djlight" id="tt-djlight" aria-hidden="true"></div>' +
        '<div class="tt-table" id="tt-table" role="group" aria-label="The DJs"></div>' +
        '<div class="tt-tabletop" aria-hidden="true"></div>' +
        '<div class="tt-crowd" id="tt-crowd" role="group" aria-label="The floor"></div>' +
        '<p class="tt-more" id="tt-more" hidden></p>' +
      "</div>";
    stage.insertBefore(room, stage.firstChild);

    // the bar: room name and the room's links, then the way back to Live
    var bar = $id("topbar");
    var brand = document.createElement("div");
    brand.id = "tt-brand";
    brand.innerHTML = '<span class="tt-roomname">' + esc(ftconfigs.roomNameShort || ftconfigs.roomName || "Indie Discotheque") + "</span>" + socialsHtml();
    var logo = $id("roomlogo");
    logo.parentNode.insertBefore(brand, logo.nextSibling);
    var exit = document.createElement("button");
    exit.type = "button";
    exit.id = "tt-exit";
    exit.className = "tt-exit";
    exit.innerHTML = ms("logout") + "<span>Back to Live</span>";
    exit.title = "Back to Live (the music keeps playing)";
    bar.appendChild(exit);

    // the panel's tabs, and the Room tab
    var grid = $id("mainGrid");
    var tabs = document.createElement("div");
    tabs.id = "tt-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Panel");
    tabs.innerHTML = [["queue", "queue_music", "Queue"], ["room", "info", "Room"], ["chat", "chat_bubble", "Chat"]].map(function (t) {
      return '<button type="button" role="tab" class="tt-tab" id="tt-tab-' + t[0] + '" data-tab="' + t[0] + '" aria-selected="false">' + ms(t[1], "material-symbols-filled") + "<span>" + t[2] + '</span><span class="tt-badge" hidden></span></button>';
    }).join("");
    grid.appendChild(tabs);

    var pane = document.createElement("section");
    pane.id = "tt-pane";
    pane.setAttribute("aria-label", "Room");
    grid.appendChild(pane);

    // visitors: what Queue and Chat would show (two places: both show at once with two sidebars)
    [["tt-guest", "Log in to chat, keep playlists and DJ."], ["tt-guestQ", "Log in to keep playlists and DJ."]].forEach(function (g) {
      var el = document.createElement("div");
      el.id = g[0];
      el.className = "tt-guestNote";
      el.innerHTML = "<p>" + g[1] + '</p><button type="button" class="tt-yellow" data-tt-signin>Log in or join</button>';
      grid.appendChild(el);
    });
    // two sidebars: the left one's heading
    var qh = document.createElement("div");
    qh.id = "tt-qhead";
    qh.innerHTML = ms("queue_music", "material-symbols-filled") + "<span>Queue</span>";
    grid.appendChild(qh);
    // one sidebar or two
    var lay = document.createElement("button");
    lay.type = "button";
    lay.id = "tt-layout";
    lay.className = "header_icon";
    bar.insertBefore(lay, exit);

    // the avatar picker
    var dlg = document.createElement("dialog");
    dlg.id = "tt-picker";
    dlg.setAttribute("aria-labelledby", "tt-pickTitle");
    dlg.innerHTML = '<div class="tt-modal tt-pickModal">' +
      '<div class="tt-pickHead"><h2 id="tt-pickTitle">Choose your avatar</h2>' +
        '<button type="button" class="tt-pickClose" id="tt-pickClose" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="tt-pickBody">' +
        '<p class="tt-pickHello" id="tt-pickHello"></p>' +
        '<div class="tt-pickTiers" role="tablist" aria-label="Avatars">' +
          TIERS.map(function (t) { return '<button type="button" role="tab" class="tt-pickTier" data-tier="' + t.id + '" aria-selected="false">' + t.label + "</button>"; }).join("") +
        "</div>" +
        '<div class="tt-pickGrid" id="tt-pickGrid" role="listbox" aria-label="Avatars"></div>' +
        '<div class="tt-pickNav">' +
          '<button type="button" class="tt-pickArrow" id="tt-pickPrev" aria-label="Previous page">' + ms("chevron_left") + "</button>" +
          '<div class="tt-pickDots" id="tt-pickDots"></div>' +
          '<button type="button" class="tt-pickArrow" id="tt-pickNext" aria-label="Next page">' + ms("chevron_right") + "</button>" +
        "</div>" +
        '<div class="tt-pickFoot"><button type="button" class="tt-ghost" id="tt-pickLeave">' + ms("logout") + "Back to Live</button>" +
          '<button type="button" class="tt-ghost" id="tt-pickRandom">' + ms("casino") + "Surprise me</button></div>" +
      "</div></div>";
    document.body.appendChild(dlg);

    // the laptop sticker builder
    var lap = document.createElement("dialog");
    lap.id = "tt-laptopEdit";
    lap.setAttribute("aria-labelledby", "tt-lapTitle");
    lap.innerHTML = '<div class="tt-modal tt-lapModal">' +
      '<div class="tt-pickHead"><h2 id="tt-lapTitle">Laptop stickers</h2>' +
        '<button type="button" class="tt-pickClose" data-lap="cancel" aria-label="Close">' + ms("close") + "</button></div>" +
      '<div class="tt-lapBody">' +
        '<div class="tt-lapStage">' +
          '<div class="tt-laptop tt-lapBig" id="tt-lapBig"><div class="tt-lid" id="tt-lapLid" role="group" aria-label="Your laptop\'s lid"></div></div>' +
          '<div class="tt-lapTools" id="tt-lapTools" role="toolbar" aria-label="The sticker you picked">' +
            '<button type="button" data-lap="left" aria-label="Turn left" title="Turn left ([)">' + ms("rotate_left") + "</button>" +
            '<button type="button" data-lap="right" aria-label="Turn right" title="Turn right (])">' + ms("rotate_right") + "</button>" +
            '<button type="button" data-lap="smaller" aria-label="Smaller" title="Smaller (-)">' + ms("remove") + "</button>" +
            '<button type="button" data-lap="bigger" aria-label="Bigger" title="Bigger (+)">' + ms("add") + "</button>" +
            '<button type="button" data-lap="front" aria-label="To the front" title="To the front">' + ms("flip_to_front") + "</button>" +
            '<button type="button" data-lap="remove" aria-label="Peel it off" title="Peel it off (Delete)">' + ms("delete") + "</button>" +
          "</div>" +
          '<p class="tt-lapHint" id="tt-lapHint">Drag stickers around the lid. Arrow keys move the one you picked.</p>' +
        "</div>" +
        '<div class="tt-lapSide">' +
          '<h3>Lid</h3><div class="tt-lids" role="radiogroup" aria-label="Lid colour">' +
            LIDS.map(function (c) { return '<button type="button" role="radio" class="tt-lidPick" data-lid="' + c + '" aria-checked="false" aria-label="' + c + '" title="' + c + '"></button>'; }).join("") + "</div>" +
          '<h3>Stickers <span id="tt-lapCount"></span></h3>' +
          '<div class="tt-palette" role="group" aria-label="Add a sticker">' +
            STICKERS.map(function (id) { return '<button type="button" class="tt-palItem" data-add="' + id + '" aria-label="' + id + ' sticker"><span style="' + stickerStyle(id) + '"></span></button>'; }).join("") +
            EMOJI.map(function (e) { return '<button type="button" class="tt-palItem" data-add="e' + e + '" aria-label="Emoji sticker"><span style="' + stickerStyle("e" + e) + '"></span></button>'; }).join("") +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="tt-lapFoot"><button type="button" class="tt-ghost" data-lap="clear">' + ms("layers_clear") + "Peel them all off</button>" +
        '<span class="flexpacer"></span><button type="button" class="tt-ghost" data-lap="cancel">Cancel</button>' +
        '<button type="button" class="tt-yellow" data-lap="save">Save</button></div></div>';
    document.body.appendChild(lap);

    bindEvents();
    S.ro = new ResizeObserver(fit);
    S.ro.observe(stage);
  }

  function socialsHtml() {
    var links = [["facebookURL", "Facebook", "facebook"], ["discordURL", "Discord", "discord"], ["redditURL", "Reddit", "reddit"], ["lastfmURL", "Last.fm", "lastfm"], ["soundcloudURL", "SoundCloud", "soundcloud"]];
    return '<span class="tt-socials">' + links.filter(function (l) { return ftconfigs[l[0]]; }).map(function (l) {
      // the same marks as the Community menu (#socialPopover)
      var svg = document.querySelector("#socialPopover .sociallogo." + l[2] + " svg");
      return '<a class="tt-social" href="' + esc(ftconfigs[l[0]]) + '" target="_blank" rel="noopener" title="' + l[1] + '" aria-label="' + l[1] + '">' + (svg ? svg.outerHTML : l[1]) + "</a>";
    }).join("") + "</span>";
  }

  /**
   * Scale the stage art to the room: the whole stage across (or as much as
   * the height allows), and the floor reaching down to the bottom of the room
   * however tall it is: the crowd's rows spread over it (--tt-fh).
   */
  function fit() {
    var stage = $id("djStage");
    if (!stage || !S.active) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    var s = Math.min(w / W, h / 820);
    var y = Math.max(0, Math.min(24, (h - 820 * s) / 2));
    stage.style.setProperty("--tt-s", s.toFixed(4));
    stage.style.setProperty("--tt-x", ((w - W * s) / 2).toFixed(1) + "px");
    stage.style.setProperty("--tt-y", y.toFixed(1) + "px");
    stage.style.setProperty("--tt-fh", Math.max(120, (h - y) / s - FLOOR - 40).toFixed(0) + "px");
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────

  function render() {
    if (!S.active || !S.list) return;
    renderSeats();
    renderCrowd();
    renderPeople();
    renderVotes();
    renderSong();
    renderTheme();
    renderPane();
    faceAll();
  }

  function djs() {
    var out = [], t = firetable.tableData || {};
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k) && t[k] && t[k].id) out.push({ id: t[k].id, name: t[k].name, plays: t[k].plays || 0 });
    return out.slice(0, SEATS);
  }

  function isMod() {
    var me = ftapi.uid && ftapi.users && ftapi.users[ftapi.uid];
    return !!(me && (me.mod || me.supermod));
  }

  function renderSeats() {
    var table = $id("tt-table");
    var list = djs();
    var active = firetable.displayedDjId;
    var mine = list.some(function (d) { return d.id === ftapi.uid; });
    var fired = firetable.fireReactors || {};
    var keep = {};
    var offered = false;
    for (var i = 0; i < SEATS; i++) {
      var d = list[i];
      var seat = table.children[i];
      if (!seat) {
        seat = document.createElement("div");
        seat.className = "tt-seat";
        seat.style.setProperty("--i", i);
        table.appendChild(seat);
      }
      if (!d) {
        var offer = !offered && !mine && !!ftapi.uid;
        offered = offered || offer;
        var want = "empty" + (offer ? "+offer" : "");
        if (seat.dataset.who !== want) {
          seat.dataset.who = want;
          seat.className = "tt-seat tt-empty";
          seat.innerHTML = offer
            ? '<button type="button" class="tt-play tt-yellow" data-tt-addme>Play<br>Music</button><span class="tt-vinyl" aria-hidden="true"></span>'
            : '<span class="tt-vinyl" aria-hidden="true"></span>';
        }
        continue;
      }
      keep[d.id] = true;
      var lapKey = stringifyLaptop(laptopOf(d.id));
      if (seat.dataset.who !== d.id || seat.dataset.av !== avatarOf(d.id) || seat.dataset.lap !== lapKey) {
        seat.dataset.who = d.id;
        seat.dataset.av = avatarOf(d.id);
        seat.dataset.lap = lapKey;
        seat.className = "tt-seat";
        seat.innerHTML = '<button type="button" class="tt-person tt-dj" data-uid="' + esc(d.id) + '" aria-label="' + esc(d.name) + ', DJ">' +
          '<span class="tt-figwrap"></span></button>' + laptopHtml(d.id) +
          '<span class="tt-plate"><b>' + esc(d.name) + '</b><span class="tt-plays"></span></span>' +
          '<span class="tt-seatacts"></span>';
        seat.querySelector(".tt-figwrap").appendChild(figure(seat.dataset.av, "f"));
      }
      seat.classList.toggle("tt-on", d.id === active);
      seat.classList.toggle("tt-fired", !!fired[d.id]);
      seat.classList.toggle("tt-self", d.id === ftapi.uid);
      seat.querySelector(".tt-plays").textContent = d.plays + "/" + (firetable.playlimit || "∞") + " plays";
      var acts = seat.querySelector(".tt-seatacts");
      var actHtml = d.id === ftapi.uid
        ? '<button type="button" class="tt-mini" data-tt-stickers>Stickers</button><button type="button" class="tt-mini" data-tt-stepdown>Step down</button>'
        : isMod() ? '<button type="button" class="tt-mini" data-tt-remove="' + esc(d.id) + '">Remove</button>' : "";
      if (acts.innerHTML !== actHtml) acts.innerHTML = actHtml;
    }
    // the spotlight
    var on = table.querySelector(".tt-seat.tt-on");
    var light = $id("tt-djlight");
    light.hidden = !on;
    if (on) light.style.setProperty("--i", on.style.getPropertyValue("--i"));
    S.seats = keep;
  }

  /**
   * The floor: a place for everyone, kept between renders (and visits):
   * each person has a favourite spot from their id and takes the next free
   * one when it's taken. Rows further back stand smaller.
   */
  var SPOTS = (function () {
    // rows from the back (f 0) to the front (f 1): further back stands smaller
    var out = [], rows = [[0, 0.86, 13], [0.18, 0.93, 12], [0.37, 1.0, 12], [0.57, 1.08, 11], [0.78, 1.16, 10], [1, 1.24, 9]];
    rows.forEach(function (r, ri) {
      var n = r[2], span = 1180 - ri * 10;
      for (var k = 0; k < n; k++) {
        var x = W / 2 - span / 2 + span * (k + 0.5) / n + (ri % 2 ? 22 : -22);
        var j = hash("spot" + ri + "." + k) >>> 0;
        out.push({ x: Math.round(x + (j % 30) - 15), f: Math.max(0, Math.min(1, r[0] + (((j >>> 5) % 9) - 4) / 200)), s: r[1] });
      }
    });
    return out;
  })();

  function renderCrowd() {
    var crowd = $id("tt-crowd");
    var users = ftapi.users || {};
    var fired = firetable.fireReactors || {};
    var uids = Object.keys(users).filter(function (u) { return !S.seats[u] && users[u] && !(ftapi.blockedUsers && ftapi.blockedUsers[u]); });
    uids.sort();
    var taken = {}, placed = {};
    uids.forEach(function (u) {
      var at = hash(u) % SPOTS.length;
      for (var t = 0; t < SPOTS.length && taken[at]; t++) at = (at + 1) % SPOTS.length;
      if (taken[at]) return; // a full floor
      taken[at] = true;
      placed[u] = at;
    });
    var overflow = uids.length - Object.keys(placed).length;
    var more = $id("tt-more");
    more.hidden = overflow <= 0;
    if (overflow > 0) more.textContent = "+" + overflow + " more on the floor";

    var existing = {};
    Array.prototype.forEach.call(crowd.children, function (el) { existing[el.dataset.uid] = el; });
    Object.keys(placed).forEach(function (u) {
      var spot = SPOTS[placed[u]], av = avatarOf(u), el = existing[u];
      delete existing[u];
      var name = (users[u] && users[u].username) || "someone";
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "tt-person tt-listener";
        el.dataset.uid = u;
        el.style.animationDelay = (-(hash(u) % 1200) / 1000) + "s";
        crowd.appendChild(el);
      }
      if (el.dataset.av !== av) {
        el.dataset.av = av;
        el.textContent = "";
        el.appendChild(figure(av, "b"));
      }
      el.setAttribute("aria-label", name + (u === ftapi.uid ? " (you)" : ""));
      el.style.cssText = "left:" + spot.x + "px;--f:" + spot.f.toFixed(3) + ";--d:" + spot.s + ";z-index:" + Math.round(10 + spot.f * 900) + ";animation-delay:" + el.style.animationDelay;
      el.dataset.name = name;
      el.classList.toggle("tt-fired", !!fired[u]);
      el.classList.toggle("tt-self", u === ftapi.uid);
      el.classList.toggle("tt-idle", !!(users[u].idle && users[u].idle.isIdle));
    });
    Object.keys(existing).forEach(function (u) {
      var el = existing[u];
      el.classList.add("tt-leaving");
      setTimeout(function () { if (el.classList.contains("tt-leaving")) el.remove(); }, 400);
    });
  }

  function renderVotes() {
    var fired = firetable.fireReactors || {};
    var count = firetable.fireCount || 0;
    var mineOn = !!(ftapi.uid && fired[ftapi.uid]);
    var aw = $id("tt-awesome");
    aw.classList.toggle("on", mineOn);
    aw.setAttribute("aria-pressed", mineOn ? "true" : "false");
    var c = $id("tt-count");
    c.hidden = !count;
    c.textContent = count > 99 ? "99+" : String(count);
    $id("tt-storm").disabled = !mineOn;
    var people = Math.max(1, Object.keys(ftapi.users || {}).length - djs().length);
    var share = Math.min(1, count / Math.max(1, Math.ceil(people * 0.6)));
    $id("tt-needle").style.setProperty("--a", (-58 + share * 116).toFixed(1) + "deg");
    var lit = count > 0 && (share >= 0.5 || document.body.classList.contains("dance-mode"));
    $id("tt-room").classList.toggle("tt-lit", lit);
    $id("tt-room").classList.toggle("tt-dance", document.body.classList.contains("dance-mode") || !!($id("deck") && $id("deck").classList.contains("dance")));
    document.querySelectorAll("#tt-room .tt-person").forEach(function (el) {
      el.classList.toggle("tt-fired", !!fired[el.dataset.uid]);
    });
    document.querySelectorAll("#tt-table .tt-seat[data-who]").forEach(function (el) {
      el.classList.toggle("tt-fired", !!fired[el.dataset.who]);
    });
    var grab = $id("grab");
    $id("tt-grab").classList.toggle("on", !!(grab && grab.classList.contains("on")));
    $id("tt-grab").hidden = $id("tt-grabPick").hidden = !ftapi.uid;
  }

  // the song: from the room's own now-playing, so tag fixes and art come along
  function renderSong() {
    var song = firetable.song;
    var playing = !!(song && song.cid && song.cid != 0);
    var title = ($id("track") && $id("track").textContent.trim()) || "";
    var artist = ($id("artist") && $id("artist").textContent.trim()) || "";
    if (!playing) { title = "Nobody's playing"; artist = "Step up and play music"; }
    setLed("tt-line1", artist || title);
    setLed("tt-line2", artist ? title : "");
    $id("tt-board").classList.toggle("tt-playing", playing);
    var artUrl = $id("albumArt") && $id("albumArt").dataset.albumArtCurrent;
    var art = playing && artUrl ? "url(" + JSON.stringify(abs(artUrl)) + ")" : "none";
    ["tt-artL", "tt-artR"].forEach(function (id) { $id(id).style.backgroundImage = art; });
    var link = $id("songlink");
    $id("tt-link").hidden = !playing || !link || !link.getAttribute("href");
    tick();
  }

  function setLed(id, text) {
    var el = $id(id);
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.classList.remove("tt-marquee");
    el.innerHTML = "<span>" + esc(text) + "</span>";
    requestAnimationFrame(function () {
      var span = el.firstChild;
      if (span && span.scrollWidth > el.clientWidth + 2) {
        el.innerHTML = "<span>" + esc(text) + "&emsp;&#9679;&emsp;" + esc(text) + "&emsp;&#9679;&emsp;</span>";
        el.style.setProperty("--len", (text.length * 0.32 + 6).toFixed(1) + "s");
        el.classList.add("tt-marquee");
      }
    });
  }

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2);
  }

  function tick() {
    if (!S.active) return;
    var song = firetable.song;
    var len = song && song.duration || 0;
    var at = song && song.started ? Math.max(0, Math.min(len || Infinity, (ftapi.now() - song.started) / 1000)) : 0;
    $id("tt-at").textContent = clock(at);
    $id("tt-left").textContent = len ? "-" + clock(len - at) : "";
    $id("tt-prog").style.width = (len ? Math.min(100, at / len * 100) : 0).toFixed(2) + "%";
  }

  function renderTheme() {
    var pill = $id("themePill"), text = $id("themePillText");
    var none = !text || !pill || pill.classList.contains("no-theme");
    var el = $id("tt-theme");
    el.hidden = none;
    if (!none) el.innerHTML = ms("chat_bubble", "material-symbols-filled") + "<span>" + esc(text.textContent.trim()) + "</span>";
  }

  // ─── The panel: Queue · Room · Chat ───────────────────────────────────────

  var SUBS = [
    { id: "people", icon: "group", label: "People here" },
    { id: "recent", icon: "history", label: "Recently played", view: "history", members: true },
    { id: "fresh", icon: "new_releases", label: "Fresh", view: "discover" },
    { id: "cards", icon: "style", label: "Cards", view: "cards", members: true }
  ];

  function setLayout(layout, remember) {
    S.layout = layout === "two" ? "two" : "one";
    if (remember) store.set(STORAGE.ttLayout, S.layout);
    document.body.setAttribute("data-tt-layout", S.layout);
    var b = $id("tt-layout");
    if (b) {
      var two = S.layout === "two";
      b.innerHTML = ms(two ? "view_sidebar" : "view_column");
      b.setAttribute("aria-label", two ? "One sidebar" : "Two sidebars: Queue on the left");
      b.title = two ? "One sidebar" : "Two sidebars: Queue on the left";
    }
    if (S.layout === "two" && S.tab === "queue") setTab("room");
    else if (S.active) setTab(S.tab);
    window.dispatchEvent(new Event("resize"));
  }

  function setTab(tab) {
    if (tab === "queue" && S.layout === "two") tab = "room";
    S.tab = tab;
    if ((tab === "queue" || S.layout === "two") && ftapi.uid && !S.sub) firetable.nav.setView("playlists");
    if (tab === "room" && S.sub) openSub(S.sub);
    document.body.setAttribute("data-tt-tab", tab);
    document.querySelectorAll("#tt-tabs .tt-tab").forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (on && tab === "chat") b.querySelector(".tt-badge").hidden = true;
    });
    if (tab === "chat" && firetable.utilities.scrollToBottom) setTimeout(firetable.utilities.scrollToBottom, 0);
    renderPane();
  }

  function openSub(sub) {
    var def = SUBS.filter(function (s) { return s.id === sub; })[0];
    if (def && def.members && !ftapi.uid) def = null;
    S.sub = def ? def.id : null;
    document.body.setAttribute("data-tt-sub", S.sub || "front");
    if (def && def.view) firetable.nav.setView(def.view);
    renderPane();
  }

  function renderPane() {
    var pane = $id("tt-pane");
    if (!pane) return;
    var users = ftapi.users || {};
    var n = Object.keys(users).length;
    var sub = SUBS.filter(function (s) { return s.id === S.sub; })[0];
    var html;
    if (sub) {
      html = '<button type="button" class="tt-back" data-tt-sub="">' + ms("chevron_left") + "<span>" + esc(sub.label) + "</span></button>" +
        (sub.id === "people" ? '<div class="tt-people" id="tt-people"></div>' : "");
    } else {
      var info = ftconfigs.roomInfoUrl || "about";
      html = '<div class="tt-intro"><p class="tt-welcome">Welcome to</p>' +
        '<h2 class="tt-name">' + esc(ftconfigs.roomNameShort || ftconfigs.roomName || "Indie Discotheque") + "</h2>" +
        '<p class="tt-count2">' + firetable.utilities.pluralize(n, "person", "people") + " here</p></div>" +
        '<div class="tt-about">' +
          "<p>" + ms("album") + "<span>Take a seat at the decks, play what you love, and give the songs you like an <b>Awesome</b>. Every avatar is unlocked.</span></p>" +
          (ftconfigs.discordURL ? "<p>" + ms("forum") + '<span>Keep in touch: <a href="' + esc(ftconfigs.discordURL) + '" target="_blank" rel="noopener">our Discord</a></span></p>' : "") +
          "<p>" + ms("help") + '<span><a href="' + esc(info) + '" target="_blank" rel="noopener">About the room and its rules</a></span></p>' +
        "</div>" +
        '<nav class="tt-subnav" aria-label="Room">' + SUBS.filter(function (s) { return !s.members || ftapi.uid; }).map(function (s) {
          return '<button type="button" class="tt-subitem" data-tt-sub="' + s.id + '">' + ms(s.icon) + "<span>" + esc(s.label) + "</span>" + ms("chevron_right") + "</button>";
        }).join("") + "</nav>";
    }
    // only redraw when it changed: keeps focus and the scroll where they are
    var key = (sub ? sub.id : "front") + "|" + n + "|" + !!ftapi.uid;
    if (pane.dataset.key !== key) {
      pane.dataset.key = key;
      pane.innerHTML = html;
    }
    renderPeople();
  }

  function renderPeople() {
    var box = $id("tt-people");
    if (!box) return;
    var users = ftapi.users || {};
    var seats = djs().map(function (d) { return d.id; });
    var groups = { djs: [], mods: [], bots: [], audience: [] };
    Object.keys(users).forEach(function (u) {
      var d = users[u];
      if (!d) return;
      if (seats.indexOf(u) !== -1) groups.djs.push(u);
      else if (d.hostbot) groups.bots.push(u);
      else if (d.mod || d.supermod) groups.mods.push(u);
      else groups.audience.push(u);
    });
    var name = function (u) { return String((users[u] && users[u].username) || "").toLowerCase(); };
    var html = [["djs", "DJs"], ["mods", "Moderators"], ["bots", "Bots"], ["audience", "Audience"]].map(function (g) {
      var list = groups[g[0]];
      if (!list.length) return "";
      if (g[0] !== "djs") list.sort(function (a, b) { return name(a) < name(b) ? -1 : 1; });
      else list.sort(function (a, b) { return seats.indexOf(a) - seats.indexOf(b); });
      return '<h3 class="tt-group">' + g[1] + " <span>" + list.length + "</span></h3><ul>" + list.map(function (u) {
        var d = users[u];
        var badges = (d.supermod ? ms("verified_user", "material-symbols-filled tt-b tt-bmod") : d.mod ? ms("shield", "material-symbols-filled tt-b tt-bmod") : "") +
          (d.hostbot ? ms("smart_toy", "material-symbols-filled tt-b") : "") +
          (firetable.fireReactors && firetable.fireReactors[u] ? ms("thumb_up", "material-symbols-filled tt-b tt-bawe") : "");
        return '<li><button type="button" class="tt-guest' + (d.idle && d.idle.isIdle ? " tt-idle" : "") + '" data-uid="' + esc(u) + '">' +
          '<span class="tt-face" style="' + faceStyle(avatarOf(u)) + '"></span><span class="tt-gname">' + esc(d.username || "someone") + "</span>" + badges + "</button></li>";
      }).join("") + "</ul>";
    }).join("");
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  /**
   * In this theme every face is a Turntable face: chat, mentions, your
   * account button, the player bar's DJ. The room's own avatar stays on the
   * element underneath (Live never sees these), covered by the theme's CSS.
   * Someone the theme can't tell gets a blank circle, never their Live face.
   */
  var FACE_ROOTS = ["chats", "inboxPopover", "loggedInUser", "nav-accountMenu", "dMini", "pv-full"];
  function whoseFace(el) {
    var uid = el.getAttribute("data-avatar-uid") || el.getAttribute("data-stage-uid");
    if (!uid) { var row = el.closest("[data-userid]"); uid = row && row.getAttribute("data-userid"); }
    if (!uid && el.closest("#loggedInUser, #nav-accountMenu")) uid = ftapi.uid;
    if (!uid && el.closest(".pb-face, .pvf-src") && firetable.song) uid = firetable.song.djid;
    return uid || null;
  }
  function faceAll() {
    if (!S.active || !S.list) return;
    FACE_ROOTS.forEach(function (id) {
      var root = $id(id);
      if (!root) return;
      root.querySelectorAll(".ft-avatar:not(.skel)").forEach(function (el) {
        var uid = whoseFace(el);
        var av = uid ? avatarOf(uid) : "";
        if (el.dataset.tt === av) return;
        el.dataset.tt = av;
        ["--tt-face", "--tt-fsize", "--tt-fpos"].forEach(function (p) { el.style.removeProperty(p); });
        if (av) el.style.cssText += ";" + faceStyle(av);
      });
    });
  }

  // ─── The picker ───────────────────────────────────────────────────────────

  function openPicker(required) {
    var dlg = $id("tt-picker");
    var mine = myAvatar();
    var a = mine && S.byId[mine];
    if (a) { S.pick.tier = a.t; S.pick.page = Math.floor(S.tiers[a.t].indexOf(mine) / PAGE); }
    dlg.classList.toggle("tt-required", !!required);
    $id("tt-pickClose").hidden = !!required;
    renderPicker();
    if (!dlg.open) dlg.showModal();
    var sel = dlg.querySelector(".tt-pickCell[aria-selected=true]") || dlg.querySelector(".tt-pickCell");
    if (sel) sel.focus();
  }

  function renderPicker() {
    var me = ftapi.uid && ftapi.users && ftapi.users[ftapi.uid];
    $id("tt-pickHello").innerHTML = (me && me.username ? "<b>" + esc(me.username) + "</b>, every" : "Every") + " avatar is unlocked. Pick the one you'll stand on the floor as." +
      (ftapi.uid ? "" : " Log in and the room sees it too.");
    var ids = S.tiers[S.pick.tier] || [];
    var pages = Math.max(1, Math.ceil(ids.length / PAGE));
    S.pick.page = Math.max(0, Math.min(pages - 1, S.pick.page));
    var mine = myAvatar();
    var start = S.pick.page * PAGE;
    var atlas = "img/tt/pick/" + S.pick.tier + "-" + S.pick.page + ".webp";
    $id("tt-pickGrid").innerHTML = ids.slice(start, start + PAGE).map(function (id, k) {
      return '<button type="button" role="option" class="tt-pickCell" data-av="' + id + '" aria-selected="' + (id === mine) + '" aria-label="Avatar ' + (start + k + 1) + '" tabindex="' + (id === mine || (!mine && k === 0) ? 0 : -1) + '">' +
        '<span class="tt-pickFig" style="background-image:url(' + atlas + ");background-position:" + (k * 100 / (PAGE - 1)).toFixed(4) + '% 0"></span></button>';
    }).join("");
    // the next page is ready before it's asked for
    if (S.pick.page + 1 < pages) new Image().src = "img/tt/pick/" + S.pick.tier + "-" + (S.pick.page + 1) + ".webp";
    document.querySelectorAll("#tt-picker .tt-pickTier").forEach(function (b) {
      var on = b.dataset.tier === S.pick.tier;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var dots = "";
    for (var p = 0; p < pages; p++) dots += '<button type="button" class="tt-dot' + (p === S.pick.page ? " on" : "") + '" data-page="' + p + '" aria-label="Page ' + (p + 1) + '"' + (p === S.pick.page ? ' aria-current="page"' : "") + "></button>";
    $id("tt-pickDots").innerHTML = dots;
    $id("tt-pickPrev").disabled = S.pick.page === 0;
    $id("tt-pickNext").disabled = S.pick.page >= pages - 1;
  }

  function choose(id) {
    if (!validId(id)) return;
    saveAvatar(id);
    var dlg = $id("tt-picker");
    if (dlg.open) dlg.close();
    firetable.ui.toast("You're on the floor. Hit Awesome when you like a song!", "success");
  }

  // ─── The laptop sticker builder ───────────────────────────────────────────

  var L = { draft: null, sel: -1, drag: null };

  function openLaptop() {
    L.draft = laptopOf(ftapi.uid);
    L.sel = -1;
    renderLaptop();
    var dlg = $id("tt-laptopEdit");
    if (!dlg.open) dlg.showModal();
  }

  function renderLaptop(focusSel) {
    var d = L.draft;
    $id("tt-lapBig").setAttribute("data-lid", d.lid);
    $id("tt-lapLid").innerHTML = stickersHtml(d, true);
    document.querySelectorAll("#tt-laptopEdit .tt-lidPick").forEach(function (b) {
      b.setAttribute("aria-checked", b.dataset.lid === d.lid ? "true" : "false");
    });
    var sel = L.sel >= 0 ? $id("tt-lapLid").querySelector('[data-n="' + L.sel + '"]') : null;
    if (sel) sel.classList.add("on");
    $id("tt-lapTools").classList.toggle("tt-off", !sel);
    $id("tt-lapTools").querySelectorAll("button").forEach(function (b) { b.disabled = !sel; });
    $id("tt-lapCount").textContent = d.items.length + " of " + MAX_STICKERS;
    if (sel && focusSel) sel.focus();
  }

  function lapAct(what) {
    var d = L.draft, i = d.items[L.sel];
    if (what === "clear") { d.items = []; L.sel = -1; return renderLaptop(); }
    if (!i) return;
    if (what === "left") i.r = Math.max(-180, i.r - 15);
    else if (what === "right") i.r = Math.min(180, i.r + 15);
    else if (what === "smaller") i.s = Math.max(40, i.s - 15);
    else if (what === "bigger") i.s = Math.min(160, i.s + 15);
    else if (what === "front") { d.items.splice(L.sel, 1); d.items.push(i); L.sel = d.items.length - 1; }
    else if (what === "remove") { d.items.splice(L.sel, 1); L.sel = -1; }
    renderLaptop(true);
  }

  function saveLaptop() {
    var str = stringifyLaptop(L.draft);
    store.set(STORAGE.ttLaptop, str);
    var me = ftapi.uid && ftapi.users && ftapi.users[ftapi.uid];
    if (me) me.ttLaptop = str;
    $id("tt-laptopEdit").close();
    render();
    if (!ftapi.uid) return;
    ftapi.db().ref("users/" + ftapi.uid + "/ttLaptop").set(str).then(function () {
      firetable.ui.toast("Your laptop's looking good.", "success");
    }).catch(function () {
      firetable.ui.toast("Your stickers show on this device. The room will see them once the site's database is updated.");
    });
  }

  function bindLaptop() {
    var dlg = $id("tt-laptopEdit"), lid = $id("tt-lapLid");
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) return dlg.close();
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.add) {
        if (L.draft.items.length >= MAX_STICKERS) { firetable.ui.toast("That's a full lid: peel one off first."); return; }
        var n = L.draft.items.length;
        L.draft.items.push({ id: b.dataset.add, x: 30 + (hash(b.dataset.add + n) % 40), y: 30 + ((hash(b.dataset.add + n) >>> 6) % 40), r: (hash(b.dataset.add + n) >>> 12) % 31 - 15, s: 100 });
        L.sel = n;
        return renderLaptop();
      }
      if (b.dataset.lid) { L.draft.lid = b.dataset.lid; return renderLaptop(); }
      if (b.classList.contains("tt-sticker")) { L.sel = +b.dataset.n; return renderLaptop(true); }
      var a = b.dataset.lap;
      if (a === "save") return saveLaptop();
      if (a === "cancel") return dlg.close();
      if (a) lapAct(a);
    });
    // drag a sticker about the lid
    lid.addEventListener("pointerdown", function (e) {
      var s = e.target.closest(".tt-sticker");
      if (!s) return;
      L.sel = +s.dataset.n;
      var r = lid.getBoundingClientRect(), it = L.draft.items[L.sel];
      L.drag = { id: e.pointerId, r: r, dx: e.clientX - (r.left + it.x / 100 * r.width), dy: e.clientY - (r.top + it.y / 100 * r.height), el: s };
      s.setPointerCapture(e.pointerId);
      lid.querySelectorAll(".tt-sticker.on").forEach(function (o) { o.classList.remove("on"); });
      s.classList.add("on");
      $id("tt-lapTools").classList.remove("tt-off");
      $id("tt-lapTools").querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      e.preventDefault();
    });
    lid.addEventListener("pointermove", function (e) {
      if (!L.drag || e.pointerId !== L.drag.id) return;
      var r = L.drag.r, it = L.draft.items[L.sel];
      it.x = Math.max(0, Math.min(100, (e.clientX - L.drag.dx - r.left) / r.width * 100));
      it.y = Math.max(0, Math.min(100, (e.clientY - L.drag.dy - r.top) / r.height * 100));
      L.drag.el.style.left = it.x + "%";
      L.drag.el.style.top = it.y + "%";
    });
    var drop = function () { if (L.drag) { L.drag = null; renderLaptop(true); } };
    lid.addEventListener("pointerup", drop);
    lid.addEventListener("pointercancel", drop);
    lid.addEventListener("keydown", function (e) {
      if (!e.target.closest(".tt-sticker") || L.sel < 0) return;
      var it = L.draft.items[L.sel], step = e.shiftKey ? 8 : 2, k = e.key;
      if (k === "ArrowLeft") it.x = Math.max(0, it.x - step);
      else if (k === "ArrowRight") it.x = Math.min(100, it.x + step);
      else if (k === "ArrowUp") it.y = Math.max(0, it.y - step);
      else if (k === "ArrowDown") it.y = Math.min(100, it.y + step);
      else if (k === "[") return lapAct("left");
      else if (k === "]") return lapAct("right");
      else if (k === "-" || k === "_") return lapAct("smaller");
      else if (k === "+" || k === "=") return lapAct("bigger");
      else if (k === "Delete" || k === "Backspace") { e.preventDefault(); return lapAct("remove"); }
      else return;
      e.preventDefault();
      renderLaptop(true);
    });
  }

  // ─── Turning it on and off ────────────────────────────────────────────────

  function apply() {
    var want = S.pref && !document.body.classList.contains("ft-discover");
    if (want === S.active) return;
    S.active = want;
    if (want) {
      // the theme's stylesheet is in the page but switched off (not even
      // downloaded) until someone first comes in; nothing shows until it's here
      var css = $id("tt-css");
      if (css && css.disabled && !css.sheet) {
        S.active = false;
        css.addEventListener("load", function () { apply(); }, { once: true });
        css.addEventListener("error", function () { firetable.ui.toast("The Turntable theme didn't load. Try again in a moment.", "error"); }, { once: true });
        css.disabled = false;
        return;
      }
      build();
      document.body.classList.add("tt-skin");
      document.body.setAttribute("data-tt-tab", S.tab);
      document.body.setAttribute("data-tt-sub", S.sub || "front");
      moveDjPicker(true);
      setLayout(store.get(STORAGE.ttLayout) || (window.innerWidth >= 1280 ? "two" : "one"), false);
      fit();
      loadAvatars().then(function () {
        if (!S.active) return;
        setTab(S.tab);
        render();
        faceAll();
        if (!myAvatar()) openPicker(true);
      }).catch(function () {
        firetable.ui.toast("The Turntable avatars didn't load. Try again in a moment.", "error");
      });
      clearInterval(S.timer);
      S.timer = setInterval(tick, 1000);
      watch(true);
    } else {
      document.body.classList.remove("tt-skin");
      moveDjPicker(false);
      clearInterval(S.timer);
      watch(false);
      var dlg = $id("tt-picker");
      if (dlg && dlg.open) dlg.close();
    }
    ["nav-ttAvatar", "nav-ttLaptop"].forEach(function (id) { var n = $id(id); if (n) n.hidden = !S.active; });
    // the room's own pieces measure themselves again (the screen, the stage's fire)
    window.dispatchEvent(new Event("resize"));
  }

  function enter() {
    S.pref = true;
    store.set(STORAGE.ttSkin, "1");
    var live = document.querySelector('#modeTabs [data-mode="live"]');
    if (document.body.classList.contains("ft-discover") && live) live.click();
    apply();
  }

  function leave() {
    S.pref = false;
    store.set(STORAGE.ttSkin, null);
    apply();
    var logo = $id("roomlogo");
    if (logo) logo.focus && logo.focus();
  }

  function toggle() { if (S.pref) leave(); else enter(); }

  // the DJ playlist picker lives under the stage, which this theme covers: it goes to the Queue tab meanwhile
  function moveDjPicker(intoQueue) {
    var el = $id("djlistpickerWrap"), q = $id("queuebox");
    if (!el) return;
    if (intoQueue && q) {
      if (!S.marker) {
        S.marker = document.createComment("djlistpickerWrap's place");
        el.parentNode.insertBefore(S.marker, el);
      }
      q.insertBefore(el, q.firstChild);
    } else if (!intoQueue && S.marker && S.marker.parentNode) {
      S.marker.parentNode.insertBefore(el, S.marker);
    }
  }

  // what the room changes on its own: the song's words and art, the theme, chat
  function watch(on) {
    if (S.mo) { S.mo.disconnect(); S.mo = null; }
    if (S.chatMo) { S.chatMo.disconnect(); S.chatMo = null; }
    if (!on) return;
    var again = firetable.utilities.oncePerFrame(function () { renderSong(); renderTheme(); renderVotes(); });
    S.mo = new MutationObserver(again);
    ["track", "artist", "albumArt", "themePillText", "themePill", "grab", "songlink"].forEach(function (id) {
      var el = $id(id);
      if (el) S.mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "href", "data-album-art-current"] });
    });
    var faces = firetable.utilities.oncePerFrame(faceAll);
    S.chatMo = new MutationObserver(function (recs) {
      faces();
      if (S.tab === "chat") return;
      if (recs.some(function (r) { return r.target.id === "chats" && r.addedNodes.length; })) {
        var b = document.querySelector("#tt-tab-chat .tt-badge");
        if (b) b.hidden = false;
      }
    });
    FACE_ROOTS.forEach(function (id) {
      var el = $id(id);
      if (el) S.chatMo.observe(el, { childList: true, subtree: id !== "chats" });
    });
  }

  function bindEvents() {
    var room = $id("tt-room");
    // the room's own buttons do the work: Awesome is Fire, Storm takes it back, Grab is Grab
    $id("tt-awesome").addEventListener("click", function () {
      if (!ftapi.uid) return firetable.ui.openAuth ? firetable.ui.openAuth() : $id("nav-signin").click();
      if (firetable.fireReactors && firetable.fireReactors[ftapi.uid]) return; // already awesome; Storm takes it back
      $id("fire").click();
    });
    $id("tt-storm").addEventListener("click", function () {
      if (ftapi.uid && firetable.fireReactors && firetable.fireReactors[ftapi.uid]) $id("fire").click();
    });
    $id("tt-grab").addEventListener("click", function () { $id("grab").click(); });
    // touch screens have no hover: a tap on the songboard shows Grab and friends
    room.querySelector(".tt-songboard").addEventListener("click", function (e) {
      if (!e.target.closest(".tt-snag")) this.classList.toggle("tt-show");
    });
    $id("tt-grabPick").addEventListener("click", function () { $id("st-grabPick").click(); });
    $id("tt-link").addEventListener("click", function () { $id("songlink").click(); });
    bindLaptop();
    $id("nav-ttLaptop").addEventListener("click", function () {
      var menu = $id("nav-accountMenu");
      try { if (menu && menu.matches(":popover-open")) menu.hidePopover(); } catch (e) { /* no popover */ }
      openLaptop();
    });
    $id("nav-ttAvatar").addEventListener("click", function () {
      var menu = $id("nav-accountMenu");
      try { if (menu && menu.matches(":popover-open")) menu.hidePopover(); } catch (e) { /* no popover */ }
      openPicker(false);
    });
    $id("tt-exit").addEventListener("click", leave);
    $id("tt-layout").addEventListener("click", function () { setLayout(S.layout === "two" ? "one" : "two", true); });

    room.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest("[data-tt-addme]")) return ftapi.actions.sendBotCommand("!addme");
      var b;
      if (t.closest("[data-tt-stickers]")) return openLaptop();
      if ((b = t.closest("[data-tt-stepdown]"))) return confirmTwice(b, "Tap to step down", function () { ftapi.actions.sendBotCommand("!removeme"); });
      if ((b = t.closest("[data-tt-remove]"))) {
        var uid = b.getAttribute("data-tt-remove");
        var dj = djs().filter(function (d) { return d.id === uid; })[0];
        return confirmTwice(b, "Tap to remove", function () { if (dj) ftapi.actions.sendBotCommand("!remove " + dj.name); });
      }
      var p = t.closest(".tt-person[data-uid]");
      if (p && firetable.ui.tooltip && firetable.ui.tooltip.user) firetable.ui.tooltip.user(p, p.dataset.uid);
    });
    // a name over each person on the floor, as Turntable did
    room.addEventListener("pointerover", function (e) {
      var p = e.target.closest(".tt-listener");
      if (p && firetable.ui.tooltip && firetable.ui.tooltip.show) firetable.ui.tooltip.show(p, p.dataset.name);
    });
    room.addEventListener("pointerout", function (e) {
      if (e.target.closest(".tt-listener") && firetable.ui.tooltip && firetable.ui.tooltip.hide) firetable.ui.tooltip.hide();
    });

    $id("tt-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]");
      if (b) setTab(b.dataset.tab);
    });
    $id("tt-tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var order = S.layout === "two" ? ["room", "chat"] : ["queue", "room", "chat"];
      var next = order[(order.indexOf(S.tab) + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
      setTab(next);
      $id("tt-tab-" + next).focus();
    });
    $id("tt-pane").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tt-sub]");
      if (b) { openSub(b.getAttribute("data-tt-sub")); var f = $id("tt-pane").querySelector("button"); if (f) f.focus(); return; }
      var g = e.target.closest(".tt-guest[data-uid]");
      if (g && firetable.ui.tooltip && firetable.ui.tooltip.user) firetable.ui.tooltip.user(g, g.dataset.uid);
    });
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-tt-signin]")) { var s = $id("nav-signin"); if (s) s.click(); }
    });

    var dlg = $id("tt-picker");
    dlg.addEventListener("click", function (e) {
      var t = e.target, b;
      if (t === dlg) { if (!dlg.classList.contains("tt-required") || myAvatar()) dlg.close(); return; }
      if ((b = t.closest(".tt-pickCell"))) return choose(b.dataset.av);
      if ((b = t.closest(".tt-pickTier"))) { S.pick.tier = b.dataset.tier; S.pick.page = 0; renderPicker(); return; }
      if ((b = t.closest(".tt-dot"))) { S.pick.page = +b.dataset.page; renderPicker(); return; }
      if (t.closest("#tt-pickPrev")) { S.pick.page--; renderPicker(); return; }
      if (t.closest("#tt-pickNext")) { S.pick.page++; renderPicker(); return; }
      if (t.closest("#tt-pickClose")) return dlg.close();
      if (t.closest("#tt-pickLeave")) { dlg.close(); return leave(); }
      if (t.closest("#tt-pickRandom")) {
        var all = (S.tiers.classic || []).concat(S.tiers.gold || [], S.tiers.special || []);
        return choose(all[Math.floor(Math.random() * all.length)]);
      }
    });
    // arrows walk the grid (and turn the page at its edges), Enter picks
    dlg.addEventListener("keydown", function (e) {
      var cell = e.target.closest && e.target.closest(".tt-pickCell");
      if (!cell) return;
      var cells = Array.prototype.slice.call(dlg.querySelectorAll(".tt-pickCell"));
      var i = cells.indexOf(cell), to = null;
      if (e.key === "ArrowRight") to = i + 1;
      else if (e.key === "ArrowLeft") to = i - 1;
      else if (e.key === "ArrowDown") to = i + 4;
      else if (e.key === "ArrowUp") to = i - 4;
      else return;
      e.preventDefault();
      if (to >= cells.length || to < 0) {
        var pages = Math.ceil((S.tiers[S.pick.tier] || []).length / PAGE);
        var np = S.pick.page + (to < 0 ? -1 : 1);
        if (np < 0 || np >= pages) return;
        S.pick.page = np;
        renderPicker();
        cells = dlg.querySelectorAll(".tt-pickCell");
        to = to < 0 ? cells.length - 1 : 0;
      }
      cells.forEach(function (c, k) { c.tabIndex = k === to ? 0 : -1; });
      cells[to].focus();
    });
    // the first time, there's no leaving without an avatar (or leaving the theme)
    dlg.addEventListener("cancel", function (e) {
      if (dlg.classList.contains("tt-required") && !myAvatar()) e.preventDefault();
    });
  }

  function confirmTwice(btn, ask, go) {
    if (btn.classList.contains("armed")) { go(); return; }
    var was = btn.textContent;
    btn.classList.add("armed");
    btn.textContent = ask;
    setTimeout(function () { btn.classList.remove("armed"); btn.textContent = was; }, 4000);
  }

  // ─── The easter egg ───────────────────────────────────────────────────────

  var KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  function inLive() { return !document.body.classList.contains("ft-discover"); }

  function init() {
    S.pref = store.get(STORAGE.ttSkin) === "1";
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { S.konami = 0; return; }
      var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
      S.konami = k === KONAMI[S.konami] ? S.konami + 1 : (k === KONAMI[0] ? 1 : 0);
      if (S.konami === KONAMI.length) { S.konami = 0; if (inLive()) toggle(); }
    });
    var logo = $id("roomlogo");
    if (logo) logo.addEventListener("click", function () {
      if (!inLive()) return;
      var now = Date.now();
      S.logoClicks = S.logoClicks.filter(function (t) { return now - t < 900; }).concat(now);
      if (S.logoClicks.length >= 3) { S.logoClicks = []; toggle(); }
    });

    // Discover and Live: the theme is Live's, and comes back with it
    new MutationObserver(function () { apply(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    var again = firetable.utilities.oncePerFrame(function () {
      if (!S.active) return;
      render();
      if ($id("tt-picker") && $id("tt-picker").open) renderPicker();
    });
    ["tableChanged", "usersChanged", "spotlightStateChanged", "newSong", "danceStateChanged", "playLimitChanged", "loggedIn", "loggedOut", "banListChanged"].forEach(function (ev) {
      ftapi.events.on(ev, function () { setTimeout(again, 0); });
    });
    apply();
  }

  return {
    init: init,
    enter: enter,
    leave: leave,
    toggle: toggle,
    /** the room's fire changed (js/chat.js) */
    fires: function () { if (S.active && S.list) { renderVotes(); renderPeople(); } },
    openPicker: function () { if (S.active) openPicker(false); },
    openLaptop: function () { if (S.active) openLaptop(); },
    isOn: function () { return S.active; },
    // for the tests
    _avatarOf: avatarOf,
    _spots: SPOTS.length
  };
})();
