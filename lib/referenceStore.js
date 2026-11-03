// IndexedDB storage for reference loops (lib/referenceTrack.js). The audio
// never leaves the browser: a song stores only the loop's id + metadata, and
// this store maps that id back to the original file on this device. Another
// device or a shared link finds nothing here, and the lane offers a re-upload.
//
// Stores the original Blob, not decoded PCM: a 3-minute stereo WAV is ~30 MB
// as a file but ~70 MB as Float32 at 48 kHz.

const DB_NAME = 'leid-reference'
const DB_VERSION = 1
const STORE = 'loops'

export class ReferenceStoreError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ReferenceStoreError'
    this.code = code // 'unavailable' | 'quota' | 'failed'
  }
}

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new ReferenceStoreError("This browser can't store files", 'unavailable'))
      return
    }
    let req
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      reject(new ReferenceStoreError("This browser can't store files", 'unavailable'))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new ReferenceStoreError("This browser can't store files", 'unavailable'))
    req.onblocked = () => reject(new ReferenceStoreError('Storage is busy in another tab', 'failed'))
  })
  // A failed open (private mode) shouldn't poison every later attempt.
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

function run(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    let tx
    try {
      tx = db.transaction(STORE, mode)
    } catch {
      reject(new ReferenceStoreError("Couldn't access stored loops", 'failed'))
      return
    }
    let result
    const req = fn(tx.objectStore(STORE))
    if (req) req.onsuccess = () => { result = req.result }
    tx.oncomplete = () => resolve(result)
    const fail = () => {
      const quota = tx.error?.name === 'QuotaExceededError' || req?.error?.name === 'QuotaExceededError'
      reject(quota
        ? new ReferenceStoreError('Not enough browser storage to keep this loop', 'quota')
        : new ReferenceStoreError("Couldn't save the loop on this device", 'failed'))
    }
    tx.onerror = fail
    tx.onabort = fail
  }))
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '')
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

// Store a file; resolves to { id, name, size }.
export async function putReference(file) {
  const id = newId()
  const record = { id, name: file.name ?? 'loop', type: file.type ?? '', size: file.size ?? 0, blob: file, savedAt: Date.now() }
  await run('readwrite', store => store.put(record))
  return { id, name: record.name, size: record.size }
}

// The stored Blob (with its original name as `.name`), or null.
export async function getReference(id) {
  if (!id) return null
  const record = await run('readonly', store => store.get(id))
  if (!record?.blob) return null
  const blob = record.blob
  if (blob.name) return blob
  try {
    return new File([blob], record.name, { type: record.type })
  } catch {
    return Object.assign(blob, { name: record.name })
  }
}

export async function deleteReference(id) {
  if (!id) return
  await run('readwrite', store => store.delete(id))
}

// Metadata of every stored loop (no blobs), newest first.
export async function listReferences() {
  const all = await run('readonly', store => store.getAll())
  return (all ?? [])
    .map(({ id, name, size, savedAt }) => ({ id, name, size, savedAt }))
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
}
