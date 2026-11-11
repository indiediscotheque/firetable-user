#!/usr/bin/env node
// Plain pages for search engines: Discover's library as ordinary HTML under
// /music/, one page per genre, DJ, artist (the 500 most played), year and
// chart, with a sitemap. Each page lists its songs and links into the room
// (/#discover/...), where they play.
//
// It reads what Discover reads, from the public parts of the database:
// discover/lib/ (the weekly Play history job in firetable-hostbot) and
// discover/charts/ (the bot). The database address and room name come from
// the site's own config.js, so it needs no secrets. DJs who turned off "Show
// my name on public pages" are already left out of that data.
//
//   node tools/plain-pages.mjs --site https://indiediscotheque.com/ [--out music]
//     [--artists 500] [--always (even with discover off in config.js)]
//   FIREBASE_DATABASE_URL overrides config.js's database address.
//
// The deploy (.github/workflows/deploy.yml) runs it, uploads music/ and
// removes pages that are no longer built. Never deployed itself (tools/).
// Writes <out>/.built when it finishes, so a failed run never empties the
// folder on the server.

import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf("--" + name); return i === -1 ? fallback : args[i + 1]; };
const SITE = String(arg("site", process.env.SITE_URL || "")).replace(/\/?$/, "/");
const OUT = arg("out", "music");
const BASE = "/music/";
const ARTISTS = Number(arg("artists", 500));
const ROWS = 50;

if (!/^https?:\/\//.test(SITE)) {
  console.error("Give the site's address: --site https://example.com/ (or SITE_URL)");
  process.exit(2);
}

// ---------------------------------------------------------------- reading

async function getText(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "firetable-plain-pages" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(url + " answered " + res.status);
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

const config = await getText(SITE + "config.js");
if (!config) throw new Error("couldn't read " + SITE + "config.js");
const pick = (re) => (config.match(re) || [])[1];
const DB = String(process.env.FIREBASE_DATABASE_URL || pick(/databaseURL:\s*["']([^"']+)["']/) || "").replace(/\/$/, "");
const ROOM = pick(/roomName:\s*["']([^"']+)["']/) || "the room";
if (!DB) throw new Error("no databaseURL in config.js");
if (!/discover:\s*true/.test(config) && !args.includes("--always")) {
  console.log("Discover is off in config.js (discover: true), so no plain pages.");
  process.exit(0);
}

const read = async (path) => {
  const url = new URL(DB); // keeps a ?ns= (the local emulator)
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + path.split("/").map(encodeURIComponent).join("/") + ".json";
  const text = await getText(url.href);
  return text == null ? null : JSON.parse(text);
};
/** Read many paths, a few at a time. */
async function readAll(paths) {
  const out = {};
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < paths.length) {
      const p = paths[next++];
      out[p] = await read(p);
    }
  }));
  return out;
}

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = (x) => Number(x || 0).toLocaleString("en-US");
const plural = (x, one, many) => n(x) + " " + (Number(x) === 1 ? one : many);
const year = (ms) => new Date(ms).getFullYear();
const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const genreSlug = (g) => String(g || "").toLowerCase().replace(/[-_/]+/g, " ").replace(/&/g, "and").replace(/\s+/g, " ").trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const artistSlug = (name) => String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ł/g, "l")
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const ARTIST_SPLIT = /(\s*(?:,|;|\s&\s|\s\+\s|\s+and\s+|\s+x\s+|\s+vs\.?\s+|\s+versus\s+|\s+with\s+|\s+\/\s+|\s+×\s+|、)\s*)/i;
const art = (t) => Number(t.type || 1) === 1 ? "https://i.ytimg.com/vi/" + encodeURIComponent(t.cid) + "/mqdefault.jpg" : SITE + "img/idlogo.png";
const songUrl = (t) => Number(t.type || 1) === 1 ? "https://www.youtube.com/watch?v=" + encodeURIComponent(t.cid) : null;
const coverOf = (key) => { const i = String(key).indexOf("_"); return art({ type: Number(key.slice(0, i)) || 1, cid: key.slice(i + 1) }); };

