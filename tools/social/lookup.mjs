// What the posts need to know about a song that the room doesn't keep: its
// real album cover (square, full size), a 30-second preview to play under
// the video, its genre, and the artist's own social accounts (to tag them).
//
//   covers and previews: Apple's catalog (the iTunes Search API, no key), then
//                        Deezer's (no key); the YouTube thumbnail as a last resort
//   accounts:            MusicBrainz's links for the artist (1 request a second)
//
// Lookups are kept in the state (state.mjs) for 30 days.
// Never deployed (tools/).

import { http, bytes, plain, artists, sleep } from "./util.mjs";
import { squareCover, plainCover } from "./render.mjs";

const DAY = 86400000;

function score(want, got) {
  const wt = plain(want.title), wa = plain(want.artist), gt = plain(got.title), ga = plain(got.artist);
  if (!gt || !ga) return 0;
  let s = 0;
  if (String(want.title).toLowerCase() === String(got.title).toLowerCase()) s += 3;
  if (wt === gt) s += 3;
  else if (gt.startsWith(wt) || wt.startsWith(gt)) s += 2;
  else {
    const a = new Set(wt.split(" ")), b = gt.split(" ");
    const shared = b.filter((w) => a.has(w)).length / Math.max(a.size, b.length);
    if (shared < 0.6) return 0;
    s += shared * 2;
  }
  const first = plain(artists(want.artist)[0] || want.artist);
  if (wa === ga) s += 3;
  else if (ga.includes(first) || first.includes(ga.split(" and ")[0])) s += 2;
  else return 0;
  // a remix is a different recording: only take one when we asked for one
  if (/remix|edit|version|mix\b/i.test(got.title) !== /remix|edit|version|mix\b/i.test(want.title)) s -= 1.5;
  return s;
}

async function apple(want, country) {
  const term = encodeURIComponent((artists(want.artist)[0] || want.artist) + " " + String(want.title).replace(/[([].*?[)\]]/g, " "));
  const j = await http(`https://itunes.apple.com/search?term=${term}&entity=song&media=music&limit=15&country=${country}`, { tries: 2 });
  let best = null, top = 0;
  for (const r of (j && j.results) || []) {
    const s = score(want, { title: r.trackName, artist: r.artistName });
    if (s > top) { top = s; best = r; }
  }
  if (!best || top < 4) return null;
  return {
    source: "apple",
    artwork: best.artworkUrl100 ? best.artworkUrl100.replace(/\/\d+x\d+bb\./, "/1200x1200bb.") : null,
    preview: best.previewUrl || null,
    url: best.trackViewUrl ? best.trackViewUrl.replace(/[?&]uo=\d+/, "") : null,
    album: best.collectionName || null,
    genre: best.primaryGenreName || null,
    released: best.releaseDate ? best.releaseDate.slice(0, 10) : null,
    explicit: best.trackExplicitness === "explicit"
  };
}

async function deezer(want) {
  const q = encodeURIComponent(`artist:"${artists(want.artist)[0] || want.artist}" track:"${String(want.title).replace(/"/g, "")}"`);
  const j = await http(`https://api.deezer.com/search?q=${q}&limit=10`, { tries: 2 });
  let best = null, top = 0;
  for (const r of (j && j.data) || []) {
    const s = score(want, { title: r.title, artist: r.artist && r.artist.name });
    if (s > top) { top = s; best = r; }
  }
  if (!best || top < 4) return null;
  return {
    source: "deezer",
    artwork: best.album && (best.album.cover_xl || best.album.cover_big) || null,
    preview: best.preview || null,
    url: best.link || null,
    album: best.album && best.album.title || null,
    genre: null,
    released: null,
    explicit: !!best.explicit_lyrics
  };
}

/**
 * A song's catalog details, from the cache or the catalogs.
 * @param {{artist: string, title: string, cid?: string, type?: number}} song
 */
export async function catalog(song, state, { country = "US" } = {}) {
  const key = "song:" + plain(song.artist) + "|" + plain(song.title);
  const hit = state.cache[key];
  if (hit && Date.now() - hit.at < 30 * DAY) return hit.v;
  let v = null;
  for (const look of [() => apple(song, country), () => deezer(song)]) {
    try { v = await look(); } catch (err) { console.log("  lookup: " + err.message); }
    if (v && v.artwork) break;
  }
  // Apple has the cover but no preview (or the other way round): fill the gap from Deezer
  if (v && !v.preview && v.source === "apple") {
    try { const d = await deezer(song); if (d && d.preview) v.preview = d.preview; } catch { /* keep what we have */ }
  }
  state.cache[key] = { at: Date.now(), v };
  return v;
}

