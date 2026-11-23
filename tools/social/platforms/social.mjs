// Bluesky, Mastodon, X, Pinterest, Telegram and Discord.
//
// Bluesky:   BLUESKY_HANDLE, BLUESKY_APP_PASSWORD (Settings → Privacy and
//            security → App passwords); BLUESKY_SERVICE if the account isn't on bsky.social
// Mastodon:  MASTODON_URL (the server, e.g. https://mastodon.social), MASTODON_TOKEN
//            (Preferences → Development → New application, scope write:statuses write:media)
// X:         X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (an app with
//            read and write access at developer.x.com; the free tier's monthly
//            post limit is low, so X_PER_DAY defaults to 2)
// Pinterest: PINTEREST_BOARD_ID and PINTEREST_APP_ID, PINTEREST_APP_SECRET,
//            PINTEREST_REFRESH_TOKEN (tools/social/auth.mjs pinterest)
// Telegram:  TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_CHAT_ID (the channel,
//            e.g. @indiediscotheque, with the bot as an admin)
// Discord:   DISCORD_WEBHOOK_URL (channel → Edit → Integrations → Webhooks)
// Never deployed (tools/).

import { createHmac, randomBytes } from "crypto";
import sharp from "sharp";
import { http, form, sleep } from "../util.mjs";
import { caption, blueskyFacets, pinTitle, linkFor } from "../captions.mjs";

const alt = (post) => post.title + (post.lead ? ". " + post.lead : "");

// ---------------------------------------------------------------- Bluesky

/** Bluesky takes pictures up to about 1 MB: smaller JPEGs until it fits. */
async function underMB(buf) {
  for (let q = 88; buf.length > 950000 && q >= 50; q -= 8) buf = await sharp(buf).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  return buf;
}

export const bluesky = {
  name: "bluesky",
  needs: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"],
  cap: (env) => Number(env.BLUESKY_PER_DAY || 20),
  async publish(post, ctx) {
    const service = (ctx.env.BLUESKY_SERVICE || "https://bsky.social").replace(/\/$/, "");
    const s = await http(service + "/xrpc/com.atproto.server.createSession", { method: "POST", retry: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: ctx.env.BLUESKY_HANDLE, password: ctx.env.BLUESKY_APP_PASSWORD }) });
    const pds = ((s.didDoc && s.didDoc.service) || []).find((x) => x.type === "AtprotoPersonalDataServer")?.serviceEndpoint?.replace(/\/$/, "") || service;
    const auth = { Authorization: "Bearer " + s.accessJwt };
    const text = caption(post, "bluesky");
    const facets = await blueskyFacets(text, async (handle) => (await http("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=" + encodeURIComponent(handle), { tries: 1 })).did);
    let embed;
    const slides = post.media.slides && post.media.slides.length > 1 ? post.media.slides : null;
    if (post.media.video && !slides) {
      // the video service processes it; it's then attached like a picture
      const svc = await http(`${pds}/xrpc/com.atproto.server.getServiceAuth?aud=${encodeURIComponent("did:web:" + new URL(pds).host)}&lxm=com.atproto.repo.uploadBlob&exp=${Math.floor(Date.now() / 1000) + 1800}`, { headers: auth });
      const bytes = await ctx.file(post.media.video);
      const up = await http(`https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(s.did)}&name=${encodeURIComponent(post.media.video)}`, {
        method: "POST", retry: true, headers: { Authorization: "Bearer " + svc.token, "Content-Type": "video/mp4", "Content-Length": String(bytes.length) }, body: bytes, okStatuses: [409], timeout: 600000
      });
      const jobId = up.jobId || (up.jobStatus && up.jobStatus.jobId);
      let blob = up.blob || (up.jobStatus && up.jobStatus.blob);
      for (let i = 0; !blob && i < 60; i++) {
        await sleep(3000);
        const j = await http("https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=" + encodeURIComponent(jobId), { headers: auth });
        const st = j.jobStatus || {};
        if (st.state === "JOB_STATE_FAILED") throw new Error("Bluesky couldn't process the video: " + (st.error || st.message || "no reason given"));
        blob = st.blob;
      }
      if (!blob) throw new Error("Bluesky took too long to process the video");
      embed = { $type: "app.bsky.embed.video", video: blob, alt: alt(post).slice(0, 1000), aspectRatio: { width: 1080, height: 1920 } };
    } else {
      const images = [];
      for (const name of (slides || [post.media.image]).slice(0, 4)) {
        const buf = await underMB(await ctx.file(name));
        const b = await http(pds + "/xrpc/com.atproto.repo.uploadBlob", { method: "POST", retry: true, headers: { ...auth, "Content-Type": "image/jpeg" }, body: buf });
        images.push({ image: b.blob, alt: alt(post).slice(0, 1000), aspectRatio: { width: 1080, height: 1350 } });
      }
      embed = { $type: "app.bsky.embed.images", images };
    }
    const r = await http(pds + "/xrpc/com.atproto.repo.createRecord", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({
      repo: s.did, collection: "app.bsky.feed.post",
      record: { $type: "app.bsky.feed.post", text, facets, langs: ["en"], createdAt: new Date().toISOString(), embed }
    }) });
    return { id: r.uri, url: `https://bsky.app/profile/${s.handle || ctx.env.BLUESKY_HANDLE}/post/${r.uri.split("/").pop()}` };
  }
};