// what's published, so links only go to pages that exist
const have = { genre: new Set(), dj: new Map(), artist: new Set() };
const djHref = (name, uid) => {
  const key = (uid && have.dj.get("uid:" + uid)) || (name && have.dj.get("name:" + String(name).toLowerCase()));
  return key ? BASE + "djs/" + key + "/" : null;
};
const artistLine = (a) => String(a || "").split(ARTIST_SPLIT).map((part, i) => {
  const slug = i % 2 ? null : artistSlug(part);
  return slug && have.artist.has(slug) ? '<a href="' + BASE + "artists/" + slug + '/">' + esc(part) + "</a>" : esc(part);
}).join("");
const djName = (name, uid) => {
  const href = djHref(name, uid);
  return href ? '<a href="' + href + '">' + esc(name) + "</a>" : esc(name);
};

// ---------------------------------------------------------------- pages

const pages = []; // {path, html, lastmod}
const updated = { at: Date.now() };

function page({ path, title, description, h1, crumbs, open, image, ld, body }) {
  const url = SITE.replace(/\/$/, "") + BASE + path;
  const nav = [["genres/", "Genres"], ["djs/", "DJs"], ["years/", "Years"], ["charts/", "Charts"]];
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(ROOM)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="${esc(ROOM)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ""}<meta name="theme-color" content="#181818">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="stylesheet" href="/css/fonts-local.css?v=1">
<link rel="stylesheet" href="/css/plain.css?v=1">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n` : ""}</head>
<body>
<header class="p-top">
<a class="p-logo" href="${BASE}"><img src="/img/idlogo.png" alt="${esc(ROOM)}" width="64" height="32"></a>
<nav aria-label="Library">${nav.map(([href, label]) => `<a href="${BASE}${href}"${path.startsWith(href) ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
<a class="p-butt" href="/${esc(open || "#discover")}">Open ${esc(ROOM)}</a>
</header>
<main>
${crumbs && crumbs.length ? `<p class="p-crumbs">${crumbs.map(([href, label]) => `<a href="${BASE}${href}">${esc(label)}</a>`).join(" / ")}</p>\n` : ""}<h1>${esc(h1 || title)}</h1>
${body}
</main>
<footer class="p-foot">
<p>${esc(ROOM)} is a live room where DJs take turns playing songs for each other. These pages come from the room's play history and are updated every week.</p>
<p><a href="/${esc(open || "#discover")}">Listen in the room</a> · <a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></p>
</footer>
</body>
</html>
`;
  pages.push({ path, html });
}

/** A numbered list of songs. */
function songs(list, opts = {}) {
  list = (list || []).filter((t) => t && t.cid).slice(0, opts.max || ROWS);
  if (!list.length) return '<p class="p-note">Nothing here yet.</p>';
  return `<ol class="p-songs">` + list.map((t, i) => {
    const link = songUrl(t);
    const who = t.dj ? djName(t.dj, t.djid) : "";
    const facts = [];
    if (opts.stamp) facts.push(opts.stamp(t));
    else if (t.plays) facts.push(plural(t.plays, "play", "plays"));
    if (t.first && !opts.noFirst) facts.push("first played " + day(t.first) + (who ? " by " + who : ""));
    if (opts.extra) facts.push(opts.extra(t));
    return `<li><span class="p-n">${i + 1}</span><img src="${esc(art(t))}" alt="" width="64" height="36" loading="lazy">` +
      `<span class="p-song"><b>${link ? `<a href="${esc(link)}" rel="noopener">${esc(t.t)}</a>` : esc(t.t)}</b><span>${artistLine(t.a)}</span>` +
      `<small>${facts.filter(Boolean).join(" · ")}</small></span></li>`;
  }).join("") + `</ol>`;
}
const playlistLd = (name, url, list) => ({
  "@context": "https://schema.org", "@type": "MusicPlaylist", name, url: SITE.replace(/\/$/, "") + BASE + url,
  numTracks: (list || []).length,
  track: (list || []).slice(0, ROWS).filter((t) => t && t.cid).map((t) => ({
    "@type": "MusicRecording", name: t.t, byArtist: { "@type": "MusicGroup", name: t.a }, ...(songUrl(t) ? { url: songUrl(t) } : {})
  }))
});
const mosaic = (keys) => `<span class="p-mosaic" aria-hidden="true">${(keys || []).slice(0, 4).concat([null, null, null, null]).slice(0, 4)
  .map((k) => k ? `<img src="${esc(coverOf(k))}" alt="" loading="lazy">` : "<i></i>").join("")}</span>`;

// ---------------------------------------------------------------- build

const [genres, djs, artistIndex, years, chartIds] = await Promise.all([
  read("discover/lib/genres"), read("discover/lib/djs"), read("discover/lib/artistIndex"), read("discover/lib/years"), read("discover/chartIds")
]);
const meta = await read("discover/lib/meta");
if (meta && meta.at) updated.at = meta.at;
if (!genres && !djs && !chartIds) {
  console.log("No library or charts published yet, so no plain pages. Run the Play history job in firetable-hostbot.");
  process.exit(0);
}

Object.keys(genres || {}).forEach((k) => have.genre.add(k));
Object.entries(djs || {}).forEach(([k, d]) => { if (d.djid) have.dj.set("uid:" + d.djid, k); if (d.name) have.dj.set("name:" + String(d.name).toLowerCase(), k); });
const topArtists = Object.entries(artistIndex || {}).sort((a, b) => (b[1][1] || 0) - (a[1][1] || 0)).slice(0, ARTISTS);
topArtists.forEach(([k]) => have.artist.add(k));

const genreList = Object.entries(genres || {}).map(([slug, g]) => ({ slug, ...g })).sort((a, b) => (b.plays || 0) - (a.plays || 0));
const djList = Object.entries(djs || {}).map(([key, d]) => ({ key, ...d })).sort((a, b) => (b.plays || 0) - (a.plays || 0));
const yearList = Object.keys(years || {}).sort().reverse();

const lib = await readAll([
  ...genreList.map((g) => "discover/lib/genre/" + g.slug),
  ...djList.map((d) => "discover/lib/dj/" + d.key),
  ...topArtists.map(([k]) => "discover/lib/artist/" + k),
  ...yearList.map((y) => "discover/lib/year/" + y)
]);

// genres
if (genreList.length) {
  page({
    path: "genres/", title: "Genres", description: `The ${genreList.length} genres played in ${ROOM}, from the room's play history: songs, plays and usual tempo for each.`,
    open: "#discover/genres",
    body: `<p class="p-lede">Every sound the room plays, most played first.</p><ul class="p-cards">` + genreList.map((g) =>
      `<li><a href="${BASE}genres/${g.slug}/">${mosaic(g.covers)}<b>${esc(g.name)}</b><small>${plural(g.songs, "song", "songs")} · ${plural(g.plays, "play", "plays")}${g.bpm ? " · " + g.bpm + " BPM" : ""}</small></a></li>`).join("") + `</ul>`
  });
  genreList.forEach((g) => {
    const p = lib["discover/lib/genre/" + g.slug];
    if (!p) return;
    const facts = [plural(g.songs, "song", "songs"), plural(g.plays, "play", "plays")];
    if (g.bpm) facts.push("usually " + g.bpm + " BPM");
    if (g.first) facts.push("played here since " + g.first);
    const who = (p.who || []).filter((x) => x.dj);
    const next = (g.next || []).filter((k) => genres[k]);
    const top = (p.fav || []).slice(0, 3).map((t) => t.a + " - " + t.t).join(", ");
    page({
      path: "genres/" + g.slug + "/", title: g.name + " songs", h1: g.name,
      description: `The ${g.name} songs ${ROOM} plays most${top ? ", including " + top : ""}. ${facts.join(", ")}.`,
      crumbs: [["genres/", "Genres"]], open: "#discover/genres/" + g.slug, image: g.covers && g.covers[0] ? coverOf(g.covers[0]) : null,
      ld: playlistLd(g.name + " in " + ROOM, "genres/" + g.slug + "/", p.fav),
      body: `<p class="p-facts">${esc(facts.join(" · "))}</p>
<p><a class="p-butt" href="/#discover/genres/${g.slug}">Play ${esc(g.name)} radio in the room</a></p>
<section><h2>Room favorites</h2>${songs(p.fav)}</section>
${(p.newHere || []).length ? `<section><h2>New here</h2><p class="p-note">Played in the room for the first time lately.</p>${songs(p.newHere, { max: 20 })}</section>` : ""}
${(p.deep || []).length ? `<section><h2>Deep cuts</h2><p class="p-note">Played here once or twice.</p>${songs(p.deep, { max: 20 })}</section>` : ""}
${who.length ? `<section><h2>Who plays it</h2><ul class="p-list">${who.map((x) => `<li>${djName(x.dj, x.djid)} <small>${plural(x.plays, "play", "plays")}</small></li>`).join("")}</ul></section>` : ""}
${next.length ? `<section><h2>Next door</h2><ul class="p-tags">${next.map((k) => `<li><a href="${BASE}genres/${k}/">${esc(genres[k].name)}</a></li>`).join("")}</ul></section>` : ""}`
    });
  });
}

