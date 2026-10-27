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

## checks
`npm ci && npm run lint` runs ESLint on `js/` (the config lists the globals each script shares). GitHub Actions runs it, plus a PHP syntax check of `api/`, on every push and pull request. None of these tooling files are deployed.

## security headers
`.htaccess` sends a Content Security Policy plus the usual hardening headers (no framing by other sites, HSTS, nosniff, referrer and permissions policies). The policy allows no inline scripts or event handlers, so add new behavior in the `js/` files with `addEventListener` / jQuery `.on()`, not `onclick="…"`. If you load something from a new host, add it to the matching directive in `.htaccess`.

The deploy uploads `.htaccess` only when the server has none or its copy contains `# firetable-managed`; a hand-made one is left alone (the run shows a warning).

## third-party libraries
CDN scripts in `index.html` are pinned to exact versions and checked with Subresource Integrity. When upgrading one, update its `integrity` hash too:
`curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`

## icons
`fonts/material-symbols-outlined.woff2` holds only the icons the site uses (about 260 KB instead of ~4 MB). After using an icon the site hasn't used before, rebuild it:
`pip install "fonttools[woff]" && python3 tools/subset-icons.py`
The full font lives in `tools/fonts/` (never deployed).

## avatars
Robot avatars provided by [robohash.org](https://robohash.org/).
