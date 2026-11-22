/**
 * storage.js — keep the app working whatever localStorage does.
 *
 * Some browsers block it (private modes, "block site data", embedded
 * previews), and then every localStorage access throws; a full one (Safari
 * gives a site about 5 MB) throws on every write. Either would stop firetable
 * mid-task: a tab that won't switch, a setting that breaks a click (#64).
 * This swaps in a store with the same API, loaded before every other app
 * script: blocked, it keeps everything in memory for the visit; working, it
 * reads and writes the real storage and keeps in memory only a write that
 * didn't fit, so the app goes on as if it had.
 */
(function () {
  var real = null;
  try {
    var probe = "__firetable_storage_test";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    real = window.localStorage;
  } catch (e) { /* blocked: memory only */ }

  // what's only in memory: everything when blocked, the writes that didn't fit otherwise
  var data = Object.create(null);
  var has = function (k) {
    if (k in data) return true;
    try { return !!real && real.getItem(k) !== null; } catch (e) { return false; }
  };
  var keys = function () {
    var out = Object.keys(data);
    if (real) {
      try {
        for (var i = 0; i < real.length; i++) {
          var k = real.key(i);
          if (k !== null && !(k in data)) out.push(k);
        }
      } catch (e) { /* unreadable now: memory only */ }
    }
    return out;
  };
  var api = {
    getItem: function (k) {
      k = String(k);
      if (k in data) return data[k];
      try { return real ? real.getItem(k) : null; } catch (e) { return null; }
    },
    setItem: function (k, v) {
      k = String(k); v = String(v);
      if (real) {
        try { real.setItem(k, v); delete data[k]; return; } catch (e) { /* full: keep it for this visit */ }
      }
      data[k] = v;
    },
    removeItem: function (k) {
      k = String(k);
      delete data[k];
      try { if (real) real.removeItem(k); } catch (e) { /* nothing to free */ }
    },
    clear: function () {
      data = Object.create(null);
      try { if (real) real.clear(); } catch (e) { /* nothing to free */ }
    },
    key: function (i) { return keys()[i] || null; }
  };
  // The app uses both localStorage.getItem(k) and localStorage[k]
  var store = new Proxy(api, {
    get: function (t, k) {
      if (k === "length") return keys().length;
      if (typeof k !== "string") return undefined;
      if (Object.prototype.hasOwnProperty.call(api, k)) return api[k];
      var v = api.getItem(k);
      return v === null ? undefined : v;
    },
    set: function (t, k, v) { api.setItem(k, v); return true; },
    deleteProperty: function (t, k) { api.removeItem(k); return true; },
    has: function (t, k) { return Object.prototype.hasOwnProperty.call(api, k) || has(String(k)); },
    ownKeys: function () { return keys(); },
    getOwnPropertyDescriptor: function (t, k) {
      return has(String(k)) ? { value: api.getItem(k), writable: true, enumerable: true, configurable: true } : undefined;
    }
  });
  try {
    Object.defineProperty(window, "localStorage", { value: store, configurable: true });
  } catch (e) { /* can't replace it: the real one stays, as before */ }
})();
