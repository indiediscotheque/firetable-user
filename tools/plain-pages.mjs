#!/usr/bin/env node
// Library pages for search engines: every genre, DJ, artist, year, chart and
// theme night, and the new releases, get an address under /music/, with a
// sitemap and two feeds. Each page is the site itself (its index.html) with
// that page's songs already in Discover's middle column, in Discover's own
// markup: search engines read them as they are, and a visitor lands in the
// real site, which opens the same Discover page at the same address
// (js/discover.js) and takes over.
//
// It also writes:
//   <out>/sitemap.xml       every page, the home page and About, each with the
//                           day its own content last changed (pages.json)
//   <out>/pages.json        each page's content hash and that day, read back
//                           from the live site on the next run
//   <out>/new/feed.xml, <out>/charts/feed.xml   Atom feeds
//   <out>/find/             Discover's song search (tools/song-search.mjs)
//   <out>/<key>.txt         the IndexNow key (Bing, Yandex, Naver, Seznam),
//                           and <out>/.changed, the addresses that changed
//   --home <file>           the home page: index.html with what's new and this
//                           week's chart already in it, linking into the library
//   --cards                 a share image beside each page (card.jpg, 1200 x 630:
//                           tools/share-cards.mjs), for link previews. Every
//                           page but the artists past the --card-artists most
//                           played (500), which keep their top song's cover.
//
// It reads what Discover reads, from the public parts of the database:
// discover/lib/ (the weekly Play history job in firetable-hostbot) and
// discover/charts/ (the bot). The database address and room name come from
// the site's own config.js, so it needs no secrets. DJs who turned off "Show
// my name on public pages" are already left out of that data.
//
//   node tools/plain-pages.mjs --site https://indiediscotheque.com/ [--out music]
//     [--template index.html] [--artists 5000] [--home index.html] [--cards] [--sounds "a, b"]
//   FIREBASE_DATABASE_URL overrides config.js's database address.
//
// The deploy (.github/workflows/deploy.yml) runs it after versioning the
// site's links, uploads music/ and removes pages that are no longer built.
// Never deployed itself (tools/). Writes <out>/.built when it finishes, so a
// failed run never empties the folder on the server.

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { shareCards } from "./share-cards.mjs";
import { songSearch } from "./song-search.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf("--" + name); return i === -1 ? fallback : args[i + 1]; };
const SITE = String(arg("site", process.env.SITE_URL || "")).replace(/\/?$/, "/");
const OUT = arg("out", "music");
const BASE = "/music/";
const ARTISTS = Number(arg("artists", 5000)); // every artist with a page in Discover
const HOME = arg("home", "");
const CARDS = args.includes("--cards") ? await shareCards() : null;
if (args.includes("--cards") && !CARDS) { console.error("--cards needs sharp: run npm ci in the repository's root"); process.exit(2); }
const CARD_ARTISTS = Number(arg("card-artists", 500));
const ROWS = 50;
// IndexNow: the key's file sits under /music/, so it speaks for those addresses only. Not a secret.
const INDEXNOW_KEY = "7c1f3a9e5b2d4c68a0e1f7b3d95c2a46";

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
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
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
const have = { genre: new Set(), dj: new Map(), artist: new Set(), year: new Set() };
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
const HOME_TITLE = (TEMPLATE.match(/<title>([^<]*)<\/title>/i) || [])[1] || esc(ROOM);
const ORIGIN = SITE.replace(/\/$/, "");
const abs = (path) => ORIGIN + BASE + path;
const pages = []; // {path, html, hash}
const cardJobs = []; // {path, card: {kicker, title, fact, covers: ["type_cid", ...]}}
const keysOf = (list) => (list || []).filter((t) => t && t.cid).slice(0, 4).map((t) => (t.type || 1) + "_" + t.cid);
const updated = { at: Date.now() };
// (a carrot is the site's own icon, drawn by css/looks.css .ms-carrot: Material Symbols has none)
const icon = (name) => (name === "carrot" ? '<i class="material-symbols-outlined ms-carrot" aria-hidden="true"></i>' : `<i class="material-symbols-outlined" aria-hidden="true">${name}</i>`);
const ldScript = (ld) => `\t<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>\n`;
/** Search results cut a description near 160 characters: end on a whole word. */
const clip = (text, max = 220) => { text = String(text).replace(/\s+/g, " ").trim(); return text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…"; };
/** Where a page sits, for the trail search results show: [[name, path], ...] under the library. */
const crumbsLd = (crumbs, title, url) => ({
  "@type": "BreadcrumbList",
  itemListElement: [[ROOM, SITE], ["Library", abs("")], ...crumbs.map(([name, path]) => [name, abs(path)]), [title, url]]
    .filter(([, u], i, all) => i === all.length - 1 || u !== url)
    .map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item }))
});

