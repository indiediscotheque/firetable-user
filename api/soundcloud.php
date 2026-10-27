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
const SC_HTTP_TIMEOUT  = 15;
const SC_RATE_LIMIT    = [120, 600]; // default: 120 requests per 10 minutes per IP
const SC_ACTION_COST   = ['search' => 1, 'resolve' => 1, 'playlist' => 5];

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

/** Send a JSON response and stop. */
function respond(int $status, array $body, int $maxAge = 0): void
{
    http_response_code($status);
    header($maxAge > 0 ? 'Cache-Control: private, max-age=' . $maxAge : 'Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** Thrown for failures that should reach the client with a given status. */
final class ScError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 502)
    {
        parent::__construct($message);
    }
}

// ─── Config ────────────────────────────────────────────────────────────────

/** soundcloud-config.php as an array (empty when missing). */
function load_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/soundcloud-config.php';
        $cfg = is_file($file) ? (require $file) : [];
        if (!is_array($cfg)) $cfg = [];
    }
    return $cfg;
}

/** @return array{client_id: string, client_secret: string} */
function load_credentials(): array
{
    $cfg = load_config();
    $id = getenv('SOUNDCLOUD_CLIENT_ID') ?: (string)($cfg['client_id'] ?? '');
    $secret = getenv('SOUNDCLOUD_CLIENT_SECRET') ?: (string)($cfg['client_secret'] ?? '');
    if (!$id || !$secret || str_contains($id, 'xxxx') || str_contains($secret, 'xxxx')) {
        throw new ScError('SoundCloud proxy is not configured (missing client ID/secret).', 501);
    }
    return ['client_id' => $id, 'client_secret' => $secret];
}

/**
 * A private folder for the token and rate-limit files: cache_dir from the
 * config, or one in the system temp folder that only this account can read
 * (shared hosts share /tmp between accounts).
 */
function cache_dir(): string
{
    $dir = (string)(load_config()['cache_dir'] ?? '');
    if ($dir === '') {
        $owner = function_exists('posix_geteuid') ? (string)posix_geteuid() : get_current_user();
        $dir = rtrim(sys_get_temp_dir(), '/') . '/firetable-sc-' . substr(sha1(__DIR__ . '|' . $owner), 0, 16);
    }
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new ScError('Cache folder is not writable.', 500);
    }
    @chmod($dir, 0700);
    return $dir;
}

// ─── Who may call this ─────────────────────────────────────────────────────

/**
 * Only this site's pages (and origins listed in allowed_origins) may use the
 * proxy. Browsers say where a request comes from in Sec-Fetch-Site; requests
 * from other websites are refused. Allowed cross-origin callers get CORS
 * headers so a proxy on another host works.
 */
