import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ChevronRight, CircleAlert, FolderOpen, FolderTree, LayoutList, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Save, Star, Trash2, X } from 'lucide-react'
import {
  addPage, ancestors, canMoveTo, indexPages, makePage, MAX_MARKDOWN_LENGTH, movePage, openPage, pageTitle,
  restorePage, setCollapsed, trashPage, updatePage, visiblePages, MAX_WORKSPACE_BYTES, officeKinds, workspaceBytes,
} from '../shared/workspace.mjs'
import { workspaceDelta } from '../shared/workspace-delta.mjs'
import { TextEncodingDialog } from './text-encoding-dialog.jsx'
import { OfficePage } from './office-page.jsx'
import OfficeFileBar from './office/OfficeFileBar.jsx'
import { FileCenter } from './FileCenter.jsx'
import { fileTitle, pageExtension } from './office-files.js'
import { useDiskFiles } from './use-disk-files.js'
import { conversionTargets } from '../shared/file-formats.mjs'
import { Breadcrumbs, Dialog, EmptyWorkspace, IconButton, PageIcon, SearchDialog, Sidebar, TrashDialog } from './workspace-ui.jsx'

const desktop = window.yanye
const DocumentEditor = lazy(() => import('./editor.jsx').then(module => ({ default: module.DocumentEditor })))
const workspaceKinds = { note: '电子文档', spreadsheet: '电子表格', presentation: '演示文稿', database: '多维表格', canvas: '流程图与白板' }

function errorText(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
}

