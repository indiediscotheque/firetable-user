// Accessibility check (redesign step 0.6, docs/redesign/04-step-plan.md):
// axe-core (pinned in package.json) in each main view, as a visitor, a member
// and a supermod, at a phone's and a computer's width. Fails on a serious or
// critical finding that isn't in the allowlist below; the allowlist holds what
// the site has today, each with the step that fixes it, and only ever shrinks.
// Also fails on text smaller than 10px: the type floor (1.2, the owner, November 20, 2026).
//
// axe is run through the browser's own evaluate (as devtools would), so the
// site keeps its real Content-Security-Policy. While it measures, the page's
// background gradient (#181818 to #111) is its plain colour, the lighter end:
// axe can't measure text against a gradient and would skip nearly everything.
//
// Run (Java 21 for the emulators):
//   cd tests && npm ci && npm run a11y
// With the emulators already running (a Claude cloud session: start them
// without the proxy, 01-ground-rules.md):
//   NO_PROXY="localhost,127.0.0.1,::1" node a11y.mjs
// Narrow a run: ROLES=member WIDTHS=390 VIEWS=live-*  ·  LIST=1 prints every finding
// Never deployed. CI: .github/workflows/smoke.yml
import { readFileSync } from "fs";
import { createRequire } from "module";
import { chromium } from "playwright";
import { policy, config, putAs, serveSite, launchOptions, sleep, authAccount, useAuthEmulator, logInAs, cachePictures, openPage } from "./harness.mjs";
import { livedIn } from "./seed.mjs";

const NS = "demo-a11y";
const put = putAs(NS);
const PASSWORD = "a11y-pass-1";
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const list = (v, all) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : all);
const ROLES = list(process.env.ROLES, ["visitor", "member", "mod"]);
const WIDTHS = list(process.env.WIDTHS, ["390", "1440"]).map(Number);
const VIEW_FILTER = list(process.env.VIEWS, null);
const SIZES = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } };

/**
 * What the site has today: for each axe rule, the kinds of element it flags
 * (the element's selector with song names, numbers and positions taken out).
 * A step that fixes one takes its line out; a kind not listed fails the check.
 * Recorded November 19, 2026; `fix` names the step that should clear it.
 */
const ALLOW = {
  "aria-required-children": { // Certain ARIA roles must contain particular children
    "#accountSettingsTabs": "4.5: the account dialog's close button sits inside its tablist",
  },
  "color-contrast": { // Text must stand out from what's behind it
    "#createAccountFormShell > #createAccountBttn": "2.5 follow-up: Create account (dark text on gold)",
    "#djlistpickerWrap > #djlistpickerLabel": "1.11: the stage's \"DJ Playlist:\" label",
    "#getAppCard > button.butt.small.showInstallGuide": "4.5: Settings' Get the app button",
    "#pv-fsrc > span.pb-kind.pb-livekind.is-off": "2.x: the full-screen player's On air label",
    "#pv-src > span.pb-kind.pb-livekind.is-off": "2.x: the player bar's On air label",
    "b > span.d-tag.pl-broken": "2.x: the Playlists tab's Broken tag",
    "b > span.d-tag.pl-next": "2.x: the Playlists tab's Next tag",
    "button.butt.d-playall > span": "2.6: Play all",
    "button.butt.d-radio > span": "2.7: a genre's radio",
    "div.chatHead > div.chatName": "1.13: names in chat",
    "li.pl-row.d-listrow > span.d-n": "2.x: row numbers in the side column's playlist",
    "li.pl-row.d-listrow.d-flagged > span.d-n": "2.x: row numbers of flagged songs there",
  },
  "label-content-name-mismatch": { // Elements must have their visible text as part of their accessible name
    "button[aria-label]": "2.8: Discover's play buttons say \"Play <title>\" but show the title and artist",
  },
};
/** The kind of element: a selector without the parts that change (names, numbers, positions). */
const kind = (target) => target.replace(/\[([\w-]+)="[^"]*"\]/g, "[$1]").replace(/:nth-(child|of-type)\(\d+\)/g, "").replace(/\d+/g, "N");

// ── the views ───────────────────────────────────────────────────────────────
const hash = (h) => (page) => page.evaluate((x) => { if (location.hash !== x) location.hash = x; }, h);
const liveTab = (id) => async (page) => { await hash("#live")(page); await page.evaluate((t) => firetable.nav.setMobileTab(t), id); };
const VIEWS = [
  { name: "d-home", run: hash("#discover") },
  { name: "d-new", run: hash("#discover/new") },
  { name: "d-charts", run: hash("#discover/charts") },
  { name: "d-genre", run: hash("#discover/genres/nu-disco") },
  { name: "d-dj", run: hash("#discover/djs/dj1") },
  { name: "live-playlists", run: liveTab("mm-playlists") },
  { name: "live-recent", run: liveTab("mm-history") },
  { name: "live-chat", run: liveTab("mmchat") },
  { name: "live-people", run: liveTab("mmusrs") },
  { name: "full-player", run: async (page) => { await hash("#discover")(page); await page.evaluate(() => firetable.discover.openFull()); },
    after: (page) => page.evaluate(() => firetable.discover.closeFull()) },
  { name: "join", who: ["visitor"], run: (page) => page.locator("#nav-signin").click() },
  { name: "profile", who: ["member", "mod"], run: (page) => page.evaluate(() => firetable.ui.openAccount("profile-tab")) },
  { name: "settings", who: ["member", "mod"], run: (page) => page.evaluate(() => firetable.ui.openAccount("settings-tab")) },
  { name: "mod-tools", who: ["mod"], run: (page) => page.evaluate(() => firetable.ui.openAccount("mod-tab")) }
].filter((v) => !VIEW_FILTER || VIEW_FILTER.some((f) => (f.endsWith("*") ? v.name.startsWith(f.slice(0, -1)) : v.name === f)));

/** Close what a view opened: dialogs, popovers, the full-screen player. */
async function reset(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll(":popover-open").forEach((p) => { try { p.hidePopover(); } catch (e) { /* fine */ } });
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    if (firetable.discover && firetable.discover.state().full) firetable.discover.closeFull();
  });
  await sleep(200);
}

