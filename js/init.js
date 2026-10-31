/**
 * init.js — Application bootstrap.
 *
 * This is the last module loaded. It defines firetable.init() which:
 *  1. Marks the app as started
 *  2. Applies room branding from ftconfigs (title, logo, social links)
 *  3. Sets up the DOMParser for HTML stripping
 *  4. Binds the window resize handler (debounced)
 *  5. Initializes the SoundCloud widget and binds its READY/PLAY events
 *  6. Removes playlist/tag editor DOM templates for later cloning
 *  7. Boots Firebase via ftapi.init()
 *  8. Binds auth lifecycle events (login, logout, reconnect, ban)
 *  9. Calls firetable.ui.init() to wire up the rest of the UI, then
 *     firetable.push.init() (@mention push notifications, js/push.js)
 *
 * The final line auto-starts the app: `if (!firetable.started) firetable.init();`
 *
 * Depends on: All other modules must be loaded before this file.
 */

// ─── Bootstrap ───────────────────────────────────────────────────────────────

firetable.init = function () {
  console.log(
    "\n" +
    " (                           )             )   (\n" +
    " )\\ )   (    (       (    ( /(      )   ( /(   )\\     (\n" +
    "(()/(   )\\   )(     ))\\   )\\())  ( /(   )\\()) (_))   ))\\\n" +
    " /(_)) ((_) (()\\   /((_) (_))/   )(_)) ((_)\\  | |   /((_)\n" +
    "(_) _|  (_)  ((_) (_))   | |_   ((_)_  | |(_) | |  (_))\n" +
    " |  _|  | | | '_| / -_)  |  _|  / _` | | '_ \\ | |  / -_)\n" +
    " |_|    |_| |_|   \\___|   \\__|  \\__,_| |_.__/ |_|  \\___|"
  );

  firetable.started = true;

  // ── Room Branding ──
  $("#welcomeName").text(ftconfigs.roomName);

  // Room avatar theme: config.js avatarset (e.g. "set2") if set, otherwise the
  // seasonal theme (monsters in October). It overrides every user's saved style.
  firetable.roomAvatarStyle = firetable.utilities.normalizeAvatarStyle(ftconfigs.avatarset)
    || firetable.utilities.seasonalAvatarStyle(new Date());
  if (firetable.roomAvatarStyle && firetable.roomAvatarStyle.indexOf("robohash:") === 0) {
    firetable.avatarset = firetable.roomAvatarStyle.slice(9);
  }

  // Social links — show each icon only if the URL is configured
  var socialLinks = [
    { cls: "facebook",   url: ftconfigs.facebookURL },
    { cls: "reddit",     url: ftconfigs.redditURL },
    { cls: "lastfm",     url: ftconfigs.lastfmURL },
    { cls: "discord",    url: ftconfigs.discordURL },
    { cls: "soundcloud", url: ftconfigs.soundcloudURL }
  ];
  socialLinks.forEach(function (link) {
    if (link.url) $(".sociallogo." + link.cls).attr("href", link.url);
  });

  // Social popover: position anchored to trigger, swap icon on toggle
  var socialPopoverEl = document.getElementById('socialPopover');
  if (socialPopoverEl) {
    socialPopoverEl.addEventListener('toggle', function (e) {
      var btn = document.getElementById('socialTrigger');
      var icon = btn && btn.querySelector('[class*="material-symbols-"]');
      if (e.newState === 'open') {
        if (icon) icon.textContent = 'close';
        socialPopoverEl.style.visibility = 'hidden';
        firetable.ui.positionPopover(btn, socialPopoverEl, document.getElementById('socialArrow'));
      } else {
        if (icon) icon.textContent = 'share';
      }
    });
  }

  if (ftconfigs.logoImage) {
    $("#roomlogo").css("background-image", "url(" + ftconfigs.logoImage + ")");
  }
  document.title = ftconfigs.roomName + " | firetable";
  if (ftconfigs.roomInfoUrl.length) {
    $("#roomInfo").attr("href", ftconfigs.roomInfoUrl);
  }
  $("#version").text("You're running firetable v" + firetable.version + ".");

  // ── Utilities Setup ──
  firetable.utilities.getEmojiMap();
  firetable.parser = new DOMParser();

  // ── Window Resize Handler (debounced) ──
  $(window).resize(firetable.utilities.debounce(function () {
    $("#thehistory").css('top', $('#stage').outerHeight() + $('#topbar').outerHeight());
    var $screenFrame = $('#screenFrame');
    var frameW = $screenFrame.outerWidth() || $('#djStage').outerWidth();
    var frameH = $screenFrame.outerHeight() || $('#djStage').outerHeight();
    // (the YouTube player is sized in CSS, taller than the frame, to crop its chrome)
    $('#scScreen')
      .width(frameW)
      .height(frameH);
    setup(); // Re-create the p5.js canvas at the new size
  }, 500));

  firetable.utilities.scrollToBottom();

  // ── SoundCloud Widget ──
  var widgetIframe = document.getElementById('sc-widget');
  firetable.scwidget = SC.Widget(widgetIframe);

  firetable.scwidget.bind(SC.Widget.Events.READY, function () {
    // When a SC track starts playing, apply volume + seek
    firetable.scwidget.bind(SC.Widget.Events.PLAY, function () {
      var vol = firetable.utilities.getEffectiveVolume();
      firetable.scwidget.setVolume(vol);
      // Previews start where asked; the room's song joins the room where it is now
      if (firetable.preview) {
        if (firetable.scSeek) firetable.scwidget.seekTo(firetable.scSeek);
      } else {
        firetable.media.syncSoundCloud();
      }
      // Clear reload spinner once SC audio actually starts playing
      $('#reloadtrack').removeClass('on working');
      firetable.media.onSoundCloudPlay();
    });
    firetable.scwidget.bind(SC.Widget.Events.ERROR, function () {
      firetable.media.onSoundCloudError();
    });

    // If a SC song was already loaded before the widget was ready, start it now
    if (firetable.song && firetable.song.type == MEDIA_SOUNDCLOUD) {
      var data = firetable.song;
      var timeSince = ftapi.now() - data.started;
      if (timeSince <= 0) timeSince = 0;
      if (!firetable.preview) {
        firetable.scSeek = timeSince;
        if (!firetable.disableMediaPlayback) {
          firetable.scwidget.load(SC_API_TRACK_URL + data.cid, {
            auto_play: true,
            callback: function () { firetable.scwidget.play(); }
          });
          firetable.media.watchSoundCloud();
        }
      }
    }
    firetable.scLoaded = true;
  });

  // ── DOM Templates ──
  $playlistItemTemplate = $('#mainqueue .pvbar').remove();

  // ── Firebase Init ──
  ftapi.init(ftconfigs.firebase);

  // ── Auth Lifecycle Events ──

  /** User successfully logged in */
  ftapi.events.on("loggedIn", function (data) {
    firetable.actions.loggedIn(data);
  });

  /** User logged out */
  ftapi.events.on("loggedOut", firetable.actions.showLoginScreen);

  /** Firebase reconnected after a network drop */
  ftapi.events.on("authReconnected", function () {
    firetable.debug && console.log('reconnected');
    $('body').removeClass('disconnected');
    $('#newchat').prop('disabled', false).focus();
  });

  /** Firebase connection lost */
  ftapi.events.on("authDisconnected", function () {
    firetable.debug && console.log('disconnected');
    $('body').addClass('disconnected');
    $('#newchat').prop('disabled', true).blur();
  });

  /** Current user was banned */
  ftapi.events.on("userBanned", function () {
    firetable.debug && console.log("ban detected.");
    if (document.getElementById("notice") == null) {
      $('.notice').attr('id', 'notice');
    }
  });

  /** Current user was un-banned */
  ftapi.events.on("userUnbanned", function () {
    window.location.reload();
  });

  // ── Visibility-change recovery ─────────────────────────────────────────
  // Chrome suppresses audible autoplay in background tabs.  When the user
  // returns, retry playback so they don't have to click "refresh audio".
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || firetable.disableMediaPlayback) return;
    var vol = firetable.utilities.getEffectiveVolume();
    if (firetable.song && firetable.song.type == MEDIA_YOUTUBE && firetable.ytLoaded && !firetable.preview) {
      if (player.getPlayerState() !== 1) {
        player.setVolume(vol);
        player.playVideo();
      }
    } else if (firetable.song && firetable.song.type == MEDIA_SOUNDCLOUD && firetable.scLoaded && !firetable.preview) {
      firetable.scwidget.isPaused(function (paused) {
        if (paused) {
          firetable.scwidget.setVolume(vol);
          firetable.scwidget.play();
        }
      });
    }
  });

  // ── UI Init (wires everything up) ──
  firetable.ui.init();
  firetable.push.init();
  firetable.snow.init();
};

// ─── Auto-start ──────────────────────────────────────────────────────────────
if (!firetable.started) firetable.init();
