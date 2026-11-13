/**
 * users.js — Authentication, login/signup UI, and user-list rendering.
 *
 * Handles:
 * - Login, signup, password reset flows
 * - Login form event binding/unbinding (loginEventsInit / loginEventsDestroy)
 * - Post-login UI setup (loggedIn: playlist picker, grab button, etc.)
 * - Logout + "show login screen" transition
 * - The sign-in dialog (#joinBox): Join / Log in from anywhere (openAuth)
 * - The account menu (header avatar) and Profile · Account · Settings
 * - User lookup by name → UID (uidLookup)
 * - Grab current song to a playlist
 * - Unban
 * - ftapi events: loggedIn, loggedOut, authReconnected, authDisconnected,
 *   userBanned, userUnbanned, userJoined, userLeft, userChanged, usersChanged
 */

firetable.actions = firetable.actions || {};
firetable.ui = firetable.ui || {};

// ─── Authentication Actions ──────────────────────────────────────────────────

/**
 * Log in with email+password via Firebase Auth.
 * @param {string} email
 * @param {string} password
 */
/**
 * Turn a Firebase Auth error (or a plain message string) into friendly text.
 * Sign-in failures share one message so the form never reveals whether an
 * email address has an account.
 * @param {Object|string} error
 * @returns {string}
 */
firetable.ui.authErrorMessage = function (error) {
  if (!error) return "Something went wrong. Please try again.";
  if (typeof error === "string") return error;
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return "That email and password don't match. Check them, or reset your password.";
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return "That doesn't look like a valid email address.";
    case 'auth/missing-password':
      return "Enter your password.";
    case 'auth/email-already-in-use':
      return "That email already has an account. Try logging in, or reset your password.";
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return "Choose a stronger password (at least 6 characters).";
    case 'auth/user-disabled':
      return "This account has been disabled.";
    case 'auth/too-many-requests':
      return "Too many attempts. Wait a few minutes and try again.";
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return "";
    case 'auth/account-exists-with-different-credential':
      return "That email already has an account here. Log in with your email and password instead.";
    case 'auth/operation-not-allowed':
      return "That sign-in option isn't turned on for this site yet.";
    case 'auth/unauthorized-domain':
      return "Signing in with that service isn't set up for this web address yet.";
    case 'auth/network-request-failed':
      return "Couldn't reach the server. Check your connection and try again.";
    case 'auth/requires-recent-login':
      return "For your safety, log out and back in, then try again.";
    case 'auth/no-current-user':
      return "You're not signed in any more. Log in and try again.";
  }
  return "Something went wrong (" + (error.code || error.message || "unknown error") + "). Please try again.";
};

firetable.actions.logIn = function (email, password) {
  firetable.debug && console.log("login");
  firetable.ui._authIntent = "login";
  firetable.ui.formMessage('#loginFormShell', '');
  ftapi.actions.logIn(email, password, function (error) {
    if (firetable.ui.authIdle) firetable.ui.authIdle();
    $("#loginpass").val("");
    firetable.ui.formMessage('#loginFormShell', firetable.ui.authErrorMessage(error));
    firetable.debug && console.log("log in error:", error);
  });
};

// ─── Sign in with Google / Apple (#128) ─────────────────────────────────────

/** Providers this site has turned on (ftconfigs.signInProviders). */
firetable.utilities.signInProviders = function () {
  var list = (typeof ftconfigs !== "undefined" && ftconfigs.signInProviders) || [];
  return (Array.isArray(list) ? list : []).filter(function (p) { return p === "google" || p === "apple"; });
};

/** Show a button for each provider that's turned on. */
firetable.ui.setupProviderSignIn = function () {
  var providers = firetable.utilities.signInProviders();
  var $box = $("#oauthBox");
  $box.find(".oauthBttn").each(function () { $(this).prop("hidden", providers.indexOf($(this).attr("data-provider")) === -1); });
  $box.prop("hidden", !providers.length);
  $(document).off("click.oauth").on("click.oauth", "#oauthBox .oauthBttn", function () {
    var name = $(this).attr("data-provider");
    var $msg = $("#oauthBox .formMessage");
    $msg.text("");
    firetable.ui._authIntent = "provider";
    ftapi.actions.logInWithProvider(name, function (error) {
      $msg.text(firetable.ui.authErrorMessage(error));
      firetable.debug && console.log("provider sign-in error:", error);
    });
  });
  if (providers.length) {
    ftapi.actions.redirectSignInError().then(function (error) {
      if (error) $("#oauthBox .formMessage").text(firetable.ui.authErrorMessage(error));
    });
  }
};

/**
 * A suggested username from a provider's display name or email: letters,
 * numbers and underscores, up to 22 characters.
 * @param {firebase.User} user
 * @returns {string}
 */
firetable.utilities.suggestUsername = function (user) {
  var base = String((user && (user.displayName || (user.email || "").split("@")[0])) || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_").replace(/[^0-9a-zA-Z_]/g, "").slice(0, 22);
  return base || "dj_" + Math.random().toString(36).slice(2, 8);
};

/** First visit with a new Google/Apple account: choose the name people see. */
firetable.actions.promptForUsername = function () {
  var dlg = document.getElementById("pickNameBox");
  if (!dlg || dlg.open) return;
  var user = firebase.app("firetable").auth().currentUser;
  var suggestion = firetable.utilities.suggestUsername(user);
  $("#pickName").val(suggestion);
  firetable.ui.formMessage("#pickNameForm", "");
  dlg.showModal();
  $("#pickName").trigger("focus").trigger("select");
  // offer a free variant of the suggestion
  ftapi.lookup.usernameTaken(suggestion, function (taken) {
    if (taken && $("#pickName").val() === suggestion) $("#pickName").val(suggestion.slice(0, 18) + "_" + Math.floor(100 + Math.random() * 900));
  });
};

firetable.ui.setupPickName = function () {
  var dlg = document.getElementById("pickNameBox");
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); }); // a name is required
  $("#pickNameForm").on("submit", function (e) {
    e.preventDefault();
    var name = $("#pickName").val().trim();
    var $save = $("#pickNameSave").prop("disabled", true);
    ftapi.lookup.usernameTaken(name, function (taken) {
      if (taken) {
        $save.prop("disabled", false);
        return firetable.ui.formMessage("#pickNameForm", "That name is taken. Try another.");
      }
      ftapi.actions.changeName(name, function (err) {
        $save.prop("disabled", false);
        if (err) return firetable.ui.formMessage("#pickNameForm", err);
        ftapi.uname = name;
        $("#loggedInName").text(name);
        $("#loggedInUser .ft-avatar").css("background-image", "url(" + firetable.utilities.avatarURL(ftapi.uid, name) + ")");
        dlg.close();
        firetable.ui.toast("Welcome, " + name + "!", "success");
      });
    });
  });
  $("#pickNameLogout").on("click", function () {
    dlg.close();
    firetable.actions.logOut();
  });
};

