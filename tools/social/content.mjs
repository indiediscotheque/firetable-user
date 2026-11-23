// What gets posted, and when. Each kind reads the room's public data, picks
// what hasn't been posted, draws its pictures and silent video (render.mjs;
// the song is added in each app from its own licensed sound picker) and
// returns a post: its parts (captions.mjs writes each platform's version from
// them), its link, its keywords and its files.
//
// A week, in the room's time zone (ctx.at; the budgets in run.mjs keep each
// platform's volume down):
//   chart      Monday       the week's top 10: carousel and countdown video
//   rising     Wednesday    what's climbing: carousel
//   newweek    Friday       New Music Friday: the week's best new releases
//   fires      Saturday     the week's most-fired song
//   spotlight  every day    one new release the room has been playing; on a
//                           day without one, the song first played on this
//                           day in an earlier year (onthisday)
//   wrapped    December 1   the year's top 10
//   theme      when it happens   a new room theme, and a recap when one ends
//   busy       when the room fills up (at most once a day): Stories
//
// Posts name songs and artists, never the room's DJs.
// Never deployed (tools/).

import { createHash } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { catalog, coverFor, accountsFor } from "./lookup.mjs";
import { songScene, sceneStill, songVideo, listFrame, titleFrame, slideshowVideo, plainCover } from "./render.mjs";
import { online } from "./data.mjs";
import { http, plain, artists, artistSlug, releaseDay, num, plural, zoned, isoWeek, dayRange } from "./util.mjs";
import { wasPosted, markPosted } from "./state.mjs";
import { roomGenre, phrase, tagsFor, topicOf } from "./keywords.mjs";

const DAY = 86400000;
const short = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 10);
const pick = (list, seed) => list[parseInt(short(seed), 16) % list.length];
const songKey = (t) => (Number(t.type || 1)) + "_" + t.cid;
/**
 * A song whatever upload it was played from: its artist and title, matched
 * loosely ("feat.", case, accents and "(Official Video)" don't count). A song
 * gets one post of its own a year, whichever kind it comes up in (a new
 * release, the room's favourite, On This Day); lists (the chart, New Music
 * Friday) can name it again.
 */
export const songOf = (t) => "song:" + norm(artists(t.a || t.artist)[0] || t.a || t.artist) + "|" + norm(t.t || t.title);
// like util's plain(), but a remix, edit or version is a song of its own
const norm = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\s*[([]?\b(feat|ft|featuring)\b\.?[^)\]]*[)\]]?/g, " ")
  .replace(/[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq)\b[^)\]]*[)\]]/g, " ")
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const fresh1 = (ctx, t) => !wasPosted(ctx.state, songOf(t));
/** The song's own YouTube video: the room plays it from there, and most platforms play a YouTube link right in the post. */
const listenUrl = (t) => Number(t.type || 1) === 1 && t.cid ? "https://www.youtube.com/watch?v=" + encodeURIComponent(t.cid) : null;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const isBot = (ctx, name) => !name || ctx.bots.has(String(name).toLowerCase());

// a question or nudge under each post: comments, saves and sends are what the feeds rank on
const PROMPTS = {
  song: ["Save it for your next playlist.", "Send this to someone who needs it in their headphones.", "Repeat or skip? Tell us below.",
    "Which song should we play after this? Drop it in the comments.", "Late night or first thing in the morning? Tell us when it fits."],
  list: ["Which one's your number one? Tell us below.", "Save this for your next playlist.", "Swipe through: what did we miss?", "Send it to a friend who needs new music."],
  throwback: ["Still on repeat? Tell us below.", "Who else remembers this one?", "Save it for your next throwback playlist."]
};

// ---------------------------------------------------------------- shared

/** The artist's page in the library when it exists, else `fallback`. */
async function pageFor(ctx, artistLine, fallback) {
  const slug = artistSlug(artists(artistLine)[0] || artistLine);
  if (slug) {
    const url = ctx.site + "music/artists/" + slug + "/";
    try {
      const res = await http(url, { method: "HEAD", raw: true, tries: 2 });
      if (res.ok) return url;
    } catch { /* the fallback */ }
  }
  return ctx.site + fallback;
}

