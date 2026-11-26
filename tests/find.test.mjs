// Discover's song search (js/discover-find.js, tools/song-search.mjs): the
// static files the deploy builds from the bot's song list, a lookup through
// them in the page (served here as the web host serves them), and your
// playlists read once and then only what changed. No emulator needed.
//   cd tests && npm ci && npm run unit
// Never deployed. CI: .github/workflows/smoke.yml
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { chromium } from "playwright";
import { policy, config, serveSite, launchOptions, openPage } from "./harness.mjs";
import { songSearch, finder } from "../tools/song-search.mjs";

const find = finder();
/** build(), as plain objects (it runs in its own context: tools/song-search.mjs) */
const build = (rows, hash) => JSON.parse(JSON.stringify(find.build(rows, hash)));
const ROWS = [
  ["Daft Punk", "One More Time", 1, "dp1", 90],
  ["Röyksopp", "Eple", 1, "ro1", 70],
  ["Simon & Garfunkel", "Cecilia", 1, "sg1", 40],
  ["The xx", "Intro", 1, "xx1", 30],
  ["Daft Punk", "Digital Love", 1, "dp2", 20],
  ["Justice", "D.A.N.C.E.", 2, "123456", 10],
  ["グリフ", "夜", 1, "jp1", 5]
];

test("words: folded, without accents or apostrophes; file keys: letters as they are, anything else by its code", () => {
  assert.deepEqual([...find.words("Röyksopp's Night Out — LIVE")], ["royksopps", "night", "out", "live"]);
  assert.deepEqual([...find.words("Simon & Garfunkel")], ["simon", "and", "garfunkel"]);
  assert.deepEqual([...find.words("D.A.N.C.E. by M.I.A, a.k.a. 1.2.3")], ["dance", "by", "mia", "aka", "123"], "initials are one word");
  assert.equal(find.keyOf("daft", 2), "da");
  assert.equal(find.keyOf("グリフ", 2), "_30b0_30ea");
});

test("build: a file for each word start, most played first; the common words choose no file", () => {
  const b = build(ROWS, "abc");
  assert.deepEqual(b.index, { v: 1, hash: "abc", songs: ROWS.length, split: [] });
  assert.deepEqual(b.files.da.map((r) => r[3]), ["dp1", "dp2", "123456"], "daft, digital and dance all start da");
  assert.deepEqual(b.files.ro.map((r) => r[3]), ["ro1"], "Röyksopp under ro");
  assert.ok(!b.files.th, "\"the\" alone files nothing");
  assert.deepEqual(b.files.xx.map((r) => r[3]), ["xx1"]);
});

test("build: a crowded word start keeps its most played and splits by one more letter, as deep as it needs", () => {
  const many = Array.from({ length: find.SHARD_MAX + 300 }, (_, i) => ["", (i % 2 ? "Love " : "Lost ") + i, 1, "c" + i, 10000 - i]);
  const b = build(many, "h");
  assert.deepEqual([...b.index.split], ["lo"]);
  assert.equal(b.files.lo.length, find.SHARD_MAX, "lo keeps the most played");
  assert.equal(b.files.lo[0][3], "c0");
  assert.equal(b.files.lov.length + b.files.los.length, many.length, "lov and los hold every one");
  const split = { lo: true };
  assert.equal(find.fileFor("love", split), "lov");
  assert.equal(find.fileFor("lo", split), "lo", "two letters: the crowded file, most played");
  assert.equal(find.fileFor("daft", split), "da");
});

