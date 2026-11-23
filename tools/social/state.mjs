// What the social posting remembers between runs: what's been posted (so
// nothing goes out twice), the queue of posts still going out to some
// platforms, what went where this past week (the budgets in run.mjs), the
// platforms' refreshed tokens, and the lookups (lookup.mjs).
//
// One JSON file. The workflow keeps it on the web server, outside the site's
// folder (never served), and fetches it before each run and puts it back after.
// Never deployed (tools/).

import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";

const DAY = 86400000;

export function emptyState() {
  return { v: 1, posted: {}, queue: [], sent: [], daily: {}, tokens: {}, cache: {}, media: [], seeded: {}, last: {} };
}

export function loadState(file) {
  if (!file || !existsSync(file)) return emptyState();
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    return { ...emptyState(), ...s };
  } catch (err) {
    throw new Error(`the state file ${file} isn't readable JSON (${err.message}); fix or delete it`);
  }
}

/** Save, dropping what's too old to matter. */
export function saveState(file, s, now = Date.now()) {
  for (const [k, v] of Object.entries(s.posted)) if (now - (v.at || 0) > 400 * DAY) delete s.posted[k];
  for (const [k, v] of Object.entries(s.cache)) if (now - (v.at || 0) > 45 * DAY) delete s.cache[k];
  for (const k of Object.keys(s.daily)) if (now - Date.parse(k + "T00:00:00Z") > 14 * DAY) delete s.daily[k];
  s.queue = s.queue.filter((q) => now - q.at < 3 * DAY);
  s.sent = (s.sent || []).filter((x) => now - x.at < 8 * DAY);
  writeFileSync(file + ".tmp", JSON.stringify(s, null, 1));
  renameSync(file + ".tmp", file);
}

export const wasPosted = (s, id) => !!s.posted[id];
export function markPosted(s, id, extra = {}, now = Date.now()) { s.posted[id] = { at: now, ...extra }; }

/** Today's count of something (a kind, or a platform's uploads). */
export const today = (s, date, what) => (s.daily[date] && s.daily[date][what]) || 0;
export function count(s, date, what, n = 1) {
  s.daily[date] = s.daily[date] || {};
  s.daily[date][what] = (s.daily[date][what] || 0) + n;
}
