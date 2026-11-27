// The left column folded into a toolbar (js/rail.js, css/rail.css), on wide
// screens: nothing of it loads before it's used; the button, the [ key and
// Settings' switch fold it and open it again; the middle takes the room it
// gives up while chat keeps its width; the choice is kept on the device ("1"
// or "0") and the page paints folded next time; with no choice kept, a
// smaller computer screen (1024 to 1369px, with a mouse) starts folded once
// the device has signed in, and follows the window across that range; who's
// here and search open the column over the middle for a moment; it never
// applies on a narrow screen or in the Turntable theme. And Discover's
// columns (a narrower left one), with its right column folded to a strip
// (js/side-panel.js). A visitor's page, under the real
// Content-Security-Policy. No emulator needed.
//   cd tests && npm ci && npm run unit
// Never deployed. CI: .github/workflows/smoke.yml
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { policy, config, serveSite, launchOptions, openPage, sleep } from "./harness.mjs";

let browser, server, SITE, context, page;
const errors = [];

before(async () => {
  const site = await serveSite({ csp: policy(), configJs: config("demo-rail") });
  server = site.server;
  SITE = site.SITE;
  browser = await chromium.launch(launchOptions());
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openPage(page, SITE + "#live");
  await page.waitForFunction(() => window.firetable && firetable.started && document.getElementById("modeTabs"), null, { timeout: 30000 });
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** The grid's columns, in pixels. */
const columns = () => page.evaluate(() => getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns.split(" ").map(parseFloat));
const folded = () => page.evaluate(() => document.documentElement.classList.contains("rail"));
const waitFolded = (on) => page.waitForFunction((v) => document.documentElement.classList.contains("rail") === v, on, { timeout: 5000 });
/** Away from any text box, so the keys are the page's. */
const blur = () => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(400); };

test("nothing of it loads before it's used, and its button says what it does", async () => {
  const r = await page.evaluate(() => {
    const btn = document.getElementById("nav-railBtn");
    return {
      script: !!document.querySelector('script[src*="rail.js"]'),
      css: !!document.getElementById("nav-railCss"),
      shown: !!btn.offsetParent,
      expanded: btn.getAttribute("aria-expanded"),
      label: btn.getAttribute("aria-label"),
      people: !!document.getElementById("nav-railPeople").offsetParent,
      // at the column's bottom right
      corner: (() => {
        const b = btn.getBoundingClientRect(), col = document.getElementById("topbar").getBoundingClientRect(), bar = document.getElementById("dMini").getBoundingClientRect();
        return b.right <= col.right && b.right > col.right - 40 && b.bottom <= bar.top && b.bottom > bar.top - 40;
      })()
    };
  });
  assert.equal(r.script, false, "js/rail.js isn't loaded with the page");
  assert.equal(r.css, false, "css/rail.css isn't loaded with the page");
  assert.equal(r.shown, true, "the button is by the logo on a wide screen");
  assert.equal(r.expanded, "true");
  assert.equal(r.label, "Collapse the column into a toolbar");
  assert.equal(r.people, false, "the toolbar's people button only shows in the toolbar");
  assert.equal(r.corner, true, "the button is at the column's bottom right");
});

test("[ folds it: the middle gets the room, chat keeps its width; kept on this device", async () => {
  await go("#discover");
  const open = await columns();
  assert.deepEqual(open.map(Math.round), [288, 720, 432], "Discover's columns: a visitor's left one 18rem (the logo and their icons in one row), the middle the rest, the right as Live's");
  await blur();
  await page.keyboard.press("[");
  await waitFolded(true);
  await sleep(500); // the cross-fade
  const shut = await columns();
  const r = await page.evaluate(() => ({
    script: !!document.querySelector('script[src*="rail.js"]'),
    css: !!(document.getElementById("nav-railCss") && document.getElementById("nav-railCss").sheet),
    stored: localStorage.getItem("firetableRail"),
    expanded: document.getElementById("nav-railBtn").getAttribute("aria-expanded"),
    label: document.getElementById("nav-railBtn").getAttribute("aria-label"),
    tip: document.getElementById("tip-nav-railBtn").textContent,
    rail: document.getElementById("dRail").getBoundingClientRect().width,
    search: document.getElementById("dSearch").getBoundingClientRect().width,
    navWords: getComputedStyle(document.querySelector("#dNav .d-nav span")).clipPath,
    themeFlat: getComputedStyle(document.getElementById("themePill")).boxShadow
  }));
  assert.equal(r.script, true, "js/rail.js loads the first time");
  assert.equal(r.css, true, "and its stylesheet");
  assert.equal(r.stored, "1");
  assert.equal(r.expanded, "false");
  assert.equal(r.label, "Open the column");
  assert.equal(r.tip, "Open the column ([)");
  assert.equal(shut[0], 64, "the toolbar is 4rem wide");
  assert.ok(Math.abs(shut[1] - (open[1] + open[0] - 64)) < 2, "the middle takes what the column gave up: " + open + " → " + shut);
  assert.ok(Math.abs(shut[2] - open[2]) < 2, "the right column keeps its width");
  assert.deepEqual(shut.map(Math.round), [64, 944, 432]);
  assert.ok(r.rail <= 64, "Discover's views are icons");
  assert.ok(r.search < 50, "search is an icon");
  assert.equal(r.navWords, "inset(50%)", "the views' words are out of sight, still there for screen readers");
  assert.equal(r.themeFlat, "none", "the theme is a flat icon, as the toolbar's others (no button shadow)");
});

test("a visitor's Live: the stage and the welcome take the middle (Fresh is Discover's); the people button counts and opens the list over the middle", async () => {
  await go("#live");
  const r = await page.evaluate(() => {
    const ppl = document.getElementById("nav-railPeople");
    return { people: !!ppl.offsetParent, expanded: ppl.getAttribute("aria-expanded"), cols: getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns };
  });
  assert.equal(r.people, true, "the people button is in the toolbar in Live");
  assert.equal(r.expanded, "false");
  const cols = r.cols.split(" ").map(parseFloat);
  assert.equal(cols.length, 2, "no column for Fresh: " + cols);
  assert.equal(cols[0], 64);
  assert.ok(Math.abs(cols[1] - (1440 - 64)) < 2, "the stage and the welcome take the rest: " + cols);
  await page.click("#nav-railPeople");
  await page.waitForFunction(() => document.documentElement.classList.contains("rail-peek"), null, { timeout: 3000 });
  const peek = await page.evaluate(() => ({
    expanded: document.getElementById("nav-railPeople").getAttribute("aria-expanded"),
    topbar: document.getElementById("topbar").getBoundingClientRect().width,
    cols: parseFloat(getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns)
  }));
  assert.equal(peek.expanded, "true");
  assert.ok(peek.topbar > 200, "the column shows whole, over the middle");
  assert.equal(peek.cols, 64, "the grid doesn't move under it");
  // the column shows, so its button is a collapse button, at its bottom right; a press puts it away
  const btn = await page.evaluate(() => {
    const b = document.getElementById("nav-railBtn");
    return { label: b.getAttribute("aria-label"), expanded: b.getAttribute("aria-expanded"), icon: getComputedStyle(b.querySelector(".nav-railClose")).display !== "none" && getComputedStyle(b.querySelector(".nav-railOpen")).display === "none",
      corner: b.getBoundingClientRect().right > document.getElementById("topbar").getBoundingClientRect().right - 40 };
  });
  assert.deepEqual(btn, { label: "Collapse the column into a toolbar", expanded: "true", icon: true, corner: true });
  await page.click("#nav-railBtn");
  await page.waitForFunction(() => !document.documentElement.classList.contains("rail-peek"), null, { timeout: 3000 });
  assert.equal(await folded(), true, "collapsing the peek leaves the toolbar, not the column open");
  assert.equal(await page.evaluate(() => document.getElementById("nav-railBtn").getAttribute("aria-label")), "Open the column");
  await page.click("#nav-railPeople");
  await page.waitForFunction(() => document.documentElement.classList.contains("rail-peek"), null, { timeout: 3000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.documentElement.classList.contains("rail-peek"), null, { timeout: 3000 });
  const back = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.id, folded: document.documentElement.classList.contains("rail") }));
  assert.equal(back.focus, "nav-railPeople", "Escape puts the focus back on the people button");
  assert.equal(back.folded, true, "and the toolbar stays");
});

