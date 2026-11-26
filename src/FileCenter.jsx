import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, Clock3, File, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Plus, Presentation, RefreshCw, Search, Sheet, X } from 'lucide-react'
import { fileTypes } from './office-files.js'
import { Dialog, IconButton } from './workspace-ui.jsx'
import './file-center.css'

const icons = { docx: FileText, xlsx: Sheet, pptx: Presentation, md: FileText }
const parentOf = path => path.split('/').slice(0, -1).join('/')
const basename = path => path?.split(/[\\/]/).filter(Boolean).at(-1) || path
const messageOf = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
const dateFormat = new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })
const collator = new Intl.Collator('zh-CN', { numeric: true })

function sizeLabel(size) {
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / (1024 * 1024)).toFixed(1) + ' MB'
}

function PathBar({ root, path, navigate }) {
  const parts = path.split('/').filter(Boolean)
  return <nav className="files-path" aria-label="目录路径">
    <button title={root} onClick={() => navigate('')}><Folder size={15}/>{basename(root)}</button>
    {parts.map((part,i) => <React.Fragment key={i}><ChevronRight size={13}/><button onClick={() => navigate(parts.slice(0,i+1).join('/'))}>{part}</button></React.Fragment>)}
  </nav>
}

function MoveDialog({ api, root, source, onClose, submit }) {
  const [target, setTarget] = useState('')
  const [entries,setEntries] = useState([])
  const [error,setError] = useState('')
  const [pending,setPending] = useState(false)
  useEffect(() => {
    let active = true
    setEntries([]); setError('')
    api.list(target).then(rows => { if (active) setEntries(rows.filter(r => r.isDirectory && r.path !== source.path)) })
      .catch(e => { if (active) setError(messageOf(e)) })
    return () => { active = false }
  }, [target])
  async function move() {
    setPending(true)
    try { await submit(target); onClose() } catch (e) { setError(messageOf(e)) } finally { setPending(false) }
  }
  return <Dialog title="移动到文件夹" onClose={onClose}>
    <p className="files-hint">选择「{source.name}」的目标目录。</p>
    <PathBar root={root} path={target} navigate={setTarget}/>
    <div className="files-folders">{entries.map(e => <button key={e.path} onClick={() => setTarget(e.path)}><Folder size={16}/>{e.name}<ChevronRight size={14}/></button>)}</div>
    {error && <p role="alert" className="files-error">{error}</p>}
    <div className="files-dialog-actions"><button className="button" onClick={onClose}>取消</button>
      <button className="button primary" disabled={pending || target === parentOf(source.path)} onClick={move}>移到这里</button></div>
  </Dialog>
}

