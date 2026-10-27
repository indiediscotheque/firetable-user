<?php
/**
 * lastfm.php — server-side signing proxy for Last.fm scrobbling.
 *
 * Every Last.fm write call must be signed with the app's shared secret, so the
 * secret lives here instead of in the browser. The page sends the call's plain
 * fields; this script adds the API key, signs them and relays Last.fm's JSON
 * answer unchanged (Last.fm errors keep their numeric "error" code).
 *
 *   GET  ?action=connect&cb=URL
 *        → 302 to Last.fm's "allow access" page, which returns to cb with ?token=
 *   POST method=auth.getSession&token=T
 *   POST method=track.updateNowPlaying&sk=S&artist=A&track=T[&album=&duration=]
 *   POST method=track.scrobble&sk=S&artist=A&track=T&timestamp=UNIX[&album=&duration=]
 *   POST method=track.love&sk=S&artist=A&track=T
 *
 * Only these methods and fields are signed, so the proxy can't be used to sign
 * arbitrary Last.fm calls. Proxy errors come back as { "error": "message" }:
 * 501 not configured, 403 a request from another website, 429 too many
 * requests from one address.
 *
 * Credentials: set LASTFM_API_KEY and LASTFM_SECRET in the environment, or
 * copy lastfm-config.php.example to lastfm-config.php (next to this file) and
 * fill it in. That file is never committed or deployed.
 */

declare(strict_types=1);

const LFM_API_URL    = 'https://ws.audioscrobbler.com/2.0/';
const LFM_AUTH_URL   = 'https://www.last.fm/api/auth/';
const LFM_RATE_LIMIT = [60, 600]; // default: 60 calls per 10 minutes per IP
const LFM_MAX_FIELD  = 512;

/** Allowed methods: [fields they accept, fields they need]. */
const LFM_METHODS = [
    'auth.getSession'        => [['token'], ['token']],
    'track.updateNowPlaying' => [['sk', 'artist', 'track', 'album', 'duration'], ['sk', 'artist', 'track']],
    'track.scrobble'         => [['sk', 'artist', 'track', 'album', 'duration', 'timestamp'], ['sk', 'artist', 'track', 'timestamp']],
    'track.love'             => [['sk', 'artist', 'track'], ['sk', 'artist', 'track']],
];

require __DIR__ . '/common.php';
proxy_setup('lastfm', 'Last.fm', 'lastfm');

/** @return array{api_key: string, secret: string} */
function load_credentials(): array
{
    $key = config_secret('LASTFM_API_KEY', 'api_key');
    $secret = config_secret('LASTFM_SECRET', 'secret');
    if (!$key || !$secret) {
        throw new ProxyError('Last.fm scrobbling is not set up on this server (missing API key/secret).', 501);
    }
    return ['api_key' => $key, 'secret' => $secret];
}

/** Last.fm's api_sig: md5 of the sorted name+value pairs, then the secret ("format" is never signed). */
function lastfm_signature(array $params, string $secret): string
{
    unset($params['format'], $params['callback']);
    ksort($params, SORT_STRING);
    $raw = '';
    foreach ($params as $k => $v) $raw .= $k . $v;
    return md5($raw . $secret);
}

/** Check one field against what Last.fm expects; returns the cleaned value. */
function lastfm_field(string $name, mixed $value): string
{
    if (!is_string($value)) throw new ProxyError('Invalid ' . $name . '.', 400);
    $value = trim($value);
    $ok = match ($name) {
        'sk', 'token'           => (bool)preg_match('/^[A-Za-z0-9_-]{1,64}$/', $value),
        'timestamp', 'duration' => (bool)preg_match('/^\d{1,10}$/', $value),
        default                 => $value !== '' && mb_check_encoding($value, 'UTF-8') && mb_strlen($value) <= LFM_MAX_FIELD,
    };
    if (!$ok) throw new ProxyError('Invalid ' . $name . '.', 400);
    return $value;
}

/** Is cb a page on this site (or an allowed origin)? Keeps "connect" from being an open redirect. */
function lastfm_callback_ok(string $cb): bool
{
    $scheme = strtolower((string)parse_url($cb, PHP_URL_SCHEME));
    $host = strtolower((string)parse_url($cb, PHP_URL_HOST));
    if (!in_array($scheme, ['http', 'https'], true) || $host === '') return false;
    $port = parse_url($cb, PHP_URL_PORT);
    $origin = $scheme . '://' . $host . ($port ? ':' . $port : '');
    $self = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    return $host . ($port ? ':' . $port : '') === $self || $host === $self
        || in_array($origin, array_map('strtolower', allowed_origins()), true);
}

proxy_run(function (): void {
    $verb = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    // Link from the Settings menu: send the visitor to Last.fm to allow access
    if ($verb === 'GET' && ($_GET['action'] ?? '') === 'connect') {
        rate_limit(1, LFM_RATE_LIMIT);
        $cb = (string)($_GET['cb'] ?? '');
        if (!lastfm_callback_ok($cb)) throw new ProxyError('Invalid return address.', 400);
        $creds = load_credentials();
        header('Cache-Control: no-store');
        header('Location: ' . LFM_AUTH_URL . '?' . http_build_query(['api_key' => $creds['api_key'], 'cb' => $cb]), true, 302);
        exit;
    }

    if ($verb !== 'POST') throw new ProxyError('Only POST is supported.', 405);
    check_caller();
    rate_limit(1, LFM_RATE_LIMIT);

    $method = (string)($_POST['method'] ?? '');
    if (!isset(LFM_METHODS[$method])) throw new ProxyError('Unsupported Last.fm method.', 400);
    [$accepted, $required] = LFM_METHODS[$method];

    $params = ['method' => $method];
    foreach ($accepted as $name) {
        if (!isset($_POST[$name]) || $_POST[$name] === '') {
            if (in_array($name, $required, true)) throw new ProxyError('Missing ' . $name . '.', 400);
            continue;
        }
        $params[$name] = lastfm_field($name, $_POST[$name]);
    }

    $creds = load_credentials();
    $params['api_key'] = $creds['api_key'];
    $params['api_sig'] = lastfm_signature($params, $creds['secret']);
    $params['format'] = 'json';

    $res = http_request('POST', LFM_API_URL, ['Content-Type: application/x-www-form-urlencoded'], http_build_query($params));
    $json = json_decode($res['body'], true);
    if (!is_array($json)) {
        throw new ProxyError('Last.fm returned an unreadable response (HTTP ' . $res['status'] . ').', 502);
    }
    // Relay Last.fm's answer as-is; its errors ({error: 9, message}) stay
    // readable by the page, with a matching status
    respond($res['status'] >= 200 && $res['status'] < 600 ? $res['status'] : 502, $json);
});
