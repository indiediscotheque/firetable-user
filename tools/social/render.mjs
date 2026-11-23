// Pictures and videos for the social posts, in the site's colours and type.
//
//   story  1080 x 1920 (9:16): Reels, Shorts, TikTok, Stories
//   feed   1080 x 1350 (4:5):  feed posts, carousels, Bluesky, X, Pinterest
//
// Every frame has the same head (the room's mark, the subject under it) and
// foot (the address on its own), with what matters inside the platforms' safe
// zone (SAFE). A song scene is the song's cover with a record sliding out of
// its sleeve, its name and artist, on a blurred, darkened copy of the cover.
// As a video the record turns and the video loops seamlessly. Videos are
// silent: the song is added in each app from its own licensed sound picker.
// Lists (the charts, New Music Friday, Rising, Wrapped) are slides, and as a
// video a countdown.
//
// Uses sharp (a dev dependency) for the pictures and ffmpeg for the videos.
// Never deployed (tools/).

import sharp from "sharp";
import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FONT = ROOT + "tools/fonts/Inter-VariableFont_opsz,wght.full.woff2";
// the site's palette (css/looks.css :root)
export const BG = "#181818", GOLD = "#cc9933", TEXT = "#ffffff", SOFT = "#d0d0d0", DIM = "#9a9a9a";
export const STORY = { w: 1080, h: 1920 };
export const FEED = { w: 1080, h: 1350 };
const FPS = 30;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- colour

const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

/** A colour light and lively enough to draw with on the dark background. */
export function usable(color) {
  const c = rgb(color);
  if (!c) return GOLD;
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let l = (max + min) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.2 || d < 0.08) return GOLD; // a grey: the room's gold instead
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  // bright and saturated enough to read on #181818
  l = Math.min(0.72, Math.max(0.6, l));
  s = Math.max(0.6, s);
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** The cover's most colourful colour, for the waveform and the bar. */
export async function accentOf(cover, fallback) {
  if (fallback && usable(fallback) !== GOLD) return usable(fallback);
  try {
    const { dominant } = await sharp(cover).stats();
    return usable(hex(dominant.r, dominant.g, dominant.b));
  } catch { return GOLD; }
}

// ---------------------------------------------------------------- words

/** Words as a picture: pango markup, wrapped to `width`, in the site's font; shrinks to fit maxHeight. */
export async function words(text, { size, weight = 400, color = TEXT, width = 960, spacing = 0, maxHeight = 0, align = "left", min = 28 }) {
  for (let s = size; ; s -= 4) {
    const { data, info } = await sharp({ text: {
      text: `<span foreground="${color}" font_weight="${weight}"${spacing ? ` letter_spacing="${Math.round(spacing * 1024)}"` : ""}>${esc(text)}</span>`,
      font: "Inter " + s, fontfile: FONT, width, wrap: "word-char", rgba: true, dpi: 72, align, spacing: Math.round(s * 0.1)
    } }).png().toBuffer({ resolveWithObject: true });
    if (!maxHeight || info.height <= maxHeight || s - 4 < min) {
      if (maxHeight && info.height > maxHeight) {
        const top = await sharp(data).extract({ left: 0, top: 0, width: info.width, height: maxHeight }).png().toBuffer();
        return { input: top, width: info.width, height: maxHeight };
      }
      return { input: data, width: info.width, height: info.height };
    }
  }
}

/** Text cut to about one line at this size (Inter averages ~0.55 em a character; bold a little more). */
export function oneLine(text, size, width, weight = 400) {
  const max = Math.floor(width / (size * (weight >= 700 ? 0.6 : 0.54)));
  const chars = [...String(text)];
  return chars.length <= max ? String(text) : chars.slice(0, max - 1).join("").replace(/[\s,·-]+$/, "") + "…";
}

// ---------------------------------------------------------------- pieces

/**
 * A square cover from an image's bytes. YouTube thumbnails are 16:9 (or 4:3
 * with black bands): the middle square is the picture.
 */
