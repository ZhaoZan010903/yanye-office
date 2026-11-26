import { Marked, type Token } from 'marked'
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as ProseNode } from '@tiptap/pm/model'
import { describeSource } from './markdown.js'
import { editSource, editorSource } from './markdown-search.js'

type Piece = { before: string; raw: string; node: ProseNode }
export interface ReadingProjection {
  pieces: Piece[]
  original: WeakMap<ProseNode, Piece>
  prefix: string
  suffix: string
  newline: string
}
const blocks = new Marked({ gfm: true })
blocks.use({ extensions: [{
  name: 'displayMath', level: 'block',
  start: src => src.match(/(?:^|\n) {0,3}\$\$/)?.index,
  tokenizer(src) {
    const m = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?=\n|$)|^ {0,3}\$\$(.+?)\$\$[ \t]*(?=\n|$)/u.exec(src)
    if (m) return { type: 'displayMath', raw: m[0], text: m[1] ?? m[2] }
  },
}, {
  name: 'directive', level: 'block',
  start: src => src.match(/(?:^|\n) {0,3}:::/)?.index,
  tokenizer(src) {
    const m = /^ {0,3}:::[^\n]*\n[\s\S]*?(?:\n {0,3}:::[ \t]*(?=\n|$)|$)/u.exec(src)
    if (m) return { type: 'directive', raw: m[0] }
  },
}] })

function literal(text: string, math = false): JSONContent {
  return { type: 'codeBlock', attrs: { sourceKind: math ? 'math' : 'raw', language: math ? 'math' : null },
    content: text ? [{ type: 'text', text }] : [] }
}

function readingBlock(editor: Editor, token: Token, text: string): JSONContent {
  if (token.type === 'displayMath') return literal(token.text, true)
  if (token.type === 'html' || token.type === 'directive' || token.type === 'def' ||
    (token.type !== 'code' && describeSource(text).sourceOnly)) return literal(text)
  const nodes = editor.markdown!.parse(text).content || []
  return nodes.length === 1 ? nodes[0] : literal(text)
}

// Reading is a projection. Keep every untouched source slice, including empty
// lines, original fence delimiters, unknown extensions, and mixed line endings.
export function openReading(editor: Editor, raw: string): ReadingProjection {
  const source = editorSource(raw)
  const content: JSONContent[] = []
  const slices: Omit<Piece, 'node'>[] = []
  let cursor = 0, rawOffset = 0, pending = ''
  function consume(length: number) {
    const start = rawOffset
    for (let i = 0; i < length; i++, rawOffset++) {
      if (raw[rawOffset] === '\r' && raw[rawOffset + 1] === '\n') rawOffset++
    }
    cursor += length
    return raw.slice(start, rawOffset)
  }
  function emit(text: string, json: JSONContent) {
    slices.push({ before: pending, raw: consume(text.length) })
    content.push(json)
    pending = ''
  }
  function gap(length: number) {
    if (!length) return
    const text = source.slice(cursor, cursor + length)
    const leading = /^\s*/u.exec(text)![0]
    pending += consume(leading.length)
    const remaining = text.slice(leading.length)
    const body = remaining.trimEnd()
    if (body) emit(body, literal(body))
    pending += consume(remaining.length - body.length)
  }
  const front = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?=\n|$)/u.exec(source)
  if (front && describeSource(front[0]).sourceOnly) emit(front[0], literal(front[0]))
  for (const token of blocks.lexer(source.slice(cursor))) {
    const at = source.indexOf(token.raw, cursor)
    if (at < 0) { gap(source.length - cursor); break }
    gap(at - cursor)
    const body = token.raw.replace(/\n+$/u, '')
    if (token.type === 'space') pending += consume(token.raw.length)
    else {
      if (body) emit(body, readingBlock(editor, token, body))
      pending += consume(token.raw.length - body.length)
    }
  }
  gap(source.length - cursor)
  if (!content.length) { content.push({ type: 'paragraph' }); slices.push({ before: '', raw: '' }) }
  editor.chain().setMeta('addToHistory', false).setContent({ type: 'doc', content }, { emitUpdate: false }).run()
  const pieces: Piece[] = []
  const original = new WeakMap<ProseNode, Piece>()
  editor.state.doc.forEach((node, _offset, index) => {
    const piece = { ...(slices[index] || { before: '', raw: '' }), node }
    pieces.push(piece)
    original.set(node, piece)
  })
  return { pieces, original, prefix: pieces[0]?.before || '', suffix: pending, newline: /\r\n|\r|\n/u.exec(raw)?.[0] || '\n' }
}

