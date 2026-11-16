// Screenshot harness (redesign step 0.2, docs/redesign/04-step-plan.md): the
// same pictures of the site before and after every redesign step. Serves the
// site under its real Content-Security-Policy against the local Firebase
// emulators, signs in real accounts, and photographs each view as four people
// at four widths. Never deployed.
//
// Run (Java 21 for the emulators):
//   cd tests && npm ci && npm run screens
// In a Claude cloud session, start the emulators without the proxy first, then:
//   NO_PROXY="localhost,127.0.0.1,::1" node screens.mjs
// (01-ground-rules.md, "Run the checks").
//
// Pictures go to tests/screens/<git short sha>/<role>-<width>-<view>.png, with
// an index.html contact sheet. Narrow a run, or compare with an earlier one:
//   ROLES=visitor,member  WIDTHS=390,1440  VIEWS=d-home,live-*  BASE=<earlier sha>
// With BASE, the sheet puts the earlier picture beside each changed one, with
// the share of pixels that changed and a diff picture (in diff/). Clocks and
// the times in chat and Recent are masked and the YouTube frame is hidden, so
// two runs of the same code match; SHOW_VIDEO=1 keeps the frame.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, relative, sep } from "path";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { chromium } from "playwright";
import { ROOT, policy, config, putAs, serveSite, launchOptions, sleep, authAccount, useAuthEmulator, logInAs } from "./harness.mjs";
import { DAY, youtubeSong, room, discover, library } from "./seed.mjs";

