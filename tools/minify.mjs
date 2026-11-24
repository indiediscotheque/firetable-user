// Minify the site's own scripts and stylesheets for publishing. The source
// stays readable; the deploy runs this on its copy of the site after
// flattening the stylesheets (tools/flatten-css.mjs) and before versioning
// links (.github/scripts/cache-bust.py), so each ?v= is the hash of what's
// actually served. About 40% less to download, the same code.
//
//   node tools/minify.mjs            minify every published script and stylesheet in place
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
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, statSync, utimesSync } from "fs";
import { transform } from "esbuild";

const TARGET = ["safari15.4"];
const check = process.argv.includes("--check");
const files = execFileSync("git", ["ls-files", "*.js", "*.css"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/^(tests|docs|tools|node_modules|\.github)\//.test(f) && !/\.min\.js$/.test(f) && f !== "sw.js");

let failed = 0, before = 0, after = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  let out;
  try {
    const result = await transform(src, {
      loader: file.endsWith(".css") ? "css" : "js",
      minify: true,
      target: TARGET,
      legalComments: "inline",
      sourcefile: file,
      logLevel: "silent"
    });
    out = result.code;
  } catch (e) {
    console.error(file + ": " + (e.errors && e.errors.length ? e.errors.map((x) => x.text).join("; ") : e.message));
    failed++;
    continue;
  }
  before += Buffer.byteLength(src);
  after += Buffer.byteLength(out);
  if (check || out === src) continue;
  const { atime, mtime } = statSync(file);
  writeFileSync(file, out);
  utimesSync(file, atime, mtime);
}
const kb = (n) => Math.round(n / 1024) + " KB";
console.log((check ? "Would minify " : "Minified ") + (files.length - failed) + " of " + files.length +
  " scripts and stylesheets: " + kb(before) + " → " + kb(after) + (failed ? "; " + failed + " failed" : "") + ".");
if (failed) process.exit(1);
