<?php
/**
 * common.php — shared plumbing for firetable's server-side API proxies
 * (soundcloud.php, lastfm.php): JSON responses, per-proxy config files,
 * a private cache folder, same-site caller checks, a per-IP rate limit and a
 * cURL wrapper that never follows redirects.
 *
 * Not a page: api/.htaccess denies it and it refuses to run on its own.
 */

declare(strict_types=1);

if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    http_response_code(404);
    exit;
}

const PROXY_HTTP_TIMEOUT = 15;

/** Thrown for failures that should reach the client with a given status. */
final class ProxyError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 502)
    {
        parent::__construct($message);
    }
}

/**
 * Name this proxy and send the headers every response shares.
 * @param string $name  config/cache name, e.g. "soundcloud" → soundcloud-config.php
 * @param string $label service name for messages, e.g. "SoundCloud"
 * @param string $cacheTag short tag for the default cache folder name
 */
function proxy_setup(string $name, string $label, string $cacheTag): void
{
    $GLOBALS['__proxy'] = ['name' => $name, 'label' => $label, 'cacheTag' => $cacheTag];
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
}

function proxy_info(string $key): string
{
    return (string)($GLOBALS['__proxy'][$key] ?? '');
}

/** Send a JSON response and stop. */
function respond(int $status, array $body, int $maxAge = 0): void
{
    http_response_code($status);
    header($maxAge > 0 ? 'Cache-Control: private, max-age=' . $maxAge : 'Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── Config ────────────────────────────────────────────────────────────────

/** <name>-config.php as an array (empty when missing). */
function load_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/' . proxy_info('name') . '-config.php';
        $cfg = is_file($file) ? (require $file) : [];
        if (!is_array($cfg)) $cfg = [];
    }
    return $cfg;
}

/** A setting from the environment (first) or the config file; placeholders count as unset. */
function config_secret(string $env, string $key): string
{
    $value = getenv($env) ?: (string)(load_config()[$key] ?? '');
    return str_contains($value, 'xxxx') ? '' : $value;
}

/**
 * A private folder for cached tokens and rate-limit files: cache_dir from the
 * config, or one in the system temp folder that only this account can read
 * (shared hosts share /tmp between accounts).
 */
function cache_dir(): string
{
    $dir = (string)(load_config()['cache_dir'] ?? '');
    if ($dir === '') {
        $owner = function_exists('posix_geteuid') ? (string)posix_geteuid() : get_current_user();
        $dir = rtrim(sys_get_temp_dir(), '/') . '/firetable-' . proxy_info('cacheTag') . '-'
            . substr(sha1(__DIR__ . '|' . $owner), 0, 16);
    }
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new ProxyError('Cache folder is not writable.', 500);
    }
    @chmod($dir, 0700);
    return $dir;
}

// ─── Who may call this ─────────────────────────────────────────────────────

/** Origins (scheme://host[:port]) listed in allowed_origins. */
function allowed_origins(): array
{
    return array_map(fn($o) => rtrim((string)$o, '/'), (array)(load_config()['allowed_origins'] ?? []));
}

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
    $originAllowed = $origin !== '' && in_array(rtrim($origin, '/'), allowed_origins(), true);

    if ($originAllowed) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    if (($site === 'cross-site' || $site === 'same-site') && !$originAllowed) {
        throw new ProxyError('This proxy only serves its own site.', 403);
    }
}

/**
 * Fixed-window rate limit per client IP, so nobody can burn the app's quota.
 * rate_limit in the config: [requests, seconds], or false.
 */
function rate_limit(int $cost, array $default): void
{
    $cfg = load_config();
    $limit = array_key_exists('rate_limit', $cfg) ? $cfg['rate_limit'] : $default;
    if (!$limit) return;
    [$max, $window] = [max(1, (int)$limit[0]), max(1, (int)$limit[1])];

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
            throw new ProxyError('Too many ' . proxy_info('label') . ' requests. Try again in a few minutes.', 429);
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
 * Minimal cURL wrapper (HTTPS only). Never follows redirects on its own, so
 * credentials can't leak to another host.
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
        CURLOPT_TIMEOUT        => PROXY_HTTP_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json; charset=utf-8'], $headers),
        CURLOPT_USERAGENT      => 'firetable-' . proxy_info('name') . '-proxy/1.0',
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
        throw new ProxyError('Could not reach ' . proxy_info('label') . ': ' . $err, 504);
    }
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ['status' => $status, 'body' => (string)$res, 'location' => $location];
}

/** Run a proxy's request handler, turning errors into JSON responses. */
function proxy_run(callable $handler): void
{
    try {
        $handler();
    } catch (ProxyError $e) {
        respond($e->status, ['error' => $e->getMessage()]);
    } catch (Throwable $e) {
        error_log('[firetable ' . proxy_info('name') . ' proxy] ' . $e);
        respond(500, ['error' => 'Unexpected server error.']);
    }
}