function OfficeFileDetails({ disk }) {
  const [features,setFeatures] = useState([])
  useEffect(() => {
    if (!disk || conversionTargets[disk.extension]) return
    let active=true
    async function load() {
      const { inspectOriginal } = await import('./modules/office-original.js')
      const source = await desktop.library.readOfficeSource(disk.id,disk.revision)
      const found = await inspectOriginal(source,disk.extension)
      if (active) setFeatures(found)
    }
    load().catch(()=>{})
    return () => { active=false }
  },[disk?.id,disk?.revision])
  return features.length ? <p>原文件含有{features.join('、')}，可另存后在原应用中核对。</p> : null
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
  const [officeNavigation, setOfficeNavigation] = useState(() => localStorage.getItem('office-navigation') === 'open')
  const [tabToolsHost,setTabToolsHost] = useState(null)
  const [contextOpen, setContextOpen] = useState(() => window.innerWidth >= 1050)
  const [screen, setScreen] = useState(() => localStorage.getItem('office-screen') === 'editor' ? 'editor' : 'files')
  const [tabs,setTabs] = useState(() => {
    try { const ids = JSON.parse(localStorage.getItem('file-tabs')); return Array.isArray(ids) ? ids : [] }
    catch { return [] }
  })
  const [fileError,setFileError] = useState('')
  const [chooseNewFile,setChooseNewFile] = useState(false)
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
      desktop.finishClose().catch(error => setSaveState({ state: 'error', message: errorText(error) }))
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
    const delta = workspaceDelta(current, snapshot)
    if (workspaceBytes(snapshot) > MAX_WORKSPACE_BYTES) {
      notify('工作区已达到 24 MiB 上限，此次改动未写入。可以缩小图片或拆分导入内容。')
      return false
    }
    latest.current = snapshot
    setWorkspace(snapshot)
    setSaveState({ state: 'pending' })
    desktop.stage(delta)
    return true
  }, [notify])

  useEffect(() => { localStorage.setItem('office-screen',screen) }, [screen])
  useEffect(() => { localStorage.setItem('file-tabs',JSON.stringify(tabs)) }, [tabs])

  function reveal(id) {
    setScreen('editor')
    setModal(null)
    setFileError('')
    if (latest.current?.pages.find(p => p.id === id)?.disk) setTabs(ids => ids.includes(id) ? ids : [...ids,id])
  }
  const files = useDiskFiles({ latest, change, reveal, notify, prompt: setModal })
  const [launchEpoch, setLaunchEpoch] = useState(0)
  const lastLaunch = useRef(-1)
  const ready = Boolean(workspace)
  useEffect(() => desktop?.onLaunchFiles?.(() => setLaunchEpoch(n => n + 1)), [])
  useEffect(() => {
    if (!ready || files.busy || !desktop?.nextLaunchFile || lastLaunch.current === launchEpoch) return
    lastLaunch.current = launchEpoch
    void files.openLaunchFiles().catch(handleFileError)
  }, [ready, files.busy, launchEpoch])
  function home() { setScreen('files'); setModal(null); setFileError('') }
  function handleFileError(error) { setFileError(errorText(error)) }

  const create = useCallback((parentId = null, kind = 'note') => {
    const page = makePage({ parentId, kind, title: officeKinds[kind] ? '未命名' + officeKinds[kind] : '' })
    try {
      if (change(current => addPage(current, page))) {
        reveal(page.id)
        setFocusTitle({ id: page.id })
      }
    } catch (error) {
      notify(errorText(error))
    }
  }, [change, notify])

  const save = useCallback(async () => {
    if (!latest.current) return
    try {
      await desktop.save()
    } catch (error) {
      setSaveState({ state: 'error', message: errorText(error) })
    }
  }, [])

  useEffect(() => {
    const shortcuts = event => {
      if (!latest.current || !(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (!['k', 'n', 's', 'o'].includes(key) || (event.shiftKey && key !== 's')) return
      event.preventDefault()
      if (document.querySelector('dialog[open]') && key !== 'k') return
      if (key === 'k') setModal(current => current?.type === 'search' ? null : { type: 'search' })
      if (key === 'n') {
        const active = latest.current.pages.find(p=>p.id===latest.current.activeId)
        if (screen === 'files' || active?.disk || ['word','spreadsheet','presentation'].includes(active?.kind)) {
          home(); setChooseNewFile(true)
        } else setModal({ type: 'new', parentId: null })
      }
      if (key === 'o') files.openFile(() => desktop.library.chooseOpen()).catch(handleFileError)
      if (key === 's' && screen === 'editor') {
        const target = latest.current.pages.find(p=>p.id===latest.current.activeId)
        if (target && pageExtension(target) && (target.disk || event.shiftKey)) {
          files.saveFile(target.id,event.shiftKey).catch(handleFileError)
        } else void save()
      }
    }
    window.addEventListener('keydown', shortcuts, true)
    return () => window.removeEventListener('keydown', shortcuts, true)
  }, [files, save, screen])

  const allPages = workspace?.pages
  const byId = useMemo(() => indexPages(allPages ?? []), [allPages])
  const pages = useMemo(() => visiblePages(allPages ?? []), [allPages])
  const page = byId.get(workspace?.activeId)
  const modalPage = byId.get(modal?.id)

  function open(id) {
    change(current => openPage(current, id))
    reveal(id)
  }

  function closeTab(id, keepDraft = false) {
    if (!keepDraft && latest.current.pages.find(p=>p.id===id)?.disk?.dirty) { setModal({type:'close-tab',id}); return }
    if (keepDraft) change(ws => {
      const saved = ws.pages.find(p=>p.id===id)
      return saved?.disk?.dirty ? updatePage(ws,id,{disk:{...saved.disk,closeAcknowledged:true}}) : ws
    })
    setModal(null)
    const remaining = tabs.filter(item => item !== id && pages.some(p => p.id === item))
    setTabs(remaining)
    if (id === page?.id && screen === 'editor') {
      if (remaining.length) open(remaining.at(-1))
      else home()
    }
  }

  async function syncFileNames() {
    const requested = new Set(latest.current.pages.filter(p => p.disk).map(p => p.disk.id))
    const recent = await desktop.library.describe([...requested])
    const names = new Map(recent.map(file => [file.id, file]))
    change(ws => {
      let next = ws
      for (const p of ws.pages) {
        if (!p.disk || !requested.has(p.disk.id)) continue
        const file = names.get(p.disk?.id)
        if (!file) next = updatePage(next,p.id,{disk:null})
        else if (file.name !== p.disk.name) next = updatePage(next,p.id,{
          title:fileTitle(file.name,file.extension).slice(0,120), disk:{...p.disk,name:file.name} })
      }
      return next
    })
  }

  async function importMarkdown() {
    try {
      const source = await desktop.importMarkdown()
      if (!source) return
      const imported = makePage(source)
      if (change(current => addPage(current, imported))) { reveal(imported.id); notify('已导入 Markdown') }
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
    return change(current => {
      const target = current.pages.find(p => p.id === id)
      const edited = target?.disk && ['content','markdown'].some(key => Object.hasOwn(fields,key) && fields[key] !== target[key])
      return updatePage(current,id,edited && (!target.disk.dirty || target.disk.closeAcknowledged) ? { ...fields, disk:{...target.disk,dirty:true,closeAcknowledged:false} } : fields)
    })
  }

  function favorite(target) {
    edit(target.id, { favorite: !target.favorite })
  }

  const closeModal = () => setModal(null)
  const pageMenu = id => setModal({ type: 'page', id })
  const actions = {
    library: home, inLibrary: screen === 'files',
    create: (parentId = null) => setModal({ type: 'new', parentId }), open, pageMenu, importMarkdown,
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

  const diskState = page?.disk ? { ...saveState,label:page.disk.dirty ? '草稿已保存 · 文件有未写入的修改' : '文件已保存到磁盘' } : saveState
  const diskTabs = tabs.map(id => pages.find(p=>p.id===id && p.disk)).filter(Boolean)
  const ribbonWorkspace = screen === 'editor' && ['word','spreadsheet','presentation'].includes(page?.kind)
  const showSidebar = ribbonWorkspace ? officeNavigation : navigationOpen
  const fileControls = ribbonWorkspace && <OfficeFileBar disk={page.disk} busy={files.busy}
    navigationOpen={officeNavigation} toggleNavigation={() => {
      const next = !officeNavigation
      setOfficeNavigation(next)
      localStorage.setItem('office-navigation', next ? 'open' : 'closed')
    }} home={home} create={() => { home(); setChooseNewFile(true) }}
    open={() => files.openFile(() => desktop.library.chooseOpen()).catch(handleFileError)}
    save={() => page.disk ? files.saveFile(page.id).catch(handleFileError) : save()}
    saveAs={() => files.saveFile(page.id,true).catch(handleFileError)}/>
  return <div className={`application ${showSidebar ? '' : 'navigation-hidden'}`} data-office-workspace={ribbonWorkspace}>
    {showSidebar && <Sidebar pages={pages} workspace={workspace} activeId={screen === 'editor' ? workspace.activeId : null} directory={directory} actions={actions} />}
    <main className="main-pane">
      {!ribbonWorkspace && <header className="window-bar">
        <IconButton className="window-control" icon={navigationOpen ? PanelLeftClose : PanelLeftOpen} label={navigationOpen ? '收起侧栏' : '显示侧栏'}
          onClick={() => setNavigationOpen(value => !value)} />
        <span className="bar-divider" />
        {screen === 'files' ? <span className="breadcrumb-empty">本机 / 文件中心</span> : <>
          <IconButton label="返回文件中心" icon={FolderOpen} onClick={home}/><Breadcrumbs page={page} byId={byId} onOpen={open} />
          {pageExtension(page) && <div className="disk-actions">
            {page.disk && page.kind !== 'pdf' && <button disabled={files.busy} onClick={() => files.saveFile(page.id).catch(handleFileError)} title="保存到磁盘 (Ctrl+S)"><Save size={14}/>保存文件</button>}
            <button disabled={files.busy} onClick={() => files.saveFile(page.id,true).catch(handleFileError)} title="Ctrl+Shift+S">{page.disk ? '另存为' : '导出文件'}</button>
          </div>}</>}
        <div className="window-drag-spacer" />
      </header>}
      {diskTabs.length > 0 && <div className={ribbonWorkspace ? 'office-documents-row' : 'documents-row'}><nav className="disk-tabs" aria-label="打开的文件">{diskTabs.map(p =>
        <div className={'disk-tab type-'+p.disk.extension} key={p.id} aria-current={p.id===page?.id && screen==='editor' ? 'page' : undefined}>
          <button onClick={() => open(p.id)} title={p.disk.name}><PageIcon page={p} size={14}/><span>{p.disk.name}</span>{p.disk.dirty && <i className="disk-tab-dot" title="文件有未写入的修改"/>}</button>
          <button className="close-tab" aria-label={'关闭标签 '+p.disk.name} onClick={() => closeTab(p.id)}><X size={12}/></button>
        </div>)}</nav>{ribbonWorkspace && page.disk && <div className="office-document-tools" ref={setTabToolsHost}/>}</div>}
      {fileError && <div className="files-feedback" role="alert">{fileError}<IconButton icon={X} label="关闭文件错误" onClick={()=>setFileError('')}/></div>}
      {screen === 'files' ? <FileCenter files={files} onMutate={syncFileNames} chooseNew={chooseNewFile} onChosen={()=>setChooseNewFile(false)}/> : page && officeKinds[page.kind] ? <OfficePage key={page.id} page={page} pages={pages}
        fileControls={fileControls} tabToolsHost={page.disk && ribbonWorkspace ? tabToolsHost : null}
        focusTitle={focusTitle?.id === page.id ? focusTitle : null} saveState={diskState} onSave={save}
        onEdit={fields => edit(page.id, fields)} onMenu={() => pageMenu(page.id)} onFavorite={() => favorite(page)} />
        : page ? <Suspense fallback={<p role="status">正在打开电子文档…</p>}><DocumentEditor key={page.id} page={page} children={pages.filter(child => child.parentId === page.id)}
        focusTitle={focusTitle?.id === page.id ? focusTitle : null} saveState={diskState} onSave={save}
        contextOpen={contextOpen} onContextToggle={() => setContextOpen(value => !value)}
        onChange={fields => edit(page.id, fields)} onOpenPage={open} onCreateChild={() => create(page.id)}
        onFavorite={() => favorite(page)} onExport={() => exportMarkdown(page.id)} onMenu={() => pageMenu(page.id)}
        onOpenFileLink={page.disk && (href => files.openFile(() => desktop.library.markdownLink(page.disk.id, href)).catch(error => notify(errorText(error))))}
        onExternalLink={href => desktop.openLink(href).catch(error => notify(errorText(error)))} /></Suspense>
        : <EmptyWorkspace onCreate={() => actions.create()} />}
    </main>

    {modal?.type === 'close-tab' && <Dialog title="文件还有未写入的修改" onClose={closeModal}>
      <p>本机工作区保留了修改。在侧栏重新打开这份草稿后，仍可保存到文件。</p>
      <div className="files-dialog-actions"><button className="button" onClick={closeModal}>继续编辑</button>
        <button className="button" onClick={()=>closeTab(modal.id,true)}>保留草稿并关闭</button>
        <button className="button primary" onClick={async()=>{const id=modal.id;closeModal();try { if (await files.saveFile(id)) closeTab(id,true) } catch(e) { handleFileError(e) }}}>保存文件</button></div>
    </Dialog>}
    {modal?.type === 'confirm-write' && <Dialog title="保存到原 Office 文件" onClose={closeModal}>
      <OfficeFileDetails disk={byId.get(modal.id)?.disk}/>
      {conversionTargets[byId.get(modal.id)?.disk?.extension]
        ? <p>此格式由本地引擎转换。旧格式可能改变公式、母版或其他高级对象的表现。覆盖前会备份上一次的文件，也可以另存为现代 Office 格式。</p>
        : byId.get(modal.id)?.content?.preserved
        ? <p>砚页会在原工作簿上写入已改动的单元格，并标记重新计算。VBA 项目和其他对象保留原部件。覆盖前的文件保存在本地用户目录的 file-backups 中。</p>
        : <p>砚页会按支持的格式重新生成文件。修订、宏、复杂图形或特殊版式可能发生变化。覆盖前会在本地用户目录的 file-backups 中备份上一次的文件。</p>}
      <div className="files-dialog-actions"><button className="button" onClick={closeModal}>取消</button>
        <button className="button" onClick={() => {closeModal();files.saveFile(modal.id,true).catch(handleFileError)}}>另存副本</button>
        <button className="button primary" onClick={() => {closeModal();files.saveFile(modal.id,false,true).catch(handleFileError)}}>备份并保存原文件</button></div>
    </Dialog>}
    <TextEncodingDialog request={files.encodingRequest}/>
    {files.formatRequest && <Dialog title="另存为" onClose={()=>files.formatRequest.finish(null)}>
      <form className="files-form" onSubmit={e=>{e.preventDefault();files.formatRequest.finish(e.currentTarget.elements.format.value)}}>
        <label>文件格式<select name="format" autoFocus defaultValue={files.formatRequest.current}>
          {files.formatRequest.options.map(([ext,type])=><option key={ext} value={ext}>{type.label}（.{ext}）</option>)}
        </select></label>
        <div className="files-dialog-actions"><button className="button" type="button" onClick={()=>files.formatRequest.finish(null)}>取消</button>
          <button className="button primary" type="submit">选择保存位置</button></div>
      </form></Dialog>}
    {modal?.type === 'new' && <Dialog title="新建工作区文稿" onClose={closeModal}>
      <div className="action-list">{Object.entries(workspaceKinds).map(([kind, label]) =>
        <button type="button" key={kind} onClick={() => create(modal.parentId, kind)}><PageIcon page={{ kind }} />{label}</button>)}</div>
    </Dialog>}
    {modal?.type === 'search' && <SearchDialog pages={pages} byId={byId} onSelect={open} onClose={closeModal} />}
    {modal?.type === 'trash' && <TrashDialog pages={allPages} byId={byId} onClose={closeModal} onRestore={id => {
      change(current => restorePage(current, id)); reveal(id); notify('页面已恢复')
    }} />}
    {modal?.type === 'page' && modalPage && <Dialog key="page-actions" title="页面操作" onClose={closeModal}>
      <div className="action-title"><PageIcon page={modalPage} />{pageTitle(modalPage)}</div>
      <div className="action-list">
        <button type="button" onClick={() => actions.create(modalPage.id)}><Plus size={17} />新建子页面</button>
        {!modalPage.disk && <button type="button" onClick={() => { open(modalPage.id); setFocusTitle({ id: modalPage.id }) }}><Pencil size={17} />重命名</button>}
        <button type="button" onClick={() => { favorite(modalPage); closeModal() }}><Star size={17} />{modalPage.favorite ? '取消收藏' : '收藏页面'}</button>
        <button type="button" onClick={() => setModal({ type: 'move', id: modalPage.id })}><FolderTree size={17} />移动到</button>
        {modalPage.disk && <button type="button" onClick={async () => {
          closeModal()
          try { if (await desktop.library.exportBackup(modalPage.disk.id)) notify('已另存上次覆盖前的原件。') }
          catch (error) { handleFileError(error) }
        }}><ArrowDownToLine size={17}/>另存上次原件</button>}
        {!officeKinds[modalPage.kind] && <button type="button" onClick={() => exportMarkdown(modalPage.id)}><ArrowDownToLine size={17} />导出 Markdown</button>}
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
