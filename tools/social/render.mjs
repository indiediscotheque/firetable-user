// Pictures and videos for the social posts, in the site's colours and type.
//
//   story  1080 x 1920 (9:16): Reels, Shorts, TikTok, Stories
//   feed   1080 x 1350 (4:5):  feed posts, carousels, Bluesky, X, Pinterest
//
// A song scene is the song's cover with a record sliding out of its sleeve, its
// name, artist and a line of facts, on a blurred, darkened copy of the cover.
// As a video the record spins, the song's 30-second preview plays, its
// waveform moves under the words and a bar fills as it plays. Lists (the
// charts, rising, Wrapped) are slides, and as a video a countdown with a
// second or two of each song.
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

/** The room's logo and address along the bottom (or the top) of a frame. */
async function brand(site, { width = 960, size = 34, logoH = 54 } = {}) {
  const logo = await sharp(ROOT + "img/idlogo2.png").resize({ height: logoH }).png().toBuffer();
  const lw = (await sharp(logo).metadata()).width;
  const addr = await words(site, { size, weight: 600, color: TEXT, width: width - lw - 24 });
  return { logo, lw, addr, height: Math.max(logoH, addr.height) };
}

function pill(text, { size = 30, color = GOLD } = {}) {
  return words(text.toUpperCase(), { size, weight: 800, color, spacing: 3, width: 960 });
}

// ---------------------------------------------------------------- a song

/**
 * Everything a song frame is made of, laid out for `format`.
 * @param {{cover: Buffer, accent?: string, kicker: string, title: string, artist: string, meta?: string[], cta?: string, site: string}} s
 * @param {"story"|"feed"} format
 */
