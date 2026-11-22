// "Nothing lost" (redesign step 0.4, docs/redesign/04-step-plan.md): every
// control people use is still in the page and can still be reached, by each
// role, at a phone's, a tablet's and a computer's width. Fails if a change
// removes or hides one.
//
// Each entry below is a feature from the inventory (docs/redesign/02-feature-
// inventory.md): who has it, which side of the site (Live or Discover), the
// visible controls a person taps to get there (`via`), and what must then be
// on screen (`target`). A step written "?#id" is tapped only when it's on
// screen (a tab on phones that's always open on computers). The list is the
// record of where everything lives: a pull request that moves a control
// behind a menu updates its `via` in the same change.
//
// Real accounts in the auth emulator (a member, the DJ on deck, a mod) and a
// visitor; the room is seed.mjs's livedIn, the same the screenshots use.
//
// Run (Java 21 for the emulators):
//   cd tests && npm ci && npm run reach
// With the emulators already running (a Claude cloud session: start them
// without the proxy, 01-ground-rules.md):
//   NO_PROXY="localhost,127.0.0.1,::1" node reach.mjs
// Narrow a run: ROLES=member,mod WIDTHS=390 ONLY=CR-,ST-11
// Never deployed. CI: .github/workflows/smoke.yml
import { chromium } from "playwright";
import { policy, config, putAs, serveSite, launchOptions, sleep, authAccount, useAuthEmulator, logInAs, cachePictures, openPage } from "./harness.mjs";
import { livedIn } from "./seed.mjs";

const NS = "demo-reach";
const put = putAs(NS);
const PASSWORD = "reach-pass-1";
const list = (v, all) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : all);
const ROLES = list(process.env.ROLES, ["visitor", "member", "dj", "mod"]);
const WIDTHS = list(process.env.WIDTHS, ["390", "1024", "1440"]).map(Number);
const ONLY = list(process.env.ONLY, null);
const SIZES = { 390: { width: 390, height: 844 }, 1024: { width: 1024, height: 768 }, 1440: { width: 1440, height: 900 } };

const ALL = ["visitor", "member", "dj", "mod"];
const IN = ["member", "dj", "mod"]; // signed in
const PHONE = [390];
const WIDE = [1024, 1440];

// shorthands for the routes
// phones: the bottom tab bar (4.1) stands in for Live's Playlists tab and Discover's row of pages
const tab = (t) => '?#nav-tabs [data-tab="' + t + '"]';
const playlists = ["?#mm-playlists", tab("library")];
const pages = (v) => [tab("discover"), '#dNav [data-view="' + v + '"]'];
const listMenu = [...playlists, "#cr-listBtn"];
const account = ["#loggedInUser"];
const chatTab = ["?#mmchat", "?#sp-chat"];
const peopleTab = ["?#mmusrs", "?#sp-people"];
const full = [".pb-expand"]; // phones: the bar opens the full-screen player
const fullMore = [...full, '#pv-full [aria-label="More controls"]'];

/**
 * The features, by inventory row. `who`: the roles that have it; `widths`: only
 * at these; `mode`: live (default) or discover; `via`: the controls tapped in
 * order; `target`: what must be on screen after; `hash`: where the address must
 * end up; `notFor`: roles that must NOT see `notTarget` (straight away, no taps);
 * `known`: a gap already reported to the owner, listed rather than failed.
 */
