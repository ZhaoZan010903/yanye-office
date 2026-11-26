import {flushSync} from 'react-dom'
import Ribbon, { RibbonGroup } from '../office/Ribbon'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownAZ, BarChart3, Bold, ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Copy, FileDown, FileUp, Filter, Grid2X2, IndentDecrease, IndentIncrease, Italic, MessageSquarePlus, MessageSquareX, Percent, Plus, Redo2, Rows3, Sigma, Strikethrough, Table2, Underline, Undo2, WrapText } from 'lucide-react'
import {
  address, columnName, csvText, emptyWorkbook, evaluator, fillFrom, formatted, LIMITS, newSheet, parseDelimited,
  bounds, changeBorders, changeCellStyle, copyRange, delimitedText, findMerge, intersects, location, mergeRange, numberFormats, pasteRange, rangeName, removeSheet, renameSheet, shiftGrid, unmergeRange, writeRange,
} from './spreadsheet.js'
import { appendSheets, availableName, exchangeNote, readXlsx, writeXlsx } from './spreadsheet-xlsx.js'
import FontPicker from './FontPicker.jsx'
import SheetRules from './SheetRules.jsx'
import {columnAxis,rowHeight,rowOrder,rowSizes,sizedAxis,visibleColumns} from './sheet-viewport.js'
import SheetPrintPreview from './SheetPrintPreview.jsx'
import SheetPageControls from './SheetPageControls.jsx'
import SheetNoteEditor from './SheetNoteEditor.jsx'
import SheetPivot, { PivotSlicers } from './SheetPivot.jsx'
import { refreshReports } from './sheet-pivot-refresh.js'
import { editsPivotResults } from './sheet-pivot.js'
import {chartData,newChart,palettes} from './sheet-chart.js'
import {conditionalFill,conditionRules,filterRow,listChoices,validationAt} from './spreadsheet.js'
import './spreadsheet.css'

import {cellBorders} from './sheet-borders.js'

