// Every avatar style, scaled for every place it's drawn: the circles (the
// people list, chat, the header, the line by the deck, Discover's faces and
// its big one) and the stage (the DJ standing at the table, at the room's
// size and scaled up, and the embedded stage). Each one is drawn with the
// site's own CSS, in the room's style (html[data-avatars]), photographed, and
// measured against the same place with no picture in it:
//   circles: the drawing fills the circle (not a speck, not a sliver), sits in
//            its middle, and isn't pushed off the top or bottom
//   stage:   the drawing stands on the table (its feet at the bottom), fills
//            the box it's drawn in, and is centred
// Several members per style (made-up Bouletmatons differ: hats, hands, hair).
// And the Turntable theme's avatars: every one, both sides, put together whole.
// Writes tests/screens/avatars.png, a contact sheet of them all.
//   cd tests && npm ci && npm run avatars
// No emulator needed. Robohash and DiceBear pictures come from their servers
// once, then from the disk cache (harness.mjs cachePictures).
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { policy, config, serveSite, launchOptions, openPage, cachePictures, ROOT } from "./harness.mjs";

// The room's styles (a supermod's pick), then October, when everyone is a monster
const STYLES = ["robohash:set1", "robohash:set2", "robohash:set4", "dicebear:notionists", "dicebear:pixel-art", "bouletmaton", "october"];
// Half the members built a Bouletmaton and switched it on (it shows whatever the
// style, except in October); the rest are the room's style. Bouletmatons with
// hats, long hair, the taller hand items and every choice at 1.
const PEOPLE = [["dj1", "Deejay", "2.3.5.10.8.20.5.30.40.6.12.3.4.7.10.5.2.33.20"], ["OiJ7rcoNaNdvk3KlFGUJx1Fqjer2", "rohn"],
  ["u42", "night_owl", "4.12.9.62.26.54.17.93.96.25.42.17.20.32.31.18.24.32.25"], ["zZ9", "Bea"],
  ["abc", "x", "1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1"], ["hat5", "Hats", "3.7.2.40.15.33.9.60.80.24.30.10.15.20.19.12.10.5.11"]];

// The places, with the site's classes and sizes. kind "circle" or "stage".
const PLACES = [
  { name: "people list", kind: "circle", html: '<div id="__allUsers_slot"></div>' },
  { name: "header", kind: "circle", html: '<div id="__header_slot"></div>' },
  { name: "chat", kind: "circle", html: '<div class="newChat"><span class="ft-avatar" style="position:static"></span></div>' },
  { name: "on deck", kind: "circle", html: '<button class="ondeck-slot" style="width:2.5rem;height:2.5rem"><div class="ft-avatar"></div></button>' },
  { name: "Discover DJ", kind: "circle", html: '<div class="d-person"><span class="ft-avatar"></span></div>' },
  { name: "Discover big", kind: "circle", html: '<div class="d-bigrobot"><span class="ft-avatar"></span></div>' },
  { name: "stage", kind: "stage", html: '<div id="__stage" style="position:relative;width:10rem;height:8rem"><div class="spot" style="position:absolute;inset:0;max-width:none"><div class="avtr"></div></div></div>' },
  { name: "stage, scaled up", kind: "stage", html: '<div id="__stage2" style="position:relative;width:20rem;height:16rem"><div class="spot" style="position:absolute;inset:0;max-width:none"><div class="avtr" style="height:14rem"></div></div></div>' }
];

const failures = [];
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) failures.push(what); console.log((ok ? "  ok   " : "  FAIL ") + what); };

/** Foreground of a screenshot pair (with the picture, without): per-pixel difference above a threshold. */
async function measure(page, withPng, withoutPng, kind) {
  return page.evaluate(async ([a, b, kind]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = ia.width, h = ia.height;
    const px = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const A = px(ia), B = px(ib);
    let n = 0, inside = 0, sx = 0, sy = 0, minX = w, minY = h, maxX = -1, maxY = -1, topBand = 0, botBand = 0;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (kind === "circle" && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
      inside++;
      const i = (y * w + x) * 4;
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      if (d < 24) continue;
      n++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (y < h * 0.3) topBand++;
      if (y > h * 0.7) botBand++;
    }
    return { w, h, cover: n / inside, cx: n ? sx / n / w : 0, cy: n ? sy / n / h : 0,
      left: minX / w, right: (maxX + 1) / w, top: minY / h, bottom: (maxY + 1) / h, topBand, botBand, n };
  }, [withPng.toString("base64"), withoutPng.toString("base64"), kind]);
}

