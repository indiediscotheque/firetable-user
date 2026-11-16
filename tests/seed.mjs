// The data the browser tests start from, shared by smoke.mjs and screens.mjs
// so both see the same room. Plain objects: each test writes them with its own
// putAs(namespace). Never deployed.

export const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The room's song as the bot leaves it: YouTube, started `now`, five minutes long. */
export const youtubeSong = (now) => ({ type: 1, cid: "dQw4w9WgXcQ", title: "Smoke Song", artist: "Smoke Artist", started: now, duration: 300, djid: "dj1", djname: "dj1",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", image: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", postedDate: now });

/** The room as the bot leaves it: a YouTube song playing, two DJs, a theme. */
export const room = (now, song = youtubeSong(now)) => ({
  users: { dj1: { username: "dj1", status: true }, dj2: { username: "dj2", status: true } },
  table: [{ name: "dj1", id: "dj1", plays: 1 }, { name: "dj2", id: "dj2", plays: 0 }], playdex: 0, playlimit: "∞",
  songToPlay: song, theme: "smoke tests", colors: { color: "#cc1c2c", txt: "#fff" }
});

/** What the hostbot publishes for Discover (discover/*): new releases, a chart, theme nights, fires, the chat peek. */
export const discover = (now) => ({
  new: { at: now, days: 90, tracks: [
    { cid: "newrel0001", a: "New Band", t: "First Single", dur: 200, rel: iso(now - 2 * DAY), relSrc: "yt", plays: 3, first: now - DAY, dj: "dj1", djid: "dj1" },
    { cid: "newrel0002", a: "Quiet One", t: "Unplayed", dur: 210, rel: iso(now - 5 * DAY), relSrc: "yt", plays: 0 },
    { cid: "newrel0003", a: "Third", t: "Song", dur: 180, rel: iso(now - 9 * DAY), relSrc: "upload", plays: 1, first: now - DAY, dj: "dj2", djid: "dj2" }] },
  charts: { week: { "2026-W45": { at: now, from: now - 3 * DAY, to: now + 4 * DAY, plays: 40, djs: 3, rows: [
    { key: "a", type: 1, cid: "chart00001", a: "Top", t: "Song", plays: 9, dj: "dj1", djid: "dj1", mv: 2, wks: 3 },
    { key: "b", type: 1, cid: "chart00002", a: "Next", t: "Song", plays: 7, mv: "new", wks: 1 },
    { key: "c", type: 1, cid: "newrel0001", a: "New Band", t: "First Single", plays: 3, fires: 4, wks: 2 }] } } },
  themes: {
    index: { nT1: { theme: "Italo Night", from: now - 2 * DAY, to: now - 2 * DAY + 3600000, n: 3, djs: ["dj1"] } },
    night: { nT1: { theme: "Italo Night", from: now - 2 * DAY, to: now - 2 * DAY + 3600000, n: 3, djs: ["dj1"], rows: [
      { type: 1, cid: "night00001", a: "Italo", t: "One", dj: "dj1", djid: "dj1", w: now - 2 * DAY, f: 2 },
      { type: 1, cid: "night00002", a: "Italo", t: "Two", dj: "dj1", djid: "dj1", w: now - 2 * DAY + 1800000 },
      { type: 1, cid: "night00003", a: "Italo", t: "Three", dj: "dj1", djid: "dj1", w: now - 2 * DAY + 3600000 }] },
      // not in the index: only Save all's whole-list check opens it
      nT2: { theme: "Long Night", from: now - 3 * DAY, to: now - 3 * DAY + 3600000, n: 100, djs: ["dj1"],
        rows: Array.from({ length: 100 }, (_, i) => ({ type: 1, cid: "long" + String(i).padStart(7, "0"), a: "Long", t: "Song " + (i + 1), dj: "dj1", djid: "dj1", w: now - 3 * DAY + i * 60000 })) } }
  },
  chartIds: { week: { "2026-W45": true } },
  ytm: { "nu-disco": "PLsmokeNuDisco" },
  fires: { at: now, since: now - 5 * DAY, index: [{ djid: "dj1", dj: "dj1", fires: 7, plays: 3 }, { djid: "dj2", dj: "dj2", fires: 2, plays: 1 }],
    djs: { dj1: { name: "dj1", fires: 7, plays: 3, songs: [
      { key: "f1", type: 1, cid: "hot0000001", a: "Hot", t: "One", fires: 5, plays: 2, top: 3, w: now - DAY },
      { key: "f2", type: 1, cid: "hot0000002", a: "Warm", t: "Two", fires: 2, plays: 1, top: 2, w: now - 2 * DAY }] } } },
  chat: { at: now, hour: 12, msgs: [{ id: "m1", uid: "dj1", n: "dj1", txt: "great tune", w: now }, { id: "m2", txt: "hidden name here", w: now }] }
});

/** The weekly library (discover/lib, tools/history/library.js in firetable-hostbot). */
export const library = (now) => {
  const row = (cid, a, t, plays, extra) => Object.assign({ type: 1, cid, a, t, plays, first: now - 400 * DAY, dj: "dj1", djid: "dj1" }, extra || {});
  return {
    genres: { "nu-disco": { name: "Nu-Disco", songs: 40, plays: 300, bpm: 118, first: 2010, djs: 2, x: 0.64, covers: ["1_lib0000001"], next: ["soul-and-randb"],
      about: "Disco's grooves rebuilt with modern synths.", dec: { 2010: 200, 2020: 100 } },
      "soul-and-randb": { name: "Soul & R&B", songs: 10, plays: 60, bpm: 98, first: 2012, djs: 1, x: 0.17, covers: [], next: ["nu-disco"], dec: { 2010: 60 } } },
    genre: { "nu-disco": { fav: [row("lib0000001", "Alpha & Beta", "Fav One", 30), row("lib0000002", "Gamma", "Fav Two", 20)], newHere: [row("lib0000003", "Delta", "New One", 1)],
      // a first DJ known only by a name nobody here has now: a plain circle, not a face
      deep: [row("lib0000004", "Echo", "Deep One", 2, { dj: "Long Gone DJ", djid: null })],
      years: { 2010: 3, 2011: 5 }, who: [{ dj: "dj1", djid: "dj1", key: "dj1", plays: 40 }] } },
    djs: { dj1: { name: "dj1", djid: "dj1", plays: 120, firsts: 30, since: now - 900 * DAY, g: ["Nu-Disco"] } },
    dj: { dj1: { name: "dj1", djid: "dj1", plays: 120, firsts: 30, songs: 80, since: now - 900 * DAY, when: "Friday nights", taste: [{ g: "Nu-Disco", slug: "nu-disco", pct: 70 }],
      most: [row("lib0000001", "Alpha & Beta", "Fav One", 30, { by: 12 })], firstHere: [], similar: [], sets: [{ at: now - DAY, n: 9 }] } },
    artistIndex: { alpha: ["Alpha", 30] },
    artist: { alpha: { name: "Alpha", plays: 30, songs: 1, first: now - 400 * DAY, firstDj: "dj1", firstDjid: "dj1", rows: [row("lib0000001", "Alpha & Beta", "Fav One", 30)], djs: [] } },
    years: { 2026: { songs: 100, plays: 50, played: 20, genre: "Nu-Disco" } },
    year: { 2026: { top: [row("lib0000002", "Gamma", "Fav Two", 20)], more: [{ type: 1, cid: "lib0000009", a: "Zed", t: "Unplayed Find", plays: 0 }] } }
  };
};
