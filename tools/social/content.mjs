// What gets posted, and when. Each kind of post reads the room's public data,
// picks what hasn't been posted, draws its pictures and video (render.mjs)
// and returns a post for the queue: its words (captions.mjs makes each
// platform's version), its link and its files.
//
//   fresh      a new release from Discover's New, as a video with its preview
//   onthisday  the song first played here on this day in an earlier year
//   fires      the week's most-fired song
//   rising     the songs played more these four weeks than the four before
//   chart      the week's top 10, as slides and a countdown video
//   wrapped    the year's top 10 and the room's year in numbers (December)
//   theme      a new room theme, and a recap when one ends
//   busy       the room is full right now: come in
//
// Never deployed (tools/).

import { createHash } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { catalog, coverFor, accountsFor } from "./lookup.mjs";
import { songScene, sceneStill, songVideo, listFrame, titleFrame, slideshowVideo, audioMontage, plainCover } from "./render.mjs";
import { online } from "./data.mjs";
import { http, bytes, plain, artists, artistSlug, genreTags, releaseDay, num, plural, zoned, isoWeek, dayRange } from "./util.mjs";
import { wasPosted, markPosted, today } from "./state.mjs";

const DAY = 86400000;
const short = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 10);
const pick = (list, seed) => list[parseInt(short(seed), 16) % list.length];
const songKey = (t) => (Number(t.type || 1)) + "_" + t.cid;
const ytUrl = (t) => Number(t.type || 1) === 1 && t.cid ? "https://www.youtube.com/watch?v=" + encodeURIComponent(t.cid) : null;

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

function baseTags(kind, extra, ctx) {
  const tags = [...extra];
  if (kind === "fresh" && ctx.zone.wd === 5) tags.unshift("newmusicfriday");
  tags.push(...ctx.tags);
  return [...new Set(tags.map((t) => t.toLowerCase()))];
}

const isBot = (ctx, name) => !name || ctx.bots.has(String(name).toLowerCase());

/** A song's lookups, cover and preview, ready to draw. */
async function prepare(ctx, t) {
  const song = { artist: t.a || t.artist, title: t.t || t.title, cid: t.cid, type: t.type, image: t.image };
  const info = await catalog(song, ctx.state, { country: ctx.country });
  const cover = await coverFor(song, info);
  let audio = null;
  if (ctx.audio && info && info.preview) {
    try {
      const file = join(ctx.tmp, "prev-" + short(info.preview) + (info.preview.includes(".mp3") ? ".mp3" : ".m4a"));
      writeFileSync(file, await bytes(info.preview, { tries: 2 }));
      audio = file;
    } catch (err) { console.log("  preview: " + err.message); }
  }
  return { song, info, cover, audio };
}

/** One song: the 9:16 video (or still, without ffmpeg), the 4:5 picture and the 9:16 still. */
async function songMedia(ctx, base, p, look, seconds) {
  const story = await songScene(look, "story");
  const feed = await songScene({ ...look, accent: story.accent }, "feed");
  const files = { image: base + "-feed.jpg", story: base + "-story.jpg", video: null };
  writeFileSync(join(ctx.out, files.image), await sceneStill(feed));
  writeFileSync(join(ctx.out, files.story), await sceneStill(story));
  if (ctx.video) {
    files.video = base + ".mp4";
    await songVideo(story, { audio: p.audio, start: 0, duration: p.audio ? seconds : Math.min(seconds, 12), out: join(ctx.out, files.video), tmp: join(ctx.tmp, base) });
  }
  return files;
}

function credit(p) {
  if (!p.info) return "";
  return p.audio ? `Preview courtesy of ${p.info.source === "apple" ? "Apple Music" : "Deezer"}.` : "";
}

function newPost(ctx, kind, id, o) {
  return {
    id, kind, at: ctx.now, emoji: o.emoji || "", title: o.title, lead: o.lead, body: (o.body || []).filter(Boolean), cta: o.cta || "Listen live with us",
    link: o.link, tags: baseTags(kind, o.tags || [], ctx), mentions: o.mentions || {}, media: o.media, credit: o.credit || "",
    targets: o.targets, audio: !!o.audio, color: o.color || null, source: o.source || null, platforms: {}
  };
}

// ---------------------------------------------------------------- fresh

