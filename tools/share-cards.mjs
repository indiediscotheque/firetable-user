#!/usr/bin/env node
// Share images for the library's pages: what a link shows when it's pasted
// into Discord, iMessage, Slack or a social post, and what search engines may
// show beside a result. 1200 x 630, the site's colours and type: the page's
// covers on the left, its name and a fact on the right, the room below.
//
// tools/plain-pages.mjs draws one for each page (--cards) and saves it beside
// the page as card.jpg. Needs sharp (a dev dependency, installed by the
// deploy's `npm ci`); without it the pages keep a song's cover as their image.
// Never deployed itself (tools/).
//
//   node tools/share-cards.mjs --check [out.jpg]   draw one from the site's own
//                                                  images and check its size

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const W = 1200, H = 630;
// the site's palette (css/looks.css :root)
const BG = "#181818", TILE = "#282828", TEXT = "#ffffff", SOFT = "#b3b3b3", GOLD = "#cc9933";
// the whole font, not the Latin part the site sends first: names come in every alphabet
const FONT = ROOT + "tools/fonts/Inter-VariableFont_opsz,wght.full.woff2";
const MOSAIC = 480, GAP = 8, LEFT = 60, TOP = (H - MOSAIC) / 2, COL = LEFT + MOSAIC + 60, COLW = W - COL - 60;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * @returns {Promise<null | {card: Function, cover: Function}>} null when sharp isn't installed
 */
