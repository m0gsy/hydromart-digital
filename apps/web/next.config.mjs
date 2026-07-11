import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for the prod Docker image.
  output: 'standalone',
  // npm-workspaces monorepo: trace deps from the repo root, not just apps/web.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // ponytail: lint runs as its own workspace gate (eslint 8), not inside `next build`.
  eslint: { ignoreDuringBuilds: true },
  // Baseline security headers. Deliberately NO Content-Security-Policy here — a
  // strict CSP needs nonce/'unsafe-inline' tuning against Next's inline bootstrap
  // and must be tested before enforce; terminate CSP + HSTS at the TLS reverse
  // proxy instead (see DEPLOY.md §6). These four are safe to ship as-is.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
