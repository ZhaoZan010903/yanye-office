import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { StateEffect, type Range } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { highlightFence, loadLanguages } from './markdown-languages'

const tokens = HighlightStyle.define([
  { tag: tags.heading1, class: 'src-h1' },
  { tag: tags.heading2, class: 'src-h2' },
  { tag: tags.heading, class: 'src-heading' },
  { tag: [tags.processingInstruction, tags.punctuation], class: 'src-mark' },
  { tag: tags.emphasis, class: 'src-em' },
  { tag: tags.strong, class: 'src-strong' },
  { tag: tags.strikethrough, class: 'src-strike' },
  { tag: [tags.link, tags.url, tags.labelName], class: 'src-link' },
  { tag: [tags.monospace, tags.special(tags.string)], class: 'src-code' },
  { tag: tags.quote, class: 'src-quote' },
  { tag: tags.comment, class: 'src-mark' },
])

const grammarReady = StateEffect.define<null>()

// Markdown and the reading view share one lazily loaded language registry.
// Highlight only fenced blocks intersecting CodeMirror's visible ranges.
const fencedCode = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none
  private alive = true
  private loading = false
  private loaded = false

  constructor(view: EditorView) { this.paint(view) }
  destroy() { this.alive = false }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.transactions.some(tr => tr.effects.some(effect => effect.is(grammarReady)))) this.paint(update.view)
  }
  private paint(view: EditorView) {
    const ranges: Range<Decoration>[] = []
    const seen = new Set<number>()
    const tree = syntaxTree(view.state)
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({ from, to, enter: node => {
        if (node.name !== 'FencedCode') return
        if (seen.has(node.from)) return false
        seen.add(node.from)
        const info = node.node.getChild('CodeInfo')
        if (!info) return false
        const language = view.state.sliceDoc(info.from, info.to).trim().split(/\s/u)[0].toLowerCase()
        const parts = node.node.getChildren('CodeText')
        if (!parts.length || node.to - node.from > 48000) return false
        if (!this.loaded && !this.loading) {
          this.loading = true
          void loadLanguages().then(() => {
            if (!this.alive) return
            this.loaded = true
            view.dispatch({ effects: grammarReady.of(null) })
          }).catch(() => { this.loading = false })
        }
        if (this.loaded) for (const part of parts) {
          for (const token of highlightFence(language, view.state.sliceDoc(part.from, part.to))) {
            ranges.push(Decoration.mark({ class: token.classes }).range(part.from + token.from, part.from + token.to))
          }
        }
        return false
      } })
    }
    this.decorations = Decoration.set(ranges, true)
  }
}, { decorations: plugin => plugin.decorations })

export const markdownSourceLanguage = [
  markdown({ base: markdownLanguage, addKeymap: false }),
  syntaxHighlighting(tokens),
  fencedCode,
]
