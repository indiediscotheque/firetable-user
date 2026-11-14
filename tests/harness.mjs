// Shared setup for the browser tests (smoke.mjs, rules.mjs): serves this site
// locally under the real Content-Security-Policy from .htaccess, with a
// config.js that points at the local Firebase emulators. Never deployed.
import http from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname, normalize } from "path";
import { fileURLToPath } from "url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DB = "http://127.0.0.1:9000";
export const AUTH = "http://127.0.0.1:9099";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The policy the server sends, plus the local emulators. upgrade-insecure-requests
 * is dropped: these tests run over plain http on 127.0.0.1.
 */
export function policy({ auth = false } = {}) {
  const htaccess = readFileSync(join(ROOT, ".htaccess"), "utf8");
  return htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/)[1]
    .replace("connect-src ", "connect-src " + DB + " ws://127.0.0.1:9000 " + (auth ? AUTH + " " : ""))
    .replace("script-src ", "script-src " + DB + " ")
    .replace(/;\s*upgrade-insecure-requests/, "");
}

/** config.js lives only on the server; this one points at the emulator's namespace `ns`. */
export function config(ns) {
  const example = readFileSync(join(ROOT, "config.js.example"), "utf8");
  return example
    .replace(/firebase:\s*\{[\s\S]*?\}/, `firebase: { apiKey: "fake-key", authDomain: "${ns}.firebaseapp.com", databaseURL: "${DB}?ns=${ns}" }`)
    .replace(/youtubeKey: "[^"]*"/, 'youtubeKey: "no-yt-key"');
}

/** Write `value` at `path` in namespace `ns`, as the database owner (rules don't apply). */
export const putAs = (ns) => (path, value) =>
  fetch(DB + path + ".json?ns=" + ns, { method: "PUT", headers: { Authorization: "Bearer owner" }, body: JSON.stringify(value) });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".gif": "image/gif" };

/**
 * Serve the site on a free port.
 * @returns {Promise<{server: http.Server, SITE: string}>}
 */
export async function serveSite({ csp, configJs }) {
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const headers = { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" };
    if (path === "/config.js") { res.writeHead(200, { ...headers, "Content-Type": "text/javascript" }); return res.end(configJs); }
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || /[\\/](tests|node_modules|\.git)([\\/]|$)/.test(file.slice(ROOT.length))) { res.writeHead(404); return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, SITE: "http://127.0.0.1:" + server.address().port + "/" };
}

/** Chromium options: through the HTTPS proxy when there is one (CDN files), never for the local servers. */
export const launchOptions = () =>
  process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {};