export async function fresh(ctx) {
  const date = ctx.zone.date;
  const slots = ctx.freshHours.filter((h) => ctx.zone.h >= h).length;
  const done = today(ctx.state, date, "fresh");
  if (!ctx.force && (done >= slots || done >= ctx.freshPerDay)) return null;
  const data = (await ctx.data.read("discover/new")) || {};
  const tracks = (data.tracks || []).filter((t) => t && t.cid && t.rel && t.a && t.t);
  // the first run: what's already out counts as posted, but the newest few
  if (!ctx.state.seeded.fresh) {
    const sorted = [...tracks].sort((a, b) => String(b.rel).localeCompare(String(a.rel)));
    for (const t of sorted.slice(ctx.freshBacklog)) markPosted(ctx.state, "fresh:" + songKey(t), { seeded: true });
    ctx.state.seeded.fresh = true;
  }
  const since = new Date(ctx.now - ctx.freshDays * DAY).toISOString().slice(0, 10);
  const todo = tracks.filter((t) => String(t.rel) >= since && !wasPosted(ctx.state, "fresh:" + songKey(t)))
    // newest first; songs a DJ brought in, and played more, before the rest
    .sort((a, b) => String(b.rel).localeCompare(String(a.rel)) || (isBot(ctx, b.dj) ? 0 : 1) - (isBot(ctx, a.dj) ? 0 : 1) || (b.plays || 0) - (a.plays || 0));
  const t = todo[0];
  if (!t) return null;
  const id = "fresh:" + songKey(t);
  console.log(`fresh: ${t.a} - ${t.t} (out ${t.rel}; ${todo.length} waiting)`);
  const p = await prepare(ctx, t);
  const genre = (p.info && p.info.genre) || "";
  const dj = isBot(ctx, t.dj) ? "" : t.dj;
  const look = { cover: p.cover, accent: undefined, kicker: ctx.zone.wd === 5 ? "New Music Friday" : "New release", title: t.t, artist: t.a,
    meta: [dj && "Found by " + dj, genre, "Out " + releaseDay(t.rel)], cta: "Listen live, 24/7", site: ctx.host };
  const media = await songMedia(ctx, "fresh-" + short(id), p, look, ctx.seconds);
  const lead = pick([
    `Fresh in the crate: ${t.t} by ${t.a}.`, `New release: ${t.a}, "${t.t}".`, `Just out: ${t.t} by ${t.a}.`, `${t.a} just dropped "${t.t}".`
  ], id);
  return newPost(ctx, "fresh", id, {
    emoji: "🆕", title: `${t.a} - ${t.t}`, lead,
    body: [dj ? `${dj} brought it to ${ctx.room}.` : "", `Out ${releaseDay(t.rel)}${t.al && !plain(t.al).startsWith(plain(t.t)) && t.al.length < 60 ? `, from ${t.al}` : ""}.`],
    link: await pageFor(ctx, t.a, "music/new/"), tags: ["newmusic", ...genreTags(genre), "nowplaying"],
    mentions: await accountsFor(t.a, ctx.state), media, audio: !!p.audio, credit: credit(p), source: ytUrl(t), color: t.c
  });
}

// ---------------------------------------------------------------- on this day

export async function onthisday(ctx) {
  if (!ctx.force && (ctx.zone.h < ctx.at.onthisday || wasPosted(ctx.state, "otd:" + ctx.zone.date))) return null;
  const rows = ((await ctx.data.read("discover/lib/onThisDay/" + ctx.zone.mmdd)) || []).filter((r) => r && r.cid && r.first);
  // the most played song first played on this day in an earlier year, not posted this past year
  const t = rows.filter((r) => zoned(r.first, ctx.tz).y < ctx.zone.y && !wasPosted(ctx.state, "otd-song:" + songKey(r))).sort((a, b) => (b.plays || 0) - (a.plays || 0))[0];
  markPosted(ctx.state, "otd:" + ctx.zone.date);
  if (!t) return null;
  const year = zoned(t.first, ctx.tz).y, ago = ctx.zone.y - year;
  const id = "otd-song:" + songKey(t);
  console.log(`on this day: ${t.a} - ${t.t} (${year})`);
  const p = await prepare(ctx, t);
  const dj = isBot(ctx, t.dj) ? "" : t.dj;
  const look = { cover: p.cover, kicker: `On this day · ${year}`, title: t.t, artist: t.a,
    meta: [dj && "First played by " + dj, plural(t.plays, "play", "plays") + " since"], cta: "Listen live, 24/7", site: ctx.host };
  const media = await songMedia(ctx, "otd-" + short(id), p, look, ctx.seconds);
  return newPost(ctx, "onthisday", id, {
    emoji: "📅", title: `On this day in ${year}: ${t.a} - ${t.t}`,
    lead: `On this day ${ago === 1 ? "a year" : ago + " years"} ago, ${dj || "someone"} first played ${t.t} by ${t.a} in ${ctx.room}.`,
    body: [`It's been played ${plural(t.plays, "time", "times")} since.`],
    link: await pageFor(ctx, t.a, ""), tags: ["onthisday", "throwback", "indiemusic"], mentions: await accountsFor(t.a, ctx.state),
    media, audio: !!p.audio, credit: credit(p), source: ytUrl(t)
  });
}