// DJs
if (djList.length) {
  page({
    path: "djs/", title: "DJs", description: `The DJs of ${ROOM}: ${djList.length} people with 25 or more plays, their sound and the songs they play most.`,
    open: "#discover/djs",
    body: `<p class="p-lede">Everyone with 25 or more plays in the room, most plays first.</p><ul class="p-list p-cols">` + djList.map((d) =>
      `<li><a href="${BASE}djs/${d.key}/">${esc(d.name)}</a> <small>${plural(d.plays, "play", "plays")}${(d.g || []).length ? " · " + esc(d.g.join(", ")) : ""}</small></li>`).join("") + `</ul>`
  });
  djList.forEach((d) => {
    const p = lib["discover/lib/dj/" + d.key];
    if (!p) return;
    const facts = [];
    if (p.since) facts.push("here since " + year(p.since));
    facts.push(plural(p.plays, "play", "plays"));
    if (p.firsts) facts.push(n(p.firsts) + " songs brought here first");
    if (p.when) facts.push("usually " + p.when);
    const taste = (p.taste || []).filter((x) => x.g);
    const similar = (p.similar || []).filter((x) => x.key && djs[x.key]);
    page({
      path: "djs/" + d.key + "/", title: p.name + ", DJ", h1: p.name,
      description: `${p.name} DJs in ${ROOM}${taste.length ? ", mostly " + taste.filter((x) => x.slug).slice(0, 3).map((x) => x.g).join(", ") : ""}. ${facts.join(", ")}.`,
      crumbs: [["djs/", "DJs"]], open: "#discover/djs/" + d.key,
      ld: { "@context": "https://schema.org", "@type": "ProfilePage", mainEntity: { "@type": "Person", name: p.name }, url: SITE.replace(/\/$/, "") + BASE + "djs/" + d.key + "/" },
      body: `<p class="p-facts">${esc(facts.join(" · "))}</p>
${taste.length ? `<section><h2>Their sound</h2><ul class="p-taste">${taste.map((x) => `<li${x.slug ? "" : ' class="p-other"'}>${x.slug && have.genre.has(x.slug) ? `<a href="${BASE}genres/${x.slug}/">${esc(x.g)}</a>` : esc(x.g)}<span class="p-bar"><i style="width:${Math.max(1, Math.min(100, Math.round(x.pct)))}%"></i></span><small>${esc(x.pct)}%</small></li>`).join("")}</ul></section>` : ""}
<section><h2>Most played</h2>${songs(p.most, { noFirst: true, stamp: (t) => plural(t.by, "play", "plays") + " by " + esc(p.name) })}</section>
${(p.firstHere || []).length ? `<section><h2>Brought here first</h2>${songs(p.firstHere, { max: 30, stamp: (t) => plural(t.plays, "play", "plays") + " in the room", noFirst: false })}</section>` : ""}
${similar.length ? `<section><h2>Similar DJs</h2><ul class="p-list">${similar.map((x) => `<li><a href="${BASE}djs/${x.key}/">${esc(x.name)}</a> <small>${esc(x.pct)}% alike</small></li>`).join("")}</ul></section>` : ""}`
    });
  });
}

