// File and function length: new code stays small, and the big files only shrink.
//
// The common limit (ESLint's max-lines) is 500 lines of code a file, not
// counting comments or blank lines, and 80 for a function. Files already over
// it keep their size today as their own cap, and so does their number of
// functions over 80 lines; both may only go down (CLAUDE.md, "File size").
//
//   node tools/line-limits.mjs           check against tools/line-limits.json
//   node tools/line-limits.mjs --write   record today's sizes (after making a file smaller)
//
// Fails when a file is over its cap (500, or its own), when a file has more
// long functions than recorded, or when a file got smaller and its record
// wasn't lowered with it (so the ratchet holds). eslint.config.mjs reads the
// same caps, so the editor shows a file over its size. Lint runs this on
// every pull request. Never deployed (tools/).
import { readFileSync, writeFileSync, existsSync } from "fs";
import { ESLint } from "eslint";

export const MAX_LINES = 500;
export const MAX_FUNCTION = 80;
const RECORD = new URL("./line-limits.json", import.meta.url);
const COUNTED = { skipBlankLines: true, skipComments: true };

// every function's and file's size, measured the way ESLint does
const eslint = new ESLint({
  overrideConfig: { rules: {
    "max-lines": ["error", { max: 1, ...COUNTED }],
    "max-lines-per-function": ["error", { max: MAX_FUNCTION, ...COUNTED, IIFEs: false }]
  } }
});
const results = await eslint.lintFiles(["js", "embed", "sw.js"]);
const now = {};
for (const r of results) {
  const file = r.filePath.slice(process.cwd().length + 1);
  const m = r.messages.find((x) => x.ruleId === "max-lines");
  const lines = m ? Number(/\((\d+)\)/.exec(m.message)[1]) : 0;
  const long = r.messages.filter((x) => x.ruleId === "max-lines-per-function").length;
  if (lines > MAX_LINES || long) now[file] = { lines: lines > MAX_LINES ? lines : undefined, longFunctions: long || undefined };
}

if (process.argv.includes("--write")) {
  const sorted = Object.fromEntries(Object.keys(now).sort().map((k) => [k, now[k]]));
  writeFileSync(RECORD, JSON.stringify({ "//": "Files over " + MAX_LINES + " lines of code, and functions over " + MAX_FUNCTION + ": today's sizes, which may only go down (node tools/line-limits.mjs; --write after making one smaller)", ...sorted }, null, 2) + "\n");
  console.log("Recorded " + Object.keys(now).length + " files.");
  process.exit(0);
}

const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : {};
const worse = [], better = [];
for (const file of new Set([...Object.keys(now), ...Object.keys(record).filter((k) => k !== "//")])) {
  const was = record[file] || {}, is = now[file] || {};
  const capLines = was.lines || MAX_LINES, capLong = was.longFunctions || 0;
  if ((is.lines || 0) > capLines) worse.push(file + ": " + is.lines + " lines of code (its cap is " + capLines + ")");
  if ((is.longFunctions || 0) > capLong) worse.push(file + ": " + is.longFunctions + " functions over " + MAX_FUNCTION + " lines (was " + capLong + ")");
  if (was.lines && (is.lines || 0) < was.lines) better.push(file + ": " + was.lines + " → " + (is.lines || "under " + MAX_LINES) + " lines");
  if (capLong && (is.longFunctions || 0) < capLong) better.push(file + ": " + capLong + " → " + (is.longFunctions || 0) + " long functions");
}
const big = Object.values(now).filter((x) => x.lines).length;
console.log("File size: " + big + " files over " + MAX_LINES + " lines of code, " +
  Object.values(now).reduce((a, x) => a + (x.longFunctions || 0), 0) + " functions over " + MAX_FUNCTION + ".");
if (worse.length) {
  console.log("::error::Bigger than allowed: " + worse.join("; ") + ". Put the new part in a file (or function) of its own; see CLAUDE.md, \"File size\".");
}
if (better.length) {
  console.log((worse.length ? "" : "::error::") + "Smaller now: " + better.join("; ") + ": good. Record it so it can't grow back: node tools/line-limits.mjs --write (and commit tools/line-limits.json).");
}
if (worse.length || better.length) process.exit(1);
