/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ponytail: lint runs as its own workspace gate (eslint 8), not inside `next build`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
