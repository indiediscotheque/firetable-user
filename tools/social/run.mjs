#!/usr/bin/env node
// Social posting for the room, hands-off: carousels and pictures posted
// straight to each platform, Instagram Reels with the song from Instagram's own
// licensed library, and every other song post carrying the song's own YouTube
// video, which most platforms play in the post. No audio is ever uploaded.
// Optional extras that need a person: TikTok drafts finished in the app, and a
// daily post kit (platforms/studio.mjs) for YouTube Shorts, Facebook Reels and
// Stories with a music sticker.
//
// Two steps, so the files are on the web server (Instagram, Facebook,
// Threads, Pinterest and Telegram fetch them from a public address) before
// anything is posted:
//
//   node tools/social/run.mjs render  --site URL --state FILE --out DIR [--kind auto|spotlight,chart,…] [--force]
//       picks what's due (content.mjs), draws it into DIR and queues it in FILE,
//       for the platforms whose budget (below) has room
//   node tools/social/run.mjs publish --site URL --state FILE --out DIR [--media-url URL] [--only a,b]
//       sends everything queued; a platform that fails is tried again on the next two runs
//   node tools/social/run.mjs preview --site URL --kind spotlight --out DIR
//       draws one of a kind and prints every platform's words and the post kit, posting nothing
//   node tools/social/run.mjs platforms        which platforms have their keys set
//   node tools/social/run.mjs old-media --state FILE   files on the server to delete (older than 10 days)
//   node tools/social/run.mjs check [DIR]      draw a song and a chart from the site's own images (CI)
//
// --dry-run (render and publish) changes nothing anywhere: publish prints
// what it would send. The workflow (.github/workflows/social.yml) runs
// render, uploads DIR to the site's social/ folder, then runs publish.
//
// Budgets: at most so many posts a day and a week on each platform, and so
// many hours apart, so followers get a steady few rather than a flood. A post
// that would go over leaves that platform out. SOCIAL_BUDGET changes them,
// e.g. "threads=3/15/3,x=0" (a day / a week / hours apart; 0 turns one off).
//
// Settings (environment, all optional):
//   TZ                     the room's time zone for the schedule (default America/Chicago)
//   SOCIAL_SPOTLIGHT_HOUR  when the day's song goes out (default 18)
//   SOCIAL_FRESH_DAYS      only releases out in the last N days (default 14)
//   SOCIAL_SKIP            kind:platform pairs to leave out (default
//                          fresh:bluesky,fresh:discord: the older poster covers those)
//   SOCIAL_PLATFORMS       only these platforms (comma separated)
//   SOCIAL_SECONDS         a song video's length (default 30; Reels do best at 30-60)
//   SOCIAL_BUSY_MIN / SOCIAL_BUSY_HOURS  people online for a "the room is busy"
//                          Story (default 8), and hours between them (default 24)
//   SOCIAL_BOTS            robot DJs left out of counts (default jarvis)
// Platform keys: platforms/*.mjs. Never deployed (tools/).

import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { connect } from "./data.mjs";
import { loadState, saveState, emptyState, markPosted } from "./state.mjs";
import { KINDS, AUTO } from "./content.mjs";
import { caption, youtubeTitle, xReply } from "./captions.mjs";
import { haveFfmpeg, probe } from "./render.mjs";
import { http, bytes, zoned, Handoff } from "./util.mjs";
import { instagram, instagram_story, facebook, facebook_story, threads } from "./platforms/meta.mjs";
import { tiktok } from "./platforms/video.mjs";
import { studio, kit } from "./platforms/studio.mjs";
import { bluesky, mastodon, x, pinterest, telegram, discord } from "./platforms/social.mjs";

// the post kit last: it says what the others have already done
export const PLATFORMS = { instagram, instagram_story, facebook, facebook_story, tiktok, threads, bluesky, mastodon, x, pinterest, telegram, discord, studio };