/** The room's genre for a song, and artists the same DJs play (for "sounds like"). */
async function genreOf(ctx, t, info) {
  let song = null, lib = null;
  if (t.song) song = await ctx.data.read("globalSongs/" + t.song + "/genres").catch(() => null);
  const slug = artistSlug(artists(t.a)[0] || t.a);
  if (slug) lib = await ctx.data.read("discover/lib/artist/" + slug).catch(() => null);
  let genre = roomGenre(t.g, song || [], (lib && lib.g) || []);
  // a new song isn't tagged yet (the weekly Play history job does that): the genre of the artist's most played songs here
  for (const r of (!genre && lib && lib.rows) || []) {
    const id = await ctx.data.read("globalTracks/" + Number(r.type || 1) + r.cid + "/song").catch(() => null);
    const g = id ? await ctx.data.read("globalSongs/" + id + "/genres").catch(() => null) : null;
    if ((genre = roomGenre(g || []))) break;
    if (lib.rows.indexOf(r) >= 2) break;
  }
  genre = genre || roomGenre(info && info.genre);
  const like = ((lib && lib.sim) || []).map((x) => x && x.n).filter(Boolean).slice(0, 3);
  return { genre, like };
}

/** A song's lookups and cover, ready to draw. */
async function prepare(ctx, t) {
  const song = { artist: t.a || t.artist, title: t.t || t.title, cid: t.cid, type: t.type, image: t.image };
  const info = await catalog(song, ctx.state, { country: ctx.country });
  const cover = await coverFor(song, info);
  return { song, info, cover };
}

/** One song: the 9:16 silent video, the 4:5 picture and the 9:16 still. */
async function songMedia(ctx, base, look) {
  const reel = await songScene(look, "reel");
  const feed = await songScene({ ...look, accent: reel.accent }, "feed");
  const story = await songScene({ ...look, accent: reel.accent }, "story");
  const files = { image: base + "-feed.jpg", story: base + "-story.jpg", video: null };
  writeFileSync(join(ctx.out, files.image), await sceneStill(feed));
  writeFileSync(join(ctx.out, files.story), await sceneStill(story));
  if (ctx.video) {
    files.video = base + ".mp4";
    await songVideo(reel, { duration: ctx.seconds, out: join(ctx.out, files.video), tmp: join(ctx.tmp, base) });
  }
  return { files, accent: reel.accent };
}

function newPost(ctx, kind, id, o) {
  return {
    id, kind, at: ctx.now, emoji: o.emoji || "", title: o.title, hook: o.hook, facts: (o.facts || []).filter(Boolean), prompt: o.prompt || "",
    cta: o.cta || `Listen live, 24/7, on ${ctx.room}`, link: o.link, tags: o.tags || [], topic: o.topic || (o.tags || [])[0] || "",
    searchTitle: o.searchTitle || o.title, sound: o.sound || null, listen: o.listen || null, mentions: o.mentions || {}, media: o.media,
    targets: o.targets || "song", color: o.color || null, platforms: {}
  };
}

/** A song post: the parts every song kind shares. */
async function songPost(ctx, kind, id, t, o) {
  markPosted(ctx.state, songOf(t), { as: id });
  const p = await prepare(ctx, t);
  const { genre, like } = await genreOf(ctx, t, p.info);
  const g = phrase(genre);
  const { files, accent } = await songMedia(ctx, kind + "-" + short(id), {
    cover: p.cover, kicker: o.kicker, title: t.t, artist: t.a, meta: o.meta(genre), site: ctx.host
  });
  const year = zoned(ctx.now, ctx.tz).y;
  return newPost(ctx, kind, id, {
    emoji: o.emoji, title: `${t.a} - ${t.t}`, hook: o.hook(g), facts: [...o.facts, like.length ? `Sounds like ${like.join(", ")}.` : ""],
    prompt: pick(PROMPTS[o.prompts || "song"], id), link: await pageFor(ctx, t.a, o.fallback || ""),
    tags: tagsFor(o.tags, [genre]), topic: topicOf([genre], o.tags[0]),
    searchTitle: o.searchTitle ? o.searchTitle(g, year) : `${t.a} - ${t.t}`, sound: { title: t.t, artist: t.a }, listen: listenUrl(t),
    mentions: await accountsFor(t.a, ctx.state), media: files, color: accent
  });
}

// ---------------------------------------------------------------- spotlight (and on this day)