// ---------------------------------------------------------------- fires

export async function fires(ctx) {
  const week = isoWeek(ctx.zone.date);
  if (!ctx.force && (ctx.zone.wd !== ctx.at.fires[0] || ctx.zone.h < ctx.at.fires[1] || wasPosted(ctx.state, "fires:" + week))) return null;
  const f = (await ctx.data.read("discover/fires")) || {};
  const songs = [];
  for (const d of Object.values(f.djs || {})) for (const s of d.songs || []) songs.push({ ...s, dj: d.name });
  const t = songs.filter((s) => s.cid && (s.fires || 0) >= 2 && ctx.now - (s.w || 0) < 8 * DAY && !wasPosted(ctx.state, "fires-song:" + songKey(s)))
    .sort((a, b) => b.fires - a.fires || (b.w || 0) - (a.w || 0))[0];
  markPosted(ctx.state, "fires:" + week);
  if (!t) return null;
  const id = "fires-song:" + songKey(t);
  console.log(`fires: ${t.a} - ${t.t} (${t.fires} fires)`);
  const p = await prepare(ctx, t);
  const dj = isBot(ctx, t.dj) ? "" : t.dj;
  const look = { cover: p.cover, kicker: "The room's most fired", title: t.t, artist: t.a,
    meta: [plural(t.fires, "fire", "fires"), dj && "played by " + dj], cta: "Listen live, 24/7", site: ctx.host };
  const media = await songMedia(ctx, "fires-" + short(id), p, look, ctx.seconds);
  return newPost(ctx, "fires", id, {
    emoji: "🔥", title: `Most fired this week: ${t.a} - ${t.t}`,
    lead: `The song the room set on fire this week: ${t.t} by ${t.a}.`,
    body: [`${plural(t.fires, "fire", "fires")} from the crowd${dj ? ` when ${dj} played it` : ""}.`],
    link: await pageFor(ctx, t.a, "music/charts/"), tags: ["nowplaying", "indiemusic"], mentions: await accountsFor(t.a, ctx.state),
    media, audio: !!p.audio, credit: credit(p), source: ytUrl(t)
  });
}

// ---------------------------------------------------------------- lists (chart, rising, wrapped)

const move = (r) => r.mv === "new" ? "New" : typeof r.mv === "number" ? (r.mv > 0 ? "↑" + r.mv : r.mv < 0 ? "↓" + -r.mv : "=") : "";

/**
 * Slides (a title slide and the songs, five a slide) and a countdown video: a
 * second or two of each song from the last up, the top one longest.
 */