// where each kind of post goes
const ROUTES = {
  // a song: an Instagram Reel with licensed music (or its picture), the song's own video on
  // Facebook, its picture with the video linked elsewhere; TikTok drafts and the kit only when set up
  song: ["instagram", "facebook", "tiktok", "threads", "bluesky", "mastodon", "x", "pinterest", "telegram", "discord", "studio"],
  // a chart, New Music Friday, Wrapped: carousels everywhere, the countdown video through TikTok and the kit
  list: ["instagram", "facebook", "tiktok", "threads", "bluesky", "mastodon", "x", "pinterest", "telegram", "discord", "studio"],
  // Rising: the quick feeds, and an Instagram Story
  rising: ["instagram_story", "threads", "bluesky", "mastodon", "x", "telegram", "discord"],
  // a theme: Stories and the quick feeds
  image: ["instagram_story", "facebook_story", "threads", "bluesky", "mastodon", "telegram", "discord"],
  // the room right now: Stories and the quickest feeds
  live: ["instagram_story", "facebook_story", "threads", "bluesky", "telegram", "discord"]
};

// [a day, a week, hours apart] for each platform: a steady few, well under what the
// research on unfollows and reach per post found to hurt (README "social posting")
export const BUDGET = {
  instagram: [1, 5, 20], instagram_story: [2, 10, 4], facebook: [1, 4, 20], facebook_story: [1, 7, 8],
  tiktok: [1, 5, 20], studio: [1, 6, 20], threads: [2, 10, 4], bluesky: [2, 12, 3], mastodon: [2, 10, 3],
  x: [1, 6, 12], pinterest: [2, 10, 3], telegram: [2, 12, 3], discord: [2, 12, 3]
};
const TRIES = 3;
const HOUR = 3600000;

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, fallback) => { const i = argv.indexOf("--" + name); return i === -1 ? fallback : argv[i + 1]; };
const flag = (name) => argv.includes("--" + name);
const env = process.env;
const list = (s) => String(s || "").split(",").map((v) => v.trim()).filter(Boolean);

const ready = (p, e) => p.ready ? p.ready(e) : p.needs.every((k) => e[k]);

/** The platforms with their keys set (and allowed by SOCIAL_PLATFORMS). */
export function configured(e = env) {
  const only = list(e.SOCIAL_PLATFORMS);
  return Object.values(PLATFORMS).filter((p) => ready(p, e) && (!only.length || only.includes(p.name) || only.includes(p.name.replace(/_story$/, ""))));
}

/** Each platform's budget, with SOCIAL_BUDGET's changes. */
export function budgets(e = env) {
  const b = { ...BUDGET };
  for (const item of list(e.SOCIAL_BUDGET)) {
    const [name, v] = item.split("=");
    const [d, w, g] = String(v).split("/").map(Number);
    if (b[name]) b[name] = [d, w == null || isNaN(w) ? b[name][1] : w, g == null || isNaN(g) ? b[name][2] : g];
  }
  return b;
}

/** Whether a platform's budget has room for one more now. */
export function withinBudget(state, name, now, e = env) {
  const [day, week, gap] = budgets(e)[name] || [Infinity, Infinity, 0];
  const sent = (state.sent || []).filter((s) => s.p === name);
  const last = Math.max(0, ...sent.map((s) => s.at));
  // a day is the room's calendar day (a run a few minutes early tomorrow still counts as tomorrow)
  const tz = e.TZ || "America/Chicago";
  const date = zoned(now, tz).date;
  return sent.filter((s) => zoned(s.at, tz).date === date).length < day && sent.filter((s) => now - s.at < 7 * 24 * HOUR).length < week && now - last >= gap * HOUR;
}

/** Which platforms a post goes to: where its kind goes, keys are set, the file it needs exists. */
export function targetsFor(post, e = env) {
  const skip = new Set(list(e.SOCIAL_SKIP == null ? "fresh:bluesky,fresh:discord" : e.SOCIAL_SKIP));
  const route = ROUTES[post.targets || "song"];
  const on = new Set(configured(e).map((p) => p.name));
  return route.filter((n) => on.has(n) && !skip.has(post.kind + ":" + n) && !skip.has(post.kind + ":" + n.replace(/_story$/, "")))
    .filter((n) => (n === "tiktok" || n === "studio") ? !!post.media.video : true);
}