const NS = "demo-screens";
const put = putAs(NS);
const PASSWORD = "screens-pass-1";
const list = (v, all) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : all);
const SHA = (() => { try { return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch (e) { return "local"; } })();
const OUT = process.env.OUT || join(ROOT, "tests", "screens", SHA);
const BASE = process.env.BASE ? join(ROOT, "tests", "screens", process.env.BASE) : null;
const ROLES = list(process.env.ROLES, ["visitor", "member", "dj", "mod"]);
const WIDTHS = list(process.env.WIDTHS, ["390", "1024", "1440", "1920"]).map(Number);
const VIEW_FILTER = list(process.env.VIEWS, null);
const SIZES = { 390: { width: 390, height: 844 }, 1024: { width: 1024, height: 768 }, 1440: { width: 1440, height: 900 }, 1920: { width: 1920, height: 1080 } };

// what changes on its own between two runs: clocks, progress and the times in chat and
// Recent are masked; the
// video is hidden for the picture (a mask would cover whatever stands in front of it)
const MASK = "#timr, #timrUp, #prgbar, .pb-time, .pb-line, #pv-fat, #pv-flen, #pv-fseek, .chatTime, .hist-timestamp:not(.d-rank), .histtime";
// the DJs bob to the beat from the song's start: hold them still for the picture
const HIDE = ".avtr, .avtr *, .ft-avatar, #deck *, #ondeck * { animation: none !important; transition: none !important; }" +
  (process.env.SHOW_VIDEO ? "" : " #playerArea iframe, #pvOverPlayer iframe, #sc-widget { visibility: hidden !important; }");

// real YouTube videos, so covers load (the titles are made up)
const VIDS = ["kJQP7kiw5Fk", "9bZkp7q19f0", "JGwWNGJdvx8", "fJ9rUzIMcZQ", "OPf0YbXqDm0", "hTWKbfoikeg", "YQHsXMglC9A", "RgKAFK5djSk", "CevxZvSJLk8", "60ItHLz5WEA"];
const art = (cid) => "https://i.ytimg.com/vi/" + cid + "/mqdefault.jpg";

// ── the people ──────────────────────────────────────────────────────────────
const now = Date.now();
const people = {
  member: { email: "mira@screens.test", name: "mira" },
  dj: { email: "rook@screens.test", name: "rook" },
  mod: { email: "modsy@screens.test", name: "modsy", mod: true }
};
for (const p of Object.values(people)) p.uid = await authAccount(p.email, PASSWORD);

// ── the room: smoke.mjs's (seed.mjs), plus people, playlists, history, chat ──
const song = youtubeSong(now);
const base = room(now, song);
const users = Object.assign({}, base.users, {
  bot: { username: "hostbot", hostbot: true, status: true },
  scytheria: { username: "scytheria", status: true }, matt: { username: "matt", status: true },
  wl1: { username: "wl1", status: true }, wl2: { username: "wl2", status: true }
});
const nameClaim = { dj1: "dj1", dj2: "dj2", bot: "hostbot", scytheria: "scytheria", matt: "matt" };
for (const p of Object.values(people)) {
  users[p.uid] = Object.assign({ username: p.name, status: true }, p.mod ? { mod: true } : {});
  nameClaim[p.name] = p.uid;
}
const tracks = ["Glider - Night Drive", "Röyksopp - Me & Youphoria", "Romain Muller - Dernière", "Supertaste - Closer to the Ground",
  "Poolside - Harvest Moon", "Breakbot - Baby I'm Yours (Remix)", "Kraak & Smaak - Squeeze Me", "Satin Jackets - You Make Me Feel Good"];
const queue = () => Object.fromEntries(tracks.map((name, i) => ["q" + i, Object.assign({ type: 1, cid: VIDS[i % VIDS.length], name },
  i === 5 ? { flagged: { date: now - DAY, code: 1 } } : {})]));
const playlists = { p1: { name: "Nu-disco keepers", list: { a: { type: 1, cid: VIDS[8], name: "Kartell - Riviera" }, b: { type: 1, cid: VIDS[9], name: "Moods - Wildflower" } } }, p2: { name: "Theme: Italo" } };
// Recent groups plays by the hour: the history starts at 8 pm (yesterday's, before 9 pm)
// so the groups are the same whenever the pictures are taken
const evening = new Date(now);
evening.setHours(20, 0, 0, 0);
if (evening.getTime() > now - 3600000) evening.setDate(evening.getDate() - 1);
const history = Object.fromEntries(tracks.slice(0, 6).map((name, i) => {
  const [artist, title] = name.split(" - ");
  return ["h" + i, { type: 1, cid: VIDS[i], artist, title, dj: i % 2 ? "dj2" : "dj1", djid: i % 2 ? "dj2" : "dj1", when: evening.getTime() + (6 - i) * 6 * 60000, img: art(VIDS[i]) }];
}));
const fresh = Object.fromEntries(tracks.slice(2, 6).map((name, i) => {
  const [artist, title] = name.split(" - ");
  return ["f" + i, { artist, title, dj: "dj1", djid: "dj1", type: 1, cid: VIDS[i + 2], when: evening.getTime() - i * 3600000, url: "https://www.youtube.com/watch?v=" + VIDS[i + 2], img: art(VIDS[i + 2]) }];
}));
const chatLines = [["dj1", "dj1", "evening all"], ["scytheria", "scytheria", "this one is a banger"], ["bot", "hostbot", "dj1 started playing Smoke Song by Smoke Artist"],
  ["matt", "matt", "🔥🔥"], ["dj2", "dj2", "next up something italo"]];
const chatData = {}, chatFeed = {};
chatLines.forEach(([id, name, txt], i) => {
  chatData["c" + i] = { id, name, txt, time: now - (chatLines.length - i) * 60000, feedID: "f" + i };
  chatFeed["f" + i] = { chatID: "c" + i };
});
const cards = {};
Object.values(people).forEach((p, i) => [0, 1, 2].forEach((n) => {
  cards["card" + i + n] = { owner: p.uid, cardnum: i * 3 + n + 1, djname: "dj1", djid: "dj1", title: tracks[n].split(" - ")[1], artist: tracks[n].split(" - ")[0], image: art(VIDS[n]), date: now - n * DAY, set: "set1" };
}));

// smoke.mjs's Discover songs have made-up ids: give them real ones here so their covers load
function withArt(data) {
  const ids = {};
  const real = (fake) => (ids[fake] = ids[fake] || VIDS[Object.keys(ids).length % VIDS.length]);
  return JSON.parse(JSON.stringify(data).replace(/"(1_)?((?:newrel|chart|night|long|hot|lib)\d+)"/g, (m, pre, fake) => '"' + (pre || "") + real(fake) + '"'));
}

// the room's song, started just now (a run takes longer than the five-minute song)
const playing = (over) => {
  const at = Date.now();
  return { songToPlay: Object.assign({}, song, { started: at, postedDate: at }, over), songBpm: { started: at, bpm: 118, src: "deezer" } };
};
const decks = {
  // as most visits find it: two DJs, nobody waiting
  normal: () => Object.assign({ table: base.table, waitlist: null, playdex: 0 }, playing()),
  // the DJ role's own song on: they're on deck and playing
  mine: (p) => Object.assign({ table: [{ name: p.name, id: p.uid, plays: 1 }, { name: "dj1", id: "dj1", plays: 2 }, { name: "dj2", id: "dj2", plays: 0 }],
    waitlist: null, playdex: 0 }, playing({ djid: p.uid, djname: p.name })),
  empty: () => ({ table: null, waitlist: null, songToPlay: null, playdex: 0 }),
  // four DJs and two waiting (the song stays as it is)
  full: () => ({ table: [{ name: "dj1", id: "dj1", plays: 2 }, { name: "dj2", id: "dj2", plays: 1 }, { name: "scytheria", id: "scytheria", plays: 1 }, { name: "matt", id: "matt", plays: 0 }],
    waitlist: [{ name: "wl1", id: "wl1", plays: 0 }, { name: "wl2", id: "wl2", plays: 0 }], playdex: 0 })
};
const setDecks = async (d) => { for (const [k, v] of Object.entries(d)) await put("/" + k, v); };

await put("/", Object.assign({}, base, {
  users, nameClaim, cards, chatData, chatFeed, songHistory: history, newMusic: fresh,
  queues: Object.fromEntries(Object.values(people).map((p) => [p.uid, queue()])),
  playlists: Object.fromEntries(Object.values(people).map((p) => [p.uid, playlists])),
  tagUpdate: { cid: song.cid, adamData: { track_name: song.title, artist: song.artist, playcount: 67 } },
  discover: withArt(Object.assign(discover(now), { lib: library(now) }))
}));

// ── the views ───────────────────────────────────────────────────────────────
const liveTab = (id) => async (page) => {
  await go(page, "#live");
  await page.evaluate((t) => firetable.nav.setMobileTab(t), id);
};
const hash = (h) => async (page) => go(page, h);
async function go(page, h) {
  if (await page.evaluate(() => location.hash) !== h) await page.evaluate((x) => { location.hash = x; }, h);
}
const VIEWS = [
  // Live, under the stage and beside it (at 1024 and up chat and people are always there)
  { name: "live-playlists", run: liveTab("mm-playlists") },
  { name: "live-recent", run: liveTab("mm-history") },
  { name: "live-fresh", run: liveTab("mm-discover") },
  { name: "live-cards", run: liveTab("mm-cards") },
  { name: "live-chat", run: liveTab("mmchat"), maxWidth: 1023 },
  { name: "live-people", run: liveTab("mmusrs"), maxWidth: 1023 },
  // Discover
  { name: "d-home", run: hash("#discover") },
  { name: "d-new", run: hash("#discover/new") },
  { name: "d-charts", run: hash("#discover/charts") },
  { name: "d-genres", run: hash("#discover/genres") },
  { name: "d-genre", run: hash("#discover/genres/nu-disco") },
  { name: "d-djs", run: hash("#discover/djs") },
  { name: "d-dj", run: hash("#discover/djs/dj1") },
  { name: "d-years", run: hash("#discover/years") },
  { name: "d-recent", run: hash("#discover/recent") },
  // the player: the room in full screen, a Discover song in the bar, that song carried into Live
  { name: "full-room", run: async (page) => { await go(page, "#discover"); await page.evaluate(() => firetable.discover.openFull()); },
    after: (role, page) => page.evaluate(() => firetable.discover.closeFull()) },
  { name: "d-playing", run: async (page) => {
    await go(page, "#discover");
    await page.evaluate(() => { firetable.discover.onFailed = () => {}; document.querySelector("#dBrowse .ft-cards .pvbar .d-play").click(); });
  } },
  { name: "live-notlive", run: (page) => go(page, "#live"),
    after: (role, page) => page.evaluate(() => { const b = document.querySelector("#st-notlive .st-nl-go"); if (b) b.click(); }) },
  // the stage's states, last: changing the decks adds lines to the chat
  { name: "stage-waitlist", run: async (page) => { await liveTab("mm-playlists")(page); await setDecks(decks.full()); } },
  { name: "stage-empty", run: async (page) => { await liveTab("mm-playlists")(page); await setDecks(decks.empty()); } }
].filter((v) => !VIEW_FILTER || VIEW_FILTER.some((f) => (f.endsWith("*") ? v.name.startsWith(f.slice(0, -1)) : v.name === f)));
const roleDecks = (role) => (role === "dj" ? decks.mine(people.dj) : decks.normal());

// Pictures from other sites (avatars, covers) come from a disk cache after the first
// run: the same bytes every time, and nothing left loading when a picture is taken
const CACHE = join(ROOT, "tests", "screens", ".cache");
const CACHED = /^https:\/\/((www\.)?indiediscotheque\.com\/robots\/|api\.dicebear\.com\/|i\.ytimg\.com\/|img\.youtube\.com\/|i\d*\.sndcdn\.com\/)/;
async function cachedPicture(route) {
  const url = route.request().url();
  const file = join(CACHE, createHash("sha1").update(url).digest("hex"));
  if (existsSync(file + ".json")) {
    const m = JSON.parse(readFileSync(file + ".json", "utf8"));
    return route.fulfill({ status: m.status, headers: m.headers, body: readFileSync(file) });
  }
  try {
    const res = await route.fetch();
    const body = await res.body();
    const headers = Object.fromEntries(Object.entries(res.headers()).filter(([k]) => !/^(content-length|content-encoding|transfer-encoding|set-cookie)$/i.test(k)));
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, body);
    writeFileSync(file + ".json", JSON.stringify({ url, status: res.status(), headers }));
    return route.fulfill({ status: res.status(), headers, body });
  } catch (e) {
    return route.abort();
  }
}

