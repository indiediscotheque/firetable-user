// The post kit: what a person posts from their phone, because the music has to
// come from each app's own licensed sound picker and the apps don't let other
// software add it (YouTube, Facebook, TikTok, Instagram Stories; Instagram
// Reels when the song isn't in the API's library).
//
// One message to a private channel with the video and the Story picture
// (save them to the phone), the sound to pick, and each platform's caption
// ready to copy, in the order to post them.
//
//   STUDIO_DISCORD_WEBHOOK   a webhook on a private Discord channel
//   STUDIO_TELEGRAM_CHAT_ID  and/or a Telegram chat with the bot (TELEGRAM_BOT_TOKEN):
//                            message the bot, then use your chat id (@userinfobot shows it)
// Never deployed (tools/).

import { http } from "../util.mjs";
import { caption, youtubeTitle, linkFor } from "../captions.mjs";

const MB = 1024 * 1024;

/** The steps, from what the post is and what's already gone out by itself. */
export function kit(post) {
  const p = post.platforms || {};
  const done = (n) => p[n] && p[n].status === "done";
  const sound = post.sound ? `"${post.sound.title}" by ${post.sound.artist}${post.sound.note ? ` (${post.sound.note})` : ""}` : null;
  const steps = [];
  if (post.media.video) {
    if (!done("instagram")) {
      steps.push({ where: "Instagram Reel", how: `New Reel → the video → Add audio → search ${sound}, start on the hook → paste the caption → Share. Turn on "Trial" for a daily song, so it's shown to non-followers first.`, text: caption(post, "instagram") });
    }
    steps.push({ where: "Instagram Story", how: `New Story → the Story picture → the music sticker → ${sound} → the link sticker: ${linkFor(post, "instagram_story")}` });
    steps.push({ where: "TikTok", how: p.tiktok && p.tiktok.status === "done" ? `It's in your TikTok inbox → Add sound → ${sound} → paste the caption → Post.` : `Upload the video → Add sound → ${sound} → paste the caption → Post.`, text: caption(post, "tiktok") });
    steps.push({ where: "YouTube Short", how: `Create → Short → upload the video → Add sound → ${sound} → title and description below.`, text: youtubeTitle(post) + "\n\n" + caption(post, "youtube") });
    steps.push({ where: "Facebook Reel", how: `Create → Reel → the video → Music → ${sound} → paste the caption.`, text: caption(post, "facebook") });
  }
  return { sound, steps };
}

export const studio = {
  name: "studio",
  needs: [],
  ready: (env) => !!(env.STUDIO_DISCORD_WEBHOOK || (env.STUDIO_TELEGRAM_CHAT_ID && env.TELEGRAM_BOT_TOKEN)),
  async publish(post, ctx) {
    const { env } = ctx;
    // an Instagram Reel still trying through the API goes to the kit now, so it's never posted twice
    const ig = post.platforms && post.platforms.instagram;
    if (ig && ig.status === "pending" && post.targets === "song") Object.assign(ig, { status: "handoff", error: "posted from the kit" });
    const k = kit(post);
    if (!k.steps.length) return { id: null, url: null };
    const head = `🎬 **Post kit: ${post.title}**\n${k.sound ? `🎵 Sound: ${k.sound}\n` : ""}Save the video and the Story picture, then post in this order:`;
    const video = await ctx.file(post.media.video);
    const story = await ctx.file(post.media.story);
    let id = null;
    if (env.STUDIO_DISCORD_WEBHOOK) {
      const fd = new FormData();
      const embeds = k.steps.map((s, i) => ({ title: `${i + 1}. ${s.where}`, description: (s.how + (s.text ? "\n\n" + s.text : "")).slice(0, 4000), color: 0xcc9933 }));
      fd.append("payload_json", JSON.stringify({ content: head.replace(/\*\*/g, "**"), embeds: embeds.slice(0, 10) }));
      // Discord takes files up to 10 MB without a boost: bigger ones go as links
      if (video.length < 9.5 * MB) fd.append("files[0]", new Blob([video], { type: "video/mp4" }), post.media.video);
      fd.append("files[1]", new Blob([story], { type: "image/jpeg" }), post.media.story);
      const r = await http(env.STUDIO_DISCORD_WEBHOOK + (env.STUDIO_DISCORD_WEBHOOK.includes("?") ? "&" : "?") + "wait=true", { method: "POST", body: fd, timeout: 300000 });
      if (video.length >= 9.5 * MB) await http(env.STUDIO_DISCORD_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "The video: " + ctx.url(post.media.video) }) });
      id = r.id;
    }
    if (env.STUDIO_TELEGRAM_CHAT_ID && env.TELEGRAM_BOT_TOKEN) {
      const api = (m, body) => http(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.STUDIO_TELEGRAM_CHAT_ID, ...body }) });
      await api("sendVideo", { video: ctx.url(post.media.video), caption: head.replace(/\*\*/g, ""), width: 1080, height: 1920, supports_streaming: true });
      await api("sendPhoto", { photo: ctx.url(post.media.story), caption: "The Story picture" });
      // one message a step, so each caption is a single tap to copy
      for (const [i, s] of k.steps.entries()) await api("sendMessage", { text: `${i + 1}. ${s.where}\n${s.how}` + (s.text ? "\n\n" + s.text : ""), disable_web_page_preview: true });
    }
    return { id, url: null };
  }
};
