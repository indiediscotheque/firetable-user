/**
 * storage.js — keep the app working when localStorage is unavailable.
 *
 * Some browsers block it (private modes, "block site data", embedded
 * previews), and then every localStorage access throws, which would stop
 * firetable from starting. In that case this swaps in an in-memory store
 * with the same API, so settings simply last for the visit. Loaded before
 * every other app script.
 */
(function () {
  try {
    var probe = "__firetable_storage_test";
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return; // real storage works
  } catch (e) { /* blocked: fall through */ }

  var data = Object.create(null);
  var api = {
    getItem: function (k) { k = String(k); return k in data ? data[k] : null; },
    setItem: function (k, v) { data[String(k)] = String(v); },
    removeItem: function (k) { delete data[String(k)]; },
    clear: function () { data = Object.create(null); },
    key: function (i) { return Object.keys(data)[i] || null; }
  };
  // Also support localStorage[key] reads/writes, as the app uses both forms
  var store = new Proxy(api, {
    get: function (t, k) {
      if (k === "length") return Object.keys(data).length;
      if (k in api) return api[k];
      return typeof k === "string" && k in data ? data[k] : undefined;
    },
    set: function (t, k, v) { data[String(k)] = String(v); return true; },
    deleteProperty: function (t, k) { delete data[String(k)]; return true; },
    has: function (t, k) { return k in data || k in api; }
  });
  try {
    Object.defineProperty(window, "localStorage", { value: store, configurable: true });
  } catch (e) { /* can't replace it; nothing more we can do */ }
})();
