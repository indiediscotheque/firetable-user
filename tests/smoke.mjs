// Browser smoke test: serves this site locally under the real
// Content-Security-Policy from .htaccess, points it at a local database
// emulator, and loads it in Chromium. Fails on any page error or anything the
// policy blocks. Run (needs Java 21 for the emulator):
//   cd tests && npm ci && npm run smoke
// Never deployed. CI: .github/workflows/smoke.yml
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";
import { ROOT, DB, policy, config, putAs, serveSite, launchOptions, sleep, openPage, stubAvatars } from "./harness.mjs";
import { youtubeSong as seedSong, room, discover, library } from "./seed.mjs";

const NS = "demo-smoke";
const put = putAs(NS);
const CSP = policy();
const CONFIG = config(NS);
const { server, SITE } = await serveSite({ csp: CSP, configJs: CONFIG });

// the room as the bot leaves it (seed.mjs): a YouTube song playing, two DJs, a theme
const now = Date.now();
const youtubeSong = seedSong(now);
await put("/", room(now, youtubeSong));

let failures = 0;
const check = (ok, msg) => { console.log((ok ? "  PASS " : "  FAIL ") + msg); if (!ok) failures++; };

const browser = await chromium.launch(launchOptions());
// every context answers avatar requests itself (see stubAvatars)
const newContext = browser.newContext.bind(browser);
browser.newContext = async (opts) => { const c = await newContext(opts); await stubAvatars(c); return c; };
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
  await openPage(page, SITE + "#live"); // the room: Discover is always on (5.3), and these checks are about Live
  await page.waitForFunction(() => /Smoke Song/.test(document.getElementById("track").textContent), null, { timeout: 30000 });
  check(true, "the playing song shows (from the database)");
  check(await page.$eval("#themePillText", (el) => /smoke tests/.test(el.textContent)).catch(() => false), "the theme shows");
  check(!loaded("w.soundcloud.com/player/?") && await page.$eval("#sc-widget", (f) => !f.getAttribute("src") && !firetable.scwidget),
    "with a YouTube song playing, SoundCloud's player isn't loaded at all");
  // the stage fades to the song's colour (--color-accent is animated): wait for it to arrive
  await page.waitForFunction(() => {
    if (!document.documentElement.classList.contains("room-colors")) return false;
    const m = getComputedStyle(document.getElementById("stage")).getPropertyValue("--color-accent").match(/\d+/g);
    return !!m && Math.abs(m[0] - 204) + Math.abs(m[1] - 28) + Math.abs(m[2] - 44) <= 12;
  }, null, { timeout: 10000 }).catch(() => {});
  const colours = await page.evaluate(() => {
    const out = {
      on: document.documentElement.classList.contains("room-colors"),
      accent: getComputedStyle(document.getElementById("stage")).getPropertyValue("--color-accent").trim(),
      outside: getComputedStyle(document.body).getPropertyValue("--color-accent").trim(),
      injected: document.querySelectorAll("style.customColorStyles, style.playerControlsHider").length
    };
    const b = document.createElement("button");
    b.className = "previewicon";
    document.body.appendChild(b);
    firetable.ui.hidePlayerControls();
    out.mediaOff = getComputedStyle(b).display;
    firetable.ui.showPlayerControls();
    out.mediaOn = getComputedStyle(b).display;
    b.remove();
    return out;
  });
  // --color-accent is an animated (registered) property: compare within a few steps of #cc1c2c
  const near = (c, [r, g, b]) => { const m = String(c).match(/\d+/g); return !!m && Math.abs(m[0] - r) + Math.abs(m[1] - g) + Math.abs(m[2] - b) <= 12; };
  check(colours.on && near(colours.accent, [204, 28, 44]) && !near(colours.outside, [204, 28, 44]) && colours.injected === 0,
    "the song's colour reaches the stage from a stylesheet, not an injected <style> (" + JSON.stringify(colours) + ")");
  check(colours.mediaOff === "none" && colours.mediaOn !== "none", "media playback off hides the preview buttons (" + colours.mediaOff + " / " + colours.mediaOn + ")");

  console.log("-- the stage's avatars: asked for at the size they're drawn, on this screen");
  const sharpOn = (p) => p.evaluate(() => [...document.querySelectorAll("[data-stage-uid]")].map((e) => {
    const r = e.getBoundingClientRect();
    const drawn = Math.min(r.width || r.height, r.height || r.width);
    const asked = Number((e.style.backgroundImage.match(/size=(\d+)x/) || [])[1] || 0);
    return { drawn: Math.round(drawn), asked, sharp: !drawn || asked >= drawn * devicePixelRatio };
  }));
  await page.waitForFunction(() => document.querySelector("[data-stage-uid][data-stage-px]"), null, { timeout: 10000 }).catch(() => {});
  const sharp1 = await sharpOn(page);
  const retina = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
  const rPage = await retina.newPage();
  await openPage(rPage, SITE + "#live");
  await rPage.waitForFunction(() => document.querySelector("[data-stage-uid][data-stage-px]"), null, { timeout: 20000 }).catch(() => {});
  const sharp2 = await sharpOn(rPage);
  await retina.close();
  check(sharp1.length >= 2 && sharp1.every((a) => a.sharp) && sharp2.length >= 1 && sharp2.every((a) => a.sharp) && sharp2[0].asked >= 2 * sharp2[0].drawn,
    "the stage's avatars are asked for at their drawn size × the screen's density, so never stretched (" + JSON.stringify({ sharp1, sharp2 }) + ")");

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
  const entry = await page.evaluate(async () => {
    const btn = document.getElementById("nav-signin");
    const out = { shown: !!btn && btn.offsetParent !== null, label: document.getElementById("nav-signinLabel").textContent };
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const dlg = document.getElementById("joinBox");
    out.dialog = dlg.open && !!dlg.querySelector("#authBox");
    out.focused = document.activeElement && document.activeElement.id;
    out.title = document.getElementById("joinTitle").textContent;
    dlg.close();
    // one sign-in form on the site: the page itself has none
    out.oneForm = document.querySelectorAll("#authBox, #createAccountFormShell, #loginFormShell").length === 3 && !document.querySelector("#login #authBox, #mainGrid #authBox");
    return out;
  });
  check(entry.shown && entry.label === "Join" && entry.dialog && entry.focused === "newemail" && /^Join /.test(entry.title) && entry.oneForm,
    "the header's Join opens the site's one sign-in form, in a dialog (" + JSON.stringify(entry) + ")");
  await page.waitForFunction(() => typeof YT !== "undefined" && YT.Player, null, { timeout: 30000 }).catch(() => {});
  check(loaded("/s/player/") || loaded("www-widgetapi"), "YouTube's player API loaded under the policy");

  console.log("-- Settings: previews play over the room");
  await page.waitForFunction(() => firetable.ytLoaded, null, { timeout: 30000 }).catch(() => {});
  // YouTube's page can take the keyboard focus as a video loads (out of the chat
  // or search box); the stage's player is inert, so it never can
  const ytFrame = await page.evaluate(() => { const f = document.getElementById("playerArea"); return f && f.tagName === "IFRAME" ? { inert: f.inert, tab: f.getAttribute("tabindex") } : null; });
  check(!ytFrame || (ytFrame.inert && ytFrame.tab === "-1"), "the stage's YouTube player can't take the keyboard focus (" + JSON.stringify(ytFrame) + ")");
  // and if it takes it all the same, the focus goes back where it was
  const focusBack = await page.evaluate(async () => {
    const f = document.getElementById("playerArea");
    if (!f || f.tagName !== "IFRAME") return { skipped: true };
    // a text box on screen (a visitor's page has none outside the sign-in dialog: one for the test)
    const seen = [...document.querySelectorAll("#chatText, input[type=text], input[type=search], textarea")].find((e) => e.offsetParent !== null && !e.closest("dialog"));
    const box = seen || document.body.appendChild(Object.assign(document.createElement("input"), { id: "focusProbe" }));
    box.focus();
    f.inert = false; f.focus(); f.inert = true; // as YouTube's page taking it
    await new Promise((r) => setTimeout(r, 50));
    const out = { back: document.activeElement === box, was: box.id || box.name || box.tagName };
    if (!seen) box.remove();
    return out;
  });
  check(focusBack.skipped || focusBack.back, "if YouTube's player takes the focus all the same, it goes back where it was (" + JSON.stringify(focusBack) + ")");
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
  check(!loaded("p5.min.js"), "the album-art glitch's p5.js isn't loaded with the page");

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
  {
    // no connection: the site's own pages show offline.html (with its logo), other paths are left alone.
    // A context of its own, with no page of the room open while offline (the room's database falls back
    // to other transports when it loses its connection)
    const offCtx = await browser.newContext();
    const first = await offCtx.newPage();
    await first.goto(SITE + "about/");
    await first.evaluate(() => navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready));
    await first.close();
    const off = await offCtx.newPage();
    await offCtx.setOffline(true);
    const shown = {};
    for (const path of ["", "music/genres/nu-disco/", "about/"]) {
      await off.goto(SITE + path).catch(() => {});
      shown[path || "/"] = (await off.title().catch(() => "")) + "|" + await off.$eval("img", (i) => i.complete && i.naturalWidth > 0).catch(() => false);
    }
    const other = await off.goto(SITE + "basement/").then(() => "loaded", () => "browser error");
    await offCtx.close();
    check(Object.values(shown).every((v) => v === "Offline · Indie Discotheque|true") && other === "browser error",
      "offline, the site's pages show the offline page with its logo; other sites in the folder don't (" + JSON.stringify({ shown, other }) + ")");
  }
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

  console.log("-- \"Play on a speaker or TV\" guide");
  const cast = await page.evaluate(() => {
    const btn = document.getElementById("st-cast");
    btn.click();
    const dlg = document.getElementById("st-castBox");
    const ways = [...dlg.querySelectorAll("#st-castWays .installSteps")];
    const out = { open: dlg.open, order: ways.map((d) => d.dataset.way).join(), opened: ways.filter((d) => d.open).map((d) => d.dataset.way).join(),
      steps: dlg.querySelectorAll(".installSteps li").length, label: btn.getAttribute("aria-label"), popup: btn.getAttribute("aria-haspopup"),
      icon: getComputedStyle(btn.querySelector("i")).fontFamily };
    dlg.querySelector(".closeModal").click();
    out.closed = !dlg.open;
    return out;
  });
  check(cast.open && cast.closed, "the cast button opens the speaker guide and its close button shuts it");
  check(cast.order === "chrome,bluetooth,airplay,android" && cast.opened === "chrome",
    "Chrome on a computer gets Google Cast first and open, the other ways one tap away (" + cast.order + " / " + cast.opened + ")");
  check(cast.steps >= 14 && cast.label === "Play on a speaker or TV" && cast.popup === "dialog", "the guide has its steps and the button says what it does");

  console.log("-- what a playlist is kept to");
  const formats = await page.evaluate(() => {
    const keep = firetable.plPrefs.format;
    const keepLists = firetable.allPlaylists;
    firetable.plPrefs.format = { scList: "sc", vidList: "video" };
    firetable.allPlaylists = { scList: { name: "SC finds", list: {} }, vidList: { name: "Videos", list: {} } };
    const out = {
      sc: firetable.utilities.listFormat("scList"),
      none: firetable.utilities.listFormat("0"),
      ytInSc: !!firetable.utilities.formatRefusal("scList", 1),
      scInSc: !firetable.utilities.formatRefusal("scList", 2),
      scInVideos: !!firetable.utilities.formatRefusal("vidList", 2),
      anyTakesBoth: !firetable.utilities.formatRefusal("0", 1) && !firetable.utilities.formatRefusal("0", 2),
      videoHelp: /videos as swaps, never audio/.test(firetable.utilities.LIST_FORMATS.video.help)
    };
    // a list kept to videos: its swap card says the match is the artist's video
    const keepView = firetable.viewListID;
    firetable.viewListID = "vidList";
    out.viewingVideos = firetable.utilities.viewingVideoList();
    firetable.viewListID = "0";
    out.viewingAny = firetable.utilities.viewingVideoList();
    firetable.viewListID = keepView;
    // the picker in All Playlists shows each list's setting
    firetable.plIndex.defaultTracks = {};
    firetable.ui.renderPlaylistIndex();
    out.picker = $('#plIndexList .plx-row[data-id="scList"] .plx-format').val();
    out.pickerNone = $('#plIndexList .plx-row[data-id="0"] .plx-format').val();
    out.options = $('#plIndexList .plx-row[data-id="0"] .plx-format option').length;
    // Find a playlist narrows the rows and stops reordering; select-all takes the rows shown
    $("#cr-plFilter").val("sc f").trigger("input");
    out.shown = $("#plIndexList .plx-row:not([hidden])").map(function () { return this.getAttribute("data-id"); }).get().join(",");
    out.filtered = $("#plIndexList").hasClass("is-filtered") && /1 of 3/.test($("#cr-plTotal").text());
    $("#cr-plSelectAll").prop("checked", true).trigger("change");
    out.selected = Object.keys(firetable.plIndex.selected).filter(function (k) { return firetable.plIndex.selected[k]; }).join(",");
    $("#plIndexClearSel").trigger("click");
    $("#cr-plFilter").val("").trigger("input");
    // a row's ⋮ menu: Delete asks to confirm just that list; the built-in list can't be deleted
    $('#plIndexList .plx-row[data-id="vidList"] .plx-more').trigger("click");
    const menu = document.getElementById("cr-plRowMenu");
    out.menuOpen = menu.matches(":popover-open");
    $(menu).find('[data-act="delete"]').trigger("click");
    out.confirm = $("#plIndexDelete").hasClass("confirming") && /Delete Videos\?/.test($("#plIndexCount").text()) && !$("#plIndexBulk").prop("hidden");
    $("#plIndexClearSel").trigger("click");
    $('#plIndexList .plx-row[data-id="0"] .plx-more').trigger("click");
    out.builtInLocked = $(menu).find('[data-act="delete"]').prop("disabled");
    menu.hidePopover();
    firetable.plPrefs.format = keep;
    firetable.allPlaylists = keepLists;
    return out;
  });
  check(formats.sc === "sc" && formats.none === "" && formats.ytInSc && formats.scInSc && formats.scInVideos && formats.anyTakesBoth,
    "a SoundCloud list takes SoundCloud only, a videos list YouTube only, an unset list anything (" + JSON.stringify(formats) + ")");
  check(formats.picker === "sc" && formats.pickerNone === "" && formats.options === 4, "All Playlists shows each list's setting, with four choices");
  check(formats.shown === "scList" && formats.filtered && formats.selected === "scList", "All Playlists: Find a playlist shows the matches, and select-all takes only those (" + JSON.stringify(formats) + ")");
  check(formats.menuOpen && formats.confirm && formats.builtInLocked, "All Playlists: a row's ⋮ menu deletes that list after a confirm; the built-in list can't be deleted");
  check(formats.videoHelp && formats.viewingVideos && !formats.viewingAny, "a videos list gets the artist's videos as swaps, and its swap card says so (" + JSON.stringify(formats) + ")");

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

  console.log("-- a playlist track's tags before it's played: ⋮ Edit tags, Undo, Swap artist and title");
  await put("/queues/smoke/k5", { type: 1, cid: "relvideo001", name: "Release - Fresh Song" });
  const tagUi = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
    const row = document.querySelector('#mainqueue .pvbar[data-key="k5"]');
    const out = { more: getComputedStyle(row.querySelector(".row-more")).display !== "none" };
    row.querySelector(".row-more").click();
    await wait(150);
    out.swapShown = !document.querySelector('#trackMenuPopover [data-act="swaptags"]').hidden;
    document.querySelector('#trackMenuPopover [data-act="tags"]').click();
    await wait(200);
    out.editor = document.getElementById("tagEditorPopover").matches(":popover-open") && document.getElementById("tagMachine").value;
    document.getElementById("tagMachine").value = "New Band - Fresh Song";
    document.querySelector("#tagEditorForm .tagSave").click();
    return out;
  });
  check(tagUi.more && tagUi.swapShown && tagUi.editor === "Release - Fresh Song", "⋮ on a playlist row opens the tag editor with its name (" + JSON.stringify(tagUi) + ")");
  await sleep(800);
  q = await listNow();
  check(q.k5.name === "New Band - Fresh Song" && q.k5.cid === "relvideo001", "Save renames the track in the playlist");
  await page.evaluate(() => document.querySelector("#ft-toast .ft-toast-action").click());
  await sleep(800);
  q = await listNow();
  check(q.k5.name === "Release - Fresh Song", "Undo puts the old name back");
  await page.evaluate(async () => {
    await ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
    firetable.actions.swapTrackTags($('#mainqueue .pvbar[data-key="k5"]'));
  });
  await sleep(800);
  q = await listNow();
  check(q.k5.name === "Fresh Song - Release", "Swap artist and title flips the name");
  await put("/queues/smoke/k5", null);
  await page.evaluate(() => ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0")));

  console.log("-- the playlist's tools: two rows, a ⋮ menu for the list, Show only for the filters");
  const tools = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login");
    firetable.nav.view = "playlists";
    firetable.nav.apply();
    await wait(100);
    const out = {};
    const top = document.querySelector(".queuetop").getBoundingClientRect();
    const sw = document.getElementById("listpicker").getBoundingClientRect(), more = document.getElementById("cr-listBtn").getBoundingClientRect(),
      find = document.getElementById("addToQueueBttn").getBoundingClientRect(), filt = document.getElementById("queueFilter").getBoundingClientRect(),
      show = document.getElementById("cr-showOnly").getBoundingClientRect();
    const mid = (r) => r.top + r.height / 2;
    out.rows = { oneRow: Math.abs(mid(sw) - mid(more)) < 3 && Math.abs(mid(more) - mid(find)) < 3, filterRow: Math.abs(mid(filt) - mid(show)) < 3 && filt.top > sw.bottom,
      height: Math.round(top.height), oldGone: ["plIndexBtn", "mergeLists", "plDeleteLauncher", "plAddLauncher"].every((id) => document.getElementById(id).offsetParent === null) };
    // Show only, Sort and Select: a glyph each (all in the icon font: a missing one would spill its name),
    // and at this width (1280px) their names beside them
    const three = ["cr-showOnly", "cr-sort", "cr-select"].map((id) => document.getElementById(id));
    out.three = { glyphs: three.map((b) => b.querySelector("i").textContent.trim()).join(), drawn: three.every((b) => { const i = b.querySelector("i"); return i.scrollWidth <= i.clientWidth + 1; }),
      names: three.map((b) => { const l = b.querySelector(".cr-toolLabel"); return l.getClientRects().length ? l.textContent : ""; }).join(),
      oneLine: three.every((b) => Math.abs(mid(b.getBoundingClientRect()) - mid(filt)) < 3), filter: Math.round(filt.width), wide: innerWidth };
    // each item does what its old button did
    const calls = [];
    const keep = { idx: firetable.actions.openPlaylistIndex, shuf: firetable.actions.shuffleQueuePrompt, check: firetable.actions.checkBrokenTracks };
    firetable.actions.openPlaylistIndex = () => calls.push("all");
    firetable.actions.shuffleQueuePrompt = (a) => calls.push("shuffle:" + (a && a.id));
    firetable.actions.checkBrokenTracks = (id) => { calls.push("check:" + id); return $.Deferred().resolve({ checked: 0, total: 0, broken: 0, newlyBroken: 0, fixed: 0, skipped: 0 }).promise(); };
    const imp = document.getElementById("importPromptBox");
    const menu = document.getElementById("cr-listMenu");
    const pick = async (act) => { document.getElementById("cr-listBtn").click(); await wait(80); out.opened = (out.opened || 0) + (menu.matches(":popover-open") ? 1 : 0); menu.querySelector('[data-act="' + act + '"]').click(); await wait(80); };
    await pick("all"); await pick("shuffle"); await pick("check");
    await pick("import"); out.import = imp.open; imp.close();
    await pick("new");
    out.create = document.getElementById("queueControls").classList.contains("cr-creating") && document.getElementById("plmaker").offsetParent !== null &&
      document.getElementById("plAddLauncher").offsetParent !== null && document.getElementById("cr-listBtn").offsetParent === null;
    document.getElementById("plmaker").dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    out.createEnds = !document.getElementById("queueControls").classList.contains("cr-creating") && document.getElementById("cr-listBtn").offsetParent !== null;
    await pick("merge"); await wait(300);
    out.merge = $("#mergeContain").is(":visible");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    out.mergeCloses = !$("#mergeContain").is(":visible");
    document.getElementById("cr-listBtn").click(); await wait(80);
    out.deleteOff = $("#listpicker").val() !== "0" || menu.querySelector('[data-act="delete"]').disabled;
    menu.hidePopover();
    Object.assign(firetable.actions, { openPlaylistIndex: keep.idx, shuffleQueuePrompt: keep.shuf, checkBrokenTracks: keep.check });
    out.calls = calls.join();
    // Show only: the two filters in a menu, counted on the button
    document.getElementById("cr-showOnly").click(); await wait(80);
    out.showOpen = document.getElementById("cr-showOnlyMenu").matches(":popover-open") && !!document.querySelector("#cr-showOnlyMenu #queueFilterRemixOnly");
    $("#queueFilterBrokenOnly").prop("checked", true).trigger("change");
    out.badge = document.getElementById("cr-showOnlyCount").textContent + "/" + document.getElementById("cr-showOnly").getAttribute("aria-label");
    $("#queueFilterBrokenOnly").prop("checked", false).trigger("change");
    out.badgeOff = document.getElementById("cr-showOnlyCount").hidden;
    document.getElementById("cr-showOnlyMenu").hidePopover();
    return out;
  });
  check(tools.three.glyphs === "tune,swap_vert,checklist" && tools.three.drawn && tools.three.oneLine && tools.three.filter >= 180 &&
    tools.three.names === (tools.three.wide >= 1200 ? "Show only,Sort,Select" : ",,"),
    "the crate's three tools each have their own glyph, and on a computer their names, with the filter box left its room (" + JSON.stringify(tools.three) + ")");
  check(tools.rows.oneRow && tools.rows.filterRow && tools.rows.height < 112 && tools.rows.oldGone,
    "the playlist, ⋮ and Find tracks share one row; the filter and Show only the next (" + JSON.stringify(tools.rows) + ")");
  check(tools.opened === 6 && tools.calls === "all,shuffle:cr-listBtn,check:" + (await page.evaluate(() => $("#listpicker").val())) && tools.import && tools.create && tools.createEnds && tools.merge && tools.mergeCloses && tools.deleteOff,
    "every ⋮ item reaches what its old button did: All playlists, Shuffle, Check, Import, New (with Cancel), Merge, Delete (" + JSON.stringify(tools) + ")");
  check(tools.showOpen && tools.badge === "1/Show only (1 on)" && tools.badgeOff, "Show only holds Remixes and Broken, and counts what's on (" + tools.badge + ")");

  console.log("-- the playlist's ⋮: Rename, Remove duplicates, Export; Show only: Duplicates, Not played here yet");
  const listBefore = await listNow(); // put back after: the drag test below goes on from it
  // the room played "Aa - One" under another upload (linked to its song); "Bb - Two" never
  await put("/globalTracks/1dupe000001", { artist: "Aa", title: "One", type: 1, song: "sDupe1" });
  await put("/globalSongs/sDupe1", { artist: "Aa", title: "One", plays: 2 });
  await put("/queues/smoke", { d1: { type: 1, cid: "dupe000001", name: "Aa - One" }, d2: { type: 1, cid: "dupe000002", name: "Bb - Two" }, d3: { type: 1, cid: "dupe000001", name: "Aa - One" } });
  const listTools = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    const realUid = ftapi.uid;
    ftapi.uid = "smoke";
    ftapi.queueRef = ftapi.db().ref("queues/smoke");
    await ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
    $("#listpicker").val("0");
    await wait(200);
    const out = {};
    const menu = document.getElementById("cr-listMenu");
    const pick = async (act) => { document.getElementById("cr-listBtn").click(); await wait(80); menu.querySelector('[data-act="' + act + '"]').click(); await wait(100); };
    out.items = [...menu.querySelectorAll("[data-act]")].map((b) => b.getAttribute("data-act")).join();
    // Show only: Duplicates leaves both copies of the song that's in twice
    $("#cr-dupesOnly").prop("checked", true).trigger("change");
    await wait(50);
    out.dupesShown = [...document.querySelectorAll("#mainqueue .pvbar:not(.ft-filtered)")].map((r) => r.getAttribute("data-cid")).join();
    out.badge = document.getElementById("cr-showOnlyCount").textContent;
    $("#cr-dupesOnly").prop("checked", false).trigger("change");
    out.allBack = document.querySelectorAll("#mainqueue .pvbar:not(.ft-filtered)").length;
    // Show only: Not played here yet asks the history, then leaves the song the room hasn't played
    $("#cr-unplayedOnly").prop("checked", true).trigger("change");
    out.unplayedBarOn = !document.getElementById("cr-unplayedBar").hidden;
    await until(() => /hasn't played/.test(document.getElementById("cr-unplayedBarText").textContent));
    await wait(50);
    out.unplayedShown = [...document.querySelectorAll("#mainqueue .pvbar:not(.ft-filtered)")].map((r) => r.getAttribute("data-cid")).join();
    out.unplayedBar = document.getElementById("cr-unplayedBarText").textContent;
    out.unplayedBadge = document.getElementById("cr-showOnlyCount").textContent;
    // the room plays it: it leaves the list without asking again
    firetable.actions.notePlayedHere(1, "dupe000002");
    await wait(100);
    out.afterPlay = document.querySelectorAll("#mainqueue .pvbar:not(.ft-filtered)").length + "|" + document.getElementById("cr-unplayedBarText").textContent + "|" + document.getElementById("mainqueue").classList.contains("overFiltered");
    document.getElementById("cr-unplayedOff").click();
    out.unplayedOff = !$("#cr-unplayedOnly").is(":checked") && document.getElementById("cr-unplayedBar").hidden && document.querySelectorAll("#mainqueue .pvbar:not(.ft-filtered)").length;
    // Export: the list as "Artist - Title" lines, in play order
    const made = URL.createObjectURL;
    let file = null;
    URL.createObjectURL = (blob) => { file = blob; return made.call(URL, blob); };
    await pick("export");
    await until(() => file);
    URL.createObjectURL = made;
    out.exported = file ? (await file.text()).trim().split("\n").join("|") : null;
    // Rename: a dialog with the name, saved for the built-in list in the preferences
    await pick("rename");
    const box = document.getElementById("cr-renameBox");
    out.renameOpen = box.open && document.getElementById("cr-renameInput").value;
    document.getElementById("cr-renameInput").value = "Smoke Crate";
    document.getElementById("cr-renameSave").click();
    await until(() => firetable.plPrefs && firetable.plPrefs.defaultName === "Smoke Crate");
    out.renamed = firetable.plPrefs.defaultName + "|" + !box.open;
    await firetable.actions.renameList("0", "Default Playlist");
    // Remove duplicates: the later copy goes, in one write
    await pick("dupes");
    await until(() => /duplicate/.test(document.getElementById("ft-toast")?.textContent || ""));
    out.toast = document.getElementById("ft-toast")?.textContent || "";
    out.left = Object.values((await ftapi.db().ref("queues/smoke").once("value")).val() || {}).map((t) => t.cid).join();
    ftapi.uid = realUid;
    return out;
  });
  check(/rename/.test(listTools.items) && /dupes/.test(listTools.items) && /export/.test(listTools.items), "the playlist's ⋮ has Rename, Remove duplicates and Export (" + listTools.items + ")");
  check(listTools.dupesShown === "dupe000001,dupe000001" && listTools.badge === "1" && listTools.allBack === 3, "Show only: Duplicates shows the songs that are in twice (" + JSON.stringify(listTools) + ")");
  check(listTools.unplayedBarOn && listTools.unplayedShown === "dupe000002" && listTools.unplayedBar === "1 song the room hasn't played yet. Play one for the room." && listTools.unplayedBadge === "1",
    "Show only: Not played here yet leaves the songs the room hasn't played, counting another upload's plays (" + JSON.stringify(listTools) + ")");
  check(listTools.afterPlay === "0|The room has played every song here.|true" && listTools.unplayedOff === 3,
    "a song the room plays leaves Not played here yet, and Show all puts every song back (" + JSON.stringify(listTools) + ")");
  check(listTools.exported === "Aa - One|Bb - Two|Aa - One", "Export downloads the list as Artist - Title lines in play order (" + listTools.exported + ")");
  check(listTools.renameOpen === "Default Playlist" && listTools.renamed === "Smoke Crate|true", "Rename opens with the list's name and saves the new one (" + JSON.stringify(listTools) + ")");
  check(/Removed 1 duplicate/.test(listTools.toast) && listTools.left === "dupe000001,dupe000002", "Remove duplicates keeps the first copy and says how many went (" + JSON.stringify(listTools) + ")");
  await put("/queues/smoke", listBefore);
  await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 300));
    return ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
  });

  console.log("-- drag to reorder the playlist: mouse, Alt+arrow keys, and a finger held on a row");
  await page.evaluate(() => {
    $("#mainGrid").removeClass("login");
    firetable.nav.view = "playlists";
    firetable.nav.apply();
    window.__saved = [];
    window.__reorder = ftapi.actions.reorderList;
    ftapi.actions.reorderList = (keys) => window.__saved.push(keys.join());
    return ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
  });
  const rowOrder = (p = page) => p.evaluate(() => [...document.querySelectorAll("#mainqueue .pvbar")].map((r) => r.getAttribute("data-key")).join());
  const box = (sel, p = page) => p.$eval(sel, (el) => { el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height }; });
  // where a drag starts and ends: both measured after one scroll, so the first isn't stale when the second scrolls
  const dragEnds = async (from, to, p = page) => {
    await p.$eval('#mainqueue .pvbar[data-key="k2"]', (el) => el.scrollIntoView({ block: "center" }));
    const at = (sel) => p.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height }; });
    return [await at('#mainqueue .pvbar[data-key="' + from + '"] .listwords'), await at('#mainqueue .pvbar[data-key="' + to + '"] .listwords')];
  };
  const drag = {};
  drag.before = await rowOrder();
  // a click isn't a drag
  let b1 = await box('#mainqueue .pvbar[data-key="k1"] .listwords');
  await page.mouse.click(b1.x, b1.y);
  drag.click = await page.evaluate(() => window.__saved.length);
  // the first row, dragged below the third
  let b3;
  [b1, b3] = await dragEnds("k1", "k3");
  await page.mouse.move(b1.x, b1.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b1.x, b1.y + (b3.y + b3.h * 0.4 - b1.y) * i / 8);
  drag.during = await page.evaluate(() => document.querySelector('#mainqueue .pvbar[data-key="k1"]').classList.contains("is-dragging"));
  await page.mouse.up();
  drag.mouse = await rowOrder();
  drag.saved = await page.evaluate(() => window.__saved.join(" / "));
  // Alt+↑ on a row's button moves that row up
  await page.focus('#mainqueue .pvbar[data-key="k4"] .bumpsongs');
  await page.keyboard.press("Alt+ArrowUp");
  drag.keys = await rowOrder();
  drag.focusKept = await page.evaluate(() => document.activeElement.closest(".pvbar").getAttribute("data-key"));
  check(drag.before === "k1,k2,k3,k4" && drag.click === 0 && drag.during && drag.mouse === "k2,k3,k1,k4" && /^k2,k3,k1,k4$/.test(drag.saved),
    "a mouse drags a row below another and the new order is saved; a click doesn't (" + JSON.stringify(drag) + ")");
  check(drag.keys === "k2,k3,k4,k1" && drag.focusKept === "k4", "Alt+↑ moves the focused row up, keeping focus (" + drag.keys + ")");

  // a phone: hold a row, then move it; a quick swipe scrolls instead
  const touchPhone = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const tPage = await touchPhone.newPage();
  tPage.on("pageerror", (e) => pageErrors.push("phone: " + e.message));
  await openPage(tPage, SITE + "#live");
  await tPage.waitForFunction(() => window.firetable && firetable.started && window.ftapi && ftapi.started, null, { timeout: 30000 });
  await tPage.evaluate(() => {
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    ftapi.uid = "smoke";
    ftapi.queueRef = ftapi.db().ref("queues/smoke");
    window.__saved = [];
    ftapi.actions.reorderList = (keys) => window.__saved.push(keys.join());
    $("#mainGrid").removeClass("login");
    firetable.nav.view = "playlists";
    firetable.nav.mobileSection = "view";
    firetable.nav.apply();
    return ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
  });
  await tPage.waitForFunction(() => document.querySelectorAll("#mainqueue .pvbar").length === 4, null, { timeout: 10000 }).catch(() => {});
  const cdpT = await touchPhone.newCDPSession(tPage);
  const touch = (type, x, y) => cdpT.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const t = {};
  let [s1, s3] = await dragEnds("k1", "k3", tPage);
  // swipe without holding: no drag
  await touch("touchStart", s1.x, s1.y);
  for (let i = 1; i <= 5; i++) { await touch("touchMove", s1.x, s1.y + i * 12); await sleep(16); }
  await touch("touchEnd");
  await sleep(300);
  t.swipe = await rowOrder(tPage);
  // hold, then move below the third row
  [s1, s3] = await dragEnds("k1", "k3", tPage);
  await touch("touchStart", s1.x, s1.y);
  await sleep(450);
  // each step aims at the third row where it is now (something above the list can appear mid-drag
  // and move every row), ending in its lower quarter
  const rowNow = (k) => tPage.$eval('#mainqueue .pvbar[data-key="' + k + '"]', (el) => { const r = el.getBoundingClientRect(); return { top: r.top, h: r.height }; });
  for (let i = 1; i <= 8; i++) {
    const r3 = await rowNow("k3");
    await touch("touchMove", s1.x, s1.y + (r3.top + r3.h * 0.75 - s1.y) * i / 8);
    await sleep(16);
  }
  await touch("touchEnd");
  await sleep(300);
  t.hold = await rowOrder(tPage);
  t.saved = await tPage.evaluate(() => window.__saved.join(" / "));
  check(t.swipe === "k1,k2,k3,k4" && t.hold === "k2,k3,k1,k4" && t.saved === "k2,k3,k1,k4",
    "on a phone, holding a row drags it and saves the order; a swipe doesn't (" + JSON.stringify(t) + ")");
  // a phone's rows keep Top and ⋮ (the rest is in ⋮), and drop the number, the length and the Remix tag
  const narrowRow = await tPage.evaluate(() => {
    const row = document.querySelector('#mainqueue .pvbar[data-key="k4"]');
    const on = (sel) => { const el = row.querySelector(sel); return !!el && getComputedStyle(el).display !== "none"; };
    return [".bumpsongs", ".row-more", ".bottomsongs", ".tracklink-btn", ".histeal", ".deletesong", ".q-num"].map((q) => q + ":" + on(q)).join(" ");
  });
  check(narrowRow === ".bumpsongs:true .row-more:true .bottomsongs:false .tracklink-btn:false .histeal:false .deletesong:false .q-num:false",
    "a phone's playlist rows show Top and ⋮ only (" + narrowRow + ")");
  const thumbRow = await tPage.evaluate(() => {
    const row = document.querySelector('#mainqueue .pvbar[data-key="k4"]');
    const a = row.querySelector(".q-art").getBoundingClientRect(), b = row.querySelector(".previewicon").getBoundingClientRect();
    return { h: Math.round(row.getBoundingClientRect().height), off: Math.abs((a.x + a.width / 2) - (b.x + b.width / 2)) };
  });
  check(thumbRow.h >= 56 && thumbRow.off <= 1, "a phone's playlist rows are a thumb's height, the play button in the middle of the cover (" + JSON.stringify(thumbRow) + ")");
  // 4.4: on a phone ⋮ opens as a sheet from the bottom, the whole width, with 48px rows over a dimmed page
  await tPage.click('#mainqueue .pvbar[data-key="k4"] .row-more');
  await tPage.waitForFunction(() => document.getElementById("trackMenuPopover").matches(":popover-open"), null, { timeout: 5000 }).catch(() => {});
  await sleep(300);
  const sheet = await tPage.evaluate(() => {
    const m = document.getElementById("trackMenuPopover"), r = m.getBoundingClientRect();
    const items = [...m.querySelectorAll('[role="menuitem"]')].filter((b) => b.offsetParent);
    return { open: m.matches(":popover-open"), bottom: Math.round(innerHeight - r.bottom), left: Math.round(r.left), wide: Math.round(r.width) === innerWidth,
      rows: items.length, tall: items.every((b) => b.getBoundingClientRect().height >= 47.5), dim: getComputedStyle(m, "::backdrop").backgroundColor };
  });
  if (process.env.SHOTS) await tPage.screenshot({ path: process.env.SHOTS + "/phone-menu-sheet.png" });
  await tPage.keyboard.press("Escape");
  check(sheet.open && sheet.bottom === 0 && sheet.left === 0 && sheet.wide && sheet.rows >= 4 && sheet.tall && sheet.dim !== "rgba(0, 0, 0, 0)",
    "on a phone ⋮ opens as a sheet from the bottom, the whole width, with 48px rows over a dimmed page (" + JSON.stringify(sheet) + ")");
  await touchPhone.close();

  console.log("-- playlist rows: number, Title · Artist, Next / Broken / Remix, and ⋮'s Delete and search for another");
  const rowLook = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const list = (await ftapi.queueRef.once("value")).val();
    list.k4 = Object.assign({}, list.k4, { name: "Fine - Track (Smoke Remix)" });
    list.k1 = Object.assign({}, list.k1, { flagged: { date: 1, code: 9 } });
    list.k2 = Object.assign({}, list.k2, { flagged: { date: 1, code: 2 } });
    const realDj = ftapi.selectedListThing;
    ftapi.selectedListThing = "0";
    ftapi.events.emit("playlistChanged", list, "0");
    await wait(100);
    const row = (k) => document.querySelector('#mainqueue .pvbar[data-key="' + k + '"]');
    const shown = (el) => !!el && getComputedStyle(el).display !== "none";
    const tags = (k) => [...row(k).querySelectorAll(".q-tag")].filter(shown).map((t) => t.textContent).join("+");
    const out = {
      num: [..."1234"].map((n) => row("k" + n).querySelector(".q-num").textContent).join(),
      name: row("k1").querySelector(".q-title").textContent + "|" + row("k1").querySelector(".q-artist").textContent,
      read: getComputedStyle(row("k1").querySelector(".q-artist"), "::before").content,
      stored: row("k1").getAttribute("data-tags"),
      k1: tags("k1"), k4: tags("k4"), k2: tags("k2")
    };
    // the two pickers: the stage's is a status line (no box, as wide as its name, its label beside it),
    // and the crate's says "DJ list" while it shows the list you DJ from
    const stagePick = document.getElementById("djlistpicker"), sp = getComputedStyle(stagePick), tag = document.getElementById("cr-djTag");
    const lab = document.getElementById("djlistpickerLabel").getBoundingClientRect(), pick = stagePick.getBoundingClientRect();
    out.status = { box: sp.backgroundColor + "|" + sp.borderTopColor + "|" + sp.boxShadow, hugs: pick.width < 0.8 * document.getElementById("djlistpickerWrap").getBoundingClientRect().width,
      beside: innerWidth < 640 || (lab.width > 40 && lab.right <= pick.left + 1), select: stagePick.tagName, tag: !tag.hidden && tag.getClientRects().length > 0 ? tag.querySelector("span").textContent.trim() : "" };
    ftapi.events.emit("djListChanged", "elsewhere");
    ftapi.selectedListThing = "elsewhere";
    firetable.ui.markDjList();
    out.notDj = tags("k1");
    out.status.tagOff = tag.hidden;
    ftapi.selectedListThing = realDj;
    firetable.ui.markDjList();
    // ⋮ → Delete and search for another
    const real = firetable.actions.deleteSongAndSearch;
    let called = null;
    firetable.actions.deleteSongAndSearch = (...a) => { called = a.join("|"); };
    row("k2").querySelector(".row-more").click();
    await wait(150);
    document.querySelector('#trackMenuPopover [data-act="delsearch"]').click();
    firetable.actions.deleteSongAndSearch = real;
    out.delsearch = called;
    ftapi.events.emit("playlistChanged", (await ftapi.queueRef.once("value")).val(), "0");
    return out;
  });
  check(rowLook.num === "1,2,3,4" && rowLook.name === "Karma Police|Radiohead" && rowLook.read === '" · "' && rowLook.stored === "Radiohead - Karma Police",
    "playlist rows show their place, then Title · Artist; the stored Artist - Title is kept (" + JSON.stringify(rowLook) + ")");
  check(rowLook.k1 === "Next+Low audio" && rowLook.k4 === "Remix" && rowLook.k2 === "Broken" && rowLook.notDj === "Low audio",
    "tags: Next on the first song of the list you DJ from (only that list), Broken (or why) when flagged, Remix when the title says so (" + JSON.stringify(rowLook) + ")");
  check(rowLook.delsearch === "k2|Daft Punk - One More Time|1", "the row's ⋮ has Delete and search for another (" + rowLook.delsearch + ")");
  check(/^rgba\(0, 0, 0, 0\)\|rgba\(0, 0, 0, 0\)\|none$/.test(rowLook.status.box) && rowLook.status.hugs && rowLook.status.beside && rowLook.status.select === "SELECT",
    "under the stage, the playlist you DJ from reads as a status: no box, as wide as its name, still the same select (" + JSON.stringify(rowLook.status) + ")");
  check(rowLook.status.tag === "DJ list" && rowLook.status.tagOff, "the crate's picker says DJ list while it shows the list you DJ from, and only then (" + JSON.stringify(rowLook.status) + ")");

  console.log("-- one song menu: the same items, words and order in each ⋮");
  const oneMenu = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const acts = (sel) => [...document.querySelectorAll(sel + " [data-act]")].map((b) => b.getAttribute("data-act")).join();
    const M = firetable.songMenu;
    const out = { crate: acts("#trackMenuPopover"), recent: acts("#histMenuPopover") };
    // Recent's ⋮ sets the mods' items apart (4.4)
    out.mods = [...document.querySelectorAll("#histMenuPopover .ft-menu > *")].map((el) => el.classList.contains("ft-menu-group") ? "|" + el.textContent + ":" : el.getAttribute("data-act") || "").filter(Boolean).join(",");
    // every shared item says the same thing wherever it is
    out.words = [...document.querySelectorAll("#trackMenuPopover [data-act], #histMenuPopover [data-act]")]
      .filter((b) => b.getAttribute("data-act") !== "open")
      .every((b) => b.lastChild.textContent.trim() === M.ITEMS[b.getAttribute("data-act")].label); // the text after the icon
    // a playlist row's ⋮: Copy the song's link, and About this song
    const copied = [];
    const realClip = navigator.clipboard && navigator.clipboard.writeText;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    const row = document.querySelector('#mainqueue .pvbar[data-key="k4"]');
    row.querySelector(".row-more").click();
    await wait(150);
    out.copyShown = !document.querySelector('#trackMenuPopover [data-act="copy"]').hidden;
    document.querySelector('#trackMenuPopover [data-act="copy"]').click();
    await wait(100);
    out.copied = copied.join() + "|" + (document.getElementById("ft-toast")?.textContent || "");
    row.querySelector(".row-more").click();
    await wait(150);
    document.querySelector('#trackMenuPopover [data-act="sheet"]').click();
    await wait(200);
    const sheet = document.getElementById("dSheetBox");
    out.sheet = !!(sheet && sheet.open) && sheet.querySelector(".d-title").textContent + "|" + sheet.querySelector(".d-artist").textContent;
    if (sheet) sheet.close();
    if (realClip) Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: realClip } });
    return out;
  });
  check(oneMenu.crate === "sheet,add,open,copy,tags,swaptags,swap,bottom,delsearch,delete" && oneMenu.recent === "sheet,open,copy,tags,flag" && oneMenu.words && oneMenu.mods === "sheet,open,copy,|Mods:,tags,flag",
    "a playlist row's ⋮ and Recent's ⋮ come from the one song menu, in its order and words (" + JSON.stringify(oneMenu) + ")");
  check(oneMenu.copyShown && /^https:\/\/www\.youtube\.com\/watch\?v=finevideo01\|Link copied/.test(oneMenu.copied) && oneMenu.sheet === "Track|Fine",
    "a playlist row's ⋮: Copy the song's link, and About this song opens the song's sheet (" + JSON.stringify(oneMenu) + ")");

  console.log("-- Sort: by artist or title, view only");
  await page.evaluate(() => { window.__saved = []; return ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0")); });
  // the menu moves focus once it's placed (a frame or two after it opens)
  const sortOpen = async () => {
    await page.click("#cr-sort");
    await page.waitForFunction(() => { const m = document.getElementById("cr-sortMenu"); return m.matches(":popover-open") && m.contains(document.activeElement); });
  };
  const srt = {};
  srt.before = await rowOrder();
  await sortOpen();
  srt.focus = await page.evaluate(() => document.activeElement.value);
  await page.click('#cr-sortMenu input[value="artist"]');
  srt.artist = await rowOrder();
  srt.menuShut = await page.evaluate(() => !document.getElementById("cr-sortMenu").matches(":popover-open"));
  srt.bar = await page.evaluate(() => !document.getElementById("cr-sortBar").hidden && document.getElementById("cr-sortBarText").textContent);
  srt.label = await page.evaluate(() => document.getElementById("cr-sort").getAttribute("aria-label") + "|" + document.getElementById("cr-sort").classList.contains("is-on"));
  await sortOpen();
  await page.click('#cr-sortMenu input[value="title"]');
  srt.title = await rowOrder();
  // dragging is off while sorted: a drag and Alt+↑ change nothing and save nothing
  const d1 = await box('#mainqueue .pvbar[data-key="k1"] .listwords');
  const d4 = await box('#mainqueue .pvbar[data-key="k4"] .listwords');
  await page.mouse.move(d1.x, d1.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(d1.x, d1.y + (d4.y + d4.h * 0.4 - d1.y) * i / 8);
  await page.mouse.up();
  await page.focus('#mainqueue .pvbar[data-key="k4"] .bumpsongs');
  await page.keyboard.press("Alt+ArrowUp");
  srt.afterDrag = await rowOrder();
  srt.saved = await page.evaluate(() => window.__saved.length);
  srt.stored = Object.keys(await listNow()).join();
  await page.click("#cr-sortBack");
  srt.back = await rowOrder();
  srt.barGone = await page.evaluate(() => document.getElementById("cr-sortBar").hidden && document.getElementById("cr-sort").getAttribute("aria-label"));
  check(srt.before === "k1,k2,k3,k4" && srt.focus === "order" && srt.artist === "k3,k2,k4,k1" && srt.menuShut && /^Showing by artist\. Your play order hasn't changed\.$/.test(srt.bar) && srt.label === "Sort: Artist|true" && srt.title === "k1,k3,k2,k4",
    "Sort shows the playlist by artist or title, says so over the list, and marks its button (" + JSON.stringify(srt) + ")");
  check(srt.afterDrag === "k1,k3,k2,k4" && srt.saved === 0 && srt.stored === "k1,k2,k3,k4" && srt.back === "k1,k2,k3,k4" && srt.barGone === "Sort: Your order",
    "a sorted view never changes the play order: dragging is off, and Back to your order brings it back (" + JSON.stringify(srt) + ")");
  console.log("-- Select several: tick songs, then Top, Delete (with Undo), Copy to…");
  const beforeSel = await listNow();
  await put("/queues/smoke", { s1: { type: 1, cid: "selvideo001", name: "Aa - One" }, s2: { type: 1, cid: "selvideo002", name: "Bb - Two" },
    s3: { type: 1, cid: "selvideo003", name: "Cc - Three" }, s4: { type: 1, cid: "selvideo004", name: "Dd - Four" }, s5: { type: 1, cid: "selvideo005", name: "Ee - Five" } });
  const fresh = () => page.evaluate(() => ftapi.queueRef.once("value").then((s) => { ftapi.events.emit("playlistChanged", s.val(), "0"); }));
  const dbNames = () => page.evaluate(async () => Object.entries((await ftapi.queueRef.once("value")).val() || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1].name.slice(0, 2)).join());
  const waitDb = async (want) => { for (let i = 0; i < 40; i++) { if ((await dbNames()) === want) return want; await sleep(100); } return dbNames(); };
  const keyOf = (name) => page.evaluate((n) => { return Object.keys(firetable.queue).find((k) => firetable.queue[k].name.startsWith(n)); }, name);
  await fresh();
  const sel = {};
  await page.click("#cr-select");
  sel.on = await page.evaluate(() => !document.getElementById("cr-bulk").hidden && $("#mainqueue").hasClass("cr-selecting") &&
    getComputedStyle(document.querySelector("#mainqueue .q-check")).display !== "none" && $("#cr-bulkTop").prop("disabled") && $("#cr-bulkCount").text());
  await page.click('#mainqueue .pvbar[data-key="s2"] .q-name');
  await page.click('#mainqueue .pvbar[data-key="s4"] .q-check');
  sel.count = await page.evaluate(() => $("#cr-bulkCount").text() + "|" + $("#mainqueue .pvbar.is-picked").map(function () { return this.getAttribute("data-key"); }).get().join());
  await page.click("#cr-bulkTop");
  sel.top = await waitDb("Bb,Dd,Aa,Cc,Ee");
  sel.kept = await page.evaluate(() => $("#cr-bulkCount").text());
  await fresh();
  sel.pickedTop = await page.evaluate(() => [...document.querySelectorAll("#mainqueue .pvbar")].slice(0, 2).every((r) => r.classList.contains("is-picked")));
  // Delete asks once, then Undo puts them back where they were
  await page.click("#cr-bulkDelete");
  sel.ask = await page.evaluate(() => $("#cr-bulkDelete span").text().trim());
  await page.click("#cr-bulkDelete");
  sel.deleted = await waitDb("Aa,Cc,Ee");
  sel.toast = await page.evaluate(() => document.getElementById("ft-toast")?.textContent || "");
  await page.evaluate(() => { const b = [...document.querySelectorAll("#ft-toast button")].find((x) => /Undo/.test(x.textContent)); if (b) b.click(); });
  sel.undone = await waitDb("Bb,Dd,Aa,Cc,Ee");
  // Copy to…: the ticked songs go to the top of another playlist, in their order
  await fresh();
  const a1 = await keyOf("Aa"), c3 = await keyOf("Cc");
  await page.click('#mainqueue .pvbar[data-key="' + c3 + '"] .q-check');
  await page.click('#mainqueue .pvbar[data-key="' + a1 + '"] .q-check');
  await page.click("#cr-bulkCopy");
  await page.waitForFunction(() => $("#stealContain").is(":visible"));
  await page.evaluate(() => { $("#stealpicker").append(new Option("Copy dest", "copyDest")).val("copyDest").trigger("change"); });
  sel.copied = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const v = (await ftapi.lookup.listRef("copyDest").once("value")).val();
      if (v) return Object.entries(v).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1].name.slice(0, 2)).join();
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  await page.click("#cr-bulkDone");
  sel.off = await page.evaluate(() => document.getElementById("cr-bulk").hidden && !$("#mainqueue").hasClass("cr-selecting") && !document.querySelector("#mainqueue .pvbar.is-picked") && Object.keys(firetable.queueSel || {}).length === 0);
  check(sel.on === "0 selected" && sel.count === "2 selected|s2,s4" && sel.top === "Bb,Dd,Aa,Cc,Ee" && sel.kept === "2 selected" && sel.pickedTop,
    "Select several: tick two songs, Top puts them first in their order and they stay ticked (" + JSON.stringify(sel) + ")");
  check(sel.ask === "Delete 2 songs?" && sel.deleted === "Aa,Cc,Ee" && /Deleted 2 songs/.test(sel.toast) && sel.undone === "Bb,Dd,Aa,Cc,Ee",
    "Select several: Delete asks once, deletes both in one go, and Undo puts them back where they were (" + JSON.stringify(sel) + ")");
  check(sel.copied === "Aa,Cc" && sel.off, "Select several: Copy to… adds them to another playlist's top in play order; × ends it and clears the ticks (" + JSON.stringify(sel) + ")");
  await put("/queues/smoke", beforeSel);
  await fresh();
  await page.evaluate(() => { ftapi.actions.reorderList = window.__reorder; $("#mainGrid").addClass("login"); });

  console.log("-- Import, step by step: see the songs first, the ones that can't play shown, into a list you have, with Undo");
  const beforeImport = await listNow();
  await put("/queues/smoke", { i1: { type: 1, cid: "impvideo00a", name: "Aa - Old" } });
  const imp = await page.evaluate(async () => {
    const realUid = ftapi.uid;
    ftapi.uid = "smoke";
    const wait = async (fn) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    window.__ytAPI = window.ytAPI;
    window.ytAPI = (resource, params, cb) => setTimeout(() => {
      if (resource === "playlists") return cb({ items: [{ id: "PLsmokeImport01", snippet: { title: "Smoke Mix", channelTitle: "Smoke Channel" }, contentDetails: { itemCount: 4 } }] });
      if (resource === "playlistItems") {
        const it = (cid, title, owner) => ({ snippet: { title, videoOwnerChannelTitle: owner, resourceId: { videoId: cid } }, status: { privacyStatus: "public" } });
        return cb({ pageInfo: { totalResults: 4 }, items: [it("impvideo00b", "Bb - Two", "Bb"), it("impvideo00x", "Deleted video", ""), it("impvideo00a", "Aa - Old", "Aa"), it("impvideo00c", "Cc - Three", "Cc")] });
      }
      cb({ items: [] });
    }, 10);
    const names = async (id) => Object.entries((await ftapi.lookup.listRef(id).once("value")).val() || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1].name.slice(0, 2)).join();
    const out = {};
    out.links = [firetable.importer.parseLink("https://www.youtube.com/playlist?list=PLsmokeImport01"), firetable.importer.parseLink("https://www.youtube.com/watch?v=abcdefghijk&list=PLsmokeImport01"),
      firetable.importer.parseLink("https://soundcloud.com/someone/sets/night-drive"), firetable.importer.parseLink("https://soundcloud.com/someone/a-song"), firetable.importer.parseLink("night drive")]
      .map((l) => (l ? l.type + ":" + (l.id || "url") : "-")).join(",");
    firetable.importer.open();
    out.step1 = !document.getElementById("im-step1").hidden && document.getElementById("im-step2").hidden && document.getElementById("importTitle").textContent;
    const input = document.getElementById("plMachine");
    input.value = "https://www.youtube.com/playlist?list=PLsmokeImport01";
    $(input).trigger($.Event("keyup", { which: 13 }));
    out.rows = await wait(() => document.querySelectorAll("#im-songs li").length === 4 && !document.getElementById("im-step2").hidden &&
      [...document.querySelectorAll("#im-songs li")].map((li) => li.querySelector(".im-title").textContent + (li.querySelector(".im-tag") ? "(" + li.querySelector(".im-tag").textContent + ")" : "")).join("|"));
    out.title = document.getElementById("importTitle").textContent + "|" + document.getElementById("im-meta").textContent;
    out.toNew = document.getElementById("im-go").textContent + "|" + document.getElementById("im-newName").value;
    document.querySelector('input[name="im-dest"][value="have"]').checked = true;
    $("#im-destList").val("0");
    $("#im-pos").val("top").trigger("change");
    out.toHave = await wait(() => /Import 2 songs/.test(document.getElementById("im-go").textContent) && document.getElementById("im-go").textContent + "|" + document.getElementById("im-status").textContent + "|" +
      [...document.querySelectorAll("#im-songs .im-tag")].map((t) => t.textContent).join(","));
    document.getElementById("im-go").click();
    out.added = await wait(async () => { const n = await names("0"); return n === "Bb,Cc,Aa" && n; }) || await names("0");
    out.closed = !document.getElementById("importPromptBox").open;
    out.toast = document.getElementById("ft-toast").textContent;
    [...document.querySelectorAll("#ft-toast button")].find((b) => b.textContent === "Undo").click();
    out.undone = await wait(async () => { const n = await names("0"); return n === "Aa" && n; }) || await names("0");
    // the old way in: importList(id, name, type) makes a new playlist of what can play
    const r = await firetable.actions.importList("PLsmokeImport01", "Smoke Mix", 1);
    out.newList = r.created + "|" + (await names(r.listID)) + "|" + r.unavailable;
    await firetable.importer.undo(r);
    out.newGone = await wait(async () => !(await ftapi.lookup.listRef(r.listID).once("value")).val() && !firetable.allPlaylists[r.listID]);
    // a playlist link pasted in Find tracks offers the import
    $("#qsearch").val("https://www.youtube.com/playlist?list=PLsmokeImport01").trigger($.Event("keyup", { which: 13 }));
    out.offer = await wait(() => document.querySelector("#searchResults .im-offerGo") && document.querySelector("#searchResults .im-offer").textContent);
    document.querySelector("#searchResults .im-offerGo").click();
    out.offerOpens = await wait(() => document.getElementById("importPromptBox").open && !document.getElementById("im-step2").hidden && document.querySelectorAll("#im-songs li").length === 4);
    document.getElementById("importPromptBox").close();
    $("#qsearch").val("");
    $("#searchResults").empty();
    window.ytAPI = window.__ytAPI;
    ftapi.uid = realUid;
    return out;
  });
  check(imp.links === "1:PLsmokeImport01,-,2:url,-,-" && imp.step1 === "Import a playlist", "Import: a playlist link is told from a song's, and it opens at the search (" + JSON.stringify(imp) + ")");
  check(imp.rows === "Two|Deleted video(Not available)|Old|Three" && imp.title === "Import “Smoke Mix”|by Smoke Channel · 4 songs · YouTube" && imp.toNew === "Import 3 songs|Smoke Mix",
    "Import: the playlist's songs are listed before anything is added, a deleted video shown as Not available (" + JSON.stringify(imp) + ")");
  check(/^Import 2 songs\|2 songs to import · 1 not available · 1 already there\|Not available,Already there$/.test(imp.toHave) && imp.added === "Bb,Cc,Aa" && imp.closed &&
    /^Imported 2 songs into .+ \(1 already there, 1 not available left out\)\./.test(imp.toast) && imp.undone === "Aa",
    "Import: into a playlist you have, at the top, skipping the one already there; Undo takes exactly those back (" + JSON.stringify(imp) + ")");
  check(imp.newList === "true|Bb,Aa,Cc|1" && imp.newGone, "Import: the old call still makes a new playlist of what can play, and Undo deletes it (" + JSON.stringify(imp) + ")");
  check(imp.offer === "That's a playlist: Smoke Mix · 4 songs. Import it" && imp.offerOpens, "Import: a playlist link in Find tracks says what it is and opens its songs (" + JSON.stringify(imp) + ")");
  console.log("-- Import a list of songs (1.20): pasted or a CSV, found by the room's bot, picked, imported");
  await put("/queues/smoke", { i1: { type: 1, cid: "impvideo00a", name: "Aa - Old" } });
  await put("/importJobs", null);
  const lst = await page.evaluate(async () => {
    const realUid = ftapi.uid;
    ftapi.uid = "smoke";
    const wait = async (fn) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    const I = firetable.importer;
    const out = {};
    out.lines = ["1. Khruangbin - Maria También (4:05)", "Men I Trust – Show Me How", "• Poolside\tHarvest Moon\t3:58", "Just A Title", "# a comment", "   "]
      .map((l) => JSON.stringify(I.parseLine(l))).join("|");
    out.csv = JSON.stringify(I.parseCsv('Track URI,Track Name,"Artist Name(s)",Duration (ms)\nspotify:1,"Show Me How","Men I Trust",215000\nspotify:2,"Harvest Moon, Pt. 2","Poolside;Panama",240500\n'));
    out.notCsv = I.parseCsv("Khruangbin - Maria También\nMen I Trust - Show Me How") === null;
    const names = async (id) => Object.entries((await ftapi.lookup.listRef(id).once("value")).val() || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1].name).join("|");
    const jobs = async () => (await ftapi.db().ref("importJobs/smoke").once("value")).val() || {};
    I.open();
    document.getElementById("listimportchoice").click();
    out.pane = !document.getElementById("im-listPane").hidden && document.getElementById("importContent").hidden && document.getElementById("importTitle").textContent;
    const text = document.getElementById("im-listText");
    text.value = "Khruangbin - Maria Tambien\nPoolside - Harvest Moon\nNobody - Knows This\nBusy - Song";
    text.dispatchEvent(new Event("input"));
    out.count = document.getElementById("im-listCount").textContent + "|" + document.getElementById("im-listFind").textContent;
    document.getElementById("im-listFind").click();
    out.looking = await wait(() => document.querySelectorAll("#im-songs .im-tag.is-looking").length === 4 && document.getElementById("im-go").disabled && document.getElementById("im-go").textContent);
    const asked = await wait(async () => { const j = await jobs(); const ids = Object.keys(j); return ids.length === 1 && Object.assign({ id: ids[0] }, j[ids[0]]); });
    out.job = asked && asked.format + "|" + asked.status + "|" + asked.items.map((it) => it.a + "/" + it.t).join(",");
    // the bot answers
    const pick = (cid, extra) => Object.assign({ type: 1, cid, artist: "", title: "", src: "ytm", kind: "a" }, extra);
    await ftapi.db().ref("importJobs/smoke/" + asked.id).update({ status: "done", n: 4, results: {
      0: { s: "room", picks: [pick("khaudio0001", { artist: "Khruangbin", title: "María También", src: "room", plays: 12 })] },
      1: { s: "song", picks: [pick("poolaudio01", { artist: "Poolside", title: "Harvest Moon" }), pick("poolvideo01", { artist: "Poolside", title: "Harvest Moon", src: "room", kind: "v" })] },
      2: { s: "none" }, 3: { s: "later" } } });
    out.found = await wait(() => !document.getElementById("im-go").disabled && [...document.querySelectorAll("#im-songs li")].map((li) =>
      li.querySelector(".im-title").textContent + "(" + (li.querySelector("select") ? [...li.querySelector("select").options].map((o) => o.textContent).join("/") : li.querySelector(".im-tag").textContent) + ")").join("|"));
    out.go = document.getElementById("im-go").textContent + "|" + document.getElementById("im-status").textContent;
    out.search = document.querySelector("#im-songs li:nth-child(3) .im-findLink").href;
    // leave one out, then put it back with the room's video instead
    const sel = document.querySelector("#im-songs li:nth-child(2) select");
    sel.value = "-1";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    out.left = await wait(() => /Import 1 song$/.test(document.getElementById("im-go").textContent) && document.getElementById("im-status").textContent);
    const sel2 = document.querySelector("#im-songs li:nth-child(2) select");
    sel2.value = "1";
    sel2.dispatchEvent(new Event("change", { bubbles: true }));
    // a destination kept to SoundCloud asks the bot again, for SoundCloud
    firetable.plPrefs.format = Object.assign({}, firetable.plPrefs.format, { "0": "sc" });
    document.querySelector('input[name="im-dest"][value="have"]').checked = true;
    $("#im-destList").val("0").trigger("change");
    const again = await wait(async () => { const j = await jobs(); const ids = Object.keys(j); return ids.length === 1 && ids[0] !== asked.id && j[ids[0]]; });
    out.again = again && again.format + "|" + document.querySelectorAll("#im-songs .im-tag.is-looking").length;
    delete firetable.plPrefs.format["0"];
    $("#im-destList").trigger("change");
    const third = await wait(async () => { const j = await jobs(); const ids = Object.keys(j); return ids.length === 1 && j[ids[0]].format === "ytm" && Object.assign({ id: ids[0] }, j[ids[0]]); });
    await ftapi.db().ref("importJobs/smoke/" + third.id).update({ status: "done", n: 4, results: {
      0: { s: "room", picks: [pick("khaudio0001", { artist: "Khruangbin", title: "María También", src: "room" })] },
      1: { s: "song", picks: [pick("poolaudio01", { artist: "Poolside", title: "Harvest Moon" })] }, 2: { s: "none" }, 3: { s: "none" } } });
    await wait(() => /Import 2 songs/.test(document.getElementById("im-go").textContent));
    $("#im-pos").val("bottom");
    document.getElementById("im-go").click();
    out.added = await wait(async () => { const n = await names("0"); return n.split("|").length === 3 && n; }) || await names("0");
    out.toast = document.getElementById("ft-toast").textContent;
    out.cleared = await wait(async () => Object.keys(await jobs()).length === 0);
    [...document.querySelectorAll("#ft-toast button")].find((b) => b.textContent === "Undo").click();
    out.undone = await wait(async () => { const n = await names("0"); return n === "Aa - Old" && n; }) || await names("0");
    // closing the dialog while the bot looks takes the job back
    I.open();
    document.getElementById("listimportchoice").click();
    text.value = "Aa - Bb";
    text.dispatchEvent(new Event("input"));
    document.getElementById("im-listFind").click();
    await wait(async () => Object.keys(await jobs()).length === 1);
    document.getElementById("importPromptBox").close();
    out.closedGone = await wait(async () => Object.keys(await jobs()).length === 0);
    document.getElementById("ytimportchoice").click();
    ftapi.uid = realUid;
    return out;
  });
  check(lst.lines === '{"a":"Khruangbin","t":"Maria También","d":245}|{"a":"Men I Trust","t":"Show Me How"}|{"a":"Poolside","t":"Harvest Moon","d":238}|{"a":"","t":"Just A Title"}|null|null',
    "a list of songs: numbering, bullets, dashes, tabs and lengths are read; comments and blank lines skipped (" + lst.lines + ")");
  check(lst.csv === '[{"a":"Men I Trust","t":"Show Me How","d":215},{"a":"Poolside, Panama","t":"Harvest Moon, Pt. 2","d":241}]' && lst.notCsv,
    "a CSV export's artist, title and length columns are found; plain lines aren't a CSV (" + lst.csv + ")");
  check(lst.pane === "Import a list of songs" && lst.count === "4 songs|Find 4 songs" && lst.looking === "Finding the songs…" && lst.job === "ytm|new|Khruangbin/Maria Tambien,Poolside/Harvest Moon,Nobody/Knows This,Busy/Song",
    "the list asks the room's bot for each song, for a YouTube Music playlist, while the rows say Looking… (" + JSON.stringify(lst) + ")");
  check(lst.found === "María También(Played here/Leave out)|Harvest Moon(Song/Played here/Leave out)|Knows This(Not found)|Song(Try later)" &&
    /^Import 2 songs\|2 songs to import · 2 not found$/.test(lst.go) && /music\.youtube\.com\/search\?q=Nobody/.test(lst.search),
    "what the bot found shows per song: Played here, a pick where there are two, Not found with a search, Try later (" + JSON.stringify([lst.found, lst.go]) + ")");
  check(/1 left out/.test(lst.left || "") && lst.again === "sc|4", "Leave out takes a song out; a playlist kept to SoundCloud asks the bot again for SoundCloud (" + JSON.stringify([lst.left, lst.again]) + ")");
  check(lst.added.split("|").sort().join("|") === "Aa - Old|Khruangbin - María También|Poolside - Harvest Moon" && /^Imported 2 songs into .+ \(2 not found left out\)\./.test(lst.toast) && lst.cleared && lst.undone === "Aa - Old" && lst.closedGone,
    "Import adds the found songs to the playlist; the job is cleared after, and when the dialog closes; Undo takes them back (" + JSON.stringify(lst) + ")");
  await put("/queues/smoke", beforeImport);

  console.log("-- Import a Spotify playlist (1.21): offered when the bot can, read by the bot, then found like a list");
  await put("/queues/smoke", { i1: { type: 1, cid: "impvideo00a", name: "Aa - Old" } });
  await put("/importJobs", null);
  await put("/discover/caps/spotify", null);
  const spo = await page.evaluate(async () => {
    const realUid = ftapi.uid;
    ftapi.uid = "smoke";
    const wait = async (fn) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    const I = firetable.importer;
    const tab = document.getElementById("spimportchoice");
    const out = {};
    out.hiddenFirst = tab.hidden;
    await ftapi.db().ref("discover/caps/spotify").set(true);
    out.shown = await wait(() => !tab.hidden);
    const P = "6rqhFgbbKwnb9MLmUQDhG6";
    out.ids = ["https://open.spotify.com/playlist/" + P + "?si=abc", "https://open.spotify.com/intl-de/playlist/" + P, "spotify:playlist:" + P,
      "https://open.spotify.com/album/" + P, "night drive"].map((t) => I.parseSpotify(t) || "-").join(",");
    const jobs = async () => (await ftapi.db().ref("importJobs/smoke").once("value")).val() || {};
    I.open();
    tab.click();
    out.pane = !document.getElementById("im-spPane").hidden && document.getElementById("importTitle").textContent;
    const link = document.getElementById("im-spLink");
    link.value = "https://open.spotify.com/album/" + P;
    link.dispatchEvent(new Event("input"));
    out.album = document.getElementById("im-spMsg").textContent + "|" + document.getElementById("im-spFind").disabled;
    link.value = "https://open.spotify.com/playlist/" + P + "?si=x1";
    link.dispatchEvent(new Event("input"));
    document.getElementById("im-spFind").click();
    const asked = await wait(async () => { const j = await jobs(); const ids = Object.keys(j); return ids.length === 1 && Object.assign({ id: ids[0] }, j[ids[0]]); });
    out.job = asked && asked.spotify + "|" + asked.format + "|" + (asked.items === undefined);
    out.reading = await wait(() => /Reading the playlist on Spotify/.test(document.getElementById("im-status").textContent) && document.getElementById("im-go").disabled);
    // the bot reads the playlist, then answers
    const ref = ftapi.db().ref("importJobs/smoke/" + asked.id);
    await ref.update({ status: "working", n: 0, name: "Night Drive", by: "Chris", skipped: 1,
      items: [{ a: "Khruangbin", t: "Maria Tambien", d: 245 }, { a: "Nobody", t: "Knows This" }] });
    out.listed = await wait(() => document.querySelectorAll("#im-songs li").length === 2 && document.getElementById("im-name").textContent + "|" +
      document.getElementById("im-meta").textContent + "|" + document.getElementById("im-newName").value);
    await ref.update({ status: "done", n: 2, results: { 0: { s: "room", picks: [{ type: 1, cid: "khaudio0001", artist: "Khruangbin", title: "María También", src: "room", kind: "a" }] }, 1: { s: "none" } } });
    // into a new playlist, named for the Spotify one
    document.querySelector('input[name="im-dest"][value="new"]').checked = true;
    $('input[name="im-dest"][value="new"]').trigger("change");
    out.found = await wait(() => /Import 1 song/.test(document.getElementById("im-go").textContent) &&
      [...document.querySelectorAll("#im-songs li")].map((li) => li.querySelector(".im-title").textContent + "(" + (li.querySelector("select") ? li.querySelector("select").options[0].textContent : li.querySelector(".im-tag").textContent) + ")").join("|"));
    document.getElementById("im-go").click();
    out.added = await wait(async () => { const v = (await ftapi.lookup.listRef(Object.keys(firetable.allPlaylists).find((k) => firetable.allPlaylists[k].name === "Night Drive") || "none").once("value")).val(); return v && Object.values(v).map((t) => t.name).join("|"); });
    out.cleared = await wait(async () => Object.keys(await jobs()).length === 0);
    const undo = [...document.querySelectorAll("#ft-toast button")].find((b) => b.textContent === "Undo");
    if (undo) undo.click();
    // one Spotify won't share: the bot's note
    I.open();
    tab.click();
    link.value = "spotify:playlist:" + P;
    link.dispatchEvent(new Event("input"));
    document.getElementById("im-spFind").click();
    const second = await wait(async () => { const j = await jobs(); const ids = Object.keys(j); return ids.length === 1 && ids[0]; });
    await ftapi.db().ref("importJobs/smoke/" + second).update({ status: "failed", note: "Spotify won't share that playlist: it's private, or one of Spotify's own mixes." });
    out.failed = await wait(() => /won't share that playlist/.test(document.getElementById("im-status").textContent) && document.getElementById("im-status").className);
    document.getElementById("importPromptBox").close();
    // the bot's keys stop working: Spotify is no longer offered
    await ftapi.db().ref("discover/caps/spotify").remove();
    out.hiddenAfter = await wait(() => tab.hidden);
    document.getElementById("ytimportchoice").click();
    ftapi.uid = realUid;
    return out;
  });
  check(spo.hiddenFirst && spo.shown && spo.hiddenAfter, "the Spotify source shows only while the bot says Spotify works (" + JSON.stringify([spo.hiddenFirst, spo.shown, spo.hiddenAfter]) + ")");
  check(spo.ids === "6rqhFgbbKwnb9MLmUQDhG6,6rqhFgbbKwnb9MLmUQDhG6,6rqhFgbbKwnb9MLmUQDhG6,-,-" && spo.pane === "Import a Spotify playlist" && /not a playlist.*\|true$/.test(spo.album),
    "a Spotify playlist's link is read (with ?si=, /intl-xx/, a spotify: URI); an album's link says it isn't a playlist (" + JSON.stringify(spo) + ")");
  check(spo.job === "6rqhFgbbKwnb9MLmUQDhG6|ytm|true" && spo.reading && spo.listed === "Night Drive|2 songs · by Chris · Spotify · 1 local file or episode left out|Night Drive",
    "the job asks the bot to read the playlist; its name, owner and songs show when the bot has (" + JSON.stringify([spo.job, spo.listed]) + ")");
  check(spo.found === "María También(Played here)|Knows This(Not found)" && spo.added === "Khruangbin - María También" && spo.cleared,
    "then each song is found as for a list, and Import makes the playlist under its Spotify name (" + JSON.stringify([spo.found, spo.added]) + ")");
  check(/is-error/.test(spo.failed || ""), "a playlist Spotify won't share says why (" + spo.failed + ")");
  await put("/queues/smoke", beforeImport);
  await put("/importJobs", null);

  // an empty playlist says so, with Import a playlist and Find tracks
  await put("/queues/smoke", null);
  const emptyList = await page.evaluate(async () => {
    await ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0"));
    await new Promise((r) => setTimeout(r, 200));
    const box = document.querySelector("#mainqueue .q-empty");
    const out = { shown: !!box, title: box && box.querySelector("h3").textContent, acts: box ? [...box.querySelectorAll("button")].map((b) => b.textContent.trim()).join(",") : "" };
    if (box) box.querySelector(".q-emptyImport").click();
    await new Promise((r) => setTimeout(r, 100));
    const dlg = document.getElementById("importPromptBox");
    out.opens = dlg.open && !document.getElementById("im-step1").hidden;
    dlg.close();
    return out;
  });
  check(emptyList.shown && /^(Bring your playlists|This playlist is empty)$/.test(emptyList.title) && emptyList.acts === "downloadImport a playlist,addFind tracks" && emptyList.opens,
    "an empty playlist offers Import a playlist and Find tracks, and Import opens the import (" + JSON.stringify(emptyList) + ")");
  await put("/queues/smoke", beforeImport);
  await page.evaluate(() => ftapi.queueRef.once("value").then((s) => ftapi.events.emit("playlistChanged", s.val(), "0")));

  console.log("-- Grab: one tap to the playlist you grabbed to last, with Undo and Change; ▾ opens the picker");
  const listBeforeGrab = await listNow(); // put back after: later checks count this list
  const grabbed = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    const count = async () => Object.keys((await ftapi.db().ref("queues/smoke").once("value")).val() || {}).length;
    const realUid = ftapi.uid;
    ftapi.uid = "smoke";
    try { localStorage.removeItem("ft-lastGrabList"); } catch (e) { /* none */ }
    const out = {};
    const before = await count();
    // the first grab: no list yet, so the picker opens
    document.getElementById("grab").click();
    await until(() => $("#stealContain").is(":visible"));
    out.firstOpens = $("#stealContain").is(":visible");
    if (!$("#stealpicker option[value='0']").length) $("#stealpicker").append(new Option("Default Playlist", "0"));
    $("#stealpicker").val("0").trigger("change");
    await wait(300);
    out.remembered = localStorage.getItem("ft-lastGrabList");
    const once = await count();
    // the next grab goes straight there, with Undo and Change
    document.getElementById("grab").click();
    await wait(400);
    out.noPicker = $("#stealContain").is(":hidden");
    out.actions = [...document.querySelectorAll("#ft-toast .ft-toast-action")].map((b) => b.textContent).join();
    const twice = await count();
    [...document.querySelectorAll("#ft-toast .ft-toast-action")].find((b) => b.textContent === "Undo").click();
    for (let i = 0; i < 30 && (await count()) !== twice - 1; i++) await wait(100);
    out.counts = [before, once, twice, await count()].join();
    // the ▾ always opens the picker
    document.getElementById("st-grabPick").click();
    await until(() => $("#stealContain").is(":visible"));
    out.pickOpens = $("#stealContain").is(":visible");
    document.getElementById("st-grabPick").click(); // a second ▾ keeps it open
    out.pickStays = $("#stealContain").is(":visible");
    document.body.click(); // a click elsewhere closes it
    out.pickCloses = $("#stealContain").is(":hidden");
    ftapi.uid = realUid;
    return out;
  });
  check(grabbed.firstOpens && grabbed.remembered === "0" && grabbed.noPicker && grabbed.actions === "Undo,Change" && /^(\d+),\1|/.test(grabbed.counts),
    "Grab: the first opens the picker, the next goes straight to that playlist with Undo and Change (" + JSON.stringify(grabbed) + ")");
  const [g0, g1, g2, g3] = grabbed.counts.split(",").map(Number);
  check(g1 === g0 + 1 && g2 === g1 + 1 && g3 === g1 && grabbed.pickOpens && grabbed.pickStays && grabbed.pickCloses,
    "each grab adds one, Undo takes the last back, and the ▾ always opens the picker (" + grabbed.counts + ")");
  await put("/queues/smoke", listBeforeGrab);

  console.log("-- keys: H fires, G grabs, M mutes, ? lists them; never while typing");
  const hotkeys = {};
  await page.evaluate(() => {
    window.__pressed = [];
    ["fire", "grab", "volstatus"].forEach((id) => document.getElementById(id).addEventListener("click", () => window.__pressed.push(id), true));
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
  });
  await page.keyboard.press("h");
  await page.keyboard.press("g");
  await page.keyboard.press("m");
  hotkeys.page = await page.evaluate(() => window.__pressed.join());
  await page.evaluate(() => { $("#stealContain").hide(); const t = document.getElementById("ft-toast"); if (t) t.classList.remove("show"); });
  await page.focus("#newchat").catch(() => {});
  await page.keyboard.press("h");
  hotkeys.typed = await page.evaluate(() => (document.getElementById("newchat") || {}).value + "|" + window.__pressed.length);
  await page.evaluate(() => { const c = document.getElementById("newchat"); if (c) { c.value = ""; c.blur(); } });
  await page.keyboard.press("Shift+Slash");
  hotkeys.help = await page.evaluate(() => document.getElementById("helpBox").open && /Shortcuts and commands/.test(document.getElementById("helpTitle").textContent));
  await page.keyboard.press("Escape");
  hotkeys.closed = await page.evaluate(() => !document.getElementById("helpBox").open);
  check(hotkeys.page === "fire,grab,volstatus" && hotkeys.typed === "h|3" && hotkeys.help && hotkeys.closed,
    "keys: H fires, G grabs, M mutes and ? lists them; in the chat box H is just an h (" + JSON.stringify(hotkeys) + ")");
  await page.keyboard.press("m"); // unmute again

  console.log("-- the stage's states: the decks open, the bot keeping the music going, Listen to the room");
  const tableBefore = await (await fetch(DB + "/table.json?ns=" + NS)).json();
  const stageState = async () => page.evaluate(() => {
    const box = document.getElementById("st-state");
    return (document.getElementById("djStage").className.match(/st-(empty|botonly)/) || [""])[0] + "|" + (box.hidden ? "" : document.getElementById("st-stateText").textContent);
  });
  const states = {};
  await put("/table", null);
  await page.waitForFunction(() => document.getElementById("djStage").classList.contains("st-empty"), null, { timeout: 10000 }).catch(() => {});
  states.open = await stageState();
  await put("/users/smokebot", { username: "smokebot", hostbot: true, status: true });
  await put("/table", { b1: { id: "smokebot", name: "smokebot" } });
  await page.waitForFunction(() => document.getElementById("djStage").classList.contains("st-botonly"), null, { timeout: 10000 }).catch(() => {});
  states.bot = await stageState();
  // the note floats over the stage: the DJ stands where they always do (it once took room in the
  // stage's column and lifted the deck by its own height). Shown even where the sound is held back.
  const deckLift = () => page.evaluate(() => {
    const blocked = document.body.classList.contains("media-blocked");
    document.body.classList.remove("media-blocked");
    const r = Math.round(document.getElementById("djStage").getBoundingClientRect().bottom - document.getElementById("deck").getBoundingClientRect().bottom);
    const shown = getComputedStyle(document.getElementById("st-state")).display !== "none";
    document.body.classList.toggle("media-blocked", blocked);
    return { gap: r, shown };
  });
  const liftBot = await deckLift();
  await put("/table", tableBefore);
  await put("/users/smokebot", null);
  await page.waitForFunction(() => !/st-(empty|botonly)/.test(document.getElementById("djStage").className), null, { timeout: 10000 }).catch(() => {});
  states.after = await stageState();
  const liftAfter = await deckLift();
  check(liftBot.shown && !liftAfter.shown && liftBot.gap === liftAfter.gap,
    "the bot's note doesn't lift the DJ: the deck sits at the stage's bottom with or without it (" + JSON.stringify({ liftBot, liftAfter }) + ")");
  states.listen = await page.evaluate(() => { firetable.ui.renderStageState(); return document.querySelector("#tapToPlay b").textContent + "|" + document.getElementById("tapToPlaySub").textContent; });
  check(/^st-empty\|The decks are open\. Hop on and the room plays from your ★ playlist\./.test(states.open) && states.bot === "st-botonly|The bot keeps the music going until someone hops on." && states.after === "|",
    "the stage says when the decks are open and when the bot is keeping the music going, and nothing otherwise (" + JSON.stringify(states) + ")");
  check(states.listen === "Listen to the room|", "audio blocked: Listen to the room, and nothing under it (the stage and the bar say who's playing what) (" + states.listen + ")");

  console.log("-- Fire's count on its button");
  const fires = await page.evaluate(async () => {
    const badge = () => { const b = document.getElementById("st-fireCount"); return (b.hidden ? "hidden" : b.textContent) + "|" + document.getElementById("fire").getAttribute("aria-label"); };
    const keep = { count: firetable.fireCount, who: firetable.fireReactors };
    firetable.fireCount = 0; firetable.fireReactors = {};
    firetable.actions.updateFireReactionDisplay();
    const out = { none: badge() };
    const at = firetable.song.started;
    const send = (id, txt) => firetable.actions.processFireReactionMessage({ id: id, txt: txt, time: Date.now(), forSong: at });
    send("fan1", "🔥"); out.one = badge();
    send("fan2", ":fire:"); send("fan2", "🔥"); out.two = badge();
    send("fan1", ":fire_off:"); out.off = badge();
    firetable.actions.processFireReactionMessage({ id: "fan3", txt: "🔥", time: Date.now(), forSong: at - 1 }); out.otherSong = badge();
    firetable.fireCount = 0; firetable.fireReactors = {}; // what newSong does
    firetable.actions.updateFireReactionDisplay();
    await new Promise((r) => setTimeout(r, 0));
    out.reset = badge();
    firetable.fireCount = keep.count; firetable.fireReactors = keep.who;
    firetable.actions.updateFireReactionDisplay();
    return out;
  });
  check(fires.none === "hidden|Fire!" && fires.one === "1|Fire! (1 so far)" && fires.two === "2|Fire! (2 so far)" && fires.off === "1|Fire! (1 so far)" && fires.otherSong === "1|Fire! (1 so far)" && fires.reset === "hidden|Fire!",
    "Fire shows how many fires this song has, one per person, and starts again at none (" + JSON.stringify(fires) + ")");

  console.log("-- the Turntable theme: /turntable in chat, a required avatar pick, Awesome is Fire, Back to Live leaves the music alone");
  const tt = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); } return false; };
    const out = {};
    location.hash = "#live";
    await wait(300);
    // as a member (this page is a visitor's): the room's panels in, someone signed in
    const shellWasIn = !!document.getElementById("appShell"), loginWas = $("#mainGrid").hasClass("login");
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login");
    const realUid = ftapi.uid;
    ftapi.uid = "smoke";
    const hadSmoke = ftapi.users.smoke ? Object.assign({}, ftapi.users.smoke) : null;
    ftapi.users.smoke = ftapi.users.smoke || { username: "smoke", status: true };
    ftapi.events.emit("usersChanged", ftapi.users);
    await wait(200);
    localStorage.removeItem("firetableTurntableAvatar");
    delete ftapi.users.smoke.ttAvatar;
    out.cssBefore = { inPage: !!document.getElementById("tt-css"), fetched: performance.getEntriesByType("resource").some((e) => /ttskin\.css|img\/tt\/|Doto-/.test(e.name)) };
    const player = document.getElementById("playerArea"), src = player.getAttribute("src");
    ftapi.events.emit("newChat", { chatID: "smktt" + Date.now(), feedID: "f", id: "dj1", name: "dj1", txt: "tt test", time: Date.now() });
    await wait(200);
    const chatFace = document.querySelector("#chats .ft-avatar[data-avatar-uid]");
    const liveFace = chatFace && chatFace.style.backgroundImage;
    // the easter egg: typed in chat
    const box = document.getElementById("newchat");
    box.value = "/turntable";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    out.on = await until(() => document.body.classList.contains("tt-skin") && firetable.tt.isOn() && document.querySelector("#tt-table .tt-seat"));
    const room = document.getElementById("tt-room").getBoundingClientRect();
    out.room = room.width > 300 && room.height > 200;
    out.picker = await until(() => document.getElementById("tt-picker").open && document.querySelectorAll("#tt-pickGrid .tt-pickCell").length === 16);
    out.required = document.getElementById("tt-pickClose").hidden;
    const pick = document.querySelectorAll("#tt-pickGrid .tt-pickCell")[3].dataset.av;
    document.querySelectorAll("#tt-pickGrid .tt-pickCell")[3].click();
    out.chosen = !document.getElementById("tt-picker").open && localStorage.getItem("firetableTurntableAvatar") === pick;
    await wait(300);
    out.seats = document.querySelectorAll("#tt-table .tt-seat").length;
    out.dj = !!document.querySelector("#tt-table .tt-dj .tt-fig[data-av]");
    out.crowd = document.querySelectorAll("#tt-crowd .tt-listener .tt-fig[data-av]").length;
    // everyone is a head on a body (the art's own, or the picture cut at the neck): no one drawn whole
    const figs = [...document.querySelectorAll("#tt-room .tt-fig[data-av]")];
    out.heads = figs.length > 0 && figs.every((f) => f.querySelector(":scope > .tt-head") && f.querySelector(":scope > .tt-body") && !f.querySelector(".tt-whole"));
    // a listener who fires rocks their head; their body stays put
    const fan = document.querySelector("#tt-crowd .tt-listener");
    fan.classList.add("tt-fired");
    const anim = (sel) => getComputedStyle(fan.querySelector(sel)).animationName;
    out.rock = anim(".tt-head") === "tt-rock" && anim(".tt-body") === "none" && !/tt-(sway|rock|bob)/.test(getComputedStyle(fan).animationName + getComputedStyle(fan.querySelector(".tt-fig")).animationName);
    // as deepcut: drawn at 20 frames a second (stepped), the head turning about its middle
    const headCs = getComputedStyle(fan.querySelector(".tt-head"));
    out.rock = out.rock && /steps\(2/.test(headCs.animationTimingFunction) && headCs.animationDuration === "1.2s" &&
      headCs.transformOrigin.split(" ").map(parseFloat).every((v, i) => Math.abs(v - (i ? fan.querySelector(".tt-head").offsetHeight : fan.querySelector(".tt-head").offsetWidth) / 2) < 1);
    out.rockInfo = [out.heads, anim(".tt-head"), anim(".tt-body"), getComputedStyle(fan).animationName, headCs.animationTimingFunction, headCs.transformOrigin].join("|");
    fan.classList.remove("tt-fired");
    // a DJ: the one playing bobs their head (deepcut's bob); one who fires small-rocks it
    const dj = document.querySelector("#tt-table .tt-seat[data-who]");
    const djAnim = () => getComputedStyle(dj.querySelector(".tt-head")).animationName;
    const wasOn = dj.classList.contains("tt-on"), wasFired = dj.classList.contains("tt-fired");
    dj.classList.add("tt-on"); dj.classList.remove("tt-fired");
    const bob = djAnim();
    dj.classList.add("tt-fired");
    const small = djAnim();
    dj.classList.toggle("tt-on", wasOn); dj.classList.toggle("tt-fired", wasFired);
    out.djMoves = bob === "tt-bob" && small === "tt-smallrock";
    out.djMovesInfo = bob + "|" + small;
    out.screen = player.isConnected && document.getElementById("playerArea") === player && player.getAttribute("src") === src;
    // every face here is a Turntable one
    const faces = [...document.querySelectorAll("#chats .ft-avatar[data-avatar-uid]")];
    out.faces = faces.length > 0 && faces.every((el) => el.dataset.tt && getComputedStyle(el, "::after").content !== "none");
    out.faceInfo = faces.length + ":" + faces.filter((el) => el.dataset.tt).length + ":" + document.querySelectorAll("#chats .ft-avatar").length;
    out.menu = !document.getElementById("nav-ttAvatar").hidden && !document.getElementById("nav-ttLaptop").hidden;
    // Awesome is Fire; Storm takes it back (never below none)
    const count = () => firetable.fireCount || 0;
    const start = count();
    const at = firetable.song.started;
    const realSend = firetable.actions.sendReaction; // sent to this page, not the database
    firetable.actions.sendReaction = (txt) => firetable.actions.processFireReactionMessage({ id: ftapi.uid, txt: txt, time: Date.now(), forSong: at });
    document.getElementById("tt-awesome").click();
    await wait(100);
    out.awesome = count() === start + 1 && document.getElementById("tt-awesome").classList.contains("on");
    document.getElementById("tt-storm").click();
    await wait(100);
    out.storm = count() === start && !document.getElementById("tt-awesome").classList.contains("on");
    document.getElementById("tt-storm").click();
    await wait(100);
    out.never = count() === start;
    firetable.actions.sendReaction = realSend;
    // a song change: Live moves to the next DJ with the song's colours, after the seats' own events,
    // and the spotlight and the nodding head go with it
    const onSeat = () => { const el = document.querySelector("#tt-table .tt-seat.tt-on"); return el && el.dataset.who; };
    const lightAt = () => { const el = document.querySelector("#tt-table .tt-seat.tt-on"), l = document.getElementById("tt-djlight"); return !l.hidden && el && l.style.getPropertyValue("--i") === el.style.getPropertyValue("--i"); };
    const keys = Object.keys(firetable.tableData || {}), was = firetable.playdex, wasDj = firetable.displayedDjId;
    const next = keys.find((k) => firetable.tableData[k].id !== wasDj && firetable.tableData[k].id !== (firetable.song && firetable.song.djid));
    const colours = { color: firetable.color, txt: firetable.countcolor };
    out.turnBefore = onSeat() === wasDj && lightAt() && firetable.song && firetable.song.djid === wasDj;
    if (next !== undefined) {
      // as the database sends it: the next seat first (held back for the song's colours), then the song, then its colours
      ftapi.events.emit("spotlightStateChanged", next);
      await wait(100);
      out.held = onSeat() === wasDj;
      firetable.song.djid = firetable.tableData[next].id;
      ftapi.events.emit("colorsChanged", colours);
      await until(() => onSeat() === firetable.tableData[next].id, 2000);
      out.turn = firetable.displayedDjId === firetable.tableData[next].id && onSeat() === firetable.displayedDjId && lightAt();
      firetable.song.djid = wasDj;
      ftapi.events.emit("spotlightStateChanged", was);
      out.turnBack = await until(() => onSeat() === wasDj && lightAt(), 2000);
    }
    // a DJ's menu: tap the DJ, the room's own actions for who's looking
    const djBtn = document.querySelector("#tt-table .tt-seat[data-who] .tt-dj");
    djBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    const menu = document.getElementById("tt-djmenu");
    out.djMenu = !menu.hidden && [...menu.querySelectorAll(".tt-djitem")].map((b) => b.textContent).join("|");
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    out.djMenuClosed = menu.hidden;
    // art tracks: a cover inside flat bars zooms on the right screen; a video's frame doesn't
    const pic = (draw) => new Promise((r) => { const c = document.createElement("canvas"); c.width = 480; c.height = 360; const x = c.getContext("2d"); draw(x); const i = new Image(); i.onload = () => r(i); i.src = c.toDataURL(); });
    const spots = (x, x0, y0, w, h, n) => { for (let k = 0; k < n; k++) { x.fillStyle = "hsl(" + (k * 37 % 360) + ",70%," + (25 + k % 45) + "%)"; x.fillRect(x0 + (k * 53 % (w - 12)), y0 + (k * 29 % (h - 12)), 12, 12); } };
    const artPic = await pic((x) => { x.fillStyle = "#000"; x.fillRect(0, 0, 480, 360); x.fillStyle = "#6b3a1e"; x.fillRect(0, 45, 480, 270); spots(x, 105, 45, 270, 270, 400); });
    const videoPic = await pic((x) => { x.fillStyle = "#000"; x.fillRect(0, 0, 480, 360); spots(x, 0, 45, 480, 270, 900); });
    // a cover with a flat background of its own (green round a sculpture): its background isn't a bar
    const flatPic = await pic((x) => { x.fillStyle = "#000"; x.fillRect(0, 0, 480, 360); x.fillStyle = "#3aa83a"; x.fillRect(105, 45, 270, 270); x.fillStyle = "#8a8a84"; x.beginPath(); x.ellipse(240, 180, 70, 95, 0, 0, 7); x.fill(); spots(x, 190, 110, 100, 140, 60); });
    const cover = firetable.tt._coverBox(artPic), flatCover = firetable.tt._coverBox(flatPic);
    out.artTrack = !!cover && Math.abs(cover.cw - 270) <= 10 && Math.abs(cover.ch - 270) <= 10 && !firetable.tt._coverBox(videoPic) &&
      !!flatCover && Math.abs(flatCover.cw - 270) <= 10 && Math.abs(flatCover.ch - 270) <= 10;
    // the songboard: a line too long to fit scrolls a dot column at a time; a short one stays put
    const artistEl = document.getElementById("artist"), wasArtist = artistEl.textContent;
    artistEl.textContent = "Ezra Collective featuring Yazmin Lacey and Friends";
    await wait(600);
    const led = document.getElementById("tt-line1"), pitch = parseFloat(getComputedStyle(led).fontSize) / 10;
    const ledAt = () => new DOMMatrix(getComputedStyle(led.querySelector(".tt-run")).transform).m41;
    const a1 = ledAt(); await wait(250); const a2 = ledAt();
    out.ledScroll = led.classList.contains("tt-marquee") && a2 < a1 && [a1, a2].every((x) => Math.abs(x / pitch - Math.round(x / pitch)) < 0.02);
    artistEl.textContent = "Moby";
    await wait(400);
    out.ledStill = !led.classList.contains("tt-marquee");
    artistEl.textContent = wasArtist;
    // the sticker builder
    document.getElementById("nav-ttLaptop").click();
    out.laptop = document.getElementById("tt-laptopEdit").open;
    document.querySelector('#tt-laptopEdit [data-add="heart"]').click();
    out.food = ["e2615", "e1f32f"].every((id) => document.querySelector('#tt-laptopEdit [data-add="' + id + '"]'));
    // the turntable.fm logo, turned a quarter by dragging its corner round its middle (no turn buttons)
    document.querySelector('#tt-laptopEdit [data-add="ttfm"]').click();
    const handle = document.getElementById("tt-lapTurn"), picked = document.querySelector("#tt-lapLid .tt-sticker.on");
    const pb = picked.getBoundingClientRect(), hb = handle.getBoundingClientRect();
    const cx = pb.left + pb.width / 2, cy = pb.top + pb.height / 2, hx = hb.left + hb.width / 2, hy = hb.top + hb.height / 2;
    const r0 = +getComputedStyle(picked).getPropertyValue("--r").replace("deg", "");
    const ptr = (type, x, y) => handle.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    ptr("pointerdown", hx, hy);
    ptr("pointermove", cx - (hy - cy), cy + (hx - cx)); // a quarter turn clockwise round the middle
    ptr("pointerup", cx - (hy - cy), cy + (hx - cx));
    const turned = document.querySelector("#tt-lapLid .tt-sticker.on");
    const r1 = +turned.style.getPropertyValue("--r").replace("deg", "");
    out.turn = !handle.hidden && !document.querySelector('#tt-laptopEdit [data-lap="left"], #tt-laptopEdit [data-lap="right"]') &&
      Math.abs(((r1 - r0 - 90) % 360 + 540) % 360 - 180) <= 2;
    out.turnInfo = r0 + "→" + r1;
    // and off the lid's edge: dragged far left, it hangs off (the lid cuts it), some of it still on
    const lidBox = document.getElementById("tt-lapLid").getBoundingClientRect();
    const logo = document.querySelector("#tt-lapLid .tt-sticker.on"), lb = logo.getBoundingClientRect();
    const sx = lb.left + lb.width / 2, sy = lb.top + lb.height / 2;
    const drag = (type, x, y) => (type === "pointerdown" ? logo : document.getElementById("tt-lapLid")).dispatchEvent(new PointerEvent(type, { pointerId: 8, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    drag("pointerdown", sx, sy);
    drag("pointermove", lidBox.left - 400, sy);
    drag("pointerup", lidBox.left - 400, sy);
    const off = document.querySelector("#tt-lapLid .tt-sticker.on"), ob = off.getBoundingClientRect();
    out.bleed = parseFloat(off.style.left) < 0 && ob.left < lidBox.left && ob.right > lidBox.left + 2;
    out.bleedInfo = off.style.left;
    document.querySelector('#tt-laptopEdit [data-lid="teal"]').click();
    document.querySelector('#tt-laptopEdit [data-lap="save"]').click();
    out.stickers = localStorage.getItem("firetableTurntableLaptop") || "";
    // opened again, the sticker off the edge is where it was left
    firetable.tt.openLaptop();
    const back = [...document.querySelectorAll("#tt-lapLid .tt-sticker")].map((el) => parseFloat(el.style.left));
    out.bleedBack = back.length === 2 && back[1] < 0 && Math.abs(back[1] - parseFloat(out.bleedInfo)) < 1;
    document.querySelector('#tt-laptopEdit [data-lap="cancel"]').click();
    // the sound held back: Live's "Listen to the room" is a plain Turntable button, centred on the floor,
    // and still starts the sound
    document.body.classList.add("media-blocked");
    const ttp = document.getElementById("tapToPlay"), tb = ttp.getBoundingClientRect(), sb = document.getElementById("djStage").getBoundingClientRect();
    const tcs = getComputedStyle(ttp), realTap = firetable.media.tapToPlay;
    let tapped = false;
    firetable.media.tapToPlay = () => { tapped = true; };
    ttp.click();
    firetable.media.tapToPlay = realTap;
    // on the stage's base, between the front speakers (stage art x 523 to 945, y 530 to 590), at the stage's scale
    const cv = document.querySelector("#tt-room .tt-canvas").getBoundingClientRect(), k = cv.width / 1468;
    const bx = (tb.left + tb.width / 2 - cv.left) / k, by = (tb.top + tb.height / 2 - cv.top) / k;
    out.listenBase = Math.abs(bx - 734) < 4 && Math.abs(by - 560) < 4 && tb.width / k < 422;
    out.listen = tb.width > 0 && out.listenBase && tcs.boxShadow.indexOf("rgba(0, 0, 0") === -1 &&
      getComputedStyle(document.getElementById("tapToPlaySub")).display === "none" && /^rgb\(2(2[0-9]|[3-5][0-9])/.test(tcs.backgroundImage.replace(/^linear-gradient\(/, "")) && tapped;
    out.listenInfo = [Math.round(bx), Math.round(by), Math.round(tb.width / k), tcs.boxShadow, tcs.backgroundImage.slice(0, 40), tapped].join(" | ");
    document.body.classList.remove("media-blocked");
    // one sidebar or two
    document.getElementById("tt-layout").click();
    const lay1 = document.body.getAttribute("data-tt-layout");
    document.getElementById("tt-layout").click();
    out.layout = lay1 !== document.body.getAttribute("data-tt-layout");
    // People here: a short list, and the panel's grey still runs to the bottom (no black underneath)
    document.getElementById("tt-tab-room").click();
    document.querySelector('#tt-pane [data-tt-sub="people"]').click();
    await wait(200);
    const paneBox = document.getElementById("tt-pane").getBoundingClientRect(), stageBox = document.getElementById("stage").getBoundingClientRect();
    out.peopleFull = getComputedStyle(document.getElementById("tt-pane")).display !== "none" && Math.abs(paneBox.bottom - stageBox.bottom) < 2;
    out.peopleInfo = Math.round(paneBox.bottom) + "/" + Math.round(stageBox.bottom) + " " + window.innerWidth;
    document.querySelector('#tt-pane .tt-back').click();
    // and back
    document.getElementById("tt-exit").click();
    await wait(300);
    out.off = !document.body.classList.contains("tt-skin") && getComputedStyle(document.getElementById("tt-room")).display === "none" &&
      document.getElementById("djlistpickerWrap").closest("#themebox") !== null && localStorage.getItem("firetableTurntable") === null;
    out.after = document.getElementById("playerArea") === player && player.getAttribute("src") === src;
    // and Live's own Listen to the room again: its pill, on one line, none of the theme's
    document.body.classList.add("media-blocked");
    const live = getComputedStyle(document.getElementById("tapToPlay"));
    out.liveListen = live.display !== "none" && !/241, 207, 58/.test(live.backgroundImage) && parseFloat(live.borderRadius) > 20 &&
      getComputedStyle(document.getElementById("tapToPlaySub")).display === "none";
    out.liveListenInfo = [live.backgroundImage.slice(0, 30), live.borderRadius].join(" | ");
    document.body.classList.remove("media-blocked");
    out.liveFace = !chatFace || chatFace.style.backgroundImage === liveFace;
    out.noTtFaceInLive = !chatFace || getComputedStyle(chatFace, "::after").content === "none" || getComputedStyle(chatFace, "::after").backgroundImage === "none";
    out.join = document.getElementById("joinBox").open; // nothing asked a member to sign in
    ftapi.uid = realUid;
    if (hadSmoke) ftapi.users.smoke = hadSmoke; else delete ftapi.users.smoke;
    ftapi.events.emit("usersChanged", ftapi.users);
    if (!shellWasIn) firetable.$appShell = $("#appShell").detach();
    $("#mainGrid").toggleClass("login", loginWas);
    ["firetableTurntableAvatar", "firetableTurntableLaptop", "firetableTurntableLayout"].forEach((k) => localStorage.removeItem(k));
    return out;
  });
  check(!tt.cssBefore.inPage && !tt.cssBefore.fetched, "nothing of the theme (its stylesheet, pictures or font) is fetched until someone goes in (" + JSON.stringify(tt.cssBefore) + ")");
  check(tt.on && tt.room, "/turntable in chat turns the Turntable theme on, and the room fills the stage");
  check(tt.picker && tt.required && tt.chosen, "the first time in, an avatar is picked (every one unlocked), and kept");
  check(tt.seats === 4 && tt.dj && tt.crowd > 0, "the DJs stand at their laptops and everyone else on the floor (" + tt.seats + " seats, " + tt.crowd + " on the floor)");
  check(tt.screen && tt.after, "going in and out never touches the room's player (the same frame, the same video)");
  check(tt.faces, "chat shows Turntable faces in the theme (" + tt.faceInfo + ")");
  check(tt.awesome && tt.storm && tt.never && !tt.join, "Awesome is Fire, Storm takes it back, and nothing counts below none");
  check(tt.food, "the sticker builder has coffee and a burrito");
  check(tt.bleed && tt.bleedBack && /;ttfm,9\d\d,/.test(tt.stickers), "a sticker can hang off the lid's edge, some of it kept on, and saves that way (" + tt.bleedInfo + ")");
  check(tt.turn && /;ttfm,/.test(tt.stickers), "the turntable.fm logo is a sticker, and a sticker turns by dragging its corner (" + tt.turnInfo + ")");
  check(tt.menu && tt.laptop && /^teal;heart,/.test(tt.stickers), "the account menu has Turntable avatar and Laptop stickers, and stickers save (" + tt.stickers + ")");
  check(tt.layout, "one sidebar or two");
  check(tt.heads && tt.rock, "everyone is a head on a body, and a fire rocks the head only, as deepcut does (its rock: 20 frames a second, about the head's middle) (" + tt.rockInfo + ")");
  check(tt.djMoves, "the DJ playing bobs their head and a DJ who fires small-rocks it, as deepcut does (" + tt.djMovesInfo + ")");
  check(tt.listen, "the sound held back: a plain Turntable Listen button, on the stage's base between the front speakers at the stage's scale, that starts the sound (" + tt.listenInfo + ")");
  check(tt.peopleFull, "People here fills the panel to the bottom, however short the list (" + tt.peopleInfo + ")");
  check(tt.turnBefore && tt.held && tt.turn && tt.turnBack, "a song change moves the spotlight and the nodding head to the DJ now playing (" + [tt.turnBefore, tt.held, tt.turn, tt.turnBack] + ")");
  check(/^@ Mention\|Their card/.test(tt.djMenu || "") && tt.djMenuClosed, "a DJ's menu: the room's own actions for who's looking, and Escape closes it (" + tt.djMenu + ")");
  check(tt.artTrack, "an art track's cover fills the right screen (one with a flat background of its own too); a video's frame is left as it is");
  check(tt.ledScroll && tt.ledStill, "the songboard scrolls a line too long to fit, a dot column at a time; a short one stays put");
  check(tt.liveListen, "Back in Live, Listen to the room is Live's own (its pill, on one line) (" + tt.liveListenInfo + ")");
  check(tt.off && tt.liveFace && tt.noTtFaceInLive, "Back to Live: Live as it was, with Live's avatars");

  console.log("-- the stage's volume slider (a native range input)");
  const vol = await page.evaluate(async () => {
    const s = document.getElementById("slider");
    const out = { type: s.type, upright: getComputedStyle(s).writingMode.startsWith("vertical") };
    s.value = 35;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    out.saved = localStorage[STORAGE.volume];
    out.pct = s.style.getPropertyValue("--pct");
    firetable.actions.muteToggle();
    out.muted = s.value + "|" + localStorage[STORAGE.mute];
    firetable.actions.muteToggle();
    out.back = s.value;
    return out;
  });
  check(vol.type === "range" && vol.upright && vol.saved === "35" && vol.pct === "35%" && vol.muted === "0|35" && vol.back === "35",
    "moving it sets and saves the volume, and mute / un-mute move it (" + JSON.stringify(vol) + ")");
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
  // back to the tab later: the bot flagged another track meanwhile, and a list was made elsewhere
  await put("/playlists/smoke/p1/list/c/flagged", { date: 2, code: 2 });
  await put("/playlists/smoke/p3", { name: "New", list: { x: { type: 1, cid: "c9", name: "X - 9" } } });
  const recount = await page.evaluate(() => {
    const keysRead = [];
    const shallow = ftapi.utilities.shallowKeys;
    ftapi.utilities.shallowKeys = (path) => { keysRead.push(path); return shallow(path); };
    const all = { p1: { name: "Mix" }, p2: { name: "Empty" }, p3: { name: "New" } };
    firetable.ui.fillPlaylistPickers(all);
    return firetable.actions.loadListCounts(all, { flaggedOnly: true }).then(() => ({
      options: [...document.querySelectorAll("#listpicker option")].map((o) => o.value + "=" + o.textContent), keysRead
    }));
  }).catch((e) => ({ options: ["error: " + e.message], keysRead: [] }));
  check(recount.options.includes("p1=Mix (3, 2 ⚠)") && recount.options.includes("p3=New (1)") && recount.keysRead.join() === "playlists/smoke/p3/list",
    "back on the tab, only the flagged counts are fetched again (every track's key only for a list not counted yet) (" + JSON.stringify(recount) + ")");

  console.log("-- grab stats: the hostbot's sum when there is one, otherwise every grab counted here");
  await put("/grabs/smoke", { "1_c1": { u1: 1, u2: 2 }, "1_c2": { u3: 3 } });
  const grabsBefore = await page.evaluate(async () => {
    ftapi.uid = "smoke";
    firetable.actions.watchGrabs();
    await new Promise((r) => setTimeout(r, 1500));
    return { text: document.getElementById("grabStats").textContent, following: !!firetable.grabs.ref };
  }).catch((e) => ({ text: "error: " + e.message }));
  check(/^3 grabs across 2 tracks/.test(grabsBefore.text) && grabsBefore.following,
    "with no sum from the hostbot (an older one, or its rules not published), the site counts every grab itself (" + JSON.stringify(grabsBefore) + ")");
  await put("/grabCount/smoke", { n: 40, t: 12, last: "1_c2", lastAt: 3 });
  await page.waitForTimeout(1200);
  await put("/grabs/smoke/1_c9", { u9: 9 }); // the hostbot counts this one now, not the site
  await page.waitForTimeout(800);
  const grabsAfter = await page.evaluate(() => ({ text: document.getElementById("grabStats").textContent, following: !!firetable.grabs.ref }));
  check(/^40 grabs across 12 tracks/.test(grabsAfter.text) && !grabsAfter.following,
    "with the hostbot's sum, Profile shows it, and grabs/ is no longer downloaded (" + JSON.stringify(grabsAfter) + ")");
  await page.evaluate(() => firetable.actions.unwatchGrabs());
  await put("/grabCount/smoke", null);
  await put("/grabs/smoke", null);

  console.log("-- emoji: Emoji 17.0 in the picker, old shortnames still work");
  await page.waitForFunction(() => firetable.emojiMap && firetable.emojiMap.trombone, null, { timeout: 30000 }).catch(() => {});
  const emo = await page.evaluate(async () => {
    const before = document.querySelectorAll(".pickerResult").length; // the picker's data waits for its first open
    const fromHere = performance.getEntriesByType("resource").filter((r) => /emoji-(map|picker)\.json/.test(r.name)).every((r) => r.name.startsWith(location.origin));
    const built = await firetable.emojis.buildPicker();
    return {
      newest: firetable.emojiMap.trombone, renamed: firetable.emojiMap.hugging_face, old: firetable.emojiMap.smile, before, built, fromHere,
      sections: document.querySelectorAll("#pickerContents > div").length, picker: document.querySelectorAll(".pickerResult").length,
      words: (document.querySelector('.pickerResult[title="grinning_face_with_big_eyes"]') || { getAttribute: () => "" }).getAttribute("data-alternative-name"),
      chat: firetable.utilities.emojiShortnamestoUnicode(":orca: :pouting_face:")
    };
  });
  check(emo.newest === "\u{1FA8A}" && emo.renamed === "🤗" && emo.old === "😄" && emo.fromHere, "Emoji 17.0 shortnames load from this site, and renamed and old ones still work");
  check(emo.before === 0 && emo.built && emo.sections === 9 && emo.picker > 1900 && /smile/.test(emo.words) && /\u{1FACD}/u.test(emo.chat) && /😡/.test(emo.chat),
    "the picker loads on its first open, with every group, " + emo.picker + " emoji and their search words (" + JSON.stringify({ before: emo.before, words: emo.words }) + ")");

  console.log("-- :emoji suggestions while typing in the chat (CH-20)");
  const sug = { };
  try {
    await page.evaluate(() => { const c = document.getElementById("newchat"); c.value = ""; c.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.focus("#newchat");
    await page.keyboard.type("moo :co");
    await page.waitForFunction(() => !document.getElementById("ch-emojiSuggest").hidden, null, { timeout: 5000 });
    await page.keyboard.type("w");
    await page.waitForTimeout(100);
    const read = () => page.evaluate(() => ({
      shown: !document.getElementById("ch-emojiSuggest").hidden,
      names: [...document.querySelectorAll("#ch-emojiSuggestList [role=option]")].map((o) => o.dataset.name),
      selected: (document.querySelector('#ch-emojiSuggestList [aria-selected="true"]') || {}).dataset?.name,
      active: document.getElementById("newchat").getAttribute("aria-activedescendant"),
      twemoji: !!document.querySelector("#ch-emojiSuggestList img.emoji, #ch-emojiSuggestList .ch-esGlyph"),
      value: document.getElementById("newchat").value
    }));
    sug.list = await read();
    await page.keyboard.press("ArrowDown");
    sug.down = (await read()).selected;
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter"); // inserts, doesn't send
    sug.entered = await read();
    await page.keyboard.type("and :fir");
    await page.waitForFunction(() => !document.getElementById("ch-emojiSuggest").hidden, null, { timeout: 5000 });
    await page.keyboard.press("Escape");
    sug.escaped = await read();
    await page.keyboard.type("e");
    sug.stayedClosed = !(await read()).shown;
    await page.keyboard.type(" :sob");
    await page.waitForFunction(() => !document.getElementById("ch-emojiSuggest").hidden, null, { timeout: 5000 });
    await page.click("#ch-emojiSuggestList [role=option]");
    sug.clicked = await read();
    sug.focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  } catch (e) { sug.error = e.message; }
  await page.evaluate(() => { const c = document.getElementById("newchat"); c.value = ""; c.dispatchEvent(new Event("input", { bubbles: true })); c.blur(); });
  check(!sug.error && sug.list.shown && sug.list.names[0] === "cow" && sug.list.names.includes("cowboy_hat_face") && sug.list.selected === "cow" && sug.list.active && sug.list.twemoji,
    "typing :cow shows matching emoji above the chat box, the best one chosen (" + JSON.stringify(sug.list || sug.error) + ")");
  check(sug.down && sug.down !== "cow" && sug.entered && sug.entered.value === "moo :cow: " && !sug.entered.shown,
    "Up and Down choose, and Enter puts in the :shortname: instead of sending (" + JSON.stringify({ down: sug.down, entered: sug.entered }) + ")");
  check(sug.escaped && !sug.escaped.shown && sug.stayedClosed && sug.clicked && sug.clicked.value === "moo :cow: and :fire :sob: " && sug.focus === "newchat",
    "Escape closes them for that word, and a click picks one and keeps typing in the box (" + JSON.stringify({ clicked: sug.clicked && sug.clicked.value, focus: sug.focus }) + ")");

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
  // the bot's lines are quieter than people's (1.13); the people list names each role (1.12)
  await put("/users/bot/status", true); // online, as the room's bot is
  await page.waitForFunction(() => ftapi.users && ftapi.users.bot && ftapi.users.bot.hostbot, null, { timeout: 10000 }).catch(() => {});
  const botLine = await page.evaluate(async () => {
    const say = (id, txt) => ftapi.events.emit("newChat", { chatID: "smkq" + Math.random().toString(36).slice(2), feedID: "f", id, name: id, txt, time: Date.now() });
    say("bot", "dj1 has played this 3 times.");
    say("dj1", "nice one");
    await new Promise((r) => setTimeout(r, 100));
    const blocks = [...document.querySelectorAll("#chats > .newChat:not(.nowplayn)")].slice(-2);
    const size = (b) => getComputedStyle(b.querySelector(".chatText")).fontSize;
    const role = document.querySelector("#usersbox .prsnRole[title]");
    const members = [...document.querySelectorAll("#usersRegular .prson:not(.ft-skeleton)")];
    const plain = members.length + "|" + members.filter((m) => m.querySelector(".prsnRole")).length;
    return { plain, bot: blocks[0].classList.contains("ch-bot") + "|" + size(blocks[0]), person: blocks[1].classList.contains("ch-bot") + "|" + size(blocks[1]),
      role: role ? role.getAttribute("title") + "|" + role.getAttribute("aria-label") : "" };
  });
  check(botLine.bot === "true|13px" && botLine.person === "false|14px", "the room bot's chat lines are quieter than people's (" + JSON.stringify(botLine) + ")");
  check(/^(Mod|Supermod|Room bot)\|\1$/.test(botLine.role), "the people list names each role icon, for a tooltip and screen readers (" + botLine.role + ")");
  check(/^[1-9]\d*\|0$/.test(botLine.plain), "only the bot, mods and supermods have a role icon: no member's row repeats one (" + botLine.plain + ")");
  await put("/cards/cardL/owner", "smoke");
  await page.waitForFunction(() => $('.chat-grab-btn[data-card="cardL"]').attr("data-state") === "mine", null, { timeout: 8000 }).catch(() => {});
  legacy.after = await page.$eval('.chat-grab-btn[data-card="cardL"]', (b) => b.dataset.state).catch(() => "missing");
  check(legacy.shown === "A new trading card has been printed." && legacy.first === "open" && legacy.sent === "!grab" && legacy.card === "cardL" && legacy.after === "mine",
    "it hides \"Type !grab\", sends a plain !grab and learns the card from \"… grabbed the card!\" (" + JSON.stringify(legacy) + ")");

  console.log("-- chat keys: a hand-made key never reaches the page's markup or selectors");
  const keys = await page.evaluate(async () => {
    const emit = (chatID, extra) => ftapi.events.emit("newChat", Object.assign({ chatID, feedID: "-Fsmk", id: "keysmk", name: "keysmk", txt: "key test " + chatID, time: Date.now() }, extra));
    const before = { body: document.body.children.length, chats: document.querySelectorAll("#chats .chatText").length };
    const bad = ['x,*', 'x" data-pwned="1', 'x"><b id="pwned">', "x y", "a/txt", ""];
    bad.forEach((k) => emit(k));
    ftapi.events.emit("chatRemoved", { chatID: "x,*", feedID: "-Fsmk", hidden: true });
    const lookups = await Promise.all(bad.map((k) => ftapi.lookup.chatData(k)));
    // a normal pair from one person still groups into one block, with its card and reactions
    emit("-Nsmk1aaaaaaaaaaaaaa");
    const showCard = firetable.actions.showCard;
    firetable.actions.showCard = () => {}; // the canvas is what's checked here, not the drawing
    emit("-Nsmk2aaaaaaaaaaaaaa", { card: "cardA" });
    firetable.actions.showCard = showCard;
    const line2 = document.getElementById("chattxt-Nsmk2aaaaaaaaaaaaaa");
    ftapi.events.emit("chatRemoved", { chatID: "-Nsmk1aaaaaaaaaaaaaa", feedID: "-Fsmk", hidden: true });
    return {
      shown: document.querySelectorAll("#chats .chatText").length - before.chats,
      pwned: !!document.querySelector("[data-pwned], #pwned"),
      body: document.body.children.length === before.body,
      stray: document.querySelectorAll("body > .reactAdd, #mainGrid > .reactAdd, #chats > .reactAdd").length,
      lookups: lookups.every((v) => v === null),
      grouped: !!line2 && line2.parentElement === document.getElementById("chattxt-Nsmk1aaaaaaaaaaaaaa").parentElement,
      card: !!document.querySelector("#chattxt-Nsmk2aaaaaaaaaaaaaa > canvas#cardMaker-Nsmk2aaaaaaaaaaaaaa"),
      reactions: !!document.getElementById("reactions-Nsmk2aaaaaaaaaaaaaa"),
      removed: document.getElementById("chattxt-Nsmk1aaaaaaaaaaaaaa").textContent === "[message removed]",
      safe: ["-Nabc_09", "x,*", 'a"b', "a/b", 5].map((k) => ftapi.utilities.isSafeKey(k)).join()
    };
  });
  check(keys.shown === 2 && !keys.pwned && keys.body && !keys.stray && keys.lookups && keys.safe === "true,false,false,false,false",
    "messages with hand-made keys are dropped, and nothing is injected or matched (" + JSON.stringify(keys) + ")");
  check(keys.grouped && keys.card && keys.reactions && keys.removed, "normal messages still group, show their card and reactions, and can be removed (" + JSON.stringify(keys) + ")");

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
    input.value = "exile (live) - MESH";
    document.querySelector("#tagEditorForm .tagCase").click();
    const cased = input.value;
    input.value = "Exile (Live) - Mesh";
    document.querySelector("#tagEditorForm .tagSwap").click();
    const swapped = input.value;
    document.querySelector("#tagEditorForm .tagSave").click();
    await new Promise((r) => setTimeout(r, 200));
    ftapi.actions.editTag = editTag;
    return { cased, swapped, calls: calls.join(), open: document.getElementById("tagEditorPopover").matches(":popover-open") };
  });
  check(saved.cased === "Exile (Live) - MESH", "Title Case puts the tags in AP title case (" + saved.cased + ")");
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
  // a song the room has tags for (a mod's fix) is added under them, however it's added
  await put("/globalTracks/1roomtag0001", { artist: "Poolside", title: "Harvest Moon", type: 1 });
  await put("/globalTracks/1roomtag0002", { artist: "Unknown", title: "Something", type: 1 });
  const roomTags = await page.evaluate(async () => {
    ftapi.roomTagCache = {};
    const ref = ftapi.queueRef;
    const nameOf = (k) => ref.child(k).once("value").then((s) => (s.val() || {}).name);
    const out = {};
    const top = await new Promise((r) => ftapi.actions.addTrackToTop(ref, { type: 1, cid: "roomtag0001", name: "POOLSIDE - Harvest Moon (Official Video)" }, null, null, (err, k) => r(k)));
    out.top = await nameOf(top);
    const bottom = ftapi.actions.addToList(1, "POOLSIDE - Harvest Moon (Official Video)", "roomtag0001", false);
    for (let i = 0; i < 40 && (await nameOf(bottom)) !== "Poolside - Harvest Moon"; i++) await new Promise((r) => setTimeout(r, 50));
    out.bottom = await nameOf(bottom);
    await new Promise((r) => ftapi.actions.addTracksToTop(ref, [{ type: 1, cid: "roomtag0001", name: "poolside harvest moon" }, { type: 1, cid: "roomtag0002", name: "Real - Name" }, { type: 1, cid: "roomtag0003", name: "New - Song" }], null, null, r));
    const all = await ref.once("value").then((s) => s.val() || {});
    out.many = Object.keys(all).sort(ftapi.utilities.compareKeys).slice(0, 3).map((k) => all[k].name).join("|");
    await ref.update(Object.fromEntries(Object.keys(all).filter((k) => /^roomtag/.test(all[k].cid)).map((k) => [k, null])));
    return out;
  });
  check(roomTags.top === "Poolside - Harvest Moon" && roomTags.bottom === "Poolside - Harvest Moon" && roomTags.many === "Poolside - Harvest Moon|Real - Name|New - Song",
    "a song the room has tags for is added under them; an \"Unknown\" artist or a song new to the room keeps its name (" + JSON.stringify(roomTags) + ")");
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
    const shellWasIn = !!document.getElementById("appShell"), loginWas = $("#mainGrid").hasClass("login");
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

  console.log("-- the decks in the mod menu (1.7)");
  const turn = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const realUid = ftapi.uid, realSend = ftapi.actions.sendBotCommand, sent = [];
    const realTable = firetable.tableData, realShown = firetable.displayedDjId;
    ftapi.actions.sendBotCommand = (t) => { sent.push(t); return Promise.resolve(); };
    const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && !!el.offsetParent; };
    const text = (id) => document.getElementById(id).textContent.trim();
    const out = {};
    ftapi.uid = "smokeMod";
    // the bar under the stage is just the picker: no line about the next song (the owner, November 22, 2026)
    out.noLine = !document.getElementById("st-turn") && !document.getElementById("st-next");

    // the mod menu on the playing song: remove dj1, add someone here who isn't DJing
    firetable.tableData = [{ name: "dj1", id: "dj1", plays: 1 }, { name: "dj2", id: "dj2", plays: 0 }];
    firetable.displayedDjId = "dj1";
    ftapi.events.emit("tableChanged", firetable.tableData);
    document.body.classList.add("is-mod");
    const modMenu = document.getElementById("npModMenu");
    modMenu.showPopover();
    await wait(100);
    out.remove = vis("npRemoveDj") && text("npRemoveDjText");
    document.getElementById("npRemoveDj").click();
    out.removeSent = sent.splice(0).join();
    modMenu.showPopover();
    await wait(50);
    document.getElementById("npAddDj").click();
    await wait(200);
    const addMenu = document.getElementById("npAddDjMenu");
    out.addOpen = addMenu.matches(":popover-open") && document.activeElement === document.getElementById("npAddDjFind");
    // everyone here but the DJs (dj1, dj2), the bot and you (the test's own signed-in user may be here too)
    out.addable = [...document.querySelectorAll("#npAddDjList .np-adddj")].map((b) => b.dataset.name).filter((n) => n !== "smoke").join();
    const find = document.getElementById("npAddDjFind");
    find.value = "WL";
    find.dispatchEvent(new Event("input"));
    out.filtered = [...document.querySelectorAll("#npAddDjList .np-adddj")].map((b) => b.dataset.name).join();
    find.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    out.addSent = sent.splice(0).join();
    out.addClosed = !addMenu.matches(":popover-open");
    // the playing DJ outranks you, or is you: no Remove
    firetable.displayedDjId = "boss";
    firetable.tableData = [{ name: "boss", id: "boss", plays: 1 }];
    ftapi.events.emit("tableChanged", firetable.tableData);
    modMenu.showPopover();
    await wait(50);
    out.noRemoveBoss = !vis("npRemoveDj");
    modMenu.hidePopover();
    // a member has no mod menu at all
    document.body.classList.remove("is-mod");
    out.memberBtn = getComputedStyle(document.getElementById("npModBtn")).display;

    ftapi.actions.sendBotCommand = realSend;
    ftapi.uid = realUid;
    firetable.waitlistData = null;
    firetable.tableData = realTable;
    firetable.displayedDjId = realShown;
    ftapi.events.emit("tableChanged", firetable.tableData);
    return out;
  });
  check(turn.noLine, "the bar under the stage has no next-song line");
  check(turn.remove === "Remove dj1 from the decks" && turn.removeSent === "!remove dj1" && turn.noRemoveBoss,
    "the mod menu removes the playing DJ, not someone who outranks you (" + JSON.stringify([turn.remove, turn.removeSent, turn.noRemoveBoss]) + ")");
  check(turn.addOpen && turn.addable === "boss,wl1" && turn.filtered === "wl1" && turn.addSent === "!add wl1" && turn.addClosed,
    "Add someone lists who's here and not DJing, filters by name, and adds with !add (" + JSON.stringify([turn.addable, turn.filtered, turn.addSent]) + ")");
  check(turn.memberBtn === "none", "a member has no mod menu button (" + turn.memberBtn + ")");

  console.log("-- on a phone: time left reads −m:ss, Chat comes first, the DJ playlist shows its name, removing a DJ takes two taps");
  await page.setViewportSize({ width: 390, height: 740 });
  const phoneFix = await page.evaluate(async () => {
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login");
    const realUid = ftapi.uid, realSend = ftapi.actions.sendBotCommand, sent = [];
    ftapi.actions.sendBotCommand = (t) => { sent.push(t); return Promise.resolve(); };
    ftapi.uid = "smokeMod";
    firetable.nav.mobileSection = "view";
    firetable.nav.apply();
    await new Promise((r) => setTimeout(r, 1200));
    const out = { left: document.getElementById("timr").textContent, played: document.getElementById("timrUp").textContent };
    const tabs = [...document.querySelectorAll("#minimodeoptions .tab")].filter((t) => t.offsetParent)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((t) => t.id);
    out.first = tabs[0];
    // with the bottom tab bar, Playlists is Library: Live keeps the rest, the stage hides in Library
    const keepView = firetable.nav.view;
    firetable.nav.view = "playlists";
    firetable.nav.apply();
    out.library = document.body.classList.contains("nt-library") && document.querySelector('#nav-tabs [data-tab="library"]').classList.contains("on");
    firetable.nav.view = keepView;
    firetable.nav.mobileSection = "chat";
    firetable.nav.apply();
    out.liveTabs = [...document.querySelectorAll("#minimodeoptions .tab")].filter((t) => t.offsetParent)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((t) => t.textContent.trim()).join();
    out.liveLit = !document.body.classList.contains("nt-library") && document.querySelector('#nav-tabs [data-tab="live"]').classList.contains("on");
    // the stage stays with Chat: Live's other tabs are lists, and get the screen (the bar names the song)
    const stageAt = () => { const r = document.getElementById("stage").getBoundingClientRect(), t = document.getElementById("minimodeoptions").getBoundingClientRect();
      return (r.right > 0 && r.left < innerWidth ? "on" : "off") + "|" + Math.round(t.top - document.getElementById("topbar").getBoundingClientRect().bottom); };
    out.stageChat = stageAt();
    firetable.nav.mobileSection = "people";
    firetable.nav.apply();
    out.stagePeople = stageAt();
    firetable.nav.mobileSection = "view";
    firetable.nav.apply();
    out.stageList = stageAt() + "|" + (document.querySelector("#dMini .pb-title, #dMini .d-mini-title") || document.getElementById("dMini")).textContent.trim().slice(0, 40);
    const label = document.getElementById("djlistpickerLabel").getBoundingClientRect();
    out.labelHidden = label.width <= 1 && label.height <= 1;
    out.labelledBy = document.getElementById("djlistpicker").getAttribute("aria-labelledby");
    ftapi.events.emit("tableChanged", firetable.tableData);
    const btn = () => document.querySelector("#deck .deckRemoveBtn");
    out.btn = !!btn();
    if (btn()) {
      btn().click();
      out.armed = btn().classList.contains("armed") && /Tap to remove/.test(btn().textContent) && btn().closest(".djplaque").classList.contains("confirming");
      out.afterOne = sent.slice();
      btn().click();
      out.afterTwo = sent.slice();
    }
    ftapi.actions.sendBotCommand = realSend;
    ftapi.uid = realUid;
    firetable.$appShell = $("#appShell").detach();
    return out;
  });
  if (process.env.SHOTS) {
    await page.evaluate(() => {
      window.__realUid = ftapi.uid; ftapi.uid = "smokeMod";
      ftapi.events.emit("tableChanged", firetable.tableData);
      document.querySelector("#deck .deckRemoveBtn").click();
    });
    await sleep(300);
    await page.locator("#stage").screenshot({ path: process.env.SHOTS + "/phone-stage-remove-armed.png" });
    await page.evaluate(() => { ftapi.uid = window.__realUid; ftapi.events.emit("tableChanged", firetable.tableData); });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  check(phoneFix.library && phoneFix.liveTabs === "Chat,Recent,Fresh,Cards,People" && phoneFix.liveLit,
    "phone, a member: Playlists is the Library tab; Live keeps Chat, Recent, Fresh, Cards and People (" + JSON.stringify(phoneFix) + ")");
  check(/^−\d+:\d\d$/.test(phoneFix.left) && /^\d+:\d\d$/.test(phoneFix.played), "time left has a minus, time played doesn't (" + phoneFix.played + " / " + phoneFix.left + ")");
  check(phoneFix.first === "mmchat", "Chat is the first phone tab (" + phoneFix.first + ")");
  check(/^on\|\d{3}$/.test(phoneFix.stageChat) && /^off\|\d$/.test(phoneFix.stagePeople) && /^off\|\d\|\S/.test(phoneFix.stageList),
    "phone, a member: the stage stays with Chat; Recent, Fresh, Cards and People get the screen, and the bar names the song (" + JSON.stringify([phoneFix.stageChat, phoneFix.stagePeople, phoneFix.stageList]) + ")");
  check(phoneFix.labelHidden && phoneFix.labelledBy === "djlistpickerLabel", "on a phone the DJ playlist's label is for screen readers only, and still names the picker");
  check(phoneFix.btn && phoneFix.armed && phoneFix.afterOne.length === 0 && phoneFix.afterTwo.join() === "!remove dj1",
    "a mod's first tap on the plate's remove asks again; the second removes (" + JSON.stringify(phoneFix) + ")");

  console.log("-- Live on a phone (4.2): the song row's buttons are 44px, Grab's ▾ is in the full-screen player; tap the bar to open it");
  await page.setViewportSize({ width: 390, height: 740 });
  const phoneRow = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bar = document.getElementById("dMini");
    // a member, hearing the room (as the bar is for a signed-in listener); the
    // buttons' 140ms colour change from the wider layout finishes first
    bar.classList.add("is-member", "is-room");
    await wait(400);
    const size = (el) => { const r = el.getBoundingClientRect(); return el.offsetParent ? Math.round(r.width) + "x" + Math.round(r.height) : "hidden"; };
    const out = { fire: size(document.getElementById("fire")), main: size(bar.querySelector(".pb-main")), open: bar.querySelector(".pb-expand") ? size(bar.querySelector(".pb-expand")) : "gone",
      pick: size(document.getElementById("st-grabPick")), inBar: !!document.getElementById("st-grabPick").closest("#dMini") };
    const grab = document.getElementById("grab");
    out.grab = grab.closest("#dMini") ? (getComputedStyle(grab).display === "none" ? "44x44" : size(grab)) : "moved";
    // the room the song has: the bar's song area, less the cover and the buttons beside it
    const w = (sel) => bar.querySelector(sel).getBoundingClientRect().width;
    out.text = Math.round(w(".pb-now") - w(".pb-art") - w(".pb-keep"));
    // Fire and Grab stay at the right whatever the title's length
    const title = bar.querySelector("#pv-title");
    const keepAt = () => Math.round(bar.querySelector(".pb-keep").getBoundingClientRect().right);
    const keptHtml = title.innerHTML;
    title.innerHTML = "<span>Hi</span>";
    const shortAt = keepAt();
    title.innerHTML = "<span>A very long song title that goes on and on (Extended Mix)</span>";
    const longAt = keepAt();
    title.innerHTML = keptHtml;
    out.keepFixed = shortAt === longAt && shortAt > 250;
    out.keepAt = shortAt + "/" + longAt;
    // the song in two lines: the title, then the room's mark beside the artist (the word Live only for screen readers)
    const tx = (sel) => bar.querySelector(sel).getBoundingClientRect();
    out.lines = Math.round(tx(".pb-src").top) > Math.round(tx(".pb-title").top) && Math.abs(tx(".pb-src").top - tx(".pb-artist").top) < 12 &&
      parseFloat(getComputedStyle(bar.querySelector(".pb-kind")).fontSize) === 0 && /Live|On air/.test(bar.querySelector(".pb-kind").textContent);
    out.mainPlain = getComputedStyle(bar.querySelector(".pb-main")).backgroundColor;
    // tapping the bar (its title, its blank space) opens the full-screen player; Fire doesn't
    const isOpen = () => document.body.classList.contains("pv-full-on");
    const close = async () => { if (isOpen()) { document.getElementById("pv-fclose").click(); await wait(500); } };
    (bar.querySelector(".pb-title .d-sheetlink") || bar.querySelector(".pb-title")).click();
    await wait(300);
    const sheet = document.getElementById("dSheetBox");
    out.titleOpens = isOpen() && !(sheet && sheet.open);
    await close();
    bar.querySelector(".pb-text").click();
    await wait(300);
    out.barOpens = isOpen();
    await close();
    document.getElementById("fire").click();
    await wait(300);
    out.fireStays = !isOpen();
    if (document.getElementById("fire").classList.contains("on")) document.getElementById("fire").click();
    await close();
    return out;
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  check(phoneRow.inBar && phoneRow.fire === "44x44" && phoneRow.main === "44x44" && phoneRow.grab === "44x44" && phoneRow.pick === "hidden" && phoneRow.open === "gone" && phoneRow.text >= 140,
    "phone: Fire, Grab and play are 44px, the ▾ and ⌃ are gone from the bar, and the song has more room (" + JSON.stringify(phoneRow) + ")");
  check(phoneRow.keepFixed, "phone: Fire and Grab stay at the right, however long the title (" + phoneRow.keepAt + ")");
  check(phoneRow.lines && phoneRow.mainPlain === "rgba(0, 0, 0, 0)", "phone: the song in two lines with the room's mark beside the artist, and play/stop a plain icon (" + JSON.stringify(phoneRow) + ")");
  check(phoneRow.titleOpens && phoneRow.barOpens && phoneRow.fireStays, "phone: tapping the bar or its title opens the full-screen player; Fire does its own thing (" + JSON.stringify(phoneRow) + ")");

  console.log("-- the player bar on a computer: the song in two lines, a click on the bar opens the full-screen player, the title its page");
  const wideBar = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const bar = document.getElementById("dMini");
    const isOpen = () => document.body.classList.contains("pv-full-on");
    const close = async () => { if (isOpen()) { document.getElementById("pv-fclose").click(); await wait(500); } };
    const out = {};
    out.expand = bar.querySelector(".pb-expand") ? getComputedStyle(bar.querySelector(".pb-expand")).display : "gone";
    out.pill = parseFloat(getComputedStyle(bar.querySelector(".pb-kind")).fontSize);
    const status = bar.querySelector(".pb-src > span:last-child");
    out.status = status ? Math.round(status.getBoundingClientRect().width) + ":" + (status.textContent.length > 0) : "none";
    // a click on the bar's own space
    bar.querySelector(".pb-now").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(300);
    out.spaceOpens = isOpen();
    await close();
    // the title is still the song's page
    const link = bar.querySelector("#pv-title .d-sheetlink");
    if (link) link.click();
    await wait(400);
    const sheet = document.getElementById("dSheetBox");
    out.titleSheet = !!(sheet && sheet.open) && !isOpen();
    if (sheet && sheet.open) sheet.close();
    await close();
    return out;
  });
  check(wideBar.expand === "gone" && wideBar.pill === 0 && /^1:true$/.test(wideBar.status),
    "computer: no ⌃ and no LIVE pill on the bar; who's on deck stays for screen readers (" + JSON.stringify(wideBar) + ")");
  check(wideBar.spaceOpens && wideBar.titleSheet, "computer: a click on the bar opens the full-screen player; the title still opens the song's page (" + JSON.stringify(wideBar) + ")");

  console.log("-- a SoundCloud song: the album-art glitch loads p5.js");
  await put("/songToPlay", Object.assign({}, youtubeSong, { type: 2, cid: "13158665", title: "Smoke SC", started: Date.now(),
    url: "https://soundcloud.com/forss/flickermood", image: SITE + "icons/icon-512.png" }));
  await page.waitForFunction(() => document.querySelector("#scScreen canvas"), null, { timeout: 30000 }).catch(() => {});
  check(loaded("p5.min.js"), "p5.js loaded with the first SoundCloud song");
  check(!!(await page.$("#scScreen canvas")), "the glitch canvas is drawn");
  await page.waitForFunction(() => firetable.scwidget, null, { timeout: 10000 }).catch(() => {});
  const sc = await page.$eval("#sc-widget", (f) => ({ src: f.getAttribute("src") || "", widget: !!firetable.scwidget }));
  check(sc.widget && /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fapi\.soundcloud\.com%2Ftracks%2F13158665&/.test(sc.src) && /auto_play=true/.test(sc.src),
    "the first SoundCloud song makes SoundCloud's player, pointed straight at that track (" + sc.src.slice(0, 120) + ")");
  // the full-screen player grows the screen without resizing the window: the cover's canvas grows with it
  const scFull = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const box = () => {
      const c = document.querySelector("#scScreen canvas"), f = document.getElementById("screenFrame");
      const cr = c.getBoundingClientRect(), fr = f.getBoundingClientRect();
      return { cw: Math.round(cr.width), ch: Math.round(cr.height), fw: Math.round(fr.width), fh: Math.round(fr.height), left: Math.round(cr.left - fr.left), top: Math.round(cr.top - fr.top) };
    };
    const out = { stage: box() };
    firetable.discover.openFull();
    await wait(800);
    out.full = box();
    document.getElementById("pv-fclose").click();
    await wait(800);
    out.back = box();
    return out;
  });
  const scFits = (b) => Math.abs(b.cw - b.fw) <= 1 && Math.abs(b.ch - b.fh) <= 1 && b.left === 0 && b.top === 0;
  check(scFits(scFull.full) && scFull.full.cw > scFull.stage.cw && scFits(scFull.back),
    "a SoundCloud cover's canvas fills the screen in the full-screen player and on the stage again after (" + JSON.stringify(scFull) + ")");
  // the Turntable theme's screen is a small TV: the 500px cover is scaled to fit it, not drawn as a giant crop
  const scTT = await page.evaluate(() => {
    const at = () => { push(); placeCover({ width: 500, height: 500 }); const m = drawingContext.getTransform(); pop(); return m; };
    const d = pixelDensity(), stage = at();
    document.body.classList.add("tt-skin");
    const tt = at();
    document.body.classList.remove("tt-skin");
    const k = Math.min(width, height) / 500;
    return { stage: Math.abs(stage.a / d - 1) < 1e-6, k: +(tt.a / d).toFixed(4), want: +k.toFixed(4),
      centred: Math.abs(tt.e / d - (width - 500 * k) / 2) < 0.5 && Math.abs(tt.f / d - (height - 500 * k) / 2) < 0.5 };
  });
  check(scTT.stage && scTT.k === scTT.want && scTT.centred, "in the Turntable theme a SoundCloud cover is scaled to fit the room's screen, centred; on the stage it keeps its own size (" + JSON.stringify(scTT) + ")");

  console.log("-- someone sends a 🔥: the fire burns behind the DJ, sized to them, with no library to load");
  await page.evaluate(() => window.firetableIgniteFyre(3));
  await page.waitForFunction(() => document.querySelector("#fyre canvas"), null, { timeout: 30000 }).catch(() => {});
  await sleep(1200);
  const alpha = () => page.evaluate(() => {
    const c = document.querySelector("#fyre canvas");
    if (!c || !c.width) return 0;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  const lit = await page.evaluate(() => {
    const f = document.getElementById("fyre"), c = f.querySelector("canvas"), a = document.querySelector("#deck .avtr");
    const fr = f.getBoundingClientRect(), ar = a ? a.getBoundingClientRect() : { width: 0, height: 0 };
    const k = Number(f.getAttribute("data-fire-scale"));
    return { libs: typeof PIXI === "undefined" && typeof TweenMax === "undefined" && typeof ftLazy.LIBS.pixi === "undefined",
      sized: !!c && c.width === Math.round(fr.width * Math.min(2, devicePixelRatio)),
      scale: k, avatar: Math.round(ar.height), wider: Math.round(fr.width) >= Math.round(ar.width),
      grows: Math.abs(k - Math.max(1, Math.min(3, ar.height / 110))) < 0.01 };
  });
  check(lit.libs && !loaded("pixi.min.js") && !loaded("TweenMax.min.js"), "the fire draws without PixiJS or GSAP (js/flame.js)");
  check((await alpha()) > 500, "the fire is drawn");
  check(lit.sized && lit.grows && lit.wider, "the fire grows with the DJ: its scale is their drawn height over 110px, its box wider than them (" + JSON.stringify(lit) + ")");
  await page.evaluate(() => window.firetableSetFyreIntensity(0));
  await sleep(300);
  check((await alpha()) === 0, "a fire going out clears its canvas and stops drawing");

} catch (e) {
  check(false, "smoke test threw: " + e.message);
}

// Discover, in a page of its own (signing in with Google offered): everything
// above ran on Live (#live), the room as members see it.
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
    body: CONFIG.replace(/roomName:/, 'signInProviders: ["google"], roomName:') }));
  await put("/discover", discover(now));
  const lib = library(now);
  // dj1 brought a song here first: their page opens on it (2.7)
  // 14 of them: the page shows 10 and Show all 14
  lib.dj.dj1.firstHere = Array.from({ length: 14 }, (_, i) => ({ cid: "fh" + String(i).padStart(9, "0"), type: 1, a: "Firsts", t: "First " + (i + 1), plays: 20 - i, first: now - (400 - i) * 86400000 }));
  // a year's playlist with one song three times (an old library build did that): the page lists it once
  lib.year[2026].top = [lib.year[2026].top[0], Object.assign({}, lib.year[2026].top[0]), Object.assign({}, lib.year[2026].top[0], { cid: "lib0000099" })];
  // two sets on one night (a break between): one line, "12 songs in 2 sets" (2.7). On a fixed
  // evening, 8 and 11 pm two days ago: hours before now could straddle the night's 6 am cutoff
  const evening = new Date(now - 2 * 86400000);
  evening.setHours(20, 0, 0, 0);
  lib.dj.dj1.sets = [{ at: evening.getTime() + 3 * 3600000, n: 3 }, { at: evening.getTime(), n: 9 }];
  // a year's covers on the Years list (2.7)
  lib.years[2026].covers = ["1_lib0000002"];
  await put("/discover/lib", lib);
  await openPage(dPage, SITE);
  await dPage.waitForFunction(() => document.querySelectorAll("#dBrowse .ft-cards .pvbar").length > 0, null, { timeout: 20000 }).catch(() => {});
  const home = await dPage.evaluate(async () => ({
    on: document.body.classList.contains("ft-discover"),
    tabs: [...document.querySelectorAll("#modeTabs .tab")].map((b) => b.textContent.trim() + (b.classList.contains("on") ? "*" : "")).join(),
    cards: document.querySelectorAll("#dBrowse .ft-cards .pvbar").length,
    befirst: [...document.querySelectorAll("#dBrowse section")].filter((sec) => /Not played live yet/.test(sec.querySelector("h2")?.textContent || ""))
      .map((sec) => sec.querySelectorAll(".pvbar").length + ":" + [...sec.querySelectorAll(".d-befirst")].map((e) => e.textContent).join() + ":" + sec.querySelector("[data-newfilter]")?.textContent).join(),
    chart: [...document.querySelectorAll("#dBrowse .ft-rows .hist-timestamp")].slice(0, 2).map((e) => e.textContent).join(),
    unplayed: [...document.querySelectorAll("#dBrowse .fresh-meta")].some((e) => /Be the first/.test(e.textContent) && /Nobody has played it yet/.test(e.textContent)),
    stageHidden: getComputedStyle(document.getElementById("stage")).opacity === "0",
    noLine: !document.getElementById("dLive"),
    bar: document.getElementById("pv-src").textContent + "|" + document.querySelector("#dMini .pb-main").getAttribute("aria-label"),
    // the room in full: the full-screen player, opened and closed again
    card: await (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      firetable.discover.openFull();
      for (let i = 0; i < 50 && !/here/.test(document.getElementById("pv-full").textContent); i++) await wait(100);
      const text = document.getElementById("pv-full").textContent;
      firetable.discover.closeFull();
      await wait(500);
      return text;
    })()
  }));
  check(home.on && home.tabs === "Discover*,Live" && home.cards === 4 && home.befirst === "1:Be the first:All 1" && home.chart === "#1,#2" && home.unplayed && home.stageHidden,
    "a visitor lands on Discover: new releases, the week's chart, the stage out of sight (" + JSON.stringify(home) + ")");
  check(!/messages this hour|great tune/.test(home.card), "the chat is for members: a visitor's full-screen player shows none of it");
  check(home.noLine && /On air|Live/.test(home.bar) && /Listen in|Stop listening/.test(home.bar) && /here/.test(home.card),
    "the room is in the bar (On air / Live, Listen in) and the full-screen player (who is here), with no second room line above search (" + JSON.stringify({ bar: home.bar, line: !home.noLine }) + ")");

  console.log("-- Discover Home leads with New this week: the most played, who found it, Play the week's");
  {
    // seven releases in the last 8 days; two have 5 plays, and the newer of them leads
    const DAYMS = 86400000;
    const day = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const today = day(new Date()), friday = day(new Date(Date.now() - 6 * DAYMS)), from = day(new Date(Date.now() - 7 * DAYMS));
    const week = [["wk01", "Week One", 2], ["wk02", "Week Two", 5], ["wk03", "Week Three", 5], ["wk04", "Week Four", 0], ["wk05", "Week Five", 1], ["wk06", "Week Six", 0], ["wk07", "Week Seven", 3]]
      .map(([cid, t, plays], i) => Object.assign({ cid: cid + "aaaaa", a: "Band " + (i + 1), t, dur: 200 + i, rel: i === 2 ? today : friday, relSrc: "yt", plays },
        plays ? { first: now - DAYMS, dj: "dj1", djid: "dj1" } : {}));
    const tracks = week.concat(discover(now).new.tracks);
    const inWeek = tracks.filter((t) => t.rel >= from).length; // the seed's own recent releases count too
    await put("/discover/new", { at: now, days: 90, tracks });
    await dPage.evaluate(() => { location.hash = "#discover"; });
    await dPage.waitForFunction(() => document.querySelector("#dBrowse .d-lead"), null, { timeout: 10000 }).catch(() => {});
    const lead = await dPage.evaluate(async () => {
      const el = document.querySelector("#dBrowse .d-lead");
      if (!el) return null;
      const out = {
        title: el.querySelector(".d-leadtitle").textContent,
        kicker: el.querySelector(".d-kicker").textContent,
        found: el.querySelector(".d-leadfound").textContent.replace(/\s+/g, " ").trim(),
        playAll: el.querySelector(".d-playall span").textContent,
        under: el.parentElement.querySelectorAll(".ft-cards .pvbar").length,
        all: el.parentElement.querySelector("[data-newfilter]").getAttribute("data-newfilter"),
        order: [...document.querySelectorAll("#dBrowse section h2")].map((h) => h.textContent).slice(0, 4).join("|")
      };
      // Not played live yet, under the week's row: none of the songs that row already shows
      const unSec = [...document.querySelectorAll("#dBrowse section")].find((sec) => /Not played live yet/.test(sec.querySelector("h2")?.textContent || ""));
      const cids = (box) => [...box.querySelectorAll(".pvbar[data-cid]")].map((p) => p.getAttribute("data-cid"));
      out.unplayed = unSec ? { n: cids(unSec).length, twice: cids(unSec).filter((c) => cids(el.parentElement).includes(c)).join(), link: unSec.querySelector("[data-newfilter]").textContent } : null;
      // the test's videos aren't real: keep the player from skipping past them (the skip waits 800ms)
      window.__skip = firetable.discover.onFailed;
      firetable.discover.onFailed = () => {};
      el.querySelector(".d-playall").click();
      await new Promise((r) => setTimeout(r, 300));
      out.playing = firetable.discover.state().playing;
      return out;
    });
    const want = "Week Three"; // the newer of the two with 5 plays
    check(lead && lead.title === want && lead.kicker === "The week's most played" && /Found by dj1/.test(lead.found) && /5 plays/.test(lead.found),
      "the lead is the week's most played release (the newer on a tie), with who found it (" + JSON.stringify(lead) + ")");
    check(lead && lead.playAll === "Play the week's " + inWeek && lead.under === 6 && lead.all === "week" && lead.playing === (want === "Week Two" ? "wk02aaaaa" : "wk03aaaaa"),
      "Play the week's " + inWeek + " plays from the lead; the next six sit under it (" + JSON.stringify(lead) + ")");
    check(lead && /^New this week\|Not played live yet\|Room chart/.test(lead.order), "Home's order: New this week, Not played live yet, the chart (" + (lead && lead.order) + ")");
    check(lead && lead.unplayed && lead.unplayed.n === 2 && lead.unplayed.twice === "" && lead.unplayed.link === "All 3",
      "Not played live yet doesn't repeat the week's row: two of the three unplayed show, the third is already above, the link counts all three (" + JSON.stringify(lead && lead.unplayed) + ")");
    await dPage.evaluate(async () => {
      if (firetable.discover.state().playing) document.querySelector("#dMini .pb-main")?.click();
      await new Promise((r) => setTimeout(r, 1000));
      firetable.discover.onFailed = window.__skip;
    });
    await put("/discover/new", discover(now).new);
  }

  console.log("-- Discover New: one Show menu, This week first, Be the first on what nobody has played");
  {
    await dPage.waitForFunction(() => !document.querySelector("#dBrowse .d-lead"), null, { timeout: 10000 }).catch(() => {});
    const shown = await dPage.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      location.hash = "#discover/new";
      await wait(300);
      const show = document.getElementById("dNewShow");
      const out = { options: [...show.options].map((o) => o.textContent).join("|"), first: show.value, chips: document.querySelectorAll("#dBrowse .d-chip[data-new]").length,
        weekCount: document.querySelectorAll("#dBrowse .d-newgrid .pvbar").length, fact: document.querySelector("#dBrowse .d-fact").textContent };
      show.value = "unplayed";
      show.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(200);
      const cards = [...document.querySelectorAll("#dBrowse .d-newgrid .pvbar")];
      out.unplayed = cards.length + ":" + cards.every((c) => /Be the first/.test(c.textContent) && /Nobody has played it yet/.test(c.textContent));
      document.getElementById("dNewShow").value = "days90";
      document.getElementById("dNewShow").dispatchEvent(new Event("change", { bubbles: true }));
      await wait(200);
      out.all = document.querySelectorAll("#dBrowse .d-newgrid .pvbar").length;
      return out;
    });
    check(shown.options === "This week|This month|Last 90 days|Not played live yet" && shown.first === "week" && !shown.chips && shown.weekCount === 2 && /last 8 days/.test(shown.fact),
      "New has one Show menu, on This week while the week has releases (" + JSON.stringify(shown) + ")");
    check(shown.unplayed === "1:true" && shown.all === 3, "Not played live yet shows Be the first; Last 90 days shows them all (" + JSON.stringify(shown) + ")");
  }

  console.log("-- Discover: playing a song uses the room's player, and keeps playing in Live");
  const playing = await dPage.evaluate(async () => {
    // the test's videos aren't real: keep the player from skipping past them
    const skip = firetable.discover.onFailed;
    firetable.discover.onFailed = () => {};
    document.querySelector("#dBrowse .ft-cards .pvbar .d-play").click();
    await new Promise((r) => setTimeout(r, 300));
    const during = { preview: firetable.preview, state: firetable.discover.state(), title: document.getElementById("pv-title").textContent };
    location.hash = "#discover/charts";
    await new Promise((r) => setTimeout(r, 300));
    const chart = { rows: document.querySelectorAll("#dBrowse .ft-rows .pvbar").length, mv: [...document.querySelectorAll("#dBrowse .d-mv")].map((e) => e.textContent).join() };
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const bar = document.getElementById("dMini");
    const after = { preview: firetable.preview, mode: document.body.classList.contains("ft-discover"), hash: firetable.discover.address(), playing: firetable.discover.state().playing,
      bar: bar.offsetParent !== null && /is-discover/.test(bar.className), stageUp: document.body.classList.contains("pb-elsewhere"),
      tools: ["screenControl", "reloadtrack", "st-cast", "fullscreenBtn", "fire", "grab"].every((id) => document.getElementById(id).closest("#dMini")),
      stageEmpty: getComputedStyle(document.getElementById("stageTopRight")).display === "none" && getComputedStyle(document.getElementById("stageActions")).display === "none",
      avatar: (() => {
        const a = document.querySelector("#deck .avtr");
        if (!a) return { drawn: -1, asked: 0 };
        const r = a.getBoundingClientRect();
        return { drawn: Math.round(Math.min(r.width, r.height)), asked: Number((a.style.backgroundImage.match(/size=(\d+)x/) || [])[1] || 0) };
      })() };
    // the stage's lower left says they aren't hearing the room
    const nl = document.getElementById("st-notlive");
    const stage = document.getElementById("djStage").getBoundingClientRect(), card = nl.getBoundingClientRect();
    after.notLive = { shown: !nl.hidden && nl.offsetParent !== null, text: nl.textContent, lowerLeft: card.left - stage.left < stage.width / 2 && stage.bottom - card.bottom < stage.height / 2 && card.width > 0,
      inside: card.right <= stage.right + 1 && card.bottom <= stage.bottom + 1 };
    // Listen in, from the bar: the room
    document.querySelector("#pv-switch .d-listen").click();
    await new Promise((r) => setTimeout(r, 300));
    after.listened = firetable.preview === false && /is-(live|onair)/.test(bar.className);
    after.notLive.goneOnListen = nl.hidden && getComputedStyle(nl).display === "none";
    document.querySelector('#modeTabs [data-mode="discover"]').click();
    await new Promise((r) => setTimeout(r, 300));
    after.notLive.notInDiscover = getComputedStyle(nl).display === "none";
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await new Promise((r) => setTimeout(r, 300));
    firetable.discover.onFailed = skip;
    return { during, chart, after };
  });
  check(playing.during.preview === "discover" && playing.during.state.playing === "newrel0001" && playing.during.title === "First Single",
    "a song plays in Discover's player (" + JSON.stringify(playing.during) + ")");
  check(playing.chart.rows === 3 && playing.chart.mv === "▲2,new", "the chart shows movement (" + JSON.stringify(playing.chart) + ")");
  check(playing.after.preview === "discover" && !playing.after.mode && playing.after.hash === "#live" && playing.after.playing === "newrel0001" && playing.after.bar && playing.after.stageUp,
    "going to Live keeps the Discover song playing: the bar along the bottom says so, and the stage's screen stays up (" + JSON.stringify(playing.after) + ")");
  check(playing.after.tools && playing.after.stageEmpty, "the stage's screen, reload, full screen, Fire and Grab are in the bar; the stage is left to the DJs (" + JSON.stringify(playing.after) + ")");
  check(playing.after.listened, "Listen in, in the bar, takes them to the room (" + JSON.stringify(playing.after) + ")");
  check(playing.after.notLive.shown && /not listening live/.test(playing.after.notLive.text) && /First Single/.test(playing.after.notLive.text) && playing.after.notLive.lowerLeft && playing.after.notLive.inside,
    "in Live while a Discover song plays, the stage's lower left says they aren't listening live (" + JSON.stringify(playing.after.notLive) + ")");
  check(playing.after.notLive.goneOnListen, "the stage's not-live card goes once they listen in (" + JSON.stringify(playing.after.notLive) + ")");
  check(playing.after.notLive.notInDiscover, "the not-live card is Live's only (" + JSON.stringify(playing.after.notLive) + ")");
  check(playing.after.avatar.drawn > 0 && playing.after.avatar.asked >= playing.after.avatar.drawn, "the DJ on the stage is never drawn past the picture asked for (" + JSON.stringify(playing.after.avatar) + ")");

  console.log("-- Discover: the player bar says what it plays, Discover or the room, and switches between them");
  const bar = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = () => document.getElementById("dMini");
    const snap = () => ({ cls: el().className, src: document.getElementById("pv-src").textContent, title: document.getElementById("pv-title").textContent,
      main: (document.querySelector("#dMini .pb-main") || {}).getAttribute("aria-label"), seek: document.getElementById("pv-seek").disabled,
      fireHere: !!document.querySelector("#dMini #fire") && document.getElementById("fire").offsetParent !== null,
      joinFire: !!document.querySelector("#dMini .pb-joinfire"), tone: el().getAttribute("data-tone-for"), other: (document.querySelector("#pv-switch .pb-other") || { className: "" }).className,
      time: getComputedStyle(document.querySelector("#dMini .pb-time")).display !== "none" });
    const out = {};
    // the test's videos aren't real: keep the player from skipping past them
    const skip = firetable.discover.onFailed;
    firetable.discover.onFailed = () => {};
    location.hash = "#discover";
    await wait(400);
    out.room = snap();
    out.room.noNowTab = !document.querySelector('#dSide [data-sidetab="now"]');
    out.room.shown = el().offsetParent !== null && el().getBoundingClientRect().bottom <= innerHeight + 1;
    document.querySelector("#dBrowse .ft-cards .pvbar .d-play").click();
    await wait(300);
    out.disc = snap();
    document.querySelector("#dMini .pb-main").click();
    await wait(100);
    out.paused = snap().cls;
    document.querySelector("#pv-switch .d-listen").click();
    await wait(300);
    out.live = snap();
    out.live.preview = firetable.preview;
    out.live.state = firetable.discover.state().listening;
    out.live.roomKey = firetable.song.type + "_" + firetable.song.cid;
    out.live.color = getComputedStyle(el()).getPropertyValue("--pb-art").trim();
    out.live.stageColor = firetable.color;
    // a mod fixes the room song's tags: the bar and the full-screen player follow
    const was = { title: firetable.song.title, artist: firetable.song.artist };
    firetable.discover.openFull();
    await wait(100);
    await ftapi.db().ref("tagUpdate").set({ cid: firetable.song.cid, adamData: { track_name: "Fixed Title", artist: "Fixed Artist", playcount: 41 } });
    await wait(200);
    out.fixed = { bar: document.getElementById("pv-title").textContent + "|" + document.getElementById("pv-artist").textContent,
      panel: document.getElementById("pv-ftitle").textContent };
    await ftapi.db().ref("tagUpdate").set({ cid: firetable.song.cid, adamData: { track_name: was.title, artist: was.artist, playcount: 41 } });
    await wait(200);
    firetable.discover.closeFull();
    await wait(500);
    document.querySelector("#dMini .pb-main").click(); // stop listening
    await wait(100);
    out.stopped = snap();
    out.stopped.preview = firetable.preview;
    document.querySelector("#pv-switch .d-mypick").click();
    await wait(300);
    out.back = snap();
    out.back.playing = firetable.discover.state().playing;
    document.querySelector("#dMini .pb-toroom").click();
    await wait(200);
    const dlg = document.getElementById("joinBox");
    out.join = !!(dlg && dlg.open);
    if (dlg && dlg.open) dlg.close();
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(300);
    out.fireHome = document.getElementById("fire").parentElement.id;
    // in Live with the pick playing: Listen live on the stage's card takes them to the room
    const nl = document.getElementById("st-notlive");
    out.card = { shown: !nl.hidden, pickTime: snap().time };
    if (nl.querySelector(".st-nl-go")) nl.querySelector(".st-nl-go").click();
    await wait(300);
    out.card.room = firetable.preview === false && /is-(live|onair)/.test(document.getElementById("dMini").className) && nl.hidden;
    out.card.roomTime = snap().time;
    out.card.stageTime = getComputedStyle(document.getElementById("timr")).display !== "none" && getComputedStyle(document.getElementById("prgbar")).display !== "none";
    firetable.discover.onFailed = skip;
    return out;
  });
  check(/is-(live|onair)/.test(bar.room.cls) && /Live|On air/.test(bar.room.src) && bar.room.noNowTab && bar.room.shown && bar.room.seek,
    "before a pick, the bar shows the room (Live or On air) and can't seek it; the right column has no Now playing tab (" + JSON.stringify(bar.room) + ")");
  check(/is-discover/.test(bar.disc.cls) && /Discover/.test(bar.disc.src) && bar.disc.title === "First Single" && /^(Pause|Play)$/.test(bar.disc.main) && !bar.disc.seek && !bar.disc.fireHere && /d-listen/.test(bar.disc.other) && bar.disc.tone === "1_newrel0001",
    "a pick: the bar says Discover and the list, takes its colour from that song's art, can seek, and offers the room one tap away (" + JSON.stringify(bar.disc) + ")");
  check(/is-paused/.test(bar.paused) !== /is-paused/.test(bar.disc.cls), "the big button pauses and plays a Discover song (" + bar.disc.cls + " → " + bar.paused + ")");
  check(/is-room/.test(bar.live.cls) && bar.live.preview === false && bar.live.state === true && !bar.live.fireHere && bar.live.joinFire && bar.live.tone === bar.live.roomKey && bar.live.seek && /d-mypick/.test(bar.live.other),
    "Listen in: the room plays, the bar takes the room song's colour, a visitor gets Join to fire (not the stage's Fire), and the pick waits one tap away (" + JSON.stringify(bar.live) + ")");
  check(!!bar.live.color && bar.live.color === bar.live.stageColor, "playing the room, the bar takes the stage's own colour (" + bar.live.color + " / " + bar.live.stageColor + ")");
  check(bar.fixed.bar === "Fixed Title|Fixed Artist" && bar.fixed.panel === "Fixed Title",
    "fixed tags reach the bar and the full-screen player at once (" + JSON.stringify(bar.fixed) + ")");
  check(/is-onair/.test(bar.stopped.cls) && bar.stopped.preview === "discover" && bar.stopped.main === "Listen in to the room",
    "stop listening: the room goes quiet and the bar offers Listen in (" + JSON.stringify(bar.stopped) + ")");
  check(/is-discover/.test(bar.back.cls) && /^newrel000/.test(bar.back.playing || ""), "Back to it plays the pick again (or the next, if the test video can't play) (" + JSON.stringify(bar.back) + ")");
  check(bar.join, "a visitor's Play it in the room opens the join dialog");
  check(bar.fireHome === "pv-livekeep", "in Live the stage's buttons stay in the bar (" + bar.fireHome + ")");
  check(bar.card.shown && bar.card.room, "Listen live on the stage's not-live card takes them to the room (" + JSON.stringify(bar.card) + ")");
  check(bar.room.time && bar.disc.time && bar.live.time && bar.card.pickTime && !bar.card.roomTime && bar.card.stageTime,
    "the bar shows time and progress except in Live on the room's song, where the stage already shows them (" + JSON.stringify({ room: bar.room.time, disc: bar.disc.time, live: bar.live.time, card: bar.card }) + ")");

  console.log("-- Discover: the full-screen player grows out of the bar, shows Audio or Video, and closes back into it");
  const full = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = document.getElementById("pv-full");
    const skip = firetable.discover.onFailed;
    firetable.discover.onFailed = () => {};
    location.hash = "#discover";
    await wait(300);
    const out = {};
    document.querySelector("#dBrowse .ft-cards .pvbar .d-play").click();
    await wait(300);
    const opener = document.getElementById("fullscreenBtn");
    opener.click();
    await wait(700);
    const r = el.getBoundingClientRect();
    const logo = el.querySelector(".pvf-logo");
    out.open = { shown: !el.hidden, on: document.body.classList.contains("pv-full-on"), inert: document.getElementById("mainGrid").inert, dialog: el.getAttribute("role") + "/" + el.getAttribute("aria-modal"),
      covers: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight, logo: !!logo && /idlogo2/.test(getComputedStyle(logo).backgroundImage) && logo.offsetParent !== null,
      focus: document.activeElement && document.activeElement.id, state: firetable.discover.state().full };
    out.disc = { cls: el.className, title: document.getElementById("pv-ftitle").textContent,
      transport: ["d-prev", "pvf-main", "d-next", "d-reload"].filter((c) => el.querySelector("#pv-ftransport ." + c)).length, seek: !document.getElementById("pv-fseek").disabled,
      acts: !!el.querySelector("#pv-fkeep .d-savebtn") && !!el.querySelector("#pv-fkeep .d-toroom") && !!el.querySelector("#pv-facts .d-more"),
      next: document.getElementById("pv-fnext").textContent, noSide: !el.querySelector("#pv-fside, #pv-ftabs, .pvf-side"), theme: document.getElementById("pv-ftheme").textContent, noBars: !el.querySelector("#pv-feq, .pvf-eq") };
    const was = el.classList.contains("is-paused");
    el.querySelector(".pvf-main").click();
    await wait(100);
    out.disc.toggled = el.classList.contains("is-paused") !== was;
    el.querySelector(".pvf-main").click();
    await wait(100);
    // the stage's screen button is in the player; V turns the screen on: the video behind the words
    out.screenHere = !!document.getElementById("screenControl").closest("#pv-fscreen");
    out.castHere = !!document.getElementById("st-cast").closest("#pv-fscreen");
    const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("v");
    await wait(800);
    const stage = document.getElementById("stage");
    const sr = stage.getBoundingClientRect();
    out.video = { cls: el.classList.contains("is-video"), body: document.body.classList.contains("pv-full-video"),
      stage: Math.round(sr.width) === innerWidth && Math.round(sr.height) === innerHeight && sr.left === 0 && getComputedStyle(stage).opacity === "1",
      under: Number(getComputedStyle(stage).zIndex) < Number(getComputedStyle(el).zIndex), saved: localStorage.getItem("firetableScreenControl"),
      screen: Math.round(document.getElementById("screenBox").getBoundingClientRect().width) === innerWidth };
    // like the stage's screen: down for Video (up while YouTube stalls), up for Audio
    const box = document.getElementById("screenBox");
    const stalled = document.body.classList.contains("yt-stalled");
    box.style.transition = "none";
    document.body.classList.remove("yt-stalled");
    const ty = () => new DOMMatrix(getComputedStyle(box).transform).m42;
    out.video.down = ty() === 0;
    document.body.classList.add("yt-stalled");
    out.video.upWhileStalled = ty() < 0;
    document.body.classList.toggle("yt-stalled", stalled);
    key("v");
    await wait(100);
    const art = getComputedStyle(el.querySelector(".pvf-art"));
    out.audio = !el.classList.contains("is-video") && !document.body.classList.contains("pv-full-video") && localStorage.getItem("firetableScreenControl") === "off" && ty() < 0;
    // the screen off: the song's own artwork, square, as the stage's, never a blown-up video frame
    out.art = { square: art.aspectRatio === "1 / 1" || art.aspectRatio === "1", img: el.querySelector(".pvf-cover").style.backgroundImage };
    box.style.transition = "";
    localStorage.setItem("firetableScreenControl", "sync");
    firetable.screenControl = "sync";
    firetable.ui.applyScreenSetting();
    firetable.ui.updateScreenBtn("sync");
    // Listen in, under the song: the room, with a visitor's Join to fire (the stage's Fire stays out of sight)
    el.querySelector("#pv-fnext .d-listen").click();
    await wait(300);
    out.room = { cls: el.className, src: document.getElementById("pv-fsrc").textContent, title: document.getElementById("pv-ftitle").textContent, song: firetable.song.title,
      joinFire: !!el.querySelector("#pv-fkeep .pb-joinfire"), fireHidden: !!document.getElementById("fire").closest("#pv-fstage") && document.getElementById("fire").offsetParent === null,
      next: document.getElementById("pv-fnext").textContent, seek: document.getElementById("pv-fseek").disabled, pick: !!el.querySelector("#pv-fnext .d-mypick"),
      tone: getComputedStyle(document.getElementById("pv-fullbg")).getPropertyValue("--pb-art").trim(), roomColor: firetable.color,
      name: el.querySelector(".pvf-roomtext b").textContent, noSide: !el.querySelector("#pv-fside, #pv-ftabs, [data-ftab], .d-decks, .d-justplayed, #actualChat") };
    // Escape closes it back into the bar, the page usable again
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(700);
    out.closed = { hidden: el.hidden, on: document.body.classList.contains("pv-full-on"), inert: document.getElementById("mainGrid").inert,
      fire: document.getElementById("fire").parentElement.id, focus: document.activeElement === opener };
    // F opens it again; the stage's button does in Live
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    await wait(200);
    out.fKey = !el.hidden;
    firetable.discover.closeFull();
    await wait(600);
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(300);
    const fsBtn = document.getElementById("fullscreenBtn");
    out.live = { label: fsBtn.getAttribute("aria-label"), shown: !fsBtn.hidden };
    fsBtn.click();
    await wait(500);
    out.live.open = !el.hidden;
    out.live.cls = el.className;
    out.live.main = (el.querySelector(".pvf-main") || {}).getAttribute("aria-label");
    out.live.same = out.live.main === document.querySelector("#dMini .pb-main").getAttribute("aria-label");
    out.live.noSkipping = !el.querySelector("#pv-ftransport .d-prev, #pv-ftransport .d-next") && document.getElementById("pv-fseek").disabled;
    out.live.reload = !!el.querySelector(".pvf-reloadroom");
    firetable.discover.closeFull();
    await wait(600);
    out.live.back = document.getElementById("fire").parentElement.id;
    out.live.bar = document.getElementById("dMini").offsetParent !== null;
    firetable.discover.onFailed = skip;
    return out;
  });
  check(full.open.shown && full.open.on && full.open.inert && full.open.dialog === "dialog/true" && full.open.covers && full.open.state && full.open.focus === "pv-fclose",
    "the bar's button opens the full-screen player over the whole page, as a dialog with the page behind it inert (" + JSON.stringify(full.open) + ")");
  check(full.open.logo, "the :id: logo is on the full-screen player");
  check(/is-discover/.test(full.disc.cls) && full.disc.title === "First Single" && full.disc.transport === 4 && full.disc.seek && full.disc.acts && full.disc.toggled && full.disc.noBars,
    "a Discover song in full: previous, play, next, reload, seek, Save, Play it in the room, ⋮, and no made-up level bars (" + JSON.stringify(full.disc) + ")");
  check(full.disc.noSide && /^NextUnplayed/i.test(full.disc.next) && /Play now/.test(full.disc.next) && /The room.*Listen in/i.test(full.disc.next) && /smoke tests/.test(full.disc.theme),
    "no side panel: under the song, the next one (Play now) and the room (Listen in); the room's theme at the top (" + JSON.stringify({ next: full.disc.next, theme: full.disc.theme }) + ")");
  check(full.screenHere && full.video.cls && full.video.body && full.video.stage && full.video.under && full.video.screen && full.video.down && full.video.upWhileStalled && full.video.saved === "on" && full.audio,
    "the stage's screen button is in the player: on lowers the room's own screen behind it (up while YouTube stalls), off raises it, one setting with the stage (" + JSON.stringify(full.video) + ")");
  check(full.art.square && /mqdefault|newrel0001/.test(full.art.img) && !/maxresdefault/.test(full.art.img), "screen off shows the song's own artwork, square (" + JSON.stringify(full.art) + ")");
  check(full.castHere, "the cast button comes into the player with it (phones' only way to it)");
  check(full.room.tone && full.room.tone === full.room.roomColor, "the background takes the room song's colour, the stage's (" + full.room.tone + " / " + full.room.roomColor + ")");
  check(full.room.name === "Indie Discotheque", "the room is named as the site's logo has it (" + full.room.name + ")");
  check(/is-room/.test(full.room.cls) && /Live|On air/.test(full.room.src) && full.room.title === full.room.song && full.room.joinFire && full.room.fireHidden && full.room.seek && full.room.pick,
    "Listen in shows the room in full: a visitor gets Join to fire, not the stage's Fire, can't seek, and their pick waits (" + JSON.stringify(full.room) + ")");
  check(full.room.noSide && /Your pick.*Back to it/i.test(full.room.next),
    "the room in full: no DJs or chat panel, just the paused pick under the song with Back to it (" + full.room.next + ")");
  check(full.closed.hidden && !full.closed.on && !full.closed.inert && full.closed.fire === "pv-livekeep" && full.closed.focus && full.fKey,
    "Escape closes it into the bar (the stage's buttons go back there, focus to the button that opened it); F opens it (" + JSON.stringify(full.closed) + ")");
  check(full.live.shown && full.live.label === "Full-screen player" && full.live.open && /is-room|is-quiet/.test(full.live.cls) && full.live.noSkipping && /Stop listening|Listen in/.test(full.live.main || "") && full.live.same && full.live.reload && full.live.back === "pv-livekeep" && full.live.bar,
    "in Live, the bar's full-screen button opens it for the room: no skipping or seeking, the same big button as the bar, reload; closed, the buttons go back to the bar (" + JSON.stringify(full.live) + ")");

  console.log("-- The full-screen player on a phone: one action, the transport and More");
  const desk = dPage.viewportSize();
  await dPage.setViewportSize({ width: 390, height: 844 });
  const phoneFull = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    location.hash = "#discover";
    await wait(300);
    firetable.discover.openFull();
    await wait(600);
    const el = document.getElementById("pv-full");
    const shown = () => [...el.querySelectorAll("button, a.butt")].filter((b) => b.offsetParent !== null && getComputedStyle(b).visibility !== "hidden" && !b.closest(".pvf-next, .pvf-drawer, .pvf-title, .pvf-src")).length;
    const out = { before: shown() };
    el.querySelector(".pvf-morebtn").click();
    await wait(100);
    out.after = shown();
    out.expanded = el.querySelector(".pvf-morebtn").getAttribute("aria-expanded");
    firetable.discover.closeFull();
    await wait(600);
    return out;
  });
  await dPage.setViewportSize(desk);
  check(phoneFull.before <= 8 && phoneFull.after > phoneFull.before && phoneFull.expanded === "true",
    "on a phone it's quiet: a few buttons, and More shows the rest (" + JSON.stringify(phoneFull) + ")");

  console.log("-- Live on a phone: the DJ stands at the stage's right, beside the song, on a shorter stage");
  const deskSide = await dPage.evaluate(async () => {
    location.hash = "#live";
    await new Promise((r) => setTimeout(r, 400));
    return { w: Math.round(document.getElementById("djStage").getBoundingClientRect().width), side: document.getElementById("stage").classList.contains("dj-side") };
  });
  await dPage.setViewportSize({ width: 390, height: 844 });
  const djSide = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    location.hash = "#live";
    await wait(400);
    const body = document.body.classList, had = { screen: body.contains("screen"), stalled: body.contains("yt-stalled") };
    const measure = () => {
      const st = document.getElementById("djStage").getBoundingClientRect(), spot = document.querySelector("#deck .spot").getBoundingClientRect();
      const av = document.querySelector("#deck .avtr").getBoundingClientRect(), np = document.getElementById("npText").getBoundingClientRect();
      return { w: Math.round(st.width), h: Math.round(st.height), spotMid: Math.round(spot.left + spot.width / 2 - st.left), spotRight: Math.round(st.right - spot.right),
        clearOfSong: np.right <= spot.left + 1, avatarIn: av.top >= st.top - 1 && av.height > 0 };
    };
    const out = { side: document.getElementById("stage").classList.contains("dj-side") };
    body.remove("screen");
    await wait(400);
    out.up = measure();
    body.add("screen"); body.remove("yt-stalled");
    await wait(400);
    out.down = measure();
    body.toggle("screen", had.screen); body.toggle("yt-stalled", had.stalled);
    await wait(200);
    return out;
  });
  console.log("-- the bottom tab bar on a phone: Home, Discover, Live, Library, You");
  const tabs = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const tap = async (t) => { document.querySelector('#nav-tabs [data-tab="' + t + '"]').click(); await wait(450); };
    const seen = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; };
    const lit = () => [...document.querySelectorAll("#nav-tabs .nt-tab.on")].map((b) => b.dataset.tab + (b.getAttribute("aria-current") === "page" ? "" : "!")).join();
    const out = {};
    const bar = document.getElementById("nav-tabs").getBoundingClientRect(), pb = document.getElementById("dMini").getBoundingClientRect();
    out.bar = { labels: [...document.querySelectorAll("#nav-tabs .nt-tab span")].map((s) => s.textContent).join(","), bottom: Math.round(innerHeight - bar.bottom), underPlayer: bar.top >= pb.bottom - 1,
      tall: Math.round(bar.height) >= 56, oldGone: !seen("#modeTabs") };
    await tap("home");
    out.home = { lit: lit(), hash: firetable.discover.address(), view: firetable.discover.state().view, rowGone: !seen("#dNav"), search: seen("#dQ") };
    await tap("discover");
    out.list = { lit: lit(), browse: document.body.classList.contains("nt-browse"), pages: [...document.querySelectorAll("#dNav .d-nav")].filter((b) => seen("#dNav") && b.getBoundingClientRect().height >= 44).length,
      browseHidden: !seen("#dBrowse") };
    document.querySelector('#dNav [data-view="charts"]').click();
    await wait(450);
    out.page = { lit: lit(), hash: firetable.discover.address(), browse: document.body.classList.contains("nt-browse"), shown: seen("#dBrowse") };
    await tap("discover");
    out.again = { lit: lit(), browse: document.body.classList.contains("nt-browse") };
    await tap("live");
    out.live = { lit: lit(), hash: firetable.discover.address(), stage: seen("#djStage"), join: seen("#login") };
    await tap("library");
    out.library = { lit: lit(), stageGone: !seen("#djStage"), join: seen("#login"), view: firetable.nav.view, section: firetable.nav.mobileSection };
    await tap("live");
    out.back = { lit: lit(), section: firetable.nav.mobileSection, stage: seen("#djStage") };
    // You: the account menu, or join / log in
    await tap("you");
    const menu = document.getElementById("nav-accountMenu"), join = document.getElementById("joinBox");
    out.you = menu.matches(":popover-open") ? "menu" : join.open ? "join" : "";
    if (menu.matches(":popover-open")) menu.hidePopover();
    if (join.open) { join.close(); await wait(300); }
    out.youNotLit = lit() === "live";
    // the Discover page row and the Live tabs come back on a computer
    return out;
  });
  check(tabs.bar.labels === "Home,Discover,Live,Library,You" && tabs.bar.bottom === 0 && tabs.bar.underPlayer && tabs.bar.tall && tabs.bar.oldGone,
    "phone: the tab bar sits along the bottom under the player, and the Discover / Live switch steps aside (" + JSON.stringify(tabs.bar) + ")");
  check(tabs.home.lit === "home" && /^#discover/.test(tabs.home.hash) && tabs.home.view === "home" && tabs.home.rowGone && tabs.home.search,
    "phone: Home is Discover's Home, with search and without the row of pages (" + JSON.stringify(tabs.home) + ")");
  check(tabs.list.lit === "discover" && tabs.list.browse && tabs.list.pages >= 8 && tabs.list.browseHidden && tabs.page.lit === "discover" && tabs.page.hash === "#discover/charts" && !tabs.page.browse && tabs.page.shown &&
    tabs.again.browse, "phone: Discover lists its pages, a page opens under the same tab, and the tab again goes back to the list (" + JSON.stringify([tabs.list, tabs.page, tabs.again]) + ")");
  check(tabs.live.lit === "live" && tabs.live.hash === "#live" && tabs.live.stage && tabs.live.join &&
    tabs.library.lit === "library" && tabs.library.stageGone && tabs.library.join && tabs.library.view === "playlists" && tabs.library.section === "view" &&
    tabs.back.lit === "live" && tabs.back.section !== "view" && tabs.back.stage,
    "phone, a visitor: Live is the stage; Library is what joining opens, on its own; Live goes back to its tab (" + JSON.stringify([tabs.live, tabs.library, tabs.back]) + ")");
  check(tabs.you === "join" && tabs.youNotLit, "phone, a visitor: You opens join and log in (" + tabs.you + ")");
  // a narrow desktop (the stage's middle column under 520px) keeps the DJ in the middle
  await dPage.setViewportSize({ width: 1024, height: 768 });
  const narrowDesk = await dPage.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 400));
    document.body.classList.remove("screen");
    await new Promise((r) => setTimeout(r, 300));
    const st = document.getElementById("djStage").getBoundingClientRect(), spot = document.querySelector("#deck .spot").getBoundingClientRect();
    return { w: Math.round(st.width), h: Math.round(st.height), spotMid: Math.round(spot.left + spot.width / 2 - st.left) };
  });
  await dPage.setViewportSize(desk);
  check(narrowDesk.w < 520 && Math.abs(narrowDesk.spotMid - narrowDesk.w / 2) < narrowDesk.w * 0.2 && narrowDesk.h >= 200,
    "a narrow desktop stage is left as it was: the DJ in the middle, the stage full height (" + JSON.stringify(narrowDesk) + ")");
  check(deskSide.w >= 520 && !deskSide.side && djSide.side, "only a narrow stage stands its DJ at the side (desktop " + JSON.stringify(deskSide) + ", phone " + djSide.side + ")");
  check(djSide.up.spotMid > djSide.up.w * 0.6 && djSide.up.spotRight < 24 && djSide.up.clearOfSong && djSide.up.avatarIn && djSide.up.h < djSide.up.w * 9 / 16 - 40,
    "screen up: the DJ is at the right, clear of the song, whole, and the stage is shorter than 16:9 (" + JSON.stringify(djSide.up) + ")");
  check(Math.abs(djSide.down.h - djSide.down.w * 9 / 16) <= 2 && Math.abs(djSide.down.spotMid - djSide.down.w / 2) < djSide.down.w * 0.2,
    "screen down: the stage is 16:9 for the video again, the DJ in the middle (" + JSON.stringify(djSide.down) + ")");

  console.log("-- Discover: the chat is for members only; visitors save songs to a crate");
  const peek = await dPage.evaluate(() => ({
    hidden: document.getElementById("chatPeek").hidden && !document.querySelector("#chatPeek .d-chatline"),
    tab: !!document.querySelector('#dSide [data-sidetab="chat"]')
  }));
  check(peek.hidden && !peek.tab, "visitors see no chat: none in Live, no Chat tab in Discover (" + JSON.stringify(peek) + ")");
  const crate = await dPage.evaluate(async () => {
    location.hash = "#discover/new";
    await new Promise((r) => setTimeout(r, 300));
    const show = document.getElementById("dNewShow");
    show.value = "days90";
    show.dispatchEvent(new Event("change", { bubbles: true }));
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
    const which = document.getElementById("dChartWhich");
    which.value = "new";
    which.dispatchEvent(new Event("change", { bubbles: true }));
    out.newOnly = [...document.querySelectorAll("#dBrowse .hist-track-title")].map((e) => e.textContent).join() + "|" + [...document.querySelectorAll("#dBrowse .hist-timestamp")].map((e) => e.textContent).join();
    document.getElementById("dChartWhich").value = "";
    document.getElementById("dChartWhich").dispatchEvent(new Event("change", { bubbles: true }));
    location.hash = "#discover/themes";
    await until(() => document.querySelector("#dBrowse .d-night"));
    out.nights = [...document.querySelectorAll("#dBrowse .d-night b")].map((e) => e.textContent).join();
    document.querySelector("#dBrowse .d-night").click();
    await until(() => document.querySelectorAll("#dBrowse .ft-rows .pvbar").length === 3);
    out.night = document.querySelector("#dBrowse .d-pagetext h2").textContent + "|" + document.querySelectorAll("#dBrowse .ft-rows .pvbar").length + "|" + firetable.discover.address();
    localStorage.setItem("ft-crate", "[]");
    document.querySelector("#dBrowse .d-saveall").click();
    out.saved = JSON.parse(localStorage.getItem("ft-crate") || "[]").map((t) => t.t).join();
    document.querySelector("#dBrowse .d-playall").click();
    await wait(200);
    out.playing = firetable.discover.state().list + ":" + firetable.discover.state().playing;
    firetable.discover.openFull();
    await until(() => document.querySelector("#pv-ftags .d-tag"));
    out.source = [...document.querySelectorAll("#pv-ftags .d-tag")].map((e) => e.textContent).includes("YouTube");
    firetable.discover.closeFull();
    await wait(500);
    out.reload = !!document.querySelector("#dMini .d-reload");
    localStorage.setItem("ft-crate", "[]");
    location.hash = "#discover/themes/nT2";
    await until(() => document.querySelectorAll("#dBrowse .ft-rows .pvbar").length === 100);
    document.querySelector("#dBrowse .d-saveall").click();
    out.savedLong = JSON.parse(localStorage.getItem("ft-crate") || "[]").length;
    localStorage.setItem("ft-crate", "[]");
    return out;
  });
  check(extras.fires === "4" && extras.wks === "3 wks,2 wks", "chart rows show fires (not counted) and weeks on the chart (" + extras.fires + " / " + extras.wks + ")");
  check(extras.newOnly === "First Single|#3", "New releases narrows the chart and keeps each song's place (" + extras.newOnly + ")");
  check(extras.nights === "Italo Night" && extras.night === "Italo Night|3|#discover/themes/nT1", "theme nights, and a night's songs in order (" + extras.nights + " / " + extras.night + ")");
  check(extras.saved === "One,Two,Three", "Save all puts a whole list in the crate (" + extras.saved + ")");
  check(extras.savedLong === 100, "Save all saves every song on screen, not just the first 50 (" + extras.savedLong + " of 100)");
  check(extras.playing === "night:night00001" && extras.source && extras.reload, "Play the night; the player names the source and can reload (" + JSON.stringify(extras) + ")");

  console.log("-- Charts: the period as one control, two drop-downs, Play the chart, Save as playlist, Share; tied songs share a rank");
  await put("/discover/charts/week/2026-W46", { at: now, from: now - 3 * 86400000, to: now + 4 * 86400000, plays: 20, djs: 2, rows: [
    { key: "t1", type: 1, cid: "tie0000001", a: "Tie", t: "One", plays: 6, dj: "dj1", djid: "dj1", first: now - 86400000, mv: "new", wks: 1 },
    { key: "t2", type: 1, cid: "tie0000002", a: "Tie", t: "Two", plays: 6, mv: "new", wks: 1 },
    { key: "t3", type: 1, cid: "tie0000003", a: "Tie", t: "Three", plays: 4, mv: "new", wks: 1 }] });
  await put("/discover/chartIds/week/2026-W46", true);
  const ties = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    location.hash = "#discover/home";
    await wait(200);
    location.hash = "#discover/charts";
    await until(() => document.getElementById("dChartWhich") && [...document.querySelectorAll("#dBrowse .hist-track-title")].some((e) => e.textContent === "Three"));
    return {
      ranks: [...document.querySelectorAll("#dBrowse .ft-rows .hist-timestamp")].map((e) => e.textContent).join(),
      note: !!document.querySelector("#dBrowse .d-tienote"),
      period: [...document.querySelectorAll("#dBrowse .d-seg .d-segbtn")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join(),
      chips: document.querySelectorAll("#dBrowse .d-chip[data-cnew], #dBrowse .d-chip[data-cgenre], #dBrowse .d-chip[data-period]").length,
      which: [...((document.getElementById("dChartWhich") || {}).options || [])].map((o) => o.textContent).join("|"),
      acts: [...document.querySelectorAll("#dBrowse .d-chartacts button span")].map((e) => e.textContent).join("|"),
      first: (document.querySelector("#dBrowse .d-firsthere") || {}).textContent || ""
    };
  });
  check(ties.ranks === "=1,=1,#3" && ties.note, "songs with the same plays share a rank, and the chart says so (" + JSON.stringify(ties) + ")");
  check(ties.period === "Week*,Month,Year,All time" && !ties.chips && ties.which === "All songs|New releases only" && ties.acts === "Play the chart|Save as playlist|Share" && /^dj1 · /.test(ties.first),
    "the chart's period is one control, genre and new releases are drop-downs, with Play the chart, Save as playlist and Share, and who played each first (" + JSON.stringify(ties) + ")");
  await put("/discover/chartIds/week/2026-W46", null);
  await put("/discover/charts/week/2026-W46", null);
  await dPage.evaluate(() => { location.hash = "#discover/home"; });

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
  await openPage(embed, SITE + "embed/chart/?period=week");
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
    out.hash = firetable.discover.address();
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
  // its tempo, for the BPM tag below (the sheet keeps what it looked up)
  await put("/bpm/1_lib0000001", { bpm: 118.3, src: "deezer" });
  // the play history keeps only names: faces must come from the member's uid, never name + name
  await put("/globalSongs/sL1", { artist: "Alpha & Beta", title: "Fav One", plays: 30, first_play_date: now - 400 * 86400000, first_play_dj: "Zed",
    last_play_date: now - 86400000, last_play_dj: "Nobody Known", genres: ["Nu-Disco"] });
  const doors = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await wait(100); return fn(); };
    firetable.knownNames = Object.assign(firetable.knownNames || {}, { uidZ: "Zed" });
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
    const faces = [...sheet.querySelectorAll("#dSheetHist .pv-dj-avatar")];
    out.faces = faces.map((f) => (f.classList.contains("d-noface") ? (/img\/robot-generic\.png/.test(f.style.backgroundImage) ? "generic" : "none") : (f.style.backgroundImage.match(/robots\/([^.?]+)/) || [])[1] || f.style.backgroundImage)).join(",");
    sheet.querySelector(".closeModal").click();
    document.getElementById("track").click();
    await until(() => /playing in the room now/.test((document.getElementById("dSheetHist") || {}).textContent || ""));
    out.stageSheet = document.getElementById("dSheetHist").textContent;
    document.getElementById("dSheetBox").close();
    const robot = document.querySelector("#thediscovers .pv-dj-avatar");
    if (robot) robot.click();
    await wait(300);
    out.robot = firetable.discover.address();
    return out;
  });
  check(doors.artistLinks === "/music/artists/alpha/,/music/artists/beta/" && /^\/music\/artists\//.test(doors.stageArtist || "") && doors.titleButton === "button",
    "in Live, artist names link to their pages and titles are buttons (" + JSON.stringify(doors) + ")");
  check(doors.faces === "uidZZed,generic", "a name-only history line shows that member's face (uid + name), or the generic gray robot bust when unknown (" + doors.faces + ")");
  check(/^Fav One\|.*30 plays/.test(doors.sheet || "") && /playing in the room now/.test(doors.stageSheet || ""), "a title opens its song sheet, with the room's plays; the stage's says it's playing now");
  check(doors.robot === "#discover/djs/dj1", "a DJ's robot in Live opens their DJ page (" + doors.robot + ")");

  console.log("-- Discover: a song's BPM tag opens the songs played here at that tempo");
  await put("/bpm/1_lib0000002", { bpm: 117.6, src: "manual" });
  await put("/bpm/1_lib0000003", { bpm: 120, src: "deezer" });
  await put("/bpm/1_lib0000004", { bpm: 124, src: "deezer" });
  await put("/bpm/1_lib0000005", { none: true });
  await put("/globalTracks/1lib0000002", { artist: "Gamma", title: "Same Tempo", type: 1, song: "sL2", first_play_date: now - 9 * 86400000, first_play_dj: "Zed" });
  await put("/globalSongs/sL2", { artist: "Gamma", title: "Same Tempo", plays: 4 });
  await put("/globalTracks/1lib0000003", { artist: "Delta", title: "Close Tempo", type: 1, song: "sL3" });
  await put("/globalSongs/sL3", { artist: "Delta", title: "Close Tempo", plays: 2 });
  await put("/globalTracks/1lib0000004", { artist: "Epsilon", title: "Too Fast", type: 1, song: "sL4" });
  const tempo = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await wait(100); return fn(); };
    const out = {};
    location.hash = "#live";
    await ftapi.watchFeed("fresh");
    await until(() => document.querySelector("#thediscovers .fresh-track-title"));
    document.querySelector("#thediscovers .fresh-track-title").click();
    await until(() => document.querySelector("#dSheetBox[open] #dSheetTags .d-bpmtag"));
    const tag = document.querySelector("#dSheetTags .d-bpmtag");
    const genre = document.querySelector("#dSheetTags a.d-tag:not(.d-bpmtag)");
    out.tag = tag ? tag.textContent + "|" + tag.getAttribute("href") : null;
    out.sameFont = !!(tag && genre && getComputedStyle(tag).fontFamily === getComputedStyle(genre).fontFamily && getComputedStyle(tag).fontWeight === getComputedStyle(genre).fontWeight);
    tag.click();
    await until(() => (document.querySelector("#dBrowse .d-pagehead h2") || {}).textContent === "118 BPM" && document.querySelector("#dBrowse .ft-rows .pvbar"));
    out.closed = !document.getElementById("dSheetBox").open;
    out.hash = firetable.discover.address();
    out.discover = document.body.classList.contains("ft-discover");
    const lists = [...document.querySelectorAll("#dBrowse .ft-rows")].map((l) => [...l.querySelectorAll(".hist-track-title")].map((e) => e.textContent).join());
    out.lists = lists.join("|");
    out.fact = document.querySelector("#dBrowse .d-pagehead .d-fact").textContent;
    out.half = [...document.querySelectorAll("#dBrowse .d-pagehead .d-fact a")].map((a) => a.getAttribute("href")).join();
    document.querySelector("#dBrowse .d-playall").click();
    await wait(200);
    out.playing = firetable.discover.state().list;
    document.querySelector('#dBrowse .d-headrow a[href="/#discover/bpm/119"]').click();
    await until(() => (document.querySelector("#dBrowse .d-pagehead h2") || {}).textContent === "119 BPM");
    out.next = firetable.discover.address() + "|" + [...document.querySelectorAll("#dBrowse .hist-track-title")].map((e) => e.textContent).join() + "|" + !!document.querySelector("#dBrowse .d-empty");
    location.hash = "#discover/bpm/12";
    await wait(300);
    out.bad = firetable.discover.address() + "|" + (document.querySelector("#dBrowse .d-pagehead h2") || {}).textContent;
    return out;
  });
  check(tempo.tag === "118 BPM|/#discover/bpm/118" && tempo.sameFont, "the BPM tag links to its tempo, in the tags' own font (" + JSON.stringify(tempo) + ")");
  check(tempo.closed && tempo.hash === "#discover/bpm/118" && tempo.discover, "the tag opens the tempo's page in Discover and closes the sheet (" + tempo.hash + ")");
  check(tempo.lists === "Fav One,Same Tempo|Close Tempo", "the tempo's songs, most played first, then the ones close by; untitled and too-far ones left out (" + tempo.lists + ")");
  check(tempo.fact === "2 songs played here · 34 plays" && tempo.half === "/#discover/bpm/59,/#discover/bpm/236", "the tempo's facts, with half and double time (" + tempo.fact + " / " + tempo.half + ")");
  check(tempo.playing === "bpm", "Play all plays the tempo's songs (" + tempo.playing + ")");
  check(/^#discover\/bpm\/119\|Fav One,Close Tempo,Same Tempo\|true$/.test(tempo.next), "Faster steps to the next tempo: nothing at it, the songs close by closest first (" + tempo.next + ")");
  check(tempo.bad === "#discover/bpm/119|119 BPM", "a tempo out of range isn't a page: the one showing stays (" + tempo.bad + ")");

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
    const out = { open: !!(dlg && dlg.open), inside: !!(dlg && dlg.querySelector("#authBox")), form: ["createscreen", "logscreen"].filter((id) => !document.getElementById(id).hidden).join(),
      title: dlg && dlg.querySelector("#joinTitle").textContent, focused: document.activeElement && document.activeElement.id, stillDiscover: document.body.classList.contains("ft-discover") };
    dlg.close();
    return out;
  });
  check(join.open && join.inside && join.form === "logscreen" && join.focused === "loginemail" && join.stillDiscover,
    "Log in opens the form in a dialog, on Discover (" + JSON.stringify(join) + ")");

  console.log("-- Join or log in from the header, on Discover and in Live");
  const header = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const dlg = document.getElementById("joinBox");
    const closeIt = async () => { dlg.close(); await wait(50); };
    const out = {};
    const btn = document.getElementById("nav-signin");
    out.label = document.getElementById("nav-signinLabel").textContent;
    out.discover = { shown: btn.offsetParent !== null };
    btn.click();
    await wait(200);
    out.discover.open = dlg.open;
    out.discover.form = ["createscreen", "logscreen"].filter((id) => !document.getElementById(id).hidden).join();
    out.discover.title = document.getElementById("joinTitle").textContent;
    document.getElementById("loginlink").click();
    out.discover.retitled = document.getElementById("joinTitle").textContent;
    await closeIt();
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(300);
    out.live = { shown: btn.offsetParent !== null };
    btn.click();
    await wait(200);
    out.live.open = dlg.open;
    out.live.inside = !!dlg.querySelector("#authBox");
    out.live.focused = document.activeElement && document.activeElement.id;
    await closeIt();
    // Live's welcome opens the same dialog, with the same buttons as Discover
    const welcomeJoin = document.querySelector("#welcomeInfo .au-join .d-join .d-createaccount");
    out.live.welcome = !!welcomeJoin && welcomeJoin.offsetParent !== null && !document.querySelector("#welcomeInfo #authBox");
    if (welcomeJoin) welcomeJoin.click();
    await wait(200);
    out.live.welcomeOpens = dlg.open && !document.getElementById("createscreen").hidden;
    await closeIt();
    document.querySelector('#modeTabs [data-mode="discover"]').click();
    await wait(200);
    return out;
  });
  check(header.label === "Join" && header.discover.shown && header.discover.open && header.discover.form === "createscreen" && /^Join /.test(header.discover.title) && header.discover.retitled === "Welcome back",
    "on Discover, the header's Join opens the sign-in dialog; its title follows the tabs (" + JSON.stringify(header) + ")");
  check(header.live.shown && header.live.open && header.live.inside && header.live.focused === "newemail" && header.live.welcome && header.live.welcomeOpens,
    "in Live the header and the welcome's Create account open the same dialog; Live has no form of its own (" + JSON.stringify(header.live) + ")");

  console.log("-- Discover: the sound map marks the room's genre, and a genre's card opens under it");
  // the room's song, as this page knows it, is one whose library record says Nu-Disco (put back after);
  // the database's song stays, so no player anywhere is cut short
  await put("/globalTracks/1mapsong0001", { artist: "Smoke Artist", title: "Map Song", type: 1, song: "sMap" });
  await put("/globalSongs/sMap", { artist: "Smoke Artist", title: "Map Song", plays: 3, genres: ["Nu-Disco"] });
  // a play from tonight whose Recent row carries its genre (the bot's g)
  await put("/songHistory/-zzzmap0001", { type: 1, cid: "maptonight1", artist: "Somebody", title: "Tonight's Soul", dj: "dj2", djid: "dj2", when: Date.now() - 3600000, g: "Soul & R&B" });
  await dPage.evaluate(() => {
    window.__songBefore = firetable.song;
    firetable.song = Object.assign({}, firetable.song, { type: 1, cid: "mapsong0001", title: "Map Song", artist: "Smoke Artist" });
    ftapi.events.emit("newSong", firetable.song);
  });
  const soundMap = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await wait(100); return fn(); };
    const out = {};
    location.hash = "#discover/genres";
    await until(() => document.querySelector("#dBrowse .d-map .d-mapg.d-room"));
    out.room = [...document.querySelectorAll("#dBrowse .d-mapg.d-room")].map((a) => a.getAttribute("data-slug")).join();
    out.hear = [...document.querySelectorAll("#dBrowse .d-mapg.d-hear")].map((a) => a.getAttribute("data-slug")).join();
    await until(() => document.querySelector("#dBrowse .d-mapg.d-tonight"));
    out.tonight = [...document.querySelectorAll("#dBrowse .d-mapg.d-tonight")].map((a) => a.getAttribute("data-slug")).join();
    out.rings = [...document.querySelectorAll("#dBrowse .d-mapg.d-tonight")].map((a) => a.style.getPropertyValue("--t")).join();
    out.halo = getComputedStyle(document.querySelector("#dBrowse .d-mapg")).textShadow !== "none";
    out.legend = [...document.querySelectorAll("#dMapLegend > span")].filter((x) => getComputedStyle(x).display !== "none").map((x) => x.textContent).join("|");
    const before = firetable.discover.address();
    document.querySelector('#dBrowse .d-mapg[data-slug="soul-and-randb"]').click();
    await wait(100);
    out.stayed = firetable.discover.address() === before && !!document.querySelector("#dBrowse .d-map");
    const card = document.getElementById("dMapCard");
    out.card = (card.querySelector("h3") || {}).textContent + "|" + !!card.querySelector('.d-radio[data-slug="soul-and-randb"]') + "|" + (card.querySelector('a[href="/music/genres/soul-and-randb/"]') ? "open" : "");
    out.picked = document.querySelector("#dBrowse .d-mapg.is-picked").getAttribute("data-slug") + "|" + document.querySelector("#dBrowse .d-mapg.is-picked").getAttribute("aria-current");
    return out;
  });
  check(soundMap.room === "nu-disco" && soundMap.hear === "nu-disco" && /The room is playing/.test(soundMap.legend) && /You're hearing/.test(soundMap.legend),
    "the sound map: the room song's genre has the room's dot, and the one you're hearing its outline, with a legend (" + JSON.stringify(soundMap) + ")");
  check(/(^|,)1\.00(,|$)/.test(soundMap.rings || "") && (soundMap.rings || "").split(",").every((t) => Number(t) > 0 && Number(t) <= 1) && soundMap.halo && /Bigger: played here more/.test(soundMap.legend),
    "the sound map: a ring is brighter the more of tonight was its genre, names have a halo so the middle lines pass behind them, and the legend says what size means (" + soundMap.rings + " / " + soundMap.legend + ")");
  check(/soul-and-randb/.test(soundMap.tonight || "") && /Played tonight/.test(soundMap.legend),
    "the sound map rings the genres played tonight, from the Recent rows' genre (" + soundMap.tonight + " / " + soundMap.legend + ")");
  check(soundMap.stayed && /^Soul & R&B\|true\|open$/.test(soundMap.card) && soundMap.picked === "soul-and-randb|true",
    "picking a genre on the map shows its card under the map (radio, Open) and stays on the page (" + JSON.stringify(soundMap) + ")");
  await dPage.evaluate(() => { firetable.song = window.__songBefore; ftapi.events.emit("newSong", firetable.song); });

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
    document.querySelector('#dBrowse .d-gcard[href="/music/genres/nu-disco/"]').click();
    await until(() => document.querySelector("#dBrowse .d-pagehead h2"));
    out.genre = document.querySelector("#dBrowse .d-pagehead h2").textContent + "|" + document.querySelectorAll("#dBrowse .ft-rows .pvbar").length + "|" + firetable.discover.address();
    out.about = (document.querySelector("#dBrowse .d-about") || {}).textContent;
    await until(() => document.querySelector("#dBrowse .d-ytm"));
    out.ytm = (document.querySelector("#dBrowse .d-ytm") || { getAttribute: () => null }).getAttribute("href");
    out.artistLinks = [...document.querySelectorAll("#dBrowse .ft-rows .hist-track-artist a")].slice(0, 2).map((a) => a.getAttribute("href")).join();
    out.who = [...document.querySelectorAll("#dBrowse .d-person")].map((p) => p.getAttribute("href")).join();
    // every face on the timeline is the timeline's size: linked to a DJ page or not, known or not
    const faces = () => [...document.querySelectorAll("#dBrowse .hist-entry .pv-dj-avatar:not(.d-nobody)")].map((a) => Math.round(a.getBoundingClientRect().width) + "x" + Math.round(a.getBoundingClientRect().height));
    out.favFaces = faces().join();
    document.querySelector('.d-chip[data-gtab="deep"]').click();
    out.deepFace = faces().join() + "|" + /img\/robot-generic\.png/.test((document.querySelector("#dBrowse .hist-entry .d-noface") || { style: {} }).style.backgroundImage || "") + "|" + Math.round(document.querySelector("#dBrowse .hist-track-title").getBoundingClientRect().width);
    document.querySelector('.d-chip[data-gtab="newHere"]').click();
    out.newHere = [...document.querySelectorAll("#dBrowse .hist-track-title")].map((e) => e.textContent).join();
    document.querySelector("#dBrowse .d-radio").click();
    await wait(200);
    out.radio = firetable.discover.state().list + "|" + (document.getElementById("pv-src") || {}).textContent;
    location.hash = "#discover/djs/dj1";
    await until(() => document.querySelector("#dBrowse .d-taste"));
    out.taste = [...document.querySelectorAll("#dBrowse .d-stacklegend li")].map((li) => li.textContent).join("|") + "|" + document.querySelectorAll("#dBrowse .d-stack > i").length;
    out.djTab = document.querySelector("#dBrowse .d-chip[data-djtab].on").getAttribute("data-djtab") + "|" +
      (document.querySelector("#dBrowse .d-pagehead .d-actions .butt span") || {}).textContent + "|" +
      [...document.querySelectorAll("#dBrowse .d-chip[data-djtab]")].map((c) => c.getAttribute("data-djtab")).join();
    const more = document.querySelector("#dBrowse .d-showall");
    const capList = more && more.previousElementSibling;
    const shownRows = () => [...capList.querySelectorAll(".pvbar")].filter((r) => r.offsetParent !== null).length;
    out.capped = shownRows() + "|" + (more && more.textContent.trim());
    more.click();
    out.uncapped = shownRows() + "|" + !document.querySelector("#dBrowse .d-showall") + "|" + firetable.discover.state().list;
    out.userCardLink = firetable.discover.djPage("dj1", "dj1");
    out.sets = [...document.querySelectorAll("#dBrowse .d-set")].map((x) => x.lastElementChild.textContent).join("|");
    out.chips = [...document.querySelectorAll("#dBrowse .d-pagehead .d-facts li")].length;
    out.dj = document.querySelector("#dBrowse .d-pagehead h2").textContent + "|" + document.querySelector("#dBrowse .d-pagehead .d-fact").textContent;
    location.hash = "#discover/artist/alpha";
    const h2 = (text) => () => (document.querySelector("#dBrowse .d-pagehead h2") || {}).textContent === text;
    await until(h2("Alpha"));
    out.artist = document.querySelector("#dBrowse .d-pagehead h2").textContent + "|" + document.querySelectorAll("#dBrowse .ft-rows .pvbar").length;
    location.hash = "#discover/years";
    await until(() => document.querySelector("#dBrowse .d-yearrow"));
    const yr = document.querySelector('#dBrowse .d-yearrow[href="/music/years/2026/"]');
    out.yearRow = !!(yr && yr.querySelector(".d-mosaic i[style]")) + "|" + /released in 2026/.test(yr ? yr.textContent : "");
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
  check(libPages.sets === "12 songs in 2 sets" && libPages.chips >= 4, "a DJ's sets on one night are one line, and the page's facts are chips (" + libPages.sets + " / " + libPages.chips + ")");
  check(libPages.yearRow === "true|true", "the Years list shows each year's covers and says they're its releases (" + libPages.yearRow + ")");
  check(libPages.taste === "Nu-Disco70%|Everything else30%|2", "a DJ's sound: one stacked bar of their top genres and the rest, with a legend (" + libPages.taste + ")");
  check(libPages.capped === "10|expand_moreShow all 14" && /^14\|true\|/.test(libPages.uncapped || ""),
    "a long list shows its top 10 and Show all, which opens the rest in place (" + libPages.capped + " / " + libPages.uncapped + ")");
  check(libPages.djTab === "firstHere|Play what they brought here|firstHere,most",
    "a DJ page opens on Brought here first, its first tab, when they have any (" + libPages.djTab + ")");
  check(libPages.artistLinks === "/music/artists/alpha/,/music/artists/beta/" && libPages.who === "/music/djs/dj1/", "artists and DJs link to their pages (" + libPages.artistLinks + " / " + libPages.who + ")");
  check(/^(\d+)x\1,\1x\1$/.test(libPages.favFaces) && Number(libPages.favFaces.split("x")[0]) > 10 && Number(libPages.favFaces.split("x")[0]) < 40,
    "faces on a genre's timeline are the timeline's size, linked to a DJ page or not (" + libPages.favFaces + ")");
  check(/^(\d+)x\1\|true\|(\d+)$/.test(libPages.deepFace) && Number(libPages.deepFace.split("x")[0]) < 40 && Number(libPages.deepFace.split("|")[2]) > 40,
    "a first DJ nobody can name now is a small generic gray robot bust, and the title keeps its room (" + libPages.deepFace + ")");
  check(/^radio\|.*Nu-Disco radio/.test(libPages.radio), "genre radio plays (" + libPages.radio + ")");
  check(/^dj1\|.*Friday nights/.test(libPages.dj) && libPages.artist === "Alpha|1" && libPages.year === "1|1", "DJ, artist and year pages; a year listing one song three times shows it once (" + [libPages.dj, libPages.artist, libPages.year].join(" / ") + ")");
  check(/no page for this DJ/.test(libPages.missing), "a DJ without a page says so (" + libPages.missing + ")");
  const dTags = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    const items = () => [...document.querySelectorAll("#dMenu .d-menuitem")].map((e) => e.getAttribute("data-act")).filter(Boolean).join();
    const out = {};
    location.hash = "#discover/genres/nu-disco";
    await until(() => document.querySelector("#dBrowse .d-more"));
    const row = () => document.querySelector("#dBrowse .d-more").closest(".pvbar");
    const cid = row().getAttribute("data-cid");
    row().querySelector(".d-more").click();
    out.visitor = items();
    document.body.click();
    // a mod (or supermod): Edit tags… on every Discover song
    const was = { uid: ftapi.uid, isMod: ftapi.isMod, editTag: ftapi.actions.editTag };
    ftapi.uid = "smokeMod";
    ftapi.isMod = true;
    const calls = [];
    ftapi.actions.editTag = (...a) => { calls.push(a.slice(0, 5).join("|")); a[5](null); };
    row().querySelector(".d-more").click();
    out.mod = items();
    document.querySelector('#dMenu [data-act="tags"]').click();
    await wait(200);
    out.editor = document.getElementById("tagEditorPopover").matches(":popover-open") && document.getElementById("tagMachine").value;
    document.getElementById("tagMachine").value = "Fixed Artist - Fixed Title";
    document.querySelector("#tagEditorForm .tagSave").click();
    await until(() => document.querySelector('#dBrowse .pvbar[data-cid="' + cid + '"] .d-sheetlink') &&
      document.querySelector('#dBrowse .pvbar[data-cid="' + cid + '"] .d-sheetlink').textContent === "Fixed Title");
    const after = document.querySelector('#dBrowse .pvbar[data-cid="' + cid + '"]');
    out.calls = calls.join();
    out.cid = cid;
    out.shown = after.querySelector(".d-sheetlink").textContent + "|" + after.querySelector(".hist-track-artist, .fresh-track-artist").textContent;
    out.closed = !document.getElementById("tagEditorPopover").matches(":popover-open");
    Object.assign(ftapi, { uid: was.uid, isMod: was.isMod });
    ftapi.actions.editTag = was.editTag;
    return out;
  });
  check(!/tags/.test(dTags.visitor) && /,tags$/.test(dTags.mod), "Discover's ⋮ has Edit tags… for mods only (" + dTags.visitor + " / " + dTags.mod + ")");
  check(/ - /.test(dTags.editor || ""), "it opens the tag editor with the song's tags (" + dTags.editor + ")");
  check(dTags.calls === "1|" + dTags.cid + "|Fixed Artist - Fixed Title||discover" && dTags.closed,
    "Save fixes the upload's tags (" + dTags.calls + ")");
  check(dTags.shown === "Fixed Title|Fixed Artist", "and Discover shows the new tags at once (" + dTags.shown + ")");
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
    const out = { tabs: [...document.querySelectorAll("#dLocked .tab")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join(), form: shown("welcomeInfo") };
    const tab = (name) => document.querySelector('#dLocked [data-locked="' + name + '"]').click();
    tab("playlists");
    out.playlists = { form: shown("welcomeInfo"), text: /Your playlists/.test(document.getElementById("dLockedPane").textContent), join: !!document.querySelector("#dLockedPane .d-createaccount") };
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
    out.back = { form: shown("welcomeInfo"), pane: document.getElementById("dLockedPane").hidden };
    return out;
  });
  check(locked.tabs === "Join*,Playlists,Recent,Cards" && locked.form, "a visitor in Live sees Join, Playlists, Recent and Cards (" + JSON.stringify(locked) + ")");
  check(!locked.playlists.form && locked.playlists.text && locked.playlists.join, "Playlists says what joining gives, with Create account (" + JSON.stringify(locked.playlists) + ")");
  check(locked.recent >= 1 && locked.played.discover && locked.played.playing === "lockrec001", "Recent lists the room's plays, and one plays in Discover (" + JSON.stringify({ n: locked.recent, played: locked.played }) + ")");
  check(locked.cards > 0 && locked.cards <= 3, "Cards shows the latest cards (" + locked.cards + ")");
  check(locked.back.form && locked.back.pane, "Join brings the welcome back (" + JSON.stringify(locked.back) + ")");

  // the bar's tools keep one order: screen and cast go into the full-screen player and come back
  const toolOrder = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ids = () => [...document.querySelectorAll("#pv-tools > [id]:not(.ft-tip)")].map((b) => b.id).join();
    const out = [ids()];
    for (let i = 0; i < 2; i++) {
      firetable.discover.openFull(); await wait(300);
      firetable.discover.closeFull(); await wait(300);
      out.push(ids());
    }
    return out;
  });
  check(toolOrder.every((o) => o === "screenControl,reloadtrack,st-cast,fullscreenBtn"),
    "the bar's tools stay in one order through the full-screen player and back: screen, reload, cast, full screen (" + JSON.stringify(toolOrder) + ")");

  // Fresh beside the welcome (640px and up): a visitor has no Fresh tab to choose, so it loads when it's on screen
  const fPage = await context.newPage();
  await fPage.setViewportSize({ width: 1280, height: 800 });
  await openPage(fPage, SITE + "#live");
  const freshBeside = await fPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && !document.querySelector("#thediscovers .pvbar"); i++) await wait(100);
    const box = document.getElementById("discover");
    return { shown: box.offsetParent !== null, login: document.getElementById("mainGrid").classList.contains("login"), view: firetable.nav.view,
      rows: document.querySelectorAll("#thediscovers .pvbar").length, loading: document.querySelectorAll("#thediscovers .ft-skeleton").length,
      djPicker: getComputedStyle(document.getElementById("djlistpicker")).visibility, clock: document.getElementById("timr").offsetParent !== null };
  });
  // Listen to the room (the browser holding the sound back): one line in the stage's lower left, clear of the DJ
  // (measured in the instant the state is set: the site clears it itself the moment the player gets going)
  const listenAt = async (pg) => pg.evaluate(() => {
    document.body.classList.add("media-blocked");
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const pill = r("#tapToPlay"), stage = r("#djStage"), dj = r("#deck .spot"), art = r("#albumArt");
    const out = { text: document.querySelector("#tapToPlay .ttp-text").textContent, sub: getComputedStyle(document.getElementById("tapToPlaySub")).display,
      inStage: pill.left >= stage.left && pill.right <= stage.right && pill.bottom <= stage.bottom, lines: Math.round(pill.height) <= 44,
      clearOfDj: pill.right <= dj.left || pill.bottom <= dj.top, underSong: pill.top >= art.bottom, left: Math.round(pill.left - art.left), w: Math.round(pill.width),
      state: [getComputedStyle(document.getElementById("tapToPlay")).display, document.getElementById("st-notlive").hidden ? "" : "not-live card", document.body.className].join(" | ") };
    document.body.classList.remove("media-blocked");
    return out;
  });
  // (a visitor's own fresh browser: in this test's, the room's sound was turned off earlier, and then
  // "You're not listening live" has that corner instead)
  const qContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const qPage = await qContext.newPage();
  await openPage(qPage, SITE + "#live");
  await qPage.waitForFunction(() => document.querySelector("#deck .spot") && /Smoke|\S/.test(document.getElementById("track").textContent), null, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const listenWide = await listenAt(qPage);
  // who is in the room, in the left column (1024px and up): a visitor's was empty
  const hereAt = (pg) => pg.evaluate(() => {
    const box = document.getElementById("pe-here"), head = document.getElementById("topbar").getBoundingClientRect(), stage = document.getElementById("stage").getBoundingClientRect();
    const rows = [...box.querySelectorAll(".pe-row")], first = rows[0] && rows[0].getBoundingClientRect();
    return { shown: box.getClientRects().length > 0, rows: rows.length, djsFirst: rows.length > 1 && rows[0].classList.contains("is-dj") && !rows[rows.length - 1].classList.contains("is-dj"),
      count: (box.querySelector(".pe-count") || {}).textContent || "", pressable: box.querySelectorAll("button, a, [tabindex], [role=button]").length,
      clear: !!first && first.top >= head.bottom && first.right <= stage.left + 1, pulse: document.getElementById("roomPulse").getClientRects().length > 0 };
  });
  const hereWide = await hereAt(qPage);
  await qPage.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  const listenPhone = await listenAt(qPage);
  const herePhone = await hereAt(qPage);
  await qContext.close();
  check(hereWide.shown && hereWide.rows >= 2 && hereWide.djsFirst && Number(hereWide.count) >= 1 && hereWide.pressable === 0 && hereWide.clear && !hereWide.pulse,
    "a visitor's Live on a computer lists who is in the room in the left column, DJs first, nothing to press, under the header (" + JSON.stringify(hereWide) + ")");
  check(!herePhone.shown && herePhone.pulse, "on a phone the line of faces above Create account says it instead (" + JSON.stringify(herePhone) + ")");
  check([listenWide, listenPhone].every((l) => l.text === "Listen to the room" && l.sub === "none" && l.inStage && l.lines && l.clearOfDj && l.underSong) && listenPhone.left === 0,
    "Listen to the room is one line under the song, inside the stage and clear of the DJ, on a computer and on a phone (where it lines up with the cover) (" + JSON.stringify({ wide: listenWide, phone: listenPhone }) + ")");
  check(freshBeside.djPicker === "hidden" && freshBeside.clock, "a visitor isn't offered a playlist to DJ from under the stage; the clocks stay (" + freshBeside.djPicker + ")");
  check(freshBeside.shown && freshBeside.login && freshBeside.view !== "discover" && freshBeside.rows >= 1 && !freshBeside.loading,
    "a visitor's Fresh, beside the welcome, loads without its tab being chosen (" + JSON.stringify(freshBeside) + ")");
  await fPage.close();

  console.log("-- guests and the radio's listeners by country, in the people lists (api/audience.php)");
  // api/audience.php answered here: a visitor's page sends heartbeats (Playwright's
  // navigator.webdriver is hidden, as it is for people), a member's only asks
  const AUDIENCE = { updated: "2026-11-23T12:00:00Z", guests: 3, guestsLive: 1,
    stream: { listeners: 6, unplaced: 1, countries: [{ code: "US", name: "United States", n: 3 }, { code: "DE", name: "Germany", n: 2 }] } };
  const audCalls = [];
  // (a person's browser: headless Chromium says "HeadlessChrome", which isn't counted)
  const aContext = await browser.newContext({ viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" });
  await aContext.addInitScript(() => { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }); });
  await aContext.route("**/api/audience.php*", (route) => {
    const r = route.request();
    audCalls.push({ method: r.method(), body: r.postData() || "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(AUDIENCE) });
  });
  const aPage = await aContext.newPage();
  aPage.on("pageerror", (e) => pageErrors.push("Audience: " + e.message));
  await openPage(aPage, SITE + "#live");
  await aPage.waitForFunction(() => document.querySelectorAll("#pe-here .pe-audRow").length >= 3, null, { timeout: 20000 }).catch(() => {});
  const visitorAud = await aPage.evaluate(() => {
    const box = document.getElementById("pe-here");
    return {
      rows: [...box.querySelectorAll(".pe-audRow")].map((r) => r.querySelector(".pe-audName").textContent + "=" + r.querySelector(".pe-audN").textContent),
      flags: [...box.querySelectorAll(".pe-audRow .pe-flag")].map((f) => f.querySelector("img.emoji") ? f.querySelector("img").alt : f.textContent),
      heads: [...box.querySelectorAll(".pe-audHead")].map((h) => h.textContent.replace(/^(radio|person)/, "")),
      note: (box.querySelector(".pe-audNote") || {}).textContent || "",
      pressable: box.querySelectorAll("button, a, [tabindex], [role=button]").length,
      pulse: document.getElementById("roomPulse").textContent
    };
  });
  const beat = audCalls.find((c) => c.method === "POST");
  const beatBody = new URLSearchParams(beat ? beat.body : "");
  check(!!beat && /^[0-9a-f]{32}$/.test(beatBody.get("id") || "") && /^[01]$/.test(beatBody.get("live") || "") && !audCalls.some((c) => c.method === "GET"),
    "a visitor's page sends a heartbeat (its browser's random id, and whether the room is sounding) and asks nothing else (" + JSON.stringify(audCalls) + ")");
  check(visitorAud.rows.join("|") === "United States=3|Germany=2|Somewhere=1|Listening live=1" && visitorAud.flags.slice(0, 2).join("") === "\u{1F1FA}\u{1F1F8}\u{1F1E9}\u{1F1EA}" &&
    visitorAud.heads.join("|") === "On the radio 6|Guests 3" && !visitorAud.note &&
    visitorAud.pressable === 0 && / · 6 on the radio/.test(visitorAud.pulse),
    "a visitor's list shows the radio's listeners merged by country with flags (and those it can't place), then the guests with how many listen live, and the room pulse counts the radio (" + JSON.stringify(visitorAud) + ")");
  // the page closing (or its visitor signing in) says goodbye at once, rather than after two minutes
  const goodbye = await aPage.evaluate(() => {
    let sent = null;
    navigator.sendBeacon = (url, body) => { sent = { url: String(url), body: String(body) }; return true; };
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    return sent;
  });
  check(!!goodbye && /api\/audience\.php$/.test(goodbye.url) && new URLSearchParams(goodbye.body).get("leave") === "1" && new URLSearchParams(goodbye.body).get("id") === beatBody.get("id"),
    "leaving the page sends a goodbye for the same id (" + JSON.stringify(goodbye) + ")");
  // a member's people list: the header counts everyone, then members, guests and the radio; the countries sit under the members
  // (the header and section a member sees, kept up to date while a visitor's page sets them aside)
  const memberAud = await aPage.evaluate((data) => {
    firetable.audience.take(JSON.parse(JSON.stringify(data)));
    const byId = (id) => document.getElementById(id) || (firetable.$appShell && firetable.$appShell.find("#" + id)[0]);
    const stats = byId("usersStats"), box = byId("pe-audience");
    const members = Object.keys(ftapi.users || {}).filter((u) => ftapi.users[u] && !ftapi.users[u].hostbot).length;
    const tip = (id) => byId(id).closest(".listenerType").getAttribute("aria-label");
    return { on: stats.classList.contains("is-on"), members, total: byId("numListeners").textContent,
      room: byId("numRoomListeners").textContent, guests: byId("pe-numGuests").textContent,
      radio: byId("numStreamListeners").textContent, tips: [tip("numRoomListeners"), tip("pe-numGuests"), tip("numStreamListeners")],
      hidden: box.hidden, rows: [...box.querySelectorAll(".pe-audRow")].map((r) => r.querySelector(".pe-audName").textContent + "=" + r.querySelector(".pe-audN").textContent) };
  }, AUDIENCE);
  check(memberAud.on && memberAud.total === String(memberAud.members + 3 + 6) && memberAud.room === String(memberAud.members) && memberAud.guests === "3" && memberAud.radio === "6" &&
    /in the room$/.test(memberAud.tips[0]) && memberAud.tips[1] === "3 guests without an account, 1 listening live" && memberAud.tips[2] === "6 people listening on the radio" &&
    !memberAud.hidden && memberAud.rows.join("|") === "United States=3|Germany=2|Somewhere=1|Listening live=1",
    "a member's people list counts everyone with the room (members, guests, radio, each named for screen readers) and lists the radio by country under the members (" + JSON.stringify(memberAud) + ")");
  await aContext.close();

  // a chart on a phone: the name keeps the row's width, the numbers sit under the artist, plays and all
  const cPage = await context.newPage();
  await cPage.setViewportSize({ width: 390, height: 844 });
  await openPage(cPage, SITE + "#discover/charts");
  const phoneChart = await cPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && !document.querySelector("#dBrowse .d-rowlist .pvbar"); i++) await wait(100);
    const row = document.querySelector("#dBrowse .d-rowlist .pvbar");
    const title = row.querySelector(".hist-track-title"), right = row.querySelector(".d-right"), plays = right.querySelector(".d-num:last-child");
    title.textContent = "Together feat. Nikki Nair, Jessy Lanza, Prentiss and a great many more besides";
    const t = title.getBoundingClientRect(), a = row.querySelector(".hist-track-artist").getBoundingClientRect(), r = right.getBoundingClientRect();
    const acts = [...document.querySelectorAll("#dBrowse .d-chartacts > button")].map((b) => Math.round(b.getBoundingClientRect().top));
    return { plays: plays.textContent, shown: plays.offsetParent !== null && plays.getBoundingClientRect().width > 0, lines: Math.round(t.height / parseFloat(getComputedStyle(title).lineHeight)),
      words: Math.round(t.width), under: r.top >= a.bottom - 1, row: Math.round(row.getBoundingClientRect().height), oneRow: new Set(acts).size === 1 && acts.length === 3,
      share: document.querySelector("#dBrowse .d-share").getAttribute("aria-label"), wide: document.documentElement.scrollWidth - innerWidth };
  });
  check(phoneChart.shown && /play/.test(phoneChart.plays) && phoneChart.lines <= 2 && phoneChart.words >= 120 && phoneChart.under && phoneChart.row <= 110 && phoneChart.oneRow && /Share/.test(phoneChart.share) && phoneChart.wide <= 0,
    "a chart row on a phone: plays shown under the artist, a long title in two lines, Play / Save / Share on one row (" + JSON.stringify(phoneChart) + ")");
  // a phone on its side (844×390): the switch sits in the header's row, and the visitor's stage clears the bar under it
  const lPage = await context.newPage();
  await lPage.setViewportSize({ width: 844, height: 390 });
  await openPage(lPage, SITE + "#live");
  await lPage.waitForFunction(() => document.querySelector("#deck .djplaque, #deck .djname") && document.getElementById("modeTabs"), null, { timeout: 30000 }).catch(() => {});
  await sleep(1200);
  const side = await lPage.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
    const head = r("#topbar"), mode = r("#modeTabs"), stage = r("#djStage"), bar = r("#themebox"), player = r("#dMini");
    const out = { head: Math.round(head.height), inRow: mode.top >= head.top && mode.bottom <= head.bottom && mode.height < head.height, clear: Math.round(bar.top - stage.bottom), player: Math.round(player.height), wide: document.documentElement.scrollWidth - innerWidth };
    location.hash = "#discover";
    return out;
  });
  await sleep(800);
  side.page = await lPage.evaluate(() => Math.round(document.getElementById("dBrowse").getBoundingClientRect().height));
  check(side.head <= 64 && side.inRow && side.clear >= 0 && side.player <= 56 && side.page >= 150 && side.wide <= 0,
    "a phone on its side: the Discover | Live switch is in the header's row, the stage ends above the bar under it, the player bar is slim, Discover's page has 150px or more (" + JSON.stringify(side) + ")");
  await lPage.close();

  // touch screens: a row's icons and the play button on its small cover have the invisible tap area
  const tContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tPage = await tContext.newPage();
  await openPage(tPage, SITE + "#discover/charts");
  const taps = await tPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && !document.querySelector("#dBrowse .d-rowlist .pvbar"); i++) await wait(100);
    const area = (sel) => {
      const el = document.querySelector(sel), b = getComputedStyle(el, "::before"), r = el.getBoundingClientRect();
      if (b.content === "none" || b.position !== "absolute") return null;
      return [Math.round(r.width - parseFloat(b.left) - parseFloat(b.right)), Math.round(r.height - parseFloat(b.top) - parseFloat(b.bottom))];
    };
    // a tap area hangs from its own control: one on a control that isn't positioned would hang
    // from a far ancestor and cover other things (it covered Join, from the lead card's icons)
    const loose = () => [...new Set([...document.querySelectorAll("button, a, [role=button]")].filter((el) => {
      if (!el.getClientRects().length || getComputedStyle(el).position !== "static") return false;
      return ["::before", "::after"].some((p) => { const s = getComputedStyle(el, p); return s.content !== "none" && s.position === "absolute"; });
    }).map((el) => el.id || el.className))];
    const out = { coarse: matchMedia("(pointer: coarse)").matches, more: area("#dBrowse .d-rowlist .row-icon.d-more"), play: area("#dBrowse .d-rowlist .previewicon"), loose: loose() };
    location.hash = "#discover";
    for (let i = 0; i < 50 && !document.querySelector("#dBrowse .d-leadacts .row-icon"); i++) await wait(100);
    out.loose = out.loose.concat(loose());
    const join = document.getElementById("nav-signin"), r = join.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out.joinOnTop = !!top && (top === join || join.contains(top));
    return out;
  });
  check(taps.coarse && taps.more && taps.more[0] >= 40 && taps.more[1] >= 44 && taps.play && taps.play[0] >= 40 && taps.play[1] >= 40,
    "on a touch screen a row's ⋮ can be tapped over 40×44px and its play button over the whole cover, at the size they were (" + JSON.stringify(taps) + ")");
  check(!taps.loose.length && taps.joinOnTop, "no tap area hangs loose from a control that isn't positioned, on Charts or Home, and nothing covers Join (" + JSON.stringify({ loose: taps.loose, join: taps.joinOnTop }) + ")");
  await tContext.close();
  await cPage.close();

  // chatting on a phone with the keyboard up: the stage and the bottom tabs step aside, and come back
  const kPage = await context.newPage();
  await kPage.setViewportSize({ width: 390, height: 844 });
  await openPage(kPage, SITE + "#live");
  await kPage.waitForFunction(() => window.firetable && firetable.nav && document.getElementById("nav-tabs") && firetable.$appShell !== undefined, null, { timeout: 30000 });
  const kb = async (h) => {
    await kPage.setViewportSize({ width: 390, height: h });
    await sleep(350);
    return kPage.evaluate(() => {
      const s = document.getElementById("stage").getBoundingClientRect(), c = document.getElementById("chatsWrap").getBoundingClientRect();
      return { on: document.body.classList.contains("kb-chat"), stage: s.right > 0 && s.height > 0, tabs: getComputedStyle(document.getElementById("nav-tabs")).display !== "none", chat: Math.round(c.height), focus: document.activeElement.id };
    });
  };
  // as a member, in Live's chat (this page is a visitor's: the room's panels in)
  await kPage.evaluate(() => {
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login pre-auth");
    firetable.nav.setMobileTab("mmchat");
    document.getElementById("newchat").focus();
  });
  const typing = { tall: await kb(844), up: await kb(500), down: await kb(844) };
  await kPage.evaluate(() => document.getElementById("newchat").blur());
  await sleep(300);
  typing.blurUp = await kb(500);
  await kPage.setViewportSize({ width: 390, height: 844 });
  check(!typing.tall.on && typing.tall.stage && typing.up.on && !typing.up.stage && !typing.up.tabs && typing.up.chat >= 200 && typing.up.focus === "newchat" &&
    !typing.down.on && typing.down.stage && typing.down.tabs && !typing.blurUp.on && typing.blurUp.stage,
    "a phone's keyboard up while chatting: the stage and the tab bar step aside and the chat keeps its room; back with the keyboard down or the box left (" + JSON.stringify(typing) + ")");


  // the same in the Turntable theme, whose room has a row of its own in the page's grid
  await kPage.evaluate(async () => {
    if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
    $("#mainGrid").removeClass("login pre-auth");
    firetable.tt.enter();
    for (let i = 0; i < 80 && !(document.body.classList.contains("tt-skin") && document.querySelector('#tt-tabs [data-tab="chat"]')); i++) await new Promise((r) => setTimeout(r, 100));
    // the first time in, the theme asks for an avatar: not what this is about
    await new Promise((r) => setTimeout(r, 400));
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    document.querySelector('#tt-tabs [data-tab="chat"]').click();
    for (let i = 0; i < 30 && document.activeElement.id !== "newchat"; i++) { document.getElementById("newchat").focus(); await new Promise((r) => setTimeout(r, 100)); }
  });
  const ttKb = async (h) => {
    await kPage.setViewportSize({ width: 390, height: h });
    await sleep(350);
    return kPage.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const s = r("stage"), c = r("chatsWrap"), box = r("newchat"), tabs = r("tt-tabs"), scr = r("screenBox");
      return { skin: document.body.classList.contains("tt-skin"), on: document.body.classList.contains("kb-chat"), stage: s.right > 0 && s.height > 0 && s.width > 0, playerSize: Math.round(s.width) + "x" + Math.round(s.height),
        tabsTop: Math.round(tabs.top), chat: Math.round(c.height), boxInView: box.top >= 0 && box.bottom <= innerHeight, bottomTabs: getComputedStyle(document.getElementById("nav-tabs")).display !== "none", focus: document.activeElement.id,
        screen: [scr.left, scr.top, scr.width, scr.height].map(Math.round).join() };
    });
  };
  const ttTyping = { tall: await ttKb(844), up: await ttKb(500), down: await ttKb(844) };
  await kPage.evaluate(() => { document.getElementById("newchat").blur(); firetable.tt.leave(); }); // the theme is kept per device: out again for the pages after this
  check(ttTyping.tall.skin && !ttTyping.tall.on && ttTyping.tall.stage && ttTyping.up.on && !ttTyping.up.stage && ttTyping.up.playerSize === "640x360" && ttTyping.up.tabsTop <= 48 &&
    ttTyping.up.chat >= 200 && ttTyping.up.boxInView && !ttTyping.up.bottomTabs && !ttTyping.down.on && ttTyping.down.stage && ttTyping.down.screen === ttTyping.tall.screen,
    "the Turntable theme too: keyboard up while chatting, the room steps out of sight at a size its player keeps, its row closes and the chat has the screen; keyboard down, the room and its video are back where they were (" + JSON.stringify(ttTyping) + ")");
  await kPage.close();

  // skip links: the first Tab stop, even on Discover Home, whose address is also the Fresh panel's id
  const sPage = await context.newPage();
  const skipState = () => sPage.evaluate(() => {
    const nav = document.getElementById("nav-skip"), a = document.activeElement;
    return { at: a && a.closest("#nav-skip") ? a.getAttribute("data-skip") : (a && a.id) || "", inView: nav.getBoundingClientRect().top >= 0,
      shown: [...nav.querySelectorAll("[data-skip]")].filter((b) => b.offsetParent !== null).map((b) => b.getAttribute("data-skip")).join() };
  });
  // a visitor on Discover Home, whose address (#discover) is also the Fresh panel's id
  await openPage(sPage, SITE + "#discover");
  await sPage.waitForFunction(() => document.querySelectorAll("#dBrowse .ft-cards .pvbar").length > 0, null, { timeout: 30000 });
  await sleep(1300);
  const skip = { rest: await skipState() };
  await sPage.keyboard.press("Tab");
  await sleep(250);
  skip.tab1 = await skipState();
  await sPage.keyboard.press("Enter");
  await sleep(200);
  skip.page = await sPage.evaluate(() => document.activeElement.id);
  await sPage.evaluate(() => document.querySelector('#nav-skip [data-skip="player"]').focus());
  await sPage.keyboard.press("Enter");
  await sleep(200);
  skip.player = await sPage.evaluate(() => !!document.activeElement.closest("#dMini"));
  skip.after = await skipState();
  check(!skip.rest.inView && skip.tab1.at === "page" && skip.tab1.inView && skip.tab1.shown === "page,player" && skip.page === "dBrowse" && skip.player && !skip.after.inView,
    "the first Tab on Discover Home is Skip to the page (the chat box and the playlist aren't offered to a visitor); it and Skip to the player go there, and the links hide again (" + JSON.stringify(skip) + ")");
  // one Tab stop per song: a card was five or six (play, title, artist, ⋮, Add, the DJ)
  const at = () => sPage.evaluate(() => { const a = document.activeElement, bar = a.closest && a.closest("#dBrowse .pvbar[data-list]");
    return (bar ? bar.getAttribute("data-list") + "/" + bar.getAttribute("data-i") + ":" : "") + (a.classList.contains("d-play") ? "play" : a.classList.contains("d-sheetlink") ? "title" : a.classList.contains("d-alink") ? "artist" :
      a.classList.contains("d-more") ? "more" : a.classList.contains("histeal") ? "add" : a.classList.contains("d-djlink") ? "dj" : a.classList.contains("butt") ? "list" : a.tagName); });
  await sPage.evaluate(() => document.querySelector("#dBrowse .ft-cards .pvbar .d-play").focus());
  const one = { from: await at(), name: await sPage.evaluate(() => document.activeElement.getAttribute("aria-label")), tabs: [], arrows: [] };
  for (let i = 0; i < 2; i++) { await sPage.keyboard.press("Tab"); one.tabs.push(await at()); }
  await sPage.evaluate(() => document.querySelector("#dBrowse .ft-cards .pvbar .d-play").focus());
  for (let i = 0; i < 4; i++) { await sPage.keyboard.press("ArrowRight"); one.arrows.push((await at()).split(":")[1]); }
  await sPage.keyboard.press("ContextMenu");
  await sleep(250);
  one.menu = await sPage.evaluate(() => { const m = document.getElementById("dMenu"); return !!m && !m.hidden && m.contains(document.activeElement); });
  await sPage.keyboard.press("Escape");
  await sleep(150);
  one.back = (await at()).split(":")[1];
  one.ring = await sPage.evaluate(() => { const b = document.querySelector("#dBrowse .ft-cards .pvbar .d-play"); b.focus(); return true; }) && await (async () => {
    await sPage.keyboard.press("Tab"); await sPage.keyboard.press("Shift+Tab");
    return sPage.evaluate(() => getComputedStyle(document.activeElement.closest(".pvbar")).outlineStyle); })();
  const songOf = (t) => t.split(":")[0];
  check(/^Play \S.* by \S/.test(one.name) && one.tabs.every((t) => /:play$/.test(t)) && new Set([one.from].concat(one.tabs).map(songOf)).size === 3,
    "Discover: Tab goes from song to song, one stop each, and the stop names its song (" + JSON.stringify([one.from, one.name, one.tabs]) + ")");
  check(one.arrows.slice(0, 2).join() === "title,artist" && one.arrows.indexOf("more") !== -1 && one.menu && one.back === "more" && one.ring === "solid",
    "Discover: ← and → reach a song's title, artist, ⋮ and Add, the menu key opens ⋮, and the ring goes round the whole song (" + JSON.stringify(one) + ")");
  await sPage.close();

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
    document.querySelector('#dSide [data-sidetab="list"]').click();
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

  console.log("-- Discover: members play a song in the room, and manage the playlist beside the player");
  await put("/queues/smoke", { "-a1": { type: 1, cid: "plA000001", name: "Ay - One" }, "-a2": { type: 1, cid: "plB000002", name: "Bee - Two" }, "-a3": { type: 1, cid: "plC000003", name: "Cee - Three" } });
  const member = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await wait(100); return fn(); };
    const out = {};
    const skip = firetable.discover.onFailed;
    firetable.discover.onFailed = () => {};
    location.hash = "#discover";
    await wait(300);
    // as signing in does: the list on screen, bound live
    ftapi.queueRef = ftapi.lookup.listRef("0");
    ftapi.queueBind = ftapi.queueRef.on("value", (snap) => { ftapi.queue = snap.val() || {}; ftapi.events.emit("playlistChanged", ftapi.queue, "0"); });
    document.querySelector('#dSide [data-sidetab="list"]').click();
    await until(() => document.querySelectorAll("#pv-plrows > li").length === 3);
    const titles = () => [...document.querySelectorAll("#pv-plrows > li .d-mini-text b")].map((b) => b.childNodes[0].textContent.trim()).join();
    out.rows = titles();
    out.next = !!document.querySelector("#pv-plrows > li .pl-next");
    const f = document.getElementById("pv-plfilter");
    f.value = "bee";
    f.dispatchEvent(new Event("input", { bubbles: true }));
    out.filtered = [...document.querySelectorAll("#pv-plrows > li")].filter((li) => !li.hidden).length;
    out.sortOff = document.getElementById("pv-plrows").classList.contains("is-sort-off");
    f.value = "";
    f.dispatchEvent(new Event("input", { bubbles: true }));
    out.sortOn = !document.getElementById("pv-plrows").classList.contains("is-sort-off");
    document.querySelectorAll("#pv-plrows > li")[2].querySelector(".pl-top").click();
    await until(() => titles().startsWith("Three"));
    out.topped = titles();
    // drag the first row's grip below the last row
    const rowsNow = () => [...document.querySelectorAll("#pv-plrows > li")];
    const grip = rowsNow()[0].querySelector(".pl-grip");
    const g = grip.getBoundingClientRect(), last = rowsNow()[2].getBoundingClientRect();
    const pe = (type, y, target) => (target || document).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, button: 0, pointerType: "mouse", clientX: g.x + g.width / 2, clientY: y }));
    pe("pointerdown", g.y + g.height / 2, grip);
    for (let i = 1; i <= 6; i++) pe("pointermove", g.y + g.height / 2 + (last.bottom - 4 - g.y - g.height / 2) * i / 6);
    pe("pointerup", last.bottom - 4);
    await wait(500); // the saved order comes back from the database and the list is drawn again
    out.dragged = titles();
    document.querySelectorAll("#pv-plrows > li")[0].querySelector(".d-mini-row").click();
    await wait(200);
    out.playingRow = !!document.querySelector("#pv-plrows > li.is-playing") && /Your|Default/.test(document.getElementById("pv-src").textContent);
    // a Discover song, to the top of the DJ playlist
    location.hash = "#discover/new";
    await wait(300);
    document.querySelector("#dBrowse .pvbar .d-play").click();
    await wait(200);
    document.querySelector("#dMini .pb-toroom").click();
    await until(() => Object.values(ftapi.queue || {}).some((t) => t.cid === firetable.discover.state().playing));
    const keys = Object.keys(ftapi.queue).sort(ftapi.utilities.compareKeys);
    out.first = ftapi.queue[keys[0]].cid === firetable.discover.state().playing && ftapi.queue[keys[0]].from === "discover";
    out.done = await until(() => document.querySelector("#dMini .pb-toroom.is-done"));
    out.done = !!out.done;
    firetable.discover.openFull();
    await wait(100);
    out.note = (document.getElementById("pv-toRoomNote") || {}).textContent;
    document.querySelector("#pv-full .d-toroom-undo").click();
    await until(() => !Object.values(ftapi.queue || {}).some((t) => t.cid === firetable.discover.state().playing));
    out.undone = Object.keys(ftapi.queue).length === 3;
    firetable.discover.closeFull();
    await wait(500);
    // a member listening in has the stage's Fire in the bar
    document.querySelector("#pv-switch .d-listen").click();
    await wait(200);
    out.fire = document.getElementById("fire").closest("#dMini") && document.getElementById("fire").offsetParent !== null;
    firetable.discover.onFailed = skip;
    document.querySelector('#modeTabs [data-mode="live"]').click();
    await wait(200);
    return out;
  });
  check(member.rows === "One,Two,Three" && member.next && member.filtered === 1, "the Playlists tab lists the DJ playlist with Next, and filters it (" + JSON.stringify(member) + ")");
  check(member.topped === "Three,One,Two" && member.playingRow, "Top moves a song up; a row plays in the bar, marked in the list (" + JSON.stringify(member) + ")");
  check(member.dragged === "One,Two,Three" && member.sortOff && member.sortOn, "a row's grip drags it and the order is saved; no dragging while filtered (" + JSON.stringify({ dragged: member.dragged, sortOff: member.sortOff, sortOn: member.sortOn }) + ")");
  check(member.first && member.done && /First in/.test(member.note || "") && member.undone && member.fire,
    "Play it in the room puts the song first in the DJ playlist, says so, and Undo takes it out; listening in, Fire is in the bar (" + JSON.stringify(member) + ")");

  console.log("-- The full-screen player for members: the stage's buttons, and nothing beside the song");
  const fullMember = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = document.getElementById("pv-full");
    const home = document.getElementById("actualChat").parentElement;
    const out = {};
    location.hash = "#live";
    await wait(300);
    document.getElementById("fullscreenBtn").click();
    await wait(500);
    out.cls = el.className;
    out.fire = !!document.getElementById("fire").closest("#pv-fstage") && document.getElementById("fire").offsetParent !== null;
    out.grab = !!document.getElementById("grab").closest("#pv-fstage");
    out.noSide = !el.querySelector("#pv-fside, #pv-ftabs, [data-ftab], .d-decks, .d-joinwait");
    out.chatHome = document.getElementById("actualChat").parentElement === home && !el.contains(document.getElementById("actualChat"));
    const st = firetable.discover.state();
    out.noState = !("fullChat" in st) && !("fullTab" in st);
    // the artwork beside the words on a wide screen, as tall as the space allows
    // (layout sizes: the cover is still growing out of the bar)
    const artEl = el.querySelector(".pvf-art"), art = artEl.getBoundingClientRect(), text = el.querySelector(".pvf-text").getBoundingClientRect(), body = el.querySelector(".pvf-body").getBoundingClientRect();
    out.layout = { beside: text.left >= art.left + artEl.offsetWidth, tall: artEl.offsetHeight > body.height * 0.75, square: Math.abs(artEl.offsetWidth - artEl.offsetHeight) < 2 };
    // the time row: the bar on the cover's edges, the times under its two ends, play under its middle
    const bar = el.querySelector(".pvf-track .d-bar").getBoundingClientRect(), main = el.querySelector(".pvf-main").getBoundingClientRect();
    const ink = (id) => { const r = document.createRange(); r.selectNodeContents(document.getElementById(id)); return r.getBoundingClientRect(); };
    const at = ink("pv-fat"), len = ink("pv-flen");
    out.time = { barLeft: Math.round(bar.left - art.left), barRight: Math.round(innerWidth - bar.right - art.left), atStart: Math.round(at.left - bar.left), lenEnd: Math.round(bar.right - len.right),
      below: at.top >= bar.bottom && len.top >= bar.bottom, playCentred: Math.round((main.left + main.right) / 2 - (bar.left + bar.right) / 2) };
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(600);
    out.closed = el.hidden && document.getElementById("fire").parentElement.id === "pv-livekeep";
    return out;
  });
  check(/is-member/.test(fullMember.cls) && fullMember.fire && fullMember.grab, "a member has the stage's Fire and Grab in the full-screen player (" + JSON.stringify(fullMember) + ")");
  check(fullMember.noSide && fullMember.chatHome && fullMember.noState && fullMember.closed,
    "no DJs or Chat beside the song (a listening view): the chat stays in its place; Escape closes it and the buttons go home");
  check(Math.abs(fullMember.time.barLeft) <= 1 && Math.abs(fullMember.time.barRight) <= 1 && Math.abs(fullMember.time.atStart) <= 1 && Math.abs(fullMember.time.lenEnd) <= 1 && fullMember.time.below && Math.abs(fullMember.time.playCentred) <= 1,
    "the time row is symmetric: the bar on the cover's edges, each time under its end, play under the bar's middle (" + JSON.stringify(fullMember.time) + ")");
  check(fullMember.layout.beside && fullMember.layout.tall && fullMember.layout.square,
    "the artwork stands beside the words, square, filling the height the player has (" + JSON.stringify(fullMember.layout) + ")");

  console.log("-- Your account: the avatar's menu, Profile · Account · Settings, and log out");
  const acct = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    const btn = document.getElementById("loggedInUser");
    const menu = document.getElementById("nav-accountMenu");
    out.signinHidden = document.getElementById("nav-signin").offsetParent === null;
    btn.click();
    await wait(250);
    out.menuOpen = menu.matches(":popover-open");
    out.expanded = btn.getAttribute("aria-expanded");
    const label = (el) => el && el.lastChild ? el.lastChild.textContent.trim() : "";
    out.items = [...menu.querySelectorAll('[role="menuitem"]')].filter((b) => !b.hidden).map(label).join("|");
    out.focused = label(document.activeElement);
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    out.arrow = label(document.activeElement);
    menu.querySelector('[data-acct="account-tab"]').click();
    await wait(100);
    const dlg = document.getElementById("accountSettingsBox");
    out.dialog = dlg.open;
    out.menuClosed = !menu.matches(":popover-open");
    out.tab = document.querySelector("#accountSettingsTabs .tab.on").textContent + "|" + document.getElementById("account-tab").classList.contains("active");
    out.logout = !!document.querySelector("#account-tab #logOutButton");
    // an empty password change is caught before it goes anywhere
    document.getElementById("ac-savePass").click();
    out.passMsg = document.querySelector("#ac-passForm .formMessage").textContent;
    document.getElementById("ac-curPass").value = "oldpass1";
    document.getElementById("ac-newPass").value = "abc";
    document.getElementById("ac-savePass").click();
    out.shortPass = document.getElementById("ac-newPassNote").getAttribute("data-state");
    document.getElementById("ac-curPass").value = "";
    document.getElementById("ac-newPass").value = "";
    // arrow keys move between the tabs
    const t = document.querySelector('#accountSettingsTabs [data-tab="account-tab"]');
    t.focus();
    t.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    out.nextTab = document.querySelector("#accountSettingsTabs .tab.on").getAttribute("data-tab");
    // a username change with nothing typed says so
    document.querySelector('#accountSettingsTabs [data-tab="profile-tab"]').click();
    document.getElementById("ac-saveName").click();
    out.nameMsg = document.getElementById("usernameResponse").getAttribute("data-state") + ":" + document.getElementById("usernameResponse").textContent;
    dlg.close();
    return out;
  });
  check(acct.signinHidden && acct.menuOpen && acct.expanded === "true" && acct.items === "Profile|Account and sign-in|Settings|Shortcuts and commands|Get the app|Log out" && acct.focused === "Profile" && acct.arrow === "Account and sign-in",
    "the header avatar opens the account menu, with the keyboard (" + JSON.stringify(acct) + ")");
  check(acct.dialog && acct.menuClosed && acct.tab === "Account|true" && acct.logout, "Account and sign-in opens the Account tab, with Log out (" + acct.tab + ")");
  check(/current password/.test(acct.passMsg) && acct.shortPass === "bad", "changing the password checks what's typed first (" + acct.passMsg + " / " + acct.shortPass + ")");
  check(acct.nextTab === "settings-tab" && /^bad:/.test(acct.nameMsg), "the tabs follow the arrow keys; an empty name change says so (" + acct.nextTab + " / " + acct.nameMsg + ")");

  console.log("-- Light mode: the header's sun and moon, the account menu, Settings, L and /light; the stage stays dark");
  const look = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.documentElement;
    const bg = (el) => getComputedStyle(el).backgroundColor;
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000; };
    const out = { start: root.getAttribute("data-look"), pref: ftLook.pref() };
    const head = document.getElementById("nav-look");
    head.click();
    await wait(150);
    out.on = root.getAttribute("data-look");
    out.pressed = head.getAttribute("aria-pressed");
    out.icon = [...head.querySelectorAll("i")].filter((i) => i.offsetParent !== null).map((i) => i.textContent).join("|");
    out.scheme = document.querySelector('meta[name="color-scheme"]').content;
    out.stored = localStorage.getItem("firetableLook");
    out.bar = document.querySelector('meta[name="theme-color"]').content;
    out.page = lum(bg(document.body));
    out.dialogBg = lum(getComputedStyle(document.getElementById("accountSettingsBox").querySelector(".modalBox")).backgroundColor);
    // the stage and the full-screen player keep the dark palette
    out.stage = lum(getComputedStyle(document.getElementById("stage")).getPropertyValue("--color-bg").trim().replace(/^#(..)(..)(..)$/, (m, a, b, c) => "rgb(" + parseInt(a, 16) + "," + parseInt(b, 16) + "," + parseInt(c, 16) + ")"));
    out.item = document.getElementById("nav-acctLook").getAttribute("aria-checked");
    out.picker = document.getElementById("lookPicker").value;
    // Settings' picker: match the device
    const pick = document.getElementById("lookPicker");
    pick.value = "auto";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(100);
    out.auto = ftLook.pref() + ":" + localStorage.getItem("firetableLook");
    // L, from anywhere but a text box
    ftLook.set("light");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    await wait(100);
    out.keyOff = root.getAttribute("data-look") + ":" + ftLook.pref() + ":" + localStorage.getItem("firetableLook");
    // the account menu's switch keeps the menu open
    document.getElementById("loggedInUser").click();
    await wait(200);
    document.getElementById("nav-acctLook").click();
    await wait(100);
    out.menuStays = document.getElementById("nav-accountMenu").matches(":popover-open") + ":" + root.getAttribute("data-look");
    document.getElementById("nav-accountMenu").hidePopover();
    // /light and /dark in chat: said only here, never sent
    const box = document.getElementById("newchat");
    const said = () => [...document.querySelectorAll("#chats .lcrsp")].map((x) => x.textContent).pop() || "";
    box.value = "/dark";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(100);
    out.slashDark = root.getAttribute("data-look") + ":" + /off/.test(said()) + ":" + box.value;
    box.value = "/light";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(100);
    out.slashLight = root.getAttribute("data-look") + ":" + /on/.test(said());
    ftLook.set("dark");
    await wait(100);
    out.back = root.getAttribute("data-look") + ":" + localStorage.getItem("firetableLook") + ":" + document.querySelector('meta[name="theme-color"]').content;
    return out;
  });
  check(look.start === null && look.pref === "dark" && look.on === "light" && look.pressed === "true" && look.icon === "dark_mode" && look.scheme === "light" && look.stored === "light" && look.bar === "#f1eee8",
    "the header's sun turns light mode on, says so, and keeps it on this device (" + JSON.stringify(look) + ")");
  check(look.page > 200 && look.dialogBg > 200 && look.stage < 40, "light mode lights the page and the dialogs; the stage keeps its dark (" + look.page + " / " + look.dialogBg + " / " + look.stage + ")");
  check(look.item === "true" && look.picker === "light" && look.auto === "auto:auto", "the account menu's switch and Settings' Look follow it; Match this device is kept (" + look.item + " / " + look.picker + " / " + look.auto + ")");
  check(look.keyOff === "null:dark:null" && look.menuStays === "true:light" && look.back === "null:null:#181818",
    "L turns it off, the menu's switch turns it on with the menu still open, and dark is the default again (" + look.keyOff + " / " + look.menuStays + " / " + look.back + ")");
  check(look.slashDark === "null:true:" && look.slashLight === "light:true", "/dark and /light in chat switch it and say so, only here (" + look.slashDark + " / " + look.slashLight + ")");

  console.log("-- Everyone's avatar style: a supermod picks one for the whole room");
  const avatars = async () => dPage.evaluate(() => ({
    style: firetable.roomAvatarStyle,
    menu: document.getElementById("mo-avatarStyle").value,
    options: document.getElementById("mo-avatarStyle").options.length,
    // the DJ on the stage and the first person in the list (the header's is a placeholder in this pretend sign-in)
    stage: (document.querySelector("#deck .avtr") || { style: {} }).style.backgroundImage || "",
    people: ((document.querySelector("#allUsers .ft-avatar") || { style: {} }).style.backgroundImage || ""),
    picker: !document.getElementById("avatarPickerSection").hidden
  }));
  const avDefault = await avatars();
  await put("/roomSettings", { avatarStyle: "robohash:set4" });
  await dPage.waitForFunction(() => firetable.roomAvatarStyle === "robohash:set4", null, { timeout: 5000 }).catch(() => {});
  await sleep(300);
  const avCats = await avatars();
  await put("/roomSettings", null);
  await dPage.waitForFunction((d) => firetable.roomAvatarStyle === d, avDefault.style, { timeout: 5000 }).catch(() => {});
  const avBack = await avatars();
  check(avDefault.menu === "" && avDefault.options === 7 && !avDefault.picker, "Mod tools offers the room's default and the six styles; members have no picker of their own (" + JSON.stringify(avDefault) + ")");
  check(avCats.style === "robohash:set4" && avCats.menu === "robohash:set4" && /set=set4/.test(avCats.stage) && (!avCats.people || /set=set4/.test(avCats.people)) && !/set=set4/.test(avDefault.stage),
    "a supermod's choice dresses everyone at once: the stage and the people redrawn (" + JSON.stringify({ before: avDefault.stage.slice(-40), after: avCats.stage.slice(-40), people: avCats.people.slice(-40) }) + ")");
  check(avBack.style === avDefault.style && avBack.menu === "", "clearing it goes back to the room's default (" + avBack.style + ")");

  console.log("-- Bouletmaton: members build their own and switch it on; robot busts for everyone else; monsters in October");
  const bmWas = await dPage.evaluate(() => ({ uid: ftapi.uid, mine: firetable.myBoulet, on: firetable.myBouletOn }));
  await dPage.evaluate(() => {
    ftapi.uid = "bmfan";
    firetable.myBoulet = null; // signed in, none built
    firetable.myBouletOn = false;
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  });
  await put("/roomSettings", { avatarStyle: "bouletmaton" });
  await dPage.waitForFunction(() => document.getElementById("bm-builderBox").open, null, { timeout: 10000 }).catch(() => {});
  const bmOpen = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(800);
    const box = document.getElementById("bm-builderBox");
    const c = document.getElementById("bm-preview");
    const g = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let drawn = 0;
    for (let i = 3; i < g.length; i += 4) if (g[i]) drawn++;
    const values = () => [...document.querySelectorAll("#bm-parts select")].map((x) => x.value);
    const start = values();
    const colours = ["#bm-skins", "#bm-hairs", "#bm-beards"].map((id) => (document.querySelector(id + " input:checked") || {}).value).join(",");
    document.querySelector('#bm-parts .bm-step[data-part="hat"][data-step="1"]').click();
    document.querySelector('#bm-beards input[value="7"]').click();
    await wait(300);
    return {
      open: box.open, intro: document.getElementById("bm-intro").textContent, drawn: drawn / (c.width * c.height),
      rows: [...document.querySelectorAll("#bm-parts label")].map((l) => l.textContent).join(","),
      skins: document.querySelectorAll("#bm-skins input").length, hairs: document.querySelectorAll("#bm-hairs input").length,
      beards: document.querySelectorAll("#bm-beards input").length, steps: document.querySelectorAll("#bm-parts .bm-step").length,
      noBackground: !/background/i.test(box.textContent), noRandom: !document.getElementById("bm-random") && !/surprise/i.test(box.textContent),
      atOne: start.every((v) => v === "1") && colours === "1,1,1", use: document.getElementById("bm-use").checked,
      changed: values().join() !== start.join(), mini: document.getElementById("bm-miniCircle").style.backgroundImage
    };
  });
  check(bmOpen.open && /Bouletmatons now/.test(bmOpen.intro) && bmOpen.drawn > 0.1 && bmOpen.atOne && bmOpen.noRandom,
    "with the room on Bouletmaton, a member without one gets the builder, every choice at 1, nothing made up (" + JSON.stringify({ open: bmOpen.open, drawn: bmOpen.drawn, atOne: bmOpen.atOne, noRandom: bmOpen.noRandom }) + ")");
  check(bmOpen.rows === "Head,Body,Hair,Mouth,Eyes,Eyebrows,Nose,Beard,Ears,Chin,Face details,Neckwear,Glasses,Earrings,In hand,Hat" &&
    bmOpen.skins === 4 && bmOpen.hairs === 12 && bmOpen.beards === 12 && bmOpen.steps === 32 && bmOpen.noBackground && bmOpen.changed && bmOpen.use && /blob:/.test(bmOpen.mini),
    "every part, skin tone, hair and beard colour can be changed, and there's no background option (" + JSON.stringify(bmOpen) + ")");
  const bmSaved = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const code = Bouletmaton.encode({ skin: 1, hair: 1, beard: 7,
      parts: Object.fromEntries([...document.querySelectorAll("#bm-parts select")].map((x) => [x.getAttribute("data-part"), Number(x.value)])) });
    document.getElementById("bm-save").click();
    for (let i = 0; i < 50 && document.getElementById("bm-builderBox").open; i++) await wait(100);
    firetable.ui.openAccount("profile-tab");
    await wait(500);
    const out = { code, closed: !document.getElementById("bm-builderBox").open, mine: firetable.myBoulet, on: firetable.myBouletOn,
      edit: document.getElementById("ac-bouletEdit").textContent, switchOn: document.getElementById("ac-bouletOn").checked,
      face: document.getElementById("ac-bouletFace").style.backgroundImage };
    document.getElementById("accountSettingsBox").close();
    firetable.ui.promptBoulet(); // built: it doesn't open by itself again
    await wait(200);
    out.again = document.getElementById("bm-builderBox").open;
    return out;
  });
  const stored = await (await fetch(DB + "/users/bmfan.json?ns=" + NS)).json();
  check(bmSaved.closed && bmSaved.mine === bmSaved.code && stored && stored.boulet === bmSaved.code && stored.bouletOn === true && !bmSaved.again,
    "saving keeps it, switched on (users/<uid>/boulet, bouletOn), and the builder doesn't open by itself again (" + JSON.stringify({ stored, code: bmSaved.code, again: bmSaved.again }) + ")");
  check(/Change your Bouletmaton/.test(bmSaved.edit) && bmSaved.switchOn && /blob:|#bm=/.test(bmSaved.face),
    "Profile has your Bouletmaton, to change it or switch it off (" + bmSaved.edit + ")");
  // the DJ on the stage builds one and switches it on; the people without one stay robot busts
  const deckDJ = await dPage.evaluate(() => (document.querySelector("#deck .avtr") || { getAttribute: () => "" }).getAttribute("data-stage-uid"));
  if (deckDJ) await put("/users/" + deckDJ + "/boulet", bmSaved.code), await put("/users/" + deckDJ + "/bouletOn", true);
  const roomLook = () => dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    firetable.utilities.redrawAvatars();
    for (let i = 0; i < 60 && document.querySelector('[style*="#bm="]'); i++) await wait(100);
    await wait(300);
    const stage = document.querySelector("#deck .avtr");
    return { html: document.documentElement.getAttribute("data-avatars"),
      stage: stage ? (stage.classList.contains("bm-face") ? "boulet" : (/set=(set\d)/.exec(stage.style.backgroundImage) || [, stage.style.backgroundImage.slice(0, 40)])[1]) : "",
      people: [...document.querySelectorAll("#allUsers .ft-avatar")].filter((e) => /url\(/.test(e.style.backgroundImage)).map((e) => e.classList.contains("bm-face") ? "boulet" : (/set=(set\d)|9\.x\/([a-z-]+)/.exec(e.style.backgroundImage) || [])[1] || (/9\.x\/([a-z-]+)/.exec(e.style.backgroundImage) || [, "?"])[1]),
      left: document.querySelectorAll('[style*="#bm="]').length };
  });
  await dPage.waitForTimeout(1500);
  const lookBoulet = await roomLook();
  check(lookBoulet.html === "robohash" && (!deckDJ || lookBoulet.stage === "boulet") && lookBoulet.people.every((x) => x === "set1" || x === "boulet") && lookBoulet.left === 0,
    "with the room on Bouletmaton, the DJ with one switched on shows it and everyone else is a robot bust (" + JSON.stringify(lookBoulet) + ")");
  await put("/roomSettings", { avatarStyle: "dicebear:pixel-art" });
  await dPage.waitForFunction(() => firetable.roomAvatarStyle === "dicebear:pixel-art", null, { timeout: 5000 }).catch(() => {});
  const lookPixel = await roomLook();
  check((!deckDJ || lookPixel.stage === "boulet") && lookPixel.html === "pixel-art",
    "with another style picked, a switched-on Bouletmaton stays (" + JSON.stringify(lookPixel) + ")");
  // October: everyone a monster, Bouletmatons too; the pick comes back after
  await dPage.evaluate(() => { firetable.avatarForced = "robohash:set2"; document.documentElement.setAttribute("data-avatars", firetable.utilities.avatarKind()); });
  const lookOctober = await roomLook();
  await dPage.evaluate(() => { firetable.avatarForced = null; document.documentElement.setAttribute("data-avatars", firetable.utilities.avatarKind()); });
  const lookNovember = await roomLook();
  check(lookOctober.stage === "set2" && lookOctober.people.every((x) => x === "set2") && (!deckDJ || lookNovember.stage === "boulet"),
    "in October everyone is a monster bust, Bouletmatons too, and they come back after (" + JSON.stringify({ october: lookOctober, november: lookNovember.stage }) + ")");
  // switched off in Profile: the room's style again
  const bmOff = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    firetable.ui.openAccount("profile-tab");
    await wait(200);
    document.getElementById("ac-bouletOn").click();
    for (let i = 0; i < 50 && firetable.myBouletOn; i++) await wait(100);
    await wait(300);
    const out = { on: firetable.myBouletOn, hint: document.getElementById("ac-bouletHint").textContent };
    document.getElementById("accountSettingsBox").close();
    return out;
  });
  const storedOff = await (await fetch(DB + "/users/bmfan/bouletOn.json?ns=" + NS)).json();
  check(!bmOff.on && storedOff === false && /Off/.test(bmOff.hint), "a member switches theirs off any time (" + JSON.stringify({ storedOff, hint: bmOff.hint }) + ")");
  await put("/roomSettings", null);
  await put("/users/bmfan", null);
  if (deckDJ) await put("/users/" + deckDJ + "/boulet", null), await put("/users/" + deckDJ + "/bouletOn", null);
  await dPage.evaluate((w) => { ftapi.uid = w.uid; firetable.myBoulet = w.mine; firetable.myBouletOn = w.on; }, bmWas);

  console.log("-- Discover: members pick cards to feature on their DJ page");
  await put("/users/dj1/featured", ["cardP", "cardA"]); // cardA isn't dj1's: left out
  const featured = await dPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await wait(100); return fn(); };
    const heads = () => [...document.querySelectorAll("#dBrowse .d-head h2")].map((e) => e.textContent);
    ftapi.uid = "dj1";
    // the page already listens on users/, so its reads answer from what it holds:
    // wait until the picks put a moment ago have reached it
    await until(() => { const u = ftapi.users && ftapi.users.dj1; return !!(u && JSON.stringify(u.featured || "").includes("cardP")); });
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
// (it's the whole site, so YouTube's player can throw there as in Discover)
plain.on("pageerror", (e) => { if (theirs(e)) return; pageErrors.push("Plain pages: " + e.message); });
try {
  console.log("-- plain pages: the library as ordinary pages, with a sitemap");
  const { execFile } = await import("child_process");
  // not execFileSync: the builder reads config.js from this process's server
  const buildPages = () => new Promise((resolve, reject) => execFile(process.execPath,
    [join(ROOT, "tools/plain-pages.mjs"), "--site", SITE, "--out", join(ROOT, "music"), "--template", join(ROOT, "index.html"), "--home", join(ROOT, "music/home.html"), "--sounds", "indie dance, nu-disco"],
    { env: { ...process.env, FIREBASE_DATABASE_URL: DB + "?ns=" + NS }, timeout: 60000 },
    (err, stdout, stderr) => (err ? reject(new Error(err.message + stderr)) : resolve(stdout))));
  const out = await buildPages();
  check(/plain pages: \d+ pages/.test(out), "the pages are built (" + out.trim() + ")");
  // each page's day in the sitemap is the day its own content last changed: a second build of the same data changes none
  const firstMap = readFileSync(join(ROOT, "music/sitemap.xml"), "utf8");
  const out2 = await buildPages();
  const told = JSON.parse(readFileSync(join(ROOT, "music/.changed"), "utf8"));
  check(/, 0 changed/.test(out2) && told.urlList.length === 0 && /^[0-9a-f]{32}$/.test(told.key) && existsSync(join(ROOT, "music", told.key + ".txt")) && readFileSync(join(ROOT, "music/sitemap.xml"), "utf8") === firstMap,
    "built again from the same data, no page counts as changed and the sitemap's dates stand (" + out2.trim() + ")");
  await plain.exposeFunction("__cspViolation", (v) => violations.push("Plain pages: " + v));
  await plain.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation(e.violatedDirective + " blocked " + e.blockedURI));
  });
  await plain.route("**/config.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript",
    body: CONFIG }));
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
    site: /id="mainGrid"/.test(raw) && /<base href="\/"/.test(raw) && /class="ft-has-discover ft-discover"/.test(raw),
    // one of each link-preview tag: the page's own, none left over from the home page
    once: ["<link rel=\"canonical\"", "og:title", "og:url", "og:image\"", "twitter:card", "name=\"description\""].every((t) => raw.split(t).length === 2)
  };
  check(/^Best Nu-Disco songs/.test(read.title) && read.canonical && read.h1 && read.rows === 4 && read.ld && read.site,
    "a genre page as sent: the site itself, with the genre's songs already in Discover, and its own title and address (" + JSON.stringify(read) + ")");
  check(read.artist && read.dj, "artists and DJs link to their pages, only where a page exists");
  const home = readFileSync(join(ROOT, "index.html"), "utf8");
  check(read.once && /<meta property="og:image" content="https:\/\/[^"]+\/img\/og\.png"/.test(home) && /<link rel="canonical"/.test(home) && !/<title>firetable<\/title>/.test(home),
    "the home page and each library page have one set of link-preview tags, their own (" + read.once + ")");
  check(read.ytm, "a genre page as sent links to its YouTube Music playlist");
  // what a visitor gets: the real site, on the same Discover page
  await openPage(plain, SITE + "music/genres/nu-disco/");
  await plain.waitForFunction(() => document.querySelector("#dBrowse .d-radio"), null, { timeout: 20000 }).catch(() => {});
  const live = await plain.evaluate(() => ({
    url: location.pathname + location.hash,
    discover: document.body.classList.contains("ft-discover"),
    tabs: !!document.getElementById("modeTabs"),
    live: !!document.querySelector("#dBrowse .d-radio") && !document.querySelector("#dBrowse[data-prerendered]"),
    h: (document.querySelector("#dBrowse .d-pagetext h2") || {}).textContent
  }));
  check(live.url === "/music/genres/nu-disco/" && live.discover && live.tabs && live.live && live.h === "Nu-Disco",
    "a visitor lands in the real site, on that genre's Discover page, at the page's own address (" + JSON.stringify(live) + ")");
  // one address: a link in the page opens the next page here, at that page's own address, and Back returns
  const walk = await plain.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const at = () => location.pathname + location.hash + "|" + ((document.querySelector("#dBrowse .d-pagetext h2, #dBrowse h1") || {}).textContent || "");
    const out = { links: [...document.querySelectorAll("#dBrowse a.d-alink")].map((a) => a.getAttribute("href")).slice(0, 2).join() };
    document.querySelector('#dBrowse a.d-alink[href="/music/artists/alpha/"]').click();
    for (let i = 0; i < 40 && !document.querySelector("#dBrowse .d-sound"); i++) await wait(100);
    out.artist = at();
    out.title = document.title;
    out.sound = [...document.querySelectorAll("#dBrowse .d-sound a")].map((a) => a.textContent + ">" + a.getAttribute("href")).join();
    out.like = [...document.querySelectorAll("#dBrowse section .d-chips a.d-chip")].map((a) => a.textContent + ">" + a.getAttribute("href")).join();
    history.back();
    for (let i = 0; i < 40 && location.pathname !== "/music/genres/nu-disco/"; i++) await wait(100);
    await wait(300);
    out.back = at();
    document.querySelector('#dNav [data-view="home"]').click();
    await wait(300);
    out.home = location.pathname + location.hash;
    // an old link, with its #, becomes the page's address
    location.hash = "#discover/djs/dj1";
    await wait(600);
    out.old = location.pathname + location.hash;
    return out;
  });
  check(walk.artist === "/music/artists/alpha/|Alpha" && walk.back === "/music/genres/nu-disco/|Nu-Disco" && walk.home === "/#discover" && walk.old === "/music/djs/dj1/",
    "links open pages here at their own addresses, Back returns, Home keeps its #, and an old #discover link becomes the page's address (" + JSON.stringify(walk) + ")");
  check(/^Alpha: top songs · /.test(walk.title), "the tab's name follows the page (" + walk.title + ")");
  check(walk.sound === "Nu-Disco>/music/genres/nu-disco/" && walk.like === "Omega>/music/artists/omega/", "an artist's page shows their genres and who they sound like (" + walk.sound + " / " + walk.like + ")");
  // the same on the page as sent
  const rawArtist = await (await fetch(SITE + "music/artists/alpha/")).text();
  const lds = (rawArtist.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).map((x) => JSON.parse(x.replace(/^<script[^>]*>|<\/script>$/g, "")));
  const graph = (lds.find((x) => x["@graph"] && x["@graph"].some((g) => g["@type"] === "BreadcrumbList")) || {})["@graph"] || [];
  check(/<title>Alpha: top songs and similar artists · /.test(rawArtist) && /<a class="d-chip" href="\/music\/artists\/omega\/">Omega<\/a>/.test(rawArtist) && /<a class="d-tag" href="\/music\/genres\/nu-disco\/">Nu-Disco<\/a>/.test(rawArtist),
    "an artist's page as sent: their songs, genres and who they sound like, each a link");
  check(lds.length >= 2 && graph.some((g) => g["@type"] === "MusicPlaylist" && g.about && g.about["@type"] === "MusicGroup") &&
    (graph.find((g) => g["@type"] === "BreadcrumbList") || { itemListElement: [] }).itemListElement.map((i) => i.name).join(" > ").endsWith("Library > Artists > Alpha"),
    "its structured data reads: the site, the page, its trail and its songs (" + graph.map((g) => g["@type"]).join() + ")");
  // a genre's write-up and its years: in Discover and on the pages as sent, each year a page of its own
  await openPage(plain, SITE + "music/genres/nu-disco/");
  await plain.waitForFunction(() => document.querySelector("#dBrowse .d-radio"), null, { timeout: 20000 }).catch(() => {});
  const gy = await plain.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (fn) => { for (let i = 0; i < 40 && !fn(); i++) await wait(100); return fn(); };
    const out = { story: [...document.querySelectorAll("#dBrowse .d-story p")].map((p) => p.textContent).join("|"), storyHead: (document.querySelector("#dBrowse .d-story h2") || {}).textContent,
      years: [...document.querySelectorAll('#dBrowse a.d-chip[href^="/music/genres/nu-disco/"]')].map((a) => a.textContent + ">" + a.getAttribute("href")).join() };
    document.querySelector('#dBrowse a.d-chip[href="/music/genres/nu-disco/2026/"]').click();
    await until(() => /2026/.test((document.querySelector("#dBrowse .d-pagetext h2") || {}).textContent || ""));
    out.page = location.pathname + location.hash + "|" + document.querySelector("#dBrowse .d-pagetext h2").textContent + "|" + [...document.querySelectorAll("#dBrowse .hist-track-title")].map((e) => e.textContent).join() + "|" +
      [...document.querySelectorAll("#dBrowse .d-facts li")].map((e) => e.textContent).join(" · ");
    out.at = firetable.discover.address() + "|" + document.title;
    out.others = [...document.querySelectorAll('#dBrowse a.d-chip')].map((a) => a.getAttribute("href")).join();
    out.back = document.querySelector("#dBrowse .d-back").getAttribute("href") + "|" + document.querySelector("#dBrowse .d-back").textContent;
    document.querySelector("#dBrowse .d-playall").click();
    await wait(300);
    out.playing = firetable.discover.state().list + "|" + firetable.discover.state().playing;
    // the year's own page lists the genres with a page for it
    location.hash = "#discover/years/2026";
    await until(() => document.querySelector('#dBrowse a.d-chip[href="/music/genres/nu-disco/2026/"]'));
    out.year = location.pathname + "|" + [...document.querySelectorAll("#dBrowse a.d-chip")].map((a) => a.textContent + ">" + a.getAttribute("href")).join();
    return out;
  });
  check(gy.storyHead === "About Nu-Disco" && gy.story === "Nu-disco is disco rebuilt by people who grew up on house.|It runs a little slower and warmer than house.",
    "a genre's page tells a little about it, under its songs (" + gy.storyHead + ": " + gy.story + ")");
  check(gy.years === "2026>/music/genres/nu-disco/2026/,2025>/music/genres/nu-disco/2025/", "and links to its best of each year, newest first (" + gy.years + ")");
  check(gy.page === "/music/genres/nu-disco/2026/|The best Nu-Disco of 2026|Fav One,Fav Two|2 songs released in 2026 played here · 50 plays" && /^#discover\/genres\/nu-disco\/2026\|Best Nu-Disco songs of 2026 · /.test(gy.at) &&
    gy.others === "/music/genres/nu-disco/2025/" && gy.back === "/music/genres/nu-disco/|arrow_backNu-Disco" && gy.playing === "genre-year|lib0000001",
    "a genre's year is a page at its own address: its songs that year, most played first, playable, with the other years (" + JSON.stringify(gy) + ")");
  check(gy.year === "/music/years/2026/|Nu-Disco>/music/genres/nu-disco/2026/", "a year's page lists the genres with a page for that year (" + gy.year + ")");
  const rawGenre = await (await fetch(SITE + "music/genres/nu-disco/")).text();
  const rawGy = await (await fetch(SITE + "music/genres/nu-disco/2026/")).text();
  check(/<section class="d-story"><div class="d-head"><h2>About Nu-Disco<\/h2><\/div><p>Nu-disco is disco rebuilt/.test(rawGenre) && /<a class="d-chip d-num" href="\/music\/genres\/nu-disco\/2026\/">2026<\/a>/.test(rawGenre),
    "the genre's page as sent has the write-up and the years");
  check(/<title>Best Nu-Disco songs of 2026 · /.test(rawGy) && /<link rel="canonical" href="[^"]*\/music\/genres\/nu-disco\/2026\/"/.test(rawGy) && /<meta name="ft-route" content="discover\/genres\/nu-disco\/2026"/.test(rawGy) &&
    /<h1>The best Nu-Disco of 2026<\/h1>/.test(rawGy) && (rawGy.match(/class="hist-entry"/g) || []).length === 2 && /"name":"Genres"[^\]]*"name":"Nu-Disco"[^\]]*"name":"2026"/.test(rawGy) &&
    /href="\/music\/genres\/nu-disco\/2025\/">2025<\/a>/.test(rawGy) && readFileSync(join(ROOT, "music/sitemap.xml"), "utf8").includes("/music/genres/nu-disco/2025/"),
    "a genre's year as sent: its own title, address, trail and songs, in the sitemap");
  // an address with no page built yet: the site itself on that Discover page, not for search engines to keep
  await openPage(plain, SITE + "music/djs/nobody/");
  await plain.waitForFunction(() => window.firetable && firetable.discover && firetable.discover.state().view === "djs", null, { timeout: 20000 }).catch(() => {});
  const unbuilt = await plain.evaluate(() => ({ url: location.pathname + location.hash, at: firetable.discover.address(), robots: [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.content).join(), canonical: !!document.querySelector('link[rel="canonical"]') }));
  check(unbuilt.url === "/music/djs/nobody/" && unbuilt.at === "#discover/djs/nobody" && unbuilt.robots === "noindex" && !unbuilt.canonical,
    "an address with no page built yet opens that Discover page, and asks search engines not to keep it (" + JSON.stringify(unbuilt) + ")");
  check((await fetch(SITE + "music/nothing/here/")).status === 404 && (await fetch(SITE + "music/genres/a/b/c/")).status === 404, "anything else under /music/ is still not found");
  // the library's own lists stay as they were built, in the site
  await openPage(plain, SITE + "music/artists/");
  await plain.waitForFunction(() => document.getElementById("modeTabs"), null, { timeout: 20000 }).catch(() => {});
  const lists = await plain.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(800);
    const out = { artists: location.pathname + location.hash + "|" + (document.querySelector("#dBrowse h1") || {}).textContent + "|" + [...document.querySelectorAll("#dBrowse .d-person b")].map((b) => b.textContent).join() };
    document.querySelector('#dBrowse .d-letters a[href="/music/artists-a-z/o/"]').click();
    for (let i = 0; i < 40 && !/Artists: O/.test((document.querySelector("#dBrowse h1") || {}).textContent || ""); i++) await wait(100);
    out.letter = location.pathname + location.hash + "|" + (document.querySelector("#dBrowse h1") || {}).textContent + "|" + [...document.querySelectorAll("#dBrowse .d-person b")].map((b) => b.textContent).join() + "|" + document.title;
    return out;
  });
  check(lists.artists === "/music/artists/|Artists|Alpha,Omega" && /^\/music\/artists-a-z\/o\/\|Artists: O\|Omega\|Artists: O · /.test(lists.letter),
    "the list of artists, and the artists by letter, stay as built inside the site (" + JSON.stringify(lists) + ")");
  // the home page as the deploy sends it: what's new and the ways into the library already in it
  const homeBuilt = readFileSync(join(ROOT, "music/home.html"), "utf8");
  check(/id="dBrowse" class="scroll-view" data-prerendered="discover"/.test(homeBuilt) && /href="\/music\/genres\/nu-disco\/"/.test(homeBuilt) && /href="\/music\/charts\/"/.test(homeBuilt) &&
    !/<body[^>]*ft-discover/.test(homeBuilt) && homeBuilt.split('<link rel="canonical"').length === 2 && homeBuilt.split("<base ").length === 2,
    "the home page is built with this week's songs and links into the library, its own tags untouched");
  const feedXml = readFileSync(join(ROOT, "music/charts/feed.xml"), "utf8");
  check(/<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(feedXml) && /<entry><title>Week 45, 2026/.test(feedXml) && /href="[^"]+\/music\/charts\/week\/2026-W45\/"/.test(feedXml),
    "the weekly chart has a feed");
  const sitemap = readFileSync(join(ROOT, "music/sitemap.xml"), "utf8");
  check(sitemap.includes("<loc>" + SITE + "</loc>") && /\/music\/artists-a-z\/a\/<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod>/.test(sitemap) && /<loc>[^<]+\/music\/<\/loc>/.test(sitemap),
    "the sitemap lists the home page, the library and the artists by letter, each with its day");
  check(/\/music\/themes\/nT1\//.test(sitemap), "theme nights get pages too");
  check(/<loc>[^<]+\/music\/djs\/dj1\/<\/loc>/.test(sitemap) && /\/music\/years\/2026\//.test(sitemap) && /\/music\/charts\/week\/2026-W45\//.test(sitemap),
    "the sitemap lists the DJ, year and chart pages");
} catch (e) {
  check(false, "plain pages test threw: " + e.message);
} finally {
  const { rmSync } = await import("fs");
  rmSync(join(ROOT, "music"), { recursive: true, force: true });
}

