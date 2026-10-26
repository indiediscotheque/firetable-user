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

Without it, pasted soundcloud.com links and playlist imports still work through the legacy resolver; keyword search shows a message asking for a link.

## avatars
Robot avatars provided by [robohash.org](https://robohash.org/).
