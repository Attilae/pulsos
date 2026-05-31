/** @type {import('next').NextConfig} */
const nextConfig = {
  // The audio engine and its deps are browser-only; keep them out of SSR.
  // (Tab components will be client components in slice 2.)
  reactStrictMode: true,
}

export default nextConfig