const FEATURES = [
  // ── the header (TB) ──
  { row: "TB-01", name: "The :id: logo", who: ALL, target: "#roomlogo" },
  { row: "TB-02", name: "The theme, and Suggest a theme", who: ALL, via: ["#themePill"], target: "#themeSuggest" },
  { row: "TB-03", name: "Community links", who: ALL, via: ["#socialTrigger"], target: "#socialPopover" },
  { row: "TB-04", name: "About", who: ALL, target: "#roomInfo" },
  { row: "TB-05", name: "Mentions inbox", who: IN, via: ["#inboxTrigger"], target: "#inboxList", notFor: ["visitor"], notTarget: "#inboxTrigger" },
  { row: "TB-06", name: "The account menu", who: IN, via: account, target: "#nav-accountMenu" },
  { row: "TB-08", name: "Discover / Live: to Live", who: ALL, widths: WIDE, mode: "discover", via: ['#modeTabs [data-mode="live"]'], target: "#stage", hash: "#live" },
  { row: "TB-08", name: "Discover / Live: to Discover", who: ALL, widths: WIDE, via: ['#modeTabs [data-mode="discover"]'], target: "#dBrowse", hash: "#discover" },
  // ── phones: the bottom tab bar (NV-01) ──
  { row: "NV-01", name: "Tab bar: Home", who: ALL, widths: PHONE, via: ['#nav-tabs [data-tab="home"]'], target: "#dBrowse .ft-cards .pvbar", hash: "#discover" },
  { row: "NV-01", name: "Tab bar: Discover's pages", who: ALL, widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="discover"]'], target: '#dNav [data-view="years"]' },
  { row: "NV-01", name: "Tab bar: Live", who: ALL, widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="live"]'], target: "#stage", hash: "#live" },
  { row: "NV-01", name: "Tab bar: Library", who: IN, widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="library"]'], target: "#mainqueue", hash: "#live" },
  { row: "NV-01", name: "Tab bar: Library (visitors: what joining opens)", who: ["visitor"], widths: PHONE, mode: "discover", via: ['#nav-tabs [data-tab="library"]'], target: "#welcomeInfo .d-createaccount" },
  { row: "NV-01", name: "Tab bar: You (the account menu)", who: IN, widths: PHONE, via: ['#nav-tabs [data-tab="you"]'], target: "#nav-accountMenu" },
  { row: "NV-01", name: "Tab bar: You (join or log in)", who: ["visitor"], widths: PHONE, via: ['#nav-tabs [data-tab="you"]'], target: "#joinBox #newemail" },
  { row: "AU-02", name: "Join or log in", who: ["visitor"], via: ["#nav-signin"], target: "#joinBox #newemail", notFor: IN, notTarget: "#nav-signin" },
  { row: "AU-07", name: "Profile: change username", who: IN, via: [...account, '#nav-accountMenu [data-acct="profile-tab"]'], target: "#changeUsername" },
  // AU-08, members choosing their avatar style: retired (the owner, November 19, 2026); a supermod sets everyone's (MO-05)
  { row: "AU-12", name: "Profile: build your Bouletmaton", who: IN, via: [...account, '#nav-accountMenu [data-acct="profile-tab"]', "#ac-bouletEdit"], target: "#bm-builderBox #bm-save" },
  { row: "AU-11", name: "Account: email, password", who: IN, via: [...account, '#nav-accountMenu [data-acct="account-tab"]'], target: "#ac-passForm" },
  { row: "AU-09", name: "Log out", who: IN, via: account, target: "#nav-logout" },
  { row: "CH-13", name: "Shortcuts and commands", who: IN, via: [...account, "#nav-acctHelp"], target: "#helpBox .helpKeys" },
  { row: "SE-*", name: "Settings", who: IN, via: [...account, '#nav-accountMenu [data-acct="settings-tab"]'], target: "#densityPicker" },
  { row: "MO-05", name: "Mod tools: everyone's avatar style (supermods)", who: ["mod"], via: [...account, '#nav-accountMenu [data-acct="mod-tab"]'], target: "#mo-avatarStyle" },
  { row: "MO-01", name: "Mod tools: suspend a user (supermods)", who: ["mod"], via: [...account, '#nav-accountMenu [data-acct="mod-tab"]'], target: "#supercopSearch" },

  // ── the stage and its tools (ST, NP), in the player bar since 2.3c ──
  { row: "ST-02", name: "The DJs on the stage", who: ALL, target: "#deck .avtr" },
  // phones: the DJs up next and the open spots are in the People tab
  { row: "ST-03", name: "Hop on the decks (an open spot)", who: ["member", "mod"], via: peopleTab, target: "#ondeck .ondeck-slot.empty" },
  { row: "ST-05", name: "Screen: video, art, off", who: ALL, widths: WIDE, target: "#screenControl" },
  { row: "ST-05", name: "Screen: video, art, off (phone: in the full-screen player)", who: ALL, widths: PHONE, via: full, target: "#screenControl" },
  { row: "ST-06", name: "Volume", who: ALL, widths: WIDE, target: "#pv-vol" },
  { row: "ST-07", name: "Reload audio", who: ALL, widths: WIDE, target: "#reloadtrack" },
  { row: "ST-07", name: "Reload audio (phone: the full-screen player's More)", who: ALL, widths: PHONE, via: fullMore, target: '#pv-full [aria-label="Reload the room\'s audio"]' },
  { row: "ST-08", name: "Full screen", who: ALL, widths: WIDE, via: ["#fullscreenBtn"], target: "#pv-full" },
  { row: "ST-08", name: "Full screen (phone: the bar's expand)", who: ALL, widths: PHONE, via: [".pb-expand"], target: "#pv-full" },
  { row: "ST-08b", name: "Play on a speaker or TV", who: ALL, widths: WIDE, via: ["#st-cast"], target: "#st-castWays" },
  { row: "ST-08b", name: "Play on a speaker or TV (phone: from the full-screen player)", who: ALL, widths: PHONE, via: [".pb-expand", "#st-cast"], target: "#st-castWays" },
  { row: "ST-09", name: "Fire", who: IN, target: "#fire" },
  { row: "ST-11", name: "Grab to a playlist", who: IN, via: ["#grab"], target: "#stealpicker" },
  { row: "ST-11", name: "Grab: choose the playlist (▾)", who: IN, widths: WIDE, via: ["#st-grabPick"], target: "#stealpicker" },
  // phones (4.2): the ▾ is in the full-screen player; the bar's Grab and its toast's Change open the picker too
  { row: "ST-11", name: "Grab: choose the playlist (▾, phone: the full-screen player)", who: IN, widths: PHONE, via: [...full, "#st-grabPick"], target: "#stealpicker" },
  { row: "ST-12", name: "Open the song on YouTube or SoundCloud", who: IN, widths: WIDE, target: "#songlink" },
  { row: "ST-12", name: "Open the song (phone: the full-screen player's More)", who: IN, widths: PHONE, via: fullMore, target: "#songlink" },
  { row: "ST-13", name: "Skip your own song (phone: the full-screen player's More)", who: ["dj"], widths: PHONE, via: [...fullMore, "#skipTrigger"], target: "#skipPopover .skipNowAction" },
  { row: "ST-13", name: "Skip your own song", who: ["dj"], widths: WIDE, via: ["#skipTrigger"], target: "#skipPopover .skipNowAction", notFor: ["member"], notTarget: "#skipTrigger" },
  { row: "ST-14", name: "Mod tools on the song (phone: the full-screen player's More)", who: ["mod"], widths: PHONE, via: [...fullMore, "#npModBtn"], target: "#npFixTags" },
  { row: "ST-14", name: "Mod tools on the song: skip, fix tags, flag", who: ["mod"], widths: WIDE, via: ["#npModBtn"], target: "#npFixTags", notFor: ["member", "dj"], notTarget: "#npModBtn" },
  { row: "DJ-06", name: "Mod tools on the song: remove the playing DJ (1.7)", who: ["mod"], widths: WIDE, via: ["#npModBtn"], target: "#npRemoveDj" },
  { row: "DJ-06", name: "Mod tools on the song: add someone to the decks (1.7)", who: ["mod"], widths: WIDE, via: ["#npModBtn", "#npAddDj"], target: "#npAddDjFind" },
  { row: "DJ-06", name: "Mod tools on the song: add someone (phone: the full-screen player's More)", who: ["mod"], widths: PHONE, via: [...fullMore, "#npModBtn", "#npAddDj"], target: "#npAddDjFind" },
  { row: "ST-24", name: "A DJ's user card (from the DJs up next)", who: IN, via: [...peopleTab, "#ondeck .ondeck-slot:not(.empty)"], target: "#ft-user-tip" },
  { row: "NP-01", name: "The song's title and artist", who: ALL, target: "#track" },
  { row: "NP-02", name: "Plays here", who: ALL, widths: WIDE, target: "#playStats" },
  { row: "NP-02", name: "Plays here (phone: the full-screen player)", who: ALL, widths: PHONE, via: full, target: "#pv-fhist" },
  { row: "NP-08", name: "The song sheet from the player", who: ALL, via: ["#pv-title .d-sheetlink"], target: ".d-sheet" },

  // ── decks, people, chat (DJ, PE, CH) ──
  { row: "DJ-01", name: "Which playlist you DJ from", who: IN, target: "#djlistpicker" },
  { row: "DJ-03", name: "The waitlist", who: IN, via: peopleTab, target: "#usersWaitlist" },
  { row: "PE-01", name: "The people in the room", who: IN, via: peopleTab, target: "#allUsers" },
  { row: "CH-01", name: "Chat", who: IN, via: chatTab, target: "#chats" },
  { row: "CH-01", name: "Chat: write a message", who: IN, via: chatTab, target: "#newchat" },
  { row: "CH-06", name: "Emoji picker", who: IN, via: [...chatTab, "#pickEmoji"], target: "#pickerSearch" },

  // ── playlists (CR) ──
  { row: "CR-01", name: "Switch playlist", who: IN, via: playlists, target: "#listpicker" },
  { row: "CR-02", name: "Playlist rows", who: IN, via: playlists, target: "#mainqueue .pvbar" },
  { row: "CR-03", name: "Row: send to top", who: IN, via: playlists, target: "#mainqueue .pvbar .bumpsongs" },
  { row: "CR-04", name: "Row: ⋮ menu (bottom, add, edit tags, swap, open, delete)", who: IN, via: [...playlists, "#mainqueue .pvbar .row-more"], target: "#trackMenuPopover" },
  { row: "CR-07", name: "Filter the playlist", who: IN, via: playlists, target: "#queueFilter" },
  { row: "CR-07", name: "Show only: Remixes, Broken", who: IN, via: [...playlists, "#cr-showOnly"], target: "#cr-showOnlyMenu" },
  { row: "CR-08", name: "Find tracks", who: IN, via: [...playlists, "#addToQueueBttn"], target: "#qsearch", close: ["#cancelqsearch"] },
  { row: "CR-10", name: "Shuffle", who: IN, via: [...listMenu, '#cr-listMenu [data-act="shuffle"]'], target: "#shuffleQueuePopover" },
  { row: "CR-11", name: "Merge playlists", who: IN, via: [...listMenu, '#cr-listMenu [data-act="merge"]'], target: "#mergepicker", close: ['#cr-listBtn', '#cr-listMenu [data-act="merge"]'] },
  { row: "CR-12", name: "New playlist", who: IN, via: [...listMenu, '#cr-listMenu [data-act="new"]'], target: "#plmaker", close: ["#plAddLauncher"] },
  { row: "CR-12", name: "Import a playlist", who: IN, via: [...listMenu, '#cr-listMenu [data-act="import"]'], target: "#importPromptBox #importSources" },
  // (off for the built-in list, which the test views)
  { row: "CR-13", name: "Delete this playlist", who: IN, via: listMenu, target: '#cr-listMenu [data-act="delete"]' },
  { row: "CR-14", name: "All playlists", who: IN, via: [...listMenu, '#cr-listMenu [data-act="all"]'], target: "#plIndexList" },
  { row: "CR-17", name: "Check for broken tracks", who: IN, via: listMenu, target: '#cr-listMenu [data-act="check"]' },
  { row: "CR-21", name: "Remove duplicates", who: IN, via: listMenu, target: '#cr-listMenu [data-act="dupes"]' },
  { row: "CR-25", name: "Rename this playlist", who: IN, via: [...listMenu, '#cr-listMenu [data-act="rename"]'], target: "#cr-renameInput" },
  { row: "CR-28", name: "Export the playlist as a list of songs", who: IN, via: listMenu, target: '#cr-listMenu [data-act="export"]' },
  { row: "CR-07", name: "Show only: Duplicates", who: IN, via: [...playlists, "#cr-showOnly"], target: "#cr-dupesOnly" },
  { row: "CR-30", name: "Select several: Top, Bottom, Copy to…, Delete", who: IN, via: [...playlists, "#cr-select"], target: "#cr-bulkTop" },
  { row: "CR-29", name: "Sort the playlist (view only)", who: IN, via: [...playlists, "#cr-sort"], target: '#cr-sortMenu input[value="artist"]' },

  // ── Recent, Fresh, Cards (RE) ──
  { row: "RE-01", name: "Recent plays", who: IN, via: ["#mm-history"], target: "#thehistory .pvbar" },
  { row: "RE-02", name: "Filter Recent", who: IN, via: ["#mm-history"], target: "#histFilter" },
  { row: "RE-04", name: "Fresh", who: IN, via: ["#mm-discover"], target: "#thediscovers" },
  { row: "RE-05", name: "Cards", who: IN, via: ["#mm-cards"], target: "#cardsMain" },
  // visitors in Live: tabs showing what joining opens, and the room's recent plays
  { row: "DI-16", name: "Live for visitors: Join, and what joining opens", who: ["visitor"], target: "#dLocked [data-locked]" },
  { row: "DI-16", name: "Live for visitors: Recent", who: ["visitor"], via: ['#dLocked [data-locked="recent"]'], target: ".d-lockedlist" },

  // ── Discover (DI) ──
  { row: "DI-12", name: "Search", who: ALL, mode: "discover", target: "#dQ" },
  { row: "DI-01", name: "Home", who: ALL, mode: "discover", target: "#dBrowse .ft-cards .pvbar" },
  { row: "DI-02", name: "New", who: ALL, mode: "discover", via: pages("new"), hash: "#discover/new", target: "#dBrowse .pvbar" },
  { row: "DI-03", name: "Charts", who: ALL, mode: "discover", via: pages("charts"), hash: "#discover/charts", target: "#dBrowse .pvbar" },
  { row: "DI-04", name: "Genres", who: ALL, mode: "discover", via: pages("genres"), hash: "#discover/genres", target: "#dBrowse .d-mapg" },
  { row: "DI-06", name: "DJs", who: ALL, mode: "discover", via: pages("djs"), hash: "#discover/djs", target: "#dBrowse" },
  { row: "DI-08", name: "Years", who: ALL, mode: "discover", via: pages("years"), hash: "#discover/years", target: "#dBrowse" },
  { row: "DI-13", name: "The player bar", who: ALL, mode: "discover", target: "#dMini .pb-main" },
  { row: "DI-14", name: "Listen in / stop the room", who: ALL, mode: "discover", target: "#dMini .pb-main" },
  { row: "DI-27", name: "The full-screen player", who: ALL, widths: WIDE, mode: "discover", via: ["#fullscreenBtn"], target: "#pv-full" },
  { row: "DI-27", name: "The full-screen player (phone: the bar's expand)", who: ALL, widths: PHONE, mode: "discover", via: [".pb-expand"], target: "#pv-full" },
  { row: "DI-19", name: "A song's ⋮ menu", who: ALL, mode: "discover", via: ["#dBrowse .pvbar .d-more"], target: "#dMenu" },
  { row: "DI-17", name: "Members' playlist beside the player", who: IN, widths: WIDE, mode: "discover", target: "#dSide" },
  { row: "DI-15", name: "Visitors' crate", who: ["visitor"], widths: WIDE, mode: "discover", target: "#dSide" }
].filter((f) => !ONLY || ONLY.some((o) => f.row.startsWith(o)));

