/**
 * chat-images.js — image links shown as pictures in chat ("Show images in
 * chat", Settings → Chat; off by default, remembered on this device).
 *
 * - Which links are pictures: a direct http(s) link to an image file
 *   (jpg, png, gif, webp, avif, svg, bmp, apng), plus page links whose
 *   picture is at a known address: Imgur ("imgur.com/abc123", ".gifv"),
 *   Giphy ("giphy.com/gifs/…-id") and Unsplash's image host.
 * - The picture still links to what was posted, opens in a new tab, and has
 *   a × to fold it away (chat.js). Pictures load lazily and without a
 *   Referer, so other sites don't learn where they were shown (and Imgur,
 *   which turns away hotlinks that send one, shows them).
 * - Turning the setting on or off changes the messages already in chat.
 *
 * Every address goes through URL(), which percent-encodes quotes and spaces,
 * and is escaped again before it goes in HTML. The styles are in looks.css
 * (.inlineImgLink, .inlineImage, .hideImage).
 */
firetable.chatImages = (function () {
  var IMAGE_FILE = /\.(?:jpe?g|jfif|png|apng|gif|webp|avif|svg|bmp)$/i;
  var IMGUR_ID = /^\/([a-zA-Z0-9]{5,8})(?:\.gifv)?$/;          // "/abc1234", "/abc1234.gifv"
  var GIPHY_ID = /^\/(?:gifs|embed|media)\/(?:[\w-]*-)?([a-zA-Z0-9]{6,})(?:\/|$)/;

  /** A URL object for an http(s) link, or null. */
  function parse(raw) {
    var u;
    try { u = new URL(String(raw || "")); } catch (e) { return null; }
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  }

  /** Where a known site keeps the picture a page link shows, or null. */
  function hosted(u) {
    var host = u.hostname.replace(/^www\./, "");
    var m;
    if (host === "imgur.com" || host === "i.imgur.com" || host === "m.imgur.com") {
      m = IMGUR_ID.exec(u.pathname);
      if (m) return "https://i.imgur.com/" + m[1] + (/\.gifv$/i.test(u.pathname) ? ".gif" : ".jpg");
    }
    if (/^(?:media\d*\.)?giphy\.com$/.test(host)) {
      m = GIPHY_ID.exec(u.pathname);
      if (m) return "https://media.giphy.com/media/" + m[1] + "/giphy.gif";
    }
    if (host === "images.unsplash.com" && u.pathname.length > 1) return u.href;
    return null;
  }

  /**
   * The picture to show for a chat link, or null when it isn't one.
   * @param {string} raw - the link as posted
   * @returns {string|null} a normalized http(s) address, safe in an attribute
   */
  function src(raw) {
    var u = parse(raw);
    if (!u) return null;
    return IMAGE_FILE.test(u.pathname) ? u.href : hosted(u);
  }

  /** "Image from imgur.com": the picture's name for screen readers. */
  function alt(href) {
    var u = parse(href);
    return "Image from " + (u ? u.hostname.replace(/^www\./, "") : "a link");
  }

  /**
   * The picture for a link, as HTML.
   * @param {string} href - the link as posted
   * @param {string} img - its picture, from src()
   * @returns {string}
   */
  function html(href, img) {
    var esc = firetable.utilities.htmlEscape;
    var link = parse(href);
    var safeHref = esc(link ? link.href : img);
    return '<a class="inlineImgLink" href="' + safeHref + '" target="_blank" rel="noopener noreferrer" tabindex="-1">' +
      '<img src="' + esc(img) + '" class="inlineImage" alt="' + esc(alt(href)) + '"' +
      ' loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
      '<span role="button" class="hideImage" aria-label="Hide image">&times;</span></a>';
  }

  /**
   * Upgrade the image links in linkified chat HTML (from textToLinks()) to
   * pictures, when the setting is on. Only anchors linkify made are matched.
   * @param {string} chatTxt
   * @returns {string}
   */
  function upgrade(chatTxt) {
    if (!firetable.showImages) return chatTxt;
    return chatTxt.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>[^<]*<\/a>/gi, function (anchor, href) {
      var decoded = firetable.utilities.decodeEntities(href);
      var img = src(decoded);
      return img ? html(decoded, img) : anchor;
    });
  }

  /** A plain link again, as linkify makes them. */
  function plainLink(href) {
    var a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.tabIndex = -1;
    a.textContent = href;
    return a;
  }

  /**
   * Turn the setting on or off: remember it and redraw the messages already
   * in chat (links become pictures, or pictures links).
   * @param {boolean} on
   */
  function setEnabled(on) {
    firetable.showImages = !!on;
    try { localStorage[STORAGE.showImages] = firetable.showImages; } catch (e) { /* private mode */ }
    // The chat may be set aside with the members' part for the sign-in screen (users.js)
    var shell = firetable.$appShell && firetable.$appShell[0];
    var box = document.getElementById("actualChat") || (shell && shell.querySelector("#actualChat"));
    if (!box) return;
    if (on) {
      box.querySelectorAll(".chatText a[href]:not(.inlineImgLink)").forEach(function (a) {
        var href = a.getAttribute("href");
        var img = src(href);
        if (!img) return;
        a.insertAdjacentHTML("afterend", html(href, img));
        a.remove();
      });
    } else {
      box.querySelectorAll("a.inlineImgLink").forEach(function (a) {
        var line = a.closest(".chatText");
        if (line) line.classList.remove("hideImg");
        a.replaceWith(plainLink(a.getAttribute("href")));
      });
    }
    firetable.utilities.scrollToBottom();
  }

  // Pictures that don't load (gone, or not a picture after all) go back to
  // being a plain link. error doesn't bubble, so this listens in the capture
  // phase. Staying at the bottom as they load is the chat's sticky-bottom
  // tracker in state.js.
  document.addEventListener("error", function (e) {
    var t = e.target;
    var link = t && t.classList && t.classList.contains("inlineImage") && t.closest(".inlineImgLink");
    if (link) link.replaceWith(plainLink(link.getAttribute("href")));
  }, true);

  return { src: src, html: html, upgrade: upgrade, setEnabled: setEnabled };
})();