/** Sign out. */
firetable.actions.logOut = function () {
  document.querySelectorAll("dialog[open]").forEach(function (d) { d.close(); });
  // Stop this device's push notifications for the account first (needs the
  // sign-in); they come back on their own when the same account signs in here.
  var forget = firetable.push ? firetable.push.forget() : Promise.resolve();
  var done = false;
  var out = function () {
    if (done) return;
    done = true;
    ftapi.actions.logOut();
    firetable.ui.toast("You're logged out. See you soon.", "success");
  };
  forget.then(out, out);
  setTimeout(out, 2000);
  firetable.debug && console.log("logout");
};

/**
 * Create a new account via Firebase Auth.
 * @param {string} email
 * @param {string} password
 * @param {string} username - Display name
 */
firetable.actions.signUp = function (email, password, username) {
  firetable.debug && console.log("signup");
  firetable.ui._authIntent = "create";
  firetable.ui.formMessage('#createAccountFormShell', '');
  ftapi.actions.signUp(email, password, username, function (error) {
    if (firetable.ui.authIdle) firetable.ui.authIdle();
    var text = firetable.ui.authErrorMessage(error);
    if (/username is not available/i.test(text)) {
      firetable.ui.fieldNote("#newusername", username + " is taken. Try another.", "bad");
      $("#newusername").trigger("focus");
      text = "";
    }
    firetable.ui.formMessage('#createAccountFormShell', text);
  });
};

/**
 * Show the login screen — called on logout or when not authenticated.
 * Saves the login form HTML so it can be restored later.
 */
firetable.actions.showLoginScreen = function () {
  // Detach all logged-in panels so they're not in the DOM while logged out
  var $shell = $('#appShell');
  if ($shell.length) { firetable.$appShell = $shell.detach(); }

  // Re-run boot reveal next time the authenticated shell appears.
  firetable.ui._hasRunBootReveal = false;
  firetable.ui._isShellBooting = false;

  $("#loggedInName").hide();
  $("#logOutButton").hide().off();
  firetable.ui.hideAccountMenu();
  $('#mainGrid').removeClass().addClass('login');
  firetable.ui.labelSignIn();
  $("#grab").css("display", "none");

  if (firetable.loginForm && !$("#login").html()) {
    $("#mainGrid").append('<div id="login" class="scroll-view" role="region" aria-label="Log in or sign up">' + firetable.loginForm + '</div>');
    firetable.ui.loginEventsInit();
  }
  firetable.ui.renderRoomPulse();
};

/**
 * Post-login setup: load playlists, show grab button, hide login form.
 * @param {Object} user - Firebase user object
 */
firetable.actions.loggedIn = function (user) {
  firetable.debug && console.log("user signed in!");

  firetable.ui.rememberAuth();
  firetable.ui.closeAuth();

  // Preserve login form HTML before removing
  if ($("#login").html()) {
    firetable.loginForm = $("#login").html();
    firetable.ui.loginEventsDestroy();
    $("#login").remove();
  }

  // Re-attach logged-in panels if they were detached
  if (firetable.$appShell && !$('#appShell').length) {
    $('#mainGrid').append(firetable.$appShell);
  }

  // Set display name and avatar
  var displayName = user.uid;
  if (ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].username) {
    displayName = ftapi.users[ftapi.uid].username;
  }
  $("#loggedInName").text(displayName);
  $("#loggedInUser .ft-avatar").removeClass('skel').css("background-image", "url(" + firetable.utilities.avatarURL(ftapi.uid, displayName) + ")");
  $("#avatarStylePicker").val(firetable.avatarStyle || "robohash:" + firetable.avatarset);

  // Load all playlists into the picker
  firetable.actions.restoreListCounts();
  firetable.actions.loadPlaylistPrefs().then(function () { ftapi.lookup.listNames(function (allPlaylists) {
    var viewListStorageKey = "firetable.viewList." + ftapi.uid;
    $("#listpicker").off("change");
    $("#djlistpicker").off("change");
    firetable.ui.fillPlaylistPickers(allPlaylists);
    firetable.actions.loadListCounts(allPlaylists);
    var defaultList = firetable.plPrefs.defaultList;
    if (!$("#listpicker option[value='" + defaultList + "']").length) defaultList = "0";

    ftapi.lookup.selectedList(function (selectedList) {
      var safeSelected = (selectedList && selectedList !== "1") ? selectedList : "0";
      var viewSelected = "0";
      try {
        var storedViewSelected = localStorage.getItem(viewListStorageKey);
        if (storedViewSelected && storedViewSelected !== "1" && $("#listpicker option[value='" + storedViewSelected + "']").length) {
          viewSelected = storedViewSelected;
        } else {
          viewSelected = defaultList; // your default list opens first
        }
      } catch (e) {
        viewSelected = defaultList;
      }

      $("#listpicker").change(function () {
        var val = $("#listpicker").val();
        $("#plDeleteLauncher").prop("disabled", !val || val === "0");
        // Switch the view/edit list (does not affect DJ queue)
        firetable.ui.showQueuePanel();
        $("#plmanager").css("display", "none");
        $("#listpickerWrap").show();
        $("#plAddLauncher i").text("add");
        try {
          localStorage.setItem(viewListStorageKey, val);
        } catch (e) {}
        firetable.actions.switchViewList(val);
        firetable.ui.matchSearchSource(val);
      });
      $("#djlistpicker").change(function () {
        ftapi.actions.switchDjList($(this).val());
      });

      // Initialize both pickers after handlers are attached.
      $("#djlistpicker").val(safeSelected);
      $("#listpicker").val(viewSelected).trigger("change");
    });
  }); });

  // A brand-new Google/Apple account has no username yet
  // (userByID stands the uid in for a missing name, so read the field itself)
  if (!ftapi.pendingSignUpName) {
    var askedFor = ftapi.uid;
    ftapi.db().ref("users/" + askedFor + "/username").once("value").then(function (snap) {
      if (!snap.val() && !ftapi.pendingSignUpName && ftapi.uid === askedFor) firetable.actions.promptForUsername();
    });
  }

  $("#loggedInName").show();
  $("#logOutButton").show().on('click', firetable.actions.logOut);
  firetable.debug && console.log('remove login class from mainGrid');
  $('#mainGrid').removeClass('login').removeClass('pre-auth');
  firetable.nav._cardsShown = false; // fresh login → reload the card collection
  firetable.nav.restore();
  firetable.nav.apply();
  $("#grab").css("display", "inline-block");
  firetable.ui.greet();
};