/**
 * Text that doesn't stand out from what's behind it (WCAG AA: 4.5:1, or 3:1
 * from 24px, or 18.66px bold), as axe-shaped findings. axe's own rule gives up
 * on text that sits straight on the page's background gradient (nearly all of
 * it), so this measures each visible piece of text against its stacked
 * backgrounds, taking the gradient as its lighter colour. Text over a picture
 * (a background image on the way down) isn't measured.
 */
const contrast = (page) => page.evaluate(() => {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const name = (el) => el.id ? "#" + el.id : el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
  const nodes = [], seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || el.closest(".material-symbols-outlined, .material-symbols-filled, [aria-hidden=true], [inert]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (el.closest("button[disabled], input[disabled], select[disabled]")) continue;
    // the backgrounds under it, top first, down to the page
    const layers = [];
    let picture = false;
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (a !== document.body && a !== document.documentElement && s.backgroundImage !== "none") { picture = true; break; }
      const bg = rgba(s.backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 1) break;
    }
    if (picture) continue;
    let bg = [255, 255, 255, 1]; // the canvas behind a page with no colour of its own
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    const fg = over(rgba(cs.color), bg);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got < need) {
      const parent = el.parentElement ? name(el.parentElement) + " > " : "";
      nodes.push({ target: [parent + name(el)], got: Math.round(got * 100) / 100 });
    }
  }
  return nodes.length ? [{ id: "color-contrast", impact: "serious", help: "Text must stand out from what's behind it (WCAG AA 4.5:1, 3:1 for large text)", nodes }] : [];
});

/** Text on screen under the 10px type floor: "selector size" for each kind of element. */
const smallText = (page) => page.evaluate(() => {
  const out = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || !el.checkVisibility() || el.closest(".material-symbols-outlined, .material-symbols-filled, [aria-hidden=true]")) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size >= 10 || size === 0) continue; // 0: hidden on purpose
    const name = el.id ? "#" + el.id : el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
    out.add(name + " " + size + "px");
  }
  return [...out];
});

// ── the room ────────────────────────────────────────────────────────────────
const now = Date.now();
const people = {
  member: { email: "mira@a11y.test", name: "mira" },
  mod: { email: "modsy@a11y.test", name: "modsy", mod: true, supermod: true }
};
for (const p of Object.values(people)) p.uid = await authAccount(p.email, PASSWORD);
const { data, decks } = livedIn(now, people);
await put("/", data);