test("search opens the column over the middle; a click outside puts it away", async () => {
  await go("#discover");
  await blur();
  await page.keyboard.press("/");
  await page.waitForFunction(() => document.documentElement.classList.contains("rail-peek") && document.activeElement.id === "dQ", null, { timeout: 3000 });
  const wide = await page.evaluate(() => document.getElementById("dQ").getBoundingClientRect().width);
  assert.ok(wide > 150, "the search box is whole while it's open: " + wide);
  await page.mouse.click(700, 450);
  await page.waitForFunction(() => !document.documentElement.classList.contains("rail-peek"), null, { timeout: 3000 });
  assert.equal(await folded(), true);
});

test("the tooltip says what an icon is", async () => {
  await go("#discover");
  await page.hover('#dNav [data-view="charts"]');
  await page.waitForFunction(() => { const t = document.getElementById("nav-railTip"); return t && t.classList.contains("is-on"); }, null, { timeout: 3000 });
  const r = await page.evaluate(() => {
    const t = document.getElementById("nav-railTip").getBoundingClientRect();
    const b = document.querySelector('#dNav [data-view="charts"]').getBoundingClientRect();
    return { text: document.getElementById("nav-railTip").textContent, right: t.left >= b.right };
  });
  assert.equal(r.text, "Charts");
  assert.equal(r.right, true, "beside the icon, to its right");
  await page.mouse.move(700, 450);
});

