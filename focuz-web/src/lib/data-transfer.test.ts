import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { blobBytes, exportSpace, importIntoSpace } from './data-transfer'
import { readExport } from './export-format'

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