function SheetChart({sheet,display,apply}) {
  const data=useMemo(()=>chartData(sheet,display),[sheet,display])
  const values=data.series.flatMap(s=>s.values.filter(v=>v!==null))
  const min=Math.min(0,...values),max=Math.max(0,...values),span=max-min||1,zero=-min/span*100
  return <section className="sheet-chart" aria-label="柱状图">
    <div className="sheet-chart-head"><strong>分组条形图</strong>
      <label>配色 <select aria-label="图表配色" value={sheet.chart.palette??'ink'} onChange={e=>apply({...sheet,chart:{...sheet.chart,palette:e.target.value,colors:null}})}>
        {Object.entries(palettes).map(([key,[title]])=><option key={key} value={key}>{title}</option>)}</select></label>
      <span className="sheet-legend">{data.series.map(s=><span key={s.col}><i style={{background:s.color}}/>{s.title}</span>)}</span>
    </div>
    {!values.length?<p>拖选含表头、分类与数值列的区域，再插入图表。</p>:
      data.rows.map((r,i)=>!filterRow(sheet,r,display)?null:<div className="sheet-chart-group" key={r}>
        <span>{data.labels[i]||r+1}</span>
        <div>{data.series.map(s=>s.values[i]===null?null:<div key={s.col} className="sheet-signed-bar" title={s.title+' '+s.values[i]}>
          <span style={{borderLeft:'1px solid #bbb',left:zero+'%'}}/>
          <i style={{left:Math.min(zero,zero+s.values[i]/span*100)+'%',width:Math.abs(s.values[i])/span*100+'%',background:s.color}}/>
        </div>)}</div><span>{data.series.map(s=>s.values[i]??'—').join(' / ')}</span>
      </div>)}
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

export default function Spreadsheet({ value, onChange, onImport, onExport, onPrintPdf }) {
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
  const [scroll, setScroll] = useState({top:0,left:0})
  const [viewportWidth,setViewportWidth]=useState(1000)
  const [preview,setPreview]=useState(false)
  const pendingJump=useRef(null)
  const [height, setHeight] = useState(450)
  const [tab, setTab] = useState('开始')
  const [noteOpen,setNoteOpen] = useState(false)
  const [formulaVisible,setFormulaVisible] = useState(true)
  const [widthEditor, setWidthEditor] = useState(false)
  const [ruleMode,setRuleMode]=useState('')
  const [pivotOpen,setPivotOpen]=useState(false)
  const history = useRef({past:[],future:[]})
  const drag = useRef(false)
  const clipboard = useRef(null)
  const scroller = useRef(null), editInput = useRef(null), original = useRef(''), draft=useRef(null), focusGrid = useRef(false)
  const row = Math.min(selection.row, sheet.rows-1), col = Math.min(selection.col,sheet.cols-1)
  const selected = address(row,col)
  const endRow = Math.min(selection.endRow ?? row,sheet.rows-1), endCol = Math.min(selection.endCol ?? col,sheet.cols-1)
  const range = bounds({row,col},{row:endRow,col:endCol})
  const style = sheet.styles?.[selected] ?? {}
  const raw = sheet.cells[selected] ?? ''
  const note = sheet.notes?.[selected]
  const noteRefs = useMemo(()=>Object.keys(sheet.notes || {}).map(location).sort((a,b)=>a.row-b.row || a.col-b.col),[sheet.notes])
  const choices=listChoices(validationAt(sheet,row,col))
  const compiledRules=useMemo(()=>conditionRules(sheet),[sheet.conditions])
  const nativeFilter=sheet.autoFilter
  const filterOffset=nativeFilter ? col-nativeFilter.box.left : -1
  const filterColumn=nativeFilter && filterOffset>=0 && col<=nativeFilter.box.right
  const display = useMemo(() => evaluator(book),[book])
  const sort = sheet.sort
  const filter = sheet.query ?? ''
  const verticalMerges = sheet.merges?.some(m => m.bottom > m.top)
  const allRows=useMemo(()=>rowOrder(sheet,display),[sheet,display])
  const columns=useMemo(()=>columnAxis(sheet),[sheet.cols,sheet.widths])
  const heights=useMemo(()=>rowSizes(sheet,display,columns),[sheet.styles,sheet.heights,display,columns])
  const rows=useMemo(()=>{
    const changes={}
    for(const [r,h] of Object.entries(heights)) {
      const index=allRows.index(Number(r))
      if(index>=0) changes[index]=h
    }
    return sizedAxis(allRows.length,rowHeight,changes)
  },[allRows,heights])
  // Chromium caps element heights. Map the scrollbar to the logical row offsets.
  const scale=Math.max(1,(rows.total-height+rowHeight)/Math.max(1,16000000-height+rowHeight))
  const logicalTop=scroll.top*scale
  const bucketSize=8
  const rowBucket=Math.floor(rows.index(logicalTop)/bucketSize)*bucketSize
  const first=Math.max(0,rowBucket-2),last=Math.min(rows.count,rows.index(rows.offset(rowBucket+bucketSize)+height)+3)
  const topSpace=Math.max(0,rows.offset(first)-logicalTop+scroll.top)
  const scrollHeight=(rows.total-height+rowHeight)/scale+height
  const visibleRows=allRows.slice(first,last)
  const frozenHeaderDetached=sheet.freezeHeader && first>0 && allRows.at(0)===0
  if(frozenHeaderDetached) visibleRows.unshift(0)
  const colBucket=Math.floor(columns.index(scroll.left)/4)*4
  const slots=visibleColumns(columns,columns.offset(colBucket),viewportWidth+columns.offset(colBucket+4)-columns.offset(colBucket),sheet.freezeColumn)
  function scrollGrid(event) {
    const {scrollTop:top,scrollLeft:left}=event.currentTarget
    if(scale===1 && Math.floor(rows.index(top)/bucketSize)*bucketSize===rowBucket && Math.floor(columns.index(left)/4)*4===colBucket)return
    if(editing && draft.current && finishDraft())setEditing(false)
    setScroll({top,left})
  }
  const visibleSlots=slots.filter(slot=>!slot.spacer)
  const visibleCols=visibleSlots.map(slot=>slot.col)
  const tableLeft=slots.find(slot=>slot.spacer==='left')?.width || 0
  const tableWidth=44+visibleSlots.reduce((sum,slot)=>sum+slot.width,0)
  const selectedRows=[allRows.index(row),allRows.index(endRow)]
  const selectedStart=Math.min(...selectedRows), selectedEnd=Math.max(...selectedRows)
  function rangeRows() {return selectedStart<0 ? [row] : allRows.slice(selectedStart,selectedEnd+1)}
  const mergeGrid=new Map()
  for(const box of sheet.merges || []) {
    const rs=visibleRows.filter(r=>r>=box.top && r<=box.bottom)
    const cs=visibleCols.filter(c=>c>=box.left && c<=box.right)
    const split=cs.length>1 && cs[1]>cs[0]+1
    for(const r of rs) for(const c of cs) mergeGrid.set(address(r,c),{
      box,first:r===rs[0] && (c===cs[0] || (split && c===cs[1])),
      height:rs.length,width:split ? (c===cs[0] ? 1 : cs.length-1) : cs.length,
    })
  }
  useEffect(() => {
    const release = () => { drag.current = false }
    window.addEventListener('pointerup',release)
    window.addEventListener('blur',release)
    return () => { window.removeEventListener('pointerup',release); window.removeEventListener('blur',release) }
  },[])

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {setHeight(entry.contentRect.height);setViewportWidth(entry.contentRect.width)})
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
  function applyStyle(patch) { updateSheet(changeCellStyle(sheet,rangeRows(),range.left,range.right,patch)) }
  function updateSheet(next) {
    if(editsPivotResults(sheet,next)) {setNotice('透视结果由源数据生成，请修改源单元格后刷新。');return false}
    const current = latest.current
    return change({ ...current, sheets:current.sheets.map(s=>s.id===next.id ? next : s) })
  }
  function navigateNote(direction) {
    const visible=noteRefs.filter(p=>allRows.index(p.row)>=0)
    const position=p=>allRows.index(p.row)*sheet.cols+p.col
    visible.sort((a,b)=>position(a)-position(b))
    const from=position({row,col})
    const dest=direction>0 ? visible.find(p=>position(p)>from) || visible[0] : visible.findLast(p=>position(p)<from) || visible.at(-1)
    if (dest) go(dest.row,dest.col)
    else setNotice('当前筛选范围内没有批注。')
  }
  function saveNote(next) {
    const notes={...sheet.notes}
    if (next) notes[selected]=next
    else delete notes[selected]
    if (updateSheet({...sheet,notes})) setNoteOpen(false)
  }
  function selectionText() {
    return delimitedText(rangeRows().map(r=>Array.from({length:range.right-range.left+1},(_,i)=>display(sheet,address(r,range.left+i)))),'\t')
  }
  async function copySelection() {
    const previous=clipboard.current
    scroller.current?.focus()
    try {
      if (document.execCommand('copy') && clipboard.current !== previous) return
      await navigator.clipboard.writeText(selectionText())
    } catch { setNotice('请在工作表中按 Ctrl+C 复制选区。') }
  }
  function pasteCells(matrix,internal) {
    if ((sort || filter || Object.keys(nativeFilter?.columns??{}).length) && matrix.length>1) throw Error('请还原行序并清除筛选，再粘贴多行。')
    updateSheet((internal ? pasteRange : writeRange)(sheet,(selectedStart<0 ? row : allRows.at(selectedStart)),range.left,matrix))
    setEditing(false)
  }
  async function pasteValues() {
    const previous=latest.current
    try {
      const text=await navigator.clipboard.readText()
      if (text && mounted.current && latest.current===previous) tryAction(()=>pasteCells(parseDelimited(text,'\t'),false))
    } catch { setNotice('无法读取系统剪贴板。请在工作表中按 Ctrl+V 粘贴。') }
  }
  function aggregate(name) {
    tryAction(()=>{
      if (sort || filter || Object.keys(nativeFilter?.columns??{}).length) throw Error('请还原行序并清除筛选，再对连续区域汇总。')
      const dest=address(range.bottom+1,range.left)
      if (sheet.cells[dest] || findMerge(sheet,range.bottom+1,range.left)) throw Error('选区下方已有内容或合并单元格，请预留一个空位。')
      if (updateSheet(writeRange(sheet,range.bottom+1,range.left,[['='+name+'('+rangeName(range)+')']]))) setNotice('已在 '+dest+' 插入 '+name+'。')
    })
  }
  function tryAction(fn) {
    try { setNotice(''); fn() } catch (error) { setNotice(error.message) }
  }
  function refreshSelection(all) {
    tryAction(()=>{
      const previous=latest.current
      const next=refreshReports(previous,all ? undefined : sheet.id)
      if (next!==previous && change(next)) setNotice(all ? '已刷新全部数据透视表。' : '已刷新当前数据透视表。')
    })
  }
  function put(text) {
    tryAction(() => updateSheet(writeRange(sheet,row,col,[[text]])))
  }
  function finishDraft() {
    const active=draft.current
    if(!active) return true
    if(active.value!==active.original) {
      try {
        if(!updateSheet(writeRange(sheet,active.row,active.col,[[active.value]])))return false
      } catch(error){setNotice(error.message);return false}
    }
    draft.current=null
    return true
  }
  function go(r,c,focus = true,extend = false) {
    if(!finishDraft())return
    r = Math.max(0,Math.min(sheet.rows-1,r)); c = Math.max(0,Math.min(sheet.cols-1,c))
    const merge = findMerge(sheet,r,c)
    if (merge && !extend) { r=merge.top; c=merge.left }
    setEditing(false); focusGrid.current = focus
    select(extend ? {...selection,endRow:r,endCol:c} : {row:r,col:c})
    if (!focus) return
    const index = allRows.index(r), box = scroller.current
    if (index >= 0 && box) {
      const top = rows.offset(index)
      if (top < box.scrollTop*scale) box.scrollTop = top/scale
      if (top+rows.size(index)+rowHeight > box.scrollTop*scale+box.clientHeight) box.scrollTop=(top+rows.size(index)+rowHeight-box.clientHeight)/scale
      const left = 44+columns.offset(c)
      if (left < box.scrollLeft+44) box.scrollLeft = left-44
      if (left+columns.size(c) > box.scrollLeft+box.clientWidth) box.scrollLeft = left+columns.size(c)-box.clientWidth
    }
  }
  useLayoutEffect(()=>{
    if(!pendingJump.current) return
    const {row:r,col:c}=pendingJump.current
    pendingJump.current=null
    go(r,c)
  },[sheet.rows,sheet.cols])
  function jumpTo(ref) {
    const target=location(ref.trim().toUpperCase())
    if(!target || target.row<0 || target.col<0 || target.row>=LIMITS.rows || target.col>=LIMITS.cols) {
      setNotice('请输入有效的单元格地址，例如 A1 或 XFD1048576。')
      return
    }
    if(target.row<sheet.rows && target.col<sheet.cols) {go(target.row,target.col);return}
    pendingJump.current=target
    if(!updateSheet({...sheet,rows:Math.max(sheet.rows,target.row+1),cols:Math.max(sheet.cols,target.col+1)})) pendingJump.current=null
  }
  function vertical(delta) {
    const merge = findMerge(sheet,row,col)
    const from = merge && delta>0 ? merge.bottom : row
    const index = Math.max(0, allRows.index(from))
    go(allRows.at(Math.max(0,Math.min(allRows.length-1,index+delta))),col)
  }
  function startEditing(text) {
    original.current=raw
    if(!choices)draft.current={row,col,original:raw,value:text ?? raw}
    setEditing(true)
  }
  function gridKeys(event) {
    if (event.nativeEvent.isComposing || event.altKey) return
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase()
      if(key==='s' && editing) flushSync(()=>{if(finishDraft())setEditing(false)})
      if(key==='p') {event.preventDefault();setPreview(true);return}
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
      if (event.key === 'Escape') { event.preventDefault(); draft.current=null; if(choices)put(original.current); go(row,col) }
      return
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      let r=event.shiftKey ? endRow : row, c=event.shiftKey ? endCol : col
      const merge=findMerge(sheet,r,c)
      if (event.key==='ArrowRight') c=(merge?.right ?? c)+1
      if (event.key==='ArrowLeft') c=(merge?.left ?? c)-1
      if (event.key==='ArrowDown') r=allRows.at(Math.min(allRows.length-1,allRows.index(merge?.bottom ?? r)+1))
      if (event.key==='ArrowUp') r=allRows.at(Math.max(0,allRows.index(merge?.top ?? r)-1))
      go(r,c,true,event.shiftKey)
    }
    else if (event.key === 'F2') { event.preventDefault(); if (event.shiftKey) setNoteOpen(true); else startEditing() }
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const cells = {...sheet.cells}
      for (const r of rangeRows()) for (let c=range.left; c<=range.right; c++) delete cells[address(r,c)]
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
  return <section className="sheet-module" data-gridlines={sheet.showGridLines!==false} aria-label="电子表格"
    onKeyDownCapture={event=>{
      if (event.key!=='F5' || !event.altKey || event.shiftKey || event.metaKey || event.nativeEvent.isComposing ||
          !(event.ctrlKey ? book.sheets.some(s=>s.pivot) : sheet.pivot)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) refreshSelection(event.ctrlKey)
    }}>
    <Ribbon label="表格" tabs={['开始','插入','页面布局','公式','数据','审阅','视图','导入导出']} active={tab}
      onChange={next=>{setTab(next);setWidthEditor(false);setRuleMode('');setFilterOpen(false);setPivotOpen(false)}}>
      <button className="sheet-action" aria-label="撤销表格操作" title="撤销 Ctrl+Z" disabled={!history.current.past.length} onClick={()=>undo()}><Undo2 size={15}/></button>
      <button className="sheet-action" aria-label="重做表格操作" title="重做 Ctrl+Y" disabled={!history.current.future.length} onClick={()=>undo(true)}><Redo2 size={15}/></button>
    </Ribbon>
    <div className="sheet-toolbar sheet-format ribbon-panel" role="toolbar" aria-label={tab==='开始'?'选区格式':tab+'工具'}>
      {tab==='页面布局' && <><SheetPageControls sheet={sheet} range={range} apply={updateSheet}/><RibbonGroup label="打印"><button onClick={()=>setPreview(true)}>打印预览</button></RibbonGroup></>}
      {tab==='数据' && <><RibbonGroup label="排序与筛选">
      <button className="sheet-action" disabled={verticalMerges} title={'按 '+columnName(col)+' 列升序排列'} onClick={()=>updateSheet({...sheet,sort:{col,desc:false}})}><ArrowDownAZ size={16}/>升序</button>
      <SheetMenu label="排序与筛选" icon={Filter}>
        <button disabled={verticalMerges} onClick={()=>updateSheet({...sheet,sort:{col,desc:false}})}>按 {columnName(col)} 列升序</button>
        <button disabled={verticalMerges} onClick={()=>updateSheet({...sheet,sort:{col,desc:true}})}>按 {columnName(col)} 列降序</button>
        <button disabled={!sort} onClick={()=>updateSheet({...sheet,sort:null})}>还原行序</button>
        <button disabled={verticalMerges} onClick={()=>setFilterOpen(true)}>筛选行</button>
        <button disabled={verticalMerges || (!nativeFilter && range.top===range.bottom)} onClick={()=>updateSheet({...sheet,autoFilter:nativeFilter?null:{box:range,columns:{}}})}>{nativeFilter?'关闭范围自动筛选':'对选区启用自动筛选'}</button>
        {verticalMerges && <small>先拆分跨行合并的单元格再筛选或排序。</small>}
      </SheetMenu>
      </RibbonGroup><RibbonGroup label="数据工具"><SheetMenu label="数据规则">
        <button onClick={()=>setRuleMode('list')}>下拉列表验证</button>
        <button onClick={()=>setRuleMode('condition')}>数值条件格式</button>
      </SheetMenu>
      </RibbonGroup></>}
      {tab==='插入' && <RibbonGroup label="图表">
      <button className="sheet-action" title="选择含表头的分类列与一个或多个数值列" aria-pressed={!!sheet.chart} onClick={()=>tryAction(()=>updateSheet({...sheet,chart:sheet.chart?null:newChart(range)}))}><BarChart3 size={15}/>柱状图</button>
      </RibbonGroup>}
      {tab==='插入' && <RibbonGroup label="行与列">
        <button className="sheet-action" onClick={()=>structure('row',1)}><Rows3 size={16}/>插入行</button>
        <button className="sheet-action" onClick={()=>structure('col',1)}>插入列</button>
      </RibbonGroup>}
      {(tab==='插入' || tab==='数据') && <RibbonGroup label="透视分析">
        <button className="sheet-action" onClick={()=>setPivotOpen(v=>!v)}><Table2 size={16}/>{sheet.pivot?'透视表字段':'数据透视表'}</button>
        {sheet.pivot && <button className="sheet-action" title="刷新当前数据透视表（Alt+F5）" aria-keyshortcuts="Alt+F5"
          onClick={()=>refreshSelection(false)}>刷新数据透视表</button>}
        {book.sheets.some(s=>s.pivot) && <button className="sheet-action" title="刷新全部数据透视表（Ctrl+Alt+F5）" aria-keyshortcuts="Control+Alt+F5"
          onClick={()=>refreshSelection(true)}>全部刷新</button>}
      </RibbonGroup>}
      {(tab==='插入' || tab==='审阅') && <RibbonGroup label="批注">
        <button className="sheet-action" aria-keyshortcuts="Shift+F2" title="Shift+F2" onClick={()=>setNoteOpen(true)}><MessageSquarePlus size={16}/>{note?'编辑批注':'新建批注'}</button>
        {tab==='审阅' && <button className="sheet-action" disabled={!note} onClick={()=>saveNote(null)}><MessageSquareX size={16}/>删除批注</button>}
      </RibbonGroup>}
      {tab==='审阅' && <RibbonGroup label="浏览批注">
        <button className="sheet-action" disabled={!noteRefs.length} onClick={()=>navigateNote(-1)}><ChevronLeft size={15}/>上一条批注</button>
        <button className="sheet-action" disabled={!noteRefs.length} onClick={()=>navigateNote(1)}><ChevronRight size={15}/>下一条批注</button>
      </RibbonGroup>}
      {tab==='公式' && <RibbonGroup label="函数库">
        <button className="sheet-action" aria-label="在选区下方插入求和" onClick={()=>aggregate('SUM')}><Sigma size={17}/>自动求和</button>
        <SheetMenu label="常用函数">{[['平均值','AVERAGE'],['数值计数','COUNT'],['非空计数','COUNTA'],['最大值','MAX'],['最小值','MIN']].map(([label,fn])=>
          <button key={fn} onClick={()=>aggregate(fn)}>{label} · {fn}</button>)}</SheetMenu>
      </RibbonGroup>}
      {tab==='视图' && <><RibbonGroup label="显示">
        <label><input type="checkbox" checked={sheet.showGridLines!==false} onChange={e=>updateSheet({...sheet,showGridLines:e.target.checked})}/><Grid2X2 size={15}/>网格线</label>
        <label><input type="checkbox" checked={formulaVisible} onChange={e=>setFormulaVisible(e.target.checked)}/>公式栏</label>
      </RibbonGroup><RibbonGroup label="冻结窗格">
        <button className="sheet-action" aria-pressed={!!sheet.freezeHeader} onClick={()=>updateSheet({...sheet,freezeHeader:!sheet.freezeHeader})}>冻结首行</button>
        <button className="sheet-action" aria-pressed={!!sheet.freezeColumn} onClick={()=>updateSheet({...sheet,freezeColumn:!sheet.freezeColumn})}>冻结首列</button>
      </RibbonGroup></>}
      {tab==='导入导出' && <RibbonGroup label="工作簿交换">
      <SheetMenu label="导入" icon={FileUp}><button disabled={busy} onClick={()=>exchange('csv',true)}>导入 CSV</button><button disabled={busy} onClick={()=>exchange('xlsx',true)}>导入 XLSX</button></SheetMenu>
      <SheetMenu label="导出" icon={FileDown}><button disabled={busy} onClick={()=>exchange('csv',false)}>导出 CSV</button><button disabled={busy} onClick={()=>exchange('xlsx',false)}>导出 XLSX</button></SheetMenu>
    </RibbonGroup>}
    {tab==='开始' && <><RibbonGroup label="剪贴板">
      <button title="复制选区 Ctrl+C" onClick={copySelection}><Copy size={16}/>复制</button>
      <button title="将系统剪贴板文本粘贴到选区起点" onClick={pasteValues}><ClipboardPaste size={16}/>粘贴文本</button>
      </RibbonGroup>
      <RibbonGroup label="字体"><FontPicker label="选区字体" value={style.font || ''} defaultLabel="默认字体" useLocalNames onChange={font=>applyStyle({font})}/>
      <select aria-label="选区字号" value={style.size || ''} onChange={e=>applyStyle({size:Number(e.target.value)})}>
        <option value="">默认字号</option>{[...new Set([9,10,11,12,14,16,18,20,24,28,32,...(style.size ? [style.size] : [])])].sort((a,b)=>a-b).map(size=><option key={size} value={size}>{size} pt</option>)}
      </select>
      <button aria-pressed={!!style.bold} aria-label="加粗选区" title="加粗 Ctrl+B" onClick={()=>applyStyle({bold:!style.bold})}><Bold size={15}/></button>
      <button aria-pressed={!!style.italic} aria-label="倾斜选区" title="倾斜 Ctrl+I" onClick={()=>applyStyle({italic:!style.italic})}><Italic size={15}/></button>
      <button aria-pressed={!!style.underline} aria-label="选区下划线" title="下划线 Ctrl+U" onClick={()=>applyStyle({underline:style.underline ? null : 'single'})}><Underline size={15}/></button>
      <button aria-pressed={!!style.strike} aria-label="选区删除线" title="删除线" onClick={()=>applyStyle({strike:!style.strike})}><Strikethrough size={15}/></button>
      <label>字色<input type="color" aria-label="选区字体颜色" value={style.color ?? '#37352f'} onChange={e=>applyStyle({color:e.target.value.toUpperCase()})}/></label>
      <label>底色<input type="color" aria-label="选区填充颜色" value={style.fill ?? '#ffffff'} onChange={e=>applyStyle({fill:e.target.value.toUpperCase()})}/></label>
      </RibbonGroup><RibbonGroup label="对齐方式">
      <select aria-label="选区水平对齐" value={style.align || ''} onChange={e=>applyStyle({align:e.target.value})}>
        <option value="">自动对齐</option><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
      </select>
      <select aria-label="选区垂直对齐" value={style.vertical || ''} onChange={e=>applyStyle({vertical:e.target.value})}>
        <option value="">垂直默认</option><option value="top">顶端对齐</option><option value="middle">垂直居中</option><option value="bottom">底端对齐</option>
      </select>
      <button aria-pressed={!!style.wrap} title="自动换行" onClick={()=>applyStyle({wrap:!style.wrap})}><WrapText size={15}/>自动换行</button>
      <button aria-label="减少缩进" title="减少缩进" disabled={!style.indent} onClick={()=>applyStyle({indent:Math.max(0,(style.indent || 0)-1)})}><IndentDecrease size={15}/></button>
      <button aria-label="增加缩进" title="增加缩进" disabled={style.indent>=15} onClick={()=>applyStyle({indent:(style.indent || 0)+1})}><IndentIncrease size={15}/></button>
      <button disabled={range.top===range.bottom && range.left===range.right} onClick={()=>tryAction(()=>{
        if (range.bottom>range.top && (sort || filter)) throw new Error('请还原行序并清除筛选，再合并多行。')
        updateSheet(mergeRange(sheet,range)); go(range.top,range.left)
      })}>合并单元格</button>
      <button disabled={!sheet.merges?.some(box=>intersects(box,range))} onClick={()=>updateSheet(unmergeRange(sheet,range))}>取消合并</button>
      </RibbonGroup><RibbonGroup label="数字">
      <select aria-label="选区数字格式" value={sheet.formats?.[selected] || ''} onChange={e=>applyStyle({numberFormat:e.target.value})}>
        <option value="">常规</option>{Object.entries(numberFormats).map(([key,[label]])=><option key={key} value={key}>{label}</option>)}</select>
      <button title="人民币格式" aria-label="人民币格式" onClick={()=>applyStyle({numberFormat:'currency'})}>¥</button>
      <button title="百分比格式" aria-label="百分比格式" onClick={()=>applyStyle({numberFormat:'percentWhole'})}><Percent size={15}/></button>
      </RibbonGroup><RibbonGroup label="单元格">
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
          <button key={mode} onClick={()=>updateSheet(changeBorders(sheet,rangeRows(),range.left,range.right,mode))}>{label}</button>)}
      </SheetMenu>
      </RibbonGroup><RibbonGroup label="编辑">
      <button onClick={()=>applyStyle({bold:false,italic:false,underline:null,strike:false,color:null,fill:null,align:null,vertical:null,wrap:null,indent:null,borders:null,font:null,size:null,numberFormat:null})}>清除格式</button>
    </RibbonGroup></>}</div>
    {tab==='审阅' && note && <aside className="sheet-note-preview" aria-label="当前批注"><strong>{selected} · {note.author}</strong><span>{note.text}</span></aside>}
    {noteOpen && <SheetNoteEditor address={selected} note={note} close={()=>setNoteOpen(false)} save={saveNote}/>}
    {widthEditor && <form className="sheet-filter" onSubmit={e=>{
      e.preventDefault()
      const size=Number(e.currentTarget.elements.size.value)
      if (widthEditor==='col') {
        const widths={...sheet.widths}
        for (let c=range.left; c<=range.right; c++) widths[c]=size
        updateSheet({...sheet,widths})
      } else {
        const heights={...sheet.heights}
        for (const r of rangeRows()) heights[r]=size
        updateSheet({...sheet,heights})
      }
      setWidthEditor(false)
    }}>
      <label>{widthEditor==='col' ? '列宽（字符）' : '行高（磅）'} <input key={widthEditor} type="number" name="size" min={widthEditor==='col'?1:9} max={widthEditor==='col'?255:409} step="any" required autoFocus defaultValue={widthEditor==='col' ? sheet.widths?.[col] ?? 14 : sheet.heights?.[row] ?? 22.5}/></label>
      <button>应用{widthEditor==='col'?'列宽':'行高'}</button><button type="button" onClick={()=>setWidthEditor(false)}>取消</button>
    </form>}
    {tab==='公式' && <details className="sheet-function-help"><summary>公式输入示例</summary><div className="sheet-functions">
      <code>=IF(B2&gt;=60,"通过","复核")</code><code>=COUNTIF(B2:B12,"&gt;=60")</code><code>=SUMIF(A2:A12,"差旅",B2:B12)</code>
      <code>=SUMIFS(C2:C12,A2:A12,"差旅",B2:B12,"已批")</code><code>=IFERROR(VLOOKUP(A2,价目!A2:C20,3,FALSE),"未找到")</code>
      <span>支持 COUNTIFS、多条件求和、通配符和跨表查找。VLOOKUP 精确查找用 FALSE；近似查找须按首列升序。每个引用区域最多 50,000 格，整列引用和动态数组暂不支持。</span>
    </div></details>}
    {removing===sheet.id && <div className="sheet-filter" role="alert"><span>删除“{sheet.name}”后，引用此表的公式将显示 #REF!。</span>
      <button onClick={()=>{change(removeSheet(book,sheet.id));setRemoving(null);select({row:0,col:0});setEditing(false)}}>确认删除工作表</button>
      <button onClick={()=>setRemoving(null)}>取消</button>
    </div>}
    {pivotOpen && <SheetPivot key={sheet.id} book={book} sheet={sheet} range={range} display={display} apply={change} close={()=>setPivotOpen(false)}/>}
    {Boolean(sheet.pivot?.slicers?.length) && <PivotSlicers key={sheet.id} book={book} sheet={sheet} onChange={change} onError={setNotice}/>}
    {ruleMode && <SheetRules key={sheet.id+':'+rangeName(range)+':'+ruleMode} mode={ruleMode} sheet={sheet} box={range} apply={updateSheet} close={()=>setRuleMode('')} tryAction={tryAction}/>}
    {filterColumn && <div className="sheet-filter"><Filter size={14}/><label>{columnName(col)} 列筛选 <select aria-label="列值筛选" value={JSON.stringify(nativeFilter.columns[filterOffset]??null)} onChange={e=>{
      const columns={...nativeFilter.columns}, values=JSON.parse(e.target.value)
      if (values===null) delete columns[filterOffset]; else columns[filterOffset]=values
      updateSheet({...sheet,autoFilter:{...nativeFilter,columns}})
    }}><option value="null">全部值</option>
      {nativeFilter.columns[filterOffset]?.length>1 && <option value={JSON.stringify(nativeFilter.columns[filterOffset])}>已选 {nativeFilter.columns[filterOffset].length} 项</option>}
      {Array.from(new Set([...(nativeFilter.columns[filterOffset]??[]),...Object.keys(sheet.cells).filter(ref=>{
        const p=location(ref); return p.col===col && p.row>nativeFilter.box.top && p.row<=nativeFilter.box.bottom
      }).map(ref=>String(display(sheet,ref))), ''])).map(v=><option key={v} value={JSON.stringify([v])}>{v || '（空白）'}</option>)}
    </select></label><span>{rangeName(nativeFilter.box)}</span></div>}
    <div hidden={!formulaVisible} className="sheet-formula"><input className="sheet-name-box" key={sheet.id+rangeName(range)} aria-label="名称框" title="输入单元格地址并按 Enter 定位" defaultValue={rangeName(range)} onFocus={e=>e.target.select()} onBlur={e=>{e.target.value=rangeName(range)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();jumpTo(e.target.value)} if(e.key==='Escape')scroller.current?.focus()}}/><span aria-hidden="true">ƒx</span>
      {choices && <select aria-label="单元格下拉列表" value={raw.replace(/^'/,'')} onChange={e=>put(e.target.value)}>
        <option value="">（空白）</option>{choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}</select>}
      <input aria-label="公式栏" placeholder="输入值或 =SUM(A1:A3)" maxLength={LIMITS.text} value={raw} readOnly={!!choices && ['1','true'].includes(validationAt(sheet,row,col)?.attrs.showErrorMessage)}
      onChange={e=>put(e.target.value)} onKeyDown={e=>{ if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); vertical(1) } }}/></div>
    {(filterOpen || filter) && <div className="sheet-filter"><Filter size={14}/><input autoFocus aria-label="工作表筛选" placeholder="按内容筛选，保留第一行表头" value={filter} onChange={e=>updateSheet({...sheet,query:e.target.value})}/><button onClick={()=>{updateSheet({...sheet,query:''});setFilterOpen(false)}}>清除筛选</button></div>}
    {sheet.chart && <SheetChart sheet={sheet} display={display} apply={updateSheet} />}
    <div ref={scroller} className="sheet-scroll" role="region" aria-label="工作表网格" tabIndex={0}
      onScroll={scrollGrid} onKeyDown={gridKeys}
      onPointerDown={e=>{
        if(e.button!==0 || ['INPUT','SELECT'].includes(e.target.tagName)) return
        const ref=e.target.closest('td[data-address]')?.dataset.address
        if(!ref)return
        e.preventDefault();drag.current=true
        const p=location(ref);go(p.row,p.col,true,e.shiftKey)
      }}
      onPointerOver={e=>{
        if(!drag.current || e.buttons!==1) return
        const ref=e.target.closest('td[data-address]')?.dataset.address
        if(ref){const p=location(ref);go(p.row,p.col,true,true)}
      }}
      onDoubleClick={e=>{
        const ref=e.target.closest('td[data-address]')?.dataset.address
        if(ref && !editing)startEditing()
      }}
      onCopy={e=>{if (!editing) {
        e.preventDefault()
        const token=crypto.randomUUID()
        clipboard.current={token, cells:copyRange(sheet,rangeRows(),range.left,range.right)}
        e.clipboardData.setData('application/x-yanye-range',token)
        e.clipboardData.setData('text/plain',selectionText())
      }}}
      onPaste={e=>{
        const data = e.clipboardData.getData('text/plain')
        if (editing && !/[\r\n\t]/.test(data)) return
        e.preventDefault(); tryAction(()=>{
          const saved = clipboard.current
          const internal = saved && e.clipboardData.getData('application/x-yanye-range')===saved.token
          const matrix = internal ? saved.cells : parseDelimited(data,'\t')
          pasteCells(matrix,internal)
        })
      }}>
      <div className="sheet-extent" style={{position:'relative',width:44+columns.total,height:Math.max(30,scrollHeight)}}>
      <table aria-label={sheet.name} className={sheet.freezeColumn?'sheet-freeze-column':''} style={{position:'absolute',left:tableLeft,top:Math.max(0,topSpace-(frozenHeaderDetached?rows.size(0):0)),width:tableWidth}}><colgroup><col style={{width:44}}/>{visibleSlots.map(({width},i)=><col key={i} style={{width}}/>)}</colgroup>
        <thead><tr><th aria-label="行号"/>{visibleSlots.map(({col:c},i)=><th key={i} scope="col" className={c===col?'sheet-head-active':''}>{columnName(c)}{sort?.col===c?(sort.desc?' ↓':' ↑'):''}</th>)}</tr></thead>
        <tbody>
          {visibleRows.map((r,i)=><React.Fragment key={i}><tr style={{'--sheet-row-height':(heights[r] || rowHeight)+'px'}} className={sheet.freezeHeader && r===0?'sheet-frozen-row':''}><th scope="row" className={r===row?'sheet-head-active':''}>{r+1}</th>
            {visibleSlots.map(({col:c},slot)=>{
              const merge=mergeGrid.get(address(r,c))
              if (merge && !merge.first) return null
              const rr=merge?.box.top ?? r, cc=merge?.box.left ?? c
              const ref = address(rr,cc), active = rr===row && cc===col
              const inRange=allRows.index(rr)>=selectedStart && allRows.index(rr)<=selectedEnd && c>=range.left && c<=range.right
              if(!active && !inRange && !merge && !sheet.cells[ref] && !sheet.styles?.[ref] && !sheet.notes?.[ref] && !compiledRules.length)
                return <td key={slot} data-address={ref} aria-label={ref}/>
              const cellStyle=sheet.styles?.[ref] ?? {}
              const result = display(sheet,ref)
              const cellNote=sheet.notes?.[ref]
              return <td key={slot} data-address={ref} data-note={cellNote?true:undefined} data-wrap={cellStyle.wrap || undefined}
                title={cellNote?cellNote.author+'：'+cellNote.text:undefined} aria-label={ref} rowSpan={merge?.height} colSpan={merge?.width}
                style={{fontWeight:cellStyle.bold?700:undefined,fontStyle:cellStyle.italic?'italic':undefined,fontFamily:cellStyle.font,fontSize:cellStyle.size ? cellStyle.size+'pt':undefined,color:cellStyle.color,backgroundColor:conditionalFill(compiledRules,rr,cc,result)??cellStyle.fill,textAlign:cellStyle.align,
                  paddingInlineStart:cellStyle.indent?4+cellStyle.indent*12:undefined,verticalAlign:cellStyle.vertical || 'bottom',textDecorationLine:[cellStyle.underline && 'underline',cellStyle.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
                  textDecorationStyle:String(cellStyle.underline).startsWith('double') ? 'double' : undefined,...cellBorders(cellStyle.borders)}}
                className={(active?'sheet-selected ':'')+(inRange ? 'sheet-highlight ' : '')+(typeof result==='number'?'sheet-number':'')}>
                {active && editing && choices ? <select ref={editInput} aria-label={'选择 '+ref} value={raw.replace(/^'/,'')} onChange={e=>put(e.target.value)} onBlur={()=>setEditing(false)}>
                  <option value="">（空白）</option>{choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}</select>
                : active && editing ? <input ref={editInput} aria-label={'编辑 '+ref} maxLength={LIMITS.text} defaultValue={draft.current?.value ?? raw} onChange={e=>{if(draft.current)draft.current.value=e.target.value}} onBlur={()=>{if(finishDraft())setEditing(false)}}/> : <span>{formatted(result,sheet.formats?.[ref])}</span>}
              </td>
            })}
          </tr></React.Fragment>)}
        </tbody>
      </table></div>
    </div>
    {preview && <SheetPrintPreview onPrintPdf={onPrintPdf} sheet={sheet} display={display} close={()=>setPreview(false)}/>}
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