export async function squareCover(bytes, size = 1000) {
  try {
    const m = await sharp(bytes).metadata();
    let src = bytes;
    if (m.width !== m.height) {
      // a video frame: drop the black bands around the picture, then take its middle square
      try {
        const t = await sharp(bytes).trim({ background: "#000000", threshold: 40 }).toBuffer({ resolveWithObject: true });
        if (t.info.width >= m.width * 0.4 && t.info.height >= m.height * 0.4) src = t.data;
      } catch { /* nothing to trim */ }
    }
    return await sharp(src).resize(size, size, { fit: "cover", position: "centre" }).jpeg({ quality: 92 }).toBuffer();
  } catch { return null; }
}

/** The room's mark on a plain tile, when a song has no cover. */
export async function plainCover(size = 1000) {
  const mark = await sharp(ROOT + "img/idlogo2.png").resize({ width: Math.round(size * 0.6) }).png().toBuffer();
  const mm = await sharp(mark).metadata();
  return sharp({ create: { width: size, height: size, channels: 3, background: "#282828" } })
    .composite([{ input: mark, left: Math.round((size - mm.width) / 2), top: Math.round((size - mm.height) / 2) }])
    .jpeg({ quality: 92 }).toBuffer();
}

const roundMask = (w, h, r) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}"/></svg>`);

async function rounded(bytes, size, radius) {
  return sharp(bytes).resize(size, size, { fit: "cover" }).composite([{ input: roundMask(size, size, radius), blend: "dest-in" }]).png().toBuffer();
}

