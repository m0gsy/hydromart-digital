import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { TOKEN_AUDIENCE, TOKEN_ISSUER } from './token-claims';

/*
 * Every script that signs its own access token must sign the claims the guard checks.
 *
 * AUTH-5 made the guard verify `iss` and `aud`. The scripts that mint tokens by hand — the
 * seeders, the load harness, the UAT harness — are not imported by anything, so no compile
 * error and no unit test noticed that some of them still signed the old shape. The UAT
 * harness only runs monthly and report-only: it kept its old tokens for weeks, and the next
 * run died on its first call with "Invalid or expired access token", which reads like an
 * auth regression in the product and cost an afternoon.
 *
 * A file that writes a JWT header is a minter. Each one has to carry both values.
 */
const ROOT = resolve(__dirname, '../../../..');
const DIRS = ['scripts', '.uat', 'test/integration'];

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('_prev') ? [] : scripts(path);
    return /\.(mjs|cjs|js)$/.test(e.name) ? [path] : [];
  });
}

const minters = DIRS.flatMap((d) => scripts(join(ROOT, d))).filter((f) =>
  /alg: 'HS256'/.test(readFileSync(f, 'utf8')),
);

describe('scripts that mint access tokens', () => {
  it('finds them (a wrong path must not turn this into a test of nothing)', () => {
    expect(minters.length).toBeGreaterThanOrEqual(10);
  });

  it.each(minters.map((f) => [f.slice(ROOT.length + 1).replace(/\\/g, '/'), f]))(
    '%s signs the issuer and audience the guard checks',
    (_name, file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain(TOKEN_ISSUER);
      expect(src).toContain(TOKEN_AUDIENCE);
    },
  );
});
