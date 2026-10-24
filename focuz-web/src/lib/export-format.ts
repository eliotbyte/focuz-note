// The export file, format 1. Pure: no database here, so the format can be tested on its own.
//
// Two shapes:
// - with pictures: a zip with notes.json and files/<name> for every picture;
// - without: a plain .json with notes.json's contents (pictures are not listed).
// Ids in the file are the ones the notes had in the exporting device; import gives new ids.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

export const EXPORT_FORMAT = 'focuz-export'
export const EXPORT_VERSION = 1
/** Largest file the importer reads. Anything bigger is refused before it is unpacked. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024
/** The server stores at most this much per attachment; larger pictures are skipped on import. */
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024

export interface ExportPicture {
  /** Path inside the zip, for example files/12-1.webp. */
  file: string
  fileName: string
  fileType: string
  fileSize: number
  position: number | null
}

export interface ExportActivity {
  /** Activity type name in the space, for example "Mood". Matched by name on import. */
  type: string
  value: string
}

export interface ExportNote {
  id: number
  parentId: number | null
  text: string
  tags: string[]
  createdAt: string
  modifiedAt: string
  date: string
  activities: ExportActivity[]
  pictures: ExportPicture[]
}

export interface ExportDocument {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  space: { name: string }
  withPictures: boolean
  notes: ExportNote[]
}

/** Writes the file: a zip when pictures are included, otherwise plain JSON. */
export function writeExport(doc: ExportDocument, pictures: Map<string, Uint8Array>): Blob {
  const text = JSON.stringify(doc, null, 1)
  if (!doc.withPictures) return new Blob([text], { type: 'application/json' })
  // Pictures are already compressed (WebP): store them, deflate only the JSON.
  const files: Zippable = { 'notes.json': [strToU8(text), { level: 6 }] }
  for (const [path, bytes] of pictures) files[path] = [bytes, { level: 0 }]
  const zipped = zipSync(files)
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
}

export interface ParsedExport {
  doc: ExportDocument
  pictures: Map<string, Uint8Array>
}

/** Reads a file made by writeExport. Throws an Error with a message for the user when it cannot. */
export function readExport(bytes: Uint8Array): ParsedExport {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('The file is too large to import')
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b // "PK"
  let jsonText: string
  const pictures = new Map<string, Uint8Array>()
  if (isZip) {
    const entries = unzipSync(bytes)
    const notes = entries['notes.json']
    if (!notes) throw new Error('This zip has no notes.json: it is not a Focuz export')
    jsonText = strFromU8(notes)
    for (const [path, data] of Object.entries(entries)) if (path !== 'notes.json') pictures.set(path, data)
  } else {
    jsonText = strFromU8(bytes)
  }
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    throw new Error('This file is not a Focuz export')
  }
  return { doc: validateDocument(raw), pictures }
}

/** Checks the shape the importer relies on. Unknown extra fields are ignored. */
export function validateDocument(raw: unknown): ExportDocument {
  function fail(why: string): never { throw new Error(`This file is not a Focuz export: ${why}`) }
  if (!raw || typeof raw !== 'object') fail('no content')
  const d = raw as Record<string, unknown>
  if (d.format !== EXPORT_FORMAT) fail('wrong format')
  if (typeof d.version !== 'number') fail('no version')
  if (d.version > EXPORT_VERSION) throw new Error('This export was made by a newer version of Focuz. Update the app to import it.')
  if (d.version !== EXPORT_VERSION) fail(`unknown version ${d.version}`)
  if (!Array.isArray(d.notes)) fail('no notes list')
  const notes = d.notes as unknown[]
  for (const n of notes) {
    if (!n || typeof n !== 'object') fail('a note is not an object')
    const note = n as Record<string, unknown>
    if (typeof note.id !== 'number') fail('a note has no id')
    if (typeof note.text !== 'string') fail('a note has no text')
    if (!Array.isArray(note.tags) || !note.tags.every(t => typeof t === 'string')) fail('a note has bad tags')
    if (typeof note.createdAt !== 'string' || typeof note.date !== 'string') fail('a note has no dates')
    if (note.parentId !== null && note.parentId !== undefined && typeof note.parentId !== 'number') fail('a note has a bad parent')
  }
  return d as unknown as ExportDocument
}

/** Parents before replies, so every reply can be given its new parent id as it is created. */
export function orderNotesForImport(notes: ExportNote[]): ExportNote[] {
  const byId = new Map(notes.map(n => [n.id, n]))
  const out: ExportNote[] = []
  const placed = new Set<number>()
  const place = (n: ExportNote, seen: Set<number>) => {
    if (placed.has(n.id) || seen.has(n.id)) return
    seen.add(n.id)
    const parent = n.parentId != null ? byId.get(n.parentId) : undefined
    if (parent) place(parent, seen)
    placed.add(n.id)
    out.push(n)
  }
  for (const n of notes) place(n, new Set())
  return out
}