/**
 * Say hello once a sign-in this page asked for works (not on a return
 * visit, where the person was already signed in).
 */
firetable.ui.greet = function () {
  var intent = firetable.ui._authIntent;
  firetable.ui._authIntent = null;
  if (!intent) return;
  setTimeout(function () {
    if (!ftapi.uid) return;
    var me = ftapi.users && ftapi.users[ftapi.uid];
    var name = ftapi.pendingSignUpName || (me && me.username) || (ftapi.uname !== ftapi.uid ? ftapi.uname : "");
    // a new Google / Apple account picks its name first, and is welcomed then
    if (!name) return;
    firetable.ui.toast(intent === "create" ? "Welcome to the room, " + name + "!" : "Welcome back, " + name + ".", "success");
  }, 400);
};

// ─── User Lookup ─────────────────────────────────────────────────────────────

/**
 * Find a user's UID by their display name.
 * Falls back to checking if `name` is itself a valid UID.
 * @param {string} name - Display name to search for
 * @returns {string|false} UID if found, false otherwise
 */
firetable.actions.uidLookup = function (name) {
  var match = false;
  var usrs = ftapi.users;
  for (var key in usrs) {
    if (usrs.hasOwnProperty(key) && ftapi.users[key].username === name) {
      match = key;
    }
  }
  if (!match && ftapi.users[name]) match = name;
  return match;
};

/**
 * Grab (copy) the currently-playing song into the user's queue.
 */
firetable.actions.grab = function () {
  if (firetable.song.cid !== 0) {
    var title = firetable.utilities.decodeEntities(firetable.song.artist + " - " + firetable.song.title);
    var isSC = firetable.song.type == MEDIA_SOUNDCLOUD;
    firetable.actions.queueTrack(firetable.song.cid, title, firetable.song.type, true, {
      url: isSC ? firetable.utilities.soundCloudPageUrl(firetable.song.url) : '',
      img: isSC && /^https:\/\//.test(firetable.song.image || '') ? firetable.song.image : ''
    });
  }
};

/**
 * Unban a user by UID.
 * @param {string} userid
 */
firetable.actions.unban = function (userid) {
  ftapi.actions.unbanUser(userid);
};

// ─── Logged-out room preview ─────────────────────────────────────────────────

/**
 * "N people here now" with their avatars and who's DJing, above the sign-up
 * form, so visitors see the room is alive before joining (#9).
 */
firetable.ui.renderRoomPulse = function () {
  var el = document.getElementById("roomPulse");
  if (!el) return;
  var people = [];
  for (var uid in ftapi.users || {}) {
    if (ftapi.users.hasOwnProperty(uid) && !ftapi.users[uid].hostbot) {
      people.push({ id: uid, name: ftapi.users[uid].username || uid });
    }
  }
  var djs = [];
  for (var k in firetable.tableData || {}) {
    if (firetable.tableData.hasOwnProperty(k) && firetable.tableData[k]) djs.push(firetable.tableData[k].name);
  }
  var $el = $(el).empty();
  if (!people.length) return;
  var $faces = $('<div class="pulse-faces" aria-hidden="true"></div>');
  people.slice(0, 8).forEach(function (u) {
    $('<span class="ft-avatar"></span>')
      .css("background-image", "url(" + firetable.utilities.avatarURL(u.id, u.name, "40x40") + ")")
      .attr("title", u.name)
      .appendTo($faces);
  });
  var text = firetable.utilities.pluralize(people.length, "person", "people") + " here now";
  if (djs.length) text += " · DJing: " + djs.join(", ");
  $el.append($faces).append($('<span class="pulse-text"></span>').text(text));
};

// ─── Login Form Events ──────────────────────────────────────────────────────

/** Someone has signed in on this device before: open on Log in next time. */
var AUTH_KNOWN_KEY = "ft-has-account";

/**
 * Show one of the sign-in forms: "create" (the default for new visitors),
 * "login" (for anyone who has signed in here before) or "reset".
 * @param {"create"|"login"|"reset"} which
 * @param {{focus?: boolean}} [opts]
 */
firetable.ui.showAuth = function (which, opts) {
  opts = opts || {};
  if (which !== "login" && which !== "reset") which = "create";
  var panes = { create: "#createscreen", login: "#logscreen", reset: "#resetscreen" };
  Object.keys(panes).forEach(function (k) { $(panes[k]).prop("hidden", k !== which); });
  var tab = which === "reset" ? "login" : which;
  $("#authTabs [data-auth]").each(function () {
    var on = $(this).attr("data-auth") === tab;
    $(this).toggleClass("on", on).attr("aria-selected", String(on));
  });
  // Google/Apple work for both, so they stay above Create and Log in
  $("#authBox").attr("data-auth", which);
  $("#login .formMessage").text("").removeClass("is-success");
  firetable.ui.titleAuth(which);
  if (which === "reset" && !$("#theAddress").val()) $("#theAddress").val($("#loginemail").val());
  if (opts.focus) setTimeout(function () { $(panes[which]).find("input").filter(":visible").first().trigger("focus"); }, 0);
};

/** The form to open on: Log in for people who've signed in here before. */
firetable.ui.authDefault = function () {
  try { return localStorage.getItem(AUTH_KNOWN_KEY) ? "login" : "create"; } catch (e) { return "create"; }
};

