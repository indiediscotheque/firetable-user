<?php
/**
 * soundcloud.php — server-side proxy for the SoundCloud API.
 *
 * SoundCloud only accepts OAuth-authenticated requests, and getting a token
 * needs the app's client secret, so the browser can't call the API itself.
 * This script gets a token with the client-credentials flow, caches it until
 * it expires, and exposes the few calls firetable needs:
 *
 *   ?action=search&type=tracks|playlists&q=TEXT[&limit=N]
 *       → { "collection": [ ...tracks or playlists... ] }
 *   ?action=resolve&url=https://soundcloud.com/...   (also m./www./on.)
 *       → { "item": { ...track, playlist or user... } }
 *   ?action=playlist&id=123
 *       → { "item": { ...playlist..., "tracks": [ ...playable tracks... ] } }
 *   ?action=tracks&ids=1,2,3                          (up to 50; broken-track check)
 *       → { "collection": [ ...the tracks that still exist... ] }
 *
 * Errors come back as { "error": "message" } with a matching HTTP status;
 * 501 means the proxy has no credentials yet, 403 a request from another
 * website, 429 too many requests from one address.
 *
 * Credentials: set SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET in the
 * environment, or copy soundcloud-config.php.example to soundcloud-config.php
 * (next to this file) and fill it in. That file is never committed or deployed.
 * It also holds the optional allowed_origins, rate_limit and cache_dir settings.
 */

declare(strict_types=1);

const SC_API_BASE      = 'https://api.soundcloud.com';
const SC_TOKEN_URL     = 'https://secure.soundcloud.com/oauth/token';
const SC_MAX_LIMIT     = 50;
const SC_DEFAULT_LIMIT = 15;
const SC_MAX_QUERY_LEN = 200;
const SC_PAGE_SIZE     = 200;   // playlist track page size
const SC_MAX_TRACKS    = 2000;  // cap on tracks returned for one playlist import
const SC_RATE_LIMIT    = [120, 600]; // default: 120 requests per 10 minutes per IP
const SC_ACTION_COST   = ['search' => 1, 'resolve' => 1, 'playlist' => 5, 'tracks' => 2];

require __DIR__ . '/common.php';
proxy_setup('soundcloud', 'SoundCloud', 'sc');

/** @return array{client_id: string, client_secret: string} */
function load_credentials(): array
{
    $id = config_secret('SOUNDCLOUD_CLIENT_ID', 'client_id');
    $secret = config_secret('SOUNDCLOUD_CLIENT_SECRET', 'client_secret');
    if (!$id || !$secret) {
        throw new ProxyError('SoundCloud proxy is not configured (missing client ID/secret).', 501);
    }
    return ['client_id' => $id, 'client_secret' => $secret];
}

// ─── OAuth token (cached) ──────────────────────────────────────────────────

function token_cache_path(string $clientId): string
{
    return cache_dir() . '/token-' . sha1($clientId) . '.json';
}

/**
 * Return a valid access token, reusing the cached one until it expires.
 * SoundCloud rate-limits token creation, so the cache file is locked while a
 * new token is fetched to stop concurrent requests from each asking for one.
 */
