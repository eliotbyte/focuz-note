import { describe, expect, it } from 'vitest'
import { canPreview, checkDocument, documentKind, isPicture, MAX_DOCUMENT_BYTES, parseCsv, previewKind } from './attachment-files'

describe('documentKind', () => {
  it('goes by the extension first, then by the type', () => {
    expect(documentKind({ fileName: 'Report.PDF', fileType: 'application/pdf' })).toBe('pdf')
    expect(documentKind({ fileName: 'notes.md', fileType: 'text/plain' })).toBe('markdown')
    expect(documentKind({ fileName: 'budget.xlsx', fileType: 'application/octet-stream' })).toBe('sheet')
    expect(documentKind({ fileName: 'deck.odp', fileType: '' })).toBe('slides')
    expect(documentKind({ fileName: 'scan', fileType: 'application/pdf' })).toBe('pdf')
    expect(documentKind({ fileName: 'readme', fileType: 'text/plain' })).toBe('text')
    expect(documentKind({ fileName: 'blob.bin', fileType: 'application/octet-stream' })).toBe('file')
  })

  it('tells pictures from documents by type', () => {
    expect(isPicture({ fileType: 'image/webp' })).toBe(true)
    expect(isPicture({ fileType: 'text/plain' })).toBe(false)
  })
})

describe('checkDocument', () => {
  const file = (name: string, size: number, type = '') => new File([new Uint8Array(size)], name, { type })

  it('accepts known documents within the limit', () => {
    expect(checkDocument(file('a.pdf', 10, 'application/pdf')).ok).toBe(true)
    expect(checkDocument(file('a.docx', 10)).ok).toBe(true)
    expect(checkDocument(file('a', 10, 'text/plain')).ok).toBe(true)
  })

  it('refuses unknown, empty and too large files', () => {
    expect(checkDocument(file('a.exe', 10)).ok).toBe(false)
    expect(checkDocument(file('a.zip', 10, 'application/zip')).ok).toBe(false)
    expect(checkDocument(file('a.pdf', 0)).ok).toBe(false)
    expect(checkDocument(new File([], 'big.pdf')).ok).toBe(false)
    const big = { name: 'big.pdf', size: MAX_DOCUMENT_BYTES + 1, type: 'application/pdf' } as File
    expect(checkDocument(big).ok).toBe(false)
  })
})

describe('canPreview', () => {
  it('shows text, Markdown and CSV up to the preview size', () => {
    expect(canPreview({ fileName: 'a.txt', fileType: 'text/plain', fileSize: 100 })).toBe(true)
    expect(canPreview({ fileName: 'a.md', fileType: 'text/plain', fileSize: 100 })).toBe(true)
    expect(canPreview({ fileName: 'a.csv', fileType: 'text/csv', fileSize: 100 })).toBe(true)
    expect(canPreview({ fileName: 'a.txt', fileType: 'text/plain', fileSize: 5 * 1024 * 1024 })).toBe(false)
  })

  it('shows PDF and .docx, not the other office formats', () => {
    expect(previewKind({ fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 20 * 1024 * 1024 })).toBe('pdf')
    expect(previewKind({ fileName: 'Report.DOCX', fileType: 'application/octet-stream', fileSize: 100 })).toBe('docx')
    expect(previewKind({ fileName: 'old.doc', fileType: 'application/msword', fileSize: 100 })).toBe(null)
    expect(previewKind({ fileName: 'a.odt', fileType: 'application/vnd.oasis.opendocument.text', fileSize: 100 })).toBe(null)
    expect(previewKind({ fileName: 'a.xlsx', fileType: '', fileSize: 100 })).toBe(null)
  })
})

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('name,note\r\nmilk,"2, fresh"\nbread,"say ""hi""\nthere"\n')).toEqual([
      ['name', 'note'],
      ['milk', '2, fresh'],
      ['bread', 'say "hi"\nthere'],
    ])
  })

  it('uses semicolons when the header has more of them', () => {
    expect(parseCsv('a;b;c\n1;2,5;3')).toEqual([['a', 'b', 'c'], ['1', '2,5', '3']])
  })

  it('stops after maxRows', () => {
    expect(parseCsv('1\n2\n3\n4\n', 2)).toEqual([['1'], ['2']])
  })
})
