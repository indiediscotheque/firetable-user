#!/usr/bin/env node
// Library pages for search engines: every genre, DJ, artist (the 500 most
// played), year and chart gets an address under /music/, with a sitemap.
// Each page is the site itself (its index.html) with that page's songs
// already in Discover's middle column, in Discover's own markup: search
// engines read them as they are, and a visitor lands in the real site, which
// starts on the same Discover page (#discover/...) and takes over.
//
// It reads what Discover reads, from the public parts of the database:
// discover/lib/ (the weekly Play history job in firetable-hostbot) and
// discover/charts/ (the bot). The database address and room name come from
// the site's own config.js, so it needs no secrets. DJs who turned off "Show
// my name on public pages" are already left out of that data.
//
//   node tools/plain-pages.mjs --site https://indiediscotheque.com/ [--out music]
//     [--template index.html] [--artists 500] [--always (even with discover off)]
//   FIREBASE_DATABASE_URL overrides config.js's database address.
//
// The deploy (.github/workflows/deploy.yml) runs it after versioning the
// site's links, uploads music/ and removes pages that are no longer built.
// Never deployed itself (tools/). Writes <out>/.built when it finishes, so a
// failed run never empties the folder on the server.

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
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
  return slug && have.artist.has(slug) ? '<a class="d-alink" href="' + BASE + "artists/" + slug + '/">' + esc(part) + "</a>" : esc(part);
}).join("");
const djName = (name, uid) => {
  const href = djHref(name, uid);
  return href ? '<a href="' + href + '">' + esc(name) + "</a>" : esc(name);
};

// ---------------------------------------------------------------- pages
// Each page is the site's own index.html, with that page's library already
// in Discover's middle column, in Discover's own markup. Search engines read
// it as it is; a visitor's browser starts the site on the same Discover page
// (meta ft-route) and the live page takes over.

const TEMPLATE = readFileSync(arg("template", "index.html"), "utf8");
const pages = []; // {path, html}
const updated = { at: Date.now() };
const icon = (name) => `<i class="material-symbols-outlined" aria-hidden="true">${name}</i>`;