// ---------------------------------------------------------------- Mastodon

export const mastodon = {
  name: "mastodon",
  needs: ["MASTODON_URL", "MASTODON_TOKEN"],
  cap: (env) => Number(env.MASTODON_PER_DAY || 20),
  async publish(post, ctx) {
    const base = ctx.env.MASTODON_URL.replace(/\/$/, "");
    const auth = { Authorization: "Bearer " + ctx.env.MASTODON_TOKEN };
    const slides = post.media.slides && post.media.slides.length > 1 ? post.media.slides : null;
    const files = post.media.video && !slides ? [[post.media.video, "video/mp4"]] : (slides || [post.media.image]).slice(0, 4).map((f) => [f, "image/jpeg"]);
    const ids = [];
    for (const [name, type] of files) {
      const fd = new FormData();
      fd.append("file", new Blob([await ctx.file(name)], { type }), name);
      fd.append("description", alt(post).slice(0, 1500));
      let m = await http(base + "/api/v2/media", { method: "POST", retry: true, headers: auth, body: fd, timeout: 600000 });
      for (let i = 0; !m.url && i < 60; i++) { await sleep(3000); m = await http(base + "/api/v1/media/" + m.id, { headers: auth, okStatuses: [206] }); }
      ids.push(m.id);
    }
    const st = await http(base + "/api/v1/statuses", { method: "POST", retry: true, headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": post.id },
      body: JSON.stringify({ status: caption(post, "mastodon"), media_ids: ids, visibility: "public", language: "en" }) });
    return { id: st.id, url: st.url };
  }
};

// ---------------------------------------------------------------- X

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** An OAuth 1.0a header (the request's own body isn't signed: JSON and multipart bodies never are). */
export function oauth1(method, url, keys, extra = {}) {
  const o = { oauth_consumer_key: keys.key, oauth_nonce: extra.nonce || randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: extra.timestamp || String(Math.floor(Date.now() / 1000)), oauth_token: keys.token, oauth_version: "1.0" };
  const u = new URL(url);
  const params = [...Object.entries(o), ...u.searchParams.entries()].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1);
  const base = [method.toUpperCase(), pct(u.origin + u.pathname), pct(params.map(([k, v]) => k + "=" + v).join("&"))].join("&");
  o.oauth_signature = createHmac("sha1", pct(keys.secret) + "&" + pct(keys.tokenSecret)).update(base).digest("base64");
  return "OAuth " + Object.entries(o).sort().map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}

export const x = {
  name: "x",
  needs: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"],
  cap: (env) => Number(env.X_PER_DAY || 2),
  async publish(post, ctx) {
    const keys = { key: ctx.env.X_API_KEY, secret: ctx.env.X_API_SECRET, token: ctx.env.X_ACCESS_TOKEN, tokenSecret: ctx.env.X_ACCESS_SECRET };
    const slides = post.media.slides && post.media.slides.length > 1 ? post.media.slides : null;
    const ids = [];
    for (const name of (slides || [post.media.image]).slice(0, 4)) {
      const url = "https://api.x.com/2/media/upload";
      const fd = new FormData();
      fd.append("media", new Blob([await ctx.file(name)], { type: "image/jpeg" }), name);
      fd.append("media_category", "tweet_image");
      const m = await http(url, { method: "POST", tries: 1, headers: { Authorization: oauth1("POST", url, keys) }, body: fd });
      ids.push((m.data && m.data.id) || m.media_id_string);
    }
    const url = "https://api.x.com/2/tweets";
    const t = await http(url, { method: "POST", headers: { Authorization: oauth1("POST", url, keys), "Content-Type": "application/json" },
      body: JSON.stringify({ text: caption(post, "x"), media: { media_ids: ids } }) });
    return { id: t.data.id, url: `https://x.com/i/status/${t.data.id}` };
  }
};

