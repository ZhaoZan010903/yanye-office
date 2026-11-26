import Ribbon, { RibbonGroup } from '../office/Ribbon'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { ArrowDown, ArrowUp, Copy, FileDown, FileInput, ImagePlus, Move, PanelTop, Play, Plus, Printer, Shapes, Trash2, Type, X } from 'lucide-react'
import { moveSlide, newSlide, readDeck, shapeKinds, slideBoxes, slideLayouts, slideShape, slidesFromDocument, slideThemes, textBox } from './slides-model.js'
import { ShapeProperties, SlideShape } from './SlideShapes.jsx'
import { slideTransition, speedNames, transitionNames } from './slide-transition.js'
import './slides.css'

function positioned({ x, y, w, h }) {
  return { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' }
}

function FreeText({ box, index, selected, select, update }) {
  const drag = useRef(null)
  const [preview,setPreview] = useState(null)
  const position = preview || box
  const style = { ...positioned(position), color:'#' + box.color, fontSize:box.fontSize / 9.6 + 'cqw',
    fontFamily:box.fontFace, fontStyle:box.italic?'italic':undefined, fontWeight:box.bold?700:400, textAlign:box.align }
  if (!update) return <div className="slides-text" style={style}>{box.text}</div>
  function dragPosition(e) {
    const start = drag.current
    return textBox({ ...box, x: start.x + (e.clientX - start.clientX) / start.width,
      y: start.y + (e.clientY - start.clientY) / start.height })
  }
  return <div className={'slides-freetext' + (selected ? ' selected' : '')} style={style}>
    <textarea className="slides-text" aria-label={'文本框 ' + (index+1)} value={box.text} placeholder="输入文字"
      onFocus={select} onChange={e => update({text:e.target.value})} />
    {selected && <button type="button" title="拖动文本框" aria-label="拖动文本框" className="slides-drag"
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault()
        const bounds = e.currentTarget.closest('.slides-page').getBoundingClientRect()
        drag.current = { x:box.x, y:box.y, width:bounds.width, height:bounds.height, clientX:e.clientX, clientY:e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => { if (drag.current) setPreview(dragPosition(e)) }}
      onPointerUp={e => { if (drag.current) { const {x,y} = dragPosition(e); drag.current=null; setPreview(null); update({x,y}) } }}
      onLostPointerCapture={() => { drag.current=null; setPreview(null) }}><Move size={14}/></button>}
  </div>
}

function SlidePage({ slide, theme, edit, onImage, boxId, onBoxSelect, onBoxEdit, shapeId, onShapeSelect, onShapeEdit }) {
  const boxes = slideBoxes(slide.layout)
  const fields = { title: '幻灯片标题', body: '幻灯片正文', side: '右栏正文' }
  const placeholders = { title: '输入标题', body: slide.layout === 'cover' ? '添加副标题' : '添加正文', side: '添加右栏正文' }
  return <div className="slides-page" style={{ '--slide-paper': '#' + theme.background, '--slide-ink': '#' + theme.ink }}>
    {Object.entries(boxes).map(([field, box]) => {
      const style = field==='title' && slide.titleBox ? {
        ...positioned(slide.titleBox), color:'#'+slide.titleBox.color, fontFamily:slide.titleBox.fontFace,
        fontSize:slide.titleBox.fontSize/9.6+'cqw',fontWeight:slide.titleBox.bold?700:400,
        fontStyle:slide.titleBox.italic?'italic':undefined,textAlign:slide.titleBox.align,
      } : positioned(box)
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
    {(slide.shapes || []).map(shape=><SlideShape key={shape.id} shape={shape} selected={shape.id===shapeId}
      onSelect={edit ? ()=>onShapeSelect(shape.id) : undefined} onMove={edit ? patch=>onShapeEdit(shape.id,patch) : undefined}/>)}
    {(slide.textBoxes || []).map((box,i) => <FreeText key={box.id} box={box} index={i} selected={box.id === boxId}
      select={() => onBoxSelect?.(box.id)} update={edit ? patch => onBoxEdit(box.id,patch) : undefined} />)}
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
  const [tab,setTab] = useState('开始')
  const [sourceId, setSourceId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleted, setDeleted] = useState(null)
  const [boxId,setBoxId] = useState(null)
  const [shapeId,setShapeId] = useState(null), [shapeKind,setShapeKind] = useState('rect')
  const shapes=selected.shapes || [], currentShape=shapes.find(s=>s.id===shapeId)
  const transition=slideTransition(selected.transition)
  function setTransition(patch) { changeSlide(selected.id,{transition:slideTransition({...transition,...patch})}) }
  function selectBox(id) { setBoxId(id);setShapeId(null) }
  function selectShape(id) { setShapeId(id);setBoxId(null) }
  const freeBoxes = selected.textBoxes || []
  const currentBox = freeBoxes.find(box => box.id === boxId)
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
        if (alive.current) await onPrintPdf(fileTitle + '.pdf', { widthMm: 13.333333 * 25.4, heightMm: 7.5 * 25.4 })
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
  function editBox(id,patch) {
    changeSlide(selected.id,{textBoxes:freeBoxes.map(box => box.id === id ? textBox({...box,...patch}) : box)})
  }
  function editShape(id,patch) {
    changeSlide(selected.id,{shapes:shapes.map(s=>s.id===id ? slideShape({...s,...patch}) : s)})
  }
  function insertShape(existing) {
    const shape = existing ? slideShape({...existing,id:crypto.randomUUID(),x:existing.x+.03,y:existing.y+.03}) :
      slideShape({kind:shapeKind,x:.32+(shapes.length%5)*.04,y:.32+(shapes.length%5)*.04})
    if(changeSlide(selected.id,{shapes:[...shapes,shape]})) selectShape(shape.id)
  }
  function insertBox() {
    const from = freeBoxes.length % 5
    const box = textBox({ x:.12 + from * .04, y:.45 + from * .04, color:theme.ink })
    if (changeSlide(selected.id,{textBoxes:[...freeBoxes,box]})) {
      selectBox(box.id)
      requestAnimationFrame(() => root.current?.querySelector('.slides-freetext.selected textarea')?.focus())
    }
  }
  function append(slides, importedTheme) {
    const current = latest.current
    const blank = current.slides.length === 1 && !current.slides[0].textBoxes?.length && !current.slides[0].shapes?.length && !['title', 'body', 'side', 'notes', 'image'].some(k => current.slides[0][k])
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
    if (!playing || transition.afterMs==null || index+1>=deck.slides.length) return
    const timer=setTimeout(()=>setActiveId(deck.slides[index+1].id),transition.afterMs)
    return ()=>clearTimeout(timer)
  },[playing,selected.id,transition.afterMs,index,deck.slides])
  useEffect(() => {
    const fullScreenChanged = () => { if (!document.fullscreenElement) setPlaying(false) }
    document.addEventListener('fullscreenchange', fullScreenChanged)
    return () => document.removeEventListener('fullscreenchange', fullScreenChanged)
  }, [])
  useEffect(() => {
    function onKey(e) {
      if (e.isComposing) return
      if (e.key === 'F5') { e.preventDefault(); if (!playing && !e.shiftKey) setActiveId(deck.slides[0].id); show(); return }
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
      <div key={selected.id} className={'slides-projector transition-'+transition.effect} style={{'--fade-time':{fast:'.25s',med:'.6s',slow:'1s'}[transition.speed]}}
        onClick={()=>{ if (transition.click && index+1<deck.slides.length) setActiveId(deck.slides[index+1].id) }}><SlidePage slide={selected} theme={theme} /></div>
      <div className="slides-show-bar">
        <button type="button" disabled={!index} onClick={() => setActiveId(deck.slides[index - 1].id)}>上一页</button>
        <span aria-live="polite">{index + 1} / {deck.slides.length}</span>
        <button type="button" disabled={index + 1 === deck.slides.length} onClick={() => setActiveId(deck.slides[index + 1].id)}>下一页</button>
        <button type="button" onClick={endShow}>退出放映 <kbd>Esc</kbd></button>
      </div>
    </div> : <>
      <Ribbon label="演示" tabs={['开始','插入','设计','切换','放映','文件']} active={tab}
        onChange={next=>{setTab(next);setPanel(next==='切换'?'transition':'')}}/>
      {tab!=='切换' && <div className="slides-toolbar ribbon-panel">
        {tab==='开始' && <RibbonGroup label="幻灯片">
        <button type="button" onClick={() => insert(false)}><Plus size={16} />新建幻灯片</button>
        <button type="button" onClick={()=>insert(true)}><Copy size={15}/>复制当前页</button>
        <button type="button" disabled={deck.slides.length<=1} onClick={remove}><Trash2 size={15}/>删除当前页</button>
        </RibbonGroup>}
        {tab==='插入' && <RibbonGroup label="对象">
        <button type="button" onClick={()=>imageInput.current.click()}><ImagePlus size={15}/>插入图片</button>
        <button type="button" onClick={insertBox}><Type size={15}/>插入文本框</button>
        <label>形状<select aria-label="形状类型" value={shapeKind} onChange={e=>setShapeKind(e.target.value)}>{Object.entries(shapeKinds).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label>
        <button onClick={()=>insertShape()}><Shapes size={15}/>插入形状</button>
        </RibbonGroup>}
        {(tab==='开始' || tab==='设计') && <RibbonGroup label="版式"><label>版式<select aria-label="幻灯片版式" value={selected.layout} onChange={e => changeSlide(selected.id, { layout: e.target.value })}>
          {Object.entries(slideLayouts).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        </RibbonGroup>}
        {tab==='设计' && <RibbonGroup label="主题"><label>主题<select aria-label="演示主题" value={deck.theme} onChange={e => save({ ...deck, theme: e.target.value })}>
          {Object.entries(slideThemes).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
        </select></label>
        </RibbonGroup>}
        {tab==='插入' && <RibbonGroup label="大纲"><button type="button" onClick={() => setPanel(panel === 'outline' ? '' : 'outline')} aria-expanded={panel === 'outline'}><PanelTop size={15} />文档大纲</button>
        </RibbonGroup>}
        {tab==='文件' && <RibbonGroup label="导入与导出">
        <button type="button" onClick={() => setPanel(panel === 'import' ? '' : 'import')} aria-expanded={panel === 'import'}><FileInput size={15} />导入 PPTX</button>
        <button type="button" disabled={busy} onClick={exportFile}><FileDown size={15} />导出 PPTX</button>
        <button type="button" disabled={busy || !onPrintPdf} onClick={printDeck} title="将所有幻灯片导出为 PDF"><Printer size={15} />导出 PDF</button>
        </RibbonGroup>}
        {tab==='放映' && <RibbonGroup label="开始放映">
        <button type="button" onClick={()=>{setActiveId(deck.slides[0].id);show()}} title="从头开始（F5）"><Play size={15}/>从头开始</button>
        <button type="button" className="slides-play" onClick={show} title="从当前页放映（Shift+F5）"><Play size={15} />从当前页开始</button>
        </RibbonGroup>}
      </div>}
      {panel==='transition' && <div className="slides-panel" aria-label="当前页切换">
        <label>效果<select aria-label="切换效果" value={transition.effect} onChange={e=>setTransition({effect:e.target.value})}>{Object.entries(transitionNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label>速度<select aria-label="切换速度" value={transition.speed} disabled={transition.effect!=='fade'} onChange={e=>setTransition({speed:e.target.value})}>{Object.entries(speedNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label><input type="checkbox" checked={transition.click} onChange={e=>setTransition({click:e.target.checked})}/>单击换页</label>
        <label><input type="checkbox" checked={transition.afterMs!=null} onChange={e=>setTransition({afterMs:e.target.checked?5000:null})}/>定时换页</label>
        {transition.afterMs!=null && <label>停留秒数<input type="number" aria-label="停留秒数" min="0" max="86400" step=".1" key={selected.id+'-'+transition.afterMs} defaultValue={transition.afterMs/1000}
          onBlur={e=>{ if(e.target.checkValidity() && Number.isFinite(e.target.valueAsNumber)) setTransition({afterMs:e.target.valueAsNumber*1000}); else e.target.value=transition.afterMs/1000 }}
          onKeyDown={e=>{if(e.key==='Enter') e.currentTarget.blur()}}/></label>}
        <button onClick={()=>save({...deck,slides:deck.slides.map(s=>({...s,transition}))})}>应用到全部幻灯片</button>
        <IconAction icon={X} label="关闭切换设置" onClick={()=>{setPanel('');setTab('开始')}}/>
      </div>}
      {currentShape && <ShapeProperties shape={currentShape} shapes={shapes} select={selectShape} edit={patch=>editShape(shapeId,patch)}
        reorder={direction=>changeSlide(selected.id,{shapes:moveSlide(shapes,shapes.indexOf(currentShape),direction)})}
        duplicate={()=>insertShape(currentShape)} remove={()=>{if(changeSlide(selected.id,{shapes:shapes.filter(s=>s.id!==shapeId)}))setShapeId(null)}}/>}
      {currentBox && <div className="slides-panel slides-box-properties" aria-label="文本框属性">
        <select aria-label="选中文本框" value={boxId} onChange={e=>setBoxId(e.target.value)}>{freeBoxes.map((b,i)=>
          <option key={b.id} value={b.id}>{i+1}. {b.text.slice(0,14) || '空文本框'}</option>)}</select>
        {Object.entries({x:'左',y:'上',w:'宽',h:'高',fontSize:'字号'}).map(([key,label]) => {
          const isSize = key === 'fontSize', scale = isSize ? 1 : 100
          const value = Number((currentBox[key]*scale).toFixed(1))
          return <label key={key}>{label}<input type="number" aria-label={'文本框'+label}
            key={currentBox.id + ':' + value} defaultValue={value} step={isSize ? 1 : .5}
            min={isSize ? 6 : key === 'w' || key === 'h' ? 4 : 0} max={isSize ? 144 : 100}
            onBlur={e => { const next=e.target.valueAsNumber; if (Number.isFinite(next)) editBox(boxId,{[key]:next/scale}); e.target.value=String(value) }}
            onKeyDown={e => { if(e.key === 'Enter') e.currentTarget.blur() }} />{isSize ? 'pt' : '%'}</label>
        })}
        <label>字色<input aria-label="文本框字色" type="color" value={'#'+currentBox.color} onChange={e=>editBox(boxId,{color:e.target.value.slice(1)})}/></label>
        <label>字体<select aria-label="文本框字体" value={currentBox.fontFace || 'Microsoft YaHei'} onChange={e=>editBox(boxId,{fontFace:e.target.value})}>
          {[...new Set([currentBox.fontFace || 'Microsoft YaHei','Microsoft YaHei','SimSun','KaiTi','Aptos','Arial','Calibri','Georgia','Times New Roman'])].map(f=><option key={f}>{f}</option>)}</select></label>
        <button aria-pressed={!!currentBox.bold} onClick={()=>editBox(boxId,{bold:!currentBox.bold})}>加粗</button>
        <button aria-pressed={!!currentBox.italic} onClick={()=>editBox(boxId,{italic:!currentBox.italic})}>斜体</button>
        <select aria-label="文本框对齐" value={currentBox.align || 'left'} onChange={e=>editBox(boxId,{align:e.target.value})}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select>
        <button onClick={()=>{if(changeSlide(selected.id,{textBoxes:freeBoxes.filter(b=>b.id!==boxId)})) setBoxId(null)}}>删除文本框</button>
        <IconAction icon={X} label="收起文本框属性" onClick={()=>setBoxId(null)} />
      </div>}
      {panel === 'outline' && <div className="slides-panel">
        {pages.length ? <><select aria-label="选择大纲文档" value={pages.some(p => p.id === sourceId) ? sourceId : pages[0].id} onChange={e => setSourceId(e.target.value)}>
          {pages.map(p => <option key={p.id} value={p.id}>{p.title || '未命名文档'}</option>)}
        </select><button type="button" onClick={() => append(slidesFromDocument(pages.find(p => p.id === sourceId) || pages[0]))}>按标题生成并追加</button></> : <span>工作区还没有可用的文档。</span>}
        <IconAction icon={X} label="关闭文档大纲" onClick={() => setPanel('')} />
      </div>}
      {panel === 'import' && <div className="slides-panel"><span>按原页序追加文本、常用形状、备注和每页首张 PNG / JPEG。导入采用本地版式，动画、组合及媒体会简化。</span>
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
            <div className="slides-mini" aria-hidden="true"><SlidePage theme={theme} slide={s}/></div>
            <span className="slides-number">{i + 1}</span>
          </button>)}
        </aside>
        <div className="slides-workarea">
          <div className="slides-canvas"><SlidePage theme={theme} slide={selected} edit={patch => changeSlide(selected.id, patch)}
            onImage={() => imageInput.current.click()} boxId={boxId} onBoxSelect={selectBox} onBoxEdit={editBox}
            shapeId={shapeId} onShapeSelect={selectShape} onShapeEdit={editShape} /></div>
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
