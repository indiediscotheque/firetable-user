// Shared setup for the browser tests (smoke.mjs, rules.mjs): serves this site
// locally under the real Content-Security-Policy from .htaccess, with a
// config.js that points at the local Firebase emulators. Never deployed.
import http from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { createHash } from "crypto";
import { join, extname, normalize } from "path";
import { fileURLToPath } from "url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DB = "http://127.0.0.1:9000";
export const AUTH = "http://127.0.0.1:9099";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The policy the server sends, plus the local emulators. upgrade-insecure-requests
 * is dropped: these tests run over plain http on 127.0.0.1.
 */
export function policy({ auth = false } = {}) {
  const htaccess = readFileSync(join(ROOT, ".htaccess"), "utf8");
  return htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/)[1]
    .replace("connect-src ", "connect-src " + DB + " ws://127.0.0.1:9000 " + (auth ? AUTH + " " : ""))
    .replace("script-src ", "script-src " + DB + " ")
    .replace(/;\s*upgrade-insecure-requests/, "");
}

/** config.js lives only on the server; this one points at the emulator's namespace `ns`. */
export function config(ns) {
  const example = readFileSync(join(ROOT, "config.js.example"), "utf8");
  return example
    .replace(/firebase:\s*\{[\s\S]*?\}/, `firebase: { apiKey: "fake-key", authDomain: "${ns}.firebaseapp.com", databaseURL: "${DB}?ns=${ns}" }`)
    .replace(/youtubeKey: "[^"]*"/, 'youtubeKey: "no-yt-key"');
}

/** Write `value` at `path` in namespace `ns`, as the database owner (rules don't apply). */
export const putAs = (ns) => (path, value) =>
  fetch(DB + path + ".json?ns=" + ns, { method: "PUT", headers: { Authorization: "Bearer owner" }, body: JSON.stringify(value) });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".gif": "image/gif" };

/**
 * Serve the site on a free port.
 * @returns {Promise<{server: http.Server, SITE: string}>}
 */
export async function serveSite({ csp, configJs }) {
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const headers = { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" };
    if (path === "/config.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); return res.end(configJs); }
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || /[\\/](tests|node_modules|\.git)([\\/]|$)/.test(file.slice(ROOT.length))) { res.writeHead(404); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, SITE: "http://127.0.0.1:" + server.address().port + "/" };
}

/**
 * Open a page of the site. Waits for the document (DOMContentLoaded), then up
 * to 15s for the load event, which also waits on third-party frames (the
 * YouTube and SoundCloud players): a CI runner where one of those hangs
 * otherwise times out every page with no clue why. When even the document
 * doesn't arrive, the error names the requests still loading.
 */
export async function openPage(page, url, { timeout = 60000 } = {}) {
  const pending = new Set();
  const add = (r) => pending.add(r);
  const done = (r) => pending.delete(r);
  const still = () => [...pending].map((r) => r.url().slice(0, 140)).join(", ") || "nothing";
  page.on("request", add);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout }).catch((e) => {
      e.message += "\n  still loading: " + still();
      throw e;
    });
    await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {
      console.log("  note: no load event 15s after " + url + "; still loading: " + still());
    });
  } finally {
    page.off("request", add);
    page.off("requestfinished", done);
    page.off("requestfailed", done);
  }
}

/** Chromium options: through the HTTPS proxy when there is one (CDN files), never for the local servers. */
export const launchOptions = () =>
  process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {};

/**
 * A real account in the auth emulator (made, or reused from an earlier run);
 * resolves its uid.
 */
export async function authAccount(email, password) {
  const call = (what) => fetch(AUTH + "/identitytoolkit.googleapis.com/v1/accounts:" + what + "?key=fake-key", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  }).then((r) => r.json());
  let j = await call("signUp");
  if (j.error && j.error.message === "EMAIL_EXISTS") j = await call("signInWithPassword");
  if (!j.localId) throw new Error("auth emulator: " + JSON.stringify(j));
  return j.localId;
}

/**
 * Point the site's Firebase app at the auth emulator the moment it's made,
 * before anything signs in (no change to the site's code).
 */
