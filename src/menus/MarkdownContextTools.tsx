import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { selectedRect } from '@tiptap/pm/tables'
import { AlignLeft, AlignCenter, AlignRight, ChevronRight, Copy, ExternalLink, Link2, Table2, Trash2 } from 'lucide-react'
import { alignColumn, focusCell, resizeTable, tableSize, moveInTable } from './tableCommands'
import { copy, selectionCommands } from './selectionCommands'
import type { Choice } from './selectionCommands'
import './menus.css'

type Props = {
  editor: Editor | null
  rootRef: RefObject<HTMLElement | null>
  sourceRef: RefObject<{ focus(): void } | null>
  sourceMode: boolean
  onLink: (url: string) => void
}
type Anchor = { x: number, y: number, target: Element, source: boolean }
type Size = { rows: number, columns: number }
const surface = '.writing-area, .md-source-surface .cm-content'
const contextual = 'a[href],td,th'

export default function MarkdownContextTools({ editor, rootRef, sourceRef, sourceMode, onLink }: Props) {
  const [menu, setMenu] = useState<Anchor | null>(null)
  const [hover, setHover] = useState<Element | null>(null)
  const [page, setPage] = useState('')
  const [size, setSize] = useState<Size | null>(null)
  const [error, setError] = useState('')
  const popup = useRef<HTMLDivElement>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastTarget = useRef<Element | null>(null)
  const submenuTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function hideLater() {
    clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => {
      if (popup.current?.matches(':hover, :focus-within')) return
      const underPointer = rootRef.current?.querySelector('.writing-area :is(td,th,a[href]):hover')
      setHover(underPointer || null)
    },220)
  }
  function close() { clearTimeout(clearTimer.current); clearTimeout(submenuTimer.current); setMenu(null); setPage(''); setHover(null); setSize(null) }

  useEffect(() => {
    const root = rootRef.current
    if (!root || !editor) return
    function open(target: Element, x: number, y: number, keyboard = false) {
      if (!target.closest(surface)) return false
      if (!sourceMode && target.closest('input,textarea,select,button')) return false
      if (!sourceMode && !keyboard) {
        const result = editor!.view.posAtCoords({left:x, top:y})
        const sel = editor!.state.selection
        if (result && (sel.empty || result.pos < sel.from || result.pos > sel.to)) {
          editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.near(editor!.state.doc.resolve(result.pos))))
        }
      }
      clearTimeout(clearTimer.current)
      setHover(null); setSize(null); setError(''); setPage('')
      setMenu({x,y,target,source:sourceMode})
      return true
    }
    function context(event: MouseEvent) {
      if (event.target instanceof Element && open(event.target,event.clientX,event.clientY)) event.preventDefault()
    }
    function keys(event: KeyboardEvent) {
      const item = event.target
      if (!sourceMode && item instanceof Element && item.closest('.writing-area') && editor!.isActive('table') && (event.ctrlKey || event.metaKey)) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault(); event.stopPropagation(); editor!.commands.addRowAfter(); return
        }
        if (event.key === 'Backspace' && event.shiftKey) {
          event.preventDefault(); event.stopPropagation(); editor!.commands.deleteRow(); return
        }
      }
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
      const target = event.target
      if (!(target instanceof Element) || !target.closest(surface)) return
      let box: {left:number, bottom:number} = target.getBoundingClientRect()
      let cell: Element = target
      if (!sourceMode) {
        box = editor!.view.coordsAtPos(editor!.state.selection.head)
        const node = editor!.view.domAtPos(editor!.state.selection.head).node
        cell = node instanceof Element ? node : node.parentElement || target
      }
      if (open(cell,box.left,box.bottom,true)) event.preventDefault()
    }
    function track(event: Event) {
      const target = event.target
      if (!(target instanceof Element) || sourceMode) return
      const item = target.closest(contextual)
      if (target.closest('.writing-area') && item) {
        clearTimeout(clearTimer.current)
        setHover(item); lastTarget.current = item
      } else if (!target.closest('.md-popover')) delayHide()
    }
    const delayHide = hideLater
    function outside(event: PointerEvent) { if (!(event.target as Element)?.closest('.md-popover')) close() }
    function scrolled(event: Event) { if (!(event.target instanceof Element && event.target.closest('.md-popover'))) close() }
    function caretMoved() {
      if (!editor || sourceMode || !editor.isFocused) return
      const node = editor.view.domAtPos(editor.state.selection.head).node
      const element = node instanceof Element ? node : node.parentElement
      const cell = element?.closest('td,th')
      setHover(cell || null)
      if (cell) lastTarget.current = cell
    }
    editor.on('selectionUpdate',caretMoved)
    root.addEventListener('contextmenu',context)
    root.addEventListener('keydown',keys,true)
    root.addEventListener('pointerover',track)
    root.addEventListener('pointermove',track)
    root.addEventListener('focusin',track)
    root.addEventListener('pointerleave',delayHide)
    root.addEventListener('scroll',scrolled,true)
    document.addEventListener('pointerdown',outside)
    window.addEventListener('resize',close)
    return () => {
      clearTimeout(clearTimer.current); clearTimeout(submenuTimer.current)
      editor.off('selectionUpdate',caretMoved)
      root.removeEventListener('contextmenu',context); root.removeEventListener('keydown',keys,true)
      root.removeEventListener('pointermove',track); root.removeEventListener('pointerover',track); root.removeEventListener('focusin',track)
      root.removeEventListener('pointerleave',delayHide); root.removeEventListener('scroll',scrolled,true)
      document.removeEventListener('pointerdown',outside); window.removeEventListener('resize',close)
    }
  }, [editor,rootRef,sourceMode])
  useEffect(() => { close() }, [sourceMode,editor])
  useEffect(() => {
    if(!error) return
    const timer = setTimeout(() => setError(''), 4000)
    return () => clearTimeout(timer)
  },[error])
  useLayoutEffect(() => {
    const el = popup.current
    if (!el) return
    const target = hover?.closest('table') || hover
    const rect = target?.getBoundingClientRect()
    const x = menu?.x ?? rect?.left ?? 4
    const y = menu?.y ?? (rect ? rect.top - el.offsetHeight : 4)
    el.style.left = Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4)) + 'px'
    const mainHeight = menu ? (el.firstElementChild as HTMLElement).offsetHeight : el.offsetHeight
    const top = Math.max(4, Math.min(y, window.innerHeight - mainHeight - 4))
    el.style.top = top + 'px'
    const child = el.querySelector<HTMLElement>('.md-submenu')
    const owner = el.querySelector<HTMLElement>('[aria-expanded=true]')
    if (child && owner) {
      const offset = owner.getBoundingClientRect().top - top - 4
      child.style.marginTop = Math.max(4-top, Math.min(offset, window.innerHeight-top-child.offsetHeight-4))+'px'
    }
    if (menu) (page ? el.querySelector<HTMLButtonElement>('.md-submenu button:not(:disabled)') : el.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({preventScroll:true})
    if (size) el.querySelector('input')?.focus({preventScroll:true})
  },[menu,page,hover,Boolean(size)])

  if (!editor || (!menu && !hover && !size && !error)) return null
  const e = editor
  const target = menu?.target || hover || lastTarget.current
  const cell = target?.closest('td,th')
  const link = target?.closest('a[href]')
  const href = link?.getAttribute('href') || ''
  const fence = target?.closest('.md-fence')
  const language = fence?.querySelector<HTMLInputElement>('input[role="combobox"]')
  const preview = fence?.querySelector<HTMLButtonElement>('button[aria-label="编辑此块源码"],button[aria-label="预览此块"]')
  const picture = target?.closest('img')

  const editing = menu ? selectionCommands(e,menu.source,menu.target) : null
  function tableAction(command: () => unknown) {
    if (cell && focusCell(e,cell)) return command()
  }
  const rect = cell && e.isActive('table') ? selectedRect(e.state) : null
  const tableItems: Choice[] = [
    {label:'上方插入行',action:()=>e.commands.addRowBefore()},
    {label:'下方插入行',action:()=>e.commands.addRowAfter()},
    {label:'左侧插入列',action:()=>e.commands.addColumnBefore()},
    {label:'右侧插入列',action:()=>e.commands.addColumnAfter()},
    {label:'上移该行',disabled:!rect || rect.top<=1,action:()=>moveInTable(e,'row',-1)},
    {label:'下移该行',disabled:!rect || rect.top===0 || rect.bottom>=rect.map.height,action:()=>moveInTable(e,'row',1)},
    {label:'左移该列',disabled:!rect || rect.left===0,action:()=>moveInTable(e,'column',-1)},
    {label:'右移该列',disabled:!rect || rect.right>=rect.map.width,action:()=>moveInTable(e,'column',1)},
    {label:'复制表格',action:()=>copy(e.markdown?.serialize(selectedRect(e.state).table.toJSON()) || '')},
    {label:'删除行',action:()=>e.commands.deleteRow()},
    {label:'删除列',action:()=>e.commands.deleteColumn()},
    {label:'删除表格',action:()=>e.commands.deleteTable()},
  ].map(item=>({...item,action:()=>tableAction(item.action)}))
  const choices = editing?.choices || []
  if (menu && !menu.source) {
    if (fence) {
      choices.push({label:'复制代码',action:()=>copy(fence.querySelector('pre code, [data-node-view-content]')?.textContent || '')})
      if (language) choices.push({label:'更改代码语言',action:()=>language.focus()})
      if (preview) choices.push({label:preview.getAttribute('aria-label')!,action:()=>preview.click()})
    }
    if (picture) {
      const name = picture.getAttribute('alt')
      if (name) choices.push({label:'复制图片说明',action:()=>copy(name)})
    }
    if (cell) choices.push({label:'表格',items:tableItems})
    if (link) choices.push({label:'打开链接',action:()=>onLink(href)},{label:'复制链接地址',action:()=>copy(href)})
    choices.push({label:'段落',items:[
      {label:'正文',action:()=>e.commands.setParagraph()},
      ...([1,2,3,4,5,6] as const).map(level=>({label:'标题 '+level,action:()=>e.commands.setHeading({level})})),
      {label:'引用',action:()=>e.commands.toggleBlockquote()},
      {label:'代码块',action:()=>e.commands.toggleCodeBlock()},
      {label:'插入表格',action:()=>e.commands.insertTable({rows:3,cols:3,withHeaderRow:true})},
    ]},{label:'格式',items:[
      {label:'加粗',action:()=>e.commands.toggleBold()},{label:'斜体',action:()=>e.commands.toggleItalic()},
      {label:'删除线',action:()=>e.commands.toggleStrike()},{label:'行内代码',action:()=>e.commands.toggleCode()},
    ]})
  }
  if (editing) choices.push(editing.selectAll)
  function run(action: () => unknown) {
    if (menu?.source) sourceRef.current?.focus()
    else e.view.focus()
    close()
    try { Promise.resolve(action()).catch(failed) } catch (reason) { failed(reason) }
  }
  function failed(reason: unknown) { setError(reason instanceof Error ? reason.message : '操作未完成') }
  function handleKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    const list = (event.target as Element).closest('[role=menu]') || event.currentTarget
    const enabled = [...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement)
    switch(event.key) {
      case 'Escape': case 'ArrowLeft':
        if (page) setPage('')
        else { close(); if(menu?.source) sourceRef.current?.focus(); else e.view.focus() }
        break
      case 'ArrowDown': enabled[(index+1)%enabled.length]?.focus(); break
      case 'ArrowUp': enabled[(index-1+enabled.length)%enabled.length]?.focus(); break
      case 'ArrowRight':
        if (enabled[index]?.hasAttribute('aria-haspopup')) enabled[index].click()
        break
      case 'Home': enabled[0]?.focus(); break
      case 'End': enabled.at(-1)?.focus(); break
      case 'Tab': close(); return
      default: return
    }
    event.preventDefault(); event.stopPropagation()
  }
  const items = choices.find(choice=>choice.label===page)?.items
  function menuItems(list: Choice[], nested=false) {
    return list.map(item=><button type="button" role="menuitem" key={item.label} disabled={item.disabled}
      aria-haspopup={item.items ? 'menu' : undefined} aria-expanded={item.items ? item.label===page : undefined}
      onMouseDown={ev=>ev.preventDefault()} onPointerEnter={ev=>{
        clearTimeout(submenuTimer.current)
        if (!nested && ev.pointerType==='mouse') submenuTimer.current = setTimeout(()=>setPage(item.items ? item.label : ''), 150)
      }} onClick={()=>{clearTimeout(submenuTimer.current); if(item.items) setPage(item.label); else run(item.action!)}}>
      <span>{item.label}</span>{item.keys && <kbd>{item.keys}</kbd>}{item.items && <ChevronRight size={13}/>}
    </button>)
  }
  return createPortal(<>
    {menu ? <div className="md-popover md-context-wrap" ref={popup} onKeyDown={handleKeys}>
      <div className="md-context" role="menu" aria-label="Markdown 编辑菜单">{menuItems(choices)}</div>
      {items && <div className="md-context md-submenu" role="menu" aria-label={page}>{menuItems(items,true)}</div>}
    </div> : !sourceMode && (hover || size) && (cell || link) ? <div ref={popup} className="md-popover md-hover" role="toolbar" aria-label={cell?'表格浮动工具':'链接浮动工具'}
      onMouseDown={ev=>{if(!(ev.target instanceof HTMLInputElement)) ev.preventDefault()}}
      onPointerEnter={()=>clearTimeout(clearTimer.current)}
      onPointerLeave={()=>{if(!size) hideLater()}}
      onKeyDown={ev=>{if(ev.key==='Escape'){close(); e.view.focus()}}}>
      {cell && !size && <>
        <button title="调整表格" aria-label="调整表格" onClick={()=>tableAction(()=>setSize(tableSize(e)))}><Table2/></button>
        {([[AlignLeft,'左对齐','left'],[AlignCenter,'居中对齐','center'],[AlignRight,'右对齐','right']] as const).map(([Icon,label,value])=>
          <button key={value} aria-label={label} title={label} onClick={()=>run(()=>tableAction(()=>alignColumn(e,value)))}><Icon/></button>)}
        <button title="删除表格" aria-label="删除表格" onClick={()=>run(()=>tableAction(()=>e.commands.deleteTable()))}><Trash2/></button>
      </>}
      {cell && size && <form onSubmit={ev=>{ev.preventDefault();run(()=>tableAction(()=>resizeTable(e,size.rows,size.columns)))}}>
        <label>行 <input type="number" min="1" max="100" required value={size.rows || ''} onChange={ev=>setSize({...size,rows:ev.target.valueAsNumber||0})}/></label>
        <label>列 <input type="number" min="1" max="40" required value={size.columns || ''} onChange={ev=>setSize({...size,columns:ev.target.valueAsNumber||0})}/></label>
        <button type="submit">应用</button><button type="button" onClick={close}>取消</button></form>}
      {link && !cell && <><Link2 size={14}/><span className="md-link-url" title={href}>{href}</span>
        <button title="打开链接" aria-label="打开链接" onClick={()=>run(()=>onLink(href))}><ExternalLink/></button>
        <button title="复制链接地址" aria-label="复制链接地址" onClick={()=>run(()=>copy(href))}><Copy/></button></>}
    </div> : null}
    {error && <div className="md-command-error" role="alert">{error}</div>}
  </>,document.body)
}