/** The site's page with `body` in Discover's middle column. */
function fill(html, route, body, visible) {
  html = html.replace(/(<div id="mainGrid"[^>]*>)/i, `$1\n\t\t<div id="discoverPage" role="region" aria-label="Discover"><div id="dRail"></div><div id="dBrowse" class="scroll-view" data-prerendered="${esc(route)}">${body}</div><section id="dSide" aria-label="Playlists and chat"></section></div>`);
  // Discover showing from the first paint (the home page decides once it knows who's there)
  if (visible) html = html.replace(/<body([^>]*)>/i, (m, attrs) => /class=/.test(attrs) ? m.replace(/class="/, 'class="ft-has-discover ft-discover ') : `<body${attrs} class="ft-has-discover ft-discover">`);
  if (!/<base href/.test(html) || !/id="discoverPage"/.test(html)) throw new Error("the template isn't the site's index.html");
  return html;
}

function page({ path, title, heading, description, image, ld, crumbs, route, body, card }) {
  const url = abs(path);
  description = clip(description);
  // its share image: drawn after every page is known (cards, below)
  const drawn = !!(CARDS && card);
  if (drawn) { cardJobs.push({ path, card }); image = abs(path + "card.jpg"); }
  const fullTitle = `${title} · ${ROOM}`;
  const graph = [{ "@type": "WebPage", "@id": url, url, name: fullTitle, description, inLanguage: "en", isPartOf: { "@id": SITE + "#site" }, dateModified: new Date(updated.at).toISOString() },
    crumbsLd(crumbs || [], heading || title, url), ...(ld ? [].concat(ld) : [])];
  const head = `<meta name="description" content="${esc(description)}" />
	<link rel="canonical" href="${esc(url)}" />
	<meta name="ft-route" content="${esc(route || "discover")}" />
	<meta name="ft-home-title" content="${HOME_TITLE}" />
	<meta property="og:site_name" content="${esc(ROOM)}" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content="${esc(title)}" />
	<meta property="og:description" content="${esc(description)}" />
	<meta property="og:url" content="${esc(url)}" />
	<meta property="og:image" content="${esc(image || SITE + "img/og.png")}" />
${drawn || !image ? `	<meta property="og:image:width" content="1200" />\n	<meta property="og:image:height" content="630" />\n` : ""}${drawn ? `	<meta property="og:image:alt" content="${esc(card.title + (card.fact ? ": " + card.fact : ""))}" />\n` : ""}	<meta name="twitter:card" content="${image && !drawn ? "summary" : "summary_large_image"}" />
${ldScript({ "@context": "https://schema.org", "@graph": graph })}`;
  const foot = `<p class="d-fact d-plainfoot">${esc(ROOM)} is a live room where DJs take turns playing songs for each other. This page comes from the room's play history${route === "discover/new" ? " and is updated every day" : ""}.</p>`;
  let html = TEMPLATE
    // every link in the page is the site's, from wherever this page sits
    .replace(/(<head>\s*\n?)/i, (m) => /<base href/i.test(TEMPLATE) ? m : `${m}\t<base href="/" />\n`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(fullTitle)}</title>`)
    .replace(/\s*<meta name="description"[^>]*>/i, "")
    // the home page's own link-preview tags: this page brings its own
    .replace(/\s*<!-- Link previews[^>]*-->/i, "")
    .replace(/\s*<link rel="canonical"[^>]*>/gi, "")
    .replace(/\s*<meta (?:property="og:|name="twitter:)[^>]*>/gi, "")
    .replace(/<\/head>/i, head + "</head>");
  html = fill(html, route || "discover", body + foot, true);
  // what's this page's own: a change to the site around it isn't a change to the page
  const hash = createHash("sha1").update(JSON.stringify([title, description, image || "", body, ld || null])).digest("hex").slice(0, 12);
  pages.push({ path, html, hash, title: heading || title });
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
const trackLd = (t) => ({ "@type": "MusicRecording", name: t.t, byArtist: { "@type": "MusicGroup", name: t.a }, ...(t.dur ? { duration: "PT" + Math.round(t.dur) + "S" } : {}), ...(songUrl(t) ? { url: songUrl(t) } : {}) });
const playlistLd = (name, url, list, more) => {
  const tracks = (list || []).filter((t) => t && t.cid).slice(0, ROWS);
  return Object.assign({ "@type": "MusicPlaylist", name, url: abs(url), numTracks: tracks.length, track: tracks.map(trackLd) }, more || {});
};
/** A list of the site's own pages (a hub), in order. */
const listLd = (name, items) => ({ "@type": "ItemList", name, numberOfItems: items.length,
  itemListElement: items.slice(0, 100).map(([label, path], i) => ({ "@type": "ListItem", position: i + 1, name: label, url: abs(path) })) });
const relDay = (rel) => new Date(String(rel).slice(0, 10) + "T12:00:00Z").getTime();
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

// what the room plays, in the words people search with (titles and descriptions): --sounds "a, b, c", else its most played genres
const SOUNDS = String(arg("sounds", "")).split(",").map((x) => x.trim()).filter(Boolean);
if (!SOUNDS.length) SOUNDS.push(...genreList.slice(0, 4).map((g) => g.name.toLowerCase()));
const soundsText = SOUNDS.length > 1 ? SOUNDS.slice(0, -1).join(", ") + " and " + SOUNDS[SOUNDS.length - 1] : SOUNDS[0] || "music";
const names = (list, max = 3) => (list || []).slice(0, max).map((t) => t.a + " - " + t.t).join(", ");

// which of a genre's years have a page (the bot lists them, ys), and the pages themselves
const genreYears = await readAll(genreList.flatMap((g) => (g.ys || []).map((y) => "discover/lib/genreYear/" + g.slug + "_" + y)));
const yearsOf = (g) => (g.ys || []).filter((y) => ((genreYears["discover/lib/genreYear/" + g.slug + "_" + y] || {}).top || []).length);
const genresIn = (y) => genreList.filter((g) => yearsOf(g).some((x) => String(x) === String(y)));
const yearChips = (g, not) => `<div class="d-chips">${yearsOf(g).slice().reverse().filter((y) => String(y) !== String(not)).map((y) => `<a class="d-chip d-num" href="${BASE}genres/${g.slug}/${y}/">${y}</a>`).join("")}</div>`;
yearList.forEach((y) => { if (lib["discover/lib/year/" + y]) have.year.add(String(y)); });

// genres
if (genreList.length) {
  page({
    path: "genres/", title: `Music genres: ${genreList.length} sounds, from ${genreList[0].name} to ${genreList[genreList.length - 1].name}`, heading: "Genres", route: "discover/genres",
    description: `The ${genreList.length} genres played in ${ROOM}, most played first: ${genreList.slice(0, 8).map((g) => g.name).join(", ")} and more. Songs, plays and the usual tempo of each.`,
    ld: listLd("Genres", genreList.map((g) => [g.name, "genres/" + g.slug + "/"])),
    card: { kicker: "Library", title: "Genres", fact: genreList.length + " sounds, from " + genreList[0].name + " to " + genreList[genreList.length - 1].name, covers: genreList.slice(0, 4).map((g) => (g.covers || [])[0]) },
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
    const top = names(p.fav);
    const shown = Math.min((p.fav || []).length, ROWS);
    page({
      path: "genres/" + g.slug + "/", title: `Best ${g.name} songs: the top ${shown}, picked by DJs`, heading: g.name, route: "discover/genres/" + g.slug,
      crumbs: [["Genres", "genres/"]],
      description: `${g.about ? g.about + " " : ""}The ${shown} ${g.name} songs ${ROOM}'s DJs play most${top ? ": " + top : ""}. ${facts.join(", ")}.`,
      image: g.covers && g.covers[0] ? coverOf(g.covers[0]) : null,
      ld: playlistLd(`Best ${g.name} songs`, "genres/" + g.slug + "/", p.fav, Object.assign({ genre: g.name }, g.about ? { description: g.about } : {}, ytmUrl(g.slug) ? { sameAs: ytmUrl(g.slug) } : {})),
      card: { kicker: "Genre", title: g.name, fact: plural(g.songs, "song", "songs") + " · " + plural(g.plays, "play", "plays"), covers: g.covers },
      body: back("genres/", "Genres") + pageHead(g.name, esc(facts.join(" · ")), { mosaic: mosaic(g.covers, true), more: g.about ? `<p class="d-about">${esc(g.about)}</p>` : "", play: ["discover/genres/" + g.slug, "Play " + g.name + " radio", "radio"],
        actions: ytmUrl(g.slug) ? `<a class="butt graybutt d-ytm" href="${esc(ytmUrl(g.slug))}" target="_blank" rel="noopener">${icon("open_in_new")}<span>YouTube Music</span></a>` : "" }) +
        `<section>${head("Room favorites")}<p class="d-fact">Most played in the room</p>${rows(p.fav)}</section>` +
        ((p.newHere || []).length ? `<section>${head("New here")}<p class="d-fact">Played here for the first time lately</p>${rows(p.newHere, { max: 20, stamp: (t) => t.first ? day(t.first) : "" })}</section>` : "") +
        ((p.deep || []).length ? `<section>${head("Deep cuts")}<p class="d-fact">Played here once or twice</p>${rows(p.deep, { max: 20, stamp: (t) => t.first ? day(t.first) : "" })}</section>` : "") +
        ((p.story || []).filter(Boolean).length ? `<section class="d-story">${head("About " + g.name)}${p.story.filter(Boolean).map((para) => `<p>${esc(para)}</p>`).join("")}</section>` : "") +
        (yearsOf(g).length ? `<section>${head("The best of each year")}<p class="d-fact">${esc(g.name)} released that year, most played here first</p>${yearChips(g, null)}</section>` : "") +
        (who.length ? `<section>${head("Who plays it")}<div class="d-people">${who.map((x) => person(djHref(x.dj, x.djid), x.dj, plural(x.plays, "play", "plays"))).join("")}</div></section>` : "") +
        (next.length ? `<section>${head("Next door")}<p class="d-fact">Genres its songs share most</p>${chips(next.map((k) => [BASE + "genres/" + k + "/", genres[k].name]))}</section>` : "")
    });
  });
}

