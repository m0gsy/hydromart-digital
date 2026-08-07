import { fileURLToPath } from 'node:url';

/**
 * The Android binaries ship this app's pages as FILES inside the APK, not as a server
 * they call over the network — a courier with no signal has to be able to open the app
 * at all. `MOBILE_BUILD=1` is what switches this config into producing those files.
 *
 * Set only by scripts/mobile-export.mjs and the CI gate. It must NOT leak into the
 * vitest environment: test/security-headers.test.ts calls `nextConfig.headers!()` with
 * a non-null assertion, and this branch removes `headers` entirely.
 */
const MOBILE = process.env.MOBILE_BUILD === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for the prod Docker image.
  output: MOBILE ? 'export' : 'standalone',
  // J2, and verified on a device: without this, export writes `out/products.html`, while
  // Capacitor's local file server resolves `/products/` by looking for
  // `products/index.html`. Every hard load and every deep link 404s into a white screen.
  ...(MOBILE ? { trailingSlash: true } : {}),
  // Its own directory so a mobile export never clobbers the `.next` a running
  // `next dev` or the server build is using — CI does both in one checkout. Note what
  // ends up here: with `output: 'export'` Next cleans its intermediates out again, so
  // `mobile-out/` holds the finished static site and nothing else. That is the
  // directory Capacitor syncs and the static Playwright project serves.
  ...(MOBILE ? { distDir: 'mobile-out' } : {}),
  // npm-workspaces monorepo: trace deps from the repo root, not just apps/web.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // ponytail: lint runs as its own workspace gate (eslint 8), not inside `next build`.
  eslint: { ignoreDuringBuilds: true },
  // Audit F-8: 223 files import icons from the @phosphor-icons/react BARREL, which is a
  // re-export of ~9,000 components. Without this every one of those routes pulls the
  // whole barrel into its chunk. Next rewrites the barrel import to the individual
  // module at compile time. Same source, a fraction of the JavaScript.
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
  // Baseline security headers. Deliberately NO Content-Security-Policy here — a
  // strict CSP needs nonce/'unsafe-inline' tuning against Next's inline bootstrap
  // and must be tested before enforce; terminate CSP + HSTS at the TLS reverse
  // proxy instead (see DEPLOY.md §6). These four are safe to ship as-is.
  //
  // Permissions-Policy: `camera=()` is an EMPTY allowlist, which denies the feature to
  // every origin INCLUDING this one — it is not "only same-origin". Shipping that broke
  // two live features (HR face check-in needs getUserMedia; driver nav and delivery proof
  // need geolocation) with no error anywhere but the browser console. `(self)` is the
  // same-origin-only form we actually wanted. Pinned by test/security-headers.test.ts.
  //
  // Dropped for the mobile export: `headers()` needs a server to send them, and there
  // is none — the pages are files on the device. The protections themselves are not
  // lost, they move to where they belong on that platform: the WebView is the frame,
  // the app is not embeddable, and camera/geolocation are Android runtime permissions
  // declared in the manifest.
  ...(MOBILE
    ? {}
    : {
        async headers() {
          return [
            {
              source: '/:path*',
              headers: [
                { key: 'X-Frame-Options', value: 'DENY' },
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                {
                  key: 'Permissions-Policy',
                  value: 'camera=(self), microphone=(), geolocation=(self)',
                },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
