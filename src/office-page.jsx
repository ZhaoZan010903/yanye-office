import React, { lazy, Suspense, useEffect, useRef } from 'react'
import { Check, MoreHorizontal, Star } from 'lucide-react'
import { officeKinds, MAX_TITLE_LENGTH } from '../shared/workspace.mjs'
import { IconButton, PageIcon } from './workspace-ui.jsx'
import './office.css'

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
  useEffect(() => {
    if (focusTitle) { titleRef.current?.focus(); titleRef.current?.select() }
  }, [focusTitle])
  const Editor = editors[page.kind]
  return <section className="office-page" aria-label={officeKinds[page.kind]}>
    <header className="office-heading">
      <PageIcon page={page} size={24} />
      <input ref={titleRef} aria-label="页面标题" maxLength={MAX_TITLE_LENGTH} value={page.title} readOnly={Boolean(page.disk)} title={page.disk ? '文件名称可在文件中心修改' : undefined}
        placeholder="未命名页面" onChange={e => onEdit({ title: e.target.value })} />
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
    <footer className="status-bar">
      {saveState.state === 'error'
        ? <button type="button" className="save-error" onClick={onSave} title={saveState.message}>保存失败，点击重试</button>
        : <span className="save-state" role="status"><Check size={13} />{saveState.state === 'pending' ? '正在保存草稿' : saveState.label || '已保存到本机'}</span>}
      <span>{officeKinds[page.kind]}</span>
    </footer>
  </section>
}