// artists
const artistPages = [];
topArtists.forEach(([slug]) => {
  const a = lib["discover/lib/artist/" + slug];
  if (!a) { have.artist.delete(slug); return; }
  artistPages.push([slug, a]);
});
artistPages.forEach(([slug, a]) => {
  const facts = [plural(a.songs, "song", "songs") + " played here", plural(a.plays, "play", "plays")];
  const who = (a.djs || []).filter((x) => x.dj);
  const top = (a.rows || []).slice(0, 3).map((t) => t.t).join(", ");
  page({
    path: "artists/" + slug + "/", title: a.name + " in " + ROOM, h1: a.name,
    description: `${a.name} songs played in ${ROOM}${top ? ": " + top : ""}. ${facts.join(", ")}.`,
    crumbs: [["artists/", "Artists"]], open: "#discover/artist/" + slug, image: a.rows && a.rows[0] ? art(a.rows[0]) : null,
    ld: playlistLd(a.name + " in " + ROOM, "artists/" + slug + "/", a.rows),
    body: `<p class="p-facts">${esc(facts.join(" · "))}${a.first ? " · first played here " + day(a.first) + (a.firstDj ? " by " + djName(a.firstDj, a.firstDjid) : "") : ""}</p>
<section><h2>Most played here</h2>${songs(a.rows, { noFirst: true })}</section>
${who.length ? `<section><h2>Who plays them</h2><ul class="p-list">${who.map((x) => `<li>${djName(x.dj, x.djid)} <small>${plural(x.plays, "play", "plays")}</small></li>`).join("")}</ul></section>` : ""}`
  });
});
if (artistPages.length) {
  page({
    path: "artists/", title: "Artists", description: `The ${artistPages.length} artists played most in ${ROOM}.`, open: "#discover",
    body: `<p class="p-lede">The ${artistPages.length} artists the room plays most.</p><ul class="p-list p-cols">` +
      artistPages.map(([slug, a]) => `<li><a href="${BASE}artists/${slug}/">${esc(a.name)}</a> <small>${plural(a.plays, "play", "plays")}</small></li>`).join("") + `</ul>`
  });
}