function page({ path, title, description, image, ld, route, body }) {
  const url = SITE.replace(/\/$/, "") + BASE + path;
  const head = `<meta name="description" content="${esc(description)}" />
	<link rel="canonical" href="${esc(url)}" />
	<meta name="ft-route" content="${esc(route || "discover")}" />
	<meta property="og:site_name" content="${esc(ROOM)}" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="${esc(title)}" />
	<meta property="og:description" content="${esc(description)}" />
	<meta property="og:url" content="${esc(url)}" />
${image ? `	<meta property="og:image" content="${esc(image)}" />\n` : ""}${ld ? `	<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n` : ""}`;
  const foot = `<p class="d-fact d-plainfoot">${esc(ROOM)} is a live room where DJs take turns playing songs for each other. This page comes from the room's play history and is updated every week.</p>`;
  let html = TEMPLATE
    // every link in the page is the site's, from wherever this page sits
    .replace(/(<head>\s*\n?)/i, `$1\t<base href="/" />\n`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)} · ${esc(ROOM)}</title>`)
    .replace(/\s*<meta name="description"[^>]*>/i, "")
    .replace(/<\/head>/i, head + "</head>")
    .replace(/<body([^>]*)>/i, (m, attrs) => /class=/.test(attrs) ? m.replace(/class="/, 'class="ft-has-discover ft-discover ') : `<body${attrs} class="ft-has-discover ft-discover">`)
    .replace(/(<div id="mainGrid"[^>]*>)/i, `$1\n\t\t<div id="discoverPage" role="region" aria-label="Discover"><div id="dRail"></div><div id="dBrowse" class="scroll-view" data-prerendered="${esc(route || "discover")}">${body}${foot}</div><aside id="dSide" aria-label="Player"></aside></div>`);
  if (!/<base href/.test(html) || !/id="discoverPage"/.test(html)) throw new Error("the template isn't the site's index.html");
  pages.push({ path, html });
}

// Discover's markup (js/discover.js), without the buttons the live page adds
const songUrlOf = (t) => songUrl(t) || "";
function rows(list, opts = {}) {
  list = (list || []).filter((t) => t && t.cid).slice(0, opts.max || ROWS);
  if (!list.length) return '<p class="d-empty">Nothing here yet.</p>';
  return '<div class="ft-rows d-rowlist">' + list.map((t, i) => {
    const link = songUrlOf(t);
    const stamp = opts.stamp ? opts.stamp(t, i) : "#" + (i + 1);
    const right = opts.right ? opts.right(t) : (t.plays ? '<span class="d-num">' + plural(t.plays, "play", "plays") + "</span>" : "");
    return `<div class="hist-entry"><span class="hist-timestamp${opts.stamp ? "" : " d-rank"}">${esc(stamp)}</span><span class="ft-avatar pv-dj-avatar dj-avatar-tip d-nobody" aria-hidden="true"></span>` +
      `<div class="pvbar"><div class="pv-art histart" style="background-image:url(${esc(art(t))})"></div>` +
      `<div class="listwords"><div class="histlink"><span class="hist-track-title">${link ? `<a href="${esc(link)}" rel="noopener">${esc(t.t)}</a>` : esc(t.t)}</span>` +
      `<span class="hist-track-artist">${artistLine(t.a)}</span></div></div>${right ? `<span class="d-right">${right}</span>` : ""}</div></div>`;
  }).join("") + "</div>";
}
const playlistLd = (name, url, list) => ({
  "@context": "https://schema.org", "@type": "MusicPlaylist", name, url: SITE.replace(/\/$/, "") + BASE + url,
  numTracks: (list || []).length,
  track: (list || []).slice(0, ROWS).filter((t) => t && t.cid).map((t) => ({
    "@type": "MusicRecording", name: t.t, byArtist: { "@type": "MusicGroup", name: t.a }, ...(songUrl(t) ? { url: songUrl(t) } : {})
  }))
});
const mosaic = (keys, big) => `<span class="d-mosaic${big ? " big" : ""}" aria-hidden="true">${(keys || []).slice(0, 4).concat([null, null, null, null]).slice(0, 4)
  .map((k) => k ? `<i style="background-image:url(${esc(coverOf(k))})"></i>` : "<i></i>").join("")}</span>`;
const back = (to, label) => `<a class="d-back" href="${BASE}${to}">${icon("arrow_back")}<span>${esc(label)}</span></a>`;
const head = (title, link, to) => `<div class="d-head"><h2>${esc(title)}</h2>${link ? `<a href="${BASE}${to}">${esc(link)}</a>` : ""}</div>`;
const pageHead = (h1, facts, opts = {}) => `<div class="d-pagehead">${opts.mosaic || ""}<div class="d-pagetext"><h1>${esc(h1)}</h1>` +
  `${facts ? `<p class="d-fact">${facts}</p>` : ""}${opts.more || ""}${opts.play ? `<div class="d-actions"><a class="butt" href="/#${esc(opts.play[0])}">${icon(opts.play[2] || "play_arrow")}<span>${esc(opts.play[1])}</span></a>${opts.actions || ""}</div>` : ""}</div></div>`;
const viewHead = (h1, fact) => `<div class="d-headrow"><h1>${esc(h1)}</h1></div>${fact ? `<p class="d-fact">${esc(fact)}</p>` : ""}`;
const person = (href, name, fact, more) => {
  const inner = `<span class="d-person-text"><b>${esc(name)}</b><span>${fact}</span>${more ? `<span>${more}</span>` : ""}</span>`;
  return href ? `<a class="d-person" href="${href}">${inner}</a>` : `<span class="d-person">${inner}</span>`;
};
const chips = (items) => `<div class="d-chips">${items.map(([href, label]) => `<a class="d-chip" href="${href}">${esc(label)}</a>`).join("")}</div>`;

// ---------------------------------------------------------------- build

const [genres, djs, artistIndex, years, chartIds] = await Promise.all([
  read("discover/lib/genres"), read("discover/lib/djs"), read("discover/lib/artistIndex"), read("discover/lib/years"), read("discover/chartIds")
]);
const meta = await read("discover/lib/meta");
const ytm = (await read("discover/ytm")) || {}; // genre playlists on YouTube Music, by slug
const ytmUrl = (slug) => /^[\w-]+$/.test(ytm[slug] || "") ? "https://music.youtube.com/playlist?list=" + ytm[slug] : null;
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
    path: "genres/", title: "Genres", route: "discover/genres",
    description: `The ${genreList.length} genres played in ${ROOM}, from the room's play history: songs, plays and usual tempo for each.`,
    body: viewHead("Genres", genreList.length + " sounds the room plays, most played first.") +
      `<div class="d-gcards">` + genreList.map((g) =>
        `<a class="d-gcard" href="${BASE}genres/${g.slug}/">${mosaic(g.covers)}<span class="d-gname">${esc(g.name)}</span>` +
        `<span class="d-gfact d-num">${n(g.songs)} songs · ${n(g.plays)} plays</span></a>`).join("") + `</div>`
  });
  genreList.forEach((g) => {
    const p = lib["discover/lib/genre/" + g.slug];
    if (!p) return;
    const facts = [plural(g.songs, "song", "songs"), plural(g.plays, "play", "plays")];
    if (g.bpm) facts.push("usually " + g.bpm + " BPM");
    if (g.first) facts.push("played here since " + g.first);
    if (g.djs) facts.push(plural(g.djs, "DJ", "DJs"));
    const who = (p.who || []).filter((x) => x.dj);
    const next = (g.next || []).filter((k) => genres[k]);
    const top = (p.fav || []).slice(0, 3).map((t) => t.a + " - " + t.t).join(", ");
    page({
      path: "genres/" + g.slug + "/", title: g.name + " songs", route: "discover/genres/" + g.slug,
      description: `${g.about ? g.about + " " : ""}The ${g.name} songs ${ROOM} plays most${top ? ", including " + top : ""}. ${facts.join(", ")}.`,
      image: g.covers && g.covers[0] ? coverOf(g.covers[0]) : null,
      ld: Object.assign(playlistLd(g.name + " in " + ROOM, "genres/" + g.slug + "/", p.fav), ytmUrl(g.slug) ? { sameAs: ytmUrl(g.slug) } : {}),
      body: back("genres/", "Genres") + pageHead(g.name, esc(facts.join(" · ")), { mosaic: mosaic(g.covers, true), more: g.about ? `<p class="d-about">${esc(g.about)}</p>` : "", play: ["discover/genres/" + g.slug, "Play " + g.name + " radio", "radio"],
        actions: ytmUrl(g.slug) ? `<a class="butt graybutt d-ytm" href="${esc(ytmUrl(g.slug))}" target="_blank" rel="noopener">${icon("open_in_new")}<span>YouTube Music</span></a>` : "" }) +
        `<section>${head("Room favorites")}<p class="d-fact">Most played in the room</p>${rows(p.fav)}</section>` +
        ((p.newHere || []).length ? `<section>${head("New here")}<p class="d-fact">Played here for the first time lately</p>${rows(p.newHere, { max: 20, stamp: (t) => t.first ? day(t.first) : "" })}</section>` : "") +
        ((p.deep || []).length ? `<section>${head("Deep cuts")}<p class="d-fact">Played here once or twice</p>${rows(p.deep, { max: 20, stamp: (t) => t.first ? day(t.first) : "" })}</section>` : "") +
        (who.length ? `<section>${head("Who plays it")}<div class="d-people">${who.map((x) => person(djHref(x.dj, x.djid), x.dj, plural(x.plays, "play", "plays"))).join("")}</div></section>` : "") +
        (next.length ? `<section>${head("Next door")}<p class="d-fact">Genres its songs share most</p>${chips(next.map((k) => [BASE + "genres/" + k + "/", genres[k].name]))}</section>` : "")
    });
  });
}

