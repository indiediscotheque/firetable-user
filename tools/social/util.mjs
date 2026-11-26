// Small helpers the social posting shares: web requests with retries, names
// made into page addresses and hashtags, and dates in the room's time zone.
// Never deployed (tools/).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(url, status, body) {
    const u = new URL(url);
    super(`${u.host}${u.pathname.replace(/%E2%80%A6/g, "…")} answered ${status}: ${String(body).slice(0, 600)}`);
    this.status = status;
    this.body = body;
  }
}

// secrets in a query (access_token=…) or a path (a Discord webhook's token, a Telegram bot's)
export const redact = (u) => String(u).replace(/(access_token|key|client_secret|token)=[^&]+/gi, "$1=…")
  .replace(/(\/webhooks\/\d+\/)[^/?#\s]+/g, "$1…").replace(/\/bot\d+:[\w-]+/g, "/bot…");

/**
 * fetch with retries (Retry-After respected). Reads, and requests marked
 * `retry: true` (uploads, drafts, tokens), are tried again after network
 * errors and 5xx; anything else (a request that posts) only after a 429, so a
 * server that stumbles after posting never gets the post twice.
 * Returns parsed JSON (when the answer is JSON), else text; `raw: true` gives the Response.
 */
export async function http(url, opts = {}) {
  const { tries = 3, raw = false, okStatuses = [], retry = false, timeout = 120000, ...init } = opts;
  init.headers = { "User-Agent": "IndieDiscothequeSocial/1.0", ...(init.headers || {}) };
  const method = String(init.method || "GET").toUpperCase();
  const safe = retry || method === "GET" || method === "HEAD";
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (err) {
      if (!safe || attempt >= tries) throw new Error(redact(url) + ": " + err.message);
      await sleep(1500 * attempt);
      continue;
    }
    if ((res.status === 429 || (safe && res.status >= 500)) && attempt < tries) {
      const wait = Math.min(60, Number(res.headers.get("retry-after")) || 2 * attempt);
      await sleep(wait * 1000);
      continue;
    }
    if (raw) return res;
    const text = await res.text();
    if (!res.ok && !okStatuses.includes(res.status)) throw new HttpError(redact(url), res.status, text);
    const type = res.headers.get("content-type") || "";
    if (type.includes("json") || /^\s*[[{]/.test(text)) { try { return JSON.parse(text); } catch { /* not JSON after all */ } }
    return text;
  }
}

/** The bytes at a URL. */
export async function bytes(url, opts = {}) {
  const res = await http(url, { ...opts, raw: true });
  if (!res.ok) throw new HttpError(redact(url), res.status, await res.text().catch(() => ""));
  return Buffer.from(await res.arrayBuffer());
}

export const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]));

// ---------------------------------------------------------------- names

// the same splitting and slugs as tools/plain-pages.mjs, so links go to the pages it builds
export const ARTIST_SPLIT = /(\s*(?:,|;|\s&\s|\s\+\s|\s+and\s+|\s+x\s+|\s+vs\.?\s+|\s+versus\s+|\s+with\s+|\s+\/\s+|\s+×\s+|、)\s*)/i;
export const artistSlug = (name) => String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ł/g, "l")
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export const artists = (a) => String(a || "").split(ARTIST_SPLIT).filter((_, i) => i % 2 === 0).map((s) => s.trim()).filter(Boolean);

/** For matching a song across catalogs: lower case, no accents, no "feat." or brackets. */
export function plain(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\s*[([]?\b(feat|ft|featuring|with)\b\.?[^)\]]*[)\]]?/g, " ")
    .replace(/[([][^)\]]*(remaster|version|edit|mix|radio|official|video|audio|lyric)[^)\]]*[)\]]/g, " ")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** "Post-Punk & Darkwave" → ["postpunk", "darkwave"]; "Nu-Disco" → ["nudisco"]. */
export function genreTags(genre) {
  return String(genre || "").split(/\s*(?:&|\/|,|\band\b)\s*/i).map((g) => g.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ""))
    .filter((g) => g.length > 1 && g.length < 30);
}

/** Grapheme count (what Bluesky and Threads count). */
export function graphemes(s) {
  return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(String(s))].length;
}

/** Cut text to at most `max` graphemes on a word boundary, with an ellipsis. */
export function clip(s, max) {
  s = String(s || "");
  if (graphemes(s) <= max) return s;
  const parts = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].map((x) => x.segment);
  let cut = parts.slice(0, max - 1).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.4) cut = cut.slice(0, sp);
  return cut.replace(/[\s,.;:–-]+$/, "") + "…";
}

// ---------------------------------------------------------------- time

/** Parts of a moment in a time zone: {y, m, d, h, wd (1 = Monday … 7), date: "YYYY-MM-DD", mmdd: "MM-DD"}. */
export function zoned(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), wd, date: `${p.year}-${p.month}-${p.day}`, mmdd: `${p.month}-${p.day}` };
}

/** The ISO week a date ("YYYY-MM-DD") falls in, e.g. "2026-W47". */
export function isoWeek(date) {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return y + "-W" + String(week).padStart(2, "0");
}

/** "Nov 16–22", or "Nov 30–Dec 6" across a month's end. */
export function dayRange(from, to, tz) {
  const a = new Date(from), b = new Date(to);
  const m = (d) => d.toLocaleDateString("en-US", { month: "short", timeZone: tz });
  const d = (x) => x.toLocaleDateString("en-US", { day: "numeric", timeZone: tz });
  return m(a) === m(b) ? `${m(a)} ${d(a)}–${d(b)}` : `${m(a)} ${d(a)}–${m(b)} ${d(b)}`;
}
export const dayName = (ms, tz) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
export const releaseDay = (rel) => new Date(String(rel) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const num = (x) => Number(x || 0).toLocaleString("en-US");
export const plural = (x, one, many) => num(x) + " " + (Number(x) === 1 ? one : many);

/**
 * Thrown by a platform that can't post this one itself (a Reel without a
 * licensed track): the post kit (platforms/studio.mjs) hands it to a person to
 * post from the app instead. Not a failure, and not tried again.
 */
export class Handoff extends Error {}