/** The song's cover as a 1000 px square: the catalog's, else YouTube's thumbnail, else the room's mark. */
export async function coverFor(song, info) {
  const tries = [];
  if (info && info.artwork) tries.push(info.artwork);
  if (song.cid && Number(song.type || 1) === 1) {
    tries.push(`https://i.ytimg.com/vi/${encodeURIComponent(song.cid)}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${encodeURIComponent(song.cid)}/hqdefault.jpg`);
  }
  if (song.image && !tries.includes(song.image)) tries.push(song.image);
  for (const url of tries) {
    try {
      const b = await bytes(url, { tries: 2 });
      // YouTube's "no maxres" placeholder is a 120 x 90 grey picture
      if (b.length < 3000) continue;
      const sq = await squareCover(b);
      if (sq) return sq;
    } catch { /* the next one */ }
  }
  return plainCover();
}

// ---------------------------------------------------------------- the artist's accounts

const SOCIAL = [
  ["instagram", /instagram\.com\/([A-Za-z0-9_.]{1,30})\/?$/],
  ["tiktok", /tiktok\.com\/@([A-Za-z0-9_.]{2,24})\/?$/],
  ["bluesky", /bsky\.app\/profile\/([A-Za-z0-9.-]+\.[a-z]{2,})\/?$/],
  ["threads", /threads\.(?:net|com)\/@([A-Za-z0-9_.]{1,30})\/?$/],
  ["youtube", /youtube\.com\/@([A-Za-z0-9_.-]{3,30})\/?$/],
  ["facebook", /facebook\.com\/([A-Za-z0-9.]{5,50})\/?$/]
];
let lastMb = 0;

async function mb(url) {
  const wait = lastMb + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastMb = Date.now();
  return http(url, { tries: 2, headers: { "User-Agent": `IndieDiscothequeSocial/1.0 ( ${process.env.SOCIAL_SITE || "https://github.com/indiediscotheque/firetable-user"} )`, Accept: "application/json" } });
}

/**
 * The artist's handles on each platform, from their MusicBrainz entry. Only
 * an exact name match counts, so the wrong band never gets tagged.
 * @returns {Promise<Record<string, string>>} e.g. {instagram: "breakbot", bluesky: "breakbot.bsky.social"}
 */
export async function artistAccounts(name, state) {
  const key = "artist:" + plain(name);
  const hit = state.cache[key];
  if (hit && Date.now() - hit.at < 30 * DAY) return hit.v;
  let v = {};
  try {
    const q = encodeURIComponent(`artist:"${String(name).replace(/"/g, "")}"`);
    const found = await mb(`https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=5`);
    const exact = ((found && found.artists) || []).filter((a) => a.score >= 95 && plain(a.name) === plain(name));
    // two artists with the same name: we can't tell which, so tag neither
    if (exact.length === 1) {
      const a = await mb(`https://musicbrainz.org/ws/2/artist/${exact[0].id}?inc=url-rels&fmt=json`);
      for (const rel of (a && a.relations) || []) {
        const url = rel.url && rel.url.resource;
        if (!url || rel.ended) continue;
        for (const [site, re] of SOCIAL) {
          const m = re.exec(url.replace(/\?.*$/, ""));
          if (m && !v[site] && !/^(p|reel|explore|channel|user|watch|share|sharer|pages|profile\.php)$/i.test(m[1])) v[site] = m[1];
        }
      }
    }
  } catch (err) {
    console.log("  MusicBrainz: " + err.message);
    return v; // not cached: try again next time
  }
  state.cache[key] = { at: Date.now(), v };
  return v;
}

/** Every credited artist's accounts, merged: {instagram: ["a", "b"], …}. */
export async function accountsFor(artistLine, state, max = 3) {
  const out = {};
  for (const name of artists(artistLine).slice(0, max)) {
    const acc = await artistAccounts(name, state);
    for (const [site, handle] of Object.entries(acc)) (out[site] = out[site] || []).push(handle);
  }
  return out;
}