/** A note under a field: a hint, or what's wrong (marks the field invalid). */
firetable.ui.fieldNote = function (input, text, state) {
  var $in = $(input);
  var $note = $("#" + $in.attr("id") + "Note");
  $in.attr("aria-invalid", state === "bad" ? "true" : null);
  if (!$note.length) return;
  $note.text(text == null ? ($note.attr("data-hint") || "") : text).attr("data-state", state || null);
};

/**
 * Bind the sign-in forms: tabs, show password, checks as you type, and
 * submit (the button or Enter).
 */
firetable.ui.loginEventsInit = function () {
  var $login = $("#login");
  firetable.ui.showAuth(firetable.ui.authDefault());

  $login.on("click.auth", "[data-auth]", function () {
    firetable.ui.showAuth($(this).attr("data-auth"), { focus: true });
  });
  // arrow keys move between the two tabs
  $login.on("keydown.auth", "#authTabs [role=tab]", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    var next = $(this).attr("data-auth") === "create" ? "login" : "create";
    firetable.ui.showAuth(next);
    $('#authTabs [data-auth="' + next + '"]').trigger("focus");
  });
  $login.on("click.auth", ".showPass", function () {
    var $in = $(this).siblings("input");
    var show = $in.attr("type") === "password";
    $in.attr("type", show ? "text" : "password");
    $(this).text(show ? "visibility_off" : "visibility").attr({ "aria-pressed": String(show), "aria-label": show ? "Hide password" : "Show password" });
  });

  // checks as you type: the name's rules and whether it's free
  var nameTimer = null;
  var nameAsked = "";
  $login.on("input.auth", "#newusername", function () {
    var name = $(this).val().trim();
    clearTimeout(nameTimer);
    if (!name) return firetable.ui.fieldNote(this, null);
    var check = ftapi.utilities.validateUsername(name);
    if (!check.valid) return firetable.ui.fieldNote(this, /long/.test(check.reason) ? "Up to 22 characters." : "Only letters, numbers and underscores.", "bad");
    firetable.ui.fieldNote(this, "Checking…");
    var input = this;
    nameTimer = setTimeout(function () {
      nameAsked = name;
      ftapi.lookup.usernameTaken(name, function (taken) {
        if (nameAsked !== name || $(input).val().trim() !== name) return;
        if (taken) firetable.ui.fieldNote(input, name + " is taken. Try another.", "bad");
        else firetable.ui.fieldNote(input, name + " is free.", "good");
      });
    }, 350);
  });
  $login.on("input.auth", "#newpass", function () {
    var n = $(this).val().length;
    firetable.ui.fieldNote(this, n && n < 6 ? (6 - n) + " more " + (6 - n === 1 ? "character" : "characters") : null, n >= 6 ? "good" : null);
  });
  $login.on("blur.auth", "#newemail", function () {
    var v = $(this).val().trim();
    firetable.ui.fieldNote(this, v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "That doesn't look like an email address." : "", v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "bad" : null);
  });
  $login.on("input.auth", "#newemail", function () {
    if ($(this).attr("aria-invalid")) firetable.ui.fieldNote(this, "");
  });
  $login.on("change.auth", "#agreetoterms", function () {
    if (this.checked) $("#termsAgreement").removeAttr("data-state");
  });

  // a button shows it's working until the answer comes back
  var busy = function ($b, label) {
    $b.prop("disabled", !!label).text(label || $b.attr("data-label"));
  };
  var idle = function () { $("#createAccountBttn, #loginBttn, #resetPassBttn").each(function () { busy($(this)); }); };
  firetable.ui.authIdle = idle;
  // the form comes back from a saved copy after signing out: start it fresh
  idle();
  $login.find(".passField input").attr("type", "password");
  $login.find(".showPass").text("visibility").attr({ "aria-pressed": "false", "aria-label": "Show password" });
  $login.find("[aria-invalid]").removeAttr("aria-invalid");
  $login.find(".fieldNote[data-state]").each(function () { $(this).removeAttr("data-state").text($(this).attr("data-hint") || ""); });
  $("#termsAgreement").removeAttr("data-state");

  $login.on("submit.auth", "#createAccountFormShell", function (e) {
    e.preventDefault();
    var email = $("#newemail").val().trim();
    var pass = $("#newpass").val();
    var username = $("#newusername").val().trim();
    var first = null;
    var bad = function (input, text) { firetable.ui.fieldNote(input, text, "bad"); first = first || input; };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad("#newemail", email ? "That doesn't look like an email address." : "Enter your email.");
    var check = ftapi.utilities.validateUsername(username);
    if (!username) bad("#newusername", "Choose the name people see in the room.");
    else if (!check.valid) bad("#newusername", /long/.test(check.reason) ? "Up to 22 characters." : "Only letters, numbers and underscores.");
    if (pass.length < 6) bad("#newpass", "At least 6 characters.");
    if (first) {
      firetable.ui.formMessage("#createAccountFormShell", "");
      return $(first).trigger("focus");
    }
    if (!$("#agreetoterms").is(":checked")) {
      $("#termsAgreement").attr("data-state", "bad");
      return firetable.ui.formMessage("#createAccountFormShell", "Tick the box to agree to the Terms of Service and Privacy Policy.");
    }
    busy($("#createAccountBttn"), "Creating your account…");
    firetable.actions.signUp(email, pass, username);
  });

  $login.on("submit.auth", "#loginFormShell", function (e) {
    e.preventDefault();
    var email = $("#loginemail").val().trim();
    var pass = $("#loginpass").val();
    if (!email || !pass) {
      firetable.ui.formMessage("#loginFormShell", !email ? "Enter your email." : "Enter your password.");
      return $(!email ? "#loginemail" : "#loginpass").trigger("focus");
    }
    busy($("#loginBttn"), "Logging in…");
    firetable.actions.logIn(email, pass);
  });

  $login.on("submit.auth", "#resetPasswordFormShell", function (e) {
    e.preventDefault();
    var email = $("#theAddress").val().trim();
    if (!email) {
      firetable.ui.formMessage("#resetPasswordFormShell", "Enter the email you joined with.");
      return $("#theAddress").trigger("focus");
    }
    // Success shows right away; a real error (bad address, rate limit,
    // network) replaces it. "No such user" keeps the success message so the
    // form doesn't reveal which emails have accounts.
    firetable.ui.formMessage("#resetPasswordFormShell", "If " + email + " has an account, a reset link is on its way. Check your inbox.", "success");
    ftapi.actions.resetPassword(email, function (error) {
      if (error && error.code === "auth/user-not-found") return;
      firetable.ui.formMessage("#resetPasswordFormShell", firetable.ui.authErrorMessage(error));
      firetable.debug && console.log("send pass reset error:", error);
    });
  });
};