// An older iPad (#164): Safari before 17 has no popover. The page loads with
// it taken away; js/popover-polyfill.js must step in, and the site start as usual.
// And a full localStorage (#64): writes refused, the app carries on.
const oldContext = await browser.newContext();
const oldPage = await oldContext.newPage();
const oldErrors = [];
oldPage.on("pageerror", (e) => { if (!theirs(e)) oldErrors.push(e.message); });
await oldPage.addInitScript(() => {
  ["showPopover", "hidePopover", "togglePopover", "popover"].forEach((k) => { delete HTMLElement.prototype[k]; });
  window.__nativePopover = "showPopover" in HTMLElement.prototype;
  // and, as there, :popover-open is no selector at all: using it throws
  const unknown = /(^|[^\\]):popover-open/;
  const refuse = (proto, name) => {
    const real = proto[name];
    Object.defineProperty(proto, name, { configurable: true, writable: true, value: function (sel) {
      if (unknown.test(String(sel))) throw new DOMException("'" + sel + "' is not a valid selector.", "SyntaxError");
      return real.apply(this, arguments);
    } });
  };
  [[Element.prototype, "matches"], [Element.prototype, "closest"], [Element.prototype, "querySelector"], [Element.prototype, "querySelectorAll"],
    [Document.prototype, "querySelector"], [Document.prototype, "querySelectorAll"]].forEach(([o, n]) => refuse(o, n));
});
try {
  console.log("-- an older iPad: no popover in the browser (the polyfill), and a full localStorage");
  await openPage(oldPage, SITE + "#live");
  // started: the room's song is drawn (whichever one the tests above left playing)
  await oldPage.waitForFunction(() => window.firetable && firetable.song && !document.getElementById("track").classList.contains("skel"), null, { timeout: 30000 })
    .catch(async () => { throw new Error("the site didn't start: " + oldErrors.join("; ") + " / " + await oldPage.evaluate(() => document.getElementById("track").textContent)); });
  const old = await oldPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { removed: window.__nativePopover === false };
    out.polyfilled = typeof HTMLElement.prototype.showPopover === "function" && !/\[native code\]/.test(HTMLElement.prototype.showPopover.toString());
    // a menu the site opens itself, with its toggle event and :popover-open in a selector
    const pop = document.getElementById("socialPopover");
    let toggled = "";
    pop.addEventListener("toggle", (e) => { toggled = e.newState; }, { once: true });
    pop.showPopover();
    await wait(50);
    out.open = pop.classList.contains(":popover-open") && pop.matches(":popover-open") && document.querySelector(":popover-open") === pop && toggled === "open";
    pop.hidePopover();
    out.closed = !pop.matches(":popover-open");
    // the style the polyfill can't inject under the security policy is in looks.css (checked by its rule, as Chromium has popover natively)
    out.rule = [...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((r) => r.cssText && r.cssText.includes("not selector(:popover-open)")); } catch (e) { return false; } });
    // localStorage full: every write refused, and switching views still works
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
    try {
      localStorage.setItem("ft-smoke-full", "kept");
      localStorage["ft-smoke-full2"] = "kept too";
      out.kept = localStorage.getItem("ft-smoke-full") === "kept" && localStorage["ft-smoke-full2"] === "kept too" && "ft-smoke-full" in localStorage;
      if (firetable.$appShell && !$("#appShell").length) $("#mainGrid").append(firetable.$appShell);
      firetable.nav.setView("history");
      await wait(600);
      out.history = document.getElementById("mainGrid").classList.contains("view-history") && localStorage[STORAGE.navView] === "history";
      firetable.nav.setView("playlists");
      await wait(600);
      out.back = document.getElementById("mainGrid").classList.contains("view-playlists") && !firetable.nav._isFading;
    } finally {
      Storage.prototype.setItem = realSet;
      localStorage.removeItem("ft-smoke-full");
      localStorage.removeItem("ft-smoke-full2");
    }
    out.gone = localStorage.getItem("ft-smoke-full") === null;
    return out;
  });
  check(old.removed && old.polyfilled, "without popover in the browser, the polyfill provides it (" + JSON.stringify(old) + ")");
  check(old.open && old.closed && old.rule, "a polyfilled menu opens and closes, with its toggle event and :popover-open, and looks.css has its styles");
  check(old.kept && old.history && old.back && old.gone, "with localStorage full, settings last the visit and switching views still works (" + JSON.stringify(old) + ")");
  check(oldErrors.length === 0, "no page errors on an older iPad" + (oldErrors.length ? ": " + oldErrors.join("; ") : ""));
} catch (e) {
  check(false, "older iPad test threw: " + e.message);
} finally {
  await oldContext.close();
}

