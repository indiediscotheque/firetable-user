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

test("recentPlays.nameKey: the same song across uploads (as the hostbot's lib/repeats.js), and where Next really is", async () => {
  const r = await run(async () => {
    await ftLazy.own("recent-js", "js/recent-plays.js");
    const k = firetable.recentPlays.nameKey;
    return {
      keys: [k("Röyksopp - Running to the Sea (Official Video)"), k("ROYKSOPP – Running To The Sea [HD]"), k("Röyksopp - Running to the Sea feat. Susanne Sundfør"),
        k("Simon & Garfunkel - Cecilia (2011 Remaster)"), k("Art - Song (Someone Remix)"), k("Intro"), k(null)],
      next: firetable.recentPlays.nextKey({ a: { type: 1, cid: "x", flagged: { code: 2 } }, b: { type: 1, cid: "y", name: "B - B" } }),
      none: firetable.recentPlays.nextKey({})
    };
  });
  assert.deepEqual(r.keys, ["royksopp running to the sea", "royksopp running to the sea", "royksopp running to the sea",
    "simon and garfunkel cecilia", "art song someone remix", "", ""]);
  assert.equal(r.next, "b", "a flagged track is never next");
  assert.equal(r.none, null);
});

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

test("chatImages.src: http(s) images and known image hosts only", async () => {
  const r = await run(() => [
    "https://x.test/a.JPG", "http://x.test/b.gif?x=1", "https://x.test/c.png#f", "https://x.test/d.webp", "https://x.test/e.avif",
    "https://imgur.com/AbC1234", "https://i.imgur.com/AbC1234.gifv", "https://imgur.com/a/AbC1234",
    "https://giphy.com/gifs/cat-dance-xT9IgG50Fb7Mi0prBC", "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif",
    "https://pbs.twimg.com/media/Fab123?format=jpg&name=small", "https://pbs.twimg.com/media/Fab123",
    "javascript:alert(1)//.png", "data:image/png;base64,AAAA", "ftp://x.test/e.png", "https://x.test/page", "not a url", ""
  ].map((u) => firetable.chatImages.src(u)));
  assert.deepEqual(r, [
    "https://x.test/a.JPG", "http://x.test/b.gif?x=1", "https://x.test/c.png#f", "https://x.test/d.webp", "https://x.test/e.avif",
    "https://i.imgur.com/AbC1234.jpg", "https://i.imgur.com/AbC1234.gif", null,
    "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif", "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif",
    null, null,
    null, null, null, null, null, null
  ]);
});

test("chat: a hosted image links to the page posted, shows the picture, and loads privately", async () => {
  const r = await chat("look https://imgur.com/AbC1234", true);
  assert.deepEqual(r.imgs, ["https://i.imgur.com/AbC1234.jpg"]);
  assert.equal(r.links[0].href, "https://imgur.com/AbC1234");
  assert.match(r.html, /referrerpolicy="no-referrer"/);
  assert.match(r.html, /loading="lazy"/);
  assert.match(r.html, /alt="Image from imgur.com"/);
});

