// Meta: Instagram (Reels, carousels, pictures, Stories), Facebook Pages (Reels,
// photos, Stories) and Threads. All three make a "container" from a public
// URL of the file, wait for Meta to fetch and process it, then publish it.
//
// Instagram, with Instagram Login (an Instagram professional account, no
// Facebook Page needed):
//   INSTAGRAM_TOKEN       a long-lived token (tools/social/auth.mjs instagram);
//                         refreshed here every week, so it never lapses
//   INSTAGRAM_USER_ID     optional: found from the token
//   INSTAGRAM_COLLAB      "false" to stop inviting the artists as collaborators
// With Facebook Login instead: INSTAGRAM_GRAPH_HOST=graph.facebook.com, the
// Page's token as INSTAGRAM_TOKEN and INSTAGRAM_USER_ID set.
// Facebook:  FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN (a Page token, which doesn't expire)
// Threads:   THREADS_TOKEN (refreshed here weekly), THREADS_USER_ID optional
// GRAPH_API_VERSION picks the Graph API version (default v23.0).
// Never deployed (tools/).

import { http, form, sleep } from "../util.mjs";
import { caption } from "../captions.mjs";

const WEEK = 7 * 86400000;
const ver = (env) => env.GRAPH_API_VERSION || "v23.0";

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
  return { host, base: `https://${host}/${ver(env)}` };
}

async function igSetup(ctx) {
  const { env } = ctx;
  const { host, base } = ig(env);
  const token = await longLived(ctx, "instagram", env.INSTAGRAM_TOKEN,
    host === "graph.instagram.com" ? (t) => `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(t)}` : null);
  let user = env.INSTAGRAM_USER_ID;
  if (!user) {
    const me = await http(`${base}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
    user = me.user_id || me.id;
  }
  // containers aren't posts until media_publish: those calls may be repeated
  const call = (path, params) => http(`${base}/${path}`, { method: "POST", body: form({ ...params, access_token: token }), retry: !path.endsWith("media_publish") });
  const wait = (id) => ready(`${base}/${id}?access_token=${encodeURIComponent(token)}`, "status_code", "FINISHED", ["ERROR", "EXPIRED"], "Instagram");
  const publish = async (creation) => {
    const p = await call(`${user}/media_publish`, { creation_id: creation });
    let url = null;
    try { url = (await http(`${base}/${p.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)).permalink; } catch { /* no link, still posted */ }
    return { id: p.id, url };
  };
  return { user, call, wait, publish };
}

