// Unit tests for the site's pure functions: escaping, the chat formatter,
// links and images, keys, names, tracks, avatars and dates. They run the
// site's own code, loaded as the site loads it (index.html, under the real
// Content-Security-Policy), so nothing is copied or built. No emulator needed.
//   cd tests && npm ci && npm run unit
// Never deployed. CI: .github/workflows/smoke.yml
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { policy, config, serveSite, launchOptions } from "./harness.mjs";

let browser, page, server;
const errors = [];

before(async () => {
  const site = await serveSite({ csp: policy(), configJs: config("demo-unit") });
  server = site.server;
  browser = await chromium.launch(launchOptions());
  page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(site.SITE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.firetable && firetable.started && firetable.parser && typeof linkifyStr === "function", null, { timeout: 30000 });
});

after(async () => {
  await browser?.close();
  server?.close();
});

/** Run fn(...args) in the page; returns its (serializable) result. */
const run = (fn, ...args) => page.evaluate(([src, a]) => (0, eval)("(" + src + ")")(...a), [fn.toString(), args]);
/** formatChatText in a scratch element: the HTML, plus what the browser made of it. */
const chat = (txt, showImages = false) => run((t, si) => {
  const was = firetable.showImages;
  firetable.showImages = si;
  const html = firetable.ui.formatChatText(t);
  firetable.showImages = was;
  const box = document.createElement("div");
  box.innerHTML = html; // parsed, never attached: nothing loads or runs
  const handlers = [...box.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.name)).filter((n) => /^on/i.test(n));
  return {
    html, text: box.textContent, handlers,
    tags: [...box.querySelectorAll("*")].map((el) => el.tagName.toLowerCase()),
    links: [...box.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel })),
    imgs: [...box.querySelectorAll("img")].map((i) => i.getAttribute("src"))
  };
}, txt, showImages);

// ─── Escaping ────────────────────────────────────────────────────────────────