test("chatImages.setEnabled: turns links already in chat into pictures and back", async () => {
  const r = await run(() => {
    const shell = firetable.$appShell && firetable.$appShell[0]; // set aside while logged out
    const box = document.getElementById("actualChat") || shell.querySelector("#actualChat");
    const line = document.createElement("div");
    line.className = "chatText";
    line.innerHTML = firetable.ui.textToLinks("https://x.test/cat.png https://x.test/page");
    box.appendChild(line);
    const was = firetable.showImages;
    firetable.chatImages.setEnabled(true);
    const on = [line.querySelectorAll("img").length, line.querySelectorAll("a").length];
    firetable.chatImages.setEnabled(false);
    const off = [line.querySelectorAll("img").length, line.querySelector("a").textContent];
    firetable.chatImages.setEnabled(was);
    line.remove();
    return { on, off };
  });
  assert.deepEqual(r, { on: [1, 2], off: [0, "https://x.test/cat.png"] });
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

test("Bouletmaton: the code, everything at 1 to start, no made-up ones, and every drawing there", async () => {
  const r = await run(async () => {
    const B = Bouletmaton;
    const files = [];
    // every choice of every part, in every skin tone and colour it comes in
    B.PARTS.forEach((p) => {
      for (let v = 1; v <= p.max; v++) {
        const dirs = p.dir === "skin" ? [1, 2, 3, 4] : p.dir ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1];
        dirs.forEach((d) => {
          const u = B.drawingOf(p, v, { skin: d, hair: d, beard: d });
          if (u) files.push(u);
        });
      }
    });
    // in batches: thousands of requests at once overwhelm the test server on a CI runner
    const head = (u) => fetch(u, { method: "HEAD" }).then((res) => res.ok);
    const there = [];
    for (let i = 0; i < files.length; i += 40) {
      there.push(...await Promise.all(files.slice(i, i + 40).map((u) => head(u).catch(() => head(u)).catch(() => false))));
    }
    return {
      parts: B.PARTS.map((p) => p.file + ":" + p.max + (p.blank ? "/" + p.blank : "") + (p.hide ? "/hide" : "")),
      first: B.FIRST, random: typeof B.random,
      bad: ["", "5.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1", "1.1.13.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1", "1.1.1.1.0.1.1.1.1.1.1.1.1.1.1.1.1.1.1",
        "1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1", "2.5.12.30.4.9.40.10.50.20.0.8.3.40.0.0.12.0", 42].map(B.isCode),
      hidden: B.isCode("1.1.1.1.1.1.1.1.1.1.1.1.1.0.1.0.1.1.1"), // nose and ears hidden
      clamped: B.encode({ skin: 9, hair: 0, beard: 4, parts: { body: 999, hat: 33, nose: 0, neck: 0 } }),
      files: files.length, missing: files.filter((u, i) => !there[i]).slice(0, 3),
      blankNone: [B.drawingOf(B.PARTS[1], 27, { skin: 1 }), B.drawingOf(B.PARTS[3], 1, { skin: 1 }), B.drawingOf(B.PARTS[15], 20, { skin: 1 })],
      extras: B.drawingOf(B.PARTS[15], 27, { skin: 2 })
    };
  });
  // the Bouletmaton's own stacking, back to front (zanorg.net/bouletmaton, js/interface.js)
  assert.deepEqual(r.parts, ["cor:62", "col:27/27", "tete:54", "menton:17/1", "bou:93", "ye:96", "bar:25/25", "so:42", "tache:18/18", "lunette:21/21",
    "nez:32/hide", "coi:72/72", "ore:18/hide", "boucle:25/25", "chapo:33/33", "divers:27/20"]);
  assert.equal(r.first, "1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1", "a new one starts with every choice at 1");
  assert.equal(r.random, "undefined", "no made-up Bouletmatons");
  assert.deepEqual(r.bad, [false, false, false, false, false, false, false]);
  assert.equal(r.hidden, true, "the nose and ears can be hidden, as on the Bouletmaton");
  assert.equal(r.clamped, "1.1.4.1.1.1.1.1.1.1.1.1.1.0.1.1.1.33.1", "out of range: 1; 0 only hides the nose and ears");
  assert.deepEqual(r.missing, [], "every drawing is in img/bouletmaton/ (" + r.files + ")");
  assert.ok(r.files > 2500, "the Bouletmaton's whole set (" + r.files + ")");
  assert.deepEqual(r.blankNone, [null, null, null], "the Bouletmaton's blank drawings are drawn as nothing");
  assert.match(r.extras, /\/img\/bouletmaton\/sec4\.png$/, "its hidden extras are in hand's last choices");
});

test("Bouletmaton: stacked exactly as the Bouletmaton does, hair lifted, on transparent", async () => {
  const r = await run(async () => {
    const B = Bouletmaton;
    const code = "2.3.5.10.8.20.5.30.40.6.12.3.4.7.10.5.2.33.20";
    const unlifted = "2.3.5.10.8.20.5.30.40.6.12.3.4.7.19.5.2.33.20";
    const names = (c) => B.layers(c).map((l) => l.url.replace(/^.*\/img\/bouletmaton\//, "") + (l.dy ? "@" + l.dy : ""));
    const canvas = await B.draw(code, 256);
    const g = canvas.getContext("2d").getImageData(0, 0, 256, 256).data;
    let opaque = 0, corners = 0;
    for (let i = 3; i < g.length; i += 4) if (g[i] > 0) opaque++;
    [[0, 0], [255, 0]].forEach(([x, y]) => { corners += g[(y * 256 + x) * 4 + 3]; });
    return { order: names(code), unlifted: names(unlifted).filter((n) => /coi/.test(n)), opaque: opaque / (256 * 256), corners };
  });
  assert.deepEqual(r.order, ["peau2/cor10.png", "col8.png", "peau2/tete20.png", "peau2/menton5.png", "peau2/bou30.png", "ye40.png", "coul5/bar6.png",
    "so12.png", "tache3.png", "lunette4.png", "peau2/nez7.png", "coul3/coi10.png@-15", "peau2/ore5.png", "boucle2.png"],
    "neckwear under the head, ears over the hair, nose over the glasses; the blank hat and hand left out");
  assert.deepEqual(r.unlifted, ["coul3/coi19.png"], "hair 19, 25 and 31 aren't lifted");
  assert.ok(r.opaque > 0.15 && r.opaque < 0.8, "it's drawn (" + r.opaque + ")");
  assert.equal(r.corners, 0, "on a transparent background");
});

test("who looks like what: robot busts, members' switched-on Bouletmatons, the supermod's pick, October's monsters", async () => {
  const r = await run(async () => {
    const was = { room: firetable.roomAvatarStyle, forced: firetable.avatarForced, users: ftapi.users, uid: ftapi.uid };
    const bm = "2.3.5.10.8.20.5.30.40.6.12.3.4.7.10.5.2.33.20";
    ftapi.users = { on: { username: "on", status: true, boulet: bm, bouletOn: true }, off: { username: "off", status: true, boulet: bm, bouletOn: false },
      none: { username: "none", status: true } };
    const look = (uid) => {
      const u = firetable.utilities.avatarURL(uid, uid, "40x40");
      return /#bm=|^blob:/.test(u) ? "boulet" : (/set=(set\d)/.exec(u) || /9\.x\/([a-z-]+)/.exec(u) || [, u])[1];
    };
    const at = (room, forced) => { firetable.roomAvatarStyle = room; firetable.avatarForced = forced; return ["on", "off", "none"].map(look).join(","); };
    const out = {
      robots: at("robohash:set1", null), boulets: at("bouletmaton", null), cats: at("robohash:set4", null),
      pixel: at("dicebear:pixel-art", null), october: at("bouletmaton", "robohash:set2"), octoberPixel: at("dicebear:pixel-art", "robohash:set2"),
      base: (firetable.roomAvatarStyle = "bouletmaton", firetable.avatarForced = null, firetable.utilities.baseAvatarStyle()),
      kind: firetable.utilities.avatarKind()
    };
    Object.assign(firetable, { roomAvatarStyle: was.room, avatarForced: was.forced });
    ftapi.users = was.users;
    return out;
  });
  assert.equal(r.robots, "boulet,set1,set1", "robot busts by default; a switched-on Bouletmaton shows");
  assert.equal(r.boulets, "boulet,set1,set1", "the room on Bouletmaton: members' own, robot busts for the rest");
  assert.equal(r.cats, "boulet,set4,set4", "another pick: a switched-on Bouletmaton stays");
  assert.equal(r.pixel, "boulet,pixel-art,pixel-art");
  assert.equal(r.october, "set2,set2,set2", "October: everyone a monster, Bouletmatons too");
  assert.equal(r.octoberPixel, "set2,set2,set2", "October overrides the supermod's pick");
  assert.equal(r.base, "robohash:set1");
  assert.equal(r.kind, "robohash");
});

test("no uid, no avatar yet: the generic gray robot bust, framed as a robot bust whatever the room's style", async () => {
  const r = await run(async () => {
    const was = { room: firetable.roomAvatarStyle, forced: firetable.avatarForced, kind: document.documentElement.getAttribute("data-avatars") };
    const at = (room, forced) => { firetable.roomAvatarStyle = room; firetable.avatarForced = forced; return firetable.utilities.avatarURL(null, "Long Gone DJ", "40x40"); };
    const out = {
      generic: GENERIC_AVATAR_URL,
      urls: [at("robohash:set1", null), at("robohash:set4", null), at("dicebear:pixel-art", null), at("bouletmaton", null), at("bouletmaton", "robohash:set2"),
        firetable.utilities.avatarURL("", "Name"), firetable.utilities.avatarURL(undefined, undefined, "160x160", null, true)],
      known: firetable.utilities.avatarURL("u1", "Name", "40x40", "robohash:set1", true),
      card: firetable.utilities.avatarURL(null, "Name", "40x40", "robohash:set4", true)
    };
    Object.assign(firetable, { roomAvatarStyle: was.room, avatarForced: was.forced });
    // the picture: Robohash's size, gray all through, on a transparent background
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error("img/robot-generic.png didn't load")); img.src = GENERIC_AVATAR_URL; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let drawn = 0, coloured = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      drawn++;
      if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) coloured++;
    }
    out.size = img.naturalWidth + "x" + img.naturalHeight;
    out.drawn = drawn / (c.width * c.height);
    out.coloured = coloured;
    out.corners = d[3] + d[(c.width - 1) * 4 + 3];
    // framed as a robot bust in a room of another style
    const framing = (kind) => {
      document.documentElement.setAttribute("data-avatars", kind);
      const el = document.createElement("span");
      el.className = "ft-avatar";
      el.style.backgroundImage = "url(" + JSON.stringify(GENERIC_AVATAR_URL) + ")";
      document.body.appendChild(el);
      const cs = getComputedStyle(el), f = [cs.getPropertyValue("--av-zoom"), cs.getPropertyValue("--av-x"), cs.getPropertyValue("--av-y")].map((v) => v.trim()).join(" ");
      el.remove();
      return f;
    };
    out.frames = ["robohash", "notionists", "pixel-art"].map(framing);
    if (was.kind === null) document.documentElement.removeAttribute("data-avatars"); else document.documentElement.setAttribute("data-avatars", was.kind);
    return out;
  });
  assert.match(r.generic, /\/img\/robot-generic\.png$/);
  assert.deepEqual(r.urls, r.urls.map(() => r.generic), "whatever the room's style or the season, and any size");
  assert.match(r.known, /robots\/u1Name\.png\?size=40x40&set=set1$/, "someone with a uid keeps their own robot");
  assert.match(r.card, /set=set4$/, "a printed card's stamp is drawn as stamped");
  assert.equal(r.size, "300x300", "Robohash's own size");
  assert.ok(r.drawn > 0.15 && r.drawn < 0.6, "it's drawn (" + r.drawn + ")");
  assert.equal(r.coloured, 0, "gray all through");
  assert.equal(r.corners, 0, "on a transparent background");
  assert.deepEqual(r.frames, ["125% 50% 66%", "125% 50% 66%", "125% 50% 66%"], "the robots' framing in every room");
});

