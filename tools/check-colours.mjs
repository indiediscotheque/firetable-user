// The site's greys come from the palette on :root in css/looks.css (redesign
// step 1.1): backgrounds --color-bg-s2 … --color-bg-t4, text --color-text …
// --color-text-dim, --color-border, --color-icon. This fails on a grey written
// out anywhere else (#333, #1a1a1a, rgb(51, 51, 51)), so panels, borders and
// menus stay one set of colours. White and black are fine, and so is
// see-through white or black (rgba(255, 255, 255, …), the stage's overlays).
// A grey that's meant to be its own (a brand's button, the festive light
// string) says so on its line: /* own colour: why */.
//
//   node tools/check-colours.mjs
//
// Never deployed (tools/). CI: the lint workflow.
import { readFileSync } from "fs";

const FILES = ["css/looks.css", "css/discover.css", "css/room-colors.css"];
const OK = new Set(["fff", "ffffff", "000", "000000"]);
const hexGrey = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
const rgbGrey = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi;

const grey = (h) => {
  h = h.toLowerCase();
  if (OK.has(h)) return false;
  if (h.length === 3) return h[0] === h[1] && h[1] === h[2];
  return h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6);
};

let found = 0;
for (const file of FILES) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    const code = line.replace(/\/\*.*?\*\//g, "");
    if (/^\s*--[\w-]+\s*:/.test(code)) return; // the palette itself
    if (/own colour/i.test(line)) return;
    const hits = [];
    for (const m of code.matchAll(hexGrey)) if (grey(m[1])) hits.push(m[0]);
    for (const m of code.matchAll(rgbGrey)) if (m[1] === m[2] && m[2] === m[3] && m[1] !== "0" && m[1] !== "255") hits.push(m[0]);
    if (!hits.length) return;
    found++;
    console.error(file + ":" + (i + 1) + ": " + hits.join(", ") + " — use the palette (--color-…) or mark it /* own colour: why */");
  });
}
if (found) {
  console.error(found + " line(s) with a grey of their own.");
  process.exitCode = 1;
} else console.log("Colours: every grey comes from the palette.");
