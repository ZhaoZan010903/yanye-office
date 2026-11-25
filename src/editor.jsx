import React, { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import {
  ArrowDownToLine, Bold, Check, ChevronRight, CircleAlert, CodeXml, Columns3, FilePlus2, Heading2, Italic, List,
  ListTree, LoaderCircle, MoreHorizontal, PanelRightClose, PanelRightOpen, Pilcrow, Plus, Redo2, Star, Undo2, X,
} from 'lucide-react'
import { MAX_MARKDOWN_LENGTH, MAX_TITLE_LENGTH, pageTitle } from '../shared/workspace.mjs'
import { blocks, BlockChoices, runBlock, slashBlocks } from './blocks.jsx'
import { describeDocument, describeSource } from './markdown.js'
import { IconButton, PageIcon } from './workspace-ui.jsx'

function SaveState({ state, onSave }) {
  if (state.state === 'error') return <button type="button" className="save-state save-error" title={state.message} onClick={onSave}>
    <CircleAlert size={14} />保存失败，点击重试
  </button>
  const pending = state.state === 'pending'
  const Icon = pending ? LoaderCircle : Check
  return <span className="save-state" aria-live="polite">
    <Icon size={14} className={pending ? 'spinning' : ''} />{pending ? '正在保存' : '已保存'}
  </span>
}

function ContextPane({ info, selected, changeSelection, childPages, onOpenPage, onCreateChild, onClose }) {
  const { headings, completed, total } = info
  return <aside className="context-pane" aria-label="页面导航与进度">
    <div className="context-top">
      <span>页面导航</span>
      <IconButton className="context-close" size={16} icon={X} label="关闭页面导航" onClick={onClose} />
    </div>
    <section className="context-section">
      <h2><ListTree size={16} aria-hidden="true" />大纲</h2>
      {headings.length > 0 ? <ol className="outline-list">
        {headings.map(heading => <li key={heading.position}>
          <button type="button" className={heading.position === selected ? 'outline-active' : ''}
            aria-current={heading.position === selected ? 'location' : undefined}
            style={{ '--indent': Math.max(0, Math.min(heading.level - 2, 3)) }}
            title={heading.label} onClick={() => changeSelection(heading)}>{heading.label}</button>
        </li>)}
      </ol> : <p className="context-empty">添加标题后会生成大纲</p>}
    </section>
    <section className="context-section child-section">
      <div className="context-heading-row"><h2><FilePlus2 size={16} aria-hidden="true" />子页面</h2>
        <IconButton icon={Plus} label="新建子页面" size={15} onClick={onCreateChild} />
      </div>
      {childPages.length > 0 ? <div className="child-links">{childPages.map(page => <button type="button" key={page.id} title={pageTitle(page)} onClick={() => onOpenPage(page.id)}>
        <PageIcon page={page} size={15} /><span>{pageTitle(page)}</span><ChevronRight size={13} />
      </button>)}</div> : <button type="button" className="add-child" onClick={onCreateChild}>添加子页面</button>}
    </section>
    {total > 0 && <section className="progress-card" aria-label="本页待办进度">
      <div><h2>本页待办</h2><strong>{completed}<span> / {total}</span></strong></div>
      <progress value={completed} max={total} aria-label={`已完成 ${completed} 项，共 ${total} 项`} />
    </section>}
  </aside>
}

function Toolbar({ editor, format, sourceMode, setMode, sourceOnly, contextOpen, onContextToggle, page, onFavorite, onExport, onMenu, onCreateChild }) {
  const [popup, setPopup] = useState('')
  const controls = useRef(null)

  useEffect(() => {
    if (!popup) return
    const dismiss = event => { if (!controls.current?.contains(event.target)) setPopup('') }
    const escape = event => { if (event.key === 'Escape') setPopup('') }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', escape)
    }
  }, [popup])

  const disabled = sourceMode || !editor
  const run = command => () => editor?.chain().focus()[command]().run()
  const isTable = !sourceMode && format?.table

  return <div className="editor-toolbar">
    <div className="format-controls" ref={controls} aria-label="编辑工具">
      <div className="tool-group history-tools">
        <IconButton icon={Undo2} label="撤销" disabled={disabled || !format?.undo} onClick={run('undo')} />
        <IconButton icon={Redo2} label="重做" disabled={disabled || !format?.redo} onClick={run('redo')} />
      </div>
      <span className="tool-divider history-tools" />
      <div className="tool-group mark-tools">
        <IconButton icon={Bold} label="粗体" title="粗体（Ctrl B）" aria-pressed={format?.bold ?? false} disabled={disabled} onClick={run('toggleBold')} />
        <IconButton icon={Italic} label="斜体" title="斜体（Ctrl I）" aria-pressed={format?.italic ?? false} disabled={disabled} onClick={run('toggleItalic')} />
        <IconButton icon={Heading2} label="二级标题" aria-pressed={format?.heading ?? false} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <IconButton icon={List} label="无序列表" aria-pressed={format?.list ?? false} disabled={disabled} onClick={run('toggleBulletList')} />
      </div>
      <span className="tool-divider mark-tools" />
      <div className="menu-anchor">
        <button type="button" className="insert-button" title="插入内容块（在空行输入 /）" aria-expanded={popup === 'blocks' && !disabled}
          disabled={disabled} onClick={() => setPopup(popup === 'blocks' ? '' : 'blocks')}><Plus size={17} /><span>插入</span></button>
        {!disabled && popup === 'blocks' && <div className="toolbar-menu"><BlockChoices items={blocks} onSelect={item => {
          setPopup(''); runBlock(editor, item, onCreateChild)
        }} /></div>}
      </div>
      {isTable && <div className="menu-anchor">
        <IconButton icon={Columns3} label="表格操作" aria-expanded={popup === 'table'} onClick={() => setPopup(popup === 'table' ? '' : 'table')} />
        {popup === 'table' && <div className="toolbar-menu block-choices table-menu">
          {[['在下方插入行', 'addRowAfter'], ['在右侧插入列', 'addColumnAfter'], ['删除当前行', 'deleteRow'], ['删除当前列', 'deleteColumn'], ['删除表格', 'deleteTable']].map(([label, command]) =>
            <button type="button" key={command} onClick={() => { setPopup(''); run(command)() }}>{label}</button>)}
        </div>}
      </div>}
    </div>
    <div className="toolbar-spacer" />
    <div className="tool-group page-tools" aria-label="页面工具">
      <div className="mode-switch" aria-label="编辑模式">
        <button type="button" aria-pressed={!sourceMode} disabled={sourceOnly} onClick={() => { setPopup(''); setMode('rich') }}>
          <Pilcrow size={15} aria-hidden="true" /><span>富文本</span>
        </button>
        <button type="button" aria-pressed={sourceMode} onClick={() => { setPopup(''); setMode('source') }}>
          <CodeXml size={15} aria-hidden="true" /><span>源码</span>
        </button>
      </div>
      <span className="tool-divider page-tools-divider" />
      <IconButton icon={Star} className={page.favorite ? 'starred' : ''} label={page.favorite ? '取消收藏' : '收藏页面'} aria-pressed={page.favorite} onClick={onFavorite} />
      <button type="button" className="export-button" title="导出 Markdown" aria-label="导出 Markdown" onClick={onExport}><ArrowDownToLine size={16} /><span>导出</span></button>
      <IconButton icon={MoreHorizontal} label="页面操作" onClick={onMenu} />
      <IconButton className="context-toggle" icon={contextOpen ? PanelRightClose : PanelRightOpen} label={contextOpen ? '收起页面导航' : '显示页面导航'}
        aria-expanded={contextOpen} onClick={onContextToggle} />
    </div>
  </div>
}