function check_caller(): void
{
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    $site = strtolower((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    $allowed = array_map(fn($o) => rtrim((string)$o, '/'), (array)(load_config()['allowed_origins'] ?? []));
    $originAllowed = $origin !== '' && in_array(rtrim($origin, '/'), $allowed, true);

    if ($originAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    if (($site === 'cross-site' || $site === 'same-site') && !$originAllowed) {
        throw new ScError('This proxy only serves its own site.', 403);
    }
}

/**
 * Fixed-window rate limit per client IP, so nobody can burn the app's
 * SoundCloud quota. rate_limit in the config: [requests, seconds], or false.
 */
function rate_limit(string $action): void
{
    $cfg = load_config();
    $limit = array_key_exists('rate_limit', $cfg) ? $cfg['rate_limit'] : SC_RATE_LIMIT;
    if (!$limit) return;
    [$max, $window] = [max(1, (int)$limit[0]), max(1, (int)$limit[1])];
    $cost = SC_ACTION_COST[$action] ?? 1;

    $dir = cache_dir();
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $path = $dir . '/rl-' . sha1($ip) . '.json';
    $old = umask(0077);
    $fh = fopen($path, 'c+');
    umask($old);
    if (!$fh) return; // never block the site because of the limiter
    try {
        flock($fh, LOCK_EX);
        $now = time();
        $state = json_decode((string)stream_get_contents($fh), true) ?: [];
        if (($state['start'] ?? 0) + $window <= $now) $state = ['start' => $now, 'used' => 0];
        if ($state['used'] + $cost > $max) {
            header('Retry-After: ' . max(1, $state['start'] + $window - $now));
            throw new ScError('Too many SoundCloud requests. Try again in a few minutes.', 429);
        }
        $state['used'] += $cost;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($state));
        fflush($fh);
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
    // Now and then, clear out other addresses' expired windows
    if (mt_rand(1, 100) === 1) {
        foreach (glob($dir . '/rl-*.json') ?: [] as $f) {
            if (filemtime($f) < time() - 2 * $window) @unlink($f);
        }
    }
}

// ─── HTTP ──────────────────────────────────────────────────────────────────

/**
 * Minimal cURL wrapper. Never follows redirects on its own, so the OAuth
 * header can't leak to another host.
 * @return array{status: int, body: string, location: ?string}
 */
function http_request(string $method, string $url, array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    $location = null;
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT        => SC_HTTP_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json; charset=utf-8'], $headers),
        CURLOPT_USERAGENT      => 'firetable-soundcloud-proxy/1.0',
        CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$location) {
            if (stripos($line, 'location:') === 0) $location = trim(substr($line, 9));
            return strlen($line);
        },
    ]);
    if ($method === 'HEAD') curl_setopt($ch, CURLOPT_NOBODY, true);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $res = curl_exec($ch);
    if ($res === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new ScError('Could not reach SoundCloud: ' . $err, 504);
    }
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ['status' => $status, 'body' => (string)$res, 'location' => $location];
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
    if (!$fh) throw new ScError('Token cache is not writable.', 500);
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
        if (!$token) throw new ScError('SoundCloud rejected the app credentials.', 502);

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
    if ($res['status'] === 429) throw new ScError('SoundCloud token rate limit reached. Try again later.', 503);
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
    if (!is_api_url($url)) throw new ScError('Refusing to call a non-SoundCloud API URL.', 400);

    for ($attempt = 0, $redirects = 0; ; ) {
        $token = access_token($creds, $attempt > 0);
        $res = http_request('GET', $url, ['Authorization: OAuth ' . $token]);

        if ($res['status'] === 401 && $attempt === 0) { $attempt++; continue; }
        if (in_array($res['status'], [301, 302, 303, 307, 308], true) && $res['location'] && $redirects < 2) {
            $next = $res['location'];
            if (str_starts_with($next, '/')) $next = SC_API_BASE . $next;
            if (!is_api_url($next)) throw new ScError('SoundCloud redirected somewhere unexpected.', 502);
            $url = $next;
            $redirects++;
            continue;
        }
        if ($res['status'] === 404) throw new ScError('Not found on SoundCloud (it may be private or deleted).', 404);
        if ($res['status'] === 429) throw new ScError('SoundCloud rate limit reached. Try again later.', 429);
        if ($res['status'] < 200 || $res['status'] >= 300) {
            throw new ScError('SoundCloud API error (HTTP ' . $res['status'] . ').', 502);
        }
        $json = json_decode($res['body'], true);
        if (!is_array($json)) throw new ScError('SoundCloud returned an unreadable response.', 502);
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
        if (!preg_match('#^/[A-Za-z0-9]+/?$#', $path)) throw new ScError('That short link looks invalid.', 400);
        $res = http_request('HEAD', 'https://on.soundcloud.com' . $path);
        $target = $res['location'] ?? '';
        if (!$target || strtolower((string)parse_url($target, PHP_URL_HOST)) === 'on.soundcloud.com') {
            throw new ScError('Could not expand that SoundCloud short link.', 404);
        }
        return normalize_sc_link($target);
    }
    if (!in_array($host, ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'], true)) {
        throw new ScError('That is not a SoundCloud link.', 400);
    }
    if ($path === '' || $path === '/') throw new ScError('That SoundCloud link has no track or playlist in it.', 400);
    return 'https://soundcloud.com' . rtrim($path, '/');
}

// ─── Router ────────────────────────────────────────────────────────────────

function clamp_limit(mixed $raw): int
{
    $n = filter_var($raw, FILTER_VALIDATE_INT);
    return $n === false ? SC_DEFAULT_LIMIT : max(1, min(SC_MAX_LIMIT, $n));
}

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') throw new ScError('Only GET is supported.', 405);
    check_caller();
    $action = (string)($_GET['action'] ?? '');
    rate_limit($action);
    $creds = load_credentials();

    switch ($action) {
        case 'search': {
            $type = (string)($_GET['type'] ?? 'tracks');
            $q = trim((string)($_GET['q'] ?? ''));
            if ($q === '') throw new ScError('Missing search text.', 400);
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
                throw new ScError('Unknown search type.', 400);
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
            if (!preg_match('/^\d{1,20}$/', $id)) throw new ScError('Invalid playlist id.', 400);
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

        default:
            throw new ScError('Unknown action.', 400);
    }
} catch (ScError $e) {
    respond($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('[firetable soundcloud proxy] ' . $e);
    respond(500, ['error' => 'Unexpected server error.']);
}
