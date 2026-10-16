// Requires agent-browser and a running Leið server. The print view deliberately
// renders all chapters regardless of the interactive search/filter state.
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const base = new URL(process.argv[2] || 'http://localhost:3000')
const guide = new URL('/guide', base)
if (!['http:', 'https:'].includes(guide.protocol)) throw new Error('Use an HTTP or HTTPS app URL')
const target = path.join(root, 'public/guides/leid-user-guide.pdf')
const artifact = path.join(root, 'output/pdf/leid-user-guide.pdf')
mkdirSync(path.dirname(target), { recursive: true })
mkdirSync(path.dirname(artifact), { recursive: true })
const session = `leid-guide-pdf-${process.pid}`
const browser = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { stdio: 'inherit' })
try {
  browser('open', guide.href)
  browser('wait', '--fn', 'document.fonts.status === "loaded" && document.querySelectorAll(".guide-print > section").length === 18')
  browser('pdf', target)
  copyFileSync(target, artifact)
} finally {
  browser('close')
}
console.log(`Guide PDF: ${target}`)