const browser = await chromium.launch(launchOptions());
const { server, SITE } = await serveSite({ csp: policy({ auth: true }), configJs: config(NS) });
const found = {}; // "rule kind" -> { rule, impact, help, where: Set of "view role width" }
const small = new Set();
const failures = [];
try {
  for (const role of ROLES) {
    for (const w of WIDTHS) {
      for (const [k, v] of Object.entries(decks.normal())) await put("/" + k, v);
      const phone = w < 640;
      const context = await browser.newContext({ viewport: SIZES[w] || { width: w, height: 900 }, isMobile: phone, hasTouch: phone });
      await cachePictures(context);
      const page = await context.newPage();
      await useAuthEmulator(page);
      await openPage(page, SITE);
      if (role === "visitor") await page.waitForFunction(() => document.querySelectorAll("#dBrowse .ft-cards .pvbar").length > 0, null, { timeout: 30000 });
      else {
        await logInAs(page, people[role].email, PASSWORD, people[role].uid);
        await page.waitForFunction(() => document.querySelector("#mainqueue .pvbar"), null, { timeout: 20000 }).catch(() => {});
      }
      await page.evaluate(AXE);
      process.stdout.write(role + " " + w + ": ");
      for (const v of VIEWS) {
        if (v.who && !v.who.includes(role)) continue;
        await reset(page);
        try {
          await v.run(page);
          await sleep(700);
          // axe for names, labels, roles and structure; contrast is measured below
          const result = await page.evaluate(() => axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: false } } }));
          result.violations.push(...await contrast(page));
          for (const r of result.violations) {
            if (r.impact !== "serious" && r.impact !== "critical") continue;
            for (const n of r.nodes) {
              const key = r.id + " " + kind(n.target.join(" "));
              const f = found[key] = found[key] || { rule: r.id, impact: r.impact, help: r.help, example: n.target.join(" "), where: new Set() };
              f.where.add(v.name + " " + role + " " + w);
            }
          }
          (await smallText(page)).forEach((s) => small.add(s));
          process.stdout.write(".");
        } catch (e) {
          failures.push(role + " " + w + " " + v.name + ": " + e.message.split("\n")[0]);
          process.stdout.write("x");
        }
        if (v.after) await v.after(page).catch(() => {});
      }
      console.log("");
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

// ── report ──────────────────────────────────────────────────────────────────
const allowed = new Set(Object.entries(ALLOW).flatMap(([rule, kinds]) => Object.keys(kinds).map((k) => rule + " " + k)));
const keys = Object.keys(found).sort();
for (const key of keys) {
  if (allowed.has(key)) continue;
  const f = found[key];
  failures.push(f.rule + " (" + f.impact + "): " + f.help + "\n      " + f.example + "\n      in " + [...f.where].slice(0, 5).join(", ") + (f.where.size > 5 ? " and " + (f.where.size - 5) + " more" : ""));
}
const full = !VIEW_FILTER && ROLES.length === 3 && WIDTHS.length === 2;
const stale = full ? [...allowed].filter((k) => !found[k]) : [];
if (process.env.LIST) {
  console.log("\nEvery serious or critical finding, as the allowlist:");
  const rules = [...new Set(keys.map((k) => found[k].rule))];
  for (const rule of rules) {
    console.log('  "' + rule + '": { // ' + found[keys.find((k) => found[k].rule === rule)].help);
    for (const k of keys.filter((x) => found[x].rule === rule)) console.log("    " + JSON.stringify(k.slice(rule.length + 1)) + ': "",');
    console.log("  },");
  }
}
console.log("\n" + keys.length + " kinds of element with a serious or critical finding (" + keys.filter((k) => allowed.has(k)).length + " in the allowlist)");
if (stale.length) console.log("  Fixed (take these out of the allowlist): " + stale.join(", "));
// the type floor (1.2): no text smaller than 10px
if (small.size) failures.push("text under 10px (the type floor, 1.2): " + [...small].sort().join(", "));
if (failures.length) {
  console.log("  FAIL " + failures.join("\n  FAIL "));
  process.exitCode = 1;
}
