// PDF and Word previews. Loaded only when someone opens such a file (React.lazy in NoteFiles), so
// pdf.js and mammoth stay out of the main bundle.

import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import DOMPurify from 'dompurify'
// The browser build: the package's main entry pulls in Node modules.
import mammoth from 'mammoth/mammoth.browser.js'

// Served from this origin, so the CSP's worker-src 'self' allows it.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Links in a document open in a new tab, never in place of the app.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Pages render when they come near the view; a long PDF does not draw everything at once. */
export function PdfView({ blob, onError }: { blob: Blob; onError: (message: string) => void }) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  useEffect(() => {
    let cancelled = false
    let task: pdfjs.PDFDocumentLoadingTask | null = null
    void blob.arrayBuffer().then(buf => {
      if (cancelled) return
      // No scripts, forms or XFA: a preview only draws the pages.
      task = pdfjs.getDocument({ data: new Uint8Array(buf), enableXfa: false, isOffscreenCanvasSupported: true })
      return task.promise
    }).then(d => { if (d && !cancelled) setDoc(d) })
      .catch(e => { if (!cancelled) onError((e as { name?: string })?.name === 'PasswordException' ? 'The PDF is protected with a password.' : 'The PDF could not be read.') })
    return () => { cancelled = true; void task?.destroy() }
  }, [blob, onError])

  if (!doc) return <p className="text-secondary">Loading…</p>
  return (
    <div className="pdf-pages">
      {Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} pageNumber={i + 1} />)}
    </div>
  )
}

function PdfPage({ doc, pageNumber }: { doc: pdfjs.PDFDocumentProxy; pageNumber: number }) {
  const holder = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [ratio, setRatio] = useState(1.414)
  const [visible, setVisible] = useState(false)

  // Size the placeholder like the page before drawing, so the scroll position holds.
  useEffect(() => {
    let cancelled = false
    void doc.getPage(pageNumber).then(p => {
      const vp = p.getViewport({ scale: 1 })
      if (!cancelled) setRatio(vp.height / vp.width)
    })
    return () => { cancelled = true }
  }, [doc, pageNumber])

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) { setVisible(true); io.disconnect() } }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !canvas.current || !holder.current) return
    let cancelled = false
    let task: pdfjs.RenderTask | null = null
    void doc.getPage(pageNumber).then(page => {
      if (cancelled || !canvas.current || !holder.current) return
      const width = holder.current.clientWidth
      const base = page.getViewport({ scale: 1 })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      canvas.current.width = Math.floor(viewport.width)
      canvas.current.height = Math.floor(viewport.height)
      task = page.render({ canvas: canvas.current, viewport })
      return task.promise
    }).catch(() => {})
    return () => { cancelled = true; task?.cancel() }
  }, [visible, doc, pageNumber])

  return (
    <div ref={holder} className="pdf-page" style={{ aspectRatio: `1 / ${ratio}` }} aria-label={`Page ${pageNumber} of ${doc.numPages}`} role="img">
      <canvas ref={canvas} />
    </div>
  )
}

/**
 * A Word file as plain, readable HTML: headings, paragraphs, lists, tables and pictures, without the
 * layout. mammoth's output is cleaned before it touches the page (the file comes from another user).
 */
export function DocxView({ blob, onError }: { blob: Blob; onError: (message: string) => void }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void blob.arrayBuffer()
      .then(arrayBuffer => mammoth.convertToHtml({ arrayBuffer }))
      .then(res => {
        if (cancelled) return
        setHtml(DOMPurify.sanitize(res.value, {
          // Pictures come inline as data: URLs; links may not run script or open the app's routes.
          ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);)/i,
          FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'svg', 'math'],
        }))
      })
      .catch(() => { if (!cancelled) onError('The document could not be read.') })
    return () => { cancelled = true }
  }, [blob, onError])

  if (html == null) return <p className="text-secondary">Loading…</p>
  if (!html.trim()) return <p className="text-secondary">The document has no text.</p>
  return <div className="note-prose docx-view" dangerouslySetInnerHTML={{ __html: html }} />
}