// years
if (yearList.length) {
  page({
    path: "years/", title: "Years", description: `${ROOM}'s playlist for each year since ${yearList[yearList.length - 1]}, and what the room played most from each.`,
    open: "#discover/years",
    body: `<ul class="p-list">` + yearList.map((y) => { const v = years[y] || {};
      return `<li><a href="${BASE}years/${y}/">${y}</a> <small>${plural(v.songs, "song", "songs")} · ${n(v.played)} played here${v.genre ? " · mostly " + esc(v.genre) : ""}</small></li>`; }).join("") + `</ul>`
  });
  yearList.forEach((y) => {
    const p = lib["discover/lib/year/" + y];
    if (!p) return;
    const v = years[y] || {};
    page({
      path: "years/" + y + "/", title: "The best songs of " + y, h1: y,
      description: `The ${y} songs ${ROOM} played most, from the room's ${y} playlist of ${n(v.songs)} songs${v.genre ? ", mostly " + v.genre : ""}.`,
      crumbs: [["years/", "Years"]], open: "#discover/years/" + y,
      ld: playlistLd(y + " in " + ROOM, "years/" + y + "/", p.top),
      body: `<p class="p-facts">${plural(v.songs, "song", "songs")} on the playlist · ${n(v.played)} played here${v.genre ? " · mostly " + esc(v.genre) : ""}</p>
<section><h2>Most played here</h2>${songs(p.top)}</section>
${(p.more || []).length ? `<section><h2>Not played here yet</h2>${songs(p.more, { max: 24, stamp: () => "" })}</section>` : ""}`
    });
  });
}

