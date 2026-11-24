<?php
/**
 * audience.php — who's with the room besides the members in it: visitors on
 * the site without an account (guests), and people listening to the radio
 * stream, counted by country.
 *
 *   GET            → {"guests":4,"guestsLive":2,"guestsUnplaced":1,
 *                      "guestCountries":[{"code":"DE","name":"Germany","n":2},…],
 *                      "stream":{"listeners":7,"unplaced":1,
 *                      "countries":[{"code":"US","name":"United States","n":3},…]},"updated":"…"}
 *   POST id=ID[&live=1][&tz=Europe/Berlin]   a guest's heartbeat (once a minute
 *                          while the page is open); answers like GET
 *   POST id=ID&leave=1    the guest closed the page or signed in
 *
 * Guests: each browser sends a random id it made itself. It's kept for
 * GUEST_TTL seconds after its last heartbeat, filed under a keyed hash, with
 * no address (only a keyed hash of one, to cap how many guests one address
 * can add). "live" means the room is sounding on that page, not Discover.
 * Where a guest is comes from their device's time zone, which PHP's own time
 * zone data places in a country: only the country is kept, and no address
 * is looked up anywhere.
 *
 * The stream: Broadcast Pal's api/listeners.php (id-broadcast-pal) already
 * reads Icecast, drops bots and looks up where each listener is. This asks it
 * at most once a minute and passes on only countries and counts. Its address:
 * LISTENERS_URL in the environment, or listeners_url (or broadcast_pal_url,
 * Broadcast Pal's page) in audience-config.php, which the deploy writes from
 * the BROADCAST_PAL_URL repository variable. Without one, "stream" is null.
 *
 * Errors come back as { "error": "message" }: 403 a request from another
 * website, 405 another method, 429 too many heartbeats from one address.
 */

declare(strict_types=1);

const AUD_GUEST_TTL = 150;        // seconds a guest counts after its last heartbeat
const AUD_PER_ADDRESS = 6;        // guests one address can add (a household, a few tabs' browsers)
const AUD_MAX_GUESTS = 5000;      // guests kept at all
const AUD_STREAM_TTL = 60;        // seconds Broadcast Pal's answer is reused
const AUD_STREAM_STALE = 600;     // an older answer is still used this long when it can't be reached
const AUD_RATE_LIMIT = [60, 600]; // heartbeats per address per 10 minutes
// Older time zone names some browsers still send, for servers without PHP's intl
const AUD_TZ_ALIASES = [
    'Asia/Calcutta' => 'Asia/Kolkata', 'Europe/Kiev' => 'Europe/Kyiv', 'Asia/Saigon' => 'Asia/Ho_Chi_Minh',
    'Asia/Katmandu' => 'Asia/Kathmandu', 'Asia/Rangoon' => 'Asia/Yangon', 'America/Buenos_Aires' => 'America/Argentina/Buenos_Aires',
    'Atlantic/Faeroe' => 'Atlantic/Faroe', 'Pacific/Truk' => 'Pacific/Chuuk', 'America/Godthab' => 'America/Nuuk',
    'Asia/Dacca' => 'Asia/Dhaka', 'Asia/Thimbu' => 'Asia/Thimphu', 'Asia/Ulan_Bator' => 'Asia/Ulaanbaatar',
    'America/Indianapolis' => 'America/Indiana/Indianapolis', 'America/Louisville' => 'America/Kentucky/Louisville',
    'US/Eastern' => 'America/New_York', 'US/Central' => 'America/Chicago', 'US/Mountain' => 'America/Denver',
    'US/Pacific' => 'America/Los_Angeles', 'Europe/Uzhgorod' => 'Europe/Kyiv', 'Europe/Zaporozhye' => 'Europe/Kyiv',
];
const AUD_BOT_AGENTS = '/(bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|monitor|uptime|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|undici)/i';

require __DIR__ . '/common.php';
proxy_setup('audience', 'audience', 'audience');

proxy_run(function (): void {
    check_caller();
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'POST') {
        rate_limit(1, AUD_RATE_LIMIT);
        record_guest($_POST);
    } elseif ($method !== 'GET' && $method !== 'HEAD') {
        header('Allow: GET, POST');
        throw new ProxyError('Use GET or POST.', 405);
    }
    respond(200, audience_summary());
});

/** Everything the people list shows. */
function audience_summary(): array
{
    [$guests, $live, $countries, $unplaced] = count_guests(read_guests());
    return [
        'updated' => gmdate('c'),
        'guests' => $guests,
        'guestsLive' => $live,
        'guestsUnplaced' => $unplaced,
        'guestCountries' => $countries,
        'stream' => stream_audience(),
    ];
}

