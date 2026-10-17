import type { HomeDoc } from './types'

const DOC_KEY = 'home-hub:doc:v1'

export function loadDoc(): HomeDoc | null {
  try {
    const raw = localStorage.getItem(DOC_KEY)
    return raw ? (JSON.parse(raw) as HomeDoc) : null
  } catch {
    return null
  }
}

export function saveDoc(doc: HomeDoc) {
  localStorage.setItem(DOC_KEY, JSON.stringify(doc))
}

// Images are too big for localStorage, so they live in IndexedDB.

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('home-hub', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('images')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction('images', mode).objectStore('images'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const putImage = (id: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, id))
export const getImage = (id: string) => tx<Blob | undefined>('readonly', (s) => s.get(id))

// Export / import as a single self-contained JSON file.

interface ExportFile {
  format: 'home-hub'
  doc: HomeDoc
  images: Record<string, string>
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function exportDoc(doc: HomeDoc): Promise<Blob> {
  const images: Record<string, string> = {}
  for (const f of doc.floors) {
    if (!f.backdrop) continue
    const blob = await getImage(f.backdrop.imageId)
    if (blob) images[f.backdrop.imageId] = await blobToDataUrl(blob)
  }
  const file: ExportFile = { format: 'home-hub', doc, images }
  return new Blob([JSON.stringify(file)], { type: 'application/json' })
}

export async function importDoc(file: File): Promise<HomeDoc> {
  const data = JSON.parse(await file.text()) as ExportFile
  if (data.format !== 'home-hub' || !data.doc?.floors) throw new Error('Not a Home Hub export file.')
  for (const [id, url] of Object.entries(data.images ?? {})) {
    await putImage(id, await (await fetch(url)).blob())
  }
  return data.doc
}