// ---------------------------------------------------------------- Pinterest

export const pinterest = {
  name: "pinterest",
  needs: ["PINTEREST_BOARD_ID", "PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REFRESH_TOKEN"],
  cap: (env) => Number(env.PINTEREST_PER_DAY || 10),
  async publish(post, ctx) {
    const { env, state } = ctx;
    const seed = env.PINTEREST_REFRESH_TOKEN.slice(-12);
    let t = state.tokens.pinterest;
    if (!t || t.seed !== seed) t = state.tokens.pinterest = { refresh: env.PINTEREST_REFRESH_TOKEN, seed };
    if (!t.access || t.expires - Date.now() < 86400000) {
      const j = await http("https://api.pinterest.com/v5/oauth/token", { method: "POST", retry: true,
        headers: { Authorization: "Basic " + Buffer.from(env.PINTEREST_APP_ID + ":" + env.PINTEREST_APP_SECRET).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ grant_type: "refresh_token", refresh_token: t.refresh }) });
      Object.assign(t, { access: j.access_token, expires: Date.now() + (j.expires_in || 2592000) * 1000, refresh: j.refresh_token || t.refresh });
    }
    const pin = await http("https://api.pinterest.com/v5/pins", { method: "POST", headers: { Authorization: "Bearer " + t.access, "Content-Type": "application/json" },
      body: JSON.stringify({ board_id: env.PINTEREST_BOARD_ID, title: pinTitle(post), description: caption(post, "pinterest"), link: linkFor(post, "pinterest"),
        alt_text: alt(post).slice(0, 500), media_source: { source_type: "image_url", url: ctx.url(post.media.image) } }) });
    return { id: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` };
  }
};

// ---------------------------------------------------------------- Telegram

export const telegram = {
  name: "telegram",
  needs: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
  cap: () => 30,
  async publish(post, ctx) {
    const api = (m, body) => http(`https://api.telegram.org/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: ctx.env.TELEGRAM_CHAT_ID, ...body }) });
    const text = caption(post, "telegram");
    let r;
    if (post.media.video) r = await api("sendVideo", { video: ctx.url(post.media.video), caption: text, width: 1080, height: 1920, supports_streaming: true });
    else if (post.media.slides && post.media.slides.length > 1) r = await api("sendMediaGroup", { media: post.media.slides.slice(0, 10).map((s, i) => ({ type: "photo", media: ctx.url(s), ...(i ? {} : { caption: text }) })) });
    else r = await api("sendPhoto", { photo: ctx.url(post.media.image), caption: text });
    const msg = Array.isArray(r.result) ? r.result[0] : r.result;
    const chat = String(ctx.env.TELEGRAM_CHAT_ID);
    return { id: msg && msg.message_id, url: chat.startsWith("@") && msg ? `https://t.me/${chat.slice(1)}/${msg.message_id}` : null };
  }
};

// ---------------------------------------------------------------- Discord

export const discord = {
  name: "discord",
  needs: ["DISCORD_WEBHOOK_URL"],
  cap: () => 30,
  async publish(post, ctx) {
    const color = parseInt(String(post.color || "#cc9933").replace("#", ""), 16) || 0xcc9933;
    const r = await http(ctx.env.DISCORD_WEBHOOK_URL + (ctx.env.DISCORD_WEBHOOK_URL.includes("?") ? "&" : "?") + "wait=true", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [{ title: (post.emoji ? post.emoji + " " : "") + post.title.slice(0, 240), description: caption(post, "discord").slice(0, 4000),
        url: linkFor(post, "discord") || undefined, color, image: { url: ctx.url(post.media.image) }, timestamp: new Date().toISOString() }] })
    });
    return { id: r.id, url: null };
  }
};