test("htmlEscape escapes every markup character", async () => {
  assert.equal(await run(() => firetable.utilities.htmlEscape(`<a href="x" onclick='y'>&</a>`)),
    "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(await run(() => firetable.utilities.htmlEscape(5)), "5");
});

test("decodeEntities decodes text without making elements", async () => {
  const r = await run(() => {
    const out = firetable.utilities.decodeEntities("Rock &amp; Roll &lt;img src=x onerror=alert(1)&gt; &#39;hi&#39;");
    return { out, plain: firetable.utilities.decodeEntities("no entities"), nul: firetable.utilities.decodeEntities(null) };
  });
  assert.equal(r.out, "Rock & Roll <img src=x onerror=alert(1)> 'hi'");
  assert.equal(r.plain, "no entities");
  assert.equal(r.nul, "");
});

// ─── The chat formatter ──────────────────────────────────────────────────────

test("chat: markup people type is shown as text, never as elements", async () => {
  for (const attack of [
    `<script>alert(1)</script>`,
    `<img src=x onerror=alert(1)>`,
    `<svg onload=alert(1)>`,
    `&lt;img src=x onerror=alert(1)&gt;`,
    `"><img src=x onerror=alert(1)>`,
    `<a href="javascript:alert(1)">click</a>`,
    `**<b onmouseover=alert(1)>bold</b>**`,
    "`<img src=x onerror=alert(1)>`",
    `<iframe src="https://evil.example"></iframe>`
  ]) {
    const r = await chat(attack);
    assert.deepEqual(r.handlers, [], attack + " → " + r.html);
    assert.ok(!r.tags.some((t) => ["script", "img", "svg", "iframe"].includes(t)), attack + " → " + r.html);
    assert.ok(!r.links.some((l) => /^javascript:/i.test(l.href || "")), attack + " → " + r.html);
  }
});

test("chat: markdown, code and line breaks", async () => {
  const r = await chat("**bold** *it* ~~gone~~ `a < b *c*`\nnext");
  assert.match(r.html, /<strong>bold<\/strong>/);
  assert.match(r.html, /<em>it<\/em>/);
  assert.match(r.html, /<s>gone<\/s>/);
  assert.match(r.html, /<code>a &lt; b \*c\*<\/code>/, "code is escaped and immune to markdown");
  assert.match(r.html, /<br>next$/);
});

test("chat: links open safely in a new tab, untouched by markdown", async () => {
  const r = await chat("see https://example.com/a_b_c*d*e and www.example.org");
  assert.deepEqual(r.links.map((l) => l.href), ["https://example.com/a_b_c*d*e", "http://www.example.org"]);
  for (const l of r.links) {
    assert.equal(l.target, "_blank");
    assert.match(l.rel, /noopener/);
  }
  assert.ok(!/<em>/.test(r.html), "no markdown inside the URL");
});

test("chat: image links become inline images only with Show images on", async () => {
  const off = await chat("https://example.com/cat.png");
  assert.deepEqual(off.imgs, []);
  const on = await chat("https://example.com/cat.png and https://example.com/page", true);
  assert.deepEqual(on.imgs, ["https://example.com/cat.png"]);
  assert.equal(on.links.length, 2);
  const sneaky = await chat(`https://example.com/a.png"onerror="alert(1)`, true);
  assert.deepEqual(sneaky.handlers, []);
});

test("imageLinkUrl: http(s) images only", async () => {
  const r = await run(() => [
    "https://x.test/a.JPG", "http://x.test/b.gif?x=1", "https://x.test/c.png#f", "https://x.test/d.webp",
    "javascript:alert(1)//.png", "data:image/png;base64,AAAA", "ftp://x.test/e.png", "not a url", ""
  ].map((u) => firetable.utilities.imageLinkUrl(u)));
  assert.deepEqual(r, ["https://x.test/a.JPG", "http://x.test/b.gif?x=1", "https://x.test/c.png#f", null, null, null, null, null, null]);
});

test("strip: drops tags and decodes entities", async () => {
  assert.equal(await run(() => firetable.ui.strip("<b>Hi</b> &amp; <i>bye</i>")), "Hi & bye");
});

// ─── Keys and names ──────────────────────────────────────────────────────────

test("isSafeKey: push-style keys only", async () => {
  const r = await run(() => ["-Nabc_09XYZ", "a", "x,*", 'a"b', "a b", "a/b", "a<b", "", "k".repeat(65), 5, null]
    .map((k) => ftapi.utilities.isSafeKey(k)));
  assert.deepEqual(r, [true, true, false, false, false, false, false, false, false, false, false]);
});

test("validateUsername: letters, numbers and _ up to 22", async () => {
  const r = await run(() => ["dj_Ok9", "a".repeat(22), "a".repeat(23), "bad name", "naïve", "", "x.y"]
    .map((n) => ftapi.utilities.validateUsername(n).valid));
  assert.deepEqual(r, [true, true, false, false, false, false, false]);
  assert.match(await run(() => ftapi.utilities.validateUsername("a".repeat(25)).reason), /Remove at least 3/);
});

test("grabKey: a database-safe key for any track", async () => {
  const r = await run(() => [firetable.utilities.grabKey(1, "dQw4w9WgXcQ"), firetable.utilities.grabKey(2, 123), firetable.utilities.grabKey(1, "a.b/c#d$e[f]"), firetable.utilities.grabKey(1, "x".repeat(80)).length]);
  assert.deepEqual(r, ["1_dQw4w9WgXcQ", "2_123", "1_a_b_c_d_e_f_", 66]);
});

// ─── Playlists ───────────────────────────────────────────────────────────────

test("findTrack: by key, or by track when the slot changed", async () => {
  const r = await run(() => {
    const items = [{ key: "k1", track: { cid: "a" } }, { key: "k2", track: { cid: "b" } }, { key: "k3", track: { cid: 7 } }];
    const f = ftapi.utilities.findTrack;
    return [f(items, "k2"), f(items, "k2", "b"), f(items, "k2", "a"), f(items, "gone", 7), f(items, "gone"), f(items, "gone", "zzz")];
  });
  assert.deepEqual(r, [1, 1, 0, 2, -1, -1]);
});

test("shuffle keeps every track", async () => {
  const r = await run(() => ftapi.utilities.shuffle(Array.from({ length: 50 }, (_, i) => i)).slice().sort((a, b) => a - b));
  assert.deepEqual(r, Array.from({ length: 50 }, (_, i) => i));
});

// ─── Avatars, seasons, dates ─────────────────────────────────────────────────

test("normalizeAvatarStyle and the seasonal default", async () => {
  const r = await run(() => [
    firetable.utilities.normalizeAvatarStyle("set2"), firetable.utilities.normalizeAvatarStyle("dicebear:bottts"),
    firetable.utilities.normalizeAvatarStyle(""), firetable.utilities.normalizeAvatarStyle(null),
    firetable.utilities.seasonalAvatarStyle(new Date(2026, 9, 15)), firetable.utilities.seasonalAvatarStyle(new Date(2026, 4, 15))
  ]);
  assert.deepEqual(r.slice(0, 4), ["robohash:set2", "dicebear:bottts", null, null]);
  assert.equal(r[4], "robohash:set2", "monsters in October");
  assert.equal(r[5], null);
});

test("avatarURL: names and ids are encoded into the address", async () => {
  const r = await run(() => [
    firetable.utilities.avatarURL("u1", "Name", "40x40", "robohash:set4", true),
    firetable.utilities.avatarURL("u1", "a b&c", null, "dicebear:pixel-art", true)
  ]);
  assert.equal(r[0], AVATAR_BASE_URL_FOR_TEST + "u1Name.png?size=40x40&set=set4");
  assert.equal(r[1], "https://api.dicebear.com/9.x/pixel-art/svg?seed=u1a%20b%26c");
});
const AVATAR_BASE_URL_FOR_TEST = "https://indiediscotheque.com/robots/";

test("dates and times", async () => {
  const r = await run(() => {
    const thisYear = new Date().getFullYear();
    return [
      firetable.utilities.format_time(new Date(2026, 0, 1, 0, 5)), firetable.utilities.format_time(new Date(2026, 0, 1, 12, 30)),
      firetable.utilities.format_time(new Date(2026, 0, 1, 23, 9)),
      firetable.utilities.shortDate(new Date(thisYear, 10, 10)), firetable.utilities.shortDate(new Date(2011, 10, 10)),
      firetable.utilities.pluralize(1, "play"), firetable.utilities.pluralize(2, "play"), firetable.utilities.pluralize(2, "person", "people")
    ];
  });
  assert.deepEqual(r, ["12:05am", "12:30pm", "11:09pm", "Nov 10", "Nov 10, 2011", "1 play", "2 plays", "2 people"]);
});

test("no page errors while the site loaded and ran these", () => {
  assert.deepEqual(errors, []);
});