// a genre's songs released in one year ("the best nu-disco of 2014"): discover/lib/genreYear/<slug>_<year>
genreList.forEach((g) => yearsOf(g).forEach((y) => {
  const p = genreYears["discover/lib/genreYear/" + g.slug + "_" + y];
  const path = "genres/" + g.slug + "/" + y + "/";
  const others = genresIn(y).filter((o) => o.slug !== g.slug);
  page({
    path, title: `Best ${g.name} songs of ${y}`, heading: String(y), route: "discover/genres/" + g.slug + "/" + y,
    crumbs: [["Genres", "genres/"], [g.name, "genres/" + g.slug + "/"]],
    description: `The ${g.name} songs released in ${y} that ${ROOM}'s DJs play most: ${names(p.top)}. ${plural(p.songs, "song", "songs")}${p.plays ? ", " + plural(p.plays, "play", "plays") : ""}.`,
    image: p.top[0] ? art(p.top[0]) : null,
    ld: playlistLd(`Best ${g.name} songs of ${y}`, path, p.top, { genre: g.name }),
    card: { kicker: g.name, title: "The best of " + y, fact: plural(p.songs, "song", "songs") + (p.plays ? " · " + plural(p.plays, "play", "plays") : ""), covers: keysOf(p.top) },
    body: back("genres/" + g.slug + "/", g.name) + pageHead("The best " + g.name + " of " + y, esc(plural(p.songs, "song", "songs") + " released in " + y + " played here" + (p.plays ? " · " + plural(p.plays, "play", "plays") : "")), {
      mosaic: mosaic(keysOf(p.top), true), play: ["discover/genres/" + g.slug + "/" + y, "Play all"]
    }) +
      `<section>${head("Most played here")}${rows(p.top, { max: 40 })}</section>` +
      (yearsOf(g).length > 1 ? `<section>${head("Other years")}${yearChips(g, y)}</section>` : "") +
      (others.length ? `<section>${head("More from " + y, have.year.has(String(y)) ? "All of " + y : "", "years/" + y + "/")}${chips(others.map((o) => [BASE + "genres/" + o.slug + "/" + y + "/", o.name]))}</section>` : "")
  });
}));