/**
 * Unbind the sign-in forms (before removing them from the page).
 */
firetable.ui.loginEventsDestroy = function () {
  $("#login").off(".auth");
};

/** Remember that this device has an account, so the form opens on Log in. */
firetable.ui.rememberAuth = function () {
  try { localStorage.setItem(AUTH_KNOWN_KEY, "1"); } catch (e) { /* private window */ }
};

// ─── Join or log in from anywhere (#joinBox) ────────────────────────────────
// The sign-in form (#login) moves into the dialog while it's open and goes
// back where it was when it closes, so there's one form and one set of
// handlers. Every "Join" and "Log in" on the site opens it: the header's
// button, Discover's crate and chat, Live's locked tabs.

var authHome = null;  // a comment node marking #login's place in the page
var authNote = null;  // a line for this opening (Discover: your crate comes with you)

function putLoginBack() {
  if (!authHome) return;
  var login = document.getElementById("login");
  if (login && login.closest("#joinBox") && authHome.parentNode) authHome.parentNode.insertBefore(login, authHome);
  if (authHome.parentNode) authHome.parentNode.removeChild(authHome);
  authHome = null;
}

/** The room's name, for "Join …". */
function roomTitle() {
  return (typeof ftconfigs !== "undefined" && (ftconfigs.roomNameShort || ftconfigs.roomName)) || "the room";
}

/**
 * Open the sign-in form in a dialog, over whatever page is showing.
 * @param {"create"|"login"|"reset"|"auto"} [which="auto"] auto: Log in on a
 *   device that has signed in before, Create account otherwise
 * @param {{note?: string}} [opts]
 */
firetable.ui.openAuth = function (which, opts) {
  opts = opts || {};
  var login = document.getElementById("login");
  var dlg = document.getElementById("joinBox");
  if (!login || ftapi.uid) return; // signed in: nothing to open
  if (!which || which === "auto") which = firetable.ui.authDefault();
  if (!dlg) { // no dialog (an old cached page): go to the form where it is
    firetable.ui.showAuth(which);
    login.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(function () { firetable.ui.showAuth(which, { focus: true }); }, 300);
    return;
  }
  authNote = opts.note || null;
  if (!login.closest("#joinBox")) {
    authHome = document.createComment("login");
    login.parentNode.insertBefore(authHome, login);
    dlg.querySelector(".modalContent").appendChild(login);
  }
  if (!dlg.open) dlg.showModal();
  firetable.ui.showAuth(which, { focus: true });
};

/** Close the sign-in dialog, with the form back in its place right away. */
firetable.ui.closeAuth = function () {
  putLoginBack();
  var dlg = document.getElementById("joinBox");
  if (dlg && dlg.open) dlg.close();
};

/** The dialog's title and note follow the form that's showing. */
firetable.ui.titleAuth = function (which) {
  var dlg = document.getElementById("joinBox");
  if (!dlg) return;
  $("#joinTitle").text(which === "create" ? "Join " + roomTitle() : which === "reset" ? "Reset your password" : "Welcome back");
  $("#au-note").text(authNote || (which === "create"
    ? "Members chat, save playlists, grab trading cards and take a turn on the decks."
    : which === "login" ? "Log in to chat, play your playlists and take a turn on the decks." : ""));
};

/** The header's button says Log in to people who've signed in here before. */
firetable.ui.labelSignIn = function () {
  var known = firetable.ui.authDefault() === "login";
  $("#nav-signinLabel").text(known ? "Log in" : "Join");
  $("#nav-signin").attr({ "aria-label": known ? "Log in or join" : "Join or log in", title: known ? "Log in or create an account" : "Create an account or log in" });
};

// ─── Your account: the menu, and Profile · Account · Settings ──────────────

/** Open the account dialog on a tab (profile-tab, account-tab, settings-tab, mod-tab). */
firetable.ui.openAccount = function (tab) {
  var dlg = document.getElementById("accountSettingsBox");
  if (!dlg || !ftapi.uid) return;
  tab = tab || "profile-tab";
  var $tabs = $("#accountSettingsTabs .tab");
  $tabs.removeClass("on").attr("aria-selected", "false").attr("tabindex", "-1");
  $tabs.filter('[data-tab="' + tab + '"]').addClass("on").attr("aria-selected", "true").attr("tabindex", "0");
  $("#accountSettingsBox .tabPanel").removeClass("active");
  $("#" + tab).addClass("active");
  firetable.ui.fillAccount();
  if (firetable.ui.updateUsernamePreview) firetable.ui.updateUsernamePreview();
  if (!dlg.open) dlg.showModal();
};

firetable.ui.hideAccountMenu = function () {
  var menu = document.getElementById("nav-accountMenu");
  try { if (menu && menu.matches(":popover-open")) menu.hidePopover(); } catch (e) { /* no popovers */ }
};

/** How someone signs in, in words. */
function signInMethod(info) {
  var p = (info && info.providers) || [];
  var names = [];
  if (p.indexOf("google.com") !== -1) names.push("Google");
  if (p.indexOf("apple.com") !== -1) names.push("Apple");
  if (p.indexOf("password") !== -1) names.push("Email and password");
  return names.join(", ") || "Email and password";
}

