import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray ~/package-lock.json makes Next guess the wrong monorepo root; pin
  // file tracing to this project so standalone/Vercel builds trace correctly.
  outputFileTracingRoot: path.join(import.meta.dirname, '.'),
  async headers() {
    return [
      {
        // The Resonator DSP (scripts/build_resonator.js) is content-addressed —
        // resonator-<sha8>.wasm — so a given URL never changes and can be cached
        // for good. The explicit type keeps WebAssembly.compileStreaming-style
        // loaders happy on hosts that don't map .wasm themselves.
        source: '/wasm/:file(resonator-[0-9a-f]{8}\\.wasm)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Content-Type', value: 'application/wasm' },
        ],
      },
    ]
  },
}

export default nextConfig
