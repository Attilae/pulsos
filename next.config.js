import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray ~/package-lock.json makes Next guess the wrong monorepo root; pin
  // file tracing to this project so standalone/Vercel builds trace correctly.
  outputFileTracingRoot: path.join(import.meta.dirname, '.'),
}

export default nextConfig