/** Your name, email, sign-in and join date, wherever they show. */
firetable.ui.fillAccount = function () {
  if (!ftapi.uid) return;
  var me = (ftapi.users && ftapi.users[ftapi.uid]) || {};
  var name = me.username || (ftapi.uname !== ftapi.uid ? ftapi.uname : "") || "You";
  var info = ftapi.actions.accountInfo ? ftapi.actions.accountInfo() : null;
  var email = (info && info.email) || "";
  var hasPassword = !info || info.providers.indexOf("password") !== -1;
  var face = "url(" + firetable.utilities.avatarURL(ftapi.uid, name) + ")";
  $("#nav-acctName, #ac-name").text(name);
  $("#nav-acctEmail").text(email).prop("hidden", !email);
  $("#nav-acctAvatar").css("background-image", face);
  $("#ac-email").text(email || "Not shared");
  $("#ac-passUser").val(email);
  $("#ac-method").text(signInMethod(info));
  $("#account-tab .ac-emailOnly").prop("hidden", !hasPassword);
  $("#ac-providerNote").prop("hidden", hasPassword)
    .text(hasPassword ? "" : "You sign in with " + signInMethod(info) + ", so your password and email are managed there.");
  var askedFor = ftapi.uid;
  if (firetable.ui._sinceFor !== askedFor) {
    firetable.ui._sinceFor = askedFor;
    $("#ac-since").text("");
    ftapi.db().ref("users/" + askedFor + "/joined").once("value").then(function (snap) {
      var when = snap.val();
      if (ftapi.uid !== askedFor || !when) return;
      $("#ac-since").text("Member since " + new Date(when).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
    }).catch(function () { /* older rules: no date */ });
  }
};

/** The account menu, the account tab's forms, and the Account tab itself. */
firetable.ui.setupAccount = function () {
  // Every [data-auth-open] on the site opens the sign-in dialog
  $(document).on("click", "[data-auth-open]", function (e) {
    e.preventDefault();
    firetable.ui.openAuth($(this).attr("data-auth-open"));
  });
  firetable.ui.labelSignIn();

  var dlg = document.getElementById("joinBox");
  if (dlg) {
    dlg.addEventListener("close", function () { putLoginBack(); authNote = null; });
  }

  // ── The menu under the header avatar ──
  var menu = document.getElementById("nav-accountMenu");
  var btn = document.getElementById("loggedInUser");
  if (menu && btn) {
    menu.addEventListener("beforetoggle", function (e) {
      if (e.newState !== "open") return;
      if (!ftapi.uid) { e.preventDefault(); return; }
      firetable.ui.fillAccount();
      menu.style.visibility = "hidden"; // until it's placed under the avatar
    });
    menu.addEventListener("toggle", function (e) {
      var open = e.newState === "open";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) return;
      firetable.ui.positionPopover(btn, menu, document.getElementById("nav-accountArrow"), "bottom-end").then(function () {
        var first = menu.querySelector('[role="menuitem"]:not([hidden])');
        if (first) first.focus();
      });
    });
    $(menu).on("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      var items = $(menu).find('[role="menuitem"]:not([hidden])').get();
      var i = items.indexOf(document.activeElement);
      i = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : i + (e.key === "ArrowDown" ? 1 : -1);
      items[(i + items.length) % items.length].focus();
    }).on("click", "[data-acct]", function () {
      firetable.ui.hideAccountMenu();
      firetable.ui.openAccount(this.getAttribute("data-acct"));
    }).on("click", ".showInstallGuide", firetable.ui.hideAccountMenu);
    $("#nav-logout").on("click", function () {
      firetable.ui.hideAccountMenu();
      firetable.actions.logOut();
    });
  }

  // ── The account dialog's tabs: arrow keys move between them ──
  $("#accountSettingsTabs").on("keydown", ".tab", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    var tabs = $("#accountSettingsTabs .tab").filter(":visible").get();
    var i = tabs.indexOf(this) + (e.key === "ArrowRight" ? 1 : -1);
    var next = tabs[(i + tabs.length) % tabs.length];
    firetable.ui.openAccount(next.getAttribute("data-tab"));
    next.focus();
  });

  // ── Account tab: show password, change password, change email ──
  var $acct = $("#account-tab");
  $acct.on("click", ".showPass", function () {
    var $in = $(this).siblings("input");
    var show = $in.attr("type") === "password";
    $in.attr("type", show ? "text" : "password");
    $(this).text(show ? "visibility_off" : "visibility").attr({ "aria-pressed": String(show), "aria-label": show ? "Hide password" : "Show password" });
  });
  var busy = function ($b, label) { $b.prop("disabled", !!label).text(label || $b.attr("data-label")); };
  var wrongPass = function (error) {
    return error && /invalid-credential|invalid-login-credentials|wrong-password/.test(error.code || "")
      ? "That password isn't right." : firetable.ui.authErrorMessage(error);
  };

  $("#ac-newPass").on("input", function () { firetable.ui.fieldNote(this); });
  $("#ac-passForm").on("submit", function (e) {
    e.preventDefault();
    var cur = $("#ac-curPass").val(), next = $("#ac-newPass").val();
    firetable.ui.formMessage("#ac-passForm", "");
    if (!cur) { firetable.ui.formMessage("#ac-passForm", "Enter your current password."); return $("#ac-curPass").trigger("focus"); }
    if (next.length < 6) { firetable.ui.fieldNote("#ac-newPass", "At least 6 characters.", "bad"); return $("#ac-newPass").trigger("focus"); }
    if (next === cur) { firetable.ui.fieldNote("#ac-newPass", "That's the password you have now.", "bad"); return $("#ac-newPass").trigger("focus"); }
    var $b = $("#ac-savePass");
    busy($b, "Changing…");
    ftapi.actions.changePassword(cur, next).then(function () {
      busy($b);
      $("#ac-curPass, #ac-newPass").val("").attr("type", "password");
      firetable.ui.fieldNote("#ac-newPass");
      firetable.ui.formMessage("#ac-passForm", "Your password is changed.", "success");
    }, function (error) {
      busy($b);
      $("#ac-curPass").val("");
      firetable.ui.formMessage("#ac-passForm", wrongPass(error));
    });
  });
  $("#ac-sendReset").on("click", function () {
    var info = ftapi.actions.accountInfo();
    if (!info || !info.email) return;
    firetable.ui.formMessage("#ac-passForm", "A reset link is on its way to " + info.email + ".", "success");
    ftapi.actions.resetPassword(info.email, function (error) {
      firetable.ui.formMessage("#ac-passForm", firetable.ui.authErrorMessage(error));
    });
  });

  $("#ac-emailForm").on("submit", function (e) {
    e.preventDefault();
    var email = $("#ac-newEmail").val().trim(), pass = $("#ac-emailPass").val();
    var info = ftapi.actions.accountInfo();
    firetable.ui.formMessage("#ac-emailForm", "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { firetable.ui.formMessage("#ac-emailForm", email ? "That doesn't look like an email address." : "Enter the new email."); return $("#ac-newEmail").trigger("focus"); }
    if (info && info.email && email.toLowerCase() === info.email.toLowerCase()) { firetable.ui.formMessage("#ac-emailForm", "That's the email you have now."); return $("#ac-newEmail").trigger("focus"); }
    if (!pass) { firetable.ui.formMessage("#ac-emailForm", "Enter your password."); return $("#ac-emailPass").trigger("focus"); }
    var $b = $("#ac-saveEmail");
    busy($b, "Sending…");
    ftapi.actions.changeEmail(email, pass).then(function () {
      busy($b);
      $("#ac-newEmail, #ac-emailPass").val("");
      firetable.ui.formMessage("#ac-emailForm", "Check " + email + " for a link. Your email changes when you open it.", "success");
    }, function (error) {
      busy($b);
      $("#ac-emailPass").val("");
      firetable.ui.formMessage("#ac-emailForm", wrongPass(error));
    });
  });

  // Signed out: nothing of the last account stays in the forms or the menu
  ftapi.events.on("loggedOut", function () {
    firetable.ui._sinceFor = null;
    $("#account-tab input").val("");
    $("#account-tab .formMessage").text("").removeClass("is-success");
    $("#nav-acctName, #nav-acctEmail, #ac-name, #ac-since, #ac-email, #usernameResponse").text("");
    $("#nav-acctMod").prop("hidden", true);
    var box = document.getElementById("accountSettingsBox");
    if (box && box.open) box.close();
  });
};

