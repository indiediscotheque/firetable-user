// Meta: Instagram (Reels with licensed music, carousels, Stories), Facebook
// Pages (photo albums, photo Stories) and Threads. Each makes a "container"
// from a public URL of the file, waits for Meta to fetch and process it, then
// publishes it.
//
// Music: a Reel goes out through the API only with a track from Instagram's
// own licensed library (the Audio API: Facebook Login only), matched exactly
// to the song. Without one, the song's picture is posted instead, or, if a
// post kit is set up (studio.mjs), a person adds the sound in the app.
// Nothing is posted with uploaded music. On Facebook a song is a post of its
// own YouTube video, which plays in the feed.
//
// Instagram with Facebook Login (needed for music; one Meta login covers
// Facebook too: `node tools/social/auth.mjs facebook` prints all of these):
//   INSTAGRAM_GRAPH_HOST=graph.facebook.com (repository variable),
//   INSTAGRAM_TOKEN (the Page's token, which doesn't expire), INSTAGRAM_USER_ID
// Instagram with Instagram Login (no music: Reels always go to the kit):
//   INSTAGRAM_TOKEN (tools/social/auth.mjs instagram; renewed here weekly)
// INSTAGRAM_COLLAB     "false": don't invite the artists as collaborators
// INSTAGRAM_TRIAL      the kinds whose Reels go out as Trial Reels, shown to
//                      non-followers first and shared with followers only if
//                      they do well (default fresh,onthisday,fires; "" for none)
// Facebook:  FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN
// Threads:   THREADS_TOKEN (renewed here weekly), THREADS_USER_ID optional
// GRAPH_API_VERSION picks the Graph API version (default v23.0).
// Never deployed (tools/).

import { http, form, sleep, plain, artists, Handoff } from "../util.mjs";
import { caption, altText } from "../captions.mjs";

const WEEK = 7 * 86400000;
const ver = (env) => env.GRAPH_API_VERSION || "v23.0";
const list = (s) => String(s == null ? "" : s).split(",").map((x) => x.trim()).filter(Boolean);
/** Many pictures for a carousel, else one. */
const kitReady = (env) => !!(env.STUDIO_DISCORD_WEBHOOK || (env.STUDIO_TELEGRAM_CHAT_ID && env.TELEGRAM_BOT_TOKEN));
const carousel = (post) => post.media.slides && post.media.slides.length > 1 ? post.media.slides : null;

/** A token from the environment, refreshed every week and kept in the state. */
async function longLived(ctx, name, envToken, refreshUrl) {
  const saved = ctx.state.tokens[name];
  // a new secret replaces what we kept
  if (!saved || saved.seed !== envToken.slice(-12)) ctx.state.tokens[name] = { token: envToken, at: Date.now(), seed: envToken.slice(-12) };
  const t = ctx.state.tokens[name];
  if (refreshUrl && Date.now() - t.at > WEEK && !ctx.dry) {
    try {
      const j = await http(refreshUrl(t.token), { retry: true });
      if (j && j.access_token) { t.token = j.access_token; t.at = Date.now(); ctx.log(`${name}: token refreshed`); }
    } catch (err) { ctx.log(`${name}: couldn't refresh the token (${err.message}); using the one we have`); }
  }
  return t.token;
}

/** Wait for a container to be ready. */
async function ready(url, field, done, failed, what) {
  for (let i = 0; i < 72; i++) {
    const j = await http(url + (url.includes("?") ? "&" : "?") + "fields=" + field + (field === "status_code" ? ",status" : ",error_message"));
    const s = j[field];
    if (s === done) return;
    if (failed.includes(s)) throw new Error(`${what} couldn't process the file: ${j.status || j.error_message || s}`);
    await sleep(i < 6 ? 3000 : 6000);
  }
  throw new Error(what + " took too long to process the file");
}

// ---------------------------------------------------------------- Instagram

function ig(env) {
  const host = env.INSTAGRAM_GRAPH_HOST || "graph.instagram.com";
  return { host, base: `https://${host}/${ver(env)}`, music: host === "graph.facebook.com" };
}

