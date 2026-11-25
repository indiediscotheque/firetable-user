/**
 * analytics.js — Google Analytics (GA4): how many people visit, where they
 * come from and which pages they open. It's the tag Google hands out as an
 * inline snippet, as a file: the Content-Security-Policy runs no inline
 * scripts.
 *
 * The measurement IDs are on the <script> that loads this file (data-id, one
 * or several with a space between: each is a stream in Analytics, and every
 * one gets the same visits), on every page: index.html (and the library's
 * pages built from it, tools/plain-pages.mjs), about/, privacy/ and terms/.
 * Not the embeds, which show inside other sites. Take the <script> out of a
 * page to stop counting it; another room puts its own ID there.
 *
 * - Only on the live site: nothing loads from this computer's own address
 *   (localhost, 127.0.0.1: development and the browser tests).
 * - Not for a browser that sends Global Privacy Control ("don't sell or share
 *   my data"): Google's script is never fetched.
 * - A private part of the address never leaves: with a one-time ?token= (the
 *   way back from Last.fm, js/ui.js checkLastfmToken) the page is reported
 *   with only its campaign parameters (utm_…, gclid and the like).
 * - Moving between Live and the library's pages (history.pushState,
 *   js/discover.js) is counted by Analytics itself: "Page changes based on
 *   browser history events" in the stream's Enhanced measurement, on by default.
 *
 * .htaccess allows Google's tag (script-src) and where it reports to
 * (connect-src). README, "analytics".
 */
(function () {
  "use strict";
  var tag = document.currentScript;
  var ids = ((tag && tag.getAttribute("data-id")) || "").split(/[\s,]+/).filter(function (id) {
    return /^G-[A-Z0-9]{4,20}$/.test(id);
  });
  if (!ids.length) return;

  // the live site only
  var host = location.hostname;
  if (!/^https?:$/.test(location.protocol) || host === "localhost" || /\.localhost$/.test(host) ||
      host === "127.0.0.1" || host === "[::1]") return;
  // the visitor's browser says not to
  if (navigator.globalPrivacyControl === true) return;

  var PRIVATE = /^(token)$/i;                                    // never reported
  var CAMPAIGN = /^(utm_[a-z_]+|gclid|gbraid|wbraid|dclid|_gl)$/i; // where a visit came from

  /** The page's address when it holds something private: only its campaign parameters kept. Otherwise "". */
  function cleaned() {
    var url, secret = false, keep = [];
    try { url = new URL(location.href); } catch (e) { return ""; }
    url.searchParams.forEach(function (value, key) {
      if (PRIVATE.test(key)) secret = true;
      if (CAMPAIGN.test(key)) keep.push([key, value]);
    });
    if (!secret) return "";
    url.search = "";
    keep.forEach(function (pair) { url.searchParams.append(pair[0], pair[1]); });
    return url.href;
  }

  // Google's snippet, as it gives it
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  var clean = cleaned();
  ids.forEach(function (id) {
    if (clean) window.gtag("config", id, { page_location: clean });
    else window.gtag("config", id);
  });

  var lib = document.createElement("script");
  lib.async = true;
  lib.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ids[0]);
  document.head.appendChild(lib);
})();