// DJs
if (djList.length) {
  page({
    path: "djs/", title: `The DJs: ${djList.length} people and what they play`, heading: "DJs", route: "discover/djs",
    description: `The DJs of ${ROOM}: ${djList.length} people with 25 or more plays, their sound and the songs they play most. Most plays: ${djList.slice(0, 6).map((d) => d.name).join(", ")}.`,
    ld: listLd("DJs", djList.map((d) => [d.name, "djs/" + d.key + "/"])),
    card: { kicker: "Library", title: "The DJs", fact: plural(djList.length, "person", "people") + " and what they play", covers: keysOf((lib["discover/lib/dj/" + djList[0].key] || {}).most) },
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
    const url = abs("djs/" + d.key + "/");
    page({
      path: "djs/" + d.key + "/", title: p.name + ", DJ", heading: p.name, route: "discover/djs/" + d.key,
      crumbs: [["DJs", "djs/"]],
      description: `${p.name} DJs in ${ROOM}${taste.length ? ", mostly " + taste.filter((x) => x.slug).slice(0, 3).map((x) => x.g).join(", ") : ""}. ${cap(facts.join(", "))}.${(p.most || []).length ? " Most played: " + names(p.most) + "." : ""}`,
      ld: [{ "@type": "ProfilePage", url, mainEntity: { "@type": "Person", name: p.name, url, ...(taste.length ? { knowsAbout: taste.filter((x) => x.slug).map((x) => x.g) } : {}) } },
        playlistLd(p.name + "'s most played songs", "djs/" + d.key + "/", p.most)],
      card: { kicker: "DJ", title: p.name, fact: (p.since ? "since " + year(p.since) + " · " : "") + plural(p.plays, "play", "plays"), covers: keysOf(p.most) },
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
const cardArtists = new Set(artistPages.slice(0, CARD_ARTISTS).map(([slug]) => slug));
artistPages.forEach(([slug, a]) => {
  const facts = [plural(a.songs, "song", "songs") + " played here", plural(a.plays, "play", "plays")];
  const who = (a.djs || []).filter((x) => x.dj);
  const top = (a.rows || []).slice(0, 3).map((t) => t.t).join(", ");
  // their sound and the artists the same DJs play (firetable-hostbot's Play history job)
  const sound = (a.g || []).filter(Boolean);
  const like = (a.sim || []).filter((x) => x && x.k && x.n && have.artist.has(x.k));
  const url = abs("artists/" + slug + "/");
  page({
    path: "artists/" + slug + "/", title: `${a.name}: top songs${like.length ? " and similar artists" : ""}`, heading: a.name, route: "discover/artist/" + slug,
    crumbs: [["Artists", "artists/"]],
    description: `The ${a.name} songs ${ROOM}'s DJs play most${top ? ": " + top : ""}. ${facts.join(", ")}.${sound.length ? " " + sound.join(", ") + "." : ""}${like.length ? " Sounds like " + like.slice(0, 4).map((x) => x.n).join(", ") + "." : ""}`,
    image: a.rows && a.rows[0] ? art(a.rows[0]) : null,
    card: cardArtists.has(slug) ? { kicker: "Artist", title: a.name, fact: plural(a.songs, "song", "songs") + " · " + plural(a.plays, "play", "plays"), covers: keysOf(a.rows) } : null,
    ld: playlistLd(a.name + ": top songs", "artists/" + slug + "/", a.rows, { about: { "@type": "MusicGroup", name: a.name, mainEntityOfPage: url, ...(sound.length ? { genre: sound } : {}) } }),
    body: back("artists/", "Artists") + pageHead(a.name, esc(facts.join(" · ")), {
      mosaic: mosaic((a.rows || []).slice(0, 4).map((t) => (t.type || 1) + "_" + t.cid), true),
      more: (sound.length ? `<p class="d-fact d-sound">${sound.map((g) => have.genre.has(genreSlug(g)) ? `<a class="d-tag" href="${BASE}genres/${genreSlug(g)}/">${esc(g)}</a>` : `<span class="d-tag">${esc(g)}</span>`).join("")}</p>` : "") +
        (a.first ? `<p class="d-fact">First played here ${day(a.first)}${a.firstDj ? " by " + djName(a.firstDj, a.firstDjid) : ""}</p>` : ""),
      play: ["discover/artist/" + slug, "Play all"]
    }) +
      `<section>${head("Most played here")}${rows(a.rows)}</section>` +
      (like.length ? `<section>${head("Sounds like")}<p class="d-fact">Artists the same DJs play</p>${chips(like.map((x) => [BASE + "artists/" + x.k + "/", x.n]))}</section>` : "") +
      (who.length ? `<section>${head("Who plays them")}<div class="d-people">${who.map((x) => person(djHref(x.dj, x.djid), x.dj, plural(x.plays, "play", "plays"))).join("")}</div></section>` : "")
  });
});
// every artist, a letter at a time: nobody's page is more than two steps from the list
const letterOf = (slug) => /^[a-z]/.test(slug) ? slug[0] : "0-9";
const letters = [...new Set(artistPages.map(([slug]) => letterOf(slug)))].sort((x, y) => (x === "0-9") - (y === "0-9") || (x < y ? -1 : 1));
const letterChips = (on) => `<div class="d-chips d-letters">${letters.map((l) => l === on ? `<span class="d-chip on" aria-current="page">${esc(l.toUpperCase())}</span>` : `<a class="d-chip" href="${BASE}artists-a-z/${l}/">${esc(l.toUpperCase())}</a>`).join("")}</div>`;
if (artistPages.length) {
  const TOP = 200;
  page({
    path: "artists/", title: `Artists: the ${n(artistPages.length)} the room plays, A to Z`, heading: "Artists", route: "discover/page/artists",
    description: `The ${n(artistPages.length)} artists played in ${ROOM}, with each one's most played songs and who plays them. Most played: ${artistPages.slice(0, 8).map(([, a]) => a.name).join(", ")}.`,
    ld: listLd("Artists", artistPages.slice(0, 100).map(([slug, a]) => [a.name, "artists/" + slug + "/"])),
    card: { kicker: "Library", title: "Artists", fact: n(artistPages.length) + " artists, A to Z", covers: artistPages.slice(0, 4).map(([, a]) => keysOf(a.rows)[0]) },
    body: viewHead("Artists", n(artistPages.length) + " artists played here. The " + Math.min(TOP, artistPages.length) + " most played, and everyone by letter.") + letterChips(null) +
      `<div class="d-people d-people-wide">` + artistPages.slice(0, TOP).map(([slug, a]) => person(BASE + "artists/" + slug + "/", a.name, plural(a.plays, "play", "plays"))).join("") + `</div>`
  });
  letters.forEach((l) => {
    const list = artistPages.filter(([slug]) => letterOf(slug) === l).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const L = l.toUpperCase();
    page({
      path: "artists-a-z/" + l + "/", title: `Artists: ${L}`, heading: L, route: "discover/page/artists-a-z/" + l,
      crumbs: [["Artists", "artists/"]],
      description: `The ${n(list.length)} artists under ${L} played in ${ROOM}: ${list.slice().sort((x, y) => (y[1].plays || 0) - (x[1].plays || 0)).slice(0, 8).map(([, a]) => a.name).join(", ")} and more.`,
      body: back("artists/", "Artists") + viewHead("Artists: " + L, plural(list.length, "artist", "artists") + " played here") + letterChips(l) +
        `<div class="d-people d-people-wide">` + list.map(([slug, a]) => person(BASE + "artists/" + slug + "/", a.name, plural(a.plays, "play", "plays"))).join("") + `</div>`
    });
  });
}

// years
if (yearList.length) {
  page({
    path: "years/", title: `The best songs of every year, ${yearList[yearList.length - 1]} to ${yearList[0]}`, heading: "Years", route: "discover/years",
    description: `${ROOM}'s playlist for each year since ${yearList[yearList.length - 1]}: the ${soundsText} released that year, and what the room played most from each.`,
    ld: listLd("Years", yearList.map((y) => [y, "years/" + y + "/"])),
    card: { kicker: "Library", title: "The best songs of every year", fact: yearList[yearList.length - 1] + " to " + yearList[0], covers: yearList.slice(0, 4).map((y) => keysOf((lib["discover/lib/year/" + y] || {}).top)[0]) },
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
    const top = names(p.top);
    page({
      path: "years/" + y + "/", title: "The best songs of " + y, heading: y, route: "discover/years/" + y,
      crumbs: [["Years", "years/"]],
      description: `The ${y} songs ${ROOM}'s DJs played most${top ? ": " + top : ""}. From the room's ${y} playlist of ${n(v.songs)} songs${v.genre ? ", mostly " + v.genre : ""}.`,
      image: p.top && p.top[0] ? art(p.top[0]) : null,
      ld: playlistLd("The best songs of " + y, "years/" + y + "/", p.top),
      card: { kicker: "Year", title: "The best songs of " + y, fact: n(v.songs) + " songs" + (v.genre ? " · mostly " + v.genre : ""), covers: keysOf(p.top) },
      body: back("years/", "Years") + pageHead(y, esc(n(v.songs) + " songs on the playlist · " + n(v.played) + " played here" + (v.genre ? " · mostly " + v.genre : "")), {
        mosaic: mosaic((p.top || []).slice(0, 4).map((t) => (t.type || 1) + "_" + t.cid), true), play: ["discover/years/" + y, "Play the year"]
      }) +
        `<section>${head("Most played here")}${rows(p.top)}</section>` +
        ((p.more || []).length ? `<section>${head("Not played here yet")}<p class="d-fact">From ${y}'s playlist. Play one for the room.</p>${rows(p.more, { max: 24, stamp: () => "", right: () => "" })}</section>` : "") +
        (genresIn(y).length ? `<section>${head(y + " by genre")}${chips(genresIn(y).map((o) => [BASE + "genres/" + o.slug + "/" + y + "/", o.name]))}</section>` : "")
    });
  });
}

// charts
const chartPaths = [];
["week", "month", "year"].forEach((period) => Object.keys((chartIds || {})[period] || {}).forEach((id) => chartPaths.push("discover/charts/" + period + "/" + id)));
chartPaths.push("discover/charts/all/all");
const charts = await readAll(chartPaths);
const weekOf = (id) => "Week " + Number(id.split("-W")[1]) + ", " + id.slice(0, 4);
const chartName = (period, id, c) => {
  if (period === "all") return "All time";
  if (period === "year") return id;
  if (period === "month") { const m = /^(\d{4})-(\d\d)$/.exec(id); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : id; }
  return weekOf(id) + (c && c.from ? " (" + day(c.from) + " to " + day(c.to - 1) + ")" : "");
};
const chartGenre = (t) => t.g ? (have.genre.has(genreSlug(t.g)) ? `<a class="d-g" href="${BASE}genres/${genreSlug(t.g)}/">${esc(t.g)}</a>` : `<span class="d-g">${esc(t.g)}</span>`) : "";
const chartRows = (c, max) => rows(c.rows, { max: max || 40, right: (t) => chartGenre(t) + '<span class="d-num">' + plural(t.plays, "play", "plays") + "</span>" });
const chartFact = (c) => c.plays ? plural(c.plays, "play", "plays") + " by " + plural(c.djs || 0, "DJ", "DJs") + (c.final === false ? " so far" : "") : "";
const chartList = [];
chartPaths.forEach((p) => {
  const c = charts[p];
  if (!c || !(c.rows || []).length) return;
  const [, , period, id] = p.split("/");
  const name = chartName(period, id, c);
  const path = "charts/" + (period === "all" ? "all-time" : period + "/" + id) + "/";
  chartList.push({ period, id, name, path, c });
  const shown = Math.min(c.rows.length, 40);
  const what = period === "all" ? "of all time" : period === "week" ? "the week of " + day(c.from || Date.now()) : "of " + name;
  page({
    path, title: period === "all" ? `The top ${shown} songs of all time` : period === "week" ? `Top ${shown} songs: week of ${day(c.from || Date.now())}` : `Top ${shown} songs of ${name}`,
    heading: period === "week" ? weekOf(id) : name, route: "discover/charts/" + (period === "all" ? "all" : period + "/" + id),
    crumbs: [["Charts", "charts/"]],
    description: `The ${soundsText} songs played most in ${ROOM}, ${what}: ${names(c.rows)}. ${chartFact(c) ? chartFact(c) + "." : ""}`,
    image: c.rows[0] ? art(c.rows[0]) : null,
    ld: playlistLd(ROOM + " chart: " + name, path, c.rows),
    card: { kicker: "Chart", title: period === "all" ? "The top " + shown + " of all time" : period === "week" ? "Top " + shown + ": week of " + day(c.from || Date.now()).replace(/, \d{4}$/, "") : "Top " + shown + " of " + name, fact: "#1 " + names(c.rows, 1), covers: keysOf(c.rows) },
    body: back("charts/", "Charts") + viewHead("Room chart: " + name, chartFact(c)) + chartRows(c)
  });
});
const latestWeek = chartList.filter((x) => x.period === "week").sort((a, b) => (a.id < b.id ? 1 : -1))[0];
if (chartList.length) {
  const group = (period, label) => {
    const list = chartList.filter((x) => x.period === period).sort((a, b) => (a.id < b.id ? 1 : -1));
    return list.length ? `<section>${head(label)}${chips(list.map((x) => [BASE + x.path, x.name]))}</section>` : "";
  };
  // like Discover's Charts: this week's chart, then the way to every other
  page({
    path: "charts/", title: `Charts: the top ${SOUNDS.slice(0, 2).join(" and ")} songs this week`, heading: "Charts", route: "discover/charts",
    description: `${ROOM}'s weekly, monthly, yearly and all-time charts: the ${soundsText} songs DJs played most.${latestWeek ? " This week: " + names(latestWeek.c.rows) + "." : ""}`,
    image: latestWeek && latestWeek.c.rows[0] ? art(latestWeek.c.rows[0]) : null,
    ld: [listLd("Charts", chartList.map((x) => [x.name, x.path]))].concat(latestWeek ? [playlistLd(ROOM + " chart: " + latestWeek.name, latestWeek.path, latestWeek.c.rows)] : []),
    card: { kicker: "Charts", title: "This week's top " + (latestWeek ? Math.min(latestWeek.c.rows.length, 40) : 40), fact: latestWeek ? "#1 " + names(latestWeek.c.rows, 1) : "", covers: latestWeek ? keysOf(latestWeek.c.rows) : [] },
    body: (latestWeek ? viewHead("Room chart: " + latestWeek.name, chartFact(latestWeek.c)) + chartRows(latestWeek.c) : viewHead("Room charts", "The songs played most in the room")) +
      group("all", "All time") + group("week", "Weeks") + group("month", "Months") + group("year", "Years")
  });
}

// new releases (discover/new, from the bot, once a day)
const fresh = (await read("discover/new")) || {};
const newTracks = (fresh.tracks || []).filter((t) => t && t.cid && t.rel).sort((a, b) => (String(a.rel) < String(b.rel) ? 1 : String(a.rel) > String(b.rel) ? -1 : (b.plays || 0) - (a.plays || 0)));
const newRows = (list, max) => rows(list, { max, stamp: (t) => day(relDay(t.rel)).replace(/, \d{4}$/, ""), right: (t) => chartGenre(t) + `<span class="d-num">${t.plays ? plural(t.plays, "play", "plays") : "new"}</span>` });
if (newTracks.length) {
  const now = fresh.at || Date.now();
  const week = newTracks.filter((t) => now - relDay(t.rel) <= 7 * 86400000);
  const rest = newTracks.filter((t) => now - relDay(t.rel) > 7 * 86400000);
  page({
    path: "new/", title: `New ${SOUNDS.slice(0, 2).join(" and ")} releases this week`, heading: "New releases", route: "discover/new",
    description: `New ${soundsText} songs, out in the last ${fresh.days || 90} days and found by ${ROOM}'s DJs: ${names(newTracks, 4)}. Updated every day.`,
    image: art(newTracks[0]),
    ld: playlistLd("New releases in " + ROOM, "new/", newTracks),
    card: { kicker: "New releases", title: "Out this week", fact: names(newTracks, 1), covers: keysOf(newTracks) },
    body: viewHead("New releases", plural(newTracks.length, "song", "songs") + " released in the last " + (fresh.days || 90) + " days, newest first") +
      (week.length ? `<section>${head("Out this week")}${newRows(week, 60)}</section>` : "") +
      (rest.length ? `<section>${head(week.length ? "Earlier" : "The last " + (fresh.days || 90) + " days")}${newRows(rest, 100 - Math.min(week.length, 60))}</section>` : "")
  });
}
const rising = ((await read("discover/lib/rising")) || {}).rows || [];

// theme nights (discover/themes, from the bot)
const nightIndex = (await read("discover/themes/index")) || {};
const nightIds = Object.keys(nightIndex).sort((a, b) => nightIndex[b].from - nightIndex[a].from);
const nightDay = (ms) => new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const nightPages = await readAll(nightIds.map((k) => "discover/themes/night/" + k));
const nightList = nightIds.filter((k) => nightPages["discover/themes/night/" + k]);
nightList.forEach((k) => {
  const n = nightPages["discover/themes/night/" + k];
  page({
    path: "themes/" + k + "/", title: n.theme + ", " + nightDay(n.from), heading: n.theme, route: "discover/themes/" + k,
    crumbs: [["Theme nights", "themes/"]],
    description: `${n.theme}: the ${n.n} songs ${ROOM} played on ${nightDay(n.from)}${(n.djs || []).length ? ", with " + n.djs.join(", ") : ""}. ${names(n.rows)}.`,
    image: n.rows && n.rows[0] ? art(n.rows[0]) : null,
    ld: playlistLd(n.theme + " · " + nightDay(n.from), "themes/" + k + "/", n.rows),
    card: { kicker: "Theme night", title: n.theme, fact: nightDay(n.from) + " · " + plural(n.n, "song", "songs"), covers: keysOf(n.rows) },
    body: back("themes/", "Theme nights") + pageHead(n.theme, esc(nightDay(n.from) + " · " + plural(n.n, "song", "songs") + ((n.djs || []).length ? " · " + n.djs.join(", ") : "")), {
      mosaic: mosaic((n.rows || []).slice(0, 4).map((t) => (t.type || 1) + "_" + t.cid), true), play: ["discover/themes/" + k, "Play the night"]
    }) + rows(n.rows, { max: 100, stamp: (t) => new Date(t.w).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).replace(" ", "").toLowerCase() })
  });
});
const nightCards = (max) => `<div class="d-nights">${nightList.slice(0, max).map((k) => { const n = nightIndex[k];
  return `<a class="d-night" href="${BASE}themes/${k}/"><b>${esc(n.theme)}</b><span>${esc(nightDay(n.from) + " · " + plural(n.n, "song", "songs") + ((n.djs || []).length ? " · " + n.djs.join(", ") : ""))}</span></a>`; }).join("")}</div>`;
if (nightList.length) {
  page({
    path: "themes/", title: "Theme nights: every night and its playlist", heading: "Theme nights", route: "discover/themes",
    description: `Every theme night in ${ROOM}: the songs DJs played for each theme, night by night. Latest: ${nightList.slice(0, 4).map((k) => nightIndex[k].theme).join(", ")}.`,
    ld: listLd("Theme nights", nightList.map((k) => [nightIndex[k].theme, "themes/" + k + "/"])),
    body: viewHead("Theme nights", "Every night the room played under a theme, newest first") + nightCards(nightList.length)
  });
}

// the library's front page, and the same shelves for the home page
const shelves = {
  fresh: newTracks.length ? `<section>${head("New releases", "All new releases", "new/")}${newRows(newTracks, 10)}</section>` : "",
  chart: latestWeek ? `<section>${head("This week's chart", "All charts", "charts/")}${chartRows(latestWeek.c, 10)}</section>` : "",
  rising: rising.length ? `<section>${head("Rising")}<p class="d-fact">Played more these four weeks than the four before</p>${rows(rising, { max: 8 })}</section>` : "",
  genres: genreList.length ? `<section>${head("Genres", "All genres", "genres/")}${chips(genreList.map((g) => [BASE + "genres/" + g.slug + "/", g.name]))}</section>` : "",
  djs: djList.length ? `<section>${head("DJs", "All DJs", "djs/")}${chips(djList.slice(0, 30).map((d) => [BASE + "djs/" + d.key + "/", d.name]))}</section>` : "",
  years: yearList.length ? `<section>${head("Years", "All years", "years/")}${chips(yearList.map((y) => [BASE + "years/" + y + "/", y]))}</section>` : "",
  artists: artistPages.length ? `<section>${head("Artists", "All " + n(artistPages.length) + " artists", "artists/")}${chips(artistPages.slice(0, 40).map(([slug, a]) => [BASE + "artists/" + slug + "/", a.name]))}</section>` : "",
  nights: nightList.length ? `<section>${head("Theme nights", "All theme nights", "themes/")}${nightCards(5)}</section>` : ""
};
const counts = `${n(genreList.length)} genres, ${n(djList.length)} DJs, ${n(artistPages.length)} artists and every year since ${yearList[yearList.length - 1] || "the start"}`;
page({
  path: "", title: "The library: every genre, DJ, artist and year", heading: "Library", route: "discover/page/library",
  description: `Everything ${ROOM} has played: ${counts}, with the charts and new releases. ${cap(soundsText)}, from the room's play history.`,
  card: { kicker: ROOM, title: "The library", fact: "Every genre, DJ, artist and year the room has played", covers: genreList.slice(0, 4).map((g) => (g.covers || [])[0]) },
  ld: listLd("The library", [["New releases", "new/"], ["Charts", "charts/"], ["Genres", "genres/"], ["DJs", "djs/"], ["Artists", "artists/"], ["Years", "years/"], ["Theme nights", "themes/"]]
    .filter(([, path]) => pages.some((p) => p.path === path))),
  body: viewHead(ROOM + ": the library", "Everything the room has played, by genre, DJ, artist and year.") +
    shelves.fresh + shelves.chart + shelves.genres + shelves.djs + shelves.years + shelves.artists + shelves.nights
});

// The home page: the site's index.html with what's new, this week's chart and
// the ways into the library already in Discover's Home. Search engines read a
// page with songs and links on it; the site fills Home in as it always does
// (Discover shows once it knows whether you're signed in, so Live's regulars
// never see it flash by).
let homeHtml = null;
if (HOME) {
  const about = (TEMPLATE.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || "";
  // Discover's pages as tiles first, as the site draws them at the top of its Home (js/discover-tabs.js,
  // from discover.js's VIEWS): a phone's way to them (css/discover.css shows them under 640px) from the
  // first paint, not only once the live Home has its data. The library's pages only where one was built
  const tiles = [["new", "New", "new_releases", "new/"], ["fresh", "Fresh", "carrot", "#discover/fresh"], ["charts", "Charts", "leaderboard", "charts/"],
    ["genres", "Genres", "category", "genres/"], ["djs", "DJs", "headphones", "djs/"], ["years", "Years", "calendar_month", "years/"],
    ["themes", "Theme nights", "nightlife", "themes/"], ["recent", "Recent plays", "history", "#discover/recent"]]
    .filter(([, , , to]) => to[0] === "#" || pages.some((p) => p.path === to))
    .map(([id, label, name, to]) => `<a class="d-tile" data-view="${id}" href="${to[0] === "#" ? "/" + to : BASE + to}">${icon(name)}<span>${label}</span></a>`);
  homeHtml = fill(/<base href/i.test(TEMPLATE) ? TEMPLATE : TEMPLATE.replace(/(<head>\s*\n?)/i, `$1\t<base href="/" />\n`), "discover",
    `<nav class="d-tiles" aria-label="Discover's pages">${tiles.join("")}</nav>` +
    `<div class="d-headrow"><h2>${esc(ROOM)}</h2></div>${about ? `<p class="d-fact">${about}</p>` : ""}` +
    shelves.fresh + shelves.chart + shelves.rising + shelves.genres + shelves.djs + shelves.years + shelves.artists + shelves.nights +
    `<p class="d-fact d-plainfoot"><a href="${BASE}">The whole library</a> · <a href="about/">About the room</a></p>`, false);
}

// ---------------------------------------------------------------- write

// The day each page's own content last changed: kept from the last run
// (pages.json on the live site) for a page that reads the same, today's for
// one that's new or different. Search engines trust dates that are true.
const today = isoDay(Date.now());
let before = null;
try { before = JSON.parse((await getText(SITE + BASE.slice(1) + "pages.json")) || "null"); } catch { before = null; }
const was = (before && before.pages) || {};
const changed = [];
pages.forEach((p) => {
  const old = was[p.path];
  p.lastmod = old && old[0] === p.hash ? old[1] : before ? today : isoDay(updated.at);
  if (!old || old[0] !== p.hash) changed.push(abs(p.path));
});

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
pages.forEach((p) => {
  const dir = join(OUT, p.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), p.html);
});
// Share images: each page's covers, name and a fact (tools/share-cards.mjs).
// Covers are read once each, a few at a time; a cover that can't be read is
// left out. Each file keeps one old date: the same picture is the same file,
// so the upload sends only the ones that changed (a different size).
if (CARDS && cardJobs.length) {
  const covers = new Map(); // "type_cid" -> Promise<Buffer|null>
  const coverOfKey = (key) => {
    if (!covers.has(key)) {
      const cut = String(key).indexOf("_"), type = Number(String(key).slice(0, cut)) || 1, cid = String(key).slice(cut + 1);
      covers.set(key, type !== 1 ? Promise.resolve(null) : fetch("https://i.ytimg.com/vi/" + encodeURIComponent(cid) + "/hqdefault.jpg", { headers: { "User-Agent": "firetable-plain-pages" } })
        .then((res) => (res.ok ? res.arrayBuffer() : null)).then((b) => (b ? CARDS.cover(Buffer.from(b), { youtube: true }) : null)).catch(() => null));
    }
    return covers.get(key);
  };
  const { utimesSync } = await import("fs");
  const old = new Date("2001-01-01T00:00:00Z");
  let next = 0, drawn = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < cardJobs.length) {
      const job = cardJobs[next++];
      const keys = (job.card.covers || []).filter(Boolean).slice(0, 4);
      const got = (await Promise.all(keys.map(coverOfKey))).filter(Boolean);
      const file = join(OUT, job.path, "card.jpg");
      // four covers make a square of four; fewer, the first one alone
      writeFileSync(file, await CARDS.card({ kicker: job.card.kicker, title: job.card.title, fact: job.card.fact, site: new URL(SITE).host.replace(/^www\./, ""), covers: got.length >= 4 ? got : got.slice(0, 1) }));
      utimesSync(file, old, old);
      drawn++;
    }
  }));
  console.log(`share images: ${drawn} drawn from ${covers.size} covers`);
}
writeFileSync(join(OUT, "pages.json"), JSON.stringify({ at: new Date().toISOString(), pages: Object.fromEntries(pages.map((p) => [p.path, [p.hash, p.lastmod]])) }));
const newest = pages.reduce((m, p) => (p.lastmod > m ? p.lastmod : m), "");
const others = [[SITE, newest], [SITE + "about/", null]]; // the sitemap is named in robots.txt, so it may list the whole site
writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${others.map(([loc, mod]) => `<url><loc>${esc(loc)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}</url>`).join("\n")}
${pages.map((p) => `<url><loc>${esc(abs(p.path))}</loc><lastmod>${p.lastmod}</lastmod></url>`).join("\n")}
</urlset>
`);

// Feeds (Atom): new releases as they come out, and each week's chart
const xml = (s) => esc(s);
const feed = (path, title, self, entries, when) => {
  mkdirSync(join(OUT, path), { recursive: true });
  writeFileSync(join(OUT, path, "feed.xml"), `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${xml(title)}</title>
