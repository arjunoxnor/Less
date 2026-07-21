/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The whole app is client-side (no server routes), so export a static site to
  // an out/ directory. That out/ is what gets deployed to Cloudflare Pages; the
  // repo root (with .env.local etc.) is never uploaded.
  output: "export",
  images: { unoptimized: true },
  // Inline the Google client id explicitly. Relying on NEXT_PUBLIC_ pickup from
  // the shell proved unreliable for client chunks under the Turbopack build, so
  // the mapping is declared here; the value still comes only from the build
  // environment (a CI secret, or secrets/less-google.env for a local deploy)
  // and is a public identifier, not a secret.
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  },
};

export default nextConfig;