// DJs
if (djList.length) {
  page({
    path: "djs/", title: "DJs", route: "discover/djs",
    description: `The DJs of ${ROOM}: ${djList.length} people with 25 or more plays, their sound and the songs they play most.`,
    body: viewHead("DJs", plural(djList.length, "DJ", "DJs") + " with 25 or more plays here") +
      `<div class="d-people d-people-wide">` + djList.map((d) => person(BASE + "djs/" + d.key + "/", d.name,
        esc((d.since ? "since " + year(d.since) + " · " : "") + n(d.plays) + " plays · " + n(d.firsts) + " firsts"), esc((d.g || []).join(", ")))).join("") + `</div>`
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
      path: "djs/" + d.key + "/", title: p.name + ", DJ", route: "discover/djs/" + d.key,
      description: `${p.name} DJs in ${ROOM}${taste.length ? ", mostly " + taste.filter((x) => x.slug).slice(0, 3).map((x) => x.g).join(", ") : ""}. ${facts.join(", ")}.`,
      ld: { "@context": "https://schema.org", "@type": "ProfilePage", mainEntity: { "@type": "Person", name: p.name }, url: SITE.replace(/\/$/, "") + BASE + "djs/" + d.key + "/" },
      body: back("djs/", "DJs") + pageHead(p.name, esc(facts.join(" · ")), { play: ["discover/djs/" + d.key, "Play their favorites"] }) +
        (taste.length ? `<section>${head("Their sound")}<div class="d-taste">${taste.map((x) =>
          `<div class="d-tasterow${x.slug ? "" : " d-other"}">${x.slug && have.genre.has(x.slug) ? `<a href="${BASE}genres/${x.slug}/">${esc(x.g)}</a>` : `<span>${esc(x.g)}</span>`}` +
          `<span class="d-bar"><i style="width:${Math.max(1, Math.min(100, Math.round(x.pct)))}%"></i></span><span class="d-num">${esc(x.pct)}%</span></div>`).join("")}</div></section>` : "") +
        `<section>${head("Most played")}${rows(p.most, { right: (t) => '<span class="d-num">' + plural(t.by, "play", "plays") + "</span>" })}</section>` +
        ((p.firstHere || []).length ? `<section>${head("Brought here first")}${rows(p.firstHere, { max: 30, stamp: (t) => t.first ? day(t.first) : "" })}</section>` : "") +
        (similar.length ? `<section>${head("Similar DJs")}<p class="d-fact">The most songs in common</p><div class="d-people">${similar.map((x) => person(BASE + "djs/" + x.key + "/", x.name, esc(x.pct + "% alike"))).join("")}</div></section>` : "")
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
    path: "artists/" + slug + "/", title: a.name + " in " + ROOM, route: "discover/artist/" + slug,
    description: `${a.name} songs played in ${ROOM}${top ? ": " + top : ""}. ${facts.join(", ")}.`,
    image: a.rows && a.rows[0] ? art(a.rows[0]) : null, ld: playlistLd(a.name + " in " + ROOM, "artists/" + slug + "/", a.rows),
    body: back("artists/", "Artists") + pageHead(a.name, esc(facts.join(" · ")), {
      mosaic: mosaic((a.rows || []).slice(0, 4).map((t) => (t.type || 1) + "_" + t.cid), true),
      more: a.first ? `<p class="d-fact">First played here ${day(a.first)}${a.firstDj ? " by " + djName(a.firstDj, a.firstDjid) : ""}</p>` : "",
      play: ["discover/artist/" + slug, "Play all"]
    }) +
      `<section>${head("Most played here")}${rows(a.rows)}</section>` +
      (who.length ? `<section>${head("Who plays them")}<div class="d-people">${who.map((x) => person(djHref(x.dj, x.djid), x.dj, plural(x.plays, "play", "plays"))).join("")}</div></section>` : "")
  });
});
if (artistPages.length) {
  page({
    path: "artists/", title: "Artists", route: "discover",
    description: `The ${artistPages.length} artists played most in ${ROOM}.`,
    body: viewHead("Artists", "The " + artistPages.length + " artists the room plays most") +
      `<div class="d-people d-people-wide">` + artistPages.map(([slug, a]) => person(BASE + "artists/" + slug + "/", a.name, plural(a.plays, "play", "plays"))).join("") + `</div>`
  });
}

