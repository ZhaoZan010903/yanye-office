import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, MoreHorizontal, Replace, Star } from 'lucide-react'
import { officeKinds, MAX_TITLE_LENGTH } from '../shared/workspace.mjs'
import { IconButton, PageIcon } from './workspace-ui.jsx'
import './office.css'

const OriginalReplaceDialog = lazy(() => import('./original-replace-dialog.jsx'))
const PreservedWorkbook = lazy(() => import('./modules/PreservedWorkbook.jsx'))
const formats = {word:'docx', spreadsheet:'xlsx', presentation:'pptx', pdf:'pdf', txt:'txt'}

const editors = {
  word: lazy(() => import('./modules/Word.jsx')),
  spreadsheet: lazy(() => import('./modules/Spreadsheet.jsx')),
  database: lazy(() => import('./modules/Database.jsx')),
  canvas: lazy(() => import('./modules/Canvas.jsx')),
  presentation: lazy(() => import('./modules/Slides.jsx')),
  txt: lazy(() => import('./modules/PlainText.jsx')),
  pdf: lazy(() => import('./modules/PdfReader.jsx')),
}

class OfficeContentBoundary extends React.Component {
  state = { failed: false, message: '' }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  exportContent = async () => {
    const { page } = this.props
    try {
      const saved = await window.yanye.exportFile((page.title || '页面') + '.json', JSON.stringify(page.content, null, 2))
      if (saved) this.setState({ message: '已导出本页原始数据。' })
    } catch (error) {
      this.setState({ message: error.message })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <section className="office-recovery" aria-label="页面读取失败">
      <h2>无法打开这页内容</h2>
      <p>可以导出本页原始数据以便恢复，也可以从侧栏继续打开其他页面。</p>
      <button type="button" className="button" onClick={this.exportContent}>导出本页原始数据</button>
      {this.state.message && <p role="status">{this.state.message}</p>}
    </section>
  }
}

export function OfficePage({ page, pages, focusTitle, saveState, onSave, onEdit, onMenu, onFavorite }) {
  const titleRef = useRef(null)
  const format = formats[page.kind]
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ribbon-collapsed-'+format) === 'true')
  useEffect(() => {
    if (!format) return
    localStorage.setItem('ribbon-collapsed-'+format, String(collapsed))
    function toggle(event) {
      if (event.ctrlKey && event.key === 'F1' && !document.querySelector('dialog[open]')) {
        event.preventDefault()
        setCollapsed(value => !value)
      }
    }
    window.addEventListener('keydown',toggle)
    return () => window.removeEventListener('keydown',toggle)
  },[format, collapsed])
  useEffect(() => {
    if (focusTitle) { titleRef.current?.focus(); titleRef.current?.select() }
  }, [focusTitle])
  const Editor = page.kind==='spreadsheet' && page.content?.preserved ? PreservedWorkbook : editors[page.kind]
  return <section className={'office-page type-'+(format || page.kind)} data-ribbon-hidden={collapsed} aria-label={officeKinds[page.kind]}>
    <header className="office-heading">
      <PageIcon page={page} size={24} />
      <input ref={titleRef} aria-label="页面标题" maxLength={MAX_TITLE_LENGTH} value={page.title} readOnly={Boolean(page.disk)} title={page.disk ? '文件名称可在文件中心修改' : undefined}
        placeholder="未命名页面" onChange={e => onEdit({ title: e.target.value })} />
      {['docx','xlsx','pptx'].includes(page.disk?.extension) && <button type="button" className="office-workspace-command" disabled={page.disk.dirty}
        title={page.disk.dirty ? '当前有未写入的修改。可在文件中心对磁盘原件操作。' : '在磁盘原件中查找并替换，保存独立副本'}
        onClick={() => setReplaceOpen(true)}><Replace size={15}/>保留版式替换</button>}
      {format && <IconButton icon={collapsed ? ChevronDown : ChevronUp} label={collapsed?'展开工具栏':'折叠工具栏'}
        aria-expanded={!collapsed} title={(collapsed?'展开':'折叠')+'工具栏（Ctrl+F1）'} onClick={()=>setCollapsed(!collapsed)}/>}
      <IconButton icon={Star} label={page.favorite ? '取消收藏' : '收藏页面'} onClick={onFavorite} aria-pressed={page.favorite} />
      <IconButton icon={MoreHorizontal} label="页面操作" onClick={onMenu} />
    </header>
    <div className="office-editor">
      <OfficeContentBoundary page={page}>
      <Suspense fallback={<p role="status">正在打开{officeKinds[page.kind]}…</p>}>
        <Editor value={page.content} title={page.title} disk={page.disk} onChange={content => onEdit({ content })}
          sourcePages={page.kind === 'presentation' ? pages.filter(item => !officeKinds[item.kind]) : undefined}
          onImport={window.yanye.importFile} onExport={window.yanye.exportFile} onPrintPdf={window.yanye.printPdf} />
      </Suspense>
      </OfficeContentBoundary>
    </div>
    {replaceOpen && <Suspense fallback={null}><OriginalReplaceDialog disk={page.disk} onClose={()=>setReplaceOpen(false)}/></Suspense>}
    <footer className="status-bar">
      {saveState.state === 'error'
        ? <button type="button" className="save-error" onClick={onSave} title={saveState.message}>保存失败，点击重试</button>
        : <span className="save-state" role="status"><Check size={13} />{saveState.state === 'pending' ? '正在保存草稿' : saveState.label || '已保存到本机'}</span>}
      <span>{officeKinds[page.kind]}</span>
    </footer>
  </section>
}
