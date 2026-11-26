import Ribbon, { RibbonGroup } from '../office/Ribbon'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Highlighter, MessageSquarePlus, RotateCcw, RotateCw, Trash2, Undo2 } from 'lucide-react'
import { appendPdfBytes, extractPdfBytes, initialPdfPages, movePdfPage, parsePdfPageRange } from './pdf-edits.js'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './readers.css'

GlobalWorkerOptions.workerSrc = workerUrl
const resourceRoot = new URL(import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : './assets/pdf-resources/', document.baseURI).href
const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
const normalize = value => value.normalize('NFKC').toLocaleLowerCase()

function PageImage({ doc, number, zoom = 1, small = false, rotation = 0, viewportRef, notes, highlights, showNotes }) {
  const host = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const container = host.current
    let active = true, renderer, textLayer
    setError('')
    container.replaceChildren()
    async function paint() {
      const page = await doc.getPage(number)
      if (!active) return
      const angle = (page.rotate + rotation) % 360
      const base = page.getViewport({scale:1,rotation:angle})
      const viewport = page.getViewport({scale:small ? 86/base.width : zoom*96/72,rotation:angle})
      const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000/(viewport.width*viewport.height)), 8192/Math.max(viewport.width,viewport.height))
      const canvas = document.createElement('canvas')
      canvas.dataset.page = String(number)
      canvas.width = Math.max(1, Math.ceil(viewport.width*density))
      canvas.height = Math.max(1, Math.ceil(viewport.height*density))
      canvas.style.width = viewport.width+'px'
      canvas.style.height = viewport.height+'px'
      container.append(canvas)
      if (viewportRef) viewportRef.current = {viewport, canvas, number}
      renderer = page.render({canvas, viewport, transform:[density,0,0,density,0,0]})
      await renderer.promise
      if (!active) return
      canvas.dataset.rendered = 'true'
      if (small) return
      for (const mark of highlights || []) {
        for (const quad of mark.quads) {
          const corners=[]
          for (let i=0;i<quad.length;i+=2) corners.push(viewport.convertToViewportPoint(quad[i],quad[i+1]))
          const xs=corners.map(p=>p[0]), ys=corners.map(p=>p[1])
          const spot=document.createElement('div')
          spot.className='pdf-mark'
          Object.assign(spot.style,{left:Math.min(...xs)+'px',top:Math.min(...ys)+'px',width:(Math.max(...xs)-Math.min(...xs))+'px',
            height:(Math.max(...ys)-Math.min(...ys))+'px',background:'#'+mark.color})
          container.append(spot)
        }
      }
      const layer = document.createElement('div')
      layer.className = 'pdf-text'
      layer.style.setProperty('--total-scale-factor', viewport.scale*page.userUnit)
      container.append(layer)
      textLayer = new TextLayer({ textContentSource:page.streamTextContent(), container:layer, viewport })
      await textLayer.render()
      if (!active || !showNotes) return
      const existing = await page.getAnnotations()
      if (!active) return
      const markers = existing.filter(a=>a.subtype==='Text' && a.rect?.length===4).map(a=>({x:a.rect[0],y:a.rect[3],text:a.contentsObj?.str || ''}))
      for (const note of [...markers,...(notes || [])]) {
        const [x,y] = viewport.convertToViewportPoint(note.x,note.y)
        const marker = document.createElement('button')
        marker.className='pdf-note-pin';marker.type='button';marker.textContent='✎';marker.title=note.text
        marker.setAttribute('aria-label','便签 '+note.text)
        marker.style.left=Math.max(0,Math.min(x,viewport.width-18))+'px'
        marker.style.top=Math.max(0,Math.min(y,viewport.height-18))+'px'
        marker.addEventListener('click',event=>{event.stopPropagation(); marker.classList.toggle('pdf-note-expanded');marker.textContent=marker.classList.contains('pdf-note-expanded')?note.text:'✎'})
        container.append(marker)
      }
    }
    paint().catch(e => { if (active) setError('页面无法显示。' + errorText(e)) })
    return () => {
      active = false
      renderer?.cancel()
      textLayer?.cancel()
      container.replaceChildren()
      if (viewportRef) viewportRef.current = null
    }
  }, [doc,number,zoom,small,rotation,viewportRef,notes,highlights,showNotes])
  return <><div ref={host} className="pdf-paper" aria-label={small ? undefined : 'PDF 第 '+number+' 页'}/>{error && <span role="alert">{error}</span>}</>
}