const site = await serveSite({ csp: policy(), configJs: config("demo-avatars") });
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await cachePictures(context);
const page = await context.newPage();
page.on("pageerror", (e) => failures.push("page error: " + e.message));
await openPage(page, site.SITE);
await page.waitForFunction(() => window.firetable && firetable.started && window.Bouletmaton, null, { timeout: 30000 });

// A fixture on top of the page: the real #allUsers and #loggedInUser rows moved into it, the rest made with the site's classes
await page.evaluate((places) => {
  const box = document.createElement("div");
  box.id = "__avtest";
  box.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#181818;display:flex;flex-wrap:wrap;align-content:flex-start;gap:24px;padding:24px;overflow:auto";
  document.body.appendChild(box);
  places.forEach((p, i) => {
    const cell = document.createElement("div");
    cell.className = "__cell";
    cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px;color:#aaa;font:12px Inter,sans-serif";
    cell.innerHTML = p.html + "<span>" + p.name + "</span>";
    box.appendChild(cell);
  });
  // the real ones when they're on the page; signed out, the app keeps them
  // off it (its shell is detached), so stand-ins with their ids take their place
  const real = (id, make) => document.getElementById(id) || make();
  const users = real("allUsers", () => Object.assign(document.createElement("div"), { id: "allUsers" }));
  const row = document.createElement("div");
  row.className = "prson";
  row.innerHTML = '<div class="ft-avatar"></div>';
  users.style.cssText = "display:block;position:static;width:auto;height:auto;overflow:visible;border:0;padding:0;margin:0;background:none";
  users.appendChild(row);
  document.getElementById("__allUsers_slot").appendChild(users);
  const header = real("loggedInUser", () => {
    const b = document.createElement("button");
    b.id = "loggedInUser";
    b.className = "header_icon";
    b.innerHTML = '<span class="ft-avatar"></span>';
    return b;
  });
  header.style.cssText = "display:block;position:static";
  document.getElementById("__header_slot").appendChild(header);
}, PLACES);

/** Every element that draws an avatar in the fixture, in PLACES order. */
const targets = () => page.$$("#__avtest .__cell .ft-avatar:not(.skel), #__avtest .__cell .avtr, #__avtest .__cell #loggedInUser .ft-avatar");

