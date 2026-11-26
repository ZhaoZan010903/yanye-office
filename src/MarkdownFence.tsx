import React, { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import CodeBlock from '@tiptap/extension-code-block'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Check, CodeXml, Eye } from 'lucide-react'
import { Figure } from './MarkdownFigures.jsx'
import { languageSuggestions, loadLanguages } from './markdown-languages'
import { fenceHighlighting } from './markdown-highlighting'

export const fenceStart = /^ {0,3}(`{3,}|~{3,})([^\s`~]*)([^\n]*)$/u

function FenceView({ node, updateAttributes, getPos, editor }: NodeViewProps) {
  const { language, sourceKind } = node.attrs
  const label = String(language || '')
  const kind = label.toLowerCase()
  const figure = ['mermaid', 'meried'].includes(kind) ? 'mermaid' : ['math', 'latex'].includes(kind) ? 'math' : null
  const [edit, setEdit] = useState(false)
  const [active, setActive] = useState(false)
  const [draft, setDraft] = useState(label)
  const [names, setNames] = useState(() => languageSuggestions(label))
  const [index, setIndex] = useState(-1)
  const id = useId()
  const box = useRef<HTMLInputElement>(null)
  const showCode = !figure || edit || !node.textContent

  useEffect(() => { setDraft(label) }, [label])
  useEffect(() => {
    if (!figure) return
    const followCaret = () => {
      const pos = getPos()
      if (typeof pos !== 'number' || !editor.isFocused) return
      const size = editor.state.doc.nodeAt(pos)?.nodeSize || 0
      const head = editor.state.selection.head
      setEdit(head > pos && head < pos + size)
    }
    followCaret()
    editor.on('selectionUpdate', followCaret); editor.on('focus', followCaret)
    return () => { editor.off('selectionUpdate', followCaret); editor.off('focus', followCaret) }
  }, [editor, getPos, figure])
  useEffect(() => {
    let mounted = true
    if (active) loadLanguages().then(() => { if (mounted) setNames(languageSuggestions(draft)) }).catch(() => {})
    setNames(languageSuggestions(draft))
    setIndex(-1)
    return () => { mounted = false }
  }, [active, draft])

  function editHere() {
    const pos = getPos()
    if (typeof pos !== 'number' || editor.isDestroyed) return
    flushSync(() => setEdit(true))
    editor.commands.setTextSelection(pos + 1)
    editor.view.focus()
  }
  function commit(value: string) {
    const next = value.trim().split(/\s/u)[0] || ''
    if (next !== label) updateAttributes({ language: next || null, sourceKind: 'fence' })
    setDraft(next)
    setActive(false)
  }

  return <NodeViewWrapper className="md-fence" data-language={kind} data-source-kind={sourceKind}>
    <div className="md-fence-tools" contentEditable={false}>
      {sourceKind === 'raw' ? <span className="md-raw-label">Markdown 原文</span> :
        <div className="md-language">
          <input ref={box} role="combobox" aria-label="代码块语言" aria-autocomplete="list"
            aria-expanded={active && names.length > 0} aria-controls={id}
            aria-activedescendant={active && index >= 0 ? id + '-' + index : undefined}
            spellCheck={false} placeholder="选择语言" value={draft}
            onFocus={e => { setActive(true); e.target.select() }}
            onChange={e => { setDraft(e.target.value); setActive(true) }}
            onBlur={() => { if (active) commit(draft) }}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); setActive(true)
                setIndex(i => Math.max(0, Math.min(names.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (e.key === 'Enter') e.preventDefault()
                commit(names[index] ?? draft)
                if (e.key === 'Enter') editHere()
              } else if (e.key === 'Escape') {
                e.preventDefault(); setDraft(label); setActive(false); editHere()
              }
              e.stopPropagation()
            }}/>
          {active && names.length > 0 && <div role="listbox" aria-label="可选代码语言" id={id}>
            {names.map((name, i) => <button type="button" role="option" id={id + '-' + i} key={name}
              aria-selected={i === index} onMouseDown={e => e.preventDefault()}
              onClick={() => { commit(name); editHere() }}>{name}{name === label && <Check size={12}/>}</button>)}
          </div>}
        </div>}
      {figure && <button type="button" onClick={event => {
        if (showCode) { setEdit(false); event.currentTarget.focus() }
        else editHere()
      }}
        aria-label={showCode ? '预览此块' : '编辑此块源码'}>{showCode ? <Eye size={14}/> : <CodeXml size={14}/>}
        {showCode ? '预览' : '源码'}</button>}
    </div>
    <pre hidden={!showCode} spellCheck={false}><NodeViewContent<"code"> as="code"/></pre>
    {!showCode && figure && <div className="md-fence-preview" contentEditable={false}
      onClick={editHere}><Figure item={{ kind: figure, source: node.textContent }}/></div>}
  </NodeViewWrapper>
}

export const MarkdownFence = CodeBlock.extend({
  addAttributes() {
    return { ...this.parent?.(),
      fence: { default: '```', rendered: false },
      infoSuffix: { default: '', rendered: false },
      sourceKind: { default: 'fence', rendered: false },
    }
  },
  parseMarkdown(token, helpers) {
    const opener = fenceStart.exec((token.raw || '').split('\n', 1)[0])
    return helpers.createNode('codeBlock', {
      language: opener?.[2] || token.lang || null, fence: opener?.[1] || '```', infoSuffix: opener?.[3] || '',
    }, token.text ? [helpers.createTextNode(token.text)] : [])
  },
  renderMarkdown(node) {
    const text = (node.content || []).map(child => child.text || '').join('')
    const attrs = node.attrs || {}
    if (attrs.sourceKind === 'raw') return text
    if (attrs.sourceKind === 'math') return ['$$', text, '$$'].join('\n')
    let fence = String(attrs.fence || '```')
    const marker = fence[0]
    for (const match of text.matchAll(/^ {0,3}(`+|~+)[ \t]*$/gm)) {
      if (match[1][0] === marker && match[1].length >= fence.length) fence = marker.repeat(match[1].length + 1)
    }
    return [fence + (attrs.language || '') + (attrs.infoSuffix || ''), text, fence].join('\n')
  },
  addKeyboardShortcuts() {
    const inherited = this.parent?.()
    return { ...inherited, Enter: props => {
      const { $from, empty } = props.editor.state.selection
      if (empty && $from.parent.type.name === 'paragraph' && $from.parentOffset === $from.parent.content.size) {
        const match = fenceStart.exec($from.parent.textContent)
        if (match) return props.editor.chain().deleteRange({ from: $from.start(), to: $from.end() })
          .command(({ tr, state }) => {
            tr.setBlockType(tr.selection.from, tr.selection.to, state.schema.nodes.codeBlock,
              { fence: match[1], language: match[2] || null, infoSuffix: match[3] })
            return true
          }).run()
      }
      return inherited?.Enter?.(props) || false
    }}
  },
  addProseMirrorPlugins() { return [...(this.parent?.() || []), fenceHighlighting()] },
  addNodeView() { return ReactNodeViewRenderer(FenceView) },
}).configure({ enableTabIndentation: true, tabSize: 4 })
