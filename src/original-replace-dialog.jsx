import React, { useEffect, useRef, useState } from 'react'
import { Dialog } from './workspace-ui.jsx'
import { FileGlyph } from './file-glyph.jsx'
import { previewMatches, readTextParts, replaceInOriginal } from './modules/office-original.js'

const message = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')

export default function OriginalReplaceDialog({ disk, onClose, onSaved }) {
  const [source, setSource] = useState(null)
  const [term, setTerm] = useState('')
  const [replacement, setReplacement] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(null)
  const search = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const bytes = await window.yanye.library.readOfficeSource(disk.id, disk.revision)
      const parts = await readTextParts(bytes, disk.extension, controller.signal)
      if (!controller.signal.aborted) setSource({ bytes, parts })
    }
    load().catch(e => { if (!controller.signal.aborted) setError(message(e)) })
    return () => controller.abort()
  }, [disk.id, disk.revision, disk.extension])
  useEffect(() => { if (source) search.current?.focus() }, [source])

  async function save() {
    if (!preview?.count || busy || term === replacement) return
    setBusy(true)
    setError('')
    try {
      const result = await replaceInOriginal(source.bytes, disk.extension, source.parts, term, replacement)
      const file = await window.yanye.library.saveOfficeCopy(disk.id, disk.revision, result.bytes)
      if (file) { setSaved(file); onSaved?.(file) }
    } catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }

  return <Dialog title="保留版式替换" onClose={() => { if (!busy) onClose() }}>
    <div className="original-source"><FileGlyph extension={disk.extension} size={22}/><strong>{disk.name}</strong></div>
    {saved ? <><p role="status">已将 {preview.count} 处替换写入副本。</p><p className="original-path">{saved.path || saved.name}</p>
      <div className="files-dialog-actions"><button className="button primary" onClick={onClose}>完成</button></div></> :
      <form className="files-form original-form" onSubmit={event => {
        event.preventDefault()
        if (source && term) { setError(''); setPreview(previewMatches(source.parts, term)) }
      }}>
        <p>在磁盘原件中查找文字，保留模板中的图表、图片和版式，结果另存为新文件。</p>
        <label>查找文字<input ref={search} value={term} maxLength={4096} disabled={!source || busy} onChange={e => { setTerm(e.target.value); setPreview(null) }}/></label>
        <label>替换为<input value={replacement} maxLength={8192} disabled={!source || busy} placeholder="留空可删除匹配文字" onChange={e => setReplacement(e.target.value)}/></label>
        {preview && <div className="original-matches"><strong role="status">找到 {preview.count} 处</strong>
          {disk.extension === 'xlsx' && preview.count > 0 && <small>共享文字的所有引用单元格将一起更新。依赖这些文字的公式可在 Excel 或 WPS 中重新计算。</small>}
          <ul>{preview.matches.map((hit,i) => <li key={i}><small>{hit.part}</small><span>{hit.text}</span></li>)}</ul></div>}
        {!source && !error && <p role="status">正在读取原件…</p>}
        {busy && <p role="status">正在生成副本…</p>}
        {error && <p role="alert" className="files-error">{error}</p>}
        <div className="files-dialog-actions"><button type="submit" className="button" disabled={!source || !term || busy}>预览匹配</button>
          <button type="button" className="button primary" disabled={!preview?.count || term === replacement || busy} onClick={save}>保存替换副本</button></div>
      </form>}
  </Dialog>
}