// The live stage for QueUp's screen (embed/stage/): its own page under its own
// policy, reading a room of its own (a namespace apart, so the pages above
// don't hear its songs change)
console.log("-- the live stage for other sites (embed/stage/)");
{
  const NS2 = NS + "-stage", put2 = putAs(NS2);
  const htaccess = readFileSync(join(ROOT, ".htaccess"), "utf8");
  const stageBlock = (htaccess.match(/<If "%\{REQUEST_URI\} =~ m#\^\/embed\/stage\/#">([\s\S]*?)<\/If>/) || ["", ""])[1];
  const stagePolicy = (stageBlock.match(/Content-Security-Policy "([^"]+)"/) || ["", ""])[1];
  check(/frame-ancestors 'self' https:\/\/queup\.net https:\/\/\*\.queup\.net/.test(stagePolicy) && /X-Robots-Tag "noindex, nofollow"/.test(stageBlock) &&
    htaccess.indexOf("m#^/embed/stage/#") > htaccess.indexOf("m#^/embed/#"), "the stage has its own policy: only this site and QueUp may frame it, never indexed");
  const linked = [join(ROOT, "index.html"), ...readdirSync(join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => join(ROOT, "js", f))]
    .filter((f) => readFileSync(f, "utf8").includes("embed/stage"));
  check(!linked.length, "nothing on the site links to the stage (it's unlisted)" + (linked.length ? ": " + linked.join(", ") : ""));
  const csp2 = stagePolicy.replace("connect-src ", "connect-src " + DB + " ").replace(/;\s*upgrade-insecure-requests/, "");
  check(/media-src 'self' https:\/\/radio\.howtojointheindiediscothequewaitlist\.com/.test(stagePolicy) && !/youtube|soundcloud/.test(stagePolicy),
    "the stage's policy lets it play the room's radio stream, and no video or SoundCloud players");
  // the stream here is the site's own sound file, as config.js stageStreamURL
  const site2 = await serveSite({ csp: csp2, configJs: config(NS2).replace(/roomName:/, 'stageStreamURL: "/sound.mp3", roomName:') });
  const t0 = Date.now();
  await put2("/", {
    users: { dj1: { username: "dj1", status: true }, dj2: { username: "dj2", status: true }, bot: { username: "bot", status: true, hostbot: true },
      gone: { username: "gone", status: false } },
    table: [{ name: "dj1", id: "dj1", plays: 1 }, { name: "dj2", id: "dj2", plays: 0 }],
    songToPlay: Object.assign({}, youtubeSong, { title: "Stage &amp; Song", started: t0 - 30000 }),
    songBpm: { bpm: 120, started: t0 - 30000 }, theme: "stage night", colors: { color: "#1c6ccc", txt: "#fff" },
    // the bot's facts on the song: its plays, first and last (noon UTC, so the day is the same anywhere)
    tagUpdate: { cid: youtubeSong.cid, adamData: { track_name: "Stage & Song", artist: "Smoke Artist", playcount: 12, all_versions_playcount: 31,
      first_play: Date.UTC(2013, 3, 14, 12), first_play_dj: "matt", last_play: Date.UTC(2020, 4, 2, 12), last_play_dj: "dj2" } }
  });
  const stageCtx = await browser.newContext({ viewport: { width: 1120, height: 630 } });
  const sp = await stageCtx.newPage();
  sp.on("pageerror", (e) => { pageErrors.push("Stage: " + e.message); });
  await sp.exposeFunction("__cspViolation", (v) => violations.push("Stage: " + v));
  await sp.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => window.__cspViolation(e.violatedDirective + " blocked " + e.blockedURI)));
  try {
    await openPage(sp, site2.SITE + "embed/stage/");
    await sp.waitForFunction(() => document.querySelectorAll("#st-deck .st-spot").length === 1 && document.querySelectorAll("#st-ondeck li").length === 1 &&
      !document.getElementById("st-theme").classList.contains("no-theme") && /BPM/.test(document.getElementById("st-kicker").textContent) &&
      document.getElementById("st-title").textContent === "Stage & Song" && document.getElementById("st-at").textContent &&
      /plays/.test(document.getElementById("st-kicker").textContent), null, { timeout: 15000 }).catch(() => {});
    const on = await sp.evaluate(() => ({
      title: document.getElementById("st-title").textContent, artist: document.getElementById("st-artist").textContent,
      kicker: document.getElementById("st-kicker").textContent, plays: document.getElementById("st-plays").textContent, count: document.getElementById("st-count").textContent,
      theme: document.getElementById("st-themeText").textContent, acc: document.getElementById("st").style.getPropertyValue("--acc"),
      deck: document.querySelector("#st-deck .st-plaque") && document.querySelector("#st-deck .st-plaque").textContent,
      line: [...document.querySelectorAll("#st-ondeck li")].map((li) => li.title).join(),
      avatar: /robots\/dj1dj1\.png\?size=\d+x\d+&set=/.test((document.querySelector("#st-deck .st-avtr") || {}).style.backgroundImage || ""),
      art: /mqdefault|maxresdefault/.test(document.getElementById("st-art").style.backgroundImage),
      at: document.getElementById("st-at").textContent, left: document.getElementById("st-left").textContent,
      links: [...document.querySelectorAll("#st a")].every((a) => a.target === "_blank" && /#live$/.test(a.href)),
      video: !!document.querySelector("iframe")
    }));
    check(on.title === "Stage & Song" && on.artist === "Smoke Artist" && on.art && on.kicker === "120 BPM · 12 plays · 31 all versions" &&
      on.plays === "first Apr 14, 2013 by matt · last May 2, 2020 by dj2",
      "the stage shows the room's song and cover, and under it the room's plays line: tempo, plays, first and last (" + JSON.stringify(on) + ")");
    check(on.deck === "dj1" && on.avatar && on.line === "dj2" && on.count === "2 in the room" && on.theme === "stage night" && on.acc === "#1c6ccc",
      "the DJ playing stands at their plaque, the next in line beside it; who's online (not the bot), the theme and the song's colours (" + JSON.stringify(on) + ")");
    check(/^00:3\d$/.test(on.at) && /^−04:[23]\d$/.test(on.left) && on.links && !on.video,
      "the times as the stage shows them, every link opens the room, and no video player (" + on.at + " / " + on.left + ")");
    // the radio: by itself where the browser allows it, else Listen live
    if (!(await sp.evaluate(() => document.getElementById("st").classList.contains("is-listening")))) await sp.click("#st-listen");
    await sp.waitForTimeout(800);
    const radio = await sp.evaluate(() => {
      const a = document.getElementById("st-audio");
      return { src: /\/sound\.mp3\?t=\d+$/.test(a.src), listen: document.getElementById("st-listen").hidden, vol: !document.getElementById("st-vol").hidden, muted: a.muted };
    });
    check(radio.src && radio.listen && radio.vol && !radio.muted, "Listen live plays the room's radio stream and shows the volume (" + JSON.stringify(radio) + ")");
    // one picture at any size: half the box, everything half the size, in the same places
    const layout = () => sp.evaluate(() => ["#st-art", "#st-deck .st-spot", "#st-title", ".st-top", ".st-box", "#st-ondeck li"].map((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return [r.left / innerWidth, r.top / innerHeight, r.width / innerWidth, r.height / innerHeight].map((v) => Math.round(v * 200) / 200).join(":");
    }).join(" "));
    const big = await layout();
    await sp.setViewportSize({ width: 560, height: 315 });
    await sp.waitForTimeout(300);
    const small = await layout();
    await sp.setViewportSize({ width: 1920, height: 1080 });
    await sp.waitForTimeout(300);
    const huge = await layout();
    // (text measures a hair differently at each size: within 1.5% of the box)
    const same = (a, b) => a.split(/[ :]/).every((v, i) => Math.abs(Number(v) - Number(b.split(/[ :]/)[i])) <= 0.015);
    check(same(big, small) && same(big, huge), "the stage scales as one picture: the same layout at 560, 1120 and 1920 wide (" + big + (same(big, small) && same(big, huge) ? "" : " | " + small + " | " + huge) + ")");
    // fire: the bot's count for the song playing lights a flame behind the DJ; a count for another song doesn't
    await put2("/songFires", { started: t0 - 60000, count: 5 });
    await sp.waitForTimeout(800);
    const stale = await sp.evaluate(() => document.getElementById("st").classList.contains("has-fire"));
    await put2("/songFires", { started: t0 - 30000, count: 3 });
    // the site's fire (js/flame.js, a plain canvas), drawn behind the DJ
    await sp.waitForFunction(() => document.getElementById("st").classList.contains("has-fire") && !!document.querySelector("#fyre canvas"), null, { timeout: 10000 }).catch(() => {});
    await sp.waitForTimeout(1200);
    const lit = await sp.evaluate(() => {
      const c = document.querySelector("#fyre canvas");
      let drawn = 0;
      if (c) { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) drawn++; }
      return { on: document.getElementById("st").classList.contains("has-fire"), drawn: drawn > 500, sized: !!c && c.width === Math.round(document.getElementById("fyre").clientWidth * Math.min(2, devicePixelRatio)),
        kicker: document.getElementById("st-kicker").textContent, libs: typeof PIXI === "undefined" && typeof TweenMax === "undefined",
        behind: Number(getComputedStyle(document.getElementById("fyre")).zIndex) < Number(getComputedStyle(document.getElementById("st-deck")).zIndex) };
    });
    check(!stale && lit.on && lit.drawn && lit.sized && lit.behind && lit.libs && /\u{1F525} 3$/u.test(lit.kicker),
      "fire: three fires for this song light the fire behind the DJ, with no libraries to load; none for another song's (" + JSON.stringify(lit) + ")");
    await put2("/songToPlay", { type: 2, cid: "13158665", title: "Stage SC", artist: "Forss", started: Date.now(), duration: 200, djid: "dj2", djname: "dj2",
      url: "https://soundcloud.com/forss/flickermood", image: site2.SITE + "icons/icon-512.png" });
    await sp.waitForFunction(() => document.getElementById("st-title").textContent === "Stage SC", null, { timeout: 15000 }).catch(() => {});
    const sc = await sp.evaluate(() => ({ deck: (document.querySelector("#st-deck .st-plaque") || {}).textContent, line: [...document.querySelectorAll("#st-ondeck li")].map((li) => li.title).join(),
      art: /icon-512\.png/.test(document.getElementById("st-art").style.backgroundImage), radio: !document.getElementById("st-audio").paused || /sound\.mp3/.test(document.getElementById("st-audio").src) }));
    sc.fire = await sp.evaluate(() => document.getElementById("st").classList.contains("has-fire"));
    check(sc.deck === "dj2" && sc.line === "dj1" && sc.art && sc.radio && !sc.fire, "a SoundCloud song: its cover, the next DJ at the plaque, the radio still on, the last song's fire out (" + JSON.stringify(sc) + ")");
    await put2("/songToPlay", null);
    await sp.waitForFunction(() => document.getElementById("st").classList.contains("is-quiet"), null, { timeout: 10000 }).catch(() => {});
    check(await sp.evaluate(() => !document.getElementById("st-quiet").hidden && document.getElementById("st-listen").hidden), "with no one playing, the stage says the decks are open");
    // Everything above ran the old way (no stage/ yet: an older hostbot). Once
    // the hostbot publishes its stage summary, the stage reads only that and
    // the song: who's here, the deck, the looks and fires come from it, and
    // users/ (every member there has ever been) is no longer followed.
    const t1 = Date.now();
    await put2("/songToPlay", Object.assign({}, youtubeSong, { title: "Summary Song", started: t1 - 5000, djid: "dj2", djname: "dj2" }));
    await put2("/stage", { online: 7, deck: [{ id: "dj2", n: "Deejay Two" }, { id: "dj1", n: "dj1" }], style: "dicebear:pixel-art",
      colors: { color: "#aa3366", txt: "#fff" }, theme: "summary night", bpm: { started: t1 - 5000, bpm: 100 }, fires: { started: t1 - 5000, count: 2 } });
    await sp.waitForFunction(() => document.getElementById("st-count").textContent === "7 in the room" &&
      document.getElementById("st-themeText").textContent === "summary night", null, { timeout: 15000 }).catch(() => {});
    await put2("/users/dj3", { username: "dj3", status: true }); // the old way would count 3 now
    await put2("/theme", "not followed");
    await sp.waitForTimeout(1500);
    const summary = await sp.evaluate(() => ({
      count: document.getElementById("st-count").textContent, theme: document.getElementById("st-themeText").textContent,
      acc: document.getElementById("st").style.getPropertyValue("--acc"), title: document.getElementById("st-title").textContent,
      deck: (document.querySelector("#st-deck .st-plaque") || {}).textContent, line: [...document.querySelectorAll("#st-ondeck li")].map((li) => li.title).join(),
      avatar: /api\.dicebear\.com\/9\.x\/pixel-art\/svg\?seed=dj2/.test((document.querySelector("#st-deck .st-avtr") || {}).style.backgroundImage || ""),
      kicker: document.getElementById("st-kicker").textContent, fire: document.getElementById("st").classList.contains("has-fire")
    }));
    check(summary.count === "7 in the room" && summary.theme === "summary night" && summary.acc === "#aa3366" && summary.title === "Summary Song" &&
      summary.deck === "Deejay Two" && summary.line === "dj1" && summary.avatar && /100 BPM/.test(summary.kicker) && summary.fire,
      "with the hostbot's stage summary, the stage shows who's here, the deck, the looks and the fire from it alone, and no longer follows users/ or reads the theme (" + JSON.stringify(summary) + ")");
    // the room's avatars are Bouletmatons: each DJ's own (bm), or the one made from their uid
    await put2("/stage/style", "bouletmaton");
    await put2("/stage/deck/0/bm", "2.3.5.10.8.20.5.30.40.6.12.3.4.7.10.5.2.33.20");
    await sp.waitForFunction(() => /blob:/.test((document.querySelector("#st-deck .st-avtr") || { style: {} }).style.backgroundImage), null, { timeout: 15000 }).catch(() => {});
    await sp.waitForTimeout(300);
    const bmStage = await sp.evaluate(() => ({ kind: document.documentElement.getAttribute("data-avatars"),
      deck: (document.querySelector("#st-deck .st-avtr") || { style: {} }).style.backgroundImage.slice(0, 12),
      face: !!document.querySelector("#st-deck .st-avtr.bm-face"),
      line: [...document.querySelectorAll("#st-ondeck li")].map((li) => (/set=(set\d)/.exec(li.style.backgroundImage) || [, li.style.backgroundImage.slice(0, 12)])[1]).join() }));
    check(bmStage.kind === "robohash" && /blob:/.test(bmStage.deck) && bmStage.face && bmStage.line === "set1",
      "with the room on Bouletmaton (stage/style), the stage draws the DJ's switched-on Bouletmaton (bm) and robot busts for the rest (" + JSON.stringify(bmStage) + ")");
  } catch (e) {
    check(false, "stage test threw: " + e.message);
  } finally {
    await stageCtx.close();
    site2.server.close();
  }
}

