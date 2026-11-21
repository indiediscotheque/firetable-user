// Unit tests for the site's pure functions: escaping, the chat formatter,
// links and images, keys, names, tracks, avatars and dates. They run the
// site's own code, loaded as the site loads it (index.html, under the real
// Content-Security-Policy), so nothing is copied or built. No emulator needed.
//   cd tests && npm ci && npm run unit
// Never deployed. CI: .github/workflows/smoke.yml
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { policy, config, serveSite, launchOptions, openPage } from "./harness.mjs";

let browser, page, server;
const errors = [];

before(async () => {
  const site = await serveSite({ csp: policy(), configJs: config("demo-unit") });
  server = site.server;
  browser = await chromium.launch(launchOptions());
  page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await openPage(page, site.SITE);
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

// ─── Lean tracks ─────────────────────────────────────────────────────────────

test("leanTrack: a YouTube track's own thumbnail and watch page aren't saved; anything else is (as the hostbot's lib/tracks.js)", async () => {
  const r = await run(() => {
    const lean = ftapi.utilities.leanTrack;
    const yt = { type: 1, cid: "abcDEF12345", name: "A - B", img: "https://i.ytimg.com/vi/abcDEF12345/mqdefault.jpg", url: "https://www.youtube.com/watch?v=abcDEF12345", from: "discover" };
    return {
      yt: lean(yt), untouched: !!yt.img,
      webp: lean({ type: 1, cid: "abcDEF12345", img: "https://i9.ytimg.com/vi_webp/abcDEF12345/maxresdefault.webp" }),
      short: lean({ type: 1, cid: "abcDEF12345", url: "https://youtu.be/abcDEF12345" }),
      other: lean({ type: 1, cid: "abcDEF12345", img: "https://i.ytimg.com/vi/zzzZZZ99999/mqdefault.jpg" }),
      start: lean({ type: 1, cid: "abcDEF12345", url: "https://www.youtube.com/watch?v=abcDEF12345&t=30" }),
      custom: lean({ type: 1, cid: "abcDEF12345", img: "https://example.com/cover.jpg" }),
      sc: lean({ type: 2, cid: 123, img: "https://i1.sndcdn.com/artworks-x-large.jpg", url: "https://soundcloud.com/a/b" }),
      none: lean(null)
    };
  });
  assert.deepEqual(r.yt, { type: 1, cid: "abcDEF12345", name: "A - B", from: "discover" });
  assert.equal(r.untouched, true, "the track passed in is left as it was");
  assert.deepEqual(r.webp, { type: 1, cid: "abcDEF12345" });
  assert.deepEqual(r.short, { type: 1, cid: "abcDEF12345" });
  assert.equal(r.other.img, "https://i.ytimg.com/vi/zzzZZZ99999/mqdefault.jpg", "another video's thumbnail is kept");
  assert.equal(r.start.url, "https://www.youtube.com/watch?v=abcDEF12345&t=30", "a link with a start time is kept");
  assert.equal(r.custom.img, "https://example.com/cover.jpg");
  assert.deepEqual(r.sc, { type: 2, cid: 123, img: "https://i1.sndcdn.com/artworks-x-large.jpg", url: "https://soundcloud.com/a/b" });
  assert.equal(r.none, null);
});

// ─── The chat formatter ──────────────────────────────────────────────────────

test("YouTube names: the artist from the title or the channel, and the real one for YouTube's stand-in \"Release - Topic\"", async () => {
  const full = "Provided to YouTube by DistroKid\n\nFresh Song · New Band · Guest\n\n℗ 2026 New Band\n\nReleased on: 2026-11-07\n\nAuto-generated by YouTube.";
  const got = await run((full) => {
    const u = firetable.utilities;
    return [
      u.youtubeTrackName("Fresh Song", "Release - Topic", full),
      u.youtubeTrackName("Fresh Song", "Release - Topic", "Provided to YouTube by DistroKid Fresh Song · New Band ℗ 2026 New Band"),
      u.youtubeTrackName("Fresh Song", "Release - Topic", ""),
      u.youtubeTrackName("Fresh Song", "Various Artists - Topic", full),
      u.youtubeTrackName("Karma Police", "Radiohead - Topic", ""),
      u.youtubeTrackName("Radiohead - Karma Police (Official Video)", "RadioheadVEVO", ""),
      u.youtubeTrackName("Rock &amp; Roll", "Band &amp; Friends - Topic", ""),
      u.youtubeTrackName("Fresh Song", "", ""),
      u.descriptionArtist("Provided to YouTube by DistroKid Fresh Song · New Ba", "Fresh Song"),
      u.isStandInArtist("Release"), u.isStandInArtist("Released")
    ];
  }, full);
  assert.deepEqual(got, [
    "New Band - Fresh Song", "New Band - Fresh Song", "Fresh Song", "New Band - Fresh Song",
    "Radiohead - Karma Police", "Radiohead - Karma Police", "Band & Friends - Rock & Roll", "Fresh Song",
    "", true, false
  ]);
});

test("apTitleCase puts tags in AP title case, keeping names' own capitals and Rohn Standard Notation", async () => {
  const cases = {
    "the cure - friday i'm in love": "The Cure - Friday I'm in Love",
    "THE CURE - FRIDAY I'M IN LOVE": "The Cure - Friday I'm in Love",
    "florence and the machine - dog days are over": "Florence and the Machine - Dog Days Are Over",
    "drake - one dance feat. wizkid & kyla (tame impala remix)": "Drake - One Dance feat. Wizkid & Kyla (Tame Impala Remix)",
    "artist - come in feat. the weeknd": "Artist - Come In feat. The Weeknd",
    "kendrick lamar vs. drake - the heart part 5": "Kendrick Lamar vs. Drake - The Heart Part 5",
    "a tribe called quest - can i kick it?": "A Tribe Called Quest - Can I Kick It?",
    "bruce springsteen - born to run": "Bruce Springsteen - Born to Run",
    "artist - title: a subtitle of things": "Artist - Title: A Subtitle of Things",
    "AC/DC - back in black": "AC/DC - Back in Black",
    "MGMT - kids": "MGMT - Kids",
    "Paul McCartney - an iPhone song (DJ Shadow remix)": "Paul McCartney - An iPhone Song (DJ Shadow Remix)",
    "will.i.am - scream & shout": "will.i.am - Scream & Shout",
    "elvis - rock 'n' roll": "Elvis - Rock 'n' Roll",
    "nas - hip-hop is dead": "Nas - Hip-Hop Is Dead",
    "artist - up-to-date": "Artist - Up-to-Date",
    "artist - shut up and dance": "Artist - Shut Up and Dance",
    "the who - who are you": "The Who - Who Are You",
    "2pac - california love": "2pac - California Love",
    "artist – song [live at the roxy]": "Artist – Song [Live at the Roxy]",
    "  spaced  out -  kept ": "  Spaced  Out -  Kept ",
    "": ""
  };
  const got = await run((ins) => ins.map((s) => firetable.utilities.apTitleCase(s)), Object.keys(cases));
  assert.deepEqual(got, Object.values(cases));
  assert.equal(await run(() => firetable.utilities.apTitleCase(null)), "");
});

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
  assert.deepEqual(r.slice(0, 4), ["robohash:set2", null, null, null]);
  assert.equal(r[4], "robohash:set2", "monsters in October");
  assert.equal(r[5], null);
});

