// Asks Zenziva how much SMS credit is left. Runs INSIDE the auth container:
//
//   docker compose exec -T auth node - < scripts/lib/zenziva-balance.cjs
//
// The credentials are read from that container's own environment (ZENZIVA_USERKEY/PASSKEY, the
// same ones the OTP adapter sends with) and travel only to Zenziva, in the POST body. Nothing
// here prints them, and nothing prints the raw response: an account response can carry more than
// a balance, so only the fields named below are written out.
//
// Output, one line per path tried:  <path> http=<code> status=<s> balance=<n> text=<first 60 chars>
// Exit 0 when at least one path answered status "1" with a numeric balance, 1 otherwise.
//
// The API path is not asserted anywhere in Zenziva's public docs that we could verify, and the
// OTP endpoint lives under `/masking/`, so the masking path is tried first and the un-prefixed
// one second. A path that 404s costs one request.
const base = (process.env.ZENZIVA_BASE_URL || 'https://console.zenziva.net').replace(/\/+$/, '');
const userkey = process.env.ZENZIVA_USERKEY || '';
const passkey = process.env.ZENZIVA_PASSKEY || '';
const PATHS = ['/masking/api/balance/', '/api/balance/'];

async function main() {
  if (!userkey || !passkey) {
    console.log('ZENZIVA_USERKEY / ZENZIVA_PASSKEY are not set in this container');
    process.exit(1);
  }
  let found = false;
  for (const path of PATHS) {
    try {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ userkey, passkey }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => null);
      // A gateway may echo what it was sent; a credential must never reach a log through that.
      const text = String(body?.text ?? '')
        .split(userkey)
        .join('***')
        .split(passkey)
        .join('***')
        .slice(0, 60);
      console.log(
        `${path} http=${res.status} status=${body?.status ?? '?'} balance=${body?.balance ?? '?'} text=${text}`,
      );
      if (body && String(body.status) === '1' && /^\d+(\.\d+)?$/.test(String(body.balance)))
        found = true;
    } catch (e) {
      console.log(`${path} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  process.exit(found ? 0 : 1);
}
main();
