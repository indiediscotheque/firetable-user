/**
 * sw.js — service worker: @mention push notifications.
 *
 * The hostbot sends Web Push messages (firetable-hostbot README, "push
 * notifications") to every device that turned on Settings → "Push @mentions
 * to this device"; this shows them, even with the app closed. Tapping one
 * opens the room's @ inbox (focusing the app if it's already open), and the
 * app icon shows the number of unread mentions where the phone supports it.
 *
 * No fetch handler: pages, scripts and media load exactly as without it.
 * It lives at the site's root so its scope covers the whole app; the site
 * registers it from js/push.js.
 */
"use strict";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/** All open windows of the app (also ones opened before this worker took over). */
function appWindows() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    return list.filter(function (c) { return c.url.indexOf(self.registration.scope) === 0; });
  });
}

function setBadge(count) {
  var nav = self.navigator;
  if (typeof count !== "number" || !nav || !nav.setAppBadge) return Promise.resolve();
  return (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(function () {});
}

self.addEventListener("push", function (event) {
  var d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = { body: event.data ? event.data.text() : "" };
  }
  var title = d.title || "Indie Discotheque";
  var options = {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || "mention",
    renotify: true,
    timestamp: typeof d.time === "number" ? d.time : Date.now(),
    data: { url: d.url || "./", id: d.id || null, kind: d.kind || "mention" }
  };
  // Every push must show a notification (browsers revoke silent ones).
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    setBadge(d.badge),
    appWindows().then(function (wins) {
      wins.forEach(function (w) { w.postMessage({ type: "push", kind: options.data.kind, id: options.data.id }); });
    })
  ]));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = new URL(data.url || "./", self.registration.scope).href;
  var openInbox = /#mentions$/.test(url);
  event.waitUntil(appWindows().then(function (wins) {
    var win = wins.filter(function (w) { return w.focused; })[0] ||
      wins.filter(function (w) { return w.visibilityState === "visible"; })[0] || wins[0];
    if (win) {
      if (openInbox) win.postMessage({ type: "openInbox", id: data.id });
      return win.focus();
    }
    return self.clients.openWindow(url);
  }));
});

// The browser replaced this device's subscription (keys expired or were
// rotated): sign up again with the same key. The site saves the new one for
// the bot the next time the room is opened; the bot drops the old one.
self.addEventListener("pushsubscriptionchange", function (event) {
  var old = event.oldSubscription;
  var key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    .then(function () {
      return appWindows();
    }).then(function (wins) {
      wins.forEach(function (w) { w.postMessage({ type: "resubscribed" }); });
    }).catch(function () { /* the site signs up again when it next opens */ }));
});
