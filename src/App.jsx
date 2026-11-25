import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ChevronRight, CircleAlert, FolderTree, LayoutList, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import {
  addPage, ancestors, canMoveTo, indexPages, makePage, MAX_MARKDOWN_LENGTH, movePage, openPage, pageTitle,
  restorePage, setCollapsed, trashPage, updatePage, visiblePages,
} from '../shared/workspace.mjs'
import { DocumentEditor } from './editor.jsx'
import { Breadcrumbs, Dialog, EmptyWorkspace, IconButton, PageIcon, SearchDialog, Sidebar, TrashDialog } from './workspace-ui.jsx'

const desktop = window.yanye

function errorText(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
}

export function App() {
  const [workspace, setWorkspace] = useState(null)
  const [directory, setDirectory] = useState('')
  const [fatal, setFatal] = useState('')
  const [saveState, setSaveState] = useState({ state: 'saved' })
  const [modal, setModal] = useState(null)
  const [notice, setNotice] = useState('')
  const [focusTitle, setFocusTitle] = useState(null)
  const [navigationOpen, setNavigationOpen] = useState(true)
  const [contextOpen, setContextOpen] = useState(() => window.innerWidth >= 1050)
  const latest = useRef(null)
  const noticeTimer = useRef(null)

  const notify = useCallback(message => {
    clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = setTimeout(() => setNotice(''), 3800)
  }, [])

  const load = useCallback(async () => {
    setFatal('')
    try {
      const result = await desktop.load()
      latest.current = result.workspace
      setWorkspace(result.workspace)
      setDirectory(result.directory)
    } catch (error) {
      setFatal(errorText(error))
    }
  }, [])

  useEffect(() => {
    if (!desktop) return
    void load()
    const stopSaving = desktop.onSave(result => {
      if (result.state === 'error' || result.revision >= (latest.current?.revision ?? 0)) setSaveState(result)
    })
    const stopClosing = desktop.onCloseRequest(() => {
      desktop.finishClose(latest.current).catch(() => {})
    })
    return () => {
      stopSaving()
      stopClosing()
      clearTimeout(noticeTimer.current)
    }
  }, [load])

  const change = useCallback(transform => {
    const current = latest.current
    if (!current) return false
    const next = transform(current)
    if (next === current) return true
    const snapshot = { ...next, revision: current.revision + 1 }
    latest.current = snapshot
    setWorkspace(snapshot)
    setSaveState({ state: 'pending' })
    desktop.stage(snapshot)
    return true
  }, [])

  const create = useCallback((parentId = null) => {
    const page = makePage({ parentId })
    try {
      if (change(current => addPage(current, page))) {
        setModal(null)
        setFocusTitle({ id: page.id })
      }
    } catch (error) {
      notify(errorText(error))
    }
  }, [change, notify])

  const save = useCallback(async () => {
    if (!latest.current) return
    try {
      await desktop.save(latest.current)
    } catch (error) {
      setSaveState({ state: 'error', message: errorText(error) })
    }
  }, [])

  useEffect(() => {
    const shortcuts = event => {
      if (!latest.current || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (!['k', 'n', 's'].includes(key)) return
      event.preventDefault()
      if (key === 'k') setModal(current => current?.type === 'search' ? null : { type: 'search' })
      if (key === 'n') create()
      if (key === 's') void save()
    }
    window.addEventListener('keydown', shortcuts, true)
    return () => window.removeEventListener('keydown', shortcuts, true)
  }, [create, save])

  const allPages = workspace?.pages
  const byId = useMemo(() => indexPages(allPages ?? []), [allPages])
  const pages = useMemo(() => visiblePages(allPages ?? []), [allPages])
  const page = byId.get(workspace?.activeId)
  const modalPage = byId.get(modal?.id)

  function open(id) {
    change(current => openPage(current, id))
    setModal(null)
  }

  async function importMarkdown() {
    try {
      const source = await desktop.importMarkdown()
      if (!source) return
      change(current => addPage(current, makePage(source)))
      notify('已导入 Markdown')
    } catch (error) {
      notify(errorText(error))
    }
  }

  async function exportMarkdown(id) {
    const target = latest.current?.pages.find(candidate => candidate.id === id)
    if (!target) return
    setModal(null)
    try {
      if (await desktop.exportMarkdown(pageTitle(target), target.markdown)) notify('已导出 Markdown')
    } catch (error) {
      notify(errorText(error))
    }
  }

  function edit(id, fields) {
    if (fields.markdown?.length > MAX_MARKDOWN_LENGTH) {
      notify('页面已达到长度上限。')
      return false
    }
    return change(current => updatePage(current, id, fields))
  }

  function favorite(target) {
    edit(target.id, { favorite: !target.favorite })
  }

  const closeModal = () => setModal(null)
  const pageMenu = id => setModal({ type: 'page', id })
  const actions = {
    create, open, pageMenu, importMarkdown,
    collapse: (id, collapsed) => change(current => setCollapsed(current, id, collapsed)),
    search: () => setModal({ type: 'search' }),
    trash: () => setModal({ type: 'trash' }),
    openFolder: async () => {
      try {
        const error = await desktop.openFolder()
        if (error) notify(error)
      } catch (error) {
        notify(errorText(error))
      }
    },
  }

  if (!desktop || fatal || !workspace) return <div className="boot-screen">
    <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
    <h1>{fatal ? '无法打开工作区' : '砚页'}</h1>
    <p>{fatal || (desktop ? '正在打开工作区…' : '请启动砚页 Windows 应用。')}</p>
    {fatal && <button className="button primary" type="button" onClick={load}>重试</button>}
  </div>

  return <div className={`application ${navigationOpen ? '' : 'navigation-hidden'}`}>
    {navigationOpen && <Sidebar pages={pages} workspace={workspace} activeId={workspace.activeId} directory={directory} actions={actions} />}
    <main className="main-pane">
      <header className="window-bar">
        <IconButton className="window-control" icon={navigationOpen ? PanelLeftClose : PanelLeftOpen} label={navigationOpen ? '收起侧栏' : '显示侧栏'}
          onClick={() => setNavigationOpen(value => !value)} />
        <span className="bar-divider" />
        <Breadcrumbs page={page} byId={byId} onOpen={open} />
        <div className="window-drag-spacer" />
      </header>
      {page ? <DocumentEditor key={page.id} page={page} children={pages.filter(child => child.parentId === page.id)}
        focusTitle={focusTitle?.id === page.id ? focusTitle : null} saveState={saveState} onSave={save}
        contextOpen={contextOpen} onContextToggle={() => setContextOpen(value => !value)}
        onChange={fields => edit(page.id, fields)} onOpenPage={open} onCreateChild={() => create(page.id)}
        onFavorite={() => favorite(page)} onExport={() => exportMarkdown(page.id)} onMenu={() => pageMenu(page.id)}
        onExternalLink={href => desktop.openLink(href).catch(error => notify(errorText(error)))} />
        : <EmptyWorkspace onCreate={() => create()} />}
    </main>

    {modal?.type === 'search' && <SearchDialog pages={pages} byId={byId} onSelect={open} onClose={closeModal} />}
    {modal?.type === 'trash' && <TrashDialog pages={allPages} byId={byId} onClose={closeModal} onRestore={id => {
      change(current => restorePage(current, id)); closeModal(); notify('页面已恢复')
    }} />}
    {modal?.type === 'page' && modalPage && <Dialog key="page-actions" title="页面操作" onClose={closeModal}>
      <div className="action-title"><PageIcon page={modalPage} />{pageTitle(modalPage)}</div>
      <div className="action-list">
        <button type="button" onClick={() => create(modalPage.id)}><Plus size={17} />新建子页面</button>
        <button type="button" onClick={() => { open(modalPage.id); setFocusTitle({ id: modalPage.id }) }}><Pencil size={17} />重命名</button>
        <button type="button" onClick={() => { favorite(modalPage); closeModal() }}><Star size={17} />{modalPage.favorite ? '取消收藏' : '收藏页面'}</button>
        <button type="button" onClick={() => setModal({ type: 'move', id: modalPage.id })}><FolderTree size={17} />移动到</button>
        <button type="button" onClick={() => exportMarkdown(modalPage.id)}><ArrowDownToLine size={17} />导出 Markdown</button>
        <button type="button" className="danger-action" onClick={() => {
          change(current => trashPage(current, modalPage.id)); closeModal(); notify('页面已移到回收站')
        }}><Trash2 size={17} />移到回收站</button>
      </div>
    </Dialog>}
    {modal?.type === 'move' && modalPage && <Dialog key="move-page" title="移动页面" onClose={closeModal}>
      <div className="action-title"><PageIcon page={modalPage} />{pageTitle(modalPage)}</div>
      <div className="dialog-results">
        <button type="button" className="dialog-row" onClick={() => {
          change(current => movePage(current, modalPage.id, null)); closeModal(); notify('页面已移动')
        }}><LayoutList size={17} /><span>工作区根目录</span><ChevronRight size={14} /></button>
        {pages.filter(target => target.id !== modalPage.parentId && canMoveTo(modalPage, target.id, byId)).map(target => <button
          type="button" className="dialog-row" key={target.id} onClick={() => {
            change(current => movePage(current, modalPage.id, target.id)); closeModal(); notify('页面已移动')
          }}><PageIcon page={target} /><span><strong>{pageTitle(target)}</strong>
          <small>{ancestors(target, byId).map(pageTitle).join(' / ') || '工作区'}</small></span><ChevronRight size={14} /></button>)}
      </div>
    </Dialog>}
    {notice && <div className="notice" role="status"><CircleAlert size={16} aria-hidden="true" />{notice}</div>}
  </div>
}