async function igSetup(ctx) {
  const { env } = ctx;
  const { host, base, music } = ig(env);
  const token = await longLived(ctx, "instagram", env.INSTAGRAM_TOKEN,
    host === "graph.instagram.com" ? (t) => `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(t)}` : null);
  let user = env.INSTAGRAM_USER_ID;
  if (!user) {
    const me = await http(`${base}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
    user = me.user_id || me.id;
  }
  const q = (o) => new URLSearchParams({ ...o, access_token: token }).toString();
  // containers aren't posts until media_publish: those calls may be repeated
  const call = (path, params) => http(`${base}/${path}`, { method: "POST", body: form({ ...params, access_token: token }), retry: !path.endsWith("media_publish") });
  const wait = (id) => ready(`${base}/${id}?access_token=${encodeURIComponent(token)}`, "status_code", "FINISHED", ["ERROR", "EXPIRED"], "Instagram");
  const publish = async (creation) => {
    const p = await call(`${user}/media_publish`, { creation_id: creation });
    let url = null;
    try { url = (await http(`${base}/${p.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)).permalink; } catch { /* no link, still posted */ }
    return { id: p.id, url };
  };
  /** The song in Instagram's licensed library: the same title by the same artist, or nothing. */
  const track = async (sound) => {
    if (!music || !sound) return null;
    const j = await http(`${base}/ig_audio?${q({ audio_type: "music", user_id: user, search_query: `${sound.title} ${artists(sound.artist)[0] || sound.artist}` })}`);
    const first = plain(artists(sound.artist)[0] || sound.artist);
    return ((j && j.audio) || []).find((a) => plain(a.title) === plain(sound.title) && plain(a.display_artist || "").includes(first)) || null;
  };
  return { user, call, wait, publish, track };
}

export const instagram = {
  name: "instagram",
  needs: ["INSTAGRAM_TOKEN"],
  async publish(post, ctx) {
    const { user, call, wait, publish, track } = await igSetup(ctx);
    const text = caption(post, "instagram");
    const alt = altText(post);
    const collab = ctx.env.INSTAGRAM_COLLAB === "false" ? [] : [...new Set((post.mentions && post.mentions.instagram) || [])].slice(0, 3);
    // an artist who can't be invited (private, or not a professional account), or an
    // option this account doesn't have: post without it
    const tolerant = async (make, extras) => {
      for (let i = extras.length; i >= 0; i--) {
        const extra = Object.assign({}, ...extras.slice(0, i).map((e) => e[1]));
        try { return await make(extra); } catch (err) {
          if (i === 0 || !extras[i - 1][2].test(err.message)) throw err;
          ctx.log(`instagram: posting without ${extras[i - 1][0]} (${err.message.slice(0, 120)})`);
        }
      }
    };
    const slides = carousel(post);
    let creation;
    if (slides) {
      const children = [];
      for (const s of slides.slice(0, 20)) {
        children.push((await tolerant((extra) => call(`${user}/media`, { image_url: ctx.url(s), is_carousel_item: "true", ...extra }), [["alt text", { alt_text: alt }, /alt/i]])).id);
      }
      for (const c of children) await wait(c);
      creation = (await tolerant((extra) => call(`${user}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: text, ...extra }),
        collab.length ? [["collaborators", { collaborators: JSON.stringify(collab) }, /collaborat|user/i]] : [])).id;
    } else if (post.media.video) {
      const a = await track(post.sound).catch((err) => { ctx.log("instagram: music search failed: " + err.message.slice(0, 160)); return null; });
      if (!a) {
        const what = `"${post.sound ? post.sound.title : post.title}" isn't in Instagram's API music library (or this login can't use it)`;
        // with a post kit set up, a person adds the sound in the app; without one, the picture goes out by itself
        if (kitReady(ctx.env)) throw new Handoff(what + ": in the post kit, to add the sound in the app");
        ctx.log("instagram: " + what + ": posting the picture instead");
        const c = await tolerant((extra) => call(`${user}/media`, { image_url: ctx.url(post.media.image), caption: text, ...extra }), [
          ["alt text", { alt_text: alt }, /alt/i], ...(collab.length ? [["collaborators", { collaborators: JSON.stringify(collab) }, /collaborat|user/i]] : [])
        ]);
        await wait(c.id);
        return publish(c.id);
      }
      ctx.log(`instagram: music "${a.title}" by ${a.display_artist}`);
      const trial = list(ctx.env.INSTAGRAM_TRIAL == null ? "fresh,onthisday,fires" : ctx.env.INSTAGRAM_TRIAL).includes(post.kind);
      creation = (await tolerant((extra) => call(`${user}/media`, {
        media_type: "REELS", video_url: ctx.url(post.media.video), caption: text, share_to_feed: "true", thumb_offset: "0",
        audio_configuration: JSON.stringify({ audio_id: String(a.audio_id), audio_volume: 100, video_volume: 1 }), ...extra
      }), [
        ...(collab.length ? [["collaborators", { collaborators: JSON.stringify(collab) }, /collaborat|user/i]] : []),
        ...(trial ? [["Trial Reels", { trial_params: JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }) }, /trial/i]] : [])
      ])).id;
    } else {
      creation = (await tolerant((extra) => call(`${user}/media`, { image_url: ctx.url(post.media.image), caption: text, ...extra }), [
        ["alt text", { alt_text: alt }, /alt/i], ...(collab.length ? [["collaborators", { collaborators: JSON.stringify(collab) }, /collaborat|user/i]] : [])
      ])).id;
    }
    await wait(creation);
    return publish(creation);
  }
};

/** Stories through the API are pictures (a Story's music sticker is only in the app: the kit). */
export const instagram_story = {
  name: "instagram_story",
  needs: ["INSTAGRAM_TOKEN"],
  async publish(post, ctx) {
    const { user, call, wait, publish } = await igSetup(ctx);
    const c = await call(`${user}/media`, { media_type: "STORIES", image_url: ctx.url(post.media.story) });
    await wait(c.id);
    return publish(c.id);
  }
};

// ---------------------------------------------------------------- Facebook

function fb(ctx) {
  const { env } = ctx;
  const base = `https://graph.facebook.com/${ver(env)}`;
  const page = env.FACEBOOK_PAGE_ID, token = env.FACEBOOK_PAGE_TOKEN;
  // an unpublished photo may be repeated; what posts may not
  const call = (path, params) => http(`${base}/${path}`, { method: "POST", body: form({ ...params, access_token: token }), retry: params.published === "false" });
  return { page, call };
}

export const facebook = {
  name: "facebook",
  needs: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"],
  async publish(post, ctx) {
    const { page, call } = fb(ctx);
    const text = caption(post, "facebook");
    // a song: its own video, which plays in the post (Facebook's player, the artist's plays)
    if (post.targets === "song" && post.listen) {
      const r = await call(`${page}/feed`, { message: text, link: post.listen });
      return { id: r.id, url: `https://www.facebook.com/${r.id}` };
    }
    const pics = carousel(post) || [post.media.image];
    if (pics.length === 1) {
      const r = await call(`${page}/photos`, { url: ctx.url(pics[0]), message: text, alt_text_custom: altText(post) });
      return { id: r.post_id || r.id, url: `https://www.facebook.com/${r.post_id || r.id}` };
    }
    const ids = [];
    for (const p of pics.slice(0, 20)) ids.push((await call(`${page}/photos`, { url: ctx.url(p), published: "false", alt_text_custom: altText(post) })).id);
    const attached = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]));
    const r = await call(`${page}/feed`, { message: text, ...attached });
    return { id: r.id, url: `https://www.facebook.com/${r.id}` };
  }
};