// ── the room ────────────────────────────────────────────────────────────────
const now = Date.now();
const people = {
  member: { email: "mira@reach.test", name: "mira" },
  dj: { email: "rook@reach.test", name: "rook" },
  // a supermod: a mod's tools, and the account menu's Mod tools (supermods only)
  mod: { email: "modsy@reach.test", name: "modsy", mod: true, supermod: true }
};
for (const p of Object.values(people)) p.uid = await authAccount(p.email, PASSWORD);
const { data, decks } = livedIn(now, people);
await put("/", data);
const setDecks = async (d) => { for (const [k, v] of Object.entries(d)) await put("/" + k, v); };

/** Is `sel` on screen and not covered: the topmost element at its middle is it, or inside it. */
async function onScreen(page, sel, timeout = 3000) {
  const loc = page.locator(sel).first();
  try { await loc.waitFor({ state: "visible", timeout }); } catch (e) { return "not visible"; }
  await loc.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return "off screen";
    // something a person can tap: the middle of the part on screen, or near its top left
    // (a long list's middle can sit under the player bar; an avatar's corner is see-through)
    const top = Math.max(r.top, 0), left = Math.max(r.left, 0);
    const bottom = Math.min(r.bottom, innerHeight), right = Math.min(r.right, innerWidth);
    const points = [[(left + right) / 2, (top + bottom) / 2], [left + Math.min((right - left) / 2, 20), top + Math.min((bottom - top) / 2, 20)]];
    let hit = null;
    for (const [x, y] of points) {
      hit = document.elementFromPoint(Math.min(innerWidth - 1, x), Math.min(innerHeight - 1, y));
      if (!hit || el === hit || el.contains(hit) || hit.contains(el)) return "";
    }
    return "covered by " + (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + (hit.className && typeof hit.className === "string" ? "." + hit.className.trim().split(/\s+/).join(".") : ""));
  });
}

