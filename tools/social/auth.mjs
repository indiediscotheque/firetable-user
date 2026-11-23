#!/usr/bin/env node
// One-time sign-in for the platforms that need OAuth: prints the keys to save
// as repository secrets (Settings → Secrets and variables → Actions).
//
//   node tools/social/auth.mjs instagram|threads|facebook|tiktok|pinterest
//
// Each needs its app's id and secret in the environment (below), and the
// app's redirect address set to REDIRECT_URI (default: the site's home page,
// https://www.indiediscotheque.com/). It prints a link: open it, allow the
// app, and paste back the address the browser lands on (it has ?code= in it).
//
//   instagram  INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET   (Meta app → Instagram → API setup with Instagram login)
//   threads    THREADS_APP_ID, THREADS_APP_SECRET       (Meta app with the Threads use case)
//   facebook   FACEBOOK_APP_ID, FACEBOOK_APP_SECRET     (Meta app → Facebook Login for Business); prints each Page's
//              token, and the Instagram account linked to the Page: Instagram through Facebook Login
//              is what can add licensed music to Reels (use it instead of "instagram")
//   tiktok     TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET  (developers.tiktok.com app with Login Kit and Content Posting API)
//   pinterest  PINTEREST_APP_ID, PINTEREST_APP_SECRET   (developers.pinterest.com app); lists your boards
//
// YouTube uses the same keys as firetable-hostbot: its tools/youtube-auth.js.
// Never deployed (tools/).

import { createInterface } from "readline/promises";
import { randomBytes } from "crypto";
import { http, form } from "./util.mjs";

const env = process.env;
const REDIRECT = env.REDIRECT_URI || "https://www.indiediscotheque.com/";
const V = env.GRAPH_API_VERSION || "v23.0";
const need = (...keys) => {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) { console.error("Set " + missing.join(", ") + " first (see the top of this file)."); process.exit(2); }
};
const qs = (o) => new URLSearchParams(o).toString();