export async function spotlight(ctx) {
  if (!ctx.force && (ctx.zone.h < ctx.at.spotlight || wasPosted(ctx.state, "spotlight:" + ctx.zone.date))) return null;
  const data = (await ctx.data.read("discover/new")) || {};
  const tracks = (data.tracks || []).filter((t) => t && t.cid && t.rel && t.a && t.t);
  // the first run: what's already out counts as posted, but the newest few
  if (!ctx.state.seeded.fresh) {
    const sorted = [...tracks].sort((a, b) => String(b.rel).localeCompare(String(a.rel)));
    for (const t of sorted.slice(ctx.freshBacklog)) markPosted(ctx.state, "fresh:" + songKey(t), { seeded: true });
    ctx.state.seeded.fresh = true;
  }
  const since = new Date(ctx.now - ctx.freshDays * DAY).toISOString().slice(0, 10);
  // the newest release the room has actually been playing; then the newest
  const t = tracks.filter((x) => String(x.rel) >= since && !wasPosted(ctx.state, "fresh:" + songKey(x)) && fresh1(ctx, x))
    .sort((a, b) => ((b.plays || 0) > 0) - ((a.plays || 0) > 0) || String(b.rel).localeCompare(String(a.rel)) || (b.plays || 0) - (a.plays || 0))[0];
  markPosted(ctx.state, "spotlight:" + ctx.zone.date);
  if (!t) return onthisday(ctx);
  console.log(`spotlight: ${t.a} - ${t.t} (out ${t.rel})`);
  const friday = ctx.zone.wd === 5;
  return songPost(ctx, "fresh", "fresh:" + songKey(t), t, {
    kicker: friday ? "New Music Friday" : "New release", emoji: "🆕",
    meta: (genre) => [genre, "Out " + releaseDay(t.rel), t.plays ? plural(t.plays, "play", "plays") + " in the room" : ""],
    hook: (g) => pick([`New ${g || "music"} from ${t.a}: "${t.t}"`, `${g ? cap(g) + " new release" : "New release"}: ${t.a}, "${t.t}"`, `${t.a} is back with "${t.t}"${g ? `, new ${g}` : ""}`], t.cid).replace(/\s+/g, " "),
    facts: [`Out ${releaseDay(t.rel)}${t.al && !plain(t.al).startsWith(plain(t.t)) && t.al.length < 60 ? ` on ${t.al}` : ""}.`],
    tags: friday ? ["NewMusicFriday", "NewMusic"] : ["NewMusic", "NewRelease"], fallback: "music/new/",
    searchTitle: (g, y) => `${t.a} - ${t.t} (New ${g ? cap(g) + " " : ""}${y})`
  });
}

export async function onthisday(ctx) {
  const rows = ((await ctx.data.read("discover/lib/onThisDay/" + ctx.zone.mmdd)) || []).filter((r) => r && r.cid && r.first);
  const t = rows.filter((r) => zoned(r.first, ctx.tz).y < ctx.zone.y && !wasPosted(ctx.state, "otd-song:" + songKey(r)) && fresh1(ctx, r)).sort((a, b) => (b.plays || 0) - (a.plays || 0))[0];
  if (!t) return null;
  const year = zoned(t.first, ctx.tz).y, ago = ctx.zone.y - year;
  console.log(`on this day: ${t.a} - ${t.t} (${year})`);
  return songPost(ctx, "onthisday", "otd-song:" + songKey(t), t, {
    kicker: `On this day · ${year}`, emoji: "📅", prompts: "throwback",
    meta: (genre) => [genre, plural(t.plays, "play", "plays") + " here"],
    hook: (g) => `${ago === 1 ? "A year" : ago + " years"} ago today, ${t.a}'s "${t.t}" first played in ${ctx.room}${g ? ` (${g})` : ""}`,
    facts: [`${plural(t.plays, "play", "plays")} since, and still on rotation.`],
    tags: ["Throwback", "OnThisDay"], searchTitle: (g) => `${t.a} - ${t.t} | ${g ? cap(g) + " " : ""}throwback from ${year}`
  });
}

// ---------------------------------------------------------------- fires

