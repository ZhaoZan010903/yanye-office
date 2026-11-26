import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import {
  ArrowDownToLine, BookOpen, Bold, Check, ChevronRight, CircleAlert, CodeXml, Columns3, FilePlus2, Italic, List,
  ListTree, LoaderCircle, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, Redo2, Star, Undo2, X,
} from 'lucide-react'
import { MAX_MARKDOWN_LENGTH, MAX_TITLE_LENGTH, pageTitle } from '../shared/workspace.mjs'
import { blocks, BlockChoices, runBlock, slashBlocks } from './blocks.jsx'
import { describeDocument, describeSource, preferDiskSource } from './markdown.js'
import MarkdownFind from './MarkdownFind.jsx'
import { MarkdownFence } from './MarkdownFence'
import MarkdownFenceCompletion from './MarkdownFenceCompletion'
import { MarkdownFile, markdownImages, relativeReference } from './MarkdownImages'
import { MarkdownInlineMath } from './MarkdownInlineMath'
import { openReading, writeReading } from './markdown-projection'
import MarkdownContextTools from './menus/MarkdownContextTools.tsx'
import { editSource, editorSource } from './markdown-search.js'
import { IconButton, PageIcon } from './workspace-ui.jsx'
import './modules/writing-tools.css'

const MarkdownFigures=lazy(()=>import('./MarkdownFigures.jsx'))
const LargeMarkdownSource=lazy(()=>import('./LargeMarkdownSource.jsx'))
const focusBlock = active => Extension.create({
  name:'writingFocus',
  addProseMirrorPlugins() {
    return [new Plugin({props:{decorations(state) {
      if (!active()) return null
      const selection=state.selection.$from
      if (!selection.depth) return null
      return DecorationSet.create(state.doc,[Decoration.node(selection.before(1),selection.after(1),{class:'md-active-block'})])
    }}})]
  },
})

