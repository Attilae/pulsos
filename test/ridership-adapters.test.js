import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRidership } from '../scripts/ridership/index.js'

test('New York adapter joins a station-complex export by name and coordinates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leid-ridership-'))
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })) })
  const dir = join(root, 'newyork_ridership')
  await mkdir(dir)
  await writeFile(join(dir, 'subway.csv'), [
    'station_complex,ridership,latitude,longitude',
    'Central (A C),1200,40.7501,-73.9901',
  ].join('\n'))
  const stopMeta = {
    CEN: { name: 'Central', lat: 40.75, lon: -73.99, parentStation: null },
    CENN: { name: 'Central', lat: 40.75, lon: -73.99, parentStation: 'CEN' },
  }
  const result = await loadRidership('newyork', root, stopMeta)
  assert.equal(result.rows, 1)
  assert.equal(result.values.get('CEN').ridership, 1200)
})

test('Zürich adapter joins official internal stop ids through HALTESTELLEN names', async t => {
  const root = await mkdtemp(join(tmpdir(), 'leid-ridership-'))
  t.after(async () => { await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })) })
  const dir = join(root, 'zurich_ridership')
  await mkdir(dir)
  await writeFile(join(dir, 'HALTESTELLEN.csv'), 'Haltestellen_Id;Haltestellenlangname\n42;Zürich, Bellevue\n')
  await writeFile(join(dir, 'REISENDE.csv'), 'Haltestellen_Id;Einsteiger;Aussteiger\n42;100;80\n')
  const stopMeta = {
    platform: { name: 'Zürich, Bellevue', lat: 47.366, lon: 8.546, parentStation: null },
  }
  const result = await loadRidership('zurich', root, stopMeta)
  assert.equal(result.rows, 1)
  assert.equal(result.values.get('platform').ridership, 180)
})