function context(data, state, out) {
  const tz = env.TZ || "America/Chicago";
  const now = Date.now();
  const site = data.site;
  return {
    data, state, out: resolve(out), tmp: resolve(out, ".tmp"), now, tz, zone: zoned(now, tz), site, room: data.room,
    host: new URL(site).host.replace(/^www\./, ""), force: flag("force"), video: true, country: env.SOCIAL_COUNTRY || "US",
    seconds: Math.min(60, Number(env.SOCIAL_SECONDS || 30)),
    freshDays: Number(env.SOCIAL_FRESH_DAYS || 14), freshBacklog: Number(env.SOCIAL_FRESH_BACKLOG || 3),
    busyMin: Number(env.SOCIAL_BUSY_MIN || 8), busyHours: Number(env.SOCIAL_BUSY_HOURS || 24),
    bots: new Set(list(env.SOCIAL_BOTS || "jarvis").map((b) => b.toLowerCase())),
    // [weekday (1 = Monday), hour] in TZ: mornings for the weekly posts (when feeds are
    // busiest on weekdays), the evening for the day's song (when the video apps are)
    at: { chart: [1, 9], rising: [3, 9], newweek: [5, 9], fires: [6, 11], spotlight: Number(env.SOCIAL_SPOTLIGHT_HOUR || 18), wrapped: [1, 12] }
  };
}

// ---------------------------------------------------------------- render

async function render() {
  const out = arg("out", "social-out");
  const stateFile = arg("state", "social-state.json");
  const state = loadState(stateFile);
  const data = await connect(arg("site", env.SITE_URL));
  const ctx = context(data, state, out);
  mkdirSync(ctx.out, { recursive: true });
  mkdirSync(ctx.tmp, { recursive: true });
  if (!(await haveFfmpeg())) { console.log("ffmpeg isn't installed: pictures only, no videos"); ctx.video = false; }
  // nothing to post to yet: draw nothing, so nothing is used up before the first keys are set
  if (!configured().length && !flag("dry-run")) {
    console.log("No platform has its keys set yet (README \"social posting\"): nothing drawn.");
    writeFileSync(join(ctx.out, "posts.json"), "[]");
    return;
  }
  const wanted = arg("kind", "auto") === "auto" ? AUTO : list(arg("kind"));
  const made = [];
  state.sent = (state.sent || []).filter((x) => ctx.now - x.at < 8 * 24 * HOUR);
  for (const kind of wanted) {
    if (!KINDS[kind]) throw new Error("no such kind: " + kind + " (" + Object.keys(KINDS).join(", ") + ")");
    let post;
    try { post = await KINDS[kind](ctx); } catch (err) { console.log(`::warning::${kind}: ${err.stack || err.message}`); continue; }
    if (!post) continue;
    if (!ctx.video) post.media.video = null;
    const targets = [], held = [];
    for (const t of targetsFor(post)) (withinBudget(state, t, ctx.now) || ctx.force ? targets : held).push(t);
    if (!targets.length && held.length) {
      // every platform has had its share: this one waits for another day
      console.log(`held ${post.id} for another day: every budget is full (${held.join(", ")})`);
      // its song can come up again
      for (const [k, v] of Object.entries(state.posted)) if (v && v.as === post.id) delete state.posted[k];
      for (const f of [post.media.video, post.media.image, post.media.story, ...(post.media.slides || []), ...(post.media.glance || [])].filter(Boolean)) rmSync(join(ctx.out, f), { force: true });
      continue;
    }
    for (const t of targets) { post.platforms[t] = { status: "pending", tries: 0 }; state.sent.push({ p: t, at: ctx.now }); }
    markPosted(state, post.id, { kind: post.kind, title: post.title });
    for (const f of [post.media.video, post.media.image, post.media.story, ...(post.media.slides || []), ...(post.media.glance || [])].filter(Boolean)) {
      if (!state.media.some((m) => m.file === f)) state.media.push({ file: f, at: ctx.now });
    }
    state.queue.push(post);
    made.push(post);
    console.log(`queued ${post.id}: ${post.title}\n  to: ${targets.join(", ") || "(none: no keys set yet, or every budget is full)"}${held.length ? "\n  held back by the budget: " + held.join(", ") : ""}`);
  }
  rmSync(ctx.tmp, { recursive: true, force: true });
  writeFileSync(join(ctx.out, "posts.json"), JSON.stringify(made.map((p) => ({ id: p.id, title: p.title, media: p.media })), null, 1));
  // a dry run keeps its queue beside the real state, for publish --dry-run to print
  saveState(flag("dry-run") ? stateFile + ".dry" : stateFile, state);
  console.log(made.length ? `Drew ${made.length} post(s) into ${out}.` : "Nothing due this time.");
}

