// Google Analytics (js/analytics.js): the tag is on every page of the site and
// on none of the embeds, loads nothing from the tests' own address or for a
// browser that asks not to be tracked, and on the live site runs under the
// real Content-Security-Policy from .htaccess: Google's script loads, every
// measurement ID is set up, the places it reports to are allowed, and a
// one-time ?token= never leaves. Google's hosts are stand-ins here, so no
// visit is ever counted. No emulator needed.
//   cd tests && npm ci && npm run unit
// Never deployed. CI: .github/workflows/smoke.yml
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";
import { ROOT, policy, config, serveSite, launchOptions } from "./harness.mjs";

const WITH = ["index.html", "about/index.html", "privacy/index.html", "terms/index.html"];
const WITHOUT = ["offline.html", "embed/chart/index.html", "embed/stage/index.html"];
const TAG = /<script async src="(?:\.\.\/)?js\/analytics\.js\?v=[^"]*" data-id="([^"]+)"><\/script>/g;
// a name that isn't this computer's own, as the live site's isn't (harness.mjs maps it here)
const LIVE = "live.test";
// where Google's tag reports: its two collectors, their regional copies, and Google signals'
const COLLECTORS = ["https://www.google-analytics.com", "https://region1.google-analytics.com", "https://analytics.google.com",
  "https://region1.analytics.google.com", "https://stats.g.doubleclick.net"];
// Google's script, stood in for: it says it ran, and reports to each collector
const STUB = `window.__tag = { loads: (window.__tag ? window.__tag.loads : 0) + 1, sent: [] };
${JSON.stringify(COLLECTORS)}.forEach(function (to) {
  fetch(to + "/g/collect?v=2", { method: "POST", mode: "no-cors" }).then(function () { window.__tag.sent.push(to); }, function () {});
});`;
const GOOGLE = (url) => /(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)$/.test(url.hostname);

let browser, server, port;
const ids = () => [...readFileSync(join(ROOT, "index.html"), "utf8").matchAll(TAG)][0][1].split(" ");

before(async () => {
  const site = await serveSite({ csp: policy(), configJs: config("demo-analytics") });
  server = site.server;
  port = new URL(site.SITE).port;
  browser = await chromium.launch(launchOptions({ hosts: [LIVE] }));
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** Open `path` on `host`; resolves the page, what it asked Google for, and what the policy blocked. */
async function visit(host, path, { gpc = false } = {}) {
  const context = await browser.newContext();
  const asked = [], blocked = [];
  await context.route(GOOGLE, (route) => {
    const url = new URL(route.request().url());
    asked.push(url.origin + url.pathname + url.search);
    if (url.hostname === "www.googletagmanager.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: STUB });
    return route.fulfill({ status: 204, body: "" });
  });
  await context.exposeFunction("__blocked", (v) => blocked.push(v));
  await context.addInitScript((off) => {
    document.addEventListener("securitypolicyviolation", (e) => window.__blocked(e.violatedDirective + " blocked " + e.blockedURI));
    if (off) Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { configurable: true, get: () => true });
  }, gpc);
  const page = await context.newPage();
  await page.goto("http://" + host + ":" + port + "/" + path, { waitUntil: "load" });
  return { page, asked, blocked, close: () => context.close() };
}
/** What js/analytics.js queued for Google's script: [["js", …], ["config", id, options], …] */
const queued = (page) => page.evaluate(() => (window.dataLayer || []).map((entry) => JSON.parse(JSON.stringify(Array.from(entry)))));

test("every page of the site has the tag, with the same IDs; the embeds and the offline page don't", () => {
  const want = ids();
  assert.ok(want.length >= 1 && want.every((id) => /^G-[A-Z0-9]{4,20}$/.test(id)), "measurement IDs: " + want);
  for (const file of WITH) {
    const tags = [...readFileSync(join(ROOT, file), "utf8").matchAll(TAG)];
    assert.equal(tags.length, 1, file + " has the tag once");
    assert.deepEqual(tags[0][1].split(" "), want, file + " has the same IDs as index.html");
  }
  for (const file of WITHOUT) assert.ok(!/analytics\.js|googletagmanager/.test(readFileSync(join(ROOT, file), "utf8")), file + " has no tag");
});

test("nothing is loaded from this computer's own address (development, the tests)", async () => {
  const v = await visit("127.0.0.1", "about/");
  await v.page.waitForTimeout(300);
  assert.deepEqual(v.asked, []);
  assert.equal(await v.page.evaluate(() => typeof window.gtag), "undefined");
  await v.close();
});

test("on the live site Google's tag loads once, every ID is set up, and the policy lets it report", async () => {
  for (const path of ["about/", "privacy/", "terms/"]) {
    const v = await visit(LIVE, path);
    await v.page.waitForFunction((n) => window.__tag && window.__tag.sent.length === n, COLLECTORS.length, { timeout: 10000 })
      .catch(() => { /* the asserts below say what's missing */ });
    assert.deepEqual(v.blocked, [], path + ": nothing blocked by the Content-Security-Policy");
    assert.deepEqual((await v.page.evaluate(() => window.__tag.sent)).sort(), [...COLLECTORS].sort(), path + ": every collector reached");
    assert.equal(await v.page.evaluate(() => window.__tag.loads), 1);
    assert.deepEqual(v.asked.filter((u) => u.includes("googletagmanager")), ["https://www.googletagmanager.com/gtag/js?id=" + ids()[0]]);
    const q = await queued(v.page);
    assert.equal(q[0][0], "js");
    assert.deepEqual(q.slice(1), ids().map((id) => ["config", id]), path + ": one config per ID, the page's address as it is");
    await v.close();
  }
});

test("a one-time ?token= never leaves: the page is reported with only its campaign parameters", async () => {
  const v = await visit(LIVE, "about/?token=secret&utm_source=newsletter&ref=x&gclid=abc");
  await v.page.waitForFunction(() => window.__tag, null, { timeout: 10000 });
  const clean = "http://" + LIVE + ":" + port + "/about/?utm_source=newsletter&gclid=abc";
  assert.deepEqual((await queued(v.page)).slice(1), ids().map((id) => ["config", id, { page_location: clean }]));
  assert.ok(!v.asked.some((u) => u.includes("secret")));
  await v.close();
});

test("a browser sending Global Privacy Control loads nothing", async () => {
  const v = await visit(LIVE, "about/", { gpc: true });
  await v.page.waitForTimeout(300);
  assert.deepEqual(v.asked, []);
  assert.equal(await v.page.evaluate(() => typeof window.gtag), "undefined");
  await v.close();
});