export async function fires(ctx) {
  const week = isoWeek(ctx.zone.date);
  if (!ctx.force && (ctx.zone.wd !== ctx.at.fires[0] || ctx.zone.h < ctx.at.fires[1] || wasPosted(ctx.state, "fires:" + week))) return null;
  const f = (await ctx.data.read("discover/fires")) || {};
  const songs = [];
  for (const d of Object.values(f.djs || {})) for (const s of d.songs || []) songs.push(s);
  const t = songs.filter((s) => s.cid && (s.fires || 0) >= 2 && ctx.now - (s.w || 0) < 8 * DAY && !wasPosted(ctx.state, "fires-song:" + songKey(s)) && fresh1(ctx, s))
    .sort((a, b) => b.fires - a.fires || (b.w || 0) - (a.w || 0))[0];
  markPosted(ctx.state, "fires:" + week);
  if (!t) return null;
  console.log(`fires: ${t.a} - ${t.t} (${t.fires} fires)`);
  return songPost(ctx, "fires", "fires-song:" + songKey(t), t, {
    kicker: "The room's favourite this week", emoji: "🔥",
    meta: (genre) => [genre, plural(t.fires, "fire", "fires") + " from the room"],
    hook: (g) => `The song the room loved most this week: ${t.a}, "${t.t}"${g ? ` (${g})` : ""}`,
    facts: [`${plural(t.fires, "fire", "fires")} from listeners while it played.`],
    tags: ["NowPlaying", "NewMusic"], fallback: "music/charts/"
  });
}

// ---------------------------------------------------------------- lists (chart, New Music Friday, rising, wrapped)

const move = (r) => r.mv === "new" ? "New" : typeof r.mv === "number" ? (r.mv > 0 ? "↑" + r.mv : r.mv < 0 ? "↓" + -r.mv : "=") : "";

/**
 * A list as pictures and a video:
 *   slides  the carousel: a hook (the top song, or the covers), one song a
 *           slide (each stands on its own: Instagram may show a carousel again
 *           from its second slide), and a closing "listen live" slide
 *   glance  for platforms that take 4 pictures: the hook and the list, five a slide
 *   video   a silent countdown, last place up (the song is added in the app)
 */
async function listMedia(ctx, base, o) {
  const looks = [];
  for (const r of o.rows) looks.push({ r, p: await prepare(ctx, r) });
  const genres = [];
  for (const l of looks.slice(0, 5)) genres.push((await genreOf(ctx, l.r, l.p.info)).genre);
  const covers = looks.slice(0, 4).map((l) => l.p.cover);
  const save = async (name, jpg) => { writeFileSync(join(ctx.out, name), jpg); return name; };
  const rankKicker = (i) => o.ranked === false ? o.kicker : `#${i + 1} · ${o.kicker}`;
  // the hook: the top song itself, or (New Music Friday, Wrapped) the covers and the headline
  const top = looks[0];
  const hookLook = { cover: top.p.cover, kicker: o.kicker + (o.stamp ? " · " + o.stamp : ""), title: top.r.t, artist: top.r.a, meta: o.hookMeta ? o.hookMeta(top.r) : [], site: ctx.host };
  const titleLook = { kicker: o.kicker, title: o.title, sub: o.sub, big: o.big, bigLabel: o.bigLabel, covers, site: ctx.host };
  const hook = await save(base + "-1.jpg", o.hook === "title" ? await titleFrame(titleLook, "feed") : await sceneStill(await songScene(hookLook, "feed")));
  const slides = [hook];
  for (let i = o.hook === "title" ? 0 : 1; i < looks.length; i++) {
    const { r, p } = looks[i];
    slides.push(await save(`${base}-${slides.length + 1}.jpg`, await sceneStill(await songScene({ cover: p.cover, kicker: rankKicker(i), title: r.t, artist: r.a, meta: o.meta ? o.meta(r) : [], site: ctx.host }, "feed"))));
  }
  slides.push(await save(`${base}-${slides.length + 1}.jpg`, await titleFrame({ kicker: "Listen live", title: o.closing || "Hear them all, live, 24/7", sub: "Every song is on our site", covers, site: ctx.host }, "feed")));
  const glance = [hook];
  for (let i = 0; i < looks.length && glance.length < 4; i += 5) {
    glance.push(await save(`${base}-list${glance.length}.jpg`, await listFrame({ kicker: o.kicker, title: o.listTitle || o.title,
      rows: looks.slice(i, i + 5).map((l, j) => ({ rank: o.ranked === false ? null : i + j + 1, cover: l.p.cover, title: l.r.t, artist: l.r.a, note: o.note ? o.note(l.r) : "" })), site: ctx.host }, "feed")));
  }
  const story = await save(base + "-story.jpg", o.hook === "title" ? await titleFrame(titleLook, "story") : await sceneStill(await songScene(hookLook, "story")));
  let video = null;
  if (ctx.video) {
    // about 3 s a song and longer on the top one: 30-40 s, where Reels do best
    const frames = [{ jpg: await titleFrame(titleLook, "reel"), dur: 2.5 }];
    for (let i = looks.length - 1; i >= 0; i--) {
      const { r, p } = looks[i];
      frames.push({ jpg: await sceneStill(await songScene({ cover: p.cover, kicker: rankKicker(i), title: r.t, artist: r.a, meta: o.meta ? o.meta(r) : [], site: ctx.host }, "reel")), dur: i === 0 ? 5 : 3 });
    }
    video = base + ".mp4";
    await slideshowVideo(frames, { out: join(ctx.out, video), tmp: join(ctx.tmp, base) });
  }
  const mentions = {};
  for (const l of looks.slice(0, 3)) for (const [k, v] of Object.entries(await accountsFor(l.r.a, ctx.state, 1))) (mentions[k] = mentions[k] || []).push(...v);
  return { media: { image: hook, slides, glance, story, video }, mentions, genres: genres.filter(Boolean), top: top.r };
}