// years
if (yearList.length) {
  page({
    path: "years/", title: "Years", route: "discover/years",
    description: `${ROOM}'s playlist for each year since ${yearList[yearList.length - 1]}, and what the room played most from each.`,
    body: viewHead("Years", "The room's playlist for each year, and how much of it was played here") +
      `<div class="d-yearlist">` + yearList.map((y) => {
        const v = years[y] || {};
        const pct = v.songs ? Math.round((v.played / v.songs) * 100) : 0;
        return `<a class="d-yearrow" href="${BASE}years/${y}/"><b class="d-num">${y}</b><span class="d-yeartext"><span>${n(v.songs)} songs · ${n(v.played)} played here · ${n(v.plays)} plays</span>` +
          `${v.genre ? `<span>mostly ${esc(v.genre)}</span>` : ""}</span><span class="d-bar"><i style="width:${pct}%"></i></span></a>`;
      }).join("") + `</div>`
  });
  yearList.forEach((y) => {
    const p = lib["discover/lib/year/" + y];
    if (!p) return;
    const v = years[y] || {};
    page({
      path: "years/" + y + "/", title: "The best songs of " + y, route: "discover/years/" + y,
      description: `The ${y} songs ${ROOM} played most, from the room's ${y} playlist of ${n(v.songs)} songs${v.genre ? ", mostly " + v.genre : ""}.`,
      ld: playlistLd(y + " in " + ROOM, "years/" + y + "/", p.top),
      body: back("years/", "Years") + pageHead(y, esc(n(v.songs) + " songs on the playlist · " + n(v.played) + " played here" + (v.genre ? " · mostly " + v.genre : "")), {
        mosaic: mosaic((p.top || []).slice(0, 4).map((t) => (t.type || 1) + "_" + t.cid), true), play: ["discover/years/" + y, "Play the year"]
      }) +
        `<section>${head("Most played here")}${rows(p.top)}</section>` +
        ((p.more || []).length ? `<section>${head("Not played here yet")}<p class="d-fact">From ${y}'s playlist. Play one for the room.</p>${rows(p.more, { max: 24, stamp: () => "", right: () => "" })}</section>` : "")
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
  const genre = (t) => t.g ? (have.genre.has(genreSlug(t.g)) ? `<a class="d-g" href="${BASE}genres/${genreSlug(t.g)}/">${esc(t.g)}</a>` : `<span class="d-g">${esc(t.g)}</span>`) : "";
  page({
    path, title: ROOM + " chart: " + name, route: "discover/charts/" + (period === "all" ? "all" : period + "/" + id),
    description: `The songs played most in ${ROOM}, ${period === "all" ? "of all time" : name}. ${c.plays ? plural(c.plays, "play", "plays") + " by " + plural(c.djs || 0, "DJ", "DJs") + "." : ""}`,
    ld: playlistLd(ROOM + " chart: " + name, path, c.rows),
    body: back("charts/", "Charts") + viewHead("Room chart: " + name, c.plays ? plural(c.plays, "play", "plays") + " by " + plural(c.djs || 0, "DJ", "DJs") + (c.final === false ? " so far" : "") : "") +
      rows(c.rows, { max: 40, right: (t) => genre(t) + '<span class="d-num">' + plural(t.plays, "play", "plays") + "</span>" })
  });
});
if (chartList.length) {
  const group = (period, label) => {
    const list = chartList.filter((x) => x.period === period).sort((a, b) => (a.id < b.id ? 1 : -1));
    return list.length ? `<section>${head(label)}${chips(list.map((x) => [BASE + x.path, x.name]))}</section>` : "";
  };
  page({
    path: "charts/", title: "Room charts", route: "discover/charts",
    description: `${ROOM}'s weekly, monthly, yearly and all-time charts: the songs played most in the room.`,
    body: viewHead("Room charts", "The songs played most in the room") + group("all", "All time") + group("week", "Weeks") + group("month", "Months") + group("year", "Years")
  });
}

// theme nights (discover/themes, from the bot)
const nightIndex = (await read("discover/themes/index")) || {};
const nightIds = Object.keys(nightIndex).sort((a, b) => nightIndex[b].from - nightIndex[a].from);
const nightDay = (ms) => new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const nightPages = await readAll(nightIds.map((k) => "discover/themes/night/" + k));
const nightList = nightIds.filter((k) => nightPages["discover/themes/night/" + k]);
nightList.forEach((k) => {
  const n = nightPages["discover/themes/night/" + k];
  page({
    path: "themes/" + k + "/", title: n.theme + ", " + nightDay(n.from), route: "discover/themes/" + k,
    description: `${n.theme}: the ${n.n} songs ${ROOM} played on ${nightDay(n.from)}${(n.djs || []).length ? ", with " + n.djs.join(", ") : ""}.`,
    ld: playlistLd(n.theme + " · " + nightDay(n.from), "themes/" + k + "/", n.rows),
    body: back("themes/", "Theme nights") + pageHead(n.theme, esc(nightDay(n.from) + " · " + plural(n.n, "song", "songs") + ((n.djs || []).length ? " · " + n.djs.join(", ") : "")), {
      mosaic: mosaic((n.rows || []).slice(0, 4).map((t) => (t.type || 1) + "_" + t.cid), true), play: ["discover/themes/" + k, "Play the night"]
    }) + rows(n.rows, { max: 100, stamp: (t) => new Date(t.w).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).replace(" ", "").toLowerCase() })
  });
});
if (nightList.length) {
  page({
    path: "themes/", title: "Theme nights", route: "discover/themes",
    description: `Every theme night in ${ROOM}: the songs DJs played for each theme, night by night.`,
    body: viewHead("Theme nights", "Every night the room played under a theme, newest first") +
      `<div class="d-nights">` + nightList.map((k) => { const n = nightIndex[k];
        return `<a class="d-night" href="${BASE}themes/${k}/"><b>${esc(n.theme)}</b><span>${esc(nightDay(n.from) + " · " + plural(n.n, "song", "songs") + ((n.djs || []).length ? " · " + n.djs.join(", ") : ""))}</span></a>`; }).join("") + `</div>`
  });
}

// the library's front page
page({
  path: "", title: "The library", route: "discover",
  description: `${ROOM}'s library: ${genreList.length} genres, ${djList.length} DJs, ${artistPages.length} artists and every year since ${yearList[yearList.length - 1] || "the start"}, from the room's play history.`,
  body: viewHead(ROOM + ": the library", "Everything the room has played, by genre, DJ, artist and year.") +
    (genreList.length ? `<section>${head("Genres", "All genres", "genres/")}${chips(genreList.map((g) => [BASE + "genres/" + g.slug + "/", g.name]))}</section>` : "") +
    (djList.length ? `<section>${head("DJs", "All DJs", "djs/")}${chips(djList.slice(0, 30).map((d) => [BASE + "djs/" + d.key + "/", d.name]))}</section>` : "") +
    (yearList.length ? `<section>${head("Years", "All years", "years/")}${chips(yearList.map((y) => [BASE + "years/" + y + "/", y]))}</section>` : "") +
    (artistPages.length ? `<section>${head("Artists", "All artists", "artists/")}${chips(artistPages.slice(0, 40).map(([slug, a]) => [BASE + "artists/" + slug + "/", a.name]))}</section>` : "") +
    (chartList.length ? `<section>${head("Charts", "All charts", "charts/")}</section>` : "") +
    (nightList.length ? `<section>${head("Theme nights", "All theme nights", "themes/")}<div class="d-nights">${nightList.slice(0, 5).map((k) =>
      `<a class="d-night" href="${BASE}themes/${k}/"><b>${esc(nightIndex[k].theme)}</b><span>${esc(nightDay(nightIndex[k].from))}</span></a>`).join("")}</div></section>` : "")
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
console.log(`plain pages: ${pages.length} pages in ${OUT}/ (${genreList.length} genres, ${djList.length} DJs, ${artistPages.length} artists, ${yearList.length} years, ${chartList.length} charts, ${nightList.length} theme nights)`);
