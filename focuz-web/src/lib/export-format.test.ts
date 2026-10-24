import { describe, expect, it } from 'vitest'
import { EXPORT_FORMAT, EXPORT_VERSION, orderNotesForImport, readExport, validateDocument, writeExport, type ExportDocument, type ExportNote } from './export-format'

const note = (over: Partial<ExportNote> & { id: number }): ExportNote => ({
  parentId: null, text: `note ${over.id}`, tags: ['a'], createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
  date: '2026-10-01T10:00:00.000Z', activities: [], pictures: [], ...over,
})

const doc = (notes: ExportNote[], withPictures: boolean): ExportDocument => ({
  format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: '2026-10-24T00:00:00.000Z', space: { name: 'Team' }, withPictures, notes,
})

function bytesOf(blob: Blob): Promise<Uint8Array> {
  // FileReader, not Response: the test environment hands Blobs to Response as text.
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

describe('export file', () => {
  it('round-trips a zip with pictures', async () => {
    const pic = new Uint8Array([1, 2, 3, 4])
    const d = doc([note({ id: 1, pictures: [{ file: 'files/1-1.webp', fileName: 'a.webp', fileType: 'image/webp', fileSize: 4, position: 0 }] })], true)
    const blob = writeExport(d, new Map([['files/1-1.webp', pic]]))
    expect(blob.type).toBe('application/zip')
    const back = readExport(await bytesOf(blob))
    expect(back.doc.notes[0].text).toBe('note 1')
    expect(back.doc.notes[0].pictures[0].file).toBe('files/1-1.webp')
    expect(Array.from(back.pictures.get('files/1-1.webp')!)).toEqual([1, 2, 3, 4])
  })

  it('writes plain JSON without pictures and reads it back', async () => {
    const blob = writeExport(doc([note({ id: 7, tags: ['x', 'y'] })], false), new Map())
    expect(blob.type).toBe('application/json')
    const back = readExport(await bytesOf(blob))
    expect(back.pictures.size).toBe(0)
    expect(back.doc.notes[0].tags).toEqual(['x', 'y'])
  })

  it('refuses a file from a newer version', () => {
    expect(() => validateDocument({ ...doc([], false), version: EXPORT_VERSION + 1 })).toThrow(/newer version/)
  })

  it('refuses something that is not an export', async () => {
    expect(() => readExport(new TextEncoder().encode('{"hello":1}'))).toThrow(/not a Focuz export/)
    expect(() => readExport(new TextEncoder().encode('not json'))).toThrow(/not a Focuz export/)
  })

  it('checks note fields', () => {
    const bad = { ...doc([{ ...note({ id: 1 }), tags: 'a' } as unknown as ExportNote], false) }
    expect(() => validateDocument(bad)).toThrow(/bad tags/)
  })
})

describe('import order', () => {
  it('puts parents before replies whatever the file order', () => {
    const notes = [note({ id: 3, parentId: 2 }), note({ id: 2, parentId: 1 }), note({ id: 1 })]
    expect(orderNotesForImport(notes).map(n => n.id)).toEqual([1, 2, 3])
  })

  it('keeps a reply whose parent is not in the file', () => {
    expect(orderNotesForImport([note({ id: 5, parentId: 99 })]).map(n => n.id)).toEqual([5])
  })
})
