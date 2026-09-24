#!/usr/bin/env node
// Packages the user-installable composer Agent Skill (skills/leid-composer) as
// public/skills/leid-composer.zip, the download offered in the header menu's
// "Connect an AI client" view. The folder is the zip root, which is the layout
// Claude's skill upload expects. The zip is generated (gitignored); `prebuild`
// and `predev` run this so it is never stale.
//
//   node scripts/build_skill.js

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = 'leid-composer'
const SOURCE = join(root, 'skills', SKILL)
const TARGET = join(root, 'public', 'skills', `${SKILL}.zip`)

const zip = new AdmZip()
zip.addLocalFolder(SOURCE, SKILL, (path) => !path.split(/[\\/]/).some(part => part.startsWith('.')))
mkdirSync(dirname(TARGET), { recursive: true })
zip.writeZip(TARGET)
console.log(`skill → ${TARGET.slice(root.length + 1)} (${zip.getEntries().length} entries)`)