test("keys typed in a text box stay text; a narrow screen or the Turntable theme keeps the column as it is", async () => {
  const typed = await page.evaluate(() => {
    const box = document.createElement("input");
    document.body.appendChild(box);
    box.focus();
    return true;
  });
  assert.ok(typed);
  await page.keyboard.press("[");
  await sleep(300);
  assert.equal(await folded(), true, "[ typed in a text box doesn't open it");
  await page.evaluate(() => document.querySelector("body > input:last-of-type").remove());
  // the Turntable theme has its own layout: folded or not, nothing in it moves or shows
  const tt = await page.evaluate(async () => {
    const root = document.documentElement;
    const tick = () => new Promise((r) => setTimeout(r, 50)); // the toolbar hears of the theme a moment later
    const sig = () => [...document.querySelectorAll("#mainGrid > *, #topbar *, #usersbox *, #pe-here, #railLine")].map((e) => {
      const r = e.getBoundingClientRect();
      return [e.id || e.className, getComputedStyle(e).display, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join();
    }).join("|");
    document.body.classList.add("tt-skin");
    await tick();
    const folded = sig();
    const cols = parseFloat(getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns);
    const hidden = ["nav-railBtn", "nav-railPeople", "railLine"].every((id) => getComputedStyle(document.getElementById(id)).display === "none");
    const extras = getComputedStyle(document.getElementById("nav-acctAbout")).display === "none" && document.getElementById("nav-acctRail").hidden;
    root.classList.remove("rail");
    const open = sig();
    root.classList.add("rail");
    document.body.classList.remove("tt-skin");
    await tick();
    return { same: folded === open, cols, hidden: hidden && extras };
  });
  assert.notEqual(tt.cols, 64, "not in the Turntable theme");
  assert.equal(tt.same, true, "the Turntable theme looks the same folded or not");
  assert.equal(tt.hidden, true, "none of the toolbar's buttons, nor Settings' switch, in the Turntable theme");
  // a narrow screen: the button isn't there, and [ does nothing
  await page.setViewportSize({ width: 800, height: 900 });
  await blur();
  await page.keyboard.press("[");
  await sleep(300);
  const narrow = await page.evaluate(() => ({ shown: !!document.getElementById("nav-railBtn").offsetParent, cols: getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns }));
  assert.equal(narrow.shown, false);
  assert.notEqual(parseFloat(narrow.cols), 64);
  assert.equal(await folded(), true, "the choice stays for the wide screen");
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("the toolbar's bottom: search, community, then the button that opens the column, then you; the account menu has the rest", async () => {
  await go("#live");
  const shown = await page.evaluate(() => ["dSearchOpen", "nav-look", "roomInfo", "socialTrigger", "nav-railBtn", "nav-signin"]
    .map((id) => { const e = document.getElementById(id); return e.offsetParent ? Math.round(e.getBoundingClientRect().top) : null; }));
  assert.ok(shown.every((t) => t !== null), "a visitor's light mode and about stay (no account menu): " + shown);
  assert.deepEqual([...shown].sort((x, y) => x - y), shown, "in this order, top to bottom: " + shown);
  assert.ok(shown[5] - shown[4] < 50 && shown[4] - shown[3] < 50, "the button sits between community and Join");
  // a member's light mode and about move to the account menu
  const member = await page.evaluate(() => {
    const grid = document.getElementById("mainGrid");
    grid.classList.remove("login", "pre-auth");
    const out = { look: !!document.getElementById("nav-look").offsetParent, about: !!document.getElementById("roomInfo").offsetParent, community: !!document.getElementById("socialTrigger").offsetParent };
    grid.classList.add("login");
    return out;
  });
  assert.deepEqual(member, { look: false, about: false, community: true });
  // the account menu, folded: About the room and Open the column, after Light mode and the shortcuts
  await page.evaluate(() => document.getElementById("nav-accountMenu").showPopover());
  await sleep(200);
  const menu = await page.evaluate(() => {
    const m = document.getElementById("nav-accountMenu");
    return {
      items: [...m.querySelectorAll(".nav-acctItem:not([hidden])")].map((b) => b.id || b.getAttribute("data-acct")),
      about: document.getElementById("nav-acctAbout").href === document.getElementById("roomInfo").href
    };
  });
  assert.deepEqual(menu.items.filter((i) => ["nav-acctLook", "nav-acctHelp", "nav-acctAbout", "nav-acctRail"].includes(i)), ["nav-acctLook", "nav-acctHelp", "nav-acctAbout", "nav-acctRail"]);
  assert.equal(menu.about, true, "About goes where the header's About does");
  await page.evaluate(() => document.getElementById("nav-acctRail").click()); // a visitor's page: the menu has no face to open from
  await waitFolded(false);
  const open = await page.evaluate(() => {
    const grid = document.getElementById("mainGrid");
    grid.classList.remove("login", "pre-auth");
    const out = {
      menu: document.getElementById("nav-accountMenu").matches(":popover-open"),
      about: getComputedStyle(document.getElementById("nav-acctAbout")).display !== "none",
      rail: document.getElementById("nav-acctRail").hidden,
      // a member's header, the column open: light mode and About are in the account menu
      header: ["nav-look", "roomInfo"].map((id) => !!document.getElementById(id).offsetParent)
    };
    grid.classList.add("login");
    return out;
  });
  assert.deepEqual(open, { menu: false, about: true, rail: true, header: [false, false] }, "with the column open: About stays in the menu, Open the column doesn't; the header has no sun or About");
  await page.click("#nav-railBtn");
  await waitFolded(true);
});

test("Live's toolbar shows who's on the decks; everyone else is behind the count", async () => {
  await go("#live");
  const r = await page.evaluate(() => {
    const here = document.getElementById("pe-here");
    // a visitor's list, as users.js draws it: a DJ, then the rest
    here.innerHTML = '<h2 class="pe-head">In the room <span class="pe-count">3</span></h2><ul class="pe-list">' +
      '<li class="pe-row is-dj"><span class="ft-avatar"></span><span class="pe-name">dj1</span><span class="pe-tag">DJ</span></li>' +
      '<li class="pe-row"><span class="ft-avatar"></span><span class="pe-name">matt</span></li><li class="pe-row"><span class="ft-avatar"></span><span class="pe-name">rook</span></li></ul>';
    const rows = [...here.querySelectorAll(".pe-row")].map((li) => !!li.offsetParent);
    return { rows };
  });
  assert.deepEqual(r.rows, [true, false, false], "the DJ shows; the floor is behind the count");
  await page.waitForFunction(() => document.querySelector("#nav-railPeople .nav-railCount").textContent === "3", null, { timeout: 3000 });
  await page.evaluate(() => { document.getElementById("pe-here").innerHTML = ""; });
});

test("the desk: a wide middle puts your playlist beside Recent or Cards, under a taller stage", async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await go("#live");
  // a member's Live (the page is a visitor's): the room's panels in, as smoke.mjs does
  await page.evaluate(() => {
    window.__shellWasIn = !!document.getElementById("appShell");
    if (firetable.$appShell && !window.__shellWasIn) $("#mainGrid").append(firetable.$appShell);
    document.getElementById("mainGrid").classList.remove("login", "pre-auth");
    firetable.nav.view = "playlists";
    firetable.nav.apply();
  });
  await page.waitForFunction(() => document.documentElement.classList.contains("rail-desk"), null, { timeout: 3000 });
  const r = await page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    const q = box("queuebox"), h = box("thehistoryWrap"), st = box("djStage");
    return {
      side: q.width > 500 && h.width > 500 && q.right <= h.left + 1 && Math.abs(q.top - box("minimodeoptions").top) < 40,
      playlistsTab: !!document.getElementById("mm-playlists").offsetParent,
      recent: document.getElementById("mm-history").getAttribute("aria-selected"),
      stage: st.height > 0.36 * innerHeight,
      fades: firetable.nav._mainPanels.indexOf("#queuebox")
    };
  });
  assert.equal(r.side, true, "the playlist down the left, Recent beside it");
  assert.equal(r.playlistsTab, false, "the playlist is always there: its tab steps aside");
  assert.equal(r.recent, "true", "Recent's tab is lit for the side it's on");
  assert.equal(r.stage, true, "the stage is taller than a third of the screen");
  assert.equal(r.fades, -1, "the playlist doesn't fade when the other side's tab changes");
  await page.evaluate(() => firetable.nav.setMobileTab("mm-cards"));
  await page.waitForFunction(() => !!document.getElementById("cardsWrap").offsetParent && !!document.getElementById("queuebox").offsetParent, null, { timeout: 3000 });
  // narrower: one panel again, the tabs as they were
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => !document.documentElement.classList.contains("rail-desk"), null, { timeout: 3000 });
  const back = await page.evaluate(() => ({ tab: !!document.getElementById("mm-playlists").offsetParent, fades: firetable.nav._mainPanels.indexOf("#queuebox") >= 0, playlists: !document.getElementById("queuebox").offsetParent }));
  assert.deepEqual(back, { tab: true, fades: true, playlists: true });
  await page.evaluate(() => {
    firetable.nav.view = "playlists";
    firetable.nav.apply();
    document.getElementById("mainGrid").classList.add("login");
    if (!window.__shellWasIn) $("#appShell").detach();
  });
});