test("the room's six avatar styles, robots by default", async () => {
  const r = await run(() => ({
    styles: AVATAR_STYLES.map((s) => s.value), def: DEFAULT_AVATAR_STYLE,
    kept: AVATAR_STYLES.map((s) => firetable.utilities.normalizeAvatarStyle(s.value)),
    gone: ["robohash:set3", "set3", "dicebear:bottts", "dicebear:adventurer", "https://x/y.png"].map(firetable.utilities.normalizeAvatarStyle),
    kinds: AVATAR_STYLES.map((s) => firetable.utilities.avatarKind(s.value)),
    menu: [...document.querySelectorAll("#mo-avatarStyle option")].map((o) => o.value),
    // with no choice, no config and no season, the room is robots
    fallback: firetable.utilities.avatarURL("u1", "Name", "40x40", "dicebear:bottts", true)
  }));
  assert.deepEqual(r.styles, ["robohash:set1", "robohash:set2", "robohash:set4", "dicebear:notionists", "dicebear:pixel-art", "bouletmaton"]);
  assert.equal(r.def, "robohash:set1");
  assert.deepEqual(r.kept, r.styles);
  assert.deepEqual(r.gone, [null, null, null, null, null]);
  assert.deepEqual(r.kinds, ["robohash", "robohash", "robohash", "notionists", "pixel-art", "bouletmaton"]);
  assert.deepEqual(r.menu, [""].concat(r.styles), "Mod tools offers the room's default and the six");
  assert.match(r.fallback, /set=set[12]$/, "a style the room no longer offers falls back to the room's");
});