// ---------------------------------------------------------------- publish

/** What a platform would get, in words (dry runs and previews). */
function describe(post, name) {
  const files = [post.media.video && name !== "studio" && (name === "tiktok" || name === "instagram" && post.targets === "song") ? post.media.video
    : name.endsWith("_story") ? post.media.story
      : post.targets === "list" && ["instagram", "facebook", "threads", "telegram"].includes(name) ? post.media.slides.length + " slides"
        : post.targets === "list" && ["bluesky", "mastodon", "x"].includes(name) ? post.media.glance.length + " pictures" : post.media.image].filter(Boolean);
  if (name === "studio") {
    const k = kit(post);
    return `\n--- post kit · ${post.id}\n🎵 Sound: ${k.sound}\n` + k.steps.map((s, i) => `${i + 1}. ${s.where}: ${s.how}` + (s.text ? "\n" + s.text.split("\n").map((l) => "     " + l).join("\n") : "")).join("\n");
  }
  if (name.endsWith("_story")) return `\n--- ${name} · ${post.id}\n[${files.join(", ")}]`;
  return `\n--- ${name} · ${post.id}\n${name === "youtube" ? youtubeTitle(post) + "\n\n" : ""}${caption(post, name)}${name === "x" ? "\n  ↳ reply: " + xReply(post) : ""}\n[${files.join(", ")}]`;
}