test("the page paints folded next time, and Settings' switch opens it", async () => {
  // before any script of the page's runs: html.rail and the stylesheet, from js/head.js
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive" && !window.__railAtParse) {
        const css = document.getElementById("nav-railCss");
        window.__railAtParse = { rail: document.documentElement.classList.contains("rail"), css: !!css, blocking: css && css.getAttribute("blocking") };
      }
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.firetable && firetable.started && firetable.rail && document.querySelector('script[src*="rail.js"]'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("nav-railBtn").getAttribute("aria-expanded") === "false", null, { timeout: 5000 });
  const r = await page.evaluate(() => ({ at: window.__railAtParse, box: document.getElementById("railToggle").checked }));
  assert.deepEqual(r.at, { rail: true, css: true, blocking: "render" });
  assert.equal(r.box, true, "Settings' switch shows it's on");
  await page.evaluate(() => { const b = document.getElementById("railToggle"); b.checked = false; b.dispatchEvent(new Event("change")); });
  await waitFolded(false);
  assert.equal(await page.evaluate(() => localStorage.getItem("firetableRail")), "0", "opening it is kept too, as a choice");
  // and the button folds it again
  await page.click("#nav-railBtn");
  await waitFolded(true);
  await page.click("#nav-railBtn");
  await waitFolded(false);
});

