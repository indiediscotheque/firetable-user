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
const context = await browser.newContext();
await context.grantPermissions(["notifications"], { origin: SITE.slice(0, -1) });
const page = await context.newPage();
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

  console.log("-- sign in: Create account and Log in as tabs, checks as you type");
  const auth = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shown = () => ["createscreen", "logscreen", "resetscreen"].filter((id) => !document.getElementById(id).hidden).join();
    const out = { first: shown(), tab: document.querySelector("#authTabs .tab.on").textContent };
    document.getElementById("createAccountBttn").click();
    out.emptyErrors = [...document.querySelectorAll("#createscreen [aria-invalid=true]")].map((e) => e.id).join();
    const name = document.getElementById("newusername");
    name.value = "bad name"; name.dispatchEvent(new Event("input", { bubbles: true }));
    out.badName = document.getElementById("newusernameNote").getAttribute("data-state") + ":" + document.getElementById("newusernameNote").textContent;
    name.value = "freshname"; name.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(1200);
    out.freeName = document.getElementById("newusernameNote").textContent;
    document.getElementById("newemail").value = "a@b.co";
    document.getElementById("newpass").value = "secret1";
    document.getElementById("createAccountBttn").click();
    out.terms = document.querySelector("#createAccountFormShell .formMessage").textContent;
    const eye = document.querySelector("#createscreen .showPass");
    eye.click();
    out.showPass = document.getElementById("newpass").type + "," + eye.getAttribute("aria-pressed");
    eye.click();
    document.getElementById("loginlink").click();
    out.login = shown();
    document.getElementById("loginemail").value = "me@x.co";
    document.getElementById("resetpass").click();
    out.reset = shown() + "," + document.getElementById("theAddress").value + "," + getComputedStyle(document.getElementById("authTabs")).display;
    document.querySelector('#resetscreen [data-auth="login"]').click();
    out.back = shown();
    document.getElementById("signuplink").click();
    return out;
  });
  check(auth.first === "createscreen" && /create/i.test(auth.tab), "a new visitor sees Create account first (" + auth.first + ")");
  check(auth.emptyErrors === "newemail,newusername,newpass", "an empty form marks each field (" + auth.emptyErrors + ")");
  check(/^bad:/.test(auth.badName) && /freshname is free/.test(auth.freeName), "the username is checked as you type (" + auth.badName + " / " + auth.freeName + ")");
  check(/Tick the box/.test(auth.terms), "the terms box is asked for (" + auth.terms + ")");
  check(auth.showPass === "text,true", "the password can be shown (" + auth.showPass + ")");
  check(auth.login === "logscreen" && auth.reset === "resetscreen,me@x.co,none" && auth.back === "logscreen",
    "Log in, Forgot your password (email carried over), and back (" + [auth.login, auth.reset, auth.back].join(" / ") + ")");
  await page.waitForFunction(() => typeof YT !== "undefined" && YT.Player, null, { timeout: 30000 }).catch(() => {});
  check(loaded("/s/player/") || loaded("www-widgetapi"), "YouTube's player API loaded under the policy");

  console.log("-- Settings: previews play over the room");
  await page.waitForFunction(() => firetable.ytLoaded, null, { timeout: 30000 }).catch(() => {});
  const over = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!firetable.ytLoaded) return { skipped: true };
    const toggle = document.getElementById("previewOverToggle");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    localStorage.setItem(STORAGE.volume, "60");
    localStorage.removeItem(STORAGE.mute);
    // what the room's player is told (its own report of the volume lags)
    const set = [];
    const realSet = player.setVolume.bind(player);
    player.setVolume = (v) => { set.push(v); return realSet(v); };
    firetable.actions.pview("ytcidM7lc1UVf-VE", true, MEDIA_YOUTUBE);
    // as it starts (where YouTube can't play here, the preview stops itself on its error)
    const during = { preview: firetable.preview, active: firetable.overlayPreview.active(), roomVol: set[set.length - 1], host: !!document.getElementById("pvOverPlayer") };
    await wait(300);
    firetable.overlayPreview.stop();
    const after = { active: firetable.overlayPreview.active(), roomVol: set[set.length - 1] };
    player.setVolume = realSet;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    return { during, after, saved: localStorage.getItem("ft-preview-over") };
  });
  check(over.skipped || (over.during.preview === false && over.during.active && over.during.roomVol === 12 && over.during.host),
    "a preview plays over the room: the room keeps its player, at a fifth of the volume (" + JSON.stringify(over) + ")");
  check(over.skipped || (!over.after.active && over.after.roomVol === 60 && over.saved === "0"), "stopping it brings the room back up; the setting is remembered");
  check(!loaded("pixi.min.js") && !loaded("p5.min.js") && !loaded("TweenMax.min.js"), "the stage effects' libraries aren't loaded with the page");

  console.log("-- the song's tempo leads the plays line");
  await put("/tagUpdate", { cid: youtubeSong.cid, adamData: { track_name: "Smoke Song", artist: "Smoke Artist", playcount: 67 } });
  await put("/songBpm", { started: youtubeSong.started, bpm: 111.3, src: "deezer" });
  await page.waitForFunction(() => !document.getElementById("npBpm").hidden, null, { timeout: 10000 }).catch(() => {});
  // as drawn: the ", " between them is CSS, which innerText leaves out
  const stats = await page.evaluate(() => {
    const count = document.getElementById("playCount");
    const sep = getComputedStyle(count, "::before").content.replace(/^"|"$/g, "");
    return document.getElementById("npBpm").textContent + (sep === "none" ? "" : sep) + count.textContent;
  }).catch(() => "");
  check(stats === "111 BPM, 67 plays", "\"111 BPM, 67 plays\" (" + JSON.stringify(stats) + ")");
  const bob = await page.evaluate(() => ({ on: document.body.classList.contains("has-beat"),
    bop: getComputedStyle(document.documentElement).getPropertyValue("--bop").trim(),
    dur: (document.querySelector(".avtr.animate") && getComputedStyle(document.querySelector(".avtr.animate")).animationDuration) || "" }));
  // 111.3 BPM: a beat is 0.539 s, so one bob (two beats) takes 1.078 s
  check(bob.on && bob.bop === "1.0782s" && (!bob.dur || bob.dur === "1.0782s"), "the DJ bobs at half the tempo, one bob every two beats (" + JSON.stringify(bob) + ")");
  if (process.env.SHOTS) await page.locator("#nowplaying").screenshot({ path: process.env.SHOTS + "/nowplaying-bpm.png" });
  await put("/songBpm", null);
  await page.waitForFunction(() => document.getElementById("npBpm").hidden, null, { timeout: 10000 }).catch(() => {});
  check(await page.$eval("#playStats", (el) => el.innerText.trim()) === "67 plays", "no tempo: just \"67 plays\"");

  console.log("-- push notifications: the service worker gets a pushed @mention");
  const swReady = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then((r) => !!r.active && r.scope),
    new Promise((r) => setTimeout(() => r(false), 15000))
  ]));
  check(swReady === SITE, "sw.js registers for the whole site, under the policy");
  check(await page.$eval("#pushMentionsToggle", () => true).catch(() => false), "the settings have the push toggle");
  await page.evaluate(() => {
    window.__swMessages = [];
    navigator.serviceWorker.addEventListener("message", (e) => window.__swMessages.push(JSON.stringify(e.data)));
  });
  // a push message as the bot sends it, delivered by the browser (DevTools protocol)
  const cdp = await context.newCDPSession(page);
  const regs = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  await sleep(500);
  const reg = regs.find((r) => r.scopeURL === SITE && !r.isDeleted);
  if (reg) {
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: SITE.slice(0, -1), registrationId: reg.registrationId,
      data: JSON.stringify({ kind: "mention", id: "c1", title: "dj2", body: "hey @smoke", tag: "m-c1", url: "./#mentions" }) }); // no badge: setting the app badge crashes headless Chromium
  }
  const got = await page.evaluate(() => new Promise((resolve) => {
    const t = Date.now();
    (function poll() {
      if (window.__swMessages.length || Date.now() - t > 10000) return resolve(window.__swMessages[0] || null);
      setTimeout(poll, 200);
    })();
  }));
  // (headless Chromium can't show notifications, so this checks the worker
  // received and read the push; it messages open windows as it shows one)
  check(!!reg && got === '{"type":"push","kind":"mention","id":"c1"}', "the service worker receives a pushed mention" + (got ? "" : " (nothing arrived)"));

  console.log("-- on deck: the tab holds a Web Lock so it isn't frozen while idle");
  const lockHeld = () => page.evaluate(() => navigator.locks.query().then((q) => q.held.some((l) => l.name === "firetable-on-deck")));
  const realUid = await page.evaluate(() => ftapi.uid);
  await page.evaluate(() => { ftapi.uid = "smokeDJ"; });
  await put("/table", [{ name: "dj1", id: "dj1", plays: 1 }, { name: "smokeDJ", id: "smokeDJ", plays: 0 }]);
  await page.waitForFunction(() => navigator.locks.query().then((q) => q.held.length > 0), null, { timeout: 10000 }).catch(() => {});
  check(await lockHeld(), "held while on deck");
  await put("/table", [{ name: "dj1", id: "dj1", plays: 1 }, { name: "dj2", id: "dj2", plays: 0 }]);
  await sleep(500);
  check(!(await lockHeld()), "let go after stepping down");
  await page.evaluate((uid) => { ftapi.uid = uid; ftapi.keepAwake.update(); }, realUid);

  console.log("-- \"Get the app\" guide");
  const guide = await page.evaluate(() => {
    firetable.install.open();
    const dlg = document.getElementById("installAppBox");
    const open = [...dlg.querySelectorAll(".installSteps")].filter((d) => d.open).map((d) => d.dataset.platform);
    const first = dlg.querySelector(".installSteps").dataset.platform;
    const ok = dlg.open && open.join() === "desktop" && first === "desktop" && dlg.querySelectorAll(".installSteps li").length >= 8;
    dlg.close();
    return ok;
  });
  check(guide, "the install guide opens with this device's steps first, the others one tap away");

  console.log("-- swap suggestions: ⇄ on a broken track, Swap, Undo, Swap all");
  const flaggedTrack = (cid, name, swapCid) => ({ type: 1, cid, name, flagged: { date: 1, code: 2 },
    swap: { cid: swapCid, artist: name.split(" - ")[0], title: name.split(" - ")[1], album: "Album", dur: 200, date: 1 } });
  await put("/queues/smoke", {
    k1: flaggedTrack("deadvideo01", "Radiohead - Karma Police", "kpstudio001"),
    k2: flaggedTrack("deadvideo02", "Daft Punk - One More Time", "omtstudio01"),
    k3: Object.assign(flaggedTrack("deadvideo03", "Air - La Femme d'Argent", "airstudio01"), { swap: { dismissed: "airstudio01", date: 1 } }),
    k4: { type: 1, cid: "finevideo01", name: "Fine - Track" }
  });
  const listNow = () => page.evaluate(() => ftapi.db().ref("queues/smoke").once("value").then((s) => s.val()));
  await page.evaluate(() => {
    // the playlist panel is only in the page while signed in: put it back for this part
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    ftapi.queueRef = ftapi.db().ref("queues/smoke");
    return ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
  });
  const ui = await page.evaluate(() => ({
    buttons: document.querySelectorAll("#mainqueue .swapsong").length,
    bar: !document.getElementById("swapBar").hidden && document.getElementById("swapBarText").textContent,
    all: document.getElementById("swapAllBtn").textContent
  }));
  check(ui.buttons === 2, "⇄ shows on the two broken tracks with a suggestion (not on a dismissed one)");
  check(/2 broken tracks have a working copy on YouTube Music/.test(ui.bar || "") && ui.all === "Swap all 2", "the bar over the list offers Swap all");
  const card = await page.evaluate(() => {
    document.querySelector('#mainqueue .pvbar[data-key="k1"] .swapsong').click();
    const pop = document.getElementById("swapPopover");
    return pop.matches(":popover-open") && pop.querySelector(".swapName").textContent + " | " + pop.querySelector(".swapOpen").href;
  });
  check(card === "Radiohead - Karma Police | https://music.youtube.com/watch?v=kpstudio001", "the swap card shows the match and links to YouTube Music");
  await page.evaluate(() => document.querySelector("#swapPopover .swapConfirm").click());
  await sleep(800);
  let q = await listNow();
  check(q.k1.cid === "kpstudio001" && q.k1.name === "Radiohead - Karma Police" && !q.k1.flagged && !q.k1.swap && q.k1.swappedFrom.cid === "deadvideo01" && q.k1.duration === 200,
    "Swap puts the audio track in the same slot, keeps the tags, clears the flag and remembers the old one");
  await page.evaluate(() => document.querySelector("#ft-toast .ft-toast-action").click());
  await sleep(800);
  q = await listNow();
  check(q.k1.cid === "deadvideo01" && q.k1.flagged && q.k1.swap.cid === "kpstudio001", "Undo puts the old track back");
  await page.evaluate(() => ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0")));
  await page.evaluate(() => document.getElementById("swapAllBtn").click());
  check(await page.$eval("#swapAllBtn", (b) => b.textContent) === "Yes, swap 2", "Swap all asks once more first");
  await page.evaluate(() => document.getElementById("swapAllBtn").click());
  await sleep(1500);
  q = await listNow();
  check(q.k1.cid === "kpstudio001" && q.k2.cid === "omtstudio01" && q.k3.cid === "deadvideo03" && q.k4.cid === "finevideo01",
    "Swap all swaps every suggestion in the list and leaves the rest alone");
  check(Object.keys(q).join() === "k1,k2,k3,k4", "the list keeps its order");
  await page.evaluate(() => ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0")));
  check(await page.$eval("#swapBar", (b) => b.hidden), "the bar goes once nothing is left to swap");
  await page.evaluate(() => { firetable.$appShell = $("#appShell").detach(); });

  console.log("-- playlist counts fill in on load, without opening each list");
  await put("/playlists/smoke", {
    p1: { name: "Mix", list: { a: { type: 1, cid: "c1", name: "A - 1" }, b: { type: 1, cid: "c2", name: "B - 2", flagged: { date: 1, code: 2 } }, c: { type: 1, cid: "c3", name: "C - 3" } } },
    p2: { name: "Empty" }
  });
  const counts = await page.evaluate((db) => {
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    ftapi.uid = "smoke";
    // the real one signs the shallow read with your token; the test database is open
    ftapi.utilities.shallowKeys = (path) => fetch(db + "/" + path + ".json?ns=demo-smoke&shallow=true").then((r) => r.json()).then((k) => k || {});
    firetable.listCounts = {};
    firetable.liveCountID = null;
    const all = { p1: { name: "Mix" }, p2: { name: "Empty" } };
    firetable.ui.fillPlaylistPickers(all);
    return firetable.actions.loadListCounts(all).then(() => [...document.querySelectorAll("#listpicker option")].map((o) => o.value + "=" + o.textContent))
      .catch((e) => ["error: " + e.message]);
  }, DB).catch((e) => ["error: " + e.message]);
  check(counts.includes("p1=Mix (3, 1 ⚠)") && counts.includes("p2=Empty (0)") && counts.some((t) => /^0=.* \(4, 1 ⚠\)$/.test(t)),
    "every list's track and flagged counts show in the picker (" + counts.join(" | ") + ")");

  console.log("-- emoji: Emoji 17.0 in the picker, old shortnames still work");
  await page.waitForFunction(() => firetable.emojiMap && firetable.emojiMap.trombone, null, { timeout: 30000 }).catch(() => {});
  const emo = await page.evaluate(() => ({
    newest: firetable.emojiMap.trombone, renamed: firetable.emojiMap.hugging_face, old: firetable.emojiMap.smile,
    sections: document.querySelectorAll("#pickerContents > div").length, picker: document.querySelectorAll(".pickerResult").length,
    chat: firetable.utilities.emojiShortnamestoUnicode(":orca: :pouting_face:")
  }));
  check(emo.newest === "\u{1FA8A}" && emo.renamed === "🤗" && emo.old === "😄", "Emoji 17.0 shortnames load, and renamed and old ones still work");
  check(emo.sections === 9 && emo.picker > 1900 && /\u{1FACD}/u.test(emo.chat) && /😡/.test(emo.chat), "the picker has every group and " + emo.picker + " emoji");

  console.log("-- a printed card: GRAB, then YOURS / GRABBED BY / GONE");
  await put("/cards", { cardA: { owner: false, cardnum: 1 }, cardB: { owner: false, cardnum: 2 }, cardC: { owner: false, cardnum: 3 } });
  await put("/users/bot", { username: "hostbot", hostbot: true });
  const grab = await page.evaluate(async () => {
    const sent = [];
    ftapi.actions.sendBotCommand = (t) => { sent.push(t); return Promise.resolve(); };
    const add = (id) => { const $t = $('<div class="chatText"></div>').appendTo("#chats"); firetable.ui.addGrabButton($t, id); return $t.find(".chat-grab-btn"); };
    const wait = (fn) => new Promise((r) => { const t = Date.now(); (function poll() { if (fn() || Date.now() - t > 8000) return r(); setTimeout(poll, 50); })(); });
    const $a = add("cardA");
    await wait(() => firetable.cardGrabs.cardA && firetable.cardGrabs.cardA.loaded);
    const first = $a.attr("data-state") + ":" + $a.text();
    $a.trigger("click");
    const pending = $a.attr("data-state") + ":" + $a.prop("disabled");
    return { first, pending, sent: sent.join() };
  });
  check(grab.first === "open:Grab" && grab.pending === "pending:true" && grab.sent === "!grab cardA", "GRAB sends \"!grab <card>\" quietly and waits (" + JSON.stringify(grab) + ")");
  await put("/cards/cardA/owner", "smoke");
  await page.waitForFunction(() => $('.chat-grab-btn[data-card="cardA"]').attr("data-state") === "mine", null, { timeout: 8000 }).catch(() => {});
  const after = await page.evaluate(async () => {
    const $a = $('.chat-grab-btn[data-card="cardA"]');
    const mine = $a.attr("data-state") + ":" + $a.text() + ":" + $a.prop("disabled");
    const $t = $('<div class="chatText"></div>').appendTo("#chats");
    firetable.ui.addGrabButton($t, "cardB");
    const $t2 = $('<div class="chatText"></div>').appendTo("#chats");
    await new Promise((r) => setTimeout(r, 1500));
    firetable.ui.addGrabButton($t2, "cardC"); // a newer card: B is gone
    await new Promise((r) => setTimeout(r, 300));
    const b = $('.chat-grab-btn[data-card="cardB"]');
    return { mine, b: b.attr("data-state") + ":" + b.prop("disabled"), listening: Object.keys(firetable.cardGrabs).filter((k) => firetable.cardGrabs[k].fn).join() };
  });
  check(after.mine === "mine:Yours! See it:false", "the winner's button opens their card case (" + after.mine + ")");
  check(after.b === "gone:true" && after.listening === "cardC", "a newer card greys out an older one nobody grabbed, and stops following it (" + JSON.stringify(after) + ")");
  await put("/cards/cardC", { owner: "dj2", cardnum: 3 });
  await page.waitForFunction(() => $('.chat-grab-btn[data-card="cardC"]').attr("data-state") === "taken", null, { timeout: 8000 }).catch(() => {});
  check(await page.$eval('.chat-grab-btn[data-card="cardC"]', (b) => b.textContent + ":" + b.disabled) === "Grabbed by dj2:true", "someone else's grab shows who got it");

  console.log("-- before the bot's rules are published: the old \"Type !grab\" message still gets a button");
  await put("/cards/cardL", { owner: false, cardnum: 4 });
  const legacy = await page.evaluate(async () => {
    const sent = [];
    ftapi.actions.sendBotCommand = (t) => { sent.push(t); return Promise.resolve(); };
    const showCard = firetable.actions.showCard;
    firetable.actions.showCard = () => {};
    const say = (id, txt, extra) => ftapi.events.emit("newChat", Object.assign({ chatID: "smk" + Math.random().toString(36).slice(2), feedID: "f", id, name: id, txt, time: Date.now() }, extra));
    say("bot", "A new trading card has been printed. Type !grab to grab it for yourself!");
    const $b = $('.chat-grab-btn[data-card=""]').last();
    const shown = $b.closest(".chatText").clone().children().remove().end().text().trim();
    const first = $b.attr("data-state");
    $b.trigger("click");
    say("bot", "smoke grabbed the card!", { card: "cardL" });
    await new Promise((r) => setTimeout(r, 300));
    firetable.actions.showCard = showCard;
    return { shown, first, sent: sent.join(), card: $b.attr("data-card") };
  });
  await put("/cards/cardL/owner", "smoke");
  await page.waitForFunction(() => $('.chat-grab-btn[data-card="cardL"]').attr("data-state") === "mine", null, { timeout: 8000 }).catch(() => {});
  legacy.after = await page.$eval('.chat-grab-btn[data-card="cardL"]', (b) => b.dataset.state).catch(() => "missing");
  check(legacy.shown === "A new trading card has been printed." && legacy.first === "open" && legacy.sent === "!grab" && legacy.card === "cardL" && legacy.after === "mine",
    "it hides \"Type !grab\", sends a plain !grab and learns the card from \"… grabbed the card!\" (" + JSON.stringify(legacy) + ")");

  console.log("-- reaction picker: disco ball and dancers, fits a phone");
  const fits = async () => page.evaluate(async () => {
    const pop = document.getElementById("reactPickerPopover");
    pop.showPopover();
    await new Promise((r) => setTimeout(r, 300));
    const box = pop.querySelector(".reactPicker").getBoundingClientRect();
    const out = { keys: [...pop.querySelectorAll(".reactPick")].map((b) => b.dataset.key).slice(-3).join(), count: pop.querySelectorAll(".reactPick").length,
      inside: box.left >= 0 && box.right <= window.innerWidth, w: Math.round(box.width) };
    pop.hidePopover();
    return out;
  });
  const wide = await fits();
  await page.setViewportSize({ width: 375, height: 740 });
  const phone = await fits();
  await page.setViewportSize({ width: 1280, height: 720 });
  check(wide.count === 11 && wide.keys === "mirror_ball,man_dancing,woman_dancing", "the picker has 🪩 🕺 💃 (" + JSON.stringify(wide) + ")");
  check(phone.inside, "the picker fits a 375px phone (" + JSON.stringify(phone) + ")");
  if (process.env.SHOTS) {
    for (const [w, name] of [[1280, "wide"], [375, "phone"]]) {
      await page.setViewportSize({ width: w, height: 740 });
      await page.evaluate(() => document.getElementById("reactPickerPopover").showPopover());
      await sleep(400);
      await page.locator("#reactPickerPopover .reactPicker").screenshot({ path: process.env.SHOTS + "/react-" + name + ".png" });
      await page.evaluate(() => document.getElementById("reactPickerPopover").hidePopover());
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  console.log("-- Recent on a phone (mods): ⋮ menu, and the tag editor sits clear of the keyboard");
  await page.setViewportSize({ width: 390, height: 740 });
  const recent = await page.evaluate(async () => {
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login");
    $("body").addClass("is-mod");
    firetable.nav.view = "history";
    firetable.nav.mobileSection = "view";
    firetable.nav.apply();
    const t = Date.now();
    [["Mesh", "Exile"], ["Justice", "One Night/All Night feat. Tame Impala"], ["Satin Jackets", "Why Change the World feat. Small Black"]].forEach(([artist, title], i) =>
      ftapi.events.emit("newHistory", { histID: "smh" + i, cid: "smcid" + i, type: 1, artist, title, dj: "dj1", djid: "dj1",
        when: t - (3 - i) * 60000, img: "img/idlogo.png", url: "https://www.youtube.com/watch?v=smcid" + i }));
    await new Promise((r) => setTimeout(r, 300));
    const row = document.querySelector('#thehistory .pvbar[data-histid="smh0"]');
    const shown = (sel) => getComputedStyle(row.querySelector(sel)).display !== "none";
    const out = { more: shown(".row-more"), add: shown(".histeal"), edit: shown(".edittags"), flag: shown(".flagplay"), open: shown(".tracklink-btn"),
      titleW: Math.round(row.querySelector(".histlink").getBoundingClientRect().width),
      title: row.querySelector(".hist-track-title").textContent, artist: row.querySelector(".hist-track-artist").textContent };
    row.querySelector(".row-more").click();
    await new Promise((r) => setTimeout(r, 200));
    out.menu = document.getElementById("histMenuPopover").matches(":popover-open");
    document.querySelector('#histMenuPopover [data-act="tags"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const pop = document.getElementById("tagEditorPopover"), input = document.getElementById("tagMachine");
    const box = pop.getBoundingClientRect();
    out.sheet = pop.matches(":popover-open") && pop.classList.contains("ft-sheet");
    out.top = Math.round(box.top); out.inside = box.left >= 0 && box.right <= window.innerWidth;
    out.focused = document.activeElement === input; out.value = input.value;
    out.editing = row.classList.contains("editing");
    return out;
  });
  check(recent.more && recent.add && !recent.edit && !recent.flag && !recent.open, "narrow rows show Add + ⋮; Open, Edit tags and Flag move into the menu (" + JSON.stringify(recent) + ")");
  check(recent.title === "Exile" && recent.artist === "Mesh" && recent.titleW > 150, "the title gets the room: title over artist, " + recent.titleW + "px wide");
  check(recent.menu && recent.sheet && recent.top <= 16 && recent.inside && recent.focused && recent.value === "Mesh - Exile" && recent.editing,
    "Edit tags opens a focused sheet at the top of the screen, above where the keyboard opens");
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/recent-tag-sheet.png" });
  const saved = await page.evaluate(async () => {
    const calls = [];
    const editTag = ftapi.actions.editTag;
    ftapi.actions.editTag = (...a) => { calls.push(a.slice(0, 5).join("|")); };
    const input = document.getElementById("tagMachine");
    input.value = "Exile (Live) - Mesh";
    document.querySelector("#tagEditorForm .tagSwap").click();
    const swapped = input.value;
    document.querySelector("#tagEditorForm .tagSave").click();
    await new Promise((r) => setTimeout(r, 200));
    ftapi.actions.editTag = editTag;
    return { swapped, calls: calls.join(), open: document.getElementById("tagEditorPopover").matches(":popover-open") };
  });
  check(saved.swapped === "Mesh - Exile (Live)", "Swap turns \"Title - Artist\" around (" + saved.swapped + ")");
  check(saved.calls === "1|smcid0|Mesh - Exile (Live)|smh0|songHistory" && !saved.open, "Save writes the tag for that play (" + JSON.stringify(saved) + ")");
  const typed = await page.evaluate(async () => {
    const calls = [];
    const editTag = ftapi.actions.editTag;
    ftapi.actions.editTag = (...a) => { calls.push(a.slice(1, 3).join("|")); };
    firetable.actions.editTagsPrompt("ytcidsmcid1", "Justice - One Night", document.querySelector('#thehistory .pvbar[data-histid="smh1"] .row-more'));
    const input = document.getElementById("tagMachine");
    input.value = "no separator";
    input.form.requestSubmit();
    const invalid = input.hasAttribute("aria-invalid") && document.getElementById("tagEditorPopover").matches(":popover-open");
    input.value = "Justice - One Night/All Night";
    input.form.requestSubmit();
    ftapi.actions.editTag = editTag;
    return { invalid, calls: calls.join(), closed: !document.getElementById("tagEditorPopover").matches(":popover-open") };
  });
  check(typed.invalid && typed.calls === "smcid1|Justice - One Night/All Night" && typed.closed, "Enter saves; a tag without \" - \" is flagged and not saved (" + JSON.stringify(typed) + ")");
  await page.setViewportSize({ width: 1280, height: 720 });
  const desk = await page.evaluate(async () => {
    const row = document.querySelector('#thehistory .pvbar[data-histid="smh0"]');
    const shown = (sel) => getComputedStyle(row.querySelector(sel)).display !== "none";
    row.querySelector(".edittags").click();
    await new Promise((r) => setTimeout(r, 300));
    const pop = document.getElementById("tagEditorPopover");
    const b = pop.getBoundingClientRect(), a = row.querySelector(".edittags").getBoundingClientRect();
    return { icons: shown(".tracklink-btn") && shown(".edittags") && shown(".flagplay") && !shown(".row-more"),
      sheet: pop.classList.contains("ft-sheet"), beside: b.top >= a.bottom || b.bottom <= a.top, focused: document.activeElement.id === "tagMachine" };
  });
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/recent-tag-popover.png" });
  check(desk.icons && !desk.sheet && desk.beside && desk.focused, "wide screens keep every button on the row and the editor beside its button (" + JSON.stringify(desk) + ")");
  await page.evaluate(() => { document.getElementById("tagEditorPopover").hidePopover(); $("body").removeClass("is-mod"); firetable.$appShell = $("#appShell").detach(); });

  console.log("-- saving a song: the + becomes a lasting gold check, and the toast can undo it");
  await put("/queues/smoke", { q1: { type: 1, cid: "inlist01", name: "Have - It" } });
  const saving = await page.evaluate(async () => {
    const wait = (fn, ms = 8000) => new Promise((r) => { const t = Date.now(); (function poll() { if (fn() || Date.now() - t > ms) return r(); setTimeout(poll, 50); })(); });
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login");
    ftapi.uid = "smoke";
    ftapi.queueRef = ftapi.db().ref("queues/smoke");
    ftapi.selectedListThing = "0";
    await ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
    const t = Date.now();
    [["inlist01", "Have", "It"], ["newsave01", "Want", "This"]].forEach(([cid, artist, title], i) =>
      ftapi.events.emit("newHistory", { histID: "svh" + i, cid, type: 1, artist, title, dj: "dj1", djid: "dj1", when: t - i * 60000, img: "img/idlogo.png", url: "https://www.youtube.com/watch?v=" + cid }));
    const btn = (cid) => document.querySelector('#thehistory .pvbar[data-cid="' + cid + '"] .histeal');
    const state = (cid) => btn(cid).textContent.trim() + (btn(cid).classList.contains("is-saved") ? ":saved" : "");
    await new Promise((r) => setTimeout(r, 200));
    const before = { have: state("inlist01"), want: state("newsave01") };
    btn("newsave01").click();
    await wait(() => $("#stealContain").is(":visible") && $("#stealpicker option[value='0']").length);
    $("#stealpicker").val("0").trigger("change");
    await wait(() => document.querySelector("#ft-toast .ft-toast-action"));
    const toast = document.getElementById("ft-toast").textContent;
    await new Promise((r) => setTimeout(r, 4000)); // longer than the old 3-second check
    const after = state("newsave01");
    const stored = await ftapi.queueRef.once("value").then((s) => Object.values(s.val() || {}).map((x) => x.cid));
    return { before, toast, after, stored };
  });
  check(saving.before.have === "playlist_add_check:saved" && saving.before.want === "playlist_add", "a song already in the open playlist shows a gold check; others show + (" + JSON.stringify(saving.before) + ")");
  check(/^Saved to Default Playlist/.test(saving.toast) && saving.stored.includes("newsave01"), "saving shows \"Saved to …\" with Undo (" + saving.toast + ")");
  check(saving.after === "playlist_add_check:saved", "the check stays after saving (" + saving.after + ")");
  await put("/queues/smoke", null);
  const undone = await page.evaluate(async () => {
    await ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val() || {}, "0"));
    firetable.saved.session = {};
    const key = await ftapi.queueRef.push({ type: 1, cid: "undo0001", name: "Undo - Me" }).key;
    firetable.ui.savedToast(ftapi.queueRef, key, { type: 1, cid: "undo0001" }, "Default Playlist");
    document.querySelector("#ft-toast .ft-toast-action").click();
    await new Promise((r) => setTimeout(r, 800));
    const left = await ftapi.queueRef.once("value").then((s) => Object.values(s.val() || {}).map((x) => x.cid));
    return { left, where: firetable.saved.where(1, "undo0001") };
  });
  check(!undone.left.includes("undo0001") && undone.where === "", "Undo takes the song back out and its + returns (" + JSON.stringify(undone) + ")");
  const fromDiscover = await page.evaluate(async () => {
    const key = await new Promise((r) => ftapi.actions.addTrackToTop(ftapi.queueRef, { type: 1, cid: "fromdisc01", name: "Found - There", from: "discover" }, null, null, (err, k) => r(k)));
    const stored = await ftapi.queueRef.child(key).once("value").then((s) => s.val());
    await ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
    await new Promise((r) => setTimeout(r, 200));
    const row = document.querySelector('#mainqueue .pvbar[data-key="' + key + '"]');
    const out = { from: stored && stored.from, label: row && (row.querySelector(".pl-from") || {}).textContent, others: document.querySelectorAll("#mainqueue .pl-from").length };
    await ftapi.queueRef.child(key).remove();
    return out;
  });
  check(fromDiscover.from === "discover" && fromDiscover.label === "Discover" && fromDiscover.others === 1,
    "a song saved from Discover says so in the playlist (" + JSON.stringify(fromDiscover) + ")");
  const noticeText = await page.evaluate(async () => {
    firetable.notices.queue.push({ txt: ":white_check_mark: matt gave you a card! It's in your card case.", card: "cardA", kind: "card" });
    firetable.ui.showNextNotice();
    await new Promise((r) => setTimeout(r, 100));
    return { txt: document.getElementById("ft-toast").firstChild.textContent, map: !!firetable.emojiMap };
  });
  check(noticeText.map && noticeText.txt === "\u2705 matt gave you a card! It's in your card case.", "a notice's emoji show as emoji, not markup (" + noticeText.txt + ")");
  const dates = await page.evaluate(() => {
    const y = new Date().getFullYear();
    return [firetable.utilities.shortDate(new Date(y, 10, 1).getTime()), firetable.utilities.shortDate(new Date(2011, 1, 3).getTime())];
  });
  check(dates[0] === "Nov 1" && dates[1] === "Feb 3, 2011", "one date style: \"Nov 1\" this year, \"Feb 3, 2011\" before (" + dates.join(" | ") + ")");
  await page.evaluate(() => { firetable.$appShell = $("#appShell").detach(); });

  console.log("-- the waitlist's user card matches the deck's: DJ info and actions (#259)");
  await put("/users", { dj1: { username: "dj1", status: true }, dj2: { username: "dj2", status: true }, bot: { username: "hostbot", hostbot: true },
    wl1: { username: "wl1", status: true }, smokeMod: { username: "smokeMod", status: true, mod: true }, boss: { username: "boss", status: true, supermod: true } });
  await put("/table", [{ name: "dj1", id: "dj1", plays: 1 }, { name: "dj2", id: "dj2", plays: 2, removeAfter: true }]);
  await put("/waitlist", [{ name: "wl1", id: "wl1", plays: 0 }, { name: "smokeMod", id: "smokeMod", plays: 0, removeAfter: true }, { name: "boss", id: "boss", plays: 0 }]);
  await page.waitForFunction(() => firetable.waitlistData && ftapi.users && ftapi.users.boss, null, { timeout: 10000 }).catch(() => {});
  const wlCard = await page.evaluate(async () => {
    // the people panel is only in the page while signed in: put it back for this part
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login");
    const realUid = ftapi.uid;
    ftapi.uid = "smokeMod";
    firetable.nav.setSide("people");
    ftapi.events.emit("waitlistChanged", firetable.waitlistData);
    ftapi.events.emit("tableChanged", firetable.tableData);
    const tip = document.getElementById("ft-user-tip");
    const facts = () => [...tip.querySelectorAll(".utt-fact")].map((f) => f.children[0].textContent + "=" + f.children[1].textContent).filter((f) => !/^(Joined|Cards)=/.test(f)).join("|");
    const actions = () => [...tip.querySelectorAll(".utt-icon-btn")].filter((b) => getComputedStyle(b).display !== "none" && b.offsetParent).map((b) => b.dataset.action + ":" + (b.getAttribute("title") || b.dataset.ftTitle)).join("|");
    const open = (sel) => { document.querySelector(sel).click(); return new Promise((r) => setTimeout(r, 100)); };
    const out = {};
    await open('#usersWaitlist .waitlist-item[data-userid="wl1"] .ft-avatar');
    out.wl = { open: tip.matches(":popover-open"), facts: facts(), actions: actions() };
    await open('#ondeck .ondeck-slot[data-djid="dj2"]');
    out.deck = { open: tip.matches(":popover-open"), facts: facts(), actions: actions() };
    await open('#usersWaitlist .waitlist-item[data-userid="boss"] .ft-avatar');
    out.boss = actions();
    await open('#usersWaitlist .waitlist-item[data-userid="smokeMod"] .ft-avatar');
    out.self = { facts: facts(), actions: actions() };
    // the waitlist redraws while the card is open: it follows its person
    await open('#usersWaitlist .waitlist-item[data-userid="wl1"] .ft-avatar');
    firetable.waitlistData = [firetable.waitlistData[1], firetable.waitlistData[0], firetable.waitlistData[2]];
    ftapi.events.emit("waitlistChanged", firetable.waitlistData);
    await new Promise((r) => setTimeout(r, 100));
    const anchor = document.querySelector('#usersWaitlist .waitlist-item[data-userid="wl1"] .ft-avatar');
    out.redraw = { open: tip.matches(":popover-open"), anchored: anchor.style.getPropertyValue("anchor-name") === "--ft-user-anchor", facts: facts() };
    tip.hidePopover();
    ftapi.uid = realUid;
    firetable.$appShell = $("#appShell").detach();
    return out;
  });
  check(wlCard.wl.open && wlCard.wl.facts === "Name=wl1|Role=Member|DJ=Waitlist, 1 of 3", "a waitlist avatar's card shows their place in line (" + JSON.stringify(wlCard.wl) + ")");
  check(wlCard.wl.actions === "chat-at:@ in chat|remove-from-deck:Remove from waitlist|toggle-bus:Send wl1 home after their next play|toggle-block:Block",
    "mods get the deck's actions on the waitlist: remove and the bus, no \"Add to deck\" (" + wlCard.wl.actions + ")");
  check(wlCard.deck.open && /DJ=On deck\|Session plays=2\/∞\|Leaving=After next play/.test(wlCard.deck.facts) && /remove-from-deck:Remove from deck\|toggle-bus:Don't send dj2 home/.test(wlCard.deck.actions),
    "the on-deck card still shows plays and its actions (" + JSON.stringify(wlCard.deck) + ")");
  check(!/remove-from-deck|toggle-bus/.test(wlCard.boss), "no remove or bus for someone who outranks you (" + wlCard.boss + ")");
  check(wlCard.self.facts === "Name=smokeMod|Role=Mod|DJ=Waitlist, 2 of 3|Leaving=After next play" &&
    wlCard.self.actions === "toggle-bus:Don't step down after your next play|step-down:Leave the waitlist",
    "your own waitlist card lets you take the bus or leave the waitlist (" + JSON.stringify(wlCard.self) + ")");
  check(wlCard.redraw.open && wlCard.redraw.anchored && /DJ=Waitlist, 2 of 3/.test(wlCard.redraw.facts), "an open card follows its person when the waitlist redraws (" + JSON.stringify(wlCard.redraw) + ")");
  await put("/waitlist", null);
  await put("/table", [{ name: "dj1", id: "dj1", plays: 1 }, { name: "dj2", id: "dj2", plays: 0 }]);

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

// Discover (config.js discover: true), in a page of its own: everything above
// ran with it off, so the site is unchanged until it's switched on.
const dPage = await context.newPage();
// the YouTube and SoundCloud players' own scripts sometimes throw when a song
// is cut short (an aborted fetch): not errors of the site's
const theirs = (e) => /^\s*at /m.test(e.stack || "") && (e.stack || "").split("\n").filter((l) => /^\s*at /.test(l)).every((l) => /sndcdn\.com|soundcloud\.com|youtube\.com|ytimg\.com/.test(l));
dPage.on("pageerror", (e) => { if (theirs(e)) return; pageErrors.push("Discover: " + e.message); });
try {
  console.log("-- Discover: visitors land on it, and the room is one step away");
  await dPage.exposeFunction("__cspViolation", (v) => violations.push("Discover: " + v));
  await dPage.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation(e.violatedDirective + " blocked " + e.blockedURI));
    try { localStorage.clear(); } catch (e) { /* fine */ }
  });
  await dPage.route("**/config.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript",
    body: CONFIG.replace(/roomName:/, 'discover: true, signInProviders: ["google"], roomName:') }));
  const DAY = 86400000, iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  await put("/discover", {
    new: { at: now, days: 90, tracks: [
      { cid: "newrel0001", a: "New Band", t: "First Single", dur: 200, rel: iso(now - 2 * DAY), relSrc: "yt", plays: 3, first: now - DAY, dj: "dj1", djid: "dj1" },
      { cid: "newrel0002", a: "Quiet One", t: "Unplayed", dur: 210, rel: iso(now - 5 * DAY), relSrc: "yt", plays: 0 },
      { cid: "newrel0003", a: "Third", t: "Song", dur: 180, rel: iso(now - 9 * DAY), relSrc: "upload", plays: 1, first: now - DAY, dj: "dj2", djid: "dj2" }] },
    charts: { week: { "2026-W45": { at: now, from: now - 3 * DAY, to: now + 4 * DAY, plays: 40, djs: 3, rows: [
      { key: "a", type: 1, cid: "chart00001", a: "Top", t: "Song", plays: 9, dj: "dj1", djid: "dj1", mv: 2, wks: 3 },
      { key: "b", type: 1, cid: "chart00002", a: "Next", t: "Song", plays: 7, mv: "new", wks: 1 },
      { key: "c", type: 1, cid: "newrel0001", a: "New Band", t: "First Single", plays: 3, fires: 4, wks: 2 }] } } },
    themes: {
      index: { nT1: { theme: "Italo Night", from: now - 2 * DAY, to: now - 2 * DAY + 3600000, n: 3, djs: ["dj1"] } },
      night: { nT1: { theme: "Italo Night", from: now - 2 * DAY, to: now - 2 * DAY + 3600000, n: 3, djs: ["dj1"], rows: [
        { type: 1, cid: "night00001", a: "Italo", t: "One", dj: "dj1", djid: "dj1", w: now - 2 * DAY, f: 2 },
        { type: 1, cid: "night00002", a: "Italo", t: "Two", dj: "dj1", djid: "dj1", w: now - 2 * DAY + 1800000 },
        { type: 1, cid: "night00003", a: "Italo", t: "Three", dj: "dj1", djid: "dj1", w: now - 2 * DAY + 3600000 }] } }
    },
    chartIds: { week: { "2026-W45": true } },
    ytm: { "nu-disco": "PLsmokeNuDisco" },
    fires: { at: now, since: now - 5 * DAY, index: [{ djid: "dj1", dj: "dj1", fires: 7, plays: 3 }, { djid: "dj2", dj: "dj2", fires: 2, plays: 1 }],
      djs: { dj1: { name: "dj1", fires: 7, plays: 3, songs: [
        { key: "f1", type: 1, cid: "hot0000001", a: "Hot", t: "One", fires: 5, plays: 2, top: 3, w: now - DAY },
        { key: "f2", type: 1, cid: "hot0000002", a: "Warm", t: "Two", fires: 2, plays: 1, top: 2, w: now - 2 * DAY }] } } },
    chat: { at: now, hour: 12, msgs: [{ id: "m1", uid: "dj1", n: "dj1", txt: "great tune", w: now }, { id: "m2", txt: "hidden name here", w: now }] }
  });
  // the weekly library (tools/history/library.js in firetable-hostbot)
  const row = (cid, a, t, plays, extra) => Object.assign({ type: 1, cid, a, t, plays, first: now - 400 * DAY, dj: "dj1", djid: "dj1" }, extra || {});
  await put("/discover/lib", {
    genres: { "nu-disco": { name: "Nu-Disco", songs: 40, plays: 300, bpm: 118, first: 2010, djs: 2, x: 0.64, covers: ["1_lib0000001"], next: ["soul-and-randb"],
      about: "Disco's grooves rebuilt with modern synths.", dec: { 2010: 200, 2020: 100 } },
      "soul-and-randb": { name: "Soul & R&B", songs: 10, plays: 60, bpm: 98, first: 2012, djs: 1, x: 0.17, covers: [], next: ["nu-disco"], dec: { 2010: 60 } } },
    genre: { "nu-disco": { fav: [row("lib0000001", "Alpha & Beta", "Fav One", 30), row("lib0000002", "Gamma", "Fav Two", 20)], newHere: [row("lib0000003", "Delta", "New One", 1)], deep: [],
      years: { 2010: 3, 2011: 5 }, who: [{ dj: "dj1", djid: "dj1", key: "dj1", plays: 40 }] } },
    djs: { dj1: { name: "dj1", djid: "dj1", plays: 120, firsts: 30, since: now - 900 * DAY, g: ["Nu-Disco"] } },
    dj: { dj1: { name: "dj1", djid: "dj1", plays: 120, firsts: 30, songs: 80, since: now - 900 * DAY, when: "Friday nights", taste: [{ g: "Nu-Disco", slug: "nu-disco", pct: 70 }],
      most: [row("lib0000001", "Alpha & Beta", "Fav One", 30, { by: 12 })], firstHere: [], similar: [], sets: [{ at: now - DAY, n: 9 }] } },
    artistIndex: { alpha: ["Alpha", 30] },
    artist: { alpha: { name: "Alpha", plays: 30, songs: 1, first: now - 400 * DAY, firstDj: "dj1", firstDjid: "dj1", rows: [row("lib0000001", "Alpha & Beta", "Fav One", 30)], djs: [] } },
    years: { 2026: { songs: 100, plays: 50, played: 20, genre: "Nu-Disco" } },
    year: { 2026: { top: [row("lib0000002", "Gamma", "Fav Two", 20)], more: [{ type: 1, cid: "lib0000009", a: "Zed", t: "Unplayed Find", plays: 0 }] } }
  });
  await dPage.goto(SITE, { waitUntil: "load", timeout: 60000 });
  await dPage.waitForFunction(() => document.querySelectorAll("#dBrowse .ft-cards .pvbar").length > 0, null, { timeout: 20000 }).catch(() => {});
  const home = await dPage.evaluate(() => ({
    on: document.body.classList.contains("ft-discover"),
    tabs: [...document.querySelectorAll("#modeTabs .tab")].map((b) => b.textContent.trim() + (b.classList.contains("on") ? "*" : "")).join(),
    cards: document.querySelectorAll("#dBrowse .ft-cards .pvbar").length,
    chart: [...document.querySelectorAll("#dBrowse .ft-rows .hist-timestamp")].slice(0, 2).map((e) => e.textContent).join(),
    unplayed: [...document.querySelectorAll("#dBrowse .fresh-meta .histdj")].some((e) => e.textContent === "Not played live yet"),
    stageHidden: getComputedStyle(document.getElementById("stage")).opacity === "0",
    live: document.getElementById("dLive").textContent
  }));
  check(home.on && home.tabs === "Discover*,Live" && home.cards === 3 && home.chart === "#1,#2" && home.unplayed && home.stageHidden,
    "a visitor lands on Discover: new releases, the week's chart, the stage out of sight (" + JSON.stringify(home) + ")");
  check(/on deck/.test(home.live) && /here/.test(home.live) && /Listen in/.test(home.live), "the room in one line: the DJ, who is here, Listen in (" + home.live.trim() + ")");

  console.log("-- Discover: playing a song uses the room's player, and Live takes it back");
  const playing = await dPage.evaluate(async () => {
    document.querySelector("#dBrowse .ft-cards .pvbar .d-play").click();
    await new Promise((r) => setTimeout(r, 300));
    const during = { preview: firetable.preview, state: firetable.discover.state(), title: (document.querySelector("#dSide .d-title") || {}).textContent };
    location.hash = "#discover/charts";
    await new Promise((r) => setTimeout(r, 300));
    const chart = { rows: document.querySelectorAll("#dBrowse .ft-rows .pvbar").length, mv: [...document.querySelectorAll("#dBrowse .d-mv")].map((e) => e.textContent).join() };
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await new Promise((r) => setTimeout(r, 300));
    return { during, chart, after: firetable.preview, mode: document.body.classList.contains("ft-discover"), hash: location.hash };
  });
  check(playing.during.preview === "discover" && playing.during.state.playing === "newrel0001" && playing.during.title === "First Single",
    "a song plays in Discover's player (" + JSON.stringify(playing.during) + ")");
  check(playing.chart.rows === 3 && playing.chart.mv === "▲2,new", "the chart shows movement (" + JSON.stringify(playing.chart) + ")");
  check(playing.after === false && !playing.mode && playing.hash === "#live", "Live gives the player back to the room (" + JSON.stringify({ after: playing.after, hash: playing.hash }) + ")");

  console.log("-- Discover: visitors read the chat in Live, and save songs to a crate");
  const peek = await dPage.evaluate(() => ({
    shown: !document.getElementById("chatPeek").hidden,
    lines: [...document.querySelectorAll("#chatPeek .d-chatline b")].map((b) => b.textContent).join()
  }));
  check(peek.shown && peek.lines === "dj1,a member", "Live shows visitors the chat to read; someone who hid their name is \"a member\" (" + JSON.stringify(peek) + ")");
  const crate = await dPage.evaluate(async () => {
    location.hash = "#discover/new";
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('.d-chip[data-new="days90"]').click();
    const saves = () => document.querySelectorAll("#dBrowse .histeal");
    for (let i = 0; i < 3; i++) { saves()[i].click(); await new Promise((r) => setTimeout(r, 100)); }
    await new Promise((r) => setTimeout(r, 900));
    const dlg = document.getElementById("keepCrateBox");
    const out = { stored: JSON.parse(localStorage.getItem("ft-crate") || "[]").length, dialog: !!(dlg && dlg.open),
      google: !!(dlg && dlg.querySelector(".d-google")), checked: [...saves()].filter((b) => b.classList.contains("is-saved")).length };
    if (dlg) dlg.close();
    return out;
  });
  check(crate.stored === 3 && crate.checked === 3, "saves go to a crate in this browser, each + turning into a check (" + JSON.stringify(crate) + ")");
  check(crate.dialog && crate.google, "the third save offers to keep the crate, with Continue with Google (" + JSON.stringify(crate) + ")");

  console.log("-- Discover: chart extras, theme nights, Save all");
  const extras = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    const out = {};
    location.hash = "#discover/charts";
    await until(() => document.querySelectorAll("#dBrowse .ft-rows .pvbar").length === 3);
    out.fires = [...document.querySelectorAll("#dBrowse .d-fires .d-num")].map((e) => e.textContent).join();
    out.wks = [...document.querySelectorAll("#dBrowse .d-wks")].map((e) => e.textContent).join();
    document.querySelector('.d-chip[data-cnew="1"]').click();
    out.newOnly = [...document.querySelectorAll("#dBrowse .hist-track-title")].map((e) => e.textContent).join() + "|" + [...document.querySelectorAll("#dBrowse .hist-timestamp")].map((e) => e.textContent).join();
    document.querySelector('.d-chip[data-cnew=""]').click();
    out.live = document.getElementById("dLive").textContent;
    location.hash = "#discover/themes";
    await until(() => document.querySelector("#dBrowse .d-night"));
    out.nights = [...document.querySelectorAll("#dBrowse .d-night b")].map((e) => e.textContent).join();
    document.querySelector("#dBrowse .d-night").click();
    await until(() => document.querySelectorAll("#dBrowse .ft-rows .pvbar").length === 3);
    out.night = document.querySelector("#dBrowse .d-pagetext h2").textContent + "|" + document.querySelectorAll("#dBrowse .ft-rows .pvbar").length + "|" + location.hash;
    localStorage.setItem("ft-crate", "[]");
    document.querySelector("#dBrowse .d-saveall").click();
    out.saved = JSON.parse(localStorage.getItem("ft-crate") || "[]").map((t) => t.t).join();
    document.querySelector("#dBrowse .d-playall").click();
    await wait(200);
    out.playing = firetable.discover.state().list + ":" + firetable.discover.state().playing;
    out.source = [...document.querySelectorAll("#dTags .d-tag")].map((e) => e.textContent).includes("YouTube");
    out.reload = !!document.querySelector("#dSide .d-reload");
    localStorage.setItem("ft-crate", "[]");
    return out;
  });
  check(extras.fires === "4" && extras.wks === "3 wks,2 wks", "chart rows show fires (not counted) and weeks on the chart (" + extras.fires + " / " + extras.wks + ")");
  check(extras.newOnly === "First Single|#3", "New releases narrows the chart and keeps each song's place (" + extras.newOnly + ")");
  check(/12 messages this hour/.test(extras.live), "the live line says how busy the chat is (" + extras.live + ")");
  check(extras.nights === "Italo Night" && extras.night === "Italo Night|3|#discover/themes/nT1", "theme nights, and a night's songs in order (" + extras.nights + " / " + extras.night + ")");
  check(extras.saved === "One,Two,Three", "Save all puts a whole list in the crate (" + extras.saved + ")");
  check(extras.playing === "night:night00001" && extras.source && extras.reload, "Play the night; the player names the source and can reload (" + JSON.stringify(extras) + ")");

  console.log("-- Discover: share a chart as a link, an image or an embed");
  await dPage.evaluate(async () => { location.hash = "#discover/charts"; await new Promise((r) => setTimeout(r, 400)); });
  await dPage.click("#dBrowse .d-share");
  const shareItems = await dPage.$$eval("#dMenu .d-menuitem span", (els) => els.map((e) => e.textContent).join("|"));
  const [download] = await Promise.all([dPage.waitForEvent("download", { timeout: 15000 }).catch(() => null), dPage.click('#dMenu [data-share="image"]')]);
  const png = download ? await download.createReadStream().then((st) => new Promise((ok) => { const parts = []; st.on("data", (d) => parts.push(d)); st.on("end", () => ok(Buffer.concat(parts))); })) : null;
  check(shareItems === "Copy a link|Save as an image|Put it on your site", "the chart's share menu (" + shareItems + ")");
  check(!!(png && png.length > 20000 && png.slice(1, 4).toString() === "PNG" && png.readUInt32BE(16) === 1080 && png.readUInt32BE(20) === 1350),
    "Save as an image makes a 1080 × 1350 picture of the chart (" + (download ? download.suggestedFilename() + ", " + (png ? png.length : 0) + " bytes" : "no download") + ")");
  await dPage.click("#dBrowse .d-share");
  await dPage.click('#dMenu [data-share="embed"]');
  const embedCode = await dPage.$eval("#dEmbedBox textarea", (el) => el.value).catch(() => "");
  await dPage.evaluate(() => document.getElementById("dEmbedBox").close());
  check(/<iframe src="http:\/\/127\.0\.0\.1:\d+\/embed\/chart\/\?period=week" /.test(embedCode), "Put it on your site gives the iframe code for the latest week (" + embedCode.slice(0, 90) + ")");
  const embed = await context.newPage();
  embed.on("pageerror", (e) => pageErrors.push("Embed: " + e.message));
  await embed.route("**/config.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: CONFIG }));
  await embed.goto(SITE + "embed/chart/?period=week", { waitUntil: "load" });
  await embed.waitForFunction(() => document.querySelectorAll("#chart li").length > 0, null, { timeout: 15000 }).catch(() => {});
  const shown = await embed.evaluate(() => ({
    rows: [...document.querySelectorAll("#chart .e-song b")].map((e) => e.textContent).join(),
    head: (document.querySelector("#chart header p") || {}).textContent,
    links: [...document.querySelectorAll("#chart a")].every((a) => a.target === "_blank")
  }));
  await embed.close();
  check(shown.rows === "Song,Song,First Single" && /^Week 45/.test(shown.head || "") && shown.links, "the embed shows the latest week's chart, every link opening the room (" + JSON.stringify(shown) + ")");

  console.log("-- Discover: one search for both sides");
  const search = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(100);
    document.getElementById("dSearchOpen").click();
    await wait(100);
    const out = { mode: document.body.classList.contains("ft-discover"), focused: document.activeElement && document.activeElement.id };
    const q = document.getElementById("dQ");
    q.value = "ital";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(600);
    out.hash = location.hash;
    out.nights = [...document.querySelectorAll("#dBrowse .d-night b")].map((e) => e.textContent).join();
    q.value = "single";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(600);
    out.songs = [...document.querySelectorAll("#dBrowse .hist-track-title")].map((e) => e.textContent).join();
    out.yt = !!document.querySelector("#dBrowse .d-ytsearch");
    return out;
  });
  check(search.mode && search.focused === "dQ", "the header's search opens Discover's search box from Live (" + JSON.stringify(search) + ")");
  check(search.hash === "#discover/search/ital" && search.nights === "Italo Night" && search.songs === "First Single",
    "search finds theme nights and songs as you type, with its own address (" + JSON.stringify(search) + ")");
  check(!search.yt, "YouTube search is for members only (it uses the site's quota)");

  console.log("-- Every name is a door: Live's lists and stage link to Discover, titles open the song sheet");
  await put("/newMusic", { f1: { artist: "Alpha & Beta", title: "Fav One", dj: "dj1", djid: "dj1", type: 1, cid: "lib0000001", when: now - 3600000,
    url: "https://www.youtube.com/watch?v=lib0000001", img: "https://i.ytimg.com/vi/lib0000001/mqdefault.jpg", colors: { color: "#333", txt: "#fff" } } });
  await put("/globalTracks/1lib0000001", { artist: "Alpha & Beta", title: "Fav One", type: 1, song: "sL1" });
  await put("/globalSongs/sL1", { artist: "Alpha & Beta", title: "Fav One", plays: 30, first_play_date: now - 400 * 86400000, first_play_dj: "dj1", genres: ["Nu-Disco"] });
  const doors = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await wait(100); return fn(); };
    location.hash = "#live";
    await ftapi.watchFeed("fresh");
    await until(() => document.querySelector("#thediscovers .fresh-track-artist a"));
    const out = {};
    out.artistLinks = [...document.querySelectorAll("#thediscovers .fresh-track-artist a")].map((a) => a.getAttribute("href")).join();
    out.stageArtist = (document.querySelector("#artist a") || {}).getAttribute ? document.querySelector("#artist a").getAttribute("href") : null;
    out.titleButton = (document.querySelector("#thediscovers .fresh-track-title") || {}).getAttribute("role");
    document.querySelector("#thediscovers .fresh-track-title").click();
    await until(() => document.querySelector("#dSheetBox[open] #dSheetHist b"));
    const sheet = document.getElementById("dSheetBox");
    out.sheet = (sheet.querySelector(".d-title") || {}).textContent + "|" + (sheet.querySelector("#dSheetHist") || {}).textContent;
    sheet.querySelector(".closeModal").click();
    document.getElementById("track").click();
    await until(() => /playing in the room now/.test((document.getElementById("dSheetHist") || {}).textContent || ""));
    out.stageSheet = document.getElementById("dSheetHist").textContent;
    document.getElementById("dSheetBox").close();
    const robot = document.querySelector("#thediscovers .pv-dj-avatar");
    if (robot) robot.click();
    await wait(300);
    out.robot = location.hash;
    return out;
  });
  check(doors.artistLinks === "#discover/artist/alpha,#discover/artist/beta" && /^#discover\/artist\//.test(doors.stageArtist || "") && doors.titleButton === "button",
    "in Live, artist names link to their pages and titles are buttons (" + JSON.stringify(doors) + ")");
  check(/^Fav One\|.*30 plays/.test(doors.sheet || "") && /playing in the room now/.test(doors.stageSheet || ""), "a title opens its song sheet, with the room's plays; the stage's says it's playing now");
  check(doors.robot === "#discover/djs/dj1", "a DJ's robot in Live opens their DJ page (" + doors.robot + ")");

  console.log("-- Discover: joining opens the sign-in form over the page, and it goes back after");
  const join = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    location.hash = "#discover";
    await wait(300);
    document.querySelector('#dSide [data-sidetab="list"]').click();
    await wait(100);
    document.querySelector("#dSide .d-login").click();
    await wait(200);
    const dlg = document.getElementById("joinBox");
    const out = { open: !!(dlg && dlg.open), inside: !!(dlg && dlg.querySelector("#login")), form: ["createscreen", "logscreen"].filter((id) => !document.getElementById(id).hidden).join(),
      title: dlg && dlg.querySelector("#joinTitle").textContent, focused: document.activeElement && document.activeElement.id, stillDiscover: document.body.classList.contains("ft-discover") };
    dlg.close();
    // the dialog's close event comes a moment later, and puts the form back
    for (let i = 0; i < 40 && document.getElementById("login").parentElement.id !== "mainGrid"; i++) await wait(50);
    out.back = document.getElementById("login").parentElement.id;
    return out;
  });
  check(join.open && join.inside && join.form === "logscreen" && join.focused === "loginemail" && join.stillDiscover,
    "Log in opens the form in a dialog, on Discover (" + JSON.stringify(join) + ")");
  check(join.back === "mainGrid", "closing it puts the form back in the page (" + join.back + ")");

  console.log("-- Discover: genres, DJs, artists and years from the weekly library");
  const libPages = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    const out = {};
    location.hash = "#discover/genres";
    await until(() => document.querySelector("#dBrowse .d-map .d-mapg"));
    out.genres = [...document.querySelectorAll("#dBrowse .d-mapg")].map((a) => a.textContent).join() + "|" + document.querySelectorAll("#dBrowse .d-gcard").length;
    document.querySelector('.d-chip[data-decade="2020"]').click();
    out.decade = [...document.querySelectorAll("#dBrowse .d-mapg")].map((a) => a.textContent + (a.classList.contains("d-quiet") ? "(quiet)" : "")).join() + "|" + document.querySelector("#dBrowse .d-gcard .d-gfact").textContent;
    document.querySelector('.d-chip[data-decade=""]').click();
    out.navOn = document.querySelector("#dNav .d-nav.on").getAttribute("data-view");
    document.querySelector('#dBrowse .d-gcard[href="#discover/genres/nu-disco"]').click();
    await until(() => document.querySelector("#dBrowse .d-pagehead h2"));
    out.genre = document.querySelector("#dBrowse .d-pagehead h2").textContent + "|" + document.querySelectorAll("#dBrowse .ft-rows .pvbar").length + "|" + location.hash;
    out.about = (document.querySelector("#dBrowse .d-about") || {}).textContent;
    await until(() => document.querySelector("#dBrowse .d-ytm"));
    out.ytm = (document.querySelector("#dBrowse .d-ytm") || { getAttribute: () => null }).getAttribute("href");
    out.artistLinks = [...document.querySelectorAll("#dBrowse .ft-rows .hist-track-artist a")].slice(0, 2).map((a) => a.getAttribute("href")).join();
    out.who = [...document.querySelectorAll("#dBrowse .d-person")].map((p) => p.getAttribute("href")).join();
    document.querySelector('.d-chip[data-gtab="newHere"]').click();
    out.newHere = [...document.querySelectorAll("#dBrowse .hist-track-title")].map((e) => e.textContent).join();
    document.querySelector("#dBrowse .d-radio").click();
    await wait(200);
    out.radio = firetable.discover.state().list + "|" + (document.querySelector("#dSide .d-from") || {}).textContent;
    location.hash = "#discover/djs/dj1";
    await until(() => document.querySelector("#dBrowse .d-taste"));
    out.userCardLink = firetable.discover.djPage("dj1", "dj1");
    out.dj = document.querySelector("#dBrowse .d-pagehead h2").textContent + "|" + document.querySelector("#dBrowse .d-pagehead .d-fact").textContent;
    location.hash = "#discover/artist/alpha";
    const h2 = (text) => () => (document.querySelector("#dBrowse .d-pagehead h2") || {}).textContent === text;
    await until(h2("Alpha"));
    out.artist = document.querySelector("#dBrowse .d-pagehead h2").textContent + "|" + document.querySelectorAll("#dBrowse .ft-rows .pvbar").length;
    location.hash = "#discover/years/2026";
    await until(h2("2026"));
    out.year = document.querySelectorAll("#dBrowse .ft-rows .pvbar").length + "|" + document.querySelectorAll("#dBrowse .ft-cards .pvbar").length;
    location.hash = "#discover/djs/nobody";
    await until(() => document.querySelector("#dBrowse .d-empty") && !/Loading/.test(document.querySelector("#dBrowse .d-empty").textContent));
    out.missing = document.querySelector("#dBrowse .d-empty").textContent;
    // the song menu: the artist, the DJ, the song's link
    location.hash = "#discover/genres/nu-disco";
    await until(() => document.querySelector("#dBrowse .d-more"));
    document.querySelector("#dBrowse .d-more").click();
    out.menu = [...document.querySelectorAll("#dMenu .d-menuitem span")].map((e) => e.textContent).join("|");
    document.body.click();
    out.menuClosed = document.getElementById("dMenu").hidden;
    return out;
  });
  check(libPages.genres === "Nu-Disco,Soul & R&B|2" && libPages.navOn === "genres", "Genres: the sound map and a card for each (" + libPages.genres + ")");
  check(libPages.decade === "Nu-Disco,Soul & R&B(quiet)|100 plays in the 2020s" && libPages.about === "Disco's grooves rebuilt with modern synths.",
    "the sound map by decade, and a genre's line (" + libPages.decade + " / " + libPages.about + ")");
  check(libPages.ytm === "https://music.youtube.com/playlist?list=PLsmokeNuDisco", "a genre page links to its YouTube Music playlist (" + libPages.ytm + ")");
  check(libPages.genre === "Nu-Disco|2|#discover/genres/nu-disco" && libPages.newHere === "New One", "a genre page, its favorites and New here (" + libPages.genre + " / " + libPages.newHere + ")");
  check(libPages.artistLinks === "#discover/artist/alpha,#discover/artist/beta" && libPages.who === "#discover/djs/dj1", "artists and DJs link to their pages (" + libPages.artistLinks + " / " + libPages.who + ")");
  check(/^radio\|.*Nu-Disco radio/.test(libPages.radio), "genre radio plays (" + libPages.radio + ")");
  check(/^dj1\|.*Friday nights/.test(libPages.dj) && libPages.artist === "Alpha|1" && libPages.year === "1|1", "DJ, artist and year pages (" + [libPages.dj, libPages.artist, libPages.year].join(" / ") + ")");
  check(/no page for this DJ/.test(libPages.missing), "a DJ without a page says so (" + libPages.missing + ")");
  const lit = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    location.hash = "#discover/djs/dj1";
    const section = () => [...document.querySelectorAll("#dBrowse section")].find((x) => /Fires earned/.test(x.textContent));
    await until(section);
    const sec = section();
    const out = { fact: sec && sec.querySelector(".d-fact").textContent, rows: sec ? [...sec.querySelectorAll(".pvbar")].map((r) => r.querySelector(".hist-track-title").textContent + ":" + r.querySelector(".d-fires").textContent.replace(/\D/g, "")).join() : "",
      head: document.querySelector("#dBrowse .d-pagehead .d-fact").textContent };
    location.hash = "#discover/djs";
    await until(() => document.querySelector('.d-chip[data-djsort="fires"]'));
    document.querySelector('.d-chip[data-djsort="fires"]').click();
    out.list = (document.querySelector("#dDjList .d-person") || {}).textContent;
    document.querySelector('.d-chip[data-djsort="plays"]').click();
    return out;
  });
  check(/^7 fires on 3 plays since .* · #1 of 2 DJs$/.test(lit.fact || "") && lit.rows === "One:5,Two:2" && /7 fires/.test(lit.head),
    "a DJ page shows their fires earned and most-fired songs (" + JSON.stringify(lit) + ")");
  check(/7 fires/.test(lit.list || ""), "DJs can be sorted by fires (" + lit.list + ")");
  check(/Open on YouTube\|Go to Alpha\|Go to Beta\|dj1's DJ page\|Copy/.test(libPages.menu) && libPages.menuClosed, "the song menu (" + libPages.menu + ")");

  console.log("-- Discover: visitors in Live see what joining opens");
  await put("/cards/cardP", { owner: "dj1", cardnum: 5, djname: "dj1", djid: "dj1", title: "Printed Song", artist: "Printer", image: "img/idlogo.png", date: now, set: "set1" });
  await put("/songHistory", { lk1: { cid: "lockrec001", type: 1, artist: "Locked", title: "Recent One", dj: "dj1", djid: "dj1", when: now - 60000, img: "img/idlogo.png" } });
  const locked = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    const shown = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.offsetParent !== null; };
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(300);
    const out = { tabs: [...document.querySelectorAll("#dLocked .tab")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join(), form: shown("authBox") };
    const tab = (name) => document.querySelector('#dLocked [data-locked="' + name + '"]').click();
    tab("playlists");
    out.playlists = { form: shown("authBox"), text: /Your playlists/.test(document.getElementById("dLockedPane").textContent), join: !!document.querySelector("#dLockedPane .d-createaccount") };
    tab("recent");
    await until(() => document.querySelector('#dLockedPane .pvbar[data-cid="lockrec001"]'));
    out.recent = document.querySelectorAll("#dLockedPane .pvbar").length;
    document.querySelector('#dLockedPane .pvbar[data-cid="lockrec001"] .d-play').click();
    await wait(300);
    out.played = { discover: document.body.classList.contains("ft-discover"), playing: firetable.discover.state().playing };
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(200);
    tab("cards");
    await until(() => document.querySelectorAll("#dLockedPane canvas").length);
    out.cards = document.querySelectorAll("#dLockedPane canvas").length;
    tab("join");
    out.back = { form: shown("authBox"), pane: document.getElementById("dLockedPane").hidden };
    return out;
  });
  check(locked.tabs === "Join*,Playlists,Recent,Cards" && locked.form, "a visitor in Live sees Join, Playlists, Recent and Cards (" + JSON.stringify(locked) + ")");
  check(!locked.playlists.form && locked.playlists.text && locked.playlists.join, "Playlists says what joining gives, with Join the room (" + JSON.stringify(locked.playlists) + ")");
  check(locked.recent >= 1 && locked.played.discover && locked.played.playing === "lockrec001", "Recent lists the room's plays, and one plays in Discover (" + JSON.stringify({ n: locked.recent, played: locked.played }) + ")");
  check(locked.cards > 0 && locked.cards <= 3, "Cards shows the latest cards (" + locked.cards + ")");
  check(locked.back.form && locked.back.pane, "Join brings the form back (" + JSON.stringify(locked.back) + ")");

  console.log("-- Discover: members chat with the room from Discover");
  const chatHere = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login pre-auth");
    ftapi.uid = "smoke";
    firetable.discover.testSignedIn(true);
    const home = document.getElementById("actualChat").parentElement;
    location.hash = "#discover";
    await wait(300);
    const out = { tab: !!document.querySelector('#dSide [data-sidetab="chat"]'), nav: !!document.querySelector("#dNav .d-chatnav") };
    document.querySelector('#dSide [data-sidetab="chat"]').click();
    await wait(200);
    const chat = document.getElementById("actualChat");
    out.moved = !!chat.closest("#dSide .d-chathost") && document.body.classList.contains("d-chat-here");
    out.visible = chat.offsetParent !== null && document.getElementById("newchat").offsetParent !== null;
    // a message while on another tab counts as new
    document.querySelector('#dSide [data-sidetab="now"]').click();
    await wait(100);
    out.backOnNow = chat.parentElement === home;
    ftapi.events.emit("chatHistoryLoaded");
    ftapi.events.emit("newChat", { id: "dj1", txt: "hello" });
    ftapi.events.emit("newChat", { id: "smoke", txt: "mine" });
    out.unread = (document.querySelector('#dSide [data-sidetab="chat"] .d-unread') || {}).textContent;
    document.querySelector('#dSide [data-sidetab="chat"]').click();
    await wait(100);
    out.cleared = !document.querySelector('#dSide [data-sidetab="chat"] .d-unread');
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(300);
    out.live = { home: chat.parentElement === home, here: document.body.classList.contains("d-chat-here") };
    return out;
  });
  check(chatHere.tab && chatHere.nav, "members get a Chat tab in Discover (" + JSON.stringify(chatHere) + ")");
  check(chatHere.moved && chatHere.visible, "the room's chat, with its message box, opens in Discover's panel (" + JSON.stringify(chatHere) + ")");
  check(chatHere.backOnNow && chatHere.unread === "1" && chatHere.cleared, "on another tab, new messages from others are counted, and cleared on Chat (" + JSON.stringify(chatHere) + ")");
  check(chatHere.live.home && !chatHere.live.here, "Live gets its chat back (" + JSON.stringify(chatHere.live) + ")");

  console.log("-- Discover: members pick cards to feature on their DJ page");
  await put("/users/dj1/featured", ["cardP", "cardA"]); // cardA isn't dj1's: left out
  const featured = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await wait(100); return fn(); };
    const heads = () => [...document.querySelectorAll("#dBrowse .d-head h2")].map((e) => e.textContent);
    ftapi.uid = "dj1";
    firetable.discover.forgetFeatured("dj1"); // read before the picks were put
    location.hash = "#discover/djs/dj1";
    await until(() => document.querySelector('#dBrowse .d-card[data-card="cardP"]'));
    const out = { heads: heads().join("|"), cards: [...document.querySelectorAll("#dBrowse .d-card[data-card]")].map((b) => b.getAttribute("data-card")).join(),
      change: (document.querySelector("#dBrowse .d-pickcards") || {}).textContent };
    document.querySelector("#dBrowse .d-pickcards").click();
    await until(() => document.querySelector("#caseCardSpotcardP .cardFeature") && document.getElementById("cardFeaturedNote"));
    const spot = () => document.getElementById("caseCardSpotcardP");
    out.caseOpen = { live: !document.body.classList.contains("ft-discover"), view: firetable.nav.view, featured: spot().classList.contains("is-featured"),
      note: document.getElementById("cardFeaturedNote").textContent };
    const stored = () => ftapi.db().ref("users/dj1/featured").once("value").then((x) => x.val());
    spot().querySelector(".cardFeature").click();
    await until(() => !spot().classList.contains("is-featured"));
    out.off = { stored: await stored(), button: spot().querySelector(".cardFeature").textContent };
    spot().querySelector(".cardFeature").click();
    await until(() => spot().classList.contains("is-featured"));
    out.on = { stored: await stored(), note: document.getElementById("cardFeaturedNote").textContent };
    firetable.discover.testSignedIn(false);
    firetable.nav.setView("history"); // the next pages share this browser's saved view
    firetable.$appShell = $("#appShell").detach();
    return out;
  });
  check(featured.heads.startsWith("Featured cards") && featured.cards.split(",")[0] === "cardP" && featured.cards.split(",").filter((k) => k === "cardP").length === 1 && featured.change === "Change",
    "a DJ page shows the cards its DJ picked first, only theirs, and offers Change on your own (" + JSON.stringify(featured) + ")");
  check(featured.caseOpen.live && featured.caseOpen.view === "cards" && featured.caseOpen.featured && /^1 of 6/.test(featured.caseOpen.note),
    "Change opens the card case with the picks marked (" + JSON.stringify(featured.caseOpen) + ")");
  check(featured.off.stored === null && featured.off.button === "Feature on my DJ page" && JSON.stringify(featured.on.stored) === '["cardP"]',
    "Feature puts a card on the DJ page and takes it off (" + JSON.stringify({ off: featured.off, on: featured.on }) + ")");
} catch (e) {
  check(false, "Discover test threw: " + e.message);
}

