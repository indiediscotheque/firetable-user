/**
 * push.js — @mention push notifications on this device.
 *
 * With Settings → "Push @mentions to this device" on, the hostbot sends a
 * notification whenever someone @mentions you and you're not looking at the
 * room, even with the app closed (firetable-hostbot README, "push
 * notifications"). Made for phones with the site installed as an app (iPhone
 * and iPad need it on the Home Screen first); desktop browsers work too.
 *
 * How: sw.js (the service worker) shows the messages. This file signs the
 * device up with the browser's push service using the bot's public key
 * (pushKey in the database) and saves the subscription under
 * pushSubs/<uid>/<device> for the bot. It re-checks on every visit, so a
 * subscription the browser replaced, or a new bot key, is picked up on its own.
 *
 * Settings live per device and per account: turning it on for your account
 * here doesn't turn it on for someone else who signs in on this device.
 *
 * Depends on: firetable.js (ftapi), state.js (firetable), constants.js (STORAGE)
 */

firetable.push = {
  key: null,        // the bot's public key; "" once known to be unset
  keyRef: null,
  keyFn: null,
  devRef: null,
  devFn: null,
  devices: {},      // this account's devices: id -> record
  busy: false,
  status: "",       // why it's off, for the settings hint

  // ─── Device and browser checks ───────────────────────────────────────────

  canWork: function () {
    return !!(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window &&
      "Notification" in window && "showNotification" in ServiceWorkerRegistration.prototype);
  },
  isIOS: function () {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  },
  isApp: function () {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  },
  isPhone: function () {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  },
  /** e.g. "iPhone app", "Android · Chrome", "Mac · Firefox" */
  deviceName: function () {
    var ua = navigator.userAgent;
    var os = /iPhone|iPod/.test(ua) ? "iPhone" : /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "iPad" :
      /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "Chromebook" : /Mac/.test(ua) ? "Mac" : /Win/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
    if (firetable.push.isApp()) return os + " app";
    var browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\//.test(ua) ? "Opera" :
      /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
    return browser ? os + " · " + browser : os;
  },

  // ─── Settings (per device, per account) ──────────────────────────────────

  enabled: function () {
    return !!ftapi.uid && localStorage[STORAGE.pushMentions] === ftapi.uid;
  },
  wantsEveryone: function () {
    return localStorage[STORAGE.pushEveryone] === "true";
  },
  thisDevice: function () {
    return localStorage[STORAGE.pushDevice] || "";
  },

  // ─── Service worker ──────────────────────────────────────────────────────

  _reg: null,
  /** Register sw.js (once). Resolves with the registration, or null. */
  register: function () {
    if (firetable.push._reg) return firetable.push._reg;
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return (firetable.push._reg = Promise.resolve(null));
    firetable.push._reg = navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function () {
      return navigator.serviceWorker.ready;
    }).catch(function (err) {
      firetable.debug && console.log("service worker failed:", err);
      return null;
    });
    navigator.serviceWorker.addEventListener("message", function (e) {
      var msg = e.data || {};
      if (msg.type === "openInbox") firetable.ui.openInbox();
      else if (msg.type === "resubscribed") firetable.push.sync(true);
    });
    return firetable.push._reg;
  },

  // ─── Keys and subscriptions ──────────────────────────────────────────────

  keyBytes: function (b64url) {
    var s = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(s + "===".slice((s.length + 3) % 4));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },
  sameKey: function (sub, key) {
    var have = sub && sub.options && sub.options.applicationServerKey;
    // a browser that doesn't say which key it used: trust the one saved with it
    if (sub && !have) return String(localStorage[STORAGE.pushSeen] || "").split("|")[3] === key;
    if (!have) return false;
    var a = new Uint8Array(have), b = firetable.push.keyBytes(key);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  },
  /** A short id for a subscription (the same endpoint always gets the same id). */
  deviceId: function (endpoint) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)).then(function (buf) {
      var s = "";
      new Uint8Array(buf).slice(0, 16).forEach(function (b) { s += String.fromCharCode(b); });
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    });
  },
  /** This device's subscription for the bot's current key (made if needed). */
  subscription: function (create) {
    var key = firetable.push.key;
    return firetable.push.register().then(function (reg) {
      if (!reg) throw new Error("no service worker");
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && firetable.push.sameKey(sub, key)) return sub;
        if (!create && !sub) return null;
        // made for an older bot key: sign up again with the new one
        return (sub ? sub.unsubscribe().catch(function () {}) : Promise.resolve()).then(function () {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: firetable.push.keyBytes(key) });
        });
      });
    });
  },
  /** Save (or refresh) this device for the bot. */
  save: function (sub) {
    var uid = ftapi.uid;
    var json = sub.toJSON();
    return firetable.push.deviceId(json.endpoint).then(function (id) {
      var record = {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        key: firetable.push.key,
        device: firetable.push.deviceName().slice(0, 60),
        everyone: firetable.push.wantsEveryone(),
        seen: firebase.database.ServerValue.TIMESTAMP
      };
      var updates = {};
      updates[id] = record;
      var old = firetable.push.thisDevice();
      if (old && old !== id) updates[old] = null; // the browser replaced the subscription
      return ftapi.db().ref("pushSubs/" + uid).update(updates).then(function () {
        localStorage[STORAGE.pushDevice] = id;
        localStorage[STORAGE.pushSeen] = uid + "|" + id + "|" + record.everyone + "|" + record.key + "|" + Date.now();
      });
    });
  },
  /** Remove this device's record for the signed-in account. */
  forget: function () {
    var id = firetable.push.thisDevice();
    if (!ftapi.uid || !id) return Promise.resolve();
    return ftapi.db().ref("pushSubs/" + ftapi.uid + "/" + id).remove().catch(function () {});
  },

  // ─── Turning it on and off ───────────────────────────────────────────────

  enable: function () {
    var p = firetable.push;
    if (!p.canWork() || !p.key || p.busy) return Promise.resolve(false);
    p.busy = true;
    p.status = "";
    p.render();
    // must run straight from the tap (iPhone asks only then)
    var ask = Notification.permission === "granted" ? Promise.resolve("granted") : Promise.resolve(Notification.requestPermission());
    return ask.then(function (perm) {
      if (perm !== "granted") {
        p.status = perm === "denied" ? "denied" : "";
        return false;
      }
      return p.subscription(true).then(function (sub) {
        localStorage[STORAGE.pushMentions] = ftapi.uid;
        return p.save(sub);
      }).then(function () {
        return p.register();
      }).then(function (reg) {
        if (reg) {
          reg.showNotification("Push notifications are on", {
            body: "You'll get @mentions here when you're away from the room.",
            icon: "icons/icon-192.png", badge: "icons/badge-96.png", tag: "test"
          }).catch(function () {});
        }
        return true;
      });
    }).catch(function (err) {
      console.error("[firetable] turning on push notifications failed:", err);
      p.status = "failed";
      return false;
    }).then(function (ok) {
      p.busy = false;
      p.render();
      return ok;
    });
  },

  disable: function () {
    var p = firetable.push;
    p.busy = true;
    p.render();
    if (localStorage[STORAGE.pushMentions] === ftapi.uid) localStorage.removeItem(STORAGE.pushMentions);
    return p.forget().then(function () {
      return p.subscription(false).catch(function () { return null; });
    }).then(function (sub) {
      // Leave the browser subscription if another account here still uses it
      if (sub && !localStorage[STORAGE.pushMentions]) return sub.unsubscribe().catch(function () {});
    }).then(function () {
      localStorage.removeItem(STORAGE.pushDevice);
      localStorage.removeItem(STORAGE.pushSeen);
      p.busy = false;
      p.render();
    });
  },

  /**
   * On every visit (and when the bot's key changes): keep this device's
   * record current, sign up again if the browser or the bot changed keys,
   * and turn the setting off if notifications were blocked meanwhile.
   */
  sync: function (force) {
    var p = firetable.push;
    if (!ftapi.uid || !p.key || !p.canWork()) return p.render();
    if (!p.enabled()) return p.render();
    if (Notification.permission !== "granted") {
      p.status = Notification.permission === "denied" ? "denied" : "";
      return p.disable();
    }
    return p.subscription(true).then(function (sub) {
      return p.deviceId(sub.toJSON().endpoint).then(function (id) {
        var last = String(localStorage[STORAGE.pushSeen] || "").split("|");
        var fresh = last[0] === ftapi.uid && last[1] === id && last[2] === String(p.wantsEveryone()) && last[3] === p.key &&
          Date.now() - Number(last[4] || 0) < 12 * 60 * 60 * 1000 && p.devices[id];
        if (!fresh || force) return p.save(sub);
      });
    }).catch(function (err) {
      firetable.debug && console.log("push sync failed:", err);
    }).then(p.render);
  },

  // ─── While signed in ─────────────────────────────────────────────────────

  watch: function () {
    var p = firetable.push;
    p.unwatch();
    if (!ftapi.uid) return;
    p.register();
    p.keyRef = ftapi.db().ref("pushKey");
    p.keyFn = p.keyRef.on("value", function (snap) {
      var key = typeof snap.val() === "string" ? snap.val() : "";
      var changed = key !== p.key;
      p.key = key;
      if (changed) p.sync();
    }, function () { p.key = ""; p.render(); });
    p.devRef = ftapi.db().ref("pushSubs/" + ftapi.uid);
    p.devFn = p.devRef.on("value", function (snap) {
      p.devices = snap.val() || {};
      p.render();
    }, function () { p.devices = {}; p.render(); });
  },

  unwatch: function () {
    var p = firetable.push;
    if (p.keyRef && p.keyFn) p.keyRef.off("value", p.keyFn);
    if (p.devRef && p.devFn) p.devRef.off("value", p.devFn);
    p.keyRef = p.keyFn = p.devRef = p.devFn = null;
    p.key = null;
    p.devices = {};
    p.status = "";
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
    p.render();
  },

  // ─── Settings and inbox UI ───────────────────────────────────────────────

  render: function () {
    var p = firetable.push;
    var $toggle = $("#pushMentionsToggle"), $every = $("#pushEveryoneToggle"), $hint = $("#pushHint");
    if (!$toggle.length) return;
    var works = p.canWork();
    var on = works && p.enabled() && !!p.key;
    var hint = "";
    if (!works) {
      hint = p.isIOS() && !p.isApp()
        ? "On iPhone and iPad, notifications work in the app: tap Share, then Add to Home Screen, and open Indie Disco from your Home Screen."
        : "This browser can't get push notifications.";
    } else if (p.key === "") {
      hint = "Push notifications aren't set up on the room's bot yet.";
    } else if (p.status === "denied" || (!on && Notification.permission === "denied")) {
      hint = "Notifications are blocked for this site. Allow them in your " + (p.isApp() ? "phone's settings" : "browser's site settings") + ", then turn this on.";
    } else if (p.status === "failed") {
      hint = "Couldn't turn on push notifications. Try again in a moment.";
    } else if (on) {
      hint = "You'll get a notification when someone @mentions you while you're away from the room.";
    } else if (p.isPhone() && !p.isApp()) {
      hint = "Tip: install the app (browser menu → Install app or Add to Home Screen) to get notifications like any other app.";
    }
    $toggle.prop({ checked: on, disabled: !works || !p.key || p.busy });
    $every.prop({ checked: on && p.wantsEveryone(), disabled: !on || p.busy });
    $("#pushEveryoneLine").toggleClass("is-disabled", !on);
    $hint.text(hint).prop("hidden", !hint);
    $("#pushTest").prop("hidden", !on).prop("disabled", p.busy);

    // this account's devices
    var mine = p.thisDevice();
    var ids = Object.keys(p.devices || {}).sort(function (a, b) { return (p.devices[b].seen || 0) - (p.devices[a].seen || 0); });
    var $list = $("#pushDevices").empty().prop("hidden", !ids.length);
    ids.forEach(function (id) {
      var d = p.devices[id] || {};
      var $li = $('<li class="pushDevice"></li>');
      $('<span class="pushDeviceName"></span>').text((d.device || "Device") + (id === mine && on ? " (this device)" : "")).appendTo($li);
      $('<button type="button" class="row-icon material-symbols-outlined pushDeviceRemove" title="Stop push notifications on this device" aria-label="Stop push notifications on this device">close</button>')
        .attr("data-id", id).appendTo($li);
      $list.append($li);
    });

    // the nudge in the @ inbox
    var nudge = "";
    if (ftapi.uid && !on && localStorage[STORAGE.pushNudge] !== "off" && (typeof Notification === "undefined" || Notification.permission !== "denied")) {
      if (works && p.key && (p.isApp() || p.isPhone())) nudge = "turnOn";
      else if (!works && p.isIOS() && !p.isApp()) nudge = "install";
    }
    $("#inboxPush").prop("hidden", !nudge).attr("data-kind", nudge);
    $("#inboxPushOn").prop("hidden", nudge !== "turnOn").prop("disabled", p.busy);
    $("#inboxPushText").text(nudge === "install"
      ? "Get these as notifications: tap Share, then Add to Home Screen, and turn them on in the app."
      : "Get these on this " + (p.isPhone() ? "phone" : "device") + ", even with the app closed.");
  },

  init: function () {
    var p = firetable.push;
    p.register();
    ftapi.events.on("loggedIn", p.watch);
    ftapi.events.on("loggedOut", p.unwatch);

    $("#pushMentionsToggle").on("change", function () {
      if (this.checked) p.enable();
      else p.disable();
    });
    $("#pushEveryoneToggle").on("change", function () {
      localStorage[STORAGE.pushEveryone] = this.checked;
      p.sync(true);
    });
    $("#pushTest").on("click", function () {
      // through the bot, the way a real mention travels
      ftapi.actions.sendBotCommand("!pushtest");
      var $b = $(this).prop("disabled", true).text("Sent");
      setTimeout(function () { $b.prop("disabled", false).text("Send a test"); }, 4000);
    });
    $("#pushDevices").on("click", ".pushDeviceRemove", function () {
      var id = $(this).attr("data-id");
      if (id === p.thisDevice() && p.enabled()) return p.disable();
      ftapi.db().ref("pushSubs/" + ftapi.uid + "/" + id).remove().catch(function () {});
    });
    $("#inboxPushOn").on("click", function () {
      p.enable();
    });
    $("#inboxPushDismiss").on("click", function () {
      localStorage[STORAGE.pushNudge] = "off";
      p.render();
    });
    // permission changed in the browser's settings while the room was open
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "notifications" }).then(function (status) {
        status.onchange = function () { p.sync(); };
      }).catch(function () {});
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && ftapi.uid) p.sync();
    });
    p.render();
  }
};
