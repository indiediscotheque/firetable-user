/**
 * sw.js — service worker: @mention push notifications.
 *
 * The hostbot sends Web Push messages (firetable-hostbot README, "push
 * notifications") to every device that turned on Settings → "Push @mentions
 * to this device"; this shows them, even with the app closed. Tapping one
 * opens the room's @ inbox (focusing the app if it's already open), and the
 * app icon shows the number of unread mentions where the phone supports it.
 *
 * It also shows offline.html when one of the site's own pages can't be
 * reached (no connection), instead of the browser's error page. That's all it
 * does with requests: the site's pages load from the network as always (it
 * keeps no copies of them), and scripts, styles, media and other sites never
 * pass through it.
 *
 * It lives at the site's root so its scope covers the whole app; the site
 * registers it on every visit (js/install.js, through js/push.js).
 */
"use strict";

// offline.html and the one image it shows. Bump the version when changing either.
var OFFLINE_CACHE = "ft-offline-v1";
var OFFLINE_PAGE = "offline.html";
var OFFLINE_LOGO = "img/idlogo2.png";
// The site's own pages (as in .htaccess); other sites share this folder
var OWN_PAGES = /^\/(?:index\.html|about|privacy|terms|music)?(?:\/|$)/;

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(function (cache) {
    return cache.addAll([new Request(OFFLINE_PAGE, { cache: "reload" }), new Request(OFFLINE_LOGO, { cache: "reload" })]);
  }).catch(function () { /* no offline page this time; push still works */ }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("ft-offline-") === 0 && k !== OFFLINE_CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/** The path of a URL below this worker's scope ("/" for the scope itself). */
function ownPath(url) {
  var scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || url.pathname.indexOf(scope.pathname) !== 0) return null;
  return "/" + url.pathname.slice(scope.pathname.length);
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var path = ownPath(new URL(req.url));
  if (path === null) return;
  if (req.mode === "navigate" && OWN_PAGES.test(path)) {
    event.respondWith(fetch(req).catch(function () {
      return caches.match(OFFLINE_PAGE, { cacheName: OFFLINE_CACHE }).then(function (page) {
        return page || Response.error();
      });
    }));
  } else if (path.slice(-OFFLINE_LOGO.length - 1) === "/" + OFFLINE_LOGO) {
    // the offline page's logo, from wherever that page was shown
    event.respondWith(fetch(req).catch(function () {
      return caches.match(OFFLINE_LOGO, { cacheName: OFFLINE_CACHE }).then(function (img) { return img || Response.error(); });
    }));
  }
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
    silent: d.silent === true, // playlist upkeep notices: no sound or vibration
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
  // only ever this site's own pages, whatever a push message names
  var target = new URL(data.url || "./", self.registration.scope);
  if (target.origin !== self.location.origin) target = new URL("./", self.registration.scope);
  var url = target.href;
  var openInbox = /#mentions$/.test(url);
  var openView = (url.match(/#(cards)$/) || [])[1]; // a card notice opens the card case
  event.waitUntil(appWindows().then(function (wins) {
    var win = wins.filter(function (w) { return w.focused; })[0] ||
      wins.filter(function (w) { return w.visibilityState === "visible"; })[0] || wins[0];
    if (win) {
      if (openInbox) win.postMessage({ type: "openInbox", id: data.id });
      else if (openView) win.postMessage({ type: "openView", view: openView });
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
