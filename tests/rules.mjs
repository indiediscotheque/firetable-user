// Rules test: the site's own reads and writes against the hostbot's real
// database rules (firetable-hostbot/firebase-rules.json), as real signed-in
// accounts in the auth emulator. smoke.mjs runs on open rules with a pretend
// sign-in, so it can't see a write the rules refuse; this can. Fails on any
// "permission_denied" from the database, and lists the paths.
//
// Run (needs Java 21 for the emulators, and the hostbot's rules):
//   cd tests && npm ci && HOSTBOT_RULES=../../firetable-hostbot/firebase-rules.json npm run rules
// HOSTBOT_RULES defaults to a firetable-hostbot checkout next to this repo.
// Never deployed. CI: .github/workflows/smoke.yml
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { chromium } from "playwright";
import { ROOT, DB, AUTH, policy, config, putAs, serveSite, launchOptions, sleep } from "./harness.mjs";

const NS = "demo-rules";
const put = putAs(NS);
const RULES = resolve(process.env.HOSTBOT_RULES || join(ROOT, "../firetable-hostbot/firebase-rules.json"));
if (!existsSync(RULES)) {
  console.error("No hostbot rules at " + RULES + ". Check out indiediscotheque/firetable-hostbot next to this repo, or set HOSTBOT_RULES.");
  process.exit(1);
}

// The hostbot's rules, exactly as published
const set = await fetch(DB + "/.settings/rules.json?ns=" + NS, { method: "PUT", headers: { Authorization: "Bearer owner" }, body: readFileSync(RULES) });
if (!set.ok) { console.error("The emulator refused the rules: " + await set.text()); process.exit(1); }

/** A real account in the auth emulator (made, or reused from an earlier run); resolves its uid. */
async function account(email) {
  const call = (what) => fetch(AUTH + "/identitytoolkit.googleapis.com/v1/accounts:" + what + "?key=fake-key", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "rules-pass-1", returnSecureToken: true })
  }).then((r) => r.json());
  let j = await call("signUp");
  if (j.error && j.error.message === "EMAIL_EXISTS") j = await call("signInWithPassword");
  if (!j.localId) throw new Error("auth emulator: " + JSON.stringify(j));
  return j.localId;
}
await fetch(AUTH + "/emulator/v1/projects/" + NS + "/accounts", { method: "DELETE" }).catch(() => {});
const FAN = await account("fan@rules.test");
const MOD = await account("modsy@rules.test");

// The room as the bot leaves it, with a member (fan) and a mod (modsy)
const now = Date.now();
await put("/", {
  users: {
    [FAN]: { username: "fan" }, [MOD]: { username: "modsy", mod: true },
    dj1: { username: "dj1", status: true }, bot: { username: "bot", hostbot: true }
  },
  nameClaim: { fan: FAN, modsy: MOD, dj1: "dj1", bot: "bot" },
  table: [{ name: "dj1", id: "dj1", plays: 1 }], playdex: 0, playlimit: 2,
  songToPlay: { type: 1, cid: "dQw4w9WgXcQ", title: "Rules Song", artist: "Rules Artist", started: now, duration: 300, djid: "dj1", djname: "dj1" },
  cards: { card1: { owner: FAN, cardnum: 1 } },
  chatData: { other1: { id: "dj1", name: "dj1", txt: "hello room", time: now, feedID: "fother1" } },
  chatFeed: { fother1: { chatID: "other1" } },
  songHistory: { h1: { type: 1, cid: "dQw4w9WgXcQ", artist: "Old Artist", title: "Old Title", dj: "dj1", djid: "dj1", when: now - 60000 } },
  globalTracks: { "1dQw4w9WgXcQ": { artist: "Old Artist", title: "Old Title" } },
  mentions: { [FAN]: { m1: { from: "dj1", fromId: "dj1", txt: "@fan hi", time: now, read: false } } },
  pushKey: "B" + "A".repeat(86)
});

const CSP = policy({ auth: true });
const { server, SITE } = await serveSite({ csp: CSP, configJs: config(NS) });
const browser = await chromium.launch(launchOptions());

let failures = 0;
const check = (ok, msg) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) failures++; };

