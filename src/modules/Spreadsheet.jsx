import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Bold, ChevronDown, FileDown, FileUp, Filter, Italic, Plus, Redo2, Sigma, Strikethrough, Table2, Underline, Undo2 } from 'lucide-react'
import {
  address, columnName, csvText, emptyWorkbook, evaluator, fillFrom, formatted, LIMITS, newSheet, parseDelimited,
  bounds, changeBorders, changeCellStyle, copyRange, delimitedText, findMerge, intersects, location, mergeRange, numberFormats, pasteRange, rangeName, removeSheet, renameSheet, shiftGrid, unmergeRange, writeRange,
} from './spreadsheet.js'
import { appendSheets, availableName, exchangeNote, readXlsx, writeXlsx } from './spreadsheet-xlsx.js'
import FontPicker from './FontPicker.jsx'
import './spreadsheet.css'

const rowHeight = 30
const collator = new Intl.Collator('zh-CN', { numeric: true })
function cellBorders(borders) {
  if (!borders) return
  const css={}
  for (const [side,property] of [['top','borderTop'],['bottom','borderBottom'],['left','borderLeft'],['right','borderRight']]) {
    const item=borders[side]
    if (!item?.style) continue
    const color=/^(?:[0-9a-f]{2})?[0-9a-f]{6}$/i.test(item.color?.argb) ? '#'+item.color.argb.slice(-6) : '#37352f'
    const stroke=item.style==='double' ? 'double' : /dash/i.test(item.style) ? 'dashed' : item.style==='dotted' ? 'dotted' : 'solid'
    const width=stroke==='double' || item.style==='thick' ? 3 : /medium/i.test(item.style) ? 2 : 1
    css[property]=width+'px '+stroke+' '+color
  }
  return css
}

function rowAt(offsets,y) {
  let low=0, high=offsets.length-1
  while (low < high) {
    const mid=Math.ceil((low+high)/2)
    if (offsets[mid]<=y) low=mid
    else high=mid-1
  }
  return Math.min(low,offsets.length-2)
}

function SheetChart({ sheet, display, rows, col }) {
  const series = rows.filter(r => r !== 0).map(row => ({
    label: display(sheet,address(row,0)) || String(row+1), value: display(sheet,address(row,col)),
  })).filter(item => typeof item.value === 'number').slice(0,20)
  const max = Math.max(1,...series.map(item => Math.abs(item.value)))
  return <section className="sheet-chart" aria-label="柱状图">
    <strong>{columnName(col)} 列柱状图</strong>
    {!series.length ? <p>选择有数字的列。第一列用作标签，第一行用作表头。</p> :
      <div>{series.map(({label,value},i) => <div className="sheet-bar-row" key={i}>
        <span title={String(label)}>{label}</span><i style={{ width: Math.abs(value)/max*100+'%' }} /><b>{value}</b>
      </div>)}</div>}
  </section>
}

function SheetMenu({ label, icon: Icon, children }) {
  const ref = useRef(null)
  return <details className="sheet-menu" ref={ref} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) ref.current.open = false
  }} onKeyDown={event => { if (event.key === 'Escape') { ref.current.open = false; ref.current.querySelector('summary').focus() } }}>
    <summary>{Icon && <Icon size={14} />} {label}<ChevronDown size={12} /></summary>
    <div className="sheet-menu-list" onClick={() => { ref.current.open = false }}>{children}</div>
  </details>
}