<id>${xml(abs(path))}</id>
<link rel="self" type="application/atom+xml" href="${xml(abs(path + "feed.xml"))}"/>
<link rel="alternate" type="text/html" href="${xml(abs(self))}"/>
<updated>${new Date(when).toISOString()}</updated>
<author><name>${xml(ROOM)}</name><uri>${xml(SITE)}</uri></author>
${entries.map((e) => `<entry><title>${xml(e.title)}</title><id>${xml(e.id)}</id><link rel="alternate" type="text/html" href="${xml(e.link)}"/><updated>${new Date(e.when).toISOString()}</updated><content type="html">${xml(e.html)}</content></entry>`).join("\n")}
</feed>
`);
};
if (newTracks.length) {
  feed("new/", ROOM + ": new releases", "new/", newTracks.slice(0, 50).map((t) => {
    const slug = String(t.a || "").split(ARTIST_SPLIT).map((part, i) => (i % 2 ? null : artistSlug(part))).find((k) => k && have.artist.has(k));
    return { title: t.a + " - " + t.t, id: abs("new/") + "#" + encodeURIComponent((t.type || 1) + "_" + t.cid), link: slug ? abs("artists/" + slug + "/") : abs("new/"), when: Math.max(relDay(t.rel), t.first || 0),
      html: `<p>${esc(t.a)} - ${esc(t.t)}${t.al ? ", from " + esc(t.al) : ""}. Out ${esc(day(relDay(t.rel)))}${t.dj ? ", found by " + esc(t.dj) : ""}.</p>${songUrl(t) ? `<p><a href="${esc(songUrl(t))}">Watch on YouTube</a> · <a href="${esc(abs("new/"))}">More new releases</a></p>` : ""}` };
  }), fresh.at || Date.now());
}
const weeks = chartList.filter((x) => x.period === "week").sort((a, b) => (a.id < b.id ? 1 : -1));
if (weeks.length) {
  feed("charts/", ROOM + ": the weekly chart", "charts/", weeks.slice(0, 12).map((x) => ({
    title: x.name + ": " + names(x.c.rows, 1), id: abs(x.path), link: abs(x.path), when: Math.min(x.c.to || Date.now(), Date.now()),
    html: `<ol>${x.c.rows.slice(0, 10).map((t) => `<li>${esc(t.a)} - ${esc(t.t)} (${esc(plural(t.plays, "play", "plays"))})</li>`).join("")}</ol><p><a href="${esc(abs(x.path))}">The whole chart</a></p>`
  })), Math.min(weeks[0].c.to || Date.now(), Date.now()));
}

// Search's songs: every song played here, split by word for Discover (tools/song-search.mjs)
await songSearch({ meta, read, getText, site: SITE, out: OUT });

// IndexNow (Bing, Yandex, Naver, Seznam...): the key, and what changed since the last run for the deploy to tell them
writeFileSync(join(OUT, INDEXNOW_KEY + ".txt"), INDEXNOW_KEY + "\n");
writeFileSync(join(OUT, ".changed"), JSON.stringify({ host: new URL(SITE).host, key: INDEXNOW_KEY, keyLocation: abs(INDEXNOW_KEY + ".txt"), urlList: changed.slice(0, 10000) }) + "\n");
if (homeHtml) writeFileSync(HOME, homeHtml);
writeFileSync(join(OUT, ".built"), new Date().toISOString() + "\n");
console.log(`plain pages: ${pages.length} pages in ${OUT}/ (${genreList.length} genres, ${djList.length} DJs, ${artistPages.length} artists, ${yearList.length} years, ${chartList.length} charts, ${nightList.length} theme nights${newTracks.length ? ", new releases" : ""}), ${changed.length} changed${homeHtml ? ", and the home page" : ""}`);
