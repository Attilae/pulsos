#!/usr/bin/env node
// Generates AGENTS.md from CLAUDE.md. The two files are identical from the first
// `## ` heading onward; only the title, the audience line and the note differ.
//
//   node scripts/sync_agents.js           # write AGENTS.md
//   node scripts/sync_agents.js --check   # exit 1 if AGENTS.md is stale (CI)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'CLAUDE.md')
const TARGET = join(root, 'AGENTS.md')

const HEADER = `# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

> **Note:** this file is **generated** from \`CLAUDE.md\` by \`npm run sync:agents\` — do not edit it
> directly. Edit \`CLAUDE.md\` and re-run that script; only these header lines differ.

`

const source = readFileSync(SOURCE, 'utf8')
const bodyStart = source.search(/^## /m)
if (bodyStart === -1) {
  console.error('[sync:agents] CLAUDE.md has no `## ` heading — refusing to generate AGENTS.md')
  process.exit(1)
}

const expected = HEADER + source.slice(bodyStart)

if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(TARGET, 'utf8') } catch {}
  if (current !== expected) {
    console.error('[sync:agents] AGENTS.md is out of date — run `npm run sync:agents`')
    process.exit(1)
  }
  console.log('[sync:agents] AGENTS.md is up to date')
} else {
  writeFileSync(TARGET, expected)
  console.log('[sync:agents] wrote AGENTS.md from CLAUDE.md')
}