test("another tab's choice follows here", async () => {
  const other = await context.newPage();
  await openPage(other, SITE + "#live");
  await other.waitForFunction(() => window.firetable && firetable.started, null, { timeout: 30000 });
  await other.evaluate(() => firetable.rail.set(true));
  await waitFolded(true);
  await other.evaluate(() => firetable.rail.set(false));
  await waitFolded(false);
  await other.close();
});

test("a short laptop screen (1366 by 640): Discover's views scroll under the search, and none goes under the player", async () => {
  await page.setViewportSize({ width: 1366, height: 640 });
  await go("#discover");
  const r = await page.evaluate(() => {
    const nav = document.getElementById("dNav"), views = [...nav.querySelectorAll(".d-nav")].filter((n) => n.offsetParent);
    const box = nav.getBoundingClientRect(), search = document.getElementById("dSearch").getBoundingClientRect(), bar = document.getElementById("dMini").getBoundingClientRect();
    nav.scrollTop = nav.scrollHeight;
    const last = views[views.length - 1].getBoundingClientRect();
    return { scrolls: nav.scrollHeight > nav.clientHeight, under: box.top >= search.bottom, above: box.bottom <= bar.top + 0.5, last: last.top >= box.top - 0.5 && last.bottom <= box.bottom + 0.5 };
  });
  assert.deepEqual(r, { scrolls: true, under: true, above: true, last: true }, "the last view scrolls into sight, over the player");
  await page.evaluate(() => { document.getElementById("dNav").scrollTop = 0; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  assert.equal(await page.evaluate(() => { const n = document.getElementById("dNav"); return n.scrollHeight > n.clientHeight; }), false, "with room, nothing scrolls");
});

// ── With no choice kept: the width's own ─────────────────────────────────

/** A page of its own, `known` once this device has signed in, recording what js/head.js did before any other script. */
async function fresh(width, height, known) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript((k) => {
    if (k) try { localStorage.setItem("ft-has-account", "1"); } catch (e) { /* blocked */ }
    document.addEventListener("readystatechange", () => {
      if (document.readyState !== "interactive") return;
      const css = document.getElementById("nav-railCss");
      window.__railAtParse = { rail: document.documentElement.classList.contains("rail"), css: !!css, blocking: css && css.getAttribute("blocking") };
    });
  }, known);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await openPage(p, SITE + "#discover");
  await p.waitForFunction(() => window.firetable && firetable.started && document.getElementById("modeTabs"), null, { timeout: 30000 });
  return { ctx, p };
}
const toolbar = (p) => p.evaluate(() => ({
  rail: document.documentElement.classList.contains("rail"),
  script: !!document.querySelector('script[src*="rail.js"]'),
  stored: localStorage.getItem("firetableRail")
}));

for (const [width, height] of [[1280, 800], [1366, 768]]) {
  test("a smaller computer screen (" + width + " by " + height + "): a device that has signed in starts folded; [ opens it, and that's kept", async () => {
    const { ctx, p } = await fresh(width, height, true);
    await p.waitForFunction(() => document.querySelector('script[src*="rail.js"]') && document.getElementById("nav-railBtn").getAttribute("aria-expanded") === "false", null, { timeout: 10000 });
    const r = await p.evaluate(() => ({ at: window.__railAtParse, box: document.getElementById("railToggle").checked, label: document.getElementById("nav-railBtn").getAttribute("aria-label") }));
    assert.deepEqual(r.at, { rail: true, css: true, blocking: "render" }, "folded before the first paint");
    assert.equal(r.box, true, "Settings' switch shows it");
    assert.equal(r.label, "Open the column");
    assert.equal((await toolbar(p)).stored, null, "the width's own, not a choice: nothing kept");
    await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await p.keyboard.press("[");
    await p.waitForFunction(() => !document.documentElement.classList.contains("rail"), null, { timeout: 5000 });
    assert.equal((await toolbar(p)).stored, "0", "opening it is a choice, kept");
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.firetable && firetable.started, null, { timeout: 30000 });
    assert.deepEqual(await p.evaluate(() => window.__railAtParse), { rail: false, css: false, blocking: null }, "next time it paints open");
    assert.equal((await toolbar(p)).rail, false);
    await ctx.close();
  });
}

