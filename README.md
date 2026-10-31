# firetable-user
client side front end for firetable, a virtual music listening room powered by firebase.

pairs with a node.js "chatbot" backend ([firetable-hostbot](https://github.com/mxew/firetable-hostbot)) that manages song lengths, queue order, DJ playcounts...

## first time setup
Steps for first time setup (running a firetable room locally) can be found [here](https://github.com/mxew/firetable-user/wiki/first-time-setup).

## configuration
- make a copy of config.js.example
- rename copy to config.js
- edit contents of config.js with your own configs/api keys

## soundcloud
**How it works today (no SoundCloud app, nothing paid), and it should stay this way:**
- Playing SoundCloud tracks uses SoundCloud's embeddable player, which needs no key.
- Pasted soundcloud.com links and playlist imports work through the legacy resolver (`SC_RESOLVE_URL` / `SC_PROXY_URL` in `js/constants.js`). Keyword search shows a message asking for a link.
- The hostbot checks each SoundCloud track before it plays with SoundCloud's own web API and a client id (`SOUNDCLOUD_KEY` in the bot's `.env`; see "soundcloud" in the firetable-hostbot README).

SoundCloud's official API only answers requests signed with a registered app's client ID *and* secret, which this room doesn't have, so `api/soundcloud.php` answers `501 not configured` and the site uses the paths above. Don't remove the legacy resolver or switch the bot over while that's the case: SoundCloud links, imports and tracks would stop working. Both workarounds rely on services SoundCloud (or the resolver's host) could change; if links stop resolving or the bot says it can't reach SoundCloud, nothing is lost (the bot flags nothing and keeps YouTube tracks playing) and the fix is a working client id, not a code change.

### adding an official SoundCloud app later (optional)
If the room gets a registered SoundCloud app (SoundCloud reviews app requests; depending on their current terms that may need a paid plan), the site and the bot are ready for it. SoundCloud's API only accepts OAuth requests, which need your app's client secret, so the browser can't search it directly. `api/soundcloud.php` (PHP 8.1+ with cURL) gets and caches the token and handles track search, playlist search, link lookups and playlist imports.
- register the app at https://soundcloud.com/you/apps and note its client ID and secret
- copy `api/soundcloud-config.php.example` to `api/soundcloud-config.php` on the server
- add your SoundCloud app's client ID and secret (or set `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET`)
- the file is git-ignored and the deploy never uploads or overwrites it
- the proxy only answers this site's pages (plus any `allowed_origins` you list) and rate-limits each visitor IP (default 120 requests per 10 minutes, set with `rate_limit`); see the example config
- check `https://<your site>/api/soundcloud.php?action=tracks&ids=13158665` answers with JSON instead of `501`; keyword search then works
- for the bot, add the same values to its `.env` as `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET` and restart it (firetable-hostbot README, "soundcloud")

Without it, pasted soundcloud.com links and playlist imports still work through the legacy resolver; keyword search shows a message asking for a link. Keep the legacy resolver either way: it's the fallback when the proxy can't help.

## last.fm scrobbling
Last.fm signs every scrobble with your API account's shared secret, so the browser never gets it: `api/lastfm.php` (PHP 8.1+ with cURL) adds the API key, signs the call and relays Last.fm's answer. It only signs connecting an account, now playing, scrobbles and loves.
- easiest: add repository secrets `LASTFM_API_KEY` and `LASTFM_SECRET` (Settings → Secrets and variables → Actions) with the values from https://www.last.fm/api/accounts. The deploy writes `api/lastfm-config.php` on the server from them, readable only by your account, and checks the proxy answers afterwards
- or by hand: copy `api/lastfm-config.php.example` to `api/lastfm-config.php` on the server and fill it in (or set the `LASTFM_API_KEY` / `LASTFM_SECRET` environment variables). The deploy leaves a hand-made file alone
- the file is git-ignored, so the secret never enters git
- same caller check as the SoundCloud proxy; each visitor IP gets 60 calls per 10 minutes by default (`rate_limit`)

Without it, the "Set up Last.fm scrobbling" link and scrobbling stop working; nothing else is affected.

Both proxies share `api/common.php` (config loading, caller check, rate limit, HTTP); `api/.htaccess` keeps it and the config files from being served.

## hostbot
Works with the original bot ([mxew/firetable-hostbot](https://github.com/mxew/firetable-hostbot)): the site only uses bot commands and database paths it already has. A few extras need [indiediscotheque/firetable-hostbot](https://github.com/indiediscotheque/firetable-hostbot): `!lights` / `!lightson` / `!lightsoff` outside the lights months, seasonal trading-card avatars, and timing stamped with the database clock (with the original bot, song positions follow the bot server's clock).

### seasons stay in sync with the bot
Seasonal settings live only on this site: defaults in `js/seasons.js`, overrides in `config.js` (`avatarset`, `avatarSeasons`, `lightsMonths`, `snowMonths`). The indiediscotheque hostbot reads both files from the live site, at startup and every 10 minutes, so its trading-card avatars and `!lights` replies follow them. Change them here, deploy (or edit `config.js` on the server), and the bot picks it up with nothing to change on the bot. It needs `SITE_URL` (this site's address) in the bot's `.env`. The bot reads these settings with a parser and never runs the files, so keep them plain values (text, numbers, `true`/`false`, lists and objects), not expressions or function calls; anything else is skipped.

## push notifications
Members can get @mentions as notifications on their phone, even with the app closed: install the site as an app (iPhone/iPad: Share → Add to Home Screen, which they need for notifications; Android: Install app), then **Settings → Push @mentions to this device**. It works in desktop browsers too.
- The [indiediscotheque hostbot](https://github.com/indiediscotheque/firetable-hostbot) sends them (its README, "push notifications"); it makes its own keys and publishes the public one as `pushKey`, so there's nothing to configure here. Until a bot with push is running, the setting says it isn't set up yet.
- `sw.js` (the service worker, at the site's root) shows each notification; tapping one opens the room's @ inbox. The app icon shows the unread count where the phone supports it. It has no fetch handler, so it never caches pages or changes how the site loads, and `.htaccess` sends it with `Cache-Control: no-cache` so updates reach phones on their next visit.
- `js/push.js` signs the device up and saves it under `pushSubs/<uid>/` for the bot, and re-checks on every visit (a subscription the browser replaced, a new bot key, or notifications blocked in the phone's settings are all picked up). Signing out removes the device; signing back in with the same account restores it.
- Options: "Also push @everyone announcements" (from mods and the bot), "Send a test" (goes through the bot, like a real mention), and the list of the account's devices with a button to remove each. The @ inbox suggests turning it on when it's opened in the installed app or on a phone.
- Nobody is pushed while they're looking at the room; the bot also skips blocked people and stale messages.
- **Get the app** (`js/install.js`): a guide to installing the site, with the steps for the visitor's own device first (iPhone/iPad, Android, computer) and a one-tap **Install the app** button where the browser offers one (Chrome, Edge, Samsung Internet). It opens from the "Get the app" card at the top of Settings, "Get the app on your phone" on the login screen (phones), and the push setting's and @ inbox's hints. Inside the installed app it says so instead.

## checks
`npm ci && npm run lint` runs ESLint on `js/` (the config lists the globals each script shares). GitHub Actions runs it, plus a PHP syntax check of `api/`, on every push and pull request, and before every deploy. None of these tooling files are deployed.

`tests/` holds a browser smoke test (`.github/workflows/smoke.yml`, every push and pull request): it serves the site under the real Content-Security-Policy from `.htaccess`, points it at a local database emulator, loads it in Chromium, and fails on page errors or anything the policy blocks. It also checks the song and theme show, YouTube's player loads, the stage effects load on first use, and the service worker registers and receives a push message. Run it with `cd tests && npm ci && npx playwright install chromium && npm run smoke` (Java 21 needed for the emulator). It doesn't gate the deploy, since it loads the CDNs and YouTube.

## deploy
Every push to `master` publishes the site to DreamHost (pages last, so a visitor mid-upload never gets a new page before its scripts) (`.github/workflows/deploy.yml`, settings listed at the top of that file). It runs the checks below first and only publishes if they pass. The `?v=…` on each link to this site's own scripts, stylesheets and fonts is set at deploy time from a hash of that file, so visitors' browsers fetch exactly the files that changed; there's nothing to bump by hand (except `config.js?v=`, since `config.js` lives only on the server). Add the repository secret `DREAMHOST_KNOWN_HOSTS` (the output of `ssh-keyscan <your DreamHost server>`, run on your own computer) so the deploy only sends the SFTP password to that server; until then each run warns.

## security headers
`.htaccess` sends a Content Security Policy plus the usual hardening headers (no framing by other sites, HSTS, nosniff, referrer and permissions policies). The policy allows no inline scripts or event handlers, so add new behavior in the `js/` files with `addEventListener` / jQuery `.on()`, not `onclick="…"`. If you load something from a new host, add it to the matching directive in `.htaccess`. The policy only covers firetable's own paths, so other sites in folders on the same server (such as `/basement`) keep working; when you add a top-level file or folder, add it to the list in the `<If>` above the policy (CI checks this).

The deploy never overwrites the server's `.htaccess`: it puts this file inside a `# BEGIN firetable` … `# END firetable` block at the top and keeps every other rule (DreamHost's, redirects, anything added by hand). The previous copy is saved as `.htaccess.firetable-previous`. If the site answers with a server error afterwards, the old file is restored and the run fails. Set the repository variable `SITE_URL` if the site's address isn't the last part of `DREAMHOST_PATH`.

## third-party libraries
CDN scripts are pinned to exact versions and checked with Subresource Integrity: most in `index.html`, and the stage effects' libraries (PixiJS and GSAP for the fire, p5.js for the SoundCloud album-art glitch) in `js/lazy.js`, which loads them the first time the effect shows instead of with every page. The Content-Security-Policy in `.htaccess` allows each of these exact files, not whole CDNs. When upgrading one, update its URL in the policy and its `integrity` hash:
`curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`

## icons
`fonts/material-symbols-outlined.woff2` holds only the icons the site uses (about 260 KB instead of ~4 MB). After using an icon the site hasn't used before, rebuild it:
`pip install "fonttools[woff]" && python3 tools/subset-icons.py`
The full font lives in `tools/fonts/` (never deployed).

## avatars
Robot avatars provided by [robohash.org](https://robohash.org/).
