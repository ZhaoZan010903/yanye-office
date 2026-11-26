import React, { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { fenceStart } from './MarkdownFence'
import { languageSuggestions, loadLanguages } from './markdown-languages'

interface Prompt { from: number; to: number; marker: string; prefix: string; left: number; top: number; names: string[] }

export default function MarkdownFenceCompletion({ editor }: { editor: Editor | null }) {
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [selected, setSelected] = useState(-1)
  const selectedRef = useRef(-1)
  const dismissed = useRef('')
  const choose = (index: number) => { selectedRef.current = index; setSelected(index) }

  useEffect(() => {
    if (!editor) return
    let current: Prompt | null = null, loaded = false, alive = true
    const refresh = () => {
      if (!alive || editor.isDestroyed) return
      const { empty, $from } = editor.state.selection
      const match = empty && editor.isFocused && $from.parent.type.name === 'paragraph' &&
        $from.parentOffset === $from.parent.content.size && fenceStart.exec($from.parent.textContent)
      if (!match || match[3] || dismissed.current === $from.pos + ':' + $from.parent.textContent) {
        if (!match) dismissed.current = ''
        if (current) { current = null; setPrompt(null); choose(-1) }
        return
      }
      if (!loaded) {
        loaded = true
        loadLanguages().then(refresh).catch(() => {})
      }
      const rect = editor.view.coordsAtPos($from.pos)
      const names = languageSuggestions(match[2])
      if (current?.prefix !== match[2]) choose(-1)
      const height = Math.min(200, names.length * 26 + 8)
      current = { from: $from.start(), to: $from.end(), marker: match[1], prefix: match[2], names,
        left: Math.max(4, Math.min(rect.left, innerWidth - 168)),
        top: rect.bottom + height + 6 > innerHeight ? Math.max(4, rect.top - height - 4) : rect.bottom + 4 }
      setPrompt(names.length ? current : null)
    }
    const accept = (name: string) => {
      if (!current) return
      const { from, to, marker } = current
      editor.chain().focus().deleteRange({ from, to }).command(({ tr, state }) => {
        tr.setBlockType(tr.selection.from, tr.selection.to, state.schema.nodes.codeBlock, { fence: marker, language: name })
        return true
      }).run()
    }
    const keyboard = (e: KeyboardEvent) => {
      if (!current?.names.length || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || !editor.view.dom.contains(e.target as Node)) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const direction = e.key === 'ArrowDown' ? 1 : -1
        choose((selectedRef.current + direction + current.names.length) % current.names.length)
      } else if (e.key === 'Escape') {
        dismissed.current = editor.state.selection.head + ':' + editor.state.selection.$head.parent.textContent
        refresh()
      } else if (e.key === 'Tab' || (e.key === 'Enter' && selectedRef.current >= 0)) {
        accept(current.names[Math.max(0, selectedRef.current)])
      } else return
      e.preventDefault(); e.stopPropagation()
    }
    const click = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fence-completion]')
      if (el && current) accept(el.value)
    }
    editor.on('transaction', refresh); editor.on('focus', refresh); editor.on('blur', refresh)
    window.addEventListener('scroll', refresh, true); window.addEventListener('resize', refresh)
    window.addEventListener('keydown', keyboard, true); window.addEventListener('click', click)
    return () => {
      alive = false
      editor.off('transaction', refresh); editor.off('focus', refresh); editor.off('blur', refresh)
      window.removeEventListener('scroll', refresh, true); window.removeEventListener('resize', refresh)
      window.removeEventListener('keydown', keyboard, true); window.removeEventListener('click', click)
    }
  }, [editor])
  if (!prompt) return null
  return <div role="listbox" aria-label="围栏语言补全" className="md-fence-completion"
    style={{ left: prompt.left, top: prompt.top }}>
    {prompt.names.map((name, i) => <button role="option" aria-selected={selected === i} value={name}
      key={name} type="button" tabIndex={-1} data-fence-completion="" onMouseDown={e => e.preventDefault()}>{name}</button>)}
  </div>
}