async function publish() {
  const dry = flag("dry-run");
  const stateFile = arg("state", "social-state.json");
  const out = resolve(arg("out", "social-out"));
  const state = loadState(dry && existsSync(stateFile + ".dry") ? stateFile + ".dry" : stateFile);
  const site = String(arg("site", env.SITE_URL || "")).replace(/\/?$/, "/");
  const mediaBase = String(arg("media-url", env.SOCIAL_MEDIA_URL || site + "social/")).replace(/\/?$/, "/");
  const only = list(arg("only", ""));
  const cache = new Map();
  const ctx = {
    env, state, dry, log: (m) => console.log("  " + m),
    url: (f) => mediaBase + encodeURIComponent(f),
    async file(f) {
      if (cache.has(f)) return cache.get(f);
      const local = join(out, f);
      const b = existsSync(local) ? readFileSync(local) : await bytes(mediaBase + encodeURIComponent(f));
      cache.set(f, b);
      return b;
    }
  };
  let sent = 0, failed = 0;
  for (const post of state.queue) {
    for (const [name, st] of Object.entries(post.platforms)) {
      if (st.status !== "pending" || (only.length && !only.includes(name))) continue;
      const p = PLATFORMS[name];
      if (!p || !ready(p, env)) { st.status = "skipped"; st.error = "keys no longer set"; continue; }
      if (dry) { console.log(describe(post, name)); continue; }
      // files that Meta, Pinterest and Telegram fetch must be up before we ask them to
      const needUrl = [post.media.video, post.media.image, post.media.story].filter(Boolean)[0];
      if (needUrl) {
        const res = await http(ctx.url(needUrl), { method: "HEAD", raw: true, tries: 2 }).catch(() => null);
        if (!res || !res.ok) { console.log(`::warning::${ctx.url(needUrl)} isn't reachable yet; ${post.id} waits`); break; }
      }
      st.tries++;
      try {
        console.log(`${name}: ${post.id}`);
        const r = await p.publish(post, ctx);
        Object.assign(st, { status: "done", at: Date.now(), id: r.id, url: r.url || null, draft: !!r.draft });
        delete st.error;
        sent++;
        console.log(`  ✓ ${r.url || r.id}${r.draft ? " (a draft in the app)" : ""}`);
      } catch (err) {
        st.error = String(err.message || err).slice(0, 500);
        if (err instanceof Handoff) { st.status = "handoff"; console.log("  → the post kit: " + st.error); continue; }
        if (st.tries >= TRIES) st.status = "failed";
        failed++;
        console.log(`::warning::${name} couldn't post ${post.id} (try ${st.tries} of ${TRIES}): ${st.error}`);
      }
    }
  }
  // finished posts leave the queue, with where they went
  state.queue = state.queue.filter((post) => {
    const open = Object.values(post.platforms).some((s) => s.status === "pending");
    if (!open) {
      const where = Object.fromEntries(Object.entries(post.platforms).map(([k, v]) => [k, v.url || v.status]));
      state.posted[post.id] = { ...(state.posted[post.id] || {}), at: state.posted[post.id]?.at || post.at, done: Date.now(), where };
    }
    return open;
  });
  if (!dry) saveState(stateFile, state);
  console.log(dry ? "\nDry run: nothing was sent." : `Sent ${sent}, ${failed} failed (they're tried again next run).`);
  // a summary for the workflow's page
  if (env.GITHUB_STEP_SUMMARY && !dry) {
    const rows = Object.entries(state.posted).filter(([, v]) => v.done && Date.now() - v.done < 3600000).map(([id, v]) => `| ${id} | ${Object.entries(v.where || {}).map(([k, u]) => /^https?:/.test(u) ? `[${k}](${u})` : `${k}: ${u}`).join(" · ")} |`);
    if (rows.length) writeFileSync(env.GITHUB_STEP_SUMMARY, "| post | where |\n|---|---|\n" + rows.join("\n") + "\n", { flag: "a" });
  }
  if (failed && !sent) process.exitCode = 0; // a platform being down isn't the run's failure
}

// ---------------------------------------------------------------- the rest

async function preview() {
  const out = arg("out", "social-preview");
  const state = existsSync(arg("state", "")) ? loadState(arg("state")) : emptyState();
  const data = await connect(arg("site", env.SITE_URL));
  const ctx = context(data, state, out);
  ctx.force = true;
  mkdirSync(ctx.out, { recursive: true });
  mkdirSync(ctx.tmp, { recursive: true });
  ctx.video = !flag("no-video") && await haveFfmpeg();
  for (const kind of list(arg("kind", "spotlight"))) {
    const post = await KINDS[kind](ctx);
    if (!post) { console.log(kind + ": nothing to show"); continue; }
    console.log(`\n=== ${post.id}: ${post.title}\nfiles: ${JSON.stringify(post.media)}`);
    for (const name of Object.keys(PLATFORMS)) if (ROUTES[post.targets || "song"].includes(name)) console.log(describe(post, name));
  }
  rmSync(ctx.tmp, { recursive: true, force: true });
}

function platforms() {
  const on = new Set(configured().map((p) => p.name));
  for (const p of Object.values(PLATFORMS)) {
    const b = budgets()[p.name];
    const why = p.name === "studio" ? "needs STUDIO_DISCORD_WEBHOOK or STUDIO_TELEGRAM_CHAT_ID" : "needs " + p.needs.filter((k) => !env[k]).join(", ");
    console.log(`${on.has(p.name) ? "✓" : "·"} ${p.name.padEnd(16)} ${(b ? `${b[0]}/day ${b[1]}/week ${b[2]}h apart` : "").padEnd(24)} ${on.has(p.name) ? "keys set" : why}`);
  }
}