function serialized(editor: Editor, node: ProseNode) {
  const result = editor.markdown!.serialize({ type: 'doc', content: [node.toJSON()] })
  return node.type.name === 'table' ? result.replace(/^\n+|\n+$/gu,'') : result
}

function editedText(before: ProseNode, after: ProseNode): { from: string; to: string } | undefined {
  if (!before.sameMarkup(after)) return
  if (before.isText && before.text) return { from: before.text, to: after.text || '' }
  if (before.childCount !== after.childCount) return
  let difference
  for (let i = 0; i < before.childCount; i++) {
    const old = before.child(i), next = after.child(i)
    if (old.eq(next)) continue
    if (difference) return
    difference = editedText(old, next)
    if (!difference) return
  }
  return difference
}

function editBlock(editor: Editor, piece: Piece, node: ProseNode, newline: string) {
  const next = serialized(editor, node)
  const prior = serialized(editor, piece.node)
  const original = editorSource(piece.raw)
  const restore = (text: string) => /[\r\n]/u.test(piece.raw) ? editSource(piece.raw, text) : text.replace(/\n/g, newline)
  const matchesBlock = (candidate: string) => {
    const tokens = blocks.lexer(candidate).filter(t => t.type !== 'space')
    return tokens.length === 1 && editor.schema.nodeFromJSON(readingBlock(editor, tokens[0], candidate)).eq(node)
  }
  // A table serializer pads all columns again when just one cell gets longer.
  // Try replacing the edited text run first and verify the full parse.
  const changed = editedText(piece.node, node)
  if (changed && prior !== original) {
    let offset = original.indexOf(changed.from)
    for (let tries = 0; offset >= 0 && tries < 8; tries++) {
      const candidate = original.slice(0, offset) + changed.to + original.slice(offset + changed.from.length)
      if (matchesBlock(candidate)) return restore(candidate)
      offset = original.indexOf(changed.from, offset + changed.from.length)
    }
  }
  if (prior === original || piece.node.type !== node.type) return restore(next)
  let start = 0, tail = 0
  while (start < prior.length && start < next.length && prior[start] === next[start]) start++
  while (tail < prior.length - start && tail < next.length - start &&
    prior[prior.length - tail - 1] === next[next.length - tail - 1]) tail++
  const end = prior.length - tail
  const widths = [16, 8, 4, 2, 1, 0]
  for (const left of widths) for (const right of widths) {
    const from = Math.max(0, start - left)
    const needle = prior.slice(from, end + right)
    if (!needle) continue
    const hit = original.indexOf(needle)
    if (hit < 0 || original.indexOf(needle, hit + 1) >= 0) continue
    const offset = hit + start - from
    const candidate = original.slice(0, offset) + next.slice(start, next.length - tail) + original.slice(offset + end - start)
    // Verify an anchored edit before retaining alternate Markdown spelling in
    // this block. Delimiter changes can otherwise alter the parse elsewhere.
    if (matchesBlock(candidate)) {
      return restore(candidate)
    }
    break
  }
  return restore(next)
}

export function writeReading(editor: Editor, state: ReadingProjection) {
  const old = state.pieces
  const nodes: ProseNode[] = []
  editor.state.doc.forEach(node => { nodes.push(node) })
  let prefix = 0, tail = 0
  while (prefix < nodes.length && prefix < old.length && nodes[prefix].eq(old[prefix].node)) prefix++
  while (tail < nodes.length - prefix && tail < old.length - prefix &&
    nodes[nodes.length - tail - 1].eq(old[old.length - tail - 1].node)) tail++
  const pieces = nodes.map((node, i): Piece => {
    const oldIndex = i < prefix ? i : i >= nodes.length - tail ? old.length - nodes.length + i :
      i - prefix < old.length - prefix - tail ? i : -1
    const previous = old[oldIndex]
    const original = state.original.get(node) || (previous?.node.eq(node) ? previous : undefined)
    const raw = original?.raw ?? (previous ? editBlock(editor, previous, node, state.newline) :
      serialized(editor, node).replace(/\n/g, state.newline))
    const before = i === 0 ? state.prefix : (original?.before || previous?.before || state.newline.repeat(2))
    const piece = { node, raw, before }
    state.original.set(node, piece)
    return piece
  })
  state.pieces = pieces
  return pieces.map(p => p.before + p.raw).join('') + state.suffix
}