async function listMedia(ctx, base, o) {
  const looks = [];
  for (const r of o.rows) looks.push({ r, p: await prepare(ctx, r) });
  const covers = looks.map((l) => l.p.cover);
  const slides = [];
  const title = { kicker: o.kicker, title: o.title, sub: o.sub, big: o.big, bigLabel: o.bigLabel, covers: covers.slice(0, 4), site: ctx.host, cta: "Listen live, 24/7" };
  const cover = base + "-1.jpg";
  writeFileSync(join(ctx.out, cover), await titleFrame(title, "feed"));
  slides.push(cover);
  for (let i = 0; i < looks.length; i += 5) {
    const name = base + "-" + (slides.length + 1) + ".jpg";
    writeFileSync(join(ctx.out, name), await listFrame({ kicker: o.kicker, title: o.listTitle || o.title, rows: looks.slice(i, i + 5).map((l, j) => ({ rank: i + j + 1, cover: l.p.cover, title: l.r.t, artist: l.r.a, note: o.note ? o.note(l.r) : "" })), site: ctx.host }, "feed"));
    slides.push(name);
  }
  const storyStill = base + "-story.jpg";
  writeFileSync(join(ctx.out, storyStill), await titleFrame(title, "story"));
  let video = null, audio = false;
  if (ctx.video) {
    // from the last place up to the top: each song's own frame, with its preview
    const frames = [{ jpg: await titleFrame(title, "story"), dur: 2.2 }];
    const clips = [{ file: null, dur: 2.2 }];
    const n = looks.length;
    for (let i = n - 1; i >= 0; i--) {
      const { r, p } = looks[i];
      const dur = i === 0 ? 6 : 2.2;
      const scene = await songScene({ cover: p.cover, kicker: `${o.rankWord || "#"}${i + 1}${o.rankSuffix || ""}`, title: r.t, artist: r.a, meta: o.meta ? o.meta(r) : [], cta: "Listen live, 24/7", site: ctx.host }, "story");
      frames.push({ jpg: await sceneStill(scene), dur });
      clips.push({ file: p.audio, from: i === 0 ? 0 : 10, dur });
      if (p.audio) audio = true;
    }
    video = base + ".mp4";
    const track = audio ? await audioMontage(clips, join(ctx.tmp, base + "-audio.m4a")) : null;
    await slideshowVideo(frames, { audio: track, out: join(ctx.out, video), tmp: join(ctx.tmp, base) });
  }
  const mentions = {};
  for (const l of looks.slice(0, 3)) for (const [k, v] of Object.entries(await accountsFor(l.r.a, ctx.state, 1))) (mentions[k] = mentions[k] || []).push(...v);
  return { media: { image: cover, slides, story: storyStill, video }, audio, mentions, looks };
}

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
  const from = c.from, to = c.from + 6 * DAY;
  console.log(`chart: ${wk}, ${rows.length} songs`);
  const m = await listMedia(ctx, "chart-" + wk.toLowerCase(), {
    rows, kicker: "The room's chart", title: "This week's top " + rows.length, listTitle: "Top " + rows.length + ", " + dayRange(from, to, ctx.tz),
    sub: `${dayRange(from, to, ctx.tz)} · ${plural(c.plays, "play", "plays")} · ${plural(c.djs, "DJ", "DJs")}`,
    note: move, rankWord: "#", rankSuffix: " this week", meta: (r) => [plural(r.plays, "play", "plays"), r.g, move(r) === "New" ? "New this week" : ""]
  });
  const top = rows[0];
  const post = newPost(ctx, "chart", "chart:" + wk, {
    emoji: "📊", title: `${ctx.room}'s top ${rows.length}, ${dayRange(from, to, ctx.tz)}`,
    lead: `This week's top ${rows.length} in ${ctx.room}, voted with plays: ${top.t} by ${top.a} is number one.`,
    body: [rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.a} - ${r.t}`).join("\n"), `${plural(c.plays, "play", "plays")} from ${plural(c.djs, "DJ", "DJs")}.`],
    link: ctx.site + "music/charts/week/" + wk + "/", tags: ["musicchart", "top10", ...genreTags(top.g)], mentions: m.mentions,
    media: m.media, audio: m.audio, credit: m.audio ? "Previews courtesy of Apple Music and Deezer." : ""
  });
  return post;
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
    rows, kicker: "Rising", title: "Rising in the room", sub: "Played more these four weeks than the four before",
    note: (x) => "↑" + (x.up || 0), rankWord: "Rising #", meta: (x) => [plural(x.recent, "play", "plays") + " this month", !isBot(ctx, x.dj) && x.dj ? "found by " + x.dj : ""]
  });
  return newPost(ctx, "rising", "rising:" + week, {
    emoji: "📈", title: `Rising in ${ctx.room}: ${rows[0].a} - ${rows[0].t}`,
    lead: `Climbing fast in ${ctx.room}: ${rows[0].t} by ${rows[0].a}, and ${rows.length - 1} more the DJs can't stop playing.`,
    body: [rows.map((x, i) => `${i + 1}. ${x.a} - ${x.t}`).join("\n")],
    link: ctx.site + "music/", tags: ["newmusic", "indiemusic"], mentions: m.mentions, media: m.media, audio: m.audio,
    credit: m.audio ? "Previews courtesy of Apple Music and Deezer." : ""
  });
}