/**
 * Wait for the page to settle: fonts, the images on screen, every avatar and
 * cover the page asked for (cards draw theirs onto a canvas), a moment for fades.
 */
async function settle(page, inflight) {
  await sleep(700);
  await page.evaluate(async () => {
    await document.fonts.ready;
    // <img>s on screen, and the background pictures (avatars, covers) of what's on screen
    const shown = [...document.images].filter((i) => i.offsetParent !== null && !i.complete)
      .map((i) => new Promise((r) => { i.addEventListener("load", r); i.addEventListener("error", r); }));
    const urls = new Set();
    for (const el of document.querySelectorAll("body *")) {
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const m = getComputedStyle(el).backgroundImage.match(/url\("?([^")]+)"?\)/);
      if (m && /^https?:/.test(m[1])) urls.add(m[1]);
    }
    const bgs = [...urls].map((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; }));
    await Promise.race([Promise.all(shown.concat(bgs)), new Promise((r) => setTimeout(r, 8000))]);
  });
  for (let quiet = 0, t = 0; quiet < 2 && t < 40; t++) {
    await sleep(200);
    quiet = inflight.size ? 0 : quiet + 1;
  }
  await sleep(300);
}

// ── run ─────────────────────────────────────────────────────────────────────
const configJs = config(NS).replace(/roomName:/, "discover: true, roomName:");
const { server, SITE } = await serveSite({ csp: policy({ auth: true }), configJs });
const browser = await chromium.launch(Object.assign(launchOptions(), { args: ["--autoplay-policy=no-user-gesture-required"] }));
mkdirSync(OUT, { recursive: true });
const shots = [], problems = [];
console.log("screens → " + OUT);
try {
  for (const role of ROLES) {
    for (const w of WIDTHS) {
      await setDecks(roleDecks(role));
      const phone = w < 640;
      const context = await browser.newContext({ viewport: SIZES[w] || { width: w, height: 900 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
      await context.route(CACHED, cachedPicture);
      const page = await context.newPage();
      const inflight = new Set();
      page.on("request", (r) => { if (CACHED.test(r.url())) inflight.add(r); });
      page.on("requestfinished", (r) => inflight.delete(r));
      page.on("requestfailed", (r) => inflight.delete(r));
      page.on("pageerror", (e) => problems.push(role + " " + w + ": " + e.message));
      await useAuthEmulator(page);
      await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
      if (role === "visitor") await page.waitForFunction(() => document.querySelectorAll("#dBrowse .ft-cards .pvbar").length > 0, null, { timeout: 30000 });
      else {
        const p = people[role];
        await logInAs(page, p.email, PASSWORD, p.uid);
        await page.waitForFunction(() => ftapi.users && Object.keys(ftapi.users).length > 3, null, { timeout: 15000 }).catch(() => {});
      }
      for (const v of VIEWS) {
        if (v.maxWidth && w > v.maxWidth) continue;
        const file = role + "-" + w + "-" + v.name + ".png";
        try {
          await v.run(page, role);
          await page.mouse.move(SIZES[w] ? SIZES[w].width - 1 : 1, 1);
          await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
          await settle(page, inflight);
          // mask only what's in sight: a mask is drawn on top of everything, even over
          // a clock hidden under the full-screen player
          await page.evaluate((sel) => {
            for (const el of document.querySelectorAll(sel)) {
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
              const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
              if (top && (el === top || el.contains(top) || top.contains(el))) el.setAttribute("data-screens-mask", "");
            }
          }, MASK);
          await page.screenshot({ path: join(OUT, file), animations: "disabled", caret: "hide", mask: [page.locator("[data-screens-mask]")], maskColor: "#2a2a2a", style: HIDE });
          await page.evaluate(() => document.querySelectorAll("[data-screens-mask]").forEach((el) => el.removeAttribute("data-screens-mask")));
          shots.push({ role, w, view: v.name, file });
          process.stdout.write(".");
        } catch (e) {
          problems.push(file + ": " + e.message.split("\n")[0]);
          process.stdout.write("x");
        }
        if (v.after) await v.after(role, page).catch(() => {});
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log("\n" + shots.length + " pictures");

// ── compare with an earlier run, and the contact sheet ──────────────────────
/**
 * How much of a picture changed: decoded and compared in the browser (no image
 * library needed). Writes a diff picture: changed pixels red over the new
 * picture, faded.
 */
async function diffPictures(page, before, after, out) {
  if (readFileSync(before).equals(readFileSync(after))) return 0;
  const url = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
  const r = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { share: 1 };
    const c = document.createElement("canvas");
    c.width = ib.width; c.height = ib.height;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    const img = x.createImageData(c.width, c.height), o = img.data;
    let n = 0;
    for (let i = 0; i < db.length; i += 4) {
      // a little slack for antialiasing
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) { n++; o[i] = 255; o[i + 1] = 48; o[i + 2] = 48; }
      else o[i] = o[i + 1] = o[i + 2] = (db[i] * 0.3 + db[i + 1] * 0.59 + db[i + 2] * 0.11) * 0.35;
      o[i + 3] = 255;
    }
    if (!n) return { share: 0 };
    x.putImageData(img, 0, 0);
    return { share: n / (db.length / 4), png: c.toDataURL("image/png").split(",")[1] };
  }, [url(before), url(after)]);
  if (r.png) writeFileSync(out, Buffer.from(r.png, "base64"));
  return r.share;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x >= 0.001 ? (x * 100).toFixed(1) : (x * 100).toFixed(3)) + "%";
let changed = 0;
if (BASE) {
  mkdirSync(join(OUT, "diff"), { recursive: true });
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 200, height: 200 } })).newPage();
  for (const s of shots) {
    const before = join(BASE, s.file);
    if (!existsSync(before)) { s.cmp = "new"; changed++; continue; }
    s.share = await diffPictures(page, before, join(OUT, s.file), join(OUT, "diff", s.file));
    s.cmp = s.share ? "changed" : "same";
    if (s.share) changed++;
  }
  await b.close();
}
const toBase = BASE ? relative(OUT, BASE).split(sep).join("/") + "/" : "";
const views = [...new Set(shots.map((s) => s.view))];
const sections = views.map((view) => {
  const rows = ROLES.map((role) => "<tr><th>" + esc(role) + "</th>" + WIDTHS.map((w) => {
    const s = shots.find((x) => x.view === view && x.role === role && x.w === w);
    if (!s) return "<td></td>";
    const img = (src, label) => '<a href="' + esc(src) + '"><img loading="lazy" src="' + esc(src) + '" alt="' + esc(label) + '"></a>';
    return '<td class="' + (s.cmp || "") + '">' +
      (s.cmp === "changed" ? '<div class="pair">' + img(toBase + s.file, "before: " + s.file) + img(s.file, "after: " + s.file) + "</div>" : img(s.file, s.file)) +
      (s.cmp === "changed" ? '<span class="tag">' + pct(s.share) + ' changed · <a href="diff/' + esc(s.file) + '">diff</a></span>' : s.cmp ? '<span class="tag">' + s.cmp + "</span>" : "") +
      "</td>";
  }).join("") + "</tr>").join("");
  const any = BASE && shots.some((x) => x.view === view && x.cmp !== "same");
  return '<h2 id="' + esc(view) + '">' + esc(view) + (any ? " ●" : "") + "</h2><table><tr><th></th>" + WIDTHS.map((w) => "<th>" + w + "</th>").join("") + "</tr>" + rows + "</table>";
}).join("");
writeFileSync(join(OUT, "index.html"), "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>Screens " + esc(SHA) + "</title><style>" +
  "body{font:14px system-ui,sans-serif;background:#181818;color:#ddd;margin:16px}a{color:#cc9933}table{border-collapse:collapse;margin-bottom:24px}" +
  "td,th{border:1px solid #333;padding:6px;vertical-align:top;text-align:left}img{max-width:220px;max-height:180px;display:block;margin-bottom:4px}" +
  ".pair{display:flex;gap:4px}.pair img{max-width:150px}td.changed{outline:2px solid #e5534b}td.new{outline:2px solid #cc9933}" +
  ".tag{font-size:12px;color:#aaa}nav a{margin-right:10px;white-space:nowrap}h2{font-size:16px}</style>" +
  "<h1>Screens at " + esc(SHA) + (BASE ? " against " + esc(process.env.BASE) + " · " + changed + " of " + shots.length + " changed or new" : "") + "</h1>" +
  "<nav>" + views.map((v) => '<a href="#' + esc(v) + '">' + esc(v) + "</a>").join(" ") + "</nav>" + sections);
console.log("contact sheet: " + join(OUT, "index.html") + (BASE ? " (" + changed + " of " + shots.length + " changed or new against " + process.env.BASE + ")" : ""));
if (problems.length) {
  console.log("\n" + problems.length + " problem(s):\n  " + [...new Set(problems)].join("\n  "));
  process.exitCode = 1;
}
