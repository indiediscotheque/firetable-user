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

// real YouTube videos, so covers load (the titles are made up)
export const VIDS = ["kJQP7kiw5Fk", "9bZkp7q19f0", "JGwWNGJdvx8", "fJ9rUzIMcZQ", "OPf0YbXqDm0", "hTWKbfoikeg", "YQHsXMglC9A", "RgKAFK5djSk", "CevxZvSJLk8", "60ItHLz5WEA"];
export const art = (cid) => "https://i.ytimg.com/vi/" + cid + "/mqdefault.jpg";


/**
 * The room as people find it on a busy evening, for screens.mjs and reach.mjs:
 * smoke.mjs's room plus people on the decks and in the list, playlists, Recent,
 * Fresh, chat, cards, and Discover with real covers. `people` maps a role
 * (member, dj, mod) to { name, uid, mod? }: real accounts in the auth emulator.
 * Returns the data to write at the root, the decks' states (written over the
 * root's as a test goes) and the room's song.
 */
export function livedIn(now, people) {
  const song = youtubeSong(now);
  const base = room(now, song);
  const users = Object.assign({}, base.users, {
    bot: { username: "hostbot", hostbot: true, status: true },
    scytheria: { username: "scytheria", status: true }, matt: { username: "matt", status: true },
    wl1: { username: "wl1", status: true }, wl2: { username: "wl2", status: true }
  });
  const nameClaim = { dj1: "dj1", dj2: "dj2", bot: "hostbot", scytheria: "scytheria", matt: "matt" };
  for (const p of Object.values(people)) {
    users[p.uid] = Object.assign({ username: p.name, status: true }, p.mod ? { mod: true } : {}, p.supermod ? { supermod: true } : {});
    nameClaim[p.name] = p.uid;
  }
  const tracks = ["Glider - Night Drive", "Röyksopp - Me & Youphoria", "Romain Muller - Dernière", "Supertaste - Closer to the Ground",
    "Poolside - Harvest Moon", "Breakbot - Baby I'm Yours (Remix)", "Kraak & Smaak - Squeeze Me", "Satin Jackets - You Make Me Feel Good"];
  const queue = () => Object.fromEntries(tracks.map((name, i) => ["q" + i, Object.assign({ type: 1, cid: VIDS[i % VIDS.length], name },
    i === 5 ? { flagged: { date: now - DAY, code: 1 } } : {})]));
  const playlists = { p1: { name: "Nu-disco keepers", list: { a: { type: 1, cid: VIDS[8], name: "Kartell - Riviera" }, b: { type: 1, cid: VIDS[9], name: "Moods - Wildflower" } } }, p2: { name: "Theme: Italo" } };
  // Recent groups plays by the hour: the history starts at 8 pm (yesterday's, before 9 pm)
  // so the groups are the same whenever the pictures are taken
  const evening = new Date(now);
  evening.setHours(20, 0, 0, 0);
  if (evening.getTime() > now - 3600000) evening.setDate(evening.getDate() - 1);
  const history = Object.fromEntries(tracks.slice(0, 6).map((name, i) => {
    const [artist, title] = name.split(" - ");
    return ["h" + i, { type: 1, cid: VIDS[i], artist, title, dj: i % 2 ? "dj2" : "dj1", djid: i % 2 ? "dj2" : "dj1", when: evening.getTime() + (6 - i) * 6 * 60000, img: art(VIDS[i]) }];
  }));
  const fresh = Object.fromEntries(tracks.slice(2, 6).map((name, i) => {
    const [artist, title] = name.split(" - ");
    return ["f" + i, { artist, title, dj: "dj1", djid: "dj1", type: 1, cid: VIDS[i + 2], when: evening.getTime() - i * 3600000, url: "https://www.youtube.com/watch?v=" + VIDS[i + 2], img: art(VIDS[i + 2]) }];
  }));
  const chatLines = [["dj1", "dj1", "evening all"], ["scytheria", "scytheria", "this one is a banger"], ["bot", "hostbot", "dj1 started playing Smoke Song by Smoke Artist"],
    ["matt", "matt", "🔥🔥"], ["dj2", "dj2", "next up something italo"]];
  const chatData = {}, chatFeed = {};
  chatLines.forEach(([id, name, txt], i) => {
    chatData["c" + i] = { id, name, txt, time: now - (chatLines.length - i) * 60000, feedID: "f" + i };
    chatFeed["f" + i] = { chatID: "c" + i };
  });
  const cards = {};
  Object.values(people).forEach((p, i) => [0, 1, 2].forEach((n) => {
    cards["card" + i + n] = { owner: p.uid, cardnum: i * 3 + n + 1, djname: "dj1", djid: "dj1", title: tracks[n].split(" - ")[1], artist: tracks[n].split(" - ")[0], image: art(VIDS[n]), date: now - n * DAY, set: "set1" };
  }));

  // smoke.mjs's Discover songs have made-up ids: give them real ones here so their covers load
  function withArt(data) {
    const ids = {};
    const real = (fake) => (ids[fake] = ids[fake] || VIDS[Object.keys(ids).length % VIDS.length]);
    return JSON.parse(JSON.stringify(data).replace(/"(1_)?((?:newrel|chart|night|long|hot|lib)\d+)"/g, (m, pre, fake) => '"' + (pre || "") + real(fake) + '"'));
  }

  // the room's song, started just now (a run takes longer than the five-minute song)
  const playing = (over) => {
    const at = Date.now();
    return { songToPlay: Object.assign({}, song, { started: at, postedDate: at }, over), songBpm: { started: at, bpm: 118, src: "deezer" } };
  };
  const decks = {
    // as most visits find it: two DJs, nobody waiting
    normal: () => Object.assign({ table: base.table, waitlist: null, playdex: 0 }, playing()),
    // the DJ role's own song on: they're on deck and playing
    mine: (p) => Object.assign({ table: [{ name: p.name, id: p.uid, plays: 1 }, { name: "dj1", id: "dj1", plays: 2 }, { name: "dj2", id: "dj2", plays: 0 }],
      waitlist: null, playdex: 0 }, playing({ djid: p.uid, djname: p.name })),
    empty: () => ({ table: null, waitlist: null, songToPlay: null, playdex: 0 }),
    // four DJs and two waiting (the song stays as it is)
    full: () => ({ table: [{ name: "dj1", id: "dj1", plays: 2 }, { name: "dj2", id: "dj2", plays: 1 }, { name: "scytheria", id: "scytheria", plays: 1 }, { name: "matt", id: "matt", plays: 0 }],
      waitlist: [{ name: "wl1", id: "wl1", plays: 0 }, { name: "wl2", id: "wl2", plays: 0 }], playdex: 0 })
  };


  const data = Object.assign({}, base, {
    users, nameClaim, cards, chatData, chatFeed, songHistory: history, newMusic: fresh,
    queues: Object.fromEntries(Object.values(people).map((p) => [p.uid, queue()])),
    playlists: Object.fromEntries(Object.values(people).map((p) => [p.uid, playlists])),
    tagUpdate: { cid: song.cid, adamData: { track_name: song.title, artist: song.artist, playcount: 67 } },
    // caps: what the bot can do (its Spotify keys work: the import offers Spotify)
    discover: withArt(Object.assign(discover(now), { new: thisWeek(discover(now).new), lib: library(now), caps: { spotify: true } }))
  });
    /** A full week of new releases from the last few days (Home leads with them from six), before the seed's own. */
  function thisWeek(feed) {
    const day = new Date(now - 3 * DAY);
    const friday = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
    const week = [["Kartell", "Riviera", 4], ["Moods", "Wildflower", 2], ["Glider", "Night Drive", 1], ["Satin Jackets", "You Make Me Feel Good", 0],
      ["Poolside", "Harvest Moon", 3], ["Breakbot", "Baby I'm Yours", 0], ["Kraak & Smaak", "Squeeze Me", 1]].map(([a, t, plays], i) =>
      Object.assign({ cid: VIDS[(i + 3) % VIDS.length], a, t, dur: 180 + i * 17, rel: friday, relSrc: "yt", plays, g: "Nu-Disco" },
        plays ? { first: now - (i + 1) * 3600000, dj: i % 2 ? "dj2" : "dj1", djid: i % 2 ? "dj2" : "dj1" } : {}));
    return Object.assign({}, feed, { tracks: week.concat(feed.tracks) });
  }
  return { data, decks, song };
}