export default function Spreadsheet({ value, onChange, onImport, onExport }) {
  const blank = useMemo(emptyWorkbook, [])
  const book = Array.isArray(value?.sheets) && value.sheets.length ? value : blank
  const sheet = book.sheets.find(s => s.id === book.active) ?? book.sheets[0]
  const latest = useRef(book)
  latest.current = book
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [selection, select] = useState({ row:0, col:0 })
  const [editing, setEditing] = useState(false)
  const [rename, setRename] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(450)
  const [showFunctions, setShowFunctions] = useState(false)
  const [widthEditor, setWidthEditor] = useState(false)
  const history = useRef({past:[],future:[]})
  const drag = useRef(false)
  const clipboard = useRef(null)
  const scroller = useRef(null), editInput = useRef(null), original = useRef(''), focusGrid = useRef(false)
  const row = Math.min(selection.row, sheet.rows-1), col = Math.min(selection.col,sheet.cols-1)
  const selected = address(row,col)
  const endRow = Math.min(selection.endRow ?? row,sheet.rows-1), endCol = Math.min(selection.endCol ?? col,sheet.cols-1)
  const range = bounds({row,col},{row:endRow,col:endCol})
  const style = sheet.styles?.[selected] ?? {}
  const raw = sheet.cells[selected] ?? ''
  const display = useMemo(() => evaluator(book),[book])
  const sort = sheet.sort
  const filter = sheet.query ?? ''
  const verticalMerges = sheet.merges?.some(m => m.bottom > m.top)
  const allRows = useMemo(() => {
    let rows = Array.from({ length: sheet.rows-1 }, (_,i) => i+1)
    if (filter.trim()) {
      const needle = filter.toLocaleLowerCase().trim()
      rows = rows.filter(r => {
        for (let c=0; c<sheet.cols; c++) if (String(display(sheet,address(r,c))).toLocaleLowerCase().includes(needle)) return true
        return false
      })
    }
    if (sort) rows.sort((a,b) => {
      const left = display(sheet,address(a,sort.col)), right = display(sheet,address(b,sort.col))
      if (left === '' || right === '') return Number(left === '') - Number(right === '')
      const compare = typeof left === 'number' && typeof right === 'number' ? left-right : collator.compare(String(left),String(right))
      return sort.desc ? -compare : compare
    })
    return [0,...rows]
  }, [sheet,display,sort,filter])
  const heights = useMemo(()=>{
    const values=Array(sheet.rows).fill(rowHeight)
    for (const [ref,style] of Object.entries(sheet.styles ?? {})) {
      if (style.size) {
        const r=location(ref).row
        values[r]=Math.max(values[r],Math.ceil(style.size*1.7)+4)
      }
    }
    for (const [r,pt] of Object.entries(sheet.heights ?? {})) values[r]=Math.max(12,Math.round(pt*4/3))
    return values
  },[sheet.rows,sheet.heights,sheet.styles])
  const offsets = useMemo(()=>{
    const values=[0]
    for (const r of allRows) values.push(values.at(-1)+heights[r])
    return values
  },[allRows,heights])
  const first = Math.max(0,rowAt(offsets,scroll)-5)
  const last = Math.min(allRows.length,rowAt(offsets,scroll+height)+7)
  const visibleRows = allRows.slice(first,last)
  const frozenHeaderDetached = sheet.freezeHeader && first>0
  if (frozenHeaderDetached) visibleRows.unshift(0)
  const cols = Array.from({length:sheet.cols},(_,i)=>i)
  const widths = cols.map(c => sheet.widths?.[c] ? Math.max(15, Math.round(sheet.widths[c]*7+5)) : 104)
  const rowIndices = [allRows.indexOf(row),allRows.indexOf(endRow)]
  const rangeRows = rowIndices.includes(-1) ? [row] : allRows.slice(Math.min(...rowIndices),Math.max(...rowIndices)+1)
  const highlighted = new Set(rangeRows)
  const mergeGrid = new Map()
  for (const box of sheet.merges ?? []) {
    const displayed = visibleRows.filter(r => r >= box.top && r <= box.bottom)
    for (const r of displayed) for (let c=box.left; c<=box.right; c++) {
      mergeGrid.set(address(r,c), {box, first:r===displayed[0] && c===box.left, height:displayed.length})
    }
  }
  useEffect(() => {
    const release = () => { drag.current = false }
    window.addEventListener('pointerup',release)
    window.addEventListener('blur',release)
    return () => { window.removeEventListener('pointerup',release); window.removeEventListener('blur',release) }
  },[])

  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => setHeight(entries[0].contentRect.height))
    observer.observe(scroller.current)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (editing) editInput.current?.focus()
    else if (focusGrid.current) scroller.current?.focus({preventScroll:true})
    focusGrid.current = false
  }, [editing,selection,sheet.id])
  function change(next, remember=true) {
    const previous = latest.current
    if (onChange(next) === false) return false
    if (remember) {
      const past = history.current.past
      past.push(previous)
      if (past.length > 24) past.shift()
      history.current.future = []
    }
    latest.current = next
    return true
  }
  function undo(redo=false) {
    const {past,future} = history.current, from = redo ? future : past, to = redo ? past : future
    const prev = latest.current, next = from.at(-1)
    if (next && change(next,false)) { from.pop(); to.push(prev); setEditing(false); select({row:0,col:0}) }
  }
  function applyStyle(patch) { updateSheet(changeCellStyle(sheet,rangeRows,range.left,range.right,patch)) }
  function updateSheet(next) {
    const current = latest.current
    change({ ...current, sheets:current.sheets.map(s=>s.id===next.id ? next : s) })
  }
  function tryAction(fn) {
    try { fn(); setNotice('') } catch (error) { setNotice(error.message) }
  }
  function put(text) {
    tryAction(() => updateSheet(writeRange(sheet,row,col,[[text]])))
  }
  function go(r,c,focus = true,extend = false) {
    r = Math.max(0,Math.min(sheet.rows-1,r)); c = Math.max(0,Math.min(sheet.cols-1,c))
    const merge = findMerge(sheet,r,c)
    if (merge && !extend) { r=merge.top; c=merge.left }
    setEditing(false); focusGrid.current = focus
    select(extend ? {...selection,endRow:r,endCol:c} : {row:r,col:c})
    if (!focus) return
    const index = allRows.indexOf(r), box = scroller.current
    if (index >= 0 && box) {
      const top = offsets[index]
      if (top < box.scrollTop) box.scrollTop = top
      if (top + heights[r]+rowHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + heights[r]+rowHeight - box.clientHeight
      const left = 44+widths.slice(0,c).reduce((a,b)=>a+b,0)
      if (left < box.scrollLeft+44) box.scrollLeft = left-44
      if (left+widths[c] > box.scrollLeft+box.clientWidth) box.scrollLeft = left+widths[c]-box.clientWidth
    }
  }
  function vertical(delta) {
    const merge = findMerge(sheet,row,col)
    const from = merge && delta>0 ? merge.bottom : row
    const index = Math.max(0, allRows.indexOf(from))
    go(allRows[Math.max(0,Math.min(allRows.length-1,index+delta))],col)
  }
  function startEditing(text) {
    original.current = raw; setEditing(true)
    if (text !== undefined) put(text)
  }
  function gridKeys(event) {
    if (event.nativeEvent.isComposing || event.altKey) return
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase()
      if (!editing && ['b','i','u','z','y'].includes(key)) {
        event.preventDefault()
        if (key==='b') applyStyle({bold:!style.bold})
        else if (key==='i') applyStyle({italic:!style.italic})
        else if (key==='u') applyStyle({underline:style.underline ? null : 'single'})
        else undo(key==='y' || event.shiftKey)
      }
      return
    }
    if (event.key === 'Enter') { event.preventDefault(); if (editing) vertical(event.shiftKey ? -1 : 1); else startEditing(); return }
    if (event.key === 'Tab') {
      event.preventDefault()
      const merge = findMerge(sheet,row,col)
      go(row,event.shiftKey ? col-1 : (merge?.right ?? col)+1)
      return
    }
    if (editing) {
      if (event.key === 'Escape') { event.preventDefault(); put(original.current); go(row,col) }
      return
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      let r=event.shiftKey ? endRow : row, c=event.shiftKey ? endCol : col
      const merge=findMerge(sheet,r,c)
      if (event.key==='ArrowRight') c=(merge?.right ?? c)+1
      if (event.key==='ArrowLeft') c=(merge?.left ?? c)-1
      if (event.key==='ArrowDown') r=allRows[Math.min(allRows.length-1,allRows.indexOf(merge?.bottom ?? r)+1)]
      if (event.key==='ArrowUp') r=allRows[Math.max(0,allRows.indexOf(merge?.top ?? r)-1)]
      go(r,c,true,event.shiftKey)
    }
    else if (event.key === 'F2') { event.preventDefault(); startEditing() }
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const cells = {...sheet.cells}
      for (const r of rangeRows) for (let c=range.left; c<=range.right; c++) delete cells[address(r,c)]
      updateSheet({...sheet,cells})
    }
    else if (event.key.length === 1) { event.preventDefault(); startEditing(event.key) }
  }
  function switchSheet(id) {
    change({...book,active:id}); select({row:0,col:0}); setEditing(false); setRename(false); setRemoving(null)
    scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0
    setNotice('')
  }
  function addSheet() {
    if (book.sheets.length >= LIMITS.sheets) return setNotice('工作簿最多 32 张工作表。')
    const name = availableName('工作表'+(book.sheets.length+1),book.sheets)
    const added = newSheet(name)
    change({...book,sheets:[...book.sheets,added],active:added.id})
    select({row:0,col:0}); setRename(false); setEditing(false); scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0
  }
  function structure(axis,delta) {
    tryAction(() => {
      const next = shiftGrid(book,sheet.id,axis,axis === 'row' ? row : col,delta)
      change(next); setEditing(false)
    })
  }
  async function exchange(ext, input) {
    setBusy(true); setNotice('')
    try {
      if (input) {
        const file = await onImport(ext)
        if (!file || !mounted.current) return
        const imported = ext === 'xlsx' ? await readXlsx(file.text) :
          [writeRange(newSheet(file.name.replace(/\.csv$/i,'')),0,0,parseDelimited(file.text))]
        if (!mounted.current) return
        const current = latest.current === blank ? { sheets: [] } : latest.current
        if (!change(appendSheets(current, imported))) { setNotice('工作区空间不足，未添加工作表。'); return }
        select({row:0,col:0}); setEditing(false); setRename(false)
        scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0
        setNotice('已添加 '+imported.length+' 张工作表。')
      } else {
        const content = ext === 'xlsx' ? await writeXlsx(book) : '\uFEFF'+csvText(sheet,display)
        if (await onExport(sheet.name+'.'+ext,content) && mounted.current) setNotice('已导出 '+ext.toUpperCase()+'。')
      }
    } catch (error) { if (mounted.current) setNotice(error.message) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <section className="sheet-module" aria-label="电子表格">
    <div className="sheet-toolbar">
      <button className="sheet-action" aria-label="撤销表格操作" title="撤销 Ctrl+Z" disabled={!history.current.past.length} onClick={()=>undo()}><Undo2 size={15}/></button>
      <button className="sheet-action" aria-label="重做表格操作" title="重做 Ctrl+Y" disabled={!history.current.future.length} onClick={()=>undo(true)}><Redo2 size={15}/></button>
      <SheetMenu label="行与列" icon={Table2}>
        <button onClick={()=>structure('row',1)}>在上方插入行</button><button onClick={()=>structure('col',1)}>在左侧插入列</button>
        <button disabled={sheet.rows<=1} onClick={()=>structure('row',-1)}>删除所选行</button><button disabled={sheet.cols<=1} onClick={()=>structure('col',-1)}>删除所选列</button>
        <button onClick={()=>setWidthEditor('col')}>设置选区列宽</button>
        <button onClick={()=>setWidthEditor('row')}>设置选区行高</button>
        <button onClick={()=>setRename(true)}>重命名工作表</button>
        <button onClick={()=>updateSheet({...sheet,freezeHeader:!sheet.freezeHeader})}>{sheet.freezeHeader?'取消冻结首行':'冻结首行'}</button>
        <button onClick={()=>updateSheet({...sheet,freezeColumn:!sheet.freezeColumn})}>{sheet.freezeColumn?'取消冻结首列':'冻结首列'}</button>
        <button disabled={book.sheets.length===1} onClick={()=>setRemoving(sheet.id)}>删除当前工作表</button>
      </SheetMenu>
      <SheetMenu label="单元格">
        <button disabled={row===0} onClick={()=>updateSheet(fillFrom(sheet,row,col,'down'))}>从上方填充</button>
        <button disabled={col===0} onClick={()=>updateSheet(fillFrom(sheet,row,col,'right'))}>从左侧填充</button>
      </SheetMenu>
      <SheetMenu label="边框">
        {[['全部框线','all'],['外侧框线','outline'],['清除边框','none']].map(([label,mode])=>
          <button key={mode} onClick={()=>updateSheet(changeBorders(sheet,rangeRows,range.left,range.right,mode))}>{label}</button>)}
      </SheetMenu>
      <SheetMenu label="排序与筛选" icon={Filter}>
        <button disabled={verticalMerges} onClick={()=>updateSheet({...sheet,sort:{col,desc:false}})}>按 {columnName(col)} 列升序</button>
        <button disabled={verticalMerges} onClick={()=>updateSheet({...sheet,sort:{col,desc:true}})}>按 {columnName(col)} 列降序</button>
        <button disabled={!sort} onClick={()=>updateSheet({...sheet,sort:null})}>还原行序</button>
        <button disabled={verticalMerges} onClick={()=>setFilterOpen(true)}>筛选行</button>
        {verticalMerges && <small>先拆分跨行合并的单元格再筛选或排序。</small>}
      </SheetMenu>
      <button className="sheet-action" aria-pressed={!!sheet.chart} onClick={()=>updateSheet({...sheet,chart:sheet.chart?null:{col}})}><BarChart3 size={15}/>柱状图</button>
      <button className="sheet-action" aria-expanded={showFunctions} onClick={()=>setShowFunctions(!showFunctions)}><Sigma size={15}/>函数</button>
      <SheetMenu label="导入" icon={FileUp}><button disabled={busy} onClick={()=>exchange('csv',true)}>导入 CSV</button><button disabled={busy} onClick={()=>exchange('xlsx',true)}>导入 XLSX</button></SheetMenu>
      <SheetMenu label="导出" icon={FileDown}><button disabled={busy} onClick={()=>exchange('csv',false)}>导出 CSV</button><button disabled={busy} onClick={()=>exchange('xlsx',false)}>导出 XLSX</button></SheetMenu>
    </div>
    <div className="sheet-format" role="toolbar" aria-label="选区格式">
      <FontPicker label="选区字体" value={style.font || ''} defaultLabel="默认字体" useLocalNames onChange={font=>applyStyle({font})}/>
      <select aria-label="选区字号" value={style.size || ''} onChange={e=>applyStyle({size:Number(e.target.value)})}>
        <option value="">默认字号</option>{[...new Set([9,10,11,12,14,16,18,20,24,28,32,...(style.size ? [style.size] : [])])].sort((a,b)=>a-b).map(size=><option key={size} value={size}>{size} pt</option>)}
      </select>
      <button aria-pressed={!!style.bold} aria-label="加粗选区" title="加粗 Ctrl+B" onClick={()=>applyStyle({bold:!style.bold})}><Bold size={15}/></button>
      <button aria-pressed={!!style.italic} aria-label="倾斜选区" title="倾斜 Ctrl+I" onClick={()=>applyStyle({italic:!style.italic})}><Italic size={15}/></button>
      <button aria-pressed={!!style.underline} aria-label="选区下划线" title="下划线 Ctrl+U" onClick={()=>applyStyle({underline:style.underline ? null : 'single'})}><Underline size={15}/></button>
      <button aria-pressed={!!style.strike} aria-label="选区删除线" title="删除线" onClick={()=>applyStyle({strike:!style.strike})}><Strikethrough size={15}/></button>
      <label>字色<input type="color" aria-label="选区字体颜色" value={style.color ?? '#37352f'} onChange={e=>applyStyle({color:e.target.value.toUpperCase()})}/></label>
      <label>底色<input type="color" aria-label="选区填充颜色" value={style.fill ?? '#ffffff'} onChange={e=>applyStyle({fill:e.target.value.toUpperCase()})}/></label>
      <select aria-label="选区水平对齐" value={style.align || ''} onChange={e=>applyStyle({align:e.target.value})}>
        <option value="">自动对齐</option><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
      </select>
      <select aria-label="选区垂直对齐" value={style.vertical || ''} onChange={e=>applyStyle({vertical:e.target.value})}>
        <option value="">垂直默认</option><option value="top">顶端对齐</option><option value="middle">垂直居中</option><option value="bottom">底端对齐</option>
      </select>
      <select aria-label="选区数字格式" value={sheet.formats?.[selected] || ''} onChange={e=>applyStyle({numberFormat:e.target.value})}>
        <option value="">常规</option>{Object.entries(numberFormats).map(([key,[label]])=><option key={key} value={key}>{label}</option>)}
      </select>
      <button disabled={range.top===range.bottom && range.left===range.right} onClick={()=>tryAction(()=>{
        if (range.bottom>range.top && (sort || filter)) throw new Error('请还原行序并清除筛选，再合并多行。')
        updateSheet(mergeRange(sheet,range)); go(range.top,range.left)
      })}>合并单元格</button>
      <button disabled={!sheet.merges?.some(box=>intersects(box,range))} onClick={()=>updateSheet(unmergeRange(sheet,range))}>取消合并</button>
      <button onClick={()=>applyStyle({bold:false,italic:false,underline:null,strike:false,color:null,fill:null,align:null,vertical:null,borders:null,font:null,size:null,numberFormat:null})}>清除格式</button>
    </div>
    {widthEditor && <form className="sheet-filter" onSubmit={e=>{
      e.preventDefault()
      const size=Number(e.currentTarget.elements.size.value)
      if (widthEditor==='col') {
        const widths={...sheet.widths}
        for (let c=range.left; c<=range.right; c++) widths[c]=size
        updateSheet({...sheet,widths})
      } else {
        const heights={...sheet.heights}
        for (const r of rangeRows) heights[r]=size
        updateSheet({...sheet,heights})
      }
      setWidthEditor(false)
    }}>
      <label>{widthEditor==='col' ? '列宽（字符）' : '行高（磅）'} <input key={widthEditor} type="number" name="size" min={widthEditor==='col'?1:9} max={widthEditor==='col'?255:409} step="any" required autoFocus defaultValue={widthEditor==='col' ? sheet.widths?.[col] ?? 14 : sheet.heights?.[row] ?? 22.5}/></label>
      <button>应用{widthEditor==='col'?'列宽':'行高'}</button><button type="button" onClick={()=>setWidthEditor(false)}>取消</button>
    </form>}
    {showFunctions && <div className="sheet-functions">
      <button onClick={()=>tryAction(()=>{
        if (sort || filter) throw new Error('请还原行序并清除筛选，再对连续区域求和。')
        const dest=address(range.bottom+1,range.left)
        if (sheet.cells[dest] || findMerge(sheet,range.bottom+1,range.left)) throw new Error('选区下方已有内容或合并单元格，请预留一个空位。')
        updateSheet(writeRange(sheet,range.bottom+1,range.left,[['=SUM('+rangeName(range)+')']]))
      })}>在选区下方插入求和</button>
      <strong>在公式栏输入函数</strong>
      <code>=IF(B2&gt;=60,"通过","复核")</code><code>=COUNTIF(B2:B12,"&gt;=60")</code><code>=SUMIF(A2:A12,"差旅",B2:B12)</code>
      <span>支持 SUM、AVERAGE、COUNT、COUNTA、MIN、MAX、ROUND、ABS。条件支持数值比较及文本匹配。</span>
    </div>}
    {removing===sheet.id && <div className="sheet-filter" role="alert"><span>删除“{sheet.name}”后，引用此表的公式将显示 #REF!。</span>
      <button onClick={()=>{change(removeSheet(book,sheet.id));setRemoving(null);select({row:0,col:0});setEditing(false)}}>确认删除工作表</button>
      <button onClick={()=>setRemoving(null)}>取消</button>
    </div>}
    <div className="sheet-formula"><output title="拖选、Shift+单击或 Shift+方向键扩展选区">{rangeName(range)}</output><span aria-hidden="true">ƒx</span><input aria-label="公式栏" placeholder="输入值或 =SUM(A1:A3)" maxLength={LIMITS.text} value={raw}
      onChange={e=>put(e.target.value)} onKeyDown={e=>{ if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); vertical(1) } }}/></div>
    {(filterOpen || filter) && <div className="sheet-filter"><Filter size={14}/><input autoFocus aria-label="工作表筛选" placeholder="按内容筛选，保留第一行表头" value={filter} onChange={e=>updateSheet({...sheet,query:e.target.value})}/><button onClick={()=>{updateSheet({...sheet,query:''});setFilterOpen(false)}}>清除筛选</button></div>}
    {sheet.chart && <SheetChart sheet={sheet} display={display} rows={allRows} col={sheet.chart.col} />}
    <div ref={scroller} className="sheet-scroll" role="region" aria-label="工作表网格" tabIndex={0}
      onScroll={e=>setScroll(e.currentTarget.scrollTop)} onKeyDown={gridKeys}
      onCopy={e=>{if (!editing) {
        e.preventDefault()
        const token=crypto.randomUUID()
        clipboard.current={token, cells:copyRange(sheet,rangeRows,range.left,range.right)}
        e.clipboardData.setData('application/x-yanye-range',token)
        e.clipboardData.setData('text/plain',delimitedText(rangeRows.map(r=>Array.from({length:range.right-range.left+1},(_,i)=>display(sheet,address(r,range.left+i)))),'\t'))
      }}}
      onPaste={e=>{
        const data = e.clipboardData.getData('text/plain')
        if (editing && !/[\r\n\t]/.test(data)) return
        e.preventDefault(); tryAction(()=>{
          const saved = clipboard.current
          const internal = saved && e.clipboardData.getData('application/x-yanye-range')===saved.token
          const matrix = internal ? saved.cells : parseDelimited(data,'\t')
          if ((sort || filter) && matrix.length>1) throw new Error('请还原行序并清除筛选，再粘贴多行。')
          const paste = internal ? pasteRange : writeRange
          updateSheet(paste(sheet,rangeRows[0],range.left,matrix)); setEditing(false)
        })
      }}>
      <table aria-label={sheet.name} className={sheet.freezeColumn?'sheet-freeze-column':''} style={{width:44+widths.reduce((a,b)=>a+b,0)}}><colgroup><col style={{width:44}}/>{cols.map(c=><col key={c} style={{width:widths[c]}}/>)}</colgroup>
        <thead><tr><th aria-label="行号"/>{cols.map(c=><th key={c} scope="col" className={c===col?'sheet-head-active':''}>{columnName(c)}{sort?.col===c?(sort.desc?' ↓':' ↑'):''}</th>)}</tr></thead>
        <tbody>
          {first>0 && !frozenHeaderDetached && <tr aria-hidden="true"><td colSpan={cols.length+1} style={{height:offsets[first]}}/></tr>}
          {visibleRows.map(r=><React.Fragment key={r}><tr style={{'--sheet-row-height':heights[r]+'px'}} className={sheet.freezeHeader && r===0?'sheet-frozen-row':''}><th scope="row" className={r===row?'sheet-head-active':''}>{r+1}</th>
            {cols.map(c=>{
              const merge=mergeGrid.get(address(r,c))
              if (merge && !merge.first) return null
              const rr=merge?.box.top ?? r, cc=merge?.box.left ?? c
              const ref = address(rr,cc), active = rr===row && cc===col
              const cellStyle=sheet.styles?.[ref] ?? {}
              const result = display(sheet,ref)
              return <td key={c} data-address={ref} aria-label={ref} rowSpan={merge?.height} colSpan={merge ? merge.box.right-merge.box.left+1 : undefined}
                style={{fontWeight:cellStyle.bold?700:undefined,fontStyle:cellStyle.italic?'italic':undefined,fontFamily:cellStyle.font,fontSize:cellStyle.size ? cellStyle.size+'pt':undefined,color:cellStyle.color,backgroundColor:cellStyle.fill,textAlign:cellStyle.align,
                  verticalAlign:cellStyle.vertical || 'bottom',textDecorationLine:[cellStyle.underline && 'underline',cellStyle.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
                  textDecorationStyle:String(cellStyle.underline).startsWith('double') ? 'double' : undefined,...cellBorders(cellStyle.borders)}}
                className={(active?'sheet-selected ':'')+(highlighted.has(rr) && c>=range.left && c<=range.right ? 'sheet-highlight ' : '')+(typeof result==='number'?'sheet-number':'')}
                onPointerDown={e=>{if(e.button!==0 || e.target.tagName==='INPUT') return; e.preventDefault(); drag.current=true; go(rr,cc,true,e.shiftKey)}}
                onPointerEnter={e=>{if(drag.current && e.buttons===1) go(rr,cc,true,true)}}
                onDoubleClick={()=>{if(!editing) { original.current=sheet.cells[ref]??''; setEditing(true) }}}>
                {active && editing ? <input ref={editInput} aria-label={'编辑 '+ref} maxLength={LIMITS.text} value={raw} onChange={e=>put(e.target.value)} onBlur={()=>setEditing(false)}/> : <span>{formatted(result,sheet.formats?.[ref])}</span>}
              </td>
            })}
          </tr>{r===0 && frozenHeaderDetached && first>1 && <tr aria-hidden="true"><td colSpan={cols.length+1} style={{height:offsets[first]-heights[0]}}/></tr>}</React.Fragment>)}
          {last<allRows.length && <tr aria-hidden="true"><td colSpan={cols.length+1} style={{height:offsets.at(-1)-offsets[last]}}/></tr>}
        </tbody>
      </table>
    </div>
    <div className="sheet-tabs" aria-label="工作表列表">{book.sheets.map(s=>
      s.id===sheet.id && rename ? <input aria-label="工作表名称" autoFocus key={s.id} defaultValue={s.name} maxLength={31}
        onFocus={e=>e.target.select()} onBlur={e=>{tryAction(()=>change(renameSheet(book,s.id,e.target.value)));setRename(false)}}
        onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter')e.target.blur();if(e.key==='Escape'){e.target.value=s.name;e.target.blur()}}}/> :
        <button key={s.id} aria-pressed={s.id===sheet.id} onClick={()=>switchSheet(s.id)} onDoubleClick={()=>setRename(true)}>{s.name}</button>)}
      <button title="新建工作表" aria-label="新建工作表" onClick={addSheet}><Plus size={15}/></button>
    </div>
    <div className="sheet-info"><span role="status">{busy?'正在交换文件…':notice || (filter ? '显示 '+(allRows.length-1)+' 条匹配数据' : sheet.rows+' 行 · '+sheet.cols+' 列')}</span>
      <details><summary>文件交换说明</summary><p>{exchangeNote}</p></details></div>
  </section>
}
