// The room's public data, read the way tools/plain-pages.mjs reads it: the
// database address and the room's name from the site's own config.js, then
// the public paths over the Realtime Database's REST API. No secrets.
// Never deployed (tools/).

import { http } from "./util.mjs";

/** @returns {Promise<{site: string, db: string, room: string, read: (path: string, query?: string) => Promise<any>}>} */
export async function connect(siteUrl) {
  const site = String(siteUrl || "").replace(/\/?$/, "/");
  if (!/^https?:\/\//.test(site)) throw new Error("Give the site's address: --site https://example.com/ (or SITE_URL)");
  const config = await http(site + "config.js", { headers: { Accept: "text/javascript" } });
  const pick = (re) => (String(config).match(re) || [])[1];
  const db = String(process.env.FIREBASE_DATABASE_URL || pick(/databaseURL:\s*["']([^"']+)["']/) || "").replace(/\/$/, "");
  const room = pick(/roomName:\s*["']([^"']+)["']/) || "the room";
  if (!db) throw new Error("no databaseURL in " + site + "config.js");
  const read = async (path, query = "") => {
    const url = new URL(db);
    url.pathname = url.pathname.replace(/\/$/, "") + "/" + path.split("/").map(encodeURIComponent).join("/") + ".json";
    if (query) for (const [k, v] of new URLSearchParams(query)) url.searchParams.set(k, v);
    return http(url.href, { okStatuses: [404] });
  };
  return { site, db, room, read };
}

/** Who's in the room right now (signed-in people whose status is on), without the robots. */
export async function online(data, bots) {
  const users = (await data.read("users", 'orderBy="status"&equalTo=true')) || {};
  return Object.entries(users).filter(([, u]) => u && u.status === true && !bots.has(String(u.username || "").toLowerCase()))
    .map(([id, u]) => ({ id, name: u.username || "someone", idle: !!u.idle }));
}