test("Bouletmaton: codes, the one made from a uid (the bot's too), and the drawing", async () => {
  const r = await run(async () => {
    const B = Bouletmaton;
    const ids = ["OiJ7rcoNaNdvk3KlFGUJx1Fqjer2", "dj1", "", "abc", "zZ9"];
    const many = Array.from({ length: 300 }, (_, i) => B.random("u" + i));
    const c = B.random("dj1");
    const canvas = await B.draw(c, 256);
    const g = canvas.getContext("2d").getImageData(0, 0, 256, 256).data;
    let opaque = 0, corners = 0;
    for (let i = 3; i < g.length; i += 4) if (g[i] > 0) opaque++;
    [[0, 0], [255, 0]].forEach(([x, y]) => { corners += g[(y * 256 + x) * 4 + 3]; });
    const layers = B.layers(c);
    const loads = await Promise.all(layers.map((u) => fetch(u).then((res) => res.ok)));
    // every part's every file is there
    const files = [];
    B.PARTS.forEach((p) => {
      for (let v = p.min; v <= p.max; v++) {
        const dir = p.dir === "skin" ? "skintone4" : p.dir === "hair" ? "haircolor12" : p.dir;
        files.push(B.BASE + dir + "/" + p.file + v + ".png");
      }
    });
    const there = await Promise.all(files.map((u) => fetch(u, { method: "HEAD" }).then((res) => res.ok)));
    return {
      made: ids.map(B.random), same: B.random("dj1") === B.random("dj1"),
      allValid: many.every(B.isCode), distinct: new Set(many).size,
      roundTrip: many.every((x) => B.encode(B.decode(x)) === x),
      bad: ["", "5.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1", "1.1.0.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1", "1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1", 42].map(B.isCode),
      clamped: B.encode({ skin: 9, hair: 0, parts: { body: 999, hat: 0, head: -1 } }),
      opaque: opaque / (256 * 256), corners, loads: loads.every(Boolean), layers: layers.length,
      files: files.length, missing: files.filter((u, i) => !there[i]).slice(0, 3),
      transparent: B.layers(c).every((u) => !/background/.test(u))
    };
  });
  // the same uids give these codes in the bot (firetable-hostbot lib/avatars.js randomBoulet, its unit test)
  assert.deepEqual(r.made, ["1.12.47.41.9.12.17.2.65.16.0.0.0.69.0.13.0.0", "1.2.25.14.10.0.37.32.14.32.0.0.0.0.4.0.15.0",
    "3.6.26.4.4.0.24.15.54.27.0.0.0.2.13.0.5.3", "3.8.56.26.12.8.49.1.69.32.0.0.0.61.17.0.19.0", "3.11.46.26.6.3.57.29.63.11.11.0.3.69.7.0.0.0"]);
  assert.ok(r.same && r.allValid && r.roundTrip);
  assert.ok(r.distinct > 295, "made-up ones differ (" + r.distinct + " of 300)");
  assert.deepEqual(r.bad, [false, false, false, false, false]);
  assert.equal(r.clamped, "1.1.1.1.1.2.1.1.1.1.1.1.1.1.1.1.0.1", "out of range or left out: the first; 0 is none where a part can be left off");
  assert.ok(r.loads && r.layers >= 8, "every layer loads (" + r.layers + ")");
  assert.deepEqual(r.missing, [], "every part's files are in img/bouletmaton/ (" + r.files + ")");
  assert.ok(r.opaque > 0.15 && r.opaque < 0.8, "it's drawn (" + r.opaque + ")");
  assert.equal(r.corners, 0, "on a transparent background");
});