// ─── Guests ────────────────────────────────────────────────────────────────

/** Note (or forget) one guest's heartbeat. Bots and malformed ids are ignored. */
function record_guest(array $in): void
{
    $id = (string)($in['id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/', $id)) throw new ProxyError('A guest id is 16 to 64 letters, digits, - or _.', 400);
    if (preg_match(AUD_BOT_AGENTS, (string)($_SERVER['HTTP_USER_AGENT'] ?? ''))) return;
    $leave = ($in['leave'] ?? '') === '1';
    $live = ($in['live'] ?? '') === '1';
    $cc = tz_country((string)($in['tz'] ?? ''));
    $who = hash_hmac('sha256', 'guest|' . $id, aud_salt());
    $from = substr(hash_hmac('sha256', 'address|' . ($_SERVER['REMOTE_ADDR'] ?? ''), aud_salt()), 0, 16);

    with_guests(function (array $G) use ($who, $from, $leave, $live, $cc): array {
        if ($leave) {
            unset($G[$who]);
            return $G;
        }
        $G[$who] = [time(), $live ? 1 : 0, $from, $cc];
        // one address adds at most AUD_PER_ADDRESS guests: its oldest go first
        $mine = array_filter($G, fn($g) => $g[2] === $from);
        if (count($mine) > AUD_PER_ADDRESS) {
            uasort($mine, fn($a, $b) => $a[0] <=> $b[0]);
            foreach (array_slice(array_keys($mine), 0, count($mine) - AUD_PER_ADDRESS) as $k) unset($G[$k]);
        }
        if (count($G) > AUD_MAX_GUESTS) {
            uasort($G, fn($a, $b) => $b[0] <=> $a[0]);
            $G = array_slice($G, 0, AUD_MAX_GUESTS, true);
        }
        return $G;
    });
}

/**
 * [guests, of them hearing the room, by country, without a country] still
 * within AUD_GUEST_TTL. Countries as {code, name, n}, the most guests first.
 */
function count_guests(array $G): array
{
    $cut = time() - AUD_GUEST_TTL;
    $n = 0;
    $live = 0;
    $by = [];
    foreach ($G as $g) {
        if ((int)($g[0] ?? 0) < $cut) continue;
        $n++;
        $live += (int)($g[1] ?? 0);
        $cc = (string)($g[3] ?? '');
        if ($cc !== '') $by[$cc] = ($by[$cc] ?? 0) + 1;
    }
    $countries = [];
    foreach ($by as $cc => $count) $countries[] = ['code' => $cc, 'name' => country_name($cc), 'n' => $count];
    usort($countries, fn($a, $b) => $b['n'] <=> $a['n'] ?: strcmp($a['name'], $b['name']));
    return [$n, $live, $countries, $n - array_sum(array_column($countries, 'n'))];
}

/**
 * "DE" for "Europe/Berlin": ICU's region for the zone when the server has PHP's
 * intl (it knows the older names browsers still send, like Asia/Calcutta),
 * else PHP's own time zone data, through AUD_TZ_ALIASES for those older names.
 * "" for UTC, Etc/… and anything unknown.
 */
function tz_country(string $tz): string
{
    if ($tz === '' || strlen($tz) > 64 || !preg_match('#^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$#', $tz)) return '';
    $cc = '';
    if (class_exists('IntlTimeZone')) $cc = (string)IntlTimeZone::getRegion($tz);
    if (!preg_match('/^[A-Z]{2}$/', $cc)) {
        try {
            $cc = (string)((new DateTimeZone(AUD_TZ_ALIASES[$tz] ?? $tz))->getLocation()['country_code'] ?? '');
        } catch (Exception $e) {
            return '';
        }
    }
    return preg_match('/^[A-Z]{2}$/', $cc) ? $cc : '';
}

/** "Germany" for "DE" (PHP's intl when the server has it; the page names it otherwise). */
function country_name(string $cc): string
{
    if (class_exists('Locale')) {
        $name = (string)Locale::getDisplayRegion('-' . $cc, 'en');
        if ($name !== '' && $name !== $cc) return $name;
    }
    return '';
}

function read_guests(): array
{
    $G = json_decode((string)@file_get_contents(cache_dir() . '/guests.json'), true);
    return is_array($G) ? $G : [];
}

