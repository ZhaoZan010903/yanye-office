import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Archive, BookOpen, ChevronDown, ChevronRight, CirclePlus, File, FileText, FolderInput, FolderOpen,
  Inbox, Library, MoreHorizontal, NotebookPen, Plus, Search, Star, Trash2, X, Sheet, Database, Workflow, Presentation,
} from 'lucide-react'
import { ancestors, pageTitle } from '../shared/workspace.mjs'

const pageIcons = { desk: NotebookPen, journal: FileText, book: BookOpen, inbox: Inbox, collection: Library, note: File,
  word: FileText, spreadsheet: Sheet, database: Database, canvas: Workflow, presentation: Presentation }

export function PageIcon({ page, size = 16 }) {
  const Icon = pageIcons[page?.kind] ?? File
  return <Icon size={size} aria-hidden="true" />
}

export function IconButton({ icon: Icon, label, size = 17, className = '', title = label, ...props }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={title} {...props}>
    <Icon size={size} aria-hidden="true" />
  </button>
}

export function Brand() {
  return <div className="brand">
    <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
    <div><div className="brand-name">砚页</div><div className="brand-subtitle">个人工作区</div></div>
  </div>
}

export function Sidebar({ pages, workspace, activeId, directory, actions }) {
  const childrenById = useMemo(() => {
    const items = new Map()
    for (const page of pages) {
      const children = items.get(page.parentId) ?? []
      children.push(page)
      items.set(page.parentId, children)
    }
    return items
  }, [pages])
  const favorites = pages.filter(page => page.favorite)

  function renderPages(parentId = null, depth = 0) {
    return (childrenById.get(parentId) ?? []).map(page => {
      const name = pageTitle(page)
      const hasChildren = childrenById.has(page.id)
      const expanded = !workspace.collapsedIds.includes(page.id)
      return <div key={page.id}>
        <div
          className={`page-row ${page.id === activeId ? 'is-current' : ''}`}
          style={{ '--depth': Math.min(depth, 8) }}
          onContextMenu={event => { event.preventDefault(); actions.pageMenu(page.id) }}
        >
          {hasChildren ? <IconButton
            className="page-disclosure" icon={expanded ? ChevronDown : ChevronRight} size={13}
            label={`${expanded ? '折叠' : '展开'} ${name}`} aria-expanded={expanded}
            onClick={() => actions.collapse(page.id, expanded)}
          /> : <span className="page-disclosure-spacer" />}
          <button type="button" className="page-link" title={name} aria-current={page.id === activeId ? 'page' : undefined}
            onClick={() => actions.open(page.id)}>
            <PageIcon page={page} /><span>{name}</span>
          </button>
          <IconButton className="page-more" icon={MoreHorizontal} size={16} label={`${name} 的页面操作`} onClick={() => actions.pageMenu(page.id)} />
        </div>
        {hasChildren && expanded && renderPages(page.id, depth + 1)}
      </div>
    })
  }

  return <aside className="sidebar" aria-label="工作区导航">
    <Brand />
    <button type="button" className="sidebar-file-center" onClick={actions.library} aria-pressed={actions.inLibrary}>
      <FolderOpen size={17} /><span>文件中心</span>
    </button>
    <button type="button" className="sidebar-search" onClick={actions.search}>
      <Search size={17} aria-hidden="true" /><span>搜索工作区</span><kbd>Ctrl K</kbd>
    </button>
    <div className="sidebar-scroll">
      {favorites.length > 0 && <section className="nav-section" aria-label="收藏">
        <h2 className="nav-heading"><Star size={13} aria-hidden="true" />收藏</h2>
        {favorites.map(page => <button type="button" key={page.id} className={`favorite-link ${page.id === activeId ? 'is-current' : ''}`}
          title={pageTitle(page)} onClick={() => actions.open(page.id)}>
          <PageIcon page={page} size={15} /><span>{pageTitle(page)}</span>
        </button>)}
      </section>}
      <section className="nav-section pages-section" aria-label="页面">
        <div className="nav-heading-row">
          <h2 className="nav-heading">工作区文稿</h2>
          <IconButton className="sidebar-add" icon={Plus} size={16} label="新建页面" title="新建页面（Ctrl N）" onClick={() => actions.create()} />
        </div>
        {pages.length ? renderPages() : <button type="button" className="empty-tree" onClick={() => actions.create()}>创建第一页</button>}
      </section>
    </div>
    <div className="sidebar-bottom">
      <button type="button" className="sidebar-utility" onClick={actions.importMarkdown}><FolderInput size={16} />导入 Markdown</button>
      <button type="button" className="sidebar-utility" onClick={actions.trash}><Trash2 size={16} />回收站</button>
      <button type="button" className="location-button" title={directory} onClick={actions.openFolder}>
        <span className="location-indicator" /><span>本地工作区</span><FolderOpen size={14} aria-hidden="true" />
      </button>
    </div>
  </aside>
}

