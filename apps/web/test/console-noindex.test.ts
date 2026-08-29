// The consoles must not be indexable, and the customer surface must still be shareable.
//
// Measured 2026-08-29: `curl https://hydromart-digital.com/hq` returned 200, prerendered,
// `Cache-Control: s-maxage=31536000`, with no `X-Robots-Tag` — and `/robots.txt` was 404.
// Nothing there serves data to a signed-out visitor, but the route names and the copy of
// four internal consoles are not something to publish by accident.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// next.config.mjs ships no .d.ts, so its shape is declared here — the same pattern
// test/security-headers.test.ts uses for the same file.
type HeaderEntry = { key: string; value: string };
type HeaderGroup = { source: string; headers: HeaderEntry[] };
type NextConfigShape = { headers?: () => Promise<HeaderGroup[]> };
// @ts-expect-error — no .d.ts; the shape is asserted above.
const nextConfig = ((await import('../next.config.mjs')) as { default: NextConfigShape }).default;

const CONSOLES = ['hq', 'dashboard', 'driver', 'hr', 'm'];

describe('robots.txt', () => {
  // Read lazily, per assertion. Reading it at describe-scope meant a missing file threw
  // during COLLECTION and the whole suite reported "no tests" — which is the shape of green
  // that this file exists to make impossible.
  const read = () => readFileSync(join(process.cwd(), 'public/robots.txt'), 'utf8');

  it.each(CONSOLES)('disallows /%s', (path) => {
    expect(read()).toMatch(new RegExp(`^Disallow: /${path}$`, 'm'));
  });

  /*
   * A STATIC file, not the app/robots.ts convention — for the same reason
   * manifest.webmanifest is static: that convention is a generated ROUTE, and the mobile
   * build runs `output: 'export'` and has to stay free of routes to export. A robots.ts
   * here would break the Android build, not this test.
   */
  it('is a file in public/, so the mobile export can carry it', () => {
    expect(() => readFileSync(join(process.cwd(), 'public/robots.txt'))).not.toThrow();
  });

  // It must NOT disallow the catalogue: that is the half customers are meant to find.
  it('leaves the shop indexable', () => {
    const txt = read();
    expect(txt).not.toMatch(/^Disallow: \/products$/m);
    expect(txt).not.toMatch(/^Disallow: \/$/m);
  });
});

describe('X-Robots-Tag', () => {
  /*
   * robots.txt only ASKS, and it does not stop a crawler that already holds the URL from
   * indexing it. The header is the half that binds, so both have to be there.
   */
  it('tells a crawler that already has the console URL', async () => {
    const rules = await nextConfig.headers!();
    const noindex = rules.filter((r) =>
      r.headers.some((h) => h.key === 'X-Robots-Tag' && /noindex/.test(h.value)),
    );
    expect(noindex.length).toBeGreaterThan(0);
    for (const c of CONSOLES) {
      expect(noindex.some((r) => r.source.includes(c))).toBe(true);
    }
  });

  // The security headers it sits next to must survive the edit.
  it('keeps the site-wide security headers', async () => {
    const rules = await nextConfig.headers!();
    const all = rules.flatMap((r) => r.headers.map((h) => h.key));
    for (const key of [
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      expect(all).toContain(key);
    }
  });
});

describe('shared links', () => {
  /*
   * Read from the SOURCE rather than imported: layout.tsx pulls in `next/font/local`, which
   * vitest cannot resolve, and nothing else in this suite imports it. Reading the file still
   * fails the day somebody deletes the declaration, which is the whole job.
   *
   * Why it matters: without `metadataBase` Next cannot make a relative og:image absolute,
   * and a relative og:image is silently DROPPED by every scraper rather than reported.
   * WhatsApp is how links are shared here, so a bare URL is what everybody saw.
   */
  const layout = () => readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

  it('declares an absolute metadataBase', () => {
    expect(layout()).toMatch(/metadataBase:\s*new URL\(/);
  });

  it('declares an Open Graph card with an image', () => {
    expect(layout()).toMatch(/openGraph:\s*\{/);
    expect(layout()).toMatch(/images:\s*\['\/icon-512\.png'\]/);
  });
});
