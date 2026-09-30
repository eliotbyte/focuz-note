import { useMemo, type ReactNode } from 'react'

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenize(query: string): string[] {
  const raw = (query || '').trim()
  if (!raw) return []
  // Split by whitespace; keep short tokens too to mimic flexsearch "full" substring behavior
  const parts = raw
    .split(/\s+/g)
    .map(s => s.trim())
    .filter(Boolean)
  // Deduplicate and sort by length desc to prefer longer matches first
  const uniq = Array.from(new Set(parts))
  uniq.sort((a, b) => b.length - a.length)
  return uniq
}

export default function HighlightedText({ text, query, className }: { text: string; query: string; className?: string }) {
  const tokens = useMemo(() => tokenize(query), [query])

  const content = useMemo(() => {
    if (!tokens.length || !text) return [text] as Array<string | ReactNode>
    const pattern = new RegExp(tokens.map(escapeRegExp).join('|'), 'gi')
    const parts: Array<string | ReactNode> = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    // Use RegExp.exec to iterate matches and preserve order/indices
    // eslint-disable-next-line no-cond-assign
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (lastIndex < start) {
        parts.push(text.slice(lastIndex, start))
      }
      parts.push(
        <mark key={`m-${start}-${end}`} className="bg-yellow-400/30 text-inherit rounded px-0.5">
          {text.slice(start, end)}
        </mark>
      )
      lastIndex = end
      // Safeguard for zero-length matches (should not happen with our tokens)
      if (pattern.lastIndex === match.index) pattern.lastIndex++
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex))
    return parts
  }, [text, tokens])

  return (
    <span className={className}>
      {content.map((part, idx) => (typeof part === 'string' ? <span key={idx}>{part}</span> : part))}
    </span>
  )
} 