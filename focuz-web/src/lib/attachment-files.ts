// Documents attached to notes (PDF, office, text): everything that is not a picture.
// Pictures are compressed to WebP and fetched in the background; documents keep their bytes as they
// are and are downloaded only when someone opens them, then stay on this device.

import { db } from './db'
import { fetchAttachmentBlob } from './jobs-worker'
import type { AttachmentRecord } from './types'

/** Same as the server's default MAX_DOCUMENT_SIZE; the server has the last word. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
/** Text files larger than this are only downloaded, not shown. */
export const MAX_PREVIEW_BYTES = 1024 * 1024
export const MAX_DOCUMENTS = 10

export type DocumentKind = 'pdf' | 'word' | 'sheet' | 'slides' | 'text' | 'markdown' | 'csv' | 'file'

const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  pdf: 'pdf',
  doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
  xls: 'sheet', xlsx: 'sheet', ods: 'sheet',
  csv: 'csv',
  ppt: 'slides', pptx: 'slides', odp: 'slides',
  txt: 'text', text: 'text', log: 'text',
  md: 'markdown', markdown: 'markdown',
}

/** What the file picker offers. The server checks the content, so this only filters the dialog. */
export const DOCUMENT_ACCEPT = [
  ...Object.keys(KIND_BY_EXTENSION).map(ext => `.${ext}`),
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
].join(',')

export function isPicture(a: { fileType: string }): boolean {
  return a.fileType.startsWith('image/')
}

function extensionOf(fileName: string): string {
  const m = /\.([^.]+)$/.exec(fileName)
  return m ? m[1].toLowerCase() : ''
}

export function documentKind(a: { fileName: string; fileType: string }): DocumentKind {
  const byExt = KIND_BY_EXTENSION[extensionOf(a.fileName)]
  if (byExt) return byExt
  if (a.fileType === 'application/pdf') return 'pdf'
  if (a.fileType === 'text/csv') return 'csv'
  if (a.fileType === 'text/markdown') return 'markdown'
  if (a.fileType.startsWith('text/')) return 'text'
  return 'file'
}

/** A file the app can attach as a document: a known extension or type, and within the size limit. */
export function checkDocument(file: File): { ok: true } | { ok: false; reason: string } {
  const known = KIND_BY_EXTENSION[extensionOf(file.name)] !== undefined
    || ['application/pdf', 'text/plain', 'text/markdown', 'text/csv'].includes(file.type)
  if (!known) return { ok: false, reason: 'this type of file cannot be attached' }
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, reason: `larger than ${formatBytes(MAX_DOCUMENT_BYTES)}` }
  if (file.size === 0) return { ok: false, reason: 'the file is empty' }
  return { ok: true }
}

export type PreviewKind = 'text' | 'markdown' | 'csv' | 'pdf' | 'docx'

/**
 * How a document can be read inside the app, or null when it can only be downloaded. Text up to
 * MAX_PREVIEW_BYTES; PDF and Word (.docx only: .doc, .odt and .rtf are other formats) at any allowed size.
 */
export function previewKind(a: { fileName: string; fileType: string; fileSize: number }): PreviewKind | null {
  const k = documentKind(a)
  if (k === 'text' || k === 'markdown' || k === 'csv') return a.fileSize <= MAX_PREVIEW_BYTES ? k : null
  if (k === 'pdf') return 'pdf'
  if (extensionOf(a.fileName) === 'docx' || a.fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  return null
}

/** Text, Markdown and CSV up to the preview size: searched with their note, so kept on the device. */
export function isSearchableText(a: { fileName: string; fileType: string; fileSize: number }): boolean {
  const k = previewKind(a)
  return k === 'text' || k === 'markdown' || k === 'csv'
}

/** Files fetched as soon as sync learns of them: pictures (for the feed) and searchable text. */
export function fetchedInBackground(a: { fileName: string; fileType: string; fileSize: number }): boolean {
  return isPicture(a) || isSearchableText(a)
}

export function canPreview(a: { fileName: string; fileType: string; fileSize: number }): boolean {
  return previewKind(a) !== null
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** The file's bytes: from this device, or downloaded now and kept here for next time (and offline). */
export async function documentBlob(att: AttachmentRecord): Promise<Blob> {
  if (att.id != null) {
    const current = await db.attachments.get(att.id)
    if (current?.data) return current.data
  }
  if (att.data) return att.data
  if (!att.serverId) throw new Error('The file is not on this device')
  const blob = await fetchAttachmentBlob(att.serverId)
  if (att.id != null) await db.attachments.update(att.id, { data: blob })
  return blob
}

/**
 * Rows of a CSV file (comma, or semicolon when the first line has more of them), with quoted fields.
 * Stops after maxRows; the preview only shows the start of a long table.
 */
export function parseCsv(text: string, maxRows = 500): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const sep = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
      if (rows.length >= maxRows) return rows
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** Hands a file to the browser to save, under its own name. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || 'file'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