async function codeFrom(url) {
  console.log("\n1. Open this link and allow the app:\n\n   " + url + "\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const back = (await rl.question("2. Paste the address your browser landed on: ")).trim();
  rl.close();
  const code = new URL(back).searchParams.get("code");
  if (!code) throw new Error("no ?code= in that address");
  return code.replace(/#_$/, "");
}

const show = (o) => {
  console.log("\nSave these as repository secrets:\n");
  for (const [k, v] of Object.entries(o)) console.log(`   ${k}=${v}`);
  console.log("");
};

const FLOWS = {
  async instagram() {
    need("INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET");
    const code = await codeFrom("https://www.instagram.com/oauth/authorize?" + qs({ client_id: env.INSTAGRAM_APP_ID, redirect_uri: REDIRECT, response_type: "code",
      scope: "instagram_business_basic,instagram_business_content_publish" }));
    const short = await http("https://api.instagram.com/oauth/access_token", { method: "POST", body: form({
      client_id: env.INSTAGRAM_APP_ID, client_secret: env.INSTAGRAM_APP_SECRET, grant_type: "authorization_code", redirect_uri: REDIRECT, code }) });
    const long = await http("https://graph.instagram.com/access_token?" + qs({ grant_type: "ig_exchange_token", client_secret: env.INSTAGRAM_APP_SECRET, access_token: short.access_token }));
    const me = await http("https://graph.instagram.com/" + V + "/me?" + qs({ fields: "user_id,username", access_token: long.access_token }));
    console.log(`\nSigned in as @${me.username}. The token lasts 60 days; the workflow renews it every week.`);
    show({ INSTAGRAM_TOKEN: long.access_token, INSTAGRAM_USER_ID: me.user_id || short.user_id });
  },
  async threads() {
    need("THREADS_APP_ID", "THREADS_APP_SECRET");
    const code = await codeFrom("https://threads.net/oauth/authorize?" + qs({ client_id: env.THREADS_APP_ID, redirect_uri: REDIRECT, response_type: "code", scope: "threads_basic,threads_content_publish" }));
    const short = await http("https://graph.threads.net/oauth/access_token", { method: "POST", body: form({
      client_id: env.THREADS_APP_ID, client_secret: env.THREADS_APP_SECRET, grant_type: "authorization_code", redirect_uri: REDIRECT, code }) });
    const long = await http("https://graph.threads.net/access_token?" + qs({ grant_type: "th_exchange_token", client_secret: env.THREADS_APP_SECRET, access_token: short.access_token }));
    show({ THREADS_TOKEN: long.access_token, THREADS_USER_ID: short.user_id });
  },
  async facebook() {
    need("FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET");
    const code = await codeFrom(`https://www.facebook.com/${V}/dialog/oauth?` + qs({ client_id: env.FACEBOOK_APP_ID, redirect_uri: REDIRECT, response_type: "code",
      scope: "pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish" }));
    const short = await http(`https://graph.facebook.com/${V}/oauth/access_token?` + qs({ client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, redirect_uri: REDIRECT, code }));
    const long = await http(`https://graph.facebook.com/${V}/oauth/access_token?` + qs({ grant_type: "fb_exchange_token", client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, fb_exchange_token: short.access_token }));
    // a Page token from a long-lived user token doesn't expire
    const pages = await http(`https://graph.facebook.com/${V}/me/accounts?` + qs({ fields: "id,name,access_token,instagram_business_account{id,username}", access_token: long.access_token }));
    if (!(pages.data || []).length) throw new Error("no Pages on this account (or the app wasn't allowed to see them)");
    for (const p of pages.data) {
      console.log(`\nPage "${p.name}":`);
      const igAcc = p.instagram_business_account;
      show({ FACEBOOK_PAGE_ID: p.id, FACEBOOK_PAGE_TOKEN: p.access_token, ...(igAcc ? { INSTAGRAM_USER_ID: igAcc.id, INSTAGRAM_TOKEN: p.access_token } : {}) });
      if (igAcc) console.log(`   and the repository variable INSTAGRAM_GRAPH_HOST=graph.facebook.com (Instagram @${igAcc.username}, with licensed music for Reels)\n`);
      else console.log("   (no Instagram account linked to this Page: link one in the Page's settings for Reels with music)\n");
    }
  },
  async tiktok() {
    need("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET");
    const code = await codeFrom("https://www.tiktok.com/v2/auth/authorize/?" + qs({ client_key: env.TIKTOK_CLIENT_KEY, response_type: "code", redirect_uri: REDIRECT,
      scope: "user.info.basic,video.upload,video.publish", state: randomBytes(8).toString("hex") }));
    const t = await http("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({
      client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, code: decodeURIComponent(code), grant_type: "authorization_code", redirect_uri: REDIRECT }) });
    if (!t.refresh_token) throw new Error("TikTok said: " + JSON.stringify(t));
    console.log("\nThe refresh token lasts a year; the workflow keeps the newest one it's given.");
    show({ TIKTOK_REFRESH_TOKEN: t.refresh_token });
  },
  async pinterest() {
    need("PINTEREST_APP_ID", "PINTEREST_APP_SECRET");
    const code = await codeFrom("https://www.pinterest.com/oauth/?" + qs({ client_id: env.PINTEREST_APP_ID, redirect_uri: REDIRECT, response_type: "code", scope: "boards:read,pins:read,pins:write" }));
    const t = await http("https://api.pinterest.com/v5/oauth/token", { method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(env.PINTEREST_APP_ID + ":" + env.PINTEREST_APP_SECRET).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT }) });
    const boards = await http("https://api.pinterest.com/v5/boards?page_size=100", { headers: { Authorization: "Bearer " + t.access_token } });
    console.log("\nYour boards (pick one for PINTEREST_BOARD_ID):");
    for (const b of boards.items || []) console.log(`   ${b.id}  ${b.name}`);
    show({ PINTEREST_REFRESH_TOKEN: t.refresh_token, PINTEREST_BOARD_ID: (boards.items || [])[0]?.id || "<a board id from the list>" });
  }
};

const which = process.argv[2];
if (!FLOWS[which]) { console.error("Usage: node tools/social/auth.mjs " + Object.keys(FLOWS).join("|")); process.exit(2); }
await FLOWS[which]().catch((err) => { console.error("\n" + err.message); process.exit(1); });