test("songSearch: reads the database only when the songs changed; the files keep one time so an unchanged index uploads nothing", async () => {
  const out = mkdtempSync(join(tmpdir(), "find-"));
  try {
    const meta = { songs: ROWS.length, songsHash: "0123456789abcdef" };
    let reads = 0;
    const read = async (p) => { reads++; assert.equal(p, "discover/lib/songs/0"); return ROWS; };
    const first = await songSearch({ meta, read, getText: async () => null, site: "https://x/", out, log: () => {} });
    assert.equal(first.from, "the database");
    assert.equal(reads, 1);
    const dir = join(out, "find");
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    assert.equal(index.hash, meta.songsHash);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "w-da.json"), "utf8")).map((r) => r[3]), ["dp1", "dp2", "123456"]);
    const times = new Set(readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs));
    assert.equal(times.size, 1, "every file has the index's time");
    // the next deploy: the live site has the same songs
    const live = readFileSync(join(dir, "songs.json"), "utf8");
    const was = [...times][0];
    const again = await songSearch({ meta, read, getText: async (url) => (/music\/find\/songs\.json\?v=0123456789abcdef$/.test(url) ? live : null), site: "https://x/", out, log: () => {} });
    assert.equal(again.from, "the live site (unchanged)");
    assert.equal(reads, 1, "no database read");
    assert.equal(statSync(join(dir, "w-da.json")).mtimeMs, was, "same time as before");
    // new songs: the database again
    const next = await songSearch({ meta: { songs: ROWS.length, songsHash: "fedcba9876543210" }, read, getText: async () => live, site: "https://x/", out, log: () => {} });
    assert.equal(next.from, "the database");
    assert.equal(reads, 2);
    assert.equal(await songSearch({ meta: {}, read, getText: async () => null, site: "https://x/", out, log: () => {} }), null, "nothing published yet: no files");
    await assert.rejects(songSearch({ meta: { songs: 99, songsHash: "1111111111111111" }, read, getText: async () => null, site: "https://x/", out, log: () => {} }), /read 7 songs, meta says 99/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ─── In the page ─────────────────────────────────────────────────────────

let browser, page, server;
const built = build(ROWS, "0123456789abcdef");
const served = [];

before(async () => {
  const site = await serveSite({ csp: policy(), configJs: config("demo-find") });
  server = site.server;
  browser = await chromium.launch(launchOptions());
  page = await (await browser.newContext()).newPage();
  // the web host's music/find/, as the deploy builds it
  await page.route(/\/music\/find\//, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    served.push(name);
    const body = name === "index.json" ? built.index : built.files[name.replace(/^w-|\.json$/g, "")];
    return body ? route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : route.fulfill({ status: 404, body: "" });
  });
  await openPage(page, site.SITE);
  await page.waitForFunction(() => window.firetable && firetable.started, null, { timeout: 30000 });
  await page.evaluate(() => ftLazy.own("find-js", "js/discover-find.js"));
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** A finder with stand-in helpers: rows come back as "list:cid:lists" so the tests can read them. */
const setup = () => page.evaluate(() => {
  window.__find = { changed: 0, lists: {} };
  window.__finder = firetable.discoverFind({
    esc: firetable.utilities.htmlEscape, ms: (n) => n, head: (t) => "<h3>" + t + "</h3>", emptyNote: (t) => "<p>" + t + "</p>", loading: () => "<i>loading</i>",
    row: (t, list, i, meta) => "[" + list + ":" + t.cid + (meta.right ? ":" + meta.right.replace(/<[^>]+>/g, "") : "") + "]",
    djShown: () => null, setList: (name, label, tracks) => { window.__find.lists[name] = tracks; },
    signedIn: () => !!ftapi.uid, loaded: () => [{ type: 1, cid: "nr1", a: "Daft Punk", t: "Brand New" }],
    changed: () => { window.__find.changed++; }
  });
});
const sections = (q) => page.evaluate((query) => window.__finder.sections(query), q);
/** sections(q) once nothing is loading. */
const settled = async (q) => {
  for (let i = 0; i < 50; i++) {
    const s = await sections(q);
    if (!s.pending) return s;
    await page.waitForTimeout(50);
  }
  throw new Error("still loading: " + q);
};

test("the library: one small file for the longest word; every word typed starts a word of the song; best match first", async () => {
  await setup();
  served.length = 0;
  const first = await sections("daft one");
  assert.ok(first.pending, "loading at first");
  const s = await settled("daft one");
  assert.match(s.html, /\[search:dp1:90 plays\]/);
  assert.doesNotMatch(s.html, /dp2/, "Digital Love has no word starting \"one\"");
  assert.deepEqual(served, ["index.json", "w-da.json"], "the index and one word's file, nothing else");
  const dance = await settled("dance");
  assert.match(dance.html, /\[search:123456:10 plays\]/, "D.A.N.C.E. is found as dance");
  const punk = await settled("daft punk");
  assert.match(punk.html, /\[search:dp1:90 plays\]\[search:dp2:20 plays\]\[search:nr1\]/, "most played first, then songs loaded on pages opened this visit");
  const royk = await settled("royksopp");
  assert.match(royk.html, /\[search:ro1:/, "found without its accent");
  const gone = await settled("zzqq");
  assert.equal(gone.found, 0, "a word start with no file: nothing, and no error");
});

test("your playlists: read once, then only the keys and what's new; the open list is never read", async () => {
  await setup();
  const r = await page.evaluate(async () => {
    const was = { uid: ftapi.uid, db: ftapi.db, shallow: ftapi.utilities.shallowKeys, names: ftapi.lookup.listNames, queue: firetable.queue, open: firetable._queueList, all: firetable.allPlaylists };
    const data = {
      "queues/u1": { k1: { type: 1, cid: "dp1", name: "Daft Punk - One More Time" } },
      "playlists/u1/p1/list": { k2: { type: 1, cid: "sg1", name: "Simon & Garfunkel - Cecilia" }, k3: { type: 1, cid: "dp1", name: "Daft Punk - One More Time" } },
      "playlists/u1/p2/list": { k4: { type: 1, cid: "zz9", name: "Never Read - Open List" } }
    };
    const reads = [], shallows = [];
    try {
      localStorage.removeItem("ft-find-lists-u1");
      ftapi.uid = "u1";
      firetable.allPlaylists = { p1: { name: "Friday set" }, p2: { name: "Open one" } };
      firetable.queue = { k9: { type: 1, cid: "op1", name: "Daft Punk - Open Track" } };
      firetable._queueList = "p2";
      ftapi.db = () => ({ ref: (path) => ({ once: () => { reads.push(path); const parts = path.split("/"); const v = path in data ? data[path] : (data[parts.slice(0, -1).join("/")] || {})[parts[parts.length - 1]]; return Promise.resolve({ val: () => (v === undefined ? null : v) }); } }) });
      ftapi.utilities.shallowKeys = (path) => { shallows.push(path); return Promise.resolve(Object.fromEntries(Object.keys(data[path] || {}).map((k) => [k, true]))); };
      const settle = async (q) => { for (let i = 0; i < 50; i++) { const s = window.__finder.sections(q); if (!s.pending) return s; await new Promise((ok) => setTimeout(ok, 30)); } throw new Error("still loading"); };
      const first = await settle("daft");
      const firstReads = reads.slice();
      const second = await settle("cecilia");
      const readsAfterSecond = reads.length;
      // half an hour on: only the keys, and the one new track
      const cache = JSON.parse(localStorage.getItem("ft-find-lists-u1"));
      cache.checked -= 31 * 60 * 1000;
      localStorage.setItem("ft-find-lists-u1", JSON.stringify(cache));
      data["playlists/u1/p1/list"].k5 = { type: 1, cid: "dp2", name: "Daft Punk - Digital Love" };
      delete data["playlists/u1/p1/list"].k2;
      fresh();
      reads.length = 0;
      const third = await settle("daft");
      return { first: first.html, firstReads, second: second.html, readsAfterSecond, third: third.html, thirdReads: reads.slice(), shallows, mine: window.__find.lists["search-mine"].map((t) => t.cid + ":" + t.lists.join("|")) };
    } finally {
      ftapi.uid = was.uid; ftapi.db = was.db; ftapi.utilities.shallowKeys = was.shallow; ftapi.lookup.listNames = was.names;
      firetable.queue = was.queue; firetable._queueList = was.open; firetable.allPlaylists = was.all;
      localStorage.removeItem("ft-find-lists-u1");
    }
    /** A new finder that starts from the copy in storage, as a later visit would. */
    function fresh() {
      window.__finder = firetable.discoverFind({
        esc: firetable.utilities.htmlEscape, ms: (n) => n, head: (t) => "<h3>" + t + "</h3>", emptyNote: (t) => "<p>" + t + "</p>", loading: () => "<i>loading</i>",
        row: (t, list, i, meta) => "[" + list + ":" + t.cid + (meta.right ? ":" + meta.right.replace(/<[^>]+>/g, "") : "") + "]",
        djShown: () => null, setList: (name, label, tracks) => { window.__find.lists[name] = tracks; },
        signedIn: () => !!ftapi.uid, loaded: () => [], changed: () => {}
      });
    }
  });
  assert.match(r.first, /In your playlists/);
  assert.match(r.first, /\[search-mine:dp1:Default Playlist \+1\]/, "a song in two lists says so");
  assert.match(r.first, /\[search-mine:op1:Open one\]/, "the open list, as it is now");
  assert.deepEqual(r.firstReads.sort(), ["playlists/u1/p1/list", "queues/u1"], "each list read once, in full; the open one not at all");
  assert.match(r.second, /\[search-mine:sg1:Friday set\]/);
  assert.equal(r.readsAfterSecond, r.firstReads.length, "the next search reads nothing");
  assert.deepEqual(r.thirdReads, ["playlists/u1/p1/list/k5"], "later: only the track added since");
  assert.deepEqual(r.shallows.sort(), ["playlists/u1/p1/list", "queues/u1"]);
  assert.ok(r.mine.includes("dp2:Friday set") && !r.mine.some((m) => m.startsWith("sg1")), "added and removed tracks: " + r.mine.join(", "));
});