export const useAuthEmulator = (page) => page.addInitScript((authUrl) => {
  let fb;
  Object.defineProperty(window, "firebase", {
    configurable: true,
    get() { return fb; },
    set(v) {
      fb = v;
      const init = v.initializeApp;
      v.initializeApp = function () {
        const app = init.apply(this, arguments);
        app.auth().useEmulator(authUrl, { disableWarnings: true });
        return app;
      };
    }
  });
}, AUTH);

/** Log the loaded site in as `email` with the site's own login, and wait until it's signed in as `uid`. */
export async function logInAs(page, email, password, uid) {
  await page.waitForFunction(() => window.ftapi && ftapi.started, null, { timeout: 30000 });
  await page.evaluate(([e, p]) => ftapi.actions.logIn(e, p, (err) => { window.__loginError = String(err && err.message); }), [email, password]);
  await page.waitForFunction((u) => ftapi.uid === u && ftapi.queueRef && !window.__loginError, uid, { timeout: 30000 })
    .catch(async () => { throw new Error("couldn't sign in as " + email + ": " + await page.evaluate(() => window.__loginError)); });
}

/** Avatars from other sites: the live site's robots and DiceBear's. */
const AVATARS = /^https:\/\/((www\.)?indiediscotheque\.com\/robots\/|api\.dicebear\.com\/)/;

/**
 * Answer every avatar request with a local picture. Tests that don't look at
 * the avatars themselves shouldn't wait on the live site's avatar server: on
 * one CI runner its requests hung, the page's load event never came, and
 * whatever waits for it (p5.js's glitch canvas) never started.
 */
export async function stubAvatars(context) {
  const png = readFileSync(join(ROOT, "favicon.png"));
  await context.route(AVATARS, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
}

/** Pictures from other sites: avatars (the live site's robots), YouTube's and SoundCloud's covers. */
export const PICTURES = /^https:\/\/((www\.)?indiediscotheque\.com\/robots\/|api\.dicebear\.com\/|i\.ytimg\.com\/|img\.youtube\.com\/|i\d*\.sndcdn\.com\/)/;
const CACHE = join(ROOT, "tests", "screens", ".cache");

/**
 * Serve PICTURES from a disk cache (tests/screens/.cache, not committed) after
 * the first fetch: the same bytes every run, nothing left loading, and no
 * load on the live site's avatar server, which rate-limits. Only a good answer
 * is kept; a refusal (429 and the like) gets one more try, then passes through
 * uncached.
 */
export async function cachePictures(context) {
  await context.route(PICTURES, async (route) => {
    const url = route.request().url();
    const file = join(CACHE, createHash("sha1").update(url).digest("hex"));
    if (existsSync(file + ".json")) {
      const m = JSON.parse(readFileSync(file + ".json", "utf8"));
      return route.fulfill({ status: m.status, headers: m.headers, body: readFileSync(file) });
    }
    // The site's robot server (it passes robohash.org's pictures through) can be
    // down or refuse a burst of requests: then the same picture from robohash.org
    const robohash = /^https:\/\/(www\.)?indiediscotheque\.com\/robots\//.test(url) ? url.replace(/^https:\/\/(www\.)?indiediscotheque\.com\/robots\//, "https://robohash.org/") : null;
    const get = async (u) => { try { return await route.fetch(u ? { url: u } : undefined); } catch (e) { return null; } };
    try {
      let res = await get();
      if (!res || !res.ok()) { await sleep(1500); res = await get(); }
      if ((!res || !res.ok()) && robohash) res = await get(robohash);
      if (!res) return route.abort();
      const body = await res.body();
      const headers = Object.fromEntries(Object.entries(res.headers()).filter(([k]) => !/^(content-length|content-encoding|transfer-encoding|set-cookie)$/i.test(k)));
      if (res.ok() && body.length) {
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(file, body);
        writeFileSync(file + ".json", JSON.stringify({ url, status: res.status(), headers }));
      }
      return route.fulfill({ status: res.status(), headers, body });
    } catch (e) {
      return route.abort();
    }
  });
}
