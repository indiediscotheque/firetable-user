# firetable-user
client side front end for firetable, a virtual music listening room powered by firebase.

pairs with a node.js "chatbot" backend ([firetable-hostbot](https://github.com/mxew/firetable-hostbot)) that manages song lengths, queue order, DJ playcounts...

## first time setup
Steps for first time setup (running a firetable room locally) can be found [here](https://github.com/mxew/firetable-user/wiki/first-time-setup).

## configuration
- make a copy of config.js.example
- rename copy to config.js
- edit contents of config.js with your own configs/api keys

## soundcloud search
SoundCloud's API only accepts OAuth requests, which need your app's client secret, so the browser can't search it directly. `api/soundcloud.php` (PHP 8.1+ with cURL) gets and caches the token and handles track search, playlist search, link lookups and playlist imports.
- copy `api/soundcloud-config.php.example` to `api/soundcloud-config.php` on the server
- add your SoundCloud app's client ID and secret (or set `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET`)
- the file is git-ignored and the deploy never uploads or overwrites it
- the proxy only answers this site's pages (plus any `allowed_origins` you list) and rate-limits each visitor IP (default 120 requests per 10 minutes, set with `rate_limit`); see the example config

Without it, pasted soundcloud.com links and playlist imports still work through the legacy resolver; keyword search shows a message asking for a link.

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

## checks
`npm ci && npm run lint` runs ESLint on `js/` (the config lists the globals each script shares). GitHub Actions runs it, plus a PHP syntax check of `api/`, on every push and pull request. None of these tooling files are deployed.

## security headers
`.htaccess` sends a Content Security Policy plus the usual hardening headers (no framing by other sites, HSTS, nosniff, referrer and permissions policies). The policy allows no inline scripts or event handlers, so add new behavior in the `js/` files with `addEventListener` / jQuery `.on()`, not `onclick="…"`. If you load something from a new host, add it to the matching directive in `.htaccess`. The policy only covers firetable's own paths, so other sites in folders on the same server (such as `/basement`) keep working; when you add a top-level file or folder, add it to the list in the `<If>` above the policy (CI checks this).

The deploy never overwrites the server's `.htaccess`: it puts this file inside a `# BEGIN firetable` … `# END firetable` block at the top and keeps every other rule (DreamHost's, redirects, anything added by hand). The previous copy is saved as `.htaccess.firetable-previous`. If the site answers with a server error afterwards, the old file is restored and the run fails. Set the repository variable `SITE_URL` if the site's address isn't the last part of `DREAMHOST_PATH`.

## third-party libraries
CDN scripts in `index.html` are pinned to exact versions and checked with Subresource Integrity. When upgrading one, update its `integrity` hash too:
`curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`

## icons
`fonts/material-symbols-outlined.woff2` holds only the icons the site uses (about 260 KB instead of ~4 MB). After using an icon the site hasn't used before, rebuild it:
`pip install "fonttools[woff]" && python3 tools/subset-icons.py`
The full font lives in `tools/fonts/` (never deployed).

## avatars
Robot avatars provided by [robohash.org](https://robohash.org/).
