// Asks Zenziva how much SMS credit is left. Runs INSIDE the auth container:
//
//   docker compose exec -T auth node - < scripts/lib/zenziva-balance.cjs
//
// The credentials are read from that container's own environment (ZENZIVA_USERKEY/PASSKEY, the
// same ones the OTP adapter sends with) and travel only to Zenziva. Nothing here prints them, and
// nothing prints the raw response: an account response can carry more than a balance, so only the
// field NAMES and the few values named below are written out.
//
// Output, one line per attempt:
//   <METHOD> <path> http=<code> status=<s> balance=<n> keys=<names> text=<first 60 chars>
// Exit 0 when an attempt answered status "1" with a numeric balance, 1 otherwise.
//
// With ZENZIVA_MODE=monitor it makes ONE call (the masking path, GET) and prints one line for
// scripts/check-zenziva-balance.sh:  balance=<integer> days=<whole days until `expired` | none>
// The balance arrives as a string with thousands separators ("1,941,690", measured 2026-09-25).
//
// The first attempt (POST) answered HTTP 405 on both paths, so the endpoint exists and wants GET
// with the keys in the query string — the shape Zenziva documents for its read-only calls. The
// OTP endpoint lives under `/masking/`, so that prefix is tried first. Kept as a probe: whichever
// attempt succeeds is what the monitor should use.
const base = (process.env.ZENZIVA_BASE_URL || 'https://console.zenziva.net').replace(/\/+$/, '');
const userkey = process.env.ZENZIVA_USERKEY || '';
const passkey = process.env.ZENZIVA_PASSKEY || '';
const PATHS = ['/masking/api/balance/', '/api/balance/'];
const METHODS = ['GET', 'POST'];

/** A gateway may echo what it was sent; a credential must never reach a log through that. */
const scrub = (s) => String(s).split(userkey).join('***').split(passkey).join('***');

/** "1,941,690" -> 1941690. Null when it is not a number at all. */
const toNumber = (raw) => {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && /\d/.test(String(raw)) ? n : null;
};

const QUIET = process.env.ZENZIVA_MODE === 'monitor';

/** One call. Resolves to the parsed body when Zenziva answered status "1", else null. */
async function attempt(method, path) {
  const params = new URLSearchParams({ userkey, passkey }).toString();
  const res =
    method === 'GET'
      ? await fetch(`${base}${path}?${params}`, { signal: AbortSignal.timeout(8000) })
      : await fetch(base + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
          signal: AbortSignal.timeout(8000),
        });
  const body = await res.json().catch(() => null);
  const keys = body && typeof body === 'object' ? Object.keys(body).join(',') : 'not-json';
  if (!QUIET) {
    console.log(
      `${method} ${path} http=${res.status} status=${body?.status ?? '?'} balance=${body?.balance ?? '?'} ` +
        `expired=${body?.expired ?? '-'} keys=${keys} text=${scrub(body?.text ?? '').slice(0, 60)}`,
    );
  }
  return body && String(body.status) === '1' && toNumber(body.balance) !== null ? body : null;
}

async function main() {
  if (!userkey || !passkey) {
    console.log('ZENZIVA_USERKEY / ZENZIVA_PASSKEY are not set in this container');
    process.exit(1);
  }
  if (process.env.ZENZIVA_MODE === 'monitor') {
    const body = await attempt('GET', PATHS[0]).catch(() => null);
    const balance = body ? toNumber(body.balance) : null;
    if (balance === null) process.exit(1);
    const ms = Date.parse(String(body.expired ?? ''));
    const days = Number.isNaN(ms) ? 'none' : Math.floor((ms - Date.now()) / 86400000);
    console.log(`balance=${Math.floor(balance)} days=${days}`);
    process.exit(0);
  }
  let found = false;
  for (const method of METHODS) {
    for (const path of PATHS) {
      try {
        found = (await attempt(method, path)) !== null || found;
      } catch (e) {
        console.log(`${method} ${path} failed: ${scrub(e instanceof Error ? e.message : e)}`);
      }
    }
  }
  process.exit(found ? 0 : 1);
}
main();