function access_token(array $creds, bool $forceNew = false): string
{
    $path = token_cache_path($creds['client_id']);
    $old = umask(0077); // created owner-only from the start (no readable moment)
    $fh = fopen($path, 'c+');
    umask($old);
    if (!$fh) throw new ProxyError('Token cache is not writable.', 500);
    try {
        flock($fh, LOCK_EX);
        $cached = json_decode((string)stream_get_contents($fh), true) ?: [];
        if (!$forceNew && !empty($cached['access_token']) && ($cached['expires_at'] ?? 0) > time()) {
            return $cached['access_token'];
        }

        $auth = 'Authorization: Basic ' . base64_encode($creds['client_id'] . ':' . $creds['client_secret']);
        $form = ['Content-Type: application/x-www-form-urlencoded'];
        $token = null;
        if (!empty($cached['refresh_token'])) {
            $token = request_token($auth, $form, [
                'grant_type' => 'refresh_token',
                'refresh_token' => $cached['refresh_token'],
            ]);
        }
        $token ??= request_token($auth, $form, ['grant_type' => 'client_credentials']);
        if (!$token) throw new ProxyError('SoundCloud rejected the app credentials.', 502);

        $entry = [
            'access_token'  => $token['access_token'],
            'refresh_token' => $token['refresh_token'] ?? null,
            'expires_at'    => time() + max(60, (int)($token['expires_in'] ?? 3600)) - 60,
        ];
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($entry));
        fflush($fh);
        return $entry['access_token'];
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

function request_token(string $auth, array $form, array $fields): ?array
{
    $res = http_request('POST', SC_TOKEN_URL, array_merge([$auth], $form), http_build_query($fields));
    if ($res['status'] === 429) throw new ProxyError('SoundCloud token rate limit reached. Try again later.', 503);
    $json = json_decode($res['body'], true);
    return ($res['status'] === 200 && !empty($json['access_token'])) ? $json : null;
}

// ─── API calls ─────────────────────────────────────────────────────────────

/**
 * GET an API path (or a full api.soundcloud.com URL such as next_href).
 * Retries once with a fresh token on 401, and follows one same-host redirect
 * (used by /resolve).
 */
function api_get(array $creds, string $pathOrUrl, array $query = []): array
{
    $url = str_starts_with($pathOrUrl, 'https://') ? $pathOrUrl : SC_API_BASE . $pathOrUrl;
    if ($query) $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($query);
    if (!is_api_url($url)) throw new ProxyError('Refusing to call a non-SoundCloud API URL.', 400);

    for ($attempt = 0, $redirects = 0; ; ) {
        $token = access_token($creds, $attempt > 0);
        $res = http_request('GET', $url, ['Authorization: OAuth ' . $token]);

        if ($res['status'] === 401 && $attempt === 0) { $attempt++; continue; }
        if (in_array($res['status'], [301, 302, 303, 307, 308], true) && $res['location'] && $redirects < 2) {
            $next = $res['location'];
            if (str_starts_with($next, '/')) $next = SC_API_BASE . $next;
            if (!is_api_url($next)) throw new ProxyError('SoundCloud redirected somewhere unexpected.', 502);
            $url = $next;
            $redirects++;
            continue;
        }
        if ($res['status'] === 404) throw new ProxyError('Not found on SoundCloud (it may be private or deleted).', 404);
        if ($res['status'] === 429) throw new ProxyError('SoundCloud rate limit reached. Try again later.', 429);
        if ($res['status'] < 200 || $res['status'] >= 300) {
            throw new ProxyError('SoundCloud API error (HTTP ' . $res['status'] . ').', 502);
        }
        $json = json_decode($res['body'], true);
        if (!is_array($json)) throw new ProxyError('SoundCloud returned an unreadable response.', 502);
        return $json;
    }
}

function is_api_url(string $url): bool
{
    return parse_url($url, PHP_URL_SCHEME) === 'https' && parse_url($url, PHP_URL_HOST) === 'api.soundcloud.com';
}

/** Pull the item list out of either a plain array or a linked_partitioning page. */
function collection_of(array $json): array
{
    return array_is_list($json) ? $json : ($json['collection'] ?? []);
}

// ─── Output shaping (only the fields the client uses) ──────────────────────

function artwork(?string $url): ?string
{
    return $url ? str_replace('-large.', '-t300x300.', $url) : null;
}

function slim_user(?array $u): array
{
    return [
        'id'            => $u['id'] ?? null,
        'username'      => $u['username'] ?? '',
        'permalink_url' => $u['permalink_url'] ?? null,
        'avatar_url'    => artwork($u['avatar_url'] ?? null),
    ];
}

function slim_track(array $t): array
{
    return [
        'kind'          => 'track',
        'id'            => $t['id'] ?? null,
        'title'         => $t['title'] ?? '',
        'user'          => slim_user($t['user'] ?? null),
        'artwork_url'   => artwork($t['artwork_url'] ?? null) ?? artwork($t['user']['avatar_url'] ?? null),
        'permalink_url' => $t['permalink_url'] ?? null,
        'duration'      => $t['duration'] ?? null,
        'access'        => $t['access'] ?? null,
        'streamable'    => $t['streamable'] ?? null,
        'sharing'       => $t['sharing'] ?? null,
    ];
}

function slim_playlist(array $p): array
{
    return [
        'kind'          => 'playlist',
        'id'            => $p['id'] ?? null,
        'title'         => $p['title'] ?? '',
        'user'          => slim_user($p['user'] ?? null),
        'artwork_url'   => artwork($p['artwork_url'] ?? null),
        'permalink_url' => $p['permalink_url'] ?? null,
        'track_count'   => $p['track_count'] ?? 0,
        'sharing'       => $p['sharing'] ?? null,
    ];
}

function slim_item(array $item): array
{
    return match ($item['kind'] ?? '') {
        'track'    => slim_track($item),
        'playlist' => slim_playlist($item),
        'user'     => ['kind' => 'user'] + slim_user($item),
        default    => ['kind' => $item['kind'] ?? 'unknown', 'id' => $item['id'] ?? null],
    };
}

// ─── Link handling ─────────────────────────────────────────────────────────

/**
 * Accept only soundcloud.com links (www./m./on. too). Short on.soundcloud.com
 * links are expanded by reading their redirect. Query strings and fragments
 * (share tracking like ?si=…) are dropped.
 */
function normalize_sc_link(string $raw): string
{
    $raw = trim($raw);
    if (!preg_match('#^https?://#i', $raw)) $raw = 'https://' . $raw;
    $host = strtolower((string)parse_url($raw, PHP_URL_HOST));
    $path = (string)parse_url($raw, PHP_URL_PATH);

    if ($host === 'on.soundcloud.com') {
        if (!preg_match('#^/[A-Za-z0-9]+/?$#', $path)) throw new ProxyError('That short link looks invalid.', 400);
        $res = http_request('HEAD', 'https://on.soundcloud.com' . $path);
        $target = $res['location'] ?? '';
        if (!$target || strtolower((string)parse_url($target, PHP_URL_HOST)) === 'on.soundcloud.com') {
            throw new ProxyError('Could not expand that SoundCloud short link.', 404);
        }
        return normalize_sc_link($target);
    }
    if (!in_array($host, ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'], true)) {
        throw new ProxyError('That is not a SoundCloud link.', 400);
    }
    if ($path === '' || $path === '/') throw new ProxyError('That SoundCloud link has no track or playlist in it.', 400);
    return 'https://soundcloud.com' . rtrim($path, '/');
}

// ─── Router ────────────────────────────────────────────────────────────────

function clamp_limit(mixed $raw): int
{
    $n = filter_var($raw, FILTER_VALIDATE_INT);
    return $n === false ? SC_DEFAULT_LIMIT : max(1, min(SC_MAX_LIMIT, $n));
}

proxy_run(function (): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') throw new ProxyError('Only GET is supported.', 405);
    check_caller();
    $action = (string)($_GET['action'] ?? '');
    rate_limit(SC_ACTION_COST[$action] ?? 1, SC_RATE_LIMIT);
    $creds = load_credentials();

    switch ($action) {
        case 'search': {
            $type = (string)($_GET['type'] ?? 'tracks');
            $q = trim((string)($_GET['q'] ?? ''));
            if ($q === '') throw new ProxyError('Missing search text.', 400);
            if (mb_strlen($q) > SC_MAX_QUERY_LEN) $q = mb_substr($q, 0, SC_MAX_QUERY_LEN);
            $limit = clamp_limit($_GET['limit'] ?? null);

            if ($type === 'tracks') {
                $json = api_get($creds, '/tracks', [
                    'q' => $q, 'limit' => $limit, 'access' => 'playable', 'linked_partitioning' => 'true',
                ]);
                $out = array_map('slim_track', collection_of($json));
            } elseif ($type === 'playlists') {
                $json = api_get($creds, '/playlists', [
                    'q' => $q, 'limit' => $limit, 'show_tracks' => 'false', 'linked_partitioning' => 'true',
                ]);
                $out = array_values(array_filter(
                    array_map('slim_playlist', collection_of($json)),
                    fn($p) => $p['sharing'] !== 'private' && $p['track_count'] > 0
                ));
            } else {
                throw new ProxyError('Unknown search type.', 400);
            }
            respond(200, ['collection' => $out], 300);
        }

        case 'resolve': {
            $url = normalize_sc_link((string)($_GET['url'] ?? ''));
            $item = api_get($creds, '/resolve', ['url' => $url]);
            respond(200, ['item' => slim_item($item)], 300);
        }

        case 'playlist': {
            $id = (string)($_GET['id'] ?? '');
            if (!preg_match('/^\d{1,20}$/', $id)) throw new ProxyError('Invalid playlist id.', 400);
            $meta = slim_playlist(api_get($creds, '/playlists/' . $id, ['show_tracks' => 'false']));

            $tracks = [];
            $next = '/playlists/' . $id . '/tracks';
            $query = ['limit' => SC_PAGE_SIZE, 'linked_partitioning' => 'true', 'access' => 'playable'];
            while ($next && count($tracks) < SC_MAX_TRACKS) {
                $page = api_get($creds, $next, $query);
                foreach (collection_of($page) as $t) $tracks[] = slim_track($t);
                $next = array_is_list($page) ? null : ($page['next_href'] ?? null);
                $query = []; // next_href already carries the query
            }
            $meta['tracks'] = array_slice($tracks, 0, SC_MAX_TRACKS);
            respond(200, ['item' => $meta], 60);
        }

        case 'tracks': {
            // Status of up to 50 tracks by id (the broken-track check). Gone
            // or private tracks are simply missing from the answer.
            $ids = (string)($_GET['ids'] ?? '');
            if (!preg_match('/^\d{1,20}(,\d{1,20}){0,49}$/', $ids)) throw new ProxyError('Invalid track ids.', 400);
            $json = api_get($creds, '/tracks', ['ids' => $ids, 'limit' => 50, 'linked_partitioning' => 'true']);
            respond(200, ['collection' => array_map('slim_track', collection_of($json))], 300);
        }

        default:
            throw new ProxyError('Unknown action.', 400);
    }
});