// ─── User Event Binding ──────────────────────────────────────────────────────

/**
 * Build a user-list HTML string for a user object (used by userJoined / userChanged).
 * @param {Object} data - User data from ftapi
 * @returns {string} Inner HTML for the user row
 */
function buildUserHTML(data) {
  var blockcon = data.blocked ? "block" : "";

  if (!data.username) data.username = data.userid;
  var roleicon = "person";
  var roleiconclass = "material-symbols-filled";
  if (data.mod) { roleicon = "shield"; roleiconclass = "material-symbols-filled"; }
  if (data.supermod) { roleicon = "local_police"; roleiconclass = "material-symbols-filled"; }
  if (data.hostbot) { roleicon = "smart_toy"; roleiconclass = "material-symbols-filled"; }

  return '<div class="ft-avatar" role="button" tabindex="0" aria-label="' + firetable.utilities.htmlEscape(data.username) + ' — profile" style="background-image:url(' + firetable.utilities.htmlEscape(firetable.utilities.avatarURL(data.userid, data.username, null, firetable.roomAvatarStyle || data.avatarStyle)) + ');">' +
         '<span class="material-symbols-outlined blockon">' + blockcon + '</span>' +
         '</div>' +
         '<span class="' + roleiconclass + ' prsnRole">' + roleicon + '</span>' +
         '<div class="prsnNameRole">' +
         '<span class="prsnName">' + firetable.utilities.htmlEscape(data.username) + '</span>' +
         '</div>';
}

/**
 * Determine which user list section a user belongs to.
 * @param {Object} data - User data
 * @returns {string} jQuery selector for the container
 */
function getUserDestination(data) {
  if (data.hostbot) return "#usersBot";
  if (data.supermod) return "#usersSuper";
  if (data.mod) return "#usersMod";
  return "#usersRegular";
}

/**
 * Persist minimal role metadata so ghost deck users keep the correct icon.
 * This is needed because disconnected deck users disappear from ftapi.users.
 */
function rememberGhostRole(data) {
  if (!data || !data.userid) return;
  firetable.ghostRoleCache = firetable.ghostRoleCache || {};
  firetable.ghostRoleCache[data.userid] = {
    mod: !!data.mod,
    supermod: !!data.supermod,
    hostbot: !!data.hostbot,
    avatarStyle: data.avatarStyle || null
  };
}

/**
 * Set up all ftapi user-related event handlers.
 * Called once from firetable.ui.init().
 */
/**
 * Reconcile "fake/ghost" (disconnected-but-on-deck) entries in the user list.
 * - Adds ghost user to user list for any deck DJ not currently in ftapi.users.
 * - Removes ghost users from user list for any user is now online again or has left the deck.
 * Safe to call any time tableData or ftapi.users may have changed.
 */
firetable.ui.syncGhostUsers = function () {
  // Remove ghost rows for users who are back online or off the deck
  $("#allUsers .prson.ghost").each(function () {
    var uid = $(this).data("userid");
    var onDeck = false;
    if (firetable.tableData) {
      for (var k in firetable.tableData) {
        if (firetable.tableData.hasOwnProperty(k) && firetable.tableData[k].id === uid) { onDeck = true; break; }
      }
    }
    if (!onDeck || (ftapi.users && ftapi.users[uid])) $(this).remove();
  });

  // Insert ghost users for deck DJs not currently in the user list
  if (!firetable.tableData) return;
  for (var k in firetable.tableData) {
    if (!firetable.tableData.hasOwnProperty(k)) continue;
    var dj = firetable.tableData[k];
    if (ftapi.users && ftapi.users[dj.id]) continue; // live user, not a ghost
    if ($("#user" + dj.id).length) continue; // already in list (ghost or live)
    var roleCache = (firetable.ghostRoleCache && firetable.ghostRoleCache[dj.id]) || {};
    var ghostData = {
      userid: dj.id,
      username: dj.name,
      mod: !!roleCache.mod,
      supermod: !!roleCache.supermod,
      hostbot: !!roleCache.hostbot,
      avatarStyle: roleCache.avatarStyle || null
    };
    var $el = $("<div></div>")
      .addClass("prson ghost")
      .attr("id", "user" + dj.id)
      .attr("data-userid", dj.id)
      .html(buildUserHTML(ghostData));
    $("#usersRegular").append($el);
  }
};

