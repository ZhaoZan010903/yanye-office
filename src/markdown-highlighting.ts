import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseNode } from '@tiptap/pm/model'
import { highlightFence, loadLanguages, type HighlightSpan } from './markdown-languages'

const key = new PluginKey<DecorationSet>('fenced-code-colors')

// ProseMirror structurally shares untouched nodes between transactions. Moving a
// fence reuses its tokens, even if its position in the document has changed.
export function fenceHighlighting() {
  const cache = new WeakMap<ProseNode, HighlightSpan[]>()
  let ready = false
  function decorate(doc: ProseNode) {
    const ranges: Decoration[] = []
    if (!ready) return DecorationSet.empty
    doc.descendants((node, pos) => {
      if (node.type.name !== 'codeBlock') return
      const language = node.attrs.language?.toLowerCase()
      if (!language || node.attrs.sourceKind === 'raw') return false
      let spans = cache.get(node)
      if (!spans) {
        spans = highlightFence(language, node.textContent)
        cache.set(node, spans)
      }
      for (const { from, to, classes } of spans) {
        ranges.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: classes }))
      }
      return false
    })
    return DecorationSet.create(doc, ranges)
  }
  return new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, previous) => tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : previous,
    },
    props: { decorations: state => key.getState(state) },
    view(view) {
      let alive = true, pending = false
      const request = () => {
        if (ready || pending) return
        let found = false
        view.state.doc.descendants(node => {
          if (node.type.name === 'codeBlock' && node.attrs.language) found = true
          return !found
        })
        if (!found) return
        pending = true
        loadLanguages().then(() => {
          ready = true
          if (alive) view.dispatch(view.state.tr.setMeta(key, true))
        }).catch(() => { pending = false })
      }
      request()
      return { update: request, destroy: () => { alive = false } }
    },
  })
}
