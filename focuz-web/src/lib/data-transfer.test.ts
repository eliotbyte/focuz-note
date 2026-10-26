import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { blobBytes, ExportCancelledError, ExportControl, exportSpace, importIntoSpace, inDateRange, MissingPicturesError } from './data-transfer'
import { readExport } from './export-format'

// Pictures that are not on this device are fetched from the server; the tests answer for it.
const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('./jobs-worker', () => ({ fetchAttachmentBlob: fetchMock }))
// jsdom can't decode pictures: the import asks this for their size.
const dimsMock = vi.hoisted(() => vi.fn())
vi.mock('./image', async importOriginal => ({ ...(await importOriginal<typeof import('./image')>()), getImageDimensions: dimsMock }))

// fake-indexeddb is the database here: pictures and files are real Blobs and Files.
function bytesBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes], { type: 'image/webp' })
}

function fileOf(name: string, bytes: Uint8Array): File {
  return new File([bytes], name, { type: 'application/zip' })
}

async function zipBytes(blob: Blob): Promise<Uint8Array> {
  return blobBytes(blob)
}

const NOW = '2026-10-01T10:00:00.000Z'

beforeEach(async () => {
  dimsMock.mockReset().mockResolvedValue({ width: 1280, height: 720 })
  await Promise.all([db.notes.clear(), db.attachments.clear(), db.activities.clear(), db.activityTypes.clear(), db.jobs.clear()])
  await db.activityTypes.add({ serverId: 77, spaceId: 1, name: 'Mood', valueType: 'integer', createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
  await db.activityTypes.add({ serverId: 88, spaceId: 2, name: 'Mood', valueType: 'integer', createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
})

describe('export and import of a space', () => {
  it('moves notes, replies, dates, tags, pictures and activities into another space', async () => {
    const parentId = await db.notes.add({ spaceId: 1, text: 'parent', tags: ['work'], createdAt: NOW, modifiedAt: NOW, date: '2026-09-01T09:00:00.000Z', parentId: null, deletedAt: null, isDirty: 0, serverId: 5, clientId: 'p' } as never)
    await db.notes.add({ spaceId: 1, text: 'reply', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId, deletedAt: null, isDirty: 0, serverId: 6, clientId: 'r' } as never)
    await db.notes.add({ spaceId: 1, text: 'deleted', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: NOW, isDirty: 0, serverId: 7, clientId: 'd' } as never)
    await db.attachments.add({ noteId: parentId as number, serverId: 'a', clientId: 'a', fileName: 'pic.webp', fileType: 'image/webp', fileSize: 4, data: bytesBlob(new Uint8Array([1, 2, 3, 4])), position: 0, createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
    await db.activities.add({ noteId: parentId as number, typeId: 77, valueRaw: '4', createdAt: NOW, modifiedAt: NOW, isDirty: 0, serverId: 9 } as never)

    const exported = await exportSpace(1, 'Team Alice', true)
    expect(exported.fileName).toMatch(/^focuz-Team-Alice-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(exported.noteCount).toBe(2)
    expect(exported.pictureCount).toBe(1)
    expect(exported.missingPictures).toBe(0)

    const result = await importIntoSpace(2, fileOf(exported.fileName, await zipBytes(exported.blob)))
    expect(result).toEqual({ notes: 2, pictures: 1, skippedPictures: 0, skippedActivities: 0 })

    const copies = await db.notes.where('spaceId').equals(2).toArray()
    const parentCopy = copies.find(n => n.text === 'parent')!
    const replyCopy = copies.find(n => n.text === 'reply')!
    expect(parentCopy.tags).toEqual(['work'])
    expect(parentCopy.date).toBe('2026-09-01T09:00:00.000Z')
    expect(replyCopy.parentId).toBe(parentCopy.id)
    expect(parentCopy.isDirty).toBe(1)
    expect(parentCopy.serverId).toBeNull()

    const pics = await db.attachments.where('noteId').equals(parentCopy.id!).toArray()
    expect(pics.map(p => p.fileName)).toEqual(['pic.webp'])
    const acts = await db.activities.where('noteId').equals(parentCopy.id!).toArray()
    expect(acts.map(a => a.valueRaw)).toEqual(['4'])
  })

  it('skips pictures the server would refuse, keeps documents and unreadable pictures', async () => {
    const id = await db.notes.add({ spaceId: 1, text: 'old pictures', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 4, clientId: 'o' } as never)
    const add = (name: string, type: string, position: number) => db.attachments.add({ noteId: id as number, serverId: name, clientId: name, fileName: name, fileType: type, fileSize: 2, data: new Blob([new Uint8Array([position, 1])], { type }), position, createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
    await add('tiny.webp', 'image/webp', 0)
    await add('big.webp', 'image/webp', 1)
    await add('broken.webp', 'image/webp', 2)
    await add('notes.md', 'text/markdown', 3)
    dimsMock.mockImplementation(async (f: File) => {
      if (f.name === 'tiny.webp') return { width: 300, height: 200 }
      if (f.name === 'broken.webp') throw new Error('Failed to read image')
      return { width: 1280, height: 720 }
    })

    const exported = await exportSpace(1, 'A', true)
    const result = await importIntoSpace(2, fileOf(exported.fileName, await zipBytes(exported.blob)))
    expect(result).toMatchObject({ notes: 1, pictures: 3, skippedPictures: 1 })
    const copy = (await db.notes.where('spaceId').equals(2).toArray())[0]
    const names = (await db.attachments.where('noteId').equals(copy.id!).toArray()).map(a => a.fileName).sort()
    expect(names).toEqual(['big.webp', 'broken.webp', 'notes.md'])
    expect(dimsMock).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.md' }))
  })

  it('leaves activities out when the space has no such type', async () => {
    const id = await db.notes.add({ spaceId: 1, text: 'with activity', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 1, clientId: 'x' } as never)
    await db.activities.add({ noteId: id as number, typeId: 77, valueRaw: '2', createdAt: NOW, modifiedAt: NOW, isDirty: 0, serverId: 3 } as never)
    await db.activityTypes.where('spaceId').equals(2).delete()

    const exported = await exportSpace(1, 'A', false)
    expect(exported.blob.type).toBe('application/json')
    const result = await importIntoSpace(2, fileOf('a.json', await zipBytes(exported.blob)))
    expect(result.notes).toBe(1)
    expect(result.skippedActivities).toBe(1)
  })

  it('reads back what it wrote', async () => {
    await db.notes.add({ spaceId: 1, text: 'plain', tags: ['t'], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 2, clientId: 'z' } as never)
    const exported = await exportSpace(1, 'A', false)
    const back = readExport(await zipBytes(exported.blob))
    expect(back.doc.space.name).toBe('A')
    expect(back.doc.notes.map(n => n.text)).toEqual(['plain'])
  })
})

describe('export waits for every picture', () => {
  it('downloads the pictures that are not on this device, then exports them', async () => {
    const parent = await db.notes.add({ spaceId: 1, text: 'remote', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 11, clientId: 'm' } as never)
    await db.attachments.add({ noteId: parent as number, serverId: 'srv-1', clientId: 'c1', fileName: 'remote.webp', fileType: 'image/webp', fileSize: 3, data: null, position: 0, createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
    fetchMock.mockResolvedValueOnce(bytesBlob(new Uint8Array([7, 8, 9])))

    const progress: Array<[number, number]> = []
    const exported = await exportSpace(1, 'A', true, { onProgress: (d, t) => progress.push([d, t]) })

    expect(fetchMock).toHaveBeenCalledWith('srv-1')
    expect(exported.pictureCount).toBe(1)
    expect(exported.missingPictures).toBe(0)
    // Before each download, then after it: the second picture's start is the one with the file name.
    expect(progress).toEqual([[0, 1], [0, 1], [1, 1]])
    const stored = await db.attachments.where('noteId').equals(parent as number).first()
    expect(stored?.data).toBeTruthy()
  })

  it('asks before exporting when a picture cannot be downloaded', async () => {
    const parent = await db.notes.add({ spaceId: 1, text: 'offline', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 12, clientId: 'o' } as never)
    await db.attachments.add({ noteId: parent as number, serverId: 'srv-2', clientId: 'c2', fileName: 'x.webp', fileType: 'image/webp', fileSize: 3, data: null, position: 0, createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await expect(exportSpace(1, 'A', true)).rejects.toBeInstanceOf(MissingPicturesError)
  })

  it('exports without the pictures that cannot be downloaded when asked to', async () => {
    const parent = await db.notes.add({ spaceId: 1, text: 'broken pic', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 13, clientId: 'b' } as never)
    await db.attachments.add({ noteId: parent as number, serverId: 'srv-3', clientId: 'c3', fileName: 'bad.webp', fileType: 'image/webp', fileSize: 3, data: null, position: 0, createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
    fetchMock.mockRejectedValueOnce(new Error('500'))

    const exported = await exportSpace(1, 'A', true, { skipUnavailable: true })
    expect(exported.noteCount).toBe(1)
    expect(exported.pictureCount).toBe(0)
    expect(exported.missingPictures).toBe(1)
  })

  it('leaves out a picture the user skips, without failing the export', async () => {
    const parent = await db.notes.add({ spaceId: 1, text: 'slow pic', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 14, clientId: 's' } as never)
    await db.attachments.add({ noteId: parent as number, serverId: 'srv-4', clientId: 'c4', fileName: 'slow.webp', fileType: 'image/webp', fileSize: 3, data: null, position: 0, createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
    fetchMock.mockReturnValueOnce(new Promise<Blob>(() => {}))
    const control = new ExportControl()

    // The skip comes from the UI, after the download has started: a timer stands in for the click.
    const exporting = exportSpace(1, 'A', true, {
      control,
      onProgress: (done, total, current) => { if (current && done < total) setTimeout(() => control.skipCurrent(), 0) },
    })
    const exported = await exporting
    expect(exported.pictureCount).toBe(0)
    expect(exported.missingPictures).toBe(1)
  })

  it('stops with ExportCancelledError and writes nothing', async () => {
    const parent = await db.notes.add({ spaceId: 1, text: 'stop here', tags: [], createdAt: NOW, modifiedAt: NOW, date: NOW, parentId: null, deletedAt: null, isDirty: 0, serverId: 15, clientId: 'x2' } as never)
    await db.attachments.add({ noteId: parent as number, serverId: 'srv-5', clientId: 'c5', fileName: 'x.webp', fileType: 'image/webp', fileSize: 3, data: null, position: 0, createdAt: NOW, modifiedAt: NOW, isDirty: 0 } as never)
    fetchMock.mockReturnValueOnce(new Promise<Blob>(() => {}))
    const control = new ExportControl()

    const exporting = exportSpace(1, 'A', true, { control, onProgress: (_d, _t, current) => { if (current) setTimeout(() => control.stop(), 0) } })
    await expect(exporting).rejects.toBeInstanceOf(ExportCancelledError)
  })

  it('filters notes by their local day, inclusive on both ends', async () => {
    const day = (d: string) => new Date(`${d}T12:00:00`).toISOString()
    await db.notes.add({ spaceId: 1, text: 'before', tags: [], createdAt: NOW, modifiedAt: NOW, date: day('2026-03-09'), parentId: null, deletedAt: null, isDirty: 0, serverId: 20, clientId: 'f1' } as never)
    await db.notes.add({ spaceId: 1, text: 'first', tags: [], createdAt: NOW, modifiedAt: NOW, date: day('2026-03-10'), parentId: null, deletedAt: null, isDirty: 0, serverId: 21, clientId: 'f2' } as never)
    await db.notes.add({ spaceId: 1, text: 'last', tags: [], createdAt: NOW, modifiedAt: NOW, date: day('2026-03-20'), parentId: null, deletedAt: null, isDirty: 0, serverId: 22, clientId: 'f3' } as never)
    await db.notes.add({ spaceId: 1, text: 'after', tags: [], createdAt: NOW, modifiedAt: NOW, date: day('2026-03-21'), parentId: null, deletedAt: null, isDirty: 0, serverId: 23, clientId: 'f4' } as never)

    const exported = await exportSpace(1, 'A', false, { from: '2026-03-10', to: '2026-03-20' })
    const back = readExport(await zipBytes(exported.blob))
    expect(back.doc.notes.map(n => n.text).sort()).toEqual(['first', 'last'])
  })
})

describe('inDateRange', () => {
  it('treats an empty bound as open', () => {
    const iso = new Date('2026-05-05T12:00:00').toISOString()
    expect(inDateRange(iso)).toBe(true)
    expect(inDateRange(iso, '2026-05-06')).toBe(false)
    expect(inDateRange(iso, undefined, '2026-05-04')).toBe(false)
    expect(inDateRange(iso, '2026-05-05', '2026-05-05')).toBe(true)
  })
})
