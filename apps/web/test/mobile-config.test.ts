import { afterEach, describe, expect, it, vi } from 'vitest';

// next.config.mjs is plain JS with a JSDoc type only, so give the shape we rely on an
// explicit local type rather than leaking `any` through the assertions.
type NextConfigShape = {
  output?: string;
  trailingSlash?: boolean;
  distDir?: string;
  headers?: () => Promise<unknown>;
};

/**
 * `MOBILE_BUILD=1` is the switch that turns this app into the static site inside an
 * Android binary. Three of its four effects are silent when wrong — an export with no
 * `trailingSlash` builds perfectly and then white-screens on the device — so they are
 * pinned here rather than discovered in a Play review.
 *
 * The fourth effect is the trap the plan called out: this branch removes `headers()`,
 * and `security-headers.test.ts` calls it with a non-null assertion. If `MOBILE_BUILD`
 * ever leaked into the vitest environment that suite would explode with a TypeError
 * that says nothing about the cause. Nothing sets it in-process today (the build script
 * passes it to a child), and the last case below is what keeps that true.
 *
 * The module cache has to be busted per read: an ES module is evaluated once, and this
 * config reads the variable at module scope.
 */
async function load(env: Record<string, string | undefined>): Promise<NextConfigShape> {
  const before = { ...process.env };
  Object.assign(process.env, env);
  try {
    vi.resetModules();
    // @ts-expect-error — next.config.mjs ships no .d.ts; the shape is asserted above.
    return ((await import('../next.config.mjs')) as { default: NextConfigShape }).default;
  } finally {
    process.env = before;
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('MOBILE_BUILD', () => {
  it('exports files instead of a server, so the APK can carry them', async () => {
    const config = await load({ MOBILE_BUILD: '1' });
    expect(config.output).toBe('export');
  });

  it('writes products/index.html, not products.html', async () => {
    // J2, verified on a device: Capacitor's local server resolves an extensionless path
    // by looking for `<path>/index.html` and never falls back to `<path>.html`. Without
    // this every hard load and every deep link is a 404 into a white screen.
    const config = await load({ MOBILE_BUILD: '1' });
    expect(config.trailingSlash).toBe(true);
  });

  it('builds into its own directory so the server .next is never clobbered', async () => {
    expect((await load({ MOBILE_BUILD: '1' })).distDir).toBe('mobile-out');
    expect((await load({ MOBILE_BUILD: '1', MOBILE_OUT_DIR: 'mobile-out-ops' })).distDir).toBe(
      'mobile-out-ops',
    );
  });

  it('drops headers(), which need a server there is none of', async () => {
    expect((await load({ MOBILE_BUILD: '1' })).headers).toBeUndefined();
  });

  it('leaves the server build completely alone when unset', async () => {
    const config = await load({ MOBILE_BUILD: undefined });
    expect(config.output).toBe('standalone');
    expect(config.trailingSlash).toBeUndefined();
    expect(config.distDir).toBeUndefined();
    // The assertion security-headers.test.ts depends on.
    expect(typeof config.headers).toBe('function');
  });
});
