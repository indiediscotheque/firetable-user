// Minify the site's own scripts and stylesheets for publishing. The source
// stays readable; the deploy runs this on its copy of the site after
// flattening the stylesheets (tools/flatten-css.mjs) and before versioning
// links (.github/scripts/cache-bust.py), so each ?v= is the hash of what's
// actually served. About 40% less to download, the same code.
//
//   node tools/minify.mjs            minify every published script and stylesheet in place
//   node tools/minify.mjs --maps     the same, and give each script a source map
//   node tools/minify.mjs --check    minify in memory and fail if any file can't be
//
// Each file stays its own file (no bundling): scripts keep their own strict
// mode, top-level names (the globals the files share) and document.currentScript,
// and one script failing still leaves the others running. Only local names are
// shortened. Nothing newer than the oldest browser the site supports (Safari 15.4,
// iPadOS 15) is introduced. Licence comments (/*! ... */) are kept.
// Already-minified libraries (*.min.js) and the service worker (sw.js) are
// left as they are. Each file keeps its modification time, so the deploy's
// upload still compares it by its last commit. Never deployed (tools/).
//
// Source maps (--maps, as the deploy runs it): js/chat.js gets js/chat.js.map
// beside it (the source inside it), linked from its last line with the map's
// own hash as its ?v=, so the browser's tools show the readable source, and
// the weekly Site health report (firetable-hostbot tools/site-health.js) can
// say which line of the source an error from a visitor's browser is on. The
// maps aren't in git (.gitignore); the deploy uploads them with the scripts.
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, statSync, utimesSync } from "fs";
import { basename } from "path";
import { pathToFileURL } from "url";
import { transform } from "esbuild";

const TARGET = ["safari15.4"];

/** The site's published scripts and stylesheets that get minified. */
export function minifiable() {
  return execFileSync("git", ["ls-files", "*.js", "*.css"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !/^(tests|docs|tools|node_modules|\.github)\//.test(f) && !/\.min\.js$/.test(f) && f !== "sw.js");
}

/**
 * One file minified, as it's published.
 * @param {string} file - its path in the repo ("js/chat.js")
 * @param {string} src - its contents
 * @param {{map?: boolean}} [opts] - also make a source map (scripts only)
 * @returns {Promise<{code: string, map: string|null}>}
 */
export async function minified(file, src, opts = {}) {
  const css = file.endsWith(".css");
  const map = !!opts.map && !css;
  const result = await transform(src, {
    loader: css ? "css" : "js",
    minify: true,
    target: TARGET,
    legalComments: "inline",
    sourcefile: file,
    sourcemap: map ? "external" : false,
    logLevel: "silent"
  });
  if (!map) return { code: result.code, map: null };
  const hash = createHash("sha256").update(result.map).digest("hex").slice(0, 10);
  return { code: result.code + "//# sourceMappingURL=" + basename(file) + ".map?v=" + hash + "\n", map: result.map };
}

async function main() {
  const check = process.argv.includes("--check");
  const maps = process.argv.includes("--maps");
  const files = minifiable();
  let failed = 0, before = 0, after = 0, mapped = 0;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let out;
    try {
      out = await minified(file, src, { map: maps });
    } catch (e) {
      console.error(file + ": " + (e.errors && e.errors.length ? e.errors.map((x) => x.text).join("; ") : e.message));
      failed++;
      continue;
    }
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(out.code);
    if (check || out.code === src) continue;
    const { atime, mtime } = statSync(file);
    writeFileSync(file, out.code);
    utimesSync(file, atime, mtime);
    if (out.map) {
      writeFileSync(file + ".map", out.map);
      utimesSync(file + ".map", atime, mtime);
      mapped++;
    }
  }
  const kb = (n) => Math.round(n / 1024) + " KB";
  console.log((check ? "Would minify " : "Minified ") + (files.length - failed) + " of " + files.length +
    " scripts and stylesheets: " + kb(before) + " → " + kb(after) + (mapped ? ", with " + mapped + " source maps" : "") + (failed ? "; " + failed + " failed" : "") + ".");
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