export async function wrapped(ctx) {
  const y = ctx.zone.y;
  if (!ctx.force && (ctx.zone.m !== 12 || ctx.zone.d < ctx.at.wrapped[0] || ctx.zone.h < ctx.at.wrapped[1])) return null;
  if (wasPosted(ctx.state, "wrapped:" + y)) return null;
  const c = await ctx.data.read("discover/charts/year/" + y);
  if (!c || (c.rows || []).length < 10) return null;
  const rows = c.rows.slice(0, 10);
  // the year's most played artists, from its chart
  const byArtist = {};
  for (const r of c.rows) for (const a of artists(r.a).slice(0, 1)) byArtist[a] = (byArtist[a] || 0) + (r.plays || 0);
  const topArtists = Object.entries(byArtist).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => a);
  console.log(`wrapped: ${y}`);
  const m = await listMedia(ctx, "wrapped-" + y, {
    rows, kicker: `${ctx.room} Wrapped`, title: `${y} in ${ctx.room}`, listTitle: `The top ${rows.length} of ${y}`, big: num(c.plays), bigLabel: "plays this year",
    sub: `${plural(c.djs, "DJ", "DJs")} · the year's most played songs`, note: (r) => plural(r.plays, "play", "plays"), rankWord: "#", rankSuffix: ` of ${y}`,
    meta: (r) => [plural(r.plays, "play", "plays"), r.g, !isBot(ctx, r.dj) && r.dj ? "found by " + r.dj : ""]
  });
  return newPost(ctx, "wrapped", "wrapped:" + y, {
    emoji: "🎁", title: `${ctx.room} Wrapped ${y}: the year's top ${rows.length}`,
    lead: `${ctx.room} Wrapped ${y}: ${num(c.plays)} plays, ${plural(c.djs, "DJ", "DJs")}, and one number one: ${rows[0].t} by ${rows[0].a}.`,
    body: [rows.slice(0, 5).map((r, i) => `${i + 1}. ${r.a} - ${r.t}`).join("\n"), topArtists.length ? "Most played artists: " + topArtists.join(", ") + "." : ""],
    link: ctx.site + "music/charts/year/" + y + "/", tags: ["wrapped", "wrapped" + y, "bestof" + y, "indiemusic"], mentions: m.mentions,
    media: m.media, audio: m.audio, credit: m.audio ? "Previews courtesy of Apple Music and Deezer." : ""
  });
}

// ---------------------------------------------------------------- theme

