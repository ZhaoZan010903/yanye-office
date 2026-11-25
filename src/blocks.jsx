import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { exitSuggestion } from '@tiptap/suggestion'
import { AlignLeft, CodeXml, FilePlus2, Heading1, Heading2, List, ListOrdered, ListTodo, Minus, Quote, Table2 } from 'lucide-react'

export const blocks = [
  { id: 'text', title: '正文', icon: AlignLeft, keywords: 'text paragraph', apply: chain => chain.setParagraph() },
  { id: 'heading-1', title: '一级标题', icon: Heading1, keywords: 'h1 heading title', apply: chain => chain.setHeading({ level: 1 }) },
  { id: 'heading-2', title: '二级标题', icon: Heading2, keywords: 'h2 heading section', apply: chain => chain.setHeading({ level: 2 }) },
  { id: 'bullet', title: '无序列表', icon: List, keywords: 'bullet list', apply: chain => chain.toggleBulletList() },
  { id: 'ordered', title: '有序列表', icon: ListOrdered, keywords: 'number ordered list', apply: chain => chain.toggleOrderedList() },
  { id: 'todo', title: '待办清单', icon: ListTodo, keywords: 'todo task check checkbox', apply: chain => chain.toggleTaskList() },
  { id: 'quote', title: '引用', icon: Quote, keywords: 'quote blockquote', apply: chain => chain.toggleBlockquote() },
  { id: 'code', title: '代码块', icon: CodeXml, keywords: 'code pre', apply: chain => chain.toggleCodeBlock() },
  { id: 'table', title: '表格', icon: Table2, keywords: 'table grid', apply: chain => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { id: 'divider', title: '分隔线', icon: Minus, keywords: 'divider horizontal rule', apply: chain => chain.setHorizontalRule() },
  { id: 'page', title: '新建子页面', icon: FilePlus2, keywords: 'page child subpage', apply: null },
]

const key = new PluginKey('yanye-slash')

export function runBlock(editor, item, onChild, range) {
  const chain = editor.chain().focus()
  if (range) chain.deleteRange(range)
  if (item.apply) item.apply(chain).run()
  else if (chain.run()) onChild()
}

export function BlockChoices({ items = blocks, selected = -1, onSelect, onHover }) {
  return <div className="block-choices">
    <div className="block-menu-title">插入内容块</div>
    {!items.length && <div className="block-empty">没有匹配的块</div>}
    {items.map(({ icon: Icon, ...item }, index) => <button type="button" className={selected === index ? 'block-selected' : ''}
      key={item.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover?.(index)} onClick={() => onSelect(item)}>
      <span className="block-icon"><Icon size={16} aria-hidden="true" /></span><span>{item.title}</span>
      {selected === index && <kbd>↵</kbd>}
    </button>)}
  </div>
}

const SlashMenu = forwardRef(function SlashMenu({ items, command, query }, ref) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, Math.max(0, items.length - 1))
  useEffect(() => { setSelected(0) }, [query])

  useImperativeHandle(ref, () => ({
    onKey(event) {
      if (event.isComposing || !items.length) return false
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setSelected((index + direction + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        command(items[index])
        return true
      }
      return false
    },
  }))

  return <div className="slash-menu"><BlockChoices items={items} selected={index} onSelect={command} onHover={setSelected} /></div>
})

export function slashBlocks(onChild) {
  return Extension.create({
    name: 'slashBlocks',
    addProseMirrorPlugins() {
      const editor = this.editor
      return [Suggestion({
        editor,
        pluginKey: key,
        char: '/',
        startOfLine: true,
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: ({ query }) => {
          const search = query.toLowerCase().trim()
          return blocks.filter(item => `${item.title} ${item.keywords}`.includes(search))
        },
        command: ({ editor, range, props }) => runBlock(editor, props, onChild, range),
        placement: 'bottom-start',
        offset: { mainAxis: 8 },
        render: () => {
          let popup
          let unmount
          return {
            onStart(props) {
              popup = new ReactRenderer(SlashMenu, { props, editor })
              unmount = props.mount(popup.element)
            },
            onUpdate(props) { popup?.updateProps(props) },
            onKeyDown({ event }) {
              if (event.key === 'Escape') {
                exitSuggestion(editor.view, key)
                return true
              }
              return popup?.ref?.onKey(event) ?? false
            },
            onExit() {
              unmount?.()
              popup?.destroy()
            },
          }
        },
      })]
    },
  })
}