export function FileCenter({ files, onMutate, chooseNew, onChosen }) {
  const api = window.yanye.library
  const [root,setRoot] = useState(null)
  const [section,setSection] = useState(() => sessionStorage.getItem('files-section') === 'folder' ? 'folder' : 'recent')
  const [directory,setDirectory] = useState(() => sessionStorage.getItem('files-dir') || '')
  const [rows,setRows] = useState([])
  const [filter,setFilter] = useState('')
  const [sort,setSort] = useState('default')
  const [modal,setModal] = useState(null)
  const [name,setName] = useState('')
  const [message,setMessage] = useState('')
  const [modalError,setModalError] = useState('')
  const [pending,setPending] = useState(false)
  const [loading,setLoading] = useState(true)
  const [refresh,setRefresh] = useState(0)
  const alive = useRef(false)
  useEffect(() => { if (chooseNew) { setModal({type:'choose-type'}); onChosen() } }, [chooseNew])
  useEffect(() => { sessionStorage.setItem('files-section',section); sessionStorage.setItem('files-dir',directory) }, [section,directory])
  useEffect(() => { alive.current=true; return () => { alive.current=false } }, [])
  useEffect(() => {
    let active = true
    setLoading(true); setMessage(''); setRows([])
    async function load() {
      const state = await api.state()
      if (active) setRoot(state.root)
      const items = section === 'recent' ? await api.recent() : state.root ? await api.list(directory) : []
      if (active) setRows(items)
    }
    load().catch(e => { if (active) setMessage(messageOf(e)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [section,directory,refresh,files.epoch])

  function navigate(path) { setDirectory(path); setFilter(''); setModal(null) }
  function show(action, initial = '') { setName(initial); setModalError(''); setModal(action) }
  async function chooseRoot() {
    try {
      const state = await api.chooseRoot()
      if (state && alive.current) { setRoot(state.root); setSection('folder'); navigate(''); setRefresh(n=>n+1) }
    } catch (e) { setMessage(messageOf(e)) }
  }
  function openRow(row) {
    if (row.isDirectory) { navigate(row.path); return }
    if (!fileTypes[row.extension]) { setMessage('可以管理此文件。可直接编辑的格式为 DOCX、XLSX、PPTX 和 Markdown。'); return }
    files.openFile(() => section === 'recent' ? api.readRecent(row.id) : api.read(row.path)).catch(e => setMessage(messageOf(e)))
  }
  async function mutated() {
    setRefresh(n=>n+1)
    await onMutate()
  }
  async function submit(e) {
    e.preventDefault()
    if (pending || files.busy) return
    setPending(true); setModalError('')
    try {
      if (modal.type === 'create') {
        const done = await files.createFile(modal.ext,name,section === 'folder' && root ? directory : null)
        if (!done) return
      } else {
        if (modal.type === 'mkdir') await api.mkdir(directory,name)
        if (modal.type === 'rename') await api.rename(modal.row.path,name)
        if (modal.type === 'trash') await api.trash(modal.row.path)
        await mutated()
      }
      if (alive.current) setModal(null)
    } catch (error) { if (alive.current) setModalError(messageOf(error)) }
    finally { if (alive.current) setPending(false) }
  }
  const recent = section === 'recent'
  const visible = rows.filter(r => r.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  if (sort !== 'default' || !recent) visible.sort((a,b) => Number(Boolean(b.isDirectory))-Number(Boolean(a.isDirectory)) ||
    (sort === 'date' ? Date.parse(b.modifiedAt)-Date.parse(a.modifiedAt) : collator.compare(a.name,b.name)))
  const title = modal?.type === 'create' ? '新建' + fileTypes[modal.ext].label : {mkdir:'新建文件夹',rename:'重命名',trash:'移到系统回收站'}[modal?.type]

  return <section className="files-center" aria-label="文件中心">
    <div className="files-content">
      <header className="files-intro"><h1>文件中心</h1><button className="button primary" disabled={files.busy}
        onClick={() => files.openFile(() => api.chooseOpen()).catch(e => setMessage(messageOf(e)))}><FolderOpen size={16}/>打开本地文件</button></header>
      <div className="files-create" aria-label="新建办公文件">{Object.entries(fileTypes).map(([ext,type]) => {
        const Icon = icons[ext]
        return <button key={ext} className={'files-create-tile type-'+ext} aria-label={'新建'+type.label} disabled={files.busy}
          onClick={() => show({type:'create',ext},type.initialName)}>
          <span className="files-type-icon"><Icon size={23} strokeWidth={1.5}/></span>
          <span><strong>{type.label}</strong><small>.{ext}</small></span><Plus size={14}/></button>
      })}</div>
      <div className="files-tabs">
        <button aria-pressed={recent} onClick={() => {setSection('recent');setFilter('');setSort('default')}}><Clock3 size={16}/>最近文件</button>
        <button aria-pressed={!recent} onClick={() => {setSection('folder');setFilter('');setSort('default')}}><Folder size={16}/>本地文件夹</button>
      </div>
      <div className="files-controls">
        {!recent && root && <><IconButton label="上一级目录" icon={ArrowUp} disabled={!directory} onClick={() => navigate(parentOf(directory))}/><PathBar root={root} path={directory} navigate={navigate}/></>}
        {!recent && <button className="files-action" onClick={chooseRoot}><FolderOpen size={15}/>{root ? '更换目录' : '选择目录'}</button>}
        {!recent && root && <button className="files-action" onClick={() => show({type:'mkdir'})}><FolderPlus size={15}/>新建文件夹</button>}
        <span className="files-spacer"/>
        <label className="files-search"><Search size={14}/><input aria-label="筛选文件" placeholder="筛选文件名" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
        <select aria-label="文件排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="default">{recent ? '最近打开' : '按名称'}</option>{recent && <option value="name">按名称</option>}<option value="date">按时间</option></select>
        <IconButton label="刷新文件列表" icon={RefreshCw} size={15} onClick={() => setRefresh(n=>n+1)}/>
      </div>
      {message && <div className="files-feedback" role="alert">{message}<IconButton label="关闭提示" icon={X} size={14} onClick={() => setMessage('')}/></div>}
      <table className="files-table"><thead><tr><th>名称</th><th>{recent ? '位置' : '大小'}</th><th>时间</th>{!recent && <th aria-label="文件操作"/>}</tr></thead><tbody>
        {visible.map(row => {
          const Icon = row.isDirectory ? Folder : icons[row.extension] || File
          return <tr key={row.path || row.id}>
            <td><button className={'files-row type-'+row.extension} onClick={() => openRow(row)} disabled={files.busy} title={row.name}><Icon size={18}/><span>{row.name}</span></button></td>
            <td title={recent ? row.path : undefined}>{recent ? row.path : row.isDirectory ? '文件夹' : sizeLabel(row.size)}</td>
            <td>{row.modifiedAt && dateFormat.format(new Date(row.modifiedAt))}</td>
            {!recent && <td><IconButton icon={MoreHorizontal} size={16} label={row.name+' 的文件操作'} onClick={() => show({type:'actions',row})}/></td>}
          </tr>
        })}
      </tbody></table>
      {!visible.length && <p className="files-empty" role="status">{loading ? '正在读取文件…' : filter ? '没有匹配的文件。' : recent ? '新建或打开文件后，可以在这里继续编辑。' : root ? '此文件夹为空。使用上方的入口创建办公文件或文件夹。' : '选择要管理的本地文件夹。'}</p>}
    </div>
    {modal?.type === 'choose-type' && <Dialog title="新建办公文件" onClose={() => setModal(null)}>
      <div className="action-list">{Object.entries(fileTypes).map(([ext,type]) => {
        const Icon = icons[ext]
        return <button key={ext} onClick={()=>show({type:'create',ext},type.initialName)}><Icon size={16}/>{type.label}</button>
      })}</div></Dialog>}
    {modal?.type === 'actions' && <Dialog title={modal.row.name} onClose={() => setModal(null)}>
      <div className="action-list"><button onClick={() => show({type:'rename',row:modal.row},modal.row.name)}>重命名</button>
        <button onClick={() => show({type:'move',row:modal.row})}>移动到文件夹</button>
        <button className="danger-action" onClick={() => show({type:'trash',row:modal.row})}>移到系统回收站</button></div></Dialog>}
    {modal?.type === 'move' && <MoveDialog api={api} root={root} source={modal.row} onClose={() => setModal(null)}
      submit={async target => { await api.move(modal.row.path,target); await mutated() }}/>}
    {title && <Dialog key={modal.type} title={title} onClose={() => {if (!pending) setModal(null)}}>
      <form className="files-form" onSubmit={submit}>
        {modal.type === 'trash' ? <p>将「{modal.row.name}」移入 Windows 回收站{modal.row.isDirectory ? '，包含目录内的文件' : ''}。</p> :
          <label>{modal.type === 'mkdir' ? '文件夹名称' : '文件名称'}<input autoFocus required value={name} onFocus={e=>e.target.select()} onChange={e=>setName(e.target.value)}/></label>}
        {modal.type === 'create' && <p className="files-hint">{section === 'folder' && root ? '保存到 ' + root + (directory ? ' / ' + directory : '') : '创建时将打开 Windows 保存对话框。'}</p>}
        {modalError && <p className="files-error" role="alert">{modalError}</p>}
        <div className="files-dialog-actions"><button type="button" className="button" disabled={pending} onClick={() => setModal(null)}>取消</button>
          <button className="button primary" disabled={pending || (modal.type !== 'trash' && !name.trim())}>{modal.type === 'trash' ? '确认移入回收站' : modal.type === 'rename' ? '保存名称' : '创建'}</button></div>
      </form></Dialog>}
  </section>
}