function SaveState({ state, onSave }) {
  if (state.state === 'error') return <button type="button" className="save-state save-error" title={state.message} onClick={onSave}>
    <CircleAlert size={14} />保存失败，点击重试
  </button>
  const pending = state.state === 'pending'
  const Icon = pending ? LoaderCircle : Check
  return <span className="save-state" aria-live="polite">
    <Icon size={14} className={pending ? 'spinning' : ''} />{pending ? '正在保存草稿' : state.label || '已保存到本机'}
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

function Toolbar({ editor, format, mode, setMode, contextOpen, onContextToggle, page, onFavorite, onExport, onMenu, onCreateChild, tools }) {
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

  const disabled = mode!=='read' || !editor
  const run = command => () => editor?.chain().focus()[command]().run()
  const isTable = !disabled && format?.table

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
        <select aria-label="段落级别" disabled={disabled} value={format?.heading ?? 0}
          onChange={e=>tools.heading(Number(e.target.value))}><option value={0}>正文</option>
          {[1,2,3,4,5,6].map(level=><option key={level} value={level}>标题 {level}</option>)}</select>
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
      <div className="menu-anchor">
        <button type="button" className="insert-button" aria-expanded={popup==='writing'} onClick={()=>setPopup(popup==='writing'?'':'writing')}>
          <BookOpen size={16}/><span>写作工具</span></button>
        {popup==='writing' && <div className="toolbar-menu md-tools-menu">
          {[
            ['查找','Ctrl F',()=>tools.find('find')], ['查找与替换','Ctrl H',()=>tools.find('replace')],
            ['专注模式','F8',tools.toggleFocus,tools.focus,disabled], ['打字机模式','F9',tools.toggleTypewriter,tools.typewriter,disabled],
            ['公式与图表预览','',tools.toggleFigures,tools.figures],
          ].map(([label,key,action,pressed,inactive])=><button key={label} disabled={inactive} aria-pressed={pressed}
            onClick={()=>{setPopup('');action()}}><span>{label}</span><kbd>{key}</kbd></button>)}
        </div>}
      </div>
    </div>
    <div className="toolbar-spacer" />
    <div className="tool-group page-tools" aria-label="页面工具">
      <div className="mode-switch" aria-label="编辑模式">
        <button type="button" aria-pressed={mode==='read'} title="在排版后的正文中直接编辑" onClick={() => { setPopup(''); setMode('read') }}>
          <BookOpen size={15} aria-hidden="true"/><span>阅读</span>
        </button>
        <button type="button" aria-pressed={mode==='source'} onClick={() => { setPopup(''); setMode('source') }}>
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
  onCreateChild, onFavorite, onExport, onMenu, onExternalLink, onOpenFileLink,
}) {
  const [largeDiskFile]=useState(()=>preferDiskSource(page))
  const [initialSource] = useState(() => largeDiskFile ? {headings:[],characters:0,completed:0,total:0,sourceOnly:false} : describeSource(page.markdown))
  const [mode, setMode] = useState(() => largeDiskFile ? 'source' : 'read')
  const parsedSource=useRef({raw:largeDiskFile?null:page.markdown,info:initialSource})
  const [largeOutline,setLargeOutline]=useState(initialSource)
  useEffect(()=>{
    if (!largeDiskFile || mode==='read' || parsedSource.current.raw===page.markdown) return
    const timer=setTimeout(()=>{
      const info=describeSource(page.markdown)
      parsedSource.current={raw:page.markdown,info}
      setLargeOutline(info)
    },350)
    return ()=>clearTimeout(timer)
  },[largeDiskFile,mode,page.markdown])
  const sourceInfo = useMemo(() => {
    if(mode==='read') return null
    if(largeDiskFile) return largeOutline
    if(parsedSource.current.raw!==page.markdown) parsedSource.current={raw:page.markdown,info:describeSource(page.markdown)}
    return parsedSource.current.info
  }, [mode, page.markdown,largeDiskFile,largeOutline])
  const [selectedHeading, setSelectedHeading] = useState(null)
  const [find,setFind]=useState(null), [figures,setFigures]=useState(false)
  const [focus,setFocus]=useState(false), [typewriter,setTypewriter]=useState(false)
  const [assetError,setAssetError]=useState('')
  const focusRef=useRef(false), scrollRef=useRef(null), rootRef=useRef(null)
  const titleInput = useRef(null)
  const sourceInput = useRef(null)
  const sourceSelection=useRef(null)
  const lastRichText = useRef(null)
  const projection = useRef(null)
  const projectionEditor = useRef(null)
  function openReference(href) {
    if (href.startsWith('#')) {
      let target = href.slice(1)
      try { target=decodeURIComponent(target) } catch { /* Use the literal fragment. */ }
      const duplicates = new Map()
      for (const heading of rootRef.current.querySelectorAll('.writing-area :is(h1,h2,h3,h4,h5,h6)')) {
        const text = heading.textContent.trim()
        const slug = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu,'').replace(/\s+/gu,'-')
        const n=duplicates.get(slug) ?? 0
        duplicates.set(slug,n+1)
        if (target===text || target===(n ? slug+'-'+n : slug)) {
          heading.scrollIntoView({block:'start'})
          return
        }
      }
      setAssetError('未找到文内标题 '+target)
    } else if (relativeReference(href)) {
      if (!page.disk || !onOpenFileLink) setAssetError('将文稿保存到磁盘后可打开相对链接。')
      else Promise.resolve(onOpenFileLink(href)).catch(error=>setAssetError(String(error?.message || error)))
    } else if (/^https?:/iu.test(href)) onExternalLink(href)
    else setAssetError('此链接使用了不支持的协议。')
  }
  const handlers = useRef(null)
  handlers.current = { onCreateChild, openReference, onChange, mode }

  const options = useMemo(() => ({
    // The desktop shell lazy-loads this view while launch files are arriving.
    // Construct the editor after commit so an abandoned Suspense render cannot
    // leave a destroyed instance for the layout effect to populate.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ codeBlock: false, trailingNode: false, underline: false, link: { openOnClick: false, HTMLAttributes: { title: 'Ctrl + 单击打开链接' } } }),
      MarkdownFence,
      MarkdownInlineMath,
      TaskList,
      TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `待办 ${node.textContent || '空白条目'}` } }),
      TableKit,
      markdownImages(() => handlers.current.mode === 'read', setAssetError),
      Placeholder.configure({ placeholder: '开始写作，或输入 / 插入内容块' }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      focusBlock(()=>focusRef.current),
      slashBlocks(() => handlers.current.onCreateChild()),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'writing-area', 'aria-label': '正文编辑器', 'aria-multiline': 'true', role: 'textbox' },
      handleClick: (_view, _pos, event) => {
        const anchor = event.target.closest?.('a[href]')
        if (!anchor) return false
        event.preventDefault()
        if (event.ctrlKey || event.metaKey) handlers.current.openReference(anchor.getAttribute('href'))
        return false
      },
    },
    onUpdate: ({ editor }) => {
      if (!projection.current) return
      const markdown = writeReading(editor, projection.current)
      if (handlers.current.onChange({ markdown })) lastRichText.current = markdown
      else projection.current = openReading(editor, lastRichText.current)
    },
  }), [])
  const editor = useEditor(options, [])

  const format = useEditorState({ editor, selector: ({ editor }) => editor ? ({
    undo: editor.can().undo(), redo: editor.can().redo(), bold: editor.isActive('bold'), italic: editor.isActive('italic'),
    heading: editor.getAttributes('heading').level ?? 0, list: editor.isActive('bulletList'), table: editor.isActive('table'),
  }) : null })

  const richDoc = useEditorState({ editor, selector: ({ editor }) => editor?.state.doc ?? null, equalityFn: Object.is })
  const info = useMemo(() => sourceInfo || (richDoc ? describeDocument(editor) : initialSource), [richDoc, editor, initialSource, sourceInfo])
  const currentHeading = info.headings.some(heading => heading.position === selectedHeading) ? selectedHeading : info.headings[0]?.position
  function toggleFocus() {
    focusRef.current=!focusRef.current
    setFocus(focusRef.current)
    if(editor) editor.view.dispatch(editor.state.tr.setMeta('writingView',true))
  }
  function heading(level) {
    const chain=editor?.chain().focus()
    if (chain) (level ? chain.setHeading({level}) : chain.setParagraph()).run()
  }
  function openFind(next) {
    setFind(next)
    if (find===next) {
      const query=rootRef.current?.querySelector('.md-find input')
      query?.focus()
      query?.select()
    }
  }
  function closeFind() {
    setFind(null)
    if (mode==='read') editor?.commands.focus()
    else sourceInput.current?.focus()
  }
  useEffect(()=>{
    if (!editor || !typewriter || mode!=='read') return
    let frame
    function center() {
      cancelAnimationFrame(frame)
      frame=requestAnimationFrame(()=>{
        if (!editor.isFocused || !scrollRef.current) return
        const box=scrollRef.current.getBoundingClientRect()
        const caret=editor.view.coordsAtPos(editor.state.selection.head)
        const distance=caret.top+((caret.bottom-caret.top)/2)-box.top-box.height/2
        if (Math.abs(distance)>3) scrollRef.current.scrollTop+=distance
      })
    }
    editor.on('transaction',center)
    editor.commands.focus()
    center()
    return ()=>{editor.off('transaction',center);cancelAnimationFrame(frame)}
  },[editor,typewriter,mode])
  function writingKey(e) {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.altKey) return
    const mod=e.ctrlKey || e.metaKey, key=e.key.toLowerCase()
    let action
    if (mod && key==='/') action=()=>switchMode(mode==='source' ? 'read' : 'source')
    else if (mod && (key==='f' || key==='h')) action=()=>openFind(key==='h'?'replace':'find')
    else if (!mod && key==='escape' && find) action=closeFind
    else if (!mod && key==='f8' && mode==='read') action=toggleFocus
    else if (!mod && key==='f9' && mode==='read') action=()=>setTypewriter(x=>!x)
    else if (mod && !e.shiftKey && /^[0-6]$/.test(key) && mode==='read') action=()=>heading(Number(key))
    if (action) {e.preventDefault();action()}
  }

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || mode !== 'read') return
    if (projectionEditor.current === editor && lastRichText.current === page.markdown) return
    projection.current = openReading(editor, page.markdown)
    lastRichText.current = page.markdown
    projectionEditor.current = editor
  }, [editor, mode, page.markdown])

  useEffect(() => {
    if (!focusTitle) return
    const frame = requestAnimationFrame(() => {
      titleInput.current?.focus()
      titleInput.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTitle])

  function switchMode(next) {
    if(next===mode) return
    if (next==='read' && !editor) return
    if (mode==='source' && sourceInput.current) {
      const text=sourceInput.current
      sourceSelection.current=text.selectedSource ? text.selectedSource() :
        {start:text.selectionStart,end:text.selectionEnd,direction:text.selectionDirection,scroll:text.scrollTop}
    }
    setSelectedHeading(null)
    setMode(next)
  }

  useLayoutEffect(()=>{
    const input=sourceInput.current, previous=sourceSelection.current
    if (mode!=='source' || !input || !previous) return
    const {start,end,direction,scroll}=previous
    if(input.selectSource) input.selectSource(start,end,direction,scroll)
    else {
      input.focus({preventScroll:true})
      input.setSelectionRange(start,end,direction)
      input.scrollTop=scroll
    }
  },[mode])

  function jumpTo(heading) {
    setSelectedHeading(heading.position)
    if (mode === 'source') {
      const input = sourceInput.current
      if (!input) return
      if(input.selectSource) {input.selectSource(heading.position,heading.position);return}
      input.focus()
      input.setSelectionRange(heading.position, heading.position)
      const lineHeight = parseFloat(getComputedStyle(input).lineHeight)
      input.scrollTop = Math.max(0, (heading.line - 2) * lineHeight)
    } else {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      editor?.view.nodeDOM(heading.position)?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' })
    }
  }

  return <section ref={rootRef} className={'document md-workspace'+(focus && mode==='read'?' md-focus':'')+(typewriter && mode==='read'?' md-typewriter':'')}
    aria-label="写作区" onKeyDownCapture={writingKey}>
    <Toolbar editor={editor} format={format} mode={mode} setMode={switchMode}
      contextOpen={contextOpen} onContextToggle={onContextToggle} page={page} onFavorite={onFavorite}
      onExport={onExport} onMenu={onMenu} onCreateChild={onCreateChild}
      tools={{heading,find:openFind,toggleFocus,focus,toggleTypewriter:()=>setTypewriter(v=>!v),typewriter,toggleFigures:()=>setFigures(v=>!v),figures}} />
    <MarkdownContextTools editor={editor} rootRef={rootRef} sourceRef={sourceInput} sourceMode={mode==='source'} onLink={openReference}/>
    {assetError && <div className="md-asset-error" role="alert"><span>{assetError}</span>
      <button type="button" onClick={()=>setAssetError('')} aria-label="关闭资源提示"><X size={14}/></button></div>}
    {mode === 'read' && <MarkdownFenceCompletion editor={editor}/>}
    {find && <MarkdownFind editor={editor} sourceRef={sourceInput} source={mode==='source'?editorSource(page.markdown):null}
      replacing={find==='replace'} close={closeFind}/>}
    {figures && <Suspense fallback={<p role="status">正在打开预览…</p>}><MarkdownFigures markdown={page.markdown} close={()=>setFigures(false)}/></Suspense>}
    <div className={`editor-layout ${contextOpen ? 'with-context' : ''}`}>
      <div className="document-scroll" ref={scrollRef}>
        <div className="document-sheet">
          <div className={`page-mark page-mark-${page.kind}`}><PageIcon page={page} size={25} /></div>
          <input ref={titleInput} spellCheck={false} className="document-title" aria-label="页面标题" value={page.title} readOnly={Boolean(page.disk)} title={page.disk ? '文件名称可在文件中心修改' : undefined}
            placeholder={pageTitle(page)} maxLength={MAX_TITLE_LENGTH} onChange={event => onChange({ title: event.target.value })}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              if (mode === 'source') sourceInput.current?.focus()
              else editor?.commands.focus('start')
            }} />
          <div className="document-rule" aria-hidden="true" />
          <div hidden={mode !== 'read'}><MarkdownFile.Provider value={page.disk?.id}><EditorContent editor={editor} /></MarkdownFile.Provider></div>
          {(mode === 'source' || largeDiskFile) && <div className="source-editor" hidden={mode!=='source'}>
            {largeDiskFile && <p className="source-note"><CodeXml size={15}/>大文档已打开源码。切换到阅读可在排版后的正文中编辑。</p>}
            {largeDiskFile ? <Suspense fallback={<p role="status">正在打开源码…</p>}>
              <LargeMarkdownSource ref={sourceInput} markdown={page.markdown} onChange={onChange} visible={mode==='source'}/>
            </Suspense> : <textarea ref={sourceInput} aria-label="Markdown 源码" value={editorSource(page.markdown)} maxLength={MAX_MARKDOWN_LENGTH}
              spellCheck={false} placeholder="在这里编写 Markdown…" onChange={event => onChange({ markdown:editSource(page.markdown,event.target.value) })} />}
          </div>}
        </div>
      </div>
      {contextOpen && <ContextPane info={info} selected={currentHeading} changeSelection={jumpTo} childPages={childPages}
        onOpenPage={onOpenPage} onCreateChild={onCreateChild} onClose={onContextToggle} />}
    </div>
    <footer className="status-bar">
      <SaveState state={saveState} onSave={onSave} />
      <div className="status-details"><span>{info.characters.toLocaleString('zh-CN')} 字符</span><span className="status-separator" />
        <span>{mode === 'source' ? 'Markdown 源码' : page.disk ? 'Markdown 阅读' : '电子文档 · 仅本机'}</span></div>
    </footer>
  </section>
}
