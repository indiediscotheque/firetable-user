// The left column folded into a toolbar (js/rail.js, css/rail.css), on wide
// screens: nothing of it loads before it's used; the button, the [ key and
// Settings' switch fold it and open it again; the middle takes the room it
// gives up while chat keeps its width; the choice is kept on the device and
// the page paints folded next time; who's here and search open the column
// over the middle for a moment; it never applies on a narrow screen or in the
// Turntable theme. A visitor's page, under the real Content-Security-Policy.
// No emulator needed.
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
      people: !!document.getElementById("nav-railPeople").offsetParent
    };
  });
  assert.equal(r.script, false, "js/rail.js isn't loaded with the page");
  assert.equal(r.css, false, "css/rail.css isn't loaded with the page");
  assert.equal(r.shown, true, "the button is by the logo on a wide screen");
  assert.equal(r.expanded, "true");
  assert.equal(r.label, "Collapse the column into a toolbar");
  assert.equal(r.people, false, "the toolbar's people button only shows in the toolbar");
});

test("[ folds it: the middle gets the room, chat keeps its width; kept on this device", async () => {
  await go("#discover");
  const open = await columns();
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
    navWords: getComputedStyle(document.querySelector("#dNav .d-nav span")).clipPath
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
  assert.ok(r.rail <= 64, "Discover's views are icons");
  assert.ok(r.search < 50, "search is an icon");
  assert.equal(r.navWords, "inset(50%)", "the views' words are out of sight, still there for screen readers");
});

test("a visitor's Live: the room goes to Fresh; the people button counts and opens the list over the middle", async () => {
  await go("#live");
  const r = await page.evaluate(() => {
    const ppl = document.getElementById("nav-railPeople");
    return { people: !!ppl.offsetParent, expanded: ppl.getAttribute("aria-expanded"), cols: getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns };
  });
  assert.equal(r.people, true, "the people button is in the toolbar in Live");
  assert.equal(r.expanded, "false");
  const cols = r.cols.split(" ").map(parseFloat);
  assert.equal(cols[0], 64);
  assert.ok(Math.abs(cols[1] - 0.46 * 1440) < 2, "the stage and the welcome keep their column: " + cols);
  assert.ok(Math.abs(cols[2] - (1440 - 64 - 0.46 * 1440)) < 2, "Fresh takes the rest: " + cols);
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
  // the Turntable theme has its own layout
  const tt = await page.evaluate(() => {
    document.body.classList.add("tt-skin");
    const cols = getComputedStyle(document.getElementById("mainGrid")).gridTemplateColumns;
    document.body.classList.remove("tt-skin");
    return parseFloat(cols);
  });
  assert.notEqual(tt, 64, "not in the Turntable theme");
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
  assert.equal(await page.evaluate(() => localStorage.getItem("firetableRail")), null, "opening it is kept too");
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

test("no page errors", () => {
  assert.deepEqual(errors.filter((e) => !/signal is aborted/.test(e)), []);
});
