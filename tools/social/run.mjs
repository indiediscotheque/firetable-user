#!/usr/bin/env node
// Social posting for the room: videos with the song playing for Reels,
// Shorts and TikTok, Stories, carousels for the charts, and posts on Threads,
// Bluesky, Mastodon, X, Pinterest, Telegram and Discord.
//
// Two steps, so the files are on the web server (Instagram, Facebook,
// Threads, Pinterest and Telegram fetch them from a public address) before
// anything is posted:
//
//   node tools/social/run.mjs render  --site URL --state FILE --out DIR [--kind auto|fresh,chart,…] [--force]
//       picks what's due (content.mjs), draws it into DIR and queues it in FILE
//   node tools/social/run.mjs publish --site URL --state FILE --out DIR [--media-url URL] [--only a,b]
//       sends everything queued to each platform with its keys set; a
//       platform that fails is tried again on the next two runs
//   node tools/social/run.mjs preview --site URL --kind fresh --out DIR
//       draws one of a kind and prints every platform's words, posting nothing
//   node tools/social/run.mjs platforms        which platforms have their keys set
//   node tools/social/run.mjs old-media --state FILE   files on the server to delete (older than 10 days)
//   node tools/social/run.mjs check [DIR]      draw a song and a chart from the site's own images (CI)
//
// --dry-run (render and publish) changes nothing anywhere: publish prints
// what it would send. The workflow (.github/workflows/social.yml) runs
// render, uploads DIR to the site's social/ folder, then runs publish.
//
// Settings (environment, all optional):
//   TZ                     the room's time zone for the schedule (default America/Chicago)
//   SOCIAL_FRESH_HOURS     hours a new release may go out (default 10,13,16,19), at most
//   SOCIAL_FRESH_PER_DAY   this many a day (default 4)
//   SOCIAL_FRESH_DAYS      only releases out in the last N days (default 21)
//   SOCIAL_SKIP            kind:platform pairs to leave out (default
//                          fresh:bluesky,fresh:discord: the older poster covers those)
//   SOCIAL_PLATFORMS       only these platforms (comma separated)
//   SOCIAL_AUDIO           "false": videos without the song's preview
//   SOCIAL_SECONDS         a song video's length (default 20; previews are 30)
//   SOCIAL_BUSY_MIN / SOCIAL_BUSY_HOURS  people online for a "the room is busy"
//                          post (default 8), and hours between them (default 12)
//   SOCIAL_BOTS            robot DJs left out of credits and counts (default jarvis)
//   SOCIAL_TAGS            hashtags on every post (default indiediscotheque)
//   SOCIAL_MAX_PER_RUN     posts drawn per run, apart from "busy" (default 2)
// Platform keys: platforms/*.mjs. Never deployed (tools/).

import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { connect } from "./data.mjs";
import { loadState, saveState, emptyState, markPosted, count, today } from "./state.mjs";
import { KINDS } from "./content.mjs";
import { caption } from "./captions.mjs";
import { haveFfmpeg, probe } from "./render.mjs";
import { http, bytes, zoned } from "./util.mjs";
import { instagram, instagram_story, facebook, facebook_story, threads } from "./platforms/meta.mjs";
import { youtube, tiktok } from "./platforms/video.mjs";
import { bluesky, mastodon, x, pinterest, telegram, discord } from "./platforms/social.mjs";

export const PLATFORMS = { youtube, tiktok, instagram, instagram_story, facebook, facebook_story, threads, bluesky, mastodon, x, pinterest, telegram, discord };

// where each kind of post goes: a video and its stills; pictures only; "right now"
const ROUTES = {
  video: ["youtube", "tiktok", "instagram", "instagram_story", "facebook", "facebook_story", "threads", "bluesky", "mastodon", "x", "pinterest", "telegram", "discord"],
  image: ["instagram", "instagram_story", "facebook", "facebook_story", "threads", "bluesky", "mastodon", "x", "pinterest", "telegram", "discord"],
  live: ["instagram_story", "facebook_story", "threads", "bluesky", "mastodon", "x", "telegram", "discord"]
};
const TRIES = 3;

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, fallback) => { const i = argv.indexOf("--" + name); return i === -1 ? fallback : argv[i + 1]; };
const flag = (name) => argv.includes("--" + name);
const env = process.env;
const list = (s) => String(s || "").split(",").map((v) => v.trim()).filter(Boolean);