/** Back to a known state: menus, popovers, dialogs and the full-screen player closed. */
async function reset(page, mode) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll(":popover-open").forEach((p) => { try { p.hidePopover(); } catch (e) { /* fine */ } });
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    if (window.firetable && firetable.discover && firetable.discover.state().full) firetable.discover.closeFull();
    document.body.classList.remove("d-sheet-open");
  });
  // phones: back out of Discover's list of pages and the Library tab
  await page.evaluate((m) => {
    const tap = (t) => { const b = document.querySelector('#nav-tabs [data-tab="' + t + '"]'); if (b && b.offsetParent) b.click(); };
    if (m === "discover" && document.body.classList.contains("nt-browse")) tap("home");
    if (m !== "discover" && document.body.classList.contains("nt-library")) tap("live");
  }, mode);
  await page.waitForFunction(() => { const f = document.getElementById("pv-full"); return !f || !f.checkVisibility(); }, null, { timeout: 3000 }).catch(() => {});
  const want = mode === "discover" ? "#discover" : "#live";
  if (await page.evaluate(() => location.hash) !== want) await page.evaluate((h) => { location.hash = h; }, want);
  await sleep(250);
}

const browser = await chromium.launch(launchOptions());
const { server, SITE } = await serveSite({ csp: policy({ auth: true }), configJs: config(NS) });
let checked = 0;
const failures = [];
const known = new Set();
try {
  for (const role of ROLES) {
    for (const w of WIDTHS) {
      await setDecks(role === "dj" ? decks.mine(people.dj) : decks.normal());
      const phone = w < 640;
      const context = await browser.newContext({ viewport: SIZES[w] || { width: w, height: 900 }, isMobile: phone, hasTouch: phone });
      await cachePictures(context);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await useAuthEmulator(page);
      await openPage(page, SITE);
      if (role === "visitor") await page.waitForFunction(() => document.querySelectorAll("#dBrowse .ft-cards .pvbar").length > 0, null, { timeout: 30000 });
      else {
        await logInAs(page, people[role].email, PASSWORD, people[role].uid);
        await page.waitForFunction(() => ftapi.users && Object.keys(ftapi.users).length > 3 && document.querySelector("#mainqueue .pvbar"), null, { timeout: 20000 }).catch(() => {});
      }
      console.log("-- " + role + " at " + w + " wide");
      for (const f of FEATURES) {
        if (f.widths && !f.widths.includes(w)) continue;
        const has = f.who.includes(role);
        const mustNot = f.notFor && f.notFor.includes(role);
        if (!has && !mustNot) continue;
        checked++;
        await reset(page, f.mode);
        const label = f.row + " " + f.name;
        if (mustNot) {
          const shown = await onScreen(page, f.notTarget, 300);
          if (!shown) failures.push(role + " " + w + ": " + label + ": " + f.notTarget + " shows, but shouldn't for a " + role);
          continue;
        }
        let why = "";
        if (f.known) { known.add(f.row + " " + f.name + ": " + f.known); continue; }
        for (const step of f.via || []) {
          const optional = step.startsWith("?");
          const sel = optional ? step.slice(1) : step;
          const state = await onScreen(page, sel, optional ? 200 : 3000);
          if (state) {
            if (optional) continue;
            why = "can't tap " + sel + " (" + state + ")";
            break;
          }
          // onScreen has checked it's in sight and not covered; force, since Playwright
          // won't tap something that moves (the DJs bob to the beat)
          try { await page.locator(sel).first().click({ timeout: 3000, force: true }); } catch (e) { why = "tapping " + sel + " failed: " + e.message.split("\n")[0]; break; }
          await sleep(250);
        }
        if (!why) {
          const state = await onScreen(page, f.target);
          if (state) why = f.target + " " + state + (f.via ? " after " + f.via.join(" → ") : "");
        }
        if (!why && f.hash && !(await page.evaluate(() => location.hash)).startsWith(f.hash)) why = "the address is " + await page.evaluate(() => location.hash) + ", not " + f.hash;
        if (why) failures.push(role + " " + w + ": " + label + ": " + why);
        else if (f.close) for (const c of f.close) await page.locator(c).first().click({ timeout: 1000 }).catch(() => {});
        process.stdout.write(why ? "x" : ".");
      }
      console.log("");
      if (errors.length) failures.push(role + " " + w + ": page errors: " + [...new Set(errors)].join("; "));
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log("\n" + checked + " checks, " + failures.length + " failed");
if (known.size) console.log("  Known gaps (not failed; listed in the inventory):\n  - " + [...known].join("\n  - "));
if (failures.length) {
  console.log("  FAIL " + failures.join("\n  FAIL "));
  process.exitCode = 1;
}
