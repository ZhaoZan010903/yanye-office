import React, { useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { ArrowDown, ArrowUp, Copy, FileDown, FileInput, ImagePlus, PanelTop, Play, Plus, Printer, Trash2, X } from 'lucide-react'
import { moveSlide, newSlide, readDeck, slideBoxes, slideLayouts, slidesFromDocument, slideThemes } from './slides-model.js'
import './slides.css'

function positioned({ x, y, w, h }) {
  return { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' }
}

function SlidePage({ slide, theme, edit, onImage }) {
  const boxes = slideBoxes(slide.layout)
  const fields = { title: '幻灯片标题', body: '幻灯片正文', side: '右栏正文' }
  const placeholders = { title: '输入标题', body: slide.layout === 'cover' ? '添加副标题' : '添加正文', side: '添加右栏正文' }
  return <div className="slides-page" style={{ '--slide-paper': '#' + theme.background, '--slide-ink': '#' + theme.ink }}>
    {Object.entries(boxes).map(([field, box]) => {
      const style = positioned(box)
      if (field === 'side' && slide.layout === 'image') {
        return <div key="image" className="slides-image-box" style={style}>
          {slide.image ? <img src={slide.image.data} alt={slide.image.name || '幻灯片插图'} /> :
            edit && <button type="button" onClick={onImage}><ImagePlus size={20} />插入本机图片</button>}
        </div>
      }
      const className = 'slides-text slides-' + field + (slide.layout === 'cover' ? ' cover' : '')
      return edit ? <textarea key={field} className={className} style={style} aria-label={fields[field]}
        placeholder={placeholders[field]} value={slide[field] || ''} onChange={e => edit({ [field]: e.target.value })} spellCheck={false} /> :
        <div key={field} className={className} style={style}>{slide[field]}</div>
    })}
  </div>
}

function IconAction({ label, icon: Icon, ...props }) {
  return <button type="button" className="slides-icon" title={label} aria-label={label} {...props}><Icon size={16} /></button>
}

export default function Slides({ value, onChange, onImport, onExport, onPrintPdf, sourcePages = [], title = '' }) {
  const deck = readDeck(value)
  const theme = slideThemes[deck.theme] || slideThemes.paper
  const [activeId, setActiveId] = useState(deck.slides[0].id)
  const index = Math.max(0, deck.slides.findIndex(s => s.id === activeId))
  const selected = deck.slides[index]
  const [playing, setPlaying] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [panel, setPanel] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleted, setDeleted] = useState(null)
  const root = useRef(null)
  const imageInput = useRef(null)
  const latest = useRef(deck)
  const alive = useRef(false)
  latest.current = deck
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const pages = sourcePages.filter(p => typeof p.markdown === 'string')
  const fileTitle = title.trim() || deck.slides[0].title.trim() || '演示文稿'

  async function printDeck() {
    await run(async () => {
      flushSync(() => setPrinting(true))
      try {
        await Promise.all([document.fonts.ready, ...[...document.querySelectorAll('.slides-print img')].map(img => img.decode())])
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (alive.current) await onPrintPdf(fileTitle + '.pdf')
      } finally {
        if (alive.current) setPrinting(false)
      }
    })
  }

  function save(next) {
    if (onChange(next) === false) { setError('无法保存此次更改，请检查工作区容量。'); return false }
    latest.current = next
    setError('')
    return true
  }
  function changeSlide(id, patch) {
    const current = latest.current
    return save({ ...current, slides: current.slides.map(s => s.id === id ? { ...s, ...patch } : s) })
  }
  function append(slides, importedTheme) {
    const current = latest.current
    const blank = current.slides.length === 1 && !['title', 'body', 'side', 'notes', 'image'].some(k => current.slides[0][k])
    const list = blank ? [] : current.slides
    const next = { ...current, slides: [...list, ...slides], theme: blank && importedTheme ? importedTheme : current.theme }
    if (save(next)) { setActiveId(slides[0].id); setPanel(''); setDeleted(null) }
  }
  function insert(duplicate) {
    const slide = newSlide(duplicate ? { ...selected, id: crypto.randomUUID() } : {})
    const slides = deck.slides.slice()
    slides.splice(index + 1, 0, slide)
    if (save({ ...deck, slides })) setActiveId(slide.id)
  }
  function remove() {
    const slides = deck.slides.filter(s => s.id !== selected.id)
    if (!slides.length) return
    if (save({ ...deck, slides })) {
      setDeleted({ slide: selected, index })
      setActiveId(slides[Math.min(index, slides.length - 1)].id)
    }
  }
  function undoRemoval() {
    if (!deleted) return
    const slides = deck.slides.slice()
    slides.splice(Math.min(slides.length, deleted.index), 0, deleted.slide)
    if (save({ ...deck, slides })) { setActiveId(deleted.slide.id); setDeleted(null) }
  }
  function show() {
    if (playing) return
    setPlaying(true)
    root.current?.focus()
    // The overlay also works on systems where a full-screen window is unavailable.
    root.current?.requestFullscreen?.().catch(() => {})
  }
  function endShow() {
    setPlaying(false)
    if (document.fullscreenElement === root.current) document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    const fullScreenChanged = () => { if (!document.fullscreenElement) setPlaying(false) }
    document.addEventListener('fullscreenchange', fullScreenChanged)
    return () => document.removeEventListener('fullscreenchange', fullScreenChanged)
  }, [])
  useEffect(() => {
    function onKey(e) {
      if (e.isComposing) return
      if (e.key === 'F5') { e.preventDefault(); show(); return }
      if (!playing) return
      const changes = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }
      let target = index
      if (e.key === 'Escape') endShow()
      else if (e.key === 'Home') target = 0
      else if (e.key === 'End') target = deck.slides.length - 1
      else if (e.key in changes) target += changes[e.key]
      else return
      e.preventDefault()
      const slide = deck.slides[Math.min(deck.slides.length - 1, Math.max(0, target))]
      setActiveId(slide.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [playing, index, deck.slides])

  async function run(work) {
    setBusy(true)
    setError('')
    try { await work() }
    catch (e) { if (alive.current) setError(e?.message || '文件操作失败。') }
    finally { if (alive.current) setBusy(false) }
  }
  function exportFile() {
    return run(async () => {
      const { exportPptx } = await import('./slides-pptx.js')
      const data = await exportPptx(deck, fileTitle)
      if (alive.current) await onExport(fileTitle + '.pptx', data)
    })
  }
  function importFile() {
    return run(async () => {
      const file = await onImport('pptx')
      if (!file || !alive.current) return
      const { importPptx } = await import('./slides-pptx.js')
      const imported = await importPptx(file.text)
      if (alive.current) append(imported.slides, imported.theme)
    })
  }
  async function setImage(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    const id = selected.id
    await run(async () => {
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('请选择 PNG 或 JPEG 图片。')
      const { loadImage } = await import('./slides-pptx.js')
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      const image = await loadImage(data, file.name)
      if (alive.current) changeSlide(id, { layout: 'image', image })
    })
  }

  return <section ref={root} tabIndex={-1} className={'slides-editor' + (playing ? ' is-playing' : '')} aria-label="演示文稿编辑器">
    {playing ? <div className="slides-show">
      <div className="slides-projector"><SlidePage slide={selected} theme={theme} /></div>
      <div className="slides-show-bar">
        <button type="button" disabled={!index} onClick={() => setActiveId(deck.slides[index - 1].id)}>上一页</button>
        <span aria-live="polite">{index + 1} / {deck.slides.length}</span>
        <button type="button" disabled={index + 1 === deck.slides.length} onClick={() => setActiveId(deck.slides[index + 1].id)}>下一页</button>
        <button type="button" onClick={endShow}>退出放映 <kbd>Esc</kbd></button>
      </div>
    </div> : <>
      <div className="slides-toolbar">
        <button type="button" onClick={() => insert(false)}><Plus size={16} />新建幻灯片</button>
        <label>版式<select aria-label="幻灯片版式" value={selected.layout} onChange={e => changeSlide(selected.id, { layout: e.target.value })}>
          {Object.entries(slideLayouts).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label>主题<select aria-label="演示主题" value={deck.theme} onChange={e => save({ ...deck, theme: e.target.value })}>
          {Object.entries(slideThemes).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
        </select></label>
        <button type="button" onClick={() => setPanel(panel === 'outline' ? '' : 'outline')} aria-expanded={panel === 'outline'}><PanelTop size={15} />文档大纲</button>
        <button type="button" onClick={() => setPanel(panel === 'import' ? '' : 'import')} aria-expanded={panel === 'import'}><FileInput size={15} />导入 PPTX</button>
        <button type="button" disabled={busy} onClick={exportFile}><FileDown size={15} />导出 PPTX</button>
        <button type="button" disabled={busy || !onPrintPdf} onClick={printDeck} title="将所有幻灯片导出为 PDF"><Printer size={15} />导出 PDF</button>
        <button type="button" className="slides-play" onClick={show} title="从当前页放映（F5）"><Play size={15} />放映</button>
      </div>
      {panel === 'outline' && <div className="slides-panel">
        {pages.length ? <><select aria-label="选择大纲文档" value={pages.some(p => p.id === sourceId) ? sourceId : pages[0].id} onChange={e => setSourceId(e.target.value)}>
          {pages.map(p => <option key={p.id} value={p.id}>{p.title || '未命名文档'}</option>)}
        </select><button type="button" onClick={() => append(slidesFromDocument(pages.find(p => p.id === sourceId) || pages[0]))}>按标题生成并追加</button></> : <span>工作区还没有可用的文档。</span>}
        <IconAction icon={X} label="关闭文档大纲" onClick={() => setPanel('')} />
      </div>}
      {panel === 'import' && <div className="slides-panel"><span>按原页序追加文字、备注和每页首张 PNG / JPEG，采用本地版式。复杂图形、动画和媒体会略过。</span>
        <button type="button" disabled={busy} onClick={importFile}>选择 PPTX 文件</button><IconAction icon={X} label="关闭导入" onClick={() => setPanel('')} /></div>}
      {error && <p className="slides-error" role="alert">{error}</p>}
      <div className="slides-layout">
        <aside className="slides-outline" aria-label="幻灯片列表">
          <div className="slides-list-actions">
            <IconAction icon={Copy} label="复制当前幻灯片" onClick={() => insert(true)} />
            <IconAction icon={ArrowUp} label="上移当前幻灯片" disabled={!index} onClick={() => save({ ...deck, slides: moveSlide(deck.slides, index, -1) })} />
            <IconAction icon={ArrowDown} label="下移当前幻灯片" disabled={index + 1 === deck.slides.length} onClick={() => save({ ...deck, slides: moveSlide(deck.slides, index, 1) })} />
            <IconAction icon={Trash2} label="删除当前幻灯片" disabled={deck.slides.length <= 1} onClick={remove} />
          </div>
          {deleted && <button className="slides-undo" type="button" onClick={undoRemoval}>撤销删除</button>}
          {deck.slides.map((s, i) => <button type="button" className="slides-thumbnail" key={s.id} aria-current={index === i ? 'page' : undefined}
            onClick={() => setActiveId(s.id)} aria-label={'第 ' + (i + 1) + ' 页 ' + (s.title || '未命名')}>
            <span className="slides-mini" style={{ color: '#' + theme.ink, background: '#' + theme.background }}>
              <strong>{s.title || '未命名幻灯片'}</strong><small>{s.body}</small>
            </span><span className="slides-number">{i + 1}</span>
          </button>)}
        </aside>
        <div className="slides-workarea">
          <div className="slides-canvas"><SlidePage theme={theme} slide={selected} edit={patch => changeSlide(selected.id, patch)} onImage={() => imageInput.current.click()} /></div>
          {selected.layout === 'image' && selected.image && <div className="slides-image-tools">
            <button type="button" onClick={() => imageInput.current.click()}>更换插图</button>
            <button type="button" onClick={() => changeSlide(selected.id, { image: null })}>移除插图</button>
          </div>}
          <input type="file" ref={imageInput} hidden accept="image/jpeg,image/png" aria-label="选择幻灯片插图" onChange={setImage} />
          <label className="slides-notes">演讲者备注<textarea aria-label="演讲者备注" placeholder="为当前页添加演讲提示…" value={selected.notes}
            onChange={e => changeSlide(selected.id, { notes: e.target.value })} /></label>
        </div>
      </div>
    </>}
    {printing && createPortal(<div className="slides-print" aria-hidden="true">
      <style>{`@media print {
        @page { size: 13.333333in 7.5in; margin: 0; }
        html, body { height: auto !important; overflow: visible !important; margin: 0; }
        body > :not(.slides-print) { display: none !important; }
        .slides-print { display: block !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .slides-print > .slides-page { break-inside: avoid; break-after: page; width: 100%; }
        .slides-print > .slides-page:last-child { break-after: auto; }
        .slides-print .slides-text { scrollbar-width: none; }
      }`}</style>
      {deck.slides.map(s => <SlidePage key={s.id} theme={theme} slide={s} />)}
    </div>, document.body)}
  </section>
}
