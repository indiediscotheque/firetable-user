// Bluesky, Mastodon, X, Pinterest, Telegram and Discord: pictures (a song's
// 4:5 card, or a list's hook and list slides). Their videos would be silent, as
// music is only added in the apps that license it.
//
// Bluesky:   BLUESKY_HANDLE, BLUESKY_APP_PASSWORD (Settings → Privacy and
//            security → App passwords); BLUESKY_SERVICE if the account isn't on bsky.social
// Mastodon:  MASTODON_URL (the server, e.g. https://mastodon.social), MASTODON_TOKEN
//            (Preferences → Development → New application, scope write:statuses write:media).
//            Tick "This is an automated account" in the profile; some servers
//            limit bots' posts (Hachyderm: 5 a day) or want a tag (SOCIAL_MASTODON_TAGS)
// X:         X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (an app with
//            read and write access at developer.x.com). The link goes in a reply
// Pinterest: PINTEREST_BOARD_ID and PINTEREST_APP_ID, PINTEREST_APP_SECRET,
//            PINTEREST_REFRESH_TOKEN (tools/social/auth.mjs pinterest)
// Telegram:  TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_CHAT_ID (the channel,
//            e.g. @indiediscotheque, with the bot as an admin)
// Discord:   DISCORD_WEBHOOK_URL (channel → Edit → Integrations → Webhooks)
// Never deployed (tools/).

import { createHmac, randomBytes } from "crypto";
import sharp from "sharp";
import { http, form, sleep } from "../util.mjs";
import { caption, blueskyFacets, pinTitle, linkFor, altText, xReply } from "../captions.mjs";

const alt = altText;
/** The pictures for a platform that takes four: a list's hook and its list slides; else the one picture. */
const four = (post) => (post.media.glance && post.media.glance.length > 1 ? post.media.glance : [post.media.image]).slice(0, 4);

// ---------------------------------------------------------------- Bluesky

/** Bluesky takes pictures up to about 1 MB: smaller JPEGs until it fits. */
async function underMB(buf) {
  for (let q = 88; buf.length > 950000 && q >= 50; q -= 8) buf = await sharp(buf).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  return buf;
}

export const bluesky = {
  name: "bluesky",
  needs: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"],
  async publish(post, ctx) {
    const service = (ctx.env.BLUESKY_SERVICE || "https://bsky.social").replace(/\/$/, "");
    const s = await http(service + "/xrpc/com.atproto.server.createSession", { method: "POST", retry: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: ctx.env.BLUESKY_HANDLE, password: ctx.env.BLUESKY_APP_PASSWORD }) });
    const pds = ((s.didDoc && s.didDoc.service) || []).find((x) => x.type === "AtprotoPersonalDataServer")?.serviceEndpoint?.replace(/\/$/, "") || service;
    const auth = { Authorization: "Bearer " + s.accessJwt };
    const text = caption(post, "bluesky");
    const facets = await blueskyFacets(text, async (handle) => (await http("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=" + encodeURIComponent(handle), { tries: 1 })).did);
    let embed;
    if (post.targets === "song" && post.listen) {
      // a song: its own video as the card, with our picture on it; Bluesky plays YouTube in the post
      const thumb = await http(pds + "/xrpc/com.atproto.repo.uploadBlob", { method: "POST", retry: true, headers: { ...auth, "Content-Type": "image/jpeg" }, body: await underMB(await ctx.file(post.media.image)) });
      embed = { $type: "app.bsky.embed.external", external: { uri: post.listen, title: post.title.slice(0, 300), description: post.hook.slice(0, 1000), thumb: thumb.blob } };
    }
    const images = [];
    for (const name of embed ? [] : four(post)) {
      const buf = await underMB(await ctx.file(name));
      const b = await http(pds + "/xrpc/com.atproto.repo.uploadBlob", { method: "POST", retry: true, headers: { ...auth, "Content-Type": "image/jpeg" }, body: buf });
      images.push({ image: b.blob, alt: alt(post).slice(0, 1000), aspectRatio: { width: 1080, height: 1350 } });
    }
    embed = embed || { $type: "app.bsky.embed.images", images };
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
  async publish(post, ctx) {
    const base = ctx.env.MASTODON_URL.replace(/\/$/, "");
    const auth = { Authorization: "Bearer " + ctx.env.MASTODON_TOKEN };
    const files = four(post).map((f) => [f, "image/jpeg"]);
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
      body: JSON.stringify({ status: caption(post, "mastodon") + (ctx.env.SOCIAL_MASTODON_TAGS ? " " + ctx.env.SOCIAL_MASTODON_TAGS : ""), media_ids: ids, visibility: "public", language: "en" }) });
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
  async publish(post, ctx) {
    const keys = { key: ctx.env.X_API_KEY, secret: ctx.env.X_API_SECRET, token: ctx.env.X_ACCESS_TOKEN, tokenSecret: ctx.env.X_ACCESS_SECRET };
    const ids = [];
    for (const name of four(post)) {
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
    // the link in a reply: X shows posts with links to fewer people
    try {
      await http(url, { method: "POST", headers: { Authorization: oauth1("POST", url, keys), "Content-Type": "application/json" },
        body: JSON.stringify({ text: xReply(post), reply: { in_reply_to_tweet_id: t.data.id } }) });
    } catch (err) { ctx.log("x: posted, but the reply with the link failed: " + err.message); }
    return { id: t.data.id, url: `https://x.com/i/status/${t.data.id}` };
  }
};

// ---------------------------------------------------------------- Pinterest

export const pinterest = {
  name: "pinterest",
  needs: ["PINTEREST_BOARD_ID", "PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REFRESH_TOKEN"],
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
  async publish(post, ctx) {
    const api = (m, body) => http(`https://api.telegram.org/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: ctx.env.TELEGRAM_CHAT_ID, ...body }) });
    const text = caption(post, "telegram");
    let r;
    if (post.media.slides && post.media.slides.length > 1) r = await api("sendMediaGroup", { media: post.media.slides.slice(0, 10).map((s, i) => ({ type: "photo", media: ctx.url(s), ...(i ? {} : { caption: text }) })) });
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
  async publish(post, ctx) {
    const color = parseInt(String(post.color || "#cc9933").replace("#", ""), 16) || 0xcc9933;
    const r = await http(ctx.env.DISCORD_WEBHOOK_URL + (ctx.env.DISCORD_WEBHOOK_URL.includes("?") ? "&" : "?") + "wait=true", {
      method: "POST", headers: { "Content-Type": "application/json" },
      // the song's video as a link of its own: Discord shows its player
      body: JSON.stringify({ content: post.listen || undefined, embeds: [{ title: (post.emoji ? post.emoji + " " : "") + post.title.slice(0, 240), description: caption(post, "discord").slice(0, 4000),
        url: linkFor(post, "discord") || undefined, color, image: { url: ctx.url(post.media.image) }, timestamp: new Date().toISOString() }] })
    });
    return { id: r.id, url: null };
  }
};