const topGenres = (genres) => [...new Set(genres)].slice(0, 2);
const genreWords = (g, fallback = "indie and dance") => g.map(phrase).filter(Boolean).join(" and ") || fallback;
const numbered = (rows) => rows.map((r, i) => `${i + 1}. ${r.a} - ${r.t}`).join("\n");

export async function chart(ctx) {
  if (!ctx.force && (ctx.zone.wd !== ctx.at.chart[0] || ctx.zone.h < ctx.at.chart[1])) return null;
  const ids = Object.keys((await ctx.data.read("discover/chartIds/week")) || {}).sort();
  let wk = null, c = null;
  for (const id of ids.slice(-3).reverse()) {
    const x = await ctx.data.read("discover/charts/week/" + id);
    if (x && x.final && (x.rows || []).length >= 5) { wk = id; c = x; break; }
  }
  if (!c || wasPosted(ctx.state, "chart:" + wk)) return null;
  const rows = c.rows.slice(0, 10);
  const range = dayRange(c.from, c.from + 6 * DAY, ctx.tz);
  console.log(`chart: ${wk}, ${rows.length} songs`);
  const m = await listMedia(ctx, "chart-" + wk.toLowerCase(), {
    rows, kicker: "Weekly chart", stamp: range, title: `This week's top ${rows.length}`, listTitle: `Top ${rows.length} · ${range}`,
    sub: `${range} · ${plural(c.plays, "play", "plays")}`, note: move, closing: "Hear the whole chart, live",
    hookMeta: (r) => ["No. 1 this week", plural(r.plays, "play", "plays") + " in the room"],
    meta: (r) => [r.g, plural(r.plays, "play", "plays"), move(r) === "New" ? "New this week" : move(r)]
  });
  const g = topGenres(m.genres);
  return newPost(ctx, "chart", "chart:" + wk, {
    emoji: "📊", title: `Top ${rows.length} ${genreWords(g)} songs this week (${range})`,
    hook: `This week's top ${rows.length} ${genreWords(g)} songs, by plays in ${ctx.room}`,
    facts: [`Number one: ${m.top.a}, "${m.top.t}".`, numbered(rows.slice(0, 5))], prompt: pick(PROMPTS.list, wk),
    link: ctx.site + "music/charts/week/" + wk + "/", tags: tagsFor(["MusicChart", "Top10", "NewMusic"], g), topic: "MusicChart",
    searchTitle: `Top ${rows.length} ${genreWords(g, "indie & dance").replace(" and ", " & ")} songs this week (${range})`,
    sound: { title: m.top.t, artist: m.top.a, note: "the number one" }, mentions: m.mentions, media: m.media, targets: "list"
  });
}