/** A page signed in as `email`, recording every read or write the database refuses. */
async function signedIn(email, uid) {
  const page = await (await browser.newContext()).newPage();
  const denied = [], errors = [];
  page.on("console", (m) => { if (/permission[_ ]denied/i.test(m.text())) denied.push(m.text().replace(/^.*FIREBASE WARNING:\s*/, "")); });
  page.on("pageerror", (e) => errors.push(e.message));
  // Point the site's Firebase app at the auth emulator the moment it's made,
  // before anything signs in (no change to the site's code)
  await page.addInitScript((authUrl) => {
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
  await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.ftapi && ftapi.started, null, { timeout: 30000 });
  await page.evaluate((e) => ftapi.actions.logIn(e, "rules-pass-1", (err) => { window.__loginError = String(err && err.message); }), email);
  await page.waitForFunction((u) => ftapi.uid === u && ftapi.queueRef && !window.__loginError, uid, { timeout: 30000 })
    .catch(async () => { throw new Error("couldn't sign in as " + email + ": " + await page.evaluate(() => window.__loginError)); });
  await sleep(1500); // presence, idle, join date, playlist and inbox listeners settle
  return { page, denied, errors };
}

/** Run a step in the page and give its writes time to be answered. */
async function step(s, name, fn, arg) {
  const before = s.denied.length;
  let threw = null;
  try { await s.page.evaluate(fn, arg); } catch (e) { threw = e.message.split("\n")[0]; }
  await sleep(700);
  const now = s.denied.slice(before);
  check(!threw && !now.length, name + (threw ? " (threw: " + threw + ")" : "") + (now.length ? " — refused: " + [...new Set(now)].join("; ") : ""));
}

try {
  console.log("-- a member (rules: " + RULES + ")");
  const fan = await signedIn("fan@rules.test", FAN);
  check(!fan.denied.length, "signing in: presence, idle, join date, playlist, inbox" + (fan.denied.length ? " — refused: " + [...new Set(fan.denied)].join("; ") : ""));
  fan.denied.length = 0;

  // the test itself: a refused write, even one whose error is caught, is seen
  await fan.page.evaluate(() => ftapi.db().ref("table").set({ hijack: true }).catch(() => {}));
  await sleep(700);
  check(fan.denied.some((d) => /\/table/.test(d)), "a write the rules refuse is caught by this test (" + fan.denied.join("; ") + ")");
  fan.denied.length = 0;

  await step(fan, "chat: send a message (message and feed entry in one write)", () => ftapi.actions.sendChat("hello from the rules test"));
  await step(fan, "chat: a bot command", () => ftapi.actions.sendBotCommand("!rulescheck"));
  await step(fan, "chat: typing, then stop", async () => { firetable.actions.setTyping(true); await new Promise((r) => setTimeout(r, 300)); firetable.actions.setTyping(false); });
  await step(fan, "chat: react, then take it back", async () => {
    firetable.actions.toggleReaction("other1", "fire");
    await new Promise((r) => setTimeout(r, 500));
    firetable.ui.renderReactions("other1", { fire: { [ftapi.uid]: true } });
    firetable.actions.toggleReaction("other1", "fire");
  });
  await step(fan, "mentions: mark read, delete one", async () => {
    await ftapi.db().ref("mentions/" + ftapi.uid + "/m1/read").set(true);
    if (firetable.actions.markInboxRead) firetable.actions.markInboxRead();
    await ftapi.db().ref("mentions/" + ftapi.uid + "/m1").remove();
  });

  await step(fan, "playlists: make a list, add tracks, reorder, shuffle, delete a track", async () => {
    const id = ftapi.actions.createList("Rules list");
    window.__list = id;
    ftapi.actions.switchList(id);
    await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => ftapi.actions.addToList(1, "Artist A - Song A", "aaaaaaaaaaa", id, r, "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg", "https://www.youtube.com/watch?v=aaaaaaaaaaa"));
    await new Promise((r) => ftapi.actions.addToList(1, "Artist B - Song B", "bbbbbbbbbbb", id, r));
    await new Promise((r) => ftapi.actions.addTrackToTop(ftapi.lookup.listRef(id), { type: 2, name: "Artist C - Song C", cid: 123456, url: "https://soundcloud.com/a/c" }, null, null, r));
    const keys = await ftapi.lookup.listRef(id).once("value").then((s) => Object.keys(s.val() || {}));
    ftapi.actions.moveTrackToBottom(keys[0], () => {});
    await new Promise((r) => setTimeout(r, 300));
    ftapi.actions.shuffleList();
    await new Promise((r) => setTimeout(r, 300));
    const now = await ftapi.lookup.listRef(id).once("value").then((s) => Object.keys(s.val() || {}));
    ftapi.actions.reorderList(now.slice().reverse());
    await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => ftapi.actions.deleteTrack(now[0], r));
  });
  await step(fan, "playlists: rename, order, format and default in your preferences", async () => {
    await firetable.actions.renameList(window.__list, "Rules list renamed");
    await firetable.actions.renameList("0", "My default");
    await firetable.actions.savePlaylistPrefs({ ["order/" + window.__list]: 1, ["format/" + window.__list]: "ytm", defaultList: window.__list });
  });
  await step(fan, "playlists: the DJ list, merge, de-duplicate, swap a flagged track and undo", async () => {
    ftapi.actions.switchDjList(window.__list);
    await new Promise((r) => ftapi.actions.addToList(1, "Artist A - Song A", "aaaaaaaaaaa", "0", r));
    await new Promise((r) => ftapi.actions.mergeLists("0", window.__list, r));
    await new Promise((r) => ftapi.actions.removeDuplicatesFromList(window.__list, r));
    const ref = ftapi.lookup.listRef("0");
    const key = Object.keys((await ref.once("value")).val())[0];
    // the bot's flag and suggestion (the owner may write their own list)
    await ref.child(key).update({ flagged: { date: Date.now(), code: 2 }, swap: { cid: "ccccccccccc", artist: "A", title: "S", kind: "audio", date: Date.now() } });
    const before = await ftapi.actions.swapTrack(ref, key, "aaaaaaaaaaa");
    if (before) await ftapi.actions.unswapTrack(ref, key, before, "ccccccccccc");
    await ftapi.actions.dismissSwap(ref, key, "aaaaaaaaaaa");
    ftapi.actions.unflagTrack(key);
  });
  await step(fan, "playlists: delete the list", () => firetable.actions.deleteLists([window.__list]));

  await step(fan, "profile: avatar style, public name, featured card", async () => {
    await ftapi.db().ref("users/" + ftapi.uid + "/avatarStyle").set("dicebear:pixel-art");
    await ftapi.db().ref("users/" + ftapi.uid + "/publicName").set(false);
    await ftapi.db().ref("users/" + ftapi.uid + "/featured").set(["card1"]);
    await ftapi.db().ref("users/" + ftapi.uid + "/featured").set(null);
  });
  await step(fan, "profile: change your name and back", async () => {
    await new Promise((r, j) => ftapi.actions.changeName("fan_two", (e) => (e ? j(new Error(e)) : r())));
    await new Promise((r, j) => ftapi.actions.changeName("fan", (e) => (e ? j(new Error(e)) : r())));
  });
  await step(fan, "the room: grab the DJ's song, idle and back, block and unblock", async () => {
    firetable.actions.recordGrab("dj1", 1, "dQw4w9WgXcQ");
    ftapi.actions.changeIdleStatus(true, 1);
    ftapi.actions.changeIdleStatus(false, 1);
    await new Promise((r) => ftapi.actions.blockUser("dj1", r));
    await new Promise((r) => setTimeout(r, 400));
    await new Promise((r) => ftapi.actions.unblockUser("dj1", r));
  });
  await step(fan, "log out (closed, offline, status)", () => ftapi.actions.logOut());
  check(!fan.errors.length, "no page errors for the member" + (fan.errors.length ? ": " + fan.errors.join("; ") : ""));

  console.log("-- a mod");
  const mod = await signedIn("modsy@rules.test", MOD);
  check(!mod.denied.length, "signing in" + (mod.denied.length ? " — refused: " + [...new Set(mod.denied)].join("; ") : ""));
  mod.denied.length = 0;
  await step(mod, "remove a chat message", () => ftapi.actions.deleteChat("fother1"));
  await step(mod, "fix a play's artist and title (history, global tags and the tag log)", () =>
    new Promise((r, j) => ftapi.actions.editTag(1, "dQw4w9WgXcQ", "New Artist - New Title", "h1", "songHistory", (e) => (e ? j(e) : r()))));
  check(!mod.errors.length, "no page errors for the mod" + (mod.errors.length ? ": " + mod.errors.join("; ") : ""));

  console.log("-- the writes landed");
  const db = await (await fetch(DB + "/.json?ns=" + NS, { headers: { Authorization: "Bearer owner" } })).json();
  const mine = Object.values(db.chatData || {}).filter((m) => m.id === FAN);
  const me = db.users[FAN] || {};
  const landed = {
    chat: mine.some((m) => m.txt === "hello from the rules test" && m.feedID && db.chatFeed[m.feedID].chatID),
    botCmd: mine.some((m) => m.botCmd === true),
    mention: !(db.mentions && db.mentions[FAN] && db.mentions[FAN].m1),
    lists: !db.playlists || !db.playlists[FAN] || !Object.keys(db.playlists[FAN]).length,
    queue: Object.keys((db.queues || {})[FAN] || {}).length >= 1,
    prefs: (db.playlistPrefs || {})[FAN] && db.playlistPrefs[FAN].defaultName === "My default",
    profile: me.username === "fan" && me.avatarStyle === "dicebear:pixel-art" && me.publicName === false && me.selectedList !== undefined,
    presence: me.status === false && typeof me.closed === "number" && typeof me.offlineAt === "number" && typeof me.joined === "number",
    grab: !!(db.grabs && db.grabs.dj1 && Object.values(db.grabs.dj1).some((t) => t[FAN])),
    hidden: db.chatFeed.fother1.hidden === true,
    tags: db.songHistory.h1.artist === "New Artist" && db.globalTracks["1dQw4w9WgXcQ"].title === "New Title" && Object.values(db.tagLog || {}).some((t) => t.by === MOD)
  };
  check(Object.values(landed).every(Boolean), "every step's write is in the database (" + JSON.stringify(landed) + ")");
} catch (e) {
  check(false, "rules test threw: " + e.message);
}

await browser.close();
server.close();
console.log(failures ? "\n" + failures + " RULES CHECK(S) FAILED" : "\nrules: the site's reads and writes all pass the hostbot's rules");
process.exit(failures ? 1 : 0);
