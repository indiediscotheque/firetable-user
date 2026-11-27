/**
 * screen-poster.js — the song's own picture on the stage's screen, between songs.
 *
 * With the screen down, a song change used to go: the video gone to black, the
 * screen sliding up and down again when the next song came a moment late, black
 * for the seconds YouTube's own bars take to clear (player.js REVEAL_MS), then
 * the video snapping in. Now the screen cuts straight to the new song's picture
 * (a video's thumbnail; a SoundCloud song's cover, whole, over a blur of itself)
 * drifting slowly in, so it reads as a title card and not a stuck video, and the
 * video fades in over it once it's clean (css/screen-poster.css). A picture is
 * put up only once it's decoded, so the cut never shows a blank frame.
 *
 * player.js loads this the first time its song or state changes with the screen
 * down (firetable.media.poster), then calls sync() on every song change and
 * every change in YouTube's player.
 */
firetable.screenPoster = (function () {
  "use strict";

  var YT_IMG = "https://i.ytimg.com/vi/";
  /** YouTube's stand-in when a video has no picture that size (120 × 90, grey) */
  var NO_PICTURE_W = 120;
  var box = null;
  /** The song whose picture is wanted ("type:cid"), or null for none */
  var want = null;

  /** The poster, made the first time (under the player, so the video covers it once it shows). */
  function el() {
    if (box) return box;
    var frame = document.getElementById("screenFrame");
    if (!frame) return null;
    if (!document.getElementById("screen-poster-css")) {
      var meta = document.querySelector('meta[name="poster-css"]');
      var css = document.createElement("link");
      css.id = "screen-poster-css";
      css.rel = "stylesheet";
      css.href = meta ? meta.content : "css/screen-poster.css";
      document.head.appendChild(css);
    }
    box = document.createElement("div");
    box.id = "screenPoster";
    box.setAttribute("aria-hidden", "true");
    box.hidden = true;
    frame.insertBefore(box, frame.firstChild);
    return box;
  }

  /**
   * What the screen's player is on: Discover's pick while it plays there (by
   * the video YouTube has, so it's never a song behind), else the room's song.
   * @returns {{type: number, cid: string, image?: string}|null}
   */
  function current() {
    if (firetable.preview === "discover") {
      var data = typeof player !== "undefined" && player && player.getVideoData ? player.getVideoData() : null;
      return firetable.previewType === MEDIA_YOUTUBE && data && data.video_id ? { type: MEDIA_YOUTUBE, cid: data.video_id } : null;
    }
    var song = firetable.song;
    return song && song.cid && song.cid != 0 ? song : null;
  }

  /**
   * A song's pictures, the one to show first and a sharper one to swap in:
   * a video's thumbnail (hqdefault always exists; its letterbox bars fall
   * outside the 16:9 screen), or a SoundCloud cover at its biggest.
   * @returns {{art: boolean, srcs: string[]}|null}
   */
  function pictures(song) {
    if (Number(song.type) === MEDIA_SOUNDCLOUD) {
      var art = String(song.image || "").replace("-large", "-t500x500");
      return art ? { art: true, srcs: [art] } : null;
    }
    var id = encodeURIComponent(String(song.cid));
    return { art: false, srcs: [YT_IMG + id + "/hqdefault.jpg", YT_IMG + id + "/maxresdefault.jpg"] };
  }

  /** An image, loaded and decoded, ready to show at once. */
  function decoded(src) {
    var img = new Image();
    img.decoding = "async";
    img.alt = "";
    img.src = src;
    var ready = img.decode ? img.decode() : new Promise(function (resolve, reject) {
      img.onload = resolve;
      img.onerror = reject;
    });
    return ready.then(function () { return img; });
  }

  /** Cut to this picture: a new element, so its drift starts again. */
  function put(b, img, art) {
    while (b.firstChild) b.removeChild(b.firstChild);
    if (art) {
      var fill = new Image();
      fill.className = "sp-fill";
      fill.alt = "";
      fill.src = img.src;
      b.appendChild(fill);
    }
    img.className = "sp-pic";
    b.appendChild(img);
    b.classList.toggle("is-art", art);
    b.hidden = false;
  }

  function clear(b) {
    b.hidden = true;
    while (b.firstChild) b.removeChild(b.firstChild);
  }

  /** The sharper picture, swapped in place once it's ready (the drift carries on). */
  function sharpen(b, key, src) {
    decoded(src).then(function (big) {
      var pic = b.querySelector(".sp-pic");
      if (want === key && pic && big.naturalWidth > NO_PICTURE_W) pic.src = big.src;
    }, function () {});
  }

  /** Show this song's picture (null: none). Asking again for the one wanted does nothing. */
  function show(song) {
    var b = el();
    if (!b) return;
    var key = song ? Number(song.type) + ":" + song.cid : null;
    if (key === want) return;
    want = key;
    var pics = song && pictures(song);
    if (!pics) return clear(b);
    decoded(pics.srcs[0]).then(function (img) {
      if (want !== key) return; // another song came first
      put(b, img, pics.art);
      if (pics.srcs[1]) sharpen(b, key, pics.srcs[1]);
    }, function () {
      if (want === key) clear(b); // no picture: black, as before
    });
  }

  /** Bring the poster in step with what the screen's player is on. */
  function sync() {
    show(current());
  }

  return { sync: sync, show: show };
})();
