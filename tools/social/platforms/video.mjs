// TikTok: the video goes to the TikTok app's inbox as a draft, where the song
// is added from TikTok's own sound picker (licensed) and the post finished.
// The post kit (studio.mjs) carries the caption to paste. TikTok allows 5
// drafts waiting at once.
//
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN (an app at
//   developers.tiktok.com with Login Kit and the Content Posting API's
//   video.upload scope; tools/social/auth.mjs tiktok)
//
// YouTube Shorts have no API for adding music from YouTube's library, so they
// go out from the app too, from the kit.
// Never deployed (tools/).

import { http, form, sleep } from "../util.mjs";

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
  const j = await http(TT + path, { method: "POST", retry: true, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body), okStatuses: [400, 403] });
  if (j && j.error && j.error.code && j.error.code !== "ok") throw new Error(`TikTok ${path}: ${j.error.code} ${j.error.message || ""}`);
  return j.data || {};
}

export const tiktok = {
  name: "tiktok",
  needs: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"],
  async publish(post, ctx) {
    const video = await ctx.file(post.media.video);
    const size = video.length;
    // one chunk up to 64 MB (ours are far smaller)
    const init = await tt(ctx, "/post/publish/inbox/video/init/", { source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } });
    const put = await http(init.upload_url, { method: "PUT", raw: true, tries: 2, retry: true, timeout: 600000,
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` }, body: video });
    if (!put.ok) throw new Error("TikTok upload answered " + put.status + ": " + (await put.text()).slice(0, 300));
    for (let i = 0; i < 40; i++) {
      await sleep(4000);
      const s = await tt(ctx, "/post/publish/status/fetch/", { publish_id: init.publish_id });
      if (s.status === "FAILED") throw new Error("TikTok couldn't take the video: " + (s.fail_reason || "no reason given"));
      if (s.status === "SEND_TO_USER_INBOX" || s.status === "PUBLISH_COMPLETE") return { id: init.publish_id, url: null, draft: true };
    }
    return { id: init.publish_id, url: null, draft: true, note: "still processing" };
  }
};