export async function newweek(ctx) {
  const week = isoWeek(ctx.zone.date);
  if (!ctx.force && (ctx.zone.wd !== ctx.at.newweek[0] || ctx.zone.h < ctx.at.newweek[1] || wasPosted(ctx.state, "newweek:" + week))) return null;
  const data = (await ctx.data.read("discover/new")) || {};
  const since = new Date(ctx.now - 8 * DAY).toISOString().slice(0, 10);
  // the week's releases, the ones the room played most first
  const rows = (data.tracks || []).filter((t) => t && t.cid && t.rel && t.a && t.t && String(t.rel) >= since)
    .sort((a, b) => (b.plays || 0) - (a.plays || 0) || String(b.rel).localeCompare(String(a.rel))).slice(0, 10);
  markPosted(ctx.state, "newweek:" + week);
  if (rows.length < 4) return null;
  const range = dayRange(ctx.now - 6 * DAY, ctx.now, ctx.tz);
  console.log(`New Music Friday: ${rows.length} songs`);
  const m = await listMedia(ctx, "nmf-" + week.toLowerCase(), {
    rows, kicker: "New Music Friday", hook: "title", title: `${rows.length} new songs this week`, listTitle: "New this week", sub: range, ranked: false,
    note: (r) => "Out " + releaseDay(r.rel), meta: (r) => ["Out " + releaseDay(r.rel), r.plays ? plural(r.plays, "play", "plays") + " in the room" : ""]
  });
  // they've had their moment: the daily spotlight moves on to newer ones
  for (const r of rows) { markPosted(ctx.state, "fresh:" + songKey(r)); markPosted(ctx.state, songOf(r), { as: "newweek:" + week }); }
  const g = topGenres(m.genres);
  return newPost(ctx, "newweek", "newweek:" + week, {
    emoji: "🆕", title: `New Music Friday: ${rows.length} new ${genreWords(g)} songs`,
    hook: `New Music Friday: ${rows.length} new ${genreWords(g)} songs we played this week`,
    facts: [rows.slice(0, 6).map((r) => `· ${r.a} - ${r.t}`).join("\n")], prompt: pick(PROMPTS.list, week),
    link: ctx.site + "music/new/", tags: tagsFor(["NewMusicFriday", "NewMusic"], g), topic: "NewMusicFriday",
    searchTitle: `New Music Friday: new ${genreWords(g, "indie & dance").replace(" and ", " & ")} songs (${range})`,
    sound: { title: rows[0].t, artist: rows[0].a }, mentions: m.mentions, media: m.media, targets: "list"
  });
}

export async function rising(ctx) {
  const week = isoWeek(ctx.zone.date);
  if (!ctx.force && (ctx.zone.wd !== ctx.at.rising[0] || ctx.zone.h < ctx.at.rising[1] || wasPosted(ctx.state, "rising:" + week))) return null;
  const r = (await ctx.data.read("discover/lib/rising")) || {};
  const rows = (r.rows || []).filter((x) => x && x.cid).slice(0, 5);
  markPosted(ctx.state, "rising:" + week);
  if (rows.length < 3) return null;
  console.log(`rising: ${rows.length} songs`);
  const m = await listMedia(ctx, "rising-" + week.toLowerCase(), {
    rows, kicker: "Rising", title: "Climbing this month", sub: "Played more these four weeks than the four before",
    note: (x) => "↑" + (x.up || 0), hookMeta: (x) => ["Climbing fastest", plural(x.recent, "play", "plays") + " this month"],
    meta: (x) => [plural(x.recent, "play", "plays") + " this month", "↑" + (x.up || 0)]
  });
  const g = topGenres(m.genres);
  return newPost(ctx, "rising", "rising:" + week, {
    emoji: "📈", title: `Rising: ${rows[0].a} - ${rows[0].t} and ${rows.length - 1} more`,
    hook: `${rows.length} ${genreWords(g)} songs climbing fast in ${ctx.room}`,
    facts: [numbered(rows)], prompt: pick(PROMPTS.list, "rising" + week), link: ctx.site + "music/",
    tags: tagsFor(["NewMusic", "NowPlaying"], g), topic: topicOf(g, "NewMusic"), sound: { title: rows[0].t, artist: rows[0].a },
    mentions: m.mentions, media: m.media, targets: "rising"
  });
}

