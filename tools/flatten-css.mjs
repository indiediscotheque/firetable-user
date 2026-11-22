// Write the site's stylesheets without CSS nesting, for browsers that can't
// read it (Safari before 16.5: iPads on iPadOS 15). The source keeps its
// nesting; the deploy runs this on its copy of the site before uploading, the
// way it versions links (.github/scripts/cache-bust.py). Nested rules become
// the plain rules they mean (postcss-nesting), so a browser with nesting reads
// the same styles either way.
//
//   node tools/flatten-css.mjs            flatten every published stylesheet in place
//   node tools/flatten-css.mjs --check    flatten in memory and fail if any nesting is left
//
// Each file keeps its modification time, so the deploy's upload still compares
// it by its last commit. Never deployed (tools/).
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, statSync, utimesSync } from "fs";
import postcss from "postcss";
import nesting from "postcss-nesting";

const check = process.argv.includes("--check");
const files = execFileSync("git", ["ls-files", "*.css"], { encoding: "utf8" })
  .split("\n").filter((f) => f && !/^(tests|docs|tools|node_modules)\//.test(f));

/** Rules still inside another rule (what older browsers drop). */
function nested(root) {
  const out = [];
  root.walkRules((rule) => {
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
      if (p.type === "rule") { out.push(rule.selector); break; }
    }
  });
  root.walkAtRules((at) => {
    if (at.parent && at.parent.type === "rule") out.push("@" + at.name + " in " + at.parent.selector);
  });
  return out;
}

let failed = 0, changed = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  let result;
  try {
    result = await postcss([nesting({ edition: "2024-02" })]).process(src, { from: file });
  } catch (e) {
    console.error(file + ": " + e.message);
    failed++;
    continue;
  }
  const left = nested(result.root);
  if (left.length) {
    console.error(file + ": still nested after flattening: " + left.slice(0, 5).join(", "));
    failed++;
    continue;
  }
  if (result.css === src) continue;
  changed++;
  if (check) continue;
  const { atime, mtime } = statSync(file);
  writeFileSync(file, result.css);
  utimesSync(file, atime, mtime);
}
console.log((check ? "Would flatten " : "Flattened ") + changed + " of " + files.length + " stylesheets" + (failed ? "; " + failed + " failed" : "") + ".");
if (failed) process.exitCode = 1;
