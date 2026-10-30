// Browser smoke test: serves this site locally under the real
// Content-Security-Policy from .htaccess, points it at a local database
// emulator, and loads it in Chromium. Fails on any page error or anything the
// policy blocks. Run (needs Java 21 for the emulator):
//   cd tests && npm ci && npm run smoke
// Never deployed. CI: .github/workflows/smoke.yml
import http from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname, normalize } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = "http://127.0.0.1:9000", NS = "demo-smoke";
const put = (path, value) => fetch(DB + path + ".json?ns=" + NS, { method: "PUT", headers: { Authorization: "Bearer owner" }, body: JSON.stringify(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The policy the server sends, plus the local emulator. upgrade-insecure-requests
// is dropped: this test runs over plain http on 127.0.0.1.
const htaccess = readFileSync(join(ROOT, ".htaccess"), "utf8");
const CSP = htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/)[1]
  .replace("connect-src ", "connect-src " + DB + " ws://127.0.0.1:9000 ")
  .replace("script-src ", "script-src " + DB + " ")
  .replace(/;\s*upgrade-insecure-requests/, "");

// config.js lives only on the server; this one points at the emulator
const example = readFileSync(join(ROOT, "config.js.example"), "utf8");
const CONFIG = example
  .replace(/firebase:\s*\{[\s\S]*?\}/, `firebase: { apiKey: "fake-key", authDomain: "${NS}.firebaseapp.com", databaseURL: "${DB}?ns=${NS}" }`)
  .replace(/youtubeKey: "[^"]*"/, 'youtubeKey: "no-yt-key"');

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".gif": "image/gif" };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const headers = { "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff" };
  if (path === "/config.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); return res.end(CONFIG); }
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || /[\\/](tests|node_modules|\.git)([\\/]|$)/.test(file.slice(ROOT.length))) { res.writeHead(404); return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const SITE = "http://127.0.0.1:" + server.address().port + "/";

// the room as the bot leaves it: a YouTube song playing, two DJs, a theme
const now = Date.now();
const youtubeSong = { type: 1, cid: "dQw4w9WgXcQ", title: "Smoke Song", artist: "Smoke Artist", started: now, duration: 300, djid: "dj1", djname: "dj1",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", image: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", postedDate: now };
await put("/", {
  users: { dj1: { username: "dj1", status: true }, dj2: { username: "dj2", status: true } },
  table: [{ name: "dj1", id: "dj1", plays: 1 }, { name: "dj2", id: "dj2", plays: 0 }], playdex: 0, playlimit: "∞",
  songToPlay: youtubeSong, theme: "smoke tests", colors: { color: "#cc1c2c", txt: "#fff" }
});

let failures = 0;
const check = (ok, msg) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) failures++; };

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
const browser = await chromium.launch(proxy ? { proxy } : {});
const page = await browser.newPage();
const pageErrors = [], violations = [], requested = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("request", (r) => requested.push(r.url()));
await page.exposeFunction("__cspViolation", (v) => violations.push(v));
await page.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation(e.violatedDirective + " blocked " + e.blockedURI));
});
const loaded = (part) => requested.some((u) => u.includes(part));

try {
  console.log("-- page load (" + SITE + ")");
  await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => /Smoke Song/.test(document.getElementById("track").textContent), null, { timeout: 30000 });
  check(true, "the playing song shows (from the database)");
  check(await page.$eval("#themePillText", (el) => /smoke tests/.test(el.textContent)).catch(() => false), "the theme shows");
  await page.waitForFunction(() => typeof YT !== "undefined" && YT.Player, null, { timeout: 30000 }).catch(() => {});
  check(loaded("/s/player/") || loaded("www-widgetapi"), "YouTube's player API loaded under the policy");
  check(!loaded("pixi.min.js") && !loaded("p5.min.js") && !loaded("TweenMax.min.js"), "the stage effects' libraries aren't loaded with the page");

  console.log("-- a SoundCloud song: the album-art glitch loads p5.js");
  await put("/songToPlay", Object.assign({}, youtubeSong, { type: 2, cid: "13158665", title: "Smoke SC", started: Date.now(),
    url: "https://soundcloud.com/forss/flickermood", image: SITE + "icons/icon-512.png" }));
  await page.waitForFunction(() => document.querySelector("#scScreen canvas"), null, { timeout: 30000 }).catch(() => {});
  check(loaded("p5.min.js"), "p5.js loaded with the first SoundCloud song");
  check(!!(await page.$("#scScreen canvas")), "the glitch canvas is drawn");

  console.log("-- someone sends a 🔥: the fire loads PixiJS and GSAP");
  await page.evaluate(() => window.firetableIgniteFyre(3));
  await page.waitForFunction(() => document.querySelector("#fyre canvas"), null, { timeout: 30000 }).catch(() => {});
  check(loaded("pixi.min.js") && loaded("TweenMax.min.js"), "PixiJS and GSAP loaded with the first fire");
  check(!!(await page.$("#fyre canvas")), "the fire is drawn");
  await page.evaluate(() => window.firetableSetFyreIntensity(0));
  await sleep(1500);
} catch (e) {
  check(false, "smoke test threw: " + e.message);
}

console.log("-- errors");
check(violations.length === 0, "nothing blocked by the Content-Security-Policy" + (violations.length ? ": " + [...new Set(violations)].join("; ") : ""));
check(pageErrors.length === 0, "no page errors" + (pageErrors.length ? ": " + pageErrors.join("; ") : ""));

await browser.close();
server.close();
console.log(failures ? "\n" + failures + " SMOKE CHECK(S) FAILED" : "\nsmoke: all passed");
process.exit(failures ? 1 : 0);