test("a device that hasn't signed in keeps the labelled column on a smaller screen (Join in words), and nothing of the toolbar loads", async () => {
  const { ctx, p } = await fresh(1280, 800, false);
  await sleep(300);
  const r = await p.evaluate(() => ({ at: window.__railAtParse, join: getComputedStyle(document.getElementById("nav-signinLabel")).display !== "none" && !!document.getElementById("nav-signin").offsetParent }));
  assert.deepEqual(r, { at: { rail: false, css: false, blocking: null }, join: true });
  assert.deepEqual(await toolbar(p), { rail: false, script: false, stored: null });
  await ctx.close();
});

test("with no choice kept, the window into the smaller screens' range folds it, and out of it opens it, quietly", async () => {
  const { ctx, p } = await fresh(1440, 900, true);
  await sleep(300);
  assert.deepEqual(await toolbar(p), { rail: false, script: false, stored: null }, "1440: open, and nothing of the toolbar loads");
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForFunction(() => document.documentElement.classList.contains("rail") && document.getElementById("nav-railBtn").getAttribute("aria-expanded") === "false", null, { timeout: 10000 });
  assert.deepEqual(await toolbar(p), { rail: true, script: true, stored: null }, "folded, and not kept: it's the width's");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForFunction(() => !document.documentElement.classList.contains("rail"), null, { timeout: 5000 });
  assert.equal((await toolbar(p)).stored, null);
  // a choice holds across the range: folded at 1440, it stays folded at 1280 and back
  await p.evaluate(() => firetable.rail.set(true));
  await p.waitForFunction(() => document.documentElement.classList.contains("rail"), null, { timeout: 5000 });
  await p.setViewportSize({ width: 1280, height: 800 });
  await sleep(300);
  await p.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  assert.deepEqual(await toolbar(p), { rail: true, script: true, stored: "1" });
  await ctx.close();
});

// ── Discover's right column, folded to a strip (js/side-panel.js) ─────────

/** The right column's button, and what it says. */
const sideBtn = () => page.evaluate(() => {
  const b = document.getElementById("nav-sideBtn"), r = b.getBoundingClientRect(), col = document.getElementById("dSide").getBoundingClientRect();
  const inside = document.querySelector("#dSide > *");
  return {
    label: b.getAttribute("aria-label"), expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls"),
    tip: document.getElementById("tip-nav-sideBtn").textContent, stored: localStorage.getItem("firetableSide"),
    // at the column's top right, or the strip's top
    atTop: r.left >= col.left && r.right <= col.right + 1 && r.top - col.top < 12 && r.right > col.right - 48,
    content: !!(inside && inside.offsetParent)
  };
});
const sideShut = (on) => page.waitForFunction((v) => document.documentElement.classList.contains("side-shut") === v, on, { timeout: 3000 });

