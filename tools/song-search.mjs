// The library's song search, as static files: Discover's search looks a song
// up in one small file instead of the database (js/discover-find.js).
//
// firetable-hostbot's weekly Play history job publishes every song played here
// (discover/lib/songs/<n>, 5,000 rows each: [artist, title, type, cid, plays])
// and a hash of them (discover/lib/meta songsHash). This writes <out>/find/:
//   index.json     {v, hash, songs, split}: which word starts split by one more letter
//   w-<key>.json   the songs with a word starting so, most played first
//   songs.json     {hash, rows}: every row, so the next build can start from here
//
// The database is read only when the hash is new: otherwise the rows come from
// the live site's songs.json, so the daily deploy costs the database nothing.
// Every file gets the index's time as its own, so an unchanged index uploads
// nothing (the deploy's lftp mirror skips files of the same size and time).
// The split into files is js/discover-find.js's build(), so the site and this
// cut words the same way. Run by tools/plain-pages.mjs; never deployed (tools/).
import { readFileSync, writeFileSync, mkdirSync, rmSync, utimesSync, readdirSync } from "fs";
import { join } from "path";
import vm from "vm";

const CHUNK = 5000; // rows in each discover/lib/songs/<n> (firetable-hostbot tools/history/songindex.js)

/** js/discover-find.js's word helpers, run without a page. */
export function finder() {
  const ctx = vm.createContext({ firetable: {} });
  vm.runInContext(readFileSync(new URL("../js/discover-find.js", import.meta.url), "utf8"), ctx);
  return ctx.firetable.discoverFind;
}

/**
 * Write <out>/find/ for the published songs.
 * @param {{meta: Object|null, read: Function, getText: Function, site: string, out: string, log?: Function}} o
 *   read(path) reads the database; getText(url) the live site (null for a 404)
 * @returns {Promise<{songs: number, files: number, from: string}|null>} null when no songs are published yet
 */
export async function songSearch({ meta, read, getText, site, out, log = console.log }) {
  const hash = meta && meta.songsHash;
  if (!hash || !meta.songs) { log("Song search: no songs published yet (firetable-hostbot's Play history job)."); return null; }
  let rows = null, at = Date.now(), from = "the database";
  // the live site's copy, when it's of the same songs
  try {
    const live = JSON.parse((await getText(site + "music/find/songs.json?v=" + encodeURIComponent(hash))) || "null");
    if (live && live.hash === hash && Array.isArray(live.rows) && live.rows.length === meta.songs) {
      rows = live.rows;
      at = Number(live.at) || at;
      from = "the live site (unchanged)";
    }
  } catch (e) { log("Song search: the live site's copy couldn't be read (" + e.message + "); reading the database."); }
  if (!rows) {
    const n = Math.ceil(meta.songs / CHUNK);
    const chunks = await Promise.all(Array.from({ length: n }, (_, i) => read("discover/lib/songs/" + i)));
    rows = chunks.flatMap((c) => (Array.isArray(c) ? c : []));
    if (rows.length !== meta.songs) throw new Error("song search: read " + rows.length + " songs, meta says " + meta.songs);
  }
  rows = rows.filter((r) => Array.isArray(r) && r.length >= 4 && r[1] && r[3] != null);
  const built = finder().build(rows, hash);
  const dir = join(out, "find");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
  write("index.json", built.index);
  Object.entries(built.files).forEach(([key, list]) => write("w-" + key + ".json", list));
  write("songs.json", { hash, at, rows });
  const when = new Date(at);
  readdirSync(dir).forEach((f) => utimesSync(join(dir, f), when, when));
  const files = Object.keys(built.files).length;
  log(`Song search: ${rows.length} songs in ${files} files, from ${from}.`);
  return { songs: rows.length, files, from };
}