export function DocumentEditor({
  page, children: childPages, focusTitle, saveState, onSave, contextOpen, onContextToggle, onChange, onOpenPage,
  onCreateChild, onFavorite, onExport, onMenu, onExternalLink,
}) {
  const sourceInfo = useMemo(() => describeSource(page.markdown), [page.markdown])
  const [mode, setMode] = useState(() => sourceInfo.sourceOnly ? 'source' : 'rich')
  const [selectedHeading, setSelectedHeading] = useState(null)
  const titleInput = useRef(null)
  const sourceInput = useRef(null)
  const lastRichText = useRef(sourceInfo.sourceOnly ? '' : page.markdown)
  const handlers = useRef({ onCreateChild, onExternalLink, onChange })
  handlers.current = { onCreateChild, onExternalLink, onChange }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, HTMLAttributes: { title: 'Ctrl + 单击打开链接' } } }),
      TaskList,
      TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `待办 ${node.textContent || '空白条目'}` } }),
      TableKit,
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: '开始写作，或输入 / 插入内容块' }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      slashBlocks(() => handlers.current.onCreateChild()),
    ],
    content: lastRichText.current,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'writing-area', 'aria-label': '正文编辑器', 'aria-multiline': 'true', role: 'textbox' },
      handleClick: (_view, _pos, event) => {
        const anchor = event.target.closest?.('a[href]')
        if (!anchor) return false
        event.preventDefault()
        if (event.ctrlKey || event.metaKey) handlers.current.onExternalLink(anchor.href)
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown()
      if (handlers.current.onChange({ markdown })) lastRichText.current = markdown
      else editor.commands.setContent(lastRichText.current, { contentType: 'markdown', emitUpdate: false })
    },
  }, [])

  const format = useEditorState({ editor, selector: ({ editor }) => editor ? ({
    undo: editor.can().undo(), redo: editor.can().redo(), bold: editor.isActive('bold'), italic: editor.isActive('italic'),
    heading: editor.isActive('heading', { level: 2 }), list: editor.isActive('bulletList'), table: editor.isActive('table'),
  }) : null })

  const info = useMemo(() => mode === 'source' || !editor ? sourceInfo : describeDocument(editor), [editor, mode, sourceInfo])
  const currentHeading = info.headings.some(heading => heading.position === selectedHeading) ? selectedHeading : info.headings[0]?.position

  useEffect(() => {
    if (!focusTitle) return
    const frame = requestAnimationFrame(() => {
      titleInput.current?.focus()
      titleInput.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTitle])

  function switchMode(next) {
    if (next === mode || (next === 'rich' && (sourceInfo.sourceOnly || !editor))) return
    if (next === 'rich' && lastRichText.current !== page.markdown) {
      editor.commands.setContent(page.markdown, { contentType: 'markdown', emitUpdate: false })
      lastRichText.current = page.markdown
    }
    setSelectedHeading(null)
    setMode(next)
  }

  function jumpTo(heading) {
    setSelectedHeading(heading.position)
    if (mode === 'source') {
      const input = sourceInput.current
      input.focus()
      input.setSelectionRange(heading.position, heading.position)
      const lineHeight = parseFloat(getComputedStyle(input).lineHeight)
      input.scrollTop = Math.max(0, (heading.line - 2) * lineHeight)
    } else {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      editor?.view.nodeDOM(heading.position)?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' })
    }
  }

  return <section className="document" aria-label="写作区">
    <Toolbar editor={editor} format={format} sourceMode={mode === 'source'} setMode={switchMode} sourceOnly={sourceInfo.sourceOnly}
      contextOpen={contextOpen} onContextToggle={onContextToggle} page={page} onFavorite={onFavorite}
      onExport={onExport} onMenu={onMenu} onCreateChild={onCreateChild} />
    <div className={`editor-layout ${contextOpen ? 'with-context' : ''}`}>
      <div className="document-scroll">
        <div className="document-sheet">
          <div className={`page-mark page-mark-${page.kind}`}><PageIcon page={page} size={25} /></div>
          <input ref={titleInput} spellCheck={false} className="document-title" aria-label="页面标题" value={page.title}
            placeholder={pageTitle(page)} maxLength={MAX_TITLE_LENGTH} onChange={event => onChange({ title: event.target.value })}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              if (mode === 'source') sourceInput.current?.focus()
              else editor?.commands.focus('start')
            }} />
          <div className="document-rule" aria-hidden="true" />
          <div hidden={mode !== 'rich'}><EditorContent editor={editor} /></div>
          {mode === 'source' && <div className="source-editor">
            {sourceInfo.sourceOnly && <p className="source-note"><CircleAlert size={15} />本文包含扩展语法，使用源码模式编辑可保留其原始格式。</p>}
            <textarea ref={sourceInput} aria-label="Markdown 源码" value={page.markdown} maxLength={MAX_MARKDOWN_LENGTH}
              spellCheck={false} placeholder="在这里编写 Markdown…" onChange={event => onChange({ markdown: event.target.value })} />
          </div>}
        </div>
      </div>
      {contextOpen && <ContextPane info={info} selected={currentHeading} changeSelection={jumpTo} childPages={childPages}
        onOpenPage={onOpenPage} onCreateChild={onCreateChild} onClose={onContextToggle} />}
    </div>
    <footer className="status-bar">
      <SaveState state={saveState} onSave={onSave} />
      <div className="status-details"><span>{info.characters.toLocaleString('zh-CN')} 字符</span><span className="status-separator" />
        <span>{mode === 'source' ? 'Markdown 源码' : 'Markdown'}</span></div>
    </footer>
  </section>
}
