import { useEffect, useMemo, useState } from 'react'
import PublicRoundedIcon from '@mui/icons-material/PublicRounded'
import SubdirectoryArrowRightRoundedIcon from '@mui/icons-material/SubdirectoryArrowRightRounded'
import { renderNoteHtml } from '../lib/note-format/render'
import { defaultServer, getServer, normalizeServerUrl, serverLabel } from '../lib/server'
import { formatExactDateTime, formatRelativeShort } from '../lib/time'
import { Avatar } from './ui/avatar'

interface PublicNote {
  id: number
  parentId: number | null
  text: string
  tags: string[]
  author: string
  createdAt: string
  modifiedAt: string
  attachments: Array<{ id: string; fileName: string; fileType: string }>
}
interface PublicData { kind: 'space' | 'note'; spaceName: string; rootNoteId: number | null; includeReplies: boolean; notes: PublicNote[] }

/** Server named in the link (when it isn't this site's default), otherwise the usual one. */
function linkServer(): string | undefined {
  const fromLink = new URLSearchParams(location.search).get('server')
  if (fromLink) return normalizeServerUrl(fromLink) ?? undefined
  return getServer()
}

/** Read-only page for a public link: /p/<token>. No sign-in, nothing is stored. */
export default function PublicPage({ token }: { token: string }) {
  const server = useMemo(linkServer, [])
  const [data, setData] = useState<PublicData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!server) { setError('This link does not say which server it is from.'); return }
    fetch(`${server}/public/${encodeURIComponent(token)}`)
      .then(async r => {
        const body = await r.json().catch(() => null)
        if (!r.ok) throw new Error(body?.error?.message || 'This link does not work any more')
        setData(body.data)
      })
      .catch(e => setError(e instanceof TypeError ? 'The server is unreachable. Try again later.' : e.message))
  }, [server, token])

  useEffect(() => {
    document.title = data ? `${data.kind === 'note' ? firstLine(data.notes.find(n => n.id === data.rootNoteId)?.text) : data.spaceName} · focuz` : 'focuz'
  }, [data])

  const children = useMemo(() => {
    const m = new Map<number, PublicNote[]>()
    for (const n of data?.notes ?? []) {
      if (n.parentId == null) continue
      const list = m.get(n.parentId) ?? []
      list.push(n)
      m.set(n.parentId, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return m
  }, [data])

  const fileUrl = (id: string) => `${server}/public/${encodeURIComponent(token)}/files/${encodeURIComponent(id)}`
  const ids = new Set((data?.notes ?? []).map(n => n.id))
  const roots = data
    ? data.kind === 'note'
      ? data.notes.filter(n => n.id === data.rootNoteId)
      : data.notes.filter(n => n.parentId == null || !ids.has(n.parentId))
    : []
  const foreign = server && server !== defaultServer()

  return (
    <div className="public-page">
      <header className="public-head">
        <a className="text-title text-primary" href="/">focuz</a>
        <span className="public-badge"><PublicRoundedIcon fontSize="inherit" /> Public, read-only</span>
      </header>
      <main className="public-main">
        {foreign && <p className="public-origin">Shared from {serverLabel(server)}</p>}
        {error && <div className="card text-center space-y-2"><b>This page is not available</b><p className="text-secondary text-sm">{error}</p></div>}
        {!error && !data && <div className="text-secondary text-center py-10">Loading…</div>}
        {data && (
          <>
            <div className="public-title">
              <h1>{data.kind === 'space' ? data.spaceName : `A note from ${data.spaceName}`}</h1>
              {data.kind === 'space' && <p className="text-secondary text-sm">{roots.length} note{roots.length === 1 ? '' : 's'}</p>}
            </div>
            <ul className="space-y-3">
              {roots.map(n => <PublicNoteItem key={n.id} note={n} childrenOf={children} depth={0} fileUrl={fileUrl} collapseReplies={data.kind === 'space'} />)}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}

function firstLine(text?: string): string {
  return (text ?? '').replace(/[#>*_`[\]-]/g, '').trim().split('\n')[0].slice(0, 60) || 'Note'
}

function PublicNoteItem({ note, childrenOf, depth, fileUrl, collapseReplies }: {
  note: PublicNote
  childrenOf: Map<number, PublicNote[]>
  depth: number
  fileUrl: (id: string) => string
  collapseReplies: boolean
}) {
  const replies = childrenOf.get(note.id) ?? []
  const [open, setOpen] = useState(!collapseReplies)
  const html = useMemo(() => renderNoteHtml(note.text), [note.text])
  const images = note.attachments.filter(a => a.fileType.startsWith('image/'))
  const files = note.attachments.filter(a => !a.fileType.startsWith('image/'))
  return (
    <li>
      <article className="card space-y-3">
        {images.length > 0 && (
          <div className="public-images">
            {images.map(a => <img key={a.id} src={fileUrl(a.id)} alt={a.fileName} loading="lazy" />)}
          </div>
        )}
        {/* Safe: markdown-it runs with html disabled; checkboxes are shown but can't be ticked. */}
        <div className="note-prose public-prose" dangerouslySetInnerHTML={{ __html: html }} />
        {files.length > 0 && <ul className="text-sm">{files.map(a => <li key={a.id}><a className="link-btn" href={fileUrl(a.id)}>{a.fileName}</a></li>)}</ul>}
        {note.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{note.tags.map(t => <span key={t} className="pill pill-tag">{t}</span>)}</div>}
        <footer className="flex items-center justify-between gap-3 text-[13px] text-secondary">
          {replies.length > 0 ? (
            <button type="button" className="inline-flex items-center gap-1.5 text-primary hover:underline" onClick={() => setOpen(o => !o)} aria-expanded={open}>
              <SubdirectoryArrowRightRoundedIcon fontSize="inherit" /> {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </button>
          ) : <span />}
          <span className="inline-flex items-center gap-2" title={formatExactDateTime(note.createdAt)}>
            <Avatar name={note.author} size={18} /> {note.author} · {formatRelativeShort(note.createdAt)}
          </span>
        </footer>
      </article>
      {open && replies.length > 0 && (
        <ul className={`space-y-3 mt-3 ${depth < 3 ? 'public-replies' : ''}`}>
          {replies.map(r => <PublicNoteItem key={r.id} note={r} childrenOf={childrenOf} depth={depth + 1} fileUrl={fileUrl} collapseReplies={collapseReplies} />)}
        </ul>
      )}
    </li>
  )
}