// charts
const chartPaths = [];
["week", "month", "year"].forEach((period) => Object.keys((chartIds || {})[period] || {}).forEach((id) => chartPaths.push("discover/charts/" + period + "/" + id)));
chartPaths.push("discover/charts/all/all");
const charts = await readAll(chartPaths);
const chartName = (period, id, c) => {
  if (period === "all") return "All time";
  if (period === "year") return id;
  if (period === "month") { const m = /^(\d{4})-(\d\d)$/.exec(id); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : id; }
  return "Week " + Number(id.split("-W")[1]) + ", " + id.slice(0, 4) + (c && c.from ? " (" + day(c.from) + " to " + day(c.to - 1) + ")" : "");
};
const chartList = [];
chartPaths.forEach((p) => {
  const c = charts[p];
  if (!c || !(c.rows || []).length) return;
  const [, , period, id] = p.split("/");
  const name = chartName(period, id, c);
  const path = "charts/" + (period === "all" ? "all-time" : period + "/" + id) + "/";
  chartList.push({ period, id, name, path, c });
  page({
    path, title: ROOM + " chart: " + name, h1: "Room chart: " + name,
    description: `The songs played most in ${ROOM}, ${period === "all" ? "of all time" : name}. ${c.plays ? plural(c.plays, "play", "plays") + " by " + plural(c.djs || 0, "DJ", "DJs") + "." : ""}`,
    crumbs: [["charts/", "Charts"]], open: "#discover/charts" + (period === "all" ? "/all" : "/" + period + "/" + id),
    ld: playlistLd(ROOM + " chart: " + name, path, c.rows),
    body: `${c.plays ? `<p class="p-facts">${plural(c.plays, "play", "plays")} by ${plural(c.djs || 0, "DJ", "DJs")}${c.final === false ? " · so far" : ""}</p>` : ""}
${songs(c.rows, { max: 40, noFirst: period !== "all", extra: (t) => t.g && have.genre.has(genreSlug(t.g)) ? `<a href="${BASE}genres/${genreSlug(t.g)}/">${esc(t.g)}</a>` : esc(t.g || "") })}`
  });
});
if (chartList.length) {
  const group = (period, label) => {
    const list = chartList.filter((x) => x.period === period).sort((a, b) => (a.id < b.id ? 1 : -1));
    return list.length ? `<section><h2>${label}</h2><ul class="p-list p-cols">${list.map((x) => `<li><a href="${BASE}${x.path}">${esc(x.name)}</a></li>`).join("")}</ul></section>` : "";
  };
  page({
    path: "charts/", title: "Room charts", description: `${ROOM}'s weekly, monthly, yearly and all-time charts: the songs played most in the room.`,
    open: "#discover/charts", body: group("all", "All time") + group("week", "Weeks") + group("month", "Months") + group("year", "Years")
  });
}

// the library's front page
page({
  path: "", title: "The library", h1: ROOM + ": the library",
  description: `${ROOM}'s library: ${genreList.length} genres, ${djList.length} DJs, ${artistPages.length} artists and every year since ${yearList[yearList.length - 1] || "the start"}, from the room's play history.`,
  body: `<p class="p-lede">${esc(ROOM)} is a live room where DJs take turns playing songs. This is everything it has played, by genre, DJ, artist and year.</p>
${genreList.length ? `<section><h2><a href="${BASE}genres/">Genres</a></h2><ul class="p-tags">${genreList.map((g) => `<li><a href="${BASE}genres/${g.slug}/">${esc(g.name)}</a></li>`).join("")}</ul></section>` : ""}
${djList.length ? `<section><h2><a href="${BASE}djs/">DJs</a></h2><ul class="p-tags">${djList.slice(0, 30).map((d) => `<li><a href="${BASE}djs/${d.key}/">${esc(d.name)}</a></li>`).join("")}</ul></section>` : ""}
${yearList.length ? `<section><h2><a href="${BASE}years/">Years</a></h2><ul class="p-tags">${yearList.map((y) => `<li><a href="${BASE}years/${y}/">${y}</a></li>`).join("")}</ul></section>` : ""}
${artistPages.length ? `<section><h2><a href="${BASE}artists/">Artists</a></h2><ul class="p-tags">${artistPages.slice(0, 40).map(([slug, a]) => `<li><a href="${BASE}artists/${slug}/">${esc(a.name)}</a></li>`).join("")}</ul></section>` : ""}
${chartList.length ? `<section><h2><a href="${BASE}charts/">Charts</a></h2></section>` : ""}`
});

// ---------------------------------------------------------------- write

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
pages.forEach((p) => {
  const dir = join(OUT, p.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), p.html);
});
const lastmod = isoDay(updated.at);
writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `<url><loc>${esc(SITE.replace(/\/$/, "") + BASE + p.path)}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}
</urlset>
`);
writeFileSync(join(OUT, ".built"), new Date().toISOString() + "\n");
console.log(`plain pages: ${pages.length} pages in ${OUT}/ (${genreList.length} genres, ${djList.length} DJs, ${artistPages.length} artists, ${yearList.length} years, ${chartList.length} charts)`);
