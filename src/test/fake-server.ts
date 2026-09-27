// In-memory stand-in for focuz-api, faithful to the parts of the protocol the client uses
// (POST/GET /sync, /spaces, /upload, /files/:id[/content]). Installed as global fetch.

type Note = {
  id: number; user_id: number; space_id: number; text: string; tags: string[]; parent_id: number | null
  created_at: string; modified_at: string; date: string; is_deleted: boolean; client_id: string | null
}
type Filter = {
  id: number; space_id: number; parent_id: number | null; name: string; params: any
  created_at: string; modified_at: string; is_deleted: boolean; client_id: string | null
}
type Attachment = { id: string; note_id: number; client_id: string | null; file_name: string; file_type: string; file_size: number; created_at: string; modified_at: string; data: Uint8Array }

export class FakeServer {
  base = 'http://api.test'
  userId = 1
  clock = Date.parse('2030-01-01T00:00:00.000Z')
  nextNoteId = 1
  nextFilterId = 1
  nextAttId = 1
  spaces = new Map<number, { id: number; name: string; created_at: string; modified_at: string }>()
  notes = new Map<number, Note>()
  filters = new Map<number, Filter>()
  attachments = new Map<string, Attachment>()
  /** When true every request fails like an unreachable host. */
  down = false
  /** Respond with this status to the next N matching requests. */
  failures: Array<{ match: RegExp; status: number; times: number }> = []
  /** Delay before responding (lets tests edit data while a request is in flight). */
  delayMs = 0
  /** Called when a request is received, before it is handled. */
  onRequest: ((method: string, path: string) => void | Promise<void>) | null = null
  log: string[] = []

  constructor() {
    this.addSpace('My Space')
  }