export const facebook_story = {
  name: "facebook_story",
  needs: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"],
  async publish(post, ctx) {
    const { page, call } = fb(ctx);
    const photo = await call(`${page}/photos`, { url: ctx.url(post.media.story), published: "false" });
    const r = await call(`${page}/photo_stories`, { photo_id: photo.id });
    return { id: r.post_id || photo.id, url: null };
  }
};

// ---------------------------------------------------------------- Threads

export const threads = {
  name: "threads",
  needs: ["THREADS_TOKEN"],
  async publish(post, ctx) {
    const base = "https://graph.threads.net/v1.0";
    const token = await longLived(ctx, "threads", ctx.env.THREADS_TOKEN, (t) => `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(t)}`);
    const user = ctx.env.THREADS_USER_ID || (await http(`${base}/me?fields=id&access_token=${encodeURIComponent(token)}`)).id;
    const call = (path, params) => http(`${base}/${path}`, { method: "POST", body: form({ ...params, access_token: token }), retry: !path.endsWith("threads_publish") });
    const wait = (id) => ready(`${base}/${id}?access_token=${encodeURIComponent(token)}`, "status", "FINISHED", ["ERROR", "EXPIRED"], "Threads");
    const text = caption(post, "threads");
    const alt = altText(post);
    let c;
    const slides = carousel(post);
    if (slides) {
      const kids = [];
      for (const s of slides.slice(0, 20)) kids.push((await call(`${user}/threads`, { media_type: "IMAGE", image_url: ctx.url(s), is_carousel_item: "true", alt_text: alt })).id);
      for (const k of kids) await wait(k);
      c = await call(`${user}/threads`, { media_type: "CAROUSEL", children: kids.join(","), text });
    } else {
      c = await call(`${user}/threads`, { media_type: "IMAGE", image_url: ctx.url(post.media.image), text, alt_text: alt });
    }
    await wait(c.id);
    const p = await call(`${user}/threads_publish`, { creation_id: c.id });
    let url = null;
    try { url = (await http(`${base}/${p.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)).permalink; } catch { /* posted all the same */ }
    return { id: p.id, url };
  }
};