test("Discover's right column folds to a strip and opens again: the middle takes the room; kept on this device; the page paints it folded", async () => {
  await go("#discover");
  assert.deepEqual(await sideBtn(), { label: "Fold the side panel", expanded: "true", controls: "dSide", tip: "Fold the side panel", stored: null, atTop: true, content: true });
  // in Discover's page, just before the column: Tab reaches it after the middle, and Shift+Tab from the column's tabs
  await page.focus("#dSide [data-sidetab]");
  await page.keyboard.press("Shift+Tab");
  assert.deepEqual(await page.evaluate(() => ({ focus: document.activeElement.id, in: document.getElementById("nav-sideBtn").parentNode.id, tip: document.getElementById("nav-sideBtn").nextElementSibling.id })),
    { focus: "nav-sideBtn", in: "discoverPage", tip: "tip-nav-sideBtn" });
  await blur();
  await page.click("#nav-sideBtn");
  await sideShut(true);
  assert.deepEqual((await columns()).map(Math.round), [288, 1096, 56], "a 3.5rem strip, and the middle takes the room");
  assert.deepEqual(await sideBtn(), { label: "Open the side panel", expanded: "false", controls: "dSide", tip: "Open the side panel", stored: "1", atTop: true, content: false });
  // the left column folded too
  await page.evaluate(() => firetable.rail.set(true));
  await waitFolded(true);
  await sleep(500);
  assert.deepEqual((await columns()).map(Math.round), [64, 1320, 56], "both folded: the middle has the rest");
  await page.evaluate(() => firetable.rail.set(false));
  await waitFolded(false);
  // Live keeps its own columns, and has no such button
  await go("#live");
  const live = await page.evaluate(() => ({ shown: !!document.getElementById("nav-sideBtn").offsetParent, cols: getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns.split(" ").map((c) => Math.round(parseFloat(c))) }));
  assert.deepEqual(live, { shown: false, cols: [346, 1094] }); // a visitor's: the people, then the stage over the welcome (Fresh is Discover's)
  // next time it paints folded (js/head.js), before any other script
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") window.__sideAtParse = document.documentElement.classList.contains("side-shut");
    });
  });
  await go("#discover");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.firetable && firetable.started && document.getElementById("dSide"), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__sideAtParse), true);
  await sleep(300);
  assert.deepEqual((await columns()).map(Math.round), [288, 1096, 56]);
  // a narrower screen: the column is a sheet there, and the button isn't shown
  await page.setViewportSize({ width: 800, height: 900 });
  await sleep(300);
  assert.equal(await page.evaluate(() => !!document.getElementById("nav-sideBtn").offsetParent), false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  // the button opens it again (Enter, as a keyboard would)
  await page.focus("#nav-sideBtn");
  await page.keyboard.press("Enter");
  await sideShut(false);
  assert.deepEqual((await columns()).map(Math.round), [288, 720, 432]);
  assert.deepEqual(await sideBtn(), { label: "Fold the side panel", expanded: "true", controls: "dSide", tip: "Fold the side panel", stored: null, atTop: true, content: true });
});

