// Export and import of one space's notes. The export first downloads every picture to this device;
// the import works on this device and is synced like any other note.
import { db } from './db'
import { activities as activitiesRepo, attachments as attachmentsRepo, notes as notesRepo } from '../data'
import { createOrUpdateLocalActivity, addLocalAttachments } from './local-writes'
import { fetchAttachmentBlob } from './jobs-worker'
import type { NoteRecord } from './types'
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MAX_PICTURE_BYTES,
  orderNotesForImport,
  readExport,
  writeExport,
  type ExportDocument,
  type ExportNote,
  type ExportPicture,
} from './export-format'

export interface ExportResult {
  blob: Blob
  fileName: string
  noteCount: number
  pictureCount: number
  /** Pictures that were not on this device, so not in the file. */
  missingPictures: number
}

export interface ImportResult {
  notes: number
  pictures: number
  /** Pictures left out: too large, or not readable. */
  skippedPictures: number
  /** Activities whose type does not exist in this space. */
  skippedActivities: number
}

/** Reads the bytes of a Blob or File. Some older browsers lack arrayBuffer(); FileReader covers them. */
export function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then(b => new Uint8Array(b))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

function fileSafeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'space'
}

function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)
  return m ? m[1].toLowerCase() : 'bin'
}

/** The export found pictures it could not download. The user decides: try again, or export without them. */
export class MissingPicturesError extends Error {
  readonly count: number
  constructor(count: number) {
    super(`${count} ${count === 1 ? 'picture' : 'pictures'} could not be downloaded`)
    this.name = 'MissingPicturesError'
    this.count = count
  }
}

export interface ExportOptions {
  onProgress?: (done: number, total: number) => void
  /** Export even when some pictures cannot be downloaded (for example, damaged on the server). */
  skipUnavailable?: boolean
}

/**
 * Downloads every picture of these notes that is not on this device yet. Pictures that fail are
 * counted, not fetched again here: returns how many are still missing.
 */
async function loadMissingPictures(noteIds: number[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const missing = await db.attachments.where('noteId').anyOf(noteIds).filter(a => !a.deletedAt && !a.data && !!a.serverId).toArray()
  let done = 0
  let failed = 0
  onProgress?.(done, missing.length)
  for (const a of missing) {
    try {
      const blob = await fetchAttachmentBlob(a.serverId!)
      await db.attachments.update(a.id!, { data: blob })
    } catch {
      failed++
    }
    done++
    onProgress?.(done, missing.length)
  }
  return failed
}

/**
 * Exports the live notes of a space. With withPictures, the pictures are downloaded first. If some
 * cannot be downloaded, this throws MissingPicturesError unless skipUnavailable is set.
 */
export async function exportSpace(spaceId: number, spaceName: string, withPictures: boolean, options: ExportOptions = {}): Promise<ExportResult> {
  const live = (await db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt).toArray())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const ids = new Set(live.map(n => n.id!))
  if (withPictures) {
    const failed = await loadMissingPictures(live.map(n => n.id!), options.onProgress)
    if (failed > 0 && !options.skipUnavailable) throw new MissingPicturesError(failed)
  }
  const pictures = new Map<string, Uint8Array>()
  const notes: ExportNote[] = []
  let missingPictures = 0

  for (const n of live) {
    const acts = await activitiesRepo.listDecoratedForNote(n.id!)
    const atts = withPictures ? await attachmentsRepo.listActiveSortedForNote(n.id!) : []
    const pics: ExportPicture[] = []
    for (const a of atts) {
      if (!a.data) { missingPictures++; continue }
      const file = `files/${n.id}-${pics.length + 1}.${extensionOf(a.fileName)}`
      pictures.set(file, await blobBytes(a.data))
      pics.push({ file, fileName: a.fileName, fileType: a.fileType, fileSize: a.fileSize, position: a.position ?? null })
    }
    notes.push({
      id: n.id!,
      parentId: n.parentId != null && ids.has(n.parentId) ? n.parentId : null,
      text: n.text,
      tags: n.tags ?? [],
      createdAt: n.createdAt,
      modifiedAt: n.modifiedAt,
      date: n.date ?? n.createdAt,
      activities: acts.map(a => ({ type: a._name, value: a.valueRaw })),
      pictures: pics,
    })
  }

  const doc: ExportDocument = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    space: { name: spaceName },
    withPictures,
    notes,
  }
  const day = new Date().toISOString().slice(0, 10)
  const fileName = `focuz-${fileSafeName(spaceName)}-${day}.${withPictures ? 'zip' : 'json'}`
  return {
    blob: writeExport(doc, pictures),
    fileName,
    noteCount: notes.length,
    pictureCount: notes.reduce((sum, n) => sum + n.pictures.length, 0),
    missingPictures,
  }
}

/**
 * Adds the notes of an export file to a space as new notes. Existing notes are not changed. The new
 * notes are saved on this device and sync like any other note.
 */
export async function importIntoSpace(spaceId: number, file: File): Promise<ImportResult> {
  const { doc, pictures } = readExport(await blobBytes(file))
  const types = (await db.activityTypes.where('spaceId').equals(spaceId).toArray()).filter(t => !t.deletedAt)
  const newIds = new Map<number, number>()
  const result: ImportResult = { notes: 0, pictures: 0, skippedPictures: 0, skippedActivities: 0 }

  for (const n of orderNotesForImport(doc.notes)) {
    const parentId = n.parentId != null ? (newIds.get(n.parentId) ?? null) : null
    const note = {
      spaceId,
      title: null,
      text: n.text,
      tags: n.tags,
      createdAt: n.createdAt,
      modifiedAt: n.modifiedAt,
      date: n.date,
      parentId,
      deletedAt: null,
      isDirty: 1,
      serverId: null,
      clientId: crypto.randomUUID(),
    } as NoteRecord
    const localId = await notesRepo.addDraft(note)
    newIds.set(n.id, localId)
    result.notes++

    const files: File[] = []
    for (const p of n.pictures) {
      const bytes = pictures.get(p.file)
      if (!bytes || bytes.byteLength > MAX_PICTURE_BYTES) { result.skippedPictures++; continue }
      files.push(new File([bytes as BlobPart], p.fileName, { type: p.fileType }))
    }
    if (files.length > 0) {
      await addLocalAttachments(localId, files)
      result.pictures += files.length
    }

    for (const a of n.activities) {
      const type = types.find(t => t.name === a.type && typeof t.serverId === 'number')
      if (!type) { result.skippedActivities++; continue }
      try {
        await createOrUpdateLocalActivity(localId, type.serverId!, a.value)
      } catch {
        result.skippedActivities++
      }
    }
  }
  return result
}

/** Saves a blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