console.log("-- fonts");
const fontFiles = [...new Set(requested.filter((u) => /\/fonts\/[^?]+\.woff2/.test(u)).map((u) => decodeURIComponent(u.split("/fonts/")[1].split("?")[0])))];
// characters on the page outside Inter's main part (from its unicode-range in fonts-local.css)
const outside = await page.evaluate(async () => {
  const css = await (await fetch("css/fonts-local.css")).text();
  const block = css.split("@font-face").find((b) => /Inter-VariableFont[^']*\.main\.woff2/.test(b)) || "";
  const ranges = (block.match(/unicode-range:([^;]+)/) || ["", ""])[1].split(",").map((r) => r.trim().slice(2).split("-").map((h) => parseInt(h, 16)));
  const inMain = (cp) => ranges.some(([a, b]) => cp >= a && cp <= (b === undefined ? a : b));
  const seen = new Map();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) {
    for (const ch of n.nodeValue) {
      const cp = ch.codePointAt(0);
      if (cp > 0x7f && !inMain(cp) && !(cp >= 0xe000 && cp <= 0xf8ff) && !/\p{Extended_Pictographic}|\uFE0F|\u200D/u.test(ch)) seen.set("U+" + cp.toString(16).toUpperCase().padStart(4, "0"), (n.parentElement && (n.parentElement.id || n.parentElement.className || n.parentElement.tagName)) + ": " + n.nodeValue.trim().slice(0, 40));
    }
  }
  return [...seen].map(([k, v]) => k + " in " + v);
});
check(fontFiles.some((f) => /^Inter-VariableFont.*\.main\.woff2$/.test(f)) && !fontFiles.some((f) => /\.rest\.woff2$/.test(f)),
  "the site's own text needs only the main part of each font (" + fontFiles.join(", ") + (outside.length ? "; outside it: " + outside.join(" | ") : "") + ")");

console.log("-- errors");
check(violations.length === 0, "nothing blocked by the Content-Security-Policy" + (violations.length ? ": " + [...new Set(violations)].join("; ") : ""));
check(pageErrors.length === 0, "no page errors" + (pageErrors.length ? ": " + pageErrors.join("; ") : ""));

await browser.close();
server.close();
console.log(failures ? "\n" + failures + " SMOKE CHECK(S) FAILED" : "\nsmoke: all passed");
process.exit(failures ? 1 : 0);