export async function songScene(s, format = "story") {
  const F = format === "story" ? STORY : FEED;
  const accent = s.accent || await accentOf(s.cover);
  const story = format === "story";
  // the cover and the record beside it
  const C = story ? 720 : 680, D = Math.round(C * 0.94), slide = Math.round(C * 0.36);
  const cx = Math.round((F.w - (C + slide)) / 2), cy = story ? 330 : 140;
  const dx = cx + C + slide - D, dy = cy + Math.round((C - D) / 2);
  const coverPng = await rounded(s.cover, C, 22);
  const disc = await vinyl(s.cover, D);
  const sh = await shadow(C);

  const layers = [{ input: sh.input, left: cx - sh.pad, top: cy - sh.pad }];
  // the kicker over the cover, the room's mark above it
  const top = story ? 170 : 62;
  const k = await pill(s.kicker, { color: accent === GOLD ? GOLD : "#ffffff" });
  layers.push({ input: k.input, left: Math.round((F.w - k.width) / 2), top });
  if (story) {
    const logo = await sharp(ROOT + "img/idlogo2.png").resize({ height: 64 }).png().toBuffer();
    const lw = (await sharp(logo).metadata()).width;
    layers.push({ input: logo, left: Math.round((F.w - lw) / 2), top: 80 });
  }
  // the words under the cover
  let y = cy + C + (story ? 60 : 40);
  const W = F.w - 120;
  const t = await words(s.title, { size: story ? 74 : 62, weight: 800, width: W, maxHeight: story ? 190 : 150, align: "centre", min: 40 });
  layers.push({ input: t.input, left: Math.round((F.w - t.width) / 2), top: y });
  y += t.height + 14;
  const a = await words(s.artist, { size: story ? 46 : 40, weight: 600, color: SOFT, width: W, maxHeight: story ? 120 : 56, align: "centre", min: 30 });
  layers.push({ input: a.input, left: Math.round((F.w - a.width) / 2), top: y });
  y += a.height + 18;
  if (s.meta && s.meta.length) {
    const m = await words(s.meta.filter(Boolean).join("  ·  "), { size: story ? 32 : 28, weight: 500, color: DIM, width: W, maxHeight: story ? 84 : 40, align: "centre", min: 24 });
    layers.push({ input: m.input, left: Math.round((F.w - m.width) / 2), top: y });
    y += m.height;
  }
  // the waveform and the bar (moving in the video; a still line in a picture)
  const wave = story ? { x: 90, y: Math.max(y + 40, 1330), w: 900, h: 130 } : null;
  const bar = story ? { x: 90, y: wave.y + wave.h + 22, w: 900, h: 8 } : null;
  if (bar) layers.push({ input: Buffer.from(`<svg width="${bar.w}" height="${bar.h}"><rect width="${bar.w}" height="${bar.h}" rx="${bar.h / 2}" fill="#fff" fill-opacity="0.18"/></svg>`), left: bar.x, top: bar.y });
  // the call to come and listen, and the address
  const b = await brand(s.site, { size: story ? 36 : 32, logoH: story ? 52 : 46 });
  const cta = s.cta ? await words(s.cta, { size: story ? 34 : 28, weight: 700, color: accent, width: W, align: "centre" }) : null;
  const by = story ? bar.y + 50 : F.h - 64 - b.height;
  if (cta) {
    const cy2 = story ? by : by - cta.height - 14;
    layers.push({ input: cta.input, left: Math.round((F.w - cta.width) / 2), top: cy2 });
  }
  const bx = Math.round((F.w - (b.lw + 20 + b.addr.width)) / 2), byy = story ? by + (cta ? cta.height + 18 : 0) : by;
  layers.push({ input: b.logo, left: bx, top: byy });
  layers.push({ input: b.addr.input, left: bx + b.lw + 20, top: byy + Math.round((b.height - b.addr.height) / 2) });

  const base = await sharp(await backdrop(s.cover, F, accent)).composite(layers).png().toBuffer();
  return { F, accent, base, disc, shine: shine(D), cover: coverPng, pos: { disc: [dx, dy], cover: [cx, cy], D }, wave, bar };
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

/**
 * A list frame: a title over up to ten rows of songs with their covers.
 * @param {{kicker: string, title: string, sub?: string, rows: Array<{rank?: number|string, cover: Buffer, title: string, artist: string, note?: string}>, site: string, accent?: string, cta?: string}} l
 */
export async function listFrame(l, format = "feed") {
  const F = format === "story" ? STORY : FEED;
  const story = format === "story";
  const accent = l.accent || GOLD;
  const bgCover = l.rows[0] ? l.rows[0].cover : await plainCover();
  const layers = [];
  let y = story ? 150 : 60;
  const k = await pill(l.kicker, { color: accent });
  layers.push({ input: k.input, left: 60, top: y });
  y += k.height + 14;
  const t = await words(l.title, { size: story ? 76 : 64, weight: 800, width: F.w - 120, maxHeight: story ? 180 : 150, min: 40 });
  layers.push({ input: t.input, left: 60, top: y });
  y += t.height + 8;
  if (l.sub) {
    const s = await words(l.sub, { size: story ? 34 : 30, weight: 500, color: SOFT, width: F.w - 120, maxHeight: 80 });
    layers.push({ input: s.input, left: 60, top: y });
    y += s.height;
  }
  y += story ? 40 : 28;
  const foot = 130;
  const room = F.h - y - foot - (story ? 260 : 0);
  const n = l.rows.length;
  const rowH = Math.min(story ? 190 : 170, Math.floor(room / Math.max(n, 1)));
  const art = Math.round(rowH * 0.82);
  for (const r of l.rows) {
    const rank = r.rank != null ? await words(String(r.rank), { size: Math.round(rowH * 0.42), weight: 800, color: accent, width: 110, align: "right" }) : null;
    let x = 60;
    if (rank) { layers.push({ input: rank.input, left: x + 110 - rank.width, top: y + Math.round((rowH - rank.height) / 2) }); x += 130; }
    layers.push({ input: await rounded(r.cover, art, 12), left: x, top: y + Math.round((rowH - art) / 2) });
    x += art + 26;
    const w = F.w - x - 60;
    const ts = Math.round(rowH * 0.24), as = Math.round(rowH * 0.19);
    const tt = await words(oneLine(r.title, ts, w, 700), { size: ts, weight: 700, width: w });
    const aa = await words(oneLine(r.artist + (r.note ? "  ·  " + r.note : ""), as, w, 500), { size: as, weight: 500, color: SOFT, width: w });
    const top = y + Math.round((rowH - tt.height - aa.height - 6) / 2);
    layers.push({ input: tt.input, left: x, top });
    layers.push({ input: aa.input, left: x, top: top + tt.height + 6 });
    y += rowH;
  }
  const b = await brand(l.site, { size: 32, logoH: 46 });
  const by = F.h - (story ? 330 : 70) - b.height;
  if (l.cta) {
    const c = await words(l.cta, { size: 30, weight: 700, color: accent, width: F.w - 120 });
    layers.push({ input: c.input, left: 60, top: by - c.height - 16 });
  }
  layers.push({ input: b.logo, left: 60, top: by });
  layers.push({ input: b.addr.input, left: 60 + b.lw + 20, top: by + Math.round((b.height - b.addr.height) / 2) });
  return sharp(await backdrop(bgCover, F, accent)).composite(layers).flatten({ background: BG }).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

/**
 * A title frame: a kicker, a big title, a line under it and up to four covers
 * (or one big number). For a chart's first slide, Wrapped, theme nights and
 * "the room is busy".
 * @param {{kicker: string, title: string, sub?: string, big?: string, bigLabel?: string, covers: Buffer[], site: string, accent?: string, cta?: string, lines?: string[]}} c
 */
export async function titleFrame(c, format = "feed") {
  const F = format === "story" ? STORY : FEED;
  const story = format === "story";
  const accent = c.accent || GOLD;
  const covers = (c.covers || []).filter(Boolean);
  const bg = covers[0] || await plainCover();
  const layers = [];
  let y = story ? 200 : 70;
  if (story) {
    const logo = await sharp(ROOT + "img/idlogo2.png").resize({ height: 64 }).png().toBuffer();
    const lw = (await sharp(logo).metadata()).width;
    layers.push({ input: logo, left: Math.round((F.w - lw) / 2), top: 90 });
  }
  const k = await pill(c.kicker, { color: accent });
  layers.push({ input: k.input, left: Math.round((F.w - k.width) / 2), top: y });
  y += k.height + 30;
  // the mosaic: four covers in a square, or one
  const M = story ? 760 : 620;
  if (covers.length) {
    const four = covers.length >= 4;
    const tile = four ? (M - 12) / 2 : M;
    const spots = four ? [[0, 0], [tile + 12, 0], [0, tile + 12], [tile + 12, tile + 12]] : [[0, 0]];
    const mx = Math.round((F.w - M) / 2);
    const sh = await shadow(M);
    layers.push({ input: sh.input, left: mx - sh.pad, top: y - sh.pad });
    for (let i = 0; i < spots.length; i++) layers.push({ input: await rounded(covers[i], Math.round(tile), 18), left: mx + Math.round(spots[i][0]), top: y + Math.round(spots[i][1]) });
    if (c.big) {
      // a number over the covers, on a dark band
      const bigW = await words(c.big, { size: story ? 200 : 170, weight: 900, color: TEXT, width: M, align: "centre" });
      const lab = c.bigLabel ? await words(c.bigLabel, { size: 40, weight: 700, color: TEXT, width: M - 40, align: "centre" }) : null;
      const bandH = bigW.height + (lab ? lab.height + 10 : 0) + 50;
      layers.push({ input: Buffer.from(`<svg width="${M}" height="${bandH}"><rect width="${M}" height="${bandH}" rx="18" fill="${BG}" fill-opacity="0.78"/></svg>`), left: mx, top: y + Math.round((M - bandH) / 2) });
      layers.push({ input: bigW.input, left: Math.round((F.w - bigW.width) / 2), top: y + Math.round((M - bandH) / 2) + 20 });
      if (lab) layers.push({ input: lab.input, left: Math.round((F.w - lab.width) / 2), top: y + Math.round((M - bandH) / 2) + 20 + bigW.height + 10 });
    }
    y += M + (story ? 60 : 40);
  }
  const t = await words(c.title, { size: story ? 80 : 64, weight: 800, width: F.w - 120, maxHeight: story ? 200 : 150, align: "centre", min: 40 });
  layers.push({ input: t.input, left: Math.round((F.w - t.width) / 2), top: y });
  y += t.height + 14;
  if (c.sub) {
    const s = await words(c.sub, { size: story ? 40 : 32, weight: 500, color: SOFT, width: F.w - 120, maxHeight: story ? 110 : 80, align: "centre" });
    layers.push({ input: s.input, left: Math.round((F.w - s.width) / 2), top: y });
    y += s.height + 14;
  }
  for (const line of c.lines || []) {
    const s = await words(line, { size: story ? 34 : 28, weight: 500, color: DIM, width: F.w - 120, maxHeight: 80, align: "centre" });
    if (y + s.height > F.h - (story ? 420 : 140)) break;
    layers.push({ input: s.input, left: Math.round((F.w - s.width) / 2), top: y });
    y += s.height + 8;
  }
  const b = await brand(c.site, { size: 34, logoH: 50 });
  const by = F.h - (story ? 360 : 66) - b.height;
  if (c.cta) {
    const cc = await words(c.cta, { size: story ? 36 : 30, weight: 700, color: accent, width: F.w - 120, align: "centre" });
    layers.push({ input: cc.input, left: Math.round((F.w - cc.width) / 2), top: by - cc.height - 18 });
  }
  const bx = Math.round((F.w - (b.lw + 20 + b.addr.width)) / 2);
  layers.push({ input: b.logo, left: bx, top: by });
  layers.push({ input: b.addr.input, left: bx + b.lw + 20, top: by + Math.round((b.height - b.addr.height) / 2) });
  return sharp(await backdrop(bg, F, accent)).composite(layers).flatten({ background: BG }).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
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

// what every platform takes: H.264 high, yuv420p, 30 fps, AAC 48 kHz, a keyframe every 2 s, moov first
const ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];

/**
 * A song scene as a video: the record turns, the preview plays, the waveform
 * moves and the bar fills.
 * @param {object} scene from songScene(…, "story")
 * @param {{audio?: string|null, start?: number, duration: number, out: string, tmp: string}} o
 */
export async function songVideo(scene, o) {
  mkdirSync(o.tmp, { recursive: true });
  const f = (n, b) => { const p = join(o.tmp, n); writeFileSync(p, b); return p; };
  const base = f("base.png", scene.base), disc = f("disc.png", scene.disc), sh = f("shine.png", scene.shine), cover = f("cover.png", scene.cover);
  const D = o.duration, [dx, dy] = scene.pos.disc, [cx, cy] = scene.pos.cover, wv = scene.wave, br = scene.bar;
  const accent = scene.accent.replace("#", "0x");
  const inputs = ["-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", base,
    "-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", disc,
    "-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", sh,
    "-loop", "1", "-framerate", String(FPS), "-t", String(D), "-i", cover];
  if (o.audio) inputs.push("-ss", String(o.start || 0), "-t", String(D), "-i", o.audio);
  else inputs.push("-f", "lavfi", "-t", String(D), "-i", "anullsrc=r=48000:cl=stereo");
  const fade = Math.min(1, D / 6);
  const g = [
    // a turn every 3.6 s, the light staying put
    `[1:v]format=rgba,rotate=a='t*2*PI/3.6':c=none:ow=iw:oh=ih[disc]`,
    `[0:v][disc]overlay=${dx}:${dy}[a]`, `[a][2:v]overlay=${dx}:${dy}[b]`, `[b][3:v]overlay=${cx}:${cy}[c]`
  ];
  let last = "c";
  if (o.audio && wv) {
    g.push(`[4:a]asplit=2[aw][ao]`,
      `[aw]showwaves=s=${wv.w}x${wv.h}:mode=cline:rate=${FPS}:colors=${accent}|${accent}:scale=sqrt,format=rgba,colorchannelmixer=aa=0.9[w]`,
      `[c][w]overlay=${wv.x}:${wv.y}:shortest=1[d]`);
    last = "d";
  }
  if (br) {
    // the bar slides into a clear strip the size of its track, so it never shows outside it
    g.push(`color=c=black@0.0:s=${br.w}x${br.h}:r=${FPS},format=rgba[trk]`, `color=c=${accent}:s=${br.w}x${br.h}:r=${FPS},format=rgba[fill]`,
      `[trk][fill]overlay=x='-${br.w}+${br.w}*t/${D}':y=0:format=auto[barl]`,
      `[${last}][barl]overlay=${br.x}:${br.y}:shortest=1[e]`);
    last = "e";
  }
  g.push(`[${last}]fade=t=in:st=0:d=0.35,fade=t=out:st=${(D - fade).toFixed(2)}:d=${fade.toFixed(2)},format=yuv420p[v]`);
  const audioIn = o.audio ? (wv ? "[ao]" : "[4:a]") : "[4:a]";
  g.push(`${audioIn}afade=t=in:st=0:d=0.5,afade=t=out:st=${(D - fade).toFixed(2)}:d=${fade.toFixed(2)},aresample=48000[aout]`);
  await ffmpeg([...inputs, "-filter_complex", g.join(";"), "-map", "[v]", "-map", "[aout]", "-t", String(D), ...ENCODE, o.out]);
  return o.out;
}

/**
 * A run of still frames as a video, each fading into the next, over one audio
 * track (or silence).
 * @param {Array<{jpg: Buffer, dur: number}>} frames
 * @param {{audio?: string|null, out: string, tmp: string}} o
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
  if (o.audio) inputs.push("-t", String(total), "-i", o.audio);
  else inputs.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo");
  const g = frames.map((_, i) => `[${i}:v]scale=${STORY.w}:${STORY.h},setsar=1,format=yuv420p[s${i}]`);
  let prev = "s0", at = 0;
  for (let i = 1; i < frames.length; i++) {
    at += frames[i - 1].dur;
    g.push(`[${prev}][s${i}]xfade=transition=fade:duration=${X}:offset=${at.toFixed(2)}[x${i}]`);
    prev = "x" + i;
  }
  g.push(`[${prev}]fade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6,format=yuv420p[v]`);
  g.push(`[${ai}:a]afade=t=in:st=0:d=0.3,afade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8,aresample=48000[aout]`);
  await ffmpeg([...inputs, "-filter_complex", g.join(";"), "-map", "[v]", "-map", "[aout]", "-t", total.toFixed(2), ...ENCODE, o.out]);
  return o.out;
}

/**
 * A second or two of each song, one after another (a countdown's soundtrack).
 * @param {Array<{file: string|null, dur: number}>} clips  null: silence for that long
 */
export async function audioMontage(clips, out) {
  const inputs = [], g = [];
  clips.forEach((c, i) => {
    if (c.file) inputs.push("-ss", String(c.from == null ? 8 : c.from), "-t", String(c.dur), "-i", c.file);
    else inputs.push("-f", "lavfi", "-t", String(c.dur), "-i", "anullsrc=r=48000:cl=stereo");
    g.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${c.dur},afade=t=in:st=0:d=0.12,afade=t=out:st=${Math.max(0, c.dur - 0.18).toFixed(2)}:d=0.18[a${i}]`);
  });
  g.push(clips.map((_, i) => `[a${i}]`).join("") + `concat=n=${clips.length}:v=0:a=1[out]`);
  await ffmpeg([...inputs, "-filter_complex", g.join(";"), "-map", "[out]", "-c:a", "aac", "-b:a", "192k", out]);
  return out;
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
