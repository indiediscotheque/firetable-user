// jQuery only shrinks. The site's scripts use jQuery in about 1,200 places;
// new code uses the browser's own DOM (querySelector, classList,
// addEventListener, fetch), and code that's being changed anyway drops its
// jQuery as it goes (CLAUDE.md, "jQuery"). There's no rewrite: this check
// just keeps the count from growing.
//
//   node tools/jquery-budget.mjs           check every script against tools/jquery-baseline.json
//   node tools/jquery-budget.mjs --write   record today's counts (after taking jQuery out)
//
// Fails when a script uses jQuery more than its baseline, when a new script
// uses it at all, or when a count went down and the baseline wasn't lowered
// with it (so the ratchet holds). Counted: $(…), $.…, and jQuery, outside
// comments. Lint runs it on every pull request. Never deployed (tools/).
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";

const BASELINE = new URL("./jquery-baseline.json", import.meta.url);
const files = execFileSync("git", ["ls-files", "*.js"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && /^(js|embed)\//.test(f) && !/\.min\.js$/.test(f));

/** jQuery calls in a script: $(…), $.…, jQuery (comments left out). */
export function count(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1"); // line comments (a // after a space or ;, not a URL's)
  return (code.match(/(?<![\w$])\$(?=\s*[(.])|(?<![\w$.])jQuery\b/g) || []).length;
}

const now = {};
for (const f of files) {
  const n = count(readFileSync(f, "utf8"));
  if (n) now[f] = n;
}
const total = Object.values(now).reduce((a, b) => a + b, 0);

if (process.argv.includes("--write")) {
  const sorted = Object.fromEntries(Object.keys(now).sort().map((k) => [k, now[k]]));
  writeFileSync(BASELINE, JSON.stringify({ "//": "jQuery calls per script; may only go down (node tools/jquery-budget.mjs, --write after taking some out)", total, ...sorted }, null, 2) + "\n");
  console.log("jQuery baseline: " + total + " calls in " + Object.keys(now).length + " scripts.");
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const more = [], fewer = [];
for (const f of new Set([...Object.keys(now), ...Object.keys(base).filter((k) => !/^(\/\/|total)$/.test(k))])) {
  const was = base[f] || 0, is = now[f] || 0;
  if (is > was) more.push(f + ": " + was + " → " + is);
  else if (is < was) fewer.push(f + ": " + was + " → " + is);
}
console.log("jQuery: " + total + " calls in " + Object.keys(now).length + " scripts (baseline " + (base.total || 0) + ").");
if (more.length) {
  console.log("::error::More jQuery than before in " + more.join("; ") + ". New code uses the browser's own DOM (querySelector, classList, addEventListener, fetch) instead; see CLAUDE.md, \"jQuery\".");
}
if (fewer.length) {
  console.log((more.length ? "" : "::error::") + "Less jQuery in " + fewer.join("; ") + ": good. Record it so it can't come back: node tools/jquery-budget.mjs --write (and commit tools/jquery-baseline.json).");
}
if (more.length || fewer.length) process.exit(1);
