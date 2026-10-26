// Export and import of one space's notes. The export first downloads every picture to this device;
// the import works on this device and is synced like any other note.
import { db } from './db'
import { activities as activitiesRepo, attachments as attachmentsRepo, notes as notesRepo } from '../data'
import { createOrUpdateLocalActivity, addLocalAttachments } from './local-writes'
import { fetchAttachmentBlob } from './jobs-worker'
import { isPicture, MAX_DOCUMENT_BYTES } from './attachment-files'
import { getImageDimensions, validateImageGeometry } from './image'
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

/** What goes into the export next to the notes: pictures, other files (documents), both or neither. */
export interface ExportInclude {
  pictures: boolean
  files: boolean
}

export interface ExportResult {
  blob: Blob
  fileName: string
  noteCount: number
  pictureCount: number
  /** Documents (non-picture files) in the export. */
  fileCount: number
  /** Pictures and files that were not on this device, so not in the file. */
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

/** The export was stopped by the user before the file was written. */
export class ExportCancelledError extends Error {
  constructor() {
    super('The export was stopped')
    this.name = 'ExportCancelledError'
  }
}

/**
 * Lets the user stop an export, or skip the picture that is downloading now. A skipped picture is
 * left out of the file, like one that could not be downloaded, but it is not an error.
 */
export class ExportControl {
  cancelled = false
  private skipper: (() => void) | null = null

  /** Skips the picture being downloaded now. */
  skipCurrent(): void {
    this.skipper?.()
  }

  /** Stops the export: the picture being downloaded is dropped and nothing is written. */
  stop(): void {
    this.cancelled = true
    this.skipper?.()
  }

  /** Waits for the task, unless the user skips it first. Resolves to null when skipped. */
  async skippable<T>(task: Promise<T>): Promise<{ value: T } | null> {
    if (this.cancelled) return null
    const skipped = new Promise<null>(resolve => { this.skipper = () => resolve(null) })
    try {
      return await Promise.race([task.then(value => ({ value })), skipped])
    } finally {
      this.skipper = null
    }
  }
}

export interface ExportOptions {
  /** Called before each picture: how many are done, how many in all, and which one is next. */
  onProgress?: (done: number, total: number, current?: { fileName: string; fileSize: number }) => void
  /** Export even when some pictures cannot be downloaded (for example, damaged on the server). */
  skipUnavailable?: boolean
  /** Only notes whose date is on or after this day, as YYYY-MM-DD in local time. */
  from?: string
  /** Only notes whose date is on or before this day, as YYYY-MM-DD in local time. */
  to?: string
  control?: ExportControl
}

/** The day of an ISO date in local time, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Whether a note's date falls in the range. An empty bound is open. */
export function inDateRange(iso: string, from?: string, to?: string): boolean {
  const day = localDay(iso)
  return (!from || day >= from) && (!to || day <= to)
}

/** Whether an attachment goes into an export with these choices. */
function included(a: { fileType: string }, include: ExportInclude): boolean {
  return isPicture(a) ? include.pictures : include.files
}

/**
 * Downloads every included picture and file of these notes that is not on this device yet. Ones that
 * fail are counted, not fetched again here. Skipped pictures are counted apart, and are not an error.
 */
async function loadMissingPictures(noteIds: number[], include: ExportInclude, control: ExportControl, onProgress?: ExportOptions['onProgress']): Promise<{ failed: number }> {
  const missing = await db.attachments.where('noteId').anyOf(noteIds).filter(a => !a.deletedAt && !a.data && !!a.serverId && included(a, include)).toArray()
  let done = 0
  let failed = 0
  onProgress?.(done, missing.length)
  for (const a of missing) {
    if (control.cancelled) break
    onProgress?.(done, missing.length, { fileName: a.fileName, fileSize: a.fileSize })
    try {
      const got = await control.skippable(fetchAttachmentBlob(a.serverId!))
      if (got) await db.attachments.update(a.id!, { data: got.value })
    } catch {
      failed++
    }
    done++
    onProgress?.(done, missing.length)
  }
  return { failed }
}

/**
 * Exports the live notes of a space. The included pictures and files are downloaded first. If some
 * cannot be downloaded, this throws MissingPicturesError unless skipUnavailable is set. Stopping
 * through the control throws ExportCancelledError.
 */
export async function exportSpace(spaceId: number, spaceName: string, include: ExportInclude, options: ExportOptions = {}): Promise<ExportResult> {
  const withPictures = include.pictures || include.files
  const control = options.control ?? new ExportControl()
  const live = (await db.notes.where('spaceId').equals(spaceId).filter(n => !n.deletedAt && inDateRange(n.date ?? n.createdAt, options.from, options.to)).toArray())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const ids = new Set(live.map(n => n.id!))
  if (withPictures) {
    const { failed } = await loadMissingPictures(live.map(n => n.id!), include, control, options.onProgress)
    if (control.cancelled) throw new ExportCancelledError()
    if (failed > 0 && !options.skipUnavailable) throw new MissingPicturesError(failed)
  }
  const pictures = new Map<string, Uint8Array>()
  const notes: ExportNote[] = []
  let missingPictures = 0

  for (const n of live) {
    const acts = await activitiesRepo.listDecoratedForNote(n.id!)
    const atts = withPictures ? (await attachmentsRepo.listActiveSortedForNote(n.id!)).filter(a => included(a, include)) : []
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
    pictureCount: notes.reduce((sum, n) => sum + n.pictures.filter(isPicture).length, 0),
    fileCount: notes.reduce((sum, n) => sum + n.pictures.filter(p => !isPicture(p)).length, 0),
    missingPictures,
  }
}

/**
 * False for a picture the server refuses (too small, too narrow): older notes may have such pictures,
 * uploaded before the server checked. A picture that can't be read here is left to the server.
 */
async function pictureAccepted(file: File): Promise<boolean> {
  try {
    return validateImageGeometry(await getImageDimensions(file)).ok
  } catch {
    return true
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
      const isPicture = p.fileType.startsWith('image/')
      const limit = isPicture ? MAX_PICTURE_BYTES : MAX_DOCUMENT_BYTES
      if (!bytes || bytes.byteLength > limit) { result.skippedPictures++; continue }
      const f = new File([bytes as BlobPart], p.fileName, { type: p.fileType })
      if (isPicture && !(await pictureAccepted(f))) { result.skippedPictures++; continue }
      files.push(f)
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