  now(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  addSpace(name: string) {
    const id = this.spaces.size + 1
    const t = this.now()
    this.spaces.set(id, { id, name, created_at: t, modified_at: t })
    return id
  }

  /** Create a note directly on the server (as another device would). */
  addNote(text: string, opts: Partial<Pick<Note, 'tags' | 'parent_id' | 'space_id' | 'user_id'>> = {}): Note {
    const t = this.now()
    const n: Note = { id: this.nextNoteId++, user_id: opts.user_id ?? this.userId, space_id: opts.space_id ?? 1, text, tags: opts.tags ?? [], parent_id: opts.parent_id ?? null, created_at: t, modified_at: t, date: t, is_deleted: false, client_id: null }
    this.notes.set(n.id, n)
    return n
  }

  editNote(id: number, text: string) {
    const n = this.notes.get(id)!
    n.text = text
    n.modified_at = this.now()
  }

  addAttachment(noteId: number, fileName: string, bytes = new Uint8Array([1, 2, 3])): Attachment {
    const t = this.now()
    const a: Attachment = { id: `att-${this.nextAttId++}`, note_id: noteId, client_id: null, file_name: fileName, file_type: 'image/webp', file_size: bytes.length, created_at: t, modified_at: t, data: bytes }
    this.attachments.set(a.id, a)
    return a
  }

  fetch = async (input: any, init: any = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || 'GET').toUpperCase()
    const path = url.pathname
    this.log.push(`${method} ${path}`)
    if (this.onRequest) await this.onRequest(method, path)
    if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs))
    if (this.down) throw new TypeError('Failed to fetch')
    const f = this.failures.find(x => x.times > 0 && x.match.test(`${method} ${path}`))
    if (f) { f.times--; return json(f.status, { success: false, error: { code: 'X', message: 'injected failure' } }) }
    const auth = (init.headers?.Authorization ?? init.headers?.authorization) as string | undefined
    if (!auth?.startsWith('Bearer ')) return json(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'no token' } })

    if (method === 'GET' && path === '/spaces') return ok({ data: [...this.spaces.values()].map(s => ({ id: s.id, name: s.name })) })
    if (method === 'POST' && path === '/spaces') {
      const body = JSON.parse(init.body)
      return ok({ id: this.addSpace(body.name) })
    }
    if (method === 'POST' && path === '/sync') return ok(this.push(JSON.parse(init.body)))
    if (method === 'GET' && path === '/sync') return ok(this.pull(url.searchParams.get('since')!))
    if (method === 'POST' && path === '/upload') return this.upload(init.body as FormData)
    const content = path.match(/^\/files\/([^/]+)\/content$/)
    if (method === 'GET' && content) {
      const a = this.attachments.get(decodeURIComponent(content[1]))
      if (!a) return json(404, { success: false, error: { code: 'NOT_FOUND', message: 'attachment not found' } })
      return new Response(a.data as any, { status: 200, headers: { 'Content-Type': a.file_type } })
    }
    return json(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } })
  }

  private validParent(pid: number | null | undefined, spaceId: number): number | null {
    if (pid == null) return null
    const p = this.notes.get(pid)
    return p && p.space_id === spaceId ? pid : null
  }

  private push(body: any) {
    const resp: any = { applied: 0, conflicts: [], mappings: [], versions: [], rejected: [] }
    for (const n of body.notes ?? []) {
      if (!n.space_id) continue
      if (n.id == null) {
        const dup = [...this.notes.values()].find(x => x.user_id === this.userId && n.clientId && x.client_id === n.clientId)
        if (dup) {
          resp.mappings.push({ resource: 'note', clientId: n.clientId, serverId: dup.id })
          resp.versions.push({ resource: 'note', id: dup.id, modified_at: dup.modified_at })
          continue
        }
        const t = this.now()
        const rec: Note = { id: this.nextNoteId++, user_id: this.userId, space_id: n.space_id, text: n.text, tags: n.tags ?? [], parent_id: this.validParent(n.parent_id, n.space_id), created_at: n.created_at ?? t, modified_at: t, date: n.date ?? t, is_deleted: false, client_id: n.clientId ?? null }
        this.notes.set(rec.id, rec)
        resp.applied++
        if (n.clientId) resp.mappings.push({ resource: 'note', clientId: n.clientId, serverId: rec.id })
        resp.versions.push({ resource: 'note', id: rec.id, modified_at: rec.modified_at })
        continue
      }
      const cur = this.notes.get(n.id)
      if (!cur) { resp.rejected.push({ resource: 'note', id: n.id, clientId: n.clientId ?? undefined, reason: 'not_found' }); continue }
      if (cur.user_id !== this.userId) { resp.rejected.push({ resource: 'note', id: n.id, reason: 'forbidden' }); continue }
      const serverChanged = n.base_modified_at != null ? Date.parse(cur.modified_at) > Date.parse(n.base_modified_at) : !(Date.parse(n.modified_at) > Date.parse(cur.modified_at))
      if (serverChanged) {
        resp.conflicts.push({ resource: 'note', id: cur.id, reason: 'server-newer', server: { id: cur.id, space_id: cur.space_id, text: cur.text, tags: [...cur.tags], date: cur.date, created_at: cur.created_at, modified_at: cur.modified_at, deleted_at: cur.is_deleted ? cur.modified_at : undefined } })
        continue
      }
      cur.text = n.text ?? cur.text
      cur.tags = n.tags ?? []
      cur.parent_id = this.validParent(n.parent_id, cur.space_id)
      cur.is_deleted = n.deleted_at != null
      cur.modified_at = this.now()
      for (const a of n.attachments ?? []) {
        const att = this.attachments.get(a.id)
        if (!att || att.note_id !== cur.id) continue
        if (a.is_deleted) this.attachments.delete(a.id)
        else if (a.modified_at) att.modified_at = a.modified_at
      }
      resp.applied++
      resp.versions.push({ resource: 'note', id: cur.id, modified_at: cur.modified_at })
    }
    for (const f of body.filters ?? []) {
      if (f.id == null) {
        const dup = [...this.filters.values()].find(x => f.clientId && x.client_id === f.clientId)
        if (dup) { resp.mappings.push({ resource: 'filter', clientId: f.clientId, serverId: dup.id }); continue }
        const t = this.now()
        const rec: Filter = { id: this.nextFilterId++, space_id: f.space_id, parent_id: f.parent_id ?? null, name: f.name, params: f.params, created_at: t, modified_at: t, is_deleted: false, client_id: f.clientId ?? null }
        this.filters.set(rec.id, rec)
        resp.applied++
        if (f.clientId) resp.mappings.push({ resource: 'filter', clientId: f.clientId, serverId: rec.id })
        resp.versions.push({ resource: 'filter', id: rec.id, modified_at: rec.modified_at })
        continue
      }
      const cur = this.filters.get(f.id)
      if (!cur) continue
      cur.name = f.name; cur.params = f.params; cur.parent_id = f.parent_id ?? null; cur.is_deleted = f.deleted_at != null; cur.modified_at = this.now()
      resp.applied++
      resp.versions.push({ resource: 'filter', id: cur.id, modified_at: cur.modified_at })
    }
    return resp
  }

  private pull(since: string) {
    const s = Date.parse(since)
    const after = (iso: string) => Date.parse(iso) > s
    const notes = [...this.notes.values()]
      .filter(n => n.user_id === this.userId)
      .filter(n => after(n.modified_at) || [...this.attachments.values()].some(a => a.note_id === n.id && after(a.modified_at)))
      .sort((a, b) => a.id - b.id)
      .map(n => ({
        id: n.id, space_id: n.space_id, user_id: n.user_id, text: n.text, tags: n.tags, date: n.date, parent_id: n.parent_id ?? undefined,
        created_at: n.created_at, modified_at: n.modified_at, deleted_at: n.is_deleted ? n.modified_at : undefined,
        activities: [], charts: [],
        attachments: [...this.attachments.values()].filter(a => a.note_id === n.id).map(a => ({ id: a.id, file_name: a.file_name, file_type: a.file_type, file_size: a.file_size, created_at: a.created_at, modified_at: a.modified_at })),
      }))
    return {
      spaces: [...this.spaces.values()].filter(x => after(x.modified_at)),
      notes,
      tags: [],
      filters: [...this.filters.values()].filter(f => after(f.modified_at)).map(f => ({ id: f.id, space_id: f.space_id, parent_id: f.parent_id ?? undefined, name: f.name, params: f.params, created_at: f.created_at, modified_at: f.modified_at, deleted_at: f.is_deleted ? f.modified_at : undefined })),
      activityTypes: [],
    }
  }

  private async upload(form: FormData) {
    const noteId = Number(form.get('note_id'))
    const note = this.notes.get(noteId)
    if (!note || note.is_deleted) return json(400, { success: false, error: { code: 'INVALID', message: 'invalid note' } })
    const file = form.get('file') as File
    const clientId = (form.get('client_id') as string) || null
    const existing = [...this.attachments.values()].find(a => a.note_id === noteId && clientId && a.client_id === clientId)
    if (existing) return json(201, { success: true, data: { attachment_id: existing.id } })
    const bytes = await readBytes(file)
    const t = this.now()
    const a: Attachment = { id: `att-${this.nextAttId++}`, note_id: noteId, client_id: clientId, file_name: file.name, file_type: file.type || 'image/webp', file_size: bytes.length, created_at: t, modified_at: t, data: bytes }
    this.attachments.set(a.id, a)
    return json(201, { success: true, data: { attachment_id: a.id } })
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function ok(data: unknown): Response {
  return json(200, { success: true, data })
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  // jsdom's Blob has no arrayBuffer(); FileReader works.
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}
