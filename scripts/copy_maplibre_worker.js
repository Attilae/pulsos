// MapLibre 6 runs its tile parsing in a module worker it locates next to its own
// bundle (import.meta.url), which doesn't survive webpack chunking. Copy the
// worker into public/ under its version so MapView can point setWorkerUrl at a
// stable, cache-safe URL. Runs from prebuild/predev; output is gitignored.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'node_modules', 'maplibre-gl')
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const targetDir = join(root, 'public', 'vendor')
mkdirSync(targetDir, { recursive: true })
copyFileSync(join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), join(targetDir, `maplibre-gl-worker-${version}.mjs`))
console.log(`maplibre worker → public/vendor/maplibre-gl-worker-${version}.mjs`)