export function Breadcrumbs({ page, byId, onOpen }) {
  if (!page) return <span className="breadcrumb-empty">工作区</span>
  return <nav className="breadcrumbs" aria-label="页面路径">
    {ancestors(page, byId).map(parent => <React.Fragment key={parent.id}>
      <button type="button" onClick={() => onOpen(parent.id)} title={pageTitle(parent)}>{pageTitle(parent)}</button>
      <ChevronRight size={13} aria-hidden="true" />
    </React.Fragment>)}
    <span aria-current="page" title={pageTitle(page)}>{pageTitle(page)}</span>
  </nav>
}

export function Dialog({ title, onClose, children, className = '' }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return <dialog ref={dialogRef} className={`dialog ${className}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="dialog-surface">
      <header className="dialog-header"><h2 id={titleId}>{title}</h2><IconButton icon={X} label="关闭对话框" onClick={onClose} /></header>
      {children}
    </section>
  </dialog>
}

const searchIndices = new WeakMap()
function pageContents(page) {
  if (!page.content) return page.markdown.toLocaleLowerCase()
  if (!searchIndices.has(page.content)) {
    const terms = []
    function collect(value) {
      if (typeof value === 'string' && value.length <= 32767 && !value.startsWith('data:image/')) terms.push(value)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    collect(page.content)
    searchIndices.set(page.content, terms.join(' ').toLocaleLowerCase())
  }
  return searchIndices.get(page.content)
}

function searchPages(pages, query) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean)
  if (!terms.length) return [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12)

  return pages.map(page => {
    const title = pageTitle(page).toLocaleLowerCase()
    const body = pageContents(page)
    const score = terms.reduce((rank, term) => {
      if (rank < 0) return rank
      if (title.startsWith(term)) return rank + 5
      if (title.includes(term)) return rank + 3
      return body.includes(term) ? rank + 1 : -1
    }, 0)
    return { page, score }
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt))
    .slice(0, 30).map(item => item.page)
}

function pathLabel(page, byId) {
  const parts = ancestors(page, byId).map(pageTitle)
  return parts.length ? parts.join(' / ') : '工作区'
}

export function SearchDialog({ pages, byId, onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = useMemo(() => searchPages(pages, query), [pages, query])
  const current = Math.min(index, Math.max(0, results.length - 1))
  const resultId = useId()
  const inputRef = useRef(null)
  const activeRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [current])

  function handleKey(event) {
    if (event.nativeEvent.isComposing || !results.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const change = event.key === 'ArrowDown' ? 1 : -1
      setIndex((current + change + results.length) % results.length)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onSelect(results[current].id)
    }
  }

  return <Dialog title="搜索工作区" onClose={onClose} className="search-dialog">
    <label className="search-field"><Search size={20} aria-hidden="true" />
      <input ref={inputRef} aria-label="搜索标题或正文" placeholder="搜索标题或正文…" value={query}
        aria-controls={resultId} onChange={event => { setQuery(event.target.value); setIndex(0) }} onKeyDown={handleKey} />
    </label>
    <p className="dialog-list-label">{query.trim() ? `${results.length} 个匹配页面` : '最近页面'}</p>
    <div id={resultId} className="dialog-results">
      {!results.length && <div className="dialog-empty">没有匹配的页面</div>}
      {results.map((page, resultIndex) => <button type="button" className={`dialog-row ${resultIndex === current ? 'row-selected' : ''}`}
        key={page.id} ref={resultIndex === current ? activeRef : null} onMouseEnter={() => setIndex(resultIndex)}
        onClick={() => onSelect(page.id)}>
        <PageIcon page={page} size={18} /><span><strong>{pageTitle(page)}</strong><small>{pathLabel(page, byId)}</small></span>
        {resultIndex === current && <kbd>↵</kbd>}
      </button>)}
    </div>
    <div className="dialog-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
  </Dialog>
}

export function TrashDialog({ pages, byId, onRestore, onClose }) {
  const entries = pages.filter(page => page.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  return <Dialog title="回收站" onClose={onClose}>
    <div className="dialog-results trash-results">
      {!entries.length && <div className="dialog-empty"><Archive size={24} />回收站为空</div>}
      {entries.map(page => <div className="dialog-row" key={page.id}>
        <PageIcon page={page} /><span><strong>{pageTitle(page)}</strong><small>{pathLabel(page, byId)}</small></span>
        <button type="button" className="button small" onClick={() => onRestore(page.id)}>恢复</button>
      </div>)}
    </div>
  </Dialog>
}

export function EmptyWorkspace({ onCreate }) {
  return <div className="empty-workspace">
    <div className="empty-mark"><NotebookPen size={29} /></div>
    <h1>从一页开始</h1>
    <button type="button" className="button primary" onClick={onCreate}><CirclePlus size={18} />新建页面</button>
  </div>
}
