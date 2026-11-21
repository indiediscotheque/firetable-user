/**
 * avatar-builder.js — Your Bouletmaton: the builder (#bm-builderBox), the
 * Profile section that opens it and switches it on or off
 * (#ac-bouletSection), and how the room finds everyone's
 * (js/bouletmaton.js draws them; helpers.js avatarURL decides who shows one).
 *
 * Nobody has a Bouletmaton until they build one. A member who saved one and
 * switched it on (users/<uid>/boulet, users/<uid>/bouletOn) shows it,
 * whatever the room's style, except in October, when everyone is a monster.
 * They switch it on or off any time in Profile. When a supermod sets the
 * room to Bouletmaton, members who haven't built one get the builder once a
 * visit, starting from every choice at 1.
 */

(function () {
  var known = {};    // uid -> active code or null, for people looked up or seen in the room
  var lastSeen = {}; // uid -> active code or null, as last seen in users/ (to notice a change)
  var prompted = false; // the builder opened by itself this visit
  var redrawTimer = 0;
  var UID_RE = /^[A-Za-z0-9_-]{1,128}$/; // a database key we can look up

  function valid(code) { return Bouletmaton.isCode(code) ? code : null; }
  /** A member's Bouletmaton if they've built it and switched it on, else null. */
  function active(u) { return u && u.bouletOn === true ? valid(u.boulet) : null; }

  // ─── How the room finds everyone's ───────────────────────────────────────

  firetable.avatars = {
    /** uid -> their switched-on Bouletmaton, null (none, or off), or undefined (not known yet). */
    bouletOf: function (uid) {
      if (!uid || !UID_RE.test(uid)) return null;
      if (uid === ftapi.uid && firetable.myBoulet !== undefined) return firetable.myBouletOn ? firetable.myBoulet : null;
      var u = ftapi.users && ftapi.users[uid];
      if (u) return active(u);
      if (Object.prototype.hasOwnProperty.call(known, uid)) return known[uid];
      return undefined;
    },
    /** Look up someone not in the room: Promise of their switched-on Bouletmaton or null. */
    lookup: function (uid) {
      if (Object.prototype.hasOwnProperty.call(known, uid)) return Promise.resolve(known[uid]);
      var read = function (k) { return ftapi.db().ref("users/" + uid + "/" + k).once("value").then(function (s) { return s.val(); }); };
      var timeout = new Promise(function (ok) { setTimeout(function () { ok(null); }, 5000); });
      return Promise.race([Promise.all([read("boulet"), read("bouletOn")]), timeout]).then(function (r) {
        known[uid] = r ? active({ boulet: r[0], bouletOn: r[1] }) : null;
        return known[uid];
      }, function () { known[uid] = null; return null; });
    }
  };

  /** Draw the room's avatars again (someone changed their Bouletmaton or switched it). */
  function redrawSoon() {
    if (redrawTimer) return;
    redrawTimer = setTimeout(function () {
      redrawTimer = 0;
      firetable.utilities.redrawAvatars();
      firetable.ui.fillBouletFace();
    }, 50);
  }

  /** Notice anyone in the room who saved a new Bouletmaton or switched theirs on or off. */
  function watchUsers(users) {
    var changed = false;
    Object.keys(users || {}).forEach(function (uid) {
      var code = active(users[uid]);
      if (Object.prototype.hasOwnProperty.call(lastSeen, uid) && lastSeen[uid] !== code) {
        changed = true;
        Bouletmaton.forget("u" + uid + "@");
        if (uid === ftapi.uid) {
          firetable.myBoulet = valid(users[uid].boulet);
          firetable.myBouletOn = users[uid].bouletOn === true;
        }
      }
      lastSeen[uid] = code;
      known[uid] = code;
    });
    if (changed) redrawSoon();
  }

  // ─── The builder ─────────────────────────────────────────────────────────

  var B = { start: null, cur: null, drawn: 0 };
  /** The order of the builder's rows: the Bouletmaton's own buttons. */
  var ROWS = ["head", "body", "hair", "mouth", "eyes", "brows", "nose", "beard", "ears", "chin", "detail", "neck", "glasses", "acc", "hand", "hat"];

  function code() { return Bouletmaton.encode(B.cur); }
  function partOf(key) { return Bouletmaton.PARTS.filter(function (p) { return p.key === key; })[0]; }

  /** Draw the preview, the circle and stage minis, and set every control to match. */
  function render() {
    var c = code();
    var n = ++B.drawn;
    Bouletmaton.draw(c, 512, document.getElementById("bm-preview"));
    Bouletmaton.picture(c, 256).then(function (url) {
      if (n !== B.drawn) return;
      var bg = 'url("' + url + '")';
      document.getElementById("bm-miniCircle").style.backgroundImage = bg;
      document.getElementById("bm-miniStage").style.backgroundImage = bg;
    });
    $("#bm-skins input").each(function () { this.checked = Number(this.value) === B.cur.skin; });
    $("#bm-hairs input").each(function () { this.checked = Number(this.value) === B.cur.hair; });
    $("#bm-beards input").each(function () { this.checked = Number(this.value) === B.cur.beard; });
    Bouletmaton.PARTS.forEach(function (part) { $("#bm-part-" + part.key).val(String(B.cur.parts[part.key])); });
    $("#bm-reset").prop("disabled", c === B.start);
  }

  /** The swatches, and a row for each part (‹ menu ›), made once. */
  function buildControls() {
    if (B.built) return;
    B.built = true;
    var swatches = function (box, name, colours, what) {
      colours.forEach(function (colour, i) {
        var n = i + 1;
        $("<label class='bm-swatch'></label>")
          .attr("title", what + " " + n)
          .append($("<input type='radio'>").attr({ name: name, value: n, "aria-label": what + " " + n }))
          .append($("<span aria-hidden='true'></span>").css("background-color", colour))
          .appendTo(box);
      });
    };
    swatches("#bm-skins", "bm-skin", Bouletmaton.SKIN_SWATCHES, "Skin tone");
    swatches("#bm-hairs", "bm-hair", Bouletmaton.HAIR_SWATCHES, "Hair colour");
    swatches("#bm-beards", "bm-beard", Bouletmaton.HAIR_SWATCHES, "Beard colour");
    var $parts = $("#bm-parts");
    ROWS.forEach(function (key) {
      var part = partOf(key), id = "bm-part-" + key;
      var $sel = $("<select></select>").attr({ id: id, "data-part": key });
      var count = part.max - (part.blank ? 1 : 0), n = 0;
      for (var v = 1; v <= part.max; v++) {
        $sel.append($("<option></option>").val(String(v)).text(v === part.blank ? "None" : (++n) + " of " + count));
      }
      if (part.hide) $sel.append($("<option></option>").val("0").text("None"));
      $("<div class='bm-part'></div>")
        .append($("<label></label>").attr("for", id).text(part.label))
        .append($("<button type='button' class='butt graybutt iconbutt small bm-step' data-step='-1'><i class='material-symbols-outlined' aria-hidden='true'>chevron_left</i></button>")
          .attr({ "aria-label": "Previous " + part.label.toLowerCase(), title: "Previous", "data-part": key }))
        .append($sel)
        .append($("<button type='button' class='butt graybutt iconbutt small bm-step' data-step='1'><i class='material-symbols-outlined' aria-hidden='true'>chevron_right</i></button>")
          .attr({ "aria-label": "Next " + part.label.toLowerCase(), title: "Next", "data-part": key }))
        .appendTo($parts);
    });

    $("#bm-skins").on("change", "input", function () { B.cur.skin = Number(this.value); render(); });
    $("#bm-hairs").on("change", "input", function () { B.cur.hair = Number(this.value); render(); });
    $("#bm-beards").on("change", "input", function () { B.cur.beard = Number(this.value); render(); });
    $parts.on("change", "select", function () { B.cur.parts[this.getAttribute("data-part")] = Number(this.value); render(); });
    $parts.on("click", ".bm-step", function () {
      var sel = document.getElementById("bm-part-" + this.getAttribute("data-part"));
      sel.selectedIndex = (sel.selectedIndex + Number(this.getAttribute("data-step")) + sel.options.length) % sel.options.length;
      B.cur.parts[sel.getAttribute("data-part")] = Number(sel.value);
      render();
    });
    $("#bm-reset").on("click", function () { B.cur = Bouletmaton.decode(B.start); render(); });
    $("#bm-cancel").on("click", function () { document.getElementById("bm-builderBox").close(); });
    $("#bm-save").on("click", save);
  }

  /** Save the Bouletmaton, and whether it's shown (#bm-use). */
  function save() {
    if (!ftapi.uid) return;
    var c = code(), on = document.getElementById("bm-use").checked, box = document.getElementById("bm-builderBox");
    $("#bm-save").prop("disabled", true);
    $("#bm-message").text("");
    ftapi.db().ref("users/" + ftapi.uid).update({ boulet: c, bouletOn: on }).then(function () {
      setMine(c, on);
      box.close();
      firetable.ui.toast(on ? (firetable.avatarForced ? "Your Bouletmaton is saved. It's monster month: it shows from November" : "Your Bouletmaton is saved and on")
        : "Your Bouletmaton is saved (switched off)", "success");
    }, function (err) {
      $("#bm-message").text("Couldn't save your Bouletmaton. Try again in a moment.");
      ftapi.saveFailed("your Bouletmaton")(err);
    }).then(function () { $("#bm-save").prop("disabled", false); });
  }

  /** Yours changed here: remember it and draw the room again. */
  function setMine(c, on) {
    firetable.myBoulet = c;
    firetable.myBouletOn = !!on;
    known[ftapi.uid] = lastSeen[ftapi.uid] = on ? c : null;
    Bouletmaton.forget("u" + ftapi.uid + "@");
    redrawSoon();
  }

  /**
   * Open the builder on your Bouletmaton (or every choice at 1).
   * @param {boolean} [welcome] - it opened by itself: the room went to Bouletmatons
   */
  firetable.ui.openBouletBuilder = function (welcome) {
    var box = document.getElementById("bm-builderBox");
    if (!box || !ftapi.uid || typeof Bouletmaton === "undefined") return;
    buildControls();
    B.start = firetable.myBoulet || Bouletmaton.FIRST;
    B.cur = Bouletmaton.decode(B.start);
    $("#bm-title").text(firetable.myBoulet ? "Your Bouletmaton" : "Build your Bouletmaton");
    $("#bm-intro").text(welcome
      ? "The room's avatars are Bouletmatons now: build yours and it shows as your avatar. Until you do, you're a robot. You can change it, or switch it off, any time in Profile."
      : firetable.myBoulet
        ? "Change anything you like, then save."
        : "Pick each part, then save. Switched on, it's your avatar everywhere in the room (except October, when everyone's a monster).");
    document.getElementById("bm-use").checked = firetable.myBoulet ? firetable.myBouletOn : true;
    $("#bm-cancel").text(welcome ? "Not now" : "Cancel");
    $("#bm-save").text(firetable.myBoulet ? "Save changes" : "Save my Bouletmaton");
    $("#bm-message").text("");
    render();
    if (!box.open) box.showModal();
  };

  /** Profile: your Bouletmaton (or a prompt to build one), and its on/off switch. */
  firetable.ui.fillBouletFace = function () {
    if (!ftapi.uid) return;
    var face = document.getElementById("ac-bouletFace"), on = document.getElementById("ac-bouletOn");
    var mine = firetable.myBoulet;
    if (face) {
      face.style.backgroundImage = mine ? 'url("' + Bouletmaton.url(mine, 256) + '")' : "";
      face.classList.toggle("is-empty", !mine);
    }
    if (on) {
      on.checked = !!(mine && firetable.myBouletOn);
      on.disabled = !mine;
    }
    $("#ac-bouletEdit").text(mine ? "Change your Bouletmaton" : "Build your Bouletmaton");
    $("#ac-bouletHint").text(!mine
      ? "Build one and switch it on to use it as your avatar. Until then you're the room's avatar (a robot, most of the time)."
      : firetable.avatarForced
        ? "It's monster month: everyone is a monster in October, Bouletmatons too. Yours comes back in November if it's on."
        : firetable.myBouletOn ? "On: it's your avatar everywhere in the room." : "Off: you're the room's avatar. Switch it on to use it.");
  };

  /** Switch yours on or off (Profile). */
  function toggle() {
    var box = this, on = box.checked;
    if (!ftapi.uid || !firetable.myBoulet) { box.checked = false; return; }
    box.disabled = true;
    ftapi.db().ref("users/" + ftapi.uid + "/bouletOn").set(on).then(function () {
      setMine(firetable.myBoulet, on);
      firetable.ui.toast(on ? "Your Bouletmaton is on" + (firetable.avatarForced ? " (from November: it's monster month)" : "") : "Your Bouletmaton is off", "success");
    }, function (err) {
      box.checked = !on;
      ftapi.saveFailed("your Bouletmaton")(err);
    }).then(function () { box.disabled = false; firetable.ui.fillBouletFace(); });
  }

  /**
   * The room's avatars are Bouletmatons and you haven't built one: open the
   * builder (once a visit), when nothing else is open. Not in October.
   */
  firetable.ui.promptBoulet = function () {
    if (prompted || firetable.roomAvatarStyle !== "bouletmaton" || firetable.avatarForced || !ftapi.uid || firetable.myBoulet !== null) return;
    if (document.querySelector("dialog[open]")) {
      clearTimeout(firetable.ui._bouletPromptTimer);
      firetable.ui._bouletPromptTimer = setTimeout(firetable.ui.promptBoulet, 3000);
      return;
    }
    prompted = true;
    firetable.ui.openBouletBuilder(true);
  };

  /** Bindings, from ui.init. */
  firetable.ui.setupAvatarBuilder = function () {
    $("#ac-bouletEdit").on("click", function () { firetable.ui.openBouletBuilder(false); });
    $("#ac-bouletOn").on("change", toggle);
    ftapi.events.on("usersChanged", watchUsers);
    ftapi.events.on("loggedIn", function (data) {
      var u = (data && data.user) || {};
      firetable.myBoulet = valid(u.boulet);
      firetable.myBouletOn = u.bouletOn === true;
      if (ftapi.uid) known[ftapi.uid] = lastSeen[ftapi.uid] = active(u);
      Bouletmaton.forget("u" + ftapi.uid + "@");
      firetable.ui.fillBouletFace();
      redrawSoon();
      firetable.ui.promptBoulet();
    });
  };
})();
