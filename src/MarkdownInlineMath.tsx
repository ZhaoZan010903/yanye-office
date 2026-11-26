import React, { useEffect, useRef, useState } from 'react'
import { InputRule, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Figure } from './MarkdownFigures.jsx'

function InlineFormula({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.attrs.source)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) input.current?.focus() }, [editing])
  function finish(save: boolean, focus: boolean) {
    if (save && draft !== node.attrs.source) updateAttributes({ source: draft })
    setEditing(false)
    const pos = getPos()
    if (focus && typeof pos === 'number') editor.commands.focus(pos + node.nodeSize)
  }
  return <NodeViewWrapper as="span" className="md-inline-math" contentEditable={false}>
    {editing ? <input ref={input} aria-label="行内公式源码" value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={() => finish(true, false)} onKeyDown={e => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter', true) }
        e.stopPropagation()
      }}/> :
      <button type="button" aria-label="编辑行内公式" onClick={() => { setDraft(node.attrs.source); setEditing(true) }}>
        <Figure item={{ kind: 'inline', source: node.attrs.source }}/>
      </button>}
  </NodeViewWrapper>
}

export const MarkdownInlineMath = Node.create({
  name: 'inlineFormula', group: 'inline', inline: true, atom: true,
  addAttributes() { return { source: { default: '' } } },
  parseHTML() { return [{ tag: 'span[data-math]', getAttrs: el => ({ source: (el as HTMLElement).dataset.math }) }] },
  renderHTML({ node }) { return ['span', { 'data-math': node.attrs.source }, '$' + node.attrs.source + '$'] },
  markdownTokenizer: {
    name: 'inlineFormula', level: 'inline',
    start: text => text.indexOf('$'),
    tokenize(src) {
      const match = /^\$(?![\s$])([^$\n]+?)(?<![\\\s])\$(?![\d$])/u.exec(src)
      if (match) return { type: 'inlineFormula', raw: match[0], text: match[1] }
    },
  },
  parseMarkdown: (token, h) => h.createNode('inlineFormula', { source: token.text }),
  renderMarkdown: node => '$' + node.attrs?.source + '$',
  addInputRules() {
    return [new InputRule({
      find: /(?<![\\$])\$(?![\s$])([^$\n]+?)(?<![\\\s])\$$/u,
      handler: ({ state, range, match }) => { state.tr.replaceWith(range.from, range.to, this.type.create({ source: match[1] })) },
    })]
  },
  addNodeView() { return ReactNodeViewRenderer(InlineFormula, { as: 'span' }) },
})