export default function PdfReader({ disk, value, onChange }) {
  const [doc,setDoc] = useState(null), [error,setError] = useState(''), [retry,setRetry] = useState(0)
  const [number,setNumber] = useState(1), [pageEntry,setPageEntry] = useState('1'), [zoom,setZoom] = useState(1)
  const [query,setQuery] = useState(''), [submitted,setSubmitted] = useState('')
  const [result,setResult] = useState({pages:[], busy:false}), [searchError,setSearchError] = useState('')
  const scroller = useRef(null), searchBox = useRef(null)
  const viewportRef = useRef(null)
  const [tab,setTab] = useState('开始'), [showThumbs,setShowThumbs] = useState(true)
  const toolsOpen = tab==='页面' || tab==='注释'
  const [note,setNote] = useState(''), [addingNote,setAddingNote] = useState(false)
  const [existingNotes,setExistingNotes] = useState([]), [undo,setUndo] = useState([])
  const [highlightColor,setHighlightColor] = useState('FFDB55'), [hasSelection,setHasSelection] = useState(false)
  const [range,setRange] = useState(''), [exportState,setExportState] = useState({}), exporting=useRef(false)
  const pages = useMemo(() => value?.pdfPages || initialPdfPages(doc?.numPages || 0), [value?.pdfPages,doc])
  const current = pages[Math.min(number,pages.length)-1]
  useEffect(() => {
    let active = true
    setExistingNotes([])
    if (doc && current && toolsOpen) {
      doc.getPage(current.source).then(page=>page.getAnnotations()).then(items=>{
        if (active) setExistingNotes(items.filter(a=>a.subtype==='Text').map(a=>({id:a.id,text:a.contentsObj?.str || ''})))
      }).catch(e => { if (active) setSearchError(errorText(e)) })
    }
    return () => { active=false }
  },[doc,current?.source,toolsOpen])
  useEffect(() => { setUndo([]);setNote('');setAddingNote(false);setRange('');setExportState({}) },[disk?.id,disk?.revision])
  useEffect(()=>{
    const changed=()=>{
      const selection=window.getSelection()
      setHasSelection(Boolean(selection?.rangeCount && !selection.isCollapsed &&
        scroller.current?.querySelector('.pdf-text')?.contains(selection.getRangeAt(0).commonAncestorContainer)))
    }
    document.addEventListener('selectionchange',changed)
    return ()=>document.removeEventListener('selectionchange',changed)
  },[])

  function apply(next, activePage=number) {
    if (onChange({...value,pdfPages:next}) === false) return
    setUndo(old=>[...old.slice(-19),{value,number}])
    setNumber(activePage)
  }
  function rotate(degrees) {
    apply(pages.map((p,i)=>i === number-1 ? {...p,rotation:(p.rotation + degrees + 360)%360} : p))
  }
  function placeNote(event) {
    if (!addingNote || !note.trim()) return
    const info = viewportRef.current
    if (!info || info.number !== current.source) return
    const rect = info.canvas.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
    const [px,py] = info.viewport.convertToPdfPoint(x*info.viewport.width/rect.width,y*info.viewport.height/rect.height)
    apply(pages.map((p,i)=> i===number-1 ? {...p,notes:[...(p.notes||[]),{id:crypto.randomUUID(),x:px,y:py,text:note.trim()}]} : p))
    setAddingNote(false);setNote('')
  }
  function highlightSelection() {
    const selection=window.getSelection(), info=viewportRef.current
    if (!selection?.rangeCount || !info || info.number!==current.source) return
    const range=selection.getRangeAt(0)
    const layer=scroller.current.querySelector('.pdf-text')
    if (!layer?.contains(range.commonAncestorContainer)) return
    const bounds=info.canvas.getBoundingClientRect()
    function point(x,y) { return info.viewport.convertToPdfPoint((x-bounds.left)*info.viewport.width/bounds.width,(y-bounds.top)*info.viewport.height/bounds.height) }
    const quads=Array.from(range.getClientRects()).filter(r=>r.width>1 && r.height>1).map(r=>
      [...point(r.left,r.top),...point(r.right,r.top),...point(r.left,r.bottom),...point(r.right,r.bottom)])
    if (!quads.length || quads.length>2000) return
    const mark={id:crypto.randomUUID(),color:highlightColor,text:selection.toString().slice(0,4000),quads}
    apply(pages.map((p,i)=>i===number-1?{...p,highlights:[...(p.highlights||[]),mark]}:p))
    selection.removeAllRanges()
  }
  async function exportPages(mode) {
    if (exporting.current || !disk) return
    exporting.current=true
    setExportState({busy:true})
    try {
      const api=window.yanye.library
      if (mode==='extract') parsePdfPageRange(range,pages.length)
      let extra
      if (mode==='append') {
        const file=await api.chooseOpen('pdf')
        if (!file) { setExportState({});return }
        if (file.id===disk.id) throw new Error('请选择另一份本地 PDF。')
        extra=await api.readPdf(file.id,file.revision)
      }
      const bytes=await api.readPdf(disk.id,disk.revision)
      const result=mode==='extract' ? await extractPdfBytes(bytes,value?.pdfPages,range) : await appendPdfBytes(bytes,value?.pdfPages,extra)
      const copy=await api.copyPdf(disk.id,disk.revision,result,mode)
      setExportState(copy ? {message:'已导出 '+copy.name} : {})
    } catch(error) {
      setExportState({error:errorText(error)})
    } finally {
      exporting.current=false
    }
  }

  useEffect(() => {
    const focusSearch = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setTab('开始');setAddingNote(false)
        requestAnimationFrame(()=>{searchBox.current?.focus();searchBox.current?.select()})
      }
    }
    window.addEventListener('keydown',focusSearch)
    return () => window.removeEventListener('keydown',focusSearch)
  }, [])

  useEffect(() => {
    let active = true, task
    setDoc(null); setError(''); setNumber(1); setSubmitted(''); setQuery('')
    async function load() {
      if (!disk) throw new Error('原件已移走或放入回收站。请从文件中心重新选择 PDF。')
      const bytes = await window.yanye.library.readPdf(disk.id, disk.revision)
      if (!active) return
      task = getDocument({ data:new Uint8Array(bytes), cMapUrl:resourceRoot+'cmaps/', cMapPacked:true,
        standardFontDataUrl:resourceRoot+'standard_fonts/', wasmUrl:resourceRoot+'wasm/', iccUrl:resourceRoot+'iccs/',
        useWorkerFetch:true, enableXfa:false, maxImageSize:48_000_000, isEvalSupported:false })
      const loaded = await task.promise
      if (active) setDoc(loaded)
    }
    load().catch(e => {
      if (active) setError(e.name === 'PasswordException' ? '此 PDF 受密码保护，请先打开未加密副本。' : errorText(e))
    })
    return () => { active = false; task?.destroy().catch(() => {}) }
  }, [disk?.id,disk?.revision,retry])

  useEffect(() => {
    setPageEntry(String(number))
    scroller.current?.scrollTo(0,0)
  }, [number,doc])

  useEffect(() => {
    let active = true
    setSearchError('')
    setResult({pages:[],busy:Boolean(doc && submitted)})
    if (!doc || !submitted) return
    async function search() {
      const needle = normalize(submitted), pages = []
      for (let n=1; n<=pageOrder.length && active; n++) {
        const page = await doc.getPage(pageOrder[n-1].source)
        if (!active) return
        const content = await page.getTextContent()
        if (!active) return
        const strings = content.items.map(item => item.str || '')
        if (normalize(strings.join(' ')).includes(needle) || normalize(strings.join('')).includes(needle)) {
          pages.push(n)
          if (pages.length === 1) setNumber(n)
        }
      }
      if (active) setResult({pages,busy:false})
    }
    const pageOrder = pages
    search().catch(e => { if (active) {setResult({pages:[],busy:false}); setSearchError(errorText(e))} })
    return () => { active = false }
  }, [doc, submitted,pages])

  if (!doc) return <section className="reader-message" aria-label="PDF 阅读器">
    {error ? <><p role="alert">{error}</p><button className="button" onClick={() => setRetry(n=>n+1)}>重新读取</button></> : <p role="status">正在读取 PDF…</p>}
  </section>
  const start = Math.max(1, Math.min(number-2,pages.length-4))
  function commitPage() {
    const value = Number(pageEntry)
    if (Number.isInteger(value) && value >= 1 && value <= pages.length) setNumber(value)
    else setPageEntry(String(number))
  }
  function fitPage(whole) {
    const view=scroller.current, paper=view?.querySelector('.pdf-paper')
    if (!view || !paper || !paper.offsetWidth || !paper.offsetHeight) return
    const width=(view.clientWidth-32)/paper.offsetWidth
    const height=(view.clientHeight-32)/paper.offsetHeight
    setZoom(Math.min(4,Math.max(.1,Math.floor(zoom*(whole?Math.min(width,height):width)*100)/100)))
  }
  function nextMatch() {
    setNumber(result.pages.find(n => n>number) ?? result.pages[0])
  }
  return <section className="pdf-reader" aria-label="PDF 正文阅读器">
    <Ribbon label="PDF" tabs={['开始','注释','页面','视图']} active={tab} onChange={next=>{setTab(next);setAddingNote(false)}}/>
    {(tab==='开始' || tab==='视图') && <div className="reader-tools ribbon-panel">
      <RibbonGroup label="翻页">
      <button disabled={number===1} onClick={() => setNumber(n=>n-1)}>上一页</button>
      <label>页 <input aria-label="跳至 PDF 页码" type="number" min="1" max={pages.length} value={pageEntry}
        onChange={e=>setPageEntry(e.target.value)} onBlur={commitPage} onKeyDown={e=>{ if(e.key==='Enter') commitPage() }}/></label>
      <span>共 {pages.length} 页</span><button disabled={number===pages.length} onClick={()=>setNumber(n=>n+1)}>下一页</button>
      </RibbonGroup><RibbonGroup label="显示比例">
      <label>缩放 <select aria-label="PDF 缩放" value={zoom} onChange={e=>setZoom(Number(e.target.value))}>
        {[...new Set([0.5,0.75,1,1.25,1.5,2,zoom])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{Math.round(n*100)}%</option>)}</select></label>
      {tab==='视图' && <>
        <button onClick={()=>fitPage(false)}>适合页宽</button><button onClick={()=>fitPage(true)}>适合整页</button>
        <button aria-pressed={showThumbs} onClick={()=>setShowThumbs(!showThumbs)}>页面缩略图</button>
      </>}
      </RibbonGroup>
      {tab==='开始' && <RibbonGroup label="文字查找"><form onSubmit={e=>{e.preventDefault(); const key=query.trim(); if (key===submitted && result.pages.length) nextMatch(); else setSubmitted(key)}}>
        <input ref={searchBox} aria-label="PDF 搜索文字" placeholder="搜索 PDF 文字" value={query} onChange={e=>{setQuery(e.target.value); if (!e.target.value.trim()) setSubmitted('')}}/>
        <button disabled={!query.trim()}>查找</button>
      </form>
      {submitted && <span role="status">{result.busy?'正在检索…':result.pages.length?'匹配 '+result.pages.length+' 页':'未找到可检索的匹配文字'}</span>}
      {result.busy && <button onClick={()=>setSubmitted('')}>取消查找</button>}
      {result.pages.length>1 && <button onClick={nextMatch}>下一匹配页</button>}{searchError && <span role="alert">{searchError}</span>}
      </RibbonGroup>}
    </div>}
    {toolsOpen && <section className="pdf-edit-panel" aria-label="PDF 页面编辑">
      <div className="reader-tools ribbon-panel">
        {tab==='页面' && <RibbonGroup label="页面顺序与方向">
        <button onClick={()=>rotate(-90)}><RotateCcw size={14}/>左旋</button>
        <button onClick={()=>rotate(90)}><RotateCw size={14}/>右旋</button>
        <button disabled={number<=1} onClick={()=>apply(movePdfPage(pages,number-1,number-2),number-1)}><ArrowUp size={14}/>前移</button>
        <button disabled={number>=pages.length} onClick={()=>apply(movePdfPage(pages,number-1,number),number+1)}><ArrowDown size={14}/>后移</button>
        <button disabled={pages.length<2} onClick={()=>apply(pages.filter((_,i)=>i!==number-1),Math.min(number,pages.length-1))}><Trash2 size={14}/>移除本页</button>
        </RibbonGroup>}
        {tab==='注释' && <RibbonGroup label="批注工具">
        <button aria-pressed={addingNote} onClick={()=>setAddingNote(!addingNote)}><MessageSquarePlus size={14}/>添加便签</button>
        <select aria-label="高亮颜色" value={highlightColor} onChange={e=>setHighlightColor(e.target.value)}><option value="FFDB55">黄色</option><option value="87DDA0">绿色</option><option value="83C9EF">蓝色</option></select>
        <button onMouseDown={e=>e.preventDefault()} disabled={!hasSelection} onClick={highlightSelection} title="先在正文中选中文字"><Highlighter size={14}/>高亮选区</button>
        {addingNote && <label>便签内容 <input autoFocus aria-label="PDF 便签内容" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} placeholder="输入后点击页面放置"/></label>}
        </RibbonGroup>}
        <RibbonGroup label="历史"><button disabled={!undo.length} onClick={()=>{const last=undo.at(-1);if(onChange(last.value)!==false){setNumber(last.number);setUndo(undo.slice(0,-1))}}}><Undo2 size={14}/>撤销整理</button></RibbonGroup>
      </div>
      {tab==='页面' && <div className="reader-tools pdf-export-tools">
        <label>页码范围 <input aria-label="提取页码范围" placeholder="例如 1,3-5" value={range} onChange={e=>setRange(e.target.value)}/></label>
        <button disabled={!range.trim() || exportState.busy} onClick={()=>exportPages('extract')}>提取为 PDF</button>
        <button disabled={exportState.busy} onClick={()=>exportPages('append')}>追加另一份 PDF 并导出</button>
        {exportState.busy && <span role="status">正在准备副本…</span>}{exportState.message && <span role="status">{exportState.message}</span>}
        {exportState.error && <span role="alert">{exportState.error}</span>}
      </div>}
      {tab==='注释' && (existingNotes.length>0 || current?.notes?.length>0) && <ul className="pdf-notes" aria-label="本页便签">{existingNotes.map(n=><li key={n.id}>{n.text}</li>)}{current?.notes?.map(n=><li key={n.id}>{n.text}<button aria-label={'删除便签 '+n.text} onClick={()=>apply(pages.map((p,i)=>i===number-1 ? {...p,notes:p.notes.filter(v=>v.id!==n.id)} : p))}>移除</button></li>)}</ul>}
      {value?.pdfPages && <small>更改已加入本机草稿。按 Ctrl+S 将页面和批注保存为独立 PDF。签名需要在输出文件中重新核验。</small>}
    </section>}
    <div className="pdf-body">{showThumbs && <nav className="pdf-thumbs" aria-label="PDF 页面缩略图">
      {Array.from({length:Math.min(5,pages.length)},(_,i)=>start+i).map(n=><button key={n} aria-label={'转到第 '+n+' 页'}
        aria-current={number===n?'page':undefined} onClick={()=>setNumber(n)}>
        <PageImage doc={doc} number={pages[n-1].source} rotation={pages[n-1].rotation} small/><span>{n}</span>
      </button>)}
    </nav>}<div className={'pdf-scroll'+(addingNote?' pdf-placing-note':'')} ref={scroller} onClick={placeNote}>{current && <PageImage doc={doc} number={current.source} rotation={current.rotation} notes={current.notes} highlights={current.highlights} showNotes viewportRef={viewportRef} zoom={zoom}/>}</div></div>
  </section>
}