export async function wrapped(ctx) {
  const y = ctx.zone.y;
  if (!ctx.force && (ctx.zone.m !== 12 || ctx.zone.d < ctx.at.wrapped[0] || ctx.zone.h < ctx.at.wrapped[1])) return null;
  if (wasPosted(ctx.state, "wrapped:" + y)) return null;
  const c = await ctx.data.read("discover/charts/year/" + y);
  if (!c || (c.rows || []).length < 10) return null;
  const rows = c.rows.slice(0, 10);
  const byArtist = {};
  for (const r of c.rows) for (const a of artists(r.a).slice(0, 1)) byArtist[a] = (byArtist[a] || 0) + (r.plays || 0);
  const topArtists = Object.entries(byArtist).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => a);
  console.log(`wrapped: ${y}`);
  const m = await listMedia(ctx, "wrapped-" + y, {
    rows, kicker: `Wrapped ${y}`, hook: "title", title: `The songs of ${y}`, listTitle: `Top ${rows.length} of ${y}`, big: num(c.plays), bigLabel: `plays in ${y}`,
    sub: "The year's most played songs", note: (r) => plural(r.plays, "play", "plays"), closing: `Hear ${y}'s best, live`, meta: (r) => [r.g, plural(r.plays, "play", "plays")]
  });
  const g = topGenres(m.genres);
  return newPost(ctx, "wrapped", "wrapped:" + y, {
    emoji: "🎁", title: `Best ${genreWords(g)} songs of ${y}: ${ctx.room} Wrapped`,
    hook: `${ctx.room} Wrapped ${y}: the year's top ${rows.length} ${genreWords(g)} songs, from ${num(c.plays)} plays`,
    facts: [`Number one: ${m.top.a}, "${m.top.t}".`, numbered(rows.slice(0, 5)), topArtists.length ? "Most played artists: " + topArtists.join(", ") + "." : ""],
    prompt: pick(PROMPTS.list, "wrapped" + y), link: ctx.site + "music/charts/year/" + y + "/",
    tags: tagsFor(["Wrapped", "BestOf" + y, "Top10"], g), topic: "BestOf" + y,
    searchTitle: `Best ${genreWords(g, "indie & dance").replace(" and ", " & ")} songs of ${y}: the top ${rows.length}`,
    sound: { title: m.top.t, artist: m.top.a, note: "the number one" }, mentions: m.mentions, media: m.media, targets: "list"
  });
}

// ---------------------------------------------------------------- theme

export async function theme(ctx) {
  const now = String((await ctx.data.read("theme")) || "").trim();
  // the first run only notes the theme; a preview (--force) shows it as new
  const last = ctx.state.last.theme === undefined && ctx.force ? "" : ctx.state.last.theme;
  ctx.state.last.theme = now;
  if (last !== undefined && now && now !== last && !wasPosted(ctx.state, "theme-start:" + now + ":" + ctx.zone.date)) {
    const id = "theme-start:" + now + ":" + ctx.zone.date;
    console.log(`theme: new theme "${now}"`);
    const playing = (await ctx.data.read("songToPlay")) || null;
    const p = playing && playing.cid ? await prepare(ctx, { a: playing.artist, t: playing.title, cid: playing.cid, type: playing.type, image: playing.image }) : null;
    const frame = { kicker: "New theme", title: now, sub: "Bring songs that fit and take a turn on the decks", covers: [p ? p.cover : await plainCover()], site: ctx.host };
    const base = "theme-" + short(id);
    writeFileSync(join(ctx.out, base + "-feed.jpg"), await titleFrame(frame, "feed"));
    writeFileSync(join(ctx.out, base + "-story.jpg"), await titleFrame(frame, "story"));
    return newPost(ctx, "theme", id, {
      emoji: "🎛️", title: `New theme: ${now}`, hook: `New theme in ${ctx.room}: "${now}"`, facts: ["Bring songs that fit and take a turn on the decks. It's free."],
      prompt: "What would you play first?", cta: "Join in", link: ctx.site, tags: tagsFor(["DJ", "MusicCommunity"], [roomGenre(now)]), topic: "MusicCommunity",
      media: { image: base + "-feed.jpg", story: base + "-story.jpg", video: null }, targets: "image"
    });
  }
  if (last === undefined) return null;
  const index = (await ctx.data.read("discover/themes/index")) || {};
  const ended = Object.entries(index).filter(([k, n]) => n && n.to && ctx.now - n.to > 3 * 3600000 && ctx.now - n.to < 3 * DAY && (n.n || 0) >= 10 && !wasPosted(ctx.state, "theme-recap:" + k))
    .sort((a, b) => b[1].to - a[1].to)[0];
  if (!ended) return null;
  const [k, n] = ended;
  console.log(`theme: recap of "${n.theme}"`);
  const night = (await ctx.data.read("discover/themes/night/" + k)) || {};
  const seen = new Set(), top = [];
  for (const r of night.rows || []) {
    if (!r.cid || seen.has(r.cid) || isBot(ctx, r.dj)) continue;
    seen.add(r.cid);
    top.push(r);
    if (top.length === 4) break;
  }
  const covers = [];
  for (const r of top) covers.push((await prepare(ctx, r)).cover);
  const days = Math.max(1, Math.round((n.to - n.from) / DAY));
  const frame = { kicker: "Theme recap", title: n.theme, sub: `${plural(n.n, "song", "songs")}${days > 1 ? ` over ${days} days` : ""}`, covers, site: ctx.host };
  const base = "recap-" + short(k);
  writeFileSync(join(ctx.out, base + "-feed.jpg"), await titleFrame(frame, "feed"));
  writeFileSync(join(ctx.out, base + "-story.jpg"), await titleFrame(frame, "story"));
  return newPost(ctx, "theme", "theme-recap:" + k, {
    emoji: "🎛️", title: `Theme recap: ${n.theme}`, hook: `That's a wrap on "${n.theme}": ${plural(n.n, "song", "songs")}, every one on the playlist`,
    facts: [top.length ? "A few of them: " + top.slice(0, 3).map((r) => `${r.a} - ${r.t}`).join(", ") + "." : ""], prompt: pick(PROMPTS.list, k),
    cta: "Every song, in order", link: ctx.site + "music/themes/" + k + "/", tags: tagsFor(["Playlist"], [roomGenre(n.theme)]), topic: "Playlist",
    media: { image: base + "-feed.jpg", story: base + "-story.jpg", video: null }, targets: "image"
  });
}