function oldMedia() {
  const stateFile = arg("state", "social-state.json");
  const state = loadState(stateFile);
  const keep = new Set(state.queue.flatMap((p) => [p.media.video, p.media.image, p.media.story, ...(p.media.slides || []), ...(p.media.glance || [])]));
  const cutoff = Date.now() - 10 * 86400000;
  const old = state.media.filter((m) => m.at < cutoff && !keep.has(m.file));
  for (const m of old) console.log(m.file);
  state.media = state.media.filter((m) => !old.includes(m));
  if (!flag("dry-run")) saveState(stateFile, state);
}

/** CI: draw a song (picture and video) and a chart from the repository's own images, offline. */
async function check() {
  const { songScene, sceneStill, songVideo, listFrame, titleFrame, squareCover } = await import("./render.mjs");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const dir = argv[1] || join(root, "social-check");
  mkdirSync(dir, { recursive: true });
  const art = await squareCover(readFileSync(root + "img/og.png"));
  const look = { cover: art, kicker: "New release", title: "Röyksopp & Robyn, 坂本龍一 and a title long enough to wrap", artist: "Artist & Another", meta: ["Nu-Disco", "Out Nov 20", "4 plays in the room"], site: "indiediscotheque.com" };
  const story = await songScene(look, "reel");
  const feed = await songScene(look, "feed");
  writeFileSync(join(dir, "story.jpg"), await sceneStill(await songScene(look, "story")));
  writeFileSync(join(dir, "reel.jpg"), await sceneStill(story));
  writeFileSync(join(dir, "feed.jpg"), await sceneStill(feed));
  const rows = Array.from({ length: 5 }, (_, i) => ({ rank: i + 1, cover: art, title: "Song number " + (i + 1), artist: "An artist", note: i ? "↑" + i : "New" }));
  writeFileSync(join(dir, "list.jpg"), await listFrame({ kicker: "Weekly chart", title: "Top 10 · Nov 16–22", rows, site: "indiediscotheque.com" }));
  writeFileSync(join(dir, "title.jpg"), await titleFrame({ kicker: "Live now", big: "12", bigLabel: "listening right now", covers: [art], title: "A song", sub: "An artist", site: "indiediscotheque.com" }, "story"));
  const sharp = (await import("sharp")).default;
  for (const [f, w, h] of [["story.jpg", 1080, 1920], ["reel.jpg", 1080, 1920], ["feed.jpg", 1080, 1350], ["list.jpg", 1080, 1350], ["title.jpg", 1080, 1920]]) {
    const m = await sharp(join(dir, f)).metadata();
    if (m.width !== w || m.height !== h) throw new Error(`${f}: expected ${w} x ${h}, got ${m.width} x ${m.height}`);
  }
  if (await haveFfmpeg()) {
    await songVideo(story, { duration: 3.6, out: join(dir, "song.mp4"), tmp: join(dir, ".tmp") });
    const v = await probe(join(dir, "song.mp4"));
    if (v.width !== 1080 || v.height !== 1920 || Math.abs(v.duration - 3.6) > 0.2 || !v.audio) throw new Error("the video isn't right: " + JSON.stringify(v));
    console.log(`Social: pictures and a ${v.duration.toFixed(1)} s ${v.width} x ${v.height} video draw.`);
  } else console.log("Social: pictures draw (no ffmpeg here, so no video).");
  if (!argv[1]) rmSync(dir, { recursive: true, force: true });
}

const COMMANDS = { render, publish, preview, platforms, "old-media": oldMedia, check };
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!COMMANDS[cmd]) {
    console.error("Usage: node tools/social/run.mjs render|publish|preview|platforms|old-media|check (see the top of this file)");
    process.exit(2);
  }
  await Promise.resolve().then(() => COMMANDS[cmd]()).catch((err) => { console.error(err.stack || err.message); process.exit(1); });
}
