// The short-video apps: YouTube Shorts and TikTok. Both take the file itself.
//
// YouTube: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN (the
//   same three firetable-hostbot uses for its playlists: tools/youtube-auth.js
//   there prints them). An upload costs 1,600 of the project's 10,000 daily
//   quota units, shared with the bot, so YOUTUBE_PER_DAY (default 2) keeps it
//   small. YOUTUBE_PLAYLIST_ID optional: each Short is added to that playlist.
// TikTok: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN
//   (tools/social/auth.mjs tiktok). TIKTOK_MODE "draft" (the default) sends
//   the video to the TikTok app's inbox, where you add the official sound and
//   post it in a few taps; "direct" posts it straight away (TikTok must have
//   audited the app first, or it can only post privately). TIKTOK_PRIVACY
//   optional for direct posts (default: public when allowed).
// Never deployed (tools/).

import { http, form, sleep } from "../util.mjs";
import { caption, youtubeTitle } from "../captions.mjs";

export const youtube = {
  name: "youtube",
  needs: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
  wants: "video",
  cap: (env) => Number(env.YOUTUBE_PER_DAY || 2),
  async publish(post, ctx) {
    const { env } = ctx;
    const tok = await http("https://oauth2.googleapis.com/token", { method: "POST", retry: true, body: form({
      client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, refresh_token: env.YOUTUBE_REFRESH_TOKEN, grant_type: "refresh_token"
    }) });
    const auth = { Authorization: "Bearer " + tok.access_token };
    const video = await ctx.file(post.media.video);
    const meta = {
      snippet: { title: youtubeTitle(post), description: caption(post, "youtube").slice(0, 4900), tags: post.tags.slice(0, 12), categoryId: "10", defaultLanguage: "en", defaultAudioLanguage: "en" },
      status: { privacyStatus: env.YOUTUBE_PRIVACY || "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: false }
    };
    const start = await http("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST", raw: true, retry: true,
      headers: { ...auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(video.length) },
      body: JSON.stringify(meta)
    });
    if (!start.ok) throw new Error("YouTube wouldn't start the upload: " + start.status + " " + (await start.text()).slice(0, 400));
    const up = await http(start.headers.get("location"), { method: "PUT", headers: { ...auth, "Content-Type": "video/mp4" }, body: video, tries: 1, timeout: 600000 });
    if (env.YOUTUBE_PLAYLIST_ID) {
      try {
        await http("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ snippet: { playlistId: env.YOUTUBE_PLAYLIST_ID, resourceId: { kind: "youtube#video", videoId: up.id } } }) });
      } catch (err) { ctx.log("youtube: posted, but couldn't add it to the playlist: " + err.message); }
    }
    return { id: up.id, url: "https://youtube.com/shorts/" + up.id };
  }
};

// ---------------------------------------------------------------- TikTok

const TT = "https://open.tiktokapis.com/v2";

async function tiktokToken(ctx) {
  const { env, state } = ctx;
  const seed = env.TIKTOK_REFRESH_TOKEN.slice(-12);
  let t = state.tokens.tiktok;
  if (!t || t.seed !== seed) t = state.tokens.tiktok = { refresh: env.TIKTOK_REFRESH_TOKEN, seed };
  if (t.access && t.expires - Date.now() > 10 * 60000) return t.access;
  const j = await http(TT + "/oauth/token/", { method: "POST", retry: true, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({
    client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t.refresh
  }) });
  if (!j.access_token) throw new Error("TikTok didn't refresh the token: " + JSON.stringify(j).slice(0, 300));
  // TikTok can hand back a new refresh token: keep it (the secret's own is then spent)
  Object.assign(t, { access: j.access_token, expires: Date.now() + (j.expires_in || 86400) * 1000, refresh: j.refresh_token || t.refresh });
  return t.access;
}

async function tt(ctx, path, body) {
  const token = await tiktokToken(ctx);
  const j = await http(TT + path, { method: "POST", retry: path !== "/post/publish/video/init/", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body), okStatuses: [400, 403] });
  if (j && j.error && j.error.code && j.error.code !== "ok") throw new Error(`TikTok ${path}: ${j.error.code} ${j.error.message || ""}`);
  return j.data || {};
}

export const tiktok = {
  name: "tiktok",
  needs: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"],
  wants: "video",
  cap: (env) => Number(env.TIKTOK_PER_DAY || 5),
  async publish(post, ctx) {
    const direct = ctx.env.TIKTOK_MODE === "direct";
    const video = await ctx.file(post.media.video);
    const size = video.length;
    // one chunk up to 64 MB (ours are far smaller)
    const source = { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 };
    let init;
    if (direct) {
      const info = await tt(ctx, "/post/publish/creator_info/query/", {});
      const options = info.privacy_level_options || [];
      const privacy = ctx.env.TIKTOK_PRIVACY && options.includes(ctx.env.TIKTOK_PRIVACY) ? ctx.env.TIKTOK_PRIVACY : options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0] || "SELF_ONLY";
      init = await tt(ctx, "/post/publish/video/init/", {
        post_info: { title: caption(post, "tiktok"), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, video_cover_timestamp_ms: 1500, brand_content_toggle: false, brand_organic_toggle: false },
        source_info: source
      });
    } else {
      init = await tt(ctx, "/post/publish/inbox/video/init/", { source_info: source });
    }
    const put = await http(init.upload_url, { method: "PUT", raw: true, tries: 2, timeout: 600000,
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` }, body: video });
    if (!put.ok) throw new Error("TikTok upload answered " + put.status + ": " + (await put.text()).slice(0, 300));
    for (let i = 0; i < 40; i++) {
      await sleep(4000);
      const s = await tt(ctx, "/post/publish/status/fetch/", { publish_id: init.publish_id });
      if (s.status === "FAILED") throw new Error("TikTok couldn't post it: " + (s.fail_reason || "no reason given"));
      if (s.status === "SEND_TO_USER_INBOX") { ctx.log("tiktok: in the app's inbox; open TikTok, add the song's sound and post"); return { id: init.publish_id, url: null, draft: true }; }
      if (s.status === "PUBLISH_COMPLETE") {
        const id = (s.publicaly_available_post_id || s.publicly_available_post_id || [])[0];
        return { id: id || init.publish_id, url: id ? `https://www.tiktok.com/video/${id}` : null };
      }
    }
    return { id: init.publish_id, url: null, note: "still processing" };
  }
};
