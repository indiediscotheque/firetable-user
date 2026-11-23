// Tests for the social posting's own logic: no network, no platform keys.
//   node --test tools/social/social.test.mjs
// CI: .github/workflows/lint.yml. Never deployed (tools/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isoWeek, plain, genreTags, clip, graphemes, dayRange, zoned, artists, artistSlug } from "./util.mjs";
import { caption, linkFor, blueskyFacets, youtubeTitle, hashtags, xReply } from "./captions.mjs";
import { roomGenre, tagsFor, GENRES } from "./keywords.mjs";
import { kit } from "./platforms/studio.mjs";
import { songOf } from "./content.mjs";
import { oauth1 } from "./platforms/social.mjs";
import { targetsFor, configured, withinBudget, budgets } from "./run.mjs";
import { emptyState, saveState, loadState, markPosted, count, today } from "./state.mjs";
import { oneLine, usable } from "./render.mjs";

const post = (o = {}) => ({
  id: "fresh:1_abc", kind: "fresh", emoji: "🆕", title: "Röyksopp & Robyn - Do It Again", targets: "song",
  hook: "New synthpop from Röyksopp & Robyn: \"Do It Again\", a song with a long enough name to matter when the limits are tight",
  facts: ["Out Nov 20 on a record whose name is also on the long side of things.", "Sounds like Robyn, The Knife, Annie."],
  prompt: "Save it for your next playlist.", cta: "Listen live, 24/7, on Indie Discotheque", link: "https://www.indiediscotheque.com/music/artists/royksopp/",
  tags: ["NewMusic", "Synthpop", "NewRelease", "Electropop", "SynthMusic", "IndieDiscotheque"], topic: "Synthpop",
  searchTitle: "Röyksopp & Robyn - Do It Again (New Synthpop 2026)", sound: { title: "Do It Again", artist: "Röyksopp & Robyn" },
  mentions: { instagram: ["royksopp"], bluesky: ["royksopp.bsky.social"], x: ["royksopp"] },
  media: { video: "a.mp4", image: "a.jpg", story: "a-story.jpg" }, platforms: {}, ...o
});

test("weeks, words and dates", () => {
  assert.equal(isoWeek("2026-11-23"), "2026-W48");
  assert.equal(isoWeek("2027-01-01"), "2026-W53");
  assert.equal(isoWeek("2021-01-04"), "2021-W01");
  assert.equal(plain("Starting From Zero (feat. Michael McDonald)"), "starting from zero");
  assert.equal(plain("Café Del Mar (Radio Edit)"), "cafe del mar");
  assert.deepEqual(genreTags("Post-Punk & Darkwave"), ["postpunk", "darkwave"]);
  assert.deepEqual(artists("Breakbot & Irfane"), ["Breakbot", "Irfane"]);
  assert.equal(artistSlug("Röyksopp"), "royksopp");
  assert.equal(clip("hello wonderful world", 12), "hello…");
  assert.equal(graphemes("🇺🇸👍🏽a"), 3);
  const from = Date.UTC(2026, 10, 16, 6), to = from + 6 * 86400000;
  assert.equal(dayRange(from, to, "America/Chicago"), "Nov 16–22");
  assert.equal(dayRange(Date.UTC(2026, 10, 30, 12), Date.UTC(2026, 11, 6, 12), "UTC"), "Nov 30–Dec 6");
  const z = zoned(Date.UTC(2026, 10, 23, 3), "America/Chicago");
  assert.deepEqual([z.date, z.h, z.wd], ["2026-11-22", 21, 7]);
});

