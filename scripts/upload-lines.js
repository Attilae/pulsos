// One-time (re-run on data changes) upload of public/data/lines.json to Vercel
// Blob, so the ~22 MB file is served from Blob storage instead of bloating the
// repo + deploy.
//
// Usage:
//   BLOB_READ_WRITE_TOKEN=… npm run upload:lines
//
// Get the token from the Vercel dashboard → Storage → your Blob store →
// ".env.local" tab (or `vercel env pull`). Prints the public URL to set as
// NEXT_PUBLIC_LINES_URL in the Next app's environment.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { put } from '@vercel/blob'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, '..', 'public', 'data', 'lines.json')

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is required (Vercel → Storage → Blob).')
    process.exit(1)
  }

  const body = await readFile(FILE)
  console.log(`Uploading ${(body.length / 1e6).toFixed(1)} MB → data/lines.json …`)

  // Stable pathname (no random suffix) so the URL is predictable; overwrite on
  // re-upload after regenerating the data.
  const blob = await put('data/lines.json', body, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  })

  console.log('\nUploaded. Set this in the Next app environment:')
  console.log(`  NEXT_PUBLIC_LINES_URL=${blob.url}\n`)
}

main().catch((err) => { console.error(err); process.exit(1) })
