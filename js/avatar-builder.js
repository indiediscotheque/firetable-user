/**
 * avatar-builder.js — Your Bouletmaton: the builder (#bm-builderBox), the
 * Profile section that opens it (#ac-bouletSection), and how the room finds
 * everyone's (js/bouletmaton.js draws them).
 *
 * Everyone has a Bouletmaton made from their uid until they save their own
 * (users/<uid>/boulet). When the room's avatars are Bouletmatons and you
 * haven't saved yours, the builder opens by itself, once per visit, showing
 * the one made for you. Once you've saved one, you change it from Profile,
 * which always has it, whatever the room's avatars are.
 */

(function () {
  var known = {};   // uid -> code or null (none saved), for people looked up or seen online
  var lastSeen = {}; // uid -> code or null, as last seen in users/ (to notice a change)
  var prompted = false; // the builder opened by itself this visit
  var redrawTimer = 0;

  function valid(code) { return Bouletmaton.isCode(code) ? code : null; }

  // ─── How the room finds everyone's ───────────────────────────────────────

  Bouletmaton.api.lookup = function (uid) {
    if (!uid) return null;
    if (uid === ftapi.uid && firetable.myBoulet !== undefined) return firetable.myBoulet;
    var u = ftapi.users && ftapi.users[uid];
    if (u) return valid(u.boulet);
    if (Object.prototype.hasOwnProperty.call(known, uid)) return known[uid];
    return undefined; // not known yet: Bouletmaton.url looks them up
  };
  Bouletmaton.api.fetch = function (uid) {
    return ftapi.db().ref("users/" + uid + "/boulet").once("value").then(function (snap) {
      known[uid] = valid(snap.val());
      return known[uid];
    }, function () { known[uid] = null; return null; });
  };

  /** Draw the room's avatars again (someone saved a new Bouletmaton). */
  function redrawSoon() {
    if (redrawTimer) return;
    redrawTimer = setTimeout(function () {
      redrawTimer = 0;
      if (firetable.roomAvatarStyle === "bouletmaton") firetable.utilities.redrawAvatars();
      firetable.ui.fillBouletFace();
    }, 50);
  }

  /** Notice anyone in the room who saved a new Bouletmaton. */
  function watchUsers(users) {
    var changed = false;
    Object.keys(users || {}).forEach(function (uid) {
      var code = valid(users[uid] && users[uid].boulet);
      if (Object.prototype.hasOwnProperty.call(lastSeen, uid) && lastSeen[uid] !== code) {
        changed = true;
        Bouletmaton.forget(uid);
        if (uid === ftapi.uid) firetable.myBoulet = code;
      }
      lastSeen[uid] = code;
      known[uid] = code;
    });
    if (changed) redrawSoon();
  }

  // ─── The builder ─────────────────────────────────────────────────────────

  var B = { start: null, cur: null, drawn: 0 };

  /** The code being built. */
  function code() { return Bouletmaton.encode(B.cur); }

  /** Your Bouletmaton as it stands: the one you saved, else the one made for you. */
  function mine() { return firetable.myBoulet || Bouletmaton.random(ftapi.uid || ""); }

  /** Draw the preview, the circle and the stage minis, and set every control to match. */
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
    Bouletmaton.PARTS.forEach(function (part) {
      $("#bm-part-" + part.key).val(String(B.cur.parts[part.key]));
    });
    var dirty = c !== (firetable.myBoulet || "");
    $("#bm-save").prop("disabled", !dirty && !!firetable.myBoulet);
    $("#bm-reset").prop("disabled", c === B.start);
  }

  /** The skin and hair swatches, and a row for each part (‹ menu ›), made once. */
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
    var $parts = $("#bm-parts");
    Bouletmaton.PARTS.forEach(function (part) {
      var id = "bm-part-" + part.key;
      var $sel = $("<select></select>").attr({ id: id, "data-part": part.key });
      if (part.none) $sel.append($("<option></option>").val("0").text("None"));
      var total = part.max - part.min + 1;
      for (var v = part.min; v <= part.max; v++) {
        $sel.append($("<option></option>").val(String(v)).text((v - part.min + 1) + " of " + total));
      }
      $("<div class='bm-part'></div>")
        .append($("<label></label>").attr("for", id).text(part.label))
        .append($("<button type='button' class='butt graybutt iconbutt small bm-step' data-step='-1'><i class='material-symbols-outlined' aria-hidden='true'>chevron_left</i></button>")
          .attr({ "aria-label": "Previous " + part.label.toLowerCase(), title: "Previous", "data-part": part.key }))
        .append($sel)
        .append($("<button type='button' class='butt graybutt iconbutt small bm-step' data-step='1'><i class='material-symbols-outlined' aria-hidden='true'>chevron_right</i></button>")
          .attr({ "aria-label": "Next " + part.label.toLowerCase(), title: "Next", "data-part": part.key }))
        .appendTo($parts);
    });

    $("#bm-skins").on("change", "input", function () { B.cur.skin = Number(this.value); render(); });
    $("#bm-hairs").on("change", "input", function () { B.cur.hair = Number(this.value); render(); });
    $parts.on("change", "select", function () { B.cur.parts[this.getAttribute("data-part")] = Number(this.value); render(); });
    $parts.on("click", ".bm-step", function () {
      var sel = document.getElementById("bm-part-" + this.getAttribute("data-part"));
      var i = (sel.selectedIndex + Number(this.getAttribute("data-step")) + sel.options.length) % sel.options.length;
      sel.selectedIndex = i;
      B.cur.parts[sel.getAttribute("data-part")] = Number(sel.value);
      render();
    });
    $("#bm-random").on("click", function () {
      B.cur = Bouletmaton.decode(Bouletmaton.random(String(Math.random()) + Date.now()));
      render();
    });
    $("#bm-reset").on("click", function () { B.cur = Bouletmaton.decode(B.start); render(); });
    $("#bm-cancel").on("click", function () { document.getElementById("bm-builderBox").close(); });
    $("#bm-save").on("click", save);
  }

  function save() {
    if (!ftapi.uid) return;
    var c = code(), box = document.getElementById("bm-builderBox");
    $("#bm-save").prop("disabled", true);
    $("#bm-message").text("");
    ftapi.db().ref("users/" + ftapi.uid + "/boulet").set(c).then(function () {
      firetable.myBoulet = c;
      known[ftapi.uid] = c;
      lastSeen[ftapi.uid] = c;
      Bouletmaton.forget(ftapi.uid);
      box.close();
      firetable.ui.toast("Your Bouletmaton is saved", "success");
      redrawSoon();
    }, function (err) {
      $("#bm-save").prop("disabled", false);
      $("#bm-message").text("Couldn't save your Bouletmaton. Try again in a moment.");
      ftapi.saveFailed("your Bouletmaton")(err);
    });
  }

  /**
   * Open the builder on your Bouletmaton.
   * @param {boolean} [welcome] - it opened by itself: the room just went to Bouletmatons
   */
  firetable.ui.openBouletBuilder = function (welcome) {
    var box = document.getElementById("bm-builderBox");
    if (!box || !ftapi.uid || typeof Bouletmaton === "undefined") return;
    buildControls();
    B.start = mine();
    B.cur = Bouletmaton.decode(B.start);
    $("#bm-title").text(firetable.myBoulet ? "Your Bouletmaton" : "Build your Bouletmaton");
    $("#bm-intro").text(welcome
      ? "The room's avatars are Bouletmatons now. Here's the one made for you: keep it, or change anything you like, then save it. You can change it later in Profile."
      : firetable.myBoulet
        ? "Change anything you like, then save. It's your face whenever the room's avatars are Bouletmatons."
        : "This is the one made for you. Keep it, or change anything you like, then save it.");
    $("#bm-cancel").text(welcome ? "Not now" : "Cancel");
    $("#bm-save").text(firetable.myBoulet ? "Save changes" : "Save my Bouletmaton");
    $("#bm-message").text("");
    render();
    if (!box.open) box.showModal();
  };

  /** The face in Profile: always your Bouletmaton, whatever the room's avatars are. */
  firetable.ui.fillBouletFace = function () {
    if (!ftapi.uid) return;
    var face = document.getElementById("ac-bouletFace");
    if (face) face.style.backgroundImage = 'url("' + Bouletmaton.url(ftapi.uid, 256, mine()) + '")';
    $("#ac-bouletEdit").text(firetable.myBoulet ? "Change your Bouletmaton" : "Build your Bouletmaton");
    $("#ac-bouletHint").text(firetable.myBoulet
      ? "Your face when the room's avatars are Bouletmatons."
      : "Your face when the room's avatars are Bouletmatons. Until you build your own, you have one made for you.");
  };

  /**
   * The room's avatars are Bouletmatons and yours isn't saved: open the
   * builder (once per visit), when nothing else is open.
   */
  firetable.ui.promptBoulet = function () {
    if (prompted || firetable.roomAvatarStyle !== "bouletmaton" || !ftapi.uid || firetable.myBoulet !== null) return;
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
    ftapi.events.on("usersChanged", watchUsers);
    ftapi.events.on("loggedIn", function (data) {
      firetable.myBoulet = valid(data && data.user && data.user.boulet);
      if (ftapi.uid) { known[ftapi.uid] = firetable.myBoulet; lastSeen[ftapi.uid] = firetable.myBoulet; }
      Bouletmaton.forget(ftapi.uid);
      firetable.ui.fillBouletFace();
      if (firetable.roomAvatarStyle === "bouletmaton") redrawSoon();
      firetable.ui.promptBoulet();
    });
  };
})();
