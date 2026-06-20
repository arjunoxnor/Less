/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The whole app is client-side (no server routes), so export a static site to
  // an out/ directory. That out/ is what gets deployed to Cloudflare Pages; the
  // repo root (with .env.local etc.) is never uploaded.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