export async function shareCards() {
  let sharp;
  try { sharp = (await import("sharp")).default; } catch { return null; }
  const logo = await sharp(ROOT + "img/idlogo2.png").resize({ height: 44 }).png().toBuffer();
  const logoWidth = (await sharp(logo).metadata()).width;

  /** Words as an image: pango markup, wrapped to `width`, in the site's font. */
  async function words(text, { size, weight = 400, color = TEXT, width = COLW, spacing = 0, maxHeight = 0 }) {
    for (let s = size; ; s -= 6) {
      const img = sharp({ text: {
        text: `<span foreground="${color}" font_weight="${weight}"${spacing ? ` letter_spacing="${spacing * 1024}"` : ""}>${esc(text)}</span>`,
        font: "Inter " + s, fontfile: FONT, width, wrap: "word-char", rgba: true, dpi: 72, spacing: Math.round(s * 0.12)
      } });
      const { data, info } = await img.png().toBuffer({ resolveWithObject: true });
      if (!maxHeight || info.height <= maxHeight || s <= 34) {
        // still too tall at the smallest size (a very long name): keep the top lines
        if (maxHeight && info.height > maxHeight) return { input: await sharp(data).extract({ left: 0, top: 0, width: info.width, height: maxHeight }).png().toBuffer(), height: maxHeight };
        return { input: data, height: info.height };
      }
    }
  }

  /**
   * A cover for the mosaic, from an image's bytes: a square, cut from the middle.
   * YouTube's hqdefault is 480 x 360 with a black band above and below the picture.
   */
  async function cover(bytes, { youtube = false } = {}) {
    try {
      let img = sharp(bytes);
      if (youtube) {
        const m = await img.metadata();
        if (m.width === 480 && m.height === 360) img = img.extract({ left: 105, top: 45, width: 270, height: 270 });
      }
      return await img.resize(MOSAIC, MOSAIC, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
    } catch { return null; }
  }

  /**
   * @param {{kicker?: string, title: string, fact?: string, room: string, site: string, covers?: Array<Buffer|null>}} c
   *   covers: up to four squares from cover() (one fills the square; none leaves it plain)
   * @returns {Promise<Buffer>} a JPEG, 1200 x 630
   */
  async function card(c) {
    const covers = (c.covers || []).filter(Boolean).slice(0, 4);
    const layers = [];
    // the covers: one large, or four in a square; rounded like the site's art
    const tile = covers.length >= 4 ? (MOSAIC - GAP) / 2 : MOSAIC;
    const spots = covers.length >= 4 ? [[0, 0], [tile + GAP, 0], [0, tile + GAP], [tile + GAP, tile + GAP]] : [[0, 0]];
    const mosaic = sharp({ create: { width: MOSAIC, height: MOSAIC, channels: 4, background: covers.length ? BG : TILE } });
    const parts = [];
    for (let i = 0; i < spots.length && i < covers.length; i++) {
      parts.push({ input: await sharp(covers[i]).resize(tile, tile).toBuffer(), left: spots[i][0], top: spots[i][1] });
    }
    // no cover to show: the room's mark on the plain square
    if (!parts.length) {
      const mark = await sharp(ROOT + "img/idlogo2.png").resize({ width: 220 }).png().toBuffer();
      const mm = await sharp(mark).metadata();
      parts.push({ input: mark, left: Math.round((MOSAIC - mm.width) / 2), top: Math.round((MOSAIC - mm.height) / 2) });
    }
    const round = Buffer.from(`<svg width="${MOSAIC}" height="${MOSAIC}"><rect width="${MOSAIC}" height="${MOSAIC}" rx="14" ry="14"/></svg>`);
    layers.push({ input: await mosaic.composite([...parts, { input: round, blend: "dest-in" }]).png().toBuffer(), left: LEFT, top: TOP });

    // the words, stacked from the top of the square; the room along its bottom edge
    let y = TOP + 6;
    if (c.kicker) {
      const k = await words(String(c.kicker).toUpperCase(), { size: 26, weight: 700, color: GOLD, spacing: 2 });
      layers.push({ input: k.input, left: COL, top: Math.round(y) });
      y += k.height + 22;
    }
    const t = await words(c.title, { size: 84, weight: 800, maxHeight: 290 });
    layers.push({ input: t.input, left: COL, top: Math.round(y) });
    y += t.height + 26;
    if (c.fact) {
      const f = await words(c.fact, { size: 32, color: SOFT, maxHeight: Math.max(40, TOP + MOSAIC - 70 - y) });
      if (y + f.height <= TOP + MOSAIC - 60) layers.push({ input: f.input, left: COL, top: Math.round(y) });
    }
    const site = await words(c.site, { size: 26, color: SOFT, width: COLW - logoWidth - 20 });
    layers.push({ input: logo, left: COL, top: TOP + MOSAIC - 44 });
    layers.push({ input: site.input, left: COL + logoWidth + 20, top: Math.round(TOP + MOSAIC - 22 - site.height / 2) });

    return sharp({ create: { width: W, height: H, channels: 3, background: BG } }).composite(layers)
      .jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  }

  return { card, cover, sharp };
}

// --check: one card from the site's own images, to prove the drawing works where it will run
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--check")) {
  const cards = await shareCards();
  if (!cards) { console.error("sharp isn't installed: run npm ci in the repository's root"); process.exit(1); }
  const art = await cards.cover(readFileSync(ROOT + "img/idlogo.png"));
  const jpg = await cards.card({ kicker: "Genre", title: "Post-Punk & Darkwave", fact: "4,299 songs · 59,044 plays", room: "Indie Discotheque", site: "indiediscotheque.com", covers: [art, art, art, art] });
  const meta = await cards.sharp(jpg).metadata();
  const plain = await cards.card({ title: "Röyksopp & Robyn, 坂本龍一 and a name long enough to need three lines or more of the card", room: "Indie Discotheque", site: "indiediscotheque.com" });
  const out = process.argv[process.argv.indexOf("--check") + 1];
  if (out) { writeFileSync(out, jpg); writeFileSync(out.replace(/(\.jpe?g)?$/, "-plain.jpg"), plain); }
  if (meta.format !== "jpeg" || meta.width !== W || meta.height !== H || jpg.length < 20000 || jpg.length > 400000 || plain.length < 8000) {
    console.error(`share card: expected a ${W} x ${H} JPEG, got ${meta.format} ${meta.width} x ${meta.height}, ${jpg.length} bytes`);
    process.exit(1);
  }
  console.log(`Share cards: a ${W} x ${H} JPEG of ${Math.round(jpg.length / 1024)} KB.`);
}
