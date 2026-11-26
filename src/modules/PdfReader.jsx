import React, { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './readers.css'

GlobalWorkerOptions.workerSrc = workerUrl
const resourceRoot = new URL(import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : './assets/pdf-resources/', document.baseURI).href
const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
const normalize = value => value.normalize('NFKC').toLocaleLowerCase()

function PageImage({ doc, number, zoom = 1, small = false }) {
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
      const base = page.getViewport({scale:1})
      const viewport = page.getViewport({scale:small ? 86/base.width : zoom*96/72})
      const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000/(viewport.width*viewport.height)), 8192/Math.max(viewport.width,viewport.height))
      const canvas = document.createElement('canvas')
      canvas.dataset.page = String(number)
      canvas.width = Math.max(1, Math.ceil(viewport.width*density))
      canvas.height = Math.max(1, Math.ceil(viewport.height*density))
      canvas.style.width = viewport.width+'px'
      canvas.style.height = viewport.height+'px'
      container.append(canvas)
      renderer = page.render({canvas, viewport, transform:[density,0,0,density,0,0]})
      await renderer.promise
      if (!active) return
      canvas.dataset.rendered = 'true'
      if (small) return
      const layer = document.createElement('div')
      layer.className = 'pdf-text'
      layer.style.setProperty('--total-scale-factor', viewport.scale*page.userUnit)
      container.append(layer)
      textLayer = new TextLayer({ textContentSource:page.streamTextContent(), container:layer, viewport })
      await textLayer.render()
    }
    paint().catch(e => { if (active) setError('页面无法显示。' + errorText(e)) })
    return () => {
      active = false
      renderer?.cancel()
      textLayer?.cancel()
      container.replaceChildren()
    }
  }, [doc,number,zoom,small])
  return <><div ref={host} className="pdf-paper" aria-label={small ? undefined : 'PDF 第 '+number+' 页'}/>{error && <span role="alert">{error}</span>}</>
}

export default function PdfReader({ disk }) {
  const [doc,setDoc] = useState(null), [error,setError] = useState(''), [retry,setRetry] = useState(0)
  const [number,setNumber] = useState(1), [pageEntry,setPageEntry] = useState('1'), [zoom,setZoom] = useState(1)
  const [query,setQuery] = useState(''), [submitted,setSubmitted] = useState('')
  const [result,setResult] = useState({pages:[], busy:false}), [searchError,setSearchError] = useState('')
  const scroller = useRef(null), searchBox = useRef(null)

  useEffect(() => {
    const focusSearch = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && searchBox.current) {
        event.preventDefault()
        searchBox.current.focus()
        searchBox.current.select()
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
      for (let n=1; n<=doc.numPages && active; n++) {
        const page = await doc.getPage(n)
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
    search().catch(e => { if (active) {setResult({pages:[],busy:false}); setSearchError(errorText(e))} })
    return () => { active = false }
  }, [doc, submitted])

  if (!doc) return <section className="reader-message" aria-label="PDF 阅读器">
    {error ? <><p role="alert">{error}</p><button className="button" onClick={() => setRetry(n=>n+1)}>重新读取</button></> : <p role="status">正在读取 PDF…</p>}
  </section>
  const start = Math.max(1, Math.min(number-2,doc.numPages-4))
  function commitPage() {
    const value = Number(pageEntry)
    if (Number.isInteger(value) && value >= 1 && value <= doc.numPages) setNumber(value)
    else setPageEntry(String(number))
  }
  function nextMatch() {
    setNumber(result.pages.find(n => n>number) ?? result.pages[0])
  }
  return <section className="pdf-reader" aria-label="PDF 正文阅读器">
    <div className="reader-tools">
      <button disabled={number===1} onClick={() => setNumber(n=>n-1)}>上一页</button>
      <label>页 <input aria-label="跳至 PDF 页码" type="number" min="1" max={doc.numPages} value={pageEntry}
        onChange={e=>setPageEntry(e.target.value)} onBlur={commitPage} onKeyDown={e=>{ if(e.key==='Enter') commitPage() }}/></label>
      <span>共 {doc.numPages} 页</span><button disabled={number===doc.numPages} onClick={()=>setNumber(n=>n+1)}>下一页</button>
      <label>缩放 <select aria-label="PDF 缩放" value={zoom} onChange={e=>setZoom(Number(e.target.value))}>
        {[0.5,0.75,1,1.25,1.5,2].map(n=><option key={n} value={n}>{n*100}%</option>)}</select></label>
      <form onSubmit={e=>{e.preventDefault(); const key=query.trim(); if (key===submitted && result.pages.length) nextMatch(); else setSubmitted(key)}}>
        <input ref={searchBox} aria-label="PDF 搜索文字" placeholder="搜索 PDF 文字" value={query} onChange={e=>{setQuery(e.target.value); if (!e.target.value.trim()) setSubmitted('')}}/>
        <button disabled={!query.trim()}>查找</button>
      </form>
      {submitted && <span role="status">{result.busy?'正在检索…':result.pages.length?'匹配 '+result.pages.length+' 页':'未找到可检索的匹配文字'}</span>}
      {result.busy && <button onClick={()=>setSubmitted('')}>取消查找</button>}
      {result.pages.length>1 && <button onClick={nextMatch}>下一匹配页</button>}{searchError && <span role="alert">{searchError}</span>}
    </div>
    <div className="pdf-body"><nav className="pdf-thumbs" aria-label="PDF 页面缩略图">
      {Array.from({length:Math.min(5,doc.numPages)},(_,i)=>start+i).map(n=><button key={n} aria-label={'转到第 '+n+' 页'}
        aria-current={number===n?'page':undefined} onClick={()=>setNumber(n)}>
        <PageImage doc={doc} number={n} small/><span>{n}</span>
      </button>)}
    </nav><div className="pdf-scroll" ref={scroller}><PageImage doc={doc} number={number} zoom={zoom}/></div></div>
  </section>
}
