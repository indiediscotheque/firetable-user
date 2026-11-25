/**
 * ttskin.js — the Turntable theme: an easter egg in Live.
 *
 * A skin over the room that looks like the Turntable.fm people remember:
 * the stage with its truss and speaker stacks, the LED songboard, the
 * awesome meter, the DJs behind their laptops, everyone standing on the floor
 * as a Turntable avatar, and the Queue · Room · Chat panel on the right.
 * Everyone's status is Live's (js/people.js status()): someone away dozes
 * where they stand ("z z Z" over their head), and in the People list their
 * face's dot turns from green to orange, with how long from five minutes on. It's
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
 *
 * Not in the page's scripts: js/lazy.js loads it (after js/ttlaptop.js, the
 * laptops' format) the first time someone goes in (its stand-in for firetable.tt takes the same calls and ways in until
 * then) and calls init() once it's here.
 */
firetable.tt = (function () {
  "use strict";

  var W = 1468; // the stage art's width: everything on it is placed in its units
  var FLOOR = 715; // where the floor's first row stands; the rest spread down to the bottom of the room
  var SEATS = 4; // the bot's deck
  var PAGE = 16;
  var TIERS = [{ id: "classic", label: "Classic" }, { id: "gold", label: "Gold" }, { id: "special", label: "Specials" }];
  // Laptops and their stickers: the format they're kept in (js/ttlaptop.js, loaded first)
  var LAP = firetable.ttLaptop;
  var STICKERS = LAP.STICKERS, EMOJI = LAP.EMOJI, LIDS = LAP.LIDS, MAX_STICKERS = LAP.MAX_STICKERS;
  var keepOn = LAP.keepOn, parseLaptop = LAP.parse, stringifyLaptop = LAP.stringify;

  var S = {
    pref: false,       // on, on this device
    cssReady: false,   // its stylesheet has arrived
    active: false,     // drawn now (on, and in Live)
    built: false,
    tab: "room",       // queue | room | chat
    layout: "one",     // one sidebar (Queue · Room · Chat) or two (Queue on the left, Room · Chat on the right)
    sub: null,         // the Room tab's page: people | recent | fresh | cards (null: its front)
    list: null, byId: {}, tiers: {}, classics: null,
    ready: null,       // the avatars' list, loading
    seats: {}, crowd: {}, // the figures on the stage, by uid
    pick: { tier: "classic", page: 0 },
    timer: 0, ro: null, mo: null, chatMo: null, logoClicks: [],
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

  /**
   * The theme's files linked from the page (index.html's tt-* metas), so the
   * deploy's ?v= versions them (.github/scripts/cache-bust.py): a changed file
   * gets a new link, an unchanged one stays cached.
   */
  function linked(name, path) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return (meta && meta.content) || path;
  }
  /** the version on the avatars' list: the picker's pages change only with it */
  function listVersion() {
    var m = /\?v=[^&]*/.exec(linked("tt-avatars", ""));
    return m ? m[0] : "";
  }

  function loadAvatars() {
    if (S.ready) return S.ready;
    S.ready = fetch(linked("tt-avatars", "img/tt/avatars.json")).then(function (r) {
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
  /**
   * In this theme the room's bot (the hostbot, jarvis) presents as a character
   * of its own: #EVE, avatar 3, the redhead girl, whatever its name or pick.
   * Live never shows it. Known by the hostbot flag, or by name while the bot is
   * on deck but has dropped out of the room for a moment.
   */
  var EVE = { name: "#EVE", av: "3" };
  var BOT_NAMES = { jarvis: true };
  function personaOf(uid, name) {
    var u = ftapi.users && ftapi.users[uid];
    if (u ? u.hostbot : BOT_NAMES[String(name || "").toLowerCase()]) return EVE;
    return null;
  }
  /** Who someone is in this theme: their persona's name, else their own. */
  function nameOf(uid, name) {
    var p = personaOf(uid, name), u = ftapi.users && ftapi.users[uid];
    return p ? p.name : (name || (u && u.username) || "someone");
  }

  function avatarOf(uid, name) {
    var persona = personaOf(uid, name);
    if (persona && validId(persona.av)) return persona.av;
    var u = ftapi.users && ftapi.users[uid];
    if (uid && uid === ftapi.uid) {
      var mine = myAvatar();
      if (mine) return mine;
    }
    if (u && validId(u.ttAvatar)) return u.ttAvatar;
    var classic = classics();
    if (!classic.length) return S.list && S.list[0].id;
    // the next one along when it lands on one taken out of the set
    for (var k = hash(String(uid || "guest")) % classic.length; RETIRED.indexOf(classic[k]) !== -1; k = (k + 1) % classic.length) { /* next */ }
    return classic[k];
  }

  /**
   * Avatars taken out of the set (tools/tt-avatars.py RETIRED): someone who
   * picked one stands as their classic. They keep their place among the
   * classics someone who hasn't picked is given, so nobody else's changes.
   */
  var RETIRED = ["25"];
  function classics() {
    var mine = S.tiers.classic || [];
    if (!mine.length) return [];
    if (!S.classics) S.classics = mine.concat(RETIRED).sort(function (a, b) { return a - b; });
    return S.classics;
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
  // each sprite with its own version (its hash, from tools/tt-avatars.py): a rebuilt one is fetched again
  function src(id) { var a = S.byId[id]; return abs("img/tt/av/" + id + ".webp" + (a && a.v ? "?v=" + a.v : "")); }

  // ─── Laptops ──────────────────────────────────────────────────────────────

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
    if (k !== -1) return "background-image:url(" + abs(linked("tt-stickers", "img/tt/stickers.webp")) + ");background-size:" + (STICKERS.length * 100) + "% 100%;background-position:" + (k * 100 / (STICKERS.length - 1)).toFixed(3) + "% 0";
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
   * centre of its box: a head picture on a body picture, each at its own
   * place, drawn in the order Turntable drew them (the head over the body,
   * or under it for the few with `u`), so the whole head, and only the head,
   * rocks and bobs on a body that stays put, as on Turntable and deepcut
   * (tools/tt-avatars.py).
   */
  function figure(id, side) {
    var a = S.byId[id];
    var el = document.createElement("span");
    el.className = "tt-fig";
    if (!a) return el;
    var s = a[side];
    el.dataset.av = id;
    el.style.cssText = "--w:" + s.w + "px;--h:" + s.h + "px;--img:url(" + src(id) + ");--sw:" + a.sw + "px;--sh:" + a.sh + "px";
    // a part: from x in the sprite, w by h, at (dx, dy) in the figure
    var part = function (name) {
      var p = s[name];
      return '<span class="tt-' + name + '" style="left:' + p[3] + "px;top:" + p[4] + "px;width:" + p[1] + "px;height:" + p[2] + "px;background-position:-" + p[0] + 'px 0"></span>';
    };
    el.innerHTML = s.u ? part("head") + part("body") : part("body") + part("head");
    return el;
  }

  /**
   * A face for lists, chat and the bar: the square round the front's whole
   * head (f.face, measured by tools/tt-avatars.py), as a circle of any size
   * (percentages). The sprite keeps clear space after the front, so a square
   * that reaches past the picture's edge shows nothing else.
   */
  function faceStyle(id) {
    var a = S.byId[id];
    if (!a) return "";
    var f = a.f, box = f.face || [0, 0, Math.min(f.w, f.h)];
    var x = f.x + box[0], y = box[1], m = box[2];
    var bw = a.sw / m, bh = a.sh / m;
    var px = (-x / m) / (1 - bw), py = (-y / m) / (1 - bh);
    return "--tt-face:url(" + src(id) + ");--tt-fsize:" + (bw * 100).toFixed(2) + "% " + (bh * 100).toFixed(2) + "%;--tt-fpos:" +
      (isFinite(px) ? (px * 100).toFixed(2) : 0) + "% " + (isFinite(py) ? (py * 100).toFixed(2) : 0) + "%";
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
          '<button type="button" class="tt-vote tt-storm" id="tt-storm" aria-label="Storm: take back your fire" title="Storm: take back your fire">' + ms("thumb_down", "material-symbols-filled") + "</button>" +
          '<div class="tt-songboard" role="status" aria-live="off">' +
            '<div class="tt-led tt-line1" id="tt-line1"><span></span></div>' +
            '<div class="tt-led tt-line2" id="tt-line2"><span></span></div>' +
            '<div class="tt-led tt-times"><span id="tt-at">0:00</span><span class="tt-prog"><i id="tt-prog"></i></span><span id="tt-left">0:00</span></div>' +
  '<div class="tt-snag" role="group" aria-label="This song">' +
            '<button type="button" id="tt-grab" class="tt-chip" aria-label="Grab: add to your playlist" title="Grab: add to your playlist">' + ms("favorite", "material-symbols-filled") + "<span>Grab</span></button>" +
            '<button type="button" id="tt-grabPick" class="tt-chip tt-chipIcon" aria-label="Choose the playlist" title="Choose the playlist">' + ms("arrow_drop_down") + "</button>" +
            '<button type="button" id="tt-link" class="tt-chip tt-chipIcon" aria-label="Open the song" title="Open the song">' + ms("open_in_new") + "</button>" +
          "</div>" +
          "</div>" +
          '<button type="button" class="tt-vote tt-awesome" id="tt-awesome" aria-label="Awesome! (Fire)" title="Awesome! (Fire)">' + ms("thumb_up", "material-symbols-filled") + '<span class="tt-count" id="tt-count" aria-hidden="true" hidden></span></button>' +
        "</div>" +
        '<div class="tt-djlight" id="tt-djlight" aria-hidden="true"></div>' +
        '<div class="tt-table" id="tt-table" role="group" aria-label="The DJs"></div>' +
        '<div class="tt-tabletop" aria-hidden="true"></div>' +
        '<div class="tt-crowd" id="tt-crowd" role="group" aria-label="The floor"></div>' +
        '<div class="tt-djmenu" id="tt-djmenu" role="menu" hidden></div>' +
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
    var tabs = document.createElement("nav");
    tabs.id = "tt-tabs";
    tabs.setAttribute("aria-label", "Panel");
    tabs.innerHTML = '<div class="tt-tablist" role="tablist" aria-label="Panel">' + [["queue", "queue_music", "Queue"], ["room", "info", "Room"], ["chat", "chat_bubble", "Chat"]].map(function (t) {
      return '<button type="button" role="tab" class="tt-tab" id="tt-tab-' + t[0] + '" data-tab="' + t[0] + '" aria-selected="false">' + ms(t[1], "material-symbols-filled") + "<span>" + t[2] + '</span><span class="tt-badge" hidden></span></button>';
    }).join("") + "</div>";
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
          // the stickers faintly past the lid's edge too (here only: the room sees them cut off), behind the lid
          '<div class="tt-laptop tt-lapBig" id="tt-lapBig"><div class="tt-lapGhost" id="tt-lapGhost" aria-hidden="true"></div><div class="tt-lid" id="tt-lapLid" role="group" aria-label="Your laptop\'s lid"></div>' +
            // the picked sticker's corner: drag it round to turn the sticker (outside the lid, so it's never cut off)
            '<span class="tt-lapTurn" id="tt-lapTurn" title="Drag to turn (Shift: in steps)" aria-hidden="true" hidden>' + ms("rotate_right") + "</span></div>" +
          '<div class="tt-lapTools" id="tt-lapTools" role="toolbar" aria-label="The sticker you picked">' +
            '<button type="button" data-lap="smaller" aria-label="Smaller" title="Smaller (-)">' + ms("remove") + "</button>" +
            '<button type="button" data-lap="bigger" aria-label="Bigger" title="Bigger (+)">' + ms("add") + "</button>" +
            '<button type="button" data-lap="front" aria-label="To the front" title="To the front">' + ms("flip_to_front") + "</button>" +
            '<button type="button" data-lap="remove" aria-label="Peel it off" title="Peel it off (Delete)">' + ms("delete") + "</button>" +
          "</div>" +
          '<p class="tt-lapHint" id="tt-lapHint">Drag stickers around the lid; drag the gold corner to turn one. Arrow keys move the one you picked, [ and ] turn it.</p>' +
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
    var links = [["facebookURL", "Facebook", "facebook"], ["instagramURL", "Instagram", "instagram"], ["xURL", "X", "x"], ["redditURL", "Reddit", "reddit"], ["threadsURL", "Threads", "threads"], ["discordURL", "Discord", "discord"], ["soundcloudURL", "SoundCloud", "soundcloud"], ["blueskyURL", "Bluesky", "bluesky"], ["lastfmURL", "Last.fm", "lastfm"]];
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
        // Play Music on the first open seat for anyone not already DJing: it takes the seat,
        // or asks a visitor to sign in
        var offer = !offered && !mine;
        offered = offered || offer;
        var does = ftapi.uid ? "data-tt-addme" : "data-tt-signin";
        var want = "empty" + (offer ? "+" + does : "");
        if (seat.dataset.who !== want) {
          seat.dataset.who = want;
          seat.className = "tt-seat tt-empty";
          seat.innerHTML = offer
            ? '<button type="button" class="tt-play tt-yellow" ' + does + '>Play<br>Music</button><span class="tt-vinyl" aria-hidden="true"></span>'
            : '<span class="tt-vinyl" aria-hidden="true"></span>';
        }
        continue;
      }
      keep[d.id] = true;
      var lapKey = stringifyLaptop(laptopOf(d.id));
      if (seat.dataset.who !== d.id || seat.dataset.av !== avatarOf(d.id, d.name) || seat.dataset.lap !== lapKey) {
        seat.dataset.who = d.id;
        seat.dataset.av = avatarOf(d.id, d.name);
        seat.dataset.lap = lapKey;
        seat.className = "tt-seat";
        var chin = (S.byId[seat.dataset.av] && S.byId[seat.dataset.av].f.chin) || 62;
        seat.innerHTML = '<button type="button" class="tt-person tt-dj" data-uid="' + esc(d.id) + '" aria-label="' + esc(nameOf(d.id, d.name)) + ', DJ" style="--chin:' + chin + '%">' +
          '<span class="tt-figwrap"></span></button>' + laptopHtml(d.id) +
          '<span class="tt-plate"><b>' + esc(nameOf(d.id, d.name)) + '</b><span class="tt-plays"></span></span>';
        seat.querySelector(".tt-figwrap").appendChild(figure(seat.dataset.av, "f"));
      }
      seat.classList.toggle("tt-on", d.id === active);
      seat.classList.toggle("tt-fired", !!fired[d.id]);
      seat.classList.toggle("tt-self", d.id === ftapi.uid);
      // on deck but gone from the room (Live's "ghost"): dimmed, as Live dims them
      seat.classList.toggle("tt-ghost", !!(ftapi.users && typeof ftapi.users === "object" && !ftapi.users[d.id]));
      var st = firetable.people.status(d.id);
      seat.classList.toggle("tt-idle", st.away);
      seat.querySelector(".tt-dj").setAttribute("aria-label", nameOf(d.id, d.name) + ", DJ" + (st.away ? ", " + st.label.toLowerCase() : ""));
      seat.querySelector(".tt-plays").textContent = d.plays + "/" + (firetable.playlimit || "∞");
    }
    // a DJ who left takes their menu with them
    if (M.uid && !keep[M.uid]) closeDjMenu();
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
    // sizes as deepcut's floor: the front row at the avatar's own size, the back row three quarters
    var out = [], rows = [[0, 0.74, 14], [0.18, 0.79, 13], [0.37, 0.84, 13], [0.57, 0.89, 12], [0.78, 0.94, 11], [1, 1.0, 10]];
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
      var name = nameOf(u);
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
      var st = firetable.people.status(u);
      el.setAttribute("aria-label", name + (u === ftapi.uid ? " (you)" : "") + (st.away ? ", " + st.label.toLowerCase() : ""));
      el.style.cssText = "left:" + spot.x + "px;--f:" + spot.f.toFixed(3) + ";--d:" + spot.s + ";z-index:" + Math.round(10 + spot.f * 900) + ";animation-delay:" + el.style.animationDelay;
      el.dataset.name = name;
      el.classList.toggle("tt-fired", !!fired[u]);
      el.classList.toggle("tt-self", u === ftapi.uid);
      el.classList.toggle("tt-idle", st.away);
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
    aw.setAttribute("aria-label", count ? "Awesome! (Fire) " + count : "Awesome! (Fire)");
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
    ["tt-artL", "tt-artR"].forEach(function (id) {
      var el = $id(id);
      el.style.backgroundImage = art;
      el.style.backgroundSize = el.style.backgroundPosition = "";
    });
    if (playing && artUrl) artTrackZoom(abs(artUrl));
    var link = $id("songlink");
    $id("tt-link").hidden = !playing || !link || !link.getAttribute("href");
    tick();
  }

  /**
   * An art track (a still cover shown as a video) comes as a picture with flat
   * bars on all four sides: the right screen zooms so the cover fills its
   * height. Anything else (a video's frame, square art) stays as it is. One
   * look per picture, at a 96-pixel copy, kept.
   */
  var ART = { seen: {} };
  var SCREEN_W = 302, SCREEN_H = 239; // .tt-screenart's size, in the stage's units
  function artTrackZoom(url) {
    var apply = function (box) {
      var el = $id("tt-artR");
      if (!box || !el || el.style.backgroundImage.indexOf(url) === -1) return;
      var k = SCREEN_H / box.ch;
      el.style.backgroundSize = (box.iw * k).toFixed(1) + "px " + (box.ih * k).toFixed(1) + "px";
      el.style.backgroundPosition = (SCREEN_W / 2 - (box.cx + box.cw / 2) * k).toFixed(1) + "px " + (SCREEN_H / 2 - (box.cy + box.ch / 2) * k).toFixed(1) + "px";
    };
    if (url in ART.seen) return apply(ART.seen[url]);
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      var box = null;
      try { box = coverBox(img); } catch (e) { /* the picture can't be read: leave it as it is */ }
      ART.seen[url] = box;
      apply(box);
    };
    img.onerror = function () { ART.seen[url] = null; };
    img.src = url;
  }
  /** The cover inside a picture with flat bars round it, in the picture's pixels; null when it isn't one. */
  function coverBox(img) {
    var w = 96, h = Math.max(1, Math.round(96 * img.naturalHeight / img.naturalWidth));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    var px = x.getImageData(0, 0, w, h).data;
    var lum = function (i) { return px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11; };
    // a line is a bar when it's all one colour, and the colour of the edge's outermost line
    // (a cover's own flat background, say green inside black bars, isn't a bar)
    var line = function (from, to, step) {
      var n = 0, s = 0, s2 = 0, rgb = [0, 0, 0];
      for (var i = from; i < to; i += step) {
        var l = lum(i); s += l; s2 += l * l; n++;
        rgb[0] += px[i]; rgb[1] += px[i + 1]; rgb[2] += px[i + 2];
      }
      var mean = s / n;
      return { flat: s2 / n - mean * mean < 60, rgb: [rgb[0] / n, rgb[1] / n, rgb[2] / n] };
    };
    var strip = function (at, from, to, step) {
      var edge = at(from);
      if (!edge.flat) return from;
      var i = from;
      while (i !== to) {
        var l = at(i);
        if (!l.flat || l.rgb.some(function (v, c) { return Math.abs(v - edge.rgb[c]) > 24; })) break;
        i += step;
      }
      return i;
    };
    var row = function (y) { return line(y * w * 4, (y + 1) * w * 4, 4); };
    var top = strip(row, 0, h - 1, 1);
    var bottom = strip(row, h - 1, top, -1);
    var col = function (xx) { return line((top * w + xx) * 4, ((bottom + 1) * w + xx) * 4, w * 4); };
    var left = strip(col, 0, w - 1, 1);
    var right = strip(col, w - 1, left, -1);
    var cw = right - left + 1, ch = bottom - top + 1;
    // bars at the sides, each a good part of the width, round something about square: a cover
    if (left < w * 0.08 || w - 1 - right < w * 0.08 || ch < h * 0.3 || cw / ch < 0.75 || cw / ch > 1.35) return null;
    var f = img.naturalWidth / w;
    return { iw: img.naturalWidth, ih: img.naturalHeight, cx: left * f, cy: top * f, cw: cw * f, ch: ch * f };
  }

  function setLed(id, text) {
    var el = $id(id);
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    el.innerHTML = '<span class="tt-run"><span>' + esc(text) + "</span></span>";
    fitLed(el);
  }

  /**
   * A line that doesn't fit scrolls as an LED sign does: a dot column at a
   * time (Doto's dots are 0.1em apart), round and round, a gap between.
   */
  var LED_COLS_PER_SEC = 16;
  function fitLed(el) {
    requestAnimationFrame(function () {
      var run = el.firstChild, one = run && run.firstChild;
      if (!one) return;
      el.classList.remove("tt-marquee");
      while (run.childNodes.length > 1) run.removeChild(run.lastChild);
      if (one.offsetWidth <= el.clientWidth) return;
      var copy = one.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      run.appendChild(copy);
      el.classList.add("tt-marquee"); // the gap after each copy comes with it
      var pitch = parseFloat(getComputedStyle(el).fontSize) / 10;
      var cols = Math.max(1, Math.round(one.offsetWidth / pitch));
      el.style.setProperty("--dist", (cols * pitch).toFixed(2) + "px");
      el.style.setProperty("--cols", cols);
      el.style.setProperty("--len", (cols / LED_COLS_PER_SEC).toFixed(2) + "s");
    });
  }
  function refitLeds() { ["tt-line1", "tt-line2"].forEach(function (id) { var el = $id(id); if (el && el.dataset.text) fitLed(el); }); }

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
    // a DJ on deck but gone from the room is still listed with the DJs, dimmed (as Live's list)
    var gone = {};
    djs().forEach(function (d) { if (!users[d.id]) { gone[d.id] = { username: d.name }; groups.djs.push(d.id); } });
    var who = function (u) { return users[u] || gone[u] || {}; };
    var name = function (u) { return nameOf(u, who(u).username).toLowerCase(); };
    var html = [["djs", "DJs"], ["mods", "Moderators"], ["bots", "Bots"], ["audience", "Audience"]].map(function (g) {
      var list = groups[g[0]];
      if (!list.length) return "";
      if (g[0] !== "djs") list.sort(function (a, b) { return name(a) < name(b) ? -1 : 1; });
      else list.sort(function (a, b) { return seats.indexOf(a) - seats.indexOf(b); });
      return '<h2 class="tt-group">' + g[1] + " <span>" + list.length + "</span></h2><ul>" + list.map(function (u) {
        var d = who(u), st = firetable.people.status(u);
        var badges = (d.supermod ? ms("verified_user", "material-symbols-filled tt-b tt-bmod") : d.mod ? ms("shield", "material-symbols-filled tt-b tt-bmod") : "") +
          (d.hostbot ? ms("smart_toy", "material-symbols-filled tt-b") : "") +
          (firetable.fireReactors && firetable.fireReactors[u] ? ms("thumb_up", "material-symbols-filled tt-b tt-bawe") : "");
        // the face's dot: green here, orange away (none for a DJ gone from the room, as in Live)
        return '<li><button type="button" class="tt-guest' + (gone[u] ? " tt-gone" : "") + (st.away ? " tt-idle" : "") + '" data-uid="' + esc(u) + '"' + (st.away || gone[u] ? ' title="' + esc(st.label) + '"' : "") + ">" +
          '<span class="tt-face" style="' + faceStyle(avatarOf(u, d.username)) + '">' + (gone[u] ? "" : '<span class="tt-pres" aria-hidden="true"></span>') + '</span><span class="tt-gname">' + esc(nameOf(u, d.username)) + "</span>" +
          (st.away ? '<span class="sr-only"> (away)</span>' : "") + badges + (st.since ? '<span class="pe-away tt-away" data-since="' + st.since + '">' + st.time + "</span>" : "") + "</button></li>";
      }).join("") + "</ul>";
    }).join("");
    // the radio's listeners by country and the guests (js/audience.js)
    if (firetable.audience) html += firetable.audience.html("tt");
    if (box.innerHTML !== html) { box.innerHTML = html; if (firetable.audience) firetable.audience.emojify(box); }
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
    document.querySelectorAll("#chats .newChat").forEach(function (line) {
      var face = line.querySelector(".ft-avatar[data-avatar-uid]"), nm = line.querySelector(".chatName");
      if (!face || !nm) return;
      var p = personaOf(face.getAttribute("data-avatar-uid"), nm.textContent);
      if (p) nm.setAttribute("data-tt-name", p.name); else nm.removeAttribute("data-tt-name");
    });
    FACE_ROOTS.forEach(function (id) {
      var root = $id(id);
      if (!root) return;
      root.querySelectorAll(".ft-avatar:not(.skel)").forEach(function (el) {
        var uid = whoseFace(el);
        var line = el.closest(".newChat"), hint = line && line.querySelector(".chatName");
        var av = uid ? avatarOf(uid, hint ? hint.textContent : el.getAttribute("aria-label")) : "";
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
    var atlas = "img/tt/pick/" + S.pick.tier + "-" + S.pick.page + ".webp" + listVersion();
    $id("tt-pickGrid").innerHTML = ids.slice(start, start + PAGE).map(function (id, k) {
      return '<button type="button" role="option" class="tt-pickCell" data-av="' + id + '" aria-selected="' + (id === mine) + '" aria-label="Avatar ' + (start + k + 1) + '" tabindex="' + (id === mine || (!mine && k === 0) ? 0 : -1) + '">' +
        '<span class="tt-pickFig" style="background-image:url(' + atlas + ");background-position:" + (k * 100 / (PAGE - 1)).toFixed(4) + '% 0"></span></button>';
    }).join("");
    // the next page is ready before it's asked for
    if (S.pick.page + 1 < pages) new Image().src = "img/tt/pick/" + S.pick.tier + "-" + (S.pick.page + 1) + ".webp" + listVersion();
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
    $id("tt-lapGhost").innerHTML = stickersHtml(d, false);
    document.querySelectorAll("#tt-laptopEdit .tt-lidPick").forEach(function (b) {
      b.setAttribute("aria-checked", b.dataset.lid === d.lid ? "true" : "false");
    });
    var sel = L.sel >= 0 ? $id("tt-lapLid").querySelector('[data-n="' + L.sel + '"]') : null;
    if (sel) sel.classList.add("on");
    $id("tt-lapTools").classList.toggle("tt-off", !sel);
    $id("tt-lapTools").querySelectorAll("button").forEach(function (b) { b.disabled = !sel; });
    $id("tt-lapCount").textContent = d.items.length + " of " + MAX_STICKERS;
    placeTurn();
    if (sel && focusSel) sel.focus();
  }

  /** The turning handle, at the picked sticker's top-right corner as it's turned. */
  function placeTurn() {
    var h = $id("tt-lapTurn"), it = L.draft && L.draft.items[L.sel], lid = $id("tt-lapLid");
    h.hidden = !it;
    if (!it) return;
    var w = lid.clientWidth, ht = lid.clientHeight;
    var half = w * 0.3 * (it.s / 100) / 2 + 4; // the sticker is 30% of the lid wide, square; past its outline
    var a = it.r * Math.PI / 180;
    // (half, -half) turned by r
    h.style.left = (lid.offsetLeft + it.x / 100 * w + half * Math.cos(a) + half * Math.sin(a)) + "px";
    h.style.top = (lid.offsetTop + it.y / 100 * ht + half * Math.sin(a) - half * Math.cos(a)) + "px";
  }

  function lapAct(what) {
    var d = L.draft, i = d.items[L.sel];
    if (what === "clear") { d.items = []; L.sel = -1; return renderLaptop(); }
    if (!i) return;
    if (what === "left") i.r = turnTo(i.r - 15);
    else if (what === "right") i.r = turnTo(i.r + 15);
    else if (what === "smaller") keepOn(Object.assign(i, { s: Math.max(40, i.s - 15) }));
    else if (what === "bigger") keepOn(Object.assign(i, { s: Math.min(160, i.s + 15) }));
    else if (what === "front") { d.items.splice(L.sel, 1); d.items.push(i); L.sel = d.items.length - 1; }
    else if (what === "remove") { d.items.splice(L.sel, 1); L.sel = -1; }
    renderLaptop(true);
  }

  /** An angle kept within -180..180 degrees (one turn either way). */
  function turnTo(r) { r = ((r + 180) % 360 + 360) % 360 - 180; return r; }

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
      try { s.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that's already gone: the lid still gets the moves */ }
      lid.querySelectorAll(".tt-sticker.on").forEach(function (o) { o.classList.remove("on"); });
      s.classList.add("on");
      $id("tt-lapTools").classList.remove("tt-off");
      $id("tt-lapTools").querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      placeTurn();
      e.preventDefault();
    });
    lid.addEventListener("pointermove", function (e) {
      if (!L.drag || e.pointerId !== L.drag.id) return;
      var r = L.drag.r, it = L.draft.items[L.sel];
      it.x = (e.clientX - L.drag.dx - r.left) / r.width * 100;
      it.y = (e.clientY - L.drag.dy - r.top) / r.height * 100;
      keepOn(it); // off the edge if you like, so long as some of it stays on
      [L.drag.el, $id("tt-lapGhost").children[L.sel]].forEach(function (el) {
        if (el) { el.style.left = it.x + "%"; el.style.top = it.y + "%"; }
      });
      placeTurn();
    });
    var drop = function () { if (L.drag) { L.drag = null; renderLaptop(true); } };
    lid.addEventListener("pointerup", drop);
    lid.addEventListener("pointercancel", drop);
    // turn the picked sticker by its corner: the angle the pointer moves round its middle
    var turn = $id("tt-lapTurn"), T = null;
    var angle = function (e) { return Math.atan2(e.clientY - T.cy, e.clientX - T.cx) * 180 / Math.PI; };
    turn.addEventListener("pointerdown", function (e) {
      var it = L.draft.items[L.sel];
      if (!it) return;
      var r = lid.getBoundingClientRect();
      T = { id: e.pointerId, cx: r.left + it.x / 100 * r.width, cy: r.top + it.y / 100 * r.height, r0: it.r };
      T.a0 = angle(e);
      try { turn.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that's already gone: the moves still come here */ }
      turn.classList.add("on");
      e.preventDefault();
    });
    turn.addEventListener("pointermove", function (e) {
      if (!T || e.pointerId !== T.id) return;
      var it = L.draft.items[L.sel], r = T.r0 + angle(e) - T.a0;
      it.r = turnTo(e.shiftKey ? Math.round(r / 15) * 15 : Math.round(r));
      [lid.querySelector('[data-n="' + L.sel + '"]'), $id("tt-lapGhost").children[L.sel]].forEach(function (el) {
        if (el) el.style.setProperty("--r", it.r + "deg");
      });
      placeTurn();
    });
    var stopTurn = function () { if (T) { T = null; turn.classList.remove("on"); renderLaptop(true); } };
    turn.addEventListener("pointerup", stopTurn);
    turn.addEventListener("pointercancel", stopTurn);
    lid.addEventListener("keydown", function (e) {
      if (!e.target.closest(".tt-sticker") || L.sel < 0) return;
      var it = L.draft.items[L.sel], step = e.shiftKey ? 8 : 2, k = e.key;
      if (k === "ArrowLeft") keepOn(Object.assign(it, { x: it.x - step }));
      else if (k === "ArrowRight") keepOn(Object.assign(it, { x: it.x + step }));
      else if (k === "ArrowUp") keepOn(Object.assign(it, { y: it.y - step }));
      else if (k === "ArrowDown") keepOn(Object.assign(it, { y: it.y + step }));
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
      // the theme's stylesheet isn't in the page until someone first comes in
      // (so nobody else downloads it); nothing shows until it's here
      if (!S.cssReady) {
        S.active = false;
        if (!$id("tt-css")) {
          var meta = document.querySelector('meta[name="tt-css"]');
          var css = document.createElement("link");
          css.rel = "stylesheet";
          css.id = "tt-css";
          css.href = meta ? meta.content : "css/ttskin.css";
          css.addEventListener("load", function () { S.cssReady = true; apply(); });
          css.addEventListener("error", function () {
            css.remove();
            firetable.ui.toast("The Turntable theme didn't load. Try again in a moment.", "error");
          });
          document.head.appendChild(css);
        }
        return;
      }
      build();
      document.body.classList.add("tt-skin");
      ftLook.apply(); // the theme is drawn dark whatever the look (js/head.js)
      document.body.setAttribute("data-tt-tab", S.tab);
      document.body.setAttribute("data-tt-sub", S.sub || "front");
      moveDjPicker(true);
      setLayout(store.get(STORAGE.ttLayout) || (window.innerWidth >= 1280 ? "two" : "one"), false);
      fit();
      if (document.fonts && document.fonts.load) document.fonts.load('900 20px "Doto"').then(refitLeds, function () {});
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
      ftLook.apply(); // light mode comes back, if it's on
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

    bindDjMenu(room);
    room.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest("[data-tt-addme]")) return ftapi.actions.sendBotCommand("!addme");
      var dj = t.closest(".tt-seat[data-who] .tt-dj, .tt-seat[data-who] > .tt-laptop");
      if (dj) {
        var seat = dj.closest(".tt-seat");
        if (M.uid === seat.dataset.who && e.pointerType !== "mouse" && e.detail) return closeDjMenu();
        return openDjMenu(seat, !e.detail); // a keyboard press goes into the menu
      }
      var p = t.closest(".tt-person[data-uid]");
      if (p && firetable.ui.tooltip && firetable.ui.tooltip.user) firetable.ui.tooltip.user(p, p.dataset.uid);
    });
    // a name over each person on the floor, as Turntable did, and whether they're away
    room.addEventListener("pointerover", function (e) {
      var p = e.target.closest(".tt-listener");
      if (!p || !firetable.ui.tooltip || !firetable.ui.tooltip.show) return;
      var st = firetable.people.status(p.dataset.uid); // the time away as it is now, not at the last draw
      firetable.ui.tooltip.show(p, p.dataset.name + (st.away ? " · " + st.label.toLowerCase() : ""));
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

  // ─── A DJ's menu (hover the laptop, or tap the DJ), as Turntable's ─────────

  var M = { uid: null, timer: 0 };
  function rank(u) { return !u ? 0 : u.supermod ? 2 : u.mod ? 1 : 0; }

  /** What the person looking may do to this DJ: the room's own actions only. */
  function djMenuItems(d) {
    var users = ftapi.users || {}, me = ftapi.uid && users[ftapi.uid], them = users[d.id] || {};
    var self = d.id === ftapi.uid, entry = null, t = firetable.tableData || {};
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k) && t[k] && t[k].id === d.id) entry = t[k];
    var leaving = !!(entry && entry.removeAfter);
    var items = [];
    if (self) {
      items.push(["stickers", "Laptop stickers"]);
      items.push(["bus", leaving ? "Stay after this song" : "Step down after this song"]);
      items.push(["stepdown", "Step down", "Tap again to step down"]);
      return items;
    }
    if (ftapi.uid) items.push(["mention", "@ Mention"]);
    items.push(["card", "Their card"]);
    var page = firetable.discover && firetable.discover.djPage && firetable.discover.djPage(d.id, d.name);
    if (page) items.push(["page", "Their DJ page", null, page]);
    if (me && (me.mod || me.supermod) && !them.hostbot && rank(them) <= rank(me)) {
      if (d.id === firetable.displayedDjId && firetable.song && firetable.song.cid != 0) items.push(["skip", "Skip their song", "Tap again to skip"]);
      items.push(["theirbus", leaving ? "Let them stay" : "Step them down after this song"]);
      items.push(["remove", "Remove DJ", "Tap again to remove"]);
    }
    if (me && me.supermod && !them.supermod && !them.hostbot) {
      items.push(them.mod ? ["unmod", "Remove moderator"] : ["mod", "Make moderator"]);
      items.push(["suspend", "Suspend", "Tap again to suspend", null, true]);
    }
    return items;
  }

  function openDjMenu(seat, focus) {
    var uid = seat && seat.dataset.who, d = djs().filter(function (x) { return x.id === uid; })[0];
    if (!d) return;
    clearTimeout(M.timer);
    var menu = $id("tt-djmenu"), them = (ftapi.users || {})[d.id] || {};
    var role = them.hostbot ? "Bot" : them.supermod ? "Supermod" : them.mod ? "Moderator" : "";
    var fires = firetable.fireReactors && firetable.fireReactors[d.id] ? " · gave it an Awesome" : "";
    menu.innerHTML = '<div class="tt-djhead"><b>' + esc(nameOf(d.id, d.name)) + "</b><span>" + d.plays + "/" + esc(firetable.playlimit || "∞") + " plays" +
      (role ? " · " + role : "") + fires + "</span></div>" +
      djMenuItems(d).map(function (it) {
        var attrs = ' role="menuitem" class="tt-djitem' + (it[4] ? " tt-danger" : "") + '" data-act="' + it[0] + '"' + (it[2] ? ' data-ask="' + esc(it[2]) + '"' : "");
        return it[3] ? "<a" + attrs + ' href="' + esc(it[3]) + '">' + esc(it[1]) + "</a>" : '<button type="button"' + attrs + ">" + esc(it[1]) + "</button>";
      }).join("");
    menu.setAttribute("aria-label", nameOf(d.id, d.name));
    menu.style.setProperty("--i", seat.style.getPropertyValue("--i"));
    menu.hidden = false;
    M.uid = d.id;
    document.querySelectorAll("#tt-table .tt-seat.tt-menu").forEach(function (s) { s.classList.remove("tt-menu"); });
    seat.classList.add("tt-menu");
    if (focus) { var first = menu.querySelector(".tt-djitem"); if (first) first.focus(); }
  }
  function closeDjMenu(back) {
    clearTimeout(M.timer);
    var menu = $id("tt-djmenu");
    if (!menu || menu.hidden) return;
    var seat = document.querySelector("#tt-table .tt-seat.tt-menu");
    menu.hidden = true;
    M.uid = null;
    if (seat) {
      seat.classList.remove("tt-menu");
      if (back) { var b = seat.querySelector(".tt-dj"); if (b) b.focus(); }
    }
  }
  function djMenuAct(btn) {
    var uid = M.uid, d = djs().filter(function (x) { return x.id === uid; })[0];
    if (!d) return closeDjMenu();
    var act = btn.dataset.act, name = d.name;
    var run = function () {
      if (act === "stickers") openLaptop();
      else if (act === "bus") ftapi.actions.sendBotCommand(btn.textContent.indexOf("Stay") === 0 ? "!dontremoveme" : "!removeafter");
      else if (act === "stepdown") ftapi.actions.sendBotCommand("!removeme");
      else if (act === "mention") firetable.ui.mentionInChat(name);
      else if (act === "card") { var p = document.querySelector('#tt-table .tt-dj[data-uid="' + CSS.escape(uid) + '"]'); if (p && firetable.ui.tooltip.user) firetable.ui.tooltip.user(p, uid); }
      else if (act === "skip") ftapi.actions.sendBotCommand("!skip");
      else if (act === "theirbus") ftapi.actions.sendBotCommand((btn.textContent.indexOf("Let") === 0 ? "!dontremoveme " : "!removeafter ") + name);
      else if (act === "remove") ftapi.actions.sendBotCommand("!remove " + name);
      else if (act === "mod") ftapi.actions.modUser(uid);
      else if (act === "unmod") ftapi.actions.unmodUser(uid);
      else if (act === "suspend") ftapi.actions.banUser(uid);
      closeDjMenu();
    };
    if (act === "page") { closeDjMenu(); return; } // the link goes to Discover itself
    if (btn.dataset.ask) return confirmTwice(btn, btn.dataset.ask, run);
    run();
  }

  function bindDjMenu(room) {
    var table = $id("tt-table"), menu = $id("tt-djmenu");
    var hover = function (e) { return e.pointerType === "mouse"; };
    // pointing at a laptop (or the DJ) opens their menu, as Turntable's did; leaving closes it
    table.addEventListener("pointerover", function (e) {
      var seat = hover(e) && e.target.closest(".tt-seat[data-who]:not(.tt-empty)");
      if (!seat) return;
      clearTimeout(M.timer);
      if (M.uid !== seat.dataset.who) M.timer = setTimeout(function () { openDjMenu(seat); }, 160);
    });
    [table, menu].forEach(function (el) {
      el.addEventListener("pointerout", function (e) {
        if (!hover(e) || (e.relatedTarget && (menu.contains(e.relatedTarget) || (e.relatedTarget.closest && e.relatedTarget.closest(".tt-seat.tt-menu"))))) return;
        clearTimeout(M.timer);
        M.timer = setTimeout(function () { closeDjMenu(); }, 260);
      });
      el.addEventListener("pointerover", function (e) { if (hover(e) && el === menu) clearTimeout(M.timer); });
    });
    menu.addEventListener("click", function (e) {
      var b = e.target.closest(".tt-djitem");
      if (b) djMenuAct(b);
    });
    menu.addEventListener("keydown", function (e) {
      var items = Array.prototype.slice.call(menu.querySelectorAll(".tt-djitem")), i = items.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); closeDjMenu(true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === "Tab") closeDjMenu();
    });
    // a tap anywhere else closes it
    document.addEventListener("pointerdown", function (e) {
      if (M.uid && !menu.contains(e.target) && !e.target.closest(".tt-seat.tt-menu")) closeDjMenu();
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

  function inLive() { return !document.body.classList.contains("ft-discover"); }

  function init() {
    S.pref = store.get(STORAGE.ttSkin) === "1";
    document.addEventListener("keydown", ftLazy.konami(function () { if (inLive()) toggle(); }));
    var logo = $id("roomlogo");
    if (logo) logo.addEventListener("click", function () {
      if (!inLive()) return;
      var now = Date.now();
      S.logoClicks = S.logoClicks.filter(function (t) { return now - t < 900; }).concat(now);
      if (S.logoClicks.length >= 3) { S.logoClicks = []; toggle(); }
    });

    // Discover and Live: the theme is Live's, and comes back with it
    new MutationObserver(function () { apply(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    again = firetable.utilities.oncePerFrame(function () {
      if (!S.active) return;
      render();
      if ($id("tt-picker") && $id("tt-picker").open) renderPicker();
    });
    ["tableChanged", "usersChanged", "spotlightStateChanged", "newSong", "danceStateChanged", "playLimitChanged", "loggedIn", "loggedOut", "banListChanged", "audienceChanged"].forEach(function (ev) {
      ftapi.events.on(ev, function () { setTimeout(again, 0); });
    });
    apply();
  }

  var again = null; // a redraw, once a frame (made in init)

  return {
    init: init,
    enter: enter,
    leave: leave,
    toggle: toggle,
    /** the room's fire changed (js/chat.js) */
    fires: function () { if (S.active && S.list) { renderVotes(); renderPeople(); } },
    /** Live switched the DJ shown as playing (js/room.js): the spotlight and the nodding head move to them */
    stage: function () { if (S.active && S.list && again) again(); },
    openPicker: function () { if (S.active) openPicker(false); },
    openLaptop: function () { if (S.active) openLaptop(); },
    isOn: function () { return S.active; },
    // for the tests
    _avatarOf: avatarOf,
    _coverBox: coverBox,
    _spots: SPOTS.length
  };
})();