test("Bouletmaton: a stand-in at once, swapped for the picture (marked .bm-face) wherever it was put", async () => {
  const r = await run(async () => {
    const was = { room: firetable.roomAvatarStyle, forced: firetable.avatarForced, users: ftapi.users };
    firetable.roomAvatarStyle = "robohash:set1";
    firetable.avatarForced = null;
    ftapi.users = Object.assign({}, was.users, { swapme: { username: "Name", status: true, boulet: "3.7.2.40.15.33.9.60.80.24.30.10.15.20.19.12.10.5.11", bouletOn: true } });
    const url = firetable.utilities.avatarURL("swapme", "Name", "40x40");
    const el = document.createElement("span");
    el.className = "ft-avatar";
    el.style.backgroundImage = "url(" + url + ")";
    document.body.appendChild(el);
    const img = document.createElement("img");
    img.src = firetable.utilities.avatarURL("swapme", "Name", "40x40");
    document.body.appendChild(img);
    const t0 = Date.now();
    while ((/#bm=/.test(el.style.backgroundImage + img.src) || !el.classList.contains("bm-face")) && Date.now() - t0 < 10000) await new Promise((ok) => setTimeout(ok, 50));
    const after = el.style.backgroundImage, face = el.classList.contains("bm-face");
    const again = firetable.utilities.avatarURL("swapme", "Name", "40x40");
    // switched off: a robot again, and no longer framed as a Bouletmaton
    ftapi.users.swapme.bouletOn = false;
    el.style.backgroundImage = "url(" + firetable.utilities.avatarURL("swapme", "Name", "40x40") + ")";
    await new Promise((ok) => setTimeout(ok, 300));
    const off = { bg: el.style.backgroundImage, face: el.classList.contains("bm-face") };
    Object.assign(firetable, { roomAvatarStyle: was.room, avatarForced: was.forced });
    ftapi.users = was.users;
    el.remove(); img.remove();
    return { url, after, face, img: img.src, again, off };
  });
  assert.match(r.url, /blank\.svg#bm=/);
  assert.match(r.after, /^url\("blob:/, "the circle got the picture");
  assert.ok(r.face, "and a Bouletmaton's framing");
  assert.match(r.img, /^blob:/, "the <img> got the picture");
  assert.match(r.again, /^blob:/, "once drawn, it's given straight away");
  assert.ok(/set=set1/.test(r.off.bg) && !r.off.face, "switched off: a robot bust, framed as one (" + JSON.stringify(r.off) + ")");
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
      boulet: await draw({ set: "set1", avs: "bouletmaton", bm: "2.3.5.10.8.20.5.30.40.6.12.3.4.7.10.5.2.33.20" }),
      unstamped: await draw({ set: "set1", avs: "bouletmaton" })
    };
  });
  const avatarOf = (seen) => seen.find((u) => /robots\/|dicebear|^blob:/.test(u)) || "";
  assert.match(avatarOf(r.old), /set=set3$/, "a card printed before styles keeps its robot as printed");
  assert.match(avatarOf(r.cats), /set=set4$/);
  assert.match(avatarOf(r.dice), /dicebear\.com\/9\.x\/notionists\//);
  assert.match(avatarOf(r.boulet), /^blob:/, "the DJ's Bouletmaton, drawn");
  assert.match(avatarOf(r.unstamped), /set=set1$/, "no Bouletmaton stamped: a robot, never a made-up one");
});
const AVATAR_BASE_URL_FOR_TEST = "https://indiediscotheque.com/robots/";

test("dates and times", async () => {
  const r = await run(() => {
    const thisYear = new Date().getFullYear();
    return [
      firetable.utilities.format_time(new Date(2026, 0, 1, 0, 5)), firetable.utilities.format_time(new Date(2026, 0, 1, 12, 30)),
      firetable.utilities.format_time(new Date(2026, 0, 1, 23, 9)),
      firetable.utilities.shortDate(new Date(thisYear, 10, 10)), firetable.utilities.shortDate(new Date(2011, 10, 10)),
      firetable.utilities.pluralize(1, "play"), firetable.utilities.pluralize(2, "play"), firetable.utilities.pluralize(2, "person", "people"), firetable.utilities.pluralize(170236, "play")
    ];
  });
  assert.deepEqual(r, ["12:05am", "12:30pm", "11:09pm", "Nov 10", "Nov 10, 2011", "1 play", "2 plays", "2 people", "170,236 plays"]);
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

// ─── :emoji suggestions (CH-20) ─────────────────────────────────────────────

test("typedShortname finds the :name being typed, and not times, links or :)", async () => {
  const r = await run(() => {
    const t = firetable.emojis.typedShortname;
    return {
      start: t(":cow", 4), mid: t("hi :cow", 7), inside: t("hi :co_face: x", 6), paren: t("(:fire", 6),
      one: t("hi :c", 5), time: t("12:30", 5), link: t("https://x", 9), smiley: t("hi :)", 5), word: t("a:cow", 5)
    };
  });
  assert.deepEqual(r.start, { start: 0, end: 4, query: "cow" });
  assert.deepEqual(r.mid, { start: 3, end: 7, query: "cow" });
  assert.deepEqual(r.inside, { start: 3, end: 12, query: "co" }); // the rest of the name, and its colon, is replaced too
  assert.deepEqual(r.paren, { start: 1, end: 6, query: "fire" });
  for (const k of ["one", "time", "link", "smiley", "word"]) assert.equal(r[k], null, k);
});

test("suggest ranks the exact name, then names that start with it, then words in names, each emoji once", async () => {
  await page.waitForFunction(() => firetable.emojiMap && firetable.emojiMap.cow, null, { timeout: 30000 });
  const r = await run(() => {
    const words = firetable.emojis.searchWords;
    firetable.emojis.searchWords = null; // names alone first
    const s = (q, n) => firetable.emojis.suggest(q, n).map((e) => e.name);
    const out = {
      cow: s(":cow", 4), fire: s("fire", 3), plus: s("+1", 1), none: s("zzzzqx"), empty: s(""), bad: s("<b>"),
      rohn: firetable.emojis.suggest("rohn")[0], happyNames: s("happy"), limit: firetable.emojis.suggest("a").length,
      once: new Set(firetable.emojis.suggest("smile", 20).map((e) => e.emoji)).size === firetable.emojis.suggest("smile", 20).length
    };
    firetable.emojis.searchWords = words;
    return out;
  });
  assert.deepEqual(r.cow.slice(0, 3), ["cow", "cow2", "cowboy_hat_face"]); // :cow_face: is 🐮 too: shown once, as :cow:
  assert.deepEqual(r.fire.slice(0, 1), ["fire"]);
  assert.deepEqual(r.plus, ["+1"]);
  assert.deepEqual(r.none, []);
  assert.deepEqual(r.empty, []);
  assert.deepEqual(r.bad, []);
  assert.deepEqual(r.rohn, { name: "rohn", emoji: "", custom: "rohnmoji" });
  assert.deepEqual(r.happyNames, []);
  assert.equal(r.limit, 10);
  assert.ok(r.once);
});

test("suggest finds emoji by their search words once the picker's data is in", async () => {
  const r = await run(async () => {
    firetable.emojis.setSearchWords(await firetable.emojis.pickerData());
    const s = (q) => firetable.emojis.suggest(q, 8);
    return { happy: s("happy"), beef: s("beef").map((e) => e.name), cow: s("cow").map((e) => e.name), map: firetable.emojiMap };
  });
  assert.ok(r.happy.length >= 5 && r.happy.every((e) => r.map[e.name] === e.emoji), "every suggestion is a name the chat understands");
  assert.equal(r.happy[0].emoji, "😀");
  assert.ok(r.beef.includes("ox"));
  assert.equal(r.cow[0], "cow");
  assert.ok(r.cow.includes("cut_of_meat") || r.cow.includes("water_buffalo"), "related emoji follow the names: " + r.cow);
});

test("the bus in words: after this song, after a number of songs, at a time (the bot's lib/bus.js)", async () => {
  const r = await run(() => {
    const b = firetable.people.bus;
    const at = new Date(2026, 10, 25, 21, 45).getTime();
    return [b(null), b({}), b({ removeAfter: false }), b({ removeAfter: true }), b({ removeAfter: true }, true),
      b({ busSongs: 3 }), b({ busSongs: 3 }, true), b({ busSongs: 2 }, true),
      b({ busAt: at }) === "at " + new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })];
  });
  assert.deepEqual(r, ["", "", "", "after next play", "after this song", "after 3 more songs", "after this song and 2 more", "after this song and 1 more", true]);
});

test("the bus menu: loads on first use, offers a song, a few or a while, and sends the bot's own commands", async () => {
  const r = await run(async () => {
    const sent = [];
    const was = { send: ftapi.actions.sendBotCommand, uid: ftapi.uid, users: ftapi.users, table: firetable.tableData, wait: firetable.waitlistData, song: firetable.song };
    const loadedBefore = !!document.querySelector('script[src*="bus-menu.js"]');
    ftapi.actions.sendBotCommand = (c) => { sent.push(c); return Promise.resolve(); };
    ftapi.uid = "me";
    ftapi.users = { me: { username: "Me" }, bea: { username: "Bea" } };
    firetable.tableData = [{ id: "me", name: "Me", plays: 1, busSongs: 3 }, { id: "bea", name: "Bea", plays: 0 }];
    firetable.waitlistData = [];
    firetable.song = { djid: "me", cid: "x" };
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const menu = () => document.getElementById("busMenu");
    const items = () => [...menu().querySelectorAll("button[data-bus]")].map((b) => b.textContent.trim());
    const out = {};
    await firetable.busMenu.open(btn, "me");
    out.loaded = !loadedBefore && !!document.querySelector('script[src*="bus-menu.js"]');
    out.open = menu().matches(":popover-open");
    out.title = menu().querySelector(".ft-menu-title").textContent;
    out.now = menu().querySelector(".bus-now").textContent;
    out.mine = items();
    menu().querySelector('[data-bus="s:3"]').click();
    out.closed = !menu().matches(":popover-open");
    for (const pick of ["m:30", "s:1", "stay"]) {
      firetable.busMenu.open(btn, "me");
      menu().querySelector('[data-bus="' + pick + '"]').click();
    }
    firetable.busMenu.open(btn, "me");
    menu().querySelector(".bus-own-n").value = "90";
    menu().querySelector(".bus-own").requestSubmit();
    out.tooMany = menu().matches(":popover-open") && sent.length === 4 && menu().querySelector(".bus-own-n").getAttribute("aria-invalid");
    menu().querySelector(".bus-own-unit").value = "minutes";
    menu().querySelector(".bus-own").requestSubmit();
    firetable.busMenu.open(btn, "bea");
    out.theirTitle = menu().querySelector(".ft-menu-title").textContent;
    out.theirs = items();
    menu().querySelector('[data-bus="s:2"]').click();
    out.sent = sent;
    out.commands = [firetable.busMenu.command({ songs: 1 }), firetable.busMenu.command({ songs: 4 }, "Bea Smith"), firetable.busMenu.command({ minutes: 45 }), firetable.busMenu.command({ stay: true }, "Bea")];
    btn.remove();
    Object.assign(ftapi, { uid: was.uid, users: was.users });
    ftapi.actions.sendBotCommand = was.send;
    firetable.tableData = was.table; firetable.waitlistData = was.wait; firetable.song = was.song;
    return out;
  });
  assert.equal(r.loaded, true, "js/bus-menu.js is loaded the first time, not with the page");
  assert.equal(r.open, true);
  assert.equal(r.title, "Catch the bus");
  assert.equal(r.now, "You're stepping down after this song and 2 more.");
  assert.deepEqual(r.mine, ["departure_board After this song", "2 songs", "3 songs", "5 songs", "15 min", "30 min", "1 hr", "2 hrs", "close Stay on (cancel the bus)"]);
  assert.equal(r.closed, true, "a choice closes it");
  assert.equal(r.tooMany, "true", "more than 50 songs: not sent, the menu stays open and the box says so");
  assert.equal(r.theirTitle, "Send Bea home");
  assert.deepEqual(r.theirs, ["departure_board After their next song", "2 songs", "3 songs", "5 songs", "15 min", "30 min", "1 hr", "2 hrs"], "not on a bus: nothing to cancel");
  assert.deepEqual(r.sent, ["!removeafter 3", "!removeafter 30m", "!removeafter", "!dontremoveme", "!removeafter 90m", "!removeafter 2 Bea"]);
  assert.deepEqual(r.commands, ["!removeafter", "!removeafter 4 Bea Smith", "!removeafter 45m", "!dontremoveme Bea"]);
});

test("usersSig: changes with what's shown of the people here, not with idle", async () => {
  const r = await run(() => {
    const was = ftapi.users;
    const sig = (users, fields) => { ftapi.users = users; return firetable.utilities.usersSig(fields); };
    const base = sig({ b: { username: "Bea", mod: true, idle: { isIdle: false } }, a: { username: "Al" } });
    const out = {
      idle: sig({ a: { username: "Al" }, b: { username: "Bea", mod: true, idle: { isIdle: true, since: 5 } } }) === base,
      role: sig({ a: { username: "Al" }, b: { username: "Bea", idle: { isIdle: false } } }) === base,
      left: sig({ a: { username: "Al" } }) === base,
      nameOnly: sig({ a: { username: "Al", avatarStyle: "x" } }, ["username"]) === sig({ a: { username: "Al" } }, ["username"]),
      renamed: sig({ a: { username: "Alan" } }, ["username"]) === sig({ a: { username: "Al" } }, ["username"]),
      none: sig(null)
    };
    ftapi.users = was;
    return out;
  });
  assert.equal(r.idle, true, "going idle or coming back redraws nothing");
  assert.equal(r.role, false, "a role change does");
  assert.equal(r.left, false, "someone leaving does");
  assert.equal(r.nameOnly, true, "only the fields asked for count");
  assert.equal(r.renamed, false, "a new name does");
  assert.equal(r.none, "null");
});

test("the emoji picker's search: by the emoji or its words, headers hidden, all back when cleared", async () => {
  const r = await run(async () => {
    await firetable.emojis.buildPicker();
    const root = firetable.emojis.results(); // in the app shell, detached for a visitor
    const els = [...root.querySelectorAll(".pickerResult")];
    const shown = () => els.filter((el) => el.style.display !== "none");
    const heads = () => [...root.querySelectorAll("h3")].filter((h) => h.style.display !== "none").length;
    firetable.emojis.niceSearch("Mirror");
    const mirror = shown().map((el) => el.textContent);
    const mirrorHeads = heads();
    firetable.emojis.niceSearch("🪩");
    const byEmoji = shown().map((el) => el.textContent);
    firetable.emojis.niceSearch("");
    return { all: els.length, mirror, mirrorHeads, byEmoji, back: shown().length, headsBack: heads() };
  });
  assert.ok(r.all > 1500, "the whole picker is built: " + r.all);
  assert.ok(r.mirror.includes("🪩"), "found by its words, whatever the case: " + r.mirror.join(" "));
  assert.ok(r.mirror.length < 20, "and only the ones that match");
  assert.equal(r.mirrorHeads, 0, "section headers hide while searching");
  assert.deepEqual(r.byEmoji, ["🪩"], "found by the emoji itself");
  assert.equal(r.back, r.all, "clearing the search shows them all again");
  assert.ok(r.headsBack > 0);
});

test("the people list: DJs in deck order (playing, next, plays, leaving), then the rest by name; away times, fires, you", async () => {
  const r = await run(() => {
    const byId = (id) => document.getElementById(id) || firetable.$appShell.find("#" + id)[0];
    const was = { users: ftapi.users, table: firetable.tableData, wait: firetable.waitlistData, song: firetable.song, limit: firetable.playlimit, fires: firetable.fireReactors, uid: ftapi.uid };
    const now = Date.now() + (ftapi.serverTimeOffset || 0);
    ftapi.users = { zed: { username: "Zed" }, amy: { username: "amy", idle: { isIdle: true, since: now - 47 * 60000 } },
      bob: { username: "Bob", mod: true, idle: { isIdle: true, since: now - 60000 } }, bot: { username: "hostbot", hostbot: true, idle: { isIdle: true, since: 5 } },
      d1: { username: "Dee" }, d2: { username: "Duo", supermod: true }, w1: { username: "Wes" } };
    firetable.tableData = [{ name: "Dee", id: "d1", plays: 1 }, { name: "Duo", id: "d2", plays: 2, removeAfter: true }, { name: "gone", id: "g1", plays: 0 }];
    firetable.waitlistData = [{ name: "Wes", id: "w1" }];
    firetable.song = { cid: "x", djid: "d1" };
    firetable.playlimit = 2;
    firetable.fireReactors = { zed: true, d1: true };
    ftapi.uid = "amy";
    firetable.people.render();
    const says = (el) => el.getAttribute("aria-label") || el.textContent;
    const row = (el) => el.id.slice(4) + ":" + el.querySelector(".prsnName").textContent + "[" + [...el.classList].filter((c) => c !== "prson").join(",") + "]" +
      (el.querySelector(".pe-meta") ? " " + [...el.querySelector(".pe-meta").children].map(says).join(",") : "");
    const rows = (id) => [...byId(id).children].map(row);
    const out = {
      djs: rows("usersDJs"), bot: rows("usersBot"), supers: rows("usersSuper"), mods: rows("usersMod"), members: rows("usersRegular"),
      heads: [byId("pe-djHead").hidden, byId("pe-djHead").textContent.replace(/^headphones/, ""), byId("pe-floorHead").hidden].join("|"),
      you: [...byId("allUsers").querySelectorAll(".pe-you")].map((y) => y.closest(".prson").id).join(","),
      dots: byId("allUsers").querySelectorAll(".prson:not(.ghost) .pe-dot").length + "|" + byId("allUsers").querySelectorAll(".prson.ghost .pe-dot").length,
      roles: [...byId("allUsers").querySelectorAll(".prsnRole")].map((i) => i.closest(".prson").id.slice(4) + "=" + i.title).join(","),
      away: [now - 4 * 60000, now - 5 * 60000, now - 3 * 3600000, now - 2 * 86400000, 0].map(firetable.people.awayFor).join("|"),
      status: ["amy", "bob", "bot", "zed", "g1"].map((u) => firetable.people.status(u).label).join("|")
    };
    // plays in words: with no limit tonight (the bot's "∞"), "2 plays", and the tooltip says so
    out.limitTip = byId("usersDJs").querySelector(".pe-plays").title;
    firetable.playlimit = "∞";
    firetable.people.render();
    out.noLimit = [...byId("usersDJs").querySelectorAll(".pe-plays")].map((p) => p.textContent + "=" + p.title).join("|");
    firetable.playlimit = 2;
    // nobody DJing: one plain list, no headings
    firetable.tableData = null;
    firetable.people.render();
    out.noDjs = byId("pe-djHead").hidden + "|" + byId("pe-floorHead").hidden + "|" + rows("usersSuper").join() + "|" + byId("usersDJs").children.length;
    ftapi.users = was.users; firetable.tableData = was.table; firetable.waitlistData = was.wait; firetable.song = was.song;
    firetable.playlimit = was.limit; firetable.fireReactors = was.fires; ftapi.uid = was.uid;
    firetable.people.render();
    return out;
  });
  assert.deepEqual(r.djs, ["d1:Dee[is-dj,is-playing] Playing now,1 of 2", "d2:Duo[is-dj] Next,Steps down after next play,2 of 2", "g1:gone[ghost,is-dj] 0 of 2,away"],
    "the DJs lead in deck order: who's playing, who's next, who steps down, each one's plays (in words: 1 of 2); a DJ who dropped off says away");
  assert.equal(r.limitTip, "1 of 2 plays this turn", "the plays' tooltip says what the numbers are");
  assert.equal(r.noLimit, "1 play=1 play this turn, no limit|2 plays=2 plays this turn, no limit|0 plays=0 plays this turn, no limit",
    "with no limit, each DJ's plays this turn in words (it was 1/∞), and the tooltip says there's no limit");
  assert.deepEqual(r.bot, ["bot:hostbot[]"], "the bot is never idle");
  assert.deepEqual(r.supers, [], "a DJ isn't listed twice");
  assert.deepEqual(r.mods, ["bob:Bob[idle] "], "away under five minutes: the dot, no time");
  assert.deepEqual(r.members, ["amy:amy[idle,is-me] 47m", "zed:Zed[] Fired this song"], "the rest by name whatever its case, with how long away and who fired; nobody from the waitlist");
  assert.equal(r.heads, "false|On the decks 3/4|false", "both groups are named once there are DJs");
  assert.equal(r.you, "useramy", "your own row says so");
  assert.equal(r.dots, "6|0", "everyone here has a presence dot; a DJ who dropped off has none");
  assert.equal(r.roles, "d2=Supermod,bot=Room bot,bob=Mod", "only the bot, mods and supermods have a role icon, named");
  assert.equal(r.away, "|5m|3h|2d|", "away times start at five minutes");
  assert.equal(r.status, "Away for 47m|Away|Here|Here|Not on the site", "status (the profile card's, the Turntable theme's): the bot is always here");
  assert.equal(r.noDjs, "true|true|d2:Duo[]|0", "with nobody DJing it's one list with no headings");
});

test("a DJ's plays in words, the same everywhere they show (the card, the stage, the Turntable theme)", async () => {
  const r = await run(() => [[1, 3], [2, "∞"], [1, "∞"], [0, undefined]].map(([n, lim]) => { const w = firetable.people.plays(n, lim); return w.shown + "=" + w.tip; }));
  assert.deepEqual(r, ["1 of 3=1 of 3 plays this turn", "2 plays=2 plays this turn, no limit", "1 play=1 play this turn, no limit", "0 plays=0 plays this turn, no limit"],
    "with a limit \"1 of 3\", with none (the bot's ∞) \"2 plays\"; never \"1/∞\"");
});

test("a playlist's name: the built-in list by the name its owner gave it, older escaped names decoded", async () => {
  const r = await run(() => {
    const was = { prefs: firetable.plPrefs.defaultName, lists: firetable.allPlaylists };
    firetable.allPlaylists = { p1: { name: "Rock &amp; Roll" }, p2: { name: "Tom's <b>" }, p3: {} };
    const out = [firetable.utilities.listName("0")];
    firetable.plPrefs.defaultName = "Smoke Crate";
    out.push(firetable.utilities.listName("0"), firetable.utilities.listName(0), firetable.utilities.listName("p1"), firetable.utilities.listName("p2"), firetable.utilities.listName("p3"));
    firetable.plPrefs.defaultName = was.prefs; firetable.allPlaylists = was.lists;
    return out;
  });
  assert.deepEqual(r, ["Default Playlist", "Smoke Crate", "Smoke Crate", "Rock & Roll", "Tom's <b>", "your playlist"],
    "its own name, as plain text (callers escape it, a toast shows it as text)");
});

test("the people header and the waitlist's card say only what there is", async () => {
  const r = await run(() => {
    const shell = firetable.$appShell[0];
    document.getElementById("mainGrid").appendChild(shell); // the waitlist's card is drawn in the page
    const byId = (id) => document.getElementById(id);
    const shown = () => [...byId("usersStats").querySelectorAll(".listenerType")].filter((t) => !t.hidden).map((t) => t.querySelector("i").textContent + " " + t.querySelector("span").textContent + " (" + t.title + ")").join(", ");
    const heads = () => [...byId("pe-audience").querySelectorAll(".pe-audHead")].map((h) => h.textContent.replace(/^(radio|person)/, "")).join(", ");
    const out = {};
    firetable.audience.take({ guests: 0, guestsLive: 0, stream: { listeners: 1, unplaced: 0, countries: [{ code: "US", name: "United States", n: 1 }] } });
    out.radioOnly = shown() + " / " + heads();
    firetable.audience.take({ guests: 1, guestsLive: 1, guestCountries: [{ code: "GB", name: "", n: 1 }], stream: { listeners: 0, unplaced: 0, countries: [] } });
    out.guestOnly = shown() + " / " + heads();
    firetable.audience.take({ guests: 0, guestsLive: 0, stream: null });
    out.neither = shown() + " / " + heads() + " / " + byId("pe-audience").hidden;

    const was = { table: firetable.tableData, wait: firetable.waitlistData, uid: ftapi.uid };
    const card = () => byId("usersWaitlist").querySelector(".waitlist-empty-msg").textContent + "|" + [...byId("usersWaitlist").querySelectorAll(".wlAddMeBtn")].map((b) => (b.disabled ? "off" : "on")).join();
    ftapi.uid = "me";
    firetable.tableData = [{ name: "a", id: "a", plays: 0 }];
    ftapi.events.emit("waitlistChanged", null);
    out.canHop = card();
    firetable.tableData = [{ name: "me", id: "me", plays: 0 }];
    ftapi.events.emit("waitlistChanged", null);
    out.onDeck = card();
    firetable.tableData = ["a", "b", "c", "d"].map((n) => ({ name: n, id: n, plays: 0 }));
    ftapi.events.emit("waitlistChanged", null);
    out.full = card();
    ftapi.uid = was.uid; firetable.tableData = was.table;
    ftapi.events.emit("waitlistChanged", was.wait || null);
    shell.remove();
    return out;
  });
  assert.equal(r.radioOnly, "room 0 (0 members in the room), radio 1 (1 person listening on the radio) / On the radio 1", "no guests: no guests count and no empty Guests group");
  assert.equal(r.guestOnly, "room 0 (0 members in the room), person 1 (1 guest without an account, 1 listening live) / Guests 1", "nobody on the radio: no radio count or group");
  assert.equal(r.neither, "room 0 (0 members in the room) /  / true", "neither: only the members");
  assert.equal(r.canHop, "Less than 4 DJs = no need to wait!|on", "someone who can hop on is offered it");
  assert.equal(r.onDeck, "Less than 4 DJs = no need to wait!|", "a DJ on the decks isn't shown a greyed-out Hop on");
  assert.equal(r.full, "The decks are full. Nobody is waiting yet.|on", "four DJs: the note doesn't say there's no wait");
});

test("chat lines: a heading between two days, a flame on the bot's fire lines, quiet commands, the DANCE button", async () => {
  const r = await run(() => {
    const chats = document.getElementById("chats") || firetable.$appShell.find("#chats")[0];
    const kept = [...chats.childNodes];
    const was = { person: firetable.lastChatPerson, id: firetable.lastChatId };
    chats.replaceChildren();
    const D = 86400000, noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const t = noon.getTime();
    // a message as chat.js draws it: the heading (if any) first, then its block with its time
    const add = (time) => {
      const headed = firetable.chatLines.day(time);
      const el = document.createElement("div");
      el.className = "newChat";
      el.innerHTML = '<span class="chatTime" data-time="' + time + '"></span>';
      chats.appendChild(el);
      return headed;
    };
    const song = () => { const el = document.createElement("div"); el.className = "newChat nowplayn"; el.innerHTML = '<span class="chatTime npmsg-time">9:00pm</span>'; chats.appendChild(el); };
    const out = { todayFirst: add(t) + "|" + chats.querySelectorAll(".ch-day").length };
    chats.replaceChildren();
    firetable.lastChatPerson = "someone";
    const seq = [add(t - 3 * D), add(t - 3 * D + 60000), add(t - D)];
    out.newBlock = firetable.lastChatPerson;
    song(); // a song announcement carries no time of its own
    seq.push(add(t - D + 5000), add(t), add(t + 1000));
    out.seq = seq.join();
    out.heads = [...chats.querySelectorAll(".ch-day")].map((h) => h.textContent + "|" + h.getAttribute("role"));
    out.order = [...chats.children].map((c) => (c.classList.contains("ch-day") ? "H" : c.classList.contains("nowplayn") ? "s" : "m")).join("");
    out.label = [firetable.chatLines.dayLabel(t, t), firetable.chatLines.dayLabel(t - D, t), firetable.chatLines.dayLabel(t, t + D)].join();
    // midnight passes: a heading that said Today is brought up to date
    const last = [...chats.querySelectorAll(".ch-day")].pop();
    last.firstChild.textContent = "Tomorrow";
    firetable.chatLines.relabel();
    out.relabel = last.textContent;

    const line = (chatData) => { const el = document.createElement("div"); el.className = "chatText"; firetable.chatLines.mark(el, chatData); firetable.chatLines.mark(el, chatData); return el; };
    const cls = (chatData) => [...line(chatData).classList].filter((c) => c !== "chatText").join() || "-";
    out.marks = [
      cls({ id: "x", name: "jarvis", txt: "Chris thinks this track is h0t! A small fire has started." }),
      cls({ id: "x", name: "jarvis", txt: "Chris thinks this track is h0t! FIRE LEVEL IS OFF THE CHARTS. CHARTS ON FIRE!" }),
      cls({ id: "x", name: "jarvis", txt: "Chris has played this 3 times." }),
      cls({ id: "x", name: "Pat", txt: "jarvis thinks this track is h0t! not really" }),
      cls({ id: "x", name: "Pat", txt: "!skip" }),
      cls({ id: "x", name: "Pat", txt: "!plays daft punk" }),
      cls({ id: "x", name: "Pat", txt: "!!! wow" }),
      cls({ id: "x", name: "Pat", txt: "try !skip" }),
      cls({ id: "x", name: "Pat", txt: "!skip", hidden: true })
    ].join(" ");
    out.dance = line({ id: "x", name: "jarvis", txt: "Pat gifted everyone a dance! Type !dance" }).querySelectorAll(".chat-dance-btn").length + "|" +
      line({ id: "x", name: "Pat", txt: "I gifted a dance" }).querySelectorAll(".chat-dance-btn").length;

    chats.replaceChildren(...kept);
    firetable.lastChatPerson = was.person;
    firetable.lastChatId = was.id;
    return out;
  });
  assert.equal(r.todayFirst, "false|0", "a chat that starts today has no heading");
  assert.equal(r.seq, "true,false,true,false,true,false", "a heading goes in where the day changes, and only there");
  assert.equal(r.newBlock, false, "the message under a heading starts a block of its own");
  assert.equal(r.order, "HmmHmsmHmm", "each heading sits above its day's first message");
  assert.match(r.heads[0], /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day, [A-Z][a-z]{2} \d{1,2}(, \d{4})?\|separator$/, "an older day is its weekday and date (" + r.heads[0] + ")");
  assert.deepEqual(r.heads.slice(1), ["Yesterday|separator", "Today|separator"]);
  assert.equal(r.label, "Today,Yesterday,Yesterday");
  assert.equal(r.relabel, "Today", "headings are brought up to date");
  assert.equal(r.marks, "ch-fire ch-fire - - ch-cmd ch-cmd - - -", "only the bot's fire lines get the flame; only a command that starts a person's message is quiet");
  assert.equal(r.dance, "1|0", "the bot's gift line gets one DANCE button");
});

test("a visitor's people list (#pe-here) shows in Live's left column, and never in the Turntable theme's grid", async () => {
  const r = await run(() => {
    const here = document.getElementById("pe-here");
    const grid = document.getElementById("mainGrid");
    const was = { html: here.innerHTML, login: grid.classList.contains("login"), pre: grid.classList.contains("pre-auth"), discover: document.body.classList.contains("ft-discover") };
    grid.classList.add("login");
    grid.classList.remove("pre-auth");
    document.body.classList.remove("ft-discover");
    here.innerHTML = '<h2 class="pe-head">In the room <span class="pe-count">1</span></h2><ul class="pe-list"><li class="pe-row"><span class="pe-name">dj1</span></li></ul>';
    const out = { wide: innerWidth >= 1024, live: getComputedStyle(here).display };
    document.body.classList.add("tt-skin");
    out.turntable = getComputedStyle(here).display;
    document.body.classList.remove("tt-skin");
    here.innerHTML = was.html;
    grid.classList.toggle("login", was.login);
    grid.classList.toggle("pre-auth", was.pre);
    document.body.classList.toggle("ft-discover", was.discover);
    return out;
  });
  assert.equal(r.wide, true, "the test page is a computer's width");
  assert.equal(r.live, "block", "Live: in the left column");
  assert.equal(r.turntable, "none", "the Turntable theme has its own People here: an area its grid doesn't name made an extra row and column");
});

test("a member's light mode and About are in the account menu at every width; a visitor's stay in the header", async () => {
  const sizes = [[390, 844], [800, 1024], [1440, 900]];
  const out = [];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    out.push(await run((w) => {
      const grid = document.getElementById("mainGrid");
      const was = { login: grid.classList.contains("login"), pre: grid.classList.contains("pre-auth") };
      const shown = (id) => !!document.getElementById(id).offsetParent;
      const display = (id) => getComputedStyle(document.getElementById(id)).display !== "none";
      grid.classList.add("login");
      grid.classList.remove("pre-auth");
      const visitor = [shown("nav-look"), shown("roomInfo")];
      grid.classList.remove("login");
      const member = [shown("nav-look"), shown("roomInfo"), display("nav-acctAbout")];
      document.body.classList.add("tt-skin");
      const turntable = display("nav-acctAbout");
      document.body.classList.remove("tt-skin");
      grid.classList.toggle("login", was.login);
      grid.classList.toggle("pre-auth", was.pre);
      return w + ": visitor " + visitor + " member " + member + " turntable " + turntable;
    }, width));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.deepEqual(out, sizes.map(([w]) => w + ": visitor true,true member false,false,true turntable false"));
});

// The player bar shows its reload when YouTube stops on the song (yt-stalled), but not where
// reloading the room's song can't help: the browser held it back (media-blocked), or what
// stopped is a playlist preview's video (preview-stalled). css/discover.css reads these.
test("the media state: YouTube stopped on the song, held back by the browser, or a playlist preview's video", async () => {
  const r = await run(() => {
    const m = firetable.media, body = document.body;
    const was = { song: firetable.song, preview: firetable.preview, type: firetable.previewType, off: firetable.disableMediaPlayback,
      state: m.ytState, error: m.ytError, tap: m.directTap, cls: body.className };
    const at = (preview, state) => {
      firetable.preview = preview;
      firetable.previewType = preview ? MEDIA_YOUTUBE : null;
      m.ytState = state;
      m.refresh();
      return ["yt-stalled", "media-blocked", "preview-stalled"].filter((c) => body.classList.contains(c)).join() || "none";
    };
    firetable.song = { type: MEDIA_YOUTUBE, cid: "abc", started: Date.now() };
    firetable.disableMediaPlayback = false;
    m.ytError = false;
    m.directTap = false;
    // the room's song: playing, buffering, ended early, paused; a preview's: ended, paused, then playing; a Discover pick's, paused
    const out = [at(false, 1), at(false, 3), at(false, 0), at(false, 2), at("pl1", 0), at("pl1", 2), at("pl1", 1), at("discover", 2)];
    m.ytError = true; // the room's video failed
    out.push(at(false, -1));
    Object.assign(firetable, { song: was.song, preview: was.preview, previewType: was.type, disableMediaPlayback: was.off });
    Object.assign(m, { ytState: was.state, ytError: was.error, directTap: was.tap });
    body.className = was.cls;
    return out;
  });
  assert.deepEqual(r, ["none", "none", "yt-stalled", "yt-stalled,media-blocked", "yt-stalled,preview-stalled", "yt-stalled,preview-stalled", "none", "yt-stalled", "yt-stalled"]);
});

test("no page errors while the site loaded and ran these", () => {
  assert.deepEqual(errors, []);
});

// ─── The Turntable theme's Konami code ──────────────────────────────────────

test("Konami code: heard in the chat box too, and its \"b\" and \"a\" don't stay there as text", async () => {
  const r = await run(() => {
    const box = document.createElement("textarea");
    document.body.appendChild(box);
    box.value = "hi";
    box.focus();
    box.setSelectionRange(2, 2);
    let done = 0;
    const heard = ftLazy.konami(() => { done++; });
    const press = (key) => {
      const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      box.addEventListener("keydown", heard, { once: true });
      box.dispatchEvent(e);
      if (!e.defaultPrevented && key.length === 1) { // what the browser would type
        const at = box.selectionStart;
        box.value = box.value.slice(0, at) + key + box.value.slice(at);
        box.setSelectionRange(at + 1, at + 1);
      }
    };
    const code = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    code.forEach(press);
    const first = { done, value: box.value };
    ["ArrowUp", "b", "a"].forEach(press); // not the code: typed as usual
    const after = { done, value: box.value };
    box.remove();
    return { first, after };
  });
  assert.deepEqual(r.first, { done: 1, value: "hi" });
  assert.deepEqual(r.after, { done: 1, value: "hiba" });
});

// ─── The phone's tab bar (js/discover-tabs.js) ──────────────────────────────
test("the phone's tab bar lights the tab for where you are: Discover, Live, Library (a member's playlists, a visitor's crate), Fresh under Discover", async () => {
  const r = await run(() => {
    // a member in Live on Chat, unless said otherwise; a visitor's Live is the stage over the welcome (or Fresh)
    const at = (s) => firetable.discoverTabs.lit(Object.assign({ mode: "live", member: true, crate: false, view: "playlists", section: "chat", welcome: false, theme: false }, s));
    const visitor = (s) => at(Object.assign({ member: false, welcome: true }, s));
    return {
      discover: at({ mode: "discover" }),
      visitorCrate: visitor({ mode: "discover", crate: true }),
      visitorDiscover: visitor({ mode: "discover" }),
      memberSheet: at({ mode: "discover", crate: true }),
      chat: at({}),
      people: at({ section: "people" }),
      library: at({ section: "view" }),
      recent: at({ section: "view", view: "history" }),
      cards: at({ section: "view", view: "cards" }),
      fresh: at({ section: "view", view: "discover" }),
      freshUnderChat: at({ view: "discover" }),
      visitorLive: visitor({}),
      visitorWelcome: visitor({ section: "view" }),
      visitorFresh: visitor({ view: "discover" }),
      themeFresh: at({ section: "view", view: "discover", theme: true }),
      themeQueue: at({ section: "view", theme: true }),
      liveCrate: visitor({ crate: true })
    };
  });
  assert.deepEqual(r, {
    discover: "discover", visitorCrate: "library", visitorDiscover: "discover", memberSheet: "discover",
    chat: "live", people: "live", library: "library", recent: "live", cards: "live",
    fresh: "discover", freshUnderChat: "live",
    visitorLive: "live", visitorWelcome: "live", visitorFresh: "discover",
    themeFresh: "live", themeQueue: "library", liveCrate: "live"
  });
});