firetable.ui.setupUserEvents = function () {

  // ── Auth state events (already bound in init.js, but user-list events here) ──

  // Single joins/leaves/changes need no work of their own: Firebase follows
  // each one with "usersChanged", which rebuilds the list (once per frame).
  // Only remember roles, so a DJ who drops off still shows the right icon.
  ftapi.events.on("userJoined", rememberGhostRole);
  ftapi.events.on("userChanged", rememberGhostRole);

  // Several updates can land at once (presence, idle, blocks); rebuild the
  // list at most once per frame, with the latest data.
  ftapi.events.on("usersChanged", firetable.utilities.oncePerFrame(function (okdata) {
    // Rebuild the user list sections from scratch — handles the timing case
    // where a user joins while #appShell is detached (login screen).
    $("#usersBot, #usersSuper, #usersMod, #usersRegular").empty();
    if (okdata) {
      // Track which IDs are on the waitlist so we skip them
      var waitlistIds = {};
      if (firetable.waitlistData) {
        for (var wk in firetable.waitlistData) {
          if (firetable.waitlistData.hasOwnProperty(wk)) {
            waitlistIds[firetable.waitlistData[wk].id] = true;
          }
        }
      }
      for (var uid in okdata) {
        if (!okdata.hasOwnProperty(uid)) continue;
        var data = okdata[uid];
        data.userid = uid;
        rememberGhostRole(data);
        if (ftapi.blockedUsers && ftapi.blockedUsers[uid]) data.blocked = true;
        if (waitlistIds[uid]) continue;
        var isIdle = (data.idle && data.idle.isIdle && !data.hostbot) ? "idle" : "";
        var $el = $("<div></div>")
          .addClass("prson" + (data.blocked ? " blockd" : "") + (isIdle ? " " + isIdle : ""))
          .attr("id", "user" + uid)
          .attr("data-userid", uid)
          .html(buildUserHTML(data));
        $(getUserDestination(data)).append($el);
      }
    }

    // Update own display name and avatar if it was showing UID
    if (ftapi.uid && ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].username) {
      var ownUsername = ftapi.users[ftapi.uid].username;
      if ($("#loggedInName").text() === ftapi.uid) {
        $("#loggedInName").text(ownUsername);
      }
      $("#loggedInUser .ft-avatar").css("background-image", "url(" + firetable.utilities.avatarURL(ftapi.uid, ownUsername) + ")");
    }
    // Show supermod controls if applicable
    if (ftapi.uid && ftapi.users[ftapi.uid] && ftapi.users[ftapi.uid].supermod) {
      if ($("#ftSuperCopButton").is(":hidden")) {
        $("#ftSuperCopButton").show();
      }
      $("#modTab").show();
      $("#nav-acctMod").prop("hidden", false);
    }
    var count = okdata ? Object.keys(okdata).length : 0;
    $("#label1 .count").text(" (" + count + ")");
    firetable.debug && console.log('users:', okdata);
    // Re-insert any ghost deck users that were cleared by the full rebuild
    firetable.ui.syncGhostUsers();
    firetable.ui.renderRoomPulse();
  }));

  

  // ── Username change ──
  // The avatar beside the box previews the face the typed name would give
  // (robohash and DiceBear faces are made from the name).
  var previewTimer = 0;
  firetable.ui.updateUsernamePreview = function () {
    var typed = String($("#changeUsername").val() || "").trim();
    var name = typed || ftapi.uname || firetable.uname || "";
    if (!ftapi.uid) return;
    $("#usernameAvatarPreview")
      .css("background-image", "url(" + firetable.utilities.avatarURL(ftapi.uid, name, null, null, true) + ")")
      .attr("aria-label", typed ? "Your avatar as " + typed : "Your avatar");
  };
  $("#changeUsername").on("input", function () {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(firetable.ui.updateUsernamePreview, 250);
  });
  $("#changeUsername").on("input", function () {
    $("#usernameResponse").text("").removeAttr("data-state");
  });
  $("#ac-nameForm").on("submit", function (e) {
    e.preventDefault();
    var newDjName = $("#changeUsername").val().trim();
    var $res = $("#usernameResponse").text("").removeAttr("data-state");
    var say = function (text, state) { $res.text(text).attr("data-state", state); };
    if (!newDjName) { say("Type the name you'd like.", "bad"); return $("#changeUsername").trigger("focus"); }
    if (newDjName === ftapi.uname) return say("That's already your name.", "bad");
    var $save = $("#ac-saveName").prop("disabled", true);
    ftapi.actions.changeName(newDjName, function (error) {
      $save.prop("disabled", false);
      if (error) return say(/not available/i.test(error) ? newDjName + " is taken. Try another." : error, "bad");
      say("Done. You're " + newDjName + " now.", "good");
      $("#loggedInName").text(newDjName);
      ftapi.uname = newDjName;
      $("#loggedInUser .ft-avatar").css("background-image", "url(" + firetable.utilities.avatarURL(ftapi.uid, newDjName, null, null, true) + ")");
      $("#changeUsername").val("");
      firetable.ui.updateUsernamePreview();
      firetable.ui.fillAccount();
    });
  });

  // ── Supermod ban search ──
  // Two steps: Enter looks the person up and asks; Enter again confirms.
  var pendingSuspend = null;
  $("#supercopSearch").on("input", function () {
    pendingSuspend = null;
    $("#supercopResponse").text("");
  });
  $("#supercopSearch").on("keyup", function (e) {
    if (e.which !== 13) return;
    var val = $(this).val().trim();
    if (!val) return;
    if (pendingSuspend && pendingSuspend.name === val) {
      var who = pendingSuspend;
      pendingSuspend = null;
      ftapi.actions.banUser(who.userid);
      $("#supercopResponse").text(who.username + " suspended.");
      $(this).val("");
      return;
    }
    $("#supercopResponse").text("");
    ftapi.lookup.userByName(val, function (person) {
      if (!person) {
        $("#supercopResponse").text(val + " not found...");
      } else if (person.supermod) {
        $("#supercopResponse").text("Can not suspend that (or any) supermod.");
      } else {
        pendingSuspend = { name: val, userid: person.userid, username: person.username };
        $("#supercopResponse").text("Suspend " + person.username + "? Press Enter again to confirm.");
      }
    });
  });
};