const sheet = [];
for (const style of STYLES) {
  console.log("-- " + style);
  await page.evaluate(([s, people]) => {
    firetable.roomAvatarStyle = s === "october" ? "bouletmaton" : s;
    firetable.avatarForced = s === "october" ? "robohash:set2" : null;
    document.documentElement.setAttribute("data-avatars", firetable.utilities.avatarKind());
    ftapi.users = {};
    people.forEach(([uid, name, bm]) => { ftapi.users[uid] = bm ? { username: name, status: true, boulet: bm, bouletOn: true } : { username: name, status: true }; });
  }, [style, PEOPLE]);
  for (const [uid, name, bm] of PEOPLE) {
    // Draw each place empty, photograph it, then with the person's picture
    const handles = [];
    for (let i = 0; i < PLACES.length; i++) {
      const el = await page.$(PLACES[i].name === "people list" ? "#allUsers .prson .ft-avatar"
        : PLACES[i].name === "header" ? "#loggedInUser .ft-avatar"
          : "#__avtest .__cell:nth-child(" + (i + 1) + ") " + (PLACES[i].kind === "stage" ? ".avtr" : ".ft-avatar"));
      handles.push(el);
    }
    // empty, on the fill the picture will sit on (a Bouletmaton has its own: black)
    const empty = [];
    const wantFace = !!bm && style !== "october";
    for (const el of handles) {
      await el.evaluate((e, face) => {
        e.classList.remove("skel", "animate"); e.style.backgroundImage = "none"; e.style.animation = "none"; e.style.backgroundColor = "";
        e.classList.toggle("bm-face", face);
        if (face) e.style.backgroundColor = getComputedStyle(e).backgroundColor;
      }, wantFace);
    }
    await page.waitForTimeout(50);
    for (const el of handles) empty.push(await el.screenshot());
    await page.evaluate(([uid, name]) => {
      document.querySelectorAll("#__avtest .__cell .ft-avatar, #__avtest .__cell .avtr").forEach((e) => { e.style.backgroundColor = ""; });
      const sizes = { circle: firetable.utilities.sharpAvatarSize(64), stage: firetable.utilities.sharpAvatarSize(224) };
      document.querySelectorAll("#__avtest .__cell .ft-avatar, #__avtest .__cell .avtr").forEach((e) => {
        e.style.backgroundImage = "url(" + JSON.stringify(firetable.utilities.avatarURL(uid, name, e.classList.contains("avtr") ? sizes.stage : sizes.circle, null, true)) + ")";
      });
    }, [uid, name]);
    // wait for every picture: Bouletmatons swapped in, the others loaded
    await page.waitForFunction(() => {
      const els = [...document.querySelectorAll("#__avtest .__cell .ft-avatar, #__avtest .__cell .avtr")];
      if (els.some((e) => /#bm=/.test(e.style.backgroundImage))) return false;
      // one load per picture (not one per poll): ready when every one has loaded
      const seen = window.__loaded = window.__loaded || {};
      return els.every((e) => {
        const m = /url\("?([^")]+)"?\)/.exec(e.style.backgroundImage);
        if (!m) return false;
        if (!(m[1] in seen)) { seen[m[1]] = false; const i = new Image(); i.onload = () => { seen[m[1]] = true; }; i.onerror = () => { delete seen[m[1]]; }; i.src = m[1]; }
        return seen[m[1]] === true;
      });
    }, null, { timeout: 30000, polling: 250 });
    // a picture the avatar server refused at first (it rate-limits) is in the
    // cache now: draw each again so none is left empty
    await page.evaluate(() => document.querySelectorAll("#__avtest .__cell .ft-avatar, #__avtest .__cell .avtr").forEach((e) => {
      const bg = e.style.backgroundImage; e.style.backgroundImage = "none"; void e.offsetWidth; e.style.backgroundImage = bg;
    }));
    await page.waitForTimeout(150);
    const faces = await page.evaluate(() => [...document.querySelectorAll("#__avtest .__cell .ft-avatar, #__avtest .__cell .avtr")].map((e) => e.classList.contains("bm-face")));
    if (faces.some((f) => f !== wantFace)) failures.push(style + " · " + name + ": " + (wantFace ? "not every place shows their Bouletmaton" : "a Bouletmaton where there shouldn't be one"));
    for (let i = 0; i < PLACES.length; i++) {
      const place = PLACES[i];
      const shot = await handles[i].screenshot();
      if (uid === PEOPLE[0][0] || uid === PEOPLE[1][0]) sheet.push({ style, uid, place: place.name, png: shot.toString("base64") });
      const m = await measure(page, shot, empty[i], place.kind);
      const label = style + " · " + place.name + " · " + name + (bm && style !== "october" ? " (Bouletmaton)" : "");
      const r2 = (v) => Math.round(v * 100) / 100;
      const facts = "(cover " + r2(m.cover) + ", centre " + r2(m.cx) + "," + r2(m.cy) + ", box " + r2(m.left) + "-" + r2(m.right) + " × " + r2(m.top) + "-" + r2(m.bottom) + ")";
      if (place.kind === "circle") {
        // the bar: what the robots (the room's look for years) do, for every style
        check(m.cover >= 0.2 && m.cover <= 0.995 && m.cx >= 0.36 && m.cx <= 0.64 && m.cy >= 0.3 && m.cy <= 0.72 &&
          m.right - m.left >= 0.45 && m.bottom - m.top >= 0.6 && m.topBand > 0 && m.botBand > 0,
          label + ": fills the circle, centred " + facts);
      } else {
        check(m.bottom >= 0.97 && m.cx >= 0.35 && m.cx <= 0.65 && (m.bottom - m.top >= 0.65 || m.right - m.left >= 0.75) && m.cover >= 0.08,
          label + ": stands on the table, fills the stage box, centred " + facts);
      }
    }
  }
}

