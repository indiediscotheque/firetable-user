#!/usr/bin/env node
// Build the chat's emoji data as two small files this site serves itself
// (never deployed: tools/ is skipped). Run it when moving to a newer Emoji
// version (keep js/twemoji.js on the same one), then commit the two files:
//
//   node tools/build-emoji.mjs
//
// js/emoji-map.json: every :shortname: the chat understands, to its emoji. The
//   site reads it on every page (chat, the theme, notices), so it's kept small.
// js/emoji-picker.json: the picker's groups, each emoji with its search words.
//   Read only when someone first opens the picker (members only).
//
// The sources are pinned to exact versions and checked against their
// Subresource Integrity hashes, so a changed file on the CDN fails the build.
import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCES = {
  // the emoji themselves, by group (Emoji 17.0)
  groups: { url: "https://unpkg.com/unicode-emoji-json@0.9.0/data-by-group.json", integrity: "sha384-BHUZGp3aPuJFNoJr+570U5rYE7MyCXiYJle7rjt1pzyMeGM5mEUsxcL88ZVRjAvz" },
  // emojilib v2: the old shortnames (:smile:, :+1:) people still type
  oldLib: { url: "https://unpkg.com/emojilib@2.4.0/emojis.json", integrity: "sha384-uPYLJyYHqrmSMGbd6WnbkvIvF3ta0lPsa9FU0u5mU/ea8G11HlacTMpr2IyplN2d" },
  // emojilib v4: search keywords for the picker
  keywords: { url: "https://unpkg.com/emojilib@4.0.3/dist/emoji-en-US.json", integrity: "sha384-BXnUdYkXV4Grqd72PWIbgz6IdTWDSuv+ced8DStGuk1h0Rpvn2GYzVUcCqU/kC50" }
};
// Shortnames Unicode has since renamed, so old messages and habits still work
const RENAMED = {
  hugging_face: "smiling_face_with_open_hands",
  knocked_out_face: "face_with_crossed_out_eyes",
  pouting_face: "enraged_face",
  flag_turkey: "flag_turkiye"
};

async function get({ url, integrity }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ": " + res.status);
  const body = Buffer.from(await res.arrayBuffer());
  const hash = "sha384-" + createHash("sha384").update(body).digest("base64");
  if (hash !== integrity) throw new Error(url + " doesn't match its integrity hash (" + hash + ")");
  return JSON.parse(body.toString("utf8"));
}

const [groups, oldLib, keywords] = await Promise.all([get(SOURCES.groups), get(SOURCES.oldLib), get(SOURCES.keywords)]);

// emoji -> its old v2 shortname
const oldName = {};
for (const slug of Object.keys(oldLib)) oldName[oldLib[slug].char] = slug;

const map = {};
const picker = [];
for (const g of groups) {
  const list = g.emojis || [];
  if (!list.length) continue;
  const out = [];
  for (const e of list) {
    map[e.slug] = e.emoji;
    const words = (keywords[e.emoji] || []).slice();
    if (oldName[e.emoji]) words.push(oldName[e.emoji]);
    out.push([e.emoji, e.slug, words.join(",")]);
  }
  picker.push({ slug: g.slug, name: g.name, emojis: out });
}
// the old names win where they clash, as people have always typed them
for (const emoji of Object.keys(oldName)) map[oldName[emoji]] = emoji;
for (const [from, to] of Object.entries(RENAMED)) if (map[to] && !Object.prototype.hasOwnProperty.call(map, from)) map[from] = map[to];

writeFileSync(ROOT + "js/emoji-map.json", JSON.stringify(map) + "\n");
writeFileSync(ROOT + "js/emoji-picker.json", JSON.stringify(picker) + "\n");
console.log(Object.keys(map).length + " shortnames, " + picker.reduce((n, g) => n + g.emojis.length, 0) + " emoji in " + picker.length + " groups");