/** The cover, blurred and darkened to fill the frame, with the colour glowing from the top. */
async function backdrop(cover, { w, h }, accent) {
  const blur = await sharp(cover).resize(w, h, { fit: "cover" }).blur(60).modulate({ brightness: 0.5, saturation: 1.25 }).toBuffer();
  const shade = Buffer.from(`<svg width="${w}" height="${h}"><defs>
    <linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG}" stop-opacity="0.35"/><stop offset="0.45" stop-color="${BG}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${BG}" stop-opacity="0.92"/></linearGradient>
    <radialGradient id="g" cx="0.5" cy="0" r="0.8"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  </defs><rect width="${w}" height="${h}" fill="url(#d)"/><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);
  return sharp(blur).composite([{ input: shade }]).png().toBuffer();
}

/** A vinyl record with the cover as its label (it spins in the video). */
async function vinyl(cover, d) {
  const r = d / 2;
  const grooves = [];
  for (let gr = r * 0.4; gr < r * 0.97; gr += 5) grooves.push(`<circle cx="${r}" cy="${r}" r="${gr.toFixed(1)}" fill="none" stroke="#fff" stroke-opacity="${(0.025 + 0.03 * ((gr / 5) % 3 === 0)).toFixed(3)}" stroke-width="1"/>`);
  const disc = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${r}" cy="${r}" r="${r}" fill="#0b0b0b"/>${grooves.join("")}
    <circle cx="${r}" cy="${r}" r="${r * 0.985}" fill="none" stroke="#2a2a2a" stroke-width="3"/></svg>`);
  const label = Math.round(d * 0.36);
  const lab = await sharp(cover).resize(label, label).composite([{ input: Buffer.from(`<svg width="${label}" height="${label}"><circle cx="${label / 2}" cy="${label / 2}" r="${label / 2}"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  const hole = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${r}" cy="${r}" r="${d * 0.012}" fill="${BG}"/></svg>`);
  return sharp(disc).composite([{ input: lab, left: Math.round(r - label / 2), top: Math.round(r - label / 2) }, { input: hole }]).png().toBuffer();
}

/** Light on the record, which stays still while the record turns under it. */
function shine(d) {
  const r = d / 2;
  return Buffer.from(`<svg width="${d}" height="${d}"><defs>
    <linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0.2" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.42" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.58" stop-color="#fff" stop-opacity="0.07"/><stop offset="0.8" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="m"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/><circle cx="${r}" cy="${r}" r="${d * 0.18}" fill="#000"/></mask>
  </defs><rect width="${d}" height="${d}" fill="url(#s)" mask="url(#m)"/></svg>`);
}

function shadow(size, blur = 40) {
  const pad = blur * 2;
  return sharp(Buffer.from(`<svg width="${size + pad * 2}" height="${size + pad * 2}"><rect x="${pad}" y="${pad + 18}" width="${size}" height="${size}" rx="24" fill="#000" fill-opacity="0.6"/></svg>`))
    .blur(blur).png().toBuffer().then((input) => ({ input, pad }));
}

// ---------------------------------------------------------------- the frame

// Where the platforms' own buttons and captions sit over a 9:16 frame. The
// strictest of them together: Reels' top 14% and bottom 35% (Meta), Shorts'
// 288 px top and 192 px right (Google), TikTok's ~150 px of buttons on the
// right. Words stay inside this box (x 150-930 centred on the frame, y
// 290-1250), which is also inside Instagram's 3:4 crop of a Reel on the grid.
export const SAFE = { top: 290, bottom: 1250, side: 150 };

const LOGO = ROOT + "img/idlogo2.png";

/** The room's mark with the post's subject under it: the head of every frame. */
async function header(kicker, F, story, accent) {
  const lh = story ? 56 : 50;
  const logo = await sharp(LOGO).resize({ height: lh }).png().toBuffer();
  const lw = (await sharp(logo).metadata()).width;
  const k = await pill(kicker, { size: story ? 36 : 32, color: accent });
  const top = story ? SAFE.top : 54;
  const gap = story ? 16 : 16;
  return {
    layers: [{ input: logo, left: Math.round((F.w - lw) / 2), top }, { input: k.input, left: Math.round((F.w - k.width) / 2), top: top + lh + gap }],
    bottom: top + lh + gap + k.height
  };
}

/** The address on its own along the foot of the frame. */
async function footer(site, F, story) {
  const a = await words(site, { size: story ? 36 : 32, weight: 600, color: SOFT, spacing: 0.5, width: F.w - 120, align: "centre" });
  const top = story ? SAFE.bottom - a.height : F.h - 60 - a.height;
  return { layer: { input: a.input, left: Math.round((F.w - a.width) / 2), top }, top };
}

function pill(text, { size = 30, color = GOLD } = {}) {
  return words(String(text).toUpperCase(), { size, weight: 800, color, spacing: 3, width: 960, maxHeight: Math.round(size * 1.4), min: 24 });
}

const kickerColour = (accent) => accent === GOLD ? GOLD : usable(accent);

// ---------------------------------------------------------------- a song

/**
 * Everything a song frame is made of, laid out for `format`.
 * @param {{cover: Buffer, accent?: string, kicker: string, title: string, artist: string, meta?: string[], site: string}} s
 * @param {"story"|"feed"} format
 */
export async function songScene(s, format = "story") {
  const F = format === "story" ? STORY : FEED;
  const accent = s.accent || await accentOf(s.cover);
  const story = format === "story";
  const layers = [];
  const head = await header(s.kicker, F, story, kickerColour(accent));
  layers.push(...head.layers);
  const foot = await footer(s.site, F, story);
  // the words first, so the cover and the words can sit together in the middle of the space
  const W = story ? F.w - 2 * SAFE.side : F.w - 140;
  const C = story ? 540 : 600, D = Math.round(C * 0.94), slide = Math.round(C * 0.36);
  const t = await words(s.title, { size: story ? 66 : 60, weight: 800, width: W, maxHeight: story ? 150 : 136, align: "centre", min: 44 });
  const a = await words(s.artist, { size: story ? 48 : 42, weight: 600, color: SOFT, width: W, maxHeight: story ? 60 : 54, align: "centre", min: 34 });
  const meta = (s.meta || []).filter(Boolean);
  const m = meta.length ? await words(meta.join("  ·  "), { size: story ? 34 : 32, weight: 500, color: SOFT, width: W, maxHeight: story ? 44 : 42, align: "centre", min: 28 }) : null;
  const gap = story ? 30 : 34;
  const space = foot.top - 18 - (head.bottom + (story ? 30 : 28));
  const parts = [t, a, m].filter(Boolean);
  // drop the facts, then the artist, if a long title leaves no room
  while (parts.length > 1 && C + gap + parts.reduce((h, x) => h + x.height + 12, 0) > space) parts.pop();
  const block = C + gap + parts.reduce((h, x) => h + x.height + 12, 0) - 12;
  const cy = head.bottom + (story ? 30 : 28) + Math.max(0, Math.round((space - block) / 2));
  const cx = Math.round((F.w - (C + slide)) / 2);
  const dx = cx + C + slide - D, dy = cy + Math.round((C - D) / 2);
  const coverPng = await rounded(s.cover, C, 22);
  const disc = await vinyl(s.cover, D);
  const sh = await shadow(C);
  layers.unshift({ input: sh.input, left: cx - sh.pad, top: cy - sh.pad });
  let y = cy + C + gap;
  for (const x of parts) { layers.push({ input: x.input, left: Math.round((F.w - x.width) / 2), top: y }); y += x.height + 12; }
  layers.push(foot.layer);
  const base = await sharp(await backdrop(s.cover, F, accent)).composite(layers).png().toBuffer();
  return { F, accent, base, disc, shine: shine(D), cover: coverPng, pos: { disc: [dx, dy], cover: [cx, cy], D } };
}

/** The scene as one picture: a JPEG (the record still, a little turned). */
export async function sceneStill(scene) {
  const D = scene.pos.D;
  const big = await sharp(scene.disc).rotate(18, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  const turned = await sharp(big.data).extract({ left: Math.floor((big.info.width - D) / 2), top: Math.floor((big.info.height - D) / 2), width: D, height: D }).png().toBuffer();
  return sharp(scene.base).composite([
    { input: turned, left: scene.pos.disc[0], top: scene.pos.disc[1] },
    { input: scene.shine, left: scene.pos.disc[0], top: scene.pos.disc[1] },
    { input: scene.cover, left: scene.pos.cover[0], top: scene.pos.cover[1] }
  ]).flatten({ background: BG }).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

// ---------------------------------------------------------------- lists

const finish = (bg, F, accent, layers) => backdrop(bg, F, accent).then((b) => sharp(b).composite(layers).flatten({ background: BG })
  .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer());

/**
 * A list frame: the head, a title, then up to five rows of songs with their covers.
 * @param {{kicker: string, title: string, sub?: string, rows: Array<{rank?: number|string, cover: Buffer, title: string, artist: string, note?: string}>, site: string, accent?: string}} l
 */
export async function listFrame(l, format = "feed") {
  const F = format === "story" ? STORY : FEED;
  const story = format === "story";
  const accent = l.accent || GOLD;
  const layers = [];
  const head = await header(l.kicker, F, story, accent);
  layers.push(...head.layers);
  let y = head.bottom + 22;
  const t = await words(l.title, { size: story ? 64 : 56, weight: 800, width: F.w - 2 * SAFE.side, maxHeight: story ? 150 : 130, align: "centre", min: 40 });
  layers.push({ input: t.input, left: Math.round((F.w - t.width) / 2), top: y });
  y += t.height + 6;
  if (l.sub) {
    const s = await words(l.sub, { size: story ? 32 : 28, weight: 500, color: SOFT, width: F.w - 2 * SAFE.side, maxHeight: 44, align: "centre" });
    layers.push({ input: s.input, left: Math.round((F.w - s.width) / 2), top: y });
    y += s.height;
  }
  y += story ? 36 : 28;
  const foot = await footer(l.site, F, story);
  layers.push(foot.layer);
  const n = l.rows.length;
  const rowH = Math.min(story ? 180 : 168, Math.floor((foot.top - 30 - y) / Math.max(n, 1)));
  const art = Math.round(rowH * 0.8);
  const x0 = SAFE.side;
  for (const r of l.rows) {
    let x = x0;
    if (r.rank != null) {
      const rank = await words(String(r.rank), { size: Math.round(rowH * 0.4), weight: 800, color: accent, width: 96, align: "right" });
      layers.push({ input: rank.input, left: x + 96 - rank.width, top: y + Math.round((rowH - rank.height) / 2) });
      x += 116;
    }
    layers.push({ input: await rounded(r.cover, art, 12), left: x, top: y + Math.round((rowH - art) / 2) });
    x += art + 26;
    const w = F.w - x - SAFE.side;
    const ts = Math.round(rowH * 0.24), as = Math.round(rowH * 0.19);
    const tt = await words(oneLine(r.title, ts, w, 700), { size: ts, weight: 700, width: w });
    const aa = await words(oneLine(r.artist + (r.note ? "  ·  " + r.note : ""), as, w, 500), { size: as, weight: 500, color: SOFT, width: w });
    const top = y + Math.round((rowH - tt.height - aa.height - 6) / 2);
    layers.push({ input: tt.input, left: x, top });
    layers.push({ input: aa.input, left: x, top: top + tt.height + 6 });
    y += rowH;
  }
  return finish(l.rows[0] ? l.rows[0].cover : await plainCover(), F, accent, layers);
}

/**
 * A title frame: the head, up to four covers (or one, with a big number over
 * it), a title and a line or two. A list's first slide, Wrapped, themes and
 * "the room is busy".
 * @param {{kicker: string, title: string, sub?: string, big?: string, bigLabel?: string, covers: Buffer[], site: string, accent?: string, lines?: string[]}} c
 */
export async function titleFrame(c, format = "feed") {
  const F = format === "story" ? STORY : FEED;
  const story = format === "story";
  const accent = c.accent || GOLD;
  const covers = (c.covers || []).filter(Boolean);
  const layers = [];
  const head = await header(c.kicker, F, story, accent);
  layers.push(...head.layers);
  const foot = await footer(c.site, F, story);
  layers.push(foot.layer);
  const M = story ? 520 : 600;
  const W = story ? F.w - 2 * SAFE.side : F.w - 140;
  const t = await words(c.title, { size: story ? 66 : 60, weight: 800, width: W, maxHeight: story ? 150 : 136, align: "centre", min: 44 });
  const lines = [];
  for (const [i, line] of [c.sub, ...(c.lines || [])].filter(Boolean).entries()) {
    lines.push(await words(line, { size: i ? (story ? 32 : 30) : (story ? 40 : 36), weight: 500, color: SOFT, width: W, maxHeight: story ? 96 : 90, align: "centre", min: 28 }));
  }
  const top0 = head.bottom + (story ? 30 : 28);
  const space = foot.top - 18 - top0;
  const gap = story ? 30 : 34;
  const parts = [t, ...lines];
  const mosaicH = covers.length ? M + gap : 0;
  while (parts.length > 1 && mosaicH + parts.reduce((h, x) => h + x.height + 10, 0) > space) parts.pop();
  const block = mosaicH + parts.reduce((h, x) => h + x.height + 10, 0) - 10;
  let y = top0 + Math.max(0, Math.round((space - block) / 2));
  if (covers.length) {
    const four = covers.length >= 4;
    const tile = four ? (M - 12) / 2 : M;
    const spots = four ? [[0, 0], [tile + 12, 0], [0, tile + 12], [tile + 12, tile + 12]] : [[0, 0]];
    const mx = Math.round((F.w - M) / 2);
    const sh = await shadow(M);
    layers.unshift({ input: sh.input, left: mx - sh.pad, top: y - sh.pad });
    for (let i = 0; i < spots.length; i++) layers.push({ input: await rounded(covers[i], Math.round(tile), 18), left: mx + Math.round(spots[i][0]), top: y + Math.round(spots[i][1]) });
    if (c.big) {
      // a number over the covers, on a dark band
      const bigW = await words(c.big, { size: story ? 190 : 170, weight: 900, color: TEXT, width: M, align: "centre" });
      const lab = c.bigLabel ? await words(c.bigLabel, { size: 38, weight: 700, color: TEXT, width: M - 40, align: "centre" }) : null;
      const bandH = bigW.height + (lab ? lab.height + 10 : 0) + 50;
      const by = y + Math.round((M - bandH) / 2);
      layers.push({ input: Buffer.from(`<svg width="${M}" height="${bandH}"><rect width="${M}" height="${bandH}" rx="18" fill="${BG}" fill-opacity="0.78"/></svg>`), left: mx, top: by });
      layers.push({ input: bigW.input, left: Math.round((F.w - bigW.width) / 2), top: by + 20 });
      if (lab) layers.push({ input: lab.input, left: Math.round((F.w - lab.width) / 2), top: by + 20 + bigW.height + 10 });
    }
    y += M + gap;
  }
  for (const x of parts) { layers.push({ input: x.input, left: Math.round((F.w - x.width) / 2), top: y }); y += x.height + 10; }
  return finish(covers[0] || await plainCover(), F, accent, layers);
}

// ---------------------------------------------------------------- video

/** Run ffmpeg; rejects with the end of its log. */
export function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error("ffmpeg failed (" + code + "): " + err.trim())));
  });
}