// The embedded stage (embed/stage/, shown on QueUp): its own CSS, the same framing
console.log("-- the embedded stage");
const embed = await context.newPage();
embed.on("pageerror", (e) => failures.push("embed page error: " + e.message));
await openPage(embed, site.SITE + "embed/stage/");
await embed.waitForFunction(() => window.Bouletmaton && window.AVATAR_STYLES, null, { timeout: 30000 });
for (const style of STYLES.filter((s) => s !== "october")) {
  const kind = await page.evaluate((s) => firetable.utilities.avatarKind(s === "bouletmaton" ? "robohash:set1" : s), style);
  for (const [uid, name, bm] of PEOPLE.slice(0, 3)) {
    const prep = (withPic) => embed.evaluate(([kind, style, uid, name, bm, withPic]) => {
      document.documentElement.setAttribute("data-avatars", kind);
      let box = document.getElementById("__emb");
      if (!box) {
        box = document.createElement("div");
        box.id = "__emb";
        box.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#181818;display:flex;gap:32px;padding:24px;align-items:flex-end;font-size:16px";
        box.innerHTML = '<div class="st-spot" style="position:relative"><span class="st-avtr" style="animation:none"></span></div><ul class="st-ondeck" style="position:static;translate:none"><li></li></ul>';
        document.body.appendChild(box);
      }
      if (style === "bouletmaton") style = "robohash:set1";
      const url = bm ? Bouletmaton.url(bm, 512)
        : style.indexOf("dicebear:") === 0 ? "https://api.dicebear.com/9.x/" + style.slice(9) + "/svg?seed=" + encodeURIComponent(uid + name)
          : "https://indiediscotheque.com/robots/" + encodeURIComponent(uid + name) + ".png?size=240x240&set=" + style.slice(9);
      box.querySelectorAll(".st-avtr, li").forEach((e) => {
        // empty, on the fill the picture will sit on (a Bouletmaton has its own: black)
        e.style.backgroundColor = "";
        if (!withPic) { e.classList.toggle("bm-face", !!bm); if (bm) e.style.backgroundColor = getComputedStyle(e).backgroundColor; }
        e.style.backgroundImage = withPic ? 'url("' + url + '")' : "none";
      });
    }, [kind, style, uid, name, bm, withPic]);
    await prep(false);
    await embed.waitForTimeout(50);
    const e0 = [await (await embed.$("#__emb .st-avtr")).screenshot(), await (await embed.$("#__emb li")).screenshot()];
    await prep(true);
    await embed.waitForFunction(() => [...document.querySelectorAll("#__emb .st-avtr, #__emb li")].every((e) => !/#bm=/.test(e.style.backgroundImage)), null, { timeout: 30000 });
    await embed.waitForFunction(() => {
      const seen = window.__loaded = window.__loaded || {};
      return [...document.querySelectorAll("#__emb .st-avtr")].every((e) => {
        const m = /url\("?([^")]+)"?\)/.exec(e.style.backgroundImage);
        if (!m) return false;
        if (!(m[1] in seen)) { seen[m[1]] = false; const i = new Image(); i.onload = () => { seen[m[1]] = true; }; i.onerror = () => { delete seen[m[1]]; }; i.src = m[1]; }
        return seen[m[1]] === true;
      });
    }, null, { timeout: 30000, polling: 250 });
    await embed.evaluate(() => document.querySelectorAll("#__emb .st-avtr, #__emb li").forEach((e) => {
      const bg = e.style.backgroundImage; e.style.backgroundImage = "none"; void e.offsetWidth; e.style.backgroundImage = bg;
    }));
    await embed.waitForTimeout(150);
    const stage = await measure(embed, await (await embed.$("#__emb .st-avtr")).screenshot(), e0[0], "stage");
    const circle = await measure(embed, await (await embed.$("#__emb li")).screenshot(), e0[1], "circle");
    check(stage.bottom >= 0.97 && stage.cx >= 0.35 && stage.cx <= 0.65 && (stage.bottom - stage.top >= 0.65 || stage.right - stage.left >= 0.6),
      style + " · embedded stage · " + name + ": stands on the table, centred (" + JSON.stringify({ cx: stage.cx.toFixed(2), top: stage.top.toFixed(2), l: stage.left.toFixed(2), r: stage.right.toFixed(2) }) + ")");
    check(circle.cover >= 0.2 && circle.cx >= 0.36 && circle.cx <= 0.64 && circle.cy >= 0.3 && circle.cy <= 0.72,
      style + " · embedded on-deck circle · " + name + ": fills the circle, centred (" + circle.cover.toFixed(2) + ", " + circle.cx.toFixed(2) + "," + circle.cy.toFixed(2) + ")");
  }
}