export async function theme(ctx) {
  const now = String((await ctx.data.read("theme")) || "").trim();
  // the first run only notes the theme; a preview (--force) shows it as new
  const last = ctx.state.last.theme === undefined && ctx.force ? "" : ctx.state.last.theme;
  ctx.state.last.theme = now;
  // a new theme: invite people to play to it
  if (last !== undefined && now && now !== last && !wasPosted(ctx.state, "theme-start:" + now + ":" + ctx.zone.date)) {
    const id = "theme-start:" + now + ":" + ctx.zone.date;
    console.log(`theme: new theme "${now}"`);
    const playing = (await ctx.data.read("songToPlay")) || null;
    const p = playing && playing.cid ? await prepare(ctx, playing) : null;
    const covers = p ? [p.cover] : [await plainCover()];
    const frame = { kicker: "New theme", title: now, sub: "Bring songs that fit and take a turn on the decks", covers, site: ctx.host, cta: "Join in, it's free" };
    const base = "theme-" + short(id);
    writeFileSync(join(ctx.out, base + "-feed.jpg"), await titleFrame(frame, "feed"));
    writeFileSync(join(ctx.out, base + "-story.jpg"), await titleFrame(frame, "story"));
    return newPost(ctx, "theme", id, {
      emoji: "🎛️", title: `New theme in ${ctx.room}: ${now}`, lead: `New theme in ${ctx.room}: "${now}".`,
      body: ["Bring your best songs that fit and take a turn on the decks."], cta: "Join in", link: ctx.site,
      tags: genreTags(now).slice(0, 3).concat(["dj", "musiccommunity"]), media: { image: base + "-feed.jpg", story: base + "-story.jpg", video: null }, targets: "image"
    });
  }
  if (last === undefined) return null;
  // a theme that ended: what it sounded like
  const index = (await ctx.data.read("discover/themes/index")) || {};
  const ended = Object.entries(index).filter(([k, n]) => n && n.to && ctx.now - n.to > 3 * 3600000 && ctx.now - n.to < 3 * DAY && (n.n || 0) >= 10 && !wasPosted(ctx.state, "theme-recap:" + k))
    .sort((a, b) => b[1].to - a[1].to)[0];
  if (!ended) return null;
  const [k, n] = ended;
  console.log(`theme: recap of "${n.theme}"`);
  const night = (await ctx.data.read("discover/themes/night/" + k)) || {};
  const seen = new Set(), picks = [];
  for (const r of night.rows || []) {
    if (!r.cid || seen.has(r.cid) || isBot(ctx, r.dj)) continue;
    seen.add(r.cid);
    picks.push(r);
  }
  const top = picks.slice(0, 4);
  const covers = [];
  for (const r of top) covers.push((await prepare({ ...ctx, audio: false }, r)).cover);
  const days = Math.max(1, Math.round((n.to - n.from) / DAY));
  const djs = (n.djs || []).filter((d) => !isBot(ctx, d));
  const frame = { kicker: "Theme recap", title: n.theme, sub: `${plural(n.n, "song", "songs")}${days > 1 ? ` over ${days} days` : ""} · ${plural(djs.length, "DJ", "DJs")}`, covers,
    lines: [djs.length ? "On the decks: " + djs.slice(0, 8).join(", ") : ""], site: ctx.host, cta: "Hear every song" };
  const base = "recap-" + short(k);
  writeFileSync(join(ctx.out, base + "-feed.jpg"), await titleFrame(frame, "feed"));
  writeFileSync(join(ctx.out, base + "-story.jpg"), await titleFrame(frame, "story"));
  return newPost(ctx, "theme", "theme-recap:" + k, {
    emoji: "🎛️", title: `Theme recap: ${n.theme}`, lead: `That's a wrap on "${n.theme}": ${plural(n.n, "song", "songs")} from ${plural(djs.length, "DJ", "DJs")}.`,
    body: [top.length ? "A few of them: " + top.slice(0, 3).map((r) => `${r.a} - ${r.t}`).join(", ") + "." : "", djs.length ? "Thanks to " + djs.slice(0, 8).join(", ") + "." : ""],
    cta: "Every song, in order", link: ctx.site + "music/themes/" + k + "/", tags: genreTags(n.theme).slice(0, 3).concat(["playlist"]),
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
  const p = playing && playing.cid ? await prepare({ ...ctx, audio: false }, { a: playing.artist, t: playing.title, cid: playing.cid, type: playing.type, image: playing.image }) : null;
  const frame = { kicker: "Live now", big: String(people.length), bigLabel: "in the room right now", covers: [p ? p.cover : await plainCover()],
    title: playing ? `${playing.title}` : ctx.room, sub: playing ? `${playing.artist}${!isBot(ctx, playing.djname) ? " · played by " + playing.djname : ""}` : "",
    lines: [table.length ? "On the decks: " + table.map((d) => d.name).join(", ") : ""], site: ctx.host, cta: "Come hang out" };
  const id = "busy:" + ctx.now;
  const base = "busy-" + short(id);
  writeFileSync(join(ctx.out, base + "-feed.jpg"), await titleFrame(frame, "feed"));
  writeFileSync(join(ctx.out, base + "-story.jpg"), await titleFrame(frame, "story"));
  return newPost(ctx, "busy", id, {
    emoji: "🔴", title: `${people.length} people in ${ctx.room} right now`,
    lead: `${ctx.room} is buzzing: ${people.length} people in the room right now${table.length ? `, ${plural(table.length, "DJ", "DJs")} on the decks` : ""}.`,
    body: [playing ? `Playing now: ${playing.title} by ${playing.artist}.` : ""], cta: "Come hang out", link: ctx.site,
    tags: ["livemusic", "dj", "musiccommunity"], media: { image: base + "-feed.jpg", story: base + "-story.jpg", video: null }, targets: "live"
  });
}

export const KINDS = { busy, theme, chart, wrapped, rising, fires, onthisday, fresh };

export function setupDirs(ctx) {
  mkdirSync(ctx.out, { recursive: true });
  mkdirSync(ctx.tmp, { recursive: true });
}