/** Change the guest list under a lock, dropping anyone whose heartbeat stopped. */
function with_guests(callable $change): void
{
    $old = umask(0077);
    $fh = fopen(cache_dir() . '/guests.lock', 'c');
    umask($old);
    if (!$fh) return; // never fail the page over a count
    try {
        flock($fh, LOCK_EX);
        $cut = time() - AUD_GUEST_TTL;
        $G = array_filter(read_guests(), fn($g) => is_array($g) && (int)($g[0] ?? 0) >= $cut);
        aud_write(cache_dir() . '/guests.json', json_encode($change($G)));
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

// ─── The stream ────────────────────────────────────────────────────────────

/** Broadcast Pal's api/listeners.php, from the environment or audience-config.php. */
function listeners_url(): string
{
    $cfg = load_config();
    $url = (string)(getenv('LISTENERS_URL') ?: ($cfg['listeners_url'] ?? ''));
    if ($url === '' && ($page = (string)($cfg['broadcast_pal_url'] ?? '')) !== '') {
        $url = preg_replace('#[^/]*$#', '', $page) . 'api/listeners.php';
    }
    return preg_match('#^https://[^/\s]+/#i', $url) ? $url : '';
}

/**
 * Stream listeners by country: {listeners, unplaced, countries}, or null when
 * Broadcast Pal isn't set up or hasn't answered for a while. One request asks
 * it at a time; the rest use the last answer.
 */
function stream_audience(): ?array
{
    $url = listeners_url();
    if ($url === '') return null;
    $file = cache_dir() . '/stream.json';
    $have = json_decode((string)@file_get_contents($file), true);
    $age = is_array($have) ? time() - (int)($have['at'] ?? 0) : PHP_INT_MAX;
    if ($age < AUD_STREAM_TTL) return $have['data'];

    $old = umask(0077);
    $lock = fopen(cache_dir() . '/stream.lock', 'c');
    umask($old);
    if ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
        try {
            $data = fetch_stream($url);
            if ($data !== null || $age >= AUD_STREAM_STALE) {
                aud_write($file, json_encode(['at' => time(), 'data' => $data], JSON_UNESCAPED_UNICODE));
                return $data;
            }
            // couldn't reach it: try again in a minute, keep the last answer meanwhile
            aud_write($file, json_encode(['at' => time(), 'data' => $have['data'] ?? null], JSON_UNESCAPED_UNICODE));
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    } elseif ($lock) {
        fclose($lock);
    }
    return $age < AUD_STREAM_STALE ? ($have['data'] ?? null) : null;
}

/** Ask Broadcast Pal, and merge its places into countries. */
function fetch_stream(string $url): ?array
{
    try {
        $res = http_request('GET', $url);
    } catch (ProxyError $e) {
        return null;
    }
    $j = json_decode($res['body'], true);
    if ($res['status'] !== 200 || !is_array($j) || !isset($j['listeners'])) return null;
    return merge_countries($j);
}

/**
 * listeners.php's places (a city, region or country each) summed by country.
 * Listeners it couldn't place are "unplaced", so the countries and unplaced
 * always add up to the total.
 */
function merge_countries(array $j): array
{
    $by = [];
    foreach ((array)($j['places'] ?? []) as $p) {
        if (!is_array($p)) continue;
        $code = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($p['countryCode'] ?? '')), 0, 2));
        $name = trim((string)($p['country'] ?? ''));
        $n = max(0, (int)($p['listeners'] ?? 0));
        if ($n === 0 || ($code === '' && $name === '')) continue;
        $key = $code !== '' ? $code : $name;
        $by[$key] = $by[$key] ?? ['code' => strlen($code) === 2 ? $code : '', 'name' => mb_substr($name !== '' ? $name : $code, 0, 60), 'n' => 0];
        $by[$key]['n'] += $n;
    }
    $countries = array_values($by);
    usort($countries, fn($a, $b) => $b['n'] <=> $a['n'] ?: strcmp($a['name'], $b['name']));
    $placed = array_sum(array_column($countries, 'n'));
    $total = max($placed, (int)$j['listeners']);
    return ['listeners' => $total, 'unplaced' => $total - $placed, 'countries' => $countries];
}

// ─── Plumbing ──────────────────────────────────────────────────────────────

/** A random key, made once, so stored guests can't be matched to ids or addresses. */
function aud_salt(): string
{
    static $salt = null;
    if ($salt !== null) return $salt;
    $f = cache_dir() . '/salt';
    if (!is_file($f)) aud_write($f, bin2hex(random_bytes(32)));
    return $salt = (string)file_get_contents($f);
}

/** Write a private file in one step (a reader never sees half of it). */
function aud_write(string $path, string|false $data): void
{
    if ($data === false) return;
    $old = umask(0077);
    $tmp = $path . '.' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $data) !== false) @rename($tmp, $path);
    umask($old);
}
