// Tests for the social posting's own logic: no network, no platform keys.
//   node --test tools/social/social.test.mjs
// CI: .github/workflows/lint.yml. Never deployed (tools/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isoWeek, plain, genreTags, clip, graphemes, dayRange, zoned, artists, artistSlug } from "./util.mjs";
import { caption, linkFor, blueskyFacets, youtubeTitle, hashtags } from "./captions.mjs";
import { oauth1 } from "./platforms/social.mjs";
import { targetsFor, configured } from "./run.mjs";
import { emptyState, saveState, loadState, markPosted, count, today } from "./state.mjs";
import { oneLine, usable } from "./render.mjs";

const post = (o = {}) => ({
  id: "fresh:1_abc", kind: "fresh", emoji: "🆕", title: "Röyksopp & Robyn - Do It Again",
  lead: "Just out: Do It Again by Röyksopp & Robyn, a song with a long enough name to matter when the limits are tight.",
  body: ["Chris brought it to Indie Discotheque.", "Out Nov 20, from a record whose name is also on the long side of things."],
  cta: "Listen live with us", link: "https://www.indiediscotheque.com/music/artists/royksopp/",
  tags: ["newmusicfriday", "newmusic", "synthpop", "electronic", "nowplaying", "indiediscotheque", "extra"],
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
  assert.deepEqual(genreTags("R&B/Soul"), ["r", "b", "soul"].filter((t) => t.length > 1));
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

test("each platform's words fit its limits", () => {
  const p = post();
  // X counts a link as 23 characters
  const xt = caption(p, "x");
  const link = linkFor(p, "x");
  assert.ok(xt.includes(link));
  assert.ok(graphemes(xt.replace(link, "x".repeat(23))) <= 280, "x: " + graphemes(xt));
  assert.ok(graphemes(caption(p, "bluesky")) <= 300);
  assert.ok(graphemes(caption(p, "threads")) <= 500);
  assert.ok(graphemes(caption(p, "mastodon")) <= 500);
  assert.ok(caption(p, "pinterest").length <= 500);
  const ig = caption(p, "instagram");
  assert.match(ig, /link in bio/);
  assert.ok(!ig.includes("https://"), "Instagram links aren't clickable: none in the caption");
  assert.equal((ig.match(/#\w+/g) || []).length, 5);
  assert.match(ig, /@royksopp/);
  assert.equal(hashtags(p, "threads").length, 1);
  assert.ok(youtubeTitle(post({ title: "x".repeat(200) })).length <= 100);
  assert.match(youtubeTitle(p), /#Shorts$/);
  // a lead too long for Bluesky on its own is cut, not dropped
  const long = caption(post({ lead: "word ".repeat(120), body: [] }), "bluesky");
  assert.ok(graphemes(long) <= 300 && long.endsWith("…"));
});

test("links say which platform sent the visit", () => {
  const u = new URL(linkFor(post(), "instagram_story"));
  assert.equal(u.searchParams.get("utm_source"), "instagram");
  assert.equal(u.searchParams.get("utm_medium"), "story");
  assert.equal(u.searchParams.get("utm_campaign"), "fresh");
});

test("Bluesky rich text counts bytes, not characters", async () => {
  const text = "🆕 Röyksopp @royksopp.bsky.social https://example.com/a?b=1 #newmusic";
  const f = await blueskyFacets(text, async () => "did:plc:abc");
  const bytes = Buffer.from(text);
  const slice = (x) => bytes.subarray(x.index.byteStart, x.index.byteEnd).toString();
  assert.deepEqual(f.map(slice), ["https://example.com/a?b=1", "@royksopp.bsky.social", "#newmusic"]);
  assert.equal(f[1].features[0].did, "did:plc:abc");
  assert.equal(f[2].features[0].tag, "newmusic");
});

test("OAuth 1.0a signature matches X's documented example", () => {
  const header = oauth1("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=" + encodeURIComponent("Hello Ladies + Gentlemen, a signed OAuth request!"), {
    key: "xvz1evFS4wEEPTGEFPHBog", secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"
  }, { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" });
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test("a post goes only where its keys are set, and fits the platform", () => {
  const env = { BLUESKY_HANDLE: "a", BLUESKY_APP_PASSWORD: "b", YOUTUBE_CLIENT_ID: "c", YOUTUBE_CLIENT_SECRET: "d", YOUTUBE_REFRESH_TOKEN: "e", INSTAGRAM_TOKEN: "f", DISCORD_WEBHOOK_URL: "g" };
  assert.deepEqual(configured(env).map((p) => p.name).sort(), ["bluesky", "discord", "instagram", "instagram_story", "youtube"]);
  // the older poster already sends new releases to Bluesky and Discord
  assert.deepEqual(targetsFor(post(), env).sort(), ["instagram", "instagram_story", "youtube"]);
  assert.deepEqual(targetsFor(post({ kind: "chart" }), env).sort(), ["bluesky", "discord", "instagram", "instagram_story", "youtube"]);
  // no video: nothing for YouTube
  assert.ok(!targetsFor(post({ kind: "chart", media: { image: "a.jpg" } }), env).includes("youtube"));
  // "right now" posts: stories and the quick feeds only
  assert.deepEqual(targetsFor(post({ kind: "busy", targets: "live", media: { image: "a.jpg", story: "s.jpg" } }), env).sort(), ["bluesky", "discord", "instagram_story"]);
  assert.deepEqual(targetsFor(post({ kind: "chart" }), { ...env, SOCIAL_PLATFORMS: "instagram" }).sort(), ["instagram", "instagram_story"]);
  assert.deepEqual(targetsFor(post(), { ...env, SOCIAL_SKIP: "" }).sort(), ["bluesky", "discord", "instagram", "instagram_story", "youtube"]);
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
  saveState(file, s, now);
  const back = loadState(file);
  assert.deepEqual(Object.keys(back.posted), ["new"]);
  assert.equal(today(back, "2026-11-23", "fresh"), 2);
  assert.equal(today(back, "2026-10-01", "fresh"), 0);
  assert.equal(back.queue.length, 1);
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