// ---------------------------------------------------------------- busy

export async function busy(ctx) {
  if (!ctx.force && ctx.now - (ctx.state.last.busy || 0) < ctx.busyHours * 3600000) return null;
  const people = await online(ctx.data, ctx.bots);
  if (!ctx.force && people.length < ctx.busyMin) return null;
  const table = ((await ctx.data.read("table")) || []).filter((d) => d && !isBot(ctx, d.name));
  const playing = await ctx.data.read("songToPlay");
  ctx.state.last.busy = ctx.now;
  console.log(`busy: ${people.length} in the room`);
  const p = playing && playing.cid ? await prepare(ctx, { a: playing.artist, t: playing.title, cid: playing.cid, type: playing.type, image: playing.image }) : null;
  const frame = { kicker: "Live now", big: String(people.length), bigLabel: "listening right now", covers: [p ? p.cover : await plainCover()],
    title: playing ? playing.title : ctx.room, sub: playing ? playing.artist : "", lines: [table.length ? plural(table.length, "DJ", "DJs") + " on the decks" : ""], site: ctx.host };
  const id = "busy:" + ctx.now;
  const base = "busy-" + short(id);
  writeFileSync(join(ctx.out, base + "-feed.jpg"), await titleFrame(frame, "feed"));
  writeFileSync(join(ctx.out, base + "-story.jpg"), await titleFrame(frame, "story"));
  return newPost(ctx, "busy", id, {
    emoji: "🔴", title: `${people.length} people listening in ${ctx.room} right now`,
    hook: `${people.length} people are listening in ${ctx.room} right now${playing ? `, to ${playing.artist}'s "${playing.title}"` : ""}`,
    facts: [table.length ? `${plural(table.length, "DJ", "DJs")} taking turns on the decks.` : ""], prompt: "Come say hi in the chat.",
    cta: "Come in", link: ctx.site, tags: ["LiveMusic", "NowPlaying", "IndieDiscotheque"], topic: "LiveMusic",
    media: { image: base + "-feed.jpg", story: base + "-story.jpg", video: null }, targets: "live"
  });
}

export const KINDS = { chart, newweek, rising, fires, wrapped, theme, spotlight, onthisday, busy };
// what a scheduled run tries, in this order: the weekly posts first, so they get the day's budget.
// On This Day runs inside spotlight, on days without a new release to show.
export const AUTO = ["chart", "newweek", "rising", "fires", "wrapped", "theme", "spotlight", "busy"];

export function setupDirs(ctx) {
  mkdirSync(ctx.out, { recursive: true });
  mkdirSync(ctx.tmp, { recursive: true });
}
