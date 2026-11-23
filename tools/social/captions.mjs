// The words for each platform, from one post (content.mjs): each platform's
// length limit, how it treats links (Instagram and TikTok don't make them
// clickable), how many hashtags it rewards, and how it tags people.
// Never deployed (tools/).

import { clip, graphemes } from "./util.mjs";

// how many hashtags each platform gets (Instagram allows 5; Threads takes one topic)
const TAGS = { instagram: 5, instagram_story: 0, facebook: 3, facebook_story: 0, tiktok: 5, youtube: 3, threads: 1, bluesky: 3, mastodon: 5, x: 2, pinterest: 6, telegram: 3, discord: 0 };

/** The post's link, tagged so the site's stats show which platform sent the visit. */
export function linkFor(post, platform) {
  if (!post.link) return "";
  const u = new URL(post.link);
  u.searchParams.set("utm_source", platform.replace(/_story$/, ""));
  u.searchParams.set("utm_medium", platform.endsWith("_story") ? "story" : "social");
  u.searchParams.set("utm_campaign", post.kind);
  return u.href;
}

export const hashtags = (post, platform) => (post.tags || []).slice(0, TAGS[platform] == null ? 3 : TAGS[platform]).map((t) => "#" + t);

/** The artists' handles on a platform, with an @. Threads shares Instagram's names. */
export function mentions(post, platform) {
  const m = post.mentions || {};
  const list = platform === "threads" ? (m.threads || m.instagram || []) : (m[platform.replace(/_story$/, "")] || []);
  return [...new Set(list)].slice(0, 3).map((h) => "@" + h);
}

const LINK23 = "⁣".repeat(23); // stands in for a link while measuring an X post
const join = (...parts) => parts.flat().filter((p) => p != null && String(p).trim() !== "").join("\n\n");

/**
 * The text for a platform.
 * @returns {string}
 */
export function caption(post, platform) {
  const link = linkFor(post, platform);
  const tags = hashtags(post, platform);
  const at = mentions(post, platform);
  const lead = (post.emoji ? post.emoji + " " : "") + post.lead;
  const body = post.body || [];
  switch (platform) {
    case "instagram":
    case "tiktok":
      // links aren't clickable here: send people to the bio
      return clip(join(lead, body, at.length ? "🎤 " + at.join(" ") : "", post.cta + " 🎧 link in bio", tags.join(" ")), 2150);
    case "facebook":
      return join(lead, body, post.cta + ": " + link, tags.join(" "));
    case "youtube":
      return join(lead, body, post.cta + ": " + link, post.credit || "", tags.join(" "));
    case "threads":
      return fit(500, (b) => join(lead, b, at.join(" "), post.cta + ": " + link, tags.join(" ")), body);
    case "mastodon":
      return fit(500, (b) => join(lead, b, post.cta + ": " + link, tags.join(" ")), body);
    case "bluesky":
      return fit(300, (b) => join(lead, b, at.join(" "), link, tags.join(" ")), body);
    case "x":
      // a link counts as 23 characters whatever its length
      return fit(280, (b) => join(lead, b, at.join(" "), LINK23, tags.join(" ")), body).replace(LINK23, link);
    case "pinterest":
      return clip(join(lead, body, post.cta + " at " + new URL(post.link || "https://example.com").host.replace(/^www\./, ""), tags.join(" ")), 500);
    case "telegram":
      return clip(join(lead, body, post.cta + ": " + link), 1000);
    default:
      return join(lead, body, link);
  }
}

/** Drop body lines from the end until the whole thing fits; then cut the lead itself. */
function fit(max, make, body) {
  let b = [...body];
  let s = make(b);
  while (graphemes(s) > max && b.length) { b.pop(); s = make(b); }
  return graphemes(s) > max ? clip(s, max) : s;
}

/** A YouTube title: at most 100 characters, ending in #Shorts. */
export function youtubeTitle(post) {
  return clip(post.title, 100 - " #Shorts".length) + " #Shorts";
}

/** A Pinterest pin's title: at most 100 characters. */
export const pinTitle = (post) => clip(post.title, 100);

/**
 * Bluesky's rich text: the byte ranges of links, @mentions and #tags in the text.
 * @param {(handle: string) => Promise<string|null>} resolve  a handle's DID
 */
export async function blueskyFacets(text, resolve) {
  const enc = new TextEncoder();
  const facets = [];
  const at = (index) => enc.encode(text.slice(0, index)).length;
  const span = (i, len) => ({ byteStart: at(i), byteEnd: at(i + len) });
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    facets.push({ index: span(m.index, url.length), features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] });
  }
  for (const m of text.matchAll(/(^|\s)(@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))/g)) {
    const did = await resolve(m[3]).catch(() => null);
    if (did) facets.push({ index: span(m.index + m[1].length, m[2].length), features: [{ $type: "app.bsky.richtext.facet#mention", did }] });
  }
  for (const m of text.matchAll(/(^|\s)(#([\p{L}\p{N}_]+))/gu)) {
    facets.push({ index: span(m.index + m[1].length, m[2].length), features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[3] }] });
  }
  return facets;
}
