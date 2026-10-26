// Languages of code blocks in notes: the list in the editor, the names written after ``` in the
// Markdown, and the highlight.js grammars that colour them (in the feed and in the editor).
// Only these grammars are bundled; any other fence name still shows as plain code.

import hljs from 'highlight.js/lib/core'
import type { LanguageFn } from 'highlight.js'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

export interface CodeLanguage {
  /** The name written after ``` in the note's Markdown. */
  id: string
  label: string
  grammar: LanguageFn
  /** File extension for code moved out of a note. */
  ext: string
}

/** In the order the editor's list shows them. */
export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: 'plaintext', label: 'Plain text', grammar: plaintext, ext: 'txt' },
  { id: 'bash', label: 'Bash', grammar: bash, ext: 'sh' },
  { id: 'c', label: 'C', grammar: c, ext: 'c' },
  { id: 'cpp', label: 'C++', grammar: cpp, ext: 'cpp' },
  { id: 'csharp', label: 'C#', grammar: csharp, ext: 'cs' },
  { id: 'css', label: 'CSS', grammar: css, ext: 'css' },
  { id: 'dockerfile', label: 'Dockerfile', grammar: dockerfile, ext: 'dockerfile' },
  { id: 'go', label: 'Go', grammar: go, ext: 'go' },
  { id: 'xml', label: 'HTML / XML', grammar: xml, ext: 'html' },
  { id: 'java', label: 'Java', grammar: java, ext: 'java' },
  { id: 'javascript', label: 'JavaScript', grammar: javascript, ext: 'js' },
  { id: 'json', label: 'JSON', grammar: json, ext: 'json' },
  { id: 'kotlin', label: 'Kotlin', grammar: kotlin, ext: 'kt' },
  { id: 'markdown', label: 'Markdown', grammar: markdown, ext: 'md' },
  { id: 'php', label: 'PHP', grammar: php, ext: 'php' },
  { id: 'powershell', label: 'PowerShell', grammar: powershell, ext: 'ps1' },
  { id: 'python', label: 'Python', grammar: python, ext: 'py' },
  { id: 'ruby', label: 'Ruby', grammar: ruby, ext: 'rb' },
  { id: 'rust', label: 'Rust', grammar: rust, ext: 'rs' },
  { id: 'sql', label: 'SQL', grammar: sql, ext: 'sql' },
  { id: 'swift', label: 'Swift', grammar: swift, ext: 'swift' },
  { id: 'typescript', label: 'TypeScript', grammar: typescript, ext: 'ts' },
  { id: 'yaml', label: 'YAML', grammar: yaml, ext: 'yaml' },
]

const BY_ID = new Map(CODE_LANGUAGES.map(l => [l.id, l]))

// Other names people write after ```, and VS Code's language ids (sent with copied code).
const ALIASES: Record<string, string> = {
  text: 'plaintext', txt: 'plaintext', plain: 'plaintext',
  sh: 'bash', shell: 'bash', zsh: 'bash', shellscript: 'bash', console: 'bash',
  h: 'c', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'csharp', 'c#': 'csharp',
  docker: 'dockerfile',
  golang: 'go',
  html: 'xml', xhtml: 'xml', svg: 'xml',
  js: 'javascript', jsx: 'javascript', javascriptreact: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsonc: 'json', json5: 'json',
  kt: 'kotlin', kts: 'kotlin',
  md: 'markdown',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  py: 'python', python3: 'python',
  rb: 'ruby',
  rs: 'rust',
  ts: 'typescript', tsx: 'typescript', typescriptreact: 'typescript',
  yml: 'yaml',
}

/** The id of a known language for a fence name or VS Code id, or null. */
export function normalizeLanguage(name: string | null | undefined): string | null {
  const key = (name ?? '').trim().toLowerCase()
  if (!key) return null
  if (BY_ID.has(key)) return key
  return ALIASES[key] ?? null
}

export function languageLabel(id: string | null | undefined): string {
  const known = normalizeLanguage(id)
  return known ? BY_ID.get(known)!.label : (id || 'Plain text')
}

export function languageExtension(id: string | null | undefined): string {
  const known = normalizeLanguage(id)
  return known ? BY_ID.get(known)!.ext : 'txt'
}

for (const l of CODE_LANGUAGES) hljs.registerLanguage(l.id, l.grammar)

/** Highlighted HTML for a code block (highlight.js escapes the text), or null for unknown languages. */
export function highlightCode(code: string, name: string | null | undefined): string | null {
  const id = normalizeLanguage(name)
  if (!id || id === 'plaintext') return null
  return hljs.highlight(code, { language: id, ignoreIllegals: true }).value
}

/** The editor's highlighter: the same grammars and names, through lowlight. */
export const lowlight = createLowlight(Object.fromEntries(CODE_LANGUAGES.map(l => [l.id, l.grammar])))
const aliasesById: Record<string, string[]> = {}
for (const [alias, id] of Object.entries(ALIASES)) (aliasesById[id] ??= []).push(alias)
lowlight.registerAlias(aliasesById)
