import { describe, expect, it } from 'vitest';

// next.config.mjs is plain JS with a JSDoc type only, so give the shape we rely on an
// explicit local type rather than leaking `any` through the assertions.
type HeaderEntry = { key: string; value: string };
type HeaderGroup = { source: string; headers: HeaderEntry[] };
type NextConfigShape = { headers?: () => Promise<HeaderGroup[]> };

// @ts-expect-error — next.config.mjs ships no .d.ts; the shape is asserted above.
const nextConfig = ((await import('../next.config.mjs')) as { default: NextConfigShape }).default;

// B-1: the Permissions-Policy header shipped `camera=(), microphone=(), geolocation=()`.
// An empty allowlist denies the feature to EVERY origin including this app's own, so HR
// face check-in (getUserMedia) and driver navigation / delivery proof (geolocation) were
// blocked in production by our own security header. These assertions fail against that
// value and pass only once `self` is allowed — the header is config, so this is the
// cheapest place to pin it. See apps/web/src/components/hr/face-capture.tsx and
// apps/web/src/lib/geo.ts for the consumers.

async function permissionsPolicy(): Promise<string> {
  const groups = await nextConfig.headers!();
  const header = groups
    .flatMap((g: HeaderGroup) => g.headers)
    .find((h: HeaderEntry) => h.key === 'Permissions-Policy');
  if (!header) throw new Error('Permissions-Policy header is not set at all');
  return header.value;
}

describe('baseline security headers', () => {
  it('allows this origin to use the camera — HR face check-in needs getUserMedia', async () => {
    expect(await permissionsPolicy()).toMatch(/camera=\(self\)/);
  });

  it('allows this origin to use geolocation — driver nav and delivery proof need it', async () => {
    expect(await permissionsPolicy()).toMatch(/geolocation=\(self\)/);
  });

  it('still denies the microphone, which nothing in the app uses', async () => {
    expect(await permissionsPolicy()).toMatch(/microphone=\(\)/);
  });

  it('keeps the other three baseline headers', async () => {
    const groups = await nextConfig.headers!();
    const byKey = new Map(groups.flatMap((g: HeaderGroup) => g.headers).map((h: HeaderEntry) => [h.key, h.value]));
    expect(byKey.get('X-Frame-Options')).toBe('DENY');
    expect(byKey.get('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});
