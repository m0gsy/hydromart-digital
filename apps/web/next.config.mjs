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
};

export default nextConfig;