test("each platform's words fit its limits and lead with the keywords", () => {
  const p = post();
  for (const name of ["instagram", "tiktok", "facebook", "threads", "bluesky", "mastodon", "x", "pinterest", "telegram"]) {
    assert.ok(caption(p, name).startsWith("🆕 New synthpop from Röyksopp"), name + " leads with the hook");
  }
  // X: no link in the post (it goes in the reply), one tag
  const xt = caption(p, "x");
  assert.ok(!xt.includes("https://") && graphemes(xt) <= 280);
  assert.equal((xt.match(/#\w+/g) || []).length, 1);
  assert.match(xReply(p), /utm_source=x/);
  assert.ok(graphemes(caption(p, "bluesky")) <= 300);
  assert.ok(graphemes(caption(p, "threads")) <= 500);
  assert.ok(graphemes(caption(p, "mastodon")) <= 500);
  const pin = caption(p, "pinterest");
  assert.ok(pin.length <= 500 && !pin.includes("#"), "Pinterest: keywords, no hashtags");
  const ig = caption(p, "instagram");
  assert.match(ig, /link in bio/);
  assert.ok(!ig.includes("https://"), "Instagram links aren't clickable: none in the caption");
  assert.equal((ig.match(/#\w+/g) || []).length, 5);
  assert.match(ig, /#NewMusic #Synthpop/);
  assert.match(ig, /@royksopp/);
  assert.match(ig, /Save it for your next playlist/);
  assert.deepEqual(hashtags(p, "threads"), ["#Synthpop"]);
  assert.match(caption(p, "youtube"), /#Shorts #NewMusic #Synthpop$/);
  assert.ok(youtubeTitle(post({ searchTitle: "x".repeat(200) })).length <= 100);
  assert.equal(youtubeTitle(p), "Röyksopp & Robyn - Do It Again (New Synthpop 2026)");
  // a hook too long for Bluesky on its own is cut, not dropped
  const long = caption(post({ hook: "word ".repeat(120), facts: [] }), "bluesky");
  assert.ok(graphemes(long) <= 300 && long.endsWith("…"));
  // no DJ is ever named
  for (const name of ["instagram", "x", "threads", "bluesky"]) assert.ok(!/found by|played by|brought it/i.test(caption(p, name)));
});

test("genre keywords", () => {
  assert.equal(roomGenre(null, [], ["Nu-Disco"]), "Nu-Disco");
  assert.equal(roomGenre("Soundtrack", "Dance"), "EDM");
  assert.equal(roomGenre("nu-disco"), "Nu-Disco");
  assert.equal(roomGenre("Soundtrack"), null);
  assert.deepEqual(tagsFor(["NewMusic", "NewRelease"], ["French House"]).slice(0, 5), ["NewMusic", "FrenchHouse", "NewRelease", "FrenchTouch", "HouseMusic"]);
  assert.deepEqual(tagsFor(["MusicChart", "Top10"], ["House", "Psych"]).slice(0, 4), ["MusicChart", "HouseMusic", "Psychedelic", "Top10"]);
  assert.ok(Object.values(GENRES).every((g) => g.tags.every((t) => /^[A-Z0-9][A-Za-z0-9]*$/.test(t))), "tags are CamelCase");
});

test("links say which platform sent the visit", () => {
  const u = new URL(linkFor(post(), "instagram_story"));
  assert.equal(u.searchParams.get("utm_source"), "instagram");
  assert.equal(u.searchParams.get("utm_medium"), "story");
  assert.equal(u.searchParams.get("utm_campaign"), "fresh");
});

test("the post kit: the sound to pick and each caption, minus what already went out", () => {
  const k = kit(post());
  assert.equal(k.sound, "\"Do It Again\" by Röyksopp & Robyn");
  assert.deepEqual(k.steps.map((s) => s.where), ["Instagram Reel", "Instagram Story", "TikTok", "YouTube Short", "Facebook Reel"]);
  assert.match(k.steps[3].text, /^Röyksopp & Robyn - Do It Again \(New Synthpop 2026\)/);
  // the Reel went out with licensed music through the API: not in the kit
  const k2 = kit(post({ platforms: { instagram: { status: "done" }, tiktok: { status: "done" } } }));
  assert.ok(!k2.steps.some((s) => s.where === "Instagram Reel"));
  assert.match(k2.steps.find((s) => s.where === "TikTok").how, /inbox/);
  assert.deepEqual(kit(post({ media: { image: "a.jpg" } })).steps, []);
});

test("people can hear the song: its own video, linked where links play", () => {
  const p = post({ listen: "https://www.youtube.com/watch?v=abc" });
  for (const name of ["threads", "mastodon", "telegram", "discord"]) assert.match(caption(p, name), /▶ Hear it: https:\/\/www\.youtube\.com\/watch\?v=abc/, name);
  assert.match(xReply(p), /▶ Hear it: https:\/\/www\.youtube\.com/);
  assert.ok(!caption(p, "instagram").includes("youtube.com"), "not where links don't work");
  assert.ok(!caption(post(), "threads").includes("Hear it"), "nothing when there's no video");
});

test("a song gets one post of its own, whichever upload or kind it comes up in", () => {
  const a = songOf({ a: "Justice", t: "Starting From Zero (feat. Michael McDonald)" });
  assert.equal(a, songOf({ artist: "Justice & Michael McDonald", title: "Starting from Zero (Official Video)" }));
  assert.equal(a, songOf({ a: "JUSTICE", t: "Starting From Zero" }));
  assert.notEqual(a, songOf({ a: "Justice", t: "Starting From Zero (Breakbot Remix)" }), "a remix is a song of its own");
  assert.notEqual(a, songOf({ a: "Justice", t: "Generator" }));
  assert.notEqual(a, songOf({ a: "Breakbot", t: "Starting From Zero" }));
});

test("Bluesky rich text counts bytes, not characters", async () => {
  const text = "🆕 Röyksopp @royksopp.bsky.social https://example.com/a?b=1 #NewMusic";
  const f = await blueskyFacets(text, async () => "did:plc:abc");
  const bytes = Buffer.from(text);
  const slice = (x) => bytes.subarray(x.index.byteStart, x.index.byteEnd).toString();
  assert.deepEqual(f.map(slice), ["https://example.com/a?b=1", "@royksopp.bsky.social", "#NewMusic"]);
  assert.equal(f[1].features[0].did, "did:plc:abc");
  assert.equal(f[2].features[0].tag, "NewMusic");
});

test("OAuth 1.0a signature matches X's documented example", () => {
  const header = oauth1("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=" + encodeURIComponent("Hello Ladies + Gentlemen, a signed OAuth request!"), {
    key: "xvz1evFS4wEEPTGEFPHBog", secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"
  }, { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" });
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test("a post goes only where its keys are set, and fits the platform", () => {
  const env = { BLUESKY_HANDLE: "a", BLUESKY_APP_PASSWORD: "b", TIKTOK_CLIENT_KEY: "c", TIKTOK_CLIENT_SECRET: "d", TIKTOK_REFRESH_TOKEN: "e", INSTAGRAM_TOKEN: "f",
    FACEBOOK_PAGE_ID: "1", FACEBOOK_PAGE_TOKEN: "2", DISCORD_WEBHOOK_URL: "g", STUDIO_DISCORD_WEBHOOK: "h" };
  assert.deepEqual(configured(env).map((p) => p.name).sort(), ["bluesky", "discord", "facebook", "facebook_story", "instagram", "instagram_story", "studio", "tiktok"]);
  // a song: a Reel, a TikTok draft and the kit; the older poster already sends new releases to Bluesky and Discord
  assert.deepEqual(targetsFor(post(), env), ["instagram", "facebook", "tiktok", "studio"]);
  // a list: carousels, the countdown through TikTok and the kit (the kit last: it reads what the others did)
  assert.deepEqual(targetsFor(post({ kind: "chart", targets: "list" }), env), ["instagram", "facebook", "tiktok", "bluesky", "discord", "studio"]);
  // no video (no ffmpeg): no TikTok, no kit
  assert.deepEqual(targetsFor(post({ kind: "chart", targets: "list", media: { image: "a.jpg" } }), env), ["instagram", "facebook", "bluesky", "discord"]);
  // "right now": Stories and the quick feeds only
  assert.deepEqual(targetsFor(post({ kind: "busy", targets: "live" }), env), ["instagram_story", "facebook_story", "bluesky", "discord"]);
  assert.deepEqual(targetsFor(post({ kind: "chart", targets: "list" }), { ...env, SOCIAL_PLATFORMS: "instagram" }), ["instagram"]);
  assert.deepEqual(targetsFor(post(), { ...env, SOCIAL_SKIP: "" }), ["instagram", "facebook", "tiktok", "bluesky", "discord", "studio"]);
});

test("budgets keep each platform to a steady few", () => {
  const H = 3600000, now = Date.UTC(2026, 10, 23, 18);
  const st = (...hoursAgo) => ({ sent: hoursAgo.map((h) => ({ p: "instagram", at: now - h * H })) });
  assert.ok(withinBudget(st(), "instagram", now, {}));
  assert.ok(!withinBudget(st(5), "instagram", now, {}), "one a day");
  assert.ok(!withinBudget(st(19), "instagram", now, {}), "20 hours apart");
  assert.ok(withinBudget(st(23.8), "instagram", now, {}), "yesterday's, a few minutes later in the day, doesn't block today's");
  assert.ok(!withinBudget(st(21, 45, 69, 93, 117), "instagram", now, {}), "five a week");
  assert.ok(withinBudget({ sent: [{ p: "threads", at: now - 5 * H }] }, "threads", now, {}), "Threads: two a day, 4 hours apart");
  assert.ok(!withinBudget({ sent: [{ p: "threads", at: now - 2 * H }] }, "threads", now, {}));
  assert.deepEqual(budgets({ SOCIAL_BUDGET: "threads=3/15/2,x=0" }).threads, [3, 15, 2]);
  assert.ok(!withinBudget({ sent: [] }, "x", now, { SOCIAL_BUDGET: "x=0" }), "0 turns one off");
});

test("the state forgets what's too old and keeps the rest", () => {
  const dir = mkdtempSync(join(tmpdir(), "social-"));
  const file = join(dir, "state.json");
  const s = emptyState();
  const now = Date.UTC(2026, 10, 23);
  markPosted(s, "old", {}, now - 500 * 86400000);
  markPosted(s, "new", {}, now);
  count(s, "2026-11-23", "fresh");
  count(s, "2026-11-23", "fresh");
  count(s, "2026-10-01", "fresh");
  s.queue.push({ at: now - 5 * 86400000 }, { at: now });
  s.sent.push({ p: "x", at: now - 9 * 86400000 }, { p: "x", at: now });
  saveState(file, s, now);
  const back = loadState(file);
  assert.deepEqual(Object.keys(back.posted), ["new"]);
  assert.equal(today(back, "2026-11-23", "fresh"), 2);
  assert.equal(today(back, "2026-10-01", "fresh"), 0);
  assert.equal(back.queue.length, 1);
  assert.equal(back.sent.length, 1);
  assert.ok(!existsSync(file + ".tmp"));
});

test("drawing helpers", () => {
  assert.equal(oneLine("short", 40, 800), "short");
  const cut = oneLine("Together feat. Nikki Nair, Jessy Lanza, Prentiss and many more", 40, 500, 700);
  assert.ok(cut.endsWith("…") && cut.length <= Math.floor(500 / 24));
  assert.equal(usable("#7f7f7f"), "#cc9933"); // grey: the room's gold
  assert.equal(usable("nonsense"), "#cc9933");
  assert.match(usable("#0a2a10"), /^#[0-9a-f]{6}$/);
});