export async function haveFfmpeg() {
  try { await ffmpeg(["-version"]); return true; } catch { return false; }
}

// what every platform takes: H.264 high, yuv420p, 30 fps, a keyframe every second, moov first,
// and a silent AAC track: the song is added in the app, from its own licensed sound picker
const ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS),
  "-c:a", "aac", "-b:a", "64k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];

/**
 * A song scene as a silent video that loops seamlessly: the record makes
 * whole turns, so the last frame leads straight into the first.
 * @param {object} scene from songScene(…, "story")
 * @param {{duration: number, out: string, tmp: string}} o
 */
export async function songVideo(scene, o) {
  mkdirSync(o.tmp, { recursive: true });
  const f = (n, b) => { const p = join(o.tmp, n); writeFileSync(p, b); return p; };
  const base = f("base.png", scene.base), disc = f("disc.png", scene.disc), sh = f("shine.png", scene.shine), cover = f("cover.png", scene.cover);
  const D = o.duration, [dx, dy] = scene.pos.disc, [cx, cy] = scene.pos.cover;
  const turn = D / Math.max(1, Math.round(D / 3.6)); // whole turns, about one every 3.6 s
  const loop = (p) => ["-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", p];
  const g = [
    `[1:v]format=rgba,rotate=a='t*2*PI/${turn.toFixed(4)}':c=none:ow=iw:oh=ih[disc]`,
    `[0:v][disc]overlay=${dx}:${dy}[a]`, `[a][2:v]overlay=${dx}:${dy}[b]`, `[b][3:v]overlay=${cx}:${cy},format=yuv420p[v]`
  ];
  await ffmpeg([...loop(base), ...loop(disc), ...loop(sh), ...loop(cover), "-f", "lavfi", "-t", String(D), "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex", g.join(";"), "-map", "[v]", "-map", "4:a", "-t", String(D), ...ENCODE, o.out]);
  return o.out;
}