test("folding with Chat open goes to Playlists first, so new messages are counted, on the button, which opens Chat again; the full-screen player's list button opens it on Playlists", async () => {
  await go("#discover");
  // a member's Discover (the page is a visitor's): the room's panels in, as the desk's test does, and
  // Playlists and Chat in the right column
  await page.evaluate(() => {
    window.__shellWasIn = !!document.getElementById("appShell");
    if (firetable.$appShell && !window.__shellWasIn) $("#mainGrid").append(firetable.$appShell);
    ftapi.uid = "rail-test";
    firetable.discover.testSignedIn(true);
  });
  await page.waitForFunction(() => document.querySelector('#dSide [data-sidetab="chat"]'), null, { timeout: 5000 });
  await page.click('#dSide [data-sidetab="chat"]');
  await page.waitForFunction(() => document.querySelector('#dSide [data-sidetab="chat"].on') && document.querySelector("#dSide #actualChat"), null, { timeout: 5000 });
  await page.click("#nav-sideBtn");
  await sideShut(true);
  const put = await page.evaluate(() => ({ list: !!document.querySelector('#dSide [data-sidetab="list"].on'), chatAway: !document.querySelector("#dSide #actualChat") }));
  assert.deepEqual(put, { list: true, chatAway: true }, "Chat put away first: Playlists is the column's tab");
  // a message from someone else, while it's folded: counted, and the count is on the button
  await page.evaluate(() => {
    ftapi.events.emit("chatHistoryLoaded");
    ftapi.events.emit("newChat", { chatID: "-NrailTest1", id: "rail-friend", name: "friend", txt: "hello", time: Date.now() });
  });
  await page.waitForFunction(() => document.querySelector("#nav-sideBtn .d-unread").textContent === "1", null, { timeout: 3000 });
  const counted = await page.evaluate(() => ({
    label: document.getElementById("nav-sideBtn").getAttribute("aria-label"),
    tip: document.getElementById("tip-nav-sideBtn").textContent,
    shown: getComputedStyle(document.querySelector("#nav-sideBtn .d-unread")).display !== "none"
  }));
  assert.deepEqual(counted, { label: "Open the side panel: 1 new in Chat", tip: "Open the side panel: 1 new in Chat", shown: true });
  // the button opens it as it was left: on Chat, the message read
  await page.click("#nav-sideBtn");
  await sideShut(false);
  await page.waitForFunction(() => document.querySelector('#dSide [data-sidetab="chat"].on') && document.querySelector("#dSide #actualChat"), null, { timeout: 5000 });
  const chatAgain = await page.evaluate(() => ({ stored: localStorage.getItem("firetableSide"), tab: !!document.querySelector("#dSide .d-unread"), count: document.querySelector("#nav-sideBtn .d-unread").textContent }));
  assert.deepEqual(chatAgain, { stored: null, tab: false, count: "" }, "Chat again, its count cleared");
  // folded from Chat again, a second message counted
  await page.click("#nav-sideBtn");
  await sideShut(true);
  await page.evaluate(() => ftapi.events.emit("newChat", { chatID: "-NrailTest2", id: "rail-friend", name: "friend", txt: "again", time: Date.now() }));
  await page.waitForFunction(() => document.querySelector("#nav-sideBtn .d-unread").textContent === "1", null, { timeout: 3000 });
  // the full-screen player's list button opens the column again, on Playlists
  await page.evaluate(() => firetable.discover.openFull());
  await page.waitForFunction(() => { const b = document.querySelector("#pv-full .pvf-list"); return b && b.checkVisibility(); }, null, { timeout: 5000 });
  await page.click("#pv-full .pvf-list");
  await sideShut(false);
  const back = await page.evaluate(() => ({
    full: firetable.discover.state().full, stored: localStorage.getItem("firetableSide"), list: !!document.querySelector('#dSide [data-sidetab="list"].on'),
    label: document.getElementById("nav-sideBtn").getAttribute("aria-label"), count: document.querySelector("#nav-sideBtn .d-unread").textContent,
    tab: (document.querySelector('#dSide [data-sidetab="chat"] .d-unread') || {}).textContent
  }));
  assert.deepEqual(back, { full: false, stored: null, list: true, label: "Fold the side panel", count: "", tab: "1" }, "open, on Playlists; the count is on Chat's tab again");
  // folded, in a narrower window the column is a sheet: Chat opened there stays as it is when another tab
  // folds it; wider again, it steps aside, so new messages are counted on the button, which opens on Chat
  await page.click("#nav-sideBtn");
  await sideShut(true);
  await page.setViewportSize({ width: 800, height: 900 });
  await sleep(300);
  await page.click(".d-chatnav");
  await page.waitForFunction(() => document.body.classList.contains("d-sheet-open") && document.querySelector('#dSide [data-sidetab="chat"].on'), null, { timeout: 5000 });
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "firetableSide" })));
  assert.equal(await page.evaluate(() => !!document.querySelector('#dSide [data-sidetab="chat"].on') && !!document.querySelector("#dSide #actualChat")), true, "the sheet's Chat as it was");
  await page.click("#dSide .d-sheetclose");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.querySelector('#dSide [data-sidetab="list"].on'), null, { timeout: 5000 });
  assert.deepEqual(await page.evaluate(() => ({ shut: firetable.sidePanel.isShut(), stored: localStorage.getItem("firetableSide") })), { shut: true, stored: "1" }, "wider again: folded still, on Playlists");
  await page.evaluate(() => ftapi.events.emit("newChat", { chatID: "-NrailTest3", id: "rail-friend", name: "friend", txt: "still there?", time: Date.now() }));
  await page.waitForFunction(() => document.querySelector("#nav-sideBtn .d-unread").textContent === "1", null, { timeout: 3000 });
  await page.click("#nav-sideBtn");
  await sideShut(false);
  await page.waitForFunction(() => document.querySelector('#dSide [data-sidetab="chat"].on') && document.querySelector("#dSide #actualChat"), null, { timeout: 5000 });
  await page.evaluate(() => {
    ftapi.uid = null;
    firetable.discover.testSignedIn(false);
    if (!window.__shellWasIn) $("#appShell").detach();
  });
});

test("no page errors", () => {
  assert.deepEqual(errors.filter((e) => !/signal is aborted/.test(e)), []);
});