test("Bouletmaton: a stand-in at once, swapped for the picture wherever it was put", async () => {
  const r = await run(async () => {
    const was = firetable.roomAvatarStyle, users = ftapi.users;
    firetable.roomAvatarStyle = "bouletmaton";
    ftapi.users = Object.assign({}, users, { swapme: { username: "Name", status: true } }); // in the room, with none saved
    const url = firetable.utilities.avatarURL("swapme", "Name", "40x40");
    const el = document.createElement("span");
    el.className = "ft-avatar";
    el.style.backgroundImage = "url(" + url + ")";
    document.body.appendChild(el);
    const img = document.createElement("img");
    img.src = firetable.utilities.avatarURL("swapme", "Name", "40x40");
    document.body.appendChild(img);
    const t0 = Date.now();
    while (/#bm=/.test(el.style.backgroundImage + img.src) && Date.now() - t0 < 10000) await new Promise((ok) => setTimeout(ok, 50));
    const after = el.style.backgroundImage;
    const again = firetable.utilities.avatarURL("swapme", "Name", "40x40");
    firetable.roomAvatarStyle = was;
    ftapi.users = users;
    el.remove(); img.remove();
    return { url, after, img: img.src, again };
  });
  assert.match(r.url, /blank\.svg#bm=/);
  assert.match(r.after, /^url\("blob:/, "the circle got the picture");
  assert.match(r.img, /^blob:/, "the <img> got the picture");
  assert.match(r.again, /^blob:/, "once drawn, it's given straight away");
});

test("avatarURL: names and ids are encoded into the address", async () => {
  const r = await run(() => [
    firetable.utilities.avatarURL("u1", "Name", "40x40", "robohash:set4", true),
    firetable.utilities.avatarURL("u1", "a b&c", null, "dicebear:pixel-art", true)
  ]);
  assert.equal(r[0], AVATAR_BASE_URL_FOR_TEST + "u1Name.png?size=40x40&set=set4");
  assert.equal(r[1], "https://api.dicebear.com/9.x/pixel-art/svg?seed=u1a%20b%26c");
});

test("trading cards print the avatar the room had: robots, cats, DiceBear, the DJ's Bouletmaton", async () => {
  const r = await run(async () => {
    const draw = (card) => new Promise((ok) => {
      const c = document.createElement("canvas");
      c.id = "cardMakertest" + Math.random().toString(36).slice(2);
      c.width = 225; c.height = 300;
      document.body.appendChild(c);
      const seen = [];
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
      Object.defineProperty(HTMLImageElement.prototype, "src", { configurable: true, get: desc.get, set(v) { seen.push(String(v)); desc.set.call(this, v); } });
      firetable.actions.displayCard(Object.assign({ djid: "dj1", djname: "Deejay", title: "T", artist: "A", image: "img/idlogo.png", colors: { color: "#336699", txt: "#fff" }, cardnum: 1, num: "1", temp: 120, date: 0 }, card), c.id.slice(9));
      setTimeout(() => { Object.defineProperty(HTMLImageElement.prototype, "src", desc); c.remove(); ok(seen); }, 1500);
    });
    return {
      old: await draw({ set: "set3" }),
      cats: await draw({ set: "set4", avs: "robohash:set4" }),
      dice: await draw({ set: "set1", avs: "dicebear:notionists" }),
      boulet: await draw({ set: "set1", avs: "bouletmaton", bm: "2.5.12.30.4.9.40.10.50.20.0.8.3.40.0.0.12.0" }),
      made: await draw({ set: "set1", avs: "bouletmaton" })
    };
  });
  const avatarOf = (seen) => seen.find((u) => /robots\/|dicebear|^blob:/.test(u)) || "";
  assert.match(avatarOf(r.old), /set=set3$/, "a card printed before styles keeps its robot as printed");
  assert.match(avatarOf(r.cats), /set=set4$/);
  assert.match(avatarOf(r.dice), /dicebear\.com\/9\.x\/notionists\//);
  assert.match(avatarOf(r.boulet), /^blob:/, "the DJ's Bouletmaton, drawn");
  assert.match(avatarOf(r.made), /^blob:/, "the one made from their uid when none was stamped");
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

test("saveFailed: tells the person once per burst, and swallows the error", async () => {
  const r = await run(() => {
    const shown = [];
    const toast = firetable.ui.toast, log = console.error;
    firetable.ui.toast = (msg, type) => shown.push(type + ": " + msg);
    console.error = () => {};
    ftapi._saveFailedShown = null;
    const back = ftapi.saveFailed("the new order")(new Error("PERMISSION_DENIED"));
    for (let i = 0; i < 5; i++) ftapi.saveFailed("the new order")(new Error("again"));
    ftapi.saveFailed("x", "Couldn't send that message.")(new Error("no"));
    firetable.ui.toast = toast;
    console.error = log;
    return { shown, back: back === undefined };
  });
  assert.deepEqual(r.shown, ["error: Couldn't save the new order. Try again in a moment.", "error: Couldn't send that message."]);
  assert.ok(r.back);
});

test("no page errors while the site loaded and ran these", () => {
  assert.deepEqual(errors, []);
});
