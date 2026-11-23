// The words for each platform, from one post's parts (content.mjs): a hook
// that leads with what people search for (genre, artist, song), a fact or two,
// a prompt to comment, save or send, the call to listen, and tags. Each
// platform gets its own order, length and tag count:
//
//   instagram, tiktok   no clickable links: "link in bio"; 5 hashtags (Instagram's cap)
//   youtube             a keyword title; #Shorts and 2 more (the 3 shown above the title)
//   facebook            the link, 2 hashtags
//   threads             one topic tag
//   bluesky             300 characters, links, mentions and tags as rich text
//   mastodon            CamelCase hashtags, which is how people find posts there
//   x                   no link in the post (X shows posts with links to fewer
//                       people): it goes in a reply; 1 hashtag
//   pinterest           keywords in the title and description, no hashtags
// Tags are CamelCase everywhere: screen readers read them as words.
// Never deployed (tools/).

import { clip, graphemes } from "./util.mjs";

export const TAGS = { instagram: 5, tiktok: 5, youtube: 2, facebook: 2, threads: 1, bluesky: 3, mastodon: 4, x: 1, pinterest: 0, telegram: 0, discord: 0, studio: 5 };

/** The post's link, tagged so the site's stats show which platform sent the visit. */
export function linkFor(post, platform) {
  if (!post.link) return "";
  const u = new URL(post.link);
  u.searchParams.set("utm_source", platform.replace(/_story$/, ""));
  u.searchParams.set("utm_medium", platform.endsWith("_story") ? "story" : "social");
  u.searchParams.set("utm_campaign", post.kind);
  return u.href;
}

export function hashtags(post, platform) {
  const n = TAGS[platform] == null ? 3 : TAGS[platform];
  if (platform === "threads") return post.topic ? ["#" + post.topic] : [];
  return (post.tags || []).slice(0, n).map((t) => "#" + t);
}

/** The artists' handles on a platform, with an @. Threads shares Instagram's names. */
export function mentions(post, platform) {
  const m = post.mentions || {};
  const list = platform === "threads" ? (m.threads || m.instagram || []) : (m[platform.replace(/_story$/, "")] || []);
  return [...new Set(list)].slice(0, 3).map((h) => "@" + h);
}

const join = (...parts) => parts.flat().filter((p) => p != null && String(p).trim() !== "").join("\n\n");
const hookOf = (post) => (post.emoji ? post.emoji + " " : "") + post.hook + (/[.!?…"”]$/.test(post.hook) ? "" : ".");

/** Drop facts from the end until the whole thing fits; then cut it. */
function fit(max, make, facts) {
  let f = [...facts];
  let s = make(f);
  while (graphemes(s) > max && f.length) { f.pop(); s = make(f); }
  return graphemes(s) > max ? clip(s, max) : s;
}

/**
 * The text for a platform.
 * @returns {string}
 */
export function caption(post, platform) {
  const link = linkFor(post, platform);
  const tags = hashtags(post, platform).join(" ");
  const at = mentions(post, platform).join(" ");
  const hook = hookOf(post);
  const facts = post.facts || [];
  switch (platform) {
    case "instagram":
    case "tiktok":
    case "studio":
      return clip(join(hook, facts, at && "🎤 " + at, post.prompt, `🎧 ${post.cta}: link in bio`, tags), 2150);
    case "facebook":
      return join(hook, facts, post.prompt, `🎧 ${post.cta}: ${link}`, tags);
    case "youtube":
      return join(hook, `🎧 ${post.cta}: ${link}`, facts, post.prompt, ["#Shorts", ...hashtags(post, "youtube")].join(" "));
    case "threads":
      return fit(500, (f) => join(hook, f, at, post.prompt, `${post.cta}: ${link}`, tags), facts);
    case "mastodon":
      return fit(500, (f) => join(hook, f, `${post.cta}: ${link}`, tags), facts);
    case "bluesky":
      return fit(300, (f) => join(hook, f, at, link, tags), facts);
    case "x":
      return fit(280, (f) => join(hook, f, at, tags), facts);
    case "pinterest":
      return clip(join(hook, facts, `${post.cta} at ${new URL(post.link || "https://example.com").host.replace(/^www\./, "")}.`), 500);
    case "telegram":
      return clip(join(hook, facts, `${post.cta}: ${link}`), 1000);
    default:
      return join(hook, facts, link);
  }
}

/** X's reply under the post, with the link. */
export const xReply = (post) => `🎧 ${post.cta}: ${linkFor(post, "x")}`;

/** A YouTube Short's title: the words people search for, at most 100 characters. */
export const youtubeTitle = (post) => clip(post.searchTitle || post.title, 100);

/** A Pinterest pin's title: keywords first, at most 100 characters. */
export const pinTitle = (post) => clip(post.searchTitle || post.title, 100);

/** Alt text for the pictures: what's in them, in words. */
export const altText = (post) => clip(`${post.title}. ${post.hook}.`.replace(/\.\./g, "."), 1000);

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
