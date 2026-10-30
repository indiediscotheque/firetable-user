/**
 * lazy.js — load the stage effects' libraries only when an effect first shows.
 *
 * The fire (PixiJS + GSAP, ~550 KB) appears once someone sends a 🔥, and the
 * album-art glitch (p5.js, ~265 KB) only during SoundCloud songs with the
 * screen down. Most visits need neither, so they're loaded on first use, not
 * with the page. Each is pinned to an exact version and checked with
 * Subresource Integrity, like the CDN scripts in index.html; when upgrading
 * one, update its integrity hash too (see the README).
 */

var ftLazy = (function () {
  var LIBS = {
    pixi: {
      src: "https://cdn.jsdelivr.net/npm/pixi.js@4.8.9/dist/pixi.min.js",
      integrity: "sha384-fxjo+jPUZU4vjfxyz9RXr7LgHy6G3mgwntjZP6+T4YWAxd8PVz/necyJjkUDjOKi"
    },
    gsap: {
      src: "https://cdnjs.cloudflare.com/ajax/libs/gsap/2.1.3/TweenMax.min.js",
      integrity: "sha384-yXOFkJyq6/vzPbuifPxEbwfurfDPO9+2O3UHh8QfQH8yZCdI/KoyHxxuOk2hwIVL"
    },
    p5: {
      src: "https://cdnjs.cloudflare.com/ajax/libs/p5.js/0.5.7/p5.min.js",
      integrity: "sha384-Nc6Wpwz02/84Nk70wNI+ylNG2C8ynXTyEv7mPrL017fNCyPIP/hiEI1FVXGPuxvQ"
    }
  };
  var loading = {};

  /** Load one library (once); resolves when it has run. */
  function one(name) {
    if (loading[name]) return loading[name];
    var lib = LIBS[name];
    loading[name] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = lib.src;
      s.integrity = lib.integrity;
      s.crossOrigin = "anonymous";
      s.onload = function () { resolve(); };
      s.onerror = function () {
        delete loading[name]; // try again next time
        reject(new Error("couldn't load " + lib.src));
      };
      document.head.appendChild(s);
    });
    return loading[name];
  }

  /**
   * Load libraries in order (each runs before the next starts).
   * @param {Array<string>} names - keys of LIBS
   * @returns {Promise}
   */
  function load(names) {
    return names.reduce(function (p, name) {
      return p.then(function () { return one(name); });
    }, Promise.resolve());
  }

  return { load: load, LIBS: LIBS };
})();
