/**
 * lazy.js — load the stage effects' libraries only when an effect first shows.
 *
 * The album-art glitch (p5.js, ~265 KB) shows only during SoundCloud songs
 * with the screen down. Most visits never need it, so it's loaded on first
 * use, not with the page. (The fire needs no library: js/flame.js.) Each is pinned to an exact version and checked with
 * Subresource Integrity, like the CDN scripts in index.html; when upgrading
 * one, update its integrity hash too (see the README).
 */

var ftLazy = (function () {
  var LIBS = {
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