/** The platforms with their keys set (and allowed by SOCIAL_PLATFORMS). */
export function configured(e = env) {
  const only = list(e.SOCIAL_PLATFORMS);
  return Object.values(PLATFORMS).filter((p) => p.needs.every((k) => e[k]) && (!only.length || only.includes(p.name) || only.includes(p.name.replace(/_story$/, ""))));
}

/** Which platforms a post goes to. */
export function targetsFor(post, e = env) {
  const skip = new Set(list(e.SOCIAL_SKIP == null ? "fresh:bluesky,fresh:discord" : e.SOCIAL_SKIP));
  const route = ROUTES[post.targets || "video"];
  return configured(e).map((p) => p.name).filter((n) => route.includes(n) && !skip.has(post.kind + ":" + n) && !skip.has(post.kind + ":" + n.replace(/_story$/, "")))
    .filter((n) => (n === "youtube" || n === "tiktok") ? !!post.media.video : true);
}

function context(data, state, out) {
  const tz = env.TZ || "America/Chicago";
  const now = Date.now();
  const site = data.site;
  return {
    data, state, out: resolve(out), tmp: resolve(out, ".tmp"), now, tz, zone: zoned(now, tz), site, room: data.room,
    host: new URL(site).host.replace(/^www\./, ""), force: flag("force"),
    video: true, audio: env.SOCIAL_AUDIO !== "false", country: env.SOCIAL_COUNTRY || "US",
    seconds: Math.min(30, Number(env.SOCIAL_SECONDS || 20)),
    freshHours: list(env.SOCIAL_FRESH_HOURS || "10,13,16,19").map(Number), freshPerDay: Number(env.SOCIAL_FRESH_PER_DAY || 4),
    freshDays: Number(env.SOCIAL_FRESH_DAYS || 21), freshBacklog: Number(env.SOCIAL_FRESH_BACKLOG || 3),
    busyMin: Number(env.SOCIAL_BUSY_MIN || 8), busyHours: Number(env.SOCIAL_BUSY_HOURS || 12),
    bots: new Set(list(env.SOCIAL_BOTS || "jarvis").map((b) => b.toLowerCase())),
    tags: list(env.SOCIAL_TAGS || "indiediscotheque"),
    // [weekday (1 = Monday), hour] in TZ; wrapped: [first day of December, hour]
    at: { chart: [1, 11], rising: [3, 17], fires: [5, 18], onthisday: 12, wrapped: [1, 14] }
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
  const wanted = arg("kind", "auto") === "auto" ? Object.keys(KINDS) : list(arg("kind"));
  const max = Number(env.SOCIAL_MAX_PER_RUN || 2);
  const made = [];
  for (const kind of wanted) {
    if (!KINDS[kind]) throw new Error("no such kind: " + kind + " (" + Object.keys(KINDS).join(", ") + ")");
    if (kind !== "busy" && made.filter((p) => p.kind !== "busy").length >= max) break;
    let post;
    try { post = await KINDS[kind](ctx); } catch (err) { console.log(`::warning::${kind}: ${err.stack || err.message}`); continue; }
    if (!post) continue;
    const targets = targetsFor(post);
    for (const t of targets) post.platforms[t] = { status: "pending", tries: 0 };
    markPosted(state, post.id, { kind: post.kind, title: post.title });
    if (post.kind === "fresh") count(state, ctx.zone.date, "fresh");
    for (const f of [post.media.video, post.media.image, post.media.story, ...(post.media.slides || [])].filter(Boolean)) {
      if (!state.media.some((m) => m.file === f)) state.media.push({ file: f, at: ctx.now });
    }
    state.queue.push(post);
    made.push(post);
    console.log(`queued ${post.id}: ${post.title}\n  to: ${targets.join(", ") || "(no platform has its keys set yet)"}`);
  }
  rmSync(ctx.tmp, { recursive: true, force: true });
  writeFileSync(join(ctx.out, "posts.json"), JSON.stringify(made.map((p) => ({ id: p.id, title: p.title, media: p.media })), null, 1));
  // a dry run keeps its queue beside the real state, for publish --dry-run to print
  saveState(flag("dry-run") ? stateFile + ".dry" : stateFile, state);
  console.log(made.length ? `Drew ${made.length} post(s) into ${out}.` : "Nothing due this time.");
}

// ---------------------------------------------------------------- publish

async function publish() {
  const dry = flag("dry-run");
  const stateFile = arg("state", "social-state.json");
  const out = resolve(arg("out", "social-out"));
  const state = loadState(dry && existsSync(stateFile + ".dry") ? stateFile + ".dry" : stateFile);
  const site = String(arg("site", env.SITE_URL || "")).replace(/\/?$/, "/");
  const mediaBase = String(arg("media-url", env.SOCIAL_MEDIA_URL || site + "social/")).replace(/\/?$/, "/");
  const only = list(arg("only", ""));
  const date = zoned(Date.now(), env.TZ || "America/Chicago").date;
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
      if (!p || !p.needs.every((k) => env[k])) { st.status = "skipped"; st.error = "keys no longer set"; continue; }
      if (today(state, date, "up:" + name) >= p.cap(env)) { console.log(`${name}: today's limit reached; ${post.id} waits for tomorrow`); continue; }
      if (dry) {
        console.log(`\n--- ${name} · ${post.id}\n${caption(post, name)}\n[${[post.media.video, post.media.slides && post.media.slides.length > 1 ? post.media.slides.length + " slides" : post.media.image].filter(Boolean).join(", ")}]`);
        continue;
      }
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
        count(state, date, "up:" + name);
        sent++;
        console.log(`  ✓ ${r.url || r.id}${r.draft ? " (a draft in the app)" : ""}`);
      } catch (err) {
        st.error = String(err.message || err).slice(0, 500);
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
  for (const kind of list(arg("kind", "fresh"))) {
    const post = await KINDS[kind](ctx);
    if (!post) { console.log(kind + ": nothing to show"); continue; }
    console.log(`\n=== ${post.id}: ${post.title}\nfiles: ${JSON.stringify(post.media)}`);
    for (const name of Object.keys(PLATFORMS)) console.log(`\n--- ${name}\n${caption(post, name)}`);
  }
  rmSync(ctx.tmp, { recursive: true, force: true });
}

function platforms() {
  const on = new Set(configured().map((p) => p.name));
  for (const p of Object.values(PLATFORMS)) console.log(`${on.has(p.name) ? "✓" : "·"} ${p.name.padEnd(16)} ${on.has(p.name) ? "keys set" : "needs " + p.needs.filter((k) => !env[k]).join(", ")}`);
}

function oldMedia() {
  const stateFile = arg("state", "social-state.json");
  const state = loadState(stateFile);
  const keep = new Set(state.queue.flatMap((p) => [p.media.video, p.media.image, p.media.story, ...(p.media.slides || [])]));
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
  const look = { cover: art, kicker: "New release", title: "Röyksopp & Robyn, 坂本龍一 and a title long enough to wrap", artist: "Artist & Another", meta: ["Found by a DJ", "Nu-Disco", "Out Nov 20"], cta: "Listen live, 24/7", site: "indiediscotheque.com" };
  const story = await songScene(look, "story");
  const feed = await songScene(look, "feed");
  writeFileSync(join(dir, "story.jpg"), await sceneStill(story));
  writeFileSync(join(dir, "feed.jpg"), await sceneStill(feed));
  const rows = Array.from({ length: 5 }, (_, i) => ({ rank: i + 1, cover: art, title: "Song number " + (i + 1), artist: "An artist", note: i ? "↑" + i : "New" }));
  writeFileSync(join(dir, "list.jpg"), await listFrame({ kicker: "The room's chart", title: "Top 10, Nov 16–22", rows, site: "indiediscotheque.com" }));
  writeFileSync(join(dir, "title.jpg"), await titleFrame({ kicker: "Live now", big: "12", bigLabel: "in the room right now", covers: [art], title: "A song", sub: "An artist", site: "indiediscotheque.com", cta: "Come hang out" }, "story"));
  const sharp = (await import("sharp")).default;
  for (const [f, w, h] of [["story.jpg", 1080, 1920], ["feed.jpg", 1080, 1350], ["list.jpg", 1080, 1350], ["title.jpg", 1080, 1920]]) {
    const m = await sharp(join(dir, f)).metadata();
    if (m.width !== w || m.height !== h) throw new Error(`${f}: expected ${w} x ${h}, got ${m.width} x ${m.height}`);
  }
  if (await haveFfmpeg()) {
    await songVideo(story, { audio: null, duration: 3, out: join(dir, "song.mp4"), tmp: join(dir, ".tmp") });
    const v = await probe(join(dir, "song.mp4"));
    if (v.width !== 1080 || v.height !== 1920 || Math.abs(v.duration - 3) > 0.2 || !v.audio) throw new Error("the video isn't right: " + JSON.stringify(v));
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