// The library's plain pages (tools/plain-pages.mjs), built from the same data
// and loaded under the real policy, as search engines and visitors get them
const plain = await context.newPage();
plain.on("pageerror", (e) => { pageErrors.push("Plain pages: " + e.message); });
try {
  console.log("-- plain pages: the library as ordinary pages, with a sitemap");
  const { execFile } = await import("child_process");
  // not execFileSync: the builder reads config.js from this process's server
  const out = await new Promise((resolve, reject) => execFile(process.execPath,
    [join(ROOT, "tools/plain-pages.mjs"), "--site", SITE, "--out", join(ROOT, "music"), "--template", join(ROOT, "index.html"), "--always"],
    { env: { ...process.env, FIREBASE_DATABASE_URL: DB + "?ns=" + NS }, timeout: 60000 },
    (err, stdout, stderr) => (err ? reject(new Error(err.message + stderr)) : resolve(stdout))));
  check(/plain pages: \d+ pages/.test(out), "the pages are built (" + out.trim() + ")");
  await plain.exposeFunction("__cspViolation", (v) => violations.push("Plain pages: " + v));
  await plain.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation(e.violatedDirective + " blocked " + e.blockedURI));
  });
  await plain.route("**/config.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript",
    body: CONFIG.replace(/roomName:/, 'discover: true, roomName:') }));
  // what a search engine reads: the page as sent
  const raw = await (await fetch(SITE + "music/genres/nu-disco/")).text();
  const read = {
    title: (raw.match(/<title>([^<]*)/) || [])[1],
    canonical: /<link rel="canonical" href="[^"]*\/music\/genres\/nu-disco\/"/.test(raw),
    h1: /<div class="d-pagetext"><h1>Nu-Disco<\/h1>/.test(raw),
    rows: (raw.match(/class="hist-entry"/g) || []).length,
    artist: /href="\/music\/artists\/alpha\/">Alpha<\/a> &amp; Beta/.test(raw),
    dj: /href="\/music\/djs\/dj1\/"/.test(raw),
    ld: /"@type":"MusicPlaylist"/.test(raw),
    ytm: /class="butt graybutt d-ytm" href="https:\/\/music\.youtube\.com\/playlist\?list=PLsmokeNuDisco"/.test(raw) && /"sameAs":"https:\/\/music\.youtube\.com\/playlist\?list=PLsmokeNuDisco"/.test(raw),
    site: /id="mainGrid"/.test(raw) && /<base href="\/"/.test(raw) && /class="ft-has-discover ft-discover"/.test(raw)
  };
  check(/^Nu-Disco songs/.test(read.title) && read.canonical && read.h1 && read.rows === 3 && read.ld && read.site,
    "a genre page as sent: the site itself, with the genre's songs already in Discover, and its own title and address (" + JSON.stringify(read) + ")");
  check(read.artist && read.dj, "artists and DJs link to their pages, only where a page exists");
  check(read.ytm, "a genre page as sent links to its YouTube Music playlist");
  // what a visitor gets: the real site, on the same Discover page
  await plain.goto(SITE + "music/genres/nu-disco/", { waitUntil: "load" });
  await plain.waitForFunction(() => document.querySelector("#dBrowse .d-radio"), null, { timeout: 20000 }).catch(() => {});
  const live = await plain.evaluate(() => ({
    url: location.pathname + location.hash,
    discover: document.body.classList.contains("ft-discover"),
    tabs: !!document.getElementById("modeTabs"),
    live: !!document.querySelector("#dBrowse .d-radio") && !document.querySelector("#dBrowse[data-prerendered]"),
    h: (document.querySelector("#dBrowse .d-pagetext h2") || {}).textContent
  }));
  check(live.url === "/#discover/genres/nu-disco" && live.discover && live.tabs && live.live && live.h === "Nu-Disco",
    "a visitor lands in the real site, on that genre's Discover page (" + JSON.stringify(live) + ")");
  const sitemap = readFileSync(join(ROOT, "music/sitemap.xml"), "utf8");
  check(/\/music\/themes\/nT1\//.test(sitemap), "theme nights get pages too");
  check(/<loc>[^<]+\/music\/djs\/dj1\/<\/loc>/.test(sitemap) && /\/music\/years\/2026\//.test(sitemap) && /\/music\/charts\/week\/2026-W45\//.test(sitemap),
    "the sitemap lists the DJ, year and chart pages");
} catch (e) {
  check(false, "plain pages test threw: " + e.message);
} finally {
  const { rmSync } = await import("fs");
  rmSync(join(ROOT, "music"), { recursive: true, force: true });
}

console.log("-- errors");
check(violations.length === 0, "nothing blocked by the Content-Security-Policy" + (violations.length ? ": " + [...new Set(violations)].join("; ") : ""));
check(pageErrors.length === 0, "no page errors" + (pageErrors.length ? ": " + pageErrors.join("; ") : ""));

await browser.close();
server.close();
console.log(failures ? "\n" + failures + " SMOKE CHECK(S) FAILED" : "\nsmoke: all passed");
process.exit(failures ? 1 : 0);