// The Turntable theme's avatars, every one, front and back: put together from
// their sprite as js/ttskin.js figure() does (the body, then the head over it, each
// at its place), they make the whole figure the sprite also holds. (A part out of
// place, say a body hidden behind its head, leaves a figure without a body.)
console.log("-- the Turntable theme's avatars: every one, both sides, whole when put together");
const tt = await page.evaluate(async () => {
  const list = await (await fetch("img/tt/avatars.json")).json();
  const load = (id) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(id)); i.src = "img/tt/av/" + id + ".webp"; });
  const bad = [];
  let sides = 0, parts = 0;
  for (const a of list) {
    const img = await load(a.id);
    if (img.naturalWidth !== a.sw || img.naturalHeight !== a.sh) { bad.push(a.id + " sprite size"); continue; }
    for (const side of ["f", "b"]) {
      const s = a[side];
      sides++;
      const alpha = (draw) => { const c = new OffscreenCanvas(s.w, s.h), x = c.getContext("2d"); draw(x); return x.getImageData(0, 0, s.w, s.h).data; };
      const whole = alpha((x) => x.drawImage(img, s.x, 0, s.w, s.h, 0, 0, s.w, s.h));
      let n = 0;
      for (let k = 3; k < whole.length; k += 4) if (whole[k] > 128) n++;
      if (n < 200) { bad.push(a.id + side + " no figure"); continue; }
      if (!s.head) continue;
      parts++;
      const got = alpha((x) => ["body", "head"].forEach((p) => { const [px, w, h, dx, dy] = s[p]; x.drawImage(img, px, 0, w, h, dx, dy, w, h); }));
      let miss = 0, extra = 0;
      for (let k = 3; k < whole.length; k += 4) { const w = whole[k] > 128, g = got[k] > 128; if (w && !g) miss++; if (g && !w) extra++; }
      if (miss / n > 0.03 || extra / n > 0.03) bad.push(a.id + side + " (" + (100 * miss / n).toFixed(0) + "% missing, " + (100 * extra / n).toFixed(0) + "% extra)");
    }
  }
  return { count: list.length, sides, parts, bad };
});
// each sprite's version (its link's ?v=, js/ttskin.js src) is its file's hash, so a rebuilt one is fetched again
const stale = JSON.parse(readFileSync(join(ROOT, "img/tt/avatars.json"), "utf8"))
  .filter((a) => a.v !== createHash("sha256").update(readFileSync(join(ROOT, "img/tt/av", a.id + ".webp"))).digest("hex").slice(0, 10)).map((a) => a.id);
check(stale.length === 0, "Turntable avatars: every sprite's version is its file's hash (tools/tt-avatars.py)" + (stale.length ? ": " + stale.slice(0, 20).join(", ") : ""));
check(tt.count > 600 && tt.bad.length === 0, "Turntable avatars: " + tt.count + " avatars, " + tt.sides + " sides (" + tt.parts + " drawn as a head on a body) all whole" + (tt.bad.length ? ": " + tt.bad.slice(0, 20).join(", ") : ""));

// The contact sheet: one row per style, each place, two members
const html = "<!doctype html><meta charset=utf-8><title>Avatars</title><body style='background:#181818;color:#ccc;font:13px sans-serif;margin:16px'>" +
  STYLES.map((s) => "<h3 style='margin:16px 0 6px'>" + s + "</h3><div style='display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end'>" +
    sheet.filter((x) => x.style === s).map((x) => "<figure style='margin:0;text-align:center'><img src='data:image/png;base64," + x.png + "' style='zoom:.5'><figcaption>" + x.place + "</figcaption></figure>").join("") + "</div>").join("");
mkdirSync(join(ROOT, "tests", "screens"), { recursive: true });
writeFileSync(join(ROOT, "tests", "screens", "avatars.html"), html);
const sheetPage = await context.newPage();
await sheetPage.setContent(html);
await sheetPage.screenshot({ path: join(ROOT, "tests", "screens", "avatars.png"), fullPage: true });

await browser.close();
site.server.close();
console.log("\n" + (checks - failures.length) + " of " + checks + " passed; contact sheet: tests/screens/avatars.png");
if (failures.length) {
  console.log("FAILED:\n  " + failures.join("\n  "));
  process.exit(1);
}