export const instagram = {
  name: "instagram",
  needs: ["INSTAGRAM_TOKEN"],
  cap: (env) => Number(env.INSTAGRAM_PER_DAY || 20),
  async publish(post, ctx) {
    const { user, call, wait, publish } = await igSetup(ctx);
    const text = caption(post, "instagram");
    const collab = ctx.env.INSTAGRAM_COLLAB === "false" ? [] : [...new Set((post.mentions && post.mentions.instagram) || [])].slice(0, 3);
    const tryCollab = async (make) => {
      try { return await make(collab.length ? { collaborators: JSON.stringify(collab) } : {}); } catch (err) {
        // an artist who can't be invited (private, or not a professional account): post without
        if (collab.length && /collaborat|user/i.test(err.message)) { ctx.log("instagram: posting without collaborators (" + err.message.slice(0, 120) + ")"); return make({}); }
        throw err;
      }
    };
    const slides = post.media.slides && post.media.slides.length > 1 && post.kind !== "fresh" ? post.media.slides : null;
    let creation;
    if (slides) {
      const children = [];
      for (const s of slides.slice(0, 10)) children.push((await call(`${user}/media`, { image_url: ctx.url(s), is_carousel_item: "true" })).id);
      for (const c of children) await wait(c);
      creation = (await tryCollab((extra) => call(`${user}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: text, ...extra }))).id;
    } else if (post.media.video) {
      creation = (await tryCollab((extra) => call(`${user}/media`, { media_type: "REELS", video_url: ctx.url(post.media.video), caption: text, share_to_feed: "true", thumb_offset: "1500", ...extra }))).id;
    } else {
      creation = (await tryCollab((extra) => call(`${user}/media`, { image_url: ctx.url(post.media.image), caption: text, ...extra }))).id;
    }
    await wait(creation);
    return publish(creation);
  }
};

export const instagram_story = {
  name: "instagram_story",
  needs: ["INSTAGRAM_TOKEN"],
  cap: (env) => Number(env.INSTAGRAM_STORIES_PER_DAY || 10),
  async publish(post, ctx) {
    const { user, call, wait, publish } = await igSetup(ctx);
    const media = post.media.video ? { video_url: ctx.url(post.media.video) } : { image_url: ctx.url(post.media.story) };
    const c = await call(`${user}/media`, { media_type: "STORIES", ...media });
    await wait(c.id);
    return publish(c.id);
  }
};

// ---------------------------------------------------------------- Facebook

function fb(ctx) {
  const { env } = ctx;
  const base = `https://graph.facebook.com/${ver(env)}`;
  const page = env.FACEBOOK_PAGE_ID, token = env.FACEBOOK_PAGE_TOKEN;
  // an unpublished photo, or a video upload's start, may be repeated; what posts may not
  const call = (path, params) => http(`${base}/${path}`, { method: "POST", body: form({ ...params, access_token: token }), retry: params.published === "false" || params.upload_phase === "start" });
  /** Reels and video Stories: start, Meta fetches the file from its URL, finish. */
  const video = async (edge, url, finish) => {
    const start = await call(`${page}/${edge}`, { upload_phase: "start" });
    await http(start.upload_url || `https://rupload.facebook.com/video-upload/${ver(env)}/${start.video_id}`, {
      method: "POST", headers: { Authorization: "OAuth " + token, file_url: url }, retry: true
    });
    const done = await call(`${page}/${edge}`, { upload_phase: "finish", video_id: start.video_id, ...finish });
    return { id: done.post_id || start.video_id, video: start.video_id };
  };
  return { page, call, video };
}

export const facebook = {
  name: "facebook",
  needs: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"],
  cap: (env) => Number(env.FACEBOOK_PER_DAY || 20),
  async publish(post, ctx) {
    const { page, call, video } = fb(ctx);
    const text = caption(post, "facebook");
    if (post.media.video) {
      const r = await video("video_reels", ctx.url(post.media.video), { video_state: "PUBLISHED", description: text });
      return { id: r.video, url: `https://www.facebook.com/reel/${r.video}` };
    }
    const pics = post.media.slides && post.media.slides.length > 1 ? post.media.slides : [post.media.image];
    if (pics.length === 1) {
      const r = await call(`${page}/photos`, { url: ctx.url(pics[0]), message: text });
      return { id: r.post_id || r.id, url: `https://www.facebook.com/${r.post_id || r.id}` };
    }
    const ids = [];
    for (const p of pics.slice(0, 10)) ids.push((await call(`${page}/photos`, { url: ctx.url(p), published: "false" })).id);
    const attached = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]));
    const r = await call(`${page}/feed`, { message: text, ...attached });
    return { id: r.id, url: `https://www.facebook.com/${r.id}` };
  }
};

export const facebook_story = {
  name: "facebook_story",
  needs: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"],
  cap: (env) => Number(env.FACEBOOK_STORIES_PER_DAY || 10),
  async publish(post, ctx) {
    const { page, call, video } = fb(ctx);
    if (post.media.video) {
      const r = await video("video_stories", ctx.url(post.media.video), {});
      return { id: r.id, url: null };
    }
    const photo = await call(`${page}/photos`, { url: ctx.url(post.media.story), published: "false" });
    const r = await call(`${page}/photo_stories`, { photo_id: photo.id });
    return { id: r.post_id || photo.id, url: null };
  }
};

// ---------------------------------------------------------------- Threads

export const threads = {
  name: "threads",
  needs: ["THREADS_TOKEN"],
  cap: (env) => Number(env.THREADS_PER_DAY || 20),
  async publish(post, ctx) {
    const base = "https://graph.threads.net/v1.0";
    const token = await longLived(ctx, "threads", ctx.env.THREADS_TOKEN, (t) => `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(t)}`);
    const user = ctx.env.THREADS_USER_ID || (await http(`${base}/me?fields=id&access_token=${encodeURIComponent(token)}`)).id;
    const call = (path, params) => http(`${base}/${path}`, { method: "POST", body: form({ ...params, access_token: token }), retry: !path.endsWith("threads_publish") });
    const wait = (id) => ready(`${base}/${id}?access_token=${encodeURIComponent(token)}`, "status", "FINISHED", ["ERROR", "EXPIRED"], "Threads");
    const text = caption(post, "threads");
    let c;
    const slides = post.media.slides && post.media.slides.length > 1 ? post.media.slides : null;
    if (post.media.video && !slides) {
      c = await call(`${user}/threads`, { media_type: "VIDEO", video_url: ctx.url(post.media.video), text });
    } else if (slides) {
      const kids = [];
      for (const s of slides.slice(0, 20)) kids.push((await call(`${user}/threads`, { media_type: "IMAGE", image_url: ctx.url(s), is_carousel_item: "true" })).id);
      for (const k of kids) await wait(k);
      c = await call(`${user}/threads`, { media_type: "CAROUSEL", children: kids.join(","), text });
    } else {
      c = await call(`${user}/threads`, { media_type: "IMAGE", image_url: ctx.url(post.media.image), text });
    }
    await wait(c.id);
    const p = await call(`${user}/threads_publish`, { creation_id: c.id });
    let url = null;
    try { url = (await http(`${base}/${p.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)).permalink; } catch { /* posted all the same */ }
    return { id: p.id, url };
  }
};