/**
 * A run of still frames as a silent video, each fading into the next (a
 * countdown; the song is added in the app).
 * @param {Array<{jpg: Buffer, dur: number}>} frames
 * @param {{out: string, tmp: string}} o
 */
export async function slideshowVideo(frames, o) {
  mkdirSync(o.tmp, { recursive: true });
  const X = 0.3;
  const inputs = [];
  frames.forEach((fr, i) => {
    const p = join(o.tmp, "slide" + i + ".jpg");
    writeFileSync(p, fr.jpg);
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(fr.dur + X), "-i", p);
  });
  const total = frames.reduce((s, fr) => s + fr.dur, 0) + X;
  const ai = frames.length;
  inputs.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo");
  const g = frames.map((_, i) => `[${i}:v]scale=${STORY.w}:${STORY.h},setsar=1,format=yuv420p[s${i}]`);
  let prev = "s0", at = 0;
  for (let i = 1; i < frames.length; i++) {
    at += frames[i - 1].dur;
    g.push(`[${prev}][s${i}]xfade=transition=fade:duration=${X}:offset=${at.toFixed(2)}[x${i}]`);
    prev = "x" + i;
  }
  g.push(`[${prev}]format=yuv420p[v]`);
  await ffmpeg([...inputs, "-filter_complex", g.join(";"), "-map", "[v]", "-map", ai + ":a", "-t", total.toFixed(2), ...ENCODE, o.out]);
  return o.out;
}

/** A video's length in seconds and size in bytes, to check what was made. */
export async function probe(file) {
  const out = await new Promise((resolve, reject) => {
    const p = spawn(process.env.FFPROBE || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
    let s = "";
    p.stdout.on("data", (d) => { s += d; });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve(s) : reject(new Error("ffprobe failed on " + file)));
  });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((x) => x.codec_type === "video") || {};
  return { duration: Number(j.format && j.format.duration), width: v.width, height: v.height, audio: (j.streams || []).some((x) => x.codec_type === "audio"), bytes: existsSync(file) ? statSync(file).size : 0 };
}

export { dirname };
