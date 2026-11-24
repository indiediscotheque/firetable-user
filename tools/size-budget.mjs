// What the home page downloads from this site before anyone does anything,
// as the deploy serves it (minified: tools/minify.mjs; gzipped), against the
// limits in tools/size-budget.json. Lint runs it on every pull request, so a
// change that makes the site's first load heavier fails until it's made
// lighter again or the budget is raised on purpose (edit the json in the same
// pull request, and say why).
//
//   node tools/size-budget.mjs           check, and list the biggest files
//   node tools/size-budget.mjs --write   set the budget to today's sizes plus 5%
//
// Counted: index.html, the site's own <script src> and stylesheets it links,
// and what it preloads (fonts, emoji data). Not counted: other sites' scripts
// (Firebase, jQuery, the players: pinned versions, cached across sites), what
// loads later on first use (js/lazy.js), pictures, and config.js (server-only).
// Never deployed (tools/).
import { readFileSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { minified, minifiable } from "./minify.mjs";
import postcss from "postcss";
import nesting from "postcss-nesting";

const BUDGET = new URL("./size-budget.json", import.meta.url);
const KINDS = { scripts: "the site's own scripts", styles: "stylesheets", other: "the page, fonts and data it preloads" };

const html = readFileSync("index.html", "utf8");
const own = (url) => !/^(https?:)?\/\//.test(url) && !/^config\.js/.test(url);
const path = (url) => url.split(/[?#]/)[0];
const files = [];
for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) if (own(m[1])) files.push({ file: path(m[1]), kind: "scripts" });
for (const m of html.matchAll(/<link\b[^>]*>/g)) {
  const tag = m[0], href = (/\bhref="([^"]+)"/.exec(tag) || [])[1];
  if (!href || !own(href)) continue;
  if (/\brel="stylesheet"/.test(tag)) files.push({ file: path(href), kind: "styles" });
  else if (/\brel="preload"/.test(tag)) files.push({ file: path(href), kind: "other" });
}
files.push({ file: "index.html", kind: "other" });

const minify = new Set(minifiable());
const rows = [];
for (const f of files) {
  let body = readFileSync(f.file);
  if (minify.has(f.file)) {
    let src = body.toString("utf8");
    // stylesheets as the deploy serves them: flattened first (tools/flatten-css.mjs)
    if (f.file.endsWith(".css")) src = (await postcss([nesting({ edition: "2024-02" })]).process(src, { from: f.file })).css;
    body = Buffer.from((await minified(f.file, src)).code);
  }
  // fonts are compressed already; the server sends them as they are
  const size = /\.(woff2|png|jpe?g|webp|mp3)$/.test(f.file) ? body.length : gzipSync(body, { level: 9 }).length;
  rows.push({ ...f, size });
}

const kb = (n) => (n / 1024).toFixed(1) + " KB";
const totals = { total: 0 };
for (const k of Object.keys(KINDS)) totals[k] = 0;
for (const r of rows) { totals[r.kind] += r.size; totals.total += r.size; }

if (process.argv.includes("--write")) {
  const budget = {};
  for (const k of Object.keys(totals)) budget[k] = Math.ceil(totals[k] * 1.05 / 1024);
  writeFileSync(BUDGET, JSON.stringify({ "//": "KB, gzipped, of what the home page loads first from this site: node tools/size-budget.mjs (--write sets today's sizes + 5%)", ...budget }, null, 2) + "\n");
  console.log("Budget set: " + JSON.stringify(budget));
  process.exit(0);
}

const budget = JSON.parse(readFileSync(BUDGET, "utf8"));
let over = 0;
console.log("First load from this site (minified, gzipped):");
for (const k of [...Object.keys(KINDS), "total"]) {
  const limit = budget[k] * 1024, ok = totals[k] <= limit;
  if (!ok) over++;
  console.log("  " + (ok ? "ok   " : "OVER ") + (KINDS[k] || "in all").padEnd(40) + kb(totals[k]).padStart(10) + "  of " + budget[k] + " KB");
}
console.log("Biggest:");
rows.sort((a, b) => b.size - a.size).slice(0, 8).forEach((r) => console.log("  " + kb(r.size).padStart(9) + "  " + r.file));
if (over) {
  console.log("::error::The site's first load is over its budget (tools/size-budget.json). Make it lighter (load it on first use: js/lazy.js), or raise the budget in the same pull request and say why.");
  process.exit(1);
}
